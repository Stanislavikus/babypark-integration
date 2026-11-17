#!/usr/bin/env python3
"""O1 evidence operator CLI: register captured documents, record PROPOSED claims, record HUMAN review decisions, verify.

It edits only ``<data-dir>/documents.json`` and ``<data-dir>/claims.json`` (plus content-addressed blobs under --blob-root).

  register-doc  --file F | --no-bytes  ...   capture a document (SHA-256 of the bytes is the identity; no bytes = URL-only, proves nothing)
  add-claim     --doc-id ID --locator JSON --quote TEXT --assertion JSON --extracted-by ACTOR ...   record a PROPOSED claim
  review-claim  --claim-id ID --reviewer human:<id> --decision VERIFIED|REJECTED ...                 record a human decision
  verify        [--json OUT]                                                      recompute every SHA-256 and print the claim matrix

Rules (lock OD1/OD7): the module refuses any reviewer that is not ``human:<id>`` - parsers and LLMs can only propose. This tool cannot
check who is typing, so a person must run ``review-claim`` after reading the ORIGINAL OEM document; an automated agent must never run it on
real data, and a recorded review is not owner approval of anything. ``verify`` exits 1 when a document's recomputed SHA-256 differs from the
registry or a claim declared VERIFIED fails a gate (reviewer == extractor, quote not found, synthetic, bytes missing, ...).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from oem_stage import canon  # noqa: E402
from oem_stage import o1_evidence as o1  # noqa: E402
from oem_stage.schema import ContractError  # noqa: E402

DOCS_SCHEMA, CLAIMS_SCHEMA, REPORT_SCHEMA = "bp-oem-documents-v1", "bp-oem-claims-v1", "bp-oem-evidence-verify-v1"
INTEGRITY_STATES = ("HASH_MISMATCH", "MISSING_BYTES", "UNREGISTERED")


def _load(data_dir: Path, name: str, key: str, schema: str) -> list:
    path = Path(data_dir) / f"{name}.json"
    if not path.exists():
        return []
    doc = canon.load_json(path)
    if doc.get("schema") != schema:
        raise ContractError(f"{path.name}: schema {doc.get('schema')!r} != {schema!r}")
    return doc[key]


def _save(data_dir: Path, name: str, key: str, schema: str, items: list) -> None:
    canon.write_json(Path(data_dir) / f"{name}.json", {"schema": schema, key: items})


def _store(a) -> o1.DocumentStore:
    return o1.DocumentStore(a.blob_root, _load(a.data_dir, "documents", "documents", DOCS_SCHEMA))


def _policy(a) -> dict:
    return {"allow_synthetic": bool(getattr(a, "allow_synthetic", False))}


def cmd_register_doc(a) -> int:
    store = _store(a)
    meta = dict(issuer=a.issuer, media_type=a.media_type, url=a.url, document_version=a.document_version,
                document_date=a.document_date, market=a.market, language=a.language, retrieved_utc=a.retrieved_utc,
                captured_by=a.captured_by, synthetic=a.synthetic, supersedes=a.supersedes, notes=a.notes)
    if a.no_bytes:
        rec = store.register_without_bytes(**meta)
    else:
        if not a.blob_root:
            raise ContractError("--blob-root is required when registering captured bytes")
        rec = store.put_bytes(Path(a.file).read_bytes(), **meta)
    _save(a.data_dir, "documents", "documents", DOCS_SCHEMA, store.registry())
    print(f"registered {rec['doc_id']} bytes_state={rec['bytes_state']} sha256={rec['sha256']}")
    return 0


def cmd_add_claim(a) -> int:
    store = _store(a)
    claims = _load(a.data_dir, "claims", "claims", CLAIMS_SCHEMA)
    doc = store.docs.get(a.doc_id)
    if doc is None:
        raise ContractError(f"unknown doc_id {a.doc_id!r} (register the document first)")
    raw = Path(a.assertion_file).read_text(encoding="utf-8") if a.assertion_file else a.assertion
    claim = o1.new_claim(doc=doc, locator=json.loads(a.locator), quote=a.quote, assertion=json.loads(raw),
                         extracted_by=a.extracted_by, created_by=a.created_by, created_utc=a.created_utc,
                         synthetic=a.synthetic, supersedes=a.supersedes)
    if any(c["claim_id"] == claim["claim_id"] for c in claims):
        raise ContractError(f"claim {claim['claim_id']} is already recorded")
    claims.append(claim)
    _save(a.data_dir, "claims", "claims", CLAIMS_SCHEMA, sorted(claims, key=lambda c: c["claim_id"]))
    print(f"recorded {claim['claim_id']} status=PROPOSED")
    return 0


def cmd_review_claim(a) -> int:
    store = _store(a)
    claims = _load(a.data_dir, "claims", "claims", CLAIMS_SCHEMA)
    idx = next((i for i, c in enumerate(claims) if c["claim_id"] == a.claim_id), None)
    if idx is None:
        raise ContractError(f"unknown claim_id {a.claim_id!r}")
    claims[idx] = o1.review_claim(claims[idx], reviewer=a.reviewer, decision=a.decision, reviewed_utc=a.reviewed_utc,
                                  note=a.note, quote_attestation=a.quote_attestation)
    superseded = {c["supersedes"] for c in claims if c.get("supersedes")}
    res = o1.check_claim(claims[idx], store, _policy(a), superseded)
    _save(a.data_dir, "claims", "claims", CLAIMS_SCHEMA, claims)
    print(f"reviewed {a.claim_id} declared={res['declared_status']} effective={res['effective_status']} "
          f"accepted={res['accepted']} reasons={','.join(res['reasons']) or '-'}")
    return 0


def cmd_verify(a) -> int:
    store = _store(a)
    claims = _load(a.data_dir, "claims", "claims", CLAIMS_SCHEMA)
    docs = [{"doc_id": d["doc_id"], "bytes_state": d["bytes_state"], "synthetic": d["synthetic"],
             "state": store.check(d["doc_id"])[0], "detail": store.check(d["doc_id"])[1]} for d in store.registry()]
    matrix = o1.claim_matrix(claims, store, _policy(a))
    problems = [f"document {d['doc_id']}: {d['state']}" for d in docs if d["state"] in INTEGRITY_STATES]
    problems += [f"claim {r['claim_id']}: declared VERIFIED but {r['effective_status']} ({','.join(r['reasons'])})"
                 for r in matrix if r["declared_status"] == "VERIFIED" and not r["accepted"]]
    problems += [f"claim {r['claim_id']}: {r['effective_status']} ({','.join(r['reasons'])})"
                 for r in matrix if r["effective_status"] == "INVALID" and r["declared_status"] != "VERIFIED"]
    summary = {"documents": len(docs), "documents_without_bytes": sum(d["state"] == "NO_BYTES" for d in docs),
               "claims": len(matrix), "accepted": sum(r["accepted"] for r in matrix),
               "by_effective_status": {k: sum(r["effective_status"] == k for r in matrix)
                                       for k in sorted({r["effective_status"] for r in matrix})}}
    report = {"schema": REPORT_SCHEMA, "policy": _policy(a), "summary": summary, "documents": docs, "claims": matrix,
              "problems": sorted(problems), "result": "PASS" if not problems else "FAIL"}
    if a.json:
        canon.write_json(a.json, report)
    print(f"documents={summary['documents']} (no bytes: {summary['documents_without_bytes']}) claims={summary['claims']} "
          f"accepted={summary['accepted']} by_status={summary['by_effective_status']}")
    for p in report["problems"]:
        print("PROBLEM", p)
    print(f"EVIDENCE {report['result']}")
    return 0 if report["result"] == "PASS" else 1


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)

    def common(p, blob_required=False):
        p.add_argument("--data-dir", required=True)
        p.add_argument("--blob-root", default=None, required=blob_required,
                       help="isolated content-addressed folder (OD7); rehearsal only")
        p.add_argument("--allow-synthetic", action="store_true", help="test fixtures only; real runs never use it")

    p = sub.add_parser("register-doc", help="register a captured document")
    common(p)
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument("--file")
    group.add_argument("--no-bytes", action="store_true", help="URL-only record: can never back an accepted claim")
    for name in ("issuer", "media-type", "url", "document-version", "document-date", "market", "language",
                 "retrieved-utc", "captured-by"):
        p.add_argument("--" + name, required=True)
    p.add_argument("--synthetic", action="store_true")
    p.add_argument("--supersedes", default=None)
    p.add_argument("--notes", default=None)
    p.set_defaults(fn=cmd_register_doc)

    p = sub.add_parser("add-claim", help="record a PROPOSED claim")
    common(p)
    p.add_argument("--doc-id", required=True)
    p.add_argument("--locator", required=True, help='JSON, e.g. {"kind":"html_text"} or {"kind":"pdf_page","page":3}')
    p.add_argument("--quote", default=None, help="verbatim OEM text (checked against the stored bytes on review)")
    grp = p.add_mutually_exclusive_group(required=True)
    grp.add_argument("--assertion")
    grp.add_argument("--assertion-file")
    for name in ("extracted-by", "created-by", "created-utc"):
        p.add_argument("--" + name, required=True)
    p.add_argument("--synthetic", action="store_true")
    p.add_argument("--supersedes", default=None)
    p.set_defaults(fn=cmd_add_claim)

    p = sub.add_parser("review-claim", help="record a HUMAN decision (VERIFIED or REJECTED)")
    common(p)
    p.add_argument("--claim-id", required=True)
    p.add_argument("--reviewer", required=True, help="human:<id> of the person who read the ORIGINAL document")
    p.add_argument("--decision", required=True, choices=("VERIFIED", "REJECTED"))
    p.add_argument("--reviewed-utc", required=True)
    p.add_argument("--note", default="")
    p.add_argument("--quote-attestation", default=None, choices=("human_attested",),
                   help="PDF pages only: the human attests the quote appears on that page")
    p.set_defaults(fn=cmd_review_claim)

    p = sub.add_parser("verify", help="recompute SHA-256 of every document and print the claim matrix")
    common(p)
    p.add_argument("--json", default=None)
    p.set_defaults(fn=cmd_verify)
    return ap


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.fn(args)
    except (ContractError, ValueError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
