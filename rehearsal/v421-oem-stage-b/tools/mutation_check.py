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
    ("EV-01", "tools/evidence_cli.py", '    return 0 if report["result"] == "PASS" else 1', '    return 0',
     "evidence verify never fails the run"),
    ("EV-02", "tools/evidence_cli.py", 'for r in matrix if r["declared_status"] == "VERIFIED" and not r["accepted"]]',
     'for r in matrix if False]', "a VERIFIED claim that fails a gate is no longer reported"),
    ("EV-03", "tools/evidence_cli.py", 'INTEGRITY_STATES = ("HASH_MISMATCH", "MISSING_BYTES", "UNREGISTERED")', 'INTEGRITY_STATES = ()',
     "tampered or missing document bytes are no longer a problem"),
    ("EV-04", "tools/evidence_cli.py", '    if any(c["claim_id"] == claim["claim_id"] for c in claims):', '    if False:',
     "a duplicate claim is recorded twice"),
    ("EV-05", "tools/evidence_cli.py", '    return {"allow_synthetic": bool(getattr(a, "allow_synthetic", False))}',
     '    return {"allow_synthetic": True}', "synthetic evidence is allowed by default"),
    ("VB-01", "tools/verify_baseline.py", '            _check("manifest_sha256", pins["accepted_manifest_sha256"], digests["manifest"]),',
     '            _check("manifest_sha256", digests["manifest"], digests["manifest"]),', "the accepted manifest digest is not enforced"),
    ("VB-02", "tools/verify_baseline.py", '            _check("catalog_nids_unique", 0, duplicates),', '            _check("catalog_nids_unique", 0, 0),',
     "duplicate catalog NIDs are not detected"),
    ("RP-01", "tools/replay_corrected_generation.py", '[python, "-I", "-B", str(patched)]', '[python, "-I", str(patched)]',
     "the replay may write bytecode into the original campaign"),
    ("RP-02", "tools/replay_corrected_generation.py", '    if len(matches) != 1:', '    if False:',
     "the one-line patch guard is not enforced"),
    ("RP-03", "tools/replay_corrected_generation.py", '    if new == original or original in new.parents or new in original.parents:', '    if False:',
     "the replay may write inside the original campaign"),
    ("EN-01", "oem_stage/engine_env.py", '    sys.dont_write_bytecode = True\n', '    pass\n',
     "importing the engine may write bytecode into the accepted campaign's engine tree"),
    ("BO-01", "tools/build_outputs.py", '        if out == base or base in out.parents or out in base.parents:', '        if False:',
     "outputs may be written into the baseline/owner data locations"),
    ("BO-02", "tools/build_outputs.py", '        if out == base or base in out.parents or out in base.parents:',
     '        if out == base or base in out.parents:', "outputs may be written above an input directory"),
    ("SC-01", "tools/verify_scope.py", '    if not path.startswith(ALLOWED_PREFIXES):', '    if False:',
     "changes outside the two allowed directories are not reported"),
    ("SC-02", "tools/verify_scope.py", '    if not ancestor:', '    if False:', "a head that does not descend from the base passes"),
    ("SC-03", "tools/verify_scope.py", '"result": "PASS" if not violations else "FAIL"}', '"result": "PASS"}',
     "the scope check never fails"),
    ("FM-01", "tools/files_manifest.py", '    problems += [f"digest differs: {k}" for k in sorted(expected.keys() & actual.keys()) if expected[k] != actual[k]]',
     '    problems += []', "an edited file is not detected by the files manifest"),
    ("FM-02", "tools/files_manifest.py", '    problems += [f"not in manifest: {k}" for k in sorted(actual.keys() - expected.keys())]',
     '    problems += []', "an added file is not detected by the files manifest"),
    ("RP-04", "tools/replay_corrected_generation.py", '    elif row["original_sha256"] == row["replay_sha256"]:',
     '    elif row["original_sha256"] is not None:', "a replay with different bytes is reported identical"),
    # ---- correction round (B-R1..B-R4)
    ("VB-03", "tools/verify_baseline.py", '                ok=covered is not None and covered == with_edges,',
     '                ok=covered is not None,', "the evidence keys are no longer compared with the sources that have accessories"),
    ("VB-04", "tools/verify_baseline.py",
     '            if item.get("metric") != "T2_edges":      # A_edges / B_edges are the tier split of the same edges: never added',
     '            if not str(item.get("metric", "")).endswith("_edges"):', "every *_edges metric is summed (each edge counted twice)"),
    ("VB-05", "tools/verify_baseline.py",
     '        observed_links.update({h: v for h, v in sorted(t2_by_head.items()) if h not in want and v})   # an unexpected head with edges',
     '        pass', "edges under an unexpected source head are ignored"),
    ("VB-06", "tools/verify_baseline.py", '        if malformed:\n            observed_links["malformed_scope_count_items"] = malformed',
     '        if False:\n            observed_links["malformed_scope_count_items"] = malformed', "malformed T2_edges items are silently skipped"),
    ("VB-07", "tools/verify_baseline.py",
     'ok=edges is not None and edges == t2_total and not malformed,', 'ok=True,',
     "the T2_edges total is no longer compared with the manifest edge total"),
    ("RP-05", "tools/replay_corrected_generation.py", '    "output/t2_v421_metrics.json": (("elapsed_seconds",),),',
     '    "output/t2_v421_metrics.json": (("elapsed_seconds",), ("manifest_sources",)),',
     "a non-timing metric is ignored by the replay comparison (whitelist widened)"),
    ("RP-06", "tools/replay_corrected_generation.py", '    if canon["original"] == canon["replay"]:',
     '    if views["original"] == views["replay"]:', "the replay comparison ignores JSON types (1 == 1.0 == True)"),
    ("RP-07", "tools/replay_corrected_generation.py", '            problems.append(f"{dotted} is missing")\n            continue',
     '            continue', "a measurement missing on one side is tolerated"),
    ("RP-08", "tools/replay_corrected_generation.py", '        if isinstance(value, bool) or not isinstance(value, (int, float)):',
     '        if not isinstance(value, (int, float)):', "a boolean is accepted as a timing measurement"),
    ("RP-09", "tools/replay_corrected_generation.py",
     '    elif rel not in VOLATILE_FIELDS:\n        row.update(status="DIFFERENT", reason="bytes differ and this file has no volatile fields: byte equality is required")\n'
     '    else:\n        row.update(_semantic_comparison(original_file, replay_file, VOLATILE_FIELDS[rel]))',
     '    else:\n        row.update(_semantic_comparison(original_file, replay_file, VOLATILE_FIELDS.get(rel, ())))',
     "files without volatile fields get a semantic second chance instead of strict bytes"),
    ("RP-10", "tools/replay_corrected_generation.py", 'ACCEPTED_STATUSES = ("IDENTICAL", "SEMANTICALLY_IDENTICAL")',
     'ACCEPTED_STATUSES = ("IDENTICAL", "SEMANTICALLY_IDENTICAL", "DIFFERENT")', "a DIFFERENT artifact no longer fails the replay"),
    ("EP-01", "oem_stage/engine_env.py", '            row["status"] = "PASS" if row["bytes"] == "MATCH" and location != "UNAPPROVED" else "FAIL"',
     '            row["status"] = "PASS" if row["bytes"] == "MATCH" else "FAIL"', "the import location of an engine module is not enforced"),
    ("EP-02", "oem_stage/engine_env.py", '            row["status"] = "PASS" if row["bytes"] == "MATCH" and location != "UNAPPROVED" else "FAIL"',
     '            row["status"] = "PASS" if location != "UNAPPROVED" else "FAIL"', "the pinned bytes of an engine module are not enforced"),
    ("EP-03", "oem_stage/engine_env.py", '            location = next((str(d) for d in approved if path.parent == d), "UNAPPROVED")',
     '            location = next((str(d) for d in approved if str(path).startswith(str(d))), "UNAPPROVED")',
     "a sub-directory or a sibling-prefix path of an approved directory is approved"),
    ("EP-04", "oem_stage/engine_env.py", '            path = _resolved(filename)\n            try:',
     '            path = Path(filename)\n            try:', "symlinks are not resolved before the import location is judged"),
    ("EP-05", "oem_stage/engine_env.py", '        if row["status"] == "PASS" or (row["status"] == "NOT_LOADED" and allow_not_loaded):',
     '        if row["status"] in ("PASS", "NOT_LOADED"):', "a module that was never imported is accepted as proven"),
    ("EP-06", "oem_stage/engine_env.py",
     '    "/opt/bp-accessories-v421-integration-rehearsal-20261112/upstream/v32/engine",   # model_mentions.py: sys.path.insert(0, ...)\n',
     '', "the legacy integration-rehearsal import directory is not approved (B-R3 regression)"),
    ("EP-07", "oem_stage/engine_env.py", '        elif canon.file_sha256(path) != digest:', '        elif False:',
     "a changed pinned file in the engine root is not reported"),
    ("EP-08", "oem_stage/engine_env.py", '"9c4cd8788aadc7d8a1422bd941c2a1032b36319f13daeaf58bb60b8ce32eafdc"',
     '"0000000000000000000000000000000000000000000000000000000000000000"', "the accepted v32_pipeline digest is wrong"),
    ("BG-01", "oem_stage/baseline_gate.py", '    if report.get("result") != "PASS":', '    if False:',
     "a baseline report with result FAIL is accepted"),
    ("BG-02", "oem_stage/baseline_gate.py", '    elif failed:', '    elif False:', "a PASS label hides a failed check"),
    ("BG-03", "oem_stage/baseline_gate.py", '        if recorded != actual:', '        if False:',
     "a report for other inputs (digest mismatch) is accepted"),
    ("BG-04", "oem_stage/baseline_gate.py",
     '    found += [f"the required check {name!r} is missing from the report" for name in REQUIRED_CHECKS if well_formed and name not in names]',
     '    found += []', "the baseline-identifying checks are not required"),
    ("BG-05", "oem_stage/baseline_gate.py", '    if report.get("read_only") is not True:', '    if False:', "a report that is not read-only is accepted"),
    ("BG-06", "oem_stage/baseline_gate.py", '    if report.get("schema") != SCHEMA:', '    if False:', "a report with a foreign schema is accepted"),
    ("BG-07", "oem_stage/baseline_gate.py",
     '            found.append(f"{flag} is required: a baseline report can only be embedded for a build whose {key} it covers")',
     '            pass', "a report is accepted without rows/manifest/evidence to bind it to"),
    ("BO-03", "tools/build_outputs.py", '        if out == path or out == path.parent:',
     '        if out == path or out == path.parent or path.parent in out.parents or out in path.parent.parents:',
     "auxiliary files protect their whole parent tree again (B-R4 regression: /tmp)"),
    ("BO-04", "tools/build_outputs.py", '        if out == path or out == path.parent:', '        if out == path:',
     "outputs may be mixed into the directory of an auxiliary input file"),
    ("BO-05", "tools/build_outputs.py", '                if _same_file(target, path):', '                if False:',
     "an output name that is a symlink/hard link onto an input file is accepted"),
    ("BO-06", "tools/build_outputs.py",
     '    baseline = load_acceptable_baseline(args)          # exit 3 on a missing / failed / foreign report, before anything else happens',
     '    baseline = canon.load_json(args.baseline_report) if args.baseline_report else None',
     "the baseline report is embedded without being checked"),
    ("BO-07", "tools/build_outputs.py", '        if root_problems:', '        if False:', "a changed engine root is not refused"),
    ("BO-08", "tools/build_outputs.py",
     '    if found:\n        refuse(EXIT_ENGINE, "an imported engine module is not the accepted V4.2.1 / V3.2 code - "',
     '    if False:\n        refuse(EXIT_ENGINE, "an imported engine module is not the accepted V4.2.1 / V3.2 code - "',
     "imported engine modules are not checked against the accepted bytes"),
    ("BO-09", "tools/build_outputs.py",
     '    if found:\n        refuse(EXIT_BASELINE_REPORT, f"the baseline report {path.name} is not acceptable - "',
     '    if False:\n        refuse(EXIT_BASELINE_REPORT, f"the baseline report {path.name} is not acceptable - "',
     "a failing baseline report is embedded and the build exits green"),
    ("BO-10", "tools/build_outputs.py", '        provenance += require_accepted_engine_modules(engine, ("v32_pipeline",))\n', '',
     "the imported V3.2 module (v32_pipeline) is not checked"),
    ("BO-11", "tools/build_outputs.py", '        provenance += require_accepted_engine_modules(engine, ("canonical_models",))\n', '',
     "the imported identity-key module (canonical_models) is not checked"),
    ("BO-12", "tools/build_outputs.py", 'planned_names=outputs.planned_file_names(args.label))', 'planned_names=())',
     "output names are not checked against input files"),
    ("BO-13", "tools/build_outputs.py", 'aux_files=[args.baseline_report, args.allow_list], ', 'aux_files=[], ',
     "auxiliary input files are not protected at all"),
    ("OU-01", "oem_stage/outputs.py",
     '    return sorted([f"{name}{suffix}.json" for name in DOC_NAMES] + [f"HASHES{suffix}.json", f"SHA256SUMS{suffix}.txt"])',
     '    return sorted([f"{name}{suffix}.json" for name in DOC_NAMES] + [f"HASHES{suffix}.json"])',
     "the planned output names miss a file the build really writes"),
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
