"""Stage C acceptance gate: Stage B typed relations -> an envelope of accepted catalog edges + a ledger of everything held.

Only a truly VERIFIED, unconditional, non-synthetic relation with verified identities and bound articles passes. The gate re-checks
the relation fields itself (it never trusts ``publish.a_tier_candidate`` alone) and refuses what the owner decisions keep held:

* OD1/OD2 - effective state LISTED needs accepted (human-VERIFIED, byte-backed) claims and unexpired evidence; an expired relation is held;
* OD3 - veto is report-only: EXCLUDED relations only feed the veto report, nothing is removed;
* OD4 - LISTED_CONDITIONAL (and any relation with conditions) is held; ``publish_states`` can only be ``["LISTED"]``;
* OD5 - every ``adapter_between`` relation abstains by default (the would-be edges are recorded in the report); the only other value is a
  TEST-ONLY policy that is refused unless the relation and the envelope are synthetic;
* OD6 - the allow-list is applied by Stage B O4 (``od6_*`` blockers); an empty allow-list means nothing passes;
* class C (``vehicle_general``) never yields a model relation.

Brand is never a key: cross-brand relations are admitted like any other. An adapter relation is two-ended by construction (seat model,
adapter article, chassis model); a missing or unverified end holds the whole relation. A relation whose configuration REQUIRES an extension
is held (``extension_required_not_in_edge``): an edge names one target and cannot express "the adapter AND EXT-1".
Catalog joins are exact: ``shadow.expand_pairs`` (model_id -> source NIDs, SKU -> target NIDs, same locale); a pair whose target is not
purchasable (field_status / published / price) or whose join is ambiguous is held, never guessed. Every accepted edge is also bound to the identity
of its SOURCE row (``source_identities``: SKU and the digest of ``source_identity.py``); a source that cannot be described holds its pairs
(``source_identity_unknown``), and the engine seam later refuses an edge whose source is no longer that product (finding C-R1).
"""
from __future__ import annotations

import datetime
import re

from . import _stage_b, envelope as E

_stage_b.ensure_on_path()
from oem_stage import canon, shadow  # noqa: E402

GATE_VERSION = "bp-oem-gate-v1"
REPORT_SCHEMA = "bp-oem-gate-report-v1"
RELATIONS_SCHEMA = "bp-oem-relations-v1"
DEFAULT_POLICY = {"publish_states": ["LISTED"], "one_ended_adapter": "abstain", "veto_mode": "report", "allow_synthetic": False}
OVERRIDABLE_BLOCKERS = ("synthetic_relation", "od5_one_ended_adapter_abstain")
VERIFIED_MODEL_VIA = ("canonical", "alias")
CLAIM_DECLARED_OK, CLAIM_EFFECTIVE_OK = "VERIFIED", "ACCEPTED"     # o1_evidence.check_claim: human-VERIFIED and byte-backed = ACCEPTED
_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
REQUIRED_ENDS = {"accessory_for_model": ("accessory", "model"), "adapter_between": ("seat", "adapter", "chassis")}


class GateRefused(ValueError):
    """The gate policy or an input is not acceptable; nothing may be produced."""


def normalize_policy(policy, *, as_of) -> dict:
    merged = {**DEFAULT_POLICY, **(policy or {})}
    unknown = sorted(set(merged) - set(DEFAULT_POLICY))
    if unknown:
        raise GateRefused(f"unknown gate policy keys {unknown}")
    if merged["publish_states"] != ["LISTED"]:
        raise GateRefused("publish_states must be ['LISTED']: conditional publication is held until OD4 copy is approved")
    if merged["veto_mode"] != "report":
        raise GateRefused("veto_mode must be 'report': veto enforcement is not authorized (OD3)")
    if merged["one_ended_adapter"] not in E.ONE_ENDED_ADAPTER_VALUES:
        raise GateRefused(f"one_ended_adapter must be one of {list(E.ONE_ENDED_ADAPTER_VALUES)}")
    if type(merged["allow_synthetic"]) is not bool:
        raise GateRefused("allow_synthetic must be a boolean")
    if merged["one_ended_adapter"] != "abstain" and not merged["allow_synthetic"]:
        raise GateRefused("a non-default OD5 policy is test-only: it requires allow_synthetic=True (synthetic evidence only)")
    if not isinstance(as_of, str) or not _DATE.fullmatch(as_of):
        raise GateRefused("as_of (YYYY-MM-DD) is required: the gate never reads the wall clock")
    try:
        datetime.date(int(as_of[:4]), int(as_of[5:7]), int(as_of[8:]))
    except ValueError:
        raise GateRefused("as_of is not a calendar date") from None
    merged["as_of"] = as_of
    return merged


# ---------------------------------------------------------------------------------------------------------- relation level
def _end_problems(name, end, *, optional=False) -> list:
    if end is None:
        return [] if optional else [f"end_missing:{name}"]
    kind = end.get("kind")
    if kind == "model":
        if not (end.get("identity_status") == "resolved" and end.get("model_id") and end.get("identity_via") in VERIFIED_MODEL_VIA):
            return [f"identity_not_verified:{name}"]
    elif kind == "article":
        if not (end.get("binding_status") == "bound" and end.get("catalog_sku")):
            return [f"article_not_bound:{name}"]
    else:
        return ["extension_unspecified" if name == "extension" else f"end_unsupported:{name}"]
    return []


def decide_relation(rel, policy, *, doc_hashes) -> dict:
    """Decision for one relation: ``{"decision": "ACCEPT"|"HOLD", "reasons": [...], "overridden": [...]}``.

    Every reason is a stable code (Stage B O4 blocker names are reused where they exist). ``overridden`` lists the O4 blockers that a
    non-default, test-only policy value waived (always empty under the default policy).
    """
    hold, overridden = set(), []
    rtype, state = rel["relation_type"], rel["effective_state"]
    blockers = set(rel["publish"]["blockers"])
    for blocker in sorted(blockers):
        if blocker == "synthetic_relation" and policy["allow_synthetic"]:
            overridden.append(blocker)
        elif blocker == "od5_one_ended_adapter_abstain" and policy["one_ended_adapter"] != "abstain" and rel["synthetic"]:
            overridden.append(blocker)
        else:
            hold.add(blocker)
    # independent re-checks of the relation itself
    if state != "LISTED":
        hold.add("od4_conditional_held" if state == "LISTED_CONDITIONAL" else f"state_{state.lower()}")
    if rel["conditions"] or rel["conditions_review_state"] != "verified_none":
        hold.add("conditions_not_verified_none")
    if rtype == "vehicle_general":
        hold.add("class_c_never_ab")
    elif rtype not in E.RELATION_TYPES:
        hold.add("unsupported_relation_type")
    claims = rel["claims"]
    if not any(c["assertion_type"] == "compatible" and c["declared_status"] == CLAIM_DECLARED_OK
               and c["effective_status"] == CLAIM_EFFECTIVE_OK for c in claims):
        hold.add("no_verified_compatible_claim")
    if any(c["assertion_type"] in ("not_recommended", "not_tested_at_time") for c in claims):
        hold.add("negative_or_time_bound_claim_present")
    if rtype in REQUIRED_ENDS:
        ends = rel["ends"]
        for name in REQUIRED_ENDS[rtype]:
            hold.update(_end_problems(name, ends.get(name)))
        if rtype == "adapter_between":
            hold.update(_end_problems("extension", ends.get("extension"), optional=True))
            if ends.get("extension") is not None:
                # Stage B keeps an extension end only when the configuration REQUIRES it. An edge names one target (the adapter) and cannot
                # say "also needs EXT-1", so recommending the bare adapter would promise a fit the OEM statement does not make.
                hold.add("extension_required_not_in_edge")
    evidence = rel["evidence"]
    if not evidence["docs"]:
        hold.add("no_evidence_documents")
    if evidence["expired"] is True:
        hold.add("evidence_expired")
    if any(d["bytes_state"] != "present" for d in evidence["docs"]):
        hold.add("evidence_bytes_not_present")
    if any(not doc_hashes.get(d["doc_id"]) for d in evidence["docs"]):
        hold.add("evidence_doc_hash_unknown")
    if rel["veto"]["candidate"] or rel["veto"]["pending_verification"]:
        hold.add("veto_signal_present")
    if rel["synthetic"] and not policy["allow_synthetic"]:
        hold.add("synthetic_relation")
    if policy["one_ended_adapter"] != "abstain" and "od5_one_ended_adapter_abstain" in blockers and not rel["synthetic"]:
        hold.add("od5_override_requires_synthetic")
    return {"decision": "HOLD" if hold else "ACCEPT", "reasons": sorted(hold), "overridden": sorted(overridden)}


# ---------------------------------------------------------------------------------------------------------- pair level
def _identity_ok(found) -> bool:
    return (isinstance(found, dict) and set(found) == {"sku", "identity"} and isinstance(found["sku"], str) and bool(found["sku"])
            and E.is_hex64(found["identity"]))


def _pair_problem(pair, price_of, counts, source_identities) -> str | None:
    if not pair["end_identity_verified"]:
        return "identity_not_verified_for_pair"
    if pair["article_binding_status"] != "bound":
        return "article_not_bound_for_pair"
    if _as_int(pair["target_field_status"]) != 1:
        return "target_field_status_not_1"
    if _as_int(pair["target_published"]) != 1:
        return "target_not_published"
    price = price_of.get(pair["target_nid"])
    if not isinstance(price, (int, float)) or isinstance(price, bool) or price <= 0:
        return "target_price_not_positive"
    if counts["target"].get((pair["target_sku"], pair["lang"]), 0) != 1:
        return "ambiguous_target_sku_in_locale"
    if not _identity_ok(source_identities.get(pair["source_nid"])):
        return "source_identity_unknown"
    return None


def _as_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _relation_ids(rels) -> list:
    return sorted(r["relation_id"] for r in rels)


def build(relations, view, *, policy, as_of, doc_hashes, binding_ids_of=None, inputs_files, source_identities, label=None,
          relations_schema=RELATIONS_SCHEMA) -> tuple:
    """Run the gate. Returns ``(envelope, report)``; both are plain deterministic JSON structures.

    ``doc_hashes``: ``{doc_id: sha256}`` of the captured OEM bytes. ``binding_ids_of(maker_id, mpn)``: optional lookup of the O3 binding id.
    ``inputs_files``: ``{typed data file: sha256}`` (the registry version of the identity and binding data the relations were derived from).
    ``source_identities``: ``{source nid: {"sku": ..., "identity": sha256}}`` from ``source_identity.identities_for(rows, index)``; required, so no
    caller can forget the binding. A pair whose source is missing or malformed there is held (``source_identity_unknown``).
    """
    if not isinstance(source_identities, dict):
        raise GateRefused("source_identities must be a mapping {source nid: {sku, identity}} (finding C-R1)")
    pol = normalize_policy(policy, as_of=as_of)
    rels = sorted(relations, key=lambda r: r["relation_id"])
    if len({r["relation_id"] for r in rels}) != len(rels):
        raise GateRefused("duplicate relation_id in the relations")
    derived_as_of = sorted({r["evidence"]["as_of"] for r in rels})
    if derived_as_of and derived_as_of != [pol["as_of"]]:
        # evidence staleness (OD2) was computed at the relations' own as_of; stamping a different date on the envelope would misstate it
        raise GateRefused(f"as_of {pol['as_of']} differs from the date the relations were derived for: {derived_as_of}")
    relations_digest, inputs_digest = canon.digest(rels), canon.digest(inputs_files)
    price_of = {t["nid"]: t.get("price") for targets in view.targets_by_sku.values() for t in targets}
    counts = {"target": {}}
    for sku, targets in view.targets_by_sku.items():
        for t in targets:
            counts["target"][(sku, t["lang"])] = counts["target"].get((sku, t["lang"]), 0) + 1

    decisions, rel_rows, held_pairs, od5_would, by_pair = {}, [], [], [], {}
    for rel in rels:
        verdict = decide_relation(rel, pol, doc_hashes=doc_hashes)
        decisions[rel["relation_id"]] = verdict
        pairs = shadow.expand_pairs(rel, view)
        row = {"relation_id": rel["relation_id"], "relation_type": rel["relation_type"], "proposed_state": rel["proposed_state"],
               "effective_state": rel["effective_state"], "decision": verdict["decision"], "reasons": verdict["reasons"],
               "overridden": verdict["overridden"], "catalog_pairs": len(pairs), "edges_accepted": 0, "pairs_held": 0}
        rel_rows.append(row)
        if verdict["decision"] == "HOLD":
            # would-be edges of a relation held ONLY by OD5 (both physical ends verified): reported for the owner, never published
            if verdict["reasons"] == ["od5_one_ended_adapter_abstain"]:
                for p in pairs:
                    problem = _pair_problem(p, price_of, counts, source_identities)
                    od5_would.append({"relation_id": rel["relation_id"], "end": p["end"], "source_nid": p["source_nid"],
                                      "target_nid": p["target_nid"], "lang": p["lang"], "target_sku": p["target_sku"],
                                      "pair_problem": problem})
            continue
        if not pairs:
            ends = rel["ends"]
            acc = ends["accessory"] if rel["relation_type"] == "accessory_for_model" else ends["adapter"]
            sides = ("model",) if rel["relation_type"] == "accessory_for_model" else ("seat", "chassis")
            has_source = any(view.sources_by_model.get(ends[s].get("model_id")) for s in sides)
            has_target = bool(view.targets_by_sku.get(str(acc.get("catalog_sku"))))
            reason = ("no_catalog_source_for_model" if not has_source else "no_catalog_target_for_sku" if not has_target
                      else "no_same_locale_pair")
            held_pairs.append({"relation_id": rel["relation_id"], "source_nid": None, "target_nid": None, "lang": None,
                               "end": None, "reason": reason})
            row["pairs_held"] += 1
            continue
        for p in pairs:
            problem = _pair_problem(p, price_of, counts, source_identities)
            if problem:
                held_pairs.append({"relation_id": rel["relation_id"], "source_nid": p["source_nid"], "target_nid": p["target_nid"],
                                   "lang": p["lang"], "end": p["end"], "reason": problem})
                row["pairs_held"] += 1
                continue
            by_pair.setdefault((p["source_nid"], p["target_nid"]), []).append((rel, p))

    envelope_edges, edge_count = {}, 0
    rows_by_id = {r["relation_id"]: r for r in rel_rows}
    for (src, tgt), support in sorted(by_pair.items()):
        types = {rel["relation_type"] for rel, _ in support}
        ends_seen = {p["end"] for _, p in support}
        models = {_model_of(rel, p["end"]) for rel, p in support}
        if len(types) > 1 or len(ends_seen) > 1 or len(models) > 1:
            for rel, p in support:
                held_pairs.append({"relation_id": rel["relation_id"], "source_nid": src, "target_nid": tgt, "lang": p["lang"],
                                   "end": p["end"], "reason": "conflicting_support_for_pair"})
                rows_by_id[rel["relation_id"]]["pairs_held"] += 1
            continue
        rels_here = sorted({rel["relation_id"]: rel for rel, _ in support}.values(), key=lambda r: r["relation_id"])
        first = support[0][1]
        bound = source_identities[src]
        claim_ids = sorted({c["claim_id"] for r in rels_here for c in r["claims"]
                            if c["assertion_type"] == "compatible" and c["effective_status"] == CLAIM_EFFECTIVE_OK})
        doc_ids = sorted({d["doc_id"] for r in rels_here for d in r["evidence"]["docs"]})
        bindings = sorted({b for r in rels_here for b in _binding_ids(r, binding_ids_of)})
        edge = {"target_nid": tgt, "target_sku": first["target_sku"], "lang": first["lang"],
                "relation_ids": _relation_ids(rels_here), "relation_type": types.pop(), "end": first["end"],
                "fit_state": "LISTED", "conditions": [], "claim_ids": claim_ids, "doc_ids": doc_ids,
                "doc_hashes": sorted({doc_hashes[d] for d in doc_ids}), "binding_ids": bindings,
                "source_model_id": models.pop(), "source_sku": bound["sku"], "source_identity": bound["identity"],
                "relation_digest": canon.digest(rels_here), "registry_version": inputs_digest,
                "synthetic": any(r["synthetic"] for r in rels_here)}
        envelope_edges.setdefault(str(src), []).append(edge)
        edge_count += 1
        for r in rels_here:
            rows_by_id[r["relation_id"]]["edges_accepted"] += 1
    for items in envelope_edges.values():
        items.sort(key=lambda e: e["target_nid"])
    envelope = {"schema": E.SCHEMA, "mode": E.MODE, "synthetic": bool(pol["allow_synthetic"]), "label": label,
                "gate": {"publish_states": ["LISTED"], "one_ended_adapter": pol["one_ended_adapter"], "veto_mode": "report",
                         "as_of": pol["as_of"], "allow_synthetic": pol["allow_synthetic"]},
                "provenance": {"relations_digest": relations_digest, "inputs_digest": inputs_digest,
                               "relations_schema": relations_schema, "gate_version": GATE_VERSION},
                "edges": envelope_edges}
    E.validate(envelope, allow_synthetic=pol["allow_synthetic"])           # the gate never writes what it would itself refuse
    veto = _veto_report(rels, view, envelope_edges)
    by_reason: dict = {}
    for row in rel_rows:
        for reason in row["reasons"]:
            by_reason[reason] = by_reason.get(reason, 0) + 1
    pair_reasons: dict = {}
    for item in held_pairs:
        pair_reasons[item["reason"]] = pair_reasons.get(item["reason"], 0) + 1
    report = {"schema": REPORT_SCHEMA, "gate": envelope["gate"], "provenance": envelope["provenance"],
              "summary": {"relations": len(rels), "accepted_relations": sum(1 for r in rel_rows if r["decision"] == "ACCEPT"),
                          "held_relations": sum(1 for r in rel_rows if r["decision"] == "HOLD"),
                          "edges_accepted": edge_count, "source_nids_with_edges": len(envelope_edges),
                          "pairs_held": len(held_pairs), "relations_held_by_reason": dict(sorted(by_reason.items())),
                          "pairs_held_by_reason": dict(sorted(pair_reasons.items())),
                          "od5_would_be_pairs": len(od5_would), "veto_candidate_relations": len(veto["candidates"]),
                          "synthetic": envelope["synthetic"]},
              "relations": rel_rows, "held_pairs": sorted(held_pairs, key=lambda h: (h["relation_id"], h["source_nid"] or 0,
                                                                                   h["target_nid"] or 0, h["reason"])),
              "od5_would_be_pairs": sorted(od5_would, key=lambda h: (h["relation_id"], h["source_nid"], h["target_nid"])),
              "veto_report": veto,
              "unmapped_brand_groups": dict(sorted(view.unmapped_brands.items())),
              "unresolved_source_groups": len(view.unresolved_sources)}
    return envelope, report


def _model_of(rel, end_name) -> str:
    return rel["ends"][end_name]["model_id"]


def _binding_ids(rel, lookup) -> list:
    if lookup is None:
        return []
    out = []
    for end in rel["ends"].values():
        if end and end.get("kind") == "article":
            found = lookup(end["maker_id"], end["mpn"])
            if found:
                out.append(found)
    return out


def _veto_report(relations, view, accepted_edges) -> dict:
    """Report-only veto: pairs an explicit OEM no-recommendation speaks about. Nothing is removed or blocked by this report."""
    accepted = {(int(src), e["target_nid"]) for src, items in accepted_edges.items() for e in items}
    candidates = sorted(r["relation_id"] for r in relations if r["veto"]["candidate"])
    pending = sorted(r["relation_id"] for r in relations if r["veto"]["pending_verification"])
    pairs = []
    for rel in relations:
        if rel["veto"]["candidate"] or rel["veto"]["pending_verification"]:
            for p in shadow.expand_pairs(rel, view):
                pairs.append({"relation_id": rel["relation_id"], "kind": "veto_candidate" if rel["veto"]["candidate"]
                              else "pending_verification", "end": p["end"], "source_nid": p["source_nid"],
                              "target_nid": p["target_nid"], "lang": p["lang"],
                              "conflicts_with_accepted_edge": (p["source_nid"], p["target_nid"]) in accepted})
    pairs.sort(key=lambda x: (x["relation_id"], x["end"], x["source_nid"], x["target_nid"]))
    return {"mode": "report", "enforced": False, "candidates": candidates, "pending_verification": pending, "pairs": pairs,
            "conflicts_with_accepted_edges": [p for p in pairs if p["conflicts_with_accepted_edge"]]}
