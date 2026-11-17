#!/usr/bin/env python3
"""Mutation self-check: deliberately break one fail-closed rule at a time and prove the test-suite notices.

    BP_V421_ENGINE_ROOT=<engine_root> python3 tools/mutation_check.py [--json out/MUTATION_CHECK.json] [--only ID ...] [-j 2]

Each mutant is applied to a throw-away COPY of the project (the repository is never modified) and the whole suite is run
(``unittest discover``; ``--failfast`` stops at the first failing test). A mutant is KILLED when the suite fails, SURVIVED when it still passes (a test gap),
INVALID when its code snippet no longer matches exactly once. The unmutated copy is run first and must pass.
Exit code 0 only when the control passes and every mutant is killed. Deterministic: derandomized property tests,
no timings in the report.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# (id, file, old snippet (must occur exactly once), new snippet, rule being broken)
MUTANTS = [
    ("O4-01", "oem_stage/o4_relations.py", '    return "UNKNOWN", None\n\n\ndef _allow_list_ok',
     '    return ("EXCLUDED", None) if types.get("absent_from_list") else ("UNKNOWN", None)\n\n\ndef _allow_list_ok',
     "absence from an OEM list becomes EXCLUDED"),
    ("O4-02", "oem_stage/o4_relations.py", '    if nt:\n        return "CONFLICT_HOLD", "time_bound_not_tested_unadjudicated"',
     '    if False:\n        return "CONFLICT_HOLD", "time_bound_not_tested_unadjudicated"',
     "time-bound 'not tested' no longer holds (N01)"),
    ("O4-03", "oem_stage/o4_relations.py", '    if pos and neg:\n        return "CONFLICT_HOLD", "positive_vs_explicit_no_recommendation"',
     '    if False:\n        return "CONFLICT_HOLD", "positive_vs_explicit_no_recommendation"',
     "a positive claim vs an explicit no-recommendation is no longer a conflict"),
    ("O4-04", "oem_stage/o4_relations.py", '        effective = "UNKNOWN" if issues else proposed_state',
     '        effective = proposed_state',
     "identity/article/condition/TTL issues no longer hold a relation"),
    ("O4-05", "oem_stage/o4_relations.py", '    elif accepted_state == proposed_state:', '    elif True:',
     "unverified (non-accepted) evidence can grant an effective state"),
    ("O4-06", "oem_stage/o4_relations.py", '    if expired:\n        issues.add("evidence_expired_ttl")',
     '    if False:\n        issues.add("evidence_expired_ttl")', "expired evidence is silently granted (OD2)"),
    ("O4-07", "oem_stage/o4_relations.py", '    if synthetic:\n        blockers.append("synthetic_relation")',
     '    if False:\n        blockers.append("synthetic_relation")', "synthetic relations can become publish candidates"),
    ("O4-08", "oem_stage/o4_relations.py",
     '    if "LISTED_CONDITIONAL" in (proposed_state, effective):\n        blockers.append("od4_conditional_held")',
     '    if False:\n        blockers.append("od4_conditional_held")', "conditional relations are no longer held (OD4)"),
    ("O4-09", "oem_stage/o4_relations.py",
     '    if slot["relation_type"] == "adapter_between":\n        blockers.append("od5_one_ended_adapter_abstain")',
     '    if False:\n        blockers.append("od5_one_ended_adapter_abstain")', "one-ended adapters no longer abstain (OD5)"),
    ("O4-10", "oem_stage/o4_relations.py", '    if merged["veto_mode"] != "report_only":', '    if False:',
     "veto enforcement becomes configurable (OD3)"),
    ("O4-11", "oem_stage/o4_relations.py", '        "veto": {"candidate": effective == "EXCLUDED",',
     '        "veto": {"candidate": proposed_state == "EXCLUDED",', "an unverified exclusion becomes a veto candidate"),
    ("O4-12", "oem_stage/o4_relations.py",
     '    return (relation_type, tuple(sorted((k, (v["key"] if v else "none")) for k, v in resolved.items())))',
     '    return (relation_type, tuple(sorted((k, (v["key"] if v else "none")) for k, v in resolved.items() if k != "chassis")))',
     "scope inheritance: relations merge across chassis"),
    ("O4-13", "oem_stage/o4_relations.py",
     '    if slot["relation_type"] == "vehicle_general":\n        blockers.append("class_c_never_ab")',
     '    if False:\n        blockers.append("class_c_never_ab")', "class C can reach the A/B tier"),
    ("O4-14", "oem_stage/o4_relations.py", '        return False, "od6_allowlist_empty"', '        return True, None',
     "an empty allow-list publishes (OD6)"),
    ("O4-15", "oem_stage/o4_relations.py", '        if len(shapes) > 1:\n            return "CONFLICT_HOLD", "conditions_disagree"',
     '        if False:\n            return "CONFLICT_HOLD", "conditions_disagree"', "disagreeing conditions are merged silently"),
    ("O1-01", "oem_stage/o1_evidence.py", '        if got != rec["sha256"]:\n            return ("HASH_MISMATCH", f"recomputed {got}")',
     '        if False:\n            return ("HASH_MISMATCH", f"recomputed {got}")', "SHA-256 is not recomputed over the stored bytes"),
    ("O1-02", "oem_stage/o1_evidence.py", '        elif norm_text(claim["quote"]) not in text:\n            reasons.append("quote_not_found")',
     '        elif False:\n            reasons.append("quote_not_found")', "the quoted text need not appear in the bytes"),
    ("O1-03", "oem_stage/o1_evidence.py", '    if policy["require_distinct_reviewer"] and review["reviewer"] == claim["extracted_by"]:',
     '    if False:', "the extractor may review their own claim"),
    ("O1-04", "oem_stage/o1_evidence.py",
     '    if (claim["synthetic"] or (doc is not None and doc["synthetic"])) and not policy["allow_synthetic"]:', '    if False:',
     "synthetic evidence is accepted by default policy"),
    ("O1-05", "oem_stage/o1_evidence.py", '        reasons.append("reviewer_equals_extractor")\n    if state in ("NO_BYTES", "MISSING_BYTES"):',
     '        reasons.append("reviewer_equals_extractor")\n    if False:', "a VERIFIED claim without captured bytes is accepted"),
    ("O1-06", "oem_stage/o1_evidence.py", '        if review["quote_attestation"] != "human_attested":', '        if False:',
     "a PDF quote is accepted without human attestation"),
    ("O2-01", "oem_stage/o2_identity.py", '    if len({_script(c) for c in text if c.isalpha()} - {None}) > 1:\n        flags.add("mixed_script")',
     '    if False:\n        flags.add("mixed_script")', "mixed-script (look-alike) model names are not blocked"),
    ("O2-02", "oem_stage/o2_identity.py", '        verified = [a for a in hits if a["status"] == "VERIFIED"]',
     '        verified = [a for a in hits if a["status"] in ("VERIFIED", "PROPOSED")]', "a PROPOSED alias resolves a model"),
    ("O2-03", "oem_stage/o2_identity.py",
     '        if len(targets) > 1:\n            return {**out, "status": "ambiguous", "reason": "multiple_models", "candidates": sorted(targets)}',
     '        if False:\n            return {**out, "status": "ambiguous", "reason": "multiple_models", "candidates": sorted(targets)}',
     "an ambiguous alias is resolved by guessing"),
    ("O2-04", "oem_stage/o2_identity.py", '    if any(c in text for c in "/\\\\|"):\n        flags.add("slash_shorthand")',
     '    if False:\n        flags.add("slash_shorthand")', "slash shorthand ('A/B') is not blocked"),
    ("O2-05", "oem_stage/o2_identity.py", '    if unicodedata.normalize("NFKC", text) != text:\n        flags.add("non_nfkc")',
     '    if False:\n        flags.add("non_nfkc")', "non-NFKC (e.g. NBSP) names are not blocked"),
    ("O3-01", "oem_stage/o3_articles.py",
     '        if b["status"] != "VERIFIED":\n            return {**out, "status": "proposed", "reasons": ["binding_unverified"]}',
     '        if False:\n            return {**out, "status": "proposed", "reasons": ["binding_unverified"]}', "a PROPOSED binding is treated as bound"),
    ("O3-02", "oem_stage/o3_articles.py", '        ok, reasons = self._evidence_ok(b)\n        if not ok:',
     '        ok, reasons = self._evidence_ok(b)\n        if False:', "a binding needs no accepted evidence claim"),
    ("O3-03", "oem_stage/o3_articles.py", '        if self.catalog_skus is not None and b["catalog_sku"] not in self.catalog_skus:',
     '        if False:', "a binding to a SKU that is not in the catalog is accepted"),
    ("O3-04", "oem_stage/o3_articles.py", '            if same_article and sku_ok:', '            if True:',
     "evidence that names a different article/SKU backs the join"),
    ("C-01", "oem_stage/conditions.py", '            if not isinstance(items, list) or not items:', '            if not isinstance(items, list):',
     "empty all_of/any_of is accepted (vacuous pass)"),
    ("C-02", "oem_stage/conditions.py", '    if review_state == "unknown":\n        return UNKNOWN', '    if review_state == "unknown":\n        return PASS',
     "unreviewed conditions pass"),
    ("C-03", "oem_stage/conditions.py", '    if attr not in ctx:\n        return UNKNOWN', '    if attr not in ctx:\n        return PASS',
     "a missing context attribute fails open"),
    ("C-04", "oem_stage/conditions.py", '        else:\n            raise UnsupportedCondition(f"unsupported condition shape {sorted(keys)}")',
     '        else:\n            pass', "an unknown condition shape is ignored"),
    ("C-05", "oem_stage/conditions.py", '    if PASS in values:\n        return PASS\n    return UNKNOWN if UNKNOWN in values else FAIL',
     '    if PASS in values:\n        return PASS\n    return FAIL', "any_of loses three-valued logic"),
    ("C-06", "oem_stage/conditions.py", '        if depth > limits["max_depth"]:', '        if False:', "the nesting-depth limit is not enforced"),
    ("CL-01", "oem_stage/classify.py", '    if not catalog_identity_ok:\n        return "HOLD_CATALOG_IDENTITY"',
     '    if False:\n        return "HOLD_CATALOG_IDENTITY"', "an unresolved catalog identity no longer holds a case"),
    ("CL-02", "oem_stage/classify.py", '    if "EXCLUDED" in prop:\n        return "EXCLUDED_PENDING_VERIFICATION"',
     '    if False:\n        return "EXCLUDED_PENDING_VERIFICATION"', "a pending exclusion is not reported"),
    ("CL-03", "oem_stage/classify.py", '    if prop == {"UNKNOWN"}:\n        return "UNKNOWN_NOT_LISTED"',
     '    if False:\n        return "UNKNOWN_NOT_LISTED"', "not-listed models are not reported as UNKNOWN"),
    ("CL-04", "oem_stage/classify.py", '    if any(not r["publish"]["a_tier_candidate"] for r in live):\n        return "HELD_BY_POLICY"',
     '    if False:\n        return "HELD_BY_POLICY"', "policy-held relations are reported as eligible candidates"),
    ("CL-05", "oem_stage/classify.py", '    return identity is not None and identity["status"] == "resolved" and identity["verified"]',
     '    return identity is not None and identity["status"] == "resolved"', "an unverified catalog identity counts as verified"),
    ("SH-01", "oem_stage/shadow.py", '    veto = {"mode": "report_only", "enforced": False,', '    veto = {"mode": "report_only", "enforced": True,',
     "the veto report claims enforcement"),
    ("SH-02", "oem_stage/shadow.py", '                if tgt["lang"] == src["lang"]:', '                if True:',
     "RU and UK catalog rows are cross-joined"),
    ("SH-03", "oem_stage/shadow.py", '    if present is None:\n        return "current_not_evaluated"',
     '    if present is None:\n        return "agree_current_recommends"', "an unevaluated current side is reported as agreement"),
]


FAILFAST = False


def _run_suite(work: Path, env_extra: dict) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env.update(env_extra)
    cmd = [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-t", "."] + (["-f"] if FAILFAST else [])
    return subprocess.run(cmd, cwd=work, env=env, capture_output=True, text=True, timeout=1800)


def _copy_project() -> tuple:
    tmp = tempfile.TemporaryDirectory()
    work = Path(tmp.name) / "project"
    shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns("__pycache__", "out", ".git", "*.pyc", ".hypothesis"))
    return tmp, work


def failing_tests(output: str) -> list:
    """Sorted ids of the failing/erroring tests (``module.Class.test``), from unittest's FAIL:/ERROR: lines."""
    found = set()
    for line in output.splitlines():
        match = re.match(r"^(FAIL|ERROR): \S+ \(([^)]+)\)", line)
        if match:
            found.add(match.group(2).replace("tests.", "", 1))
    return sorted(found)


def run_mutant(mutant, env_extra) -> dict:
    mid, rel, old, new, why = mutant
    tmp, work = _copy_project()
    try:
        path = work / rel
        text = path.read_text(encoding="utf-8")
        if text.count(old) != 1:
            return {"id": mid, "file": rel, "rule_broken": why, "status": "INVALID", "detail": f"snippet occurs {text.count(old)} times"}
        path.write_text(text.replace(old, new), encoding="utf-8", newline="\n")
        proc = _run_suite(work, env_extra)
        if proc.returncode == 0:
            return {"id": mid, "file": rel, "rule_broken": why, "status": "SURVIVED", "detail": "the suite still passes"}
        failing = failing_tests(proc.stderr + proc.stdout)
        return {"id": mid, "file": rel, "rule_broken": why, "status": "KILLED", "failing_tests": len(failing),
                "detail": (failing[0] if failing else "suite exited non-zero") + (f" (+{len(failing) - 1} more)" if len(failing) > 1 else ""),
                "killed_by": failing[:5]}
    finally:
        tmp.cleanup()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", default=None, help="write the deterministic report here")
    ap.add_argument("--only", nargs="*", default=None, help="mutant ids to run")
    ap.add_argument("-j", "--jobs", type=int, default=2)
    ap.add_argument("--examples", default="60", help="Hypothesis examples per property while mutating (default 60)")
    ap.add_argument("--failfast", action="store_true", help="stop each mutant run at its first failing test (faster, less detail)")
    args = ap.parse_args(argv)
    global FAILFAST
    FAILFAST = args.failfast
    env_extra = {"BP_HYPOTHESIS_EXAMPLES": str(args.examples)}
    mutants = [m for m in MUTANTS if not args.only or m[0] in args.only]
    tmp, work = _copy_project()
    try:
        control = _run_suite(work, env_extra)
    finally:
        tmp.cleanup()
    control_ok = control.returncode == 0
    print(f"control (unmutated copy): {'PASS' if control_ok else 'FAIL'}", flush=True)
    if not control_ok:
        print((control.stderr + control.stdout)[-3000:])
        return 2
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        for res in pool.map(lambda m: run_mutant(m, env_extra), mutants):
            results.append(res)
            print(f"  {res['id']:6s} {res['status']:9s} {res['rule_broken']}  [{res['detail']}]", flush=True)
    summary = {s: sum(1 for r in results if r["status"] == s) for s in ("KILLED", "SURVIVED", "INVALID")}
    print(f"mutants: {len(results)}  killed: {summary['KILLED']}  survived: {summary['SURVIVED']}  invalid: {summary['INVALID']}")
    if args.json:
        report = {"schema": "bp-oem-mutation-check-v1", "control": "PASS", "hypothesis_examples": int(args.examples),
                  "mutants": sorted(results, key=lambda r: r["id"]), "summary": {"total": len(results), **summary}}
        Path(args.json).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json).write_text(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8", newline="\n")
    return 0 if summary["SURVIVED"] == 0 and summary["INVALID"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
