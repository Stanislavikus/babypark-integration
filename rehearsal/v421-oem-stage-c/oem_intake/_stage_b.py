"""Make the accepted Stage B package ``oem_stage`` importable (read-only reuse).

Default location: the sibling directory ``rehearsal/v421-oem-stage-b`` of this stage. ``BP_OEM_STAGE_B_DIR`` overrides it for a host whose
checkout layout differs. Importing never writes anything (no bytecode is written into the Stage B tree by this helper's callers that run with ``-B``).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def stage_b_dir() -> Path:
    override = os.environ.get("BP_OEM_STAGE_B_DIR")
    return Path(override) if override else Path(__file__).resolve().parents[2] / "v421-oem-stage-b"


def ensure_on_path() -> Path:
    base = stage_b_dir()
    if not (base / "oem_stage" / "__init__.py").is_file():
        raise ImportError(f"the accepted Stage B package oem_stage was not found under {base} (set BP_OEM_STAGE_B_DIR)")
    if str(base) not in sys.path:
        sys.path.insert(0, str(base))
    return base
