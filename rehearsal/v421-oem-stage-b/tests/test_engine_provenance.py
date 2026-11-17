"""B-R3: provenance of the imported V4.2.1 / V3.2 engine modules = pinned BYTES + a trusted import LOCATION.

The unmodified legacy engine puts more than one directory on sys.path (accessory_v4: the accepted campaign engine_root;
model_mentions: /opt/bp-accessories-v421-integration-rehearsal-20261112/upstream/v32/engine; v32_pipeline: the V3.2 rollout engine
directory), so the SAME accepted bytes can legitimately be imported from a path other than ``engine_root``. A test or tool that insists on
``startswith(engine_root)`` rejects an accepted module for its address; one that ignores the address accepts anything. These tests fix the rule:
the file's SHA-256 must equal the accepted pin AND its resolved directory must be an approved one. Synthetic modules here; the real engine
is checked in test_integration_real_modules.py."""
from __future__ import annotations

import hashlib
import os
import re
import tempfile
import types
import unittest
from pathlib import Path

from oem_stage import engine_env
from tests.helpers import engine_ready

NAMES = ("accessory_auto_v39", "accessory_v4", "canonical_models", "v32_pipeline", "v3_rules_v421")
APPROVED_20261112 = "/opt/bp-accessories-v421-integration-rehearsal-20261112/upstream/v32/engine"
APPROVED_20261111 = "/opt/bp-recommendations-full-rollout-rehearsal-20261111/v3.2/engine"
HEX64 = re.compile(r"^[0-9a-f]{64}$")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class World:
    """A throw-away engine root + an 'approved legacy' directory + an unapproved one, with synthetic module files."""

    def __init__(self, base: Path):
        self.root = base / "engine_root"
        self.src, self.upstream = self.root / "work/accessories/src", self.root / "upstream/v32/engine"
        self.legacy, self.unapproved = base / "legacy_approved", base / "somewhere_else"
        for d in (self.src, self.upstream, self.legacy, self.unapproved):
            d.mkdir(parents=True)
        self.content = {name: f"# synthetic accepted module {name}\nVALUE = {index}\n".encode() for index, name in enumerate(NAMES)}
        self.accepted = {name: sha(data) for name, data in self.content.items()}
        for name, data in self.content.items():
            (self.src / f"{name}.py").write_bytes(data)

    def put(self, directory: Path, name: str, data: bytes = None) -> Path:
        path = directory / f"{name}.py"
        path.write_bytes(self.content[name] if data is None else data)
        return path

    def module(self, path) -> types.SimpleNamespace:
        return types.SimpleNamespace(__file__=str(path))

    def rows(self, modules: dict, **kw):
        return engine_env.import_provenance(self.root, modules=modules, accepted=self.accepted,
                                            approved_dirs=kw.pop("approved_dirs", [self.src, self.upstream, self.legacy]), **kw)


class TestImportProvenance(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.w = World(Path(self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def one(self, name, path, **kw):
        rows = self.w.rows({name: self.w.module(path)}, names=[name], **kw)
        self.assertEqual(len(rows), 1)
        return rows[0]

    def test_accepted_bytes_in_the_engine_root_pass(self):
        for directory in (self.w.src, self.w.upstream):
            path = self.w.put(directory, "v32_pipeline")
            row = self.one("v32_pipeline", path)
            self.assertEqual((row["status"], row["bytes"]), ("PASS", "MATCH"), row)
            self.assertEqual(row["location"], str(directory.resolve()))
            self.assertEqual(row["sha256"], self.w.accepted["v32_pipeline"])

    def test_the_same_accepted_bytes_from_another_approved_legacy_path_pass(self):
        """The reviewer's B-R3 case: byte-identical v32_pipeline imported from the integration-rehearsal path, not from engine_root."""
        path = self.w.put(self.w.legacy, "v32_pipeline")
        row = self.one("v32_pipeline", path)
        self.assertEqual(row["status"], "PASS", row)
        self.assertEqual(row["location"], str(self.w.legacy.resolve()))
        self.assertFalse(str(path.resolve()).startswith(str(self.w.root.resolve())))        # NOT under engine_root, still trusted
        self.assertEqual(engine_env.provenance_problems([row]), [])

    def test_one_changed_byte_is_refused_even_at_an_approved_location(self):
        for directory in (self.w.src, self.w.legacy):
            path = self.w.put(directory, "v32_pipeline", self.w.content["v32_pipeline"] + b"#")
            row = self.one("v32_pipeline", path)
            self.assertEqual((row["status"], row["bytes"]), ("FAIL", "MISMATCH"), row)
            problems = engine_env.provenance_problems([row])
            self.assertEqual(len(problems), 1)
            self.assertIn("v32_pipeline", problems[0])
            self.assertIn("MISMATCH", problems[0])

    def test_identical_bytes_at_an_unapproved_location_are_refused(self):
        path = self.w.put(self.w.unapproved, "canonical_models")
        row = self.one("canonical_models", path)
        self.assertEqual((row["status"], row["bytes"], row["location"]), ("FAIL", "MATCH", "UNAPPROVED"), row)
        self.assertIn("unapproved", engine_env.provenance_problems([row])[0])

    def test_a_subdirectory_or_a_sibling_prefix_of_an_approved_directory_is_not_approved(self):
        sub = self.w.legacy / "nested"
        sub.mkdir()
        sibling = self.w.legacy.parent / (self.w.legacy.name + "_evil")
        sibling.mkdir()
        for directory in (sub, sibling):
            row = self.one("v32_pipeline", self.w.put(directory, "v32_pipeline"))
            self.assertEqual((row["status"], row["location"]), ("FAIL", "UNAPPROVED"), directory)

    def test_symlinks_are_resolved_before_the_location_is_judged(self):
        real = self.w.put(self.w.unapproved, "v32_pipeline")
        link = self.w.legacy / "v32_pipeline.py"
        os.symlink(real, link)                                    # approved-looking path, but the file really lives elsewhere
        row = self.one("v32_pipeline", link)
        self.assertEqual((row["status"], row["location"]), ("FAIL", "UNAPPROVED"), row)
        accepted_file = self.w.put(self.w.src, "canonical_models")
        elsewhere = self.w.unapproved / "canonical_models.py"
        os.symlink(accepted_file, elsewhere)                      # the file really IS the accepted one in engine_root
        self.assertEqual(self.one("canonical_models", elsewhere)["status"], "PASS")

    def test_modules_that_are_not_real_source_files_are_refused(self):
        rows = self.w.rows({"accessory_v4": types.SimpleNamespace(),                       # a stub without __file__
                            "v32_pipeline": self.w.module(self.w.src / "v32_pipeline.pyc")},  # sourceless / not the .py
                           names=["accessory_v4", "v32_pipeline", "canonical_models"])
        self.assertEqual([r["status"] for r in rows], ["FAIL", "FAIL", "NOT_LOADED"])
        self.assertEqual([r.get("detail") for r in rows][0], "module has no source file (stub, builtin or namespace)")

    def test_not_loaded_is_reported_and_is_a_problem_only_for_modules_that_were_required(self):
        rows = self.w.rows({}, names=["v32_pipeline"])
        self.assertEqual(rows[0]["status"], "NOT_LOADED")
        self.assertEqual(len(engine_env.provenance_problems(rows)), 1)
        self.assertEqual(engine_env.provenance_problems(rows, allow_not_loaded=True), [])

    def test_unknown_module_names_are_rejected(self):
        with self.assertRaises(ValueError):
            self.w.rows({}, names=["json"])

    def test_default_names_are_all_five_pinned_modules(self):
        modules = {}
        for name in NAMES:
            modules[name] = self.w.module(self.w.put(self.w.src, name))
        rows = self.w.rows(modules)
        self.assertEqual([r["module"] for r in rows], sorted(NAMES))
        self.assertEqual({r["status"] for r in rows}, {"PASS"})

    def test_rows_are_deterministic_plain_data(self):
        path = self.w.put(self.w.legacy, "v32_pipeline")
        first, second = self.one("v32_pipeline", path), self.one("v32_pipeline", path)
        self.assertEqual(first, second)
        import json
        json.dumps(first, sort_keys=True)


class TestEngineRootPins(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.w = World(Path(self.tmp.name))
        self.accepted = {f"work/accessories/src/{n}.py": h for n, h in self.w.accepted.items()}

    def tearDown(self):
        self.tmp.cleanup()

    def test_matching_root_has_no_problems(self):
        self.assertEqual(engine_env.engine_root_problems(self.w.root, accepted=self.accepted), [])

    def test_changed_and_missing_files_are_reported_by_name(self):
        (self.w.src / "accessory_v4.py").write_bytes(b"# changed\n")
        (self.w.src / "v32_pipeline.py").unlink()
        problems = engine_env.engine_root_problems(self.w.root, accepted=self.accepted)
        self.assertEqual(len(problems), 2)
        self.assertTrue(any("accessory_v4.py" in p and "differs" in p for p in problems), problems)
        self.assertTrue(any("v32_pipeline.py" in p and "missing" in p for p in problems), problems)


class TestPinConstants(unittest.TestCase):
    def test_the_accepted_table_covers_exactly_the_engine_files_with_sha256_values(self):
        self.assertEqual(sorted(engine_env.ACCEPTED_ENGINE_SHA256), sorted(engine_env.ENGINE_FILES))
        self.assertTrue(all(HEX64.match(v) for v in engine_env.ACCEPTED_ENGINE_SHA256.values()))
        self.assertEqual(sorted(engine_env.MODULE_SHA256), sorted(NAMES))
        self.assertEqual(engine_env.MODULE_SHA256["v32_pipeline"], "9c4cd8788aadc7d8a1422bd941c2a1032b36319f13daeaf58bb60b8ce32eafdc")
        self.assertEqual(engine_env.MODULE_SHA256["canonical_models"], "eb54e4bef88158af896ad54ebe5f6c27b3886c1b831fee91166877e9ccabdda3")

    def test_the_approved_directories_are_exactly_those_the_legacy_engine_hard_codes(self):
        self.assertEqual(tuple(engine_env.LEGACY_IMPORT_DIRS), (APPROVED_20261112, APPROVED_20261111))
        dirs = {str(d) for d in engine_env.approved_import_dirs(Path("/x/engine_root"))}
        literal = ["/x/engine_root/work/accessories/src", "/x/engine_root/upstream/v32/engine",
                   f"{engine_env.DEFAULT_ROOT}/work/accessories/src", f"{engine_env.DEFAULT_ROOT}/upstream/v32/engine",
                   APPROVED_20261112, APPROVED_20261111]
        # compared after resolve(): in a sandbox the /opt paths may be symlinks (tools/sandbox_opt_shim.sh); on rehearsal they are real
        self.assertEqual(dirs, {str(Path(d).resolve()) for d in literal})

    @unittest.skipUnless(engine_ready()[0], "real V4.2.1 engine unavailable (BP_V421_ENGINE_ROOT / shim)")
    def test_every_approved_legacy_directory_is_evidenced_in_the_unmodified_engine_source(self):
        root = engine_env.engine_root()
        text = {name: (root / "work/accessories/src" / f"{name}.py").read_text(encoding="utf-8")
                for name in ("model_mentions", "v32_pipeline", "accessory_v4")}
        self.assertIn(APPROVED_20261112, text["model_mentions"])                         # sys.path.insert(0, ".../upstream/v32/engine")
        self.assertIn(APPROVED_20261111 .rsplit("/engine", 1)[0], text["v32_pipeline"])  # BASE = .../v3.2 ; ENGINE = BASE / "engine"
        self.assertIn(engine_env.DEFAULT_ROOT.rsplit("/engine_root", 1)[0], text["accessory_v4"])
        self.assertIn("/engine_root/upstream/v32/engine", text["accessory_v4"])


if __name__ == "__main__":
    unittest.main()
