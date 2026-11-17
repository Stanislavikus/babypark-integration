"""O4 - typed OEM relations, states and conditions (shadow only; nothing here recommends anything).

States: LISTED, LISTED_CONDITIONAL, EXCLUDED (only an explicit, scoped OEM no-recommendation),
UNKNOWN (absence / not listed / not tested / nothing accepted) and the separate CONFLICT_HOLD.

Evidence gating (see the lock, O1/O4 and OD1-OD8):
* ``proposed_state`` is derived from every non-rejected claim; ``effective_state`` additionally requires
  ACCEPTED (human-VERIFIED, byte-backed) claims, verified identity, a bound article and supported,
  reviewed conditions. Unverified evidence can only *hold* (UNKNOWN / CONFLICT_HOLD), never grant.
* absent-from-list => UNKNOWN, never EXCLUDED; a time-bound "not tested" statement or a positive claim
  contradicted by an explicit no-recommendation => CONFLICT_HOLD (needs adjudication).
* relations are exact scoped tuples; nothing is inherited across family/brand/generation/chassis.
* veto is report-only; enforcement is not authorized (OD3).
"""
from __future__ import annotations

import datetime as _dt

from . import canon, conditions as cd
from .assertions import ENDPOINTS
from .o1_evidence import DocumentStore, check_claim
from .o2_identity import IdentityRegistry, exact_key
from .o3_articles import ArticleBindings, norm_mpn
from .schema import ContractError, STATES, parse_date

DEFAULT_POLICY = {"require_distinct_reviewer": True, "allow_synthetic": False, "veto_mode": "report_only",
                  "publish_allow_list": [], "ttl_days": None, "as_of": None}
DOWNSTREAM_GATES = ["stage1_native_receipt", "locale_variant_commercial_gates", "owner_enablement_flag"]
_STATE_BLOCKER = {"LISTED_CONDITIONAL": "od4_conditional_held", "EXCLUDED": "state_excluded",
                  "UNKNOWN": "state_unknown", "CONFLICT_HOLD": "state_conflict_hold"}


def merge_policy(policy) -> dict:
    merged = {**DEFAULT_POLICY, **(policy or {})}
    if merged["veto_mode"] != "report_only":
        raise ContractError("veto enforcement is not authorized (OD3): veto_mode must be 'report_only'")
    if merged["as_of"] is None:
        raise ContractError("policy.as_of (YYYY-MM-DD) is required: outputs must not depend on the wall clock")
    parse_date(merged["as_of"], "policy.as_of")
    return merged


# ------------------------------------------------------------------ endpoint resolution
def _article_end(end, articles: ArticleBindings, issues: list, label: str) -> dict:
    b = articles.lookup(end["maker_id"], end["mpn"])
    if b["status"] != "bound":
        issues.append(f"article:{label}:{b['status']}")
    return {"kind": "article", "maker_id": end["maker_id"], "mpn": end["mpn"], "catalog_sku": b["catalog_sku"],
            "binding_status": b["status"], "binding_reasons": b["reasons"],
            "key": f"art:{end['maker_id']}:{norm_mpn(end['mpn'])}"}


def _model_end(end, registry: IdentityRegistry, issues: list, label: str) -> dict:
    r = registry.resolve(end["maker_id"], end["name"], "oem")
    if not (r["status"] == "resolved" and r["verified"]):
        issues.append(f"identity:{label}:{r['reason']}")
    key = r["model_id"] if r["status"] == "resolved" else f"raw:{end['maker_id']}:{exact_key(end['name'])}"
    return {"kind": "model", "maker_id": end["maker_id"], "name": end["name"], "model_id": r["model_id"],
            "identity_status": r["status"], "identity_reason": r["reason"], "identity_via": r["via"],
            "identity_flags": r["flags"], "identity_candidates": r["candidates"], "key": key}


def resolve_ends(relation_type, ends, registry, articles) -> tuple:
    out, issues = {}, []
    for name, field in ENDPOINTS[relation_type].items():
        end = ends[name]
        out[name] = (_article_end(end, articles, issues, name) if field == "mpn"
                     else _model_end(end, registry, issues, name))
    if relation_type == "adapter_between":
        ext = ends.get("extension")
        if ext is None or not ext["required"]:
            out["extension"] = None
        elif ext["mpn"]:
            out["extension"] = _article_end({"maker_id": ext["maker_id"], "mpn": ext["mpn"]}, articles, issues,
                                            "extension")
        elif ext["name"] and ext["maker_id"]:
            out["extension"] = _model_end({"maker_id": ext["maker_id"], "name": ext["name"]}, registry, issues,
                                          "extension")
        else:
            issues.append("extension_unspecified")
            out["extension"] = {"kind": "extension", "key": "ext:unspecified"}
    return out, issues


def _relation_key(relation_type, resolved) -> tuple:
    return (relation_type, tuple(sorted((k, (v["key"] if v else "none")) for k, v in resolved.items())))


# ------------------------------------------------------------------ state derivation
def _state_from(claims) -> tuple:
    """(state, conflict_reason) from a set of claim records using the proposed-state rules."""
    types = {}
    for c in claims:
        types.setdefault(c["assertion"]["type"], []).append(c)
    pos, neg, nt = types.get("compatible", []), types.get("not_recommended", []), types.get("not_tested_at_time", [])
    if pos and neg:
        return "CONFLICT_HOLD", "positive_vs_explicit_no_recommendation"
    if nt:
        return "CONFLICT_HOLD", "time_bound_not_tested_unadjudicated"
    if neg:
        return "EXCLUDED", None
    if pos:
        shapes = {canon.canonical_json([c["assertion"]["conditions"], c["assertion"]["conditions_review_state"]])
                  for c in pos}
        if len(shapes) > 1:
            return "CONFLICT_HOLD", "conditions_disagree"
        review_state = pos[0]["assertion"]["conditions_review_state"]
        return ("LISTED" if review_state == "verified_none" else "LISTED_CONDITIONAL"), None
    return "UNKNOWN", None


def _allow_list_ok(policy, docs) -> tuple:
    entries = policy["publish_allow_list"]
    if not entries:
        return False, "od6_allowlist_empty"
    for doc in docs:
        if not any(e["issuer"] == doc["issuer"] and doc["market"] in e["markets"]
                   and doc["language"] in e["languages"] for e in entries):
            return False, "od6_market_language_not_allowed"
    return True, None


def derive_relations(claims, store: DocumentStore, registry: IdentityRegistry, articles: ArticleBindings,
                     vocab, policy) -> list:
    """Derive typed relations from claims. Deterministic; sorted by relation_id."""
    policy = merge_policy(policy)
    as_of = parse_date(policy["as_of"])
    superseded = {c["supersedes"] for c in claims if c.get("supersedes")}
    checks = {c["claim_id"]: check_claim(c, store, policy, superseded) for c in claims}
    groups: dict = {}
    for claim in claims:
        chk = checks[claim["claim_id"]]
        if chk["declared_status"] is None or chk["effective_status"] in ("REJECTED", "SUPERSEDED"):
            continue  # structurally broken / rejected / superseded: visible only in the claim matrix
        a = claim["assertion"]
        if a["type"] == "article_identity":
            continue
        resolved, issues = resolve_ends(a["relation_type"], a["ends"], registry, articles)
        key = _relation_key(a["relation_type"], resolved)
        slot = groups.setdefault(key, {"relation_type": a["relation_type"], "resolved": resolved,
                                       "issues": set(), "claims": []})
        slot["issues"].update(issues)
        slot["claims"].append(claim)
    relations = [_build_relation(key, slot, checks, store, vocab, policy, as_of)
                 for key, slot in groups.items()]
    return sorted(relations, key=lambda r: r["relation_id"])


def _build_relation(key, slot, checks, store, vocab, policy, as_of) -> dict:
    claims = sorted(slot["claims"], key=lambda c: c["claim_id"])
    accepted = [c for c in claims if checks[c["claim_id"]]["accepted"]]
    proposed_state, conflict = _state_from(claims)
    accepted_state, _ = _state_from(accepted) if accepted else ("UNKNOWN", None)
    deciding = accepted if accepted_state in ("LISTED", "LISTED_CONDITIONAL", "EXCLUDED") else claims
    pos = [c for c in deciding if c["assertion"]["type"] == "compatible"]
    conditions = pos[0]["assertion"]["conditions"] if pos else []
    review_state = pos[0]["assertion"]["conditions_review_state"] if pos else None
    reasons, issues = set(), set(slot["issues"])
    result_wo_ctx = None
    if pos:
        try:
            cd.check_conditions(review_state, conditions, vocab)
            result_wo_ctx = cd.conditions_result(review_state, conditions, {}, vocab)
        except cd.UnsupportedCondition:
            issues.add("unsupported_condition_type")
            result_wo_ctx = "UNSUPPORTED"
        if review_state == "unknown":
            issues.add("conditions_review_unknown")
    docs = sorted({c["doc_id"] for c in deciding})
    evidence_docs = []
    for doc_id in docs:
        doc = store.docs.get(doc_id)
        if doc is not None:
            age = (as_of - parse_date(doc["document_date"])).days
            evidence_docs.append({"doc_id": doc_id, "issuer": doc["issuer"], "document_date": doc["document_date"],
                                  "market": doc["market"], "language": doc["language"], "age_days": age,
                                  "bytes_state": doc["bytes_state"], "synthetic": doc["synthetic"]})
    max_age = max((d["age_days"] for d in evidence_docs), default=None)
    ttl = policy["ttl_days"]
    expired = None if ttl is None or max_age is None else max_age > ttl
    if expired:
        issues.add("evidence_expired_ttl")
    # effective state: unverified evidence may only hold, never grant
    if proposed_state == "CONFLICT_HOLD":
        effective = "CONFLICT_HOLD"
        reasons.add(conflict)
    elif proposed_state == "UNKNOWN":
        effective = "UNKNOWN"
        reasons.add("absent_from_list_or_no_positive_claim")
    elif accepted_state == proposed_state:
        effective = "UNKNOWN" if issues else proposed_state
    else:
        effective = "UNKNOWN"
        for c in claims:
            if not checks[c["claim_id"]]["accepted"]:
                reasons.update(checks[c["claim_id"]]["reasons"])
    reasons |= issues
    ends_out = {name: ({k: v for k, v in end.items() if k != "key"} if end else None)
                for name, end in slot["resolved"].items()}
    synthetic = any(c["synthetic"] or (store.docs.get(c["doc_id"]) or {}).get("synthetic") for c in claims)
    blockers = []
    if effective != "LISTED":
        blockers.append(_STATE_BLOCKER[effective])
    if "LISTED_CONDITIONAL" in (proposed_state, effective):
        blockers.append("od4_conditional_held")  # still held after verification until OD4 copy/policy is approved
    if slot["relation_type"] == "adapter_between":
        blockers.append("od5_one_ended_adapter_abstain")
    if slot["relation_type"] == "vehicle_general":
        blockers.append("class_c_never_ab")
    if accepted:
        ok, why = _allow_list_ok(policy, [store.docs[d["doc_id"]] for d in evidence_docs if d["doc_id"] in store.docs])
        if not ok:
            blockers.append(why)
    else:
        blockers.append("od6_allowlist_empty" if not policy["publish_allow_list"] else "no_accepted_claim")
    if synthetic:
        blockers.append("synthetic_relation")
    time_bound = [{"claim_id": c["claim_id"], "as_of": c["assertion"]["as_of"]}
                  for c in claims if c["assertion"]["type"] == "not_tested_at_time"]
    relation = {
        "relation_id": "rel:" + canon.digest([key[0], [list(p) for p in key[1]]])[:16],
        "relation_type": slot["relation_type"], "ends": ends_out,
        "proposed_state": proposed_state, "effective_state": effective, "reasons": sorted(reasons),
        "claims": [{"claim_id": c["claim_id"], "assertion_type": c["assertion"]["type"],
                    "declared_status": checks[c["claim_id"]]["declared_status"],
                    "effective_status": checks[c["claim_id"]]["effective_status"]} for c in claims],
        "conditions": conditions, "conditions_review_state": review_state,
        "conditions_result_without_context": result_wo_ctx,
        "context_requirements": sorted({a for c in conditions for a in cd.attributes_in(c)}) if conditions
        and result_wo_ctx != "UNSUPPORTED" else [],
        "time_bound_statements": time_bound,
        "evidence": {"docs": evidence_docs, "max_age_days": max_age, "ttl_days": ttl, "expired": expired,
                     "as_of": policy["as_of"]},
        "veto": {"candidate": effective == "EXCLUDED",
                 "pending_verification": proposed_state == "EXCLUDED" and effective != "EXCLUDED",
                 "mode": policy["veto_mode"],
                 "scope": {n: (e["key"] if e else "none") for n, e in slot["resolved"].items()}
                 if proposed_state == "EXCLUDED" else None},
        "publish": {"a_tier_candidate": not blockers, "blockers": sorted(set(blockers)),
                    "downstream_gates": list(DOWNSTREAM_GATES)},
        "synthetic": bool(synthetic),
    }
    if relation["effective_state"] not in STATES or relation["proposed_state"] not in STATES:
        raise ContractError("internal: invalid state")
    return relation


class RelationIndex:
    """Exact-scope lookup: a missing exact tuple is UNKNOWN. No inheritance across family/brand/generation."""

    def __init__(self, relations) -> None:
        self.relations = list(relations)

    @staticmethod
    def end_keys(rel) -> dict:
        have = {}
        for name, end in rel["ends"].items():
            if end is None:
                have[name] = "none"
            elif end["kind"] == "article":
                have[name] = f"art:{end['maker_id']}:{norm_mpn(end['mpn'])}"
            elif end["kind"] == "model":
                have[name] = end["model_id"] or f"raw:{end['maker_id']}:{exact_key(end['name'])}"
            else:
                have[name] = "ext:unspecified"
        return have

    def find_all(self, relation_type, **ends) -> list:
        """Relations of this type whose end keys equal the given ones; ends that are not given are not compared."""
        return [rel for rel in self.relations if rel["relation_type"] == relation_type
                and all(self.end_keys(rel).get(k) == v for k, v in ends.items())]

    def find(self, relation_type, **ends) -> dict | None:
        """Exact match on *all* end keys (model_id / 'art:<maker>:<MPN>' / 'none'): the scope is the whole tuple."""
        for rel in self.relations:
            if rel["relation_type"] == relation_type and self.end_keys(rel) == dict(ends):
                return rel
        return None

    def state_for(self, relation_type, **ends) -> str:
        rel = self.find(relation_type, **ends)
        return rel["effective_state"] if rel else "UNKNOWN"


def summarize(relations) -> dict:
    def count(field):
        out: dict = {}
        for r in relations:
            out[r[field]] = out.get(r[field], 0) + 1
        return dict(sorted(out.items()))

    return {"relations": len(relations), "by_effective_state": count("effective_state"),
            "by_proposed_state": count("proposed_state"), "by_relation_type": count("relation_type"),
            "a_tier_candidates": sum(1 for r in relations if r["publish"]["a_tier_candidate"]),
            "veto_candidates": sum(1 for r in relations if r["veto"]["candidate"]),
            "veto_pending_verification": sum(1 for r in relations if r["veto"]["pending_verification"])}
