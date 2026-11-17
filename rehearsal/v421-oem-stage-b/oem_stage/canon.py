"""Deterministic serialization and hashing (stdlib only).

All outputs of the OEM stage are produced through these helpers so that the same
inputs always give byte-identical files (sorted keys, no timestamps, LF, final newline).
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path


def canonical_json(obj) -> str:
    """Compact canonical JSON used for content-derived identifiers and digests."""
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def digest(obj) -> str:
    """SHA-256 of the canonical JSON encoding of ``obj``."""
    return sha256_hex(canonical_json(obj).encode("utf-8"))


def dumps_pretty(obj) -> str:
    """Human-readable deterministic JSON: sorted keys, 2-space indent, final newline."""
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n"


def write_text(path, text: str) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def write_json(path, obj) -> str:
    """Write ``obj`` as deterministic pretty JSON; return the SHA-256 of the written bytes."""
    text = dumps_pretty(obj)
    write_text(path, text)
    return sha256_hex(text.encode("utf-8"))


def file_sha256(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)
