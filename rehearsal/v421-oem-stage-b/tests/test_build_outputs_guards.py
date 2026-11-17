"""tools/build_outputs.py must never write into (or above) a location it reads: baseline and owner data are immutable.

Needs no engine (``--no-engine``); uses the real seed data directory and tiny manifest/evidence files."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tests.helpers import ROOT

CLI = ROOT / "tools" / "build_outputs.py"


class TestOutputLocationGuard(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.campaign = self.root / "campaign"
        (self.campaign / "output").mkdir(parents=True)
        self.manifest = self.campaign / "output" / "t2_v421_manifest.json"
        self.evidence = self.campaign / "output" / "t2_v421_evidence.json"
        self.manifest.write_text(json.dumps({"schema": "m", "generation_id": "g", "sources": {}}), encoding="utf-8")
        self.evidence.write_text(json.dumps({"schema": "e", "sources": {}}), encoding="utf-8")
        self.blobs = self.root / "blobs"
        self.blobs.mkdir()

    def tearDown(self):
        self._tmp.cleanup()

    def run_cli(self, out, *extra):
        cmd = [sys.executable, "-I", str(CLI), "--as-of", "2026-11-17", "--no-engine", "--manifest", str(self.manifest),
               "--evidence", str(self.evidence), "--out", str(out), *map(str, extra)]
        return subprocess.run(cmd, capture_output=True, text=True, env=dict(os.environ))

    def assertRefused(self, proc, out):
        self.assertNotEqual(proc.returncode, 0, proc.stdout[-500:])
        self.assertIn("refusing to write outputs", proc.stderr)
        self.assertFalse((Path(out) / "oem_relations.json").exists())

    def test_output_inside_the_baseline_directory_is_refused(self):
        for out in (self.campaign / "output", self.campaign / "output" / "oem", self.campaign):
            self.assertRefused(self.run_cli(out), out)

    def test_output_above_an_input_directory_is_refused(self):
        self.assertRefused(self.run_cli(self.root), self.root)

    def test_output_inside_the_blob_root_or_the_data_directory_is_refused(self):
        self.assertRefused(self.run_cli(self.blobs / "x", "--blob-root", self.blobs), self.blobs / "x")
        data = self.root / "data"
        data.mkdir()
        for name in ("documents", "claims", "makers", "models", "aliases", "articles"):
            (data / f"{name}.json").write_text("{}", encoding="utf-8")
        self.assertRefused(self.run_cli(data / "out", "--data-dir", data), data / "out")

    def test_a_separate_output_directory_is_accepted_and_nothing_is_written_to_the_inputs(self):
        before = sorted(p.name for p in self.campaign.rglob("*"))
        out = self.root / "stage_b_out"
        proc = self.run_cli(out)
        self.assertEqual(proc.returncode, 0, proc.stderr[-800:])
        self.assertTrue((out / "oem_relations.json").is_file())
        self.assertEqual(before, sorted(p.name for p in self.campaign.rglob("*")))


if __name__ == "__main__":
    unittest.main()
