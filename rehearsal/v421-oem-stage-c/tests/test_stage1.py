"""Stage1 preparation: the plan of fresh native checks and the fail-closed comparison of receipts (``oem_intake/stage1.py``, ``tools/stage1_plan.py``).

Engine-free on purpose (these tests always run): the module is stdlib-only and reads only catalog rows, an envelope and receipt documents. EVERY
receipt in this file is explicitly SYNTHETIC test data built from the plan's own expectations; the real native receipts do not exist in this
session and Stage1 itself is never reimplemented - the tests only prove that missing, stale, mismatching or self-asserted receipts are refused.
"""
from __future__ import annotations

import copy
import gzip
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tests import scenarios as sc
from tests.helpers import ROOT, require_engine
from oem_intake import stage1 as S1
from oem_stage import canon

CLI = ROOT / "tools" / "stage1_plan.py"


def row(nid, tnid, sku, lang, *, field_status=1, published=1, price=500.0, vid=None, changed=1700000000, option_digest="", oid="", **over):
    out = {"nid": nid, "tnid": tnid, "sku": sku, "lang": lang, "published": published, "field_status": field_status, "price": price,
           "vid": nid * 10 if vid is None else vid, "changed": changed, "option_digest": option_digest, "oid_weight_price_rows": oid,
           "title": f"synthetic {sku} {lang}"}
    out.update(over)
    return out


def catalog() -> dict:
    """Seats 1/2 (S-1) and 3/4 (S-2); accessories ACC-1..ACC-5 as RU/UK pairs; ACC-3 is field_status=3, ACC-4 carries an option digest."""
    rows = [row(1, 1, "S-1", "ru"), row(2, 1, "S-1", "uk"), row(3, 3, "S-2", "ru"), row(4, 3, "S-2", "uk")]
    for i, nid in enumerate((11, 13, 15, 17, 19), start=1):
        sku = f"ACC-{i}"
        over = {"field_status": 3} if i == 3 else {"option_digest": "dg-4", "oid_weight_price_rows": "oid-4"} if i == 4 else {}
        rows += [row(nid, nid, sku, "ru", **over), row(nid + 1, nid, sku, "uk", **over)]
    return {r["nid"]: r for r in rows}


def envelope(rows, pairs, **over):
    return sc.envelope([(src, sc.edge_for(rows, tgt, lang=rows[src]["lang"], source=src)) for src, tgt in pairs], **over)


PAIRS = [(1, 11), (2, 12), (3, 11), (4, 12), (1, 13), (2, 14), (1, 17), (2, 18)]


def diff_doc(rows, links, *, synthetic=False, result="PASS"):
    """A bp-oem-on-off-diff-v1 shaped document (only the fields the planner reads) from ``(change, source_nid, target_nid)`` triples."""
    edges = [{"change": kind, "source_nid": src, "target_nid": tgt, "lang": rows[src]["lang"], "target_sku": rows[tgt]["sku"],
              **({"relation_ids": ["rel:0000000000000001"]} if kind == "new_oem_edge" else {})} for kind, src, tgt in links]
    return {"schema": "bp-oem-on-off-diff-v1", "result": result, "synthetic": synthetic, "edges": edges}


DIFF_LINKS = [("new_oem_edge", 1, 11), ("new_oem_edge", 2, 12), ("new_b_backfill_after_role_coverage", 1, 13),
              ("promoted_b_to_oem_a", 3, 17), ("displaced_b_by_role_coverage", 1, 14), ("displaced_b_by_limit_20", 2, 18)]


def good_receipt(entry, **over):
    exp = entry["expected"]
    rec = {"nid": exp["nid"], "sku": exp["sku"], "tnid": exp["tnid"], "vid": exp["vid"], "changed": exp["changed"], "lang": exp["lang"],
           "option_digest": exp["option_digest"], "oid_weight_price_rows": exp["oid_weight_price_rows"], "all_gates_pass": True,
           "native_access": {"synthetic": True}, "native_stage1_probe": {"stage1_pass": True, "native_states": [{"cta": "buy", "state": "synthetic"}]},
           "synthetic": True}
    rec.update(over)
    return rec


def receipts_for(plan, key="targets", **over):
    return {"targets": [good_receipt(e, **over) for e in plan[key] if e["state"] == S1.NOT_RUN]}


class StageOneCase(unittest.TestCase):
    def setUp(self):
        self.rows = catalog()
        self.env = envelope(self.rows, PAIRS)
        self.plan = S1.plan_from_envelope(self.env, self.rows, allow_synthetic=True)

    def report(self, targets=None, sources=None, plan=None):
        plan = plan or self.plan
        return S1.check_receipts(plan, targets, sources)

    def state(self, rep, nid, key="targets"):
        return next(r for r in rep[key] if r["nid"] == nid)


class TestPlan(StageOneCase):
    def test_the_plan_lists_every_target_locale_and_every_source_context(self):
        plan = self.plan
        self.assertEqual(plan["schema"], S1.PLAN_SCHEMA)
        self.assertEqual([t["nid"] for t in plan["targets"]], [11, 12, 13, 14, 17, 18])
        self.assertEqual([s["nid"] for s in plan["source_contexts"]], [1, 2, 3, 4])
        self.assertEqual(next(t for t in plan["targets"] if t["nid"] == 11)["source_nids"], [1, 3])
        self.assertEqual(next(s for s in plan["source_contexts"] if s["nid"] == 1)["target_nids"], [11, 13, 17])
        self.assertEqual(plan["native_check_nids"], {"targets": [11, 12, 13, 14, 17, 18], "source_contexts": [1, 2, 3, 4]})
        self.assertTrue(all(e["state"] == S1.NOT_RUN and e["reasons"] == [] for e in plan["targets"] + plan["source_contexts"]))
        want = {"nid": 17, "tnid": 17, "sku": "ACC-4", "lang": "ru", "vid": 170, "changed": 1700000000, "option_digest": "dg-4",
                "oid_weight_price_rows": "oid-4", "published": 1, "field_status": 1, "price": 500.0}
        self.assertEqual(next(t for t in plan["targets"] if t["nid"] == 17)["expected"], want)
        self.assertTrue(plan["synthetic"])
        self.assertIn("Not a recommendation", plan["notice"])
        self.assertEqual(plan["summary"], {"targets": 6, "targets_to_check": 6, "targets_not_recommendable": 0, "source_contexts": 4,
                                           "source_contexts_to_check": 4, "unresolved_skus": 0})

    def test_the_plan_is_deterministic_and_carries_its_own_digest(self):
        again = S1.plan_from_envelope(copy.deepcopy(self.env), self.rows, allow_synthetic=True)
        self.assertEqual(canon.canonical_json(self.plan), canon.canonical_json(again))
        self.assertEqual(self.plan["plan_digest"], canon.digest({k: v for k, v in self.plan.items() if k != "plan_digest"}))

    def test_an_envelope_of_zero_edges_gives_an_empty_plan(self):
        plan = S1.plan_from_envelope(sc.envelope([], synthetic=False), self.rows)
        self.assertEqual((plan["targets"], plan["source_contexts"], plan["native_check_nids"]), ([], [], {"targets": [], "source_contexts": []}))
        rep = S1.check_receipts(plan)
        self.assertFalse(rep["summary"]["all_planned_checks_pass"])                # nothing planned is not "everything passed"
        self.assertEqual(rep["summary"]["edges_total"], 0)

    def test_a_synthetic_envelope_needs_the_explicit_opt_in(self):
        with self.assertRaises(S1.Stage1Refused):
            S1.plan_from_envelope(self.env, self.rows)

    def test_a_node_whose_own_catalog_state_rules_it_out_gets_no_native_test(self):
        rows = catalog()
        for nid, over in ((11, {"field_status": 3}), (12, {"published": 0}), (13, {"price": 0}), (14, {"price": "free"}), (17, {"price": True})):
            rows[nid] = dict(rows[nid], **over)
        plan = S1.plan_from_envelope(envelope(rows, PAIRS), rows, allow_synthetic=True)
        got = {t["nid"]: (t["state"], t["reasons"]) for t in plan["targets"]}
        self.assertEqual(got[11], (S1.NOT_RECOMMENDABLE, ["field_status_3"]))
        self.assertEqual(got[12], (S1.NOT_RECOMMENDABLE, ["not_published"]))
        self.assertEqual(got[13], (S1.NOT_RECOMMENDABLE, ["price_not_positive"]))
        self.assertEqual(got[14], (S1.NOT_RECOMMENDABLE, ["price_not_positive"]))
        self.assertEqual(got[17], (S1.NOT_RECOMMENDABLE, ["price_not_positive"]))
        self.assertEqual(got[18], (S1.NOT_RUN, []))
        self.assertEqual(plan["native_check_nids"]["targets"], [18])

    def test_a_catalog_row_without_the_identity_fields_cannot_be_planned_for_a_native_check(self):
        rows = catalog()
        rows[11] = dict(rows[11], vid=None, changed="soon")
        plan = S1.plan_from_envelope(envelope(rows, PAIRS), rows, allow_synthetic=True)
        entry = next(t for t in plan["targets"] if t["nid"] == 11)
        self.assertEqual(entry["state"], S1.NOT_RECOMMENDABLE)
        self.assertEqual(entry["reasons"], ["catalog_row_without_vid", "catalog_row_without_changed"])
        rows[11] = dict(rows[11], price=float("nan"), vid=110, changed=1)
        self.assertEqual(next(t for t in S1.plan_from_envelope(envelope(rows, PAIRS), rows, allow_synthetic=True)["targets"] if t["nid"] == 11)["reasons"],
                         ["price_not_positive"])                                   # a NaN price must not crash the canonical hashing

    def test_a_node_outside_the_two_locales_is_not_planned_for_a_native_test(self):
        rows = {n: row(n, n, f"X-{n}", "en") for n in (1, 11)}
        plan = S1.plan_from_envelope(envelope(rows, [(1, 11)]), rows, allow_synthetic=True)
        self.assertEqual([(t["nid"], t["state"], t["reasons"]) for t in plan["targets"]], [(11, S1.NOT_RECOMMENDABLE, ["locale_not_ru_uk"])])
        self.assertEqual([(s["nid"], s["state"], s["reasons"]) for s in plan["source_contexts"]], [(1, S1.NOT_RECOMMENDABLE, ["locale_not_ru_uk"])])
        self.assertEqual(plan["native_check_nids"], {"targets": [], "source_contexts": []})

    def test_a_self_consistent_document_of_another_schema_is_not_a_plan(self):
        """The digest check alone would accept it: the schema is checked on its own."""
        other = copy.deepcopy(self.plan)
        other["schema"] = "bp-oem-something-else-v1"
        other["plan_digest"] = canon.digest({k: v for k, v in other.items() if k != "plan_digest"})
        with self.assertRaisesRegex(S1.Stage1Refused, "not a bp-oem-stage1-plan-v1 document"):
            S1.check_receipts(other)

    def test_a_source_row_without_a_sku_gets_no_native_check(self):
        rows = catalog()
        accepted = envelope(rows, PAIRS)                                    # the gate can no longer bind a source without a SKU (C-R1): defence in depth
        rows[1] = dict(rows[1], sku="")
        plan = S1.plan_from_envelope(accepted, rows, allow_synthetic=True)
        entry = next(s for s in plan["source_contexts"] if s["nid"] == 1)
        self.assertEqual((entry["state"], entry["reasons"]), (S1.NOT_RECOMMENDABLE, ["catalog_row_without_sku"]))
        self.assertNotIn(1, plan["native_check_nids"]["source_contexts"])

    def test_an_envelope_that_does_not_match_the_catalog_is_refused(self):
        bad = envelope(self.rows, PAIRS)
        bad["edges"]["1"][-1]["target_nid"] = 999                                   # unknown target (still the last, so the edge order is valid)
        with self.assertRaises(S1.Stage1Refused):
            S1.plan_from_envelope(bad, self.rows, allow_synthetic=True)
        bad = envelope(self.rows, PAIRS)
        bad["edges"]["1"][0]["target_sku"] = "OTHER"                                # SKU differs from the catalog row
        with self.assertRaises(S1.Stage1Refused):
            S1.plan_from_envelope(bad, self.rows, allow_synthetic=True)
        bad = envelope(self.rows, PAIRS)
        bad["edges"]["1"][0]["lang"] = "uk"                                         # edge locale differs from the source row's
        with self.assertRaises(S1.Stage1Refused):
            S1.plan_from_envelope(bad, self.rows, allow_synthetic=True)
        rows = catalog()
        del rows[1]                                                                 # unknown source
        with self.assertRaises(S1.Stage1Refused):
            S1.plan_from_envelope(self.env, rows, allow_synthetic=True)
        with self.assertRaises(S1.Stage1Refused):
            S1.plan_from_envelope({"schema": "nope"}, self.rows, allow_synthetic=True)
        with self.assertRaises(S1.Stage1Refused):
            S1.plan_from_envelope(None, self.rows, allow_synthetic=True)

    def test_the_diff_plan_covers_every_new_link_and_nothing_else(self):
        plan = S1.plan_from_diff(diff_doc(self.rows, DIFF_LINKS), self.rows)
        self.assertEqual(plan["mode"], "diff")
        self.assertFalse(plan["synthetic"])
        self.assertEqual([t["nid"] for t in plan["targets"]], [11, 12, 13])             # promoted / displaced links are not new links
        self.assertEqual([s["nid"] for s in plan["source_contexts"]], [1, 2])
        self.assertEqual({t["nid"]: t["link_kinds"] for t in plan["targets"]},
                         {11: ["new_oem_edge"], 12: ["new_oem_edge"], 13: ["new_b_backfill_after_role_coverage"]})
        self.assertEqual({t["nid"]: t["relation_ids"] for t in plan["targets"]},
                         {11: ["rel:0000000000000001"], 12: ["rel:0000000000000001"], 13: []})
        self.assertEqual(plan["native_check_nids"], {"targets": [11, 12, 13], "source_contexts": [1, 2]})
        self.assertEqual(plan["inputs"]["diff_digest"], canon.digest(diff_doc(self.rows, DIFF_LINKS)))
        shuffled = S1.plan_from_diff(diff_doc(self.rows, list(reversed(DIFF_LINKS))), self.rows)       # the order of the diff's edges changes nothing
        self.assertEqual((shuffled["targets"], shuffled["source_contexts"]), (plan["targets"], plan["source_contexts"]))

    def test_a_diff_without_new_links_gives_an_empty_plan(self):
        plan = S1.plan_from_diff(diff_doc(self.rows, DIFF_LINKS[3:]), self.rows)
        self.assertEqual((plan["targets"], plan["source_contexts"]), ([], []))

    def test_the_diff_plan_refuses_what_it_cannot_trust(self):
        good = diff_doc(self.rows, DIFF_LINKS[:2])
        bad = {"failing": dict(good, result="FAIL"), "other schema": dict(good, schema="other"),
               "unknown synthetic": dict(good, synthetic=None), "synthetic": dict(good, synthetic=True)}
        for name, doc in bad.items():
            with self.subTest(name):
                with self.assertRaises(S1.Stage1Refused):
                    S1.plan_from_diff(doc, self.rows)
        self.assertTrue(S1.plan_from_diff(bad["synthetic"], self.rows, allow_synthetic=True)["synthetic"])
        for name, mutate in (("unknown target", lambda d: d["edges"][0].__setitem__("target_nid", 999)),
                             ("unknown source", lambda d: d["edges"][0].__setitem__("source_nid", 999)),
                             ("sku differs", lambda d: d["edges"][0].__setitem__("target_sku", "OTHER")),
                             ("locale differs", lambda d: d["edges"][0].__setitem__("lang", "uk")),
                             ("nid not an int", lambda d: d["edges"][0].__setitem__("target_nid", "x")),
                             ("nid missing", lambda d: d["edges"][0].pop("source_nid"))):
            with self.subTest(name):
                doc = copy.deepcopy(good)
                mutate(doc)
                with self.assertRaises(S1.Stage1Refused):
                    S1.plan_from_diff(doc, self.rows)
        for junk in (None, [], "x"):
            with self.assertRaises(S1.Stage1Refused):
                S1.plan_from_diff(junk, self.rows)

    def test_the_candidate_cohort_preflight_mirrors_the_lock_shape(self):
        """Four status=1 SKUs x RU/UK = 8 native checks; one field_status=3 SKU x RU/UK is NOT_RECOMMENDABLE; an unknown SKU is reported."""
        plan = S1.plan_from_skus(["ACC-1", "ACC-2", "ACC-3", "ACC-4", "ACC-5", "NOPE-1", "ACC-1"], self.rows)
        self.assertEqual(plan["mode"], "candidates")
        self.assertFalse(plan["synthetic"])
        self.assertEqual(plan["summary"], {"targets": 10, "targets_to_check": 8, "targets_not_recommendable": 2, "source_contexts": 0,
                                           "source_contexts_to_check": 0, "unresolved_skus": 1})
        self.assertEqual(plan["native_check_nids"], {"targets": [11, 12, 13, 14, 17, 18, 19, 20], "source_contexts": []})
        self.assertEqual([(t["sku"], t["lang"], t["state"], t["reasons"]) for t in plan["targets"] if t["sku"] == "ACC-3"],
                         [("ACC-3", "ru", S1.NOT_RECOMMENDABLE, ["field_status_3"]), ("ACC-3", "uk", S1.NOT_RECOMMENDABLE, ["field_status_3"])])
        self.assertEqual(plan["unresolved_skus"], [{"sku": "NOPE-1", "reason": "sku_not_in_catalog_rows"}])
        self.assertIn("pre-flight", plan["note"])

    def test_the_candidate_preflight_ignores_other_locales_and_names_the_gap(self):
        rows = catalog()
        rows[90] = row(90, 90, "ONLY-EN", "en")
        rows[91] = row(91, 91, "BOTH", "ru")
        rows[92] = row(92, 91, "BOTH", "en")
        plan = S1.plan_from_skus(["ONLY-EN", "BOTH"], rows)
        self.assertEqual([t["nid"] for t in plan["targets"]], [91])
        self.assertEqual(plan["unresolved_skus"], [{"sku": "ONLY-EN", "reason": "no_ru_uk_row"}])
        with self.assertRaises(S1.Stage1Refused):
            S1.plan_from_skus([], rows)
        with self.assertRaises(S1.Stage1Refused):
            S1.plan_from_skus([""], rows)


class TestReceipts(StageOneCase):
    def test_without_receipts_nothing_is_run_and_nothing_is_cleared(self):
        rep = self.report()
        self.assertEqual(rep["summary"]["targets"], {S1.NOT_RUN: 6})
        self.assertEqual(rep["summary"]["source_contexts"], {S1.NOT_RUN: 4})
        self.assertEqual((rep["summary"]["edges_total"], rep["summary"]["edges_stage1_cleared"]), (8, 0))
        self.assertFalse(rep["summary"]["all_planned_checks_pass"])
        self.assertTrue(all(r["problems"] == ["no_receipt"] for r in rep["targets"] + rep["source_contexts"]))
        self.assertEqual((rep["authorizes_publication"], rep["oem_fit_proof"]), (False, False))
        self.assertEqual((rep["inputs"]["receipts_supplied"], rep["inputs"]["source_receipts_supplied"]), (False, False))
        self.assertEqual(rep["plan_digest"], self.plan["plan_digest"])

    def test_complete_matching_receipts_clear_every_edge_but_still_authorize_nothing(self):
        rep = self.report(receipts_for(self.plan), receipts_for(self.plan, "source_contexts"))
        self.assertEqual(rep["summary"]["targets"], {S1.PASS_STAGE1: 6})
        self.assertEqual(rep["summary"]["source_contexts"], {S1.PASS_STAGE1: 4})
        self.assertEqual((rep["summary"]["edges_total"], rep["summary"]["edges_stage1_cleared"]), (8, 8))
        self.assertTrue(rep["summary"]["all_planned_checks_pass"])
        self.assertTrue(rep["synthetic"])
        self.assertEqual((rep["authorizes_publication"], rep["oem_fit_proof"]), (False, False))
        self.assertEqual(rep["unexpected_receipts"], {"targets": [], "source_contexts": []})

    def test_the_source_context_is_required_separately(self):
        rep = self.report(receipts_for(self.plan))                                  # targets pass, no source receipts at all
        self.assertEqual(rep["summary"]["edges_stage1_cleared"], 0)
        self.assertEqual({e["source_context_state"] for e in rep["edges"]}, {S1.NOT_RUN})
        partial = receipts_for(self.plan, "source_contexts")
        partial["targets"] = [r for r in partial["targets"] if r["nid"] != 1]       # source 1 unchecked: only its edges stay uncleared
        rep = self.report(receipts_for(self.plan), partial)
        self.assertEqual({(e["source_nid"], e["target_nid"]) for e in rep["edges"] if not e["stage1_cleared"]}, {(1, 11), (1, 13), (1, 17)})

    def test_every_field_of_a_receipt_is_compared_and_a_failure_names_its_reason(self):
        def mutate(path, value):
            def go(rec):
                holder, _, leaf = path.rpartition(".")
                node = rec
                for part in filter(None, holder.split(".")):
                    node = node[part]
                if value is KeyError:
                    node.pop(leaf, None)
                else:
                    node[leaf] = value
            return go

        cases = [
            ("sku missing", mutate("sku", KeyError), ["missing_sku"]), ("sku other", mutate("sku", "ACC-9"), ["mismatch_sku"]),
            ("tnid missing", mutate("tnid", KeyError), ["missing_tnid"]), ("tnid other", mutate("tnid", 5), ["mismatch_tnid"]),
            ("tnid junk", mutate("tnid", "abc"), ["malformed_tnid"]), ("tnid float", mutate("tnid", 17.0), ["malformed_tnid"]),
            ("vid stale", mutate("vid", 169), ["mismatch_vid"]), ("vid missing", mutate("vid", KeyError), ["missing_vid"]),
            ("vid bool", mutate("vid", True), ["malformed_vid"]),
            ("changed newer", mutate("changed", 1700000001), ["mismatch_changed"]), ("changed missing", mutate("changed", KeyError), ["missing_changed"]),
            ("digest other", mutate("option_digest", "dg-other"), ["mismatch_option_digest"]),
            ("digest missing", mutate("option_digest", KeyError), ["missing_option_digest"]),
            ("digest empty", mutate("option_digest", ""), ["mismatch_option_digest"]),
            ("oid rows other", mutate("oid_weight_price_rows", "oid-other"), ["mismatch_oid_weight_price_rows"]),
            ("oid rows missing", mutate("oid_weight_price_rows", KeyError), ["missing_oid_weight_price_rows"]),
            ("gates false", mutate("all_gates_pass", False), ["all_gates_pass_not_true"]),
            ("gates string", mutate("all_gates_pass", "true"), ["all_gates_pass_not_true"]),
            ("gates one", mutate("all_gates_pass", 1), ["all_gates_pass_not_true"]),
            ("gates missing", mutate("all_gates_pass", KeyError), ["all_gates_pass_not_true"]),
            ("pass false", mutate("native_stage1_probe.stage1_pass", False), ["stage1_pass_not_true"]),
            ("pass string", mutate("native_stage1_probe.stage1_pass", "yes"), ["stage1_pass_not_true"]),
            ("pass one", mutate("native_stage1_probe.stage1_pass", 1), ["stage1_pass_not_true"]),
            ("probe missing", mutate("native_stage1_probe", KeyError), ["cta_buy_not_proven", "stage1_pass_not_true"]),
            ("probe not a dict", mutate("native_stage1_probe", True), ["cta_buy_not_proven", "stage1_pass_not_true"]),
            ("no buy cta", mutate("native_stage1_probe.native_states", [{"cta": "notify_me"}]), ["cta_buy_not_proven"]),
            ("no states", mutate("native_stage1_probe.native_states", []), ["cta_buy_not_proven"]),
            ("states not a list", mutate("native_stage1_probe.native_states", {"cta": "buy"}), ["cta_buy_not_proven"]),
            ("locale other", mutate("lang", "uk"), ["mismatch_locale"]),
        ]
        entry = next(t for t in self.plan["targets"] if t["nid"] == 17)
        for name, change, want in cases:
            with self.subTest(name):
                rec = good_receipt(entry)
                change(rec)
                rep = self.report({"targets": [rec]})
                got = self.state(rep, 17)
                self.assertEqual((got["state"], got["problems"]), (S1.BLOCKED, want))
                self.assertEqual(self.state(rep, 11)["state"], S1.NOT_RUN)           # the others are untouched
        self.assertEqual(self.state(self.report({"targets": [good_receipt(entry)]}), 17)["state"], S1.PASS_STAGE1)

    def test_an_absent_option_key_equals_an_empty_value_only_where_the_catalog_row_is_empty(self):
        """Mirrors the existing join (``str(stage.get(k) or "") == str(row.get(k) or "")``): absent == empty, nothing else is."""
        plain = next(t for t in self.plan["targets"] if t["nid"] == 11)
        rec = good_receipt(plain)
        del rec["option_digest"], rec["oid_weight_price_rows"]
        self.assertEqual(self.state(self.report({"targets": [rec]}), 11)["state"], S1.PASS_STAGE1)
        rec = good_receipt(plain, option_digest="surprise")
        self.assertEqual(self.state(self.report({"targets": [rec]}), 11)["problems"], ["mismatch_option_digest"])
        rec = good_receipt(plain, option_digest=None)
        self.assertEqual(self.state(self.report({"targets": [rec]}), 11)["state"], S1.PASS_STAGE1)

    def test_numeric_json_skus_compare_by_value_and_a_lost_leading_zero_does_not(self):
        rows = catalog()
        rows[11] = dict(rows[11], sku="2000030111")
        rows[12] = dict(rows[12], sku="0123")
        plan = S1.plan_from_envelope(envelope(rows, [(1, 11), (2, 12)]), rows, allow_synthetic=True)
        a, b = plan["targets"]
        self.assertEqual(self.state(S1.check_receipts(plan, {"targets": [good_receipt(a, sku=2000030111)]}), 11)["state"], S1.PASS_STAGE1)
        self.assertEqual(self.state(S1.check_receipts(plan, {"targets": [good_receipt(b, sku=123)]}), 12)["problems"], ["mismatch_sku"])

    def test_duplicate_receipts_unexpected_receipts_and_non_recommendable_nodes(self):
        rows = catalog()
        rows[11] = dict(rows[11], field_status=3)
        plan = S1.plan_from_envelope(envelope(rows, PAIRS), rows, allow_synthetic=True)
        ok = next(t for t in plan["targets"] if t["nid"] == 12)
        blocked = next(t for t in plan["targets"] if t["nid"] == 11)
        stranger = dict(good_receipt(ok), nid=555)
        rep = S1.check_receipts(plan, {"targets": [good_receipt(ok), good_receipt(ok), good_receipt(blocked), stranger]})
        self.assertEqual((self.state(rep, 12)["state"], self.state(rep, 12)["problems"]), (S1.BLOCKED, ["duplicate_receipt"]))
        node = self.state(rep, 11)                                                   # a passing receipt cannot make a field_status=3 node recommendable
        self.assertEqual(node["state"], S1.NOT_RECOMMENDABLE)
        self.assertEqual(node["problems"], ["field_status_3", "receipt_present_for_a_non_recommendable_node_ignored"])
        self.assertEqual(rep["unexpected_receipts"]["targets"], [555])
        self.assertEqual(rep["summary"]["edges_stage1_cleared"], 0)

    def test_a_synthetic_receipt_is_refused_for_a_real_plan_and_tolerated_for_a_synthetic_one(self):
        real = S1.plan_from_skus(["ACC-1"], self.rows)
        entry = real["targets"][0]
        self.assertEqual(self.state(S1.check_receipts(real, {"targets": [good_receipt(entry)]}), entry["nid"])["problems"], ["synthetic_receipt"])
        self.assertEqual(self.state(S1.check_receipts(real, {"targets": [good_receipt(entry, synthetic=False)]}), entry["nid"])["state"],
                         S1.PASS_STAGE1)
        self.assertEqual(self.state(self.report({"targets": [good_receipt(self.plan["targets"][0])]}), 11)["state"], S1.PASS_STAGE1)

    def test_an_edited_plan_is_refused(self):
        for name, edit in (("expected vid", lambda p: p["targets"][0]["expected"].__setitem__("vid", 1)),
                           ("state", lambda p: p["targets"][0].__setitem__("state", S1.NOT_RECOMMENDABLE)),
                           ("synthetic flag", lambda p: p.__setitem__("synthetic", False)),
                           ("digest itself", lambda p: p.__setitem__("plan_digest", "0" * 64))):
            with self.subTest(name):
                plan = copy.deepcopy(self.plan)
                edit(plan)
                with self.assertRaises(S1.Stage1Refused):
                    S1.check_receipts(plan)
        with self.assertRaises(S1.Stage1Refused):
            S1.check_receipts({"schema": "other"})
        with self.assertRaises(S1.Stage1Refused):
            S1.check_receipts([])

    def test_unusable_receipt_documents_are_refused(self):
        for bad in ([], {"targets": "x"}, {"rows": []}, {"targets": [1]}, {"targets": [{"sku": "no-nid"}]}, {"targets": [{"nid": "12.5"}]},
                    {"targets": [{"nid": True}]}):
            with self.subTest(bad=bad):
                with self.assertRaises(S1.Stage1Refused):
                    self.report(bad)
                with self.assertRaises(S1.Stage1Refused):
                    self.report(None, bad)

    def test_exact_integer_parsing(self):
        for value, want in ((7, 7), ("7", 7), ("007", 7), (True, None), (False, None), (7.0, None), ("7.0", None), ("", None), (None, None), ("-1", None)):
            self.assertEqual(S1._int(value), want, repr(value))


class TestCli(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.base = Path(cls.tmp.name)
        cls.rows = catalog()
        cls.rows_path = cls.base / "rows.jsonl.gz"
        with gzip.open(cls.rows_path, "wt", encoding="utf-8") as handle:
            for nid in sorted(cls.rows):
                handle.write(json.dumps(cls.rows[nid], sort_keys=True) + "\n")
        cls.env_path = cls.base / "env.json"
        canon.write_json(cls.env_path, envelope(cls.rows, PAIRS))
        cls.empty_env = cls.base / "empty.json"
        canon.write_json(cls.empty_env, sc.envelope([], synthetic=False))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def run_cli(self, *args):
        return subprocess.run([sys.executable, "-I", "-B", str(CLI), *map(str, args)], capture_output=True, text=True, cwd=str(ROOT), timeout=120)

    def test_plan_then_verify_end_to_end(self):
        plan_dir = self.base / "p1"
        proc = self.run_cli("plan", "--rows", self.rows_path, "--envelope", self.env_path, "--allow-synthetic", "--out", plan_dir)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        plan = json.loads((plan_dir / "stage1_plan.json").read_text(encoding="utf-8"))
        self.assertEqual(plan["inputs"]["rows_sha256"], canon.sha256_hex(self.rows_path.read_bytes()))
        sums = (plan_dir / "SHA256SUMS.txt").read_text(encoding="utf-8").splitlines()
        self.assertEqual(sums, [f"{canon.sha256_hex((plan_dir / 'stage1_plan.json').read_bytes())}  stage1_plan.json"])
        # without receipts: a report of NOT_RUN, exit 0 - and exit 1 when the caller demands every planned check to have passed
        rep_dir = self.base / "r0"
        proc = self.run_cli("verify", "--plan", plan_dir / "stage1_plan.json", "--out", rep_dir)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads((rep_dir / "stage1_receipts_report.json").read_text(encoding="utf-8"))["summary"]["edges_stage1_cleared"], 0)
        proc = self.run_cli("verify", "--plan", plan_dir / "stage1_plan.json", "--out", self.base / "r1", "--require-cleared")
        self.assertEqual(proc.returncode, 1)
        # complete synthetic receipts (existing format) -> cleared, exit 0
        t_path, s_path = self.base / "t.json", self.base / "s.json"
        canon.write_json(t_path, receipts_for(plan))
        canon.write_json(s_path, receipts_for(plan, "source_contexts"))
        proc = self.run_cli("verify", "--plan", plan_dir / "stage1_plan.json", "--receipts", t_path, "--source-receipts", s_path,
                            "--out", self.base / "r2", "--require-cleared")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        report = json.loads((self.base / "r2" / "stage1_receipts_report.json").read_text(encoding="utf-8"))
        self.assertEqual((report["summary"]["edges_stage1_cleared"], report["inputs"]["receipts_sha256"]), (8, canon.sha256_hex(t_path.read_bytes())))
        # one stale receipt -> that target is BLOCKED and --require-cleared fails
        stale = receipts_for(plan)
        stale["targets"][0]["vid"] += 1
        canon.write_json(self.base / "stale.json", stale)
        proc = self.run_cli("verify", "--plan", plan_dir / "stage1_plan.json", "--receipts", self.base / "stale.json", "--source-receipts", s_path,
                            "--out", self.base / "r3", "--require-cleared")
        self.assertEqual(proc.returncode, 1)
        self.assertIn(S1.BLOCKED, json.loads((self.base / "r3" / "stage1_receipts_report.json").read_text(encoding="utf-8"))["summary"]["targets"])

    def test_the_sku_preflight_and_every_refusal(self):
        proc = self.run_cli("plan", "--rows", self.rows_path, "--sku", "ACC-1", "--sku", "ACC-3", "--sku", "NOPE", "--out", self.base / "c1")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        plan = json.loads((self.base / "c1" / "stage1_plan.json").read_text(encoding="utf-8"))
        self.assertEqual(plan["summary"]["targets_to_check"], 2)
        self.assertEqual(plan["summary"]["targets_not_recommendable"], 2)
        self.assertEqual(plan["unresolved_skus"], [{"sku": "NOPE", "reason": "sku_not_in_catalog_rows"}])
        refused = [
            ("both modes", ["plan", "--rows", self.rows_path, "--sku", "ACC-1", "--envelope", self.env_path, "--allow-synthetic", "--out", self.base / "x1"]),
            ("neither mode", ["plan", "--rows", self.rows_path, "--out", self.base / "x2"]),
            ("synthetic without opt-in", ["plan", "--rows", self.rows_path, "--envelope", self.env_path, "--out", self.base / "x3"]),
            ("opt-in on skus", ["plan", "--rows", self.rows_path, "--sku", "ACC-1", "--allow-synthetic", "--out", self.base / "x4"]),
            ("existing output dir", ["plan", "--rows", self.rows_path, "--sku", "ACC-1", "--out", self.base / "c1"]),
            ("missing rows", ["plan", "--rows", self.base / "nope.gz", "--sku", "ACC-1", "--out", self.base / "x5"]),
            ("tampered plan", ["verify", "--plan", self.base / "tampered.json", "--out", self.base / "x6"]),
            ("bad receipts", ["verify", "--plan", self.base / "c1" / "stage1_plan.json", "--receipts", self.env_path, "--out", self.base / "x7"]),
        ]
        plan["targets"][0]["expected"]["vid"] = 1
        canon.write_json(self.base / "tampered.json", plan)
        for name, args in refused:
            with self.subTest(name):
                proc = self.run_cli(*args)
                self.assertEqual(proc.returncode, 2, proc.stdout + proc.stderr)
                self.assertNotIn("Traceback", proc.stderr)
        for leftover in ("x1", "x2", "x3", "x4", "x5", "x6", "x7"):
            self.assertFalse((self.base / leftover).exists(), leftover)

    def test_the_diff_mode_of_the_cli(self):
        diff = self.base / "diff.json"
        canon.write_json(diff, diff_doc(self.rows, DIFF_LINKS))
        proc = self.run_cli("plan", "--rows", self.rows_path, "--diff", diff, "--out", self.base / "d1")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        plan = json.loads((self.base / "d1" / "stage1_plan.json").read_text(encoding="utf-8"))
        self.assertEqual(plan["native_check_nids"], {"targets": [11, 12, 13], "source_contexts": [1, 2]})
        synthetic = self.base / "diff_syn.json"
        canon.write_json(synthetic, diff_doc(self.rows, DIFF_LINKS, synthetic=True))
        self.assertEqual(self.run_cli("plan", "--rows", self.rows_path, "--diff", synthetic, "--out", self.base / "d2").returncode, 2)
        self.assertEqual(self.run_cli("plan", "--rows", self.rows_path, "--diff", synthetic, "--allow-synthetic", "--out", self.base / "d3").returncode, 0)
        self.assertEqual(self.run_cli("plan", "--rows", self.rows_path, "--diff", diff, "--sku", "ACC-1", "--out", self.base / "d4").returncode, 2)
        self.assertFalse((self.base / "d2").exists() or (self.base / "d4").exists())

    def test_an_empty_envelope_plans_nothing(self):
        proc = self.run_cli("plan", "--rows", self.rows_path, "--envelope", self.empty_env, "--out", self.base / "e1")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads((self.base / "e1" / "stage1_plan.json").read_text(encoding="utf-8"))["native_check_nids"],
                         {"targets": [], "source_contexts": []})


@require_engine
class TestPlanFromRealEngineOutputs(unittest.TestCase):
    """The plan derived from a REAL OFF/ON engine run covers exactly the links that are new in ON (checked against the raw outputs)."""

    def test_the_plan_matches_the_links_that_are_new_in_the_real_output(self):
        from oem_intake import replay_diff
        inp, _ = sc.standard()
        pairs = [sc.edge(inp, "C-FY", "RC-9", lang=lang) for lang in ("ru", "uk")] + [sc.edge(inp, "C-FX", "BG-9", lang=lang) for lang in ("ru", "uk")] + \
                [sc.edge(inp, "S-A1", "RS-100", lang=lang, model="zeta:alpha-1") for lang in ("ru", "uk")]
        env = sc.envelope(pairs)
        off, on = inp.baseline(), inp.patched(oem_relations=env, oem_enabled=True, oem_allow_synthetic=True)
        diff = replay_diff.classify({"sources": off[0], "evidence": off[1], "metrics": off[2]}, {"sources": on[0], "evidence": on[1], "metrics": on[2]},
                                    envelope=env, rows={n: {"sku": r["sku"]} for n, r in inp.rows.items()})
        self.assertEqual(diff["result"], "PASS")
        new_links = {(int(sid), t) for sid in on[0] for t in on[0][sid]["accessories"] if t not in off[0][sid]["accessories"]}
        self.assertGreater(len(new_links), 0)
        plan = S1.plan_from_diff(diff, inp.rows, allow_synthetic=True)
        planned = {(src, t["nid"]) for t in plan["targets"] for src in t["source_nids"]}
        self.assertEqual(planned, new_links)
        self.assertEqual({s["nid"] for s in plan["source_contexts"]}, {src for src, _ in new_links})
        self.assertTrue(all(e["state"] == S1.NOT_RUN for e in plan["targets"] + plan["source_contexts"]))
        # the envelope plan is a superset (it also lists the legacy-duplicate edge RS-100 that is not a new link)
        env_plan = S1.plan_from_envelope(env, inp.rows, allow_synthetic=True)
        self.assertTrue({t["nid"] for t in plan["targets"]} < {t["nid"] for t in env_plan["targets"]})
        # complete SYNTHETIC receipts clear exactly those links
        rep = S1.check_receipts(plan, receipts_for(plan), receipts_for(plan, "source_contexts"))
        self.assertEqual((rep["summary"]["edges_total"], rep["summary"]["edges_stage1_cleared"]), (len(new_links), len(new_links)))


if __name__ == "__main__":
    unittest.main()
