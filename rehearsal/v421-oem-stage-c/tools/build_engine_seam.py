#!/usr/bin/env python3
"""Build (or verify) the Stage C engine seam: the accepted ``accessory_v4.py`` plus five exact, anchored edits.

    BP_V421_ENGINE_ROOT=<accepted engine_root> python3 tools/build_engine_seam.py --check     # verify the committed seam files
    BP_V421_ENGINE_ROOT=<accepted engine_root> python3 tools/build_engine_seam.py --write     # regenerate them (developers only)

The accepted engine tree is only READ. The seam is shipped as a patched COPY of the one file (``engine_seam/accessory_v4_stage_c.py``) with
pinned digests (``engine_seam/ENGINE_SEAM_PINS.json``) and the regenerated unified diff (``engine_seam/accessory_v4_stage_c.patch``), built
with stdlib ``difflib`` only. Each edit anchors on text that must occur exactly once in the base file; the base file must have the accepted
SHA-256, otherwise nothing is produced. ``--check`` fails (exit 1) unless the committed files equal what this tool regenerates and every pin
matches. The edits are the whole change: a new optional helper block before ``build_catalog`` and five insertions that are inert unless
``oem_enabled=True``.
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
import sys
from pathlib import Path

STAGE = Path(__file__).resolve().parents[1]
SEAM_DIR = STAGE / "engine_seam"
BASE_REL = "work/accessories/src/accessory_v4.py"
BASE_SHA256 = "20c12303543fa7c4a522cc28ea5f4dc698098b0093ccf14fa066f9d67f7be2e8"
HELPERS = SEAM_DIR / "seam_helpers.py.txt"
PATCHED = SEAM_DIR / "accessory_v4_stage_c.py"
PATCH = SEAM_DIR / "accessory_v4_stage_c.patch"
PINS = SEAM_DIR / "ENGINE_SEAM_PINS.json"
PINS_SCHEMA = "bp-oem-engine-seam-pins-v1"

OLD_DEF = "def build_catalog(rows,original,index,policy,fitment_rules=None,option_profiles=None):\n"
NEW_DEF = ("def build_catalog(rows,original,index,policy,fitment_rules=None,option_profiles=None,\n"
           "                  oem_relations=None,oem_enabled=False,oem_allow_synthetic=False):\n")
EDITS = [
    ("E1", "signature and helper block (inert unless oem_enabled=True)", OLD_DEF, None, NEW_DEF),
    ("E2", "run-level flag: validate the envelope once, only when ON",
     "    pool_a=v39.build_pool(rows)\n",
     None,
     "    if type(oem_enabled) is not bool:raise ValueError(\"oem_enabled must be a boolean\")\n"
     "    oem_on=oem_enabled;oem_edges={};oem_ledger=[];oem_meta=None\n"
     "    if oem_on:\n"
     "        if oem_relations is None:raise ValueError(\"oem_relations: oem_enabled requires an accepted-edges envelope\")\n"
     "        oem_edges,oem_meta=oem_load_envelope(oem_relations,oem_allow_synthetic)\n"
     "        metrics[\"edges\"][\"A_oem_relation\"]=0\n"
     "    pool_a=v39.build_pool(rows)\n"),
    ("E3", "merge accepted OEM edges AFTER all legacy A edges (order of legacy edges cannot change)",
     "        old_similar=list(record[\"similar\"])\n        b_ids=[]; b_reasons={}\n",
     None,
     "        old_similar=list(record[\"similar\"])\n"
     "        oem_accepted=[]\n"
     "        if oem_on:a_ids,oem_accepted=_oem_merge(nid,source,head,a_ids,a_reasons,old_similar,rows,policy,option_profiles,oem_edges,oem_ledger,index)\n"
     "        b_ids=[]; b_reasons={}\n"),
    ("E4", "record published / dropped-by-limit once the limit of 20 is applied",
     "        total=(a_ids+b_ids)[:20]\n",
     None,
     "        total=(a_ids+b_ids)[:20]\n"
     "        if oem_on:_oem_finalize(oem_accepted,total)\n"),
    ("E5", "close the ledger and write the OEM metrics (only when ON)",
     "    metrics[\"elapsed_seconds\"]=round(time.perf_counter()-start,3)\n",
     None,
     "    if oem_on:_oem_close(metrics,oem_edges,original,oem_ledger,oem_meta)\n"
     "    metrics[\"elapsed_seconds\"]=round(time.perf_counter()-start,3)\n"),
]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class SeamError(RuntimeError):
    pass


def base_path(engine_root) -> Path:
    return Path(engine_root) / BASE_REL


def apply_edits(base: str, helpers: str) -> tuple:
    """Return (patched_text, edit_records). Every anchor must match exactly once; the helper block is spliced in before build_catalog."""
    text, records = base, []
    for edit_id, description, anchor, _unused, replacement in EDITS:
        count = base.count(anchor)
        if count != 1 or text.count(anchor) != 1:
            raise SeamError(f"{edit_id}: the anchor occurs {count} times in the base file (expected exactly once)")
        line = base[: base.index(anchor)].count("\n") + 1          # line number in the ACCEPTED base file
        if edit_id == "E1":
            replacement = helpers + replacement
        text = text.replace(anchor, replacement, 1)
        records.append({"id": edit_id, "description": description, "base_line": line})
    return text, records


def unified_diff(base: str, patched: str) -> str:
    lines = difflib.unified_diff(base.splitlines(keepends=True), patched.splitlines(keepends=True),
                                 fromfile="a/" + BASE_REL, tofile="b/" + BASE_REL, n=3)
    return "".join(lines)


def build(engine_root) -> dict:
    path = base_path(engine_root)
    if not path.is_file():
        raise SeamError(f"the accepted engine file is missing: {path}")
    raw = path.read_bytes()
    if sha256_bytes(raw) != BASE_SHA256:
        raise SeamError(f"the base file is not the accepted accessory_v4.py (sha256 {sha256_bytes(raw)}, expected {BASE_SHA256})")
    if b"\r" in raw:
        raise SeamError("the base file has CR characters; the seam is defined for LF text")
    helpers = HELPERS.read_text(encoding="utf-8")
    base = raw.decode("utf-8")
    patched, records = apply_edits(base, helpers)
    diff = unified_diff(base, patched)
    added = sum(1 for line in diff.splitlines() if line.startswith("+") and not line.startswith("+++"))
    removed = sum(1 for line in diff.splitlines() if line.startswith("-") and not line.startswith("---"))
    patched_bytes, diff_bytes = patched.encode("utf-8"), diff.encode("utf-8")
    pins = {"schema": PINS_SCHEMA, "base_file": BASE_REL, "base_sha256": BASE_SHA256,
            "patched_file": "engine_seam/accessory_v4_stage_c.py", "patched_sha256": sha256_bytes(patched_bytes),
            "patch_file": "engine_seam/accessory_v4_stage_c.patch", "patch_sha256": sha256_bytes(diff_bytes),
            "helpers_file": "engine_seam/seam_helpers.py.txt", "helpers_sha256": sha256_bytes(HELPERS.read_bytes()),
            "edits": records, "patch_added_lines": added, "patch_removed_lines": removed,
            "base_lines": base.count("\n"), "patched_lines": patched.count("\n")}
    return {"patched": patched_bytes, "patch": diff_bytes, "pins": pins}


def pins_text(pins: dict) -> str:
    return json.dumps(pins, ensure_ascii=False, sort_keys=True, indent=2) + "\n"


def check(engine_root) -> list:
    """Problems found when the committed seam files are compared with a fresh build (empty list = verified)."""
    built = build(engine_root)
    problems = []
    for label, path, data in (("patched file", PATCHED, built["patched"]), ("patch", PATCH, built["patch"]),
                              ("pins", PINS, pins_text(built["pins"]).encode("utf-8"))):
        if not path.is_file():
            problems.append(f"the committed {label} {path.name} is missing")
        elif path.read_bytes() != data:
            problems.append(f"the committed {label} {path.name} differs from a fresh build")
    return problems


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--write", action="store_true")
    ap.add_argument("--engine-root", default=os.environ.get("BP_V421_ENGINE_ROOT"))
    args = ap.parse_args(argv)
    if not args.engine_root:
        print("REFUSED: --engine-root or BP_V421_ENGINE_ROOT is required", file=sys.stderr)
        return 2
    try:
        if args.check:
            problems = check(args.engine_root)
            for problem in problems:
                print("FAIL:", problem)
            pins = json.loads(PINS.read_text(encoding="utf-8")) if PINS.is_file() else {}
            print("ENGINE SEAM", "VERIFIED" if not problems else "FAILED", "base", BASE_SHA256[:12], "patched", str(pins.get("patched_sha256"))[:12])
            return 0 if not problems else 1
        built = build(args.engine_root)
    except SeamError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2
    SEAM_DIR.mkdir(parents=True, exist_ok=True)
    PATCHED.write_bytes(built["patched"])
    PATCH.write_bytes(built["patch"])
    PINS.write_text(pins_text(built["pins"]), encoding="utf-8", newline="\n")
    print(f"written: {PATCHED.name} sha256 {built['pins']['patched_sha256']}, +{built['pins']['patch_added_lines']} -{built['pins']['patch_removed_lines']} lines")
    return 0


if __name__ == "__main__":
    sys.exit(main())
