#!/usr/bin/env python3
"""OEM fitment regressions for the V4.2.1 rehearsal handoff.

The 8,129-source / 28,769-row catalog snapshot is not in the handoff archive.
These tests use only the CSV fixtures and evidence file that are.
"""
from __future__ import annotations

import csv
import json
import sys
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "engine" / "src"
sys.path.insert(0, str(SRC))
for _name in ("accessory_auto_v39", "v3_rules", "v3_rules_v421"):
    sys.modules.setdefault(_name, types.ModuleType(_name))
sys.modules["v3_rules"].accessory_class = lambda *args, **kwargs: "adapter"
sys.modules["accessory_auto_v39"].explicit_accessory = lambda row: False
sys.modules["accessory_auto_v39"].match_exact_model = lambda title, model: ("candidate", "stub")

import accessory_v4 as v4  # noqa: E402

EVIDENCE = json.loads((ROOT / "engine" / "input" / "manufacturer_fitment_evidence_v42.json").read_text())
POLICY = v4.taxonomy_policy(json.loads((ROOT / "engine" / "input" / "taxonomy_terms_v4.json").read_text()))
LEGACY = EVIDENCE["rules"]
OEM = EVIDENCE["oem_evidence"]
RULES = LEGACY + OEM
FIXTURES = ROOT / "fixtures"


def rows(name):
    with (FIXTURES / name).open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def product(nid, title, sku, lang="ru", status=1, price=100):
    return {
        "nid": nid,
        "tnid": nid,
        "lang": lang,
        "type": "kreslo",
        "title": title,
        "sku": sku,
        "brand_tid": 9,
        "brand": "Brand",
        "cats": "137:Автокрісла (від 9 до 18 кг)",
        "published": 1,
        "field_status": status,
        "price": price,
        "body": "",
    }


class OemFitmentTest(unittest.TestCase):
    def match(self, source, target, use_context=None, chassis=None, rules=None):
        return v4.manufacturer_fitment_match(
            source, target, POLICY, RULES if rules is None else rules, {}, use_context, chassis)

    def test_normalization_keeps_generations(self):
        same = (
            ("iZi Go Modular X-1 iSize", "iZi Go Modular X1 i-Size"),
            ("DUALFIX   M PLUS", "dualfix m plus"),
        )
        distinct = (
            ("SWIVEL", "SWIVEL 2"),
            ("Pebble 360 Pro", "Pebble 360 Pro 2"),
            ("Coral Slide Pro", "Coral 360"),
            ("Fox 5", "Fox 2"),
            ("iZi Go Modular X1", "iZi Go Modular X2"),
            ("iZi Go X1", "iZi Go Х1"),
        )
        for left, right in same:
            self.assertEqual(v4.normalize_oem_model_span(left), v4.normalize_oem_model_span(right), (left, right))
        for left, right in distinct:
            self.assertNotEqual(v4.normalize_oem_model_span(left), v4.normalize_oem_model_span(right), (left, right))

    def test_thirteen_reference_pairs_resolve_without_an_unconditional_link(self):
        seed = rows("OEM_VERIFIED_MISSED_PAIRS.csv")
        self.assertEqual(len(seed), 26)
        physical = {(row["group_id"], row["source_tnid"], row["target_sku_oem_base"]) for row in seed}
        self.assertEqual(len(physical), 13)
        confirmed = 0
        for index, row in enumerate(seed):
            source = product(1000 + index, row["source_title"], row["source_sku"], row["source_lang"])
            target = product(2000 + index, row["target_title"], row["target_sku_catalog"], row["source_lang"])
            before = v4.manufacturer_fitment_match(source, target, POLICY, LEGACY, {})
            after = self.match(source, target)
            self.assertIsNone(before, row["oem_compatible_model"])
            self.assertFalse(after, row["oem_compatible_model"])
            self.assertFalse(after["unconditional_recommendation"])
            self.assertFalse(after["ab_eligible"])
            self.assertIsNone(after["catalog_tier"])
            self.assertFalse(after["newborn_insert_recommended"])
            self.assertIn("stage1_not_run", after["publication_blockers"])
            self.assertIn("document_hash_missing", after["publication_blockers"])
            if row["oem_compatible_model"] == "DUALFIX PRO M":
                self.assertEqual(after["decision"], "abstain_ambiguous_model_span")
                self.assertIsNone(after["model_fit"])
                self.assertIsNone(after["matched_model"])
            elif row["group_id"].startswith("P01"):
                self.assertEqual(after["decision"], "confirmed_conditional")
                self.assertTrue(after["model_fit"])
                self.assertEqual(v4.normalize_oem_model_span(after["matched_model"]),
                                 v4.normalize_oem_model_span(row["oem_compatible_model"]))
                self.assertIn("approval_standard", after["missing_required_conditions"])
                confirmed += 1
            elif row["group_id"].startswith("P02"):
                self.assertEqual(after["decision"], "confirmed_conditional")
                self.assertTrue(after["model_fit"])
                self.assertIn("x1", v4.normalize_oem_model_span(after["matched_model"]))
                self.assertNotIn("x2", v4.normalize_oem_model_span(after["matched_model"]))
                self.assertIn("in_vehicle", after["missing_required_conditions"])
                confirmed += 1
            else:
                self.assertEqual(after["decision"], "abstain_incomplete_interface")
                self.assertIsNone(after["model_fit"])
                self.assertTrue(after["seat_name_listed"])
                self.assertIn("component", after["missing_required_conditions"])
                self.assertIn("chassis", after["missing_required_conditions"])
        self.assertEqual(confirmed, 22)

    def test_conditions_are_separate_from_model_fit(self):
        source = product(1, "Britax-Romer автокресло Dualfix Pro", "2000038298")
        target = product(2, "BRITAX-ROMER вкладыш для новорожденных (авто group 1)", "2000030111")
        missing = self.match(source, target)
        self.assertTrue(missing["model_fit"])
        self.assertFalse(missing["unconditional_recommendation"])
        passed = self.match(source, target, {
            "standard": "R129", "integrated_harness": True, "infant_carrier": False,
            "height_cm": 76, "direction": "forward",
        })
        self.assertTrue(passed["model_fit"])
        self.assertEqual(passed["failed_conditions"], [])
        self.assertFalse(passed["unconditional_recommendation"])
        self.assertIn("stage1_not_run", passed["publication_blockers"])
        short = self.match(source, target, {
            "standard": "R129", "integrated_harness": True, "infant_carrier": False,
            "height_cm": 75, "direction": "forward",
        })
        self.assertTrue(short["model_fit"])
        self.assertEqual(short["decision"], "reject_condition")
        self.assertIn("height_cm", short["failed_conditions"])
        light = self.match(source, target, {
            "standard": "R44", "integrated_harness": True, "infant_carrier": False, "weight_kg": 8.9,
        })
        self.assertEqual(light["decision"], "reject_condition")
        carrier = self.match(source, target, {
            "standard": "R44", "integrated_harness": True, "infant_carrier": True, "weight_kg": 10,
        })
        self.assertEqual(carrier["decision"], "reject_condition")
        self.assertIn("infant_carrier", carrier["failed_conditions"])
        rain_source = product(3, "BeSafe автокресло iZi Go Modular X-1 iSize", "11008150-BurgundyMpar")
        rain = product(4, "BeSafe дождевик Rain Shield", "11006001par")
        indoor = self.match(rain_source, rain, {"in_vehicle": True})
        self.assertTrue(indoor["model_fit"])
        self.assertEqual(indoor["decision"], "reject_condition")
        outdoor = self.match(rain_source, rain, {"in_vehicle": False})
        self.assertTrue(outdoor["model_fit"])
        self.assertEqual(outdoor["failed_conditions"], [])
        self.assertFalse(outdoor["unconditional_recommendation"])
        x2 = product(5, "BeSafe автокресло iZi Go Modular X2", "x2")
        self.assertEqual(self.match(x2, rain)["decision"], "abstain_not_listed")

    def test_adapter_needs_both_ends_and_does_not_cross_generations(self):
        seat = product(10, "Maxi-Cosi автокресло Coral Slide Pro", "8441129110")
        other = product(11, "Maxi-Cosi автокресло Coral 360", "coral-360")
        adapter = product(12, "Maxi-Cosi адаптеры Fame к автокреслу Coral Slide Pro", "1166057110")
        bare = self.match(seat, adapter)
        self.assertEqual(bare["decision"], "abstain_incomplete_interface")
        self.assertFalse(bare)
        shell = self.match(seat, adapter, {"component": "safety_shell"}, "Fame Cabin")
        self.assertEqual(shell["decision"], "reject_wrong_component")
        self.assertFalse(shell["model_fit"])
        unknown = self.match(seat, adapter, {"component": "soft_carrier"}, None)
        self.assertEqual(unknown["decision"], "abstain_incomplete_interface")
        fame_cabin = self.match(seat, adapter, {"component": "soft_carrier"}, "Fame Cabin")
        self.assertTrue(fame_cabin["model_fit"])
        self.assertEqual(fame_cabin["matched_chassis"], "Fame Cabin")
        self.assertEqual(fame_cabin["attachment"], "direct")
        self.assertFalse(fame_cabin["unconditional_recommendation"])
        fame = self.match(seat, adapter, {"component": "soft_carrier"}, "Fame")
        self.assertTrue(fame["model_fit"])
        self.assertIn("extension_adapter", fame["missing_required_conditions"])
        self.assertFalse(fame)
        fame_no = self.match(seat, adapter, {"component": "soft_carrier", "extension_adapter_present": False}, "Fame")
        self.assertEqual(fame_no["decision"], "reject_condition")
        self.assertTrue(fame_no["model_fit"])
        fox = self.match(seat, adapter, {"component": "soft_carrier"}, "Fox 5")
        self.assertEqual(fox["decision"], "abstain_not_listed")
        coral_360 = self.match(other, adapter, {"component": "soft_carrier"}, "Fame Cabin")
        self.assertEqual(coral_360["decision"], "abstain_not_listed")
        self.assertIsNone(coral_360["model_fit"])

    def test_bugaboo_holdout_and_negative_generations(self):
        holdout = {row["case_id"]: row for row in rows("HOLDOUT_RESULTS.csv")}
        for case_id in ("H01_PEBBLE_PRO_DRAGONFLY", "H02_PEBBLE_PRO2_FOX5",
                        "H03_BESAFE_X1_FOX5_SKU_HOLDOUT", "H04_CORAL_SLIDE_PRO_FOX5_SKU_HOLDOUT",
                        "N01_PEBBLE_PRO2_DRAGONFLY", "N02_PEBBLE_PRO2_FOX2",
                        "N03_CABRIOFIX_DRAGONFLY", "N04_RELAX_INSERT_IDENTITY"):
            self.assertIn(case_id, holdout)
        pebble = product(20, "Maxi-Cosi автокресло Pebble 360 Pro", "8052047110", status=3)
        pro2 = product(21, "Maxi-Cosi автокресло Pebble 360 Pro 2", "8052672111")
        x1 = product(22, "BeSafe автокресло iZi Go Modular X-1 iSize", "11008150-BurgundyMpar")
        coral = product(23, "Maxi-Cosi автокресло Coral Slide Pro", "8441129110")
        cabrio = product(24, "Maxi-Cosi автокресло Cabriofix", "8617720120")
        dragonfly = product(25, "Bugaboo adapter", "400003001", status=3)
        fox = product(26, "Bugaboo adapter", "400019001")
        h01 = self.match(pebble, dragonfly, chassis="Dragonfly")
        self.assertEqual(h01["decision"], "confirmed_conditional")
        self.assertTrue(h01["model_fit"])
        self.assertFalse(h01)
        self.assertIn("not_currently_purchasable", h01["publication_blockers"])
        h01_plus = self.match(pebble, dragonfly, chassis="Dragonfly Plus")
        self.assertEqual(h01_plus["matched_chassis"], "Dragonfly Plus")
        h02 = self.match(pro2, fox, chassis="Fox 5")
        self.assertTrue(h02["model_fit"])
        self.assertEqual(h02["matched_chassis"], "Fox 5")
        h02_renew = self.match(pro2, fox, chassis="Fox 5 Renew")
        self.assertEqual(h02_renew["matched_chassis"], "Fox 5 Renew")
        h03 = self.match(x1, fox, chassis="Fox 5")
        self.assertTrue(h03["model_fit"])
        self.assertIn("x1", v4.normalize_oem_model_span(h03["matched_model"]))
        h04 = self.match(coral, fox, chassis="Fox 5")
        self.assertTrue(h04["model_fit"])
        self.assertIn("component", h04["missing_required_conditions"])
        self.assertFalse(h04["unconditional_recommendation"])
        h04_shell = self.match(coral, fox, {"component": "safety_shell"}, "Fox 5")
        self.assertEqual(h04_shell["decision"], "reject_wrong_component")
        n01 = self.match(pro2, dragonfly, chassis="Dragonfly")
        self.assertEqual(n01["decision"], "abstain_not_listed")
        self.assertIsNone(n01["model_fit"])
        n02 = self.match(pro2, fox, chassis="Fox 2")
        self.assertEqual(n02["decision"], "abstain_not_listed")
        self.assertEqual(n02["reason"], "named_absent_from_oem_list")
        mixed = self.match(pro2, fox, chassis="Fox 5 / Fox 2")
        self.assertEqual(mixed["decision"], "abstain_ambiguous_chassis")
        n03 = self.match(cabrio, dragonfly, chassis="Dragonfly")
        self.assertEqual(n03["decision"], "reject_explicit")
        self.assertFalse(n03["model_fit"])
        relax_source = product(27, "Britax-Romer автокресло Dualfix Plus", "2000036277")
        relax = product(28, "Britax Relax", "2000040775")
        n04 = self.match(relax_source, relax, {"standard": "R129", "height_cm": 70, "direction": "forward",
                                               "integrated_harness": True, "infant_carrier": False,
                                               "stage1_passed": True})
        self.assertEqual(n04["decision"], "abstain_identity")
        self.assertFalse(n04)
        unknown_chassis = self.match(pebble, dragonfly, chassis=None)
        self.assertEqual(unknown_chassis["decision"], "abstain_unknown_chassis")

    def test_negative_controls_do_not_enter_ab(self):
        controls = rows("NEGATIVE_AND_CONDITIONAL_CONTROLS.csv")
        self.assertEqual(len(controls), 8)
        kidfix = self.match(product(30, "Britax-Romer автокресло KIDFIX PRO", "kidfix"),
                            product(31, "Comfort Insert", "2000030111"))
        self.assertEqual(kidfix["decision"], "abstain_not_listed")
        self.assertEqual(kidfix["reason"], "named_absent_from_oem_list")
        swivel = self.match(product(32, "Britax-Romer автокресло Swivel", "swivel"),
                            product(33, "Comfort Insert", "2000030111"))
        self.assertEqual(swivel["decision"], "abstain_not_listed")
        self.assertIsNone(swivel["matched_model"])
        swivel2 = self.match(product(34, "Britax-Romer автокресло Swivel 2", "swivel2"),
                             product(35, "Comfort Insert", "2000030111"))
        self.assertEqual(swivel2["matched_model"], "SWIVEL 2")
        organiser = self.match(product(36, "любое автокресло", "seat"),
                               product(37, "органайзер на спинку сиденья", "6900000016817"))
        self.assertEqual(organiser["decision"], "reject_class_c")
        self.assertEqual(organiser["accessory_class"], "C")
        self.assertFalse(organiser["ab_eligible"])
        self.assertIsNone(organiser["catalog_tier"])
        pocket = self.match(product(38, "Maxi-Cosi RodiFix Air Protect", "rodifix"),
                            product(39, "Maxi Cosi Pocket", "74203550"))
        self.assertEqual(pocket["decision"], "abstain_not_listed")
        self.assertEqual(pocket["reason"], "no_generalization_from_partial_list")
        cyrillic = self.match(product(40, "BeSafe iZi Go Modular \u04251", "cyr"),
                              product(41, "Rain Shield", "11006001par"))
        self.assertEqual(cyrillic["decision"], "abstain_ambiguous_model_span")
        self.assertIsNone(cyrillic["model_fit"])

    def test_full_context_can_admit_only_when_every_gate_is_present(self):
        record = json.loads(json.dumps(next(item for item in OEM if item["oem_article"] == "11006001")))
        record["document"]["content_sha256"] = "abc123"
        source = product(50, "BeSafe автокресло iZi Go Modular X-1 iSize", "11008150")
        target = product(51, "BeSafe дождевик", "11006001par")
        opened = self.match(source, target, {"in_vehicle": False, "stage1_passed": True}, rules=LEGACY + [record])
        self.assertTrue(opened["unconditional_recommendation"])
        self.assertTrue(opened)
        self.assertEqual(opened["decision"], "confirmed_unconditional")
        self.assertEqual(opened["accessory_class"], "A")
        missing_condition = self.match(source, target, {"stage1_passed": True}, rules=LEGACY + [record])
        self.assertFalse(missing_condition)
        self.assertIn("in_vehicle", missing_condition["missing_required_conditions"])
        target["option_digest"] = "unknown-profile"
        blocked = self.match(source, target, {"in_vehicle": False, "stage1_passed": True}, rules=LEGACY + [record])
        self.assertFalse(blocked["unconditional_recommendation"])
        self.assertIn("variant_profile_not_cleared", blocked["publication_blockers"])

    def test_identity_does_not_use_nid_or_fuzzy_proof(self):
        first = self.match(product(134907, "Britax-Romer автокресло Dualfix Pro", "2000038298"),
                           product(82597, "Comfort Insert", "2000030111"))
        second = self.match(product(1, "Britax-Romer автокресло Dualfix Pro", "2000038298"),
                            product(2, "Comfort Insert", "2000030111"))
        self.assertEqual(first["decision"], second["decision"])
        self.assertEqual(first["matched_model"], second["matched_model"])
        decoy = {
            "record_type": "oem_evidence",
            "evidence_key": "nid-decoy",
            "oem_article": "999",
            "catalog_skus": ["999"],
            "source_nids": [134907],
            "target_nids": [82597],
            "accessory_class": "A",
            "accessory_type": "comfort_insert",
            "confirmed_models": [],
            "document": {"url": "none", "version": "none", "content_sha256": None},
        }
        ignored = self.match(product(134907, "Britax-Romer автокресло KIDFIX PRO", "kidfix"),
                             product(82597, "decoy", "999"), rules=LEGACY + [decoy])
        self.assertIsNone(ignored["model_fit"])
        self.assertNotEqual(ignored["decision"], "confirmed_conditional")
        fuzzy = self.match(product(70, "Britax-Romer автокресло Dualfix ProX", "prox"),
                           product(71, "Comfort Insert", "2000030111"))
        self.assertEqual(fuzzy["decision"], "abstain_not_listed")

    def test_legacy_manufacturer_rule_still_admits_and_similar_guard_remains(self):
        source = product(80, "Espiro Noble", "noble", lang="uk")
        source.update(type="kol", brand_tid=737, cats="128:Прогулянкові коляски",
                      function_signature={"travel_config": "2"},
                      option_digest="color-digest")
        target = product(81, "Адаптер для коляски Noble", "adapter", lang="uk")
        target.update(type="kol", brand_tid=737, cats="134:Аксесуари", option_digest="")
        profiles = {"color-digest": {"variant_class": "color", "all_oids_available": True,
                                     "fitment_critical": False, "oids": [{"oid": 1, "weight": 1, "price": 0}]}}
        proof = v4.manufacturer_fitment_match(source, target, POLICY, LEGACY, profiles)
        self.assertTrue(proof)
        self.assertEqual(proof["evidence_key"], "espiro-noble-frame-adapter")
        self.assertEqual(proof["role"], "adapter")
        self.assertNotIn("decision", proof)
        mixed = v4.manufacturer_fitment_match(source, target, POLICY, RULES, profiles)
        self.assertEqual(mixed["evidence_key"], "espiro-noble-frame-adapter")
        text = Path(v4.__file__).read_text(encoding="utf-8")
        self.assertIn('if list(record["similar"])!=old_similar:raise ValueError("similar changed "', text)
        self.assertIn('old_similar=list(record["similar"])', text)

    def test_relax_height_gate_stays_closed_without_a_catalog_join(self):
        joined = json.loads(json.dumps(next(item for item in OEM if item["oem_article"] == "ACCSFCC207")))
        joined["catalog_skus"] = ["ACCSFCC207"]
        joined["unjoined_seller_skus"] = []
        joined["document"]["content_sha256"] = "def456"
        source = product(90, "Britax-Romer автокресло Dualfix Pro", "2000036277")
        target = product(91, "Relax Insert", "ACCSFCC207")
        low = self.match(source, target, {"height_cm": 60, "other_insert_fitted": False, "seat_model": "DUALFIX PRO",
                                           "stage1_passed": True}, rules=LEGACY + [joined])
        self.assertEqual(low["decision"], "reject_condition")
        self.assertTrue(low["model_fit"])
        ok = self.match(source, target, {"height_cm": 61, "other_insert_fitted": False, "seat_model": "DUALFIX PRO",
                                          "stage1_passed": True}, rules=LEGACY + [joined])
        self.assertTrue(ok["unconditional_recommendation"])
        high = self.match(source, target, {"height_cm": 88, "other_insert_fitted": False, "seat_model": "DUALFIX PRO"},
                          rules=LEGACY + [joined])
        self.assertEqual(high["decision"], "reject_condition")
        second = self.match(source, target, {"height_cm": 70, "other_insert_fitted": True, "seat_model": "DUALFIX PRO"},
                            rules=LEGACY + [joined])
        self.assertIn("other_insert_fitted", second["failed_conditions"])
        unlisted = self.match(product(92, "Britax-Romer автокресло Dualfix Pro 2", "pro2"), target,
                              {"height_cm": 70, "other_insert_fitted": False, "seat_model": "DUALFIX PRO 2"},
                              rules=LEGACY + [joined])
        self.assertEqual(unlisted["decision"], "abstain_not_listed")
        seller = self.match(source, product(93, "Relax Insert", "2000040775"),
                            {"height_cm": 70, "other_insert_fitted": False, "seat_model": "DUALFIX PRO",
                             "stage1_passed": True})
        self.assertEqual(seller["decision"], "abstain_identity")


if __name__ == "__main__":
    unittest.main(verbosity=2)
