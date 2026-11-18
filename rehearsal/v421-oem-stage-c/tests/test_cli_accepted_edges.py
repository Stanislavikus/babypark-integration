"""``tools/build_accepted_edges.py`` through its real command line, on files, with the real V4.2.1 modules (SYNTHETIC world, fictional catalog).

Chain under test, exactly as on rehearsal: Stage B ``build_outputs.py`` writes ``oem_relations.json`` -> Stage C ``build_accepted_edges.py`` re-derives the
relations from the typed data, requires them to equal the supplied file, runs the gate and writes ``accepted_edges.json`` + ``oem_gate_report.json``.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tests import helpers as H
from tests.helpers import ROOT, STAGE_B, engine_ready, require_engine
from oem_intake import envelope as E
from oem_stage import canon

CLI = ROOT / "tools" / "build_accepted_edges.py"
B_CLI = STAGE_B / "tools" / "build_outputs.py"
AS_OF = "2026-11-17"
ALLOW = [{"issuer": "acme", "markets": ["GB"], "languages": ["en"]}]

try:
    mc = H.stage_b_module("mini_catalog", "tests/mini_catalog.py")
    sw = H.stage_b_module("synthetic_world", "tests/synthetic_world.py")
    _ENGINE_OK = engine_ready()[0] and mc.taxonomy_available()
except Exception:  # pragma: no cover - reported by the skip reason
    mc = sw = None
    _ENGINE_OK = False


def run(script, *args, env_extra=None):
    env = dict(os.environ)
    env.update(env_extra or {})
    return subprocess.run([sys.executable, "-I", str(script), *map(str, args)], capture_output=True, text=True, env=env, cwd=str(ROOT),
                          timeout=300)


def digest_tree(path):
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(Path(path).iterdir()) if p.is_file()}


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


@require_engine
@unittest.skipUnless(_ENGINE_OK, "engine taxonomy file / mini catalog unavailable")
class TestBuildAcceptedEdgesCli(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        base = cls.base = Path(cls.tmp.name)
        cls.mini = mc.build(base / "input")
        cls.world = sw.build(base / "world_blobs")
        sw.extend_for_catalog(cls.world)
        sw.dump(cls.world, base / "data")
        (base / "ctl").mkdir()
        canon.write_json(base / "ctl" / "allow_list.json", ALLOW)
        cls.common = ["--data-dir", base / "data", "--blob-root", base / "world_blobs" / "blobs", "--as-of", AS_OF]
        cls.catalog = ["--rows", cls.mini.rows_path, "--index", cls.mini.index_path]
        cls.b_catalog = [*cls.catalog, "--manifest", cls.mini.manifest_path, "--evidence", cls.mini.evidence_path]
        # Stage B relations for the three policies the tests need (all produced by the accepted Stage B CLI)
        cls.rel_syn = cls.stage_b("syn", "--allow-synthetic", "--allow-list", base / "ctl" / "allow_list.json")
        cls.rel_syn_noallow = cls.stage_b("syn_noallow", "--allow-synthetic")
        cls.rel_real = cls.stage_b("real")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    @classmethod
    def stage_b(cls, name, *extra):
        out = cls.base / f"stage_b_{name}"
        proc = run(B_CLI, *cls.common, *cls.b_catalog, *extra, "--out", out)
        if proc.returncode != 0:
            raise AssertionError(f"Stage B CLI failed: {proc.stderr[-2000:]}")
        return out / "oem_relations.json"

    def c_args(self, relations, out, *extra):
        return [*self.common, *self.catalog, "--relations", relations, *extra, "--out", out]

    def cli(self, relations, out, *extra, **kw):
        return run(CLI, *self.c_args(relations, out, *extra), **kw)

    def test_end_to_end_outputs_are_complete_deterministic_hash_listed_and_synthetic_marked(self):
        outs = [self.base / "e2e_1", self.base / "e2e_2"]
        for out in outs:
            proc = self.cli(self.rel_syn, out, "--allow-synthetic", "--allow-list", self.base / "ctl" / "allow_list.json", "--label", "synthetic_demo")
            self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(digest_tree(outs[0]), digest_tree(outs[1]))                  # byte-identical reruns
        self.assertEqual(sorted(digest_tree(outs[0])), ["HASHES.synthetic_demo.json", "SHA256SUMS.synthetic_demo.txt",
                                                        "accepted_edges.synthetic_demo.json", "oem_gate_report.synthetic_demo.json"])
        for line in (outs[0] / "SHA256SUMS.synthetic_demo.txt").read_text(encoding="utf-8").splitlines():
            sha, name = line.split("  ")
            self.assertEqual(hashlib.sha256((outs[0] / name).read_bytes()).hexdigest(), sha, name)
        env = load(outs[0] / "accepted_edges.synthetic_demo.json")
        report = load(outs[0] / "oem_gate_report.synthetic_demo.json")
        self.assertEqual(E.validate(env, allow_synthetic=True)["edge_count"], 6)
        self.assertTrue(env["synthetic"] and report["summary"]["synthetic"])
        self.assertEqual((env["label"], report["summary"]["edges_accepted"], report["summary"]["accepted_relations"]), ("synthetic_demo", 6, 2))
        self.assertEqual(report["catalog_side"]["kind"], "rehearsal_rows")
        self.assertEqual(report["baseline_verification"], "not supplied")
        self.assertIn("Nothing in this file is a recommendation or a publication authorization", report["notice"])
        # provenance: the envelope's relations digest is Stage B's own digest of the same relations
        self.assertEqual(env["provenance"]["relations_digest"], load(self.rel_syn)["relations_digest"])
        self.assertEqual(report["inputs"]["oem_relations.json"], canon.file_sha256(self.rel_syn))
        self.assertEqual(env["provenance"]["inputs_digest"], canon.digest(report["inputs"]))
        for path in outs[0].iterdir():                                                # no absolute paths or temp dirs leak into any artifact
            text = path.read_text(encoding="utf-8")
            for leak in (str(self.base), "/tmp/", "/home/"):
                self.assertNotIn(leak, text, (path.name, leak))

    def test_an_accepted_envelope_drives_the_patched_engine_end_to_end_from_files(self):
        """Files -> envelope -> engine (synthetic opt-in): the same two new edges as the in-process wiring test."""
        out = self.base / "e2e_engine"
        self.assertEqual(self.cli(self.rel_syn, out, "--allow-synthetic", "--allow-list", self.base / "ctl" / "allow_list.json").returncode, 0)
        env = load(out / "accepted_edges.json")
        with gzip.open(self.mini.rows_path, "rt", encoding="utf-8") as handle:
            rows = {json.loads(line)["nid"]: json.loads(line) for line in handle}
        scope = {str(n): {"language": rows[int(n)]["lang"], "similar": [], "accessories": []} for n in self.mini.scope_keys}
        import copy
        result = H.patched().build_catalog(rows, copy.deepcopy(scope), self.mini.index, self.mini.policy, [], {},
                                           oem_relations=env, oem_enabled=True, oem_allow_synthetic=True)
        self.assertEqual((result[2]["oem"]["edges_in"], result[2]["oem"]["published"], result[2]["oem"]["already_present_legacy"]), (6, 2, 4))

    def test_the_default_policy_publishes_nothing_even_though_the_typed_data_is_synthetic(self):
        out = self.base / "default_policy"
        self.assertEqual(self.cli(self.rel_real, out).returncode, 0)
        env, report = load(out / "accepted_edges.json"), load(out / "oem_gate_report.json")
        self.assertEqual((env["edges"], env["synthetic"]), ({}, False))
        self.assertEqual(report["summary"]["edges_accepted"], 0)
        self.assertEqual(report["summary"]["held_relations"], report["summary"]["relations"])

    def test_an_empty_allow_list_publishes_nothing_even_with_the_synthetic_opt_in(self):
        out = self.base / "no_allow_list"
        self.assertEqual(self.cli(self.rel_syn_noallow, out, "--allow-synthetic").returncode, 0)
        report = load(out / "oem_gate_report.json")
        self.assertEqual(report["summary"]["edges_accepted"], 0)
        self.assertEqual(report["summary"]["relations_held_by_reason"]["od6_allowlist_empty"], report["summary"]["relations"])

    def test_adapters_abstain_by_default_and_the_test_policy_needs_the_synthetic_opt_in(self):
        proc = self.cli(self.rel_syn, self.base / "od5_real", "--allow-list", self.base / "ctl" / "allow_list.json",
                        "--one-ended-adapter", "synthetic_test_two_ended")
        self.assertEqual(proc.returncode, 2, proc.stderr)
        self.assertIn("test-only", proc.stderr)
        self.assertFalse((self.base / "od5_real").exists())
        out = self.base / "od5_test"
        proc = self.cli(self.rel_syn, out, "--allow-synthetic", "--allow-list", self.base / "ctl" / "allow_list.json",
                        "--one-ended-adapter", "synthetic_test_two_ended")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        env = load(out / "accepted_edges.json")
        self.assertEqual(env["gate"]["one_ended_adapter"], "synthetic_test_two_ended")
        self.assertEqual(sorted(e["end"] for items in env["edges"].values() for e in items if e["relation_type"] == "adapter_between"),
                         ["chassis", "chassis", "seat", "seat"])

    def test_a_relations_file_that_is_not_reproducible_from_the_typed_data_is_refused(self):
        syn = load(self.rel_syn)
        tampered = {"relation edited": ("relations", lambda d: d["relations"][0].update(reasons=d["relations"][0]["reasons"] + ["tampered"])),
                "state flipped": ("relations", lambda d: d["relations"][-1].update(
                    effective_state="LISTED" if d["relations"][-1]["effective_state"] != "LISTED" else "UNKNOWN")),
                    "digest changed": ("relations_digest", lambda d: d.update(relations_digest="0" * 64)),
                    "schema changed": ("schema", lambda d: d.update(schema="bp-oem-relations-v2")),
                    "synthetic flag flipped": ("synthetic", lambda d: d.update(synthetic=False)),
                    "relation dropped": ("relations", lambda d: d["relations"].pop())}
        for name, (_, mutate) in tampered.items():
            doc = json.loads(json.dumps(syn))
            mutate(doc)
            path = self.base / "ctl" / f"tampered_{name.replace(' ', '_')}.json"
            canon.write_json(path, doc)
            out = self.base / f"refused_{name.replace(' ', '_')}"
            with self.subTest(name):
                proc = self.cli(path, out, "--allow-synthetic", "--allow-list", self.base / "ctl" / "allow_list.json")
                self.assertEqual(proc.returncode, 5, proc.stderr)
                self.assertIn("not reproducible", proc.stderr)
                self.assertFalse(out.exists())                                         # nothing is written on a refusal

    def test_relations_derived_under_another_policy_are_refused(self):
        proc = self.cli(self.rel_syn, self.base / "other_policy", "--allow-synthetic")           # the file was derived WITH the allow-list
        self.assertEqual(proc.returncode, 5, proc.stderr)
        proc = self.cli(self.rel_real, self.base / "other_policy2", "--allow-synthetic", "--allow-list", self.base / "ctl" / "allow_list.json")
        self.assertEqual(proc.returncode, 5, proc.stderr)

    def test_unsafe_output_locations_are_refused_before_anything_is_written(self):
        for name, location in (("rows folder", self.base / "input"), ("typed data", self.base / "data"),
                               ("blob store", self.base / "world_blobs" / "blobs"), ("stage B output", self.base / "stage_b_syn"),
                               ("control dir", self.base / "ctl"), ("parent of the inputs", self.base)):
            before = sorted(p.name for p in location.iterdir()) if location.is_dir() else None
            with self.subTest(name):
                proc = self.cli(self.rel_syn, location, "--allow-synthetic", "--allow-list", self.base / "ctl" / "allow_list.json")
                self.assertEqual(proc.returncode, 1, proc.stderr)
                self.assertIn("refusing to write outputs", proc.stderr)
                self.assertEqual(sorted(p.name for p in location.iterdir()), before)           # not even a stray file

    def test_unauthorized_policies_and_bad_dates_are_refused_with_exit_2(self):
        for name, extra in (("non-date as-of", ["--as-of", "2026-13-01"]), ("unknown OD5 value", ["--one-ended-adapter", "conditional"])):
            with self.subTest(name):
                args = [a for a in self.c_args(self.rel_syn, self.base / "policy_refused", "--allow-synthetic")]
                if "--as-of" in extra:
                    args[args.index("--as-of") + 1] = extra[1]
                else:
                    args += extra
                proc = run(CLI, *args)
                self.assertEqual(proc.returncode, 2, proc.stderr)
                self.assertFalse((self.base / "policy_refused").exists())

    def test_a_baseline_report_must_be_a_pass_for_exactly_these_files(self):
        bad = self.base / "ctl" / "bad_baseline.json"
        canon.write_json(bad, {"schema": "bp-oem-baseline-verification-v1", "result": "FAIL", "checks": [], "read_only": True, "files": {}})
        out = self.base / "baseline_refused"
        proc = self.cli(self.rel_syn, out, "--allow-synthetic", "--allow-list", self.base / "ctl" / "allow_list.json",
                        "--baseline-report", bad, "--manifest", self.mini.manifest_path, "--evidence", self.mini.evidence_path)
        self.assertEqual(proc.returncode, 3, proc.stderr)
        self.assertFalse(out.exists())
        proc = self.cli(self.rel_syn, out, "--allow-synthetic", "--allow-list", self.base / "ctl" / "allow_list.json",
                        "--baseline-report", bad)                                                  # without the files it would have to cover
        self.assertEqual(proc.returncode, 3, proc.stderr)

    def test_a_missing_engine_root_is_refused_cleanly(self):
        empty = self.base / "empty_engine"
        empty.mkdir()
        proc = self.cli(self.rel_syn, self.base / "engine_missing", "--allow-synthetic", "--allow-list", self.base / "ctl" / "allow_list.json",
                        env_extra={"BP_V421_ENGINE_ROOT": str(empty)})
        self.assertEqual(proc.returncode, 4, proc.stderr)                              # the specific refusal (exit 4), not just any crash
        self.assertIn("the engine root is not the accepted V4.2.1 engine", proc.stderr)
        self.assertNotIn("Traceback", proc.stderr)
        self.assertFalse((self.base / "engine_missing").exists())

    def test_an_engine_root_with_other_bytes_is_refused_before_anything_is_read_or_written(self):
        fake = self.base / "fake_engine"
        (fake / "work" / "accessories" / "src").mkdir(parents=True)
        (fake / "work" / "accessories" / "src" / "accessory_v4.py").write_text("# not the accepted engine\n", encoding="utf-8")
        proc = self.cli(self.rel_syn, self.base / "engine_refused", "--allow-synthetic", "--allow-list", self.base / "ctl" / "allow_list.json",
                        env_extra={"BP_V421_ENGINE_ROOT": str(fake)})
        self.assertEqual(proc.returncode, 4, proc.stderr)
        self.assertIn("the engine root is not the accepted V4.2.1 engine", proc.stderr)
        self.assertIn("sha256 differs from the accepted pin", proc.stderr)             # the changed file is named ...
        self.assertIn("missing in the engine root", proc.stderr)                       # ... and so are the missing ones
        self.assertFalse((self.base / "engine_refused").exists())

    def test_the_inputs_are_never_modified(self):
        watched = [self.mini.rows_path, self.mini.index_path, self.rel_syn, self.base / "data" / "claims.json", self.base / "ctl" / "allow_list.json"]
        before = {str(p): canon.file_sha256(p) for p in watched}
        self.assertEqual(self.cli(self.rel_syn, self.base / "readonly_check", "--allow-synthetic", "--allow-list",
                                  self.base / "ctl" / "allow_list.json").returncode, 0)
        self.assertEqual({str(p): canon.file_sha256(p) for p in watched}, before)
        blobs = sorted(str(p) for p in (self.base / "world_blobs" / "blobs").rglob("*"))
        self.assertEqual(len(blobs), len(sorted(set(blobs))))


if __name__ == "__main__":
    unittest.main()
