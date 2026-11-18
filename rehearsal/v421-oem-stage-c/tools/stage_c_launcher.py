#!/usr/bin/env python3
"""Run an accepted ``run_fresh_t2.py``-style script with the Stage C engine registered as ``accessory_v4`` (feature OFF or ON). Stdlib only.

    python3 -I -B tools/stage_c_launcher.py --runner <runner copy> --engine-src <accepted engine src dir> --seam-file engine_seam/accessory_v4_stage_c.py \\
        --pins engine_seam/ENGINE_SEAM_PINS.json --mode off|on [--envelope accepted_edges.json [--allow-synthetic]] --receipt <receipt.json>

Both files are checked against ENGINE_SEAM_PINS.json first: the engine in ``--engine-src`` must be the accepted V4.2.1 ``accessory_v4.py`` and the seam file
must be the audited patched copy of exactly that file. The runner then imports ``accessory_v4`` as usual and gets the seam module. ``off`` changes nothing
(the seam is only present); ``on`` wraps ``build_catalog`` so that the envelope and the explicit flag are passed to it - nothing else about the run changes.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import runpy
import sys
from pathlib import Path


def sha256(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--runner", required=True)
    ap.add_argument("--engine-src", required=True)
    ap.add_argument("--seam-file", required=True)
    ap.add_argument("--pins", required=True)
    ap.add_argument("--mode", choices=("off", "on"), required=True)
    ap.add_argument("--envelope", default=None)
    ap.add_argument("--allow-synthetic", action="store_true")
    ap.add_argument("--receipt", default=None)
    args = ap.parse_args(argv)
    pins = json.loads(Path(args.pins).read_text(encoding="utf-8"))
    base = Path(args.engine_src) / "accessory_v4.py"
    problems = []
    if not base.is_file() or sha256(base) != pins["base_sha256"]:
        problems.append("the engine accessory_v4.py is not the accepted V4.2.1 file the seam was built on")
    if sha256(args.seam_file) != pins["patched_sha256"]:
        problems.append("the seam file is not the audited patched copy pinned in ENGINE_SEAM_PINS.json")
    if args.mode == "on" and not args.envelope:
        problems.append("--envelope is required for --mode on")
    if args.mode == "off" and (args.envelope or args.allow_synthetic):
        problems.append("--envelope / --allow-synthetic are only meaningful for --mode on")
    if problems:
        print("REFUSED: " + "; ".join(problems), file=sys.stderr)
        return 2
    envelope = None
    if args.mode == "on":
        envelope = json.loads(Path(args.envelope).read_text(encoding="utf-8"))
    sys.path.insert(0, str(Path(args.engine_src)))
    spec = importlib.util.spec_from_file_location("accessory_v4", args.seam_file)
    module = importlib.util.module_from_spec(spec)
    sys.modules["accessory_v4"] = module                    # the runner's own `import accessory_v4` now yields the seam module
    spec.loader.exec_module(module)
    if args.mode == "on":
        original = module.build_catalog

        def build_catalog(*a, **kw):
            return original(*a, oem_relations=envelope, oem_enabled=True, oem_allow_synthetic=args.allow_synthetic, **kw)

        module.build_catalog = build_catalog
    if args.receipt:
        receipt = {"schema": "bp-oem-launcher-receipt-v1", "mode": args.mode, "engine_base_sha256": pins["base_sha256"],
                   "seam_sha256": pins["patched_sha256"], "envelope_sha256": None if not args.envelope else sha256(args.envelope),
                   "allow_synthetic": bool(args.allow_synthetic), "runner_sha256": sha256(args.runner)}
        Path(args.receipt).write_text(json.dumps(receipt, sort_keys=True, indent=2) + "\n", encoding="utf-8", newline="\n")
    sys.argv = [str(args.runner)]
    runpy.run_path(str(args.runner), run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
