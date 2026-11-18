#!/usr/bin/env python3
"""Mutation self-check of Stage C: deliberately break one fail-closed rule at a time and prove the test suite notices.

    BP_V421_ENGINE_ROOT=<engine_root> python3 tools/mutation_check.py [--failfast] [--json out/MUTATION_CHECK.json] [--only ID ...] [-j 2] [--validate-only]

Each mutant is applied to a throw-away COPY of this stage laid out like the repository (``rehearsal/v421-oem-stage-c`` mutated, the accepted Stage B
package linked read-only next to it); the repository is never modified. The whole suite is run (``unittest discover``) minus the two test modules
that test the harness and the documents themselves (``test_mutation_harness``: it would re-validate the mutated snippets; ``test_governance_docs``: it
binds document digests to file bytes, so it fails for ANY edit and says nothing about behaviour).

A mutant is KILLED when at least one BEHAVIOURAL test fails, SURVIVED when the suite still passes (a test gap), and INVALID when its snippet no longer
matches exactly once or the run was broken (usage error, import failure, timeout) - a broken run is never counted as a kill. The unmutated copy (the
control) is run first and must pass. Seam mutants rewrite the pinned SHA-256 in the copy so that the launcher accepts the mutated engine copy; the two
seam-consistency tests (they fail for any change of that file) never count as a kill, and seam mutants always run the whole suite.

Exit code 0 only when the control passes and every mutant is killed; 2 when the control fails or the engine is missing. The report is deterministic
(derandomized property tests, no timings, no paths).
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
STAGE_B = ROOT.parent / "v421-oem-stage-b"
SEAM = "engine_seam/accessory_v4_stage_c.py"
DOC_DIRS = ("docs/oem-review-20261117", "docs/oem-stage-b-20261117")
EXCLUDED_MODULES = ("tests/test_mutation_harness.py", "tests/test_governance_docs.py")     # not behavioural: see the module docstring
NON_BEHAVIOURAL_PREFIXES = ("test_seam.TestSeamFilesAreConsistent.",)                       # fail for ANY change of the seam file

G, E, S, R = "oem_intake/gate.py", "oem_intake/envelope.py", "oem_intake/stage1.py", "oem_intake/replay_diff.py"

# (id, file, old snippet (must occur exactly once), new snippet, rule being broken)
MUTANTS = [
    # ---------------------------------------------------------------------------------------------------------------- the gate (relation level)
    ("G-01", G, '    if merged["publish_states"] != ["LISTED"]:', '    if False:', "conditional publication can be switched on by policy (OD4)"),
    ("G-02", G, '    if merged["veto_mode"] != "report":', '    if False:', "veto enforcement can be switched on by policy (OD3)"),
    ("G-03", G, '    if merged["one_ended_adapter"] != "abstain" and not merged["allow_synthetic"]:', '    if False:',
     "a non-default OD5 value is accepted for real evidence"),
    ("G-04", G, '    if state != "LISTED":\n        hold.add(', '    if False:\n        hold.add(', "a relation whose effective state is not LISTED is not held"),
    ("G-05", G, '    if rel["conditions"] or rel["conditions_review_state"] != "verified_none":', '    if False:',
     "conditions that are not verified-none no longer hold a relation"),
    ("G-06", G, '    if rtype == "vehicle_general":\n        hold.add("class_c_never_ab")', '    if False:\n        hold.add("class_c_never_ab")',
     "a class C vehicle-general relation can reach the A tier"),
    ("G-07", G, 'c["effective_status"] == CLAIM_EFFECTIVE_OK for c in claims):', 'True for c in claims):',
     "the O1 effective status of a claim is not required (regression of finding B1)"),
    ("G-08", G, 'c["declared_status"] == CLAIM_DECLARED_OK', 'True', "a claim that was never declared VERIFIED is accepted"),
    ("G-09", G, '    if any(c["assertion_type"] in ("not_recommended", "not_tested_at_time") for c in claims):', '    if False:',
     "a negative or time-bound claim next to a positive one no longer holds the relation"),
    ("G-10", G, '        for name in REQUIRED_ENDS[rtype]:\n            hold.update(_end_problems(name, ends.get(name)))',
     '        for name in REQUIRED_ENDS[rtype]:\n            pass', "the identity / article binding of the relation's ends is not checked"),
    ("G-11", G, '            if ends.get("extension") is not None:', '            if False:',
     "an adapter that requires an extension is published as the bare adapter (regression of finding B2)"),
    ("G-12", G, '    if evidence["expired"] is True:', '    if False:', "expired evidence is silently granted (OD2)"),
    ("G-13", G, '    if any(d["bytes_state"] != "present" for d in evidence["docs"]):', '    if False:', "a relation without captured OEM bytes is accepted"),
    ("G-14", G, '    if any(not doc_hashes.get(d["doc_id"]) for d in evidence["docs"]):', '    if False:', "an evidence document without a known hash is accepted"),
    ("G-15", G, '    if rel["veto"]["candidate"] or rel["veto"]["pending_verification"]:\n        hold.add("veto_signal_present")',
     '    if False:\n        hold.add("veto_signal_present")', "a veto signal no longer holds the relation"),
    ("G-16", G, '    if rel["synthetic"] and not policy["allow_synthetic"]:\n        hold.add("synthetic_relation")',
     '    if False:\n        hold.add("synthetic_relation")', "synthetic relations are accepted by the default policy"),
    ("G-17", G, '    if policy["one_ended_adapter"] != "abstain" and "od5_one_ended_adapter_abstain" in blockers and not rel["synthetic"]:', '    if False:',
     "the one-ended-adapter override works on real (non-synthetic) relations"),
    # ---------------------------------------------------------------------------------------------------------------- the gate (pair level, as_of)
    ("G-18", G, '    if _as_int(pair["target_field_status"]) != 1:', '    if False:', "a target with field_status != 1 gets an edge"),
    ("G-19", G, '    if _as_int(pair["target_published"]) != 1:', '    if False:', "an unpublished target gets an edge"),
    ("G-20", G, '    if not isinstance(price, (int, float)) or isinstance(price, bool) or price <= 0:', '    if False:', "a target with price <= 0 gets an edge"),
    ("G-21", G, '    if counts["target"].get((pair["target_sku"], pair["lang"]), 0) != 1:', '    if False:', "an ambiguous SKU in the locale gets an edge"),
    ("G-22", G, '    if not pair["end_identity_verified"]:', '    if False:', "an unverified model identity gets an edge"),
    ("G-23", G, '    if derived_as_of and derived_as_of != [pol["as_of"]]:', '    if False:', "an envelope can be stamped with a different as_of than its evidence"),
    ("G-24", G, '        if len(types) > 1 or len(ends_seen) > 1 or len(models) > 1:', '        if False:', "conflicting support for one pair is merged silently"),
    ("G-25", G, '    if not isinstance(as_of, str) or not _DATE.fullmatch(as_of):', '    if False:', "the gate accepts a non-date as_of"),
    # ---------------------------------------------------------------------------------------------------------------- the envelope contract
    ("E-01", E, '    if edge["fit_state"] != "LISTED":', '    if False:', "a non-LISTED edge is accepted by the envelope"),
    ("E-02", E, '    if edge["conditions"] != []:', '    if False:', "a conditional edge is accepted by the envelope"),
    ("E-03", E, '    if doc["synthetic"] and not allow_synthetic:', '    if False:', "a synthetic envelope is accepted without the opt-in"),
    ("E-04", E, '    if gate["veto_mode"] != "report":', '    if False:', "an envelope can declare an enforced veto"),
    ("E-05", E, '    if gate["publish_states"] != ["LISTED"]:', '    if False:', "an envelope can declare conditional publication"),
    ("E-06", E, '            if int(key) == edge["target_nid"]:', '            if False:', "an edge from a product to itself is accepted"),
    ("E-07", E, '    if edge["synthetic"] and not envelope_synthetic:', '    if False:', "a synthetic edge in a real envelope is accepted"),
    ("E-08", E, '    if not all(_hex64(h) for h in hashes):', '    if False:', "document hashes need not be SHA-256 hex"),
    # ---------------------------------------------------------------------------------------------------------------- Stage1 preparation
    ("S1-01", S, '    if rec.get("all_gates_pass") is not True:', '    if False:', "a receipt with all_gates_pass != true is accepted"),
    ("S1-02", S, '    if not isinstance(probe, dict) or probe.get("stage1_pass") is not True:', '    if False:', "a receipt whose native probe did not pass is accepted"),
    ("S1-03", S, '    if not (isinstance(states, list) and any(isinstance(s, dict) and s.get("cta") == "buy" for s in states)):', '    if False:',
     "a receipt without a native buy CTA is accepted"),
    ("S1-04", S, '        elif _int(rec[name]) != expected[name]:', '        elif False:', "a stale VID / changed / TNID in a receipt is accepted"),
    ("S1-05", S, '        if _text(rec.get(name)) != expected[name]:', '        if False:', "a receipt for other option rows or another option digest is accepted"),
    ("S1-06", S, '    elif _text(rec["sku"]) != expected["sku"]:', '    elif False:', "a receipt for another SKU is accepted"),
    ("S1-07", S, '    if rec.get("synthetic") is True and not plan_synthetic:', '    if False:', "a synthetic receipt is accepted for a real plan"),
    ("S1-08", S, '        elif nid in duplicates:', '        elif False:', "duplicate receipts for one node no longer block"),
    ("S1-09", S, '    if snap["field_status"] != 1:', '    if False:', "a field_status != 1 node is planned for a native test (and may be 'recommended')"),
    ("S1-10", S, '"stage1_cleared": tgt_state == PASS_STAGE1 and src_state == PASS_STAGE1})', '"stage1_cleared": tgt_state == PASS_STAGE1})',
     "the source context is no longer required to have its own receipt"),
    ("S1-11", S, '    if plan.get("plan_digest") != canon.digest(', '    if False and plan.get("plan_digest") != canon.digest(', "an edited plan is accepted"),
    ("S1-12", S, '    if diff.get("result") != "PASS":', '    if False:', "a failing ON/OFF diff is used to plan native checks"),
    ("S1-13", S, '        if rows[tgt].get("lang") != lang or rows[src].get("lang") != lang:', '        if False:', "a link across locales is planned"),
    ("S1-14", S, '    if diff.get("synthetic") is not False and not allow_synthetic:', '    if False:', "a synthetic or undeclared diff is planned without the opt-in"),
    ("S1-15", S, 'NEW_LINK_KINDS = ("new_oem_edge", "new_b_backfill_after_role_coverage")', 'NEW_LINK_KINDS = ("new_oem_edge",)',
     "backfilled B links get no native check"),
    # ---------------------------------------------------------------------------------------------------------------- the ON/OFF classifier
    ("R-01", R, '        if s_off[sid]["similar"] != s_on[sid]["similar"]:', '        if False:', "a changed V3.6 similar list is not reported"),
    ("R-02", R, '            if ev.get("tier") != "B_universal":\n                violate("legacy_a_removed"', '            if False:\n                violate("legacy_a_removed"',
     "a removed legacy A edge is not reported"),
    ("R-03", R, '        if len(b) != len(set(b)) or len(b) > LIMIT:', '        if False:', "a list over the limit of 20 or with duplicates is not reported"),
    ("R-04", R, '        if len(added_b) > len(role_removed) + len(promoted):', '        if False:', "a backfill without a freed slot is not reported"),
    ("R-05", R, '            else:\n                violate("unexplained_addition"', '            elif False:\n                violate("unexplained_addition"',
     "an unexplained added edge is not reported"),
    ("R-06", R, '        if b[:len(legacy_off)] != legacy_off and not [t for t in legacy_off if t not in b]:', '        if False:', "a reordered legacy A prefix is not reported"),
    ("R-07", R, '    if set(s_off) != set(s_on):', '    if False:', "a changed source set is not reported"),
    ("R-08", R, '        if len(pairs) != len(ledger):', '        if False:', "a duplicate ledger entry is not reported"),
]

SEAM_MUTANTS = [
    # snippets of the engine seam (the patched copy of accessory_v4.py); only the helper block and its insertions are mutated
    ("M-01", '        if tid in legacy:\n            entry["status"]="already_present_legacy"', '        if False:\n            entry["status"]="already_present_legacy"',
     "an OEM edge the legacy engine already has is added again"),
    ("M-02", '        if not why and tid in similar:why="in_v36_similar"', '        if False:why="in_v36_similar"', "V3.6 similar no longer wins over an OEM edge"),
    ("M-03", '    if new_ids:a_ids=a_ids+commercial_accessory_order(new_ids,source,rows,a_reasons,head)', '    if new_ids:a_ids=commercial_accessory_order(new_ids,source,rows,a_reasons,head)+a_ids',
     "OEM edges are inserted BEFORE the legacy A edges"),
    ("M-04", '        entry["status"]="published" if entry["target_nid"] in total else "dropped_by_limit_20"', '        entry["status"]="published"',
     "an edge dropped by the limit of 20 is reported as published"),
    ("M-05", '    if any(x["status"] in (None,"accepted") for x in ledger) or len(ledger)!=meta["edges_in"] or', '    if False or len(ledger)!=meta["edges_in"] or',
     "an undisposed ledger entry is not detected"),
    ("M-06", '                ledger.append({"source_nid":src,"target_nid":edge["target_nid"],"relation_ids":list(edge["relation_ids"]),\n                               "status":"held","reason":"source_not_in_scope"})',
     '                pass', "an envelope edge whose source is outside the scope vanishes from the ledger"),
    ("M-07", '"reason":"accepted_oem_relation"', '"reason":"accepted_model_title"', "an OEM edge claims a legacy reason"),
    ("M-08", '"fit_state":"LISTED","conditions":[]', '"fit_state":"LISTED","conditions":["x"]', "OEM evidence carries invented conditions"),
]


def _seam_mutants():
    """Seam mutants are applied to the patched file; their snippets are looked up by their own ids (see run_mutant)."""
    return [(mid, SEAM, old, new, why) for mid, old, new, why in SEAM_MUTANTS]


ALL = MUTANTS + _seam_mutants()


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _engine_root() -> Path:
    """The engine root the tests will use: ``BP_V421_ENGINE_ROOT`` or the rehearsal default of the accepted Stage B package."""
    sys.path.insert(0, str(ROOT))
    from oem_intake import _stage_b
    _stage_b.ensure_on_path()
    from oem_stage import engine_env
    return Path(engine_env.engine_root())


def snippet_problems(mutants) -> list:
    """Mutants whose snippet does not occur exactly once in the current file (stale mutants), and duplicated ids."""
    problems, seen = [], set()
    for mid, rel, old, _new, _why in mutants:
        if mid in seen:
            problems.append(f"{mid}: duplicated mutant id")
        seen.add(mid)
        count = (ROOT / rel).read_text(encoding="utf-8").count(old)
        if count != 1:
            problems.append(f"{mid}: {rel}: snippet occurs {count} times")
    return problems


def _copy_project() -> tuple:
    """A repository-shaped throw-away copy: this stage (to be mutated) and the accepted Stage B linked read-only."""
    tmp = tempfile.TemporaryDirectory()
    base = Path(tmp.name)
    work = base / "rehearsal" / "v421-oem-stage-c"
    shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns("__pycache__", "out", ".git", "*.pyc", ".hypothesis", "blobs"))
    for rel in EXCLUDED_MODULES:
        (work / rel).unlink(missing_ok=True)
    (base / "rehearsal" / "v421-oem-stage-b").symlink_to(STAGE_B, target_is_directory=True)
    for rel in DOC_DIRS:
        if (REPO / rel).is_dir():
            shutil.copytree(REPO / rel, base / rel, ignore=shutil.ignore_patterns("__pycache__"))
    return tmp, work


def suite_command(failfast: bool = False) -> list:
    cmd = [sys.executable, "-B", "-m", "unittest", "discover", "-s", "tests", "-t", "."]
    if failfast:
        cmd.append("--failfast")        # AFTER the sub-command: before it unittest does not parse -s / -t and exits with a usage error
    return cmd


def _run_suite(work: Path, env_extra: dict, failfast: bool = False, timeout: int = 3600) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env.update(env_extra)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return subprocess.run(suite_command(failfast), cwd=work, env=env, capture_output=True, text=True, timeout=timeout)


_FAIL_LINE = re.compile(r"^(?:FAIL|ERROR): \S+ \(([^)]+)\)", re.M)
_RAN_LINE = re.compile(r"^Ran (\d+) tests? in ", re.M)
_RESULT_LINE = re.compile(r"^(OK|FAILED)(?: \(([^)]*)\))?\s*$", re.M)


def failing_tests(output: str) -> list:
    """Sorted ids of the failing/erroring tests (``module.Class.test``), from unittest's FAIL:/ERROR: lines."""
    return sorted({m.group(1).replace("tests.", "", 1) for m in _FAIL_LINE.finditer(output)})


def parse_outcome(returncode: int, output: str) -> dict:
    """Judge one unittest run. ``verdict`` is PASSED, FAILED (real test failures) or BROKEN (anything else: usage error, import failure, no tests).

    Only FAILED may kill a mutant: a non-zero exit code alone proves nothing (a mistyped command line also exits non-zero)."""
    ran, result = _RAN_LINE.search(output), _RESULT_LINE.findall(output)
    tests = int(ran.group(1)) if ran else 0
    detail = result[-1][1] if result else ""
    skipped = int(m.group(1)) if (m := re.search(r"skipped=(\d+)", detail)) else 0
    failing = failing_tests(output)
    if returncode == 0:
        if ran and tests > 0 and result and result[-1][0] == "OK":
            return {"verdict": "PASSED", "tests": tests, "skipped": skipped, "failing": []}
        return {"verdict": "BROKEN", "why": "exit code 0 without a unittest 'OK' summary", "tests": tests, "skipped": skipped, "failing": []}
    if not ran or tests == 0:
        return {"verdict": "BROKEN", "why": "no tests ran (usage error or import failure): " + (output.strip().splitlines() or ["no output"])[-1][:160],
                "tests": tests, "skipped": skipped, "failing": failing}
    if not result or result[-1][0] != "FAILED" or not failing:
        return {"verdict": "BROKEN", "why": "non-zero exit without a parseable FAIL/ERROR test", "tests": tests, "skipped": skipped, "failing": failing}
    if any("unittest.loader._FailedTest" in m.group(0) for m in re.finditer(r"^(?:FAIL|ERROR): .*$", output, re.M)):
        return {"verdict": "BROKEN", "why": "a test module failed to import", "tests": tests, "skipped": skipped, "failing": failing}
    return {"verdict": "FAILED", "tests": tests, "skipped": skipped, "failing": failing}


def behavioural(failing: list) -> list:
    return [t for t in failing if not t.startswith(NON_BEHAVIOURAL_PREFIXES)]


def run_mutant(mutant, env_extra, failfast: bool = False) -> dict:
    mid, rel, old, new, why = mutant
    base = {"id": mid, "file": rel, "rule_broken": why}
    tmp, work = _copy_project()
    try:
        path = work / rel
        text = path.read_text(encoding="utf-8")
        if text.count(old) != 1:
            return {**base, "status": "INVALID", "detail": f"snippet occurs {text.count(old)} times"}
        path.write_text(text.replace(old, new), encoding="utf-8", newline="\n")
        if rel == SEAM:                                                   # let the launcher accept the mutated copy: only behaviour may kill it
            pins_path = work / "engine_seam" / "ENGINE_SEAM_PINS.json"
            pins = json.loads(pins_path.read_text(encoding="utf-8"))
            pins["patched_sha256"] = _sha(path)
            pins_path.write_text(json.dumps(pins, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
        use_failfast = failfast and rel != SEAM
        try:
            outcome = parse_outcome(*_judge_inputs(_run_suite(work, env_extra, failfast=use_failfast)))
            if outcome["verdict"] == "FAILED" and use_failfast and not behavioural(outcome["failing"]):
                outcome = parse_outcome(*_judge_inputs(_run_suite(work, env_extra, failfast=False)))     # the first failure proves nothing: look at all
        except subprocess.TimeoutExpired:
            return {**base, "status": "INVALID", "detail": "the suite timed out"}
        if outcome["verdict"] == "BROKEN":
            return {**base, "status": "INVALID", "detail": "broken run, not a kill: " + outcome["why"]}
        if outcome["verdict"] == "PASSED":
            return {**base, "status": "SURVIVED", "detail": "the suite still passes"}
        real = behavioural(outcome["failing"])
        if not real:
            return {**base, "status": "SURVIVED", "detail": "only the seam-consistency tests failed: no behavioural test noticed",
                    "killed_by": outcome["failing"][:5]}
        return {**base, "status": "KILLED", "detail": real[0] + (f" (+{len(real) - 1} more)" if len(real) > 1 else ""), "killed_by": real[:5]}
    finally:
        tmp.cleanup()


def _judge_inputs(proc: subprocess.CompletedProcess) -> tuple:
    return proc.returncode, proc.stderr + proc.stdout


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", default=None, help="write the deterministic report here")
    ap.add_argument("--only", nargs="*", default=None, help="mutant ids to run")
    ap.add_argument("-j", "--jobs", type=int, default=2)
    ap.add_argument("--examples", default="60", help="Hypothesis examples per property while mutating (default 60)")
    ap.add_argument("--failfast", action="store_true",
                    help="stop each non-seam mutant's run at its first failing test (much faster; seam mutants always run the whole suite)")
    ap.add_argument("--validate-only", action="store_true", help="only check that every snippet occurs exactly once; run nothing")
    args = ap.parse_args(argv)
    if not (STAGE_B / "oem_stage" / "__init__.py").is_file():
        print(f"REFUSED: the accepted Stage B package was not found at {STAGE_B}", file=sys.stderr)
        return 2
    mutants = [m for m in ALL if not args.only or m[0] in args.only]
    if args.only and len(mutants) != len(set(args.only)):
        print(f"REFUSED: unknown mutant id in --only: {sorted(set(args.only) - {m[0] for m in ALL})}", file=sys.stderr)
        return 2
    if args.validate_only:
        bad = snippet_problems(mutants)
        print("\n".join(bad) if bad else f"all {len(mutants)} snippets occur exactly once")
        return 1 if bad else 0
    try:
        _engine_root()
    except FileNotFoundError as exc:
        print(f"REFUSED: {exc}: without the real engine the seam and integration tests are skipped and no mutant of the seam could be killed",
              file=sys.stderr)
        return 2
    env_extra = {"BP_HYPOTHESIS_EXAMPLES": str(args.examples)}
    tmp, work = _copy_project()
    try:
        control = parse_outcome(*_judge_inputs(_run_suite(work, env_extra)))
    finally:
        tmp.cleanup()
    print(f"control (unmutated copy): {control['verdict']} ({control['tests']} tests, {control['skipped']} skipped)", flush=True)
    if control["verdict"] != "PASSED":
        print(control.get("why", ""), control["failing"][:10])
        return 2
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        for res in pool.map(lambda m: run_mutant(m, env_extra, args.failfast), mutants):
            results.append(res)
            print(f"  {res['id']:6s} {res['status']:9s} {res['rule_broken']}  [{res['detail']}]", flush=True)
    summary = {s: sum(1 for r in results if r["status"] == s) for s in ("KILLED", "SURVIVED", "INVALID")}
    print(f"mutants: {len(results)}  killed: {summary['KILLED']}  survived: {summary['SURVIVED']}  invalid: {summary['INVALID']}")
    if args.json:
        report = {"schema": "bp-oem-stage-c-mutation-check-v1", "control": {"result": "PASS", "tests": control["tests"], "skipped": control["skipped"],
                                                                              "excluded_modules": list(EXCLUDED_MODULES)},
                  "hypothesis_examples": int(args.examples), "mutants": sorted(results, key=lambda r: r["id"]),
                  "summary": {"total": len(results), **summary}}
        Path(args.json).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json).write_text(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8", newline="\n")
    return 0 if summary["SURVIVED"] == 0 and summary["INVALID"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
