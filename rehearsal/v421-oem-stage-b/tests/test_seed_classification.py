"""All 13 PR #167 physical relations (26 RU+UK locale cases) and the cross-brand Bugaboo holdouts, classified.

These are the *as-shipped* expectations: the seeds carry no real OEM bytes and no human review, so every positive
relation must be HOLD/UNKNOWN (never LISTED/accepted), identity risks must be held, and the lock's negative
semantics (N01 CONFLICT_HOLD, N02 UNKNOWN, N03 scoped report-only veto candidate) must hold.
"""
from __future__ import annotations

import copy
import unittest
from collections import Counter

from oem_stage import canon, classify, o1_evidence as o1, outputs, shadow, world as W
from oem_stage.o4_relations import RelationIndex


class _Seeds(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.w = W.load_world(policy={"as_of": "2026-11-17"})
        cls.rels = cls.w.derive()
        cls.idx = RelationIndex(cls.rels)
        cls.seed_cases = canon.load_json(W.SEEDS / "seed_cases.json")
        cls.extras = canon.load_json(W.SEEDS / "holdout_endpoints.json")
        cls.view, cls.groups = classify.build_seed_view(cls.seed_cases, cls.w.registry)
        cls.doc = outputs.classification_doc(
            cls.w, cls.rels, cls.seed_cases, cls.extras, canon.load_json(W.SEEDS / "condition_vectors.json"),
            canon.load_json(W.SEEDS / "typed_conditions.json"), {}, cls.groups)
        cls.by_nid = {c["source"]["nid"]: c for c in cls.doc["locale_cases"]}
        cls.hold = {h["prefix"]: h for h in cls.doc["holdouts"]}


class TestNothingIsFabricated(_Seeds):
    def test_every_seed_claim_is_proposed_and_none_is_accepted(self):
        self.assertEqual(len(self.w.claims), 53)
        self.assertEqual({c["status"] for c in self.w.claims}, {"PROPOSED"})
        self.assertEqual(self.w.accepted, {})
        self.assertTrue(all(c["review"] is None for c in self.w.claims))
        self.assertTrue(all(d["sha256"] is None and d["bytes_state"] == "missing" for d in self.w.store.registry()))

    def test_no_relation_is_effectively_listed_or_a_publish_candidate(self):
        self.assertEqual({r["effective_state"] for r in self.rels} - {"UNKNOWN", "CONFLICT_HOLD"}, set())
        self.assertEqual(sum(1 for r in self.rels if r["publish"]["a_tier_candidate"]), 0)
        self.assertEqual(sum(1 for r in self.rels if r["veto"]["candidate"]), 0)
        self.assertEqual(self.doc["counts"]["publishable_now"], 0)
        self.assertFalse(any(r["synthetic"] for r in self.rels))

    def test_a_human_clicking_verified_on_a_byteless_pr167_claim_still_cannot_make_it_accepted(self):
        for claim in self.w.claims:
            verified = o1.review_claim(claim, reviewer="human:anyone", decision="VERIFIED", reviewed_utc="2026-11-17T12:00:00Z")
            res = o1.check_claim(verified, self.w.store, self.w.policy)
            self.assertFalse(res["accepted"], claim["claim_id"])
            self.assertIn("bytes_missing", res["reasons"])
            self.assertIn("locator_not_byte_backed", res["reasons"])

    def test_seed_files_match_their_manifest_and_pr167_provenance(self):
        manifest = canon.load_json(W.SEEDS / "SEEDS_MANIFEST.json")["files"]
        for name, sha in manifest.items():
            self.assertEqual(canon.file_sha256(W.SEEDS / name), sha, name)
        prov = canon.load_json(W.SEEDS / "pr167_source" / "PROVENANCE.json")
        self.assertEqual(prov["pr167_head"], "706f292c419cac7ec88b68a1393259dc3af8e402")
        for name, sha in prov["files"].items():
            self.assertEqual(canon.file_sha256(W.SEEDS / "pr167_source" / name), sha, name)


class TestThirteenPhysicalRelations(_Seeds):
    def test_counts_and_locale_pairing(self):
        c = self.doc["counts"]
        self.assertEqual((c["physical_relations"], c["locale_cases"], c["holdouts"], c["controls"]), (13, 26, 8, 8))
        for p in self.doc["physical_relations"]:
            self.assertEqual(p["locales"], ["ru", "uk"])
            self.assertTrue(p["locale_consistent"], p["physical_relation_id"])
        self.assertEqual(Counter(p["group_id"][:3] for p in self.doc["physical_relations"]),
                         {"P01": 11, "P02": 1, "P03": 1})

    def test_verdict_distribution_is_exactly_the_as_shipped_one(self):
        self.assertEqual(self.doc["counts"]["physical_verdicts"], {"HOLD_ARTICLE_BINDING": 10, "HOLD_CATALOG_IDENTITY": 3})
        self.assertEqual(self.doc["counts"]["locale_verdicts"], {"HOLD_ARTICLE_BINDING": 20, "HOLD_CATALOG_IDENTITY": 6})

    def test_plain_p01_models_hold_on_article_binding_with_a_proposed_conditional_relation(self):
        for nid in (134907, 134912, 136852, 137510, 137851, 137852, 138021, 143126, 143259):
            case = self.by_nid[nid]
            self.assertEqual(case["verdict"], "HOLD_ARTICLE_BINDING", case["case_id"])
            (rel,) = case["relations"]
            self.assertEqual((rel["proposed_state"], rel["effective_state"]), ("LISTED_CONDITIONAL", "UNKNOWN"))
            self.assertIn("claim_proposed_unverified", rel["reasons"])
            self.assertIn("article:accessory:proposed", rel["reasons"])
            self.assertIn("od4_conditional_held", rel["blockers"])
            self.assertEqual(rel["conditions_result_without_context"], "UNKNOWN")
            self.assertFalse(case["publishable_now"])
            self.assertEqual(case["target"]["field_status"], 1)

    def test_catalog_identity_holds_cyrillic_extract_artifact_and_xdash_spellings(self):
        expectations = {136855: "Dualfix Pro М", 136666: "Britax-R mer Evolvafix", 133428: "iZi Go Modular X-1 iSize"}
        for nid, text in expectations.items():
            for case in (self.by_nid[nid], self.by_nid[nid + 0]):
                self.assertEqual(case["verdict"], "HOLD_CATALOG_IDENTITY", text)
                self.assertEqual(case["catalog_identity"]["status"], "unresolved")
                self.assertIn("alias_unreviewed", " ".join(case["catalog_identity"]["reasons"]))
                self.assertEqual(case["catalog_identity"]["locale_strings"]["ru"], text)
                self.assertEqual(len(case["relations"]), 1)   # the OEM side exists; only the catalog join is held
        self.assertEqual(self.by_nid[136855]["oem_model_resolution"]["model_id"], "britax-romer:dualfix-pro-m")

    def test_p03_two_sided_adapter_is_an_adapter_relation_with_a_required_unspecified_extension(self):
        case = self.by_nid[144473]
        self.assertEqual(case["relation_type"], "adapter_between")
        self.assertEqual(case["verdict"], "HOLD_ARTICLE_BINDING")
        self.assertEqual(len(case["relations"]), 2)   # Fame and Fame Cabin are separate scoped tuples
        self.assertTrue(any("extension_unspecified" in r["reasons"] for r in case["relations"]))
        self.assertTrue(all("od5_one_ended_adapter_abstain" in r["blockers"] for r in case["relations"]))

    def test_p02_family_alias_is_not_resolved_by_normalization(self):
        case = self.by_nid[133428]
        self.assertEqual(case["verdict"], "HOLD_CATALOG_IDENTITY")
        # the OEM list names X1 and X1 i-Size separately; neither is X2 (absent => UNKNOWN)
        states = {tuple(sorted(r["proposed_state"] for r in self.idx.find_all(
            "accessory_for_model", accessory="art:besafe:11006001", model=m))) for m in
                  ("besafe:izi-go-modular-x1", "besafe:izi-go-modular-x1-i-size", "besafe:izi-go-modular-x2")}
        self.assertEqual(states, {("LISTED_CONDITIONAL",), ("UNKNOWN",)})
        self.assertEqual(self.idx.state_for("accessory_for_model", accessory="art:besafe:11006001",
                                            model="besafe:izi-go-modular-x2"), "UNKNOWN")


class TestCrossBrandHoldouts(_Seeds):
    def test_every_holdout_matches_the_lock_expectation(self):
        self.assertEqual(self.doc["counts"]["holdouts_matching_lock"], 8)
        self.assertEqual(sorted(self.hold), ["H01", "H02", "H03", "H04", "N01", "N02", "N03", "N04"])

    def test_positive_cross_brand_adapter_holdouts_are_proposed_conditional_and_held(self):
        for prefix in ("H01", "H02", "H03", "H04"):
            h = self.hold[prefix]
            self.assertEqual(h["stage_b_proposed_states"], ["LISTED_CONDITIONAL"], prefix)
            self.assertFalse(h["publishable_now"])
            for rel in h["relations"]:
                self.assertEqual(rel["effective_state"], "UNKNOWN")
                self.assertIn("od5_one_ended_adapter_abstain", rel["blockers"])
            self.assertIn("one_ended_adapter:chassis_has_no_catalog_source", h["hold_reasons"])
        for prefix in ("H01", "H02", "H03", "H04"):
            for rel_summary in self.hold[prefix]["relations"]:
                rel = next(r for r in self.rels if r["relation_id"] == rel_summary["relation_id"])
                self.assertEqual(rel["ends"]["adapter"]["maker_id"], "bugaboo")
                self.assertEqual(rel["ends"]["chassis"]["maker_id"], "bugaboo")
                self.assertNotEqual(rel["ends"]["seat"]["maker_id"], rel["ends"]["adapter"]["maker_id"])  # cross-brand
        h01 = self.hold["H01"]
        self.assertEqual(h01["target"]["field_status"], 3)
        self.assertIn("target_field_status:3", h01["hold_reasons"])

    def test_n01_dragonfly_vs_pebble_360_pro_2_is_conflict_hold(self):
        h = self.hold["N01"]
        self.assertEqual((h["verdict"], h["stage_b_proposed_states"]), ("CONFLICT_HOLD", ["CONFLICT_HOLD"]))
        for chassis in ("bugaboo:dragonfly", "bugaboo:dragonfly-plus"):
            rel = self.idx.find("adapter_between", seat="maxi-cosi:pebble-360-pro-2", adapter="art:bugaboo:400003001",
                                chassis=chassis, extension="none")
            self.assertEqual(rel["effective_state"], "CONFLICT_HOLD")
            self.assertIn("time_bound_not_tested_unadjudicated", rel["reasons"])
            self.assertFalse(rel["veto"]["candidate"])
            self.assertFalse(rel["veto"]["pending_verification"])

    def test_n02_fox_2_vs_pebble_pro_2_is_unknown_not_excluded(self):
        h = self.hold["N02"]
        self.assertEqual((h["verdict"], h["stage_b_proposed_states"]), ("UNKNOWN_NOT_LISTED", ["UNKNOWN"]))
        rel = self.idx.find("adapter_between", seat="maxi-cosi:pebble-360-pro-2", adapter="art:bugaboo:400019001",
                            chassis="bugaboo:fox-2", extension="none")
        self.assertEqual((rel["proposed_state"], rel["effective_state"]), ("UNKNOWN", "UNKNOWN"))
        self.assertFalse(rel["veto"]["candidate"] or rel["veto"]["pending_verification"])

    def test_n03_cabriofix_on_dragonfly_is_a_scoped_report_only_veto_candidate_pending_verification(self):
        h = self.hold["N03"]
        self.assertEqual(h["verdict"], "EXCLUDED_PENDING_VERIFICATION")
        for chassis in ("bugaboo:dragonfly", "bugaboo:dragonfly-plus"):
            rel = self.idx.find("adapter_between", seat="maxi-cosi:cabriofix", adapter="art:bugaboo:400003001",
                                chassis=chassis, extension="none")
            self.assertEqual((rel["proposed_state"], rel["effective_state"]), ("EXCLUDED", "UNKNOWN"))
            self.assertTrue(rel["veto"]["pending_verification"])
            self.assertFalse(rel["veto"]["candidate"])          # not a candidate until the claims are VERIFIED
            self.assertEqual(rel["veto"]["mode"], "report_only")
            self.assertEqual(rel["veto"]["scope"]["chassis"], chassis)
        # scoped: the Dragonfly/CabrioFix no-recommendation says nothing about Fox 2 / Fox 5 with CabrioFix
        for chassis in ("bugaboo:fox-2", "bugaboo:fox-5", "bugaboo:fox-5-renew"):
            self.assertEqual(self.idx.state_for("adapter_between", seat="maxi-cosi:cabriofix",
                                                adapter="art:bugaboo:400019001", chassis=chassis, extension="none"),
                             "UNKNOWN", chassis)
        self.assertEqual(self.idx.find_all("adapter_between", seat="maxi-cosi:cabriofix", adapter="art:bugaboo:400019001"), [])

    def test_n04_relax_insert_article_is_not_bound_by_title_similarity(self):
        h = self.hold["N04"]
        self.assertEqual(h["verdict"], "HOLD_ARTICLE_BINDING")
        look = self.w.articles.lookup("britax-romer", "ACCSFCC207")
        self.assertEqual((look["status"], look["reasons"]), ("unbound", ["unjoined_candidate_unproven"]))
        self.assertIsNone(look["catalog_sku"])
        self.assertEqual(self.w.articles.lookup("britax-romer", "2000040775")["status"], "unbound")  # seller SKU != MPN


class TestControlsNormalizationAndConditions(_Seeds):
    def test_controls(self):
        by = {(c["control"], c["source_model"]): c for c in self.doc["controls"]}
        self.assertEqual(by[("Britax Comfort Insert", "KIDFIX PRO")]["verdict"], "UNKNOWN_NOT_LISTED")
        self.assertEqual(by[("Britax Comfort Insert", "SWIVEL")]["verdict"], "UNKNOWN_NOT_LISTED")
        self.assertEqual(by[("Maxi-Cosi adapter", "Coral 360")]["verdict"], "UNKNOWN_NOT_LISTED")
        self.assertEqual(by[("Maxi Cosi Pocket", "RodiFix Air Protect")]["verdict"], "UNKNOWN_NOT_LISTED")
        self.assertEqual(by[("Britax Comfort Insert", "DUALFIX PRO")]["verdict"], "HOLD_ARTICLE_BINDING")
        self.assertEqual(by[("Maxi-Cosi adapter", "Coral Slide Pro")]["verdict"], "HOLD_ARTICLE_BINDING")
        self.assertEqual(len(by[("Maxi-Cosi adapter", "Coral Slide Pro")]["relations"]), 2)
        organiser = by[("Car organiser C", "any car seat / stand-alone ISOFIX base")]
        self.assertIn("blocker:class_c_never_ab", organiser["hold_reasons"])
        self.assertFalse(any(r["a_tier_candidate"] for r in organiser["relations"]))
        # SWIVEL is not conflated with SWIVEL 2
        swivel2 = self.idx.find_all("accessory_for_model", accessory="art:britax-romer:2000030111", model="britax-romer:swivel-2")
        swivel = self.idx.find_all("accessory_for_model", accessory="art:britax-romer:2000030111", model="britax-romer:swivel")
        self.assertEqual(([r["proposed_state"] for r in swivel2], [r["proposed_state"] for r in swivel]),
                         (["LISTED_CONDITIONAL"], ["UNKNOWN"]))

    def test_normalization_cases(self):
        by = {n["case_id"][:3]: n for n in self.doc["identity_normalization"]}
        self.assertEqual(by["M01"]["agreement"], "STRICTER_HOLD_REVIEWED_ALIAS_REQUIRED")
        self.assertEqual(by["M01"]["stage_b"]["reason"], "alias_unreviewed")
        for key in ("M02", "M03", "M04", "M05"):
            self.assertEqual(by[key]["agreement"], "AGREES_EQUAL", key)
        self.assertEqual(by["M06"]["agreement"], "AGREES_DISTINCT_NOT_RESOLVED")
        self.assertTrue(all(n["distinct_ok"] for n in by.values()))

    def test_identity_probes_and_condition_vectors(self):
        self.assertTrue(all(p["as_expected"] for p in self.doc["identity_probes"]), [p for p in self.doc["identity_probes"] if not p["as_expected"]])
        self.assertEqual(len(self.doc["condition_vectors"]), 15)
        self.assertTrue(all(c["as_expected"] for c in self.doc["condition_vectors"]))
        c14 = next(c for c in self.doc["condition_vectors"] if c["case_id"].startswith("C14"))
        self.assertEqual((c14["result"], c14["level"]), ("UNKNOWN", "relation_tuple_missing"))


class TestStage1GapAndShadowPairs(_Seeds):
    def test_stage1_gap_lists_exactly_the_eight_target_locales_of_the_lock(self):
        gap = shadow.stage1_gap(self.rels, self.view)
        got = sorted((r["catalog_sku"], r["lang"]) for r in gap["required_target_locales"])
        self.assertEqual(got, [(s, l) for s in ("11006001par", "1166057110", "2000030111", "400019001") for l in ("ru", "uk")])
        blocked = sorted((r["catalog_sku"], r["lang"], r["field_status"]) for r in gap["not_recommendable_field_status_not_1"])
        self.assertEqual(blocked, [("400003001", "ru", 3), ("400003001", "uk", 3)])
        self.assertTrue(all(r["native_stage1_receipt"] == "NOT_RUN" for r in gap["required_target_locales"]))
        self.assertFalse(gap["receipts_available_to_stage_b"])

    def test_without_a_current_manifest_pairs_are_explicitly_not_evaluated(self):
        res = shadow.compare(self.rels, self.view, shadow.NoCurrent())
        self.assertEqual(set(res["pair_counts"]), {"current_not_evaluated"})
        self.assertTrue(res["pairs"])
        self.assertEqual(res["veto_report"]["mode"], "report_only")
        self.assertFalse(res["veto_report"]["enforced"])
        self.assertEqual(res["veto_report"]["candidates"], [])
        self.assertEqual(len(res["veto_report"]["pending_verification"]), 2)

    def test_unresolved_catalog_sources_are_reported_with_reasons(self):
        res = shadow.compare(self.rels, self.view, shadow.NoCurrent())
        got = {r["tnid"]: r for r in res["unresolved_sources"]}
        self.assertEqual(sorted(got), [133428, 136666, 136855])
        self.assertTrue(all(r["status"] == "unresolved" and r["candidates"] for r in got.values()))


if __name__ == "__main__":
    unittest.main()
