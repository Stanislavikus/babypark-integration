# AI Seller PoC-0 — bounded scope change under Agreement §10

Status: NORMATIVE — FROZEN scope change under `docs/AI_WORKING_AGREEMENT.md` §10, **only after merge to canonical `main`**; while unmerged, this file is a proposal and authorizes nothing.
Applies to: exactly one offline research experiment, "AI Seller PoC-0" (quality of AI answers, comparisons and recommendations over an existing BabyPark catalog snapshot), within the bounds of §3 below.
Supersedes: none. This document does not amend `docs/AI_WORKING_AGREEMENT.md`, `docs/AI_FIRST_LINE_DESIGN.md` or `docs/AI_FIRST_LINE_ACCEPTANCE.md`.
Target repository path: `docs/AI_SELLER_POC0_SCOPE_CHANGE.md`.
Proposal basis: canonical `main` `f3d92325e6b4ef04f0137c4c49dde07c05731bbe` (tree `ffb8953002feaeb5f417a09a832c86f24051afa2`), Agreement blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.
Justification evidence: R1 final review `FINAL_REVIEW.md`, SHA-256 `eb6bfac11efd2ff8fb84e6db502a8b515921a97e6ebca640027e850036cf35c0` (EVIDENCE — NON-NORMATIVE).

Preparing or merging this document is not an implementation authorization and not a budget approval.

## 1. Exclusion being reopened

Agreement §10 (lines 311–313 at the basis above):

> Ordinary product-scope exclusions may be reopened only by a separately justified/frozen scope change:
> - general business/product market, RAG, or recommendation research unless a concrete current-slice correctness blocker requires it;

This document reopens **only** "RAG research" and "recommendation research", **only** for PoC-0 as bounded in §3. "General business/product market research" stays excluded. The other §10 exclusions are untouched: 1C/Magento/middleware adapter design; Voice/Asterisk and Telegram/Viber customer-facing AI.

## 2. Separate justification

1. **Product objective (owner).** An AI that understands a customer question, reads a provider-neutral catalog, compares products and recommends suitable options. Drupal now, Magento later; a source change must not require AI rework.
2. **No current-slice blocker applies.** The frozen Website First Line v1 deliberately excludes this capability:
   - `AI_FIRST_LINE_DESIGN.md` §1: "must not behave as a universal sales consultant";
   - §16: `SUBJECTIVE_RECOMMENDATION` and `PRODUCT_ATTRIBUTE_NOT_AUTHORITATIVE` → HUMAN;
   - §26, §49 (non-goals).

   So the §10 "correctness blocker" path does not apply, and a separate scope change is the only lawful path.
3. **The product decision depends on facts only an experiment can provide** (FINAL_REVIEW §2):
   - canonical structured attributes are empty by construction (exporter `attributes: []`; production count 0);
   - product knowledge sits in descriptions: owner-attested 32,308 non-empty descriptions out of 32,311 `product_text` rows on a historical SQLite snapshot, raw HTML with real contradictions;
   - lexical search fails on morphology, typos, transliteration and natural phrasing (tests E1, E4);
   - "quote exists" checks do not prove meaning (tests E3, E4).

   Whether one Claude model can answer, compare and recommend reliably from this data is unknown. Under Agreement §9 the answer must not be guessed.
4. **Lowest-risk evidence path.** The experiment is offline and uses:
   - an existing, verified catalog snapshot;
   - synthetic seller-authored questions, no customer data;
   - no production writes or connectivity from the PoC environment;
   - no new BabyPark code;
   - the existing n8n test container and one Claude model.

   It produces evidence for a later, separately reviewed design decision. It decides nothing by itself.

## 3. Exact bounded scope reopened

| Item | Bound |
|---|---|
| Activity | One experiment, PoC-0. It measures: (a) understanding of natural uk/ru questions; (b) product finding in a bounded catalog subset; (c) comparison of 2–4 products; (d) recommendations with claim-level source labels. |
| Data | An allowlisted projection of a verified BabyPark catalog snapshot: no `provenance`, `metadata` or provider-native IDs. Plus synthetic questions written by BabyPark sellers, without personal data. |
| Runtime | Stock n8n 2.43.7 in the existing non-production test container. One Claude model through a non-production API key. Exact configuration lives in the bound fit-note. |
| Outputs | Measurement results and a report classified EVIDENCE — NON-NORMATIVE. No customer-facing, operator-facing or Chatwoot output of any kind. |
| Lifetime | Ends at the first of: PoC-0 report delivered; a stop condition of the bound plan fires; the bound fit-note authorization becomes invalid (Agreement §3); owner revocation. |

## 4. What remains excluded

- Production use, shadow mode, or any customer-data path. Real customer messages, transcripts or PII.
- Any Chatwoot read or write, including private notes. Seller Assist (Design Slice E remains deferred).
- Changes to `AI_FIRST_LINE_DESIGN.md` / `AI_FIRST_LINE_ACCEPTANCE.md`. Website First Line v1 behavior is unchanged and its frozen contract stays authoritative.
- New BabyPark production code, APIs or services. Changes to CatalogService, FTS, generation or ingest.
- PIM, vector databases, embeddings providers and additional agents — unless a later, separately approved stage proves necessity.
- Use of PoC results as authority for any customer-facing behavior, or as a substitute for the Agreement §§1–3 gates of any later stage.
- Market or general product research; the other §10 exclusions.

## 5. Preconditions for any PoC-0 activity

All must hold. Merging this document satisfies only the first.

1. This document is merged to canonical `main` byte-identical to the reviewed proposal (or re-bound by digest).
2. A frozen Agreement §1 alternatives scan exists (SHA-256).
3. A frozen §3 architecture-fit note binds: that scan digest, this document's digest, and the PoC plan digest with its exit criteria and stop conditions.
4. The owner go-ahead names the fit-note digest, the bounded use and the budget cap.
5. Data acquisition from the catalog is separately authorized by the owner, using existing tooling only.
6. Credentials are isolated and non-production. The PoC environment has no production connectivity.
7. The PoC lives on its own bounded branch pinned to an exact base SHA, without merge authorization (Agreement §3).

## 6. Interaction with other rules

- Agreement §§1–9 and §2.0a apply unchanged; this document cannot relax them (§11).
- `AI_FIRST_LINE_DESIGN.md` §2.4 (KnowledgeContent out of scope for First Line v1) is not affected: PoC-0 is not part of First Line v1.
- Any later stage must obtain its own scope change or reviewed design amendment, plus its own §§1–3 evidence:
  - production design;
  - Seller Assist;
  - search/index change;
  - any customer exposure.

## 7. Merge procedure for this document

`RISK CLASSIFICATION: HEAVY`

- Reasoning (Agreement §7.0): the change introduces a normative scope contract that reopens a governance exclusion; classification ambiguity → HEAVY.
- Required verification: docs-only change → `git diff --check "${CAMPAIGN_BASE_OID}..HEAD"` and `git diff --name-status "${CAMPAIGN_BASE_OID}..HEAD"`, with `CAMPAIGN_BASE_OID` bound exactly as in §7.0a. Only `docs/` paths may change. The campaign may also update `docs/CURRENT_STATE.md` per its lifecycle rules.
- Closure: exhaustive R1 and isolated R2, both ZERO BLOCKERS on the same exact basis. Then owner approval bound to the final-gate bundle, and an atomic CAS/lease merge (§7, §8). No auto-merge.

## 8. Traceability (Agreement §6; `PRODUCTION IMPLEMENTATION: NONE`)

| Requirement | Artifact clause | Verification | Fail-closed behavior | Durable-state impact | Status |
|---|---|---|---|---|---|
| §10: reopening only by separate, frozen scope change | this document §§1–2, Status line | R1/R2 confirm justification and frozen status after merge | unmerged → authorizes nothing | none | IN PROGRESS |
| Reopen only RAG + recommendation research | §1 | R1/R2 compare against §10 text | anything else stays excluded | none | IN PROGRESS |
| Bounded activity, data, runtime, outputs, lifetime | §3 | R1/R2 check against bound fit-note and plan | out-of-bound use → not covered | none | IN PROGRESS |
| Explicit exclusions | §4 | R1/R2 completeness check vs Design §1/§16/§49 and Agreement §10 | excluded items need a new scope change | none | IN PROGRESS |
| §3 PoC gates preserved | §5 | R1/R2 compare with Agreement §3:124–130 | missing gate → no PoC activity | none | IN PROGRESS |
| No relaxation of other rules | §6 | R1/R2 check against §11 limits | conflict → Agreement wins | none | IN PROGRESS |
| HEAVY closure | §7 | manifest + R1/R2 records | gate open → no merge | none | IN PROGRESS |

Every row must reach `DONE` before merge. `IN PROGRESS` blocks merge.
