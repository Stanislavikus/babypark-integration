"""Assemble the Stage B shadow artifacts (pure functions; no I/O except ``write_outputs``).

Artifacts: ``oem_relations.json``, ``oem_vs_current_report.json``, ``claim_status_matrix.json``,
``review_queue.json`` and ``HASHES.json`` / ``SHA256SUMS.txt``. Everything is deterministic: sorted keys, no wall
clock (``policy.as_of`` is an input), no absolute paths, no host names.
"""
from __future__ import annotations

from pathlib import Path

from . import canon, classify as cls, o1_evidence as o1, shadow
from .o3_articles import norm_mpn
from .o4_relations import RelationIndex, summarize

SCHEMA_RELATIONS = "bp-oem-relations-v1"
SCHEMA_REPORT = "bp-oem-vs-current-report-v1"
SCHEMA_MATRIX = "bp-oem-claim-status-matrix-v1"
SCHEMA_QUEUE = "bp-oem-review-queue-v1"
SHADOW_NOTICE = ("SHADOW DATA ONLY. Nothing in this file is a recommendation, a publication authorization or an "
                 "enforced veto. OD1-OD8 are owner decisions that are still PENDING; the defaults implemented here "
                 "are safe/held, not approved policy.")
OWNER_DECISIONS = [
    {"id": "OD1", "topic": "VERIFIED approval authority", "implemented_default": "human reviewer metadata required; extractor "
     "!= reviewer; LLM/parser can never verify; no reviewer approval is fabricated", "status": "PENDING_OWNER"},
    {"id": "OD2", "topic": "evidence TTL", "implemented_default": "staleness recorded (age_days); expiry only enforced "
     "when policy.ttl_days is set; never silently granted", "status": "PENDING_OWNER"},
    {"id": "OD3", "topic": "veto", "implemented_default": "report_only; any other mode is refused", "status": "PENDING_OWNER"},
    {"id": "OD4", "topic": "conditional buyer-facing copy RU/UK", "implemented_default": "LISTED_CONDITIONAL carries blocker "
     "od4_conditional_held", "status": "PENDING_OWNER"},
    {"id": "OD5", "topic": "one-ended adapter", "implemented_default": "every adapter_between relation carries blocker "
     "od5_one_ended_adapter_abstain", "status": "PENDING_OWNER"},
    {"id": "OD6", "topic": "market/language allow-list", "implemented_default": "empty allow-list => od6_allowlist_empty "
     "blocker; shadow still records evidence", "status": "PENDING_OWNER"},
    {"id": "OD7", "topic": "evidence byte storage", "implemented_default": "isolated content-addressed folder (rehearsal "
     "only); no production location/retention", "status": "PENDING_OWNER"},
    {"id": "OD8", "topic": "sole normalizer", "implemented_default": "no normalizer: strict pre-screen + exact key + "
     "scoped reviewed aliases; canonical_models.key() used for collision reporting only", "status": "PENDING_OWNER"},
]


def _policy_view(policy) -> dict:
    return {k: policy[k] for k in sorted(policy)}


def _claims_summary(matrix) -> dict:
    out = {"total": len(matrix), "by_effective_status": {}, "by_assertion_type": {}, "by_reason": {}}
    for row in matrix:
        for key, val in (("by_effective_status", row["effective_status"]), ("by_assertion_type", row["assertion_type"])):
            out[key][val] = out[key].get(val, 0) + 1
        for reason in row["reasons"]:
            out["by_reason"][reason] = out["by_reason"].get(reason, 0) + 1
    return {k: (dict(sorted(v.items())) if isinstance(v, dict) else v) for k, v in out.items()}


def claim_matrix_doc(world, relations) -> dict:
    matrix = o1.claim_matrix(world.claims, world.store, world.policy)
    feeds: dict = {}
    for rel in relations:
        for c in rel["claims"]:
            feeds.setdefault(c["claim_id"], []).append(rel["relation_id"])
    for row in matrix:
        row["relation_ids"] = sorted(feeds.get(row["claim_id"], []))
    return {"schema": SCHEMA_MATRIX, "notice": SHADOW_NOTICE, "policy": _policy_view(world.policy),
            "summary": _claims_summary(matrix), "claims": matrix,
            "documents": [{"doc_id": d["doc_id"], "issuer": d["issuer"], "url": d["url"], "market": d["market"],
                           "language": d["language"], "document_date": d["document_date"],
                           "bytes_state": world.store.check(d["doc_id"])[0], "sha256": d["sha256"],
                           "synthetic": d["synthetic"]} for d in world.store.registry()],
            "drift": o1.drift_report(world.store)}


def _binding_rows(world) -> list:
    rows = []
    for b in sorted(world.articles.bindings, key=lambda b: b["binding_id"]):
        look = world.articles.lookup(b["manufacturer_id"], b["mpn"])
        rows.append({"binding_id": b["binding_id"], "manufacturer_id": b["manufacturer_id"], "mpn": b["mpn"],
                     "catalog_sku": b["catalog_sku"], "declared_status": b["status"], "lookup_status": look["status"],
                     "reasons": look["reasons"], "evidence_claim_ids": b["evidence_claim_ids"]})
    return rows


def relations_doc(world, relations, *, engine_pins=None, collisions=None, label=None) -> dict:
    synthetic = any(r["synthetic"] for r in relations)
    aliases = [{"alias_id": a["alias_id"], "maker_id": a["maker_id"], "text": a["text"], "model_id": a["model_id"],
                "context": a["scope"]["context"], "status": a["status"]} for a in world.registry.aliases]
    return {
        "schema": SCHEMA_RELATIONS, "stage": "B-shadow", "label": label, "synthetic": synthetic,
        "notice": SHADOW_NOTICE, "policy": _policy_view(world.policy),
        "inputs": {"files": world.digests, "engine_pins": engine_pins},
        "summary": summarize(relations), "relations_digest": canon.digest(relations), "relations": relations,
        "article_bindings": {"bindings": _binding_rows(world),
                             "unjoined_candidates": [{"manufacturer_id": k[0], "mpn": v["mpn"],
                                                      "seller_skus": v["seller_skus"], "reason": v["reason"]}
                                                     for k, v in sorted(world.articles.unjoined.items())],
                             "conflicts": {f"{k[0]}:{k[1]}": sorted(v) for k, v in
                                           sorted(world.articles.conflicts.items())}},
        "identity": {"makers": sorted(world.registry.makers), "models": len(world.registry.models),
                     "aliases": sorted(aliases, key=lambda a: a["alias_id"]),
                     "canonical_models_key_collisions": collisions},
        "owner_decisions": OWNER_DECISIONS}


def review_queue_doc(world, relations, classification, collisions) -> dict:
    claims_by_doc: dict = {}
    for c in world.claims:
        if c["status"] == "PROPOSED":
            claims_by_doc[c["doc_id"]] = claims_by_doc.get(c["doc_id"], 0) + 1
    docs = []
    for doc in world.store.registry():
        state = world.store.check(doc["doc_id"])[0]
        docs.append({"doc_id": doc["doc_id"], "issuer": doc["issuer"], "url": doc["url"], "bytes_state": state,
                     "proposed_claims": claims_by_doc.get(doc["doc_id"], 0),
                     "action": "capture original bytes, then review claims" if state != "OK"
                     else "review claims against captured bytes"})
    return {
        "schema": SCHEMA_QUEUE, "notice": SHADOW_NOTICE,
        "documents_needing_bytes_or_review": [d for d in docs if d["proposed_claims"] or d["bytes_state"] != "OK"],
        "aliases_pending_review": [a["alias_id"] for a in world.registry.aliases if a["status"] == "PROPOSED"],
        "bindings_pending_review": [b["binding_id"] for b in world.articles.bindings if b["status"] == "PROPOSED"],
        "unjoined_article_candidates": sorted(f"{k[0]}:{k[1]}" for k in world.articles.unjoined),
        "relations_with_unreviewed_conditions": sorted(r["relation_id"] for r in relations
                                                       if r["conditions_review_state"] == "unknown"),
        "relations_with_unspecified_extension": sorted(r["relation_id"] for r in relations
                                                       if "extension_unspecified" in r["reasons"]),
        "catalog_identity_holds": sorted({c["case_id"] for c in classification["locale_cases"]
                                          if c["verdict"] == "HOLD_CATALOG_IDENTITY"}),
        "canonical_models_key_collisions": collisions,
        "veto_pending_verification": sorted(r["relation_id"] for r in relations if r["veto"]["pending_verification"]),
        "conflict_holds_needing_adjudication": sorted(r["relation_id"] for r in relations
                                                      if r["effective_state"] == "CONFLICT_HOLD")}


def classification_doc(world, relations, seed_cases, extras, vectors, typed, current_pairs, groups, key_fn=None) -> dict:
    idx = RelationIndex(relations)
    loc, phys = cls.classify_positives(seed_cases, extras, world.registry, idx, groups, current_pairs)
    hold = cls.classify_holdouts(seed_cases, extras, world.registry, idx, groups)
    ctrl = cls.classify_controls(extras, world.registry, idx, seed_cases["controls"])
    norm = cls.classify_normalization(seed_cases, extras, world.registry)
    probes = cls.identity_probes(world.registry)
    conds = cls.classify_conditions(vectors, typed, world.vocab, seed_cases, idx, world.registry)

    def tally(rows):
        out: dict = {}
        for r in rows:
            out[r["verdict"]] = out.get(r["verdict"], 0) + 1
        return dict(sorted(out.items()))

    counts = {"physical_relations": len(phys), "locale_cases": len(loc), "holdouts": len(hold), "controls": len(ctrl),
              "normalization": len(norm), "identity_probes": len(probes), "condition_vectors": len(conds),
              "physical_verdicts": tally(phys), "locale_verdicts": tally(loc), "holdout_verdicts": tally(hold),
              "control_verdicts": tally(ctrl),
              "publishable_now": sum(1 for r in loc + hold + ctrl if r["publishable_now"]),
              "holdouts_matching_lock": sum(1 for h in hold if h["matches_lock_expectation"]),
              "normalization_agreement": {k: sum(1 for n in norm if n["agreement"] == k)
                                          for k in sorted({n["agreement"] for n in norm})},
              "identity_probes_as_expected": sum(1 for p in probes if p["as_expected"]),
              "condition_vectors_as_expected": sum(1 for c in conds if c["as_expected"])}
    return {"counts": counts, "physical_relations": phys, "locale_cases": loc, "holdouts": hold, "controls": ctrl,
            "identity_normalization": norm, "identity_probes": probes, "condition_vectors": conds,
            "canonical_models_key_probes": None if key_fn is None else cls.key_probes(key_fn, world.registry)}


def fixture_vs_catalog(seed_cases, rows) -> dict:
    """Rehearsal check: do the PR #167 fixture NIDs/SKUs match the corrected-generation catalog rows?"""
    checks, bad = 0, []

    def check(case, nid, **want):
        nonlocal checks
        row = rows.get(int(nid))
        if row is None:
            bad.append({"case_id": case, "nid": int(nid), "problem": "nid_missing_in_catalog"})
            checks += 1
            return
        for key, val in want.items():
            checks += 1
            if val is not None and str(row.get(key)) != str(val) and not (key == "price"
                                                                          and abs(float(row[key]) - float(val)) < 1e-9):
                bad.append({"case_id": case, "nid": int(nid), "field": key, "fixture": val, "catalog": row.get(key)})

    for p in seed_cases["positives"]:
        s, t = p["source"], p["target"]
        check(p["case_id"], s["nid"], sku=s["sku"], tnid=s["tnid"], lang=p["lang"], title=s["title"])
        check(p["case_id"], t["nid"], sku=t["sku"], tnid=t["tnid"], field_status=t["field_status"],
              published=t["published"], price=t["price"])
    for h in seed_cases["holdouts"]:
        for lang, nid in h["source_nids"].items():
            check(h["case_id"], nid, tnid=h["source_tnid"], lang=lang)
        for lang, nid in h["accessory_nids"].items():
            check(h["case_id"], nid, sku=h["accessory_sku"], lang=lang, field_status=h["pr167"]["accessory_field_status"])
    return {"checks": checks, "mismatches": bad, "ok": not bad}


def report_doc(world, relations, comparison, gap, classification, *, current_side, catalog_side, baseline=None,
               fixture_check=None, label=None) -> dict:
    synthetic = any(r["synthetic"] for r in relations)
    return {
        "schema": SCHEMA_REPORT, "stage": "B-shadow", "label": label, "synthetic": synthetic, "notice": SHADOW_NOTICE,
        "as_of": world.policy["as_of"], "current_side": current_side, "catalog_side": catalog_side,
        "baseline": baseline, "relation_totals": summarize(relations),
        "pair_counts": comparison["pair_counts"], "pairs": comparison["pairs"],
        "veto_report": comparison["veto_report"],
        "unmapped_brand_groups": comparison["unmapped_brand_groups"],
        "unresolved_catalog_sources": comparison["unresolved_sources"], "stage1_gap": gap,
        "classification": classification, "fixture_vs_catalog": fixture_check,
        "honest_limits": [
            "No real OEM document bytes or human reviews are present: every real-seed claim is PROPOSED and every real "
            "relation is HOLD/UNKNOWN (effective); nothing is fabricated as VERIFIED.",
            "The current V4.2.1 side is only evaluated when a corrected-generation manifest+evidence is supplied; "
            "otherwise pairs say current_not_evaluated and PR #167's recorded values are shown as unverified fixture data.",
            "Stage1 native receipts are not available to this stage; the report lists the target-locales that need them.",
            "Stage C (the build_catalog seam) is not started and not authorized before independent acceptance of Stage B."]}


def hashes_doc(files: dict, inputs: dict) -> dict:
    return {"schema": "bp-oem-hashes-v1", "files": dict(sorted(files.items())), "inputs": dict(sorted(inputs.items()))}


def write_outputs(out_dir, docs: dict, label=None) -> dict:
    """Write ``{name: object}`` as ``name[.label].json``; return ``{filename: sha256}`` (deterministic)."""
    out_dir = Path(out_dir)
    hashes = {}
    for name, obj in sorted(docs.items()):
        fname = f"{name}.{label}.json" if label else f"{name}.json"
        hashes[fname] = canon.write_json(out_dir / fname, obj)
    return hashes
