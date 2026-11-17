"""Converter: PR #167 evidence records and fixtures -> Stage B typed seed data.

Every produced claim, alias and binding is PROPOSED (nothing is VERIFIED, no reviewer is invented):
the PR #167 records carry ``content_sha256: null`` so no document bytes exist (lock: PROPOSED/HOLD).
The conversion is generic over record shapes; maker/model/condition specifics are *data*
(data/seeds/*.json). A name or key without a table entry makes the converter fail closed.
"""
from __future__ import annotations

import unicodedata

from . import canon, o1_evidence as o1
from .o3_articles import norm_mpn
from .schema import ContractError

EXTRACTOR = "llm:pr167-handoff-unattributed"
CREATED_BY = "parser:migrate_pr167@stage-b-1"
CREATED_UTC = "2026-11-17T00:00:00Z"
GENERIC_USE_LIMIT_KINDS = {"outdoor_only", "height_band"}
USE_LIMIT_KEYS = {"kind", "height_cm", "forbid_other_insert", "in_vehicle"}


def slug(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").lower()
    out = "".join(c if c.isalnum() else "-" for c in ascii_text)
    return "-".join(p for p in out.split("-") if p)


def media_type_for(url: str) -> str:
    if url.lower().endswith(".pdf"):
        return "application/pdf"
    return "text/plain" if url.startswith("negative-control:") else "text/html"


def conditions_from_use_limits(use_limits, kinds) -> tuple:
    """(conditions, conditions_review_state). No use_limits => ([], 'unknown'): nobody reviewed conditions."""
    ul = use_limits or {}
    unknown_keys = sorted(set(ul) - USE_LIMIT_KEYS)
    if unknown_keys:
        raise ContractError(f"use_limits: unsupported keys {unknown_keys}")
    conds: list = []
    kind = ul.get("kind")
    if kind is not None and kind not in GENERIC_USE_LIMIT_KINDS:
        if kind not in kinds:
            raise ContractError(f"use_limits.kind {kind!r} has no typed-conditions table entry")
        conds.extend(kinds[kind])
    if "height_cm" in ul:
        lo, hi = ul["height_cm"]
        conds += [{"attr": "child_height_cm", "op": "gte", "value": lo},
                  {"attr": "child_height_cm", "op": "lte", "value": hi}]
    if ul.get("forbid_other_insert"):
        conds.append({"attr": "has_other_insert", "op": "eq", "value": False})
    if ul.get("in_vehicle") is False:
        conds.append({"attr": "usage_context", "op": "in", "value": ["outside_vehicle", "on_stroller"]})
    return conds, ("reviewed_constraints" if conds else "unknown")


class _Builder:
    def __init__(self, hints, typed, positives, holdouts, controls):
        self.hints = hints["models"]
        self.kinds = typed["kinds"]
        self.store = o1.DocumentStore()
        self.claims: list = []
        self.makers: dict = {}
        self.models: dict = {}
        self.bindings: list = []
        self.unjoined: list = []
        self.positives, self.holdouts, self.controls = positives, holdouts, controls
        self.sku_map = {r["target_sku_oem_base"]: r["target_sku_catalog"] for r in positives}

    def maker(self, name: str) -> str:
        mid = slug(name)
        self.makers.setdefault(mid, {"maker_id": mid, "names": set(), "catalog_brands": set()})["names"].add(name)
        return mid

    def ensure_model(self, maker_id: str, display: str, kind: str) -> str:
        self.maker(maker_id)
        model_id = f"{maker_id}:{slug(display)}"
        self.models.setdefault(model_id, {"model_id": model_id, "maker_id": maker_id, "display": display,
                                          "kind": kind})
        return model_id

    def owner(self, name: str, default_maker=None):
        if name in self.hints:
            maker_id, kind = self.hints[name]
            return self.maker(maker_id), kind
        if default_maker is None:
            raise ContractError(f"model {name!r} has no maker hint (fail closed)")
        return default_maker, "car_seat"

    def add_claim(self, doc, ref, assertion):
        claim = o1.new_claim(doc=doc, locator={"kind": "record_ref", "ref": ref}, quote=None, assertion=assertion,
                             extracted_by=EXTRACTOR, created_by=CREATED_BY, created_utc=CREATED_UTC)
        self.claims.append(claim)
        return claim

    # ------------------------------------------------------------------ one evidence record
    def record(self, rec, supplement) -> None:
        maker = self.maker(rec["manufacturer"])
        d = rec["document"]
        doc = self.store.register_without_bytes(
            issuer=maker, media_type=media_type_for(d["url"]), url=d["url"], document_version=d["version"],
            document_date=d["retrieved_at"], market=d["region"], language=d["language"],
            retrieved_utc=d["retrieved_at"] + "T00:00:00Z", captured_by=CREATED_BY,
            notes="PR #167 record without bytes (content_sha256 null). document_date is the retrieval date; "
                  "the OEM publication/revision date is unknown.")
        key, mpn = rec["evidence_key"], rec["oem_article"]
        base = f"pr167:oem_evidence/{key}"
        complete = not any(w in (rec.get("completeness_state") or "") for w in ("subset", "partial"))
        conds, state = conditions_from_use_limits(rec.get("use_limits"), self.kinds)
        adapter_end = {"maker_id": maker, "mpn": mpn}
        for name in rec.get("confirmed_models") or []:
            owner, kind = self.owner(name, maker)
            self.ensure_model(owner, name, kind)
            self.add_claim(doc, f"{base}#confirmed_models/{name}", {
                "type": "compatible", "relation_type": "accessory_for_model", "conditions": conds,
                "conditions_review_state": state,
                "ends": {"accessory": adapter_end, "model": {"maker_id": owner, "name": name}}})
        for name in rec.get("explicit_absent_models") or []:
            owner, kind = self.owner(name, maker)
            self.ensure_model(owner, name, kind)
            self.add_claim(doc, f"{base}#explicit_absent_models/{name}", {
                "type": "absent_from_list", "relation_type": "accessory_for_model", "list_complete": complete,
                "ends": {"accessory": adapter_end, "model": {"maker_id": owner, "name": name}}})
        iface = rec.get("interface")
        if iface:
            self._interface(doc, base, maker, mpn, iface)
        for sup in supplement:
            if sup["evidence_key"] == key:
                self._supplement(doc, maker, mpn, sup)
        if rec.get("never_ab"):
            self.add_claim(doc, base + "#never_ab", {
                "type": "compatible", "relation_type": "vehicle_general", "conditions": [],
                "conditions_review_state": "verified_none", "ends": {"accessory": adapter_end}})
        if not (rec.get("confirmed_models") or iface or rec.get("never_ab")):
            for ctl in self.controls:
                if ctl["target_sku"] == mpn:
                    owner, kind = self.owner(ctl["source_model"], maker)
                    self.ensure_model(owner, ctl["source_model"], kind)
                    self.add_claim(doc, f"pr167:fixtures/NEGATIVE_AND_CONDITIONAL_CONTROLS.csv#{ctl['control']}", {
                        "type": "absent_from_list", "relation_type": "accessory_for_model", "list_complete": False,
                        "ends": {"accessory": adapter_end, "model": {"maker_id": owner, "name": ctl["source_model"]}}})
        self._article(doc, rec, maker, mpn, base)

    def _interface(self, doc, base, maker, mpn, iface) -> None:
        adapter = {"maker_id": maker, "mpn": mpn}

        def ends(seat, chassis, extension=None):
            s_owner, s_kind = self.owner(seat)
            c_owner, c_kind = self.owner(chassis)
            self.ensure_model(s_owner, seat, s_kind)
            self.ensure_model(c_owner, chassis, c_kind)
            out = {"seat": {"maker_id": s_owner, "name": seat}, "adapter": adapter,
                   "chassis": {"maker_id": c_owner, "name": chassis}}
            if extension is not None:
                out["extension"] = extension
            return out

        def compat(seat, chassis, conds, state, ref, extension=None):
            self.add_claim(doc, ref, {"type": "compatible", "relation_type": "adapter_between",
                                      "conditions": conds, "conditions_review_state": state,
                                      "ends": ends(seat, chassis, extension)})

        if "seat_models" in iface:  # one adapter page, explicit chassis rows
            comp = iface.get("required_component")
            conds = [{"attr": "carrier_component", "op": "eq", "value": comp}] if comp else []
            for seat in iface["seat_models"]:
                for ch in iface["chassis"]:
                    ext = ({"required": True, "maker_id": None, "mpn": None, "name": None}
                           if ch.get("attachment") == "extension_adapter_required" else None)
                    compat(seat, ch["model"], conds, "reviewed_constraints" if conds else "unknown",
                           f"{base}#interface/{seat}/{ch['model']}", ext)
            for seat in iface.get("explicit_absent_models") or []:
                for ch in iface["chassis"]:
                    self.add_claim(doc, f"{base}#interface/absent/{seat}/{ch['model']}", {
                        "type": "absent_from_list", "relation_type": "adapter_between", "list_complete": True,
                        "ends": ends(seat, ch["model"])})
        for lst in iface.get("lists") or []:
            need = set(lst.get("component_confirmation_required_models") or [])
            for ch in lst["chassis_models"]:
                for seat in lst.get("confirmed_models") or []:
                    if seat in need and lst.get("confirmed_component"):
                        conds = [{"attr": "carrier_component", "op": "eq", "value": lst["confirmed_component"]}]
                        compat(seat, ch, conds, "reviewed_constraints", f"{base}#lists/{ch}/{seat}")
                    else:
                        compat(seat, ch, [], "unknown", f"{base}#lists/{ch}/{seat}")
                for seat in lst.get("explicit_absent_models") or []:
                    self.add_claim(doc, f"{base}#lists/{ch}/absent/{seat}", {
                        "type": "absent_from_list", "relation_type": "adapter_between", "list_complete": True,
                        "ends": ends(seat, ch)})
                for seat in lst.get("explicit_reject_models") or []:
                    self.add_claim(doc, f"{base}#lists/{ch}/reject/{seat}", {
                        "type": "not_recommended", "relation_type": "adapter_between", "ends": ends(seat, ch),
                        "scope_note": "scoped to this exact seat + adapter + chassis"})

    def _supplement(self, doc, maker, mpn, sup) -> None:
        t = sup["template"]
        for ch_maker, ch_name in t["chassis"]:
            s_maker, s_name = t["seat"]
            self.ensure_model(s_maker, s_name, "car_seat")
            self.ensure_model(ch_maker, ch_name, "chassis")
            self.add_claim(doc, f"{sup['locator_ref']}/{ch_name}", {
                "type": t["type"], "relation_type": t["relation_type"], "as_of": t["as_of"],
                "ends": {"seat": {"maker_id": t["seat"][0], "name": t["seat"][1]},
                         "adapter": {"maker_id": t["adapter"][0], "mpn": t["adapter"][1]},
                         "chassis": {"maker_id": ch_maker, "name": ch_name}}})

    def _article(self, doc, rec, maker, mpn, base) -> None:
        cands = set(rec.get("catalog_skus") or [])
        if mpn in self.sku_map:
            cands.add(self.sku_map[mpn])
        chosen = None
        if len(cands) == 1:
            chosen = next(iter(cands))
        elif len(cands) > 1:
            if mpn in self.sku_map and self.sku_map[mpn] in cands:
                chosen = self.sku_map[mpn]
            else:
                raise ContractError(f"article {mpn}: ambiguous catalog SKU candidates {sorted(cands)}")
        alias = chosen if chosen not in (None, mpn) else None
        ident = self.add_claim(doc, base + "#article", {"type": "article_identity", "article": {
            "maker_id": maker, "mpn": mpn, "role": rec["accessory_type"], "sku_alias": alias}})
        if chosen:
            self.bindings.append({
                "binding_id": f"bnd:{maker}:{norm_mpn(mpn)}", "manufacturer_id": maker, "mpn": mpn,
                "catalog_sku": chosen, "evidence_claim_ids": [ident["claim_id"]], "status": "PROPOSED",
                "review": None, "proposed_by": CREATED_BY,
                "notes": "PR #167 joined this OEM article to the catalog SKU without document bytes"})
        if rec.get("unjoined_seller_skus"):
            self.unjoined.append({"manufacturer_id": maker, "mpn": mpn,
                                  "seller_skus": sorted(rec["unjoined_seller_skus"]),
                                  "reason": "PR #167: no audited OEM-article mapping; name similarity is insufficient"})


def build_seed_data(evidence_doc, positives, holdouts, controls, hints, typed, supplement, alias_seeds) -> dict:
    """Return the typed seed data as plain JSON-serializable structures (deterministic ordering)."""
    b = _Builder(hints, typed, positives, holdouts, controls)
    for rec in evidence_doc["oem_evidence"]:
        b.record(rec, supplement["claims"])
    for row in positives:  # catalog brand strings as printed in the catalog (explicit brand->maker join)
        mid = slug(row["source_brand"])
        if mid in b.makers:
            b.makers[mid]["catalog_brands"].add(row["source_brand"])
    aliases = []
    for seed in alias_seeds["aliases"]:
        model_id = f"{seed['maker_id']}:{slug(seed['model_display'])}"
        if model_id not in b.models:
            raise ContractError(f"alias seed targets unknown model {model_id}")
        aliases.append({"alias_id": "als:" + canon.digest([seed["maker_id"], seed["context"], seed["text"]])[:12],
                        "maker_id": seed["maker_id"], "text": seed["text"], "model_id": model_id,
                        "scope": {"context": seed["context"]}, "status": "PROPOSED", "review": None,
                        "notes": seed["note"]})
    makers = [{"maker_id": m["maker_id"], "names": sorted(m["names"]), "catalog_brands": sorted(m["catalog_brands"])}
              for m in sorted(b.makers.values(), key=lambda x: x["maker_id"])]
    return {
        "documents": b.store.registry(),
        "claims": sorted(b.claims, key=lambda c: c["claim_id"]),
        "makers": makers,
        "models": sorted(b.models.values(), key=lambda m: m["model_id"]),
        "aliases": sorted(aliases, key=lambda a: a["alias_id"]),
        "bindings": sorted(b.bindings, key=lambda x: x["binding_id"]),
        "unjoined": sorted(b.unjoined, key=lambda x: (x["manufacturer_id"], x["mpn"])),
    }
