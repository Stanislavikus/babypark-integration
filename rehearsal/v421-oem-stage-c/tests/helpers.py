"""Shared test helpers for Stage C: the real V4.2.1 engine modules, the patched seam copy, and the accepted Stage B fixtures.

* ``engine_ready()`` / ``require_engine``: the real engine needs ``BP_V421_ENGINE_ROOT`` (engine_root layout) and the rehearsal /opt path or its
  sandbox shim (same rule as the accepted Stage B tests). The engine is never stubbed; without it the dependent tests skip loudly.
* ``baseline()`` is the UNMODIFIED accepted ``accessory_v4``; ``patched()`` is the Stage C seam copy loaded under another module name next to
  it, so both can run side by side in one process.
* ``stage_b_module()`` loads Stage B test fixtures (synthetic world, mini catalog builder) by file path: both stages call their test package
  ``tests``, so they must not be imported by package name.
"""
from __future__ import annotations

import importlib.util
import os
import sys
import unittest
from pathlib import Path

from oem_intake import _stage_b

ROOT = Path(__file__).resolve().parents[1]
STAGE_B = _stage_b.ensure_on_path()
SEAM_FILE = ROOT / "engine_seam" / "accessory_v4_stage_c.py"
SHIM_TARGET = Path("/opt/bp-recommendations-full-rollout-rehearsal-20261111/v3.2/engine/run_v3_final.py")
_CACHE: dict = {}


def engine_ready() -> tuple:
    root = os.environ.get("BP_V421_ENGINE_ROOT")
    if not root or not (Path(root) / "work/accessories/src/accessory_v4.py").is_file():
        return False, "BP_V421_ENGINE_ROOT is not set to an engine_root-layout directory"
    if not SHIM_TARGET.is_file():
        return False, f"{SHIM_TARGET} missing (run tools/sandbox_opt_shim.sh of Stage B in a sandbox; exists on rehearsal)"
    return True, ""


def require_engine(testcase_cls):
    ok, why = engine_ready()
    return testcase_cls if ok else unittest.skip("real V4.2.1 engine unavailable: " + why)(testcase_cls)


def stage_b_module(name: str, relpath: str):
    """Load a Stage B file by path under a private module name (cached)."""
    key = "stage_b:" + name
    if key not in _CACHE:
        path = STAGE_B / relpath
        spec = importlib.util.spec_from_file_location("stage_b_" + name, path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        _CACHE[key] = module
    return _CACHE[key]


def baseline():
    """The unmodified accepted accessory_v4 (imported through the accepted engine root; bytecode is never written there)."""
    if "baseline" not in _CACHE:
        from oem_stage import engine_env
        engine_env.prepare_sys_path()
        import accessory_v4
        _CACHE["baseline"] = accessory_v4
    return _CACHE["baseline"]


def patched():
    """The Stage C seam copy, loaded by path as ``accessory_v4_stage_c`` (its sibling imports resolve through the accepted engine root)."""
    if "patched" not in _CACHE:
        baseline()                                    # same sys.path set-up as the accepted module
        spec = importlib.util.spec_from_file_location("accessory_v4_stage_c", SEAM_FILE)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        _CACHE["patched"] = module
    return _CACHE["patched"]
