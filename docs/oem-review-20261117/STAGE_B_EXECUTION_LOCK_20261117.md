# BabyPark V4.2.1 — STAGE B EXECUTION LOCK (2026-11-17)

**Status: FROZEN implementation scope; Stage A ACCEPTED; Stage B implementation authorized on rehearsal.**
**Risk: HEAVY per BabyPark repository governance.** This document locks the engineering work scope, NOT a production/publishing authorization. Do not misrepresent OD1–OD8 proposals as owner-approved operational policy.

## Authority and immutable inputs

- Repository: `Stanislavikus/babypark-integration`; PR #167 HEAD `706f292c419cac7ec88b68a1393259dc3af8e402` is an **unmerged experimental source**, not merge-ready. Reuse its eight evidence examples, 13 physical/26 locale positive fixtures, 8 controls, 29 holdout cases and 11 unit tests as a historical reference.
- Accepted architecture: **Sonnet/Luna variant B**. Separate small data-driven OEM evidence/identity/relations stage O1–O4; existing V4.2.1 consumes the relations through a narrow optional `build_catalog(..., oem_relations=None)` seam. No new recommendation engine or platform. Preserve the existing legacy `manufacturer_fitment_match()`, old mechanical_pool, B_universal, rank/order/max20 and V3.6 Similar. Do NOT copy PR #167's ~480-line OEM matcher into the legacy engine. PR #167 is not to be merged as-is.
- Reference original analysis files in the same GitHub directory: `BEST_PRACTICES_REVIEW.md`, `PR167_ARCHITECTURE_GAPS.md`, `RECOMMENDED_IMPLEMENTATION.md`, `ACCEPTANCE_TEST_PLAN.md`, `INDEPENDENT_VERDICT_20261117.md`, `IMPLEMENTATION_WORKER_TASK_20261117.md`.
- **Stage A is final: do not repeat it**. Source `/opt/bp-v421-v36-full-category-decision-20261115/stage_a_reconciliation_20261117/`; independent acceptance `/opt/bp-v421-v36-full-category-decision-20261115/stage_a_independent_acceptance_20261117/INDEPENDENT_ACCEPTANCE.md`.
- Corrected T2: **28,769 catalog rows, 8,129 sources, 1,832 stroller links, 42 seat links** (1,874 total); generation `v421-t2-fresh-20261116-live-v34`; accepted manifest SHA256 `10a3a9af57635cfa60d008f6c702054a667249bd78e1412318502e855481176d`. Fresh source rows SHA256 `20544b488f12d86f590d13efca7e732f8470f61a889ef151b929bfff6453b8d0`. The bundled 28,011/8,471 inputs are a DIFFERENT/older generation. Use the **full** `CANONICAL_INPUT_MANIFEST.json` for other digests. Do not simply change numeric guards.

## LOCKED functional requirements — implement, not research

**O1 — Original OEM evidence validation.** Persist OEM HTML/PDF bytes with issuer, document version/date/market/language, specific quote/locator, compute and recheck SHA256 over captured bytes. No free-text hash or URL-only proof. `PROPOSED`/unverified (including old PR records) cannot create accepted links; only reviewed `VERIFIED` can. Preserve claim/provenance and drift/revision history. AI extraction is PROPOSED-only.

**O2 — Identity.** Use exact maker-scoped canonical `model_id` and reviewed, explicitly scoped model aliases, not fuzzy title substrings or global homoglyph fold. Generation is significant. The existing `canonical_models.key()` alone is NOT an identity proof: pre-block `Pebble 360/PRO(2)` collision, `Fox` as prefix of `Fox Cub`, mixed Cyrillic/Latin M until reviewed binding; X-1/X1 only under verified maker model mapping. Do not change legacy model logic without protected diff.

**O3 — Article binding.** Exact `(manufacturer_id,MPN)` to catalog accessory using evidence-backed SKU alias, with uniqueness/conflict detection. SKU is an identity join, never an item-specific behavioral exception. Never treat GTIN, catalog title, price or manual associations as fitment evidence.

**O4 — Typed relations and conditions.** Data-driven `accessory_for_model`, `adapter_between` (car seat/soft carrier + exact adapter + exact chassis and any required extension) and `vehicle_general` class C. Distinguish `LISTED`, `LISTED_CONDITIONAL`, `EXCLUDED` (only explicit scoped OEM no-recommendation), `UNKNOWN`, and separate `CONFLICT_HOLD`. Unknown required condition never passes silently. Unsupported condition type fails closed. Carry conditions into audit data; no family/brand/generation inheritance. Source/adaptor may be different brands, and target taxonomy may differ.

**Veto and negative semantics**: no match or absent-from-list = UNKNOWN, not EXCLUDED. Dragonfly/Pebble 360 Pro 2 = `CONFLICT_HOLD`; Fox 2/Pebble Pro 2 = UNKNOWN; Dragonfly/CabrioFix official no-recommendation is scoped to that exact adapter/chassis (candidate for report-only veto), does not apply to Fox 2/CabrioFix. No automatic veto enforcement.

**S5 V4.2.1 seam** (separate reversible change after working shadow O1–O4): input `oem_relations` optional default OFF; only verified eligible relations enter existing A tier as `tier: "A_model"`, `reason: "accepted_oem_relation"`, preserving explainable provenance. Legacy `rules` remain untouched, no mixing two schemas into `fitment_rules`. New candidates filtered via exact ID and current locale/variant/commercial gates. Conditional held by default. With OFF/None: baseline **byte-for-semantics unchanged**, including order, limits and V3.6 Similar. Veto `report` by default, never `enforce` without later owner approval.

**Stage1** is an existing downstream native Drupal/Ubercart purchasability gate, NOT an OEM model-fit proof, and NOT an arbitrary `stage1_passed=True` passed to the matcher. Current isolated receipt covers 4 old target-locales, none of the new OEM cohort. Fresh native Stage1 checks for **up to 8 currently status=1 accessory target-locales**: 2000030111 RU/UK, 11006001par RU/UK, 1166057110 RU/UK, 400019001 RU/UK. 400003001 RU/UK is currently `field_status=3`, cannot be recommended; do not waste native purchase tests until available. Validate each current SKU/TNID/NID/VID/changed/OID/option digest, CTA and source-context separately; there is no need for 26 redundant checkout tests.

**No new producer-specific code.** New manufacturer/doc/model/MPN mapping/condition values use existing typed data contract. Add regression tests and real-module integration tests, not stubs; property tests for ambiguous aliases and fail-closed conditions.

## Output/stop gates

1. **S0** reproducible corrected-generation runner and baseline digest; do not rerun Stage A investigation. Perform only code-readiness and the repository-mandated bounded §1/§3 alternatives/governance check for this HEAVY change, recording decision and hash, not broad research.
2. **S1–S4 Stage B shadow**: working code, tests, data schema, `oem_relations.json`, `oem_vs_current_report.json`, claim status/reason matrix and deterministic hashes. All 13 seed physical relations/26 RU+UK plus cross-brand Bugaboo holdouts must be classified; missing real OEM bytes means PROPOSED/HOLD, not fabricated VERIFIED.
3. Independent acceptance of Stage B by a different executor before moving to S5.
4. **S5–S6 Stage C**: feature-flagged optional builder seam, complete corrected 8,129-source/28,769-row replay, exact `similar` invariance, 1,832 old stroller and 42 old seat links reconciliation, reasons for all diffs/displacement at max 20, no unjustified legacy removals, native Stage1 receipts for potential publishable targets.
5. New branch and bounded draft PR(s), not direct changes to `main`, PR #167, or production. Keep baseline and owner data immutable. Reversible default OFF. Report source/outputs SHA256, tests, exact files, and honest GO/NO-GO.
6. S7 next manufacturer demonstration is **data only** if valid OEM evidence exists; do not require inventory of all OEM makers.

## Pending owner decisions — implement safe defaults, never silently approve

- **OD1** approval authority: human-reviewer required for VERIFIED, LLM never auto-verifies. For rehearsal implement reviewer metadata; do not fabricate reviewer approval.
- **OD2** TTL: record and report staleness; never silently grant expired proof. Expiry enforcement policy pending owner.
- **OD3** veto: `report` only; enforcement pending owner.
- **OD4** conditional buyer-facing copy RU/UK: hold conditional from buyer-facing publish until copy/policy approved.
- **OD5** one-ended adapter: abstain from unconditional recommendation.
- **OD6** manufacturer market/language allow-list: not yet approved; empty policy => no publish, while shadow still records evidence.
- **OD7** evidence bytes storage: isolated rehearsal content-addressed folder is permitted for testing, durable production location/retention unapproved.
- **OD8** sole normalizer: NOT approved; strict pre-screen + scoped aliases required; `canonical_models.key()` alone unsafe.

Do **not** block S1–S4 development on OD1–OD8, but do not activate uncertain behavior. Owner authorization is required before buyer-visible conditional text, veto enforcement, regional publish policy and rollout.

## Executor/reviewer division

Implementation: one **Sonnet 5.5 Work/Cursor coding worker** with Desktop Commander access to rehearsal, following this exact file, as a bounded assignment and producing actual changed Python files/tests/shadow artifacts (not merely reports).
Independent engineering review: **ChatGPT in the original conversation**; review exact diff/output/hash and either accept or return a small defect list. No new architecture study.
Owner: authorizes pending OD decisions and production deployment only when there is a concrete observed result.

**Definition of success**: code works end-to-end on rehearsal, exact fitment provenance and typed constraints preserved, zero false claimed OEM links, baseline protected, no repeat of research-only cycles.
