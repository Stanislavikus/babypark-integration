"""tools/files_manifest.py on a throw-away repository layout."""
from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tests.helpers import ROOT

sys.path.insert(0, str(ROOT / "tools"))
import files_manifest as fm  # noqa: E402


class TestManifest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name)
        for rel, text in (("rehearsal/v421-oem-stage-b/a.py", "a\n"), ("rehearsal/v421-oem-stage-b/sub/b.json", "{}\n"),
                          ("docs/oem-stage-b-20261117/R.md", "r\n"), ("README.md", "outside\n"),
                          ("rehearsal/v421-oem-stage-b/__pycache__/a.cpython-313.pyc", "x"),
                          ("rehearsal/v421-oem-stage-b/blobs/ab/abcd", "blob"), ("rehearsal/v421-oem-stage-b/.hypothesis/x", "h")):
            path = self.repo / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")

    def tearDown(self):
        self._tmp.cleanup()

    def run_cli(self, mode):
        return subprocess.run([sys.executable, "-I", str(ROOT / "tools" / "files_manifest.py"), mode, "--repo", str(self.repo)],
                              capture_output=True, text=True)

    def test_collect_covers_only_the_two_scopes_and_skips_caches(self):
        self.assertEqual(sorted(fm.collect(self.repo)), ["docs/oem-stage-b-20261117/R.md", "rehearsal/v421-oem-stage-b/a.py",
                                                         "rehearsal/v421-oem-stage-b/sub/b.json"])

    def test_write_then_check_passes_and_the_format_is_sha256sum_compatible(self):
        self.assertEqual(self.run_cli("--write").returncode, 0)
        manifest = (self.repo / fm.MANIFEST_REL).read_text(encoding="utf-8")
        self.assertTrue(manifest.endswith("\n"))
        self.assertEqual(sorted(fm.parse(manifest)), sorted(fm.collect(self.repo)))
        proc = subprocess.run(["sha256sum", "-c", "--quiet", str(self.repo / fm.MANIFEST_REL)], cwd=self.repo, capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        ok = self.run_cli("--check")
        self.assertEqual((ok.returncode, "MANIFEST PASS" in ok.stdout), (0, True))

    def test_any_edit_addition_or_removal_is_detected(self):
        self.run_cli("--write")
        (self.repo / "rehearsal/v421-oem-stage-b/a.py").write_text("changed\n", encoding="utf-8")
        bad = self.run_cli("--check")
        self.assertEqual(bad.returncode, 1)
        self.assertIn("digest differs: rehearsal/v421-oem-stage-b/a.py", bad.stdout)
        self.run_cli("--write")
        (self.repo / "docs/oem-stage-b-20261117/new.md").write_text("n\n", encoding="utf-8")
        self.assertIn("not in manifest: docs/oem-stage-b-20261117/new.md", self.run_cli("--check").stdout)
        (self.repo / "docs/oem-stage-b-20261117/new.md").unlink()
        (self.repo / "docs/oem-stage-b-20261117/R.md").unlink()
        self.assertIn("missing from disk: docs/oem-stage-b-20261117/R.md", self.run_cli("--check").stdout)

    def test_a_missing_or_malformed_manifest_is_an_error(self):
        self.assertEqual(self.run_cli("--check").returncode, 2)
        (self.repo / fm.MANIFEST_REL).parent.mkdir(parents=True, exist_ok=True)
        (self.repo / fm.MANIFEST_REL).write_text("not a manifest\n", encoding="utf-8")
        self.assertEqual(self.run_cli("--check").returncode, 2)

    def test_the_manifest_does_not_list_itself(self):
        self.run_cli("--write")
        self.assertNotIn(fm.MANIFEST_REL, fm.parse((self.repo / fm.MANIFEST_REL).read_text(encoding="utf-8")))


if __name__ == "__main__":
    unittest.main()
