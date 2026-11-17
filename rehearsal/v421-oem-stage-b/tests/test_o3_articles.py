"""O3: exact (maker, MPN) -> catalog SKU joins; SKU is an identity join, never fitment evidence (lock O3)."""
from __future__ import annotations

import tempfile
import unittest

from oem_stage import o1_evidence as o1
from oem_stage.o3_articles import ArticleBindings, norm_mpn
from oem_stage.schema import ContractError
from tests import synthetic_world as sw

REVIEW = {"reviewer": "human:alice", "reviewed_utc": sw.UTC, "note": "t"}


def binding(bid, maker, mpn, sku, claims, status="VERIFIED"):
    return {"binding_id": bid, "manufacturer_id": maker, "mpn": mpn, "catalog_sku": sku, "evidence_claim_ids": claims,
            "status": status, "review": None if status == "PROPOSED" else dict(REVIEW), "proposed_by": "parser:t"}


class TestWithSyntheticEvidence(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.w = sw.build(self._tmp.name)
        self.rs100 = self.w.__dict__["id_RS-100"]["claim_id"]
        self.rs300 = self.w.__dict__["id_RS-300"]["claim_id"]
        self.adp = self.w.__dict__["id_ADP-200"]["claim_id"]

    def make(self, bindings, unjoined=(), skus=None):
        return ArticleBindings(bindings, unjoined, self.w.accepted, skus)

    def test_bound_needs_verified_binding_and_an_accepted_identity_claim(self):
        a = self.make([binding("b1", "acme", "RS-100", "RS-100", [self.rs100])])
        res = a.lookup("acme", "rs-100 ")
        self.assertEqual((res["status"], res["catalog_sku"], res["binding_id"]), ("bound", "RS-100", "b1"))

    def test_proposed_binding_is_visible_but_not_bound(self):
        a = self.make([binding("b1", "acme", "RS-100", "RS-100", [self.rs100], "PROPOSED")])
        res = a.lookup("acme", "RS-100")
        self.assertEqual((res["status"], res["reasons"]), ("proposed", ["binding_unverified"]))

    def test_verified_binding_without_accepted_evidence_stays_proposed(self):
        a = self.make([binding("b1", "acme", "RS-100", "RS-100", [])])
        self.assertEqual(a.lookup("acme", "RS-100")["status"], "proposed")
        self.assertIn("no_evidence_claim", a.lookup("acme", "RS-100")["reasons"])
        a2 = self.make([binding("b1", "acme", "RS-100", "RS-100", ["clm:0000000000000000"])])
        self.assertIn("evidence_claim_not_accepted:clm:0000000000000000", a2.lookup("acme", "RS-100")["reasons"])

    def test_evidence_must_be_an_article_identity_claim_for_the_same_article(self):
        fitment = next(c for c in self.w.claims if c["assertion"]["type"] == "compatible")
        a = self.make([binding("b1", "acme", "RS-100", "RS-100", [fitment["claim_id"]])])
        self.assertEqual(a.lookup("acme", "RS-100")["status"], "proposed")
        wrong = self.make([binding("b1", "acme", "RS-100", "RS-100", [self.adp])])   # identity claim for ADP-200
        self.assertEqual(wrong.lookup("acme", "RS-100")["status"], "proposed")
        self.assertTrue(any(r.startswith("evidence_claim_does_not_name_this_join") for r in
                            wrong.lookup("acme", "RS-100")["reasons"]))

    def test_sku_alias_must_be_named_by_the_evidence(self):
        ok = self.make([binding("b1", "acme", "RS-300", "RS-300-X", [self.rs300])])
        self.assertEqual(ok.lookup("acme", "RS-300")["status"], "bound")
        no_alias = self.make([binding("b1", "acme", "RS-100", "RS-100-X", [self.rs100])])   # evidence names no alias
        self.assertEqual(no_alias.lookup("acme", "RS-100")["status"], "proposed")

    def test_uniqueness_conflicts_fail_closed_both_ways(self):
        many_skus = self.make([binding("b1", "acme", "RS-100", "S1", [self.rs100]),
                               binding("b2", "acme", "RS-100", "S2", [self.rs100])])
        self.assertEqual(many_skus.lookup("acme", "RS-100")["status"], "conflict")
        self.assertIn("mpn_to_multiple_skus", many_skus.lookup("acme", "RS-100")["reasons"])
        many_arts = self.make([binding("b1", "acme", "RS-100", "S1", [self.rs100]),
                               binding("b2", "acme", "ADP-200", "S1", [self.adp])])
        for mpn in ("RS-100", "ADP-200"):
            res = many_arts.lookup("acme", mpn)
            self.assertEqual(res["status"], "conflict", mpn)
            self.assertIn("sku_to_multiple_articles", res["reasons"])

    def test_rejected_bindings_are_ignored(self):
        a = self.make([binding("b1", "acme", "RS-100", "S1", [self.rs100], "REJECTED"),
                       binding("b2", "acme", "RS-100", "RS-100", [self.rs100])])
        self.assertEqual(a.lookup("acme", "RS-100")["status"], "bound")

    def test_maker_scope_is_part_of_the_key(self):
        a = self.make([binding("b1", "acme", "RS-100", "RS-100", [self.rs100])])
        self.assertEqual(a.lookup("zeta", "RS-100")["status"], "unbound")

    def test_unjoined_candidate_never_binds(self):
        a = self.make([], unjoined=[{"manufacturer_id": "acme", "mpn": "RS-777", "seller_skus": ["RS-770"],
                                     "reason": "similar title only"}])
        res = a.lookup("acme", "RS-777")
        self.assertEqual((res["status"], res["reasons"]), ("unbound", ["unjoined_candidate_unproven"]))
        self.assertEqual(a.lookup("acme", "RS-770")["status"], "unbound")   # a seller SKU is not an MPN

    def test_sku_must_exist_in_the_catalog_when_a_catalog_is_known(self):
        a = self.make([binding("b1", "acme", "RS-100", "RS-100", [self.rs100])], skus={"OTHER"})
        self.assertEqual(a.lookup("acme", "RS-100")["reasons"], ["sku_not_in_catalog"])

    def test_by_catalog_sku(self):
        a = self.make([binding("b1", "acme", "RS-100", "RS-100", [self.rs100])])
        self.assertEqual([x["binding_id"] for x in a.by_catalog_sku("RS-100")], ["b1"])
        self.assertEqual(a.by_catalog_sku("nope"), [])


class TestRecordShape(unittest.TestCase):
    def test_gtin_title_price_and_manual_fields_are_not_representable(self):
        for extra in ("gtin", "title", "price", "manual_association", "similarity", "ean"):
            rec = binding("b1", "acme", "X", "X", [])
            rec[extra] = "x"
            with self.assertRaises(ContractError, msg=extra):
                ArticleBindings([rec])

    def test_review_contract(self):
        with self.assertRaises(ContractError):
            ArticleBindings([{**binding("b1", "acme", "X", "X", []), "review": None}])
        with self.assertRaises(ContractError):
            ArticleBindings([{**binding("b1", "acme", "X", "X", []), "review": {**REVIEW, "reviewer": "llm:x"}}])
        with self.assertRaises(ContractError):
            ArticleBindings([{**binding("b1", "acme", "X", "X", [], "PROPOSED"), "review": dict(REVIEW)}])
        with self.assertRaises(ContractError):
            ArticleBindings([binding("b1", "acme", "X", "X", []), binding("b1", "acme", "Y", "Y", [])])

    def test_norm_mpn_is_exact_apart_from_case_and_trim(self):
        self.assertEqual(norm_mpn("  rs-100 "), "RS-100")
        self.assertNotEqual(norm_mpn("RS-100"), norm_mpn("RS100"))
        self.assertNotEqual(norm_mpn("11006001"), norm_mpn("11006001par"))   # BeSafe: a suffix is a different article


if __name__ == "__main__":
    unittest.main()
