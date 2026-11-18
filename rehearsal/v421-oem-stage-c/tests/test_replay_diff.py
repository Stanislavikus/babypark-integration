"""S6 classifier on REAL V4.2.1 outputs (fictional catalogs): every OFF->ON difference gets a reason, every impossible difference is a violation.

Each displacement kind is produced by the real engine (role coverage, promotion, backfill, limit 20); the violation tests then corrupt a real ON output
and require the classifier to name exactly what is wrong.
"""
from __future__ import annotations

import copy
import json
import unittest

from tests import catalog_fixture as cf
from tests import scenarios as sc
from tests.helpers import baseline, require_engine
from oem_intake import replay_diff as R

ON = {"oem_enabled": True, "oem_allow_synthetic": True}


def jround(obj):
    return json.loads(json.dumps(obj, ensure_ascii=False))


def with_scope_counts(inp, result):
    """Add ``metrics["scope_counts"]`` exactly as run_fresh_t2.py computes its T2/A/B edge counts per head and locale."""
    sources, evidence, metrics = result
    v4, counts = baseline(), {}
    for sid, record in sources.items():
        row = inp.rows[int(sid)]
        head = v4.source_head(row, inp.policy)
        if not head:
            continue
        key = (head, row["lang"])
        counts[key + ("T2_edges",)] = counts.get(key + ("T2_edges",), 0) + len(record["accessories"])
        for tid in record["accessories"]:
            tier = evidence.get(sid, {}).get("targets", {}).get(str(tid), {}).get("tier")
            metric = "A_edges" if tier == "A_model" else "B_edges"
            counts[key + (metric,)] = counts.get(key + (metric,), 0) + 1
    metrics = dict(metrics)
    metrics["scope_counts"] = [{"head": k[0], "lang": k[1], "metric": k[2], "value": v} for k, v in sorted(counts.items())]
    return sources, evidence, metrics


def pack(result):
    sources, evidence, metrics = jround(result)
    metrics.pop("elapsed_seconds", None)
    return {"sources": sources, "evidence": evidence, "metrics": metrics}


def both_locales(inp, source, target, **kw):
    return [sc.edge(inp, source, target, lang=lang, **kw) for lang in cf.LANGS]


def run_pair(inp, pairs):
    env = sc.envelope(pairs)
    off = pack(with_scope_counts(inp, inp.baseline()))
    on = pack(with_scope_counts(inp, inp.patched(oem_relations=env, **ON)))
    return off, on, env


def codes(report):
    return sorted({v["code"] for v in report["violations"]})


@require_engine
class TestEveryDifferenceIsExplained(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inp, cls.cat = sc.standard()

    def sku(self, nid):
        return self.inp.rows[nid]["sku"]

    def test_an_empty_envelope_changes_nothing(self):
        off, on, env = run_pair(self.inp, [])
        report = R.classify(off, on, envelope=env)
        self.assertEqual((report["result"], report["sources"]["changed"], report["edges"], report["violations"]), ("PASS", 0, [], []))
        self.assertEqual(report["ledger"]["edges_in"], 0)
        self.assertEqual(report["links"]["t2_edges_total"]["delta"], 0)
        self.assertEqual(off["sources"], on["sources"])                                   # byte-identical output sections (manifest side)
        self.assertEqual(off["evidence"], on["evidence"])

    def test_a_new_edge_displaces_the_generic_b_edge_of_the_same_role(self):
        off, on, env = run_pair(self.inp, both_locales(self.inp, "C-FY", "RC-9"))
        report = R.classify(off, on, envelope=env, rows=self.inp.rows)
        self.assertEqual((report["result"], report["violations"]), ("PASS", []), report["violations"])
        kinds = {(e["change"], e["target_sku"], e["lang"]) for e in report["edges"]}
        self.assertEqual(kinds, {("new_oem_edge", "RC-9", "ru"), ("new_oem_edge", "RC-9", "uk"),
                                 ("displaced_b_by_role_coverage", "UN-1", "ru"), ("displaced_b_by_role_coverage", "UN-1", "uk")})
        for e in report["edges"]:
            if e["change"] == "displaced_b_by_role_coverage":
                self.assertEqual((e["role"], e["caused_by_targets"]), ("rain_cover", [self.cat.nid("RC-9", e["lang"])]))
        self.assertEqual(report["sources"]["changed"], 2)
        self.assertEqual(report["links"]["t2_edges_by_head"]["stroller"], {"off": 12, "on": 12, "delta": 0})       # one in, one out per locale
        self.assertTrue(report["links"]["reconciled_with_edge_classification"])
        self.assertEqual(report["ledger"]["published"], 2)

    def test_the_same_target_moving_from_b_to_a_is_a_promotion_not_a_new_edge(self):
        off, on, env = run_pair(self.inp, both_locales(self.inp, "C-FY", "UN-2"))
        report = R.classify(off, on, envelope=env, rows=self.inp.rows)
        self.assertEqual((report["result"], report["violations"]), ("PASS", []))
        self.assertEqual(sorted(e["change"] for e in report["edges"]), ["promoted_b_to_oem_a"] * 2)
        self.assertEqual(report["links"]["t2_edges_total"]["delta"], 0)                   # the edge was already there: A + 1, B - 1
        by = {(r["head"], r["lang"], r["metric"]): r["delta"] for r in report["links"]["delta_by_head_lang_metric"]}
        self.assertEqual((by[("stroller", "ru", "A_edges")], by[("stroller", "ru", "B_edges")]), (1, -1))

    def test_an_edge_the_engine_already_had_is_listed_as_already_present_and_changes_nothing(self):
        off, on, env = run_pair(self.inp, both_locales(self.inp, "S-A1", "RS-100", model="zeta:alpha-1"))
        report = R.classify(off, on, envelope=env)
        self.assertEqual((report["result"], report["sources"]["changed"]), ("PASS", 0))
        self.assertEqual({e["change"] for e in report["edges"]}, {"oem_edge_already_present_legacy"})
        self.assertEqual(report["ledger"]["already_present_legacy"], 2)

    def test_edges_held_by_a_current_engine_gate_are_listed_with_the_reason(self):
        pairs = [*both_locales(self.inp, "C-FX", "KIT-1"), *both_locales(self.inp, "C-FX", "FS3-1")]
        off, on, env = run_pair(self.inp, pairs)
        report = R.classify(off, on, envelope=env)
        self.assertEqual((report["result"], report["sources"]["changed"]), ("PASS", 0))
        self.assertEqual({(e["change"], e["reason"]) for e in report["edges"]},
                         {("oem_edge_held", "product_kit_excluded"), ("oem_edge_held", "target_not_purchasable")})

    def test_a_slot_freed_under_the_max_3_b_cap_is_filled_by_the_next_generic_edge(self):
        cat = cf.Catalog()
        cat.stroller("Frame Y", "C-FY")
        for sku, ru, uk in (("UN-1", "Универсальный дождевик UN-1 для всех колясок", "Універсальний дощовик UN-1 для всіх візків"),
                            ("UN-2", "Универсальный подстаканник UN-2 для всех колясок", "Універсальний підсклянник UN-2 для всіх візків"),
                            ("UN-3", "Универсальная москитная сетка UN-3 для всех колясок", "Універсальна москітна сітка UN-3 для всіх візків"),
                            ("UN-4", "Универсальная сумка UN-4 для всех колясок", "Універсальна сумка UN-4 для всіх візків")):
            cat.stroller_accessory(ru, uk, sku, brand=cf.THIRD_BRAND)
        cat.stroller_accessory("Acme дождевик RC-9", "Acme дощовик RC-9", "RC-9")
        inp = cat.finish()
        before = {inp.rows[t]["sku"] for t in inp.baseline()[0][str(cat.nid("C-FY"))]["accessories"]}
        self.assertEqual(before, {"UN-4", "UN-2", "UN-1"})                                 # max 3 roles: bag, cup holder, rain cover (net cut)
        off, on, env = run_pair(inp, both_locales(inp, "C-FY", "RC-9"))
        report = R.classify(off, on, envelope=env, rows=inp.rows)
        self.assertEqual((report["result"], report["violations"]), ("PASS", []), report["violations"])
        self.assertEqual({(e["change"], e["target_sku"]) for e in report["edges"]},
                         {("new_oem_edge", "RC-9"), ("displaced_b_by_role_coverage", "UN-1"), ("new_b_backfill_after_role_coverage", "UN-3")})

    def test_the_limit_of_20_pushes_a_trailing_b_edge_out_and_never_a_legacy_a_edge(self):
        cat = cf.Catalog()
        cat.stroller("Frame Z", "C-FZ")
        for n in range(17):
            cat.stroller_accessory(f"Acme чехол LZ-{n:02d} для коляски Acme Frame Z", f"Acme чохол LZ-{n:02d} для візка Acme Frame Z", f"LZ-{n:02d}")
        for sku, ru, uk in (("UN-1", "Универсальный дождевик UN-1 для всех колясок", "Універсальний дощовик UN-1 для всіх візків"),
                            ("UN-2", "Универсальный подстаканник UN-2 для всех колясок", "Універсальний підсклянник UN-2 для всіх візків"),
                            ("UN-4", "Универсальная сумка UN-4 для всех колясок", "Універсальна сумка UN-4 для всіх візків")):
            cat.stroller_accessory(ru, uk, sku, brand=cf.THIRD_BRAND)
        cat.stroller_accessory("Acme москитная сетка OZ-1", "Acme москітна сітка OZ-1", "OZ-1")
        inp = cat.finish()
        base = inp.baseline()
        self.assertEqual(len(base[0][str(cat.nid("C-FZ"))]["accessories"]), 20)            # 17 legacy A + 3 B
        off, on, env = run_pair(inp, both_locales(inp, "C-FZ", "OZ-1"))
        report = R.classify(off, on, envelope=env, rows=inp.rows)
        self.assertEqual((report["result"], report["violations"]), ("PASS", []), report["violations"])
        self.assertEqual(sorted(e["change"] for e in report["edges"]), ["displaced_b_by_limit_20"] * 2 + ["new_oem_edge"] * 2)
        legacy = base[0][str(cat.nid("C-FZ"))]["accessories"][:17]
        self.assertEqual(on["sources"][str(cat.nid("C-FZ"))]["accessories"][:17], legacy)  # the 17 legacy edges are first, in order, untouched

    def test_the_links_of_every_head_reconcile_arithmetically(self):
        off, on, env = run_pair(self.inp, [*both_locales(self.inp, "C-FY", "RC-9"), *both_locales(self.inp, "C-FX", "BG-9"),
                                           *both_locales(self.inp, "S-B1", "SC-5", model="zeta:beta-1")])
        report = R.classify(off, on, envelope=env)
        self.assertEqual(report["result"], "PASS", report["violations"])
        links = report["links"]
        self.assertTrue(links["reconciled_with_edge_classification"])
        self.assertEqual(links["t2_edges_total"]["on"] - links["t2_edges_total"]["off"], links["t2_edges_total"]["delta"])
        published = report["counts_by_change"].get("new_oem_edge", 0)
        displaced = sum(v for k, v in report["counts_by_change"].items() if k.startswith("displaced_"))
        backfilled = report["counts_by_change"].get("new_b_backfill_after_role_coverage", 0)
        self.assertEqual(links["t2_edges_total"]["delta"], published - displaced + backfilled)

    def test_the_veto_view_is_report_only_and_keeps_every_current_edge(self):
        off, on, env = run_pair(self.inp, both_locales(self.inp, "C-FY", "RC-9"))
        gate_report = {"relations": [{"relation_id": "rel:0000000000000001", "decision": "ACCEPT", "effective_state": "LISTED", "reasons": [],
                                      "edges_accepted": 2},
                                     {"relation_id": "rel:00000000000000ee", "decision": "HOLD", "effective_state": "UNKNOWN",
                                      "reasons": ["state_unknown"], "edges_accepted": 0}],
                       "veto_report": {"pairs": [{"relation_id": "rel:00000000000000dd", "kind": "veto_candidate",
                                                  "source_nid": self.cat.nid("C-FX"), "target_nid": self.cat.nid("RC-1")}]}}
        report = R.classify(off, on, envelope=env, gate_report=gate_report)
        view = report["relations_and_veto"]
        self.assertEqual([r["outcome"] for r in view["relations"]], ["accepted", "held_by_gate"])
        self.assertEqual(view["relations"][0]["ledger"]["published"], 2)
        self.assertEqual((view["veto_vs_output"]["enforced"], view["veto_vs_output"]["mode"]), (False, "report_only"))
        self.assertEqual(view["veto_vs_output"]["pairs"][0]["outcome"], "kept_report_only")       # the legacy RC-1 for Frame X stays


@require_engine
class TestViolationsAreNamed(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inp, cls.cat = sc.standard()
        cls.off, cls.on, cls.env = run_pair(cls.inp, [*both_locales(cls.inp, "C-FY", "RC-9"), *both_locales(cls.inp, "S-A1", "RS-100", model="zeta:alpha-1")])
        cls.fx = str(cls.cat.nid("C-FX"))
        cls.fy = str(cls.cat.nid("C-FY"))

    def corrupted(self, edit):
        on = copy.deepcopy(self.on)
        edit(on)
        return R.classify(self.off, on, envelope=self.env)

    def test_the_uncorrupted_run_passes(self):
        self.assertEqual(R.classify(self.off, self.on, envelope=self.env)["result"], "PASS")

    def test_a_removed_legacy_a_edge_fails(self):
        def edit(on):
            gone = on["sources"][self.fx]["accessories"].pop(0)
            on["evidence"][self.fx]["targets"].pop(str(gone))
            on["evidence"][self.fx]["A_model"].remove(gone)
        self.assertIn("legacy_a_removed", codes(self.corrupted(edit)))

    def test_a_changed_v36_similar_fails(self):
        self.assertIn("similar_changed", codes(self.corrupted(lambda on: on["sources"][self.fx]["similar"].append(1))))

    def test_an_unexplained_added_or_removed_edge_fails(self):
        def add(on):
            on["sources"][self.fx]["accessories"].append(self.cat.nid("BG-9"))
            on["evidence"][self.fx]["targets"][str(self.cat.nid("BG-9"))] = {"tier": "A_model", "reason": "accepted_model_title"}
        self.assertIn("unexplained_addition", codes(self.corrupted(add)))

        def drop_b(on):                                                     # a B edge disappears although no OEM edge covers its role
            ids = on["sources"][self.fx]["accessories"]
            b_target = next(t for t in ids if on["evidence"][self.fx]["targets"][str(t)]["tier"] == "B_universal")
            ids.remove(b_target)
            on["evidence"][self.fx]["targets"].pop(str(b_target))
            on["evidence"][self.fx]["B_universal"].remove(b_target)
        self.assertIn("unexplained_removal", codes(self.corrupted(drop_b)))

    def test_changed_evidence_of_a_kept_edge_fails(self):
        def edit(on):
            first = next(iter(on["evidence"][self.fx]["targets"]))
            on["evidence"][self.fx]["targets"][first] = {"tier": "A_model", "reason": "accepted_oem_relation"}
        self.assertIn("evidence_changed_for_kept_edge", codes(self.corrupted(edit)))

    def test_a_moved_legacy_edge_fails(self):
        def edit(on):
            on["sources"][self.fx]["accessories"][:2] = on["sources"][self.fx]["accessories"][:2][::-1]
        self.assertIn("legacy_a_order_changed", codes(self.corrupted(edit)))

    def test_ledger_and_output_must_agree_edge_for_edge(self):
        def forget(on):
            on["metrics"]["oem"]["ledger"] = [e for e in on["metrics"]["oem"]["ledger"] if e["status"] != "published"]
        self.assertIn("oem_edge_without_published_ledger_entry", codes(self.corrupted(forget)))

        def ghost(on):
            on["metrics"]["oem"]["ledger"].append({"source_nid": 1, "target_nid": 2, "relation_ids": ["rel:x"], "status": "published", "reason": None})
        self.assertIn("published_ledger_entry_without_output_edge", codes(self.corrupted(ghost)))

        def count(on):
            on["metrics"]["edges"]["A_oem_relation"] += 1
        self.assertIn("metric_mismatch", codes(self.corrupted(count)))

        def drift(on):
            on["metrics"]["oem"]["published"] += 1
        self.assertIn("ledger_summary_mismatch", codes(self.corrupted(drift)))

    def test_link_counts_that_do_not_reconcile_fail(self):
        def edit(on):
            row = next(r for r in on["metrics"]["scope_counts"] if r["metric"] == "T2_edges" and r["head"] == "stroller")
            row["value"] += 1
        self.assertIn("link_counts_do_not_reconcile", codes(self.corrupted(edit)))

    def test_oem_edges_without_oem_metrics_and_a_changed_source_set_fail(self):
        self.assertIn("oem_edges_without_oem_metrics", codes(self.corrupted(lambda on: on["metrics"].pop("oem"))))
        self.assertIn("source_set_changed", codes(self.corrupted(lambda on: on["sources"].pop(self.fy))))

    def test_a_different_envelope_than_the_one_the_run_used_fails(self):
        other = sc.envelope([sc.edge(self.inp, "C-FX", "BG-9")])
        self.assertIn("envelope_and_ledger_differ", codes(R.classify(self.off, self.on, envelope=other)))


if __name__ == "__main__":
    unittest.main()
