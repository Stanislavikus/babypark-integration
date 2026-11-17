"""Shared test helpers: engine availability (real V4.2.1 modules) and seed loading."""
from __future__ import annotations

import os
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHIM_TARGET = Path("/opt/bp-recommendations-full-rollout-rehearsal-20261111/v3.2/engine/run_v3_final.py")


def engine_ready() -> tuple:
    """(ok, reason): the real V4.2.1 modules need BP_V421_ENGINE_ROOT and the rehearsal /opt path (or sandbox shim)."""
    root = os.environ.get("BP_V421_ENGINE_ROOT")
    if not root or not (Path(root) / "work/accessories/src/accessory_v4.py").is_file():
        return False, "BP_V421_ENGINE_ROOT is not set to an engine_root-layout directory"
    if not SHIM_TARGET.is_file():
        return False, f"{SHIM_TARGET} missing (run tools/sandbox_opt_shim.sh in a sandbox; exists on rehearsal)"
    return True, ""


def require_engine(testcase_cls):
    """Class decorator: skip (loudly, with a reason) when the real engine is not importable. Never stubs it."""
    ok, why = engine_ready()
    return testcase_cls if ok else unittest.skip("real V4.2.1 engine unavailable: " + why)(testcase_cls)
