# BabyPark V4.2.1 OEM-fitment — Stage C (S5–S6) bounded alternatives scan

Status: EVIDENCE — NON-NORMATIVE pre-code decision record.
Applies to: Stage C (S5 engine seam, S6 replay/diff/Stage1 preparation) of the OEM-fitment campaign, branch `feat/v421-oem-stage-c-20261118`, directories `rehearsal/v421-oem-stage-c/` and `docs/oem-stage-c-20261118/` only. Not a production, rollout or publishing authorization.
Supersedes: none. The frozen Stage B scan `docs/oem-stage-b-20261117/S0_ALTERNATIVES_SCAN_20261117.md` is not edited; because Stage C still depends on its areas RA1 (property tests) and RA2 (typed validation), those two are re-observed here at the new scan time as RC5 and RC4 (Agreement §3: a prior scan is reused only after it is revalidated as current).

RISK CLASSIFICATION: HEAVY

Scan time (UTC): 2026-11-18T12:03:27Z.
Discovery tool (reproducible): `rehearsal/v421-oem-stage-c/governance/s5_alternatives_scan.py` (PyPI JSON API only).
Raw evidence file: `rehearsal/v421-oem-stage-c/governance/s5_scan_evidence.json`, SHA-256 `e6cb2b302c7e517f52b09b266260f521da3d5f59486311fa1e72360db1040279` (19 candidates, 0 lookup failures).
This document's own SHA-256 is recorded in `S5_GOVERNANCE_RECORD_20261118.md` and `STAGE_C_FILES_SHA256.txt` (UTF-8, LF, final newline); the implementation decisions are bound to that digest.

## 1. Bounded requirements and invariants (what counts as a fit)

Sources: the user's Stage C task of 2026-11-18, the acceptance protocol `https://github.com/Stanislavikus/babypark-integration/pull/168#issuecomment-6971608485`, `docs/oem-review-20261117/STAGE_B_EXECUTION_LOCK_20261117.md` (S5/S6, Stage1 and output gates), `docs/oem-review-20261117/RECOMMENDED_IMPLEMENTATION.md` §5–§6, Agreement §§1, 3, 7.0.

| ID | Requirement | Source |
| --- | --- | --- |
| R1 | The engine seam is an optional input of the existing `build_catalog()`, OFF by default, a run-level constant (never decided per source or per request). Deterministic, offline, no remote service, no clock, no new runtime import or dependency in the legacy engine on the rehearsal host. With the flag OFF or the input absent the result is byte-for-semantics identical to the accepted output (order, limit 20, V3.6 `similar`). | task items 2–3; lock S5 |
| R2 | A consumer-side acceptance gate admits only truly VERIFIED, unconditional, non-synthetic relations (cross-brand allowed, adapters only with both physical ends verified and the OD5 policy honoured); UNKNOWN / CONFLICT_HOLD / unverified / conditional relations are held with reasons; veto is report-only. Typed, fail-closed, stdlib-only, with cross-record integrity checks (relation digest, re-derivation from the typed data). | task item 4; lock S5, OD3–OD6 |
| R3 | The corrected full replay needs a diff that gives a reason for every new, held and displaced relation (A-over-B role coverage, limit 20, `similar` precedence) and proves OFF equals the accepted artifacts by SHA-256. | task item 6; lock S6 |
| R4 | The engine lives outside git on the rehearsal host. The seam must be delivered as a reviewable change with a pinned base SHA and a pinned result SHA, verified offline, never applied in place to the accepted engine tree. | lock "immutable inputs"; task "do not change production" |
| R5 | Property/state-space tests for the new combinatorial behaviour use maintained OSS tooling, test-only, synthetic data only (Stage B area RA1, unchanged). | Agreement §7.0 |
| R6 | Licensing permits commercial repository use without a paid tier or usage cap, including required transitive components. | Agreement §3 |

Maintenance signal used below: latest PyPI release within 12 months of the scan time (an observation, not a security assertion).

## 2. Decision order (Agreement §1) and sources

1. Verified native capability of the component in scope. The accepted engine `accessory_v4.py` (SHA-256 `20c12303543fa7c4a522cc28ea5f4dc698098b0093ccf14fa066f9d67f7be2e8`) already makes its extra inputs optional with default-`None` parameters (`build_catalog(rows, original, index, policy, fitment_rules=None, option_profiles=None)`), so an optional input that is inert when absent is the engine's own idiom. Python's standard library provides `json`, `hashlib`, `difflib` (unified diff generation) and `unittest`. The engine has no typed OEM relation intake (Stage A and Stage B conclusion); that part stays missing natively.
2. Implemented and proven existing repository capability: the accepted Stage B package `rehearsal/v421-oem-stage-b/oem_stage/` (`shadow.CatalogView`, `shadow.expand_pairs`, `baseline_gate`, `engine_env` pins) and its tools (`verify_baseline.py`, `replay_corrected_generation.py`, `files_manifest.py`, `verify_scope.py`) are reused unchanged. PR #167 is an unmerged experimental source; its 480-line matcher is NOT a capability and is not copied (lock).
3. Maintained OSS: PyPI discovery below (queries recorded per candidate in the evidence file; bounded to Python libraries because the engine is Python).
4. Ready external product: none named by the owner. Hosted feature-flag services (the vendor products behind the RC1 SDKs) evaluate flags remotely or through a synced rule feed, which does not fit a deterministic offline batch build.
5. Custom BabyPark code: last resort, justified per decision in `S5_GOVERNANCE_RECORD_20261118.md`.

Owner-named candidates: none. The architecture (variant B, optional builder seam, typed relations) is fixed by Stage A, the lock and the accepted Stage B; it is not re-opened.

## 3. Candidate matrix (19 PyPI candidates; every row has an explicit reason)

Basis: PyPI metadata (version, license, requires-python, core requirements, release dates) and the documented purpose of each project. No candidate was installed or exercised except Hypothesis, which the Stage B property tests already exercise. "Core deps" are the non-extra requirements listed in the evidence file.

### RC1 — feature-flag mechanism for the default-OFF seam (R1, R6)

| Candidate (version, license, last release) | Fit | Decision and reason |
| --- | --- | --- |
| openfeature-sdk 0.10.0, Apache-2.0, 2026-06-01; core deps 0 | PARTIAL: vendor-neutral flag-evaluation API with no core dependency; still needs a provider and evaluation context, and adds a runtime import to the frozen legacy engine for a single boolean; pre-1.0 | EXCLUDE: no benefit over a boolean parameter; breaks R1 (no new runtime import in the engine) |
| UnleashClient 6.9.1, MIT, 2026-10-15; core deps 9 | FAIL R1: client of a flag server (scheduler, HTTP, cache); 9 core deps | EXCLUDE |
| flagsmith 6.6.0, "Other/Proprietary License" per PyPI metadata, 2026-11-16; core deps 6 (requests, sseclient-py, flag engine) | FAIL R1 (remote flag service client); license not established as permissive by this scan | EXCLUDE |
| launchdarkly-server-sdk 9.21.0, Apache-2.0, 2026-11-12; core deps 5 | FAIL R1: SaaS server SDK (network streaming); vendor product | EXCLUDE |
| growthbook 4.0.1, MIT, 2026-11-12; core deps 4 (aiohttp, cryptography, urllib3 ...) | FAIL R1: feature flags plus experiments over HTTP; 4 core deps | EXCLUDE |
| django-waffle 5.0.0, BSD, 2025-06-12 (older than 12 months); core dep: django | FAIL: Django-only; the engine is not a Django app | EXCLUDE |
| Native optional parameter (default `None`/`False`) | PASS R1: the engine's own idiom, a run-level constant, offline, no dependency, trivially deterministic; the flag value is echoed into the evidence of the ON run | SELECT (no new component) |

### RC2 — structured JSON diff for the S6 replay (R3)

| Candidate | Fit | Decision and reason |
| --- | --- | --- |
| deepdiff 9.1.0, MIT, 2026-05-15; core deps 2 (cachebox, orderly-set) | PARTIAL: generic structural delta of Python objects; gives paths, not reasons; new dependency on the rehearsal host | EXCLUDE: cannot attribute a change to "A-over-B role coverage" or "limit 20" |
| jsonpatch 1.47, BSD-3-Clause, 2026-11-11, requires Python >= 3.11; core dep: jsonpointer | PARTIAL: RFC 6902 patch generation; no reasons; dependency | EXCLUDE |
| dictdiffer 0.10.0, MIT, 2026-07-16; core deps 0 | PARTIAL: dict diff/patch; no reasons; dependency | EXCLUDE |
| jsondiff 2.2.1, MIT, 2024-08-29 (older than 12 months); core dep: pyyaml | PARTIAL; weak maintenance signal; no reasons | EXCLUDE |
| stdlib `json` + `hashlib` for equality and byte comparison; custom classifier for reasons | PASS R3: equality by SHA-256 of the exact bytes, classification built on the engine's own `target_role`/`target_heads` functions | SELECT (stdlib plus a small custom classifier; see governance D3) |

### RC3 — delivering and verifying a patch of the legacy engine (R4)

| Candidate | Fit | Decision and reason |
| --- | --- | --- |
| unidiff 1.0.1, MIT, 2026-09-15; core deps 0 | PARTIAL: parses unified diffs; does not by itself prove that the patched bytes are the pinned bytes | EXCLUDE: SHA-256 of base and result bytes is the proof; parsing adds nothing |
| patch-ng 1.19.1, MIT, 2026-04-23; core deps 0 | PARTIAL: applies unified diffs in Python; same reasoning | EXCLUDE |
| whatthepatch 1.0.7, MIT, 2024-11-16 (older than 12 months); core deps 0 | PARTIAL; weak maintenance signal | EXCLUDE |
| stdlib `difflib.unified_diff` + `hashlib` + a build step that writes a NEW engine root copy | PASS R4: the full patched file is shipped with a pinned SHA-256; the reviewable `.patch` is regenerated deterministically from base and patched bytes and compared byte-for-byte; the accepted engine tree is only read | SELECT (stdlib; see governance D4) |

### RC4 — typed envelope validation (R2; Stage B area RA2 re-observed)

| Candidate | Fit | Decision and reason |
| --- | --- | --- |
| jsonschema 4.26.0, MIT, 2026-01-07; core deps 4 | PASS shape validation; FAIL cross-record invariants (relation digest, re-derivation, state-versus-evidence consistency); FAIL R1 (new dependency) | EXCLUDE (unchanged from Stage B) |
| pydantic 2.14.3, MIT, 2026-11-05; core deps 4 | same | EXCLUDE (unchanged) |
| fastjsonschema 2.22.3, BSD, 2026-11-01; core deps 0 | same; shape only | EXCLUDE (unchanged) |
| msgspec 0.22.0, BSD-3-Clause, 2026-09-29; core deps 0 | same; compiled extension on the rehearsal host | EXCLUDE (unchanged) |
| Custom stdlib gate and envelope validator | PASS R2 | BUILD (governance D2) |

### RC5 — property/state-space test tooling (R5, R6; Stage B area RA1 re-observed)

| Candidate (version, license, last release) | Fit | Decision and reason |
| --- | --- | --- |
| hypothesis 6.170.15, MPL-2.0, 2026-11-06 (1,594 releases, first 2013); core dep: sortedcontainers | unchanged from Stage B: PASS generation and shrinking; PASS derandomized runs; PASS test-only; PASS commercial use (file-level copyleft, unmodified, not distributed); requires Python >= 3.11 | REUSE as the already-recommended test-only dependency; owner go-ahead for it is still NOT RECEIVED; Stage C adds no new dependency |
| sortedcontainers 2.4.0, Apache Software License, 2021-05-16; core deps 0 | unchanged | required component of hypothesis; hash-pinned by the Stage B `requirements-test.txt` |

The versions seen at this scan equal the versions pinned in the Stage B `requirements-test.txt`, so that pin file stays valid and is not duplicated.

## 4. Result

No scanned candidate satisfies R1–R4 together with the offline, no-new-dependency posture of the rehearsal engine host. Selected: the engine's native optional-parameter idiom (RC1), stdlib `json`/`hashlib`/`difflib` (RC2, RC3), custom BabyPark code only where no component fits (gate, envelope validator, replay classifier, Stage1 plan/receipt join), and the already-recommended test-only Hypothesis (RC5). The scan does not approve any owner decision.
