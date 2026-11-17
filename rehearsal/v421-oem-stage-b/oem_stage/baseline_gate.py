"""Acceptance rule for a tools/verify_baseline.py report that is to be embedded in the shadow report (B-R4). Stdlib only.

A baseline report is evidence that the rows / manifest / evidence a build reads are the accepted corrected-generation files. It may therefore
only be embedded when it really says so for THIS build: the schema is the verifier's, the result is PASS, every single check is PASS (a
``PASS`` label cannot hide a failed check), the report is marked read-only, the two digest checks that identify the baseline are present, and
the SHA-256 of rows, manifest and evidence recorded in the report equal the files this run is about to read. Anything else yields a list of
problems; tools/build_outputs.py turns a non-empty list into a refusal (exit code 3) before any output is written.
"""
from __future__ import annotations

from pathlib import Path

from . import canon

SCHEMA = "bp-oem-baseline-verification-v1"            # tools/verify_baseline.py report["schema"]
REQUIRED_CHECKS = ("manifest_sha256", "fresh_source_rows_sha256")
BOUND_FILES = (("rows", "--rows"), ("manifest", "--manifest"), ("evidence", "--evidence"))


def problems(report, *, rows, manifest, evidence) -> list:
    """Why ``report`` may not be embedded for a build reading ``rows`` / ``manifest`` / ``evidence`` (empty list = acceptable)."""
    if not isinstance(report, dict):
        return ["the baseline report is not a JSON object"]
    found = []
    if report.get("schema") != SCHEMA:
        found.append(f"schema is {report.get('schema')!r}, expected {SCHEMA!r}")
    checks = report.get("checks")
    well_formed = isinstance(checks, list) and bool(checks) and all(isinstance(c, dict) for c in checks)
    failed = [str(c.get("check")) for c in checks if c.get("status") != "PASS"] if well_formed else []
    if not well_formed:
        found.append("the report has no usable list of checks")
    if report.get("result") != "PASS":
        found.append(f"BASELINE FAIL (result={report.get('result')!r})" + (f"; failed checks: {', '.join(failed)}" if failed else ""))
    elif failed:
        found.append(f"the report says PASS but these checks are not PASS: {', '.join(failed)}")
    if report.get("read_only") is not True:
        found.append("the report does not state read_only=true")
    names = {c.get("check") for c in checks} if well_formed else set()
    found += [f"the required check {name!r} is missing from the report" for name in REQUIRED_CHECKS if well_formed and name not in names]
    files = report.get("files") if isinstance(report.get("files"), dict) else {}
    paths = {"rows": rows, "manifest": manifest, "evidence": evidence}
    for key, flag in BOUND_FILES:
        if paths[key] is None:
            found.append(f"{flag} is required: a baseline report can only be embedded for a build whose {key} it covers")
            continue
        entry = files.get(key)
        recorded = entry.get("sha256") if isinstance(entry, dict) else None
        if not isinstance(recorded, str):
            found.append(f"the report records no digest for the {key} file")
            continue
        try:
            actual = canon.file_sha256(paths[key])
        except OSError:
            found.append(f"the {key} file {Path(paths[key]).name} cannot be read to compare its digest")
            continue
        if recorded != actual:
            found.append(f"the {key} digest in the report does not match {Path(paths[key]).name} used by this build "
                         f"(report {recorded[:12]}..., file {actual[:12]}...)")
    return found
