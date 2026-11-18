"""Reusable fictional scenarios for the seam tests (real engine modules; every envelope here is explicitly SYNTHETIC test data)."""
from __future__ import annotations

from tests import catalog_fixture as cf

A64, B64, C64 = "a" * 64, "b" * 64, "c" * 64
AS_OF = "2026-11-17"


def standard():
    """Seats Alpha 1 / Alpha 6 / Beta 1 (Zeta), strollers Frame X / Frame Y (Acme); returns ``(Inputs, handles)``.

    Legacy (current engine) output: RS-100 -> Alpha 1 and Alpha 6 (A, model title); RC-1 and MN-1 -> Frame X (A, model title);
    Frame Y has only B_universal (UN-2, UN-1, UN-3); Frame X's B rain cover UN-1 is already displaced by its A rain cover RC-1 (existing rule).
    OEM-only targets (the engine cannot find them by title): RC-9 rain cover, BG-9 bag (third-party brand), SC-5 seat cover, plus products that fail
    one engine gate each (kit, field_status 3, price 0, option profile unknown / fitment-critical, wrong domain).
    """
    cat = cf.Catalog()
    for model, sku in (("Alpha 1", "S-A1"), ("Alpha 6", "S-A6"), ("Beta 1", "S-B1")):
        cat.seat(model, sku)
    for model, sku in (("Frame X", "C-FX"), ("Frame Y", "C-FY")):
        cat.stroller(model, sku)
    cat.seat_accessory("Zeta дождевик RS-100 для автокресел Zeta Alpha 1 и Alpha 6", "Zeta дощовик RS-100 для автокрісел Zeta Alpha 1 та Alpha 6", "RS-100")
    cat.stroller_accessory("Acme дождевик RC-1 для коляски Acme Frame X", "Acme дощовик RC-1 для візка Acme Frame X", "RC-1")
    cat.stroller_accessory("Acme москитная сетка MN-1 для коляски Acme Frame X", "Acme москітна сітка MN-1 для візка Acme Frame X", "MN-1")
    for sku, ru, uk in (("UN-1", "Универсальный дождевик UN-1 для всех колясок", "Універсальний дощовик UN-1 для всіх візків"),
                        ("UN-2", "Универсальный подстаканник UN-2 для всех колясок", "Універсальний підсклянник UN-2 для всіх візків"),
                        ("UN-3", "Универсальная москитная сетка UN-3 для всех колясок", "Універсальна москітна сітка UN-3 для всіх візків")):
        cat.stroller_accessory(ru, uk, sku, brand=cf.THIRD_BRAND)
    cat.stroller_accessory("Acme дождевик RC-9", "Acme дощовик RC-9", "RC-9")
    cat.stroller_accessory("Acme сумка BG-9", "Acme сумка BG-9", "BG-9", brand=cf.THIRD_BRAND)          # cross-brand: catalog brand Nova
    cat.seat_accessory("Zeta чехол SC-5", "Zeta чохол SC-5", "SC-5")
    cat.stroller_accessory("Acme чехол KIT-1", "Acme чохол KIT-1", "KIT-1")
    cat.set("KIT-1", type="product_kit")
    cat.stroller_accessory("Acme чехол FS3-1", "Acme чохол FS3-1", "FS3-1")
    cat.set("FS3-1", field_status=3)
    cat.stroller_accessory("Acme чехол PR0-1", "Acme чохол PR0-1", "PR0-1")
    cat.set("PR0-1", price=0.0)
    cat.stroller_accessory("Acme чехол VAR-1", "Acme чохол VAR-1", "VAR-1")
    cat.stroller_accessory("Acme чехол VAR-2", "Acme чохол VAR-2", "VAR-2")
    safe, critical = cf.profile([11, 12]), cf.profile([21, 22], fitment_critical=True)
    cat.profiles = {safe["option_digest"]: safe, critical["option_digest"]: critical}
    cat.set("VAR-1", option_digest="0" * 64)                           # option digest with no known profile -> unverified
    cat.set("VAR-2", option_digest=critical["option_digest"])          # fitment-critical profile
    cat.stroller_accessory("Acme чехол OK-3", "Acme чохол OK-3", "OK-3")
    cat.set("OK-3", option_digest=safe["option_digest"])               # known, available, not fitment-critical -> passes the variant gate
    cat.seat_accessory("Zeta чехол WD-1", "Zeta чохол WD-1", "WD-1")   # a SEAT accessory offered to a stroller source -> wrong domain
    inp = cat.finish()
    return inp, cat


def edge_for(rows, target_nid, *, lang, end="model", relation_type="accessory_for_model", rel="rel:0000000000000001", model="zeta:alpha-1",
             synthetic=True, **over):
    """One envelope edge to a target given by nid (also for generated catalogs that have no reference handles)."""
    out = {"target_nid": target_nid, "target_sku": rows[target_nid]["sku"], "lang": lang, "relation_ids": [rel], "relation_type": relation_type,
           "end": end, "fit_state": "LISTED", "conditions": [], "claim_ids": ["claim:test-1"], "doc_ids": ["doc:test-1"],
           "doc_hashes": [A64], "binding_ids": ["bind:test-1"], "source_model_id": model, "relation_digest": B64,
           "registry_version": C64, "synthetic": synthetic}
    out.update(over)
    return out


def edge(inp, source, target, *, lang="ru", **kw):
    """One envelope edge for the pair (source ref, target ref) in ``lang``; returns ``(source_nid, edge)``."""
    cat = inp.catalog
    src, tgt = cat.nid(source, lang), cat.nid(target, lang)
    return src, edge_for(inp.rows, tgt, lang=lang, **kw)


def envelope(pairs, *, synthetic=True, one_ended_adapter="abstain", label="synthetic-test", **over):
    """A bp-oem-accepted-edges-v1 envelope from ``(source_nid, edge)`` pairs (edges sorted by target within a source)."""
    edges: dict = {}
    for src, e in pairs:
        edges.setdefault(str(src), []).append(e)
    for items in edges.values():
        items.sort(key=lambda e: e["target_nid"])
    doc = {"schema": "bp-oem-accepted-edges-v1", "mode": "accepted_only", "synthetic": synthetic, "label": label,
           "gate": {"publish_states": ["LISTED"], "one_ended_adapter": one_ended_adapter, "veto_mode": "report", "as_of": AS_OF,
                    "allow_synthetic": synthetic},
           "provenance": {"relations_digest": A64, "inputs_digest": B64, "relations_schema": "bp-oem-relations-v1",
                          "gate_version": "bp-oem-gate-v1"},
           "edges": edges}
    doc.update(over)
    return doc
