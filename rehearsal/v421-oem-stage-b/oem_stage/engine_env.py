"""Locate the V4.2.1 engine modules (read-only) and pin their digests.

On rehearsal the engine lives under the corrected-generation campaign (``engine_root``); in a
sandbox set BP_V421_ENGINE_ROOT to a directory with the same layout
(``work/accessories/src`` and ``upstream/v32/engine``). The engine is imported, never modified.

Provenance of what was actually imported (B-R3). The unmodified legacy engine puts several directories on sys.path itself, so the
accepted bytes of a module may be imported from a path other than ``engine_root`` (for example ``v32_pipeline`` from
``/opt/bp-accessories-v421-integration-rehearsal-20261112/upstream/v32/engine``). The rule is therefore: the imported file's SHA-256 must equal
the accepted pin (ACCEPTED_ENGINE_SHA256) AND its resolved directory must be one the engine itself uses (approved_import_dirs). Bytes decide
whether it is the accepted code; the location decides whether it was imported from a trusted place. Neither alone is enough.
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


# Accepted V4.2.1 engine bytes (the five modules the Stage B shadow imports), as listed in STAGE_B_RESULT_20261117.md and confirmed on the
# rehearsal host by the independent check. canonical_models.py and v32_pipeline.py exist byte-identically in work/accessories/src and
# upstream/v32/engine, so one digest per module name covers both copies.
ACCEPTED_ENGINE_SHA256 = {
    "work/accessories/src/accessory_auto_v39.py": "7f313b47f7f94efd797527737d32761bd3670a2cbe236cefc1827a84692beb04",
    "work/accessories/src/accessory_v4.py": "20c12303543fa7c4a522cc28ea5f4dc698098b0093ccf14fa066f9d67f7be2e8",
    "work/accessories/src/canonical_models.py": "eb54e4bef88158af896ad54ebe5f6c27b3886c1b831fee91166877e9ccabdda3",
    "work/accessories/src/v32_pipeline.py": "9c4cd8788aadc7d8a1422bd941c2a1032b36319f13daeaf58bb60b8ce32eafdc",
    "work/accessories/src/v3_rules_v421.py": "42c4fa835d25f3ed027df25f01fdd29790da20af75bfcf5b68fc2ee420141a35",
}
MODULE_SHA256 = {Path(name).stem: digest for name, digest in ACCEPTED_ENGINE_SHA256.items()}
# Directories the UNMODIFIED legacy engine itself puts on sys.path (evidence: tests/test_engine_provenance.py reads the engine source):
LEGACY_IMPORT_DIRS = (
    "/opt/bp-accessories-v421-integration-rehearsal-20261112/upstream/v32/engine",   # model_mentions.py: sys.path.insert(0, ...)
    "/opt/bp-recommendations-full-rollout-rehearsal-20261111/v3.2/engine",           # v32_pipeline.py: ENGINE = BASE / "engine"
)


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


def _resolved(path) -> Path:
    return Path(path).resolve()


def approved_import_dirs(root: Path | None = None) -> list:
    """Resolved directories a pinned engine module may be imported from: the two source directories of the engine root in use, the same two
    of the accepted campaign engine_root that accessory_v4 hard-codes, and the legacy directories above. Never a parent or a child of these."""
    roots = [Path(root) if root is not None else engine_root(), Path(DEFAULT_ROOT)]
    dirs = [r / sub for r in roots for sub in ("work/accessories/src", "upstream/v32/engine")] + [Path(d) for d in LEGACY_IMPORT_DIRS]
    return [_resolved(d) for d in dirs]


def import_provenance(root: Path | None = None, *, names=None, modules=None, accepted=None, approved_dirs=None) -> list:
    """One row per requested module: where it was imported from, whether its bytes are the accepted ones, whether that location is approved.

    ``modules`` defaults to sys.modules, ``accepted`` to MODULE_SHA256 and ``approved_dirs`` to approved_import_dirs(root) (the parameters exist
    so the rule is testable without the real engine). Status: PASS (bytes MATCH and location approved), FAIL, or NOT_LOADED."""
    modules = sys.modules if modules is None else modules
    accepted = MODULE_SHA256 if accepted is None else accepted
    approved = [_resolved(d) for d in (approved_import_dirs(root) if approved_dirs is None else approved_dirs)]
    rows = []
    for name in sorted(accepted) if names is None else list(names):
        if name not in accepted:
            raise ValueError(f"{name!r} is not a pinned engine module (pinned: {sorted(accepted)})")
        row = {"module": name, "accepted_sha256": accepted[name]}
        module = modules.get(name)
        filename = getattr(module, "__file__", None)
        if module is None:
            row["status"] = "NOT_LOADED"
        elif not filename:
            row.update(status="FAIL", detail="module has no source file (stub, builtin or namespace)")
        else:
            path = _resolved(filename)
            try:
                digest = canon.file_sha256(path)
            except OSError:
                digest = None
            location = next((str(d) for d in approved if path.parent == d), "UNAPPROVED")
            row.update(file=str(path), sha256=digest, location=location,
                       bytes="UNREADABLE" if digest is None else "MATCH" if digest == accepted[name] else "MISMATCH")
            row["status"] = "PASS" if row["bytes"] == "MATCH" and location != "UNAPPROVED" else "FAIL"
        rows.append(row)
    return rows


def provenance_problems(rows, *, allow_not_loaded: bool = False) -> list:
    """Human-readable problems of import_provenance rows (empty list = every requested module is the accepted code from an approved place)."""
    problems = []
    for row in rows:
        if row["status"] == "PASS" or (row["status"] == "NOT_LOADED" and allow_not_loaded):
            continue
        if row["status"] == "NOT_LOADED":
            problems.append(f"{row['module']}: not imported, so its provenance cannot be shown")
        elif "detail" in row:
            problems.append(f"{row['module']}: {row['detail']}")
        else:
            reasons = []
            if row["bytes"] != "MATCH":
                reasons.append(f"bytes {row['bytes']} (sha256 {row['sha256']}, accepted {row['accepted_sha256']})")
            if row["location"] == "UNAPPROVED":
                reasons.append("imported from an unapproved location")
            problems.append(f"{row['module']} at {row['file']}: " + "; ".join(reasons))
    return problems


def engine_root_problems(root: Path | None = None, *, accepted=None) -> list:
    """The engine root in use must hold exactly the accepted bytes (a missing or changed pinned file is a problem)."""
    root = Path(root) if root is not None else engine_root()
    accepted = ACCEPTED_ENGINE_SHA256 if accepted is None else accepted
    problems = []
    for name, digest in sorted(accepted.items()):
        path = root / name
        if not path.is_file():
            problems.append(f"{name}: missing in the engine root {root}")
        elif canon.file_sha256(path) != digest:
            problems.append(f"{name}: sha256 differs from the accepted pin {digest}")
    return problems
