"""Governance documents of Stage B (docs/oem-stage-b-20261117/) must be internally consistent and bound to their digests.

Checks: UTF-8 / LF / one final newline; docs metadata (Status / Applies to / Supersedes); the exact ``RISK CLASSIFICATION: HEAVY`` line;
the frozen alternatives-scan digest equals the digest quoted by the governance record; the scan evidence digest equals the one quoted
by both documents; every scanned candidate is named in the scan document; exactly one recommendation per decision; the owner go-ahead
is not claimed; and every in-repository path the documents cite exists. Skipped loudly when the documents are not next to the stage."""
from __future__ import annotations

import hashlib
import json
import re
import unittest
from pathlib import Path

from tests.helpers import ROOT

REPO = ROOT.parents[1]
DOCS = REPO / "docs" / "oem-stage-b-20261117"
REVIEW_DOCS = REPO / "docs" / "oem-review-20261117"
SCAN, RECORD = DOCS / "S0_ALTERNATIVES_SCAN_20261117.md", DOCS / "S0_GOVERNANCE_RECORD_20261117.md"
EVIDENCE = ROOT / "governance" / "s0_scan_evidence.json"
HEAVY_LINE = "RISK CLASSIFICATION: HEAVY"
RECOMMENDATIONS = ("integrate", "keep-existing", "PoC-only", "reference", "build")
PATH_PREFIXES = ("rehearsal/v421-oem-stage-b/", "docs/oem-stage-b-20261117/")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def binding_problems(scan: bytes, scan_text: str, record: str, evidence: bytes) -> list:
    """Problems in the digest binding between the frozen scan, its evidence file and the governance record."""
    problems = []
    scan_digest, evidence_digest = hashlib.sha256(scan).hexdigest(), hashlib.sha256(evidence).hexdigest()
    if record.count(scan_digest) < 3:
        problems.append("the record must quote the frozen scan digest in section 2 and in both decision rows")
    if evidence_digest not in record or evidence_digest not in scan_text:
        problems.append("the scan evidence digest is not quoted by both documents")
    for stale in set(re.findall(r"`([0-9a-f]{64})`", record)) - {scan_digest, evidence_digest}:
        problems.append(f"the record quotes an unexplained SHA-256: {stale}")
    return problems


class TestDigestBindingDetectsDrift(unittest.TestCase):
    """Non-vacuity: the binding check must fail when a frozen file or a quoted digest changes."""

    RECORD = "`{s}` `{s}` `{s}` `{e}`"
    SCAN_BYTES, EVIDENCE_BYTES = b"scan\n", b"evidence\n"

    def inputs(self):
        s, e = hashlib.sha256(self.SCAN_BYTES).hexdigest(), hashlib.sha256(self.EVIDENCE_BYTES).hexdigest()
        return self.SCAN_BYTES, f"`{e}`", self.RECORD.format(s=s, e=e), self.EVIDENCE_BYTES

    def test_consistent_inputs_have_no_problems(self):
        self.assertEqual(binding_problems(*self.inputs()), [])

    def test_a_changed_scan_a_changed_evidence_or_a_missing_quote_is_reported(self):
        scan, scan_text, record, evidence = self.inputs()
        self.assertTrue(binding_problems(scan + b" ", scan_text, record, evidence))
        self.assertTrue(binding_problems(scan, scan_text, record, evidence + b" "))
        self.assertTrue(binding_problems(scan, "no digest here", record, evidence))
        self.assertTrue(binding_problems(scan, scan_text, record.replace("`" + hashlib.sha256(scan).hexdigest() + "` ", "", 1), evidence))
        self.assertTrue(binding_problems(scan, scan_text, record + " `" + "0" * 64 + "`", evidence))


@unittest.skipUnless(DOCS.is_dir(), f"governance documents not found at {DOCS}: this suite was run without the docs directory")
class TestGovernanceDocs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.docs = sorted(DOCS.glob("*.md"))
        cls.text = {p.name: p.read_text(encoding="utf-8") for p in cls.docs}

    def test_the_two_s0_documents_exist(self):
        self.assertTrue(SCAN.is_file() and RECORD.is_file())

    def test_encoding_line_endings_and_final_newline(self):
        for path in self.docs:
            data = path.read_bytes()
            data.decode("utf-8")
            self.assertNotIn(b"\r", data, path.name)
            self.assertTrue(data.endswith(b"\n") and not data.endswith(b"\n\n"), f"{path.name}: exactly one final newline")

    def test_docs_metadata_block(self):
        for name, text in self.text.items():
            head = text.splitlines()[:12]
            for key in ("Status:", "Applies to:", "Supersedes:"):
                self.assertTrue(any(line.startswith(key) for line in head), f"{name}: missing '{key}' in the header")

    def test_the_exact_risk_classification_line(self):
        for path in (SCAN, RECORD):
            self.assertIn(HEAVY_LINE, self.text[path.name].splitlines(), path.name)
            self.assertEqual(len(re.findall(r"RISK CLASSIFICATION:", self.text[path.name])), 1, path.name)

    def test_the_digests_bind_the_scan_its_evidence_and_the_record(self):
        self.assertEqual(binding_problems(SCAN.read_bytes(), self.text[SCAN.name], self.text[RECORD.name], EVIDENCE.read_bytes()), [])

    def test_every_scanned_candidate_is_named_with_an_explicit_reason(self):
        evidence = json.loads(EVIDENCE.read_text(encoding="utf-8"))
        scan = self.text[SCAN.name].lower()
        self.assertEqual(evidence["failures"], [])
        self.assertEqual(len(evidence["candidates"]), 29)
        self.assertIn("29 pypi candidates", scan)
        for candidate in evidence["candidates"]:
            self.assertIn(candidate["pypi_name"].lower(), scan, candidate["pypi_name"])

    def test_exactly_one_recommendation_per_decision(self):
        rows = [line for line in self.text[RECORD.name].splitlines() if re.match(r"\| D\d+ \|", line)]
        self.assertEqual([r.split("|")[1].strip() for r in rows], ["D1", "D2"])
        for row in rows:
            cell = row.split("|")[3]
            found = re.findall(r"\*\*([A-Za-z-]+)\*\*", cell)
            self.assertEqual(len(found), 1, row)
            self.assertIn(found[0], RECOMMENDATIONS)

    def test_owner_go_ahead_for_the_integrate_decision_is_not_claimed(self):
        record = self.text[RECORD.name]
        self.assertIn("**NOT RECEIVED**", record)
        self.assertNotRegex(record, r"(?i)owner (has )?approved|go-ahead (was )?received")

    def test_no_document_claims_authorization_or_approval(self):
        for name, text in self.text.items():
            if name == SCAN.name:
                continue
            self.assertRegex(text, r"(?i)not a production|NOT a production", name)
        self.assertNotRegex(self.text[RECORD.name], r"(?i)\bOD[1-8]\b[^.\n]*\bis approved\b")

    def test_every_cited_in_repository_path_exists(self):
        missing = []
        for name, text in self.text.items():
            for token in re.findall(r"`([^`\s]+)`", text):
                if any(c in token for c in "<>*{}"):
                    continue
                if re.fullmatch(r"[A-Z0-9_]+_20261117\.md", token):  # a sibling document, or a Stage A document
                    target = next((d / token for d in (DOCS, REVIEW_DOCS) if (d / token).exists()), DOCS / token)
                elif token.startswith(PATH_PREFIXES):
                    target = REPO / token.rstrip("/")
                else:
                    continue
                if not target.exists():
                    missing.append(f"{name}: {token}")
        self.assertEqual(missing, [], "documents cite files that do not exist")


if __name__ == "__main__":
    unittest.main()
