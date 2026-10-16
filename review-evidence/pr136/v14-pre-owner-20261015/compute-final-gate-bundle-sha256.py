#!/usr/bin/env python3
"""Deterministic aggregate SHA-256 for PR136 V14 final-gate evidence bundle.

Carriers excluded from preimage (derived / post-hoc binding):
  FINAL-GATE-BUNDLE_SHA256.txt
  final-gate-bundle.manifest
  PRE-OWNER-CLOSURE-CERTIFICATE.sha256
  OWNER-APPROVAL-BINDING.json
"""
from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXCLUDE = frozenset(
    {
        "FINAL-GATE-BUNDLE_SHA256.txt",
        "final-gate-bundle.manifest",
        "PRE-OWNER-CLOSURE-CERTIFICATE.sha256",
        "OWNER-APPROVAL-BINDING.json",
    }
)


def list_paths() -> list[str]:
    paths: list[str] = []
    for p in ROOT.rglob("*"):
        if p.is_file():
            rel = p.relative_to(ROOT).as_posix()
            if rel in EXCLUDE:
                continue
            paths.append(rel)
    paths.sort(key=lambda s: s.encode("utf-8"))
    return paths


def bundle_digest(paths: list[str]) -> str:
    h = hashlib.sha256()
    for rel in paths:
        data = (ROOT / rel).read_bytes()
        h.update(f"path:{rel}\n".encode())
        h.update(f"size:{len(data)}\n".encode())
        h.update(data)
    return h.hexdigest()


def main() -> None:
    paths = list_paths()
    manifest = "\n".join(
        f"{hashlib.sha256((ROOT / r).read_bytes()).hexdigest()}  {r}" for r in paths
    ) + "\n"
    (ROOT / "final-gate-bundle.manifest").write_text(manifest, encoding="utf-8")
    digest = bundle_digest(paths)
    (ROOT / "FINAL-GATE-BUNDLE_SHA256.txt").write_text(digest + "\n", encoding="utf-8")
    print(digest)
    print(f"files={len(paths)}")


if __name__ == "__main__":
    main()
