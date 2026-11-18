"""S6 classifier: the complete, explained difference between the feature-OFF and the feature-ON V4.2.1 outputs. Pure functions, stdlib only.

``classify`` takes the two outputs (``sources``, ``evidence``, ``metrics`` as written by ``run_fresh_t2.py``) and explains EVERY difference:

* ``new_oem_edge``                          an accepted OEM relation reached the A tier (must match a ``published`` ledger entry);
* ``promoted_b_to_oem_a``                   the same target was a generic B_universal "may fit" edge and is now OEM-confirmed A;
* ``displaced_b_by_role_coverage``          a B edge left because the source now has an A edge of the same role (existing engine rule);
* ``displaced_b_by_limit_20``               a B edge fell off the end of the existing 20-edge limit (legacy A edges never move or leave);
* ``new_b_backfill_after_role_coverage``    a B edge entered because role coverage / promotion freed a slot under the existing max-3 B cap.

Everything else is a violation and the replay fails: a legacy A edge that disappeared, a changed V3.6 ``similar``, an edge nobody can explain,
a changed evidence record, a moved legacy edge, a ledger entry without a matching output or an output edge without a ledger entry.
Nothing here decides anything; it only reads two finished outputs.
"""
from __future__ import annotations

SCHEMA = "bp-oem-on-off-diff-v1"
OEM_REASON = "accepted_oem_relation"
LIMIT = 20
LEDGER_STATUSES = ("published", "already_present_legacy", "dropped_by_limit_20", "held")


def _targets(evidence, sid) -> dict:
    return evidence.get(sid, {}).get("targets", {})


def _tier_counts(evidence, sid) -> tuple:
    ev = evidence.get(sid)
    return (len(ev.get("A_model", [])), len(ev.get("B_universal", []))) if ev else (0, 0)


def _scope_counts(metrics) -> dict:
    out: dict = {}
    for item in metrics.get("scope_counts", []):
        out[(item["head"], item["lang"], item["metric"])] = item["value"]
    return out


def classify(off, on, *, envelope=None, gate_report=None, rows=None) -> dict:
    """Explain every OFF->ON difference. ``off`` / ``on``: ``{"sources", "evidence", "metrics"}``; ``envelope`` / ``gate_report`` /
    ``rows`` are optional enrichment and cross-checks (the envelope must be the one the ON run was given)."""
    s_off, e_off, m_off = off["sources"], off["evidence"], off["metrics"]
    s_on, e_on, m_on = on["sources"], on["evidence"], on["metrics"]
    violations: list = []
    edges: list = []

    def violate(code, sid=None, target=None, detail=None):
        violations.append({"code": code, "source_nid": None if sid is None else int(sid),
                           "target_nid": None if target is None else int(target), "detail": detail})

    def enrich(row, sid, target):
        row["source_nid"], row["target_nid"] = int(sid), int(target)
        row["lang"] = s_on.get(sid, s_off.get(sid, {})).get("language")
        row["head"] = (e_on.get(sid) or e_off.get(sid) or {}).get("head")
        if rows is not None:
            row["target_sku"] = (rows.get(int(target)) or rows.get(str(target)) or {}).get("sku")
        return row

    if set(s_off) != set(s_on):
        violate("source_set_changed", detail=f"only OFF {sorted(set(s_off) - set(s_on))[:5]}, only ON {sorted(set(s_on) - set(s_off))[:5]}")
    unchanged = changed = 0
    for sid in sorted(set(s_off) & set(s_on), key=int):
        a, b = list(s_off[sid]["accessories"]), list(s_on[sid]["accessories"])
        if s_off[sid]["similar"] != s_on[sid]["similar"]:
            violate("similar_changed", sid)
        if s_off[sid]["language"] != s_on[sid]["language"]:
            violate("language_changed", sid)
        if len(b) != len(set(b)) or len(b) > LIMIT:
            violate("accessory_list_invariant", sid, detail=f"{len(b)} entries, {len(set(b))} distinct")
        if s_off[sid] == s_on[sid] and e_off.get(sid) == e_on.get(sid):
            unchanged += 1
            continue
        changed += 1
        t_off, t_on = _targets(e_off, sid), _targets(e_on, sid)
        for t in b:
            if str(t) not in t_on:
                violate("output_edge_without_evidence", sid, t)
        added = [t for t in b if t not in a]
        removed = [t for t in a if t not in b]
        kept = [t for t in a if t in b]
        promoted, role_removed = [], []
        oem_roles: dict = {}
        for t in b:
            ev = t_on.get(str(t), {})
            if ev.get("reason") == OEM_REASON and ev.get("role"):
                oem_roles.setdefault(ev["role"], []).append(t)
        for t in kept:                                              # same edge on both sides: evidence must be unchanged, except B -> OEM A
            before, after = t_off.get(str(t), {}), t_on.get(str(t), {})
            if before == after:
                continue
            if before.get("tier") == "B_universal" and after.get("reason") == OEM_REASON:
                promoted.append(t)
                edges.append(enrich({"change": "promoted_b_to_oem_a", "reason": "the same target was a generic B_universal edge; the accepted "
                                     "OEM relation moves it to the A tier (A has precedence over B)", "relation_ids": after.get("relation_ids"),
                                     "from_tier": "B_universal", "to_tier": "A_model", "role": after.get("role")}, sid, t))
            else:
                violate("evidence_changed_for_kept_edge", sid, t, detail=f"{before.get('tier')}/{before.get('reason')} -> {after.get('tier')}/{after.get('reason')}")
        for t in added:
            ev = t_on.get(str(t), {})
            if ev.get("reason") == OEM_REASON:
                edges.append(enrich({"change": "new_oem_edge", "reason": "accepted OEM relation (verified, unconditional, exact catalog IDs); "
                                     "passed every existing locale/variant/commercial/head gate", "relation_ids": ev.get("relation_ids"),
                                     "end": ev.get("end"), "role": ev.get("role"), "relation_type": ev.get("relation_type")}, sid, t))
            elif ev.get("tier") == "B_universal":
                edges.append(enrich({"change": "new_b_backfill_after_role_coverage", "role": ev.get("role"),
                                     "reason": "a generic B edge entered because an OEM A edge covered another B role or took over a B edge, "
                                     "freeing a slot under the existing max-3 B cap"}, sid, t))
            else:
                violate("unexplained_addition", sid, t, detail=f"{ev.get('tier')}/{ev.get('reason')}")
        for t in removed:
            ev = t_off.get(str(t), {})
            if ev.get("tier") != "B_universal":
                violate("legacy_a_removed", sid, t, detail=f"{ev.get('tier')}/{ev.get('reason')}")
            elif ev.get("role") in oem_roles:
                role_removed.append(t)
                edges.append(enrich({"change": "displaced_b_by_role_coverage", "role": ev.get("role"),
                                     "reason": "existing rule: a source with an A edge of a role does not also show a B edge of that role",
                                     "caused_by_targets": oem_roles[ev["role"]]}, sid, t))
            elif len(b) == LIMIT:
                edges.append(enrich({"change": "displaced_b_by_limit_20", "role": ev.get("role"),
                                     "reason": "existing limit of 20: the new OEM A edges are inserted before the B block, so a B edge falls off the end"}, sid, t))
            else:
                violate("unexplained_removal", sid, t, detail=f"B role {ev.get('role')}, {len(b)} edges in ON")
        added_b = [t for t in added if t_on.get(str(t), {}).get("tier") == "B_universal"]
        if len(added_b) > len(role_removed) + len(promoted):
            violate("backfill_exceeds_freed_slots", sid, detail=f"{len(added_b)} added B edges, {len(role_removed) + len(promoted)} freed slots")
        legacy_off = [t for t in a if t_off.get(str(t), {}).get("tier") == "A_model"]
        if b[:len(legacy_off)] != legacy_off and not [t for t in legacy_off if t not in b]:
            violate("legacy_a_order_changed", sid, detail=f"OFF A prefix {legacy_off[:4]} vs ON {b[:4]}")
        b_off = [t for t in a if t_off.get(str(t), {}).get("tier") == "B_universal" and t in b and t not in promoted]
        b_on = [t for t in b if t in b_off]
        if b_on != b_off:
            violate("b_relative_order_changed", sid, detail=f"{b_off} vs {b_on}")
    # ---------------------------------------------------------------------------------------------------- ledger reconciliation
    oem = m_on.get("oem")
    ledger_summary = None
    if oem is not None:
        ledger = oem.get("ledger", [])
        pairs = {(e["source_nid"], e["target_nid"]) for e in ledger}
        if len(pairs) != len(ledger):
            violate("ledger_duplicate_pair")
        on_oem = {(int(sid), int(t)) for sid in s_on for t in s_on[sid]["accessories"]
                  if _targets(e_on, sid).get(str(t), {}).get("reason") == OEM_REASON}
        published = {(e["source_nid"], e["target_nid"]) for e in ledger if e["status"] == "published"}
        if on_oem != published:
            for sid, t in sorted(on_oem - published):
                violate("oem_edge_without_published_ledger_entry", sid, t)
            for sid, t in sorted(published - on_oem):
                violate("published_ledger_entry_without_output_edge", sid, t)
        for e in ledger:
            sid, t, status = str(e["source_nid"]), e["target_nid"], e["status"]
            if status not in LEDGER_STATUSES:
                violate("ledger_unknown_status", sid, t, detail=status)
            elif status == "already_present_legacy" and not (t in s_off.get(sid, {}).get("accessories", []) and t in s_on.get(sid, {}).get("accessories", [])):
                violate("already_present_but_not_in_both_outputs", sid, t)
            elif status == "dropped_by_limit_20" and (t in s_on.get(sid, {}).get("accessories", []) or len(s_on.get(sid, {}).get("accessories", [])) != LIMIT):
                violate("dropped_by_limit_but_output_has_room_or_edge", sid, t)
            elif status == "held" and _targets(e_on, sid).get(str(t), {}).get("reason") == OEM_REASON:
                violate("held_edge_present_as_oem", sid, t)
            if status in ("held", "dropped_by_limit_20", "already_present_legacy"):
                edges.append(enrich({"change": "oem_edge_" + status, "reason": e.get("reason") or status, "relation_ids": e.get("relation_ids")},
                                    sid, t))
        counted = {k: sum(1 for e in ledger if e["status"] == k) for k in LEDGER_STATUSES}
        for key in LEDGER_STATUSES:
            if oem.get(key, oem.get("held") if key == "held" else None) != counted[key]:
                violate("ledger_summary_mismatch", detail=f"{key}: summary {oem.get(key)} vs ledger {counted[key]}")
        if m_on.get("edges", {}).get("A_oem_relation") != counted["published"]:
            violate("metric_mismatch", detail=f"edges.A_oem_relation {m_on.get('edges', {}).get('A_oem_relation')} vs published {counted['published']}")
        if oem.get("edges_in") != len(ledger):
            violate("ledger_summary_mismatch", detail=f"edges_in {oem.get('edges_in')} vs ledger {len(ledger)}")
        if envelope is not None:
            env_pairs = {(int(src), e["target_nid"]) for src, items in envelope["edges"].items() for e in items}
            if env_pairs != pairs:
                violate("envelope_and_ledger_differ", detail=f"{len(env_pairs ^ pairs)} pairs differ")
        ledger_summary = {**counted, "edges_in": oem.get("edges_in"), "held_by_reason": oem.get("held_by_reason", {})}
    elif any(e_on.get(sid, {}).get("targets") and any(v.get("reason") == OEM_REASON for v in e_on[sid]["targets"].values()) for sid in e_on):
        violate("oem_edges_without_oem_metrics")
    # ------------------------------------------------------------------------------------------------------------ link reconciliation
    links = None
    c_off, c_on = _scope_counts(m_off), _scope_counts(m_on)
    if c_off and c_on:
        expected: dict = {}
        for sid in set(s_off) & set(s_on):
            head = (e_on.get(sid) or e_off.get(sid) or {}).get("head")
            lang = s_on[sid]["language"]
            if not head:
                continue
            a_off, b_off = _tier_counts(e_off, sid)
            a_on, b_on = _tier_counts(e_on, sid)
            for metric, delta in (("A_edges", a_on - a_off), ("B_edges", b_on - b_off), ("T2_edges", len(s_on[sid]["accessories"]) - len(s_off[sid]["accessories"]))):
                if delta:
                    expected[(head, lang, metric)] = expected.get((head, lang, metric), 0) + delta
        actual = {k: c_on.get(k, 0) - c_off.get(k, 0) for k in set(c_off) | set(c_on) if k[2] in ("A_edges", "B_edges", "T2_edges")}
        actual = {k: v for k, v in actual.items() if v}
        if expected != actual:
            violate("link_counts_do_not_reconcile", detail=f"expected {sorted(expected.items())[:6]} actual {sorted(actual.items())[:6]}")
        heads: dict = {}
        for (head, lang, metric), value in sorted(c_off.items()):
            if metric == "T2_edges":
                row = heads.setdefault(head, {"off": 0, "on": 0})
                row["off"] += value
                row["on"] += c_on.get((head, lang, metric), 0)
        total = {"off": sum(r["off"] for r in heads.values()), "on": sum(r["on"] for r in heads.values())}
        links = {"t2_edges_by_head": {h: {**r, "delta": r["on"] - r["off"]} for h, r in sorted(heads.items())},
                 "t2_edges_total": {**total, "delta": total["on"] - total["off"]},
                 "delta_by_head_lang_metric": [{"head": k[0], "lang": k[1], "metric": k[2], "delta": v} for k, v in sorted(actual.items())],
                 "reconciled_with_edge_classification": expected == actual}
    # --------------------------------------------------------------------------------------------------------------- per-relation view
    relations = None
    if gate_report is not None:
        by_rel: dict = {}
        if oem is not None:
            for e in oem.get("ledger", []):
                for rid in e.get("relation_ids", []):
                    row = by_rel.setdefault(rid, {k: 0 for k in LEDGER_STATUSES})
                    row[e["status"]] += 1
        relations = []
        for r in gate_report["relations"]:
            if r["decision"] == "HOLD":
                relations.append({"relation_id": r["relation_id"], "outcome": "held_by_gate", "reasons": r["reasons"],
                                  "effective_state": r["effective_state"], "edges_in_envelope": 0})
            else:
                counts = by_rel.get(r["relation_id"], {k: 0 for k in LEDGER_STATUSES})
                if sum(counts.values()) != r["edges_accepted"] and oem is not None and envelope is not None:
                    violate("relation_edges_do_not_reconcile", detail=f"{r['relation_id']}: gate {r['edges_accepted']} vs ledger {sum(counts.values())}")
                relations.append({"relation_id": r["relation_id"], "outcome": "accepted", "reasons": [], "effective_state": r["effective_state"],
                                  "edges_in_envelope": r["edges_accepted"], "ledger": counts})
        pair_status = {(int(sid), t): "present" for sid in s_off for t in s_off[sid]["accessories"]}
        veto = []
        for p in gate_report["veto_report"]["pairs"]:
            key = (p["source_nid"], p["target_nid"])
            was = key in pair_status
            now = p["target_nid"] in s_on.get(str(p["source_nid"]), {}).get("accessories", [])
            veto.append({"relation_id": p["relation_id"], "kind": p["kind"], "source_nid": key[0], "target_nid": key[1],
                         "in_off_output": was, "in_on_output": now, "outcome": ("kept_report_only" if was and now else
                                                                              "absent_in_both" if not was and not now else
                                                                              "removed_with_feature_on_see_displacement" if was else "added_with_feature_on")})
        relations = {"relations": relations, "veto_vs_output": {"mode": "report_only", "enforced": False, "pairs": veto,
                                                               "present_in_off_output": sum(1 for v in veto if v["in_off_output"]),
                                                               "kept_with_feature_on": sum(1 for v in veto if v["outcome"] == "kept_report_only")}}
    counts_by_change: dict = {}
    for row in edges:
        counts_by_change[row["change"]] = counts_by_change.get(row["change"], 0) + 1
    edges.sort(key=lambda r: (r["source_nid"], r["target_nid"], r["change"]))
    violations.sort(key=lambda v: (v["code"], v["source_nid"] or 0, v["target_nid"] or 0))
    return {"schema": SCHEMA, "result": "PASS" if not violations else "FAIL",
            "sources": {"total": len(s_off), "changed": changed, "unchanged": unchanged},
            "counts_by_change": dict(sorted(counts_by_change.items())), "violations": violations,
            "invariants_checked": ["similar identical for every source", "accessory lists unique and at most 20", "no legacy A edge removed or moved",
                                   "every removed edge explained by role coverage or the limit of 20", "every added edge explained",
                                   "kept edges keep their evidence (except B -> OEM A promotion)", "ledger <-> output edges 1:1",
                                   "link counts reconcile with the edge classification"],
            "ledger": ledger_summary, "links": links, "edges": edges, "relations_and_veto": relations}
