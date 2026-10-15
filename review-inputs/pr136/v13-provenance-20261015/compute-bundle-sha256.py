#!/usr/bin/env python3
"""Deterministic bundle SHA-256 per BUNDLE_SHA256_METHODOLOGY.md."""
from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXCLUDE = {"BUNDLE_SHA256.txt", "bundle-sha256.manifest"}


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


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def bundle_digest(paths: list[str]) -> str:
    h = hashlib.sha256()
    for rel in paths:
        fp = ROOT / rel
        data = fp.read_bytes()
        h.update(f"path:{rel}\n".encode("utf-8"))
        h.update(f"size:{len(data)}\n".encode("utf-8"))
        h.update(data)
    return h.hexdigest()


def main() -> None:
    paths = list_paths()
    manifest_lines = [f"{file_sha256(ROOT / rel)}  {rel}" for rel in paths]
    (ROOT / "bundle-sha256.manifest").write_text(
        "\n".join(manifest_lines) + "\n", encoding="utf-8"
    )
    digest = bundle_digest(paths)
    (ROOT / "BUNDLE_SHA256.txt").write_text(digest + "\n", encoding="utf-8")
    print(digest)
    print(f"files={len(paths)}")


if __name__ == "__main__":
    main()
