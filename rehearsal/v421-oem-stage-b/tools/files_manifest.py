#!/usr/bin/env python3
"""SHA-256 manifest of every Stage B file (``sha256sum -c`` format, repository-relative paths, sorted).

    python3 tools/files_manifest.py --write   # (re)generate docs/oem-stage-b-20261117/STAGE_B_FILES_SHA256.txt
    python3 tools/files_manifest.py --check   # verify: same file set, same digests; exit 1 on any difference

Covers rehearsal/v421-oem-stage-b/ and docs/oem-stage-b-20261117/ except the manifest itself, ``__pycache__``, ``*.pyc``,
``.hypothesis`` and ``blobs`` (local test caches and byte stores). The manifest cannot contain its own digest; report it separately.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
from pathlib import Path

STAGE = Path(__file__).resolve().parents[1]
REPO = STAGE.parents[1]
SCOPES = ("rehearsal/v421-oem-stage-b", "docs/oem-stage-b-20261117")
MANIFEST_REL = "docs/oem-stage-b-20261117/STAGE_B_FILES_SHA256.txt"
SKIP_DIRS = {"__pycache__", ".hypothesis", "blobs"}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def collect(repo: Path = REPO) -> dict:
    files = {}
    for scope in SCOPES:
        for dirpath, dirnames, names in os.walk(repo / scope):
            dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
            for name in sorted(names):
                path = Path(dirpath) / name
                rel = path.relative_to(repo).as_posix()
                if rel == MANIFEST_REL or name.endswith(".pyc") or path.is_symlink():
                    continue
                files[rel] = sha256(path)
    return files


def render(files: dict) -> str:
    return "".join(f"{files[k]}  {k}\n" for k in sorted(files))


def parse(text: str) -> dict:
    out = {}
    for line in text.splitlines():
        digest, _, rel = line.partition("  ")
        if len(digest) != 64 or not rel:
            raise ValueError(f"malformed manifest line: {line!r}")
        out[rel] = digest
    return out


def diff(expected: dict, actual: dict) -> list:
    problems = [f"missing from disk: {k}" for k in sorted(expected.keys() - actual.keys())]
    problems += [f"not in manifest: {k}" for k in sorted(actual.keys() - expected.keys())]
    problems += [f"digest differs: {k}" for k in sorted(expected.keys() & actual.keys()) if expected[k] != actual[k]]
    return problems


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    ap.add_argument("--repo", default=str(REPO))
    args = ap.parse_args(argv)
    repo = Path(args.repo)
    files = collect(repo)
    target = repo / MANIFEST_REL
    if args.write:
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(render(files))
        print(f"wrote {MANIFEST_REL}: {len(files)} files, manifest sha256 {sha256(target)}")
        return 0
    try:
        expected = parse(target.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    problems = diff(expected, files)
    for p in problems:
        print("PROBLEM", p)
    print(f"files: {len(files)}; manifest sha256 {sha256(target)}")
    print(f"MANIFEST {'PASS' if not problems else 'FAIL'}")
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
