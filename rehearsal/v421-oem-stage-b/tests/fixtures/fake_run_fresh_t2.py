#!/usr/bin/env python3
"""TEST DOUBLE of the *structure* of run_fresh_t2.py (same REBUILD/INPUT/OUT derivation, same never-overwrite writers,
same deterministic gzip/JSON writers, same output names) and of the SHAPES the real corrected generation has:

* the manifest lists every source, but only some have accessories;
* the evidence is SPARSE: it has an entry only for sources that have accessories;
* the metrics ``scope_counts`` carry ``sources`` / ``eligible_sources`` / ``sources_with_T2`` / ``T2_edges`` / ``A_edges`` / ``B_edges``
  per (head, lang), so ``A_edges + B_edges == T2_edges`` and summing every ``*_edges`` metric double counts;
* wall-clock/volatile fields exist exactly where the real files have them: ``elapsed_seconds`` in the metrics and
  ``metrics.build_seconds`` / ``metrics.peak_rss_kib`` in the v32 index. Here they derive from ``FAKE_VOLATILE`` so a test can make two runs differ.

It computes tiny fake artifacts from the live-transfer input. It exists only to test tools/verify_baseline.py and
tools/replay_corrected_generation.py without the rehearsal host; it is not the real runner."""
import gzip, json, os, sys
from collections import Counter
from pathlib import Path

BASE = Path(os.environ["FAKE_CAMPAIGN_BASE"])
REBUILD = BASE / "car_seat_correction_20261117"
# like the real script's ENGINE: a literal path inside the ORIGINAL campaign, not derived from REBUILD
sys.path.insert(0, str(BASE / "car_seat_correction_20261117" / "engine_root" / "work" / "accessories" / "src"))
import fake_engine_mod  # noqa: E402,F401
INPUT = REBUILD / "input"
OUT = REBUILD / "output"
for d in (INPUT, OUT):
    d.mkdir(mode=0o700, parents=True, exist_ok=True)


def write_json_new(path, value):
    if path.exists():
        raise FileExistsError(str(path))
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")


def write_gzip_new(path, raw):
    if path.exists():
        raise FileExistsError(str(path))
    with open(path, "wb") as f:
        with gzip.GzipFile(fileobj=f, mode="wb", mtime=0, compresslevel=6) as gz:
            gz.write(raw)


live = json.loads(gzip.open(INPUT / "v36_live_transfer" / "live_v36_tree_sources.json.gz", "rt", encoding="utf-8").read())
ids = sorted(live["ids"])
variant = os.environ.get("FAKE_VARIANT", "")
vol = float(os.environ.get("FAKE_VOLATILE", "1"))


def head(i):
    return "stroller" if i <= 30 else "car_seat"


def lang(i):
    return "ru" if i % 2 == 0 else "uk"


def tier(i):
    return "A_model" if i % 4 == 1 else "B_universal"


sources = {str(i): {"language": lang(i), "similar": [], "accessories": [i + 1000] if i % 2 else []} for i in ids}
evidence_sources = {str(i): {"targets": {str(i + 1000): {"tier": tier(i), "reason": "accepted_model_title" if tier(i) == "A_model" else "universal"}}}
                    for i in ids if i % 2}
counts = Counter()
for i in ids:
    acc = sources[str(i)]["accessories"]
    key = (head(i), lang(i))
    counts[key + ("sources",)] += 1
    counts[key + ("eligible_sources",)] += 1
    if acc:
        counts[key + ("sources_with_T2",)] += 1
    counts[key + ("T2_edges",)] += len(acc)
    for _ in acc:
        counts[key + ("A_edges" if tier(i) == "A_model" else "B_edges",)] += 1
edges_a = sum(1 for i in ids if i % 2 and tier(i) == "A_model")
edges_b = sum(1 for i in ids if i % 2 and tier(i) != "A_model")
manifest = {"schema": "babypark-recommendations-v42-rehearsal-candidate-v1", "generation_id": os.environ.get("FAKE_GENERATION", "fake-gen"),
            "sources": sources, "variant": variant}
evidence = {"schema": "babypark-v42-rehearsal-evidence-v1", "sources": evidence_sources}
metrics = {"schema": "babypark-v42-catalog-metrics-v1", "sources": len(ids),
           "edges": {"A_model": edges_a, "B_universal": edges_b, "A_manufacturer_verified": 0},
           "elapsed_seconds": round(vol * 1.5, 3),
           "scope_counts": [{"head": k[0], "lang": k[1], "metric": k[2], "value": v} for k, v in sorted(counts.items())],
           "manifest_sources": len(ids)}
index = {"catalog_nids": len(ids), "source_models": {str(i): ["m%d" % i] for i in ids},
         "metrics": {"build_seconds": round(vol * 0.25, 4), "peak_rss_kib": int(vol * 1000), "similar_bucket_keys": 7}}
drift = os.environ.get("FAKE_DRIFT", "")
if drift == "metrics_value":                 # a non-volatile metric changes
    metrics["manifest_sources"] += 1
elif drift == "metrics_type":                # same number, different JSON type (int -> float)
    metrics["sources"] = float(len(ids))
elif drift == "metrics_scope_counts":        # one T2 count changes (A/B untouched)
    metrics["scope_counts"][0]["value"] += 1
elif drift == "metrics_missing_volatile":    # the volatile key disappears on one side only
    del metrics["elapsed_seconds"]
elif drift == "metrics_volatile_not_number":  # the volatile key now hides a structure
    metrics["elapsed_seconds"] = {"total": 1.0}
elif drift == "metrics_volatile_bool":
    metrics["elapsed_seconds"] = True
elif drift == "index_value":
    index["catalog_nids"] += 1
elif drift == "index_extra_timing_key":      # a timing-like key that is NOT on the whitelist
    index["metrics"]["elapsed_seconds"] = 1.0
elif drift == "index_nested_volatile_name":  # whitelisted name at the wrong nesting level
    index["build_seconds"] = 0.25
elif drift == "index_volatile_not_number":
    index["metrics"]["build_seconds"] = "slow"
elif drift == "index_missing_volatile":
    del index["metrics"]["peak_rss_kib"]
write_json_new(OUT / "t2_v421_manifest.json", manifest)
if drift == "evidence_whitespace":           # same JSON value, different bytes
    (OUT / "t2_v421_evidence.json").write_text(json.dumps(evidence, sort_keys=True, indent=1) + "\n", encoding="utf-8")
else:
    write_json_new(OUT / "t2_v421_evidence.json", evidence)
write_json_new(OUT / "t2_v421_metrics.json", metrics)
rows = b"".join(json.dumps({"nid": i, "title": f"row {i}"}, sort_keys=True, separators=(",", ":")).encode() + b"\n" for i in ids)
write_gzip_new(INPUT / "fresh_current_catalog_records.jsonl.gz", rows)
write_gzip_new(INPUT / "fresh_v32_index.json.gz", json.dumps(index, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode())
if drift == "scope_whitespace":              # same JSON value, different bytes
    (INPUT / "fresh_v36_scope_sources.json").write_text(json.dumps({"n": len(ids)}, indent=1) + "\n", encoding="utf-8")
else:
    write_json_new(INPUT / "fresh_v36_scope_sources.json", {"n": len(ids)})
write_json_new(REBUILD / "fresh_t2_run_metadata.json", {"captured_utc": os.environ.get("FAKE_NOW", "t"), "capture_sha256": "c" * 64,
                                                        "fresh_catalog_rows": len(ids)})
print(json.dumps({"event": "V421_T2_COMPLETE", "sources": len(ids)}))
