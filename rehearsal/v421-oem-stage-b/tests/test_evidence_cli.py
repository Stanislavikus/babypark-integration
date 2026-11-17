"""tools/evidence_cli.py: the operator workflow around O1 (register -> propose -> HUMAN review -> verify).

Fixtures are SYNTHETIC (fictional makers, fabricated bytes, test-double reviewer ids). Nothing here is real OEM evidence."""
from __future__ import annotations

import contextlib
import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

from tests.helpers import ROOT
from tests.synthetic_world import HTML

sys.path.insert(0, str(ROOT / "tools"))
import evidence_cli as cli  # noqa: E402

UTC = "2026-11-17T10:00:00Z"
EXTRACTOR, REVIEWER = "human:SYNTHETIC-extractor", "human:SYNTHETIC-reviewer"
QUOTE = "RS-100 rain shield fits Zeta Alpha 1."
ASSERTION = {"type": "compatible", "relation_type": "accessory_for_model", "conditions": [],
             "conditions_review_state": "verified_none",
             "ends": {"accessory": {"maker_id": "acme", "mpn": "RS-100"}, "model": {"maker_id": "zeta", "name": "Zeta Alpha 1"}}}


def run(*argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = cli.main([str(a) for a in argv])
    return code, out.getvalue(), err.getvalue()


class CliCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.data, self.blobs = self.root / "data", self.root / "blobs"
        self.data.mkdir()
        self.html = self.root / "acme.html"
        self.html.write_bytes(HTML if isinstance(HTML, bytes) else HTML.encode("utf-8"))

    def tearDown(self):
        self._tmp.cleanup()

    def base(self):
        return ["--data-dir", self.data, "--blob-root", self.blobs]

    def register(self, path=None, media="text/html", version="v1", extra=()):
        code, out, err = run("register-doc", *self.base(), "--file", path or self.html, "--issuer", "acme", "--media-type", media,
                             "--url", "https://example.invalid/acme", "--document-version", version, "--document-date", "2026-11-01",
                             "--market", "EU", "--language", "en", "--retrieved-utc", UTC, "--captured-by", "human:SYNTHETIC-operator",
                             "--synthetic", *extra)
        self.assertEqual(code, 0, err)
        return out.split()[1]

    def add_claim(self, doc_id, *, quote=QUOTE, locator=None, assertion=None, extracted_by=EXTRACTOR):
        code, out, err = run("add-claim", *self.base(), "--doc-id", doc_id, "--locator", json.dumps(locator or {"kind": "html_text"}),
                             "--quote", quote, "--assertion", json.dumps(assertion or ASSERTION), "--extracted-by", extracted_by,
                             "--created-by", extracted_by, "--created-utc", UTC, "--synthetic")
        self.assertEqual(code, 0, err)
        return out.split()[1]

    def review(self, claim_id, reviewer=REVIEWER, decision="VERIFIED", extra=()):
        return run("review-claim", *self.base(), "--claim-id", claim_id, "--reviewer", reviewer, "--decision", decision,
                   "--reviewed-utc", UTC, "--allow-synthetic", *extra)

    def verify(self, *extra):
        return run("verify", *self.base(), *extra)

    def snapshot(self):
        return {p.name: p.read_bytes() for p in sorted(self.data.iterdir())}


class TestLifecycle(CliCase):
    def test_accepts_only_a_distinct_human_reviewed_byte_backed_claim(self):
        doc = self.register()
        claim = self.add_claim(doc)
        code, out, _ = self.verify("--allow-synthetic")
        self.assertEqual(code, 0, out)
        self.assertIn("accepted=0", out)
        code, out, err = self.review(claim)
        self.assertEqual(code, 0, err)
        self.assertIn("effective=ACCEPTED accepted=True", out)
        code, out, _ = self.verify("--allow-synthetic")
        self.assertEqual((code, "accepted=1" in out, "EVIDENCE PASS" in out), (0, True, True))
        # the default policy refuses synthetic evidence: the same claim is VERIFIED-but-not-accepted -> FAIL
        code, out, _ = self.verify()
        self.assertEqual(code, 1)
        self.assertIn("synthetic_not_allowed", out)

    def test_non_human_reviewers_are_refused_and_nothing_is_written(self):
        claim = self.add_claim(self.register())
        before = self.snapshot()
        for reviewer in ("llm:gpt-5", "parser:regex-1", "human:", "alice", ""):
            code, _, err = self.review(claim, reviewer=reviewer)
            self.assertEqual(code, 2, reviewer)
            self.assertIn("ERROR", err)
        self.assertEqual(before, self.snapshot())

    def test_reviewer_equal_to_extractor_is_not_accepted(self):
        claim = self.add_claim(self.register(), extracted_by=REVIEWER)
        code, out, _ = self.review(claim)
        self.assertEqual(code, 0)
        self.assertIn("effective=INVALID", out)
        self.assertIn("reviewer_equals_extractor", out)
        code, out, _ = self.verify("--allow-synthetic")
        self.assertEqual(code, 1)
        self.assertIn("declared VERIFIED but INVALID", out)

    def test_a_quote_that_is_not_in_the_document_cannot_be_accepted(self):
        claim = self.add_claim(self.register(), quote="RS-100 rain shield fits Zeta Alpha 99.")
        _, out, _ = self.review(claim)
        self.assertIn("quote_not_found", out)
        self.assertEqual(self.verify("--allow-synthetic")[0], 1)

    def test_rejected_claims_are_reported_not_hidden(self):
        claim = self.add_claim(self.register())
        code, out, _ = self.review(claim, decision="REJECTED")
        self.assertEqual(code, 0)
        self.assertIn("effective=REJECTED", out)
        code, out, _ = self.verify("--allow-synthetic")
        self.assertEqual(code, 0)
        self.assertIn("'REJECTED': 1", out)
        # a rejected claim cannot be verified afterwards
        self.assertEqual(self.review(claim)[0], 2)

    def test_pdf_page_quotes_need_a_human_attestation(self):
        pdf = self.root / "acme.pdf"
        pdf.write_bytes(b"%PDF-1.4 synthetic fixture bytes")
        doc = self.register(pdf, media="application/pdf", version="pdf1")
        loc = lambda page: {"kind": "pdf_page", "page": page}  # noqa: E731
        plain, attested = self.add_claim(doc, locator=loc(1)), self.add_claim(doc, locator=loc(2))
        self.assertIn("quote_needs_human_attestation", self.review(plain)[1])
        out = self.review(attested, extra=("--quote-attestation", "human_attested"))[1]
        self.assertIn("effective=ACCEPTED", out)


class TestIntegrity(CliCase):
    def test_tampered_blob_is_detected_by_the_recomputed_sha256(self):
        doc = self.register()
        self.add_claim(doc)
        sha = json.loads((self.data / "documents.json").read_text(encoding="utf-8"))["documents"][0]["sha256"]
        blob = self.blobs / sha[:2] / sha
        blob.write_bytes(blob.read_bytes() + b"<!-- edited -->")
        code, out, _ = self.verify("--allow-synthetic")
        self.assertEqual(code, 1)
        self.assertIn("HASH_MISMATCH", out)

    def test_a_missing_blob_is_an_integrity_problem(self):
        self.add_claim(self.register())
        shutil.rmtree(self.blobs)
        code, out, _ = self.verify("--allow-synthetic")
        self.assertEqual(code, 1)
        self.assertIn("MISSING_BYTES", out)

    def test_url_only_documents_stay_on_hold_and_can_never_back_an_accepted_claim(self):
        code, out, err = run("register-doc", *self.base(), "--no-bytes", "--issuer", "acme", "--media-type", "text/html",
                             "--url", "https://example.invalid/url-only", "--document-version", "v1", "--document-date", "2026-11-01",
                             "--market", "EU", "--language", "en", "--retrieved-utc", UTC, "--captured-by", "human:SYNTHETIC-operator",
                             "--synthetic")
        self.assertEqual(code, 0, err)
        doc = out.split()[1]
        claim = self.add_claim(doc)
        code, out, _ = self.verify("--allow-synthetic")
        self.assertEqual(code, 0)  # honest hold, not an error
        self.assertIn("no bytes: 1", out)
        self.assertIn("accepted=0", out)
        self.assertIn("bytes_missing", self.review(claim)[1])
        self.assertEqual(self.verify("--allow-synthetic")[0], 1)

    def test_verify_report_is_deterministic(self):
        self.add_claim(self.register())
        first, second = self.root / "a.json", self.root / "b.json"
        self.assertEqual(self.verify("--allow-synthetic", "--json", first)[0], 0)
        self.assertEqual(self.verify("--allow-synthetic", "--json", second)[0], 0)
        self.assertEqual(first.read_bytes(), second.read_bytes())
        report = json.loads(first.read_text(encoding="utf-8"))
        self.assertEqual((report["schema"], report["result"]), ("bp-oem-evidence-verify-v1", "PASS"))


class TestInputValidation(CliCase):
    def test_bad_inputs_exit_2_and_leave_the_files_untouched(self):
        doc = self.register()
        claim = self.add_claim(doc)
        before = self.snapshot()
        bad_assertions = [{"type": "unknown"}, {**ASSERTION, "conditions_review_state": "maybe"},
                          {**ASSERTION, "ends": {"accessory": {"maker_id": "acme"}, "model": ASSERTION["ends"]["model"]}}]
        for assertion in bad_assertions:
            code, _, err = run("add-claim", *self.base(), "--doc-id", doc, "--locator", json.dumps({"kind": "html_text"}), "--quote", QUOTE,
                               "--assertion", json.dumps(assertion), "--extracted-by", EXTRACTOR, "--created-by", EXTRACTOR,
                               "--created-utc", UTC, "--synthetic")
            self.assertEqual(code, 2, assertion)
            self.assertIn("ERROR", err)
        code, _, err = run("add-claim", *self.base(), "--doc-id", "doc:unknown", "--locator", "{}", "--quote", QUOTE,
                           "--assertion", json.dumps(ASSERTION), "--extracted-by", EXTRACTOR, "--created-by", EXTRACTOR,
                           "--created-utc", UTC)
        self.assertEqual((code, "unknown doc_id" in err), (2, True))
        code, _, err = run("add-claim", *self.base(), "--doc-id", doc, "--locator", json.dumps({"kind": "html_text"}), "--quote", QUOTE,
                           "--assertion", json.dumps(ASSERTION), "--extracted-by", EXTRACTOR, "--created-by", EXTRACTOR,
                           "--created-utc", UTC, "--synthetic")
        self.assertEqual((code, "already recorded" in err), (2, True))
        self.assertEqual(run("review-claim", *self.base(), "--claim-id", "clm:nope", "--reviewer", REVIEWER, "--decision", "VERIFIED",
                             "--reviewed-utc", UTC)[0], 2)
        self.assertEqual(before, self.snapshot())
        self.assertTrue(claim.startswith("clm:"))

    def test_only_the_two_data_files_and_blobs_are_written(self):
        claim = self.add_claim(self.register())
        self.review(claim)
        self.verify("--allow-synthetic")
        self.assertEqual(sorted(self.snapshot()), ["claims.json", "documents.json"])
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ["acme.html", "blobs", "data"])

    def test_conflicting_reregistration_is_refused_and_identical_is_idempotent(self):
        first = self.register()
        again = self.register()
        self.assertEqual(first, again)
        docs = json.loads((self.data / "documents.json").read_text(encoding="utf-8"))["documents"]
        self.assertEqual(len(docs), 1)

    def test_registering_bytes_without_a_blob_root_is_refused(self):
        code, _, err = run("register-doc", "--data-dir", self.data, "--file", self.html, "--issuer", "acme", "--media-type", "text/html",
                           "--url", "https://example.invalid/acme", "--document-version", "v1", "--document-date", "2026-11-01",
                           "--market", "EU", "--language", "en", "--retrieved-utc", UTC, "--captured-by", "human:SYNTHETIC-operator")
        self.assertEqual(code, 2)
        self.assertIn("--blob-root", err)


class TestRealSeeds(unittest.TestCase):
    def test_seed_evidence_stays_proposed_and_nothing_is_accepted(self):
        seeds = ROOT / "data" / "seeds"
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp) / "data"
            data.mkdir()
            for name in ("documents.json", "claims.json"):
                shutil.copy(seeds / name, data / name)
            report_path = Path(tmp) / "report.json"
            code, out, _ = run("verify", "--data-dir", data, "--json", report_path)
            report = json.loads(report_path.read_text(encoding="utf-8"))
        self.assertEqual(code, 0, out)
        self.assertEqual(report["summary"]["accepted"], 0)
        self.assertEqual(set(report["summary"]["by_effective_status"]), {"PROPOSED"})
        self.assertEqual(report["summary"]["documents_without_bytes"], report["summary"]["documents"])
        self.assertTrue(all(d["state"] == "NO_BYTES" for d in report["documents"]))


if __name__ == "__main__":
    unittest.main()
