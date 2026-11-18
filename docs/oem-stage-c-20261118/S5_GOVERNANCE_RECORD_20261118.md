# BabyPark V4.2.1 OEM-fitment — Stage C (S5–S6) governance record

Status: EVIDENCE — NON-NORMATIVE pre-code decision record.
Applies to: Stage C (S5 engine seam, S6 replay/diff/Stage1 preparation), branch `feat/v421-oem-stage-c-20261118`, directories `rehearsal/v421-oem-stage-c/` and `docs/oem-stage-c-20261118/` only.
Supersedes: none. The Stage B governance files under `docs/oem-stage-b-20261117/` stay frozen and unedited.

This record locks the engineering decision for the bounded Stage C change. It is NOT a production, rollout or publishing authorization, NOT a formal R1/R2 closure, and it does not approve any owner decision OD1–OD8.

RISK CLASSIFICATION: HEAVY

## 1. Classification (Agreement §7.0 / AGENTS.md §2)

HEAVY is mandatory. Stage C touches the recommendation builder `build_catalog()` of V4.2.1 (behind a default-OFF flag) and so introduces or depends on, in the Agreement's own words:
- authority selection and identity/cardinality (which evidence may enter the existing A tier, which catalog source and target an OEM statement may name, exact IDs only);
- fail-closed behavior and dynamic-fact freshness (VERIFIED-only intake, expiry, synthetic refusal, report-only veto);
- money/policy decision semantics at the buyer boundary (what could later be recommended; OD3–OD6 remain pending);
- ordering and limit invariants of an existing production-path algorithm (limit 20, A-over-B role coverage, V3.6 `similar` precedence, legacy edge order).

Ambiguity is HEAVY and this stage does not lower the tier. The Stage B record already classified the whole bounded campaign, including the later Stage C seam, as HEAVY and said a refreshed scan is required if the requirements materially change. Stage C adds three requirement areas (optional default-OFF seam, structured replay diff, delivery of a patch to an engine that lives outside git), so §2 binds a refreshed bounded scan rather than reusing the Stage B one. The classification was reported to the user in this stage's status messages before any implementation file was written. For a HEAVY change with combinatorial and stateful behavior the verification includes property/state-space coverage (§7.0), see §4.

## 2. Bound alternatives scan

- Frozen document: `docs/oem-stage-c-20261118/S5_ALTERNATIVES_SCAN_20261118.md` (UTF-8, LF, final newline).
- Scan document SHA-256: `caec3e38856ce78b219d318f6ee08c3ffd81c8756bec6471480b6f73242101e1`.
- Raw evidence `rehearsal/v421-oem-stage-c/governance/s5_scan_evidence.json`, SHA-256 `e6cb2b302c7e517f52b09b266260f521da3d5f59486311fa1e72360db1040279`; scan time 2026-11-18T12:03:27Z.

Any material change to the requirements, the candidate set, the search evidence, a candidate result, the integration burden or an inclusion/exclusion rationale invalidates this record's decisions until a refreshed scan is frozen under a new digest.

## 3. Decisions (exactly one recommendation per bounded decision, Agreement §3)

| ID | Scope | Recommendation | Bound to scan digest |
| --- | --- | --- | --- |
| C-D1 | Feature flag of the S5 seam in `build_catalog()` | **keep-existing** — the engine's own optional-parameter idiom (`oem_relations=None`, `oem_enabled=False`); no flag library or service | `caec3e38856ce78b219d318f6ee08c3ffd81c8756bec6471480b6f73242101e1` |
| C-D2 | Consumer-side acceptance gate and typed envelope under `rehearsal/v421-oem-stage-c/oem_intake/` | **build** — stdlib-only, offline, fail-closed, reuses the accepted Stage B `oem_stage` package; no scanned validator covers the cross-record invariants | `caec3e38856ce78b219d318f6ee08c3ffd81c8756bec6471480b6f73242101e1` |
| C-D3 | S6 replay and reason-giving diff | **build** — stdlib `json`/`hashlib` for equality, a small classifier built on the engine's own `target_role`/`target_heads`; no scanned diff library gives reasons | `caec3e38856ce78b219d318f6ee08c3ffd81c8756bec6471480b6f73242101e1` |
| C-D4 | Delivery and verification of the engine seam patch | **build** — stdlib `difflib`/`hashlib`: pinned base SHA-256, pinned patched SHA-256, regenerated `.patch`, a new engine-root copy; the accepted engine tree is never edited | `caec3e38856ce78b219d318f6ee08c3ffd81c8756bec6471480b6f73242101e1` |
| C-D5 | Property/state-space test tooling | **integrate** `hypothesis` 6.170.15 + `sortedcontainers` 2.4.0 as a test-only development dependency (unchanged Stage B decision D2, same pins in the Stage B `requirements-test.txt`) | `caec3e38856ce78b219d318f6ee08c3ffd81c8756bec6471480b6f73242101e1` |

Owner go-ahead status for C-D5 (the `integrate` recommendation, identical to the still-open Stage B D2): **NOT RECEIVED**. Nothing here claims it. Stage C property tests skip loudly where Hypothesis is not installed; if the owner declines, delete `tests/test_properties.py` of Stage C (and the Stage B equivalent); no runtime code or other test is affected. C-D1 to C-D4 need no external-product authorization; the custom-last rule is satisfied by the scan.

## 4. Verification posture of Stage C (development evidence, not formal closure)

- Tests: unit tests of the gate, envelope and diff; integration tests that run the REAL V4.2.1 modules (patched seam copy next to the accepted modules) over a fictional catalog with explicitly synthetic evidence; OFF-versus-baseline identity tests; negative tests for every non-VERIFIED state; property tests (Hypothesis); a mutation self-check of the gate and the seam. Results and exact commands: `STAGE_C_RESULT_20261118.md`.
- Not done and not claimed: the real corrected 28,769-row / 8,129-source replay (it needs the rehearsal host; this session has no remote-device bridge), native Stage1 receipts, formal required-verification manifest freeze, first ZERO-BLOCKERS pass, isolated HEAVY confirmation (AGENTS.md §2), traceability terminal (§6), final-gate bundle, owner approval, merge. Stage C is delivered as a Draft PR for independent engineering acceptance by a different executor.
- Changed-surface classification for a later manifest: `docs/oem-stage-c-20261118/**` (docs); `rehearsal/v421-oem-stage-c/**` (new Python tooling, tests, a patched copy of one engine file, data; not part of any npm package and not imported by `src/**`). The root `npm test` baseline is not exercised by this change and is not claimed.

## 5. Architecture-fit notes

### C-D1 — the seam (S5)

- Exact bounded function: `build_catalog(rows, original, index, policy, fitment_rules=None, option_profiles=None, oem_relations=None, oem_enabled=False, oem_allow_synthetic=False)`. With the flag OFF the OEM input is never read; with the flag ON and no valid input the call raises (never a silent no-op).
- Insertion point: after the legacy A block, the legacy `manufacturer_fitment_match` block, the legacy de-duplication and `commercial_accessory_order`, and after `old_similar` is read. Accepted OEM edges are appended after ALL legacy A edges, so the order and membership of legacy edges cannot change; they carry `tier: "A_model"`, `reason: "accepted_oem_relation"` and the provenance (relation id and digest, claim ids, document hashes). B_universal logic, `mechanical_pool`, `v39.rank_source`, `eligible_source`, V3.6 `similar` and limit 20 are untouched; existing role coverage (A over B) and the existing `similar` filter then apply to the new edges unchanged.
- Engine-side gates for each OEM edge (exact IDs and the current locale, variant, commercial and head gates): the source and target NIDs exist, the SKU and locale recorded by the gate still match the live row, same locale, `eligible_source()` for the target, not the same NID/TNID, not a kit, the existing option-profile gate, and `target_in_head()`. A failed gate holds the edge with a reason; it never relaxes a legacy gate.
- OFF/None: no keys are added to `sources`, `evidence` or `metrics`; the accepted artifacts must reproduce byte for byte (checked by SHA-256 in the S6 replay and in tests against the unmodified module).
- What remains BabyPark-owned: the whole seam, gate and tooling (custom code only where no component fits).
- Data/connectivity scope: no network; inputs are local JSON; no customer, transcript or production data; the production catalog is never touched.
- Freshness/fail-closed: a malformed or non-`accepted_only` envelope, an unknown schema, a synthetic envelope without the explicit test-only opt-in, a conditional or non-LISTED edge, or an edge whose live SKU/locale no longer matches raises or holds; nothing is guessed.
- Failure isolation/rollback: the seam ships as a patched COPY of one engine file in a new engine-root copy; rollback is to keep using the accepted engine or to leave the flag OFF. The accepted campaign tree and the accepted artifacts are only read.

### C-D2 — the gate

- Admits only relations whose effective state is LISTED with verified-none conditions, accepted (human-VERIFIED, byte-backed) claims, verified model identity, bound article, unexpired evidence and no veto signal; re-derives the relations from the typed data and requires equality with the supplied `oem_relations.json` (tamper evidence); synthetic relations only under an explicit test-only flag. Cross-brand relations are admitted (brand is never a key). Adapter relations need both physical ends (seat and chassis, plus a bound adapter article and a bound extension when required); under the default OD5 policy every adapter edge is HELD with its reason and a would-be edge record, and the only way to a published adapter edge is a test-only policy that is refused for non-synthetic evidence.
- Veto: report-only. EXCLUDED relations produce a veto report (candidates and conflicts with the current output); nothing is removed.

### C-D3, C-D4 — replay and delivery

- The replay runs the patched engine OFF and ON over the accepted corrected inputs inside a NEW campaign directory, proves OFF equals the accepted manifest/evidence/metrics, and classifies every difference of ON against OFF as added, held, corroborating, displaced (role coverage / limit 20 / `similar`) or UNEXPLAINED; any legacy removal without a recorded reason, any legacy reorder, any `similar` change or any UNEXPLAINED difference fails the run.
- The seam patch is delivered as the full patched file with pinned base and result SHA-256, the regenerated `.patch`, and a build step that writes a NEW engine-root copy.

### C-D5 — test-only property tooling

Same exact use, version, license reasoning, privacy impact (none) and rollback as the Stage B record §5 (derandomized, `database=None`, skipped loudly when absent); Stage C adds only new strategies for the gate, the seam and the diff invariants.

## 6. Owner decisions OD1–OD8 — safe defaults kept, none approved

All eight stay `PENDING_OWNER`. Stage C keeps them: OD1 no approval is fabricated and VERIFIED means human-reviewed claims only; OD2 staleness is recorded and an expired relation is held, never silently granted; OD3 veto is report-only and `enforce` is refused; OD4 conditional relations are held (`publish_states` is hard-limited to LISTED); OD5 adapters abstain by default, with the would-be edges recorded; OD6 an empty allow-list publishes nothing; OD7 byte storage is not decided here; OD8 is not approved. D2 (Hypothesis) go-ahead: **NOT RECEIVED** (see §3).

## 7. Hard boundaries kept

- No change to `main`, PR #167 (head `706f292c419cac7ec88b68a1393259dc3af8e402`, not merged), PR #168 or production; production strictly read-only; no recommendation published; Stage1 is not rewritten; no production rollout.
- Baseline and owner data immutable: the replay only reads the accepted campaign and writes to a new directory.
- Missing real OEM bytes and missing Stage1 receipts mean PROPOSED/HOLD/UNKNOWN. No VERIFIED claim, reviewer approval or Stage1 receipt is fabricated; synthetic fixtures carry `synthetic: true` and cannot enter a real run.
- Every internal finding of this stage is recorded in the campaign PR as FIXED (with commit, test and evidence) or NOT APPLICABLE (AGENTS.md §3); the ledger is in `STAGE_C_RESULT_20261118.md`.
- Environment: Desktop Commander and the `mcp__remote-devices__` tools were unavailable in this session; implementation and tests ran in an Anthropic cloud sandbox with the real V4.2.1 modules imported from an engine copy. Commands to repeat the checks and the real replay on the rehearsal host are in `STAGE_C_REHEARSAL_RUNBOOK_20261118.md`.
