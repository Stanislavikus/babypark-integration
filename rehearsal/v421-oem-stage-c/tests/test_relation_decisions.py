"""tools/relation_decisions.py: the relation-level view of the gate for a Stage B ``oem_relations.json``.

It applies the gate's own ``decide_relation`` with the default policy and no byte store, so it can never accept anything. The committed
``out/real_relations/relation_decisions.json`` is the view of the accepted REAL shadow relations (SHA-256 pinned in ``test_real_relations_held``);
a test proves that the committed file is exactly what the tool produces now (not stale, not hand-edited).
"""
from __future__ import annotations

import io
import contextlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

from tests.helpers import ROOT, STAGE_B
from tests.test_gate import WorldCase, non_synthetic
from tests import world_fixture as WF

sys.path.insert(0, str(ROOT / "tools"))
import relation_decisions as rd  # noqa: E402
from oem_stage import canon  # noqa: E402

REAL = STAGE_B / "out" / "oem_relations.json"
COMMITTED = ROOT / "out" / "real_relations" / "relation_decisions.json"


def run_cli(*args):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = rd.main([str(a) for a in args])
    return code, out.getvalue(), err.getvalue()


class TestRelationDecisionsOnSyntheticRelations(WorldCase):
    def doc(self, *relations, synthetic=True):
        return {"schema": "bp-oem-relations-v1", "relations": list(relations), "relations_digest": canon.digest(list(relations)), "synthetic": synthetic}

    def test_even_a_fully_verified_relation_is_never_accepted_by_this_view(self):
        result = rd.decisions_document(self.doc(non_synthetic(self.listed), synthetic=False), as_of=WF.AS_OF, relations_sha256="0" * 64)
        self.assertEqual((result["summary"]["accept"], result["summary"]["hold"]), (0, 1))
        self.assertIn("evidence_doc_hash_unknown", result["relations"][0]["reasons"])      # the byte store is unknown here: only the gate can accept
        self.assertIn("never accept", result["notice"])

    def test_the_output_is_sorted_by_relation_and_reports_every_reason(self):
        rels = [non_synthetic(self.listed), self.listed]
        result = rd.decisions_document(self.doc(*rels), as_of=WF.AS_OF, relations_sha256="0" * 64)
        ids = [r["relation_id"] for r in result["relations"]]
        self.assertEqual(ids, sorted(ids))
        self.assertEqual(sum(result["summary"]["by_reason"].values()), sum(len(r["reasons"]) for r in result["relations"]))

    def test_a_document_of_the_wrong_schema_is_refused(self):
        for bad in ({"schema": "other", "relations": []}, {"schema": "bp-oem-relations-v1"}, [], "x"):
            with self.subTest(bad=str(bad)[:30]), self.assertRaises(rd.Refused):
                rd.decisions_document(bad, as_of=WF.AS_OF, relations_sha256="0" * 64)


class TestCli(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def write_relations(self, obj):
        path = self.tmp / "rel.json"
        path.write_text(json.dumps(obj), encoding="utf-8")
        return path

    def test_refusals_write_nothing_and_exit_2(self):
        good = self.write_relations({"schema": "bp-oem-relations-v1", "relations": []})
        occupied = self.tmp / "occupied"
        occupied.mkdir()
        (occupied / "x").write_text("x", encoding="utf-8")
        cases = {"missing relations file": (self.tmp / "nope.json", "2026-11-17", self.tmp / "o1"),
                 "bad as_of": (good, "2026-13-01", self.tmp / "o2"),
                 "occupied output directory": (good, "2026-11-17", occupied),
                 "wrong schema": (self.write_relations({"schema": "x", "relations": []}), "2026-11-17", self.tmp / "o3")}
        for name, (rel, as_of, out) in cases.items():
            with self.subTest(name):
                code, _, err = run_cli("--relations", rel, "--as-of", as_of, "--out", out)
                self.assertEqual(code, 2, err)
                self.assertIn("REFUSED", err)
        self.assertEqual([p.name for p in occupied.iterdir()], ["x"])
        for name in ("o1", "o2", "o3"):
            self.assertFalse((self.tmp / name).exists(), name)

    def test_an_empty_relations_document_gives_an_empty_valid_result(self):
        code, out, _ = run_cli("--relations", self.write_relations({"schema": "bp-oem-relations-v1", "relations": []}), "--as-of", "2026-11-17",
                               "--out", self.tmp / "ok")
        self.assertEqual(code, 0)
        doc = json.loads((self.tmp / "ok" / "relation_decisions.json").read_text(encoding="utf-8"))
        self.assertEqual((doc["summary"]["relations"], doc["relations"]), (0, []))
        sums = (self.tmp / "ok" / "SHA256SUMS.txt").read_text(encoding="utf-8")
        self.assertEqual(sums, f"{canon.file_sha256(self.tmp / 'ok' / 'relation_decisions.json')}  relation_decisions.json\n")


@unittest.skipUnless(REAL.is_file() and COMMITTED.is_file(), "the accepted Stage B output or the committed view is not available")
class TestCommittedViewOfTheRealRelations(unittest.TestCase):
    def test_the_committed_file_is_exactly_what_the_tool_produces_now(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, _, err = run_cli("--relations", REAL, "--as-of", "2026-11-17", "--out", Path(tmp) / "out")
            self.assertEqual(code, 0, err)
            self.assertEqual((Path(tmp) / "out" / "relation_decisions.json").read_bytes(), COMMITTED.read_bytes())
        sums = (COMMITTED.parent / "SHA256SUMS.txt").read_text(encoding="utf-8")
        self.assertEqual(sums, f"{canon.file_sha256(COMMITTED)}  relation_decisions.json\n")

    def test_the_view_of_the_real_relations_accepts_nothing_and_binds_the_accepted_input(self):
        doc = json.loads(COMMITTED.read_text(encoding="utf-8"))
        self.assertEqual(doc["inputs"]["relations_sha256"], "7c606903c1861d1399457be812bcdf76e2f81951838d18275d69e6cc0691f44e")
        self.assertEqual((doc["summary"]["relations"], doc["summary"]["accept"], doc["summary"]["hold"]), (43, 0, 43))
        self.assertFalse(doc["inputs"]["synthetic"])
        for rel in doc["relations"]:
            self.assertEqual(rel["decision"], "HOLD")
            self.assertGreaterEqual(len(rel["reasons"]), 6)


if __name__ == "__main__":
    unittest.main()
