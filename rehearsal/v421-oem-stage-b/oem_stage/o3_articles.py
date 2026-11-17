"""O3 - article binding: exact ``(manufacturer_id, MPN)`` -> catalog SKU through evidence-backed records.

* a binding is an *identity join*, never fitment evidence and never an item-specific behaviour exception;
* GTIN, catalog title, price, similarity and manual associations are not representable: the record
  shape is strict, so such fields are rejected (ContractError) instead of ignored;
* ``bound`` needs a human-VERIFIED binding backed by an ACCEPTED ``article_identity`` claim that names the
  same manufacturer/MPN (and the SKU alias when the catalog SKU differs from the MPN);
* uniqueness is enforced both ways; any conflict makes every involved key ``conflict`` (fail closed).
"""
from __future__ import annotations

import unicodedata

from .schema import ContractError, actor_kind, check_keys, require_enum, require_str, CLAIM_STATUSES

BINDING_REQUIRED = ("binding_id", "manufacturer_id", "mpn", "catalog_sku", "evidence_claim_ids", "status",
                    "review", "proposed_by")
BINDING_OPTIONAL = ("notes",)
UNJOINED_REQUIRED = ("manufacturer_id", "mpn", "seller_skus", "reason")


def norm_mpn(mpn: str) -> str:
    """Exact article-number normalization: NFKC, trim, upper-case. Internal characters are preserved."""
    return unicodedata.normalize("NFKC", mpn).strip().upper()


class ArticleBindings:
    def __init__(self, bindings, unjoined=(), accepted_claims=None, catalog_skus=None) -> None:
        self.bindings: list = []
        self.unjoined: dict = {}
        self.accepted_claims = accepted_claims or {}
        self.catalog_skus = None if catalog_skus is None else set(catalog_skus)
        seen_ids = set()
        for rec in bindings:
            check_keys(rec, BINDING_REQUIRED, BINDING_OPTIONAL, "binding")
            for key in ("binding_id", "manufacturer_id", "mpn", "catalog_sku"):
                require_str(rec[key], "binding." + key)
            require_enum(rec["status"], CLAIM_STATUSES, "binding.status")
            if rec["binding_id"] in seen_ids:
                raise ContractError(f"duplicate binding_id {rec['binding_id']}")
            seen_ids.add(rec["binding_id"])
            if not isinstance(rec["evidence_claim_ids"], list):
                raise ContractError("binding.evidence_claim_ids must be a list")
            if rec["status"] == "PROPOSED":
                if rec["review"] is not None:
                    raise ContractError("PROPOSED binding cannot carry a review")
            else:
                check_keys(rec["review"], ("reviewer", "reviewed_utc", "note"), (), "binding.review")
                if actor_kind(rec["review"]["reviewer"]) != "human":
                    raise ContractError("binding review must be by a human reviewer")
            self.bindings.append({**rec, "_mpn": norm_mpn(rec["mpn"])})
        for rec in unjoined:
            check_keys(rec, UNJOINED_REQUIRED, (), "unjoined")
            self.unjoined[(rec["manufacturer_id"], norm_mpn(rec["mpn"]))] = rec
        self.conflicts = self._find_conflicts()

    def _active(self) -> list:
        return [b for b in self.bindings if b["status"] != "REJECTED"]

    def _find_conflicts(self) -> dict:
        """Map key -> reasons for every (maker, mpn) / sku involved in a uniqueness conflict."""
        by_article: dict = {}
        by_sku: dict = {}
        for b in self._active():
            by_article.setdefault((b["manufacturer_id"], b["_mpn"]), set()).add(b["catalog_sku"])
            by_sku.setdefault(b["catalog_sku"], set()).add((b["manufacturer_id"], b["_mpn"]))
        conflicts: dict = {}
        for key, skus in by_article.items():
            if len(skus) > 1:
                conflicts.setdefault(key, set()).add("mpn_to_multiple_skus")
        for sku, keys in by_sku.items():
            if len(keys) > 1:
                for key in keys:
                    conflicts.setdefault(key, set()).add("sku_to_multiple_articles")
        return conflicts

    def _evidence_ok(self, binding) -> tuple:
        """(ok, reasons): an accepted article_identity claim must back this exact join."""
        reasons = []
        matching = []
        for claim_id in binding["evidence_claim_ids"]:
            claim = self.accepted_claims.get(claim_id)
            if claim is None:
                reasons.append("evidence_claim_not_accepted:" + claim_id)
                continue
            a = claim["assertion"]
            if a["type"] != "article_identity":
                reasons.append("evidence_claim_wrong_type:" + claim_id)
                continue
            art = a["article"]
            same_article = (art["maker_id"] == binding["manufacturer_id"]
                            and norm_mpn(art["mpn"]) == binding["_mpn"])
            sku_ok = binding["catalog_sku"] == art["mpn"] or art["sku_alias"] == binding["catalog_sku"]
            if same_article and sku_ok:
                matching.append(claim_id)
            else:
                reasons.append("evidence_claim_does_not_name_this_join:" + claim_id)
        if not binding["evidence_claim_ids"]:
            reasons.append("no_evidence_claim")
        return bool(matching), reasons

    def lookup(self, maker_id, mpn) -> dict:
        key = (maker_id, norm_mpn(mpn))
        base = {"manufacturer_id": maker_id, "mpn": mpn, "catalog_sku": None, "binding_id": None, "reasons": []}
        if key in self.conflicts:
            return {**base, "status": "conflict", "reasons": sorted(self.conflicts[key])}
        mine = [b for b in self._active() if (b["manufacturer_id"], b["_mpn"]) == key]
        if not mine:
            why = "unjoined_candidate_unproven" if key in self.unjoined else "no_binding"
            return {**base, "status": "unbound", "reasons": [why]}
        b = mine[0]
        out = {**base, "catalog_sku": b["catalog_sku"], "binding_id": b["binding_id"]}
        if self.catalog_skus is not None and b["catalog_sku"] not in self.catalog_skus:
            return {**out, "status": "unbound", "reasons": ["sku_not_in_catalog"]}
        if b["status"] != "VERIFIED":
            return {**out, "status": "proposed", "reasons": ["binding_unverified"]}
        ok, reasons = self._evidence_ok(b)
        if not ok:
            return {**out, "status": "proposed", "reasons": sorted(set(reasons))}
        return {**out, "status": "bound", "reasons": []}

    def by_catalog_sku(self, sku) -> list:
        """Active bindings that point at a catalog SKU (used to expand OEM relations to catalog rows)."""
        return [{"manufacturer_id": b["manufacturer_id"], "mpn": b["mpn"], "binding_id": b["binding_id"]}
                for b in self._active() if b["catalog_sku"] == sku]
