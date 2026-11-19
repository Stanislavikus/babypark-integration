#!/usr/bin/env python3
"""Per-claim sufficiency assessment of the 53 Stage B seed claims against the browser captures (stdlib only, deterministic).

Reads:   ../v421-oem-stage-b/data/seeds/claims.json, documents.json and captures/CAPTURE_*.json
Writes:  evidence/CLAIM_ASSESSMENT.json, evidence/CLAIM_ASSESSMENT.csv, evidence/COVERAGE_REPORT_CAPTURED.json,
         evidence/HUMAN_REVIEW_QUEUE_CAPTURED.json, evidence/CAPTURE_INDEX.json

It NEVER writes a claim status.  The "suggested_oem_state" field is a hint for the human reviewer, not a state; nothing here is VERIFIED.
Names are matched exactly or by punctuation only; a longer/shorter model name is NEVER an alias (generation rule).
"""
from __future__ import annotations
import csv, json, re, sys
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
STAGE_B = HERE.parent / "v421-oem-stage-b"
CAPS = HERE / "captures"
OUT = HERE / "evidence"
SCHEMA = "bp-oem-claim-assessment-v1"

def load(p): return json.loads(Path(p).read_text(encoding="utf-8"))
def canon(o): return json.dumps(o, sort_keys=True, indent=1, ensure_ascii=False) + "\n"

def norm(s: str) -> str:
    s = s.lower().replace("-", " ").replace("®", "")
    for b in ("maxi cosi ", "besafe ", "britax römer ", "britax romer ", "bugaboo "):
        if s.startswith(b): s = s[len(b):]
    return re.sub(r"\s+", " ", s).strip()

def strip_brand(e: str) -> str:
    for b in ("Maxi-Cosi ", "BeSafe ", "Britax Römer ", "Britax Romer ", "Bugaboo "):
        if e.startswith(b): return e[len(b):]
    return e

def match_name(claim_name: str, page_entries: list[str]) -> dict:
    """exact (maker prefix ignored) | punctuation_variant | suffix_variant (needs identity decision) | not_listed. Never an alias."""
    for e in page_entries:
        if e.strip() == claim_name.strip() or strip_brand(e.strip()) == claim_name.strip(): return {"match": "exact", "page_entry": e.strip()}
    c = norm(claim_name)
    for e in page_entries:
        if norm(e) == c: return {"match": "punctuation_variant", "page_entry": e.strip()}
    cand = [e.strip() for e in page_entries if norm(e).startswith(c + " ")]
    if cand: return {"match": "suffix_variant_NEEDS_IDENTITY_DECISION", "page_entry": cand[0], "all_candidates": cand}
    return {"match": "not_listed", "page_entry": None}

CAP = {p.name: load(p) for p in sorted(CAPS.glob("CAPTURE_*.json"))}
BY_SEED = {c["seed_doc_id"]: (n, c) for n, c in CAP.items()}
DOCS = {d["doc_id"]: d for d in load(STAGE_B / "data/seeds/documents.json")["documents"]}
CLAIMS = load(STAGE_B / "data/seeds/claims.json")["claims"]

DF = BY_SEED["doc:8b27a7246e3541d0"][1]; FOX = BY_SEED["doc:b00a78102f589f76"][1]
RELAX = BY_SEED["doc:bac1a286d1860ffb"][1]; COMF = BY_SEED["doc:c2ef54b501b55631"][1]
CORAL = BY_SEED["doc:381465952729913b"][1]; BESAFE = BY_SEED["doc:3d6c5125466e6847"][1]

DF_SEATS = DF["sections_in_raw_bytes"]["car_seat_compatibility_accordion"]
DF_CHASSIS = [x.replace("Bugaboo ", "") for x in DF["sections_in_raw_bytes"]["compatible_products_accordion"]]
FOX_LISTS = FOX["car_seat_lists_by_chassis_heading"]
FOX_HEADING_SCOPE = {"Fox 5 & 5 Renew:": ["Fox 5", "Fox 5 Renew"], "Fox 2:": ["Fox 2"]}  # read from the heading text itself
RELAX_LIST = RELAX["available_for_these_products_text"]; COMF_LIST = COMF["available_for_these_products_text"]

def label(ends: dict) -> str:
    def one(v): return f"{v.get('maker_id')}:{v.get('name') or v.get('mpn')}" if isinstance(v, dict) else str(v)
    return " | ".join(f"{k}={one(v)}" for k, v in sorted(ends.items()) if v)

def base(i, c):
    a = c["assertion"]; cap_name, cap = BY_SEED[c["doc_id"]] if c["doc_id"] in BY_SEED else (None, None)
    ends = a.get("ends") or {}
    return {"claim_index": i, "claim_id": c["claim_id"], "assertion_type": a["type"], "relation_type": a.get("relation_type"),
            "subject": label({k: v for k, v in ends.items()}) if ends else json.dumps(a.get("article") or a.get("accessory") or a, ensure_ascii=False, sort_keys=True),
            "seed_doc_id": c["doc_id"], "seed_doc_url": DOCS[c["doc_id"]].get("url"),
            "capture_file": cap_name, "capture_sha256": cap["sha256"] if cap else None,
            "declared_status": c["status"], "restrictions": [], "conflicts": [], "uncertainty": [], "evidence": [], "generation_notes": []}

def finish(r, assessment, sufficiency, hint, action):
    r.update({"assessment": assessment, "sufficiency": sufficiency, "suggested_oem_state_HINT_not_a_state": hint, "reviewer_action": action,
              "assigned_status": "none (PROPOSED stays PROPOSED)"})
    return r

def assess(i, c):
    a = c["assertion"]; t = a["type"]; r = base(i, c); did = c["doc_id"]
    ends = a.get("ends") or {}
    # ---------- Bugaboo Dragonfly 400003001 ----------
    if did == "doc:8b27a7246e3541d0":
        chassis = (ends.get("chassis") or {}).get("name"); seat = (ends.get("seat") or {}).get("name")
        qa = DF["qa_widget_text_not_in_page_bytes"]["entries"]
        if t == "article_identity":
            r["evidence"].append({"where": "raw HTML accordion 'Top features'", "quote": "Product Code: 400003001"})
            return finish(r, "SUPPORTED_ARTICLE_IDENTITY", "SUFFICIENT_FOR_HUMAN_REVIEW", "article identity (OEM side)", "confirm after bytes are registered; the catalog SKU join stays a separate human decision")
        chassis_ok = chassis in DF_CHASSIS
        r["evidence"].append({"where": "raw HTML accordion 'Compatible products'", "quote": f"Bugaboo {chassis}" if chassis_ok else None, "chassis_named_on_page": chassis_ok})
        m = match_name(seat, DF_SEATS); r["seat_name_match"] = m
        if chassis == "Dragonfly Plus": r["generation_notes"].append("'Dragonfly Plus' is its own entry in 'Compatible products'; the Dragonfly entry is not used for it")
        r["uncertainty"].append("one flat seat list and one flat chassis list: the seat x chassis pair is implied by the two product-level lists, not stated per pair")
        if t == "compatible":
            r["evidence"].append({"where": "raw HTML accordion 'Car seat compatibility'", "quote": m["page_entry"]})
            ok = chassis_ok and m["match"] in ("exact", "punctuation_variant")
            return finish(r, "SUPPORTED_PAGE_LEVEL_CROSS_LIST" if ok else "NOT_SUPPORTED", "SUFFICIENT_FOR_HUMAN_REVIEW" if ok else "HOLD", "LISTED" if ok else "UNKNOWN", "human confirms that the pair may be read from the two product-level lists")
        if t == "absent_from_list":
            r["evidence"].append({"where": "raw HTML accordion 'Car seat compatibility'", "quote": None, "note": f"'{seat}' does not occur in the list"})
            r["conflicts"].append("Q&A (Bazaarvoice, not in page bytes): an older Bugaboo Service answer names 'Maxi-Cosi Pebble 360 Pro 2' among seats 'tested and confirmed as compatible'; the newest answer says it has not been tested and is not compatible")
            return finish(r, "ABSENCE_ONLY_WITH_CONFLICTING_QA", "HOLD", "UNKNOWN or CONFLICT_HOLD (never EXCLUDED from absence)", "do not turn absence into EXCLUDED; resolve the Q&A conflict with an official Bugaboo statement")
        if t == "not_tested_at_time":
            r["evidence"].append({"where": "Q&A widget text (rendered, not byte-captured)", "quote": "has not been tested with the car seat Maxi Cosi pebble 360 pro v2", "age": "answered 7 days before retrieval"})
            r["conflicts"].append("an older answer (a year ago) lists 'Maxi-Cosi Pebble 360 Pro 2' as tested and confirmed compatible")
            r["uncertainty"].append("the statement is about the Dragonfly adapter in general ('v2' naming), not specifically about 'Dragonfly Plus'" if chassis == "Dragonfly Plus" else "'v2' naming vs 'Pebble 360 Pro 2' needs a Maxi-Cosi identity decision")
            return finish(r, "STATEMENT_SEEN_NOT_BYTE_BACKED_AND_CONFLICTING", "HOLD", "CONFLICT_HOLD", "needs byte capture of the Q&A source and an official resolution; do not publish")
        if t == "not_recommended":
            r["evidence"].append({"where": "Q&A widget text (rendered, not byte-captured)", "quote": "we do not recommend using it with the Dragonfly", "age": "answered a year before retrieval"})
            if chassis == "Dragonfly Plus":
                r["generation_notes"].append("the statement says 'Dragonfly' only; it is NOT transferred to 'Dragonfly Plus'")
                return finish(r, "NOT_SUPPORTED_FOR_THIS_GENERATION", "HOLD", "UNKNOWN (absence from the page list only)", "needs its own sentence for Dragonfly Plus; otherwise keep as absence")
            return finish(r, "STATEMENT_SEEN_NOT_BYTE_BACKED", "HOLD", "possible EXCLUDED (scoped OEM no-recommendation) after byte capture and human review", "byte-capture the Q&A source; scope = Dragonfly adapter 400003001 x CabrioFix")
    # ---------- Bugaboo Fox 400019001 ----------
    if did == "doc:b00a78102f589f76":
        chassis = (ends.get("chassis") or {}).get("name"); seat = (ends.get("seat") or {}).get("name")
        if t == "article_identity":
            r["evidence"].append({"where": "raw HTML accordion 'Car seat compatibility'", "quote": "Product Code: 400019001"})
            return finish(r, "SUPPORTED_ARTICLE_IDENTITY", "SUFFICIENT_FOR_HUMAN_REVIEW", "article identity (OEM side)", "confirm after bytes are registered; the catalog SKU join stays a separate human decision")
        heading = next((h for h, sc in FOX_HEADING_SCOPE.items() if chassis in sc), None)
        r["evidence"].append({"where": "raw HTML <strong> heading", "quote": heading, "raw_byte_offset": FOX["raw_byte_offsets"].get("heading_Fox_5_and_5_Renew") if heading and "5" in heading else FOX["raw_byte_offsets"].get("heading_Fox_2")})
        lst = FOX_LISTS.get(heading, []); m = match_name(seat, lst); r["seat_name_match"] = m
        if chassis in ("Fox 5", "Fox 5 Renew"): r["generation_notes"].append("heading 'Fox 5 & 5 Renew:' names both chassis explicitly; nothing is inferred from Fox 3 / Fox 2 / Fox Cub lists")
        if t == "compatible":
            r["evidence"].append({"where": f"list under '{heading}'", "quote": m["page_entry"]})
            if m["match"] == "exact": return finish(r, "SUPPORTED_BY_PER_CHASSIS_LIST", "SUFFICIENT_FOR_HUMAN_REVIEW", "LISTED", "confirm after bytes are registered")
            if m["match"] == "punctuation_variant":
                r["uncertainty"].append(f"page writes '{m['page_entry']}', claim writes '{seat}' (spacing/hyphen only)")
                return finish(r, "SUPPORTED_BY_PER_CHASSIS_LIST_PUNCTUATION_VARIANT", "SUFFICIENT_FOR_HUMAN_REVIEW", "LISTED", "confirm after bytes are registered; confirm the seat name variant")
            if m["match"].startswith("suffix"):
                r["uncertainty"].append(f"page entry '{m['page_entry']}' is longer than the claim seat '{seat}'; not an automatic alias")
                return finish(r, "LISTED_UNDER_DIFFERENT_NAME_NEEDS_IDENTITY_DECISION", "HOLD", "UNKNOWN until the identity decision (Maxi-Cosi page)", "a human decides whether 'Pebble 360 Pro 2 i Size' is the catalog 'Pebble 360 Pro 2', with an official Maxi-Cosi source")
            return finish(r, "NOT_SUPPORTED", "HOLD", "UNKNOWN", "seat not listed")
        if t == "absent_from_list":
            r["evidence"].append({"where": f"list under '{heading}'", "quote": None, "note": f"'{seat}' does not occur; the list has no 'Pebble 360 Pro' / 'Pebble 360 Pro 2' entry"})
            return finish(r, "ABSENCE_ONLY", "SUFFICIENT_FOR_HUMAN_REVIEW", "UNKNOWN (never EXCLUDED: the page has no exclusion sentence)", "confirm only the absence; do not promote to EXCLUDED")
    # ---------- Britax relax insert ACCSFCC207 ----------
    if did == "doc:bac1a286d1860ffb":
        if t == "article_identity":
            r["evidence"].append({"where": "raw HTML utag_data / cq_params", "quote": "\"product_master_id\": [ \"ACCSFCC207\" ]", "also": "product_id/sku 2000040775; product_ean 4000984938036"})
            r["uncertainty"].append("seed binding bnd:britax-romer:ACCSFCC207 had an unproven seller SKU 2000040775; the page markup now ties it to the master id, the catalog row still has to be matched by a human")
            return finish(r, "SUPPORTED_ARTICLE_IDENTITY_WITH_SKU_EVIDENCE", "SUFFICIENT_FOR_HUMAN_REVIEW", "article identity (OEM side)", "confirm after bytes are registered; match catalog SKU/EAN by a human")
        model = (a.get("model") or {}).get("name") if isinstance(a.get("model"), dict) else None
        model = model or (ends.get("model") or {}).get("name") or a.get("model_name")
        return None  # handled below when model is extracted by caller
    return None

def model_of(c):
    a = c["assertion"]; mo = a.get("model")
    if isinstance(mo, dict): return mo.get("name")
    return mo or (a.get("ends") or {}).get("model", {}).get("name")

def assess_insert(i, c, cap, lst, label_doc):
    a = c["assertion"]; t = a["type"]; r = base(i, c); model = model_of(c)
    if t == "article_identity": return None
    m = match_name(model, lst); r["model_name_match"] = m
    r["evidence"].append({"where": "raw HTML 'Available for these products'", "quote": m["page_entry"], "raw_byte_offset": cap["raw_byte_offsets"]["available_for_these_products"]})
    r["restrictions"].append(cap["conditions_text_verbatim"])
    if t == "compatible":
        if m["match"] != "exact": return finish(r, "NOT_SUPPORTED", "HOLD", "UNKNOWN", "model not listed exactly")
        if label_doc == "relax" and model == "SWINGFIX M PLUS":
            r["uncertainty"].append("listed under 'Available for these products', but the description speaks only of 'our DUALFIX seats' (61-87 cm); SWINGFIX is not a DUALFIX")
            return finish(r, "LISTED_WITH_INTERNAL_PAGE_INCONSISTENCY", "HOLD_UNTIL_HUMAN_DECISION", "LISTED_CONDITIONAL (only if the reviewer accepts the list over the description)", "a human decides; ask Britax if the description is meant to cover SWINGFIX M PLUS")
        return finish(r, "SUPPORTED_BY_LIST_WITH_CONDITIONS", "SUFFICIENT_FOR_HUMAN_REVIEW", "LISTED_CONDITIONAL", "confirm after bytes are registered; the engine must carry the conditions")
    if t == "absent_from_list":
        r["evidence"][0]["quote"] = None; r["evidence"][0]["note"] = f"'{model}' does not occur in the list; the page has no exclusion sentence"
        if model == "SWIVEL": r["generation_notes"].append("'SWIVEL 2' is listed, 'SWIVEL' is not: the listing must not be transferred between generations, and absence is not EXCLUDED")
        return finish(r, "ABSENCE_ONLY", "SUFFICIENT_FOR_HUMAN_REVIEW" if m["match"] in ("not_listed", "suffix_variant_NEEDS_IDENTITY_DECISION") else "HOLD", "UNKNOWN (never EXCLUDED)", "confirm only the absence; do not promote to EXCLUDED")
    return None

def main(write=True):
    rows = []
    for i, c in enumerate(CLAIMS):
        did = c["doc_id"]; a = c["assertion"]; t = a["type"]
        r = assess(i, c)
        if r is None and did == "doc:bac1a286d1860ffb": r = assess_insert(i, c, RELAX, RELAX_LIST, "relax")
        if r is None and did == "doc:c2ef54b501b55631":
            if t == "article_identity":
                r = base(i, c); r["evidence"].append({"where": "raw HTML utag_data", "quote": "\"product_master_id\": [ \"4406\" ]", "also": "product_id/sku 2000030111; product_ean 4000984194777"})
                r["uncertainty"].append(COMF["article_identity_in_raw_bytes"]["DISCREPANCY"])
                r = finish(r, "IDENTITY_MISMATCH_NEEDS_DECISION", "HOLD_UNTIL_HUMAN_DECISION", "article identity not decided", "a human decides whether the repository MPN is 4406 (master id) or 2000030111 (SKU); the seed value is not rewritten")
            else: r = assess_insert(i, c, COMF, COMF_LIST, "comfort")
        if r is None and did == "doc:381465952729913b":
            r = base(i, c); ends = a.get("ends") or {}
            if t == "article_identity":
                r["evidence"].append({"where": "raw HTML specification", "quote": "SKU: 1166057110", "also": "EAN: 3220660010097"})
                r["uncertainty"].append("seed URL redirects to 'Coral Carrier adapter - Fame'; document URL must be recorded as the final URL")
                r = finish(r, "SUPPORTED_ARTICLE_IDENTITY", "SUFFICIENT_FOR_HUMAN_REVIEW", "article identity (OEM side)", "confirm after bytes are registered")
            else:
                chassis = ends["chassis"]["name"]; seat = ends["seat"]["name"]
                r["generation_notes"].append("'Fame' and 'Fame Cabin' are named separately in the same sentence; no transfer between them")
                if t == "compatible" and chassis == "Fame Cabin":
                    r["evidence"].append({"where": "FAQ 'Which products can I use the Coral Slide Pro Carrier adapter with?'", "quote": "The adapter clicks directly onto the Fame Cabin frame"})
                    r = finish(r, "SUPPORTED_EXPLICIT_SENTENCE", "SUFFICIENT_FOR_HUMAN_REVIEW", "LISTED", "confirm after bytes are registered")
                elif t == "compatible" and chassis == "Fame":
                    r["evidence"].append({"where": "FAQ 'Which products can I use the Coral Slide Pro Carrier adapter with?'", "quote": "can be installed on the Fame by attaching the included adapter-extension set"})
                    r["restrictions"].append("Fame needs the adapter-extension set (stated as included)")
                    r["uncertainty"].append("seed has an unknown extension end ('?|None'): the extension's own MPN/SKU is not on this page; read it from the manual or box contents, do not guess")
                    r = finish(r, "SUPPORTED_WITH_EXTENSION_CONDITION", "SUFFICIENT_FOR_HUMAN_REVIEW", "LISTED_CONDITIONAL (both ends: adapter + extension)", "confirm after bytes are registered; extension identity from the manual")
                elif t == "absent_from_list":
                    r["evidence"].append({"where": "whole page", "quote": None, "note": f"'{seat}' does not occur anywhere on the page (0 hits)"})
                    r = finish(r, "ABSENCE_ONLY", "SUFFICIENT_FOR_HUMAN_REVIEW", "UNKNOWN (never EXCLUDED)", "confirm only the absence; the page lists no seats other than Coral Slide Pro")
        if r is None and did == "doc:3d6c5125466e6847":
            r = base(i, c); model = model_of(c)
            r["evidence"].append({"where": "PDF page 1 (English block)", "quote": "do not use the Rain shield on the BeSafe iZi Go inside the car", "note": "names only 'BeSafe iZi Go'; no Modular / X1 / X2 / i-Size / 11006001 anywhere in the file"})
            if t == "article_identity":
                r = finish(r, "NOT_SUPPORTED_BY_DOCUMENT", "HOLD_MISSING_DOCUMENT", "UNKNOWN", "needs an OEM product page / data sheet carrying 11006001 (and the catalog SKU 11006001par)")
            elif t == "compatible":
                r["uncertainty"].append("the manual speaks of 'BeSafe iZi Go' only; whether that covers the separate model/generation is not stated")
                r = finish(r, "NOT_SUPPORTED_BY_DOCUMENT", "HOLD_MISSING_DOCUMENT", "UNKNOWN", "needs an OEM page that names this exact model next to this article")
            else:
                r["evidence"][0]["quote"] = None
                r = finish(r, "NOT_SUPPORTED_BY_DOCUMENT", "HOLD_MISSING_DOCUMENT", "UNKNOWN (never EXCLUDED)", "the file has no model list, so it cannot even show absence; needs the OEM compatibility statement")
        if r is None and did in ("doc:f554312a10c64b6e", "doc:81bb8659a109e590"):
            r = base(i, c)
            r["evidence"].append({"where": "none", "note": "the seed 'document' is a catalog control CSV, not an OEM document; no OEM page was captured (maxi-cosi.co.uk search for 74203550 and 'pocket' returned no results; no source found for 6900000016817)"})
            r = finish(r, "NO_OEM_DOCUMENT", "HOLD_MISSING_DOCUMENT", "UNKNOWN", "find an official document or drop the claim")
        assert r is not None, (i, did, t)
        rows.append(r)
    assert len(rows) == 53 and [r["claim_index"] for r in rows] == list(range(53))
    return rows

def build():
    rows = main()
    counts = {}
    for r in rows: counts[r["assessment"]] = counts.get(r["assessment"], 0) + 1
    suff = {}
    for r in rows: suff[r["sufficiency"]] = suff.get(r["sufficiency"], 0) + 1
    by_doc = {}
    for r in rows:
        d = by_doc.setdefault(r["seed_doc_id"], {"claims": 0, "sufficient_for_human_review": 0, "hold": 0, "capture_sha256": r["capture_sha256"], "capture_file": r["capture_file"]})
        d["claims"] += 1
        if r["sufficiency"] == "SUFFICIENT_FOR_HUMAN_REVIEW": d["sufficient_for_human_review"] += 1
        else: d["hold"] += 1
    index = [{"capture_file": n, "seed_doc_id": c["seed_doc_id"], "url_final": c["url_final"], "retrieved_http_date": c["retrieved_http_date"], "bytes": c["bytes"], "sha256": c["sha256"], "downloaded_file_name": c["downloaded_file_name"], "bytes_in_repo": False} for n, c in CAP.items()]
    coverage = {"schema": "bp-oem-coverage-captured-v1", "claims_total": len(rows), "assessment_counts": dict(sorted(counts.items())), "sufficiency_counts": dict(sorted(suff.items())),
                "by_document": by_doc, "claims_verified": 0, "claims_accepted_by_o1": 0, "bytes_in_repo": 0,
                "documents_captured_in_browser_with_sha256": len(index), "documents_in_seed": len(DOCS), "oem_documents_missing": 4,
                "notice": "Sufficiency here means 'the located official text is enough for a human to review the claim once the bytes are registered'. No claim is accepted or verified; O1 accepts none until byte-backed registration and a human review (reviewer != extractor)."}
    queue = {"schema": "bp-oem-human-review-queue-captured-v1",
             "ready_for_human_review_after_bytes_registered": [{"claim_index": r["claim_index"], "claim_id": r["claim_id"], "subject": r["subject"], "assessment": r["assessment"], "restrictions": r["restrictions"], "uncertainty": r["uncertainty"], "evidence": r["evidence"]} for r in rows if r["sufficiency"] == "SUFFICIENT_FOR_HUMAN_REVIEW"],
             "hold_until_human_decision": [{"claim_index": r["claim_index"], "claim_id": r["claim_id"], "subject": r["subject"], "assessment": r["assessment"], "why": r["reviewer_action"], "conflicts": r["conflicts"], "uncertainty": r["uncertainty"]} for r in rows if r["sufficiency"] in ("HOLD", "HOLD_UNTIL_HUMAN_DECISION")],
             "hold_missing_document": [{"claim_index": r["claim_index"], "claim_id": r["claim_id"], "subject": r["subject"], "assessment": r["assessment"], "needs": r["reviewer_action"]} for r in rows if r["sufficiency"] == "HOLD_MISSING_DOCUMENT"],
             "documents_missing": ["BeSafe OEM page/data sheet carrying 11006001 and naming iZi Go Modular X1 / X1 i-Size (the manual names only 'BeSafe iZi Go'); not found in the besafe.com sitemap (3103 URLs, no product pages)",
                                   "Maxi-Cosi document for Pocket 74203550 and RodiFix Air Protect (no result on maxi-cosi.co.uk search)",
                                   "Maxi-Cosi Coral Slide Pro carrier adapter user manual MC1166_coralslideprocarrieradapters_UM_LR.pdf (linked from the page, not captured): interface and extension article",
                                   "Britax user guide https://manuals.britax.com/product/P1070-1 (linked from the relax insert page, not captured)",
                                   "Bugaboo Q&A source (Bazaarvoice) for the Dragonfly statements, byte-captured with date",
                                   "source for article 6900000016817 (maker unspecified)"],
             "never": "no VERIFIED is assigned; the human reviewer must differ from the extractor; absence from a list is never EXCLUDED"}
    return {"CLAIM_ASSESSMENT.json": {"schema": SCHEMA, "claims": rows}, "COVERAGE_REPORT_CAPTURED.json": coverage, "HUMAN_REVIEW_QUEUE_CAPTURED.json": queue, "CAPTURE_INDEX.json": {"schema": "bp-oem-capture-index-v1", "captures": index}}, rows

def write_csv(rows, path):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n"); w.writerow(["idx", "claim_id", "type", "subject", "assessment", "sufficiency", "hint_not_a_state", "restrictions", "conflicts", "uncertainty", "reviewer_action"])
        for r in rows: w.writerow([r["claim_index"], r["claim_id"], r["assertion_type"], r["subject"], r["assessment"], r["sufficiency"], r["suggested_oem_state_HINT_not_a_state"], " || ".join(r["restrictions"]), " || ".join(r["conflicts"]), " || ".join(r["uncertainty"]), r["reviewer_action"]])

if __name__ == "__main__":
    outs, rows = build(); OUT.mkdir(exist_ok=True)
    if "--check" in sys.argv:
        bad = [n for n, o in outs.items() if not (OUT / n).exists() or (OUT / n).read_text(encoding="utf-8") != canon(o)]
        print("CHECK", "OK" if not bad else f"DIFF {bad}"); sys.exit(1 if bad else 0)
    for n, o in outs.items(): (OUT / n).write_text(canon(o), encoding="utf-8")
    write_csv(rows, OUT / "CLAIM_ASSESSMENT.csv")
    cv = outs["COVERAGE_REPORT_CAPTURED.json"]; print(json.dumps({"assessment_counts": cv["assessment_counts"], "sufficiency_counts": cv["sufficiency_counts"]}, indent=1, ensure_ascii=False))
