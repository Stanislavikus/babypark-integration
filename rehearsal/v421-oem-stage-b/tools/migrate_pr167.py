#!/usr/bin/env python3
"""Deterministic PR #167 -> Stage B seed conversion (all PROPOSED; nothing VERIFIED).

    BP_V421_ENGINE_ROOT=<engine_root> python3 tools/migrate_pr167.py [--pr167-root DIR] [--out data/seeds]

Reads the four PR #167 source files (committed unchanged under data/seeds/pr167_source/) and the hand-written
seed tables in data/seeds/, uses the *real* ``canonical_models.extract`` to record the catalog-side model
string of every seed row, and writes typed seed data plus SEEDS_MANIFEST.json (SHA-256 of every output).
"""
from __future__ import annotations

import argparse
import csv
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from oem_stage import canon, engine_env, seed_convert  # noqa: E402

PR167_HEAD = "706f292c419cac7ec88b68a1393259dc3af8e402"
SOURCE_FILES = ("manufacturer_fitment_evidence_v42.json", "OEM_VERIFIED_MISSED_PAIRS.csv",
                "NEGATIVE_AND_CONDITIONAL_CONTROLS.csv", "HOLDOUT_RESULTS.csv")


def read_csv(path):
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pr167-root", default=str(ROOT / "data/seeds/pr167_source"))
    ap.add_argument("--out", default=str(ROOT / "data/seeds"))
    args = ap.parse_args(argv)
    src, out = Path(args.pr167_root), Path(args.out)
    kept = out / "pr167_source"
    if src.resolve() != kept.resolve():
        kept.mkdir(parents=True, exist_ok=True)
        for name in SOURCE_FILES:
            shutil.copyfile(src / name, kept / name)
    canon.write_json(kept / "PROVENANCE.json", {
        "files": {n: canon.file_sha256(kept / n) for n in SOURCE_FILES},
        "note": "Unchanged copies of the PR #167 evidence file and fixtures, used as historical seed/fixture sources only. "
                "PR #167 is an unmerged experimental source and is not merged by Stage B.",
        "pr167_head": PR167_HEAD, "schema": "bp-oem-seed-provenance-v1"})
    evidence = json.loads((kept / SOURCE_FILES[0]).read_text(encoding="utf-8"))
    positives = read_csv(kept / SOURCE_FILES[1])
    controls = read_csv(kept / SOURCE_FILES[2])
    holdouts = read_csv(kept / SOURCE_FILES[3])
    tables = {n: json.loads((out / f"{n}.json").read_text(encoding="utf-8"))
              for n in ("model_maker_hints", "typed_conditions", "supplement_claims", "alias_seeds",
                        "holdout_endpoints")}
    data = seed_convert.build_seed_data(evidence, positives, holdouts, controls, tables["model_maker_hints"],
                                        tables["typed_conditions"], tables["supplement_claims"],
                                        tables["alias_seeds"])
    root = engine_env.prepare_sys_path()
    import canonical_models as cm  # noqa: E402  (real V4.2.1 identity extractor, read-only)

    brand_to_maker = {b: m["maker_id"] for m in data["makers"] for b in m["catalog_brands"]}

    def src_block(row, prefix="source"):
        title, brand = row[f"{prefix}_title"], row[f"{prefix}_brand"]
        ident = cm.extract(title, brand)
        return {"nid": int(row[f"{prefix}_nid"]), "tnid": int(row[f"{prefix}_tnid"]), "sku": row[f"{prefix}_sku"],
                "title": title, "brand": brand, "maker_id": brand_to_maker.get(brand),
                "catalog_model_string": ident.model, "extract_status": ident.status}

    cases_pos = []
    for row in positives:
        cases_pos.append({
            "case_id": f"{row['group_id'][:3]}:{row['source_nid']}:{row['source_lang']}", "group_id": row["group_id"],
            "lang": row["source_lang"], "source": src_block(row),
            "target": {"nid": int(row["target_nid"]), "tnid": int(row["target_tnid"]), "sku": row["target_sku_catalog"],
                       "oem_base_sku": row["target_sku_oem_base"], "title": row["target_title"],
                       "role": row["target_role"], "field_status": int(row["target_field_status"]),
                       "published": int(row["target_published"]), "price": float(row["target_price"])},
            "oem_compatible_model": row["oem_compatible_model"],
            "pr167": {"already_in_corrected_AB": row["already_in_corrected_AB"], "manual_T1_pair": row["manual_T1_pair"],
                      "evidence_status": row["evidence_status"], "required_conditions": row["required_conditions"],
                      "stage1_new_pair_checked": row["stage1_new_pair_checked"],
                      "ready_for_publication": row["ready_for_publication"]}})
    ends = tables["holdout_endpoints"]["cases"]
    cases_hold, cases_norm, cases_cond = [], [], []
    for row in holdouts:
        prefix = row["case_id"].split("_")[0]
        pr = {k: row[k] for k in ("expected_oem_state", "shadow_output", "counterfactual_current_t2", "test_result",
                                  "stage1_status", "rejection_reason", "accessory_field_status", "rule")}
        if prefix in ends:
            seat_maker = ends[prefix]["seat"][0] if "seat" in ends[prefix] else ends[prefix]["model"][0]
            seat_brands = next(m["catalog_brands"] for m in data["makers"] if m["maker_id"] == seat_maker)
            ident = cm.extract(row["source_model"], seat_brands[0] if seat_brands else "")
            cases_hold.append({"case_id": row["case_id"], "prefix": prefix, "endpoints": ends[prefix],
                               "source_brand_assumed": seat_brands[0] if seat_brands else None,
                               "source_catalog_model_string": ident.model, "source_extract_status": ident.status,
                               "source_title": row["source_model"],
                               "source_nids": {"ru": int(row["source_nid_ru"]), "uk": int(row["source_nid_uk"])},
                               "source_tnid": int(row["source_tnid"]), "accessory_sku": row["accessory_sku_catalog"],
                               "accessory_nids": {"ru": int(row["accessory_target_nid_ru"]),
                                                  "uk": int(row["accessory_target_nid_uk"])},
                               "pr167": pr})
        elif prefix.startswith("M"):
            cases_norm.append({"case_id": row["case_id"], "source_model": row["source_model"], "pr167": pr})
        elif prefix.startswith("C"):
            cases_cond.append({"case_id": row["case_id"], "pr167": pr})
    seeds = {"seed_cases": {"schema": "bp-oem-seed-cases-v1", "positives": cases_pos, "holdouts": cases_hold,
                            "controls": [dict(c) for c in controls], "normalization": cases_norm,
                            "condition_cases": cases_cond,
                            "engine_pins": engine_env.engine_pins(root)},
             "documents": {"schema": "bp-oem-documents-v1", "documents": data["documents"]},
             "claims": {"schema": "bp-oem-claims-v1", "claims": data["claims"]},
             "makers": {"schema": "bp-oem-makers-v1", "makers": data["makers"]},
             "models": {"schema": "bp-oem-models-v1", "models": data["models"]},
             "aliases": {"schema": "bp-oem-aliases-v1", "aliases": data["aliases"]},
             "articles": {"schema": "bp-oem-articles-v1", "bindings": data["bindings"], "unjoined": data["unjoined"]}}
    manifest = {}
    for name, obj in seeds.items():
        manifest[name + ".json"] = canon.write_json(out / f"{name}.json", obj)
    canon.write_json(out / "SEEDS_MANIFEST.json", {"files": manifest, "schema": "bp-oem-seeds-manifest-v1"})
    print(json.dumps({"claims": len(data["claims"]), "models": len(data["models"]), "documents": len(data["documents"]),
                      "bindings": len(data["bindings"]), "positives": len(cases_pos), "holdouts": len(cases_hold),
                      "manifest": manifest}, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
