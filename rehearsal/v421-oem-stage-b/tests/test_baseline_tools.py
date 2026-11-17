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


def pins_for(camp: Path, **override) -> dict:
    manifest = json.loads((camp / "output" / "t2_v421_manifest.json").read_text(encoding="utf-8"))
    pins = json.loads(PINS_FILE.read_text(encoding="utf-8"))
    rows = camp / "input" / "fresh_current_catalog_records.jsonl.gz"
    pins.update({"accepted_manifest_sha256": sha(camp / "output" / "t2_v421_manifest.json"),
                 "fresh_source_rows_sha256": sha(rows), "catalog_rows": 40, "manifest_sources": 40,
                 "generation_id": manifest["generation_id"], "capture_sha256": "c" * 64,
                 "links": {"stroller": 20, "car_seat": 0, "total": 20}})
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
        cases = {"manifest_sha256": {"accepted_manifest_sha256": "0" * 64}, "fresh_source_rows_sha256": {"fresh_source_rows_sha256": "1" * 64},
                 "catalog_rows": {"catalog_rows": 41}, "manifest_sources": {"manifest_sources": 39},
                 "generation_id": {"generation_id": "other"}, "capture_sha256": {"capture_sha256": "d" * 64},
                 "manifest_accessory_edges_total": {"links": {"stroller": 20, "car_seat": 0, "total": 21}},
                 "links_by_source_head": {"links": {"stroller": 19, "car_seat": 1, "total": 20}}}
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


class TestReplayWrapper(unittest.TestCase):
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
        for key in ("FAKE_VARIANT", "FAKE_GENERATION"):
            os.environ.pop(key, None)
        self.tmp.cleanup()

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


if __name__ == "__main__":
    unittest.main()
