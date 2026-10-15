#!/usr/bin/env python3
"""Deterministic aggregate SHA-256 for r1-qualifying evidence tree.

See BUNDLE_SHA256_METHODOLOGY.md — single unambiguous algorithm; no contradictory exclusions.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# Excluded carriers only (digest is over payload files; carriers are derived):
EXCLUDE = frozenset({"BUNDLE_SHA256.txt", "bundle-sha256.manifest"})


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


def file_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


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
    manifest = "\n".join(f"{file_digest(ROOT / r)}  {r}" for r in paths) + "\n"
    (ROOT / "bundle-sha256.manifest").write_text(manifest, encoding="utf-8")
    digest = bundle_digest(paths)
    (ROOT / "BUNDLE_SHA256.txt").write_text(digest + "\n", encoding="utf-8")
    print(digest)
    print(f"files={len(paths)}")


if __name__ == "__main__":
    main()
