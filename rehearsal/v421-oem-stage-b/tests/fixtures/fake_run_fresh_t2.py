#!/usr/bin/env python3
"""TEST DOUBLE of the *structure* of run_fresh_t2.py (same REBUILD/INPUT/OUT derivation, same never-overwrite writers,
same deterministic gzip/JSON writers and output names). It computes tiny fake artifacts from the live-transfer input.
It exists only to test tools/replay_corrected_generation.py without the rehearsal host; it is not the real runner."""
import gzip, hashlib, json, os, sys
from pathlib import Path

BASE = Path(os.environ["FAKE_CAMPAIGN_BASE"])
REBUILD = BASE / "car_seat_correction_20261117"
# like the real script's ENGINE: a literal path inside the ORIGINAL campaign, not derived from REBUILD
sys.path.insert(0, str(BASE / "car_seat_correction_20261117" / "engine_root" / "work" / "accessories" / "src"))
import fake_engine_mod  # noqa: E402
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
sources = {str(i): {"language": "ru", "similar": [], "accessories": [i + 1000] if i % 2 else []} for i in ids}
manifest = {"schema": "babypark-recommendations-v42-rehearsal-candidate-v1", "generation_id": os.environ.get("FAKE_GENERATION", "fake-gen"),
            "sources": sources, "variant": variant}
evidence = {"schema": "babypark-v42-rehearsal-evidence-v1", "sources": {k: {"targets": {}} for k in sources}}
edges = sum(len(s["accessories"]) for s in sources.values())
metrics = {"scope_counts": [{"head": "stroller", "lang": "ru", "metric": "A_edges", "value": edges}]}
write_json_new(OUT / "t2_v421_manifest.json", manifest)
write_json_new(OUT / "t2_v421_evidence.json", evidence)
write_json_new(OUT / "t2_v421_metrics.json", metrics)
rows = b"".join(json.dumps({"nid": i, "title": f"row {i}"}, sort_keys=True, separators=(",", ":")).encode() + b"\n" for i in ids)
write_gzip_new(INPUT / "fresh_current_catalog_records.jsonl.gz", rows)
write_gzip_new(INPUT / "fresh_v32_index.json.gz", json.dumps({"n": len(ids)}, sort_keys=True).encode())
write_json_new(INPUT / "fresh_v36_scope_sources.json", {"n": len(ids)})
write_json_new(REBUILD / "fresh_t2_run_metadata.json", {"captured_utc": os.environ.get("FAKE_NOW", "t"), "capture_sha256": "c" * 64,
                                                        "fresh_catalog_rows": len(ids)})
print(json.dumps({"event": "V421_T2_COMPLETE", "sources": len(ids)}))
