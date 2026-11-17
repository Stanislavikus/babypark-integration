"""Shadow comparison of OEM relations against the *current* V4.2.1 output. Read-only: never writes engine data.

``CatalogView`` joins OEM relations to catalog NIDs through the strict O2/O3 identities (verified-or-reported model_id
and bound-or-reported article), never through title similarity. ``ManifestCurrent`` reads the V4.2.1 ``sources`` /
``evidence`` structures produced by ``build_catalog`` (or the accepted ``t2_v421_manifest.json`` /
``t2_v421_evidence.json``). Nothing here recommends anything: the output is a report.
"""
from __future__ import annotations


class CatalogView:
    """Catalog-side joins: model_id -> source NIDs, catalog SKU -> target NIDs."""

    def __init__(self) -> None:
        self.sources_by_model: dict = {}
        self.targets_by_sku: dict = {}
        self.unresolved_sources: list = []   # brand mapped to a maker, but the model string did not resolve
        self.unmapped_brands: dict = {}      # catalog brand -> number of source groups (no maker mapping: hold)

    def add_source(self, model_id, nid, tnid, lang) -> None:
        self.sources_by_model.setdefault(model_id, []).append({"nid": int(nid), "tnid": int(tnid), "lang": lang})

    def add_target(self, sku, nid, tnid, lang, field_status=None, published=None, price=None) -> None:
        self.targets_by_sku.setdefault(str(sku), []).append(
            {"nid": int(nid), "tnid": int(tnid), "lang": lang, "field_status": field_status,
             "published": published, "price": price})

    def add_source_group(self, registry, tnid, brand, brand_tid, models, nids_by_lang, maker_id=None):
        """Resolve one translation group through the registry; returns the group resolution or ``None`` (no maker)."""
        maker = maker_id or registry.maker_for_catalog_brand(brand, brand_tid)
        if maker is None:
            self.unmapped_brands[brand] = self.unmapped_brands.get(brand, 0) + 1
            return None
        res = registry.resolve_catalog_group(maker, {"models": models})
        if res["status"] == "resolved":
            for lang, nid in sorted(nids_by_lang.items()):
                self.add_source(res["model_id"], nid, tnid, lang)
        else:
            self.unresolved_sources.append({
                "tnid": int(tnid), "maker_id": maker, "status": res["status"], "models": models,
                "reasons": sorted({f"{lang}:{r['reason']}" for lang, r in res["locales"].items()}),
                "candidates": sorted({c for r in res["locales"].values() for c in r["candidates"]})})
        return res

    @classmethod
    def from_engine(cls, rows, index, registry) -> "CatalogView":
        """Build from real V4.2.1 structures: catalog ``rows`` and ``index['source_models']``."""
        view = cls()
        for tnid_s, rec in sorted(index["source_models"].items(), key=lambda kv: int(kv[0])):
            nids = {lang: loc["nid"] for lang, loc in rec["locales"].items()}
            row = rows[next(iter(sorted(nids.values())))]
            view.add_source_group(registry, tnid_s, row.get("brand"), rec.get("brand_tid"), rec.get("models") or {},
                                  nids)
        for nid, row in sorted(rows.items()):
            view.add_target(row.get("sku"), nid, row["tnid"], row["lang"], row.get("field_status"),
                            row.get("published"), row.get("price"))
        view.unresolved_sources.sort(key=lambda r: r["tnid"])
        return view


class ManifestCurrent:
    """Current V4.2.1 recommendations: ``sources[str(nid)]['accessories']`` + ``evidence[str(nid)]['targets']``."""

    kind = "v421_manifest"

    def __init__(self, sources, evidence) -> None:
        self.sources, self.evidence = sources, evidence

    def pair(self, src_nid, tgt_nid) -> dict:
        present = int(tgt_nid) in [int(x) for x in self.sources.get(str(src_nid), {}).get("accessories", [])]
        ev = self.evidence.get(str(src_nid), {}).get("targets", {}).get(str(tgt_nid), {}) if present else {}
        return {"present": present, "tier": ev.get("tier"), "reason": ev.get("reason")}


class NoCurrent:
    """No corrected-generation output available in this run: the current side is NOT evaluated."""

    kind = "not_evaluated"

    def pair(self, src_nid, tgt_nid) -> dict:
        return {"present": None, "tier": None, "reason": "current_v421_not_evaluated"}


def expand_pairs(relation, view: CatalogView) -> list:
    """Catalog (source, target) pairs an OEM relation speaks about.

    Empty when the accessory has no catalog SKU or no catalog source carries the model. Pairs carry the identity
    and binding state so a PROPOSED join is never mistaken for a verified one.
    """
    ends, pairs = relation["ends"], []
    rtype = relation["relation_type"]
    if rtype == "vehicle_general":
        return pairs
    acc = ends["accessory"] if rtype == "accessory_for_model" else ends["adapter"]
    sku = acc.get("catalog_sku")
    if not sku:
        return pairs
    side_names = ("model",) if rtype == "accessory_for_model" else ("seat", "chassis")
    for end_name in side_names:
        model_id = ends[end_name].get("model_id")
        if not model_id:
            continue
        for src in view.sources_by_model.get(model_id, []):
            for tgt in view.targets_by_sku.get(str(sku), []):
                if tgt["lang"] == src["lang"]:
                    pairs.append({"end": end_name, "source_nid": src["nid"], "source_tnid": src["tnid"],
                                  "target_nid": tgt["nid"], "target_tnid": tgt["tnid"], "lang": src["lang"],
                                  "target_sku": str(sku), "target_field_status": tgt["field_status"],
                                  "target_published": tgt["published"],
                                  "article_binding_status": acc["binding_status"],
                                  "end_identity_verified": ends[end_name]["identity_status"] == "resolved"
                                  and ends[end_name]["identity_via"] in ("canonical", "alias")})
    return pairs


def diff_class(relation, current) -> str:
    """Why current V4.2.1 and the OEM relation agree or differ for one catalog pair (report only)."""
    present, tier = current["present"], current["tier"]
    state, proposed = relation["effective_state"], relation["proposed_state"]
    if present is None:
        return "current_not_evaluated"
    if state in ("LISTED", "LISTED_CONDITIONAL"):
        if present:
            return "agree_current_recommends" if tier == "A_model" else "current_b_universal_oem_listed"
        return "oem_adds_candidate" if relation["publish"]["a_tier_candidate"] else "oem_listed_but_blocked"
    if state == "EXCLUDED":
        return "veto_candidate_conflicts_with_current" if present else "agree_absent_oem_excludes"
    if state == "CONFLICT_HOLD":
        return "current_in_conflict_hold" if present else "held_conflict"
    if proposed in ("LISTED", "LISTED_CONDITIONAL"):
        return "oem_proposed_unverified_current_has" if present else "oem_proposed_unverified_current_lacks"
    if proposed == "EXCLUDED":
        return "veto_pending_verification_conflicts_with_current" if present else "exclusion_pending_verification"
    return "current_without_oem_signal" if present else "no_signal"


VETO_CONFLICT_CLASSES = ("veto_candidate_conflicts_with_current", "veto_pending_verification_conflicts_with_current")


def compare(relations, view: CatalogView, current) -> dict:
    """Pair-level OEM-vs-current comparison. Sorted and deterministic."""
    rows, counts = [], {}
    for rel in relations:
        for pair in expand_pairs(rel, view):
            cur = current.pair(pair["source_nid"], pair["target_nid"])
            klass = diff_class(rel, cur)
            counts[klass] = counts.get(klass, 0) + 1
            rows.append({"relation_id": rel["relation_id"], "relation_type": rel["relation_type"],
                         "end": pair["end"], "lang": pair["lang"], "source_nid": pair["source_nid"],
                         "target_nid": pair["target_nid"], "target_sku": pair["target_sku"],
                         "target_field_status": pair["target_field_status"],
                         "article_binding_status": pair["article_binding_status"],
                         "end_identity_verified": pair["end_identity_verified"],
                         "oem_proposed_state": rel["proposed_state"], "oem_effective_state": rel["effective_state"],
                         "a_tier_candidate": rel["publish"]["a_tier_candidate"], "current": cur, "diff_class": klass})
    rows.sort(key=lambda r: (r["relation_id"], r["end"], r["lang"], r["source_nid"], r["target_nid"]))
    veto = {"mode": "report_only", "enforced": False,
            "candidates": sorted({r["relation_id"] for r in relations if r["veto"]["candidate"]}),
            "pending_verification": sorted({r["relation_id"] for r in relations if r["veto"]["pending_verification"]}),
            "conflicts_with_current": [r for r in rows if r["diff_class"] in VETO_CONFLICT_CLASSES]}
    return {"pairs": rows, "pair_counts": dict(sorted(counts.items())), "veto_report": veto,
            "unmapped_brand_groups": dict(sorted(view.unmapped_brands.items())),
            "unresolved_sources": view.unresolved_sources}


def stage1_gap(relations, view: CatalogView) -> dict:
    """Which catalog target-locales would need a fresh *native* Stage1 check before any publication.

    Stage1 is the downstream Drupal/Ubercart purchasability gate, never an OEM model-fit proof, and its receipts are
    not available to this stage: every entry is ``NOT_RUN``. Targets that are not ``field_status == 1`` cannot be
    recommended at all, so they are listed separately instead of asking for pointless native purchase tests.
    """
    required, blocked, seen = [], [], set()
    for rel in relations:
        if rel["proposed_state"] not in ("LISTED", "LISTED_CONDITIONAL") or rel["relation_type"] == "vehicle_general":
            continue
        end = rel["ends"]["accessory" if rel["relation_type"] == "accessory_for_model" else "adapter"]
        sku = end.get("catalog_sku")
        for tgt in view.targets_by_sku.get(str(sku), []) if sku else []:
            key = (str(sku), tgt["lang"], tgt["nid"])
            if key in seen:
                continue
            seen.add(key)
            row = {"catalog_sku": str(sku), "lang": tgt["lang"], "nid": tgt["nid"], "tnid": tgt["tnid"],
                   "field_status": tgt["field_status"], "native_stage1_receipt": "NOT_RUN"}
            (required if tgt["field_status"] == 1 else blocked).append(row)
    order = lambda r: (r["catalog_sku"], r["lang"], r["nid"])  # noqa: E731
    return {"stage1_is": "downstream native Drupal/Ubercart purchasability gate; not an OEM model-fit proof",
            "receipts_available_to_stage_b": False,
            "required_target_locales": sorted(required, key=order),
            "not_recommendable_field_status_not_1": sorted(blocked, key=order),
            "per_sku_checks": ["SKU", "TNID", "NID", "VID", "changed", "OID", "option digest", "CTA", "source context"]}
