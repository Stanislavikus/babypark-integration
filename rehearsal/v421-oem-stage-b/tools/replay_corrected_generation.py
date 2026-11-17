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
 * compares the six deterministic artifacts against the original campaign and always reports both raw SHA-256 values. Four of them
   (manifest, evidence, fresh catalog rows, v36 scope sources) must be byte-identical (``IDENTICAL``). The other two carry the engine's own
   wall-clock/RSS measurements, so a faithful replay can never be byte-identical there: the metrics JSON differs only in
   ``elapsed_seconds`` and the gzip v32 index JSON only in ``metrics.build_seconds`` and ``metrics.peak_rss_kib``. Those two files are
   compared as complete parsed objects EXCLUDING exactly those three keys (``SEMANTICALLY_IDENTICAL``; the measurement must exist on both
   sides as a plain number); every other difference - a value, a JSON type, a missing/extra key, a list order, any other timing-like key -
   is ``DIFFERENT`` and fails the replay. The whitelist is VOLATILE_FIELDS below and is printed in the report;
 * then runs the baseline verifier (tools/verify_baseline.py) on the new campaign against data/baseline_pins.json.
 * proves the original campaign was not written (size/mtime snapshot of its whole tree before and after). The real script imports
   the engine from an absolute path inside the ORIGINAL campaign (``ENGINE``), so the child runs with ``-B`` (no bytecode writes there).
Exit code 0 only when the script succeeded, every artifact is IDENTICAL or (for the two measurement-carrying files) SEMANTICALLY_IDENTICAL,
the original campaign is unchanged and the verifier passes.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import subprocess
import sys
import zlib
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import verify_baseline  # noqa: E402

REBUILD_LINE = re.compile(r"^REBUILD = .*$", re.MULTILINE)
LIVE_TRANSFER = Path("input/v36_live_transfer/live_v36_tree_sources.json.gz")
DETERMINISTIC = ("output/t2_v421_manifest.json", "output/t2_v421_evidence.json", "output/t2_v421_metrics.json",
                 "input/fresh_current_catalog_records.jsonl.gz", "input/fresh_v32_index.json.gz",
                 "input/fresh_v36_scope_sources.json")
# Wall-clock / resource measurements written by the engine itself into two of the six artifacts (observed by the independent Stage B
# rehearsal check). They are the ONLY values ignored: only inside these two files, and only when present on BOTH sides as plain numbers.
VOLATILE_FIELDS = {
    "output/t2_v421_metrics.json": (("elapsed_seconds",),),
    "input/fresh_v32_index.json.gz": (("metrics", "build_seconds"), ("metrics", "peak_rss_kib")),
}
ACCEPTED_STATUSES = ("IDENTICAL", "SEMANTICALLY_IDENTICAL")


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


class _Unreadable(ValueError):
    pass


def _load_json(path: Path):
    try:
        raw = path.read_bytes()
        if path.name.endswith(".gz"):
            raw = gzip.decompress(raw)
    except (OSError, EOFError, zlib.error):
        raise _Unreadable("cannot be read or decompressed") from None
    try:
        return json.loads(raw.decode("utf-8"))
    except ValueError:
        raise _Unreadable("is not valid JSON") from None


def _canonical(obj) -> str:
    """Canonical text of a parsed JSON value: object member order is not significant, but values, JSON types (1 vs 1.0 vs true),
    presence of keys and list order all are."""
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _strip_volatile(obj, paths) -> tuple:
    """Remove the whitelisted measurement values from the freshly parsed ``obj`` (owned by the caller, so edited in place).
    Returns (obj, {dotted path: value}, problems); a measurement that is missing or not a plain number is a problem, not an exclusion."""
    values, problems = {}, []
    for path in paths:
        dotted, node = ".".join(path), obj
        for key in path[:-1]:
            node = node.get(key) if isinstance(node, dict) else None
        if not isinstance(node, dict) or path[-1] not in node:
            problems.append(f"{dotted} is missing")
            continue
        value = node[path[-1]]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            problems.append(f"{dotted} is not a plain number")
            continue
        values[dotted] = value
        del node[path[-1]]
    return obj, values, problems


def _differences(a, b, path="$", out=None, limit=8) -> list:
    out = [] if out is None else out
    if len(out) >= limit:
        return out
    if type(a) is not type(b):
        out.append(f"{path}: JSON type {type(a).__name__} != {type(b).__name__}")
    elif isinstance(a, dict):
        for key in sorted(set(a) | set(b)):
            if key not in a:
                out.append(f"{path}.{key}: only in the replay")
            elif key not in b:
                out.append(f"{path}.{key}: only in the original")
            else:
                _differences(a[key], b[key], f"{path}.{key}", out, limit)
    elif isinstance(a, list):
        if len(a) != len(b):
            out.append(f"{path}: list length {len(a)} != {len(b)}")
        for index, (x, y) in enumerate(zip(a, b)):
            _differences(x, y, f"{path}[{index}]", out, limit)
    elif a != b:
        out.append(f"{path}: {str(a)[:60]!r} != {str(b)[:60]!r}")
    return out[:limit]


def _semantic_comparison(original_file: Path, replay_file: Path, paths) -> dict:
    views, volatile, problems = {}, {}, []
    for side, path in (("original", original_file), ("replay", replay_file)):
        try:
            obj = _load_json(path)
        except _Unreadable as exc:
            return {"status": "DIFFERENT", "reason": f"the {side} file {exc}"}
        views[side], volatile[side], issues = _strip_volatile(obj, paths)
        problems += [f"{side}: {issue}" for issue in issues]
    if problems:
        return {"status": "DIFFERENT", "reason": "whitelisted measurement unusable (" + "; ".join(problems) + ")"}
    canon = {side: _canonical(view) for side, view in views.items()}
    semantic = {"volatile_paths": [".".join(path) for path in paths],
                "original_semantic_sha256": hashlib.sha256(canon["original"].encode("utf-8")).hexdigest(),
                "replay_semantic_sha256": hashlib.sha256(canon["replay"].encode("utf-8")).hexdigest(),
                "volatile_values": {key: {"original": volatile["original"][key], "replay": volatile["replay"][key]}
                                    for key in sorted(volatile["original"])}}
    if canon["original"] == canon["replay"]:
        return {"status": "SEMANTICALLY_IDENTICAL", "semantic": semantic}
    found = _differences(views["original"], views["replay"])
    return {"status": "DIFFERENT", "semantic": semantic,
            "reason": "content other than the whitelisted measurements differs: " + ("; ".join(found) or "see the semantic hashes")}


def compare_artifact(original_root, replay_root, rel: str) -> dict:
    """Compare one deterministic artifact. Raw SHA-256 values are always reported. Identical bytes are IDENTICAL; different bytes are
    DIFFERENT unless the file is in VOLATILE_FIELDS and its parsed content is equal once exactly those measurements are excluded."""
    original_file, replay_file = Path(original_root) / rel, Path(replay_root) / rel
    row = {"file": rel, "original_sha256": sha256(original_file) if original_file.is_file() else None,
           "replay_sha256": sha256(replay_file) if replay_file.is_file() else None}
    if row["original_sha256"] is None:
        row["status"] = "ORIGINAL_MISSING"
    elif row["replay_sha256"] is None:
        row["status"] = "REPLAY_MISSING"
    elif row["original_sha256"] == row["replay_sha256"]:
        row["status"] = "IDENTICAL"
    elif rel not in VOLATILE_FIELDS:
        row.update(status="DIFFERENT", reason="bytes differ and this file has no volatile fields: byte equality is required")
    else:
        row.update(_semantic_comparison(original_file, replay_file, VOLATILE_FIELDS[rel]))
    return row


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
    artifacts = [compare_artifact(original, new, rel) for rel in DETERMINISTIC]
    after = tree_snapshot(original)
    verification = (verify_baseline.verify(new / "input", new / "output", pins, new) if run_verifier and proc.returncode == 0
                    else None)
    ok = (proc.returncode == 0 and all(a["status"] in ACCEPTED_STATUSES for a in artifacts) and before == after
          and (verification is None or verification["result"] == "PASS") and len(changed) == 1)
    return {"schema": "bp-oem-replay-report-v1", "result": "PASS" if ok else "FAIL", "script_exit_code": proc.returncode,
            "patched_lines": len(changed), "original_tree_unchanged": before == after, "original_files_snapshotted": len(before),
            "artifacts": artifacts, "artifact_status_counts": dict(sorted(Counter(a["status"] for a in artifacts).items())),
            "volatile_field_whitelist": {rel: [".".join(path) for path in paths] for rel, paths in sorted(VOLATILE_FIELDS.items())},
            "baseline_verification": verification,
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
        print(f"{a['status']:24s} {a['file']}" + (f"  ({a['reason']})" if a.get("reason") else ""))
    print(f"REPLAY {report['result']} (script exit {report['script_exit_code']}, original tree unchanged: {report['original_tree_unchanged']})")
    return 0 if report["result"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
