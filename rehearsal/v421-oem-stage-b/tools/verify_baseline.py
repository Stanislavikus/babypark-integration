#!/usr/bin/env python3
"""S0 baseline digest verifier: proves the corrected-generation T2 baseline is the accepted one. READ-ONLY.

    python3 tools/verify_baseline.py --input-dir <INPUT> --output-dir <OUTPUT> [--campaign-dir <REBUILD>] [--json out.json]

Pins (data/baseline_pins.json; values from the Stage B lock): accepted manifest SHA-256, fresh source rows SHA-256
(accepted in either the gzip or the decompressed form; the report says which one matched), 28,769 catalog rows (unique NIDs),
8,129 manifest sources, generation id, 1,832 stroller + 42 seat links (1,874; from the metrics ``scope_counts`` and cross-checked
against the manifest edge total), the capture digest recorded by run_fresh_t2.py, and "not the older 28,011/8,471 generation".
Every input is opened read-only and its size/mtime is compared before and after. Exit code 0 only when every check is PASS.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PINS = ROOT / "data" / "baseline_pins.json"
ROWS_FILE, MANIFEST_FILE, EVIDENCE_FILE, METRICS_FILE = ("fresh_current_catalog_records.jsonl.gz", "t2_v421_manifest.json",
                                                         "t2_v421_evidence.json", "t2_v421_metrics.json")
METADATA_FILE = "fresh_t2_run_metadata.json"


def _sha(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _stat(path: Path) -> tuple:
    st = os.stat(path)
    return (st.st_size, st.st_mtime_ns)


def _check(name, expected, observed, ok=None, note="") -> dict:
    status = "PASS" if (observed == expected if ok is None else ok) else "FAIL"
    return {"check": name, "status": status, "expected": expected, "observed": observed, "note": note}


def verify(input_dir, output_dir, pins: dict, campaign_dir=None) -> dict:
    input_dir, output_dir = Path(input_dir), Path(output_dir)
    files = {"rows": input_dir / ROWS_FILE, "manifest": output_dir / MANIFEST_FILE, "evidence": output_dir / EVIDENCE_FILE,
             "metrics": output_dir / METRICS_FILE}
    if campaign_dir is not None:
        files["metadata"] = Path(campaign_dir) / METADATA_FILE
    checks, missing = [], [k for k, p in files.items() if not p.is_file()]
    for key in missing:
        checks.append({"check": f"file_present:{key}", "status": "FAIL", "expected": "present", "observed": "MISSING",
                       "note": str(files[key].name)})
    present = {k: p for k, p in files.items() if p.is_file()}
    before = {k: _stat(p) for k, p in present.items()}
    digests = {k: _sha(p) for k, p in present.items()}

    if "manifest" in present:
        manifest = json.loads(present["manifest"].read_text(encoding="utf-8"))
        sources = manifest.get("sources", {})
        edges = sum(len(s.get("accessories", [])) for s in sources.values())
        checks += [
            _check("manifest_sha256", pins["accepted_manifest_sha256"], digests["manifest"]),
            _check("generation_id", pins["generation_id"], manifest.get("generation_id")),
            _check("manifest_schema", pins["manifest_schema"], manifest.get("schema")),
            _check("manifest_sources", pins["manifest_sources"], len(sources)),
            _check("manifest_accessory_edges_total", pins["links"]["total"], edges),
            _check("not_the_older_generation:sources", f"!= {pins['not_this_generation']['manifest_sources']}", len(sources),
                   ok=len(sources) != pins["not_this_generation"]["manifest_sources"]),
        ]
    else:
        edges = None
    if "evidence" in present:
        evidence = json.loads(present["evidence"].read_text(encoding="utf-8"))
        checks.append(_check("evidence_schema", pins["evidence_schema"], evidence.get("schema")))
        if "manifest" in present:
            checks.append(_check("evidence_sources_match_manifest", len(sources), len(evidence.get("sources", {}))))
    if "rows" in present:
        raw_sha = hashlib.sha256()
        count, seen, duplicates = 0, set(), 0
        with gzip.open(present["rows"], "rb") as handle:
            for line in handle:
                raw_sha.update(line)
                if line.strip():
                    count += 1
                    nid = json.loads(line)["nid"]
                    duplicates += nid in seen
                    seen.add(nid)
        raw = raw_sha.hexdigest()
        matched = "gzip" if digests["rows"] == pins["fresh_source_rows_sha256"] else (
            "raw" if raw == pins["fresh_source_rows_sha256"] else None)
        checks += [
            _check("fresh_source_rows_sha256", pins["fresh_source_rows_sha256"], matched or {"gzip": digests["rows"], "raw": raw},
                   ok=matched is not None, note=f"matched form: {matched}" if matched else "neither gzip nor raw form matches"),
            _check("catalog_rows", pins["catalog_rows"], count),
            _check("catalog_nids_unique", 0, duplicates),
            _check("not_the_older_generation:rows", f"!= {pins['not_this_generation']['catalog_rows']}", count,
                   ok=count != pins["not_this_generation"]["catalog_rows"]),
        ]
    if "metrics" in present:
        metrics = json.loads(present["metrics"].read_text(encoding="utf-8"))
        by_head: dict = {}
        for item in metrics.get("scope_counts", []):
            if str(item.get("metric", "")).endswith("_edges"):
                by_head[item["head"]] = by_head.get(item["head"], 0) + int(item["value"])
        want = {k: v for k, v in pins["links"].items() if k != "total"}
        checks += [
            _check("links_by_source_head", want, {k: by_head.get(k, 0) for k in want}),
            _check("metrics_edges_match_manifest_total", edges, sum(by_head.values()), ok=edges is not None and edges == sum(by_head.values()),
                   note="sum of scope_counts *_edges vs manifest accessory total"),
        ]
    if "metadata" in present:
        meta = json.loads(present["metadata"].read_text(encoding="utf-8"))
        checks += [_check("capture_sha256", pins["capture_sha256"], meta.get("capture_sha256")),
                   _check("fresh_catalog_rows_in_metadata", pins["catalog_rows"], meta.get("fresh_catalog_rows"))]
    after = {k: _stat(p) for k, p in present.items()}
    checks.append(_check("inputs_not_modified_while_verifying", "unchanged", "unchanged" if before == after else "CHANGED"))
    ok = all(c["status"] == "PASS" for c in checks)
    return {"schema": "bp-oem-baseline-verification-v1", "result": "PASS" if ok else "FAIL",
            "files": {k: {"name": p.name, "sha256": digests[k], "bytes": before[k][0]} for k, p in sorted(present.items())},
            "checks": checks, "read_only": True}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input-dir", required=True, help="campaign input/ (fresh_current_catalog_records.jsonl.gz)")
    ap.add_argument("--output-dir", required=True, help="campaign output/ (t2_v421_manifest/evidence/metrics.json)")
    ap.add_argument("--campaign-dir", default=None, help="campaign root (fresh_t2_run_metadata.json); optional")
    ap.add_argument("--pins", default=str(DEFAULT_PINS))
    ap.add_argument("--json", default=None, help="write the report here (deterministic)")
    args = ap.parse_args(argv)
    pins = json.loads(Path(args.pins).read_text(encoding="utf-8"))
    report = verify(args.input_dir, args.output_dir, pins, args.campaign_dir)
    text = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if args.json:
        Path(args.json).write_text(text, encoding="utf-8", newline="\n")
    for c in report["checks"]:
        print(f"{c['status']:4s} {c['check']}")
    print(f"BASELINE {report['result']}")
    return 0 if report["result"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
