# BabyPark V4.2.1 OEM-fitment — Stage B S0 governance record

Status: EVIDENCE — NON-NORMATIVE pre-code decision record.
Applies to: Stage B (S1–S4 shadow O1–O4), branch `feat/v421-oem-stage-b-20261117`, directory `rehearsal/v421-oem-stage-b/` and `docs/oem-stage-b-20261117/` only.
Supersedes: none.

This record locks the engineering decision for the bounded Stage B change. It is NOT a production, rollout or publishing authorization, NOT a formal R1/R2 closure, and it does not approve any owner decision OD1–OD8.

RISK CLASSIFICATION: HEAVY

## 1. Classification (Agreement §7.0 / AGENTS.md §2)

HEAVY is mandatory because Stage B is a BabyPark-authored implementation that introduces or depends on, in the Agreement's own words:
- an unproven reusable primitive or invariant (typed OEM evidence → identity → article binding → relation derivation);
- authority selection, identity/cardinality, dynamic-fact freshness and fail-closed behavior (which OEM evidence may be accepted, which catalog model/article an OEM statement is allowed to name, evidence staleness);
- money/policy decision semantics at the boundary (what may later become a recommendation, held by OD3–OD6).

Stage B itself is shadow-only (no engine seam, no production write, nothing published), but the classification covers the whole bounded campaign including the later Stage C seam. The lock already states "Risk: HEAVY"; ambiguity is HEAVY, and this stage does not lower the tier. For a HEAVY change with combinatorial/stateful behavior the verification includes property/state-space coverage (§7.0); see §4.

## 2. Bound alternatives scan

- Frozen document: `docs/oem-stage-b-20261117/S0_ALTERNATIVES_SCAN_20261117.md` (UTF-8, LF, final newline).
- Scan document SHA-256: `73f570590c8461aa9528f99497f89410f5676c1627ee2be5794684127cb9b727`.
- Raw evidence `rehearsal/v421-oem-stage-b/governance/s0_scan_evidence.json`, SHA-256 `e20b5006751f56bebc92dd0a88306efc849767e1f8497a0aadce2ed50c538e4c`; scan time 2026-11-17T17:35:53Z.

Any material change to the requirements, the candidate set, the search evidence, a candidate result, the integration burden or an inclusion/exclusion rationale invalidates this record's decisions until a refreshed scan is frozen under a new digest.

## 3. Decisions (exactly one recommendation per bounded decision, Agreement §3)

| ID | Scope | Recommendation | Bound to scan digest |
| --- | --- | --- | --- |
| D1 | Runtime O1–O4 stage under `rehearsal/v421-oem-stage-b/oem_stage/` | **build** — stdlib-only, offline, data-driven, no producer-specific code; no scanned candidate satisfies R1 together with R2–R6 | `73f570590c8461aa9528f99497f89410f5676c1627ee2be5794684127cb9b727` |
| D2 | Property/state-space test tooling | **integrate** `hypothesis` 6.170.15 + `sortedcontainers` 2.4.0 as a test-only development dependency | `73f570590c8461aa9528f99497f89410f5676c1627ee2be5794684127cb9b727` |

Owner go-ahead status for D2 (the `integrate` recommendation): **NOT RECEIVED**. Nothing here claims it. The dependency is isolated (see §5): if the owner declines, delete `requirements-test.txt` and `tests/test_properties.py`; the runtime stage and every other test are unaffected. D1 needs no external-product authorization; the custom-last rule is satisfied by the scan.

## 4. Verification posture of Stage B (development evidence, not formal closure)

- Tests: unit, property (Hypothesis), real-module integration against the V4.2.1 modules, regression/determinism, 44-mutant fail-closed self-check. Results and exact commands: `STAGE_B_RESULT_20261117.md`.
- Not done and not claimed: formal required-verification manifest freeze, first ZERO-BLOCKERS pass, isolated HEAVY confirmation (AGENTS.md §2), traceability terminal (§6), final-gate bundle, owner approval, merge. Stage B is delivered as a Draft PR for independent engineering acceptance by a different executor.
- Changed-surface classification for a later manifest: `docs/oem-stage-b-20261117/**` (docs); `rehearsal/v421-oem-stage-b/**` (new Python tooling, tests, data; not part of any npm package and not imported by `src/**`). The root `npm test` baseline is not exercised by this change and is not claimed.

## 5. Architecture-fit note for D2 (test-only Hypothesis)

- Exact bounded function/use: generate and shrink structured cases for `tests/test_properties.py` — ambiguous aliases, exact-resolution soundness, fail-closed condition validation, three-valued soundness, state derivation. Runs only where a developer or reviewer installs `requirements-test.txt`; without it the module is skipped loudly (never silently green).
- What remains BabyPark-owned: all test strategies, all assertions, the OEM stage itself (D1).
- Exact version/identity/license: hypothesis 6.170.15 (MPL-2.0, released 2026-11-06, requires Python ≥ 3.11), required component sortedcontainers 2.4.0 (Apache Software License); hashes from PyPI metadata are pinned in `requirements-test.txt` and installed with `--require-hashes`. MPL-2.0 is a file-level copyleft license; the library is used unmodified, test-only, and is not distributed with or imported by production code.
- Data/connectivity scope: no runtime service, no network at test time (installation needs the package registry once), no customer, transcript or production data; inputs are synthetic strings generated per test.
- Transcript/privacy impact: none; no persistence (Hypothesis example database disabled: `database=None`).
- Freshness/fail-closed: runs are derandomized by default so the same examples run every time; an optional exploratory mode is opt-in (`BP_HYPOTHESIS_RANDOM=1`). If Hypothesis is missing or Python < 3.11 the property module is skipped with an explicit reason.
- Concurrency/restart/recovery impact: none (no state).
- Failure isolation/rollback: development dependency only; rollback = delete `requirements-test.txt` and `tests/test_properties.py`.
- Custom code required: none beyond the tests themselves.
- Why the experiment is worth running: the Agreement requires maintained OSS tooling for HEAVY combinatorial behavior before inventing a custom property framework; Hypothesis is the maintained, shrinking, reproducible option found by the scan.

## 6. Owner decisions OD1–OD8 — safe defaults implemented, none approved

All eight are `PENDING_OWNER` and are reported as such in `oem_relations.json` (`owner_decisions`). Safe defaults: OD1 human reviewer metadata required, extractor ≠ reviewer, LLM/parser can never verify, no approval fabricated (`o1_evidence.review_claim/check_claim`); OD2 staleness recorded, TTL enforced only when configured, never silently granted (`o4_relations`); OD3 veto `report_only`, any other mode refused (`merge_policy`); OD4 `od4_conditional_held` blocker; OD5 `od5_one_ended_adapter_abstain` blocker on every `adapter_between`; OD6 empty allow-list ⇒ `od6_allowlist_empty`, no publish; OD7 isolated content-addressed blob folder for tests/rehearsal only; OD8 no sole normalizer: strict pre-screen, exact key, reviewed scoped aliases, `canonical_models.key()` only for collision reporting.

## 7. Hard boundaries kept

- No change to `main`, PR #167 (head `706f292c419cac7ec88b68a1393259dc3af8e402`, not merged) or production; production strictly read-only; no recommendation published; Stage C/S5–S6 not started.
- Baseline and owner data immutable: the baseline verifier and replay wrapper (`S0_BASELINE_AND_RUNNER_20261117.md`) only read, and write only to a new campaign directory.
- Missing real OEM bytes and missing Stage1 receipts mean PROPOSED/HOLD/UNKNOWN; no VERIFIED claim, reviewer approval or Stage1 receipt is fabricated. Synthetic fixtures are flagged `synthetic: true` and refused by the default policy.
- Environment: Desktop Commander and the `mcp__remote-devices__` tools were unavailable in this session; implementation and tests ran in an Anthropic cloud sandbox with the real V4.2.1 modules imported from an engine copy. Commands to repeat the checks on the rehearsal host are in `STAGE_B_RESULT_20261117.md`.
