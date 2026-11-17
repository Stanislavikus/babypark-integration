"""tools/verify_scope.py on throw-away git repositories (no network, no real repository is touched)."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tests.helpers import ROOT

sys.path.insert(0, str(ROOT / "tools"))
import verify_scope as vs  # noqa: E402

GIT = shutil.which("git")
ENV = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
       "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid"}
STAGE = "rehearsal/v421-oem-stage-b"
DOCS = "docs/oem-stage-b-20261117"


@unittest.skipUnless(GIT, "git is not installed")
class TestScope(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name)
        self.git("init", "-q", "-b", "base")
        for path in ("README.md", "docs/oem-review-20261117/LOCK.md", "rehearsal/other/pr167.txt", "services/prod.cfg"):
            self.write(path, "x\n")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "base")
        self.base = self.git("rev-parse", "HEAD").stdout.strip()
        self.git("checkout", "-q", "-b", "feature")

    def tearDown(self):
        self._tmp.cleanup()

    def git(self, *args):
        proc = subprocess.run(["git", "-C", str(self.repo), *args], capture_output=True, text=True, env=ENV)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return proc

    def write(self, rel, text):
        path = self.repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def commit(self):
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "change")

    def check(self):
        return vs.check(self.repo, self.base)

    def test_changes_only_inside_the_allowed_directories_pass(self):
        self.write(f"{STAGE}/oem_stage/a.py", "a\n")
        self.write(f"{DOCS}/RESULT.md", "r\n")
        self.commit()
        report = self.check()
        self.assertEqual((report["result"], report["changed_files"], report["violations"]), ("PASS", 2, []))
        self.assertEqual(report["by_status"], {"A": 2})

    def test_a_modified_file_outside_is_reported(self):
        self.write(f"{STAGE}/a.py", "a\n")
        self.write("README.md", "changed\n")
        self.commit()
        report = self.check()
        self.assertEqual(report["result"], "FAIL")
        self.assertEqual([(v["status"], v["path"]) for v in report["violations"]], [("M", "README.md")])

    def test_deleting_or_moving_a_file_out_of_a_protected_place_is_reported(self):
        self.git("rm", "-q", "docs/oem-review-20261117/LOCK.md")
        (self.repo / STAGE).mkdir(parents=True)
        self.git("mv", "rehearsal/other/pr167.txt", f"{STAGE}/pr167_copy.txt")
        self.commit()
        report = self.check()
        paths = sorted((v["status"], v["path"]) for v in report["violations"])
        self.assertEqual(paths, [("D", "docs/oem-review-20261117/LOCK.md"), ("D", "rehearsal/other/pr167.txt")])

    def test_a_similarly_named_sibling_directory_is_outside(self):
        self.write("rehearsal/v421-oem-stage-b-extra/x.py", "x\n")
        self.write("docs/oem-stage-b-20261117-copy/x.md", "x\n")
        self.commit()
        report = self.check()
        self.assertEqual(sorted(v["path"] for v in report["violations"]),
                         ["docs/oem-stage-b-20261117-copy/x.md", "rehearsal/v421-oem-stage-b-extra/x.py"])

    def test_unsafe_paths_are_rejected(self):
        for bad in ("/etc/passwd", f"{STAGE}/../services/prod.cfg", "a\\b"):
            self.assertIsNotNone(vs.path_problem(bad), bad)
        self.assertIsNone(vs.path_problem(f"{STAGE}/x.py"))

    def test_the_head_must_descend_from_the_base(self):
        self.write(f"{STAGE}/a.py", "a\n")
        self.commit()                       # feature: one allowed change on top of the original base
        self.git("checkout", "-q", "base")
        self.write(f"{STAGE}/b.py", "b\n")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "base moved on")
        moved = self.git("rev-parse", "HEAD").stdout.strip()
        report = vs.check(self.repo, moved, "feature")   # a merge base exists, but feature does not contain `moved`
        self.assertEqual(report["result"], "FAIL")
        self.assertTrue(any("not a descendant" in v["problem"] for v in report["violations"]))
        self.assertEqual(vs.check(self.repo, self.base, "feature")["result"], "PASS")

    def test_a_head_without_a_common_history_is_an_error_not_a_pass(self):
        self.git("checkout", "-q", "--orphan", "unrelated")
        self.git("rm", "-rf", "-q", ".")
        self.write(f"{STAGE}/a.py", "a\n")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "unrelated")
        with self.assertRaises(RuntimeError):
            self.check()

    def test_cli_exit_codes(self):
        self.write(f"{STAGE}/a.py", "a\n")
        self.commit()
        ok = subprocess.run([sys.executable, "-I", str(ROOT / "tools" / "verify_scope.py"), "--repo", str(self.repo), "--base", self.base],
                            capture_output=True, text=True, env=ENV)
        self.assertEqual((ok.returncode, "SCOPE PASS" in ok.stdout), (0, True))
        self.write("services/prod.cfg", "changed\n")
        self.commit()
        bad = subprocess.run([sys.executable, "-I", str(ROOT / "tools" / "verify_scope.py"), "--repo", str(self.repo), "--base", self.base],
                             capture_output=True, text=True, env=ENV)
        self.assertEqual(bad.returncode, 1)
        self.assertIn("VIOLATION M services/prod.cfg", bad.stdout)
        err = subprocess.run([sys.executable, "-I", str(ROOT / "tools" / "verify_scope.py"), "--repo", str(self.repo), "--base", "no-such-ref"],
                             capture_output=True, text=True, env=ENV)
        self.assertEqual(err.returncode, 2)


if __name__ == "__main__":
    unittest.main()
