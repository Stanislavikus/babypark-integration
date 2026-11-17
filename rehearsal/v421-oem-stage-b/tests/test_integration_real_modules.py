"""Integration with the REAL V4.2.1 modules (no stubs, no mocks).

A fictional mini catalog is run through the engine's own ``functional_signature`` / ``build_indexes`` /
``build_catalog`` / ``canonical_models``; the OEM stage is then compared against that real output, both in-process and
through the ``tools/build_outputs.py`` CLI in rehearsal mode (rows + index + manifest + evidence files, as written by
run_fresh_t2.py). OEM evidence is the SYNTHETIC fixture world (accepted path, ``allow_synthetic``), clearly flagged.
Skipped loudly when the real engine is not importable (needs BP_V421_ENGINE_ROOT and the rehearsal /opt path or shim).
"""
from __future__ import annotations

import copy
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

from oem_stage import canon, engine_env, shadow
from oem_stage.o4_relations import summarize
from tests import synthetic_world as sw
from tests.helpers import ROOT, engine_ready, require_engine

try:
    from tests import mini_catalog as mc
    _ENGINE_OK = engine_ready()[0] and mc.taxonomy_available()
except Exception:  # pragma: no cover - reported by the skip reason
    mc, _ENGINE_OK = None, False

CLI = ROOT / "tools" / "build_outputs.py"
AS_OF = "2026-11-17"


def run_cli(*args, env_extra=None, check=True):
    env = dict(os.environ)
    env.update(env_extra or {})
    proc = subprocess.run([sys.executable, "-I", str(CLI), *map(str, args)], capture_output=True, text=True, env=env,
                          cwd=str(ROOT), timeout=300)
    if check and proc.returncode != 0:
        raise AssertionError(f"CLI failed ({proc.returncode}):\n{proc.stdout[-2000:]}\n{proc.stderr[-4000:]}")
    return proc


def digest_tree(path):
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(Path(path).iterdir()) if p.is_file()}


@require_engine
@unittest.skipUnless(_ENGINE_OK, "engine taxonomy file / mini catalog unavailable")
class TestShadowAgainstRealEngineOutput(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        base = Path(cls.tmp.name)
        cls.mini = mc.build(base / "catalog")
        cls.world = sw.build(base / "world")
        sw.extend_for_catalog(cls.world)
        cls.rels = cls.world.derive()
        cls.view = shadow.CatalogView.from_engine(cls.mini.rows, cls.mini.index, cls.world.registry)
        cls.current = shadow.ManifestCurrent(cls.mini.sources, cls.mini.evidence)
        cls.res = shadow.compare(cls.rels, cls.view, cls.current)
        cls.sku_by_nid = {n: r["sku"] for n, r in cls.mini.rows.items()}

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    # ---------------------------------------------------------------- the real engine, not a stub
    def test_modules_are_the_real_engine_files_with_pinned_digests(self):
        root = engine_env.engine_root().resolve()
        pins = engine_env.engine_pins(root)
        self.assertEqual(sorted(pins), sorted(engine_env.ENGINE_FILES))
        for name in ("accessory_v4", "v32_pipeline", "canonical_models", "v3_rules_v421"):
            module = sys.modules[name]
            path = Path(module.__file__).resolve()
            self.assertTrue(str(path).startswith(str(root)), (name, path))
            self.assertEqual(canon.file_sha256(path), pins[str(path.relative_to(root))])
        import accessory_v4 as v4
        self.assertGreater(len(Path(v4.__file__).read_text(encoding="utf-8").splitlines()), 200)  # real code, not a shim

    def test_fixture_is_meaningful_current_engine_really_recommends_by_model_title(self):
        by_sku = {}
        for src, rec in self.mini.sources.items():
            for tgt in rec["accessories"]:
                by_sku.setdefault(self.sku_by_nid[tgt], set()).add(self.mini.rows[int(src)]["title"].split()[-1] + ":" +
                                                                  self.mini.rows[int(src)]["lang"])
        self.assertEqual(self.mini.metrics["edges"], {"A_model": 8, "B_universal": 0, "A_manufacturer_verified": 0})
        self.assertEqual(sorted(by_sku), ["RS-100", "RS-300-X", "RS-770"])      # the engine does not recommend adapters here
        self.assertEqual(by_sku["RS-100"], {"1:ru", "1:uk", "6:ru", "6:uk"})
        for evidence in self.mini.evidence.values():
            for ev in evidence["targets"].values():
                self.assertEqual((ev["tier"], ev["reason"]), ("A_model", "accepted_model_title"))

    # ---------------------------------------------------------------- identity joins through the real index
    def test_catalog_identity_joins_use_verified_aliases_only(self):
        by_model = {m: sorted({s["nid"] for s in v}) for m, v in self.view.sources_by_model.items()}
        self.assertEqual(by_model["zeta:alpha-1"], [1001, 1002, 1015, 1016])      # Latin + Cyrillic-lookalike via VERIFIED alias
        self.assertEqual(by_model["zeta:alpha-2"], [1003, 1004])                  # "Alpha-2" via VERIFIED alias
        self.assertEqual(by_model["acme:frame-x"], [1017, 1018])
        unresolved = {u["tnid"]: u for u in self.view.unresolved_sources}
        self.assertEqual(sorted(unresolved), [1013])                              # "Alpha 1 Plus": PROPOSED alias only
        self.assertEqual(unresolved[1013]["reasons"], ["ru:alias_unreviewed", "uk:alias_unreviewed"])
        self.assertEqual(self.view.unmapped_brands, {})
        import canonical_models as cm
        # the engine's own key would merge Alpha-2 with Alpha 2 and (for Cyrillic) keep Аlpha 1 apart; the OEM stage
        # joined only what a human-reviewed alias says
        self.assertEqual(cm.key("Alpha-2"), cm.key("Alpha 2"))
        self.assertNotEqual(cm.key("Аlpha 1"), cm.key("Alpha 1"))

    def test_title_similarity_is_never_a_join(self):
        # the real engine recommends catalog SKU RS-770 (Alpha-2); the OEM list has an *unjoined* candidate RS-777
        engine_targets = {self.sku_by_nid[t] for rec in self.mini.sources.values() for t in rec["accessories"]}
        self.assertIn("RS-770", engine_targets)
        self.assertEqual([p for p in self.res["pairs"] if p["target_sku"] == "RS-770"], [])
        self.assertEqual(self.world.articles.lookup("acme", "RS-777")["status"], "unbound")

    # ---------------------------------------------------------------- shadow classes against real output
    def pairs(self, **match):
        return [p for p in self.res["pairs"] if all(p[k] == v for k, v in match.items())]

    def test_agree_where_oem_listed_and_the_engine_recommends(self):
        agree = {(p["source_nid"], p["target_sku"]) for p in self.res["pairs"] if p["diff_class"] == "agree_current_recommends"}
        self.assertEqual(agree, {(1001, "RS-100"), (1002, "RS-100"), (1005, "RS-300-X"), (1006, "RS-300-X")})

    def test_oem_listed_but_not_recommended_by_engine_is_held_never_added(self):
        for p in self.pairs(diff_class="oem_listed_but_blocked"):
            self.assertFalse(p["a_tier_candidate"])
            self.assertFalse(p["current"]["present"])
        listed_blocked = {(p["source_nid"], p["target_sku"]) for p in self.pairs(diff_class="oem_listed_but_blocked")}
        self.assertIn((1003, "RS-100"), listed_blocked)      # LISTED_CONDITIONAL (OD4 hold), Alpha-2 via alias
        self.assertIn((1015, "RS-100"), listed_blocked)      # Cyrillic-lookalike source: engine does not recommend it
        self.assertTrue({(1009, "ADP-200"), (1019, "ADP-200")} <= listed_blocked)   # two-ended adapter, both catalog sources
        self.assertEqual(sum(1 for r in self.rels if r["publish"]["a_tier_candidate"]), 0)

    def test_explicit_oem_exclusion_the_engine_contradicts_is_a_report_only_veto_candidate(self):
        conflicts = self.res["veto_report"]["conflicts_with_current"]
        self.assertEqual({(c["source_nid"], c["target_sku"]) for c in conflicts}, {(1007, "RS-100"), (1008, "RS-100")})
        self.assertEqual({c["diff_class"] for c in conflicts}, {"veto_candidate_conflicts_with_current"})
        self.assertEqual((self.res["veto_report"]["mode"], self.res["veto_report"]["enforced"]), ("report_only", False))
        # the engine's recommendation is still there: the OEM stage only reports
        self.assertIn(1021, self.mini.sources["1007"]["accessories"])

    def test_absence_conflict_and_scope_are_not_turned_into_exclusions(self):
        classes = {(p["relation_id"], p["diff_class"]) for p in self.res["pairs"]}
        absent = [p for p in self.res["pairs"] if p["oem_proposed_state"] == "UNKNOWN"]
        self.assertTrue(absent)
        self.assertEqual({p["diff_class"] for p in absent}, {"no_signal"})
        held = {p["diff_class"] for p in self.res["pairs"] if p["oem_effective_state"] == "CONFLICT_HOLD"}
        self.assertEqual(held, {"held_conflict"})
        # scoped: the Frame X exclusion does not touch the Frame Y relation
        frame_y = [r for r in self.rels if r["relation_type"] == "adapter_between"
                   and r["ends"]["chassis"].get("model_id") == "acme:frame-y"
                   and r["ends"]["seat"].get("model_id") == "zeta:beta-1"]
        self.assertEqual([r["effective_state"] for r in frame_y], ["LISTED"])
        self.assertTrue(classes)

    def test_pair_counts_are_exactly_the_documented_distribution(self):
        self.assertEqual(self.res["pair_counts"], {
            "agree_absent_oem_excludes": 4, "agree_current_recommends": 4, "held_conflict": 8, "no_signal": 2,
            "oem_listed_but_blocked": 10, "veto_candidate_conflicts_with_current": 2})
        self.assertEqual(summarize(self.rels)["a_tier_candidates"], 0)

    def test_stage1_gap_on_the_mini_catalog_asks_native_checks_for_listed_targets_only(self):
        gap = shadow.stage1_gap(self.rels, self.view)
        skus = sorted({(r["catalog_sku"], r["lang"]) for r in gap["required_target_locales"]})
        self.assertEqual(skus, [("ADP-200", "ru"), ("ADP-200", "uk"), ("RS-100", "ru"), ("RS-100", "uk"),
                                ("RS-300-X", "ru"), ("RS-300-X", "uk")])
        self.assertTrue(all(r["native_stage1_receipt"] == "NOT_RUN" for r in gap["required_target_locales"]))
        self.assertEqual(gap["not_recommendable_field_status_not_1"], [])

    # ---------------------------------------------------------------- baseline unchanged
    def test_compare_does_not_mutate_the_current_inputs(self):
        before = canon.digest({"sources": self.mini.sources, "evidence": self.mini.evidence, "index": self.mini.index})
        copy_of_rows = copy.deepcopy(self.mini.rows)
        shadow.compare(self.rels, shadow.CatalogView.from_engine(self.mini.rows, self.mini.index, self.world.registry),
                       self.current)
        self.assertEqual(before, canon.digest({"sources": self.mini.sources, "evidence": self.mini.evidence,
                                               "index": self.mini.index}))
        self.assertEqual(copy_of_rows, self.mini.rows)

    def test_the_engine_output_is_identical_before_and_after_the_oem_stage(self):
        v4 = self.mini.engine
        before = canon.digest([self.mini.sources, self.mini.evidence])
        scope = {k: {"language": self.mini.rows[int(k)]["lang"], "similar": [], "accessories": []}
                 for k in self.mini.scope_keys}
        sources, evidence, _ = v4.build_catalog(copy.deepcopy(self.mini.rows), scope,
                                                copy.deepcopy(self.mini.index), self.mini.policy, [], {})
        self.assertEqual(before, canon.digest([sources, evidence]))
        for rec in sources.values():                       # V3.6 Similar is passed through untouched (empty here)
            self.assertEqual(rec["similar"], [])
        pins = engine_env.engine_pins()
        self.assertEqual(pins, engine_env.engine_pins())   # engine files not written by the OEM stage

    def test_engine_never_imports_the_oem_stage_and_the_oem_core_never_imports_the_engine(self):
        for name in ("accessory_v4", "v32_pipeline", "canonical_models", "v3_rules_v421"):
            self.assertFalse(any(k.startswith("oem_stage") for k in vars(sys.modules[name])), name)
        code = ("import sys\n"
                "import oem_stage.canon, oem_stage.schema, oem_stage.conditions, oem_stage.assertions, "
                "oem_stage.o1_evidence, oem_stage.o2_identity, oem_stage.o3_articles, oem_stage.o4_relations, "
                "oem_stage.shadow, oem_stage.world, oem_stage.classify, oem_stage.outputs\n"
                "bad = [m for m in ('accessory_v4','v32_pipeline','canonical_models','v3_rules_v421','run_v3_final') "
                "if m in sys.modules]\n"
                "print('ENGINE_IMPORTED' if bad else 'CLEAN', bad)\n")
        proc = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=str(ROOT), timeout=120)
        self.assertEqual((proc.returncode, proc.stdout.split()[0]), (0, "CLEAN"), proc.stderr)


@require_engine
@unittest.skipUnless(_ENGINE_OK, "engine taxonomy file / mini catalog unavailable")
class TestBuildOutputsCliRehearsalMode(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        base = Path(cls.tmp.name)
        cls.base = base
        cls.mini = mc.build(base / "input")
        cls.world = sw.build(base / "world_blobs")
        sw.extend_for_catalog(cls.world)
        sw.dump(cls.world, base / "data")
        cls.args = ["--data-dir", base / "data", "--blob-root", base / "world_blobs" / "blobs", "--as-of", AS_OF,
                    "--rows", cls.mini.rows_path, "--manifest", cls.mini.manifest_path,
                    "--evidence", cls.mini.evidence_path]

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_blob_root_layout_matches_the_writer(self):
        self.assertTrue((self.base / "world_blobs" / "blobs").is_dir())
        self.assertEqual(len(list((self.base / "world_blobs" / "blobs").glob("*/*"))), 3)   # html, pdf, addendum

    def test_end_to_end_outputs_are_complete_deterministic_and_flagged_synthetic(self):
        out1, out2 = self.base / "out1", self.base / "out2"
        for out in (out1, out2):
            run_cli(*self.args, "--index", self.mini.index_path, "--allow-synthetic", "--label", "synthetic_demo",
                    "--out", out)
        self.assertEqual(digest_tree(out1), digest_tree(out2))                       # byte-identical reruns
        names = sorted(digest_tree(out1))
        self.assertEqual(names, ["HASHES.synthetic_demo.json", "SHA256SUMS.synthetic_demo.txt",
                                 "claim_status_matrix.synthetic_demo.json", "oem_relations.synthetic_demo.json",
                                 "oem_vs_current_report.synthetic_demo.json", "review_queue.synthetic_demo.json"])
        for line in (out1 / "SHA256SUMS.synthetic_demo.txt").read_text(encoding="utf-8").splitlines():
            sha, name = line.split("  ")
            self.assertEqual(hashlib.sha256((out1 / name).read_bytes()).hexdigest(), sha, name)
        relations = json.loads((out1 / "oem_relations.synthetic_demo.json").read_text(encoding="utf-8"))
        report = json.loads((out1 / "oem_vs_current_report.synthetic_demo.json").read_text(encoding="utf-8"))
        self.assertTrue(relations["synthetic"] and report["synthetic"])
        self.assertEqual(relations["label"], "synthetic_demo")
        self.assertEqual(report["current_side"]["kind"], "v421_manifest")
        self.assertEqual(report["current_side"]["generation_id"], mc.GENERATION)
        self.assertEqual(report["current_side"]["manifest_schema"], mc.MANIFEST_SCHEMA)
        self.assertEqual(report["current_side"]["manifest_accessory_edges"], 8)
        self.assertEqual((report["catalog_side"]["kind"], report["catalog_side"]["rows"], report["catalog_side"]["index"]),
                         ("rehearsal_rows", 32, "loaded"))
        self.assertEqual(report["pair_counts"], {
            "agree_absent_oem_excludes": 4, "agree_current_recommends": 4, "held_conflict": 8, "no_signal": 2,
            "oem_listed_but_blocked": 10, "veto_candidate_conflicts_with_current": 2})
        self.assertEqual(report["veto_report"]["mode"], "report_only")
        self.assertFalse(report["veto_report"]["enforced"])
        self.assertEqual(report["relation_totals"]["a_tier_candidates"], 0)
        self.assertEqual([u["tnid"] for u in report["unresolved_catalog_sources"]], [1013])
        # engine pins recorded, no absolute paths or temp dirs leak into any artifact
        self.assertEqual(sorted(relations["inputs"]["engine_pins"]), sorted(engine_env.ENGINE_FILES))
        for path in out1.iterdir():
            text = path.read_text(encoding="utf-8")
            for leak in (str(self.base), "/tmp/", "/home/"):
                self.assertNotIn(leak, text, (path.name, leak))

    def test_index_rebuilt_with_the_real_build_indexes_gives_the_same_report(self):
        with_index, rebuilt = self.base / "with_index", self.base / "rebuilt"
        run_cli(*self.args, "--index", self.mini.index_path, "--allow-synthetic", "--label", "x", "--out", with_index)
        run_cli(*self.args, "--allow-synthetic", "--label", "x", "--out", rebuilt)
        a = json.loads((with_index / "oem_vs_current_report.x.json").read_text(encoding="utf-8"))
        b = json.loads((rebuilt / "oem_vs_current_report.x.json").read_text(encoding="utf-8"))
        self.assertEqual(b["catalog_side"]["index"], "rebuilt_with_real_v32_build_indexes")
        self.assertEqual((a["pairs"], a["pair_counts"], a["stage1_gap"]), (b["pairs"], b["pair_counts"], b["stage1_gap"]))

    def test_synthetic_evidence_is_refused_without_the_explicit_flag(self):
        out = self.base / "refused"
        run_cli(*self.args, "--index", self.mini.index_path, "--out", out)
        relations = json.loads((out / "oem_relations.json").read_text(encoding="utf-8"))
        report = json.loads((out / "oem_vs_current_report.json").read_text(encoding="utf-8"))
        states = relations["summary"]["by_effective_state"]
        self.assertEqual(set(states) - {"UNKNOWN", "CONFLICT_HOLD"}, set(), states)    # nothing becomes effective
        self.assertEqual(relations["summary"]["veto_candidates"], 0)
        self.assertEqual(report["pair_counts"].get("agree_current_recommends", 0), 0)
        veto = report["veto_report"]
        self.assertEqual(veto["candidates"], [])                           # nothing is a veto candidate yet ...
        self.assertTrue(veto["pending_verification"])                      # ... the exclusions wait for human verification
        self.assertEqual({c["diff_class"] for c in veto["conflicts_with_current"]},
                         {"veto_pending_verification_conflicts_with_current"})
        self.assertEqual({c["article_binding_status"] for c in veto["conflicts_with_current"]}, {"proposed"})

    def test_cli_argument_contract(self):
        no_date = run_cli("--out", self.base / "nodate", check=False)
        self.assertEqual(no_date.returncode, 2)                                      # --as-of is mandatory (no wall clock)
        self.assertIn("--as-of", no_date.stderr)
        half = run_cli("--as-of", AS_OF, "--manifest", self.mini.manifest_path, "--out", self.base / "half", check=False)
        self.assertNotEqual(half.returncode, 0)
        self.assertIn("together", half.stderr + half.stdout)
        self.assertFalse((self.base / "half").exists())

    def test_duplicate_catalog_nid_is_an_error_not_silently_merged(self):
        (self.base / "dup_in").mkdir()   # outputs may not be written next to the inputs they were built from
        rows = self.base / "dup_in" / "dup_rows.jsonl.gz"
        with gzip.open(self.mini.rows_path, "rt", encoding="utf-8") as handle:
            lines = handle.read().splitlines()
        with gzip.GzipFile(rows, "wb", mtime=0) as handle:
            handle.write(("\n".join(lines + [lines[0]]) + "\n").encode("utf-8"))
        args = [a if a != self.mini.rows_path else rows for a in self.args]
        bad = run_cli(*args, "--allow-synthetic", "--out", self.base / "dup_out", check=False)
        self.assertNotEqual(bad.returncode, 0)
        self.assertIn("duplicate catalog NID", bad.stderr)



@require_engine
class TestEngineTreeIsNeverWritten(unittest.TestCase):
    """The accepted campaign's engine_root is baseline data: importing it through the OEM stage must not create bytecode there."""

    def test_importing_the_engine_writes_nothing_into_the_engine_tree(self):
        real = engine_env.engine_root()
        with tempfile.TemporaryDirectory() as tmp:
            copy_root = Path(tmp) / "engine_root"
            for sub in ("work/accessories/src", "upstream/v32/engine"):
                shutil.copytree(real / sub, copy_root / sub, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))

            def listing():
                return sorted(str(p.relative_to(copy_root)) for p in copy_root.rglob("*"))

            before = listing()
            code = (f"import sys; sys.path.insert(0, {str(ROOT)!r})\n"
                    "from oem_stage import engine_env\n"
                    "engine_env.prepare_sys_path()\n"
                    "import accessory_v4, v32_pipeline, v3_rules_v421, canonical_models\n"
                    "print(sys.dont_write_bytecode)\n")
            proc = subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True,
                                  env={**os.environ, "BP_V421_ENGINE_ROOT": str(copy_root)})
            self.assertEqual(proc.returncode, 0, proc.stderr[-800:])
            self.assertEqual(proc.stdout.strip(), "True")
            self.assertEqual(before, listing(), "importing the engine created files inside the engine tree")
            self.assertFalse([p for p in listing() if "__pycache__" in p or p.endswith(".pyc")])


if __name__ == "__main__":
    unittest.main()
