#!/usr/bin/env python3
"""S6 replay of the accepted corrected T2 generation with the Stage C seam: feature OFF (must reproduce the accepted result) and feature ON (explained diff).

REHEARSAL-ONLY command (needs the capture inputs and the engine that only exist on the rehearsal host):

    python3 tools/replay_stage_c.py \\
        --script <accepted run_fresh_t2.py> \\
        --original-campaign /opt/bp-v421-v36-full-category-decision-20261115/car_seat_correction_20261117 \\
        --new-campaign-off /opt/bp-v421-v36-full-category-decision-20261115/stage_c_replay_off_20261118 \\
        --new-campaign-on  /opt/bp-v421-v36-full-category-decision-20261115/stage_c_replay_on_20261118 \\
        --envelope <stage C accepted_edges.json> --gate-report <stage C oem_gate_report.json> --out /tmp/work/stage_c_replay

What it does (and only this): the Stage B replay mechanics (one patched ``REBUILD = ...`` line, a read-only copy of the live-transfer input, the six deterministic
artifacts compared with the original, the original tree snapshotted before/after) run TWICE through ``tools/stage_c_launcher.py``, which first checks the
engine and the seam file against ENGINE_SEAM_PINS.json:
  OFF  the seam engine with the feature off: every deterministic artifact must be IDENTICAL (or SEMANTICALLY_IDENTICAL for the two measurement-carrying
       files) to the accepted corrected generation, and tools/verify_baseline.py must pass: 28,769 rows, 8,129 sources, 1,832 stroller + 42 car-seat links.
  ON   the same engine with the envelope: the three INPUT-side artifacts must still be identical; the output side is compared with OFF and EVERY difference
       must be explained by ``oem_intake.replay_diff`` (new / promoted / displaced / backfilled / held edges, ledger, links). With an envelope of zero edges ON must
       reproduce OFF's manifest and evidence byte for byte.
Exit code 0 only when both runs pass, the diff classification has no violation and the original campaign is unchanged; 1 = completed but failed; 2 = refused.
Outputs in --out: replay_report.json, on_off_diff.json, HASHES.json, SHA256SUMS.txt.
"""
from __future__ import annotations

import argparse
import gzip
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from oem_intake import _stage_b, envelope as E, replay_diff  # noqa: E402

STAGE_B = _stage_b.ensure_on_path()
from oem_stage import canon  # noqa: E402


def _stage_b_tool(name: str):
    spec = importlib.util.spec_from_file_location("stage_b_tool_" + name, STAGE_B / "tools" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


RC = _stage_b_tool("replay_corrected_generation")
verify_baseline = RC.verify_baseline
SEAM_FILE = ROOT / "engine_seam" / "accessory_v4_stage_c.py"
SEAM_PINS = ROOT / "engine_seam" / "ENGINE_SEAM_PINS.json"
LAUNCHER = ROOT / "tools" / "stage_c_launcher.py"
INPUT_SIDE = ("input/fresh_current_catalog_records.jsonl.gz", "input/fresh_v32_index.json.gz", "input/fresh_v36_scope_sources.json")
OUTPUT_SIDE = ("output/t2_v421_manifest.json", "output/t2_v421_evidence.json", "output/t2_v421_metrics.json")
SCHEMA_REPORT = "bp-oem-stage-c-replay-report-v1"
NOTICE = ("REHEARSAL REPLAY REPORT. Nothing here is a recommendation or a publication authorization; production, main and PR #167/#168 are untouched; "
          "OD1-OD8 remain owner decisions that are still PENDING.")


class Refused(RuntimeError):
    pass


def _json(path):
    raw = Path(path).read_bytes()
    return json.loads((gzip.decompress(raw) if str(path).endswith(".gz") else raw).decode("utf-8"))


def check_locations(original: Path, off: Path, on: Path, out: Path) -> None:
    places = {"original campaign": original, "OFF campaign": off, "ON campaign": on, "output directory": out}
    names = list(places)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            pa, pb = places[a], places[b]
            if pa == pb or pa in pb.parents or pb in pa.parents:
                raise Refused(f"the {a} and the {b} must be separate, non-nested directories")
    for label, path in (("OFF campaign", off), ("ON campaign", on)):
        try:
            RC.check_paths(original, path)
        except RC.ReplayRefused as exc:
            raise Refused(f"{label}: {exc}") from None
    if out.exists() and any(out.iterdir()):
        raise Refused("the output directory must not exist or must be empty")


def run_one(mode, script_text, original, campaign, engine_src, envelope_path, allow_synthetic, python) -> dict:
    """One replay (OFF or ON) in a NEW campaign directory. Never writes into the original campaign."""
    patched_text = RC.patch_script(script_text, campaign)
    changed = [i for i, (a, b) in enumerate(zip(script_text.splitlines(), patched_text.splitlines())) if a != b]
    live_src = original / RC.LIVE_TRANSFER
    if not live_src.is_file():
        raise Refused(f"original campaign lacks {RC.LIVE_TRANSFER}")
    campaign.mkdir(mode=0o700, parents=True, exist_ok=True)
    live_dst = campaign / RC.LIVE_TRANSFER
    live_dst.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    data = live_src.read_bytes()
    live_dst.write_bytes(data)
    os.chmod(live_dst, 0o400)
    runner = campaign / "replay_run_fresh_t2.py"
    runner.write_text(patched_text, encoding="utf-8", newline="\n")
    receipt = campaign / "stage_c_launcher_receipt.json"
    cmd = [python, "-I", "-B", str(LAUNCHER), "--runner", str(runner), "--engine-src", str(engine_src), "--seam-file", str(SEAM_FILE),
           "--pins", str(SEAM_PINS), "--mode", mode, "--receipt", str(receipt)]
    if mode == "on":
        cmd += ["--envelope", str(envelope_path)] + (["--allow-synthetic"] if allow_synthetic else [])
    proc = subprocess.run(cmd, cwd=str(campaign), capture_output=True, text=True)
    events = []
    for line in proc.stdout.splitlines():
        try:
            events.append(json.loads(line))
        except ValueError:
            continue
    return {"mode": mode, "script_exit_code": proc.returncode, "patched_lines": len(changed), "final_event": events[-1] if events else None,
            "script_stderr_tail": proc.stderr[-1500:] if proc.returncode else "", "launcher_receipt": _json(receipt) if receipt.is_file() else None}


def load_outputs(campaign: Path) -> dict:
    out = campaign / "output"
    return {"sources": _json(out / "t2_v421_manifest.json")["sources"], "evidence": _json(out / "t2_v421_evidence.json")["sources"],
            "metrics": _json(out / "t2_v421_metrics.json")}


def strip_oem(metrics: dict) -> dict:
    """Metrics of an ON run without what only the seam adds (the oem block and the A_oem_relation counter) and without the wall-clock measurement."""
    out = json.loads(json.dumps(metrics))
    out.pop("oem", None)
    out.pop("elapsed_seconds", None)
    out.get("edges", {}).pop("A_oem_relation", None)
    return out


def empty_envelope_identity(off_dir: Path, on_dir: Path, off_out: dict, on_out: dict) -> dict:
    """With an envelope of zero edges ON must reproduce OFF: manifest and evidence byte for byte, metrics once the seam's own additions are removed."""
    files = {rel: {"off_sha256": RC.sha256(off_dir / rel), "on_sha256": RC.sha256(on_dir / rel)} for rel in OUTPUT_SIDE[:2]}
    for row in files.values():
        row["status"] = "IDENTICAL" if row["off_sha256"] == row["on_sha256"] else "DIFFERENT"
    a, b = strip_oem(off_out["metrics"]), strip_oem(on_out["metrics"])
    metrics_same = canon.canonical_json(a) == canon.canonical_json(b)
    return {"files": files, "metrics_equal_without_oem_additions": metrics_same,
            "ok": all(r["status"] == "IDENTICAL" for r in files.values()) and metrics_same}


def replay(args) -> tuple:
    original, off, on, out = (Path(p).resolve() for p in (args.original_campaign, args.new_campaign_off, args.new_campaign_on, args.out))
    check_locations(original, off, on, out)
    pins = json.loads(SEAM_PINS.read_text(encoding="utf-8"))
    engine_src = Path(args.engine_src) if args.engine_src else original / "engine_root" / "work" / "accessories" / "src"
    if not (engine_src / "accessory_v4.py").is_file() or RC.sha256(engine_src / "accessory_v4.py") != pins["base_sha256"]:
        raise Refused(f"{engine_src}/accessory_v4.py is not the accepted V4.2.1 engine file the seam was built on")
    if RC.sha256(SEAM_FILE) != pins["patched_sha256"]:
        raise Refused("engine_seam/accessory_v4_stage_c.py is not the audited patched copy pinned in ENGINE_SEAM_PINS.json (run tools/build_engine_seam.py --check)")
    envelope = _json(args.envelope)
    try:
        info = E.validate(envelope, allow_synthetic=args.allow_synthetic)
    except E.EnvelopeError as exc:
        raise Refused(f"the envelope is not acceptable: {exc}") from None
    gate_report = _json(args.gate_report) if args.gate_report else None
    script_text = Path(args.script).read_text(encoding="utf-8")
    try:                                                      # refuse before anything is created: exactly one REBUILD line, for both campaigns
        RC.patch_script(script_text, off)
        RC.patch_script(script_text, on)
    except RC.ReplayRefused as exc:
        raise Refused(str(exc)) from None
    baseline_pins = json.loads(Path(args.pins).read_text(encoding="utf-8"))
    before = RC.tree_snapshot(original)
    runs = {mode: run_one(mode, script_text, original, campaign, engine_src, args.envelope, args.allow_synthetic, sys.executable)
            for mode, campaign in (("off", off), ("on", on))}
    artifacts = {mode: [RC.compare_artifact(original, campaign, rel) for rel in RC.DETERMINISTIC] for mode, campaign in (("off", off), ("on", on))}
    after = RC.tree_snapshot(original)
    verification = (verify_baseline.verify(off / "input", off / "output", baseline_pins, off)
                    if not args.no_verify and runs["off"]["script_exit_code"] == 0 else None)
    off_ok = (runs["off"]["script_exit_code"] == 0 and runs["off"]["patched_lines"] == 1
              and all(a["status"] in RC.ACCEPTED_STATUSES for a in artifacts["off"]) and (verification is None or verification["result"] == "PASS"))
    on_input_ok = (runs["on"]["script_exit_code"] == 0 and runs["on"]["patched_lines"] == 1
                   and all(a["status"] in RC.ACCEPTED_STATUSES for a in artifacts["on"] if a["file"] in INPUT_SIDE))
    diff = identity = None
    if runs["off"]["script_exit_code"] == 0 and runs["on"]["script_exit_code"] == 0:
        off_out, on_out = load_outputs(off), load_outputs(on)
        rows = None
        rows_path = original / "input" / "fresh_current_catalog_records.jsonl.gz"
        if rows_path.is_file():
            with gzip.open(rows_path, "rt", encoding="utf-8") as handle:
                rows = {int(r["nid"]): {"sku": r.get("sku")} for r in map(json.loads, handle)}
        diff = replay_diff.classify(off_out, on_out, envelope=envelope, gate_report=gate_report, rows=rows)
        if info["edge_count"] == 0:
            identity = empty_envelope_identity(off, on, off_out, on_out)
    ok = (off_ok and on_input_ok and before == after and diff is not None and diff["result"] == "PASS"
          and (identity is None or identity["ok"]))
    report = {"schema": SCHEMA_REPORT, "result": "PASS" if ok else "FAIL", "notice": NOTICE,
              "synthetic_envelope": envelope["synthetic"], "envelope_edges": info["edge_count"], "envelope_sha256": RC.sha256(Path(args.envelope)),
              "seam": {"engine_base_sha256": pins["base_sha256"], "seam_sha256": pins["patched_sha256"], "patch_sha256": pins["patch_sha256"]},
              "original_tree_unchanged": before == after, "original_files_snapshotted": len(before),
              "off": {"result": "PASS" if off_ok else "FAIL", **runs["off"], "artifacts": artifacts["off"], "baseline_verification": verification},
              "on": {"result": "PASS" if on_input_ok else "FAIL", **runs["on"], "artifacts": artifacts["on"],
                     "output_side_note": "the output side may differ from the accepted generation by design; every difference is explained in on_off_diff.json"},
              "on_vs_off": None if diff is None else {"result": diff["result"], "sources": diff["sources"], "counts_by_change": diff["counts_by_change"],
                                                      "violations": len(diff["violations"]), "ledger": diff["ledger"], "links": diff["links"]},
              "empty_envelope_identity": identity,
              "volatile_field_whitelist": {rel: [".".join(p) for p in paths] for rel, paths in sorted(RC.VOLATILE_FIELDS.items())}}
    return report, diff


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--script", required=True)
    ap.add_argument("--original-campaign", required=True)
    ap.add_argument("--new-campaign-off", required=True)
    ap.add_argument("--new-campaign-on", required=True)
    ap.add_argument("--envelope", required=True)
    ap.add_argument("--gate-report", default=None)
    ap.add_argument("--allow-synthetic", action="store_true", help="test-only: the envelope is synthetic")
    ap.add_argument("--engine-src", default=None, help="accepted engine src dir (default: <original>/engine_root/work/accessories/src)")
    ap.add_argument("--pins", default=str(verify_baseline.DEFAULT_PINS))
    ap.add_argument("--no-verify", action="store_true", help="skip tools/verify_baseline.py on the OFF campaign (sandbox tests with fictional data only)")
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    try:
        report, diff = replay(args)
    except Refused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2
    out = Path(args.out)
    hashes = {"replay_report.json": canon.write_json(out / "replay_report.json", report)}
    if diff is not None:
        hashes["on_off_diff.json"] = canon.write_json(out / "on_off_diff.json", diff)
    canon.write_json(out / "HASHES.json", {"schema": "bp-oem-hashes-v1", "files": dict(sorted(hashes.items())),
                                           "inputs": {"envelope.sha256": report["envelope_sha256"], "seam.sha256": report["seam"]["seam_sha256"],
                                                      "engine_base.sha256": report["seam"]["engine_base_sha256"]}})
    canon.write_text(out / "SHA256SUMS.txt", "".join(f"{sha}  {name}\n" for name, sha in sorted(hashes.items())))
    for mode in ("off", "on"):
        for a in report[mode]["artifacts"]:
            print(f"{mode.upper():3s} {a['status']:24s} {a['file']}" + (f"  ({a['reason']})" if a.get("reason") else ""))
    if report["on_vs_off"]:
        print("ON vs OFF:", json.dumps({"result": report["on_vs_off"]["result"], "changed_sources": report["on_vs_off"]["sources"]["changed"],
                                        "counts": report["on_vs_off"]["counts_by_change"], "violations": report["on_vs_off"]["violations"]}))
    print(f"STAGE C REPLAY {report['result']} (OFF {report['off']['result']}, ON inputs {report['on']['result']}, original tree unchanged: "
          f"{report['original_tree_unchanged']})")
    return 0 if report["result"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
