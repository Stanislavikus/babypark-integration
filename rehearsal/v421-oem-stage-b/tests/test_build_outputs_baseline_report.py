"""B-R4: safe execution of tools/build_outputs.py with a baseline report.

1. The output-location guard must tell a protected DIRECTORY / baseline-data file from an auxiliary control file (the baseline report, the
   owner allow-list) that merely sits in a shared scratch directory such as /tmp: ``--out /tmp/stage_out`` next to
   ``--baseline-report /tmp/baseline_verification.json`` is legitimate; writing into the baseline data's own directories is still refused,
   and no output file may ever replace (symlink/hardlink onto) an input file.
2. A ``--baseline-report`` is evidence that the inputs are the accepted ones: a report with ``result: FAIL`` (or any failing check, a wrong
   schema, an unreadable file, digests that do not match THIS build's rows/manifest/evidence, or no rows/manifest/evidence to bind to) must
   stop the build before anything is written (exit code 3) - never a green build with a failed baseline embedded.
3. The imported legacy modules must be the accepted bytes from an approved location (exit code 4), checked before anything is written.

Refusal paths need no engine (the baseline gate runs before the engine is imported); acceptance paths use the real engine and the mini catalog."""
from __future__ import annotations

import contextlib
import copy
import gzip
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from oem_stage import baseline_gate, engine_env, outputs
from tests.helpers import ROOT, require_engine

sys.path.insert(0, str(ROOT / "tools"))
import build_outputs  # noqa: E402
import verify_baseline as vb  # noqa: E402

CLI = ROOT / "tools" / "build_outputs.py"
AS_OF = "2026-11-17"
SCHEMA = "bp-oem-baseline-verification-v1"


def sha(path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run_cli(*args, check=False):
    proc = subprocess.run([sys.executable, "-I", str(CLI), *map(str, args)], capture_output=True, text=True, env=dict(os.environ),
                          cwd=str(ROOT), timeout=300)
    if check and proc.returncode != 0:
        raise AssertionError(f"CLI failed ({proc.returncode}):\n{proc.stdout[-1500:]}\n{proc.stderr[-3000:]}")
    return proc


def make_report(rows, manifest, evidence, *, result="PASS", checks=None, **override) -> dict:
    """A verifier-shaped report bound (by digest) to the three given files."""
    names = ("manifest_sha256", "fresh_source_rows_sha256", "generation_id", "catalog_rows", "links_by_source_head")
    report = {"schema": SCHEMA, "result": result, "read_only": True,
              "checks": checks if checks is not None else [{"check": n, "status": "PASS", "expected": 1, "observed": 1, "note": ""} for n in names],
              "files": {"rows": {"name": Path(rows).name, "sha256": sha(rows), "bytes": Path(rows).stat().st_size},
                        "manifest": {"name": Path(manifest).name, "sha256": sha(manifest), "bytes": Path(manifest).stat().st_size},
                        "evidence": {"name": Path(evidence).name, "sha256": sha(evidence), "bytes": Path(evidence).stat().st_size}}}
    report.update(override)
    return report


class Inputs:
    """Tiny corrected-generation-like inputs (bytes only; the gate and the guard never parse them) next to a shared scratch parent."""

    def __init__(self, base: Path):
        self.base = base
        self.campaign = base / "campaign"
        (self.campaign / "input").mkdir(parents=True)
        (self.campaign / "output").mkdir()
        self.rows = self.campaign / "input" / "fresh_current_catalog_records.jsonl.gz"
        with gzip.GzipFile(self.rows, "wb", mtime=0) as handle:
            handle.write(b'{"nid":1}\n')
        self.manifest = self.campaign / "output" / "t2_v421_manifest.json"
        self.evidence = self.campaign / "output" / "t2_v421_evidence.json"
        self.manifest.write_text(json.dumps({"schema": "m", "generation_id": "g", "sources": {}}), encoding="utf-8")
        self.evidence.write_text(json.dumps({"schema": "e", "sources": {}}), encoding="utf-8")
        self.scratch = base / "scratch"                      # the shared parent (the /tmp of the reviewer's run)
        self.scratch.mkdir()
        self.report_path = self.scratch / "baseline_verification.json"

    def write_report(self, **kw) -> dict:
        report = make_report(self.rows, self.manifest, self.evidence, **kw)
        self.report_path.write_text(json.dumps(report), encoding="utf-8")
        return report

    def args(self, out, *extra):
        return ["--as-of", AS_OF, "--rows", self.rows, "--manifest", self.manifest, "--evidence", self.evidence,
                "--baseline-report", self.report_path, "--out", out, *extra]


class CaseWithInputs(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name)
        self.inp = Inputs(self.base)

    def tearDown(self):
        self._tmp.cleanup()

    def assertRefusedWith(self, proc, code, *needles):
        self.assertEqual(proc.returncode, code, (proc.stdout[-600:], proc.stderr[-1500:]))
        for needle in needles:
            self.assertIn(needle, proc.stderr)


class TestBaselineGateRules(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.inp = Inputs(Path(self._tmp.name))
        self.good = make_report(self.inp.rows, self.inp.manifest, self.inp.evidence)

    def tearDown(self):
        self._tmp.cleanup()

    def problems(self, report):
        return baseline_gate.problems(report, rows=self.inp.rows, manifest=self.inp.manifest, evidence=self.inp.evidence)

    def test_the_schema_constant_is_the_one_the_verifier_writes(self):
        self.assertEqual(baseline_gate.SCHEMA, SCHEMA)
        report = vb.verify(self.inp.campaign / "input", self.inp.campaign / "output", {
            "accepted_manifest_sha256": "0" * 64, "generation_id": "g", "manifest_schema": "m", "manifest_sources": 0, "evidence_schema": "e",
            "links": {"stroller": 0, "total": 0}, "not_this_generation": {"manifest_sources": -1, "catalog_rows": -1},
            "fresh_source_rows_sha256": "1" * 64, "catalog_rows": 1, "capture_sha256": "c" * 64})
        self.assertEqual(report["schema"], baseline_gate.SCHEMA)

    def test_a_bound_passing_report_is_acceptable(self):
        self.assertEqual(self.problems(self.good), [])

    def test_a_failing_report_is_refused_and_names_the_failed_checks(self):
        report = copy.deepcopy(self.good)
        report["result"] = "FAIL"
        report["checks"][2]["status"] = "FAIL"
        report["checks"][4]["status"] = "FAIL"
        found = self.problems(report)
        self.assertTrue(found)
        joined = " | ".join(found)
        self.assertIn("BASELINE FAIL", joined)
        self.assertIn("generation_id", joined)
        self.assertIn("links_by_source_head", joined)

    def test_a_pass_label_cannot_hide_a_failed_check(self):
        report = copy.deepcopy(self.good)
        report["checks"][0]["status"] = "FAIL"
        self.assertTrue(any("manifest_sha256" in p for p in self.problems(report)))

    def test_structural_problems_are_refused(self):
        cases = {"not_a_dict": [1, 2], "wrong_schema": {**self.good, "schema": "other"}, "no_schema": {k: v for k, v in self.good.items() if k != "schema"},
                 "result_fail_while_every_check_passes": {**self.good, "result": "FAIL"},
                 "result_missing": {k: v for k, v in self.good.items() if k != "result"}, "result_lower": {**self.good, "result": "pass"},
                 "not_read_only": {**self.good, "read_only": False}, "read_only_missing": {k: v for k, v in self.good.items() if k != "read_only"},
                 "no_checks": {**self.good, "checks": []}, "checks_not_list": {**self.good, "checks": "x"},
                 "check_not_dict": {**self.good, "checks": ["PASS"]}, "no_files": {k: v for k, v in self.good.items() if k != "files"},
                 "required_check_missing": {**self.good, "checks": [c for c in self.good["checks"] if c["check"] != "manifest_sha256"]},
                 "rows_check_missing": {**self.good, "checks": [c for c in self.good["checks"] if c["check"] != "fresh_source_rows_sha256"]}}
        for name, report in cases.items():
            with self.subTest(name):
                self.assertTrue(self.problems(report), name)

    def test_the_report_must_describe_exactly_these_inputs(self):
        for key in ("rows", "manifest", "evidence"):
            with self.subTest(key):
                report = copy.deepcopy(self.good)
                report["files"][key]["sha256"] = "f" * 64
                found = self.problems(report)
                self.assertEqual(len(found), 1, found)
                self.assertIn(key, found[0])
                self.assertIn("does not match", found[0])
                report = copy.deepcopy(self.good)
                del report["files"][key]
                self.assertTrue(self.problems(report))

    def test_a_changed_input_after_verification_is_detected(self):
        self.inp.manifest.write_text(json.dumps({"schema": "m", "generation_id": "g", "sources": {"1": {}}}), encoding="utf-8")
        self.assertTrue(any("manifest" in p and "does not match" in p for p in self.problems(self.good)))

    def test_missing_inputs_cannot_be_bound(self):
        found = baseline_gate.problems(self.good, rows=None, manifest=self.inp.manifest, evidence=self.inp.evidence)
        self.assertTrue(any("--rows" in p for p in found), found)
        found = baseline_gate.problems(self.good, rows=self.inp.rows, manifest=None, evidence=None)
        self.assertEqual(sum("--manifest" in p or "--evidence" in p for p in found), 2, found)

    def test_a_report_written_by_the_real_verifier_on_real_shapes_is_accepted_and_a_failing_one_is_not(self):
        """End to end with the REAL verifier on the realistic fixture (sparse evidence, A/B/T2 metrics): PASS is accepted, a mutated pin gives
        BASELINE FAIL and is refused."""
        from tests.test_baseline_tools import pins_for, write_campaign
        with tempfile.TemporaryDirectory() as tmp:
            camp = write_campaign(Path(tmp))
            args = (camp / "input", camp / "output")
            rows, manifest, evidence = camp / "input" / vb.ROWS_FILE, camp / "output" / vb.MANIFEST_FILE, camp / "output" / vb.EVIDENCE_FILE
            good = vb.verify(*args, pins_for(camp), camp)
            self.assertEqual(good["result"], "PASS")
            self.assertEqual(baseline_gate.problems(good, rows=rows, manifest=manifest, evidence=evidence), [])
            bad = vb.verify(*args, pins_for(camp, catalog_rows=41), camp)
            self.assertEqual(bad["result"], "FAIL")
            found = baseline_gate.problems(bad, rows=rows, manifest=manifest, evidence=evidence)
            self.assertTrue(found and any("catalog_rows" in p for p in found), found)


class TestOutputGuardDistinguishesFilesFromDirectories(CaseWithInputs):
    def seed_args(self, out, *extra):
        return ["--as-of", AS_OF, "--no-engine", "--out", out, *extra]

    def allow_list(self):
        path = self.base / "scratch" / "allow_list.json"
        path.write_text("[]", encoding="utf-8")
        return path

    def test_an_auxiliary_file_in_a_shared_parent_does_not_block_a_sibling_or_child_output_directory(self):
        allow = self.allow_list()
        for out in (self.scratch_out("stage_b_rehearsal_out"), self.scratch_out("deeper/stage_out")):
            proc = run_cli(*self.seed_args(out, "--allow-list", allow))
            self.assertEqual(proc.returncode, 0, proc.stderr[-1500:])
            self.assertTrue((out / "oem_relations.json").is_file())
        self.assertEqual(allow.read_text(encoding="utf-8"), "[]")

    def scratch_out(self, rel) -> Path:
        return self.base / "scratch" / rel

    def test_an_output_ancestor_of_an_auxiliary_file_does_not_touch_it(self):
        nested = self.base / "scratch" / "inner"
        nested.mkdir()
        allow = nested / "allow_list.json"
        allow.write_text("[]", encoding="utf-8")
        out = self.base / "scratch"
        proc = run_cli(*self.seed_args(out, "--allow-list", allow))
        self.assertEqual(proc.returncode, 0, proc.stderr[-1500:])
        self.assertEqual(allow.read_text(encoding="utf-8"), "[]")

    def test_outputs_are_never_mixed_into_the_directory_of_an_auxiliary_file(self):
        allow = self.allow_list()
        proc = run_cli(*self.seed_args(allow.parent, "--allow-list", allow))
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("refusing to write outputs", proc.stderr)
        self.assertFalse((allow.parent / "oem_relations.json").exists())
        self.assertEqual(allow.read_text(encoding="utf-8"), "[]")

    def test_an_output_path_that_resolves_onto_an_input_file_is_refused(self):
        out = self.base / "stage_out"
        out.mkdir()
        before = self.inp.evidence.read_bytes()
        link = out / "oem_relations.json"
        os.symlink(self.inp.evidence, link)                                 # symlink onto baseline data
        proc = run_cli(*self.seed_args(out, "--manifest", self.inp.manifest, "--evidence", self.inp.evidence))
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("would overwrite an input file", proc.stderr)
        self.assertEqual(self.inp.evidence.read_bytes(), before)
        link.unlink()
        os.link(self.inp.manifest, out / "review_queue.json")             # hardlink onto baseline data
        before = self.inp.manifest.read_bytes()
        proc = run_cli(*self.seed_args(out, "--manifest", self.inp.manifest, "--evidence", self.inp.evidence))
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("would overwrite an input file", proc.stderr)
        self.assertEqual(self.inp.manifest.read_bytes(), before)

    def test_the_planned_names_are_exactly_what_a_real_run_writes(self):
        for label in (None, "synthetic_demo"):
            out = self.base / f"plan_{label}"
            args = self.seed_args(out) + (["--label", label] if label else [])
            self.assertEqual(run_cli(*args).returncode, 0)
            self.assertEqual(sorted(p.name for p in out.iterdir()), outputs.planned_file_names(label))


class TestBaselineReportRefusalsNeedNoEngine(CaseWithInputs):
    """The gate runs before anything else: nothing is written and the engine is not even imported."""

    def out(self):
        return self.base / "stage_out"

    def refused(self, *needles, code=3):
        proc = run_cli(*self.inp.args(self.out()))
        self.assertRefusedWith(proc, code, *needles)
        self.assertFalse(self.out().exists(), "no output directory may be created for a refused build")
        return proc

    def test_a_failed_baseline_report_is_refused_with_the_failed_checks_named(self):
        checks = [{"check": "evidence_sources_match_manifest", "status": "FAIL", "expected": 8129, "observed": 591, "note": ""},
                  {"check": "links_by_source_head", "status": "FAIL", "expected": {}, "observed": {}, "note": ""},
                  {"check": "manifest_sha256", "status": "PASS", "expected": 1, "observed": 1, "note": ""},
                  {"check": "fresh_source_rows_sha256", "status": "PASS", "expected": 1, "observed": 1, "note": ""}]
        self.inp.write_report(result="FAIL", checks=checks)
        self.refused("BASELINE FAIL", "evidence_sources_match_manifest", "links_by_source_head", "no outputs were written")

    def test_a_label_of_pass_cannot_hide_a_failed_check(self):
        report = self.inp.write_report()
        report["checks"][1]["status"] = "FAIL"
        self.inp.report_path.write_text(json.dumps(report), encoding="utf-8")
        self.refused("fresh_source_rows_sha256")

    def test_an_unreadable_or_wrong_report_is_refused(self):
        self.inp.report_path.write_text("{not json", encoding="utf-8")
        self.refused("not valid JSON")
        self.inp.report_path.write_text(json.dumps({"schema": "something-else", "result": "PASS"}), encoding="utf-8")
        self.refused("schema")
        self.inp.report_path.unlink()
        self.refused("cannot be read")

    def test_a_report_for_other_inputs_is_refused(self):
        report = self.inp.write_report()
        report["files"]["manifest"]["sha256"] = "9" * 64
        self.inp.report_path.write_text(json.dumps(report), encoding="utf-8")
        self.refused("manifest", "does not match")
        self.inp.write_report()
        self.inp.manifest.write_text(json.dumps({"schema": "m", "generation_id": "g", "sources": {"changed": {}}}), encoding="utf-8")
        self.refused("manifest", "does not match")

    def test_a_baseline_report_needs_rows_manifest_and_evidence_to_bind_to(self):
        self.inp.write_report()
        proc = run_cli("--as-of", AS_OF, "--no-engine", "--baseline-report", self.inp.report_path, "--out", self.out())
        self.assertRefusedWith(proc, 3, "--rows", "--manifest", "--evidence")
        self.assertFalse(self.out().exists())

    def test_a_missing_report_file_is_an_error_not_silently_ignored(self):
        proc = run_cli(*self.inp.args(self.out()))
        self.assertRefusedWith(proc, 3, "cannot be read")


class TestEngineGate(unittest.TestCase):
    """build_outputs refuses (exit code 4) before writing when the engine modules it imported are not the accepted bytes from an approved place."""

    def test_the_gate_accepts_accepted_modules_and_refuses_everything_else(self):
        import types
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "engine_root"
            src = root / "work/accessories/src"
            src.mkdir(parents=True)
            good = {}
            for name in ("canonical_models", "v32_pipeline"):
                (src / f"{name}.py").write_bytes(b"# synthetic\n")
                good[name] = types.SimpleNamespace(__file__=str(src / f"{name}.py"))
            accepted = {name: hashlib.sha256(b"# synthetic\n").hexdigest() for name in good}
            rows = build_outputs.require_accepted_engine_modules(root, ("canonical_models", "v32_pipeline"), modules=good, accepted=accepted,
                                                                  approved_dirs=[src])
            self.assertEqual([r["status"] for r in rows], ["PASS", "PASS"])
            (src / "v32_pipeline.py").write_bytes(b"# tampered\n")
            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr), self.assertRaises(SystemExit) as caught:
                build_outputs.require_accepted_engine_modules(root, ("canonical_models", "v32_pipeline"), modules=good, accepted=accepted,
                                                              approved_dirs=[src])
            self.assertEqual(caught.exception.code, 4)
            self.assertIn("v32_pipeline", stderr.getvalue())
            self.assertIn("MISMATCH", stderr.getvalue())
            self.assertIn("no outputs were written", stderr.getvalue())
            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr), self.assertRaises(SystemExit) as caught:   # never imported: cannot be vouched for
                build_outputs.require_accepted_engine_modules(root, ("canonical_models", "v32_pipeline"), modules={}, accepted=accepted,
                                                              approved_dirs=[src])
            self.assertEqual(caught.exception.code, 4)
            self.assertIn("not imported", stderr.getvalue())


@require_engine
class TestRehearsalModeWithTheRealEngine(unittest.TestCase):
    """Acceptance and engine-provenance paths through the real CLI on the real-engine mini catalog (synthetic OEM world, flagged)."""

    @classmethod
    def setUpClass(cls):
        from tests import mini_catalog as mc
        from tests import synthetic_world as sw
        cls.tmp = tempfile.TemporaryDirectory()
        cls.base = Path(cls.tmp.name)
        cls.mini = mc.build(cls.base / "input")
        cls.world = sw.build(cls.base / "world_blobs")
        sw.extend_for_catalog(cls.world)
        sw.dump(cls.world, cls.base / "data")
        cls.args = ["--data-dir", cls.base / "data", "--blob-root", cls.base / "world_blobs" / "blobs", "--as-of", AS_OF,
                    "--rows", cls.mini.rows_path, "--manifest", cls.mini.manifest_path, "--evidence", cls.mini.evidence_path,
                    "--index", cls.mini.index_path, "--allow-synthetic", "--label", "synthetic_demo"]
        cls.scratch = cls.base / "scratch"                                  # shared parent of the report and the output directory
        cls.scratch.mkdir()

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def report_path(self, **kw) -> Path:
        path = self.scratch / "baseline_verification.json"
        path.write_text(json.dumps(make_report(self.mini.rows_path, self.mini.manifest_path, self.mini.evidence_path, **kw)), encoding="utf-8")
        return path

    def load(self, out, name):
        return json.loads((Path(out) / name).read_text(encoding="utf-8"))

    def test_the_documented_rehearsal_command_runs_with_the_report_next_to_the_output_directory(self):
        """The reviewer's exact layout: --baseline-report in a shared parent, --out a separate directory in that parent."""
        out = self.scratch / "stage_b_rehearsal_out"
        proc = run_cli(*self.args, "--baseline-report", self.report_path(), "--out", out)
        self.assertEqual(proc.returncode, 0, proc.stderr[-2000:])
        report = self.load(out, "oem_vs_current_report.synthetic_demo.json")
        self.assertEqual(report["baseline"]["result"], "PASS")
        self.assertEqual(report["baseline"]["files"]["rows"]["sha256"], sha(self.mini.rows_path))
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["baseline_verification"], "PASS (embedded)")
        self.assertEqual({r["status"] for r in summary["engine_provenance"]}, {"PASS"})
        self.assertEqual(sorted(r["module"] for r in summary["engine_provenance"]), ["canonical_models", "v32_pipeline"])   # both were checked
        self.assertEqual(sorted(p.name for p in out.iterdir()), outputs.planned_file_names("synthetic_demo"))

    def test_the_baseline_data_directories_stay_protected_even_with_a_valid_report(self):
        report = self.report_path()
        for out in (self.base / "input", self.base / "input" / "oem", self.base):
            proc = run_cli(*self.args, "--baseline-report", report, "--out", out)
            self.assertNotEqual(proc.returncode, 0, out)
            self.assertIn("refusing to write outputs", proc.stderr, out)
            self.assertFalse((out / "oem_relations.synthetic_demo.json").exists(), out)

    def test_the_baseline_report_changes_only_the_baseline_field(self):
        with_report, without = self.base / "with_report", self.base / "without_report"
        self.assertEqual(run_cli(*self.args, "--baseline-report", self.report_path(), "--out", with_report).returncode, 0)
        self.assertEqual(run_cli(*self.args, "--out", without).returncode, 0)
        for name in ("oem_relations", "claim_status_matrix", "review_queue"):
            self.assertEqual((with_report / f"{name}.synthetic_demo.json").read_bytes(), (without / f"{name}.synthetic_demo.json").read_bytes(), name)
        a, b = (self.load(d, "oem_vs_current_report.synthetic_demo.json") for d in (with_report, without))
        self.assertIsNone(b["baseline"])
        a.pop("baseline"), b.pop("baseline")
        self.assertEqual(a, b)

    def test_a_failed_baseline_report_never_yields_outputs(self):
        out = self.scratch / "failed_baseline_out"
        failing = [{"check": "links_by_source_head", "status": "FAIL", "expected": {"stroller": 1}, "observed": {"stroller": 2}, "note": ""},
                   {"check": "manifest_sha256", "status": "PASS", "expected": 1, "observed": 1, "note": ""},
                   {"check": "fresh_source_rows_sha256", "status": "PASS", "expected": 1, "observed": 1, "note": ""}]
        proc = run_cli(*self.args, "--baseline-report", self.report_path(result="FAIL", checks=failing), "--out", out)
        self.assertEqual(proc.returncode, 3, proc.stderr[-1500:])
        self.assertIn("BASELINE FAIL", proc.stderr)
        self.assertIn("links_by_source_head", proc.stderr)
        self.assertFalse(out.exists())

    def test_a_tampered_engine_root_is_refused_before_anything_is_written(self):
        real = engine_env.engine_root()
        copy_root = self.base / "tampered_engine_root"
        for sub in ("work/accessories/src", "upstream/v32/engine"):
            shutil.copytree(real / sub, copy_root / sub, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        target = copy_root / "work/accessories/src/accessory_v4.py"
        target.write_bytes(target.read_bytes() + b"\n# one extra line\n")
        out = self.base / "tampered_out"
        proc = subprocess.run([sys.executable, "-I", str(CLI), *map(str, self.args), "--out", str(out)], capture_output=True, text=True,
                              env={**os.environ, "BP_V421_ENGINE_ROOT": str(copy_root)}, cwd=str(ROOT), timeout=300)
        self.assertEqual(proc.returncode, 4, proc.stderr[-1500:])
        self.assertIn("accessory_v4.py", proc.stderr)
        self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
