"""Regressions for the two defects of the independent rehearsal review of Stage C (HEAD de2ffb6), run against the REAL V4.2.1 engine modules.

C-R1  An accepted edge was keyed only by the source NID: a valid envelope kept publishing after the catalog row behind that NID had become another
      model / SKU (reviewer reproduction: NID 1009 "C-FY" -> "C-FZ", index rebuilt, edge still ``published``). The seam now recomputes the identity of the
      current source from the live rows and the live V3.2 index and holds every edge that does not carry exactly that identity.
C-R2  A gate-approved two-ended ``adapter_between`` edge whose ``end`` is ``seat`` could never reach the car-seat page when the catalog files the adapter
      under the stroller taxonomy (``target_not_in_source_head``). The adapter may now cross the taxonomy, and only that: every other gate still applies.

Every envelope here is explicitly SYNTHETIC; nothing is production or OEM data.
"""
from __future__ import annotations

import copy
import hashlib
import json
import unittest

from oem_intake import envelope as E
from oem_intake import source_identity as SI
from tests import catalog_fixture as cf
from tests import scenarios as sc
from tests.helpers import baseline, patched, require_engine

ON = {"oem_enabled": True, "oem_allow_synthetic": True}
TWO_ENDED = {"one_ended_adapter": "synthetic_test_two_ended"}


def ledger_of(result):
    return {(e["source_nid"], e["target_nid"]): (e["status"], e["reason"]) for e in result[2]["oem"]["ledger"]}


def reasons_of(result, source_nid):
    return result[1].get(str(source_nid), {}).get("targets", {})


def restate(inp, nid, **fields):
    """The catalog changed AFTER the gate ran: update a row (and its translation sibling when ``both``) and rebuild the V3.2 index like a re-run would."""
    import v32_pipeline as v32
    import v3_rules_v421 as rules
    for key in [nid] if not fields.pop("both", False) else [nid, *(n for n, r in inp.rows.items() if r["tnid"] == inp.rows[nid]["tnid"] and n != nid)]:
        inp.rows[key].update(fields)
    for row in inp.rows.values():
        row["function_signature"] = rules.functional_signature(row)
    inp.index = v32.build_indexes(inp.rows)


# ------------------------------------------------------------------------------------------------------------------------------------- C-R1
class TestIdentityDefinition(unittest.TestCase):
    """No engine needed: the identity is a SHA-256 of a canonical JSON that is written out here by hand (known answer)."""

    @staticmethod
    def tiny():
        rows = {1: {"nid": 1, "tnid": 10, "lang": "ru", "sku": "S-1", "type": "product", "brand": "Zeta", "brand_tid": 9001},
                2: {"nid": 2, "tnid": 10, "lang": "uk", "sku": "S-1", "type": "product", "brand": "Zeta", "brand_tid": 9001}}
        index = {"source_models": {"10": {"brand_tid": 9001, "models": {"zeta:alpha-1": ["Alpha 1"]}, "locales": {"ru": {"nid": 1}, "uk": {"nid": 2}}}}}
        return rows, index

    def test_known_answer(self):
        rows, index = self.tiny()
        text = ('{"brand":"Zeta","brand_tid":9001,"group":{"brand_tid":9001,"locales":{"ru":{"brand":"Zeta","nid":1},"uk":{"brand":"Zeta","nid":2}},'
                '"models":{"zeta:alpha-1":["Alpha 1"]}},"lang":"ru","nid":1,"schema":"bp-oem-source-identity-v1","sku":"S-1","tnid":10,"type":"product"}')
        self.assertEqual(SI.digest_of(1, rows, index), hashlib.sha256(text.encode("utf-8")).hexdigest())
        self.assertEqual(SI.identities_for(rows, index)[1], {"sku": "S-1", "identity": hashlib.sha256(text.encode("utf-8")).hexdigest()})

    def test_every_identity_field_changes_the_digest(self):
        rows, index = self.tiny()
        base = SI.digest_of(1, rows, index)
        changes = {
            "sku": lambda r, i: r[1].update(sku="S-2"), "type": lambda r, i: r[1].update(type="product_kit"), "lang": lambda r, i: r[1].update(lang="uk"),
            "brand": lambda r, i: r[1].update(brand="Acme"), "brand_tid": lambda r, i: r[1].update(brand_tid=9100),
            "tnid": lambda r, i: (r[1].update(tnid=11), i["source_models"].update({"11": i["source_models"]["10"]})),
            "group models": lambda r, i: i["source_models"]["10"]["models"].update({"zeta:alpha-6": ["Alpha 6"]}),
            "group brand_tid": lambda r, i: i["source_models"]["10"].update(brand_tid=9100),
            "sibling nid": lambda r, i: i["source_models"]["10"]["locales"]["uk"].update(nid=3) or r.update({3: dict(r[2], nid=3)}),
            "sibling brand": lambda r, i: r[2].update(brand="Acme"),
        }
        for name, change in changes.items():
            with self.subTest(change=name):
                rows, index = self.tiny()
                change(rows, index)
                self.assertNotEqual(SI.digest_of(1, rows, index), base)

    def test_fields_the_variant_gate_owns_or_that_change_all_the_time_are_not_part_of_the_identity(self):
        rows, index = self.tiny()
        base = SI.digest_of(1, rows, index)
        rows[1].update(price=1.0, option_digest="e" * 64, title="renamed", field_status=3, cats="1:x", function_signature="x")
        self.assertEqual(SI.digest_of(1, rows, index), base)

    def test_a_source_that_cannot_be_described_has_no_identity(self):
        rows, index = self.tiny()
        self.assertIsNone(SI.digest_of(99, rows, index))                                              # not a row
        self.assertIsNone(SI.digest_of(1, rows, {"source_models": {}}))                               # not in the index
        self.assertIsNone(SI.digest_of(1, rows, {}))
        self.assertIsNone(SI.digest_of(1, rows, None))
        self.assertIsNone(SI.digest_of(1, {1: {"nid": 1}}, index))                                    # incomplete row
        bad = copy.deepcopy(index)
        bad["source_models"]["10"]["locales"] = {}
        self.assertIsNone(SI.digest_of(1, rows, bad))
        bad = copy.deepcopy(index)
        bad["source_models"]["10"]["models"] = ["x"]
        self.assertIsNone(SI.digest_of(1, rows, bad))
        self.assertEqual(SI.identities_for(rows, {"source_models": {}}), {})

    def test_the_edge_shape_requires_both_fields_and_a_real_hash(self):
        from tests.test_envelope import good
        doc = good()
        E.validate(doc, allow_synthetic=True)
        for field in ("source_sku", "source_identity"):
            with self.subTest(missing=field):
                broken = copy.deepcopy(doc)
                del broken["edges"]["1001"][0][field]
                with self.assertRaises(E.EnvelopeError):
                    E.validate(broken, allow_synthetic=True)
        for value in ("", "d" * 63, "D" * 64, "z" * 64, None, 7):
            with self.subTest(identity=value):
                broken = copy.deepcopy(doc)
                broken["edges"]["1001"][0]["source_identity"] = value
                with self.assertRaises(E.EnvelopeError):
                    E.validate(broken, allow_synthetic=True)
        broken = copy.deepcopy(doc)
        broken["edges"]["1001"][0]["source_sku"] = ""
        with self.assertRaises(E.EnvelopeError):
            E.validate(broken, allow_synthetic=True)


@require_engine
class TestSourceIdentityIsEnforcedByTheEngine(unittest.TestCase):
    """The reviewer's finding: the edge is for THIS source row as it was when the gate ran, or it is held."""

    def setUp(self):
        self.inp, self.cat = sc.standard()
        self.fy = {lang: self.cat.nid("C-FY", lang) for lang in cf.LANGS}
        self.src, self.edge = sc.edge(self.inp, "C-FY", "RC-9", model="acme:frame-y")
        self.env = sc.envelope([(self.src, self.edge)])
        self.base = self.inp.baseline()

    def status(self, inp=None, env=None):
        inp = inp or self.inp
        result = inp.patched(oem_relations=env or self.env, **ON)
        return ledger_of(result)[(self.src, self.edge["target_nid"])], result

    def test_the_valid_envelope_is_published_while_the_source_is_unchanged(self):
        (status, reason), result = self.status()
        self.assertEqual((status, reason), ("published", None))
        ev = reasons_of(result, self.src)[str(self.edge["target_nid"])]
        self.assertEqual((ev["source_sku"], ev["source_identity"]), ("C-FY", SI.digest_of(self.src, self.inp.rows, self.inp.index)))

    def test_reviewer_reproduction_the_source_nid_becomes_another_model_and_sku_with_a_rebuilt_index(self):
        self.assertEqual(self.status()[0], ("published", None))
        for lang in cf.LANGS:                                                                              # the NID now carries "C-FZ / Frame Z" (both locales)
            nid = self.fy[lang]
            restate(self.inp, nid, sku="C-FZ", title=self.inp.rows[nid]["title"].replace("Frame Y", "Frame Z"))
        self.assertEqual(self.inp.rows[self.src]["sku"], "C-FZ")
        self.assertIn("frame-z", json.dumps(self.inp.index["source_models"][str(self.inp.rows[self.src]["tnid"])]["models"]).lower().replace(" ", "-"))
        (status, reason), result = self.status()
        self.assertEqual((status, reason), ("held", "source_sku_changed"))
        self.assertNotIn(str(self.edge["target_nid"]), reasons_of(result, self.src))
        self.assertEqual(result[2]["edges"]["A_oem_relation"], 0)
        self.assertEqual(cf.normalize((result[0], result[1], {k: v for k, v in result[2].items() if k not in ("oem",)}))
                         .count("accepted_oem_relation"), 0)

    def test_a_model_change_with_the_same_sku_is_caught_by_the_identity_digest(self):
        for lang in cf.LANGS:
            nid = self.fy[lang]
            restate(self.inp, nid, title=self.inp.rows[nid]["title"].replace("Frame Y", "Frame Z"))      # SKU untouched: only the model changed
        self.assertEqual(self.inp.rows[self.src]["sku"], "C-FY")
        self.assertEqual(self.status()[0], ("held", "source_identity_changed"))

    def test_each_identity_field_of_the_live_source_is_checked(self):
        cases = {
            "brand": dict(brand="Nova"), "brand_tid": dict(brand_tid=9200), "type": dict(type="product_kit_v2"),
        }
        for name, change in cases.items():
            with self.subTest(changed=name):
                inp, cat = sc.standard()
                src, edge = sc.edge(inp, "C-FY", "RC-9")
                env = sc.envelope([(src, edge)])
                restate(inp, src, **change)
                got = ledger_of(inp.patched(oem_relations=env, **ON))[(src, edge["target_nid"])]
                self.assertEqual(got[0], "held")
                self.assertIn(got[1], ("source_identity_changed", "source_not_purchasable"))              # a changed type can also fail an older gate first: never published

    def test_a_changed_translation_sibling_or_group_is_a_changed_identity(self):
        uk = self.fy["uk"]
        restate(self.inp, uk, brand="Nova")                                                              # the UK twin now belongs to another brand
        self.assertEqual(self.status()[0], ("held", "source_identity_changed"))
        inp, cat = sc.standard()
        src, edge = sc.edge(inp, "C-FY", "RC-9")
        env = sc.envelope([(src, edge)])
        inp.rows[src]["tnid"] = cat.nid("C-FX", "ru") and inp.rows[cat.nid("C-FX", "ru")]["tnid"]       # re-pointed into the translation set of another product
        restate(inp, src)
        self.assertEqual(ledger_of(inp.patched(oem_relations=env, **ON))[(src, edge["target_nid"])][0], "held")

    def test_the_edge_of_one_source_cannot_be_attached_to_another_source(self):
        fx = self.cat.nid("C-FX", "ru")
        moved = sc.envelope([(fx, dict(self.edge))])                                                      # FY's identity filed under FX
        got = ledger_of(self.inp.patched(oem_relations=moved, **ON))[(fx, self.edge["target_nid"])]
        self.assertEqual(got, ("held", "source_sku_changed"))
        same_sku = sc.envelope([(fx, dict(self.edge, source_sku=self.inp.rows[fx]["sku"]))])              # even with the right SKU the digest is FY's
        got = ledger_of(self.inp.patched(oem_relations=same_sku, **ON))[(fx, self.edge["target_nid"])]
        self.assertEqual(got, ("held", "source_identity_changed"))

    def test_opaque_placeholder_hashes_are_never_trusted(self):
        for placeholder in (sc.D64, "0" * 64, "f" * 64, sc.A64):
            with self.subTest(placeholder=placeholder[:4]):
                env = sc.envelope([(self.src, dict(self.edge, source_identity=placeholder))])
                self.assertEqual(self.status(env=env)[0], ("held", "source_identity_changed"))
        env = sc.envelope([(self.src, dict(self.edge, source_sku="SRC-UNBOUND"))])
        self.assertEqual(self.status(env=env)[0], ("held", "source_sku_changed"))

    def test_a_source_the_engine_cannot_describe_fails_closed(self):
        tnid = str(self.inp.rows[self.src]["tnid"])
        del self.inp.index["source_models"][tnid]                                                         # no model group any more
        self.assertEqual(self.status()[0], ("held", "source_identity_changed"))
        inp, _ = sc.standard()
        src, edge = sc.edge(inp, "C-FY", "RC-9")
        env = sc.envelope([(src, edge)])
        inp.index["source_models"] = {}
        self.assertEqual(ledger_of(inp.patched(oem_relations=env, **ON))[(src, edge["target_nid"])], ("held", "source_identity_changed"))

    def test_a_stale_edge_is_held_before_it_can_be_called_already_present_or_published(self):
        rc1 = self.cat.nid("RC-1", "ru")
        fx = self.cat.nid("C-FX", "ru")
        legacy = sc.edge(self.inp, "C-FX", "RC-1")[1]                                                    # RC-1 is already a legacy A edge of Frame X
        env = sc.envelope([(fx, legacy)])
        self.assertEqual(ledger_of(self.inp.patched(oem_relations=env, **ON))[(fx, rc1)][0], "already_present_legacy")
        restate(self.inp, fx, sku="C-FQ")
        self.assertEqual(ledger_of(self.inp.patched(oem_relations=env, **ON))[(fx, rc1)], ("held", "source_sku_changed"))

    def test_stale_edges_change_nothing_in_the_output_and_each_gets_exactly_one_disposition(self):
        other = sc.edge(self.inp, "C-FY", "BG-9")[1]
        env = sc.envelope([(self.src, self.edge), (self.src, other)])
        restate(self.inp, self.src, sku="C-FZ")
        base = self.inp.baseline()
        result = self.inp.patched(oem_relations=env, **ON)
        self.assertEqual(sorted(v[0] for v in ledger_of(result).values()), ["held", "held"])
        self.assertEqual(result[2]["oem"]["held_by_reason"], {"source_sku_changed": 2})
        self.assertEqual(result[2]["oem"]["published"], 0)
        self.assertEqual(result[0], base[0])
        self.assertEqual(result[1], base[1])
        self.assertEqual({k: v for k, v in result[2]["edges"].items() if k != "A_oem_relation"}, base[2]["edges"])

    def test_irrelevant_catalog_changes_do_not_invalidate_a_current_edge(self):
        restate(self.inp, self.src, both=True, price=99999.0, option_digest="")                           # price and options belong to other gates, not to the identity
        self.assertEqual(self.status()[0], ("published", None))
        self.inp.rows[self.edge["target_nid"]]["price"] = 5.0
        self.assertEqual(self.status()[0], ("published", None))

    def test_the_variant_gate_still_decides_the_options_of_the_source(self):
        restate(self.inp, self.src, option_digest="0" * 64)                                              # unknown profile: the existing gate, not an identity change
        self.assertEqual(self.status()[0], ("held", "source_variant_unverified"))

    def test_both_locales_are_bound_independently(self):
        pairs = [sc.edge(self.inp, "C-FY", "RC-9", lang=lang, model="acme:frame-y") for lang in cf.LANGS]
        env = sc.envelope(pairs)
        got = ledger_of(self.inp.patched(oem_relations=env, **ON))
        self.assertEqual({v for v in got.values()}, {("published", None)})
        restate(self.inp, self.fy["uk"], sku="C-FZ")                                                     # only the UK row of the pair changes SKU
        got = ledger_of(self.inp.patched(oem_relations=env, **ON))
        self.assertEqual(got[(self.fy["ru"], pairs[0][1]["target_nid"])], ("published", None))           # the RU row itself is unchanged (a sibling's SKU is checked on the sibling's own edge)
        self.assertEqual(got[(self.fy["uk"], pairs[1][1]["target_nid"])], ("held", "source_sku_changed"))

    def test_off_ignores_the_identity_fields_entirely(self):
        restate(self.inp, self.src, sku="C-FZ")
        self.assertEqual(cf.normalize(self.inp.patched(oem_relations=self.env)), cf.normalize(self.inp.baseline()))
        self.assertEqual(cf.normalize(self.inp.patched()), cf.normalize(self.inp.baseline()))

    def test_gate_side_and_engine_side_identity_agree_on_every_row_of_several_catalogs(self):
        module = patched()
        catalogs = [sc.standard()[0], cf.stress_catalog(1).finish(), cf.stress_catalog(5, seats=3, strollers=4).finish()]
        checked = 0
        for inp in catalogs:
            for nid in inp.rows:
                with self.subTest(nid=nid):
                    self.assertEqual(module._oem_source_identity(nid, inp.rows, inp.index), SI.digest_of(nid, inp.rows, inp.index))
                    checked += 1
        self.assertGreater(checked, 100)
        self.assertIsNone(module._oem_source_identity(999999, catalogs[0].rows, catalogs[0].index))
        self.assertIsNone(module._oem_source_identity(next(iter(catalogs[0].rows)), catalogs[0].rows, {"source_models": {}}))

    def test_the_engine_hold_reasons_are_exactly_the_documented_ones(self):
        module = patched()
        source = {"sku": "C-FY"}
        edge = {"source_sku": "C-FY", "source_identity": "a" * 64}
        self.assertIsNone(module._oem_source_stale(source, edge, "a" * 64))
        self.assertEqual(module._oem_source_stale({"sku": "X"}, edge, "a" * 64), "source_sku_changed")
        self.assertEqual(module._oem_source_stale({}, edge, "a" * 64), "source_sku_changed")
        self.assertEqual(module._oem_source_stale(source, edge, "b" * 64), "source_identity_changed")
        self.assertEqual(module._oem_source_stale(source, edge, None), "source_identity_changed")


# ------------------------------------------------------------------------------------------------------------------------------------- C-R2
def adapter_world():
    """A car seat, a stroller, a third-party adapter filed under the STROLLER taxonomy and one filed under the car-seat taxonomy."""
    cat = cf.Catalog()
    cat.seat("Alpha 1", "S-A1")
    cat.seat("Alpha 6", "S-A6")
    cat.stroller("Frame Y", "C-FY")
    cat.stroller_accessory("Acme адаптер ADP-200", "Acme адаптер ADP-200", "ADP-200", brand=cf.THIRD_BRAND)
    cat.seat_accessory("Zeta адаптер ADP-300 для автокресла", "Zeta адаптер ADP-300 для автокрісла", "ADP-300")
    cat.stroller_accessory("Acme дождевик RC-9", "Acme дощовик RC-9", "RC-9")
    cat.stroller_accessory("Acme подстаканник CUP-1", "Acme підсклянник CUP-1", "CUP-1")
    cat.seat_accessory("Zeta чехол SC-5", "Zeta чохол SC-5", "SC-5")
    cat.stroller_accessory("Acme адаптер KIT-A", "Acme адаптер KIT-A", "KIT-A")
    cat.set("KIT-A", type="product_kit")
    cat.stroller_accessory("Acme адаптер FS3-A", "Acme адаптер FS3-A", "FS3-A")
    cat.set("FS3-A", field_status=3)
    cat.stroller_accessory("Acme адаптер PR0-A", "Acme адаптер PR0-A", "PR0-A")
    cat.set("PR0-A", price=0.0)
    cat.stroller_accessory("Acme адаптер VAR-A", "Acme адаптер VAR-A", "VAR-A")
    cat.set("VAR-A", option_digest="0" * 64)
    cat.stroller_accessory("Acme адаптер NOTAX-A", "Acme адаптер NOTAX-A", "NOTAX-A")
    cat.set("NOTAX-A", cats="")
    return cat.finish(), cat


# (source ref, source head, envelope end)
ENDS = (("S-A1", "car_seat", "seat"), ("C-FY", "stroller", "chassis"))
FOREIGN_END = {"car_seat": "chassis", "stroller": "seat"}


def adapter_edge(inp, source, target, end, lang, **over):
    return sc.edge(inp, source, target, lang=lang, relation_type="adapter_between", end=end, **over)


@require_engine
class TestTwoEndedAdapterCrossesTheTaxonomy(unittest.TestCase):
    """Positive: the exact adapter reaches the page of each of its two ends in both languages. Negative: nothing else crosses."""

    def setUp(self):
        self.inp, self.cat = adapter_world()
        self.base = self.inp.baseline()

    def run_edges(self, items, **kw):
        env = sc.envelope(items, **{**TWO_ENDED, **kw})
        return self.inp.patched(oem_relations=env, **ON)

    # ---------- positive
    def test_the_precondition_of_the_defect_the_catalog_files_the_adapter_under_the_stroller_taxonomy(self):
        module = patched()
        row = self.inp.rows[self.cat.nid("ADP-200")]
        self.assertEqual(sorted(module.target_heads(row, self.inp.policy)), ["stroller"])
        self.assertFalse(module.target_in_head(row, "car_seat", self.inp.policy))
        self.assertEqual(module.target_role(row, "car_seat"), "adapter")

    def test_each_end_in_each_language_reaches_its_own_page_with_provenance(self):
        for source, head, end in ENDS:
            for lang in cf.LANGS:
                with self.subTest(source=source, end=end, lang=lang):
                    src, edge = adapter_edge(self.inp, source, "ADP-200", end, lang)
                    result = self.run_edges([(src, edge)])
                    self.assertEqual(ledger_of(result)[(src, edge["target_nid"])], ("published", None))
                    self.assertIn(edge["target_nid"], result[0][str(src)]["accessories"])
                    ev = reasons_of(result, src)[str(edge["target_nid"])]
                    self.assertEqual((ev["tier"], ev["reason"], ev["role"]), ("A_model", "accepted_oem_relation", "adapter"))
                    self.assertEqual((ev["relation_type"], ev["end"], ev["fit_state"], ev["conditions"]), ("adapter_between", end, "LISTED", []))
                    if head == "car_seat":                                                                # the seat end is the crossing: the catalog files the adapter under strollers
                        self.assertEqual(ev["taxonomy_heads"], ["stroller"])
                        self.assertEqual(ev["functional_head"], head)
                        self.assertIn("cross_taxonomy", ev)
                    else:
                        self.assertNotIn("cross_taxonomy", ev)
                    # the engine's own taxonomy head of the page does not move
                    self.assertEqual(result[1][str(src)]["head"], head)

    def test_the_stroller_end_needs_no_crossing_and_carries_no_crossing_note(self):
        src, edge = adapter_edge(self.inp, "C-FY", "ADP-200", "chassis", "ru")
        ev = reasons_of(self.run_edges([(src, edge)]), src)[str(edge["target_nid"])]
        self.assertNotIn("cross_taxonomy", ev)
        self.assertNotIn("taxonomy_heads", ev)

    def test_an_adapter_filed_under_the_seat_taxonomy_is_not_a_crossing_for_the_seat_end(self):
        src, edge = adapter_edge(self.inp, "S-A1", "ADP-300", "seat", "ru")
        ev = reasons_of(self.run_edges([(src, edge)]), src)[str(edge["target_nid"])]
        self.assertNotIn("cross_taxonomy", ev)
        self.assertEqual(ledger_of(self.run_edges([(src, edge)]))[(src, edge["target_nid"])], ("published", None))

    def test_both_ends_of_one_adapter_publish_on_both_pages_in_one_run(self):
        pairs = [adapter_edge(self.inp, s, "ADP-200", end, lang) for s, _, end in ENDS for lang in cf.LANGS]
        result = self.run_edges(pairs)
        self.assertEqual({v for v in ledger_of(result).values()}, {("published", None)})
        self.assertEqual(result[2]["oem"]["published"], 4)
        self.assertEqual(result[2]["edges"]["A_oem_relation"], 4)

    def test_the_crossing_adapter_comes_after_the_legacy_edges_and_nothing_legacy_moves(self):
        src, edge = adapter_edge(self.inp, "S-A1", "ADP-200", "seat", "ru")
        result = self.run_edges([(src, edge)])
        legacy = self.base[0][str(src)]["accessories"]
        self.assertEqual(result[0][str(src)]["accessories"][:len(legacy)], legacy)
        self.assertEqual(result[0][str(src)]["accessories"][len(legacy):], [edge["target_nid"]])
        for nid, entry in self.base[0].items():
            if nid != str(src):
                self.assertEqual(result[0][nid], entry)

    # ---------- negative: the end and the page must match
    def test_an_end_that_belongs_to_the_other_page_never_crosses(self):
        for lang in cf.LANGS:
            with self.subTest(source="S-A1", end="chassis", lang=lang):          # a car-seat page never takes the stroller end of an adapter
                src, edge = adapter_edge(self.inp, "S-A1", "ADP-200", "chassis", lang)
                self.assertEqual(ledger_of(self.run_edges([(src, edge)]))[(src, edge["target_nid"])], ("held", "target_not_in_source_head"))

    def test_the_crossing_is_symmetrical_for_an_adapter_filed_under_the_seat_taxonomy(self):
        for lang in cf.LANGS:
            with self.subTest(lang=lang):                                        # chassis end -> stroller page, although the catalog files ADP-300 under car seats
                src, edge = adapter_edge(self.inp, "C-FY", "ADP-300", "chassis", lang)
                result = self.run_edges([(src, edge)])
                self.assertEqual(ledger_of(result)[(src, edge["target_nid"])], ("published", None))
                ev = reasons_of(result, src)[str(edge["target_nid"])]
                self.assertEqual((ev["taxonomy_heads"], ev["functional_head"]), (["car_seat"], "stroller"))
                src, edge = adapter_edge(self.inp, "C-FY", "ADP-300", "seat", lang)                    # but the seat end does not belong on a stroller page
                self.assertEqual(ledger_of(self.run_edges([(src, edge)]))[(src, edge["target_nid"])], ("held", "target_not_in_source_head"))

    # ---------- negative: only a real adapter, only an adapter_between edge
    def test_a_generic_accessory_never_crosses_even_when_the_edge_claims_to_be_an_adapter(self):
        held, ok = ("held", "target_not_in_source_head"), ("published", None)
        expected = {("S-A1", "RC-9"): held, ("S-A1", "CUP-1"): held, ("S-A1", "SC-5"): ok,      # a stroller rain cover / cup holder is not a car-seat accessory
                    ("C-FY", "RC-9"): ok, ("C-FY", "CUP-1"): ok, ("C-FY", "SC-5"): held}        # a seat cover is not a stroller accessory
        ends = {"S-A1": "seat", "C-FY": "chassis"}
        for (source, target), want in expected.items():
            for lang in cf.LANGS:
                with self.subTest(source=source, target=target, lang=lang):
                    src, edge = adapter_edge(self.inp, source, target, ends[source], lang)
                    self.assertEqual(ledger_of(self.run_edges([(src, edge)]))[(src, edge["target_nid"])], want)

    def test_a_model_edge_to_a_stroller_filed_accessory_still_cannot_reach_a_car_seat(self):
        for lang in cf.LANGS:
            for target in ("ADP-200", "RC-9"):
                with self.subTest(target=target, lang=lang):
                    src, edge = sc.edge(self.inp, "S-A1", target, lang=lang)
                    got = ledger_of(self.run_edges([(src, edge)]))[(src, edge["target_nid"])]
                    self.assertEqual(got, ("held", "target_not_in_source_head"))

    def test_a_taxonomy_the_engine_does_not_know_does_not_cross(self):
        for lang in cf.LANGS:
            with self.subTest(lang=lang):
                src, edge = adapter_edge(self.inp, "S-A1", "NOTAX-A", "seat", lang)
                got = ledger_of(self.run_edges([(src, edge)]))[(src, edge["target_nid"])]
                self.assertEqual(got, ("held", "target_not_in_source_head"))

    # ---------- negative: every other gate still applies to a crossing adapter
    def test_commercial_and_safety_gates_are_unchanged_for_a_crossing_adapter(self):
        expected = {"KIT-A": "product_kit_excluded", "FS3-A": "target_not_purchasable", "PR0-A": "target_not_purchasable",
                    "VAR-A": "target_variant_unverified"}
        for target, reason in expected.items():
            for lang in cf.LANGS:
                with self.subTest(target=target, lang=lang):
                    src, edge = adapter_edge(self.inp, "S-A1", target, "seat", lang)
                    self.assertEqual(ledger_of(self.run_edges([(src, edge)]))[(src, edge["target_nid"])], ("held", reason))

    def test_locale_sku_and_no_self_gates_are_unchanged_for_a_crossing_adapter(self):
        src, edge = adapter_edge(self.inp, "S-A1", "ADP-200", "seat", "ru")
        for name, mutated, reason in (("locale", dict(edge, lang="uk"), "locale_mismatch"),
                                      ("target sku", dict(edge, target_sku="ADP-200-OLD"), "target_sku_changed"),
                                      ("ghost target", dict(edge, target_nid=424242, target_sku="X"), "target_not_in_catalog")):
            with self.subTest(gate=name):
                self.assertEqual(ledger_of(self.run_edges([(src, mutated)]))[(src, mutated["target_nid"])], ("held", reason))
        twin = self.inp.rows[src]["tnid"]
        self.inp.rows[edge["target_nid"]]["tnid"] = twin                                                  # the adapter row is now in the translation set of the source
        self.assertEqual(ledger_of(self.run_edges([(src, edge)]))[(src, edge["target_nid"])], ("held", "same_product"))

    def test_the_source_identity_gate_applies_to_a_crossing_adapter(self):
        src, edge = adapter_edge(self.inp, "S-A1", "ADP-200", "seat", "ru")
        env = sc.envelope([(src, edge)], **TWO_ENDED)
        self.assertEqual(ledger_of(self.inp.patched(oem_relations=env, **ON))[(src, edge["target_nid"])], ("published", None))
        restate(self.inp, src, sku="S-A9")
        self.assertEqual(ledger_of(self.inp.patched(oem_relations=env, **ON))[(src, edge["target_nid"])], ("held", "source_sku_changed"))
        forged = sc.envelope([(src, dict(edge, source_sku="S-A9", source_identity=sc.D64))], **TWO_ENDED)
        self.assertEqual(ledger_of(self.inp.patched(oem_relations=forged, **ON))[(src, edge["target_nid"])], ("held", "source_identity_changed"))

    def test_v36_similar_still_wins_over_a_crossing_adapter(self):
        src, edge = adapter_edge(self.inp, "S-A1", "ADP-200", "seat", "ru")
        self.inp.scope[str(src)]["similar"] = [edge["target_nid"]]
        self.assertEqual(ledger_of(self.run_edges([(src, edge)]))[(src, edge["target_nid"])], ("held", "in_v36_similar"))

    def test_a_source_that_is_not_purchasable_or_not_a_source_gets_no_adapter(self):
        src, edge = adapter_edge(self.inp, "S-A1", "ADP-200", "seat", "ru")
        self.inp.rows[src]["field_status"] = 3
        self.assertEqual(ledger_of(self.run_edges([(src, edge)]))[(src, edge["target_nid"])], ("held", "source_not_purchasable"))
        accessory_as_source = self.cat.nid("RC-9", "ru")
        src2, edge2 = sc.edge(self.inp, "S-A6", "ADP-200", relation_type="adapter_between", end="seat")
        got = ledger_of(self.run_edges([(accessory_as_source, dict(edge2))]))[(accessory_as_source, edge2["target_nid"])]
        self.assertEqual(got[0], "held")

    # ---------- nothing else moves
    def test_the_default_one_ended_policy_still_publishes_no_adapter_edge(self):
        env = sc.envelope([adapter_edge(self.inp, "S-A1", "ADP-200", "seat", "ru")], one_ended_adapter="abstain", synthetic=True)
        with self.assertRaises(ValueError):
            self.inp.patched(oem_relations=env, **ON)                                                     # an adapter edge cannot be expressed under abstain
        plain = sc.envelope([sc.edge(self.inp, "C-FY", "RC-9")])
        result = self.inp.patched(oem_relations=plain, **ON)
        self.assertNotIn(str(self.cat.nid("ADP-200")), result[0][str(self.cat.nid("S-A1"))]["accessories"])

    def test_without_an_envelope_edge_the_engine_never_offers_a_stroller_filed_adapter_to_a_car_seat(self):
        result = self.inp.patched(oem_relations=sc.envelope([sc.edge(self.inp, "C-FY", "RC-9")]), **ON)
        for src in (self.cat.nid("S-A1"), self.cat.nid("S-A6")):
            self.assertEqual(result[0][str(src)], self.base[0][str(src)])
        module = patched()
        self.assertFalse(module.target_in_head(self.inp.rows[self.cat.nid("ADP-200")], "car_seat", self.inp.policy))     # target_in_head is not relaxed globally

    def test_off_is_unchanged(self):
        env = sc.envelope([adapter_edge(self.inp, "S-A1", "ADP-200", "seat", "ru")], **TWO_ENDED)
        self.assertEqual(cf.normalize(self.inp.patched(oem_relations=env)), cf.normalize(self.base))

    def test_the_crossing_rule_itself_as_a_truth_table(self):
        module = patched()
        stroller_adapter = self.inp.rows[self.cat.nid("ADP-200")]
        rain_cover = self.inp.rows[self.cat.nid("RC-9")]
        no_tax = self.inp.rows[self.cat.nid("NOTAX-A")]
        policy = self.inp.policy
        edge = {"relation_type": "adapter_between", "end": "seat"}
        self.assertTrue(module._oem_adapter_crosses(edge, stroller_adapter, "car_seat", policy))
        self.assertTrue(module._oem_adapter_crosses(dict(edge, end="chassis"), stroller_adapter, "stroller", policy))
        self.assertFalse(module._oem_adapter_crosses(dict(edge, end="chassis"), stroller_adapter, "car_seat", policy))
        self.assertFalse(module._oem_adapter_crosses(edge, stroller_adapter, "stroller", policy))
        self.assertFalse(module._oem_adapter_crosses(dict(edge, end="model"), stroller_adapter, "car_seat", policy))
        self.assertFalse(module._oem_adapter_crosses(dict(edge, relation_type="accessory_for_model", end="seat"), stroller_adapter, "car_seat", policy))
        self.assertFalse(module._oem_adapter_crosses(edge, rain_cover, "car_seat", policy))
        self.assertFalse(module._oem_adapter_crosses(edge, no_tax, "car_seat", policy))
        self.assertFalse(module._oem_adapter_crosses(edge, stroller_adapter, None, policy))


if __name__ == "__main__":
    unittest.main()
