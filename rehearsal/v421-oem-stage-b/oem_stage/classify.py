"""Classification of the PR #167 seed cases under the Stage B contract.

Shadow only: nothing here recommends or publishes anything. Every case gets a closed-set ``verdict`` plus the full
list of ``hold_reasons`` so a reviewer can see exactly which gate holds it. PR #167's recorded expectations are shown
next to the Stage B result and are never silently adopted: where Stage B is stricter the case says so.
"""
from __future__ import annotations

from . import conditions as cd, seed_convert
from .o3_articles import norm_mpn
from .o4_relations import RelationIndex
from .shadow import CatalogView

VERDICTS = ("CONFLICT_HOLD", "EXCLUDED_VETO_CANDIDATE", "EXCLUDED_PENDING_VERIFICATION", "UNKNOWN_NOT_LISTED",
            "HOLD_CATALOG_IDENTITY", "HOLD_ARTICLE_BINDING", "HOLD_UNVERIFIED_EVIDENCE", "HELD_BY_POLICY",
            "ELIGIBLE_SHADOW_CANDIDATE")
_ART_REASON = "article:"


# ---------------------------------------------------------------------------------------------- catalog side
def build_seed_view(seed_cases, registry) -> tuple:
    """CatalogView of the fixture rows (PR #167 NIDs/SKUs) joined through the strict registry.

    Returns ``(view, groups)`` where ``groups[tnid]`` is the catalog identity resolution of that source group.
    """
    view, groups, seen = CatalogView(), {}, set()
    src_groups: dict = {}
    for p in seed_cases["positives"]:
        s = p["source"]
        g = src_groups.setdefault(int(s["tnid"]), {"brand": s["brand"], "models": {}, "nids": {}})
        g["models"][p["lang"]] = s["catalog_model_string"]
        g["nids"][p["lang"]] = int(s["nid"])
        t = p["target"]
        if int(t["nid"]) not in seen:
            seen.add(int(t["nid"]))
            view.add_target(t["sku"], t["nid"], t["tnid"], p["lang"], t["field_status"], t["published"], t["price"])
    for h in seed_cases["holdouts"]:
        g = src_groups.setdefault(int(h["source_tnid"]), {"brand": h["source_brand_assumed"], "models": {}, "nids": {}})
        for lang, nid in h["source_nids"].items():
            g["models"][lang] = h["source_catalog_model_string"]
            g["nids"][lang] = int(nid)
        field_status = int(h["pr167"]["accessory_field_status"])
        for lang, nid in h["accessory_nids"].items():
            if int(nid) not in seen:
                seen.add(int(nid))
                view.add_target(h["accessory_sku"], nid, h["accessory_nids"]["ru"], lang, field_status, None, None)
    for tnid, g in sorted(src_groups.items()):
        groups[tnid] = view.add_source_group(registry, tnid, g["brand"], None, g["models"], g["nids"])
    return view, groups


def _catalog_identity(res) -> dict:
    if res is None:
        return {"status": "unmapped_brand", "model_id": None, "reasons": ["maker_unmapped"], "verified": False}
    return {"status": res["status"], "model_id": res["model_id"], "verified": res["verified"],
            "reasons": sorted({f"{lang}:{r['reason']}" for lang, r in res["locales"].items()}),
            "locale_strings": {lang: r["text"] for lang, r in res["locales"].items()}}


# ---------------------------------------------------------------------------------------------- verdicts
def _rel_summary(rel) -> dict:
    return {"relation_id": rel["relation_id"], "relation_type": rel["relation_type"],
            "proposed_state": rel["proposed_state"], "effective_state": rel["effective_state"],
            "reasons": rel["reasons"], "conditions_review_state": rel["conditions_review_state"],
            "conditions_result_without_context": rel["conditions_result_without_context"],
            "claim_statuses": sorted({c["effective_status"] for c in rel["claims"]}),
            "blockers": rel["publish"]["blockers"], "a_tier_candidate": rel["publish"]["a_tier_candidate"],
            "veto": {"candidate": rel["veto"]["candidate"], "pending_verification": rel["veto"]["pending_verification"],
                     "mode": rel["veto"]["mode"]}}


def verdict_for(relations, catalog_identity_ok=True) -> str:
    """Primary verdict from the relations a case maps to. Precedence is the order of ``VERDICTS``."""
    if not relations:
        return "UNKNOWN_NOT_LISTED"
    eff = {r["effective_state"] for r in relations}
    prop = {r["proposed_state"] for r in relations}
    if "CONFLICT_HOLD" in eff:
        return "CONFLICT_HOLD"
    if "EXCLUDED" in eff:
        return "EXCLUDED_VETO_CANDIDATE"
    if "EXCLUDED" in prop:
        return "EXCLUDED_PENDING_VERIFICATION"
    if prop == {"UNKNOWN"}:
        return "UNKNOWN_NOT_LISTED"
    if not catalog_identity_ok:
        return "HOLD_CATALOG_IDENTITY"
    live = [r for r in relations if r["proposed_state"] in ("LISTED", "LISTED_CONDITIONAL")]
    if any(any(x.startswith(_ART_REASON) for x in r["reasons"]) for r in live):
        return "HOLD_ARTICLE_BINDING"
    if any(r["effective_state"] == "UNKNOWN" for r in live):
        return "HOLD_UNVERIFIED_EVIDENCE"
    if any(not r["publish"]["a_tier_candidate"] for r in live):
        return "HELD_BY_POLICY"
    return "ELIGIBLE_SHADOW_CANDIDATE"


def _hold_reasons(relations, identity, extra=()) -> list:
    reasons = set(extra)
    if identity is not None and identity["status"] != "resolved":
        reasons.add("catalog_identity:" + identity["status"])
        reasons.update("catalog_identity:" + r for r in identity["reasons"])
    for rel in relations:
        reasons.update(rel["reasons"])
        reasons.update("blocker:" + b for b in rel["publish"]["blockers"])
    return sorted(reasons)


def _identity_ok(identity) -> bool:
    return identity is not None and identity["status"] == "resolved" and identity["verified"]


# ---------------------------------------------------------------------------------------------- positives
def classify_positives(seed_cases, extras, registry, index: RelationIndex, groups, current_pairs) -> tuple:
    locale_cases = []
    for p in seed_cases["positives"]:
        s, t = p["source"], p["target"]
        rtype = extras["positive_groups"][p["group_id"]]
        maker = s["maker_id"]
        identity = _catalog_identity(groups.get(int(s["tnid"])))
        acc_key = f"art:{maker}:{norm_mpn(t['oem_base_sku'])}"
        oem_model = None
        if rtype == "accessory_for_model":
            oem_model = registry.resolve(maker, p["oem_compatible_model"], "oem")
            rels = (index.find_all(rtype, accessory=acc_key, model=oem_model["model_id"])
                    if oem_model["status"] == "resolved" else [])
        else:
            seat_id = identity["model_id"]
            rels = index.find_all(rtype, adapter=acc_key, seat=seat_id) if seat_id else []
        extra = []
        if int(t["field_status"]) != 1:
            extra.append(f"target_field_status:{t['field_status']}")
        if int(t["published"]) != 1:
            extra.append(f"target_published:{t['published']}")
        pair_current = current_pairs.get((int(s["nid"]), int(t["nid"])))
        locale_cases.append({
            "case_id": p["case_id"], "group_id": p["group_id"], "lang": p["lang"],
            "relation_type": rtype,
            "source": {"nid": s["nid"], "tnid": s["tnid"], "sku": s["sku"], "title": s["title"],
                       "catalog_model_string": s["catalog_model_string"]},
            "target": {"nid": t["nid"], "tnid": t["tnid"], "catalog_sku": t["sku"], "oem_mpn": t["oem_base_sku"],
                       "field_status": t["field_status"], "published": t["published"]},
            "oem_model_resolution": None if oem_model is None else {
                "status": oem_model["status"], "reason": oem_model["reason"], "model_id": oem_model["model_id"]},
            "catalog_identity": identity,
            "relations": [_rel_summary(r) for r in rels],
            "verdict": verdict_for(rels, _identity_ok(identity)),
            "hold_reasons": _hold_reasons(rels, identity, extra),
            "publishable_now": False,
            "current_v421": pair_current,
            "pr167_recorded": p["pr167"],
        })
    physical: dict = {}
    for case in locale_cases:
        physical.setdefault((case["source"]["tnid"], case["target"]["tnid"]), []).append(case)
    order = {v: i for i, v in enumerate(VERDICTS)}
    phys_out = []
    for (stnid, ttnid), cases in sorted(physical.items()):
        worst = min((c["verdict"] for c in cases), key=lambda v: order[v])
        phys_out.append({
            "physical_relation_id": f"{cases[0]['group_id'][:3]}:{stnid}>{ttnid}", "group_id": cases[0]["group_id"],
            "source_tnid": stnid, "target_tnid": ttnid, "locales": sorted(c["lang"] for c in cases),
            "case_ids": sorted(c["case_id"] for c in cases), "verdict": worst,
            "locale_verdicts": {c["lang"]: c["verdict"] for c in cases},
            "locale_consistent": len({c["verdict"] for c in cases}) == 1,
            "relation_ids": sorted({r["relation_id"] for c in cases for r in c["relations"]}),
            "hold_reasons": sorted({x for c in cases for x in c["hold_reasons"]}), "publishable_now": False})
    return locale_cases, phys_out


# ---------------------------------------------------------------------------------------------- holdouts
def _end_key(registry, maker, name, context="oem"):
    res = registry.resolve(maker, name, context)
    return (res["model_id"] if res["status"] == "resolved" else None), res


def classify_holdouts(seed_cases, extras, registry, index: RelationIndex, groups) -> list:
    out = []
    for h in seed_cases["holdouts"]:
        ep = h["endpoints"]
        rtype = ep["relation_type"]
        identity = _catalog_identity(groups.get(int(h["source_tnid"])))
        rels, ends_report = [], []
        if rtype == "adapter_between":
            seat_id, seat_res = _end_key(registry, *ep["seat"])
            art = f"art:{ep['adapter'][0]}:{norm_mpn(ep['adapter'][1])}"
            for chassis in ep["chassis"]:
                chassis_id, _ = _end_key(registry, *chassis)
                found = (index.find_all(rtype, seat=seat_id, adapter=art, chassis=chassis_id)
                         if seat_id and chassis_id else [])
                rels.extend(found)
                ends_report.append({"seat": ep["seat"][1], "chassis": chassis[1], "adapter_mpn": ep["adapter"][1],
                                    "relation_ids": [r["relation_id"] for r in found],
                                    "states": sorted({r["proposed_state"] for r in found}) or ["UNKNOWN"]})
        else:
            model_id, _ = _end_key(registry, *ep["model"])
            art = f"art:{ep['accessory'][0]}:{norm_mpn(ep['accessory'][1])}"
            found = index.find_all(rtype, accessory=art, model=model_id) if model_id else []
            rels.extend(found)
            ends_report.append({"model": ep["model"][1], "accessory_mpn": ep["accessory"][1],
                                "relation_ids": [r["relation_id"] for r in found],
                                "states": sorted({r["proposed_state"] for r in found}) or ["UNKNOWN"]})
        expected = set(ep["lock_expected_proposed_state"])
        proposed = {r["proposed_state"] for r in rels} or {"UNKNOWN"}
        field_status = int(h["pr167"]["accessory_field_status"])
        extra = [f"target_field_status:{field_status}"] if field_status != 1 else []
        if rtype == "adapter_between":
            extra.append("one_ended_adapter:chassis_has_no_catalog_source")
        out.append({
            "case_id": h["case_id"], "prefix": h["prefix"], "relation_type": rtype,
            "source": {"tnid": h["source_tnid"], "nids": h["source_nids"], "title": h["source_title"],
                       "catalog_model_string": h["source_catalog_model_string"],
                       "brand_assumed": h["source_brand_assumed"]},
            "target": {"catalog_sku": h["accessory_sku"], "nids": h["accessory_nids"], "field_status": field_status},
            "catalog_identity": identity, "end_report": ends_report, "relations": [_rel_summary(r) for r in rels],
            "lock_expected_proposed_state": sorted(expected), "stage_b_proposed_states": sorted(proposed),
            "matches_lock_expectation": proposed <= expected,
            "verdict": verdict_for(rels, _identity_ok(identity)), "hold_reasons": _hold_reasons(rels, identity, extra),
            "publishable_now": False,
            "pr167_recorded": {k: h["pr167"][k] for k in ("expected_oem_state", "shadow_output", "test_result",
                                                          "stage1_status", "counterfactual_current_t2")}})
    return out


# ---------------------------------------------------------------------------------------------- controls
def classify_controls(extras, registry, index: RelationIndex, seed_controls) -> list:
    out = []
    expected_by_key = {(c["control"], c["source_model"], c["target_sku"]): c for c in seed_controls}
    for spec in extras["controls"]:
        rels = []
        for r in spec["relations"]:
            rt = r["relation_type"]
            if rt == "vehicle_general":
                rels += index.find_all(rt, accessory=f"art:{r['accessory'][0]}:{norm_mpn(r['accessory'][1])}")
            elif rt == "accessory_for_model":
                model_id, _ = _end_key(registry, *r["model"])
                rels += (index.find_all(rt, accessory=f"art:{r['accessory'][0]}:{norm_mpn(r['accessory'][1])}",
                                        model=model_id) if model_id else [])
            else:
                seat_id, _ = _end_key(registry, *r["seat"])
                chassis_id, _ = _end_key(registry, *r["chassis"])
                rels += (index.find_all(rt, seat=seat_id, chassis=chassis_id,
                                        adapter=f"art:{r['adapter'][0]}:{norm_mpn(r['adapter'][1])}")
                         if seat_id and chassis_id else [])
        key = (spec["control"], spec["source_model"], spec["target_sku"])
        pr = expected_by_key.get(key)
        out.append({"control": spec["control"], "source_model": spec["source_model"], "target_sku": spec["target_sku"],
                    "pr167_expected": None if pr is None else pr["expected"],
                    "pr167_purpose": None if pr is None else pr["purpose"],
                    "relations": [_rel_summary(r) for r in rels], "verdict": verdict_for(rels),
                    "hold_reasons": _hold_reasons(rels, None), "publishable_now": False})
    return out


# ---------------------------------------------------------------------------------------------- identity
IDENTITY_PROBES = (
    # (maker, text, context, expected status, expected reason prefix, why it matters)
    ("maxi-cosi", "Pebble 360/PRO(2)", "oem", "blocked", "prescreen:", "slash/paren shorthand collides with Pebble 360 Pro / Pro 2 under cm.key"),
    ("maxi-cosi", "Pebble 360 Pro", "oem", "resolved", "canonical_exact", "generation-less name resolves only to itself"),
    ("maxi-cosi", "Pebble 360 Pro 2", "oem", "resolved", "canonical_exact", "generation 2 is a different model"),
    ("bugaboo", "Fox", "oem", "unresolved", "no_exact_match", "'Fox' is not a prefix match for Fox 2 / Fox 5"),
    ("bugaboo", "Fox 5", "oem", "resolved", "canonical_exact", "Fox 5 is not Fox 5 Renew"),
    ("britax-romer", "Dualfix Pro М", "catalog", "unresolved", "alias_unreviewed", "Cyrillic M needs a human-verified alias"),
    ("britax-romer", "Dualfix Pro М", "oem", "blocked", "prescreen:mixed_script", "mixed-script name is blocked in OEM context"),
    ("britax-romer", "Britax-R mer Evolvafix", "catalog", "unresolved", "alias_unreviewed", "extract() output for 'Römer' needs a reviewed alias"),
    ("besafe", "iZi Go Modular X-1 iSize", "catalog", "unresolved", "alias_unreviewed", "X-1 is not X1 without a reviewed alias"),
    ("besafe", "iZi Go X1", "catalog", "unresolved", "no_exact_match", "confusable short name must not resolve"),
)


def identity_probes(registry) -> list:
    out = []
    for maker, text, context, status, reason_prefix, why in IDENTITY_PROBES:
        r = registry.resolve(maker, text, context)
        out.append({"maker_id": maker, "text": text, "context": context, "status": r["status"], "reason": r["reason"],
                    "model_id": r["model_id"], "verified": r["verified"], "flags": r["flags"],
                    "expected_status": status, "expected_reason_prefix": reason_prefix, "why": why,
                    "as_expected": r["status"] == status and r["reason"].startswith(reason_prefix)})
    return out


def classify_normalization(seed_cases, extras, registry) -> list:
    out = []
    for n in seed_cases["normalization"]:
        spec = extras["normalization"][n["case_id"].split("_")[0]]
        r = registry.resolve(spec["maker"], n["source_model"], spec["context"])
        pr_equal = spec["pr167_equal_to"]
        resolved = r["model_id"] if r["status"] == "resolved" else None
        if pr_equal is not None and resolved == pr_equal:
            agreement = "AGREES_EQUAL"
        elif pr_equal is not None and resolved is None:
            agreement = "STRICTER_HOLD_REVIEWED_ALIAS_REQUIRED"
        elif pr_equal is None and resolved is None:
            agreement = "AGREES_DISTINCT_NOT_RESOLVED"
        else:
            agreement = "DISAGREES"
        out.append({"case_id": n["case_id"], "text": n["source_model"], "maker_id": spec["maker"],
                    "stage_b": {"status": r["status"], "reason": r["reason"], "model_id": resolved,
                                "verified": r["verified"], "flags": r["flags"], "candidates": r["candidates"]},
                    "pr167_expected": n["pr167"]["expected_oem_state"], "pr167_equal_to": pr_equal,
                    "distinct_from": spec["distinct_from"],
                    "distinct_ok": resolved not in spec["distinct_from"], "agreement": agreement})
    return out


# ---------------------------------------------------------------------------------------------- conditions
def classify_conditions(vectors_doc, typed, vocab, seed_cases, index: RelationIndex, registry) -> list:
    kinds = {name: seed_convert.conditions_from_use_limits(spec.get("use_limits", {"kind": spec.get("kind")}),
                                                           typed["kinds"])
             for name, spec in vectors_doc["kinds"].items()}
    out = []
    for v in vectors_doc["vectors"]:
        conds, review = kinds[v["conditions"]]
        result = cd.conditions_result(review, conds, v["context"], vocab)
        out.append({"case_id": v["case_id"], "kind": v["conditions"], "conditions_review_state": review,
                    "context": v["context"], "expected": v["expected"], "result": result,
                    "as_expected": result == v["expected"], "level": "condition_predicate"})
    # C14: the unlisted-model case is relation-level, not a predicate: no OEM tuple => UNKNOWN
    unlisted_model, _ = _end_key(registry, "britax-romer", "KIDFIX PRO")
    found = index.find_all("accessory_for_model", accessory="art:britax-romer:ACCSFCC207", model=unlisted_model)
    pr = next(c for c in seed_cases["condition_cases"] if c["case_id"].startswith("C14"))
    out.append({"case_id": pr["case_id"], "kind": "relation_level", "conditions_review_state": None, "context": None,
                "expected": "FAIL", "result": "UNKNOWN" if not found else found[0]["effective_state"],
                "as_expected": not found, "level": "relation_tuple_missing",
                "note": "no ACCSFCC207 relation exists for this model: absence is UNKNOWN (not recommended), never inherited"})
    out.sort(key=lambda r: r["case_id"])
    return out


# ---------------------------------------------------------------------------------------------- canonical_models.key probes
KEY_PROBES = (
    # (maker, text_a, text_b): pairs where the legacy canonical_models.key() is (or is not) an identity proof
    ("maxi-cosi", "Pebble 360/PRO(2)", "Pebble 360 Pro 2"),
    ("maxi-cosi", "Pebble 360 Pro", "Pebble 360 Pro 2"),
    ("besafe", "iZi Go Modular X-1 iSize", "iZi Go Modular X1 i-Size"),
    ("britax-romer", "Dualfix Pro М", "DUALFIX PRO M"),
    ("britax-romer", "SWIVEL", "SWIVEL 2"),
    ("bugaboo", "Fox", "Fox 5"),
)


def key_probes(key_fn, registry) -> list:
    """Where the legacy ``canonical_models.key`` equates two strings and what the Stage B identity layer does instead."""
    out = []
    for maker, a, b in KEY_PROBES:
        ra, rb = registry.resolve(maker, a, "catalog"), registry.resolve(maker, b, "catalog")
        out.append({"maker_id": maker, "a": a, "b": b, "cm_key_a": key_fn(a), "cm_key_b": key_fn(b),
                    "cm_key_equal": key_fn(a) == key_fn(b),
                    "stage_b_a": {"status": ra["status"], "reason": ra["reason"], "model_id": ra["model_id"]},
                    "stage_b_b": {"status": rb["status"], "reason": rb["reason"], "model_id": rb["model_id"]},
                    "stage_b_same_model": ra["model_id"] is not None and ra["model_id"] == rb["model_id"]})
    return out
