#!/usr/bin/env python3
"""Build the Stage B shadow artifacts (read-only with respect to the V4.2.1 engine, catalog and production).

Seed/fixture mode (no catalog supplied):
    BP_V421_ENGINE_ROOT=<engine_root> python3 tools/build_outputs.py --as-of 2026-11-17 --out out

Rehearsal mode (corrected generation; inputs are only READ):
    python3 tools/build_outputs.py --as-of 2026-11-17 --out out_rehearsal \\
        --rows <INPUT>/fresh_current_catalog_records.jsonl.gz --index <INPUT>/fresh_v32_index.json.gz \\
        --manifest <OUTPUT>/t2_v421_manifest.json --evidence <OUTPUT>/t2_v421_evidence.json

Outputs: oem_relations.json, oem_vs_current_report.json, claim_status_matrix.json, review_queue.json,
HASHES.json, SHA256SUMS.txt. Same inputs => byte-identical outputs (no clock, no absolute paths).
"""
from __future__ import annotations

import argparse
import gzip
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from oem_stage import canon, engine_env, outputs, shadow, world as W  # noqa: E402
from oem_stage import classify as cls  # noqa: E402
from oem_stage.o4_relations import summarize  # noqa: E402


def read_rows(path) -> dict:
    """Corrected-generation rows (gzip JSON lines keyed by NID); a duplicate NID is an error."""
    rows = {}
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            nid = int(row["nid"])
            if nid in rows:
                raise ValueError(f"duplicate catalog NID {nid}")
            rows[nid] = row
    return rows


def load_index(path):
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def parse_args(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", default=str(W.SEEDS), help="typed data directory (default: data/seeds)")
    ap.add_argument("--out", default=str(ROOT / "out"))
    ap.add_argument("--as-of", required=True, help="policy date YYYY-MM-DD (explicit; the wall clock is never used)")
    ap.add_argument("--blob-root", default=None, help="content-addressed OEM byte store (isolated rehearsal folder)")
    ap.add_argument("--allow-synthetic", action="store_true", help="accept synthetic fixtures (tests/demo only)")
    ap.add_argument("--ttl-days", type=int, default=None, help="evidence TTL; unset = staleness is only reported")
    ap.add_argument("--allow-list", default=None, help="JSON list of {issuer, markets[], languages[]} (OD6)")
    ap.add_argument("--label", default=None, help="file-name label, e.g. synthetic_demo")
    ap.add_argument("--rows", default=None, help="corrected-generation catalog rows (jsonl.gz)")
    ap.add_argument("--index", default=None, help="fresh_v32_index.json.gz (else rebuilt with the real v32.build_indexes)")
    ap.add_argument("--manifest", default=None, help="t2_v421_manifest.json of the current V4.2.1 output")
    ap.add_argument("--evidence", default=None, help="t2_v421_evidence.json of the current V4.2.1 output")
    ap.add_argument("--baseline-report", default=None, help="JSON written by tools/verify_baseline.py (embedded)")
    ap.add_argument("--no-engine", action="store_true", help="do not import the V4.2.1 engine (no pins/collisions)")
    return ap.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    data_dir = Path(args.data_dir)
    policy = {"as_of": args.as_of, "allow_synthetic": args.allow_synthetic, "ttl_days": args.ttl_days}
    if args.allow_list:
        policy["publish_allow_list"] = canon.load_json(args.allow_list)
    engine = None
    if not args.no_engine or args.rows:
        engine = engine_env.prepare_sys_path()
    rows = index = None
    if args.rows:
        rows = read_rows(args.rows)
    w = W.load_world(data_dir, policy=policy, blob_root=args.blob_root,
                     catalog_skus=None if rows is None else {str(r.get("sku")) for r in rows.values()})
    relations = w.derive()
    inputs = dict(w.digests)

    # ----- catalog side + current side
    seed_path = data_dir / "seed_cases.json"
    seed_cases = canon.load_json(seed_path) if seed_path.is_file() else None
    if rows is not None:
        import v32_pipeline as v32  # real V4.2.1 index builder (read-only)
        index = load_index(args.index) if args.index else v32.build_indexes(rows)
        view = shadow.CatalogView.from_engine(rows, index, w.registry)
        catalog_side = {"kind": "rehearsal_rows", "rows": len(rows), "source_groups": len(index["source_models"]),
                        "rows_sha256": canon.file_sha256(args.rows),
                        "index": "loaded" if args.index else "rebuilt_with_real_v32_build_indexes"}
        inputs["catalog_rows.jsonl.gz"] = catalog_side["rows_sha256"]
        if args.index:
            inputs["v32_index.json.gz"] = canon.file_sha256(args.index)
    else:
        catalog_side = {"kind": "seed_fixture", "note": "PR #167 fixture NIDs/SKUs only; no full catalog supplied"}
        if seed_cases is None:
            view = shadow.CatalogView()
        else:
            view, _ = cls.build_seed_view(seed_cases, w.registry)
    if args.manifest and args.evidence:
        manifest, evidence = canon.load_json(args.manifest), canon.load_json(args.evidence)
        current = shadow.ManifestCurrent(manifest["sources"], evidence["sources"])
        edges = sum(len(s.get("accessories", [])) for s in manifest["sources"].values())
        current_side = {"kind": current.kind, "generation_id": manifest.get("generation_id"),
                        "manifest_schema": manifest.get("schema"), "manifest_sources": len(manifest["sources"]),
                        "manifest_accessory_edges": edges, "manifest_sha256": canon.file_sha256(args.manifest),
                        "evidence_sha256": canon.file_sha256(args.evidence)}
        inputs["t2_manifest.json"], inputs["t2_evidence.json"] = (current_side["manifest_sha256"],
                                                                  current_side["evidence_sha256"])
    elif args.manifest or args.evidence:
        raise SystemExit("--manifest and --evidence must be given together")
    else:
        current = shadow.NoCurrent()
        current_side = {"kind": current.kind, "reason": "no corrected-generation manifest/evidence supplied"}

    pins = collisions = key_fn = None
    if engine is not None:
        pins = engine_env.engine_pins(engine)
        import canonical_models as cm  # real V4.2.1 identity key: used for collision reporting only
        key_fn = cm.key
        collisions = w.registry.collisions(cm.key)
        inputs.update({"engine:" + k: v for k, v in pins.items()})

    comparison = shadow.compare(relations, view, current)
    gap = shadow.stage1_gap(relations, view)
    classification = fixture_check = None
    if seed_cases is not None:
        _, groups = cls.build_seed_view(seed_cases, w.registry)
        pairs = {(int(c["source"]["nid"]), int(c["target"]["nid"])): current.pair(c["source"]["nid"], c["target"]["nid"])
                 for c in (_p for _p in [{"source": p["source"], "target": p["target"]} for p in seed_cases["positives"]])}
        classification = outputs.classification_doc(
            w, relations, seed_cases, canon.load_json(data_dir / "holdout_endpoints.json"),
            canon.load_json(data_dir / "condition_vectors.json"), canon.load_json(data_dir / "typed_conditions.json"),
            pairs, groups, key_fn)
        if rows is not None:
            fixture_check = outputs.fixture_vs_catalog(seed_cases, rows)
    baseline = canon.load_json(args.baseline_report) if args.baseline_report else None
    docs = {
        "oem_relations": outputs.relations_doc(w, relations, engine_pins=pins, collisions=collisions, label=args.label),
        "oem_vs_current_report": outputs.report_doc(
            w, relations, comparison, gap, classification or {"counts": None}, current_side=current_side,
            catalog_side=catalog_side, baseline=baseline, fixture_check=fixture_check, label=args.label),
        "claim_status_matrix": outputs.claim_matrix_doc(w, relations),
    }
    docs["review_queue"] = outputs.review_queue_doc(w, relations, classification or {"locale_cases": []}, collisions)
    out_dir = Path(args.out)
    file_hashes = outputs.write_outputs(out_dir, docs, args.label)
    hashes = outputs.hashes_doc(file_hashes, inputs)
    suffix = f".{args.label}" if args.label else ""
    canon.write_json(out_dir / f"HASHES{suffix}.json", hashes)
    canon.write_text(out_dir / f"SHA256SUMS{suffix}.txt",
                     "".join(f"{sha}  {name}\n" for name, sha in sorted(file_hashes.items())))
    print(json.dumps({"out": str(out_dir), "synthetic": docs["oem_relations"]["synthetic"], "summary": summarize(relations),
                      "pair_counts": comparison["pair_counts"], "files": file_hashes,
                      "classification": None if classification is None else classification["counts"]},
                     ensure_ascii=False, indent=1, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
