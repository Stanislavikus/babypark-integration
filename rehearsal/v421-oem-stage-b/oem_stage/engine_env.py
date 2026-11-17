"""Locate the V4.2.1 engine modules (read-only) and pin their digests.

On rehearsal the engine lives under the corrected-generation campaign (``engine_root``); in a
sandbox set BP_V421_ENGINE_ROOT to a directory with the same layout
(``work/accessories/src`` and ``upstream/v32/engine``). The engine is imported, never modified.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from . import canon

DEFAULT_ROOT = ("/opt/bp-v421-v36-full-category-decision-20261115/car_seat_correction_20261117/engine_root")
ENGINE_FILES = ("work/accessories/src/accessory_v4.py", "work/accessories/src/accessory_auto_v39.py",
                "work/accessories/src/canonical_models.py", "work/accessories/src/v3_rules_v421.py",
                "work/accessories/src/v32_pipeline.py")


def engine_root() -> Path:
    root = Path(os.environ.get("BP_V421_ENGINE_ROOT", DEFAULT_ROOT))
    if not (root / "work/accessories/src/accessory_v4.py").is_file():
        raise FileNotFoundError(f"V4.2.1 engine not found under {root} (set BP_V421_ENGINE_ROOT)")
    return root


def prepare_sys_path(root: Path | None = None) -> Path:
    """Put the engine source dirs first on sys.path (same precedence accessory_v4 itself uses)."""
    # The engine tree lives inside the accepted campaign (baseline data, immutable): importing it must never write bytecode there.
    sys.dont_write_bytecode = True
    root = root or engine_root()
    for sub in ("upstream/v32/engine", "work/accessories/src"):
        path = str(root / sub)
        if path in sys.path:
            sys.path.remove(path)
        sys.path.insert(0, path)
    return root


def engine_pins(root: Path | None = None) -> dict:
    root = root or engine_root()
    return {name: canon.file_sha256(root / name) for name in ENGINE_FILES if (root / name).is_file()}
