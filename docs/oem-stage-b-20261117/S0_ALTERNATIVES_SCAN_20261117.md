# BabyPark V4.2.1 OEM-fitment — Stage B S0 bounded alternatives scan

Status: EVIDENCE — NON-NORMATIVE pre-code decision record.
Applies to: Stage B (S1–S4 shadow O1–O4) of the OEM-fitment campaign, branch `feat/v421-oem-stage-b-20261117`, directory `rehearsal/v421-oem-stage-b/` only. Not a production, rollout or publishing authorization.
Supersedes: none. (Stage A `BEST_PRACTICES_REVIEW.md` is reused as reference for data-model standards and is not re-researched, as the Stage B lock requires.)

RISK CLASSIFICATION: HEAVY

Scan time (UTC): 2026-11-17T17:35:53Z.
Discovery tool (reproducible): `rehearsal/v421-oem-stage-b/governance/s0_alternatives_scan.py` (PyPI JSON API only).
Raw evidence file: `rehearsal/v421-oem-stage-b/governance/s0_scan_evidence.json`, SHA-256 `e20b5006751f56bebc92dd0a88306efc849767e1f8497a0aadce2ed50c538e4c`.
This document's own SHA-256 is recorded in `S0_GOVERNANCE_RECORD_20261117.md` and `SHA256SUMS.txt` (UTF-8, LF, final newline); the implementation decision is bound to that digest.

## 1. Bounded requirements and invariants (what counts as a fit)

Sources: `docs/oem-review-20261117/STAGE_B_EXECUTION_LOCK_20261117.md` (the lock) and `INDEPENDENT_VERDICT_20261117.md` Task B; Agreement §§1, 3, 7.0.

| ID | Requirement | Source |
| --- | --- | --- |
| R1 | Runtime O1–O4 stage is a separate deterministic module using only the Python standard library; offline; no clock; no new runtime dependency on the rehearsal host. | INDEPENDENT_VERDICT Task B; lock "No new producer-specific code" |
| R2 | Strict typed records (document, claim, model/alias, article binding, relation) that fail closed on unknown/malformed input, plus cross-record invariants: content-derived ids, SHA-256 recomputed over captured bytes, claim bound to document, distinct reviewer, human-only VERIFIED. | lock O1, O3, O4, OD1 |
| R3 | Typed condition language: closed vocabulary, three-valued (unknown never passes), unsupported shape/attribute/value fails closed, bounded depth/size, no code execution. | lock O4 |
| R4 | Exact maker-scoped model identity plus reviewed, explicitly scoped aliases; no fuzzy title matching, no global homoglyph fold; `canonical_models.key()` alone is not an identity proof. | lock O2, OD8 |
| R5 | Quote verification over captured bytes: HTML visible text checked mechanically; PDF quotes carry explicit human page attestation. | lock O1 |
| R6 | Provenance fields only (document → claim → extractor → reviewer); no RDF/PROV store. | Stage A `BEST_PRACTICES_REVIEW.md` P5 |
| R7 | HEAVY combinatorial/stateful behavior gets property/state-space tests with maintained OSS tooling (test-only, reproducible, synthetic data only). | Agreement §7.0; lock "property tests for ambiguous aliases and fail-closed conditions" |
| R8 | Licensing permits commercial repository use without a paid tier or usage cap, including required transitive components. | Agreement §3 |

Maintenance signal used below: latest PyPI release within 12 months of the scan time (observation, not a security assertion).

## 2. Decision order (Agreement §1) and sources

1. Verified native capability of the component in scope: the deployed V4.2.1 engine has no typed OEM evidence/identity/relation capability; it has legacy `manufacturer_fitment_match()` over the `fitment_rules` array and `canonical_models.key()` (lock: not an identity proof); `INDEPENDENT_VERDICT_20261117.md` lists the missing typed relations, provenance and identity. Result: FAIL for R2–R5; the legacy code is kept unchanged.
2. Implemented and proven existing repository capability: none fits R2–R6 (Stage A `PR167_ARCHITECTURE_GAPS.md`; PR #167 is an unmerged experimental source, not a capability).
3. Maintained OSS: PyPI discovery below (queries recorded per candidate in the evidence file; bounded to Python libraries, because the engine is Python).
4. Ready external product: none named by the owner; none plausible for a stdlib-only, offline, rehearsal-hosted stage.
5. Custom BabyPark code: last resort, justified in §5.

Owner-named candidates: none in the Stage B lock. Stage A already fixed the architecture (variant B); it is not re-opened here. Data-model standards (ACES/PIES, TecDoc, Schema.org, GS1/GDSN, W3C PROV-O, UTS #39) were assessed in Stage A `BEST_PRACTICES_REVIEW.md` §§2–3 (taken as principles, formats/databases not taken); no runtime candidate results from them.

## 3. Candidate matrix (29 PyPI candidates; every row has an explicit reason)

Basis of evaluation: PyPI metadata (version, license, requires-python, core requirements, release dates) and the documented purpose of each project. No candidate was installed or exercised except Hypothesis, which the Stage B property tests exercise. "Core deps" counts non-extra requirements from the evidence file.

### RA1 — property/state-space test tooling (R7, R8; test-only)

| Candidate (version, license, last release) | Fit | Decision and reason |
| --- | --- | --- |
| hypothesis 6.170.15, MPL-2.0, 2026-11-06 (1,594 releases, first 2013); core dep: sortedcontainers | PASS generation + shrinking; PASS derandomized reproducible runs; PASS test-only/no service; PASS commercial use (MPL-2.0 is file-level; used unmodified, not distributed, test-only); PARTIAL requires Python ≥ 3.11 on the machine that runs the property tests | SELECT as test-only dev dependency (pinned with hashes in `requirements-test.txt`) |
| sortedcontainers 2.4.0, Apache Software License, 2021-05-16 | PASS license; stable pure-Python component | Required component of hypothesis; hash-pinned; weak recent-release signal accepted because it is test-only and pinned |
| crosshair-tool 0.0.113, MIT, 2026-11-05; core deps 7 | PARTIAL: contract/symbolic checking, not a generative state-space tool with shrinking for unittest-style tests; pre-1.0 | DEFER: not a drop-in for the required alias/condition generators |
| atheris 3.1.0, license UNSPECIFIED in PyPI metadata (not verified), 2026-06-17 | PARTIAL: coverage-guided fuzzing, no structured generators; license not established by this scan | EXCLUDE |
| Custom property framework | Not needed: Hypothesis fits | BUILD rejected (Agreement §7.0) |

### RA2 — typed record validation (R1, R2)

| Candidate | Fit | Decision and reason |
| --- | --- | --- |
| jsonschema 4.26.0, MIT, 2026-01-07; core deps 4 | PASS shape validation; FAIL cross-record invariants (hash recompute, claim↔document binding, reviewer distinctness); FAIL R1 | EXCLUDE |
| pydantic 2.14.3, MIT, 2026-11-05; core deps 4 | PASS typed shape validation; FAIL cross-record invariants; FAIL R1 | EXCLUDE |
| msgspec 0.22.0, BSD-3-Clause, 2026-09-29; core deps 0 | PASS typed decoding; FAIL cross-record invariants; FAIL R1 (runtime package outside stdlib) | EXCLUDE |
| fastjsonschema 2.22.3, BSD License, 2026-11-01; core deps 0 | PARTIAL shape only; FAIL cross-record invariants; FAIL R1 | EXCLUDE |
| voluptuous 0.16.0, BSD License, 2025-12-18; core deps 0 | PARTIAL shape only; FAIL cross-record invariants; FAIL R1 | EXCLUDE |
| cerberus 1.3.8, ISC License, 2025-11-06; core deps 1 | PARTIAL shape only; FAIL cross-record invariants; FAIL R1 | EXCLUDE |

### RA3 — condition expression language (R1, R3)

| Candidate | Fit | Decision and reason |
| --- | --- | --- |
| cel-python 0.5.0, license UNSPECIFIED in PyPI metadata (not verified), 2026-01-31; core deps 7 | PARTIAL general expression language; no closed vocabulary or unknown-never-passes guarantee by construction; FAIL R1 | EXCLUDE |
| json-logic 0.6.3, MIT License, 2015-12-04; core deps 0 | FAIL maintenance (last release 2015); no vocabulary closure | EXCLUDE |
| simpleeval 1.0.8, MIT License, 2026-09-12; core deps 0 | PARTIAL safe evaluation of free-form expressions; vocabulary closure and three-valued unknown are not provided; FAIL R1 | EXCLUDE |

### RA4 — model identity (R1, R4)

| Candidate | Fit | Decision and reason |
| --- | --- | --- |
| rapidfuzz 3.14.6 (MIT, 2026-08-30), thefuzz 0.22.1 (MIT License, 2024-01-19), recordlinkage 0.16 (BSD License, 2023-07-20), dedupe 3.0.3 (MIT License, 2024-08-15), splink 5.0.0 (MIT, 2026-09-28) | FAIL R4: approximate/probabilistic matching is exactly what the lock forbids for identity; FAIL R1; three of five are also stale by the 12-month signal | EXCLUDE as identity authority; may be revisited only as a non-authoritative alias-suggestion queue for human review (not part of S1–S4) |
| Unidecode 1.4.0, GNU General Public License v2 or later (PyPI classifier), 2025-04-24 | FAIL R4: transliteration is a global fold; R8 not established (GPL-2.0-or-later copyleft) | EXCLUDE |
| confusable-homoglyphs 3.3.1, MIT License, 2024-01-30; core deps 0 | PARTIAL detection of confusable/mixed script; stale signal; FAIL R1 | EXCLUDE: stdlib `unicodedata` script-prefix classification covers the required block flag and is property-tested; revisit if UTS #39 skeletons become a requirement |

### RA5 — text extraction for quote verification (R1, R5)

| Candidate | Fit | Decision and reason |
| --- | --- | --- |
| beautifulsoup4 4.15.0 (MIT License, 2026-06-07; core deps 2), lxml 6.1.3 (BSD-3-Clause, 2026-09-03; core deps 0), selectolax 1.0.2 (MIT, 2026-10-22; core deps 0), trafilatura 2.3.1 (Apache-2.0, 2026-10-06; core deps 7) | PASS HTML text extraction; PARTIAL need (substring containment of a normalized quote over visible text only); FAIL R1 | EXCLUDE: stdlib `html.parser` extracts visible text ignoring script/style and is tested against tampering and quote-mismatch cases |
| pypdf 7.1.0 (BSD-3-Clause, 2026-11-13; core deps 1), pdfminer.six 20260107 (MIT, 2026-01-07; core deps 2) | PASS PDF text extraction; FAIL R1 | DEFER: Stage B stores PDF claims with explicit human page attestation; a machine PDF check needs a later owner decision on a runtime dependency |
| PyMuPDF 2.1, dual GNU AGPL 3.0 / commercial (PyPI), 2026-11-02; core deps 9 | FAIL R8: AGPL or a commercial license; FAIL R1 | EXCLUDE |

### RA6 — provenance format (R1, R6)

| Candidate | Fit | Decision and reason |
| --- | --- | --- |
| prov 3.3.0, MIT, 2026-11-08; core deps 0 | PARTIAL W3C PROV data model; over-scoped (graph/RDF serializations); FAIL R1 | EXCLUDE: Stage A took only the field subset (document, claim, extractor, reviewer) |
| in-toto 3.1.0, Apache-2.0, 2026-04-25; core deps 5 | PARTIAL software-supply-chain attestations; over-scoped; FAIL R1 | EXCLUDE |

## 4. What the scan does and does not establish

- Establishes: no scanned PyPI candidate satisfies R1 together with R2–R6 for the runtime stage, and Hypothesis satisfies R7/R8 as a test-only tool.
- Does not establish: security posture of any candidate, behavior of non-Hypothesis candidates beyond their documented purpose, or the license of candidates whose PyPI metadata says UNSPECIFIED. The Python version of the rehearsal host was not observed; Hypothesis needs Python ≥ 3.11 and the property tests skip loudly when it is absent.
- Reproducibility: `python3 governance/s0_alternatives_scan.py --out <file>` re-observes the same candidates; it will record a new scan time and possibly new versions, which is a new scan with a new digest and invalidates the decision bound to this one (Agreement §1).

## 5. Recommendation (Agreement §3: exactly one per bounded decision)

- D1 — runtime O1–O4 (custom code under `rehearsal/v421-oem-stage-b/oem_stage/`): **build**. Rationale: steps 1–4 of the decision order produce no proven fit for R1–R6 (above); the custom code is stdlib-only, data-driven, contains no producer-specific logic, and is shadow-only (no engine seam, no production write).
- D2 — property/state-space test tooling: **integrate** `hypothesis` 6.170.15 (+ `sortedcontainers` 2.4.0) as a test-only development dependency, hash-pinned in `requirements-test.txt`. No production import, no network at test time, no customer data (synthetic strings only). The owner go-ahead for this `integrate` recommendation, bound to the fit-note digest in the governance record, is NOT yet received; removing `requirements-test.txt` and `tests/test_properties.py` leaves runtime and all other tests unaffected.
