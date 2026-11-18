"""Stage1 preparation for OEM candidates. Stage1 itself is NOT rewritten and NOT reimplemented here.

Stage1 is the existing downstream NATIVE Drupal/Ubercart purchasability gate (``STAGE1_REQUIREMENTS.md``; its receipt file is
``stage1_new_targets_validation.json`` and is joined to the catalog by ``generate_analysis.py``). It is not an OEM model-fit proof and its result is
never an argument of the matcher. This module only does two read-only things around it:

* ``plan_from_envelope`` / ``plan_from_skus``: lists exactly which target-locales (and which source contexts) would need a FRESH native check, with the
  catalog state (NID, TNID, SKU, locale, VID, changed, OID/option digest, publication, status, price) a receipt must agree with. A target whose own
  catalog state already blocks it (``field_status != 1``, unpublished, price not positive) is ``NOT_RECOMMENDABLE`` and no native test is requested.
* ``check_receipts``: compares receipts given in the EXISTING receipt format with that plan and fails closed: no receipt = ``NOT_RUN``; a receipt that
  disagrees in any field or lacks a required one = ``BLOCKED`` with the reason; ``PASS_STAGE1`` only when every field agrees. Nothing is ever
  fabricated: without a receipts file every planned check stays ``NOT_RUN``.

A ``PASS_STAGE1`` is not a recommendation, not an OEM-fit proof and not a publication authorization; ``authorizes_publication`` is always false.
"""
from __future__ import annotations

import re

from oem_intake import _stage_b, envelope as E

_stage_b.ensure_on_path()
from oem_stage import canon  # noqa: E402

PLAN_SCHEMA = "bp-oem-stage1-plan-v1"
REPORT_SCHEMA = "bp-oem-stage1-receipts-report-v1"
NOTICE = ("STAGE1 PREPARATION. Not a recommendation, not an OEM model-fit proof and not a publication authorization. A passing native receipt only "
          "shows that the node's native purchasability state agrees with the catalog row used by the replay; the OEM gate decides the relation.")
NOT_RUN, BLOCKED, PASS_STAGE1, NOT_RECOMMENDABLE = "NOT_RUN", "BLOCKED", "PASS_STAGE1", "NOT_RECOMMENDABLE"
LOCALES = ("ru", "uk")
INT_FIELDS = ("tnid", "vid", "changed")
TEXT_FIELDS = ("option_digest", "oid_weight_price_rows")
REQUIREMENTS = {
    "identity": "receipt carries sku, tnid, vid and changed and each equals the catalog row the replay used (the nid is the join key)",
    "option_rows": "option_digest and oid_weight_price_rows each equal the catalog row's (absent or empty only where the row's is empty)",
    "gates": "all_gates_pass is the literal true and native_stage1_probe.stage1_pass is the literal true",
    "cta": "native_stage1_probe.native_states contains an entry with cta == 'buy'",
    "locale": "a receipt locale field, when present, equals the target locale; every source of an edge has the target's locale",
    "source_context": "the source nid of every edge has its own current native receipt (same format, same checks)",
    "synthetic": "a receipt marked synthetic is refused unless the plan itself is synthetic",
}


class Stage1Refused(ValueError):
    """The plan or the receipts file is not acceptable input; nothing is judged."""


def _int(value):
    """An exact integer from an int or an integer-looking string; None otherwise (bool, float, empty, junk)."""
    if type(value) is int:
        return value
    if isinstance(value, str) and re.fullmatch(r"[0-9]+", value):
        return int(value)
    return None


def _text(value) -> str:
    """The comparison form of a free-form field: strings as they are, other JSON values canonically, None as the empty string."""
    if value is None:
        return ""
    return value if isinstance(value, str) else canon.canonical_json(value)


def _price_value(price):
    return str(price) if isinstance(price, float) and (price != price or price in (float("inf"), float("-inf"))) else price


def snapshot(row) -> dict:
    """The catalog state a receipt has to agree with (taken from a row of the corrected generation's catalog records)."""
    return {"nid": _int(row.get("nid")), "tnid": _int(row.get("tnid")), "sku": str(row.get("sku") or ""), "lang": str(row.get("lang") or ""),
            "vid": _int(row.get("vid")), "changed": _int(row.get("changed")), "option_digest": _text(row.get("option_digest")),
            "oid_weight_price_rows": _text(row.get("oid_weight_price_rows")), "published": _int(row.get("published")),
            "field_status": _int(row.get("field_status")), "price": _price_value(row.get("price"))}


def _price_ok(price) -> bool:
    if isinstance(price, bool):
        return False
    if isinstance(price, str):
        try:
            price = float(price)
        except ValueError:
            return False
    return isinstance(price, (int, float)) and price == price and price > 0


def blocking_reasons(snap) -> list:
    """Why the node's own catalog state already rules it out (so a native test would be wasted); empty = a native check can be requested."""
    reasons = []
    for name in ("nid", "tnid", "vid", "changed"):
        if snap[name] is None:
            reasons.append(f"catalog_row_without_{name}")
    if not snap["sku"]:
        reasons.append("catalog_row_without_sku")
    if snap["lang"] not in LOCALES:
        reasons.append("locale_not_ru_uk")
    if snap["published"] != 1:
        reasons.append("not_published")
    if snap["field_status"] != 1:
        reasons.append(f"field_status_{snap['field_status']}")
    if not _price_ok(snap["price"]):
        reasons.append("price_not_positive")
    return reasons


def _entry(row, **extra) -> dict:
    snap = snapshot(row)
    reasons = blocking_reasons(snap)
    out = {"nid": snap["nid"], "sku": snap["sku"], "lang": snap["lang"], "expected": snap,
           "state": NOT_RECOMMENDABLE if reasons else NOT_RUN, "reasons": reasons}
    out.update(extra)
    return out


def _finish(plan: dict) -> dict:
    checks = {"targets": [t["nid"] for t in plan["targets"] if t["state"] == NOT_RUN],
              "source_contexts": [s["nid"] for s in plan["source_contexts"] if s["state"] == NOT_RUN]}
    plan["native_check_nids"] = {k: sorted(v) for k, v in checks.items()}
    plan["summary"] = {"targets": len(plan["targets"]), "targets_to_check": len(checks["targets"]),
                       "targets_not_recommendable": sum(1 for t in plan["targets"] if t["state"] == NOT_RECOMMENDABLE),
                       "source_contexts": len(plan["source_contexts"]), "source_contexts_to_check": len(checks["source_contexts"]),
                       "unresolved_skus": len(plan["unresolved_skus"])}
    plan["plan_digest"] = canon.digest({k: v for k, v in plan.items() if k != "plan_digest"})
    return plan


def _base(mode, *, synthetic, inputs) -> dict:
    return {"schema": PLAN_SCHEMA, "notice": NOTICE, "mode": mode, "synthetic": bool(synthetic), "requirements": dict(REQUIREMENTS),
            "inputs": inputs, "targets": [], "source_contexts": [], "unresolved_skus": []}


def _assemble(plan, links, rows) -> dict:
    """Fill ``plan`` from ``links = [(source_nid, target_nid, lang, target_sku_or_None, relation_ids, kind)]`` after checking each against the rows."""
    sources_of: dict = {}
    relations_of: dict = {}
    kinds_of: dict = {}
    targets_of: dict = {}
    for src, tgt, lang, sku, relation_ids, kind in links:
        if src not in rows:
            raise Stage1Refused(f"link source nid {src} is not in the catalog rows")
        if tgt not in rows:
            raise Stage1Refused(f"link target nid {tgt} is not in the catalog rows")
        if sku is not None and rows[tgt].get("sku") != sku:
            raise Stage1Refused(f"link target nid {tgt}: SKU {sku!r} differs from the catalog row's")
        if rows[tgt].get("lang") != lang or rows[src].get("lang") != lang:
            raise Stage1Refused(f"link {src}->{tgt}: the locales of the source, the target and the link are not all {lang!r}")
        sources_of.setdefault(tgt, set()).add(src)
        targets_of.setdefault(src, set()).add(tgt)
        relations_of.setdefault(tgt, set()).update(relation_ids)
        kinds_of.setdefault(tgt, set()).add(kind)
    plan["targets"] = [_entry(rows[t], source_nids=sorted(sources_of[t]), relation_ids=sorted(relations_of[t]), link_kinds=sorted(kinds_of[t]))
                       for t in sorted(sources_of)]
    plan["source_contexts"] = [_entry(rows[s], target_nids=sorted(targets_of[s])) for s in sorted(targets_of)]
    return _finish(plan)


def plan_from_envelope(envelope, rows, *, allow_synthetic=False, rows_sha256=None) -> dict:
    """The native checks the targets (and source contexts) of the gate's accepted edges would need. An empty envelope gives an empty plan.

    A synthetic envelope (tests only) is refused unless ``allow_synthetic`` is explicitly set, exactly like the engine seam and the replay do."""
    try:
        E.validate(envelope, allow_synthetic=allow_synthetic)
    except E.EnvelopeError as exc:
        raise Stage1Refused(f"the envelope is not acceptable: {exc}") from None
    plan = _base("envelope", synthetic=envelope["synthetic"],
                 inputs={"envelope_digest": canon.digest(envelope), "rows_sha256": rows_sha256, "locales": list(LOCALES)})
    links = [(int(src), edge["target_nid"], edge["lang"], edge["target_sku"], edge["relation_ids"], "envelope_edge")
             for src, edges in sorted(envelope["edges"].items(), key=lambda kv: int(kv[0])) for edge in edges]
    return _assemble(plan, links, rows)


NEW_LINK_KINDS = ("new_oem_edge", "new_b_backfill_after_role_coverage")
DIFF_SCHEMA = "bp-oem-on-off-diff-v1"


def plan_from_diff(diff, rows, *, allow_synthetic=False, rows_sha256=None) -> dict:
    """The native checks every link that is NEW in the feature-ON output (compared with OFF) would need: the accepted OEM edges that were really
    published AND the generic B edges that only appear because an OEM A edge freed a slot. Edges that were already there (legacy, promoted) and
    edges that were held or dropped are not new links and get no check here."""
    if not isinstance(diff, dict) or diff.get("schema") != DIFF_SCHEMA:
        raise Stage1Refused("not a bp-oem-on-off-diff-v1 document")
    if diff.get("result") != "PASS":
        raise Stage1Refused("the ON/OFF diff has violations; fix the replay before planning native checks from it")
    if diff.get("synthetic") is not False and not allow_synthetic:
        raise Stage1Refused("the diff comes from a synthetic envelope or does not say (tests only): pass allow_synthetic explicitly")
    plan = _base("diff", synthetic=diff.get("synthetic") is not False,
                 inputs={"diff_digest": canon.digest(diff), "rows_sha256": rows_sha256, "locales": list(LOCALES)})
    links = []
    for edge in diff.get("edges", []):
        if edge.get("change") in NEW_LINK_KINDS:
            links.append((_int(edge.get("source_nid")), _int(edge.get("target_nid")), edge.get("lang"), edge.get("target_sku"),
                          edge.get("relation_ids") or [], edge["change"]))
    if any(x is None for link in links for x in link[:2]):
        raise Stage1Refused("a diff edge without integer source/target nids")
    return _assemble(plan, sorted(links, key=lambda l: (l[0], l[1])), rows)


def plan_from_skus(skus, rows, *, rows_sha256=None) -> dict:
    """The native checks a list of OEM-candidate accessory SKUs would need if their relations were ever VERIFIED (pre-flight; no edge is implied)."""
    skus = sorted({str(s) for s in skus})
    if not skus or any(not s for s in skus):
        raise Stage1Refused("at least one non-empty SKU is required")
    plan = _base("candidates", synthetic=False, inputs={"skus": skus, "rows_sha256": rows_sha256, "locales": list(LOCALES)})
    by_sku: dict = {}
    for nid in sorted(rows):
        by_sku.setdefault(str(rows[nid].get("sku") or ""), []).append(nid)
    for sku in skus:
        found = by_sku.get(sku, [])
        in_scope = [n for n in found if rows[n].get("lang") in LOCALES]
        for nid in in_scope:
            plan["targets"].append(_entry(rows[nid], source_nids=[], relation_ids=[]))
        if not found:
            plan["unresolved_skus"].append({"sku": sku, "reason": "sku_not_in_catalog_rows"})
        elif not in_scope:
            plan["unresolved_skus"].append({"sku": sku, "reason": "no_ru_uk_row"})
    plan["note"] = ("pre-flight list only: the source contexts to check are known once an OEM edge exists; run `plan --envelope` on the gate output then")
    return _finish(plan)


def _check_plan(plan) -> None:
    if not isinstance(plan, dict) or plan.get("schema") != PLAN_SCHEMA:
        raise Stage1Refused("not a bp-oem-stage1-plan-v1 document")
    if plan.get("plan_digest") != canon.digest({k: v for k, v in plan.items() if k != "plan_digest"}):
        raise Stage1Refused("plan_digest does not match the plan content (the plan was edited after it was written)")


def index_receipts(doc, *, what) -> tuple:
    """``({nid: record}, duplicates)`` from a receipt document in the existing format ``{"targets": [{"nid": ..., ...}, ...]}``."""
    if doc is None:
        return {}, set()
    if not isinstance(doc, dict) or not isinstance(doc.get("targets"), list):
        raise Stage1Refused(f"{what}: expected the existing receipt format, an object with a 'targets' list")
    by_nid: dict = {}
    duplicates: set = set()
    for rec in doc["targets"]:
        nid = _int(rec.get("nid")) if isinstance(rec, dict) else None
        if nid is None:
            raise Stage1Refused(f"{what}: a record without an integer nid")
        if nid in by_nid:
            duplicates.add(nid)
        by_nid[nid] = rec
    return by_nid, duplicates


def verify_record(expected, rec, *, plan_synthetic) -> list:
    """Every reason one receipt does not agree with the catalog state it is meant to cover (empty list = it agrees). Fails closed."""
    problems = []
    if _text(rec.get("sku")) == "":
        problems.append("missing_sku")
    elif _text(rec["sku"]) != expected["sku"]:
        problems.append("mismatch_sku")
    for name in INT_FIELDS:
        if _text(rec.get(name)) == "":
            problems.append(f"missing_{name}")
        elif _int(rec[name]) is None:
            problems.append(f"malformed_{name}")
        elif _int(rec[name]) != expected[name]:
            problems.append(f"mismatch_{name}")
    for name in TEXT_FIELDS:                      # like the existing join: an absent key equals an empty value, nothing else does
        if _text(rec.get(name)) != expected[name]:
            problems.append(f"missing_{name}" if name not in rec else f"mismatch_{name}")
    for name in ("lang", "language", "locale"):
        if name in rec and rec[name] != expected["lang"]:
            problems.append("mismatch_locale")
    probe = rec.get("native_stage1_probe")
    if rec.get("all_gates_pass") is not True:
        problems.append("all_gates_pass_not_true")
    if not isinstance(probe, dict) or probe.get("stage1_pass") is not True:
        problems.append("stage1_pass_not_true")
    states = probe.get("native_states") if isinstance(probe, dict) else None
    if not (isinstance(states, list) and any(isinstance(s, dict) and s.get("cta") == "buy" for s in states)):
        problems.append("cta_buy_not_proven")
    if rec.get("synthetic") is True and not plan_synthetic:
        problems.append("synthetic_receipt")
    return sorted(set(problems))


def _judge(entries, by_nid, duplicates, *, plan_synthetic) -> tuple:
    rows, unexpected = [], sorted(set(by_nid) - {e["nid"] for e in entries})
    for entry in entries:
        nid = entry["nid"]
        row = {"nid": nid, "sku": entry["sku"], "lang": entry["lang"], "plan_state": entry["state"], "problems": []}
        if entry["state"] == NOT_RECOMMENDABLE:
            row["state"], row["problems"] = NOT_RECOMMENDABLE, list(entry["reasons"])
            if nid in by_nid:
                row["problems"].append("receipt_present_for_a_non_recommendable_node_ignored")
        elif nid in duplicates:
            row["state"], row["problems"] = BLOCKED, ["duplicate_receipt"]
        elif nid not in by_nid:
            row["state"], row["problems"] = NOT_RUN, ["no_receipt"]
        else:
            row["problems"] = verify_record(entry["expected"], by_nid[nid], plan_synthetic=plan_synthetic)
            row["state"] = BLOCKED if row["problems"] else PASS_STAGE1
        rows.append(row)
    return rows, unexpected


def check_receipts(plan, receipts=None, source_receipts=None, *, receipts_sha256=None, source_receipts_sha256=None) -> dict:
    """Compare receipts (existing format) with the plan. Never creates or completes a receipt."""
    _check_plan(plan)
    synthetic = bool(plan["synthetic"])
    t_idx, t_dup = index_receipts(receipts, what="receipts")
    s_idx, s_dup = index_receipts(source_receipts, what="source receipts")
    targets, t_unexpected = _judge(plan["targets"], t_idx, t_dup, plan_synthetic=synthetic)
    sources, s_unexpected = _judge(plan["source_contexts"], s_idx, s_dup, plan_synthetic=synthetic)
    t_state = {r["nid"]: r["state"] for r in targets}
    s_state = {r["nid"]: r["state"] for r in sources}
    edges = []
    for t in plan["targets"]:
        for src in t["source_nids"]:
            tgt_state, src_state = t_state[t["nid"]], s_state.get(src, NOT_RUN)
            edges.append({"source_nid": src, "target_nid": t["nid"], "target_state": tgt_state, "source_context_state": src_state,
                          "stage1_cleared": tgt_state == PASS_STAGE1 and src_state == PASS_STAGE1})

    planned = [r for r in targets + sources if r["plan_state"] == NOT_RUN]

    def count(rows):
        out: dict = {}
        for r in rows:
            out[r["state"]] = out.get(r["state"], 0) + 1
        return dict(sorted(out.items()))

    return {"schema": REPORT_SCHEMA, "notice": NOTICE, "plan_digest": plan["plan_digest"], "plan_mode": plan["mode"], "synthetic": synthetic,
            "authorizes_publication": False, "oem_fit_proof": False,
            "inputs": {"receipts_sha256": receipts_sha256, "source_receipts_sha256": source_receipts_sha256,
                       "receipts_supplied": receipts is not None, "source_receipts_supplied": source_receipts is not None},
            "targets": targets, "source_contexts": sources, "edges": edges,
            "unexpected_receipts": {"targets": t_unexpected, "source_contexts": s_unexpected},
            "summary": {"targets": count(targets), "source_contexts": count(sources),
                        "edges_total": len(edges), "edges_stage1_cleared": sum(1 for e in edges if e["stage1_cleared"]),
                        "all_planned_checks_pass": bool(planned) and all(r["state"] == PASS_STAGE1 for r in planned)}}
