"""Governance documents of Stage C (docs/oem-stage-c-20261118/) must be internally consistent and bound to their digests.

Checks: UTF-8 / LF / one final newline; docs metadata (Status / Applies to / Supersedes); the exact ``RISK CLASSIFICATION: HEAVY`` line;
the frozen alternatives-scan digest equals the digest quoted by the governance record (section 2 and one per decision row); the scan
evidence digest equals the real SHA-256 of ``governance/s5_scan_evidence.json`` and is quoted by both documents; every scanned candidate is
named in the scan document; exactly one recommendation per decision; the owner go-ahead is not claimed; every in-repository path the documents
cite exists; and every SHA-256 the documents quote is the real digest of a file of this stage or a digest already accepted with Stage B.
Skipped loudly when the documents are not next to the stage."""
from __future__ import annotations

import hashlib
import json
import re
import unittest
from pathlib import Path

from tests.helpers import ROOT

REPO = ROOT.parents[1]
DOCS = REPO / "docs" / "oem-stage-c-20261118"
STAGE_B_DOCS = REPO / "docs" / "oem-stage-b-20261117"
REVIEW_DOCS = REPO / "docs" / "oem-review-20261117"
SCAN, RECORD = DOCS / "S5_ALTERNATIVES_SCAN_20261118.md", DOCS / "S5_GOVERNANCE_RECORD_20261118.md"
RESULT = DOCS / "STAGE_C_RESULT_20261118.md"
EVIDENCE = ROOT / "governance" / "s5_scan_evidence.json"
PINS = ROOT / "engine_seam" / "ENGINE_SEAM_PINS.json"
HEAVY_LINE = "RISK CLASSIFICATION: HEAVY"
RECOMMENDATIONS = ("integrate", "keep-existing", "PoC-only", "reference", "build")
DECISIONS = ["C-D1", "C-D2", "C-D3", "C-D4", "C-D5"]
PATH_PREFIXES = ("rehearsal/v421-oem-stage-c/", "docs/oem-stage-c-20261118/", "rehearsal/v421-oem-stage-b/", "docs/oem-stage-b-20261117/",
                 "docs/oem-review-20261117/")
SIBLING = re.compile(r"[A-Z0-9_]+_(?:20261117|20261118)\.md")
SKIP_DIRS = {"__pycache__", ".hypothesis", "blobs"}


def binding_problems(scan: bytes, scan_text: str, record: str, evidence: bytes) -> list:
    """Problems in the digest binding between the frozen scan, its evidence file and the governance record."""
    problems = []
    scan_digest, evidence_digest = hashlib.sha256(scan).hexdigest(), hashlib.sha256(evidence).hexdigest()
    if record.count(scan_digest) < 1 + len(DECISIONS):
        problems.append("the record must quote the frozen scan digest in section 2 and in every decision row")
    if evidence_digest not in record or evidence_digest not in scan_text:
        problems.append("the scan evidence digest is not quoted by both documents")
    for stale in set(re.findall(r"`([0-9a-f]{64})`", record)) - {scan_digest, evidence_digest}:
        problems.append(f"the record quotes an unexplained SHA-256: {stale}")
    return problems


def quoted_digests(text: str) -> set:
    return set(re.findall(r"(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])", text))


def files_digests(*roots: Path) -> set:
    """SHA-256 of every regular file under the given roots (symlinks are followed once at the root, caches skipped)."""
    out = set()
    for root in roots:
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*")):
            if path.is_file() and not (SKIP_DIRS & set(path.relative_to(root).parts)) and not path.name.endswith(".pyc"):
                out.add(hashlib.sha256(path.read_bytes()).hexdigest())
    return out


def unknown_digests(text: str, known: set) -> list:
    return sorted(quoted_digests(text) - known)


class TestDigestBindingDetectsDrift(unittest.TestCase):
    """Non-vacuity: the binding checks must fail when a frozen file or a quoted digest changes."""

    SCAN_BYTES, EVIDENCE_BYTES = b"scan\n", b"evidence\n"

    def inputs(self):
        s, e = hashlib.sha256(self.SCAN_BYTES).hexdigest(), hashlib.sha256(self.EVIDENCE_BYTES).hexdigest()
        record = " ".join([f"`{s}`"] * (1 + len(DECISIONS)) + [f"`{e}`"])
        return self.SCAN_BYTES, f"`{e}`", record, self.EVIDENCE_BYTES

    def test_consistent_inputs_have_no_problems(self):
        self.assertEqual(binding_problems(*self.inputs()), [])

    def test_a_changed_scan_a_changed_evidence_or_a_missing_quote_is_reported(self):
        scan, scan_text, record, evidence = self.inputs()
        self.assertTrue(binding_problems(scan + b" ", scan_text, record, evidence))
        self.assertTrue(binding_problems(scan, scan_text, record, evidence + b" "))
        self.assertTrue(binding_problems(scan, "no digest here", record, evidence))
        self.assertTrue(binding_problems(scan, scan_text, record.replace("`" + hashlib.sha256(scan).hexdigest() + "` ", "", 1), evidence))
        self.assertTrue(binding_problems(scan, scan_text, record + " `" + "0" * 64 + "`", evidence))

    def test_a_quoted_digest_that_matches_no_file_is_reported(self):
        good = hashlib.sha256(b"a file").hexdigest()
        self.assertEqual(unknown_digests(f"`{good}`", {good}), [])
        self.assertEqual(unknown_digests(f"`{good[:-1]}0` and `{good}`", {good}), [good[:-1] + "0"])
        self.assertEqual(unknown_digests("a 63-char token " + good[:-1] + " and a 65-char one " + good + "0", {good}), [])


@unittest.skipUnless(DOCS.is_dir(), f"governance documents not found at {DOCS}: this suite was run without the docs directory")
class TestGovernanceDocs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.docs = sorted(DOCS.glob("*.md"))
        cls.text = {p.name: p.read_text(encoding="utf-8") for p in cls.docs}

    def test_the_two_s5_documents_exist(self):
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
        self.assertEqual(len(evidence["candidates"]), 19)
        self.assertIn("19 pypi candidates", scan)
        for candidate in evidence["candidates"]:
            self.assertIn(candidate["pypi_name"].lower(), scan, candidate["pypi_name"])

    def test_exactly_one_recommendation_per_decision(self):
        rows = [line for line in self.text[RECORD.name].splitlines() if re.match(r"\| C-D\d+ \|", line)]
        self.assertEqual([r.split("|")[1].strip() for r in rows], DECISIONS)
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
            self.assertRegex(text, r"(?i)not a production", name)
            self.assertNotRegex(text, r"(?i)\bOD[1-8]\b[^.\n]*\bis approved\b", name)
            self.assertNotRegex(text, r"(?i)(reviewer|owner) (has )?(accepted|approved) stage c", name)

    def test_every_cited_in_repository_path_exists(self):
        missing = []
        for name, text in self.text.items():
            for token in re.findall(r"`([^`\s]+)`", text):
                if any(c in token for c in "<>*{}"):
                    continue
                if SIBLING.fullmatch(token):  # a sibling document, or a Stage A / Stage B document
                    target = next((d / token for d in (DOCS, STAGE_B_DOCS, REVIEW_DOCS) if (d / token).exists()), DOCS / token)
                elif token.startswith(PATH_PREFIXES):
                    target = REPO / token.rstrip("/")
                else:
                    continue
                if not target.exists():
                    missing.append(f"{name}: {token}")
        self.assertEqual(missing, [], "documents cite files that do not exist")

    def test_every_quoted_sha256_is_the_real_digest_of_a_file_or_an_accepted_stage_b_digest(self):
        """A mistyped or stale digest in a report is as bad as a wrong number: each one must be traceable to a real file."""
        known = files_digests(ROOT, DOCS, STAGE_B_DOCS, REVIEW_DOCS, ROOT.parent / "v421-oem-stage-b")
        # the engine files and the corrected-baseline pins are quoted by the accepted Stage B result, not stored in the repository
        accepted = quoted_digests((STAGE_B_DOCS / "STAGE_B_RESULT_20261117.md").read_text(encoding="utf-8")) if STAGE_B_DOCS.is_dir() else set()
        problems = {name: unknown_digests(text, known | accepted) for name, text in self.text.items()}
        self.assertEqual({k: v for k, v in problems.items() if v}, {}, "quoted SHA-256 values that match no file and no accepted Stage B digest")

    def test_the_result_document_quotes_the_pinned_engine_seam_digests(self):
        if not RESULT.is_file():
            self.skipTest("the result document is not part of this tree")
        pins = json.loads(PINS.read_text(encoding="utf-8"))
        quoted = quoted_digests(self.text[RESULT.name])
        for key in ("base_sha256", "patched_sha256", "patch_sha256", "helpers_sha256"):
            self.assertIn(pins[key], quoted, f"the result document must quote the pinned {key}")


if __name__ == "__main__":
    unittest.main()
