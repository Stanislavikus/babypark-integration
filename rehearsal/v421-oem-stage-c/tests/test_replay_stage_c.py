"""``tools/replay_stage_c.py`` end to end with a runner that imitates ``run_fresh_t2.py`` (same ``REBUILD`` line, literal ``ENGINE``, ``import accessory_v4 as v4``,
``v4.build_catalog(...)`` call, ``write_json_new`` / ``write_gzip_new`` refusal to overwrite, the same six deterministic artifacts) on the REAL V4.2.1 engine and a
FICTIONAL catalog. The real corrected generation (28,769 rows / 8,129 sources) only exists on the rehearsal host; this test proves the launcher, the seam injection,
the OFF-identity proof, the ON classification and every refusal on data of the same shape. ``--no-verify`` skips only the pinned-numbers baseline verifier.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tests import scenarios as sc
from tests.helpers import ROOT, SEAM_FILE, engine_ready, require_engine
from oem_stage import canon

CLI = ROOT / "tools" / "replay_stage_c.py"

RUNNER = '''#!/usr/bin/env python3
import gzip, hashlib, json, os, sys, time
from collections import Counter
from pathlib import Path

BASE = Path("__BASE__")
REBUILD = BASE / "car_seat_correction_20261117"
INPUT = REBUILD / "input"
OUT = REBUILD / "output"
ENGINE = Path("__ENGINE__")
SRC = ENGINE / "src"
FIXTURE = Path("__FIXTURE__")
sys.path.insert(0, str(SRC))
import accessory_v4 as v4
import v32_pipeline as v32

for d in (INPUT, OUT):
    d.mkdir(mode=0o700, parents=True, exist_ok=True)

def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def write_json_new(path, value):
    if path.exists():
        raise FileExistsError(str(path))
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\\n", encoding="utf-8")

def write_gzip_new(path, raw):
    if path.exists():
        raise FileExistsError(str(path))
    with open(path, "wb") as f:
        with gzip.GzipFile(fileobj=f, mode="wb", mtime=0, compresslevel=6) as gz:
            gz.write(raw)

fresh_rows = {int(k): v for k, v in json.loads((FIXTURE / "rows.json").read_text(encoding="utf-8")).items()}
scope_original = json.loads((FIXTURE / "scope.json").read_text(encoding="utf-8"))
policy = v4.taxonomy_policy(json.loads((FIXTURE / "taxonomy.json").read_text(encoding="utf-8")))
option_profiles = v4.validate_variant_profiles(json.loads((FIXTURE / "profiles.json").read_text(encoding="utf-8")))
fitment_rules = []
index = v32.build_indexes(fresh_rows)
sources, evidence, metrics = v4.build_catalog(fresh_rows, scope_original, index, policy, fitment_rules, option_profiles)
assert len(sources) == len(scope_original)
for nid in scope_original:
    assert sources[nid]["similar"] == scope_original[nid]["similar"]
    assert len(sources[nid]["accessories"]) == len(set(sources[nid]["accessories"]))

t2_counts = Counter()
for nid in scope_original:
    row = fresh_rows[int(nid)]
    head = v4.source_head(row, policy)
    selected = sources[nid]["accessories"]
    if head:
        t2_counts[(head, row["lang"], "sources")] += 1
        if selected:
            t2_counts[(head, row["lang"], "sources_with_T2")] += 1
        t2_counts[(head, row["lang"], "T2_edges")] += len(selected)
        for target_nid in selected:
            ev = evidence.get(str(nid), {}).get("targets", {}).get(str(target_nid), {})
            t2_counts[(head, row["lang"], "A_edges" if ev.get("tier") == "A_model" else "B_edges")] += 1
metrics.update({"schema": "babypark-v42-catalog-metrics-v1", "core_catalog_rows": len(fresh_rows), "manifest_sources": len(scope_original),
                "scope_counts": [{"head": k[0], "lang": k[1], "metric": k[2], "value": v} for k, v in sorted(t2_counts.items())]})
write_json_new(OUT / "t2_v421_manifest.json", {"schema": "babypark-recommendations-v42-rehearsal-candidate-v1",
                                               "generation_id": "synthetic-fake-runner", "sources": sources})
write_json_new(OUT / "t2_v421_evidence.json", {"schema": "babypark-v42-rehearsal-evidence-v1", "sources": evidence})
write_json_new(OUT / "t2_v421_metrics.json", metrics)
raw = bytearray()
for nid in sorted(fresh_rows):
    raw.extend(json.dumps(fresh_rows[nid], ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    raw.extend(b"\\n")
write_gzip_new(INPUT / "fresh_current_catalog_records.jsonl.gz", bytes(raw))
write_gzip_new(INPUT / "fresh_v32_index.json.gz", json.dumps(index, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8"))
write_json_new(INPUT / "fresh_v36_scope_sources.json", scope_original)
print(json.dumps({"event": "V421_T2_COMPLETE", "sources": len(sources), "t2_edges": metrics["edges"]}, sort_keys=True), flush=True)
'''


def run(*args, env_extra=None, cwd=None):
    env = dict(os.environ)
    env.update(env_extra or {})
    return subprocess.run([sys.executable, "-I", "-B", *map(str, args)], capture_output=True, text=True, env=env, cwd=cwd or str(ROOT), timeout=600)


def tree_digest(path):
    return {str(p.relative_to(path)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(Path(path).rglob("*")) if p.is_file()}


@require_engine
class TestReplayStageC(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ok, why = engine_ready()
        cls.tmp = tempfile.TemporaryDirectory()
        base = cls.base = Path(cls.tmp.name)
        inp, cat = sc.standard()
        cls.inp, cls.cat = inp, cat
        engine_root = Path(os.environ["BP_V421_ENGINE_ROOT"])
        cls.engine_src = engine_root / "work" / "accessories" / "src"
        fixture = base / "fixture"
        fixture.mkdir()
        (fixture / "rows.json").write_text(json.dumps({str(k): v for k, v in inp.rows.items()}, ensure_ascii=False), encoding="utf-8")
        (fixture / "scope.json").write_text(json.dumps(inp.scope, ensure_ascii=False), encoding="utf-8")
        shutil.copy(engine_root / "work/accessories/input/taxonomy_terms_v4.json", fixture / "taxonomy.json")
        (fixture / "profiles.json").write_text(json.dumps(list(inp.catalog.profiles.values())), encoding="utf-8")
        cls.runner = base / "run_fresh_t2.py"
        cls.runner.write_text(RUNNER.replace("__BASE__", str(base)).replace("__ENGINE__", str(engine_root / "work" / "accessories"))
                              .replace("__FIXTURE__", str(fixture)), encoding="utf-8")
        cls.orig = base / "car_seat_correction_20261117"
        live = cls.orig / "input" / "v36_live_transfer"
        live.mkdir(parents=True)
        import gzip
        with gzip.open(live / "live_v36_tree_sources.json.gz", "wb") as handle:
            handle.write(b'{"schema":"fake"}')
        proc = run(cls.runner)                                                       # the "accepted" original generation (unpatched engine)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr[-3000:])
        cls.orig_digest = tree_digest(cls.orig)
        env_pairs = [sc.edge(inp, "C-FY", "RC-9", lang=lang) for lang in ("ru", "uk")] + \
                    [sc.edge(inp, "C-FX", "BG-9", lang=lang) for lang in ("ru", "uk")] + \
                    [sc.edge(inp, "S-A1", "RS-100", lang=lang, model="zeta:alpha-1") for lang in ("ru", "uk")]
        cls.env_path = base / "ctl" / "env.json"
        cls.env_path.parent.mkdir()
        canon.write_json(cls.env_path, sc.envelope(env_pairs))
        cls.empty_path = base / "ctl" / "empty.json"
        canon.write_json(cls.empty_path, sc.envelope([], synthetic=False))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def replay(self, name, envelope, *extra, script=None):
        off, on, out = self.base / f"{name}_off", self.base / f"{name}_on", self.base / f"{name}_out"
        proc = run(CLI, "--script", script or self.runner, "--original-campaign", self.orig, "--new-campaign-off", off, "--new-campaign-on", on,
                   "--envelope", envelope, "--engine-src", self.engine_src, "--no-verify", "--out", out, *extra)
        return proc, off, on, out

    def test_off_reproduces_the_accepted_generation_and_every_on_difference_is_explained(self):
        proc, off, on, out = self.replay("full", self.env_path, "--allow-synthetic")
        self.assertEqual(proc.returncode, 0, proc.stdout[-2500:] + proc.stderr[-2500:])
        report = json.loads((out / "replay_report.json").read_text(encoding="utf-8"))
        self.assertEqual(report["result"], "PASS")
        for mode in ("off", "on"):
            statuses = {a["file"]: a["status"] for a in report[mode]["artifacts"]}
            input_side = [s for f, s in statuses.items() if f.startswith("input/")]
            self.assertTrue(all(s in ("IDENTICAL", "SEMANTICALLY_IDENTICAL") for s in input_side), statuses)
        off_status = {a["file"]: a["status"] for a in report["off"]["artifacts"]}
        self.assertTrue(all(s in ("IDENTICAL", "SEMANTICALLY_IDENTICAL") for s in off_status.values()), off_status)     # all six, output side included
        self.assertEqual(off_status["output/t2_v421_manifest.json"], "IDENTICAL")
        self.assertEqual(off_status["output/t2_v421_evidence.json"], "IDENTICAL")
        self.assertEqual(report["off"]["patched_lines"], 1)
        self.assertEqual(report["on"]["launcher_receipt"]["mode"], "on")
        self.assertEqual(report["off"]["launcher_receipt"]["mode"], "off")
        self.assertEqual(report["off"]["launcher_receipt"]["seam_sha256"], hashlib.sha256(SEAM_FILE.read_bytes()).hexdigest())
        self.assertTrue(report["original_tree_unchanged"])
        self.assertEqual(tree_digest(self.orig), self.orig_digest)                                # the original campaign is byte-identical afterwards
        diff = json.loads((out / "on_off_diff.json").read_text(encoding="utf-8"))
        self.assertEqual((diff["result"], diff["violations"]), ("PASS", []))
        self.assertEqual(diff["counts_by_change"], {"displaced_b_by_role_coverage": 2, "new_oem_edge": 4, "oem_edge_already_present_legacy": 2})
        self.assertEqual(report["on_vs_off"]["ledger"]["published"], 4)
        self.assertTrue(report["on_vs_off"]["links"]["reconciled_with_edge_classification"])
        self.assertIn("Nothing here is a recommendation or a publication authorization", report["notice"])
        for line in (out / "SHA256SUMS.txt").read_text(encoding="utf-8").splitlines():
            sha, name = line.split("  ")
            self.assertEqual(hashlib.sha256((out / name).read_bytes()).hexdigest(), sha, name)
        self.assertNotEqual(tree_digest(on)["output/t2_v421_manifest.json"], tree_digest(off)["output/t2_v421_manifest.json"])   # ON really differs

    def test_an_envelope_of_zero_edges_makes_on_identical_to_off(self):
        proc, off, on, out = self.replay("empty", self.empty_path)
        self.assertEqual(proc.returncode, 0, proc.stdout[-2500:] + proc.stderr[-2500:])
        report = json.loads((out / "replay_report.json").read_text(encoding="utf-8"))
        identity = report["empty_envelope_identity"]
        self.assertTrue(identity["ok"], identity)
        self.assertEqual({v["status"] for v in identity["files"].values()}, {"IDENTICAL"})
        self.assertTrue(identity["metrics_equal_without_oem_additions"])
        self.assertEqual(report["on_vs_off"]["sources"]["changed"], 0)

    def test_a_synthetic_envelope_is_refused_without_the_opt_in_and_nothing_is_written(self):
        proc, off, on, out = self.replay("nosyn", self.env_path)
        self.assertEqual(proc.returncode, 2, proc.stderr)
        self.assertIn("synthetic envelope is refused", proc.stderr)
        for path in (off, on, out):
            self.assertFalse(path.exists(), path)

    def test_unsafe_or_stale_locations_are_refused(self):
        out = self.base / "loc_out"
        for name, off, on in (("campaign inside the original", self.orig / "inner_off", self.base / "loc_on1"),
                              ("both campaigns the same", self.base / "same", self.base / "same"),
                              ("ON inside OFF", self.base / "nest_off", self.base / "nest_off" / "on")):
            with self.subTest(name):
                proc = run(CLI, "--script", self.runner, "--original-campaign", self.orig, "--new-campaign-off", off, "--new-campaign-on", on,
                           "--envelope", self.empty_path, "--engine-src", self.engine_src, "--no-verify", "--out", out)
                self.assertEqual(proc.returncode, 2, proc.stderr)
                self.assertFalse(out.exists())
        stale = self.base / "stale_off"
        stale.mkdir()
        (stale / "leftover").write_text("x", encoding="utf-8")
        proc, *_ = self.replay("fresh", self.empty_path)
        self.assertEqual(proc.returncode, 0, proc.stderr)                                            # fresh names are fine ...
        proc = run(CLI, "--script", self.runner, "--original-campaign", self.orig, "--new-campaign-off", stale, "--new-campaign-on", self.base / "stale_on",
                   "--envelope", self.empty_path, "--engine-src", self.engine_src, "--no-verify", "--out", self.base / "stale_out")
        self.assertEqual(proc.returncode, 2, proc.stderr)                                           # ... a non-empty campaign is not

    def test_an_engine_that_is_not_the_accepted_file_is_refused(self):
        copy = self.base / "other_engine_src"
        shutil.copytree(self.engine_src, copy, ignore=shutil.ignore_patterns("__pycache__"))
        with open(copy / "accessory_v4.py", "a", encoding="utf-8") as handle:
            handle.write("\n# tampered\n")
        out = self.base / "engine_out"
        proc = run(CLI, "--script", self.runner, "--original-campaign", self.orig, "--new-campaign-off", self.base / "eng_off", "--new-campaign-on",
                   self.base / "eng_on", "--envelope", self.empty_path, "--engine-src", copy, "--no-verify", "--out", out)
        self.assertEqual(proc.returncode, 2, proc.stderr)
        self.assertIn("not the accepted V4.2.1 engine file", proc.stderr)
        self.assertFalse((self.base / "eng_off").exists())

    def test_a_script_without_exactly_one_rebuild_line_is_refused_before_anything_runs(self):
        bad = self.base / "bad_runner.py"
        bad.write_text(self.runner.read_text(encoding="utf-8").replace("REBUILD = BASE", "OTHER = BASE", 1), encoding="utf-8")
        proc, off, on, out = self.replay("badscript", self.empty_path, script=bad)
        self.assertEqual(proc.returncode, 2, proc.stderr)
        self.assertFalse(off.exists() or on.exists())

    def test_a_tampered_original_artifact_makes_the_off_proof_fail(self):
        tampered = self.base / "tampered_orig"
        shutil.copytree(self.orig, tampered)
        manifest = tampered / "output" / "t2_v421_manifest.json"
        manifest.write_text(manifest.read_text(encoding="utf-8").replace("synthetic-fake-runner", "tampered"), encoding="utf-8")
        out = self.base / "tamper_out"
        proc = run(CLI, "--script", self.runner, "--original-campaign", tampered, "--new-campaign-off", self.base / "tam_off", "--new-campaign-on",
                   self.base / "tam_on", "--envelope", self.empty_path, "--engine-src", self.engine_src, "--no-verify", "--out", out)
        self.assertEqual(proc.returncode, 1, proc.stdout[-1500:] + proc.stderr[-1500:])
        report = json.loads((out / "replay_report.json").read_text(encoding="utf-8"))
        self.assertEqual((report["result"], report["off"]["result"]), ("FAIL", "FAIL"))
        self.assertIn("DIFFERENT", {a["status"] for a in report["off"]["artifacts"]})

    def test_the_launcher_refuses_a_wrong_seam_or_a_missing_envelope(self):
        launcher = ROOT / "tools" / "stage_c_launcher.py"
        pins = ROOT / "engine_seam" / "ENGINE_SEAM_PINS.json"
        proc = run(launcher, "--runner", self.runner, "--engine-src", self.engine_src, "--seam-file", self.engine_src / "accessory_v4.py", "--pins", pins,
                   "--mode", "off")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("not the audited patched copy", proc.stderr)
        proc = run(launcher, "--runner", self.runner, "--engine-src", self.engine_src, "--seam-file", SEAM_FILE, "--pins", pins, "--mode", "on")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("--envelope is required", proc.stderr)
        proc = run(launcher, "--runner", self.runner, "--engine-src", self.engine_src, "--seam-file", SEAM_FILE, "--pins", pins, "--mode", "off",
                   "--envelope", self.empty_path)
        self.assertEqual(proc.returncode, 2)


if __name__ == "__main__":
    unittest.main()
