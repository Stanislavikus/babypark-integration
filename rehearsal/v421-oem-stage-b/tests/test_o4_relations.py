"""O4: typed relations, five states, scoped non-inheritance, conditions, publish blockers (lock O4 / OD3-OD6)."""
from __future__ import annotations

import random
import tempfile
import unittest
from pathlib import Path

from oem_stage import conditions as cd, o1_evidence as o1, o4_relations as o4
from oem_stage.o2_identity import IdentityRegistry
from oem_stage.o3_articles import ArticleBindings
from oem_stage.schema import ContractError
from tests import synthetic_world as sw

ALLOW = [{"issuer": "acme", "markets": ["GB"], "languages": ["en"]}]


def adapter_keys(seat, chassis, adapter="ADP-200", extension="none"):
    return {"seat": seat, "adapter": f"art:acme:{adapter}", "chassis": chassis, "extension": extension}


class _Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.w = sw.build(self._tmp.name)
        self.rels = self.w.derive_with(self.w.policy) if hasattr(self.w, "derive_with") else o4.derive_relations(
            self.w.claims, self.w.store, self.w.registry, self.w.articles, self.w.vocab, self.w.policy)
        self.idx = o4.RelationIndex(self.rels)

    def afm(self, seat, mpn="RS-100"):
        return self.idx.find("accessory_for_model", accessory=f"art:acme:{mpn}", model=seat)

    def adapter(self, seat, chassis, extension="none", adapter="ADP-200"):
        return self.idx.find("adapter_between", **adapter_keys(seat, chassis, adapter, extension))


class TestFiveStates(_Base):
    def test_listed_requires_accepted_evidence_and_verified_ends(self):
        r = self.afm("zeta:alpha-1")
        self.assertEqual((r["proposed_state"], r["effective_state"]), ("LISTED", "LISTED"))
        self.assertEqual(r["conditions_review_state"], "verified_none")
        self.assertEqual(r["ends"]["accessory"]["binding_status"], "bound")

    def test_listed_conditional_carries_typed_conditions_into_audit_data(self):
        r = self.afm("zeta:alpha-2")
        self.assertEqual(r["effective_state"], "LISTED_CONDITIONAL")
        self.assertEqual(r["conditions"], [{"attr": "usage_context", "op": "in", "value": ["outside_vehicle", "on_stroller"]}])
        self.assertEqual(r["conditions_result_without_context"], cd.UNKNOWN)   # unknown context never passes silently
        self.assertEqual(r["context_requirements"], ["usage_context"])
        self.assertIn("od4_conditional_held", r["publish"]["blockers"])
        self.assertFalse(r["publish"]["a_tier_candidate"])

    def test_absence_is_unknown_never_excluded(self):
        r = self.afm("zeta:alpha-3")
        self.assertEqual((r["proposed_state"], r["effective_state"]), ("UNKNOWN", "UNKNOWN"))
        self.assertFalse(r["veto"]["candidate"])
        self.assertIn("absent_from_list_or_no_positive_claim", r["reasons"])
        self.assertFalse(any(x["effective_state"] == "EXCLUDED" for x in self.rels if "alpha-3" in str(x["ends"])))

    def test_excluded_only_from_an_explicit_scoped_no_recommendation(self):
        r = self.adapter("zeta:beta-1", "acme:frame-x")
        self.assertEqual((r["proposed_state"], r["effective_state"]), ("EXCLUDED", "EXCLUDED"))
        self.assertTrue(r["veto"]["candidate"])
        self.assertEqual(r["veto"]["mode"], "report_only")
        self.assertEqual(r["veto"]["scope"]["seat"], "zeta:beta-1")
        self.assertEqual(r["veto"]["scope"]["chassis"], "acme:frame-x")

    def test_exclusion_is_not_inherited_across_chassis_family_or_generation(self):
        for chassis in ("acme:frame", "acme:frame-cub", "acme:frame-y"):
            r = self.adapter("zeta:beta-1", chassis)
            self.assertTrue(r is None or r["effective_state"] != "EXCLUDED", chassis)
        self.assertEqual(self.idx.state_for("adapter_between", **adapter_keys("zeta:beta-1", "acme:frame-cub")), "UNKNOWN")
        self.assertEqual(self.idx.state_for("adapter_between", **adapter_keys("zeta:beta-2", "acme:frame-x")), "CONFLICT_HOLD")
        self.assertEqual(self.idx.state_for("adapter_between", **adapter_keys("zeta:alpha-1", "acme:frame-x")), "UNKNOWN")

    def test_conflict_hold_for_not_tested_statement_and_for_positive_vs_negative(self):
        nt = self.adapter("zeta:beta-2", "acme:frame-x")
        self.assertEqual(nt["effective_state"], "CONFLICT_HOLD")
        self.assertIn("time_bound_not_tested_unadjudicated", nt["reasons"])
        self.assertEqual(nt["time_bound_statements"][0]["as_of"], "2026-03-01")
        pn = self.adapter("zeta:beta-2", "acme:frame-y")
        self.assertEqual(pn["effective_state"], "CONFLICT_HOLD")
        self.assertIn("positive_vs_explicit_no_recommendation", pn["reasons"])
        self.assertFalse(pn["veto"]["candidate"])   # a conflict is not a veto

    def test_disagreeing_conditions_among_positives_is_a_conflict(self):
        r = self.afm("zeta:alpha-5")
        self.assertEqual(r["effective_state"], "CONFLICT_HOLD")
        self.assertIn("conditions_disagree", r["reasons"])

    def test_proposed_only_evidence_can_hold_but_never_grant(self):
        r = self.afm("zeta:alpha-4")
        self.assertEqual((r["proposed_state"], r["effective_state"]), ("LISTED", "UNKNOWN"))
        self.assertIn("claim_proposed_unverified", r["reasons"])
        self.assertFalse(r["publish"]["a_tier_candidate"])

    def test_unreviewed_conditions_hold_even_with_accepted_claims(self):
        r = self.afm("zeta:alpha-1-pro")
        self.assertEqual((r["proposed_state"], r["effective_state"]), ("LISTED_CONDITIONAL", "UNKNOWN"))
        self.assertIn("conditions_review_unknown", r["reasons"])


class TestTypesAndEnds(_Base):
    def test_adapter_has_two_physical_ends_plus_exact_extension(self):
        r = self.adapter("zeta:beta-1", "acme:frame-y")
        self.assertEqual(set(r["ends"]), {"seat", "adapter", "chassis", "extension"})
        self.assertEqual(r["effective_state"], "LISTED")
        self.assertIn("od5_one_ended_adapter_abstain", r["publish"]["blockers"])
        ext = self.adapter("zeta:beta-1", "acme:frame", extension="art:acme:EXT-1")
        self.assertEqual(ext["effective_state"], "LISTED")
        self.assertEqual(ext["ends"]["extension"]["mpn"], "EXT-1")
        self.assertIsNone(self.adapter("zeta:beta-1", "acme:frame"), "with/without extension are different tuples")

    def test_a_required_but_unspecified_extension_holds_the_relation(self):
        w = self.w
        claim = w.claim({"type": "compatible", "relation_type": "adapter_between", "conditions": [],
                         "conditions_review_state": "verified_none",
                         "ends": sw.adapter_ends("Alpha 1", "Frame Cub", extension={"required": True, "maker_id": None,
                                                                                    "mpn": None, "name": None})},
                        "ADP-200 adapter fits Zeta Beta 1 on Frame Y.")
        rels = o4.derive_relations(w.claims, w.store, w.registry, w.articles, w.vocab, w.policy)
        r = next(x for x in rels if any(c["claim_id"] == claim["claim_id"] for c in x["claims"]))
        self.assertEqual((r["proposed_state"], r["effective_state"]), ("LISTED", "UNKNOWN"))
        self.assertIn("extension_unspecified", r["reasons"])

    def test_vehicle_general_is_class_c_and_never_an_ab_candidate(self):
        r = self.idx.find("vehicle_general", accessory="art:acme:ORG-9")
        self.assertIn("class_c_never_ab", r["publish"]["blockers"])
        self.assertFalse(r["publish"]["a_tier_candidate"])
        self.assertEqual(set(r["ends"]), {"accessory"})

    def test_article_with_sku_alias_expands_to_the_catalog_sku(self):
        r = self.afm("zeta:alpha-3", "RS-300")
        self.assertEqual(r["ends"]["accessory"]["catalog_sku"], "RS-300-X")
        self.assertEqual(r["effective_state"], "LISTED")

    def test_unbound_article_holds_the_relation(self):
        r = self.idx.find("vehicle_general", accessory="art:acme:ORG-9")
        self.assertEqual(r["effective_state"], "UNKNOWN")
        self.assertIn("article:accessory:proposed", r["reasons"])

    def test_cross_brand_ends_are_supported(self):
        # source/adapter makers differ (zeta seat, acme adapter and chassis) and are kept as separate scoped ends
        r = self.adapter("zeta:beta-1", "acme:frame-y")
        self.assertEqual({r["ends"]["seat"]["maker_id"], r["ends"]["adapter"]["maker_id"]}, {"zeta", "acme"})


class TestUnsupportedAndPolicy(_Base):
    def test_unsupported_condition_fails_closed(self):
        w = self.w
        bad = [{"attr": "no_such_attribute", "op": "eq", "value": 1}]
        w.claim(sw.compat_afm("Alpha 2", "RS-300", state="reviewed_constraints", conditions=bad),
                "RS-100 rain shield fits Zeta Alpha 1.")
        rels = o4.derive_relations(w.claims, w.store, w.registry, w.articles, w.vocab, w.policy)
        r = next(x for x in rels if x["conditions"] == bad)
        self.assertEqual(r["effective_state"], "UNKNOWN")
        self.assertIn("unsupported_condition_type", r["reasons"])
        self.assertEqual(r["conditions_result_without_context"], "UNSUPPORTED")
        self.assertEqual(r["context_requirements"], [])

    def test_ttl_is_recorded_and_enforced_only_when_configured(self):
        r = self.afm("zeta:alpha-1")
        self.assertEqual((r["evidence"]["max_age_days"], r["evidence"]["ttl_days"], r["evidence"]["expired"]),
                         (47, None, None))
        w = self.w
        rels = o4.derive_relations(w.claims, w.store, w.registry, w.articles, w.vocab, {**w.policy, "ttl_days": 30})
        r2 = o4.RelationIndex(rels).find("accessory_for_model", accessory="art:acme:RS-100", model="zeta:alpha-1")
        self.assertTrue(r2["evidence"]["expired"])
        self.assertEqual(r2["effective_state"], "UNKNOWN")
        self.assertIn("evidence_expired_ttl", r2["reasons"])
        rels3 = o4.derive_relations(w.claims, w.store, w.registry, w.articles, w.vocab, {**w.policy, "ttl_days": 90})
        r3 = o4.RelationIndex(rels3).find("accessory_for_model", accessory="art:acme:RS-100", model="zeta:alpha-1")
        self.assertEqual((r3["evidence"]["expired"], r3["effective_state"]), (False, "LISTED"))

    def test_policy_contract(self):
        w = self.w
        for policy in ({**w.policy, "veto_mode": "enforce"}, {"allow_synthetic": True}, {**w.policy, "as_of": "17/11/2026"}):
            with self.assertRaises(ContractError):
                o4.derive_relations(w.claims, w.store, w.registry, w.articles, w.vocab, policy)

    def test_default_policy_refuses_synthetic_evidence_and_the_empty_allow_list_blocks_publication(self):
        w = self.w
        rels = o4.derive_relations(w.claims, w.store, w.registry, w.articles, w.vocab, {"as_of": "2026-11-17"})
        self.assertEqual(sum(1 for r in rels if r["effective_state"] == "LISTED"), 0)
        r = self.afm("zeta:alpha-1")
        self.assertIn("od6_allowlist_empty", r["publish"]["blockers"])
        self.assertIn("synthetic_relation", r["publish"]["blockers"])
        self.assertTrue(r["synthetic"])

    def test_allow_list_and_synthetic_flags_are_independent_gates(self):
        w = self.w
        rels = o4.derive_relations(w.claims, w.store, w.registry, w.articles, w.vocab,
                                   {**w.policy, "publish_allow_list": ALLOW})
        r = o4.RelationIndex(rels).find("accessory_for_model", accessory="art:acme:RS-100", model="zeta:alpha-1")
        self.assertEqual(r["publish"]["blockers"], ["synthetic_relation"])
        other = [{"issuer": "acme", "markets": ["DE"], "languages": ["en"]}]
        rels2 = o4.derive_relations(w.claims, w.store, w.registry, w.articles, w.vocab,
                                    {**w.policy, "publish_allow_list": other})
        r2 = o4.RelationIndex(rels2).find("accessory_for_model", accessory="art:acme:RS-100", model="zeta:alpha-1")
        self.assertIn("od6_market_language_not_allowed", r2["publish"]["blockers"])


class TestDeterminismAndSelection(_Base):
    def test_output_is_deterministic_and_order_independent(self):
        w = self.w
        again = o4.derive_relations(w.claims, w.store, w.registry, w.articles, w.vocab, w.policy)
        self.assertEqual(self.rels, again)
        shuffled = list(w.claims)
        random.Random(7).shuffle(shuffled)
        self.assertEqual(self.rels, o4.derive_relations(shuffled, w.store, w.registry, w.articles, w.vocab, w.policy))
        self.assertEqual([r["relation_id"] for r in self.rels], sorted(r["relation_id"] for r in self.rels))

    def test_rejected_and_superseded_claims_do_not_contribute(self):
        w = self.w
        old = next(c for c in w.claims if c["quote"] == "RS-100 rain shield fits Zeta Alpha 1.")
        rejected = o1.review_claim(o1.new_claim(
            doc=w.doc, locator={"kind": "html_text"}, quote="ADP-200 adapter fits Zeta Beta 1 on Frame Y.",
            assertion={"type": "not_recommended", "relation_type": "adapter_between",
                       "ends": sw.adapter_ends("Beta 1", "Frame Y")}, extracted_by=sw.EXTRACTOR,
            created_by="parser:t", created_utc=sw.UTC, synthetic=True), reviewer="human:alice", decision="REJECTED",
            reviewed_utc=sw.UTC)
        rels = o4.derive_relations(w.claims + [rejected], w.store, w.registry, w.articles, w.vocab, w.policy)
        self.assertEqual(o4.RelationIndex(rels).find("adapter_between", **adapter_keys("zeta:beta-1", "acme:frame-y"))
                         ["effective_state"], "LISTED")
        new = o1.review_claim(o1.new_claim(
            doc=w.doc, locator={"kind": "html_text"}, quote="RS-100 rain shield fits Zeta Alpha 1.",
            assertion=sw.compat_afm("Alpha 1", "RS-100", state="reviewed_constraints",
                                    conditions=[{"attr": "usage_context", "op": "eq", "value": "outside_vehicle"}]),
            extracted_by=sw.EXTRACTOR, created_by="parser:t", created_utc=sw.UTC, synthetic=True,
            supersedes=old["claim_id"]), reviewer=sw.REVIEWER, decision="VERIFIED", reviewed_utc=sw.UTC)
        rels2 = o4.derive_relations(w.claims + [new], w.store, w.registry, w.articles, w.vocab, w.policy)
        r = o4.RelationIndex(rels2).find("accessory_for_model", accessory="art:acme:RS-100", model="zeta:alpha-1")
        self.assertEqual(r["effective_state"], "LISTED_CONDITIONAL")   # the superseding claim replaced the old one
        self.assertEqual({c["effective_status"] for c in r["claims"]}, {"ACCEPTED"})

    def test_find_all_matches_given_ends_only_and_find_is_exact(self):
        many = self.idx.find_all("adapter_between", adapter="art:acme:ADP-200", seat="zeta:beta-1")
        self.assertGreaterEqual(len(many), 3)
        self.assertIsNone(self.idx.find("adapter_between", adapter="art:acme:ADP-200", seat="zeta:beta-1"))
        self.assertEqual(self.idx.state_for("accessory_for_model", accessory="art:acme:RS-100", model="zeta:nothing"),
                         "UNKNOWN")

    def test_summary_counts(self):
        s = o4.summarize(self.rels)
        self.assertEqual(s["relations"], len(self.rels))
        self.assertEqual(sum(s["by_effective_state"].values()), len(self.rels))
        self.assertEqual(s["veto_candidates"], 1)
        self.assertEqual(s["a_tier_candidates"], 0)


class TestVerifiedNonSyntheticGatePath(unittest.TestCase):
    """What-if: if REAL evidence + a human review + an owner allow-list existed, the gate logic would let a *candidate*
    through (still shadow, still behind Stage1/locale/owner gates). Fixture data only; never written to data/ or out/."""

    def test_candidate_only_when_every_gate_is_satisfied(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = o1.DocumentStore(Path(tmp) / "blobs")
            page = (b"<html><body><p>Article Q-1 is the Acme test accessory.</p>"
                    b"<p>Q-1 fits Zeta Z1.</p></body></html>")
            doc = store.put_bytes(page, media_type="text/html", issuer="acme", url="https://example.invalid/whatif",
                                  document_version="whatif-1", document_date="2026-11-01", market="GB", language="en",
                                  retrieved_utc=sw.UTC, captured_by="human:whatif-capturer", synthetic=False)

            def make(quote, assertion):
                c = o1.new_claim(doc=doc, locator={"kind": "html_text"}, quote=quote, assertion=assertion,
                                 extracted_by="human:whatif-extractor", created_by="parser:t", created_utc=sw.UTC)
                return o1.review_claim(c, reviewer="human:whatif-reviewer", decision="VERIFIED", reviewed_utc=sw.UTC)

            ident = make("Article Q-1 is the Acme test accessory.", {
                "type": "article_identity", "article": {"maker_id": "acme", "mpn": "Q-1", "role": "accessory",
                                                        "sku_alias": None}})
            fit = make("Q-1 fits Zeta Z1.", sw.compat_afm("Z1", "Q-1"))
            registry = IdentityRegistry(sw.MAKERS, [{"model_id": "zeta:z1", "maker_id": "zeta", "display": "Z1",
                                                     "kind": "car_seat"}], [])
            policy = {"as_of": "2026-11-17", "publish_allow_list": ALLOW}
            accepted = {c["claim_id"]: c for c in (ident, fit) if o1.check_claim(c, store, policy)["accepted"]}
            self.assertEqual(len(accepted), 2)
            binding = {"binding_id": "b1", "manufacturer_id": "acme", "mpn": "Q-1", "catalog_sku": "Q-1",
                       "evidence_claim_ids": [ident["claim_id"]], "status": "VERIFIED",
                       "review": {"reviewer": "human:whatif-reviewer", "reviewed_utc": sw.UTC, "note": ""},
                       "proposed_by": "parser:t"}
            articles = ArticleBindings([binding], [], accepted, {"Q-1"})
            vocab = cd.load_vocab(sw.ROOT / "data" / "conditions_vocab.json")
            rels = o4.derive_relations([ident, fit], store, registry, articles, vocab, policy)
            self.assertEqual(len(rels), 1)
            r = rels[0]
            self.assertEqual((r["effective_state"], r["publish"]["blockers"], r["synthetic"]), ("LISTED", [], False))
            self.assertTrue(r["publish"]["a_tier_candidate"])
            self.assertEqual(r["publish"]["downstream_gates"],
                             ["stage1_native_receipt", "locale_variant_commercial_gates", "owner_enablement_flag"])
            # the same evidence with an empty allow-list is blocked (OD6 default)
            blocked = o4.derive_relations([ident, fit], store, registry, articles, vocab, {"as_of": "2026-11-17"})[0]
            self.assertFalse(blocked["publish"]["a_tier_candidate"])
            self.assertIn("od6_allowlist_empty", blocked["publish"]["blockers"])


if __name__ == "__main__":
    unittest.main()
