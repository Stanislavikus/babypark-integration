"""O1 - original OEM evidence: byte-backed documents, claim lifecycle, drift history.

Rules enforced here (see STAGE_B_EXECUTION_LOCK_20261117.md, O1/OD1/OD2/OD7):
* a document is proven only by captured bytes whose SHA-256 is recomputed on every check;
  a URL, a free-text hash or a missing hash proves nothing;
* a claim is ``PROPOSED`` until a *human* reviewer verifies it; parser/LLM extraction is PROPOSED-only;
* only claims that pass every check are ``ACCEPTED``; everything else is reported with reason codes;
* superseded documents/claims keep their history and are never silently re-granted.
"""
from __future__ import annotations

import copy
import html.parser
import os
import unicodedata
from pathlib import Path

from . import canon
from .assertions import check_assertion
from .schema import (CLAIM_STATUSES, MEDIA_TYPES, ContractError, actor_kind, check_keys, is_hex64, parse_date,
                     require_actor, require_enum, require_str)

DOC_REQUIRED = ("doc_id", "issuer", "media_type", "url", "document_version", "document_date", "market",
                "language", "retrieved_utc", "sha256", "bytes_state", "captured_by", "synthetic")
DOC_OPTIONAL = ("supersedes", "notes")
CLAIM_REQUIRED = ("claim_id", "doc_id", "doc_sha256", "locator", "quote", "assertion", "status",
                  "extracted_by", "review", "history", "supersedes", "synthetic")
REVIEW_KEYS = ("reviewer", "decision", "reviewed_utc", "note", "quote_attestation")
DEFAULT_POLICY = {"require_distinct_reviewer": True, "allow_synthetic": False}

_ZERO_WIDTH = dict.fromkeys(map(ord, "­​‌‍‎‏﻿"), None)
_BLOCK_TAGS = {"p", "div", "li", "tr", "td", "th", "br", "h1", "h2", "h3", "h4", "h5", "h6", "section",
               "article", "ul", "ol", "table", "thead", "tbody", "dt", "dd", "caption", "blockquote", "pre", "hr"}
_SKIP_TAGS = {"script", "style", "noscript", "template"}


def norm_text(value: str) -> str:
    """NFKC, drop zero-width/soft-hyphen, collapse whitespace. Used for quote matching only."""
    return " ".join(unicodedata.normalize("NFKC", value).translate(_ZERO_WIDTH).split())


class _TextExtractor(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in _SKIP_TAGS:
            self.skip += 1
        elif tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in _SKIP_TAGS:
            self.skip = max(0, self.skip - 1)
        elif tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def extract_text(media_type: str, data: bytes):
    """Normalized text of machine-readable media (stdlib). ``None`` for PDF/undecodable bytes."""
    if media_type not in ("text/html", "text/plain"):
        return None
    try:
        decoded = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return None
    if media_type == "text/plain":
        return norm_text(decoded)
    parser = _TextExtractor()
    parser.feed(decoded)
    parser.close()
    return norm_text("".join(parser.parts))


# ----------------------------------------------------------------------------- documents

def make_doc_id(issuer, url, document_version, sha256) -> str:
    return "doc:" + canon.digest({"issuer": issuer, "url": url, "document_version": document_version,
                                  "sha256": sha256})[:16]


def validate_document(rec) -> None:
    check_keys(rec, DOC_REQUIRED, DOC_OPTIONAL, "document")
    for key in ("issuer", "url", "document_version", "market", "language", "retrieved_utc"):
        require_str(rec[key], "document." + key)
    require_enum(rec["media_type"], MEDIA_TYPES, "document.media_type")
    parse_date(rec["document_date"], "document.document_date")
    parse_date(rec["retrieved_utc"][:10], "document.retrieved_utc")
    require_actor(rec["captured_by"], "document.captured_by")
    if not isinstance(rec["synthetic"], bool):
        raise ContractError("document.synthetic must be boolean")
    sha = rec["sha256"]
    if sha is None:
        if rec["bytes_state"] != "missing":
            raise ContractError("document: sha256 null requires bytes_state 'missing'")
    else:
        if not is_hex64(sha) or rec["bytes_state"] != "present":
            raise ContractError("document: sha256 must be 64 lowercase hex and bytes_state 'present'")
    if rec["doc_id"] != make_doc_id(rec["issuer"], rec["url"], rec["document_version"], sha):
        raise ContractError("document: doc_id does not match its content-derived identity")
    if rec.get("supersedes") is not None:
        require_str(rec["supersedes"], "document.supersedes")


class DocumentStore:
    """Registry of documents plus an isolated, content-addressed blob folder (OD7: rehearsal only)."""

    def __init__(self, blob_root=None, documents=None) -> None:
        self.blob_root = Path(blob_root) if blob_root is not None else None
        self.docs: dict = {}
        for rec in documents or []:
            self.register(rec)

    def register(self, rec) -> None:
        validate_document(rec)
        old = self.docs.get(rec["doc_id"])
        if old is not None and old != rec:
            raise ContractError(f"document {rec['doc_id']}: conflicting re-registration")
        self.docs[rec["doc_id"]] = copy.deepcopy(rec)

    def blob_path(self, sha256: str) -> Path:
        if self.blob_root is None:
            raise ContractError("document store has no blob root")
        return self.blob_root / sha256[:2] / sha256

    def put_bytes(self, data: bytes, *, issuer, media_type, url, document_version, document_date, market,
                  language, retrieved_utc, captured_by, synthetic=False, supersedes=None, notes=None) -> dict:
        sha = canon.sha256_hex(data)
        path = self.blob_path(sha)
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            with open(tmp, "wb") as handle:
                handle.write(data)
            os.chmod(tmp, 0o600)
            os.replace(tmp, path)
        rec = {"doc_id": make_doc_id(issuer, url, document_version, sha), "issuer": issuer,
               "media_type": media_type, "url": url, "document_version": document_version,
               "document_date": document_date, "market": market, "language": language,
               "retrieved_utc": retrieved_utc, "sha256": sha, "bytes_state": "present",
               "captured_by": captured_by, "synthetic": bool(synthetic)}
        if supersedes is not None:
            rec["supersedes"] = supersedes
        if notes is not None:
            rec["notes"] = notes
        self.register(rec)
        return self.docs[rec["doc_id"]]

    def register_without_bytes(self, *, issuer, media_type, url, document_version, document_date, market, language,
                               retrieved_utc, captured_by, synthetic=False, supersedes=None, notes=None) -> dict:
        """Register a document whose bytes were never captured (URL-only). It can never back an accepted claim."""
        rec = {"doc_id": make_doc_id(issuer, url, document_version, None), "issuer": issuer,
               "media_type": media_type, "url": url, "document_version": document_version,
               "document_date": document_date, "market": market, "language": language,
               "retrieved_utc": retrieved_utc, "sha256": None, "bytes_state": "missing",
               "captured_by": captured_by, "synthetic": bool(synthetic)}
        if supersedes is not None:
            rec["supersedes"] = supersedes
        if notes is not None:
            rec["notes"] = notes
        self.register(rec)
        return self.docs[rec["doc_id"]]

    def check(self, doc_id) -> tuple:
        """Recompute SHA-256 over the stored bytes. Returns (state, detail)."""
        rec = self.docs.get(doc_id)
        if rec is None:
            return ("UNREGISTERED", "document not in registry")
        if rec["sha256"] is None:
            return ("NO_BYTES", "no captured bytes (content_sha256 null): URL-only evidence proves nothing")
        if self.blob_root is None or not self.blob_path(rec["sha256"]).exists():
            return ("MISSING_BYTES", "registered sha256 but the captured bytes are not in the store")
        data = self.blob_path(rec["sha256"]).read_bytes()
        got = canon.sha256_hex(data)
        if got != rec["sha256"]:
            return ("HASH_MISMATCH", f"recomputed {got}")
        return ("OK", "")

    def read_bytes(self, doc_id):
        return self.blob_path(self.docs[doc_id]["sha256"]).read_bytes() if self.check(doc_id)[0] == "OK" else None

    def text(self, doc_id):
        data = self.read_bytes(doc_id)
        return None if data is None else extract_text(self.docs[doc_id]["media_type"], data)

    def superseded_ids(self) -> set:
        return {rec["supersedes"] for rec in self.docs.values() if rec.get("supersedes")}

    def registry(self) -> list:
        return [self.docs[k] for k in sorted(self.docs)]


def drift_report(store: DocumentStore) -> list:
    """Revision history: which documents were superseded by a newer capture (claims must be re-verified)."""
    out = []
    for rec in store.registry():
        if rec.get("supersedes"):
            old = store.docs.get(rec["supersedes"])
            out.append({"doc_id": rec["doc_id"], "supersedes": rec["supersedes"],
                        "old_sha256": old["sha256"] if old else None, "new_sha256": rec["sha256"],
                        "same_bytes": bool(old and old["sha256"] and old["sha256"] == rec["sha256"])})
    return out


# ----------------------------------------------------------------------------- claims

def make_claim_id(doc_id, doc_sha256, locator, quote, assertion) -> str:
    return "clm:" + canon.digest({"doc_id": doc_id, "doc_sha256": doc_sha256, "locator": locator,
                                  "quote": quote, "assertion": assertion})[:16]


def new_claim(*, doc, locator, quote, assertion, extracted_by, created_by, created_utc,
              synthetic=False, supersedes=None) -> dict:
    """Create a PROPOSED claim. Every extractor (human, parser, llm) starts at PROPOSED."""
    require_actor(extracted_by, "claim.extracted_by")
    require_actor(created_by, "claim.created_by")
    claim = {"claim_id": make_claim_id(doc["doc_id"], doc["sha256"], locator, quote, assertion),
             "doc_id": doc["doc_id"], "doc_sha256": doc["sha256"], "locator": locator, "quote": quote,
             "assertion": assertion, "status": "PROPOSED", "extracted_by": extracted_by, "review": None,
             "history": [{"seq": 0, "event": "created", "to": "PROPOSED", "by": created_by,
                          "utc": created_utc, "note": ""}],
             "supersedes": supersedes, "synthetic": bool(synthetic)}
    validate_claim(claim)
    return claim


def review_claim(claim, *, reviewer, decision, reviewed_utc, note="", quote_attestation=None) -> dict:
    """Return a new claim record carrying a human decision. Only a human may decide (OD1)."""
    if actor_kind(reviewer) != "human":
        raise ContractError("only a human reviewer ('human:<id>') may verify or reject a claim")
    require_enum(decision, ("VERIFIED", "REJECTED"), "decision")
    old = claim["status"]
    if old == "REJECTED" or (old == "VERIFIED" and decision == "VERIFIED"):
        raise ContractError(f"illegal transition {old} -> {decision}")
    new = copy.deepcopy(claim)
    new["status"] = decision
    new["review"] = {"reviewer": reviewer, "decision": decision, "reviewed_utc": reviewed_utc, "note": note,
                     "quote_attestation": quote_attestation}
    new["history"].append({"seq": len(new["history"]), "event": "reviewed", "from": old, "to": decision,
                           "by": reviewer, "utc": reviewed_utc, "note": note})
    validate_claim(new)
    return new


def _check_locator(locator) -> None:
    if not isinstance(locator, dict):
        raise ContractError("claim.locator: expected an object")
    kind = locator.get("kind")
    if kind == "html_text":
        check_keys(locator, ("kind",), ("section",), "claim.locator")
    elif kind == "pdf_page":
        check_keys(locator, ("kind", "page"), (), "claim.locator")
        if not isinstance(locator["page"], int) or isinstance(locator["page"], bool) or locator["page"] < 1:
            raise ContractError("claim.locator.page must be an integer >= 1")
    elif kind == "record_ref":
        check_keys(locator, ("kind", "ref"), (), "claim.locator")
        require_str(locator["ref"], "claim.locator.ref")
    else:
        raise ContractError(f"claim.locator.kind {kind!r} unsupported")


def validate_claim(claim) -> None:
    """Structure, content-derived id and lifecycle consistency. Raises ContractError."""
    check_keys(claim, CLAIM_REQUIRED, (), "claim")
    require_enum(claim["status"], CLAIM_STATUSES, "claim.status")
    require_actor(claim["extracted_by"], "claim.extracted_by")
    _check_locator(claim["locator"])
    if claim["quote"] is not None:
        require_str(claim["quote"], "claim.quote", allow_empty=True)
    if claim["doc_sha256"] is not None and not is_hex64(claim["doc_sha256"]):
        raise ContractError("claim.doc_sha256 must be null or 64 lowercase hex")
    if not isinstance(claim["synthetic"], bool):
        raise ContractError("claim.synthetic must be boolean")
    check_assertion(claim["assertion"])
    if claim["claim_id"] != make_claim_id(claim["doc_id"], claim["doc_sha256"], claim["locator"],
                                          claim["quote"], claim["assertion"]):
        raise ContractError("claim_id does not match claim content (tampered or edited without re-keying)")
    review = claim["review"]
    if claim["status"] == "PROPOSED":
        if review is not None:
            raise ContractError("PROPOSED claim cannot carry a review")
    else:
        check_keys(review, REVIEW_KEYS, (), "claim.review")
        if actor_kind(review["reviewer"]) != "human" or review["decision"] != claim["status"]:
            raise ContractError("claim.review must be a human decision equal to the status")
    history = claim["history"]
    if not isinstance(history, list) or not history:
        raise ContractError("claim.history must be a non-empty list")
    state = None
    for seq, event in enumerate(history):
        if event.get("seq") != seq:
            raise ContractError("claim.history sequence is not contiguous")
        require_actor(event.get("by"), "claim.history.by")
        if seq == 0:
            if event.get("event") != "created" or event.get("to") != "PROPOSED":
                raise ContractError("claim.history must start with created -> PROPOSED")
            state = "PROPOSED"
            continue
        if event.get("event") != "reviewed" or actor_kind(event["by"]) != "human" or event.get("from") != state:
            raise ContractError("claim.history: only a human review may change status")
        if (state, event.get("to")) not in {("PROPOSED", "VERIFIED"), ("PROPOSED", "REJECTED"),
                                            ("VERIFIED", "REJECTED")}:
            raise ContractError(f"claim.history: illegal transition {state} -> {event.get('to')}")
        state = event["to"]
    if state != claim["status"]:
        raise ContractError("claim.history does not end in the declared status")


def check_claim(claim, store: DocumentStore, policy=None, superseded_claims=frozenset()) -> dict:
    """Effective status of one claim. ``accepted`` is True only for a fully verified, byte-backed claim."""
    policy = {**DEFAULT_POLICY, **(policy or {})}
    base = {"claim_id": claim.get("claim_id") if isinstance(claim, dict) else None, "reasons": [],
            "accepted": False}
    try:
        validate_claim(claim)
    except ContractError as exc:
        return {**base, "declared_status": None, "effective_status": "INVALID",
                "reasons": ["invalid_claim:" + str(exc)]}
    declared = claim["status"]
    out = {**base, "declared_status": declared, "reasons": []}
    reasons = out["reasons"]
    if declared == "REJECTED":
        return {**out, "effective_status": "REJECTED", "reasons": ["claim_rejected"]}
    if claim["claim_id"] in superseded_claims:
        return {**out, "effective_status": "SUPERSEDED", "reasons": ["claim_superseded"]}
    doc = store.docs.get(claim["doc_id"])
    state, detail = store.check(claim["doc_id"])
    if doc is None:
        reasons.append("doc_unregistered")
    if (claim["synthetic"] or (doc is not None and doc["synthetic"])) and not policy["allow_synthetic"]:
        reasons.append("synthetic_not_allowed")
    if declared == "PROPOSED":
        reasons.append("claim_proposed_unverified")
        if state in ("NO_BYTES", "MISSING_BYTES"):
            reasons.append("bytes_missing")
        elif state == "HASH_MISMATCH":
            reasons.append("hash_mismatch")
        return {**out, "effective_status": "PROPOSED", "reasons": sorted(set(reasons))}
    # declared VERIFIED: every gate must hold or the claim is INVALID (never silently accepted)
    review = claim["review"]
    if policy["require_distinct_reviewer"] and review["reviewer"] == claim["extracted_by"]:
        reasons.append("reviewer_equals_extractor")
    if state in ("NO_BYTES", "MISSING_BYTES"):
        reasons.append("bytes_missing")
    elif state == "HASH_MISMATCH":
        reasons.append("hash_mismatch")
    elif state == "UNREGISTERED":
        reasons.append("doc_unregistered")
    if doc is not None and claim["doc_sha256"] != doc["sha256"]:
        reasons.append("claim_doc_sha_mismatch")
    if claim["doc_id"] in store.superseded_ids():
        reasons.append("doc_superseded_reverify")
    kind = claim["locator"]["kind"]
    if kind == "record_ref":
        reasons.append("locator_not_byte_backed")
    elif not claim["quote"] or not claim["quote"].strip():
        reasons.append("quote_missing")
    elif kind == "pdf_page":
        if review["quote_attestation"] != "human_attested":
            reasons.append("quote_needs_human_attestation")
    elif state == "OK":
        text = store.text(claim["doc_id"])
        if text is None:
            reasons.append("quote_not_machine_checkable")
        elif norm_text(claim["quote"]) not in text:
            reasons.append("quote_not_found")
    reasons = sorted(set(reasons))
    if reasons:
        return {**out, "effective_status": "INVALID", "reasons": reasons}
    return {**out, "effective_status": "ACCEPTED", "accepted": True, "reasons": []}


def claim_matrix(claims, store: DocumentStore, policy=None) -> list:
    """Claim status/reason matrix, sorted by claim_id (deterministic)."""
    superseded = {c["supersedes"] for c in claims if isinstance(c, dict) and c.get("supersedes")}
    rows = []
    for claim in sorted(claims, key=lambda c: c.get("claim_id", "")):
        res = check_claim(claim, store, policy, superseded)
        a = claim.get("assertion", {}) if isinstance(claim, dict) else {}
        rows.append({"claim_id": res["claim_id"], "doc_id": claim.get("doc_id"),
                     "assertion_type": a.get("type"), "relation_type": a.get("relation_type"),
                     "extracted_by_kind": actor_kind(claim.get("extracted_by")),
                     "declared_status": res["declared_status"], "effective_status": res["effective_status"],
                     "accepted": res["accepted"], "reasons": res["reasons"]})
    return rows
