"""The mutation harness (tools/mutation_check.py) must not be able to fake a kill.

A first draft of the harness put ``--failfast`` before ``discover``: unittest then exited with a usage error for EVERY mutant, and a harness that
took "exit code != 0" for "the tests noticed the mutation" reported 55 of 55 mutants killed without a single test having run. These tests pin that
down: an exit code alone is never a kill; only real failing tests of the behaviour are; a broken run is INVALID. The end-to-end cases run the real
``run_mutant`` / ``_run_suite`` on a tiny throw-away project (no engine, a second or two). This module is excluded from the mutant runs themselves.
"""
from __future__ import annotations

import contextlib
import io
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tests.helpers import ROOT

sys.path.insert(0, str(ROOT / "tools"))
import mutation_check as mc  # noqa: E402

PASSED_OUT = "....\n----------------------------------------------------------------------\nRan 5 tests in 0.010s\n\nOK (skipped=1)\n"
FAILED_OUT = ("F\n======================================================================\n"
              "FAIL: test_x (tests.test_gate.TestPolicy.test_x)\nAssertionError\n"
              "----------------------------------------------------------------------\nRan 3 tests in 0.010s\n\nFAILED (failures=1)\n")
USAGE_OUT = "usage: python -m unittest [-h] [-v] [-q] [--locals] [-f] [-c] [-b] [-k TESTNAMEPATTERNS]\npython -m unittest: error: unrecognized arguments: -s tests\n"
IMPORT_OUT = ("E\n======================================================================\n"
              "ERROR: test_a (unittest.loader._FailedTest.test_a)\nImportError: Failed to import test module: test_a\n"
              "----------------------------------------------------------------------\nRan 1 test in 0.000s\n\nFAILED (errors=1)\n")


class TestOutcomeParsing(unittest.TestCase):
    def test_a_clean_run_passes_and_counts_tests_and_skips(self):
        self.assertEqual(mc.parse_outcome(0, PASSED_OUT), {"verdict": "PASSED", "tests": 5, "skipped": 1, "failing": []})

    def test_real_failures_are_the_only_thing_that_kills(self):
        out = mc.parse_outcome(1, FAILED_OUT)
        self.assertEqual((out["verdict"], out["failing"]), ("FAILED", ["test_gate.TestPolicy.test_x"]))

    def test_a_usage_error_is_broken_not_a_kill(self):
        out = mc.parse_outcome(2, USAGE_OUT)
        self.assertEqual(out["verdict"], "BROKEN")
        self.assertIn("no tests ran", out["why"])

    def test_an_import_failure_is_broken_not_a_kill(self):
        out = mc.parse_outcome(1, IMPORT_OUT)
        self.assertEqual((out["verdict"], out["why"]), ("BROKEN", "a test module failed to import"))

    def test_other_non_zero_exits_without_failing_tests_are_broken(self):
        self.assertEqual(mc.parse_outcome(1, "")["verdict"], "BROKEN")
        self.assertEqual(mc.parse_outcome(1, "Ran 4 tests in 0.1s\n\nFAILED (failures=1)\n")["verdict"], "BROKEN")   # no FAIL: line to name
        self.assertEqual(mc.parse_outcome(0, "")["verdict"], "BROKEN")                                              # exit 0 but nothing ran
        self.assertEqual(mc.parse_outcome(0, "Ran 0 tests in 0.0s\n\nOK\n")["verdict"], "BROKEN")

    def test_the_seam_consistency_tests_are_not_behavioural(self):
        ids = ["test_seam.TestSeamFilesAreConsistent.test_the_build_tool_check_passes", "test_seam.TestSeamHelpers.test_merge",
               "test_seam.TestSeamFilesAreConsistent.test_the_pins_equal_the_files_and_the_accepted_engine_file"]
        self.assertEqual(mc.behavioural(ids), ["test_seam.TestSeamHelpers.test_merge"])

    def test_the_failfast_flag_comes_after_the_discover_sub_command(self):
        cmd = mc.suite_command(True)
        self.assertGreater(cmd.index("--failfast"), cmd.index("discover"))
        self.assertNotIn("--failfast", mc.suite_command(False))


class TestMutantsAreWellFormed(unittest.TestCase):
    def test_every_snippet_occurs_exactly_once_and_ids_are_unique(self):
        self.assertEqual(mc.snippet_problems(mc.ALL), [])

    def test_every_mutant_changes_the_text_and_says_which_rule_it_breaks(self):
        for mid, rel, old, new, why in mc.ALL:
            self.assertNotEqual(old, new, mid)
            self.assertTrue(why.strip(), mid)
            self.assertTrue((ROOT / rel).is_file(), mid)

    SEAM_PREFIXES = ("M-", "V-", "H-", "I-", "C-")   # M: ledger/merge wiring, V: engine-side envelope validator, H: the existing per-edge engine gates,
                                                      # I: source identity (C-R1), C: adapter crossing (C-R2)

    def test_seam_mutants_target_the_patched_seam_file_only(self):
        seam = [m for m in mc.ALL if m[0].startswith(self.SEAM_PREFIXES)]
        self.assertTrue(seam)
        self.assertEqual({m[0][:2] for m in seam}, set(self.SEAM_PREFIXES))              # every family is present
        self.assertEqual({m[1] for m in seam}, {mc.SEAM})
        self.assertEqual({m[1] for m in mc.ALL if not m[0].startswith(self.SEAM_PREFIXES)} & {mc.SEAM}, set())


class TestRunMutantEndToEnd(unittest.TestCase):
    """The real run_mutant on a tiny project: a behavioural change is KILLED, a harmless one SURVIVES, a broken one is INVALID."""

    LIB = "def positive(x):\n    return x > 0\n\n\ndef label(x):\n    return 'pos' if positive(x) else 'non-pos'\n"
    SEAM_SRC = "MARK = 'ORIGINAL'\n\n\ndef value():\n    return 1\n"

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        self.mini = base / "mini"
        (self.mini / "tests").mkdir(parents=True)
        (self.mini / "engine_seam").mkdir()
        (self.mini / "tests" / "__init__.py").write_text("", encoding="utf-8")
        (self.mini / "lib.py").write_text(self.LIB, encoding="utf-8")
        (self.mini / "engine_seam" / "accessory_v4_stage_c.py").write_text(self.SEAM_SRC, encoding="utf-8")
        (self.mini / "engine_seam" / "ENGINE_SEAM_PINS.json").write_text('{"patched_sha256": "x"}\n', encoding="utf-8")
        (self.mini / "tests" / "test_lib.py").write_text(
            "import unittest\nimport lib\n\n\nclass TestLib(unittest.TestCase):\n"
            "    def test_boundary(self):\n        self.assertFalse(lib.positive(0))\n        self.assertTrue(lib.positive(1))\n"
            "    def test_label(self):\n        self.assertEqual(lib.label(2), 'pos')\n", encoding="utf-8")
        (self.mini / "tests" / "test_seam.py").write_text(
            "import importlib.util\nimport pathlib\nimport unittest\n\n"
            "def load():\n    p = pathlib.Path(__file__).resolve().parents[1] / 'engine_seam' / 'accessory_v4_stage_c.py'\n"
            "    spec = importlib.util.spec_from_file_location('seam_under_test', p)\n    mod = importlib.util.module_from_spec(spec)\n"
            "    spec.loader.exec_module(mod)\n    return mod\n\n\n"
            "class TestSeamFilesAreConsistent(unittest.TestCase):\n    def test_the_build_tool_check_passes(self):\n"
            "        self.assertEqual(load().MARK, 'ORIGINAL')\n\n\n"
            "class TestSeamBehaviour(unittest.TestCase):\n    def test_value(self):\n        self.assertEqual(load().value(), 1)\n", encoding="utf-8")
        self.stage_b = base / "stage_b"
        self.stage_b.mkdir()
        self.patches = [mock.patch.object(mc, "ROOT", self.mini), mock.patch.object(mc, "STAGE_B", self.stage_b),
                        mock.patch.object(mc, "REPO", base / "repo"), mock.patch.object(mc, "DOC_DIRS", ())]
        for patch in self.patches:
            patch.start()

    def tearDown(self):
        for patch in self.patches:
            patch.stop()
        self._tmp.cleanup()

    def run_one(self, rel, old, new, failfast=False):
        return mc.run_mutant(("T-01", rel, old, new, "a test rule"), {}, failfast=failfast)

    def test_the_unmutated_mini_project_passes(self):
        tmp, work = mc._copy_project()
        try:
            out = mc.parse_outcome(*mc._judge_inputs(mc._run_suite(work, {})))
        finally:
            tmp.cleanup()
        self.assertEqual((out["verdict"], out["tests"]), ("PASSED", 4), out)

    def test_the_copy_keeps_the_committed_real_view_and_leaves_the_rest_of_out_behind(self):
        for name, text in (("real_relations/relation_decisions.json", "{}"), ("MUTATION_CHECK.json", "{}"), ("scratch/x.txt", "x")):
            path = self.mini / "out" / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        tmp, work = mc._copy_project()
        try:
            self.assertEqual(sorted(p.name for p in (work / "out").iterdir()), ["real_relations"])
            self.assertTrue((work / "out" / "real_relations" / "relation_decisions.json").is_file())
        finally:
            tmp.cleanup()

    def test_a_behavioural_change_is_killed_with_and_without_failfast(self):
        for failfast in (False, True):
            res = self.run_one("lib.py", "x > 0", "x >= 0", failfast)
            self.assertEqual(res["status"], "KILLED", res)
            self.assertIn("test_lib.TestLib.test_boundary", res["killed_by"])

    def test_a_change_no_test_notices_survives(self):
        res = self.run_one("lib.py", "'non-pos'", "'not positive'")
        self.assertEqual(res["status"], "SURVIVED", res)

    def test_a_snippet_that_is_missing_or_ambiguous_is_invalid(self):
        self.assertEqual(self.run_one("lib.py", "no such text", "x")["status"], "INVALID")
        self.assertEqual(self.run_one("lib.py", "positive", "x")["status"], "INVALID")             # occurs three times

    def test_a_mutant_that_breaks_the_import_is_invalid_not_killed(self):
        res = self.run_one("lib.py", "return x > 0", "return x >", failfast=True)
        self.assertEqual(res["status"], "INVALID", res)
        self.assertIn("broken run", res["detail"])

    def test_a_seam_change_that_only_the_consistency_test_notices_survives(self):
        res = self.run_one(mc.SEAM, "MARK = 'ORIGINAL'", "MARK = 'EDITED'", failfast=True)
        self.assertEqual(res["status"], "SURVIVED", res)
        self.assertIn("only the seam-consistency tests", res["detail"])

    def test_a_behavioural_seam_change_is_killed_by_the_behavioural_test(self):
        res = self.run_one(mc.SEAM, "    return 1\n", "    return 2\n", failfast=True)
        self.assertEqual(res["status"], "KILLED", res)
        self.assertEqual(res["killed_by"], ["test_seam.TestSeamBehaviour.test_value"])

    def test_the_seam_pin_is_rewritten_in_the_copy_only(self):
        pins = self.mini / "engine_seam" / "ENGINE_SEAM_PINS.json"
        before = pins.read_text(encoding="utf-8")
        self.run_one(mc.SEAM, "    return 1\n", "    return 2\n")
        self.assertEqual(pins.read_text(encoding="utf-8"), before)
        self.assertIn("return 1", (self.mini / "engine_seam" / "accessory_v4_stage_c.py").read_text(encoding="utf-8"))

    def test_the_old_command_line_bug_would_have_looked_like_a_kill_without_the_guard(self):
        """Documents the defect: --failfast before discover exits non-zero although no test ran."""
        tmp, work = mc._copy_project()
        try:
            bad = subprocess.run([sys.executable, "-B", "-m", "unittest", "--failfast", "discover", "-s", "tests", "-t", "."],
                                 cwd=work, capture_output=True, text=True, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
        finally:
            tmp.cleanup()
        self.assertNotEqual(bad.returncode, 0)
        self.assertEqual(mc.parse_outcome(bad.returncode, bad.stderr + bad.stdout)["verdict"], "BROKEN")


class TestMainRefusals(unittest.TestCase):
    @staticmethod
    def quiet_main(argv):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return mc.main(argv)

    def test_an_unknown_mutant_id_is_refused(self):
        self.assertEqual(self.quiet_main(["--only", "NO-SUCH-ID"]), 2)

    def test_without_the_engine_nothing_runs(self):
        with mock.patch.dict(os.environ, {"BP_V421_ENGINE_ROOT": "/nonexistent/engine_root"}):        # also true on a host whose default root exists
            self.assertEqual(self.quiet_main(["--only", "G-01"]), 2)

    def test_validate_only_passes_on_the_real_mutants(self):
        self.assertEqual(self.quiet_main(["--validate-only"]), 0)


if __name__ == "__main__":
    unittest.main()
