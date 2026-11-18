"""Seeded pseudo-random invariants of the seam on the REAL V4.2.1 engine: many generated catalogs, many generated (explicitly SYNTHETIC) envelopes.

Everything here is recomputed from the raw OFF/ON outputs without using ``oem_intake.replay_diff``, and the classifier is then required to agree
(PASS, no violation). No Hypothesis here: the seeds are fixed, so a failure is reproducible by its seed (reported in the message). The same
``check_run`` is reused by ``test_properties.py`` with Hypothesis-drawn seeds (test-only dependency, skipped loudly when absent).
Invariants for every source of every generated run, however the envelope was drawn (valid edges, locale mismatches, wrong domains, duplicates of
legacy edges, edges to sources outside the head):
  1. ``similar`` is identical to OFF; the source set and each language are identical.
  2. The ON list has no duplicate and at most 20 entries.
  3. Every legacy A edge of OFF is still there, in the same relative order, with byte-identical evidence.
  4. Only four kinds of difference exist: a NEW OEM edge (``A_model`` / ``accepted_oem_relation``), a PROMOTION of an edge OFF had as
     ``B_universal`` to that A edge, a DISPLACEMENT of an OFF ``B_universal`` edge (its role is now covered by an A edge) and a BACKFILL (a new
     ``B_universal`` edge, only possible into a slot the two previous kinds freed; at most 3 B edges stay in any list).
  5. A legacy A edge is never removed or replaced by an OEM edge; every other OFF edge keeps byte-identical evidence.
  6. The ledger has exactly one entry per envelope edge, and its status agrees with the output (published => present, an OFF edge only when
     it was B_universal; dropped_by_limit_20 => absent; already_present_legacy => present in OFF too; held => the list did not change for it).
  7. With an envelope of zero edges ON equals OFF in sources and evidence.
  8. The Stage1 plan derived from the classifier's diff lists exactly the links that are new in ON (recomputed here from the raw outputs).
"""
from __future__ import annotations

import json
import random
import unittest

from tests import catalog_fixture as cf, scenarios as sc
from tests.helpers import require_engine
from oem_intake import replay_diff, stage1
from oem_stage import canon

WORDS = ("дождевик", "москитная сетка", "чехол", "вкладыш", "подстаканник", "сумка")
SEEDS = range(14)
COUNTERS = ("displaced", "published", "dropped", "held", "promoted", "backfilled", "new_a")


def generate(seed):
    small = seed % 3 == 0                                           # few models and many accessories: lists near the limit of 20
    cat = cf.stress_catalog(seed, seats=3 if small else 6, strollers=3 if small else 6, accessories=100 if small else 30)
    rnd = random.Random(1000 + seed)
    for n, word in enumerate(WORDS[:4]):
        cat.stroller_accessory(f"Универсальный {word} UN-{n} для всех колясок", f"Універсальний {word} UN-{n} для всіх візків", f"UN-{n}",
                               brand=cf.THIRD_BRAND)
    for n in range(14):                                             # no model in the title: the legacy engine cannot match these
        word = rnd.choice(WORDS)
        make = cat.seat_accessory if n % 2 else cat.stroller_accessory
        make(f"Nova {word} OEM-{n}", f"Nova {word} OEM-{n}", f"OEM-{n}", brand=cf.THIRD_BRAND)
    inp = cat.finish()
    accessories = [r for r in inp.rows.values() if r["sku"].startswith(("ACC-", "OEM-", "UN-"))]
    pairs = []
    for sid in sorted(int(n) for n in inp.scope):
        lang = inp.rows[sid]["lang"]
        same = sorted(r["nid"] for r in accessories if r["lang"] == lang)
        other = sorted(r["nid"] for r in accessories if r["lang"] != lang)
        chosen = rnd.sample(same, min(rnd.randint(0, 6), len(same)))
        if other and rnd.random() < 0.2:
            chosen.append(rnd.choice(other))                        # locale mismatch: the engine must hold it
        pairs += [(sid, sc.edge_for(inp.rows, t, lang=lang)) for t in chosen]
    return inp, pairs


def check_run(case, msg, inp, pairs) -> dict:
    """OFF and ON for one generated catalog/envelope: assert every invariant and the classifier's agreement; return how often each path was taken."""
    c = dict.fromkeys(COUNTERS, 0)
    env = sc.envelope(pairs)
    off, on = inp.baseline(), inp.patched(oem_relations=env, oem_enabled=True, oem_allow_synthetic=True)
    (s_off, e_off, m_off), (s_on, e_on, m_on) = off, on
    case.assertEqual(set(s_off), set(s_on), msg)
    for sid in s_off:
        a, b = s_off[sid]["accessories"], s_on[sid]["accessories"]
        case.assertEqual(s_on[sid]["similar"], s_off[sid]["similar"], f"{msg} source {sid}: similar changed")
        case.assertEqual(s_on[sid]["language"], s_off[sid]["language"], msg)
        case.assertEqual((len(b) == len(set(b)), len(b) <= 20), (True, True), f"{msg} source {sid}: {len(b)} entries")
        ev_off, ev_on = e_off.get(sid, {}).get("targets", {}), e_on.get(sid, {}).get("targets", {})
        legacy_a = [t for t in a if ev_off[str(t)].get("tier") == "A_model"]
        case.assertEqual([t for t in b if t in legacy_a], legacy_a, f"{msg} source {sid}: legacy A edge lost or reordered")
        for t in legacy_a:
            case.assertEqual(canon.canonical_json(ev_on[str(t)]), canon.canonical_json(ev_off[str(t)]), msg)
        new_b = removed_b = promoted_here = 0
        for t in b:
            was, now = ev_off.get(str(t)), ev_on[str(t)]
            if t not in a:
                if now.get("tier") == "A_model":
                    c["new_a"] += 1
                    case.assertEqual(now["reason"], "accepted_oem_relation", f"{msg} source {sid} target {t}")
                else:
                    c["backfilled"] += 1
                    new_b += 1
                    case.assertEqual(now.get("tier"), "B_universal", f"{msg} source {sid} target {t}")
            elif was.get("tier") == "B_universal" and now.get("tier") == "A_model":
                c["promoted"] += 1
                promoted_here += 1
                case.assertEqual(now["reason"], "accepted_oem_relation", f"{msg} source {sid} target {t}")
            else:
                case.assertEqual(canon.canonical_json(now), canon.canonical_json(was), f"{msg} source {sid} target {t}: evidence changed")
        for t in a:
            if t not in b:
                c["displaced"] += 1
                removed_b += 1
                case.assertEqual(ev_off[str(t)].get("tier"), "B_universal", f"{msg} source {sid}: a non-B edge {t} was removed")
        case.assertLessEqual(new_b, removed_b + promoted_here, f"{msg} source {sid}: a backfill without a freed slot")
        case.assertLessEqual(sum(1 for t in b if ev_on[str(t)].get("tier") == "B_universal"), 3, f"{msg} source {sid}: more than 3 B edges")
    ledger = m_on["oem"]["ledger"]
    case.assertEqual(len(ledger), len(pairs), msg)
    case.assertEqual({(e["source_nid"], e["target_nid"]) for e in ledger}, {(s, e["target_nid"]) for s, e in pairs}, msg)
    for entry in ledger:
        sid, tid = str(entry["source_nid"]), entry["target_nid"]
        in_off, in_on = tid in s_off[sid]["accessories"], tid in s_on[sid]["accessories"]
        status = entry["status"]
        case.assertIn(status, ("published", "dropped_by_limit_20", "already_present_legacy", "held"), msg)
        if status == "published":
            c["published"] += 1
            was_b = in_off and e_off[sid]["targets"][str(tid)].get("tier") == "B_universal"
            case.assertTrue(in_on and (not in_off or was_b), f"{msg} {entry}")
            case.assertEqual(e_on[sid]["targets"][str(tid)]["tier"], "A_model", f"{msg} {entry}")
        elif status == "dropped_by_limit_20":
            c["dropped"] += 1
            case.assertFalse(in_on, f"{msg} {entry}")
        elif status == "already_present_legacy":
            case.assertTrue(in_off and in_on, f"{msg} {entry}")
        else:
            c["held"] += 1
            case.assertTrue(entry["reason"], f"{msg} {entry}")
            case.assertEqual(in_on, in_off, f"{msg} a held edge changed the list: {entry}")
    rows = {nid: {"sku": r["sku"]} for nid, r in inp.rows.items()}
    diff = replay_diff.classify({"sources": s_off, "evidence": e_off, "metrics": m_off}, {"sources": s_on, "evidence": e_on, "metrics": m_on},
                                envelope=env, rows=rows)
    case.assertEqual((diff["result"], diff["violations"]), ("PASS", []), msg)
    new_links = {(int(sid), t) for sid in s_on for t in s_on[sid]["accessories"] if t not in s_off[sid]["accessories"]}
    plan = stage1.plan_from_diff(diff, inp.rows, allow_synthetic=True)
    case.assertEqual({(src, t["nid"]) for t in plan["targets"] for src in t["source_nids"]}, new_links, f"{msg}: Stage1 plan vs new links")
    return c


@require_engine
class TestRandomizedInvariants(unittest.TestCase):
    def test_invariants_hold_for_generated_catalogs_and_envelopes(self):
        total = dict.fromkeys(COUNTERS, 0)
        for seed in SEEDS:
            with self.subTest(seed=seed):
                inp, pairs = generate(seed)
                for key, value in check_run(self, f"seed {seed}", inp, pairs).items():
                    total[key] += value
        # the generated runs must really have exercised the interesting paths, otherwise this test proves nothing
        self.assertGreater(total["published"], 20)
        self.assertGreater(total["new_a"], 20)
        self.assertGreater(total["displaced"], 0)
        self.assertGreater(total["backfilled"], 0)
        self.assertGreater(total["promoted"], 0)
        self.assertGreater(total["held"], 5)
        self.assertGreater(total["dropped"], 0, "no generated run reached the limit of 20: enlarge the small catalogs")

    def test_an_envelope_of_zero_edges_changes_nothing_on_generated_catalogs(self):
        for seed in SEEDS:
            with self.subTest(seed=seed):
                inp, _ = generate(seed)
                off = inp.baseline()
                on = inp.patched(oem_relations=sc.envelope([], synthetic=False), oem_enabled=True)
                self.assertEqual(canon.canonical_json([on[0], on[1]]), canon.canonical_json([off[0], off[1]]), f"seed {seed}")
                self.assertEqual(on[2]["oem"]["edges_in"], 0)

    def test_the_run_is_reproducible(self):
        inp, pairs = generate(3)
        env = sc.envelope(pairs)
        first = cf.normalize(inp.patched(oem_relations=env, oem_enabled=True, oem_allow_synthetic=True))
        again, pairs2 = generate(3)
        self.assertEqual(json.dumps(pairs, sort_keys=True), json.dumps(pairs2, sort_keys=True))
        self.assertEqual(first, cf.normalize(again.patched(oem_relations=sc.envelope(pairs2), oem_enabled=True, oem_allow_synthetic=True)))


if __name__ == "__main__":
    unittest.main()
