"""End-to-end wiring on the REAL V4.2.1 modules: OEM relation -> Stage B typed relation -> Stage C gate -> envelope -> existing A tier.

Everything is explicitly SYNTHETIC (fictional makers, fabricated bytes, test-double reviewers); the envelope is only accepted by the engine through
the test-only opt-in. Scenario A runs the accepted Stage B mini catalog (the same fictional catalog Stage B was accepted on); scenario B is a
catalog in which the accessories belong to OTHER brands than the seats (cross-brand) and carry no model name in their titles, so the legacy
title matcher cannot find them. No real OEM evidence exists in this repository; nothing here is, or stands in for, a VERIFIED real relation.
"""
from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path

from tests import catalog_fixture as cf
from tests import helpers as H
from tests import world_fixture as WF
from tests.helpers import require_engine
from oem_stage import shadow

ON = {"oem_enabled": True, "oem_allow_synthetic": True}
SYN_TEST_OD5 = {"allow_synthetic": True, "one_ended_adapter": "synthetic_test_two_ended"}


def normalize(result) -> str:
    return cf.normalize(result)


@require_engine
class TestScenarioAMiniCatalog(unittest.TestCase):
    """The accepted Stage B fictional catalog + synthetic world."""

    @classmethod
    def setUpClass(cls):
        mc = H.stage_b_module("mini_catalog", "tests/mini_catalog.py")
        cls.mini = mc.build(Path(tempfile.mkdtemp(prefix="bp-stage-c-mini-")) / "catalog")
        cls.world = WF.build_world()
        cls.view = shadow.CatalogView.from_engine(cls.mini.rows, cls.mini.index, cls.world.world.registry)
        cls.env, cls.report = WF.run_gate(cls.world, cls.view)
        cls.scope = {str(n): {"language": cls.mini.rows[n]["lang"], "similar": [], "accessories": []} for n in map(int, cls.mini.scope_keys)}
        cls.base = cls.build(H.baseline())
        cls.off = cls.build(H.patched())
        cls.on = cls.build(H.patched(), oem_relations=cls.env, **ON)

    @classmethod
    def build(cls, module, **kw):
        m = cls.mini
        return module.build_catalog(m.rows, copy.deepcopy(cls.scope), m.index, m.policy, [], {}, **kw)

    def sku(self, nid):
        return self.mini.rows[nid]["sku"]

    def test_the_catalog_is_joined_through_verified_identity_only(self):
        alpha1 = sorted(s["nid"] for s in self.view.sources_by_model["zeta:alpha-1"])
        self.assertEqual(len(alpha1), 4)                               # "Alpha 1" and the VERIFIED mixed-script alias, ru + uk each
        self.assertEqual([u["status"] for u in self.view.unresolved_sources], ["unresolved"])   # the PROPOSED alias "Alpha 1 Plus" joins nothing
        unresolved_nids = {self.mini.rows[n]["tnid"] for n in self.mini.rows if "Alpha 1 Plus" in self.mini.rows[n]["title"]}
        edge_sources = {int(s) for s in self.env["edges"]}
        self.assertFalse({n for n in self.mini.rows if self.mini.rows[n]["tnid"] in unresolved_nids} & edge_sources)

    def test_the_gate_accepts_only_the_two_verified_unconditional_relations(self):
        self.assertEqual(self.report["summary"]["accepted_relations"], 2)
        self.assertEqual(self.report["summary"]["edges_accepted"], 6)
        self.assertEqual(self.report["summary"]["held_relations"], 12)

    def test_feature_off_is_byte_for_semantics_identical_to_the_accepted_engine(self):
        self.assertEqual(normalize(self.off), normalize(self.base))

    def test_feature_on_adds_only_what_the_legacy_title_matcher_missed_and_keeps_the_rest_untouched(self):
        changed = [sid for sid in self.base[0] if self.on[0][sid] != self.base[0][sid] or self.on[1].get(sid) != self.base[1].get(sid)]
        self.assertEqual(sorted(changed), ["1015", "1016"])               # the two locales of the mixed-script-named seat
        for sid in changed:
            self.assertEqual(self.base[0][sid]["accessories"], [])
            self.assertEqual([self.sku(t) for t in self.on[0][sid]["accessories"]], ["RS-100"])
        for sid in self.base[0]:
            self.assertEqual(self.on[0][sid]["similar"], self.base[0][sid]["similar"])
        oem = self.on[2]["oem"]
        self.assertEqual((oem["edges_in"], oem["published"], oem["already_present_legacy"], oem["held"], oem["dropped_by_limit_20"]), (6, 2, 4, 0, 0))
        self.assertEqual(self.on[2]["edges"]["A_oem_relation"], 2)
        self.assertEqual(self.on[2]["edges"]["A_model"], self.base[2]["edges"]["A_model"] + 2)

    def test_a_new_edge_is_tier_a_model_accepted_oem_relation_with_the_gate_provenance(self):
        rs100_ru = next(n for n, r in self.mini.rows.items() if r["sku"] == "RS-100" and r["lang"] == "ru")
        ev = self.on[1]["1015"]["targets"][str(rs100_ru)]
        gate_edge = next(e for e in self.env["edges"]["1015"] if e["target_nid"] == rs100_ru)
        rel = self.world.listed_afm
        self.assertEqual((ev["tier"], ev["reason"], ev["fit_state"], ev["conditions"], ev["end"], ev["relation_type"]),
                         ("A_model", "accepted_oem_relation", "LISTED", [], "model", "accessory_for_model"))
        for key in ("relation_ids", "claim_ids", "doc_ids", "doc_hashes", "binding_ids", "source_model_id", "relation_digest", "registry_version"):
            self.assertEqual(ev[key], gate_edge[key], key)
        self.assertEqual((ev["relation_ids"], ev["binding_ids"], ev["synthetic"]), ([rel["relation_id"]], ["b-RS-100"], True))
        self.assertEqual(ev["doc_hashes"], [self.world.doc_hashes[rel["evidence"]["docs"][0]["doc_id"]]])
        self.assertIn(rs100_ru, self.on[1]["1015"]["A_model"])

    def test_edges_the_engine_already_had_keep_their_legacy_reason_and_are_not_duplicated(self):
        for sid in ("1001", "1002", "1005", "1006"):
            self.assertEqual(self.on[0][sid], self.base[0][sid])
            self.assertEqual(self.on[1][sid], self.base[1][sid])
        legacy = [e for e in self.on[2]["oem"]["ledger"] if e["status"] == "already_present_legacy"]
        self.assertEqual({e["reason"] for e in legacy}, {"accepted_model_title"})
        self.assertEqual(len(legacy), 4)

    def test_relations_that_are_not_verified_never_reach_the_engine(self):
        accepted = {r["relation_id"] for r in self.report["relations"] if r["decision"] == "ACCEPT"}
        seen = {rid for e in self.on[2]["oem"]["ledger"] for rid in e["relation_ids"]}
        self.assertEqual(seen, accepted)
        for held in (r for r in self.report["relations"] if r["decision"] == "HOLD"):
            blob = repr(self.on[1])
            self.assertNotIn(held["relation_id"], blob)

    def test_the_report_only_veto_removes_nothing_from_the_current_output(self):
        """RS-100 / Alpha 6 is an explicit (synthetic) OEM no-recommendation, yet the current engine recommends it: reported, never enforced."""
        compare = shadow.compare(self.world.relations, self.view, shadow.ManifestCurrent(self.base[0], self.base[1]))
        conflicts = compare["veto_report"]["conflicts_with_current"]
        self.assertTrue(conflicts)
        self.assertEqual(compare["veto_report"]["mode"], "report_only")
        self.assertEqual({self.sku(c["target_nid"]) for c in conflicts}, {"RS-100"})
        for c in conflicts:
            self.assertIn(c["target_nid"], self.on[0][str(c["source_nid"])]["accessories"])      # still recommended with the feature ON
            self.assertIn(c["target_nid"], self.base[0][str(c["source_nid"])]["accessories"])
        self.assertTrue(self.report["veto_report"]["candidates"])
        self.assertFalse(self.report["veto_report"]["enforced"])

    def test_the_default_policy_publishes_nothing_even_with_the_feature_enabled(self):
        env, report = WF.run_gate(self.world, self.view, policy={})
        self.assertEqual((report["summary"]["edges_accepted"], env["synthetic"]), (0, False))
        result = self.build(H.patched(), oem_relations=env, oem_enabled=True)                # no synthetic opt-in needed for an empty real envelope
        self.assertEqual(result[0], self.base[0])
        self.assertEqual(result[1], self.base[1])
        self.assertEqual(result[2]["oem"]["edges_in"], 0)

    def test_a_synthetic_envelope_cannot_be_enabled_without_the_engine_side_opt_in(self):
        with self.assertRaisesRegex(ValueError, "synthetic envelope is refused"):
            self.build(H.patched(), oem_relations=self.env, oem_enabled=True)

    def test_adapters_abstain_by_default_and_under_the_test_policy_both_ends_are_offered(self):
        default_adapters = [e for items in self.env["edges"].values() for e in items if e["relation_type"] == "adapter_between"]
        self.assertEqual(default_adapters, [])                                   # OD5: abstain
        env, report = WF.run_gate(self.world, self.view, policy=SYN_TEST_OD5)
        offered = [(int(s), e) for s, items in env["edges"].items() for e in items if e["relation_type"] == "adapter_between"]
        self.assertEqual(sorted(e["end"] for _, e in offered), ["chassis", "chassis", "seat", "seat"])
        result = self.build(H.patched(), oem_relations=env, **ON)
        ledger = {(e["source_nid"], e["target_nid"]): e for e in result[2]["oem"]["ledger"]}
        for src, edge in offered:
            entry = ledger[(src, edge["target_nid"])]
            if edge["end"] == "chassis":                                        # stroller source, stroller accessory: published
                self.assertEqual(entry["status"], "published", edge)
            else:                                                               # car-seat source: the existing head gate does not file it there
                self.assertEqual((entry["status"], entry["reason"]), ("held", "target_not_in_source_head"), edge)
        self.assertEqual(report["od5_would_be_pairs"], [])

    def test_gate_outputs_and_engine_outputs_are_deterministic_across_runs(self):
        env, _ = WF.run_gate(self.world, self.view)
        self.assertEqual(env, self.env)
        again = self.build(H.patched(), oem_relations=copy.deepcopy(self.env), **ON)
        self.assertEqual(normalize(again), normalize(self.on))


@require_engine
class TestScenarioBCrossBrand(unittest.TestCase):
    """Accessories of other brands (Acme / Nova) for Zeta seats; titles do not name the seat, so only the OEM relation can connect them."""

    @classmethod
    def setUpClass(cls):
        cat = cf.Catalog()
        cat.seat("Alpha 1", "S-A1")
        cat.seat("Alpha 3", "S-A3")
        cat.seat_accessory("Acme дождевик RS-100", "Acme дощовик RS-100", "RS-100", brand=cf.STROLLER_BRAND)
        cat.seat_accessory("Nova чехол RS-300 XL", "Nova чохол RS-300 XL", "RS-300-X", brand=cf.THIRD_BRAND)
        cat.stroller("Frame Y", "C-FY")
        cat.stroller_accessory("Acme адаптер ADP-200", "Acme адаптер ADP-200", "ADP-200", brand=cf.THIRD_BRAND)
        cls.cat, cls.inp = cat, cat.finish()
        cls.world = WF.build_world()
        cls.view = shadow.CatalogView.from_engine(cls.inp.rows, cls.inp.index, cls.world.world.registry)
        cls.env, cls.report = WF.run_gate(cls.world, cls.view)

    def test_the_accessory_brands_differ_from_the_seat_brand(self):
        seat = self.inp.rows[self.cat.nid("S-A1")]
        for sku in ("RS-100", "RS-300-X"):
            self.assertNotEqual(self.inp.rows[self.cat.nid(sku)]["brand_tid"], seat["brand_tid"])

    def test_the_legacy_engine_finds_none_of_them(self):
        edges = self.inp.baseline()[2]["edges"]
        self.assertEqual((edges["A_model"], edges["B_universal"]), (0, 0))

    def test_verified_cross_brand_relations_reach_the_a_tier_of_the_matching_seats(self):
        sources, evidence, metrics = self.inp.patched(oem_relations=self.env, **ON)
        self.assertEqual((metrics["edges"]["A_oem_relation"], metrics["oem"]["published"], metrics["oem"]["held"]), (4, 4, 0))
        for model_sku, acc_sku in (("S-A1", "RS-100"), ("S-A3", "RS-300-X")):
            for lang in cf.LANGS:
                src, tgt = self.cat.nid(model_sku, lang), self.cat.nid(acc_sku, lang)
                self.assertEqual(sources[str(src)]["accessories"], [tgt])
                ev = evidence[str(src)]["targets"][str(tgt)]
                self.assertEqual((ev["tier"], ev["reason"], ev["fit_state"]), ("A_model", "accepted_oem_relation", "LISTED"))
        for lang in cf.LANGS:                                                   # the sources the relations do not mention stay empty
            self.assertEqual(sources[str(self.cat.nid("C-FY", lang))]["accessories"], [])

    def test_a_catalog_without_the_matching_seat_gets_nothing(self):
        cat = cf.Catalog()
        cat.seat("Gamma 9", "S-G9")
        cat.seat_accessory("Acme дождевик RS-100", "Acme дощовик RS-100", "RS-100", brand=cf.STROLLER_BRAND)
        inp = cat.finish()
        view = shadow.CatalogView.from_engine(inp.rows, inp.index, self.world.world.registry)
        env, report = WF.run_gate(self.world, view)
        self.assertEqual(report["summary"]["edges_accepted"], 0)
        self.assertEqual(inp.patched(oem_relations=env, **ON)[2]["edges"]["A_oem_relation"], 0)

    def test_an_adapter_chassis_end_is_published_to_the_stroller_pages_under_the_test_policy_only(self):
        default_env, _ = WF.run_gate(self.world, self.view)
        self.assertFalse([e for items in default_env["edges"].values() for e in items if e["relation_type"] == "adapter_between"])
        env, _ = WF.run_gate(self.world, self.view, policy=SYN_TEST_OD5)
        sources, evidence, metrics = self.inp.patched(oem_relations=env, **ON)
        for lang in cf.LANGS:
            src, tgt = self.cat.nid("C-FY", lang), self.cat.nid("ADP-200", lang)
            self.assertEqual(sources[str(src)]["accessories"], [tgt])
            self.assertEqual(evidence[str(src)]["targets"][str(tgt)]["end"], "chassis")
            self.assertEqual(evidence[str(src)]["targets"][str(tgt)]["relation_type"], "adapter_between")


if __name__ == "__main__":
    unittest.main()
