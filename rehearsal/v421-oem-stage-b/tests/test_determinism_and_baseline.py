"""Regression guards: the OEM stage stays stdlib-only, offline, clock-free and deterministic, and it never touches the
V4.2.1 engine, baseline data or production. (Stage B is a standalone shadow stage; there is no engine seam yet.)"""
from __future__ import annotations

import ast
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from oem_stage import canon, world as W
from tests.helpers import ROOT, engine_ready, require_engine

PKG = ROOT / "oem_stage"
TOOLS = ROOT / "tools"
AS_OF = "2026-11-17"
FORBIDDEN_MODULES = {"socket", "ssl", "urllib", "http", "ftplib", "smtplib", "telnetlib", "xmlrpc", "requests",
                     "httpx", "aiohttp", "paramiko", "pymysql", "MySQLdb", "sqlite3", "subprocess", "multiprocessing",
                     "ctypes", "importlib", "pickle", "marshal", "shelve"}
ENGINE_MODULES = {"accessory_v4", "accessory_auto_v39", "canonical_models", "v3_rules_v421", "v32_pipeline",
                  "run_v3_final"}


def _imports(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield alias.name.split(".")[0], node.lineno, 0
        elif isinstance(node, ast.ImportFrom):
            yield (node.module or "").split(".")[0], node.lineno, node.level


def _sources(*dirs):
    for d in dirs:
        yield from sorted(d.glob("*.py"))


class TestOemStageIsStdlibOnlyOfflineAndClockFree(unittest.TestCase):
    def test_every_import_is_standard_library_or_internal(self):
        stdlib = set(sys.stdlib_module_names)
        for path in _sources(PKG):
            for name, line, level in _imports(path):
                if level:
                    continue
                self.assertTrue(name in stdlib or name == "oem_stage", f"{path.name}:{line} imports {name!r}")

    def test_no_network_database_subprocess_or_dynamic_code_in_the_stage(self):
        for path in _sources(PKG):
            for name, line, level in _imports(path):
                self.assertNotIn(name, FORBIDDEN_MODULES, f"{path.name}:{line}")
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.Call):
                    fn = node.func
                    if isinstance(fn, ast.Name):
                        self.assertNotIn(fn.id, {"eval", "exec", "compile", "__import__"},
                                         f"{path.name}:{node.lineno} calls builtin {fn.id}")
                    elif isinstance(fn, ast.Attribute):
                        self.assertNotIn(fn.attr, {"system", "popen", "spawn", "fork", "exec_module"},
                                         f"{path.name}:{node.lineno} calls .{fn.attr}")

    def test_no_wall_clock_or_randomness_in_the_stage(self):
        banned_attrs = {"now", "utcnow", "today", "time", "monotonic", "perf_counter", "gmtime", "localtime",
                        "strftime", "random", "randint", "uuid4", "getpid"}
        for path in _sources(PKG):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                    self.assertNotIn(node.func.attr, banned_attrs, f"{path.name}:{node.lineno}")
            for name, line, level in _imports(path):
                self.assertNotIn(name, {"time", "random", "uuid", "secrets", "tempfile"}, f"{path.name}:{line}")

    def test_the_engine_is_imported_only_by_the_two_cli_tools_never_by_the_stage(self):
        for path in _sources(PKG):
            for name, line, level in _imports(path):
                self.assertNotIn(name, ENGINE_MODULES, f"{path.name}:{line}")
        importers = sorted(p.name for p in _sources(TOOLS) for name, _, _ in _imports(p) if name in ENGINE_MODULES)
        self.assertEqual(sorted(set(importers)), ["build_outputs.py", "migrate_pr167.py"])

    def test_tools_have_no_network_database_shell_or_write_paths_to_the_engine_or_production(self):
        for path in _sources(TOOLS):
            for name, line, level in _imports(path):
                self.assertNotIn(name, FORBIDDEN_MODULES - {"subprocess"}, f"{path.name}:{line}")
            text = path.read_text(encoding="utf-8")
            for marker in ("ssh ", "scp ", "rsync", "drush", "mysql", "curl ", "wget ", "/var/www", "production_write"):
                self.assertNotIn(marker, text, f"{path.name} mentions {marker!r}")

    def test_stage_modules_never_write_outside_their_given_output_paths(self):
        """File-writing helpers exist only in canon (outputs) and o1 (the isolated content-addressed blob store)."""
        writers = {}
        for path in _sources(PKG):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "open":
                    mode = ""
                    if len(node.args) > 1 and isinstance(node.args[1], ast.Constant):
                        mode = str(node.args[1].value)
                    for kw in node.keywords:
                        if kw.arg == "mode" and isinstance(kw.value, ast.Constant):
                            mode = str(kw.value.value)
                    if set(mode) & set("wax+"):
                        writers.setdefault(path.name, 0)
                        writers[path.name] += 1
        self.assertEqual(sorted(writers), ["canon.py", "o1_evidence.py"], writers)


class TestOutputsAreDeterministic(unittest.TestCase):
    def run_seed_cli(self, out, *extra, env_extra=None, isolated=True, as_of=AS_OF):
        env = dict(os.environ)
        env.update(env_extra or {})
        cmd = [sys.executable] + (["-I"] if isolated else []) + [str(TOOLS / "build_outputs.py"), "--as-of", as_of,
                                                                  "--out", str(out), *extra]
        proc = subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=str(ROOT), timeout=300)
        self.assertEqual(proc.returncode, 0, proc.stderr[-3000:])
        return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(Path(out).iterdir())}

    def test_seed_mode_without_the_engine_is_byte_identical_and_path_free(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            first = self.run_seed_cli(a, "--no-engine")
            second = self.run_seed_cli(b, "--no-engine")
            self.assertEqual(first, second)
            self.assertEqual(sorted(first), ["HASHES.json", "SHA256SUMS.txt", "claim_status_matrix.json",
                                             "oem_relations.json", "oem_vs_current_report.json", "review_queue.json"])
            for name in first:
                text = (Path(a) / name).read_text(encoding="utf-8")
                for leak in (a, "/tmp/", "/home/"):
                    self.assertNotIn(leak, text, (name, leak))
            rel = json.loads((Path(a) / "oem_relations.json").read_text(encoding="utf-8"))
            self.assertFalse(rel["synthetic"])
            self.assertEqual(rel["summary"]["a_tier_candidates"], 0)
            self.assertEqual(rel["summary"]["veto_candidates"], 0)
            self.assertIsNone(rel["inputs"]["engine_pins"])

    def test_hash_seed_timezone_and_locale_cannot_change_the_outputs(self):
        noise = ({"PYTHONHASHSEED": "1", "TZ": "UTC", "LC_ALL": "C"},
                 {"PYTHONHASHSEED": "2", "TZ": "Pacific/Kiritimati", "LC_ALL": "C.UTF-8"},
                 {"PYTHONHASHSEED": "random", "TZ": "America/St_Johns", "LANG": "ru_RU.UTF-8"})
        results = []
        for env_extra in noise:
            with tempfile.TemporaryDirectory() as out:
                results.append(self.run_seed_cli(out, "--no-engine", env_extra=env_extra, isolated=False))
        self.assertEqual(results[0], results[1])
        self.assertEqual(results[0], results[2])

    def test_as_of_is_required_echoed_and_the_only_time_input(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            self.run_seed_cli(a, "--no-engine", "--ttl-days", "30")
            self.run_seed_cli(b, "--no-engine", "--ttl-days", "30", as_of="2030-01-01")
            ra = json.loads((Path(a) / "oem_relations.json").read_text(encoding="utf-8"))
            rb = json.loads((Path(b) / "oem_relations.json").read_text(encoding="utf-8"))
            self.assertEqual((ra["policy"]["as_of"], rb["policy"]["as_of"]), (AS_OF, "2030-01-01"))
            self.assertEqual((ra["policy"]["ttl_days"], rb["policy"]["ttl_days"]), (30, 30))
            # the seeds carry no accepted evidence, so no clock input can make anything effective
            for doc in (ra, rb):
                self.assertEqual(set(doc["summary"]["by_effective_state"]) - {"UNKNOWN", "CONFLICT_HOLD"}, set())

    @require_engine
    def test_seed_mode_with_the_real_engine_records_pins_and_is_byte_identical(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            first = self.run_seed_cli(a)
            second = self.run_seed_cli(b)
            self.assertEqual(first, second)
            rel = json.loads((Path(a) / "oem_relations.json").read_text(encoding="utf-8"))
            self.assertEqual(sorted(rel["inputs"]["engine_pins"]), sorted(
                ["work/accessories/src/accessory_v4.py", "work/accessories/src/accessory_auto_v39.py",
                 "work/accessories/src/canonical_models.py", "work/accessories/src/v3_rules_v421.py",
                 "work/accessories/src/v32_pipeline.py"]))
            self.assertIsNotNone(rel["identity"]["canonical_models_key_collisions"])


@require_engine
class TestSeedsAreReproducibleFromPr167(unittest.TestCase):
    def test_regenerating_the_seeds_from_the_unchanged_pr167_files_is_byte_identical(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp) / "seeds"
            shutil.copytree(W.SEEDS, work)
            for generated in ("aliases", "articles", "claims", "documents", "makers", "models", "seed_cases"):
                (work / f"{generated}.json").unlink()
            (work / "SEEDS_MANIFEST.json").unlink()
            proc = subprocess.run([sys.executable, "-I", str(TOOLS / "migrate_pr167.py"), "--pr167-root",
                                   str(work / "pr167_source"), "--out", str(work)], capture_output=True, text=True,
                                  cwd=str(ROOT), timeout=300)
            self.assertEqual(proc.returncode, 0, proc.stderr[-3000:])
            committed = canon.load_json(W.SEEDS / "SEEDS_MANIFEST.json")["files"]
            for name, sha in committed.items():
                self.assertEqual(canon.file_sha256(work / name), sha, name)
            self.assertEqual(canon.file_sha256(work / "SEEDS_MANIFEST.json"),
                             canon.file_sha256(W.SEEDS / "SEEDS_MANIFEST.json"))

    def test_the_four_pr167_files_are_unchanged_copies(self):
        prov = canon.load_json(W.SEEDS / "pr167_source" / "PROVENANCE.json")
        self.assertEqual(sorted(prov["files"]), ["HOLDOUT_RESULTS.csv", "NEGATIVE_AND_CONDITIONAL_CONTROLS.csv",
                                                "OEM_VERIFIED_MISSED_PAIRS.csv", "manufacturer_fitment_evidence_v42.json"])
        for name, sha in prov["files"].items():
            self.assertEqual(canon.file_sha256(W.SEEDS / "pr167_source" / name), sha)


if __name__ == "__main__":
    unittest.main()
