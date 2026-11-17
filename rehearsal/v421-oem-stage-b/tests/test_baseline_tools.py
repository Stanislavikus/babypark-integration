"""S0 tools: the read-only baseline verifier and the corrected-generation replay wrapper.

The replay wrapper is tested against a structural test double of run_fresh_t2.py (tests/fixtures/fake_run_fresh_t2.py); the real
runner needs the rehearsal capture inputs and is NOT run here. The verifier is tested on the real-engine mini catalog files
and on synthetic pins derived from them (mutating one byte must flip PASS to FAIL)."""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path

from tests.helpers import ROOT

sys.path.insert(0, str(ROOT / "tools"))
import replay_corrected_generation as replay  # noqa: E402
import verify_baseline as vb  # noqa: E402

FAKE = ROOT / "tests" / "fixtures" / "fake_run_fresh_t2.py"
PINS_FILE = ROOT / "data" / "baseline_pins.json"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_campaign(base: Path, *, env_extra=None) -> Path:
    """Original campaign = the fake runner executed once (its own never-overwrite semantics, like the real one)."""
    camp = base / "car_seat_correction_20261117"
    live = camp / "input" / "v36_live_transfer"
    live.mkdir(parents=True)
    engine_src = camp / "engine_root" / "work" / "accessories" / "src"
    engine_src.mkdir(parents=True)
    (engine_src / "fake_engine_mod.py").write_text("VALUE = 1\n", encoding="utf-8")
    with gzip.GzipFile(live / "live_v36_tree_sources.json.gz", "wb", mtime=0) as handle:
        handle.write(json.dumps({"ids": list(range(1, 41))}).encode())
    env = dict(os.environ, FAKE_CAMPAIGN_BASE=str(base), **(env_extra or {}))
    proc = subprocess.run([sys.executable, "-I", "-B", str(FAKE)], env=env, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr
    return camp


def fixture_links(camp: Path) -> dict:
    """Links per head computed straight from the manifest by source id (stroller <= 30 < car_seat): independent of the metrics file."""
    manifest = json.loads((camp / "output" / "t2_v421_manifest.json").read_text(encoding="utf-8"))
    by = {"stroller": 0, "car_seat": 0}
    for key, src in manifest["sources"].items():
        by["stroller" if int(key) <= 30 else "car_seat"] += len(src["accessories"])
    return {**by, "total": by["stroller"] + by["car_seat"]}


def pins_for(camp: Path, **override) -> dict:
    manifest = json.loads((camp / "output" / "t2_v421_manifest.json").read_text(encoding="utf-8"))
    pins = json.loads(PINS_FILE.read_text(encoding="utf-8"))
    rows = camp / "input" / "fresh_current_catalog_records.jsonl.gz"
    pins.update({"accepted_manifest_sha256": sha(camp / "output" / "t2_v421_manifest.json"),
                 "fresh_source_rows_sha256": sha(rows), "catalog_rows": 40, "manifest_sources": 40,
                 "generation_id": manifest["generation_id"], "capture_sha256": "c" * 64,
                 "links": fixture_links(camp)})
    pins.update(override)
    return pins


class TestPinsFile(unittest.TestCase):
    def test_pins_are_exactly_the_values_of_the_lock(self):
        pins = json.loads(PINS_FILE.read_text(encoding="utf-8"))
        self.assertEqual(pins["accepted_manifest_sha256"], "10a3a9af57635cfa60d008f6c702054a667249bd78e1412318502e855481176d")
        self.assertEqual(pins["fresh_source_rows_sha256"], "20544b488f12d86f590d13efca7e732f8470f61a889ef151b929bfff6453b8d0")
        self.assertEqual((pins["catalog_rows"], pins["manifest_sources"]), (28769, 8129))
        self.assertEqual(pins["links"], {"car_seat": 42, "stroller": 1832, "total": 1874})
        self.assertEqual(pins["links"]["stroller"] + pins["links"]["car_seat"], pins["links"]["total"])
        self.assertEqual(pins["generation_id"], "v421-t2-fresh-20261116-live-v34")
        self.assertEqual(pins["not_this_generation"], {"catalog_rows": 28011, "manifest_sources": 8471})

    def test_the_lock_document_states_the_same_pins(self):
        lock = ROOT.parents[1] / "docs" / "oem-review-20261117" / "STAGE_B_EXECUTION_LOCK_20261117.md"
        if not lock.is_file():
            self.skipTest("lock document not present next to the stage directory")
        text = lock.read_text(encoding="utf-8")
        pins = json.loads(PINS_FILE.read_text(encoding="utf-8"))
        for needle in (pins["accepted_manifest_sha256"], pins["fresh_source_rows_sha256"], pins["generation_id"], "28,769", "8,129",
                       "1,832", "42", "28,011", "8,471"):
            self.assertIn(needle, text)


class TestVerifyBaseline(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.camp = write_campaign(self.base)

    def tearDown(self):
        self.tmp.cleanup()

    def run_verify(self, pins=None, **kw):
        return vb.verify(self.camp / "input", self.camp / "output", pins or pins_for(self.camp), self.camp, **kw)

    def test_matching_campaign_passes_and_is_read_only(self):
        before = replay.tree_snapshot(self.camp)
        report = self.run_verify()
        self.assertEqual(report["result"], "PASS", [c for c in report["checks"] if c["status"] != "PASS"])
        self.assertEqual(before, replay.tree_snapshot(self.camp))
        self.assertTrue(report["read_only"])
        self.assertEqual({c["check"] for c in report["checks"]} >= {"manifest_sha256", "fresh_source_rows_sha256", "catalog_rows",
                                                                   "manifest_sources", "links_by_source_head", "capture_sha256"}, True)

    def test_rows_digest_is_accepted_in_raw_form_too_and_the_form_is_reported(self):
        rows = self.camp / "input" / "fresh_current_catalog_records.jsonl.gz"
        raw_sha = hashlib.sha256(gzip.open(rows, "rb").read()).hexdigest()
        report = self.run_verify(pins_for(self.camp, fresh_source_rows_sha256=raw_sha))
        check = next(c for c in report["checks"] if c["check"] == "fresh_source_rows_sha256")
        self.assertEqual((report["result"], check["note"]), ("PASS", "matched form: raw"))

    def test_every_pin_is_enforced(self):
        links = fixture_links(self.camp)
        cases = {"manifest_sha256": {"accepted_manifest_sha256": "0" * 64}, "fresh_source_rows_sha256": {"fresh_source_rows_sha256": "1" * 64},
                 "catalog_rows": {"catalog_rows": 41}, "manifest_sources": {"manifest_sources": 39},
                 "generation_id": {"generation_id": "other"}, "capture_sha256": {"capture_sha256": "d" * 64},
                 "manifest_accessory_edges_total": {"links": {**links, "total": links["total"] + 1}},
                 "links_by_source_head": {"links": {"stroller": links["stroller"] - 1, "car_seat": links["car_seat"] + 1,
                                                    "total": links["total"]}}}
        for name, override in cases.items():
            report = self.run_verify(pins_for(self.camp, **override))
            failed = {c["check"] for c in report["checks"] if c["status"] == "FAIL"}
            self.assertEqual(report["result"], "FAIL", name)
            self.assertIn(name, failed)

    def test_a_single_changed_byte_is_detected(self):
        manifest = self.camp / "output" / "t2_v421_manifest.json"
        pins = pins_for(self.camp)
        manifest.write_bytes(manifest.read_bytes().replace(b"fake-gen", b"fake-gex"))
        report = self.run_verify(pins)
        failed = {c["check"] for c in report["checks"] if c["status"] == "FAIL"}
        self.assertEqual(report["result"], "FAIL")
        self.assertTrue({"manifest_sha256", "generation_id"} <= failed)

    def test_the_older_generation_is_refused(self):
        report = self.run_verify(pins_for(self.camp, not_this_generation={"catalog_rows": 40, "manifest_sources": 40}))
        failed = {c["check"] for c in report["checks"] if c["status"] == "FAIL"}
        self.assertEqual(failed, {"not_the_older_generation:sources", "not_the_older_generation:rows"})

    def test_duplicate_nids_and_missing_files_fail(self):
        rows = self.camp / "input" / "fresh_current_catalog_records.jsonl.gz"
        lines = gzip.open(rows, "rb").read().splitlines(keepends=True)
        with gzip.GzipFile(rows, "wb", mtime=0) as handle:
            handle.write(b"".join(lines + [lines[0]]))
        report = self.run_verify(pins_for(self.camp, fresh_source_rows_sha256=sha(rows)))
        self.assertIn("catalog_nids_unique", {c["check"] for c in report["checks"] if c["status"] == "FAIL"})
        (self.camp / "output" / "t2_v421_metrics.json").unlink()
        report = self.run_verify(pins_for(self.camp))
        self.assertIn("file_present:metrics", {c["check"] for c in report["checks"] if c["status"] == "FAIL"})

    def test_cli_exit_codes_and_report_file(self):
        pins_path = self.base / "pins.json"
        pins_path.write_text(json.dumps(pins_for(self.camp)), encoding="utf-8")
        out = self.base / "report.json"
        args = [sys.executable, "-I", str(ROOT / "tools" / "verify_baseline.py"), "--input-dir", str(self.camp / "input"),
                "--output-dir", str(self.camp / "output"), "--campaign-dir", str(self.camp), "--pins", str(pins_path), "--json", str(out)]
        ok = subprocess.run(args, capture_output=True, text=True)
        self.assertEqual(ok.returncode, 0, ok.stdout + ok.stderr)
        self.assertIn("BASELINE PASS", ok.stdout)
        self.assertEqual(json.loads(out.read_text(encoding="utf-8"))["result"], "PASS")
        pins_path.write_text(json.dumps(pins_for(self.camp, catalog_rows=1)), encoding="utf-8")
        bad = subprocess.run(args, capture_output=True, text=True)
        self.assertEqual(bad.returncode, 1)
        self.assertIn("BASELINE FAIL", bad.stdout)


class ReplayCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.camp = write_campaign(self.base)
        self.new = self.base / "replay_campaign"
        self.script = self.base / "run_fresh_t2.py"
        self.script.write_text(FAKE.read_text(encoding="utf-8"), encoding="utf-8")
        os.environ["FAKE_CAMPAIGN_BASE"] = str(self.base)

    def tearDown(self):
        os.environ.pop("FAKE_CAMPAIGN_BASE", None)
        for key in ("FAKE_VARIANT", "FAKE_GENERATION", "FAKE_VOLATILE", "FAKE_DRIFT"):
            os.environ.pop(key, None)
        self.tmp.cleanup()


class TestReplayWrapper(ReplayCase):
    def test_patch_changes_exactly_one_line_and_refuses_ambiguity(self):
        text = self.script.read_text(encoding="utf-8")
        patched = replay.patch_script(text, self.new)
        diff = [(a, b) for a, b in zip(text.splitlines(), patched.splitlines()) if a != b]
        self.assertEqual(len(diff), 1)
        self.assertTrue(diff[0][0].startswith("REBUILD = ") and diff[0][1] == f"REBUILD = Path({str(self.new)!r})")
        self.assertEqual(len(text.splitlines()), len(patched.splitlines()))
        for bad in (text.replace("REBUILD = BASE", "REBUILD_ = BASE"), text + "\nREBUILD = BASE / 'x'\n"):
            with self.assertRaises(replay.ReplayRefused):
                replay.patch_script(bad, self.new)

    def test_refuses_unsafe_campaign_locations(self):
        for new in (self.camp, self.camp / "sub", self.base):
            with self.assertRaises(replay.ReplayRefused):
                replay.check_paths(self.camp.resolve(), new.resolve())
        occupied = self.base / "occupied"
        occupied.mkdir()
        (occupied / "x").write_text("x", encoding="utf-8")
        with self.assertRaises(replay.ReplayRefused):
            replay.check_paths(self.camp.resolve(), occupied.resolve())

    def test_identical_replay_passes_leaves_the_original_untouched_and_verifies_the_baseline(self):
        before = replay.tree_snapshot(self.camp)
        report = replay.replay(self.script, self.camp, self.new, pins_for(self.camp))
        self.assertEqual(report["result"], "PASS", json.dumps(report, indent=1)[:1500])
        self.assertTrue(report["original_tree_unchanged"])
        self.assertEqual(before, replay.tree_snapshot(self.camp))
        self.assertEqual(list(self.camp.rglob("__pycache__")), [], "the replay must not write bytecode into the original campaign")
        self.assertEqual(report["patched_lines"], 1)
        self.assertEqual({a["status"] for a in report["artifacts"]}, {"IDENTICAL"})
        self.assertEqual(report["baseline_verification"]["result"], "PASS")
        self.assertEqual(report["final_event"]["event"], "V421_T2_COMPLETE")
        self.assertTrue((self.new / "output" / "t2_v421_manifest.json").is_file())
        mode = (self.new / "input" / "v36_live_transfer" / "live_v36_tree_sources.json.gz").stat().st_mode & 0o777
        self.assertEqual(mode, 0o400)

    def test_a_replay_that_produces_different_bytes_fails(self):
        os.environ["FAKE_VARIANT"] = "drift"
        report = replay.replay(self.script, self.camp, self.new, pins_for(self.camp))
        self.assertEqual(report["result"], "FAIL")
        statuses = {a["file"]: a["status"] for a in report["artifacts"]}
        self.assertEqual(statuses["output/t2_v421_manifest.json"], "DIFFERENT")
        self.assertEqual(report["baseline_verification"]["result"], "FAIL")
        self.assertTrue(report["original_tree_unchanged"])

    def test_a_failing_script_is_reported_not_hidden(self):
        script = self.base / "broken.py"
        script.write_text("from pathlib import Path\nREBUILD = None\nraise SystemExit(3)\n", encoding="utf-8")
        report = replay.replay(script, self.camp, self.new, pins_for(self.camp))
        self.assertEqual((report["result"], report["script_exit_code"]), ("FAIL", 3))
        self.assertIsNone(report["baseline_verification"])
        self.assertTrue(report["original_tree_unchanged"])

    def test_cli_refuses_with_exit_code_2_and_never_creates_the_new_campaign(self):
        proc = subprocess.run([sys.executable, "-I", str(ROOT / "tools" / "replay_corrected_generation.py"), "--script", str(self.script),
                               "--original-campaign", str(self.camp), "--new-campaign", str(self.camp / "inside")],
                              capture_output=True, text=True, env=dict(os.environ))
        self.assertEqual(proc.returncode, 2)
        self.assertIn("REFUSED", proc.stderr)
        self.assertFalse((self.camp / "inside").exists())


class TestVerifierOnRealShapes(unittest.TestCase):
    """B-R1: the real corrected generation has SPARSE evidence (only sources that have accessories) and edge metrics A_edges / B_edges /
    T2_edges where A + B == T2. The verifier must model exactly that: count T2_edges only, compare evidence to the sparse set."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.camp = write_campaign(Path(self.tmp.name))
        self.metrics_path = self.camp / "output" / "t2_v421_metrics.json"
        self.evidence_path = self.camp / "output" / "t2_v421_evidence.json"

    def tearDown(self):
        self.tmp.cleanup()

    def load(self, path):
        return json.loads(path.read_text(encoding="utf-8"))

    def save(self, path, obj):
        path.write_text(json.dumps(obj, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")

    def verify(self):
        return vb.verify(self.camp / "input", self.camp / "output", pins_for(self.camp), self.camp)

    @staticmethod
    def failed(report):
        return {c["check"] for c in report["checks"] if c["status"] == "FAIL"}

    def test_the_fixture_reproduces_both_traps_of_the_real_data(self):
        manifest, evidence, metrics = (self.load(self.camp / "output" / "t2_v421_manifest.json"), self.load(self.evidence_path),
                                       self.load(self.metrics_path))
        with_edges = {k for k, s in manifest["sources"].items() if s["accessories"]}
        self.assertTrue(0 < len(with_edges) < len(manifest["sources"]))
        self.assertEqual(set(evidence["sources"]), with_edges)                       # sparse evidence, not one entry per source
        by_metric = Counter()
        for item in metrics["scope_counts"]:
            by_metric[item["metric"]] += item["value"]
        self.assertGreater(by_metric["A_edges"], 0)
        self.assertGreater(by_metric["B_edges"], 0)
        self.assertEqual(by_metric["A_edges"] + by_metric["B_edges"], by_metric["T2_edges"])
        every_edges_metric = sum(v for m, v in by_metric.items() if m.endswith("_edges"))
        self.assertEqual(every_edges_metric, 2 * by_metric["T2_edges"])               # summing every *_edges metric double counts
        self.assertEqual(by_metric["T2_edges"], fixture_links(self.camp)["total"])

    def test_sparse_evidence_and_t2_edges_pass(self):
        report = self.verify()
        self.assertEqual(report["result"], "PASS", [c for c in report["checks"] if c["status"] != "PASS"])
        names = {c["check"] for c in report["checks"]}
        self.assertTrue({"evidence_sources_match_manifest", "links_by_source_head", "metrics_edges_match_manifest_total"} <= names)

    def test_evidence_must_cover_exactly_the_sources_with_accessories(self):
        evidence = self.load(self.evidence_path)
        covered = sorted(evidence["sources"])
        del evidence["sources"][covered[0]]                                          # a source with accessories lost its evidence
        self.save(self.evidence_path, evidence)
        self.assertEqual(self.failed(self.verify()), {"evidence_sources_match_manifest"})
        evidence = self.load(self.evidence_path)
        evidence["sources"][covered[0]] = {"targets": {}}
        evidence["sources"]["2"] = {"targets": {}}                                   # evidence for a source WITHOUT accessories
        self.save(self.evidence_path, evidence)
        self.assertEqual(self.failed(self.verify()), {"evidence_sources_match_manifest"})
        evidence["sources"].pop("2")
        evidence["sources"]["not-a-source"] = evidence["sources"].pop(covered[0])    # a renamed key
        self.save(self.evidence_path, evidence)
        self.assertEqual(self.failed(self.verify()), {"evidence_sources_match_manifest"})

    def test_edges_are_counted_from_the_t2_edges_metric_only(self):
        metrics = self.load(self.metrics_path)
        for item in metrics["scope_counts"]:
            if item["metric"] == "T2_edges" and item["head"] == "stroller" and item["value"]:
                item["value"] += 1
                break
        self.save(self.metrics_path, metrics)
        self.assertEqual(self.failed(self.verify()), {"links_by_source_head", "metrics_edges_match_manifest_total"})

    def test_an_unknown_head_with_edges_fails_but_one_with_zero_edges_is_ignored(self):
        metrics = self.load(self.metrics_path)
        metrics["scope_counts"].append({"head": "other", "lang": "ru", "metric": "T2_edges", "value": 0})
        self.save(self.metrics_path, metrics)
        self.assertEqual(self.verify()["result"], "PASS")
        metrics["scope_counts"].append({"head": "other", "lang": "uk", "metric": "T2_edges", "value": 1})
        self.save(self.metrics_path, metrics)
        self.assertEqual(self.failed(self.verify()), {"links_by_source_head", "metrics_edges_match_manifest_total"})

    def test_a_malformed_t2_edges_value_fails_even_when_the_sums_would_still_match(self):
        for bad in ("0", 0.0, True, None, [0]):
            with self.subTest(value=bad):
                metrics = self.load(self.metrics_path)
                metrics["scope_counts"] = [i for i in metrics["scope_counts"] if i.get("head") != "other"]
                metrics["scope_counts"].append({"head": "other", "lang": "ru", "metric": "T2_edges", "value": bad})
                self.save(self.metrics_path, metrics)
                report = self.verify()
                self.assertEqual(report["result"], "FAIL")
                links = next(c for c in report["checks"] if c["check"] == "links_by_source_head")
                self.assertEqual(links["observed"].get("malformed_scope_count_items"), 1)
        metrics = self.load(self.metrics_path)
        metrics["scope_counts"] = [i for i in metrics["scope_counts"] if i.get("head") != "other"] + ["not-an-object"]
        self.save(self.metrics_path, metrics)
        self.assertEqual(self.verify()["result"], "FAIL")

    def test_a_metrics_file_without_t2_edges_fails(self):
        metrics = self.load(self.metrics_path)
        metrics["scope_counts"] = [i for i in metrics["scope_counts"] if i["metric"] != "T2_edges"]
        self.save(self.metrics_path, metrics)
        self.assertEqual(self.failed(self.verify()), {"links_by_source_head", "metrics_edges_match_manifest_total"})

    def test_the_data_integrity_guards_are_preserved(self):
        pins = pins_for(self.camp)                                                   # pins are taken from the accepted bytes
        manifest = self.camp / "output" / "t2_v421_manifest.json"
        manifest.write_bytes(manifest.read_bytes().replace(b"fake-gen", b"fake-gex"))
        report = vb.verify(self.camp / "input", self.camp / "output", pins, self.camp)
        self.assertTrue({"manifest_sha256", "generation_id"} <= self.failed(report))
        self.assertEqual(report["result"], "FAIL")


class TestReplaySemanticComparison(ReplayCase):
    """B-R2: the real engine writes wall-clock / RSS measurements into two of the six artifacts (metrics ``elapsed_seconds``; v32 index
    ``metrics.build_seconds`` and ``metrics.peak_rss_kib``), so a faithful replay can never be byte-identical there. Those two files are
    compared as parsed objects EXCLUDING exactly those keys; every other difference (value, type, presence, extra key, list order) and every
    difference in the other four files (strict bytes) fails. Raw hashes are always reported."""

    METRICS, INDEX = "output/t2_v421_metrics.json", "input/fresh_v32_index.json.gz"

    def run_replay(self, **env):
        os.environ.update(env)
        return replay.replay(self.script, self.camp, self.new, pins_for(self.camp))

    @staticmethod
    def statuses(report):
        return {a["file"]: a["status"] for a in report["artifacts"]}

    def test_volatile_fields_alone_give_a_semantically_identical_pass(self):
        before = replay.tree_snapshot(self.camp)
        report = self.run_replay(FAKE_VOLATILE="2")
        self.assertEqual(report["result"], "PASS", json.dumps(report, indent=1)[:2500])
        statuses = self.statuses(report)
        self.assertEqual({statuses[self.METRICS], statuses[self.INDEX]}, {"SEMANTICALLY_IDENTICAL"})
        self.assertEqual(sorted(f for f, st in statuses.items() if st == "IDENTICAL"),
                         sorted(set(replay.DETERMINISTIC) - {self.METRICS, self.INDEX}))
        self.assertEqual(len(statuses), 6)
        self.assertTrue(report["original_tree_unchanged"])
        self.assertEqual(before, replay.tree_snapshot(self.camp))
        self.assertEqual(report["baseline_verification"]["result"], "PASS")
        by_file = {a["file"]: a for a in report["artifacts"]}
        for rel in (self.METRICS, self.INDEX):                                   # raw hashes are reported and DO differ
            row = by_file[rel]
            self.assertNotEqual(row["original_sha256"], row["replay_sha256"])
            self.assertEqual(row["original_sha256"], sha(self.camp / rel))
            self.assertEqual(row["replay_sha256"], sha(self.new / rel))
            self.assertEqual(row["semantic"]["original_semantic_sha256"], row["semantic"]["replay_semantic_sha256"])
        self.assertEqual(sorted(by_file[self.METRICS]["semantic"]["volatile_values"]), ["elapsed_seconds"])
        self.assertEqual(sorted(by_file[self.INDEX]["semantic"]["volatile_values"]), ["metrics.build_seconds", "metrics.peak_rss_kib"])
        self.assertEqual(by_file[self.METRICS]["semantic"]["volatile_values"]["elapsed_seconds"], {"original": 1.5, "replay": 3.0})
        for rel in set(replay.DETERMINISTIC) - {self.METRICS, self.INDEX}:
            self.assertEqual(by_file[rel]["original_sha256"], by_file[rel]["replay_sha256"])
            self.assertNotIn("semantic", by_file[rel])

    def test_the_whitelist_is_exactly_the_keys_named_by_the_independent_check(self):
        self.assertEqual(replay.VOLATILE_FIELDS, {"output/t2_v421_metrics.json": (("elapsed_seconds",),),
                                                  "input/fresh_v32_index.json.gz": (("metrics", "build_seconds"), ("metrics", "peak_rss_kib"))})
        self.assertLessEqual(set(replay.VOLATILE_FIELDS), set(replay.DETERMINISTIC))
        report = self.run_replay()
        self.assertEqual(report["volatile_field_whitelist"], {"input/fresh_v32_index.json.gz": ["metrics.build_seconds", "metrics.peak_rss_kib"],
                                                               "output/t2_v421_metrics.json": ["elapsed_seconds"]})

    def test_any_other_change_fails_even_when_the_volatile_fields_also_differ(self):
        expected = {"metrics_value": self.METRICS, "metrics_type": self.METRICS, "metrics_scope_counts": self.METRICS,
                    "metrics_missing_volatile": self.METRICS, "metrics_volatile_not_number": self.METRICS,
                    "metrics_volatile_bool": self.METRICS,
                    "index_value": self.INDEX, "index_extra_timing_key": self.INDEX, "index_nested_volatile_name": self.INDEX,
                    "index_volatile_not_number": self.INDEX, "index_missing_volatile": self.INDEX,
                    "evidence_whitespace": "output/t2_v421_evidence.json", "scope_whitespace": "input/fresh_v36_scope_sources.json"}
        for drift, rel in expected.items():
            with self.subTest(drift=drift):
                self.tearDownCampaign()
                self.setUp()
                report = self.run_replay(FAKE_VOLATILE="2", FAKE_DRIFT=drift)
                self.assertEqual(report["result"], "FAIL")
                statuses = self.statuses(report)
                self.assertEqual(statuses[rel], "DIFFERENT", (drift, statuses))
                self.assertEqual([f for f, st in statuses.items() if st == "DIFFERENT"], [rel])
                row = next(a for a in report["artifacts"] if a["file"] == rel)
                self.assertTrue(row["reason"], drift)
                self.assertTrue(report["original_tree_unchanged"])

    def tearDownCampaign(self):
        """Fresh original campaign per sub-test (the runner never overwrites)."""
        for key in ("FAKE_VARIANT", "FAKE_GENERATION", "FAKE_VOLATILE", "FAKE_DRIFT"):
            os.environ.pop(key, None)
        self.tmp.cleanup()

    def test_a_volatile_value_alone_is_never_what_decides_a_byte_identical_file(self):
        report = self.run_replay()                                                # same env -> same volatile values -> byte identical
        self.assertEqual({a["status"] for a in report["artifacts"]}, {"IDENTICAL"})
        self.assertTrue(all("semantic" not in a for a in report["artifacts"]))

    def test_cli_exit_code_0_and_statuses_are_printed_for_a_volatile_only_replay(self):
        os.environ["FAKE_VOLATILE"] = "3"
        out, pins_file = self.base / "report.json", self.base / "pins.json"
        pins_file.write_text(json.dumps(pins_for(self.camp)), encoding="utf-8")        # the fake campaign is not the real baseline
        proc = subprocess.run([sys.executable, "-I", str(ROOT / "tools" / "replay_corrected_generation.py"), "--script", str(self.script),
                               "--original-campaign", str(self.camp), "--new-campaign", str(self.new), "--pins", str(pins_file),
                               "--json", str(out)], capture_output=True, text=True, env=dict(os.environ))
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertEqual(proc.stdout.count("SEMANTICALLY_IDENTICAL"), 2)
        self.assertEqual(proc.stdout.count("IDENTICAL"), 6)                       # 4 x IDENTICAL + 2 x SEMANTICALLY_IDENTICAL
        self.assertIn("REPLAY PASS", proc.stdout)
        self.assertEqual(json.loads(out.read_text(encoding="utf-8"))["result"], "PASS")


class TestCompareArtifact(unittest.TestCase):
    """The comparison function on its own: exactly the whitelisted numeric measurements are ignored, nothing else."""

    METRICS, INDEX, OTHER = "output/t2_v421_metrics.json", "input/fresh_v32_index.json.gz", "output/t2_v421_manifest.json"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.a, self.b = Path(self.tmp.name) / "a", Path(self.tmp.name) / "b"
        for d in (self.a, self.b):
            (d / "output").mkdir(parents=True)
            (d / "input").mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def put(self, side, rel, obj, *, text=None):
        path = side / rel
        raw = (text if text is not None else json.dumps(obj, sort_keys=True, separators=(",", ":")) + "\n").encode()
        if rel.endswith(".gz"):
            with gzip.GzipFile(path, "wb", mtime=0) as handle:
                handle.write(raw)
        else:
            path.write_bytes(raw)

    def compare(self, rel, original, replayed):
        self.put(self.a, rel, original)
        self.put(self.b, rel, replayed)
        return replay.compare_artifact(self.a, self.b, rel)

    def test_byte_identical_files_are_identical_whatever_the_content(self):
        self.put(self.a, self.OTHER, {"x": 1})
        self.put(self.b, self.OTHER, {"x": 1})
        row = replay.compare_artifact(self.a, self.b, self.OTHER)
        self.assertEqual(row["status"], "IDENTICAL")
        self.assertEqual(row["original_sha256"], row["replay_sha256"])

    def test_only_the_whitelisted_numbers_may_differ(self):
        base = {"edges": 3, "elapsed_seconds": 1.5, "sources": 40}
        row = self.compare(self.METRICS, base, {**base, "elapsed_seconds": 2.25})
        self.assertEqual(row["status"], "SEMANTICALLY_IDENTICAL")
        self.assertEqual(row["semantic"]["volatile_values"], {"elapsed_seconds": {"original": 1.5, "replay": 2.25}})
        index = {"catalog_nids": 4, "metrics": {"build_seconds": 0.4, "peak_rss_kib": 900, "similar_bucket_keys": 7}}
        row = self.compare(self.INDEX, index, {**index, "metrics": {**index["metrics"], "build_seconds": 0.5, "peak_rss_kib": 901}})
        self.assertEqual(row["status"], "SEMANTICALLY_IDENTICAL")
        self.assertNotEqual(row["original_sha256"], row["replay_sha256"])
        row = self.compare(self.INDEX, index, {**index, "metrics": {**index["metrics"], "similar_bucket_keys": 8}})
        self.assertEqual(row["status"], "DIFFERENT")
        self.assertIn("similar_bucket_keys", row["reason"])

    def test_key_order_and_whitespace_are_not_semantic_but_only_in_the_whitelisted_files(self):
        self.put(self.a, self.METRICS, None, text='{"a":1,"elapsed_seconds":1.0,"b":[1,2]}\n')
        self.put(self.b, self.METRICS, None, text='{\n "b": [1, 2],\n "elapsed_seconds": 1.0,\n "a": 1\n}\n')
        self.assertEqual(replay.compare_artifact(self.a, self.b, self.METRICS)["status"], "SEMANTICALLY_IDENTICAL")
        self.put(self.a, self.OTHER, None, text='{"a":1,"b":[1,2]}\n')
        self.put(self.b, self.OTHER, None, text='{"b":[1,2],"a":1}\n')
        self.assertEqual(replay.compare_artifact(self.a, self.b, self.OTHER)["status"], "DIFFERENT")     # strict bytes elsewhere

    def test_type_presence_and_order_changes_are_differences(self):
        base = {"elapsed_seconds": 1.0, "n": 1, "flag": False, "items": [1, 2, 3], "nested": {"k": "v"}}
        cases = {"int_to_float": {**base, "n": 1.0}, "bool_to_int": {**base, "flag": 0}, "int_to_bool": {**base, "n": True},
                 "list_order": {**base, "items": [3, 2, 1]}, "list_length": {**base, "items": [1, 2]}, "extra_key": {**base, "extra": 1},
                 "missing_key": {k: v for k, v in base.items() if k != "n"}, "nested": {**base, "nested": {"k": "w"}},
                 "null": {**base, "n": None}, "string_number": {**base, "n": "1"}}
        for name, changed in cases.items():
            with self.subTest(name):
                row = self.compare(self.METRICS, base, {**changed, "elapsed_seconds": 9.0})
                self.assertEqual(row["status"], "DIFFERENT")
                self.assertTrue(row["reason"])

    def test_the_whitelisted_key_must_exist_on_both_sides_as_a_plain_number(self):
        base = {"n": 1, "elapsed_seconds": 1.0}
        for name, changed in {"missing": {"n": 1}, "string": {"n": 1, "elapsed_seconds": "1.0"}, "bool": {"n": 1, "elapsed_seconds": True},
                              "object": {"n": 1, "elapsed_seconds": {"v": 1.0}}, "null": {"n": 1, "elapsed_seconds": None}}.items():
            with self.subTest(name):
                self.assertEqual(self.compare(self.METRICS, base, changed)["status"], "DIFFERENT")
                self.assertEqual(self.compare(self.METRICS, changed, base)["status"], "DIFFERENT")
        self.assertEqual(self.compare(self.METRICS, {"n": 1, "elapsed_seconds": 1}, {"n": 1, "elapsed_seconds": 2.5})["status"],
                         "SEMANTICALLY_IDENTICAL")                                  # int vs float is fine for the measurement itself

    def test_an_unparseable_whitelisted_file_is_a_difference_with_a_reason(self):
        self.put(self.a, self.METRICS, {"elapsed_seconds": 1.0})
        self.put(self.b, self.METRICS, None, text="{not json")
        row = replay.compare_artifact(self.a, self.b, self.METRICS)
        self.assertEqual(row["status"], "DIFFERENT")
        self.assertIn("not valid JSON", row["reason"])
        self.put(self.a, self.INDEX, {"metrics": {}})
        (self.b / self.INDEX).write_bytes(b"not gzip at all")
        self.assertEqual(replay.compare_artifact(self.a, self.b, self.INDEX)["status"], "DIFFERENT")

    def test_missing_files_are_reported(self):
        self.put(self.a, self.OTHER, {"x": 1})
        self.assertEqual(replay.compare_artifact(self.a, self.b, self.OTHER)["status"], "REPLAY_MISSING")
        self.assertEqual(replay.compare_artifact(self.b, self.a, self.OTHER)["status"], "ORIGINAL_MISSING")


if __name__ == "__main__":
    unittest.main()
