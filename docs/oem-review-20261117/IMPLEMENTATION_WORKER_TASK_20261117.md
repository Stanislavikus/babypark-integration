# BabyPark V4.2.1 — execution task: close PR #167 architecture gaps without another broad study

**Work area:** `babypark-catalog-rehearsal-fra1`; root `/opt/bp-v421-v36-full-category-decision-20261115/`. GitHub `Stanislavikus/babypark-integration` PR #167 head `706f292c419cac7ec88b68a1393259dc3af8e402`, DO NOT MERGE. Read original Sonnet documents in `/babypark/V421_OEM_Architecture_Review_20261117/` or branch `docs/v421-oem-review-20261117`, **plus** `INDEPENDENT_VERDICT.md`. Production strictly read-only.

## Task A — focused proof gate, no new full audit

1. Pin actual accepted corrected input (28,769 fresh rows, 8,129 sources) and T2 manifest/evidence, verify checksums; distinguish older engine input (28,011 rows, expected 8,471 sources). Record one runnable entrypoint for corrected generation and baseline digest. Do not blindly replace hardcoded guards.
2. Locate actual Stage1 output schema on rehearsal; list which new OEM targets lack current Stage1 receipts. The existing 4-target file is insufficient; don't fabricate passes and don't place a boolean `stage1_passed` in OEM evidence.
3. Run real `canonical_models.key()` on N1 plus `Pebble 360/PRO(2)` vs `Pebble 360 Pro 2` (known collision); define a pre-normalization shorthand reject and scoped reviewed-alias acceptance. Probe Cyrillic М, slash abbreviations, Fox Cub/Fox/Fox 5 Renew, X1/X2 with real sources.
4. Adjudicate N01/N02/N03: absence/not-tested vs actual OEM not-recommended. Validate current document regions, capture original bytes and anchor quotes. N02 must remain UNKNOWN/ABSTAIN, not EXCLUDED, unless manufacturer explicitly rejects it. Manufacturer-version conflict = CONFLICT_HOLD; no veto.
5. Review the PR's 8 evidence records: missing hashes, missing quote locators, ambiguous SKU aliases; turn into an evidence backfill checklist. Do not certify them based on URL alone.

Deliver `TASK_A_FACTS.md`, `SNAPSHOT_IDENTITY.json`, `STAGE1_GAP_MATRIX.csv`, `NEGATIVE_SEMANTICS.csv`, and a bounded independent GO/NO-GO on implementation scope. This should not block implementing deterministic code with synthetic byte-backed fixtures.

## Task B — implementation (can proceed on isolated rehearsal branch after Task A facts)

Implement the Sonnet option B as a tiny OEM evidence/validation module and *existing* V4.2.1 consumer, not a new engine, scraper, database or UI. Reuse PR #167 data/negative fixtures and preserve its 11 tests as historical reference, but do not merge the current unintegrated PR directly.

- O1 validate persisted original OEM document bytes, computed SHA256, anchored quote, issuer/region/language/version; `PROPOSED` cannot create positives; `VERIFIED` can. Require reviewed confirmation of no restrictions, or conditions remain UNKNOWN.
- O2 resolve stable exact maker-scoped `model_id` and aliases through existing model index; avoid `canonical_models.key()` shorthand collision; no automatic Cyrillic/Latin confusable folding, fuzzy, substring, generation inheritance.
- O3 resolve `(manufacturer_id, MPN)` to one exact catalog target using evidence-bound bindings, not catalog NID/SKU exception rules.
- O4 generate deterministic typed relations including two-endpoint adapters (seat/carrier + adapter + exact chassis), component and extension qualifiers; emit LISTED, LISTED_CONDITIONAL, UNKNOWN, EXPLICIT_NEGATIVE, CONFLICT_HOLD (can keep four public statuses and separate conflict flag if needed). Preserve audit records for held/unknown cases. Not-listed cannot become veto; only genuine current OEM no-recommendation can be a report-only veto candidate.
- Integrate as an optional `oem_relations` input to `build_catalog` under OFF flag. Keep legacy `fitment_rules` array, `mechanical_pool`, B_universal and V3.6 similar unchanged. Cross-brand candidate index must not require `brand_tid` equality or same head. Only eligible and reviewed relation can become a new A_model; conditional is held unless safe UX/policy explicitly approved. Correct UA/RU and cross-taxonomy roles.
- Stage1 stays downstream: consume actual native probe/option/VID/OID/digest results for each target and source context; no untrusted ad hoc True flag. No Stage1 receipt -> no publication. Source or target unavailable -> no publication.
- Control outputs: 13 physical pairs/26 locale rows as seed; all negative/holdouts; actual Bugaboo cross-brand brands different; original legacy manufacturer proofs; multiple ambiguous/spoofed aliases; tampered bytes; source region drift; same-row T2 baseline. Re-run full corrected 8,129-source / 28,769-row snapshot, diff all existing 1,832 stroller and 42 seat A, all V3.6 similar and limit/order. Any displaced legacy recommendation due to max-20 requires explicit report and owner approval.

Deliver patch/branch, tests real modules without stubs, reproducible commands, byte hashes, `oem_relations.json`, `OEM_SHADOW_DIFF.csv`, `REGRESSION_DIFF.csv`, Stage1 gap report, and clearly marked `GO (rehearsal only)` / `NO-GO (production)`. Preserve originals unchanged; never publish, merge, or alter production without separate explicit owner approval. Avoid repeated generalized research.
