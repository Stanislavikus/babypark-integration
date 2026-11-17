#!/usr/bin/env python3
"""S0 reproducible corrected-generation runner: replay run_fresh_t2.py in a NEW campaign directory and compare digests.

REHEARSAL-ONLY command (needs the capture inputs and the engine that only exist on the rehearsal host):

    python3 tools/replay_corrected_generation.py \\
        --script <path to the accepted run_fresh_t2.py> \\
        --original-campaign /opt/bp-v421-v36-full-category-decision-20261115/car_seat_correction_20261117 \\
        --new-campaign /opt/bp-v421-v36-full-category-decision-20261115/stage_b_replay_20261117 \\
        --json replay_report.json

What it does (and only this):
 * refuses if the new campaign exists and is non-empty, equals, contains or is contained in the original campaign;
 * writes a patched COPY of the script into the new campaign in which exactly ONE line differs: ``REBUILD = ...``
   (the script's INPUT/OUT derive from REBUILD; its capture and engine paths are read-only inputs; run_fresh_t2.py itself
   refuses to overwrite existing files, which is why a new campaign directory is required);
 * copies the one input that lives inside the original campaign (``input/v36_live_transfer/live_v36_tree_sources.json.gz``)
   into the new one (read-only copy, SHA-256 checked) and runs the patched script;
 * compares the six deterministic artifacts byte-for-byte (SHA-256) against the original campaign, then runs the baseline
   verifier (tools/verify_baseline.py) on the new campaign against data/baseline_pins.json.
 * proves the original campaign was not written (size/mtime snapshot of its whole tree before and after). The real script imports
   the engine from an absolute path inside the ORIGINAL campaign (``ENGINE``), so the child runs with ``-B`` (no bytecode writes there).
Exit code 0 only when the script succeeded, every artifact is identical to the accepted one and the verifier passes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import verify_baseline  # noqa: E402

REBUILD_LINE = re.compile(r"^REBUILD = .*$", re.MULTILINE)
LIVE_TRANSFER = Path("input/v36_live_transfer/live_v36_tree_sources.json.gz")
DETERMINISTIC = ("output/t2_v421_manifest.json", "output/t2_v421_evidence.json", "output/t2_v421_metrics.json",
                 "input/fresh_current_catalog_records.jsonl.gz", "input/fresh_v32_index.json.gz",
                 "input/fresh_v36_scope_sources.json")


class ReplayRefused(RuntimeError):
    pass


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def patch_script(text: str, new_campaign: Path) -> str:
    """Replace the single ``REBUILD = ...`` line; anything else is refused (never a silent multi-line patch)."""
    matches = REBUILD_LINE.findall(text)
    if len(matches) != 1:
        raise ReplayRefused(f"expected exactly one 'REBUILD = ...' line in the script, found {len(matches)}")
    return REBUILD_LINE.sub(lambda _m: f"REBUILD = Path({str(new_campaign)!r})", text, count=1)


def tree_snapshot(root: Path) -> dict:
    snap = {}
    for dirpath, _dirs, names in os.walk(root):
        for name in names:
            p = Path(dirpath) / name
            try:
                st = p.lstat()
            except OSError:
                continue
            snap[str(p.relative_to(root))] = (st.st_size, st.st_mtime_ns)
    return snap


def check_paths(original: Path, new: Path) -> None:
    if new == original or original in new.parents or new in original.parents:
        raise ReplayRefused("the new campaign must be a separate directory outside the original campaign")
    if new.exists() and any(new.iterdir()):
        raise ReplayRefused("the new campaign directory must not exist or must be empty (run_fresh_t2.py never overwrites)")


def replay(script, original_campaign, new_campaign, pins, *, python=sys.executable, run_verifier=True) -> dict:
    script, original, new = Path(script), Path(original_campaign).resolve(), Path(new_campaign).resolve()
    check_paths(original, new)
    source = script.read_text(encoding="utf-8")
    patched_text = patch_script(source, new)
    changed = [i for i, (a, b) in enumerate(zip(source.splitlines(), patched_text.splitlines())) if a != b]
    live_src = original / LIVE_TRANSFER
    if not live_src.is_file():
        raise ReplayRefused(f"original campaign lacks {LIVE_TRANSFER}")
    before = tree_snapshot(original)
    new.mkdir(mode=0o700, parents=True, exist_ok=True)
    live_dst = new / LIVE_TRANSFER
    live_dst.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    data = live_src.read_bytes()
    live_dst.write_bytes(data)
    os.chmod(live_dst, 0o400)
    if sha256(live_dst) != hashlib.sha256(data).hexdigest():
        raise ReplayRefused("copied live transfer does not match its source")
    patched = new / "replay_run_fresh_t2.py"
    patched.write_text(patched_text, encoding="utf-8", newline="\n")
    # -B: run_fresh_t2.py imports the engine from a literal path INSIDE the original campaign; never write bytecode there
    proc = subprocess.run([python, "-I", "-B", str(patched)], cwd=str(new), capture_output=True, text=True)
    events = []
    for line in proc.stdout.splitlines():
        try:
            events.append(json.loads(line))
        except ValueError:
            continue
    artifacts = []
    for rel in DETERMINISTIC:
        a, b = original / rel, new / rel
        row = {"file": rel, "original_sha256": sha256(a) if a.is_file() else None, "replay_sha256": sha256(b) if b.is_file() else None}
        row["status"] = ("IDENTICAL" if row["original_sha256"] and row["original_sha256"] == row["replay_sha256"]
                         else "ORIGINAL_MISSING" if row["original_sha256"] is None else "REPLAY_MISSING"
                         if row["replay_sha256"] is None else "DIFFERENT")
        artifacts.append(row)
    after = tree_snapshot(original)
    verification = (verify_baseline.verify(new / "input", new / "output", pins, new) if run_verifier and proc.returncode == 0
                    else None)
    ok = (proc.returncode == 0 and all(a["status"] == "IDENTICAL" for a in artifacts) and before == after
          and (verification is None or verification["result"] == "PASS") and len(changed) == 1)
    return {"schema": "bp-oem-replay-report-v1", "result": "PASS" if ok else "FAIL", "script_exit_code": proc.returncode,
            "patched_lines": len(changed), "original_tree_unchanged": before == after, "original_files_snapshotted": len(before),
            "artifacts": artifacts, "baseline_verification": verification,
            "final_event": events[-1] if events else None,
            "script_stderr_tail": proc.stderr[-1500:] if proc.returncode else ""}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--script", required=True)
    ap.add_argument("--original-campaign", required=True)
    ap.add_argument("--new-campaign", required=True)
    ap.add_argument("--pins", default=str(verify_baseline.DEFAULT_PINS))
    ap.add_argument("--json", default=None)
    ap.add_argument("--no-verify", action="store_true")
    args = ap.parse_args(argv)
    pins = json.loads(Path(args.pins).read_text(encoding="utf-8"))
    try:
        report = replay(args.script, args.original_campaign, args.new_campaign, pins, run_verifier=not args.no_verify)
    except ReplayRefused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2
    text = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if args.json:
        Path(args.json).write_text(text, encoding="utf-8", newline="\n")
    for a in report["artifacts"]:
        print(f"{a['status']:16s} {a['file']}")
    print(f"REPLAY {report['result']} (script exit {report['script_exit_code']}, original tree unchanged: {report['original_tree_unchanged']})")
    return 0 if report["result"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
