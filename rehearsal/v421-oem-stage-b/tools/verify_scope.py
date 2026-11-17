#!/usr/bin/env python3
"""Scope check for the Stage B branch: it may only add/change/delete files under the two allowed directories.

    python3 tools/verify_scope.py --base <ref the branch was cut from> [--head HEAD] [--repo <path>] [--json out.json]

Fails (exit 1) when the diff ``base...head`` touches any path outside ``docs/oem-stage-b-20261117/`` and
``rehearsal/v421-oem-stage-b/`` (so nothing in ``main``'s files, PR #167's files, the V4.2.1 engine or anything production-related is changed),
when ``head`` is not a descendant of ``base``, or when a path is unsafe (absolute, ``..``). Exit 2 on a git error. Read-only.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ALLOWED_PREFIXES = ("docs/oem-stage-b-20261117/", "rehearsal/v421-oem-stage-b/")


def git(repo, *args) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True)


def changed_files(repo, base, head) -> list:
    proc = git(repo, "diff", "--name-status", "--no-renames", "-z", f"{base}...{head}")
    if proc.returncode != 0:
        raise RuntimeError("git diff failed: " + proc.stderr.decode("utf-8", "replace").strip())
    fields = proc.stdout.decode("utf-8").split("\0")
    if fields and fields[-1] == "":
        fields.pop()
    if len(fields) % 2:
        raise RuntimeError("unexpected git diff output")
    return [(fields[i], fields[i + 1]) for i in range(0, len(fields), 2)]


def path_problem(path: str):
    if path.startswith("/") or "\\" in path or ".." in path.split("/"):
        return "unsafe path"
    if not path.startswith(ALLOWED_PREFIXES):
        return "outside the allowed directories"
    return None


def check(repo, base, head="HEAD") -> dict:
    ancestor = git(repo, "merge-base", "--is-ancestor", base, head).returncode == 0
    files = changed_files(repo, base, head)
    violations = [{"status": s, "path": p, "problem": path_problem(p)} for s, p in files if path_problem(p)]
    if not ancestor:
        violations.append({"status": "-", "path": f"{head}", "problem": f"{head} is not a descendant of {base}"})
    counts = {s: sum(1 for st, _ in files if st == s) for s in sorted({st for st, _ in files})}
    return {"schema": "bp-oem-scope-check-v1", "base": base, "head": head, "allowed_prefixes": list(ALLOWED_PREFIXES),
            "changed_files": len(files), "by_status": counts, "violations": violations,
            "result": "PASS" if not violations else "FAIL"}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", required=True)
    ap.add_argument("--head", default="HEAD")
    ap.add_argument("--repo", default=str(Path(__file__).resolve().parents[1]))
    ap.add_argument("--json", default=None)
    args = ap.parse_args(argv)
    try:
        report = check(args.repo, args.base, args.head)
    except (RuntimeError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    if args.json:
        Path(args.json).write_text(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8", newline="\n")
    for v in report["violations"]:
        print(f"VIOLATION {v['status']} {v['path']}: {v['problem']}")
    print(f"changed files: {report['changed_files']} {report['by_status']}")
    print(f"SCOPE {report['result']}")
    return 0 if report["result"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
