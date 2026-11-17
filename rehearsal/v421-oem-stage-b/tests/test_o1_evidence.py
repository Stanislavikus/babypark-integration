"""O1: byte-backed evidence, human-only verification, claim lifecycle, drift (lock O1 / OD1 / OD2 / OD7)."""
from __future__ import annotations

import copy
import tempfile
import unittest

from oem_stage import o1_evidence as o1
from oem_stage.schema import ContractError
from tests import synthetic_world as sw


class _Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.w = sw.build(self._tmp.name)
        self.policy = dict(self.w.policy)

    def check(self, claim, policy=None, superseded=frozenset()):
        return o1.check_claim(claim, self.w.store, policy or self.policy, superseded)

    def claim_for(self, quote):
        return next(c for c in self.w.claims if c["quote"] == quote)


class TestDocumentBytes(_Base):
    def test_sha256_is_recomputed_from_stored_bytes(self):
        self.assertEqual(self.w.store.check(self.w.doc["doc_id"])[0], "OK")

    def test_tampered_bytes_are_detected_and_stop_acceptance(self):
        claim = self.claim_for("RS-100 rain shield fits Zeta Alpha 1.")
        self.assertTrue(self.check(claim)["accepted"])
        path = self.w.store.blob_path(self.w.doc["sha256"])
        path.write_bytes(path.read_bytes() + b"<!-- edited -->")
        self.assertEqual(self.w.store.check(self.w.doc["doc_id"])[0], "HASH_MISMATCH")
        res = self.check(claim)
        self.assertFalse(res["accepted"])
        self.assertIn("hash_mismatch", res["reasons"])

    def test_missing_blob_is_reported(self):
        self.w.store.blob_path(self.w.doc["sha256"]).unlink()
        self.assertEqual(self.w.store.check(self.w.doc["doc_id"])[0], "MISSING_BYTES")
        self.assertFalse(self.check(self.claim_for("RS-100 rain shield fits Zeta Alpha 1."))["accepted"])

    def test_url_only_document_proves_nothing(self):
        doc = self.w.store.register_without_bytes(
            issuer="acme", media_type="text/html", url="https://synthetic.invalid/url-only", document_version="v1",
            document_date="2026-10-01", market="GB", language="en", retrieved_utc=sw.UTC, captured_by=sw.EXTRACTOR,
            synthetic=True)
        self.assertEqual(self.w.store.check(doc["doc_id"])[0], "NO_BYTES")
        claim = o1.new_claim(doc=doc, locator={"kind": "html_text"}, quote="anything", extracted_by=sw.EXTRACTOR,
                             created_by="parser:t", created_utc=sw.UTC, synthetic=True,
                             assertion=sw.compat_afm("Alpha 1", "RS-100"))
        verified = o1.review_claim(claim, reviewer=sw.REVIEWER, decision="VERIFIED", reviewed_utc=sw.UTC)
        res = self.check(verified)
        self.assertEqual(res["effective_status"], "INVALID")
        self.assertIn("bytes_missing", res["reasons"])
        self.assertFalse(res["accepted"])

    def test_free_text_hash_is_not_a_proof(self):
        bad = dict(self.w.doc, sha256="deadbeef", bytes_state="present")
        with self.assertRaises(ContractError):
            o1.validate_document(bad)
        forged = dict(self.w.doc, sha256="0" * 64)  # well-formed but the doc_id no longer matches its content
        with self.assertRaises(ContractError):
            o1.validate_document(forged)

    def test_doc_id_is_content_derived(self):
        edited = dict(self.w.doc, url="https://synthetic.invalid/other")
        with self.assertRaises(ContractError):
            o1.validate_document(edited)

    def test_conflicting_reregistration_refused(self):
        other = copy.deepcopy(self.w.doc)
        other["language"] = "de"
        with self.assertRaises(ContractError):
            self.w.store.register(other)


class TestClaimLifecycle(_Base):
    def test_only_a_human_can_verify_or_reject(self):
        claim = o1.new_claim(doc=self.w.doc, locator={"kind": "html_text"}, quote="RS-100 rain shield fits Zeta Alpha 1.",
                             assertion=sw.compat_afm("Alpha 1", "RS-100"), extracted_by="llm:model-x",
                             created_by="parser:t", created_utc=sw.UTC, synthetic=True)
        for actor in ("llm:model-x", "parser:t", "tool:x", "someone"):
            with self.assertRaises(ContractError):
                o1.review_claim(claim, reviewer=actor, decision="VERIFIED", reviewed_utc=sw.UTC)
        verified = o1.review_claim(claim, reviewer="human:alice", decision="VERIFIED", reviewed_utc=sw.UTC)
        self.assertTrue(self.check(verified)["accepted"])

    def test_proposed_claims_are_never_accepted(self):
        claim = o1.new_claim(doc=self.w.doc, locator={"kind": "html_text"}, quote="RS-100 rain shield fits Zeta Alpha 1.",
                             assertion=sw.compat_afm("Alpha 1", "RS-100"), extracted_by=sw.EXTRACTOR,
                             created_by="parser:t", created_utc=sw.UTC, synthetic=True)
        res = self.check(claim)
        self.assertEqual((res["effective_status"], res["accepted"]), ("PROPOSED", False))
        self.assertIn("claim_proposed_unverified", res["reasons"])

    def test_reviewer_must_differ_from_extractor(self):
        claim = o1.new_claim(doc=self.w.doc, locator={"kind": "html_text"}, quote="RS-100 rain shield fits Zeta Alpha 1.",
                             assertion=sw.compat_afm("Alpha 1", "RS-100"), extracted_by="human:bob",
                             created_by="parser:t", created_utc=sw.UTC, synthetic=True)
        verified = o1.review_claim(claim, reviewer="human:bob", decision="VERIFIED", reviewed_utc=sw.UTC)
        res = self.check(verified)
        self.assertFalse(res["accepted"])
        self.assertIn("reviewer_equals_extractor", res["reasons"])
        self.assertTrue(self.check(verified, {**self.policy, "require_distinct_reviewer": False})["accepted"])

    def test_quote_must_be_found_in_the_captured_bytes(self):
        claim = o1.new_claim(doc=self.w.doc, locator={"kind": "html_text"}, quote="RS-100 fits every Zeta seat.",
                             assertion=sw.compat_afm("Alpha 1", "RS-100"), extracted_by=sw.EXTRACTOR,
                             created_by="parser:t", created_utc=sw.UTC, synthetic=True)
        res = self.check(o1.review_claim(claim, reviewer=sw.REVIEWER, decision="VERIFIED", reviewed_utc=sw.UTC))
        self.assertIn("quote_not_found", res["reasons"])
        self.assertEqual(res["effective_status"], "INVALID")

    def test_missing_quote_blocks_acceptance(self):
        claim = o1.new_claim(doc=self.w.doc, locator={"kind": "html_text"}, quote=None,
                             assertion=sw.compat_afm("Alpha 1", "RS-100"), extracted_by=sw.EXTRACTOR,
                             created_by="parser:t", created_utc=sw.UTC, synthetic=True)
        res = self.check(o1.review_claim(claim, reviewer=sw.REVIEWER, decision="VERIFIED", reviewed_utc=sw.UTC))
        self.assertIn("quote_missing", res["reasons"])

    def test_record_ref_locator_is_never_byte_backed(self):
        claim = o1.new_claim(doc=self.w.doc, locator={"kind": "record_ref", "ref": "pr167:x"}, quote="q",
                             assertion=sw.compat_afm("Alpha 1", "RS-100"), extracted_by=sw.EXTRACTOR,
                             created_by="parser:t", created_utc=sw.UTC, synthetic=True)
        res = self.check(o1.review_claim(claim, reviewer=sw.REVIEWER, decision="VERIFIED", reviewed_utc=sw.UTC))
        self.assertIn("locator_not_byte_backed", res["reasons"])

    def test_pdf_quote_needs_explicit_human_attestation(self):
        for claim in self.w.claims:
            if claim["locator"] == {"kind": "pdf_page", "page": 3}:
                self.assertEqual(claim["review"]["quote_attestation"], "human_attested")
                self.assertTrue(self.check(claim)["accepted"])
        pdf = o1.new_claim(doc=self.w.doc_pdf, locator={"kind": "pdf_page", "page": 3}, quote="RS-300 fits Alpha 3",
                           assertion=sw.compat_afm("Alpha 3", "RS-300"), extracted_by=sw.EXTRACTOR,
                           created_by="parser:t", created_utc=sw.UTC, synthetic=True)
        res = self.check(o1.review_claim(pdf, reviewer=sw.REVIEWER, decision="VERIFIED", reviewed_utc=sw.UTC))
        self.assertIn("quote_needs_human_attestation", res["reasons"])

    def test_html_text_extraction_ignores_script_and_style(self):
        for hidden in ("var q=1;", ".a{color:red}"):
            claim = o1.new_claim(doc=self.w.doc, locator={"kind": "html_text"}, quote=hidden,
                                 assertion=sw.compat_afm("Alpha 1", "RS-100"), extracted_by=sw.EXTRACTOR,
                                 created_by="parser:t", created_utc=sw.UTC, synthetic=True)
            res = self.check(o1.review_claim(claim, reviewer=sw.REVIEWER, decision="VERIFIED", reviewed_utc=sw.UTC))
            self.assertIn("quote_not_found", res["reasons"], hidden)

    def test_synthetic_evidence_is_refused_by_the_default_policy(self):
        claim = self.claim_for("RS-100 rain shield fits Zeta Alpha 1.")
        res = self.check(claim, policy={"as_of": "2026-11-17"})
        self.assertFalse(res["accepted"])
        self.assertIn("synthetic_not_allowed", res["reasons"])

    def test_claim_id_binds_content(self):
        claim = copy.deepcopy(self.claim_for("RS-100 rain shield fits Zeta Alpha 1."))
        claim["assertion"]["conditions_review_state"] = "unknown"  # edit without re-keying
        with self.assertRaises(ContractError):
            o1.validate_claim(claim)
        res = self.check(claim)
        self.assertEqual((res["declared_status"], res["effective_status"]), (None, "INVALID"))

    def test_rejected_is_terminal_and_history_is_append_only(self):
        claim = o1.new_claim(doc=self.w.doc, locator={"kind": "html_text"}, quote="RS-100 rain shield fits Zeta Alpha 1.",
                             assertion=sw.compat_afm("Alpha 1", "RS-100"), extracted_by=sw.EXTRACTOR,
                             created_by="parser:t", created_utc=sw.UTC, synthetic=True)
        rejected = o1.review_claim(claim, reviewer="human:alice", decision="REJECTED", reviewed_utc=sw.UTC, note="no")
        self.assertEqual([e["event"] for e in rejected["history"]], ["created", "reviewed"])
        with self.assertRaises(ContractError):
            o1.review_claim(rejected, reviewer="human:alice", decision="VERIFIED", reviewed_utc=sw.UTC)
        self.assertEqual(self.check(rejected)["effective_status"], "REJECTED")
        tampered = copy.deepcopy(rejected)
        tampered["history"].pop()
        with self.assertRaises(ContractError):
            o1.validate_claim(tampered)

    def test_verified_cannot_be_forged_by_editing_status(self):
        claim = o1.new_claim(doc=self.w.doc, locator={"kind": "html_text"}, quote="RS-100 rain shield fits Zeta Alpha 1.",
                             assertion=sw.compat_afm("Alpha 1", "RS-100"), extracted_by=sw.EXTRACTOR,
                             created_by="parser:t", created_utc=sw.UTC, synthetic=True)
        forged = copy.deepcopy(claim)
        forged["status"] = "VERIFIED"
        forged["review"] = {"reviewer": "llm:x", "decision": "VERIFIED", "reviewed_utc": sw.UTC, "note": "",
                            "quote_attestation": None}
        with self.assertRaises(ContractError):
            o1.validate_claim(forged)


class TestDriftAndSupersession(_Base):
    def test_new_capture_supersedes_old_and_claims_must_be_reverified(self):
        old_claim = self.claim_for("RS-100 rain shield fits Zeta Alpha 1.")
        new_doc = self.w.store.put_bytes(
            sw.HTML_V2, media_type="text/html", url="https://synthetic.invalid/acme", document_version="v2",
            issuer="acme", market="GB", language="en", document_date="2026-11-01", retrieved_utc=sw.UTC,
            captured_by="human:SYNTHETIC-capturer", synthetic=True, supersedes=self.w.doc["doc_id"])
        drift = o1.drift_report(self.w.store)
        self.assertEqual(len(drift), 1)
        self.assertEqual((drift[0]["supersedes"], drift[0]["same_bytes"]), (self.w.doc["doc_id"], False))
        res = self.check(old_claim)
        self.assertFalse(res["accepted"])
        self.assertIn("doc_superseded_reverify", res["reasons"])
        # the revised wording has to be re-extracted and re-verified against the new bytes
        revised = o1.new_claim(doc=new_doc, locator={"kind": "html_text"}, quote="RS-100 rain shield fits Zeta Alpha 1 (revised).",
                               assertion=sw.compat_afm("Alpha 1", "RS-100"), extracted_by=sw.EXTRACTOR,
                               created_by="parser:t", created_utc=sw.UTC, synthetic=True,
                               supersedes=old_claim["claim_id"])
        revised = o1.review_claim(revised, reviewer=sw.REVIEWER, decision="VERIFIED", reviewed_utc=sw.UTC)
        self.assertTrue(self.check(revised, superseded=frozenset())["accepted"])
        self.assertEqual(self.check(old_claim, superseded=frozenset({old_claim["claim_id"]}))["effective_status"],
                         "SUPERSEDED")

    def test_claim_matrix_is_sorted_and_deterministic(self):
        a = o1.claim_matrix(self.w.claims, self.w.store, self.policy)
        b = o1.claim_matrix(list(reversed(self.w.claims)), self.w.store, self.policy)
        self.assertEqual(a, b)
        self.assertEqual([r["claim_id"] for r in a], sorted(r["claim_id"] for r in a))
        self.assertTrue(all(r["effective_status"] in ("ACCEPTED", "PROPOSED", "INVALID", "REJECTED", "SUPERSEDED")
                            for r in a))


if __name__ == "__main__":
    unittest.main()
