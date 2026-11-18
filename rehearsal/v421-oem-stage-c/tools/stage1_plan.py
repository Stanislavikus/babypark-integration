#!/usr/bin/env python3
"""Stage1 preparation for OEM candidates (Stage C, S6). Read-only; Stage1 itself is the existing native Drupal/Ubercart gate and is NOT run here.

    # 1. which fresh native checks would be needed (a plan; nothing is judged, nothing is run)
    python3 -I -B tools/stage1_plan.py plan --rows <INPUT>/fresh_current_catalog_records.jsonl.gz --diff <replay out>/on_off_diff.json --out /tmp/work/stage1_plan
    python3 -I -B tools/stage1_plan.py plan --rows <INPUT>/fresh_current_catalog_records.jsonl.gz --envelope <stage C accepted_edges.json> --out /tmp/work/stage1_plan_env
    python3 -I -B tools/stage1_plan.py plan --rows <INPUT>/fresh_current_catalog_records.jsonl.gz --sku <SKU> [--sku <SKU> ...] --out /tmp/work/stage1_candidates

    # 2. after the EXISTING native Stage1 gate has been run on the nids of the plan (its receipt files keep the existing format):
    python3 -I -B tools/stage1_plan.py verify --plan /tmp/work/stage1_plan/stage1_plan.json --receipts <targets receipt file> \\
        [--source-receipts <source-context receipt file>] --out /tmp/work/stage1_report [--require-cleared]

``plan --diff`` (the exact one after a replay) lists the target-locales and source contexts of every link that is NEW in the feature-ON output: the
accepted OEM edges that were really published and the generic B edges that only appear because an OEM edge freed a slot; ``plan --envelope`` lists the
target-locales and the source contexts of ALL the gate's accepted edges (a superset: before the replay, or when the diff is not at hand; an envelope of
zero edges gives an empty plan); ``plan --sku`` is the pre-flight for OEM-candidate accessory SKUs (every ru/uk row of the SKU; a row whose own catalog state already rules it out -
``field_status != 1``, unpublished, price not positive - is ``NOT_RECOMMENDABLE`` and gets no native test). ``verify`` compares receipts with the plan
and fails closed (see ``oem_intake/stage1.py``): without a receipts file every planned check is ``NOT_RUN``. Receipts are never created or completed here.

Exit codes: 0 the plan / report was written (a report full of NOT_RUN is a result, not an error; with ``--require-cleared`` it is exit 1 unless every
planned native check passed); 2 the input was refused (bad envelope or plan, an envelope that is synthetic without --allow-synthetic, unusable receipts,
an output directory that already holds files).
"""
from __future__ import annotations

import argparse
import gzip
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from oem_intake import _stage_b, stage1  # noqa: E402

_stage_b.ensure_on_path()
from oem_stage import canon  # noqa: E402


def _read(path):
    """``(raw bytes, decoded bytes)``; an unreadable or corrupt file is a refusal, never a traceback."""
    try:
        raw = Path(path).read_bytes()
        return raw, (gzip.decompress(raw) if str(path).endswith(".gz") else raw)
    except (OSError, EOFError) as exc:
        raise stage1.Stage1Refused(f"{path}: not readable ({exc})") from None


def load_json(path):
    try:
        return json.loads(_read(path)[1].decode("utf-8"))
    except ValueError as exc:
        raise stage1.Stage1Refused(f"{path}: not readable JSON ({exc})") from None


def load_rows(path) -> tuple:
    """``({nid: row}, sha256 of the file)`` from the corrected generation's catalog records (JSON lines, gzip allowed)."""
    raw, data = _read(path)
    rows = {}
    try:
        for line in data.decode("utf-8").splitlines():
            if line.strip():
                row = json.loads(line)
                rows[int(row["nid"])] = row
    except (ValueError, KeyError, TypeError) as exc:
        raise stage1.Stage1Refused(f"{path}: not catalog records with an integer nid ({exc})") from None
    return rows, canon.sha256_hex(raw)


def ensure_new_dir(out: Path) -> None:
    if out.exists() and (not out.is_dir() or any(out.iterdir())):
        raise stage1.Stage1Refused(f"the output directory {out} must not exist or must be empty")


def write_outputs(out: Path, docs: dict) -> dict:
    hashes = {name: canon.write_json(out / name, doc) for name, doc in sorted(docs.items())}
    canon.write_text(out / "SHA256SUMS.txt", "".join(f"{sha}  {name}\n" for name, sha in sorted(hashes.items())))
    return hashes


def cmd_plan(args) -> int:
    if sum(bool(x) for x in (args.envelope, args.diff, args.sku)) != 1:
        raise stage1.Stage1Refused("give exactly one of --diff, --envelope and --sku")
    out = Path(args.out)
    ensure_new_dir(out)
    rows, rows_sha = load_rows(args.rows)
    if args.envelope:
        plan = stage1.plan_from_envelope(load_json(args.envelope), rows, allow_synthetic=args.allow_synthetic, rows_sha256=rows_sha)
    elif args.diff:
        plan = stage1.plan_from_diff(load_json(args.diff), rows, allow_synthetic=args.allow_synthetic, rows_sha256=rows_sha)
    else:
        if args.allow_synthetic:
            raise stage1.Stage1Refused("--allow-synthetic only applies to --envelope and --diff")
        plan = stage1.plan_from_skus(args.sku, rows, rows_sha256=rows_sha)
    hashes = write_outputs(out, {"stage1_plan.json": plan})
    print(json.dumps({"out": str(out), "mode": plan["mode"], "summary": plan["summary"], "native_check_nids": plan["native_check_nids"],
                      "plan_digest": plan["plan_digest"], "files": hashes}, indent=1, sort_keys=True))
    return 0


def cmd_verify(args) -> int:
    out = Path(args.out)
    ensure_new_dir(out)
    plan = load_json(args.plan)
    receipts = load_json(args.receipts) if args.receipts else None
    source_receipts = load_json(args.source_receipts) if args.source_receipts else None
    sha = lambda p: canon.sha256_hex(_read(p)[0]) if p else None  # noqa: E731
    report = stage1.check_receipts(plan, receipts, source_receipts, receipts_sha256=sha(args.receipts),
                                   source_receipts_sha256=sha(args.source_receipts))
    hashes = write_outputs(out, {"stage1_receipts_report.json": report})
    print(json.dumps({"out": str(out), "summary": report["summary"], "files": hashes}, indent=1, sort_keys=True))
    return 1 if args.require_cleared and not report["summary"]["all_planned_checks_pass"] else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)
    p = sub.add_parser("plan", help="list the fresh native checks that would be needed")
    p.add_argument("--rows", required=True)
    p.add_argument("--envelope", default=None)
    p.add_argument("--diff", default=None, help="on_off_diff.json written by tools/replay_stage_c.py")
    p.add_argument("--allow-synthetic", action="store_true", help="test-only: the envelope / diff is synthetic")
    p.add_argument("--sku", action="append", default=[], help="OEM-candidate accessory SKU (repeatable)")
    p.add_argument("--out", required=True)
    p.set_defaults(run=cmd_plan)
    v = sub.add_parser("verify", help="compare existing-format native receipts with a plan (fails closed)")
    v.add_argument("--plan", required=True)
    v.add_argument("--receipts", default=None)
    v.add_argument("--source-receipts", default=None)
    v.add_argument("--require-cleared", action="store_true")
    v.add_argument("--out", required=True)
    v.set_defaults(run=cmd_verify)
    args = ap.parse_args(argv)
    try:
        return args.run(args)
    except stage1.Stage1Refused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
