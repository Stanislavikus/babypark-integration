"""S5 seam against the REAL V4.2.1 modules: OFF is byte-for-semantics identical to the accepted engine; ON appends verified edges after
every legacy A edge, applies the existing gates to each edge, and records exactly one disposition per envelope edge.

Envelopes are hand-built and explicitly SYNTHETIC (``synthetic: true``, test-only opt-in); the end-to-end path from Stage B relations through the
gate is in ``test_wiring.py``. Skipped loudly when the real engine is not importable."""
from __future__ import annotations

import copy
import hashlib
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

from tests import catalog_fixture as cf
from tests import scenarios as sc
from tests.helpers import ROOT, SEAM_FILE, baseline, patched, require_engine

ON = {"oem_enabled": True, "oem_allow_synthetic": True}


def reasons(result, source_nid):
    return result[1].get(str(source_nid), {}).get("targets", {})


@require_engine
class TestOffIsIdentical(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inp, cls.cat = sc.standard()
        cls.base = cls.inp.baseline()

    def test_patched_off_equals_the_accepted_engine_exactly(self):
        self.assertEqual(cf.normalize(self.inp.patched()), cf.normalize(self.base))

    def test_envelope_without_the_flag_is_never_read(self):
        env = sc.envelope([sc.edge(self.inp, "C-FY", "RC-9")])
        self.assertEqual(cf.normalize(self.inp.patched(oem_relations=env)), cf.normalize(self.base))
        self.assertEqual(cf.normalize(self.inp.patched(oem_relations={"garbage": True})), cf.normalize(self.base))   # not even validated
        self.assertEqual(cf.normalize(self.inp.patched(oem_enabled=False, oem_relations=env)), cf.normalize(self.base))

    def test_off_adds_no_keys_anywhere(self):
        sources, evidence, metrics = self.inp.patched()
        self.assertNotIn("oem", metrics)
        self.assertNotIn("A_oem_relation", metrics["edges"])
        self.assertEqual(sorted(metrics), sorted(self.base[2]))
        self.assertEqual(sorted(metrics["edges"]), ["A_manufacturer_verified", "A_model", "B_universal"])
        for ev in evidence.values():
            self.assertEqual(sorted(ev), ["A_model", "B_universal", "head", "targets"])
            self.assertNotIn("accepted_oem_relation", [t.get("reason") for t in ev["targets"].values()])   # legacy B edges carry no reason key

    def test_off_equals_the_accepted_engine_on_pseudo_random_catalogs(self):
        for seed in (1, 2, 3, 11):
            with self.subTest(seed=seed):
                inp = cf.stress_catalog(seed).finish()
                self.assertGreater(inp.baseline()[2]["edges"]["A_model"], 0)
                self.assertEqual(cf.normalize(inp.patched()), cf.normalize(inp.baseline()))

    def test_the_patch_only_adds_names_and_keeps_every_legacy_function_object_semantics(self):
        base, new = baseline(), patched()
        legacy_names = [n for n in dir(base) if not n.startswith("__")]
        for name in legacy_names:
            self.assertTrue(hasattr(new, name), name)
        added = sorted(n for n in dir(new) if not n.startswith("__") and not hasattr(base, n))
        self.assertEqual(added, ["OEM_SCHEMA", "_OEM_DATE", "_OEM_EDGE_KEYS", "_OEM_ENDS", "_OEM_ENVELOPE_KEYS", "_OEM_GATE_KEYS", "_OEM_HEX64",
                                 "_OEM_PROVENANCE_KEYS", "_oem_close", "_oem_edge_hold", "_oem_fail", "_oem_finalize", "_oem_hex",
                                 "_oem_keys", "_oem_merge", "_oem_strings", "_oem_variant_ok", "oem_load_envelope"])


@require_engine
class TestOnIsStrict(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inp, cls.cat = sc.standard()

    def test_on_without_an_envelope_fails_loudly(self):
        with self.assertRaisesRegex(ValueError, "requires an accepted-edges envelope"):
            self.inp.patched(oem_enabled=True)

    def test_the_flag_must_be_a_real_boolean(self):
        for bad in (1, "yes", "false", None, 0):
            with self.subTest(flag=bad), self.assertRaisesRegex(ValueError, "oem_enabled must be a boolean"):
                self.inp.patched(oem_enabled=bad, oem_relations=sc.envelope([]))

    def test_a_synthetic_envelope_needs_the_explicit_opt_in(self):
        env = sc.envelope([sc.edge(self.inp, "C-FY", "RC-9")])
        with self.assertRaisesRegex(ValueError, "synthetic envelope is refused"):
            self.inp.patched(oem_relations=env, oem_enabled=True)
        self.inp.patched(oem_relations=env, **ON)

    def test_malformed_envelopes_are_refused_not_partially_applied(self):
        good = sc.envelope([sc.edge(self.inp, "C-FY", "RC-9")])
        src = next(iter(good["edges"]))
        mutations = {
            "unknown top key": lambda d: d.update(extra=1),
            "missing key": lambda d: d.pop("provenance"),
            "wrong schema": lambda d: d.update(schema="bp-oem-accepted-edges-v2"),
            "wrong mode": lambda d: d.update(mode="all"),
            "conditional state": lambda d: d["edges"][src][0].update(fit_state="LISTED_CONDITIONAL"),
            "conditions present": lambda d: d["edges"][src][0].update(conditions=[{"attr": "x"}]),
            "publish_states widened": lambda d: d["gate"].update(publish_states=["LISTED", "LISTED_CONDITIONAL"]),
            "veto enforced": lambda d: d["gate"].update(veto_mode="enforce"),
            "float nid": lambda d: d["edges"][src][0].update(target_nid=1.0),
            "bool nid": lambda d: d["edges"][src][0].update(target_nid=True),
            "bad hash": lambda d: d["edges"][src][0].update(doc_hashes=["xyz"]),
            "hash with trailing newline": lambda d: d["edges"][src][0].update(doc_hashes=[sc.A64 + "\n"]),
            "as_of with trailing newline": lambda d: d["gate"].update(as_of="2026-11-17\n"),
            "as_of not a date": lambda d: d["gate"].update(as_of="soon"),
            "empty claims": lambda d: d["edges"][src][0].update(claim_ids=[]),
            "self edge": lambda d: d["edges"][src][0].update(target_nid=int(src)),
            "duplicate edge": lambda d: d["edges"][src].append(copy.deepcopy(d["edges"][src][0])),
            "non canonical key": lambda d: d["edges"].update({"0" + src: d["edges"].pop(src)}),
            "adapter end on accessory": lambda d: d["edges"][src][0].update(end="seat"),
            "non-default OD5 on a real envelope": lambda d: (d.update(synthetic=False), d["gate"].update(one_ended_adapter="synthetic_test_two_ended")),
        }
        for name, mutate in mutations.items():
            with self.subTest(mutation=name):
                bad = copy.deepcopy(good)
                mutate(bad)
                with self.assertRaises(ValueError):
                    self.inp.patched(oem_relations=bad, **ON)

    def test_the_engine_never_mutates_the_envelope(self):
        env = sc.envelope([sc.edge(self.inp, "C-FY", "RC-9"), sc.edge(self.inp, "C-FX", "BG-9")])
        before = copy.deepcopy(env)
        self.inp.patched(oem_relations=env, **ON)
        self.assertEqual(env, before)

    def test_on_is_deterministic(self):
        env = sc.envelope([sc.edge(self.inp, "C-FY", "RC-9"), sc.edge(self.inp, "C-FX", "BG-9")])
        first, second = (cf.normalize(self.inp.patched(oem_relations=env, **ON)) for _ in range(2))
        self.assertEqual(first, second)


@require_engine
class TestOnWiring(unittest.TestCase):
    """The accepted edges reach the existing A tier; everything legacy keeps its place."""

    @classmethod
    def setUpClass(cls):
        cls.inp, cls.cat = sc.standard()
        cls.base = cls.inp.baseline()
        cls.fy = {lang: cls.cat.nid("C-FY", lang) for lang in cf.LANGS}
        cls.fx = {lang: cls.cat.nid("C-FX", lang) for lang in cf.LANGS}

    def run_on(self, pairs, **kw):
        return self.inp.patched(oem_relations=sc.envelope(pairs, **kw), **ON)

    def sku(self, nid):
        return self.inp.rows[nid]["sku"]

    def test_a_verified_edge_enters_the_existing_a_tier_with_provenance(self):
        result = self.run_on([sc.edge(self.inp, "C-FY", "RC-9", rel="rel:00000000000000aa")])
        sources, evidence, metrics = result
        fy = self.fy["ru"]
        target = self.cat.nid("RC-9")
        self.assertEqual(sources[str(fy)]["accessories"][0], target)                  # A edges precede B edges
        ev = evidence[str(fy)]["targets"][str(target)]
        self.assertEqual((ev["tier"], ev["reason"]), ("A_model", "accepted_oem_relation"))
        self.assertEqual((ev["fit_state"], ev["conditions"], ev["relation_ids"], ev["end"]), ("LISTED", [], ["rel:00000000000000aa"], "model"))
        self.assertEqual(sorted(ev), sorted(["tier", "reason", "role", "fit_state", "conditions", "relation_ids", "relation_type", "end",
                                             "relation_digest", "claim_ids", "doc_ids", "doc_hashes", "binding_ids", "registry_version",
                                             "source_model_id", "synthetic"]))
        self.assertEqual(ev["role"], "rain_cover")
        self.assertIn(target, evidence[str(fy)]["A_model"])
        self.assertEqual(metrics["edges"]["A_oem_relation"], 1)
        self.assertEqual(metrics["edges"]["A_model"], self.base[2]["edges"]["A_model"] + 1)

    def test_legacy_edges_keep_membership_and_relative_order_for_every_source(self):
        pairs = [sc.edge(self.inp, "C-FX", "BG-9"), sc.edge(self.inp, "C-FX", "RC-9"), sc.edge(self.inp, "C-FY", "RC-9"),
                 sc.edge(self.inp, "S-B1", "SC-5", end="model", model="zeta:beta-1")]
        sources, evidence, _ = self.run_on(pairs)
        for sid, record in self.base[0].items():
            legacy_a = self.base[1].get(sid, {}).get("A_model", [])
            now_a = evidence.get(sid, {}).get("A_model", [])
            self.assertEqual([t for t in now_a if t in legacy_a], legacy_a, sid)                 # legacy A: same members, same order
            self.assertEqual(now_a[:len(legacy_a)], legacy_a, sid)                               # ... and still first (new ones come after)
            self.assertEqual(sources[sid]["similar"], record["similar"])
            self.assertEqual(len(sources[sid]["accessories"]), len(set(sources[sid]["accessories"])))
            self.assertLessEqual(len(sources[sid]["accessories"]), 20)

    def test_cross_brand_edges_are_accepted_where_the_legacy_manufacturer_path_would_not(self):
        sources, evidence, _ = self.run_on([sc.edge(self.inp, "C-FX", "BG-9")])
        target = self.cat.nid("BG-9")
        self.assertNotEqual(self.inp.rows[target]["brand_tid"], self.inp.rows[self.fx["ru"]]["brand_tid"])      # Nova accessory, Acme stroller
        self.assertIn(target, evidence[str(self.fx["ru"])]["A_model"])
        self.assertEqual(sources[str(self.fx["ru"])]["accessories"][:3], [self.cat.nid("RC-1"), self.cat.nid("MN-1"), target])

    def test_an_edge_the_legacy_engine_already_has_is_not_duplicated_and_keeps_its_legacy_reason(self):
        legacy = sc.edge(self.inp, "S-A1", "RS-100")
        sources, evidence, metrics = self.run_on([legacy])
        src = str(legacy[0])
        self.assertEqual(sources[src], self.base[0][src])
        self.assertEqual(evidence[src], self.base[1][src])                                        # legacy evidence untouched
        entry = metrics["oem"]["ledger"][0]
        self.assertEqual((entry["status"], entry["reason"]), ("already_present_legacy", "accepted_model_title"))
        self.assertEqual(metrics["edges"]["A_oem_relation"], 0)

    def test_an_a_edge_displaces_a_legacy_b_edge_of_the_same_role_by_the_existing_rule(self):
        sources, evidence, _ = self.run_on([sc.edge(self.inp, "C-FY", "RC-9")])
        fy = str(self.fy["ru"])
        base_b = [self.sku(t) for t in self.base[1][fy]["B_universal"]]
        now_b = [self.sku(t) for t in evidence[fy]["B_universal"]]
        self.assertEqual(base_b, ["UN-2", "UN-1", "UN-3"])
        self.assertEqual(now_b, ["UN-2", "UN-3"])                                                 # the universal rain cover UN-1 is displaced
        self.assertEqual([self.sku(t) for t in sources[fy]["accessories"]], ["RC-9", "UN-2", "UN-3"])

    def test_every_envelope_edge_gets_exactly_one_disposition(self):
        names = ("RC-9", "BG-9", "KIT-1", "FS3-1", "PR0-1", "VAR-1", "VAR-2", "OK-3", "WD-1", "RS-100")
        pairs = [sc.edge(self.inp, "C-FX", n) for n in names]
        _, _, metrics = self.run_on(pairs)
        oem = metrics["oem"]
        self.assertEqual(oem["edges_in"], len(names))
        self.assertEqual(oem["published"] + oem["dropped_by_limit_20"] + oem["already_present_legacy"] + oem["held"], len(names))
        self.assertEqual(len(oem["ledger"]), len(names))
        self.assertEqual(sorted({(e["source_nid"], e["target_nid"]) for e in oem["ledger"]}), sorted((e["source_nid"], e["target_nid"]) for e in oem["ledger"]))
        self.assertTrue(all(e["status"] in ("published", "dropped_by_limit_20", "already_present_legacy", "held") for e in oem["ledger"]))

    def test_each_current_engine_gate_holds_its_own_edge_and_names_the_reason(self):
        want = {"KIT-1": "product_kit_excluded", "FS3-1": "target_not_purchasable", "PR0-1": "target_not_purchasable",
                "VAR-1": "target_variant_unverified", "VAR-2": "target_variant_unverified", "WD-1": "target_not_in_source_head"}
        pairs = [sc.edge(self.inp, "C-FX", n) for n in (*want, "OK-3", "RC-9")]
        _, evidence, metrics = self.run_on(pairs)
        got = {self.sku(e["target_nid"]): e for e in metrics["oem"]["ledger"] if e["source_nid"] == self.fx["ru"]}
        for sku, reason in want.items():
            self.assertEqual((got[sku]["status"], got[sku]["reason"]), ("held", reason), sku)
            self.assertNotIn(str(self.cat.nid(sku)), evidence[str(self.fx["ru"])]["targets"])
        for sku in ("OK-3", "RC-9"):
            self.assertEqual(got[sku]["status"], "published", sku)               # a known, available, non-critical profile passes the variant gate
        self.assertEqual(metrics["oem"]["held_by_reason"], {"product_kit_excluded": 1, "target_not_purchasable": 2,
                                                            "target_not_in_source_head": 1, "target_variant_unverified": 2})

    def test_the_variant_gate_applies_to_a_source_as_well_as_to_a_target(self):
        inp, cat = sc.standard()
        safe = next(d for d, p in cat.profiles.items() if not p["fitment_critical"])
        critical = next(d for d, p in cat.profiles.items() if p["fitment_critical"])
        for model, sku, digest in (("Frame U", "C-FU", "0" * 64), ("Frame V", "C-FV", critical), ("Frame W", "C-FW", safe)):
            cat.stroller(model, sku)
            cat.set(sku, option_digest=digest)                    # unknown profile / fitment-critical profile / known, available, non-critical profile
        inp = cat.finish()
        pairs = [sc.edge(inp, sku, "RC-9") for sku in ("C-FU", "C-FV", "C-FW")]
        _, evidence, metrics = inp.patched(oem_relations=sc.envelope(pairs), **ON)
        got = {e["source_nid"]: (e["status"], e["reason"]) for e in metrics["oem"]["ledger"]}
        self.assertEqual(got[cat.nid("C-FU")], ("held", "source_variant_unverified"))
        self.assertEqual(got[cat.nid("C-FV")], ("held", "source_variant_unverified"))
        self.assertEqual(got[cat.nid("C-FW")][0], "published")
        rc9 = str(cat.nid("RC-9"))
        self.assertNotIn(rc9, evidence[str(cat.nid("C-FU"))]["targets"])
        self.assertNotIn(rc9, evidence[str(cat.nid("C-FV"))]["targets"])
        self.assertIn(rc9, evidence[str(cat.nid("C-FW"))]["targets"])
        self.assertEqual(metrics["oem"]["held_by_reason"], {"source_variant_unverified": 2})

    def test_a_target_in_the_translation_set_of_the_source_is_the_same_product_and_is_held(self):
        inp, cat = sc.standard()
        src, edge = sc.edge(inp, "C-FX", "RC-9")
        cat.rows[edge["target_nid"]]["tnid"] = cat.rows[src]["tnid"]       # two rows of one language in one translation set: the legacy rules call it one product
        inp = cat.finish()
        _, evidence, metrics = inp.patched(oem_relations=sc.envelope([(src, edge)]), **ON)
        self.assertEqual([(e["status"], e["reason"]) for e in metrics["oem"]["ledger"]], [("held", "same_product")])
        self.assertNotIn(str(edge["target_nid"]), evidence[str(src)]["targets"])
        self.assertEqual(metrics["edges"]["A_oem_relation"], 0)

    def test_locale_sku_and_catalog_staleness_are_checked_against_the_live_rows(self):
        rc9 = self.cat.nid("RC-9", "ru")
        src_ru = self.cat.nid("C-FX", "ru")
        _, locale_edge = sc.edge(self.inp, "C-FX", "RC-9")
        locale_edge = dict(locale_edge, lang="uk")                                                  # envelope says uk, rows are ru
        _, sku_edge = sc.edge(self.inp, "C-FX", "BG-9")
        sku_edge = dict(sku_edge, target_sku="BG-9-OLD")                                            # SKU changed since the gate ran
        ghost = dict(sc.edge(self.inp, "C-FX", "MN-1")[1], target_nid=987654, target_sku="X")        # target no longer in the catalog
        env = sc.envelope([(src_ru, locale_edge), (src_ru, sku_edge), (src_ru, ghost)])
        _, _, metrics = self.inp.patched(oem_relations=env, **ON)
        got = {e["target_nid"]: (e["status"], e["reason"]) for e in metrics["oem"]["ledger"]}
        self.assertEqual(got[rc9], ("held", "locale_mismatch"))
        self.assertEqual(got[self.cat.nid("BG-9")], ("held", "target_sku_changed"))
        self.assertEqual(got[987654], ("held", "target_not_in_catalog"))

    def test_sources_outside_the_scope_or_without_a_head_or_not_purchasable_are_held_with_a_reason(self):
        inp, cat = sc.standard()
        out_of_scope = cat.nid("RC-9", "ru")                                                         # an accessory is not a recommendation source
        seat_fs3 = cat.nid("S-B1", "ru")
        cat.rows[seat_fs3]["field_status"] = 3                                                      # a seat that is not purchasable
        headless = cat.nid("OK-3", "ru")
        inp.scope[str(headless)] = {"language": "ru", "similar": [], "accessories": []}              # in scope (the runner scopes every cohort row) but no head
        pairs = [(out_of_scope, sc.edge(inp, "C-FY", "BG-9")[1]), (seat_fs3, sc.edge(inp, "S-B1", "SC-5", model="zeta:beta-1")[1]),
                 (headless, sc.edge(inp, "C-FY", "BG-9")[1])]
        result = inp.patched(oem_relations=sc.envelope(pairs), **ON)
        got = {e["source_nid"]: e["reason"] for e in result[2]["oem"]["ledger"]}
        self.assertEqual(got[out_of_scope], "source_not_in_scope")
        self.assertEqual(got[seat_fs3], "source_not_purchasable")
        self.assertEqual(got[headless], "source_has_no_recommendation_head")
        self.assertEqual(result[2]["edges"]["A_oem_relation"], 0)

    def test_v36_similar_wins_over_an_oem_edge(self):
        inp, cat = sc.standard()
        fy_ru, rc9 = cat.nid("C-FY", "ru"), cat.nid("RC-9", "ru")
        inp.scope[str(fy_ru)]["similar"] = [rc9]
        sources, evidence, metrics = inp.patched(oem_relations=sc.envelope([sc.edge(inp, "C-FY", "RC-9")]), **ON)
        self.assertEqual(sources[str(fy_ru)]["similar"], [rc9])
        self.assertNotIn(rc9, sources[str(fy_ru)]["accessories"])
        self.assertEqual(metrics["oem"]["ledger"][0]["reason"], "in_v36_similar")

    def test_seat_liner_age_group_gate_still_applies_to_car_seat_sources(self):
        inp, cat = sc.standard()
        cat.seat_accessory("Zeta вкладыш LN-1", "Zeta вкладиш LN-1", "LN-1")
        inp = cat.finish()
        env = sc.envelope([sc.edge(inp, "S-A1", "LN-1", model="zeta:alpha-1")])
        _, _, metrics = inp.patched(oem_relations=env, **ON)
        self.assertEqual(inp.patched()[2]["edges"], inp.baseline()[2]["edges"])
        self.assertEqual((metrics["oem"]["ledger"][0]["status"], metrics["oem"]["ledger"][0]["reason"]),
                         ("held", "seat_liner_age_group_incompatible"))

    def test_the_limit_of_20_applies_to_new_edges_and_never_removes_a_legacy_edge(self):
        cat = cf.Catalog()
        cat.stroller("Frame Z", "C-FZ")
        for n in range(18):
            cat.stroller_accessory(f"Acme чехол LZ-{n:02d} для коляски Acme Frame Z", f"Acme чохол LZ-{n:02d} для візка Acme Frame Z", f"LZ-{n:02d}")
        for n in range(4):
            cat.stroller_accessory(f"Acme чехол OZ-{n}", f"Acme чохол OZ-{n}", f"OZ-{n}")
        inp = cat.finish()
        base = inp.baseline()
        z_ru = cat.nid("C-FZ", "ru")
        self.assertEqual(len(base[0][str(z_ru)]["accessories"]), 18)
        env = sc.envelope([sc.edge(inp, "C-FZ", f"OZ-{n}") for n in range(4)])
        sources, evidence, metrics = inp.patched(oem_relations=env, **ON)
        accessories = sources[str(z_ru)]["accessories"]
        self.assertEqual(len(accessories), 20)
        self.assertEqual(accessories[:18], base[0][str(z_ru)]["accessories"])                    # legacy untouched and first
        self.assertEqual(sorted(e["status"] for e in metrics["oem"]["ledger"]), ["dropped_by_limit_20", "dropped_by_limit_20", "published", "published"])
        self.assertEqual(metrics["oem"]["published"], 2)
        self.assertEqual(metrics["edges"]["A_oem_relation"], 2)

    def test_legacy_manufacturer_fitment_path_and_a_tier_counts_are_unchanged_when_there_is_no_oem_edge(self):
        sources, evidence, metrics = self.inp.patched(oem_relations=sc.envelope([]), **ON)
        self.assertEqual((sources, evidence), (self.base[0], self.base[1]))
        mm = {k: v for k, v in metrics.items() if k not in ("oem", "elapsed_seconds")}
        bm = {k: v for k, v in self.base[2].items() if k != "elapsed_seconds"}
        mm["edges"] = {k: v for k, v in mm["edges"].items() if k != "A_oem_relation"}
        self.assertEqual(mm, bm)
        self.assertEqual(metrics["oem"]["edges_in"], 0)


@require_engine
class TestLedgerInvariantGuard(unittest.TestCase):
    """``_oem_close`` refuses a ledger in which an envelope edge did not end in exactly one known disposition (a bug guard: it must never be silent)."""

    META = {"synthetic": False, "relations_digest": "0" * 64, "inputs_digest": "1" * 64, "gate_version": "test", "as_of": "2026-11-17",
            "one_ended_adapter": "abstain", "edges_in": 2}

    @staticmethod
    def entry(target, status, reason=None):
        return {"source_nid": 1, "target_nid": target, "relation_ids": ["rel:0000000000000001"], "status": status, "reason": reason}

    def close(self, ledger, **meta):
        metrics = {"edges": {}}
        patched()._oem_close(metrics, {}, {"1": {}}, ledger, {**self.META, **meta})
        return metrics

    def test_a_ledger_in_which_every_edge_has_one_known_status_is_accepted_and_counted(self):
        metrics = self.close([self.entry(2, "published"), self.entry(3, "held", "target_not_in_source_head")])
        oem = metrics["oem"]
        self.assertEqual((metrics["edges"]["A_oem_relation"], oem["published"], oem["held"], oem["edges_in"]), (1, 1, 1, 2))
        self.assertEqual(oem["held_by_reason"], {"target_not_in_source_head": 1})

    def test_an_undisposed_unknown_or_miscounted_ledger_is_refused(self):
        cases = {"status None": [self.entry(2, "published"), self.entry(3, None)],
                 "status accepted (never final)": [self.entry(2, "published"), self.entry(3, "accepted")],
                 "an unknown status": [self.entry(2, "published"), self.entry(3, "bogus")],
                 "an envelope edge without any entry": [self.entry(2, "published")],
                 "an entry more than the envelope has": [self.entry(2, "published"), self.entry(3, "held", "x"), self.entry(4, "held", "x")]}
        for name, ledger in cases.items():
            with self.subTest(name), self.assertRaises(ValueError) as ctx:
                self.close(ledger)
            self.assertIn("ledger invariant", str(ctx.exception))

    def test_an_edge_whose_source_is_outside_the_scope_gets_its_own_held_entry(self):
        edges = {7: [{"target_nid": 9, "relation_ids": ["rel:0000000000000002"]}]}
        metrics, ledger = {"edges": {}}, [self.entry(2, "published")]
        patched()._oem_close(metrics, edges, {"1": {}}, ledger, {**self.META, "edges_in": 2})
        self.assertEqual(metrics["oem"]["held_by_reason"], {"source_not_in_scope": 1})


@require_engine
class TestSeamFilesAreConsistent(unittest.TestCase):
    """The committed patch, helper block, patched file and pins are exactly what the build tool regenerates from the accepted engine file."""

    def test_the_build_tool_check_passes(self):
        proc = subprocess.run([sys.executable, "-I", "-B", str(ROOT / "tools" / "build_engine_seam.py"), "--check"], capture_output=True, text=True,
                              env=dict(os.environ), cwd=str(ROOT), timeout=300)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("ENGINE SEAM VERIFIED", proc.stdout + proc.stderr)

    def test_the_pins_equal_the_files_and_the_accepted_engine_file(self):
        pins = json.loads((ROOT / "engine_seam" / "ENGINE_SEAM_PINS.json").read_text(encoding="utf-8"))
        sha = lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest()  # noqa: E731
        engine_file = Path(os.environ["BP_V421_ENGINE_ROOT"]) / pins["base_file"]
        self.assertEqual(sha(engine_file), pins["base_sha256"])
        self.assertEqual(sha(SEAM_FILE), pins["patched_sha256"])
        self.assertEqual(sha(ROOT / pins["patch_file"]), pins["patch_sha256"])
        self.assertEqual(sha(ROOT / pins["helpers_file"]), pins["helpers_sha256"])
        base_lines = engine_file.read_text(encoding="utf-8").count("\n")
        self.assertEqual(base_lines, pins["base_lines"])
        self.assertEqual(SEAM_FILE.read_text(encoding="utf-8").count("\n") - base_lines, pins["patch_added_lines"] - pins["patch_removed_lines"])


if __name__ == "__main__":
    unittest.main()
