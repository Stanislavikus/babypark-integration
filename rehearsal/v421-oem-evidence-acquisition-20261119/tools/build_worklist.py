#!/usr/bin/env python3
"""Evidence-acquisition worklist, coverage report and human-review queue preparation for the existing Stage B O1-O4 mechanism.

This is NOT a new evidence system. It only READS the accepted Stage B seed data (``rehearsal/v421-oem-stage-b/data/seeds``) and its committed
outputs (``out/``), and writes three derived files next to this tool:

    worklist/ACQUISITION_WORKLIST.json   per document: the claims that depend on it, what the original document must show, the exact
                                         catalog identities involved and the generation-sensitive name pairs (no transfer between them)
    worklist/COVERAGE_REPORT.json        how much of the 53 claims / 8 documents is byte-backed (today: none)
    worklist/HUMAN_REVIEW_QUEUE.json     what can be confirmed (nothing before bytes exist), what must be held, which documents are missing

It records the state of the evidence, it never changes it: no claim status is set, no document is registered, nothing is fetched.
Same inputs give byte-identical outputs (canonical JSON, no clock). Usage:

    python3 -B tools/build_worklist.py            # (re)write worklist/
    python3 -B tools/build_worklist.py --check    # exit 1 when worklist/ differs from what the inputs give
"""
from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
STAGE_B = HERE.parents[0] / "v421-oem-stage-b"
SEEDS = STAGE_B / "data" / "seeds"
OUT_B = STAGE_B / "out"
TARGET = HERE / "worklist"
SCHEMA = "bp-oem-acquisition-worklist-v1"

# What an original document must contain before a PROPOSED claim of this type can even be offered to a human reviewer (lock OD1 / DATA_SCHEMA).
NEEDS = {
    "compatible": "a sentence/table row of the ORIGINAL document that names BOTH ends exactly (model + generation, article number); conditions, if any, verbatim",
    "article_identity": "the OEM article number (MPN) printed next to the product role/name; plus a separate, reviewed catalog-SKU binding (a SKU is not proof)",
    "absent_from_list": "the document must state that its list is COMPLETE; otherwise the claim stays UNKNOWN. Absence from a list is never EXCLUDED",
    "not_recommended": "an explicit, scoped manufacturer statement that the pair/model is not recommended or not compatible (quote verbatim)",
    "not_tested_at_time": "a dated manufacturer statement that the pair was not tested; time-bound, always a hold",
}


def load(name):
    return json.loads((SEEDS / name).read_text(encoding="utf-8"))


def canon(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=1) + "\n"


def ends_of(assertion):
    ends = assertion.get("ends") or {}
    out = {}
    for role, end in sorted(ends.items()):
        out[role] = {k: end.get(k) for k in ("maker_id", "name", "mpn", "role") if end.get(k) is not None}
    if assertion.get("article"):
        out["article"] = {k: assertion["article"].get(k) for k in ("maker_id", "mpn", "role", "sku_alias") if assertion["article"].get(k) is not None}
    if assertion.get("type") == "compatible" and assertion.get("relation_type") == "vehicle_general":
        out["note"] = "vehicle_general: maker unspecified in the seed; an OEM document may not exist"
    return out


def generation_pairs(names_by_maker):
    """Name pairs where one model name is a word-prefix of the other (Fox 5 / Fox 5 Renew): never transfer a statement between them."""
    pairs = []
    for maker, names in sorted(names_by_maker.items()):
        norm = sorted({n for n in names if n})
        for a in norm:
            for b in norm:
                if a != b and b.casefold().startswith(a.casefold() + " "):
                    pairs.append({"maker_id": maker, "shorter": a, "longer": b,
                                  "rule": "separate models/generations: each needs its own sentence in the document; no automatic transfer of compatibility, absence or exclusion"})
    return pairs


def build():
    documents = load("documents.json")["documents"]
    claims = load("claims.json")["claims"]
    articles = load("articles.json")
    cases = load("seed_cases.json")
    models = load("models.json")["models"]
    matrix = {c["claim_id"]: c for c in json.loads((OUT_B / "claim_status_matrix.json").read_text(encoding="utf-8"))["claims"]}
    queue_b = json.loads((OUT_B / "review_queue.json").read_text(encoding="utf-8"))
    bindings = {(b["manufacturer_id"], b["mpn"]): b for b in articles["bindings"]}

    by_doc = collections.defaultdict(list)
    names_by_maker = collections.defaultdict(set)
    for index, claim in enumerate(claims):
        a = claim["assertion"]
        by_doc[claim["doc_id"]].append((index, claim))
        for end in (a.get("ends") or {}).values():
            if end.get("name"):
                names_by_maker[end["maker_id"]].add(end["name"])
    for m in models:
        names_by_maker[m["maker_id"]].add(m["display"])

    catalog_by_sku = collections.defaultdict(dict)
    for p in cases["positives"]:
        t, s = p["target"], p["source"]
        catalog_by_sku[str(t["sku"])].setdefault("target", {"sku": t["sku"], "oem_base_sku": t.get("oem_base_sku"), "role": t.get("role"), "title": t.get("title")})
        catalog_by_sku[str(t["sku"])].setdefault("sources", {})[p["case_id"]] = {"nid": s["nid"], "sku": s["sku"], "catalog_model_string": s["catalog_model_string"],
                                                                                     "title": s["title"], "oem_compatible_model": p["oem_compatible_model"]}
    holdouts = [{"case_id": h["case_id"], "accessory_sku": h["accessory_sku"], "accessory_nids": h["accessory_nids"], "source_nids": h["source_nids"],
                 "source_catalog_model_string": h["source_catalog_model_string"], "endpoints": h["endpoints"]} for h in cases["holdouts"]]

    doc_items = []
    for doc in sorted(documents, key=lambda d: d["doc_id"]):
        items = []
        for index, claim in by_doc.get(doc["doc_id"], []):
            a = claim["assertion"]
            row = matrix[claim["claim_id"]]
            items.append({"claim_index": index, "claim_id": claim["claim_id"], "assertion_type": a["type"], "relation_type": a.get("relation_type"),
                          "ends": ends_of(a), "seed_locator_ref": claim["locator"].get("ref"),
                          "declared_status": row["declared_status"], "effective_status": row["effective_status"], "reasons": row["reasons"],
                          "relation_ids": row["relation_ids"],
                          "original_document_must_show": NEEDS[a["type"]]})
        is_control = doc["url"].startswith("negative-control:")
        doc_items.append({
            "doc_id": doc["doc_id"], "issuer": doc["issuer"], "url": doc["url"], "media_type": doc["media_type"], "seed_market": doc["market"],
            "seed_language": doc["language"], "bytes_state": "NO_BYTES",
            "official_manufacturer_document": not is_control,
            "blocker": ("no official document: the seed points at a catalog control CSV, which is not OEM evidence; an official manufacturer page/manual must be found for these claims"
                        if is_control else "original bytes not captured; the seed URL was read on 2026-11-17 by an unattributed handoff and its content was never stored"),
            "capture_requirements": {
                "register_doc_fields": ["file (the ORIGINAL bytes, unchanged)", "issuer", "media_type", "url", "document_version", "document_date", "market", "language", "retrieved_utc", "captured_by=human:<id>"],
                "after_capture": "add-claim with a verbatim quote found in the stored bytes (HTML/text) or the page number (PDF); reviewer must be a different human:<id>",
            },
            "claims": items,
        })

    article_items = []
    for (maker, mpn), b in sorted(bindings.items()):
        article_items.append({"manufacturer_id": maker, "mpn": mpn, "binding_id": b["binding_id"], "catalog_sku": b["catalog_sku"], "binding_status": b["status"],
                              "binding_note": b["notes"], "catalog": catalog_by_sku.get(str(b["catalog_sku"]).replace("par", ""), {}).get("target"),
                              "needs": "an ACCEPTED article_identity claim from original bytes AND a human review of this binding; the SKU/MPN join is not proof"})
    for u in articles.get("unjoined", []):
        article_items.append({"manufacturer_id": u["manufacturer_id"], "mpn": u["mpn"], "binding_status": "UNJOINED", "binding_note": u.get("reason"),
                              "needs": "an audited catalog join (which catalog SKU is this OEM article?) - no document can prove it by itself"})

    worklist = {
        "schema": SCHEMA, "notice": "Worklist only. No document was fetched, no claim status was changed, nothing here is evidence, a recommendation or an approval.",
        "inputs": {"seeds": "rehearsal/v421-oem-stage-b/data/seeds", "outputs": "rehearsal/v421-oem-stage-b/out"},
        "documents": doc_items, "article_bindings": article_items,
        "generation_sensitive_pairs": generation_pairs(names_by_maker),
        "holdout_physical_pairs": holdouts,
        "additional_documents_to_find": [
            {"need": "BeSafe SKU-to-article proof for 11006001 / 11006001par (the seed names sku_proof_url https://besafe.hr/proizvod/besafe-kisna-zastita/)", "why": "binding of catalog SKU to the OEM article"},
            {"need": "official Maxi-Cosi document for the Pocket (74203550) and RodiFix Air Protect; the seed only has a catalog control CSV", "why": "claims 13 and 20 have no OEM document at all"},
            {"need": "official document for the Maxi-Cosi Fame extension adapter named in the Coral Slide Pro interface (claim 11 has an unspecified extension)", "why": "extension article unspecified: the relation stays held"},
            {"need": "audited catalog join for Britax-Roemer ACCSFCC207 (seller SKU 2000040775 is unproven)", "why": "unjoined article"},
            {"need": "maker and official document for vehicle organiser 6900000016817 (seed maker 'unspecified')", "why": "no manufacturer is known; a never-A/B class-C item"},
        ],
    }

    n_claims = len(claims)
    by_type = collections.Counter(c["assertion"]["type"] for c in claims)
    coverage = {
        "schema": "bp-oem-coverage-report-v1", "notice": worklist["notice"],
        "documents": {"total": len(documents), "with_original_bytes": 0, "official_documents": sum(1 for d in doc_items if d["official_manufacturer_document"]),
                      "not_official_catalog_control": sum(1 for d in doc_items if not d["official_manufacturer_document"])},
        "claims": {"total": n_claims, "byte_backed": 0, "accepted": 0, "by_assertion_type": dict(sorted(by_type.items())),
                   "by_issuer": dict(sorted(collections.Counter(next(d["issuer"] for d in documents if d["doc_id"] == c["doc_id"]) for c in claims).items()))},
        "article_bindings": {"total": len(bindings), "verified": 0, "unjoined": len(articles.get("unjoined", []))},
        "physical_relations": {"seed_physical_relations": 13, "publishable_now": 0, "holdouts": len(holdouts), "locale_cases": len(cases["positives"])},
        "stage_b_review_queue_counts": {k: (len(v) if isinstance(v, list) else v) for k, v in queue_b.items() if k not in ("notice", "schema")},
        "sufficiency": "no claim has sufficient evidence today: all 53 are PROPOSED and bytes_missing; reasons claim_proposed_unverified and bytes_missing for all 53",
    }

    review = {
        "schema": "bp-oem-human-review-queue-v1", "notice": worklist["notice"],
        "can_be_confirmed_now": [],
        "can_be_confirmed_now_reason": "nothing: no original bytes exist, so no claim can be offered to a human reviewer (the module refuses bytes-less claims)",
        "must_hold": [{"claim_id": c["claim_id"], "assertion_type": c["assertion"]["type"], "reasons": matrix[c["claim_id"]]["reasons"]} for c in claims],
        "missing_documents": [{"doc_id": d["doc_id"], "issuer": d["issuer"], "url": d["url"], "official_manufacturer_document": d["official_manufacturer_document"],
                               "claims_waiting": len(d["claims"])} for d in doc_items],
        "additional_documents_to_find": worklist["additional_documents_to_find"],
        "review_rules": ["reviewer is human:<id> and differs from the extractor", "the reviewer reads the ORIGINAL document, not this queue", "absence from a list is UNKNOWN, never EXCLUDED",
                         "no transfer between generations/models named differently", "a review is not owner approval and does not publish anything"],
    }
    return {"ACQUISITION_WORKLIST.json": worklist, "COVERAGE_REPORT.json": coverage, "HUMAN_REVIEW_QUEUE.json": review}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)
    files = {name: canon(obj) for name, obj in build().items()}
    if args.check:
        bad = [n for n, text in files.items() if not (TARGET / n).is_file() or (TARGET / n).read_text(encoding="utf-8") != text]
        print("WORKLIST CURRENT" if not bad else "WORKLIST DIFFERS: " + ", ".join(bad))
        return 1 if bad else 0
    TARGET.mkdir(exist_ok=True)
    for name, text in files.items():
        (TARGET / name).write_text(text, encoding="utf-8")
        print("wrote", (TARGET / name).relative_to(HERE.parents[1]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
