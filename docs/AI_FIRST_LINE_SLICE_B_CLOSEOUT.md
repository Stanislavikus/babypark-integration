# AI First Line Slice B — final acceptance closeout

Status: CLOSEOUT CANDIDATE
Last verified: 2026-10-02
Owner: BabyPark
Umbrella issue: #69
Normative design:
- docs/AI_FIRST_LINE_DESIGN.md
- docs/AI_FIRST_LINE_ACCEPTANCE.md

## Scope

Slice B provides provider-neutral deterministic Catalog/resolver facts for the
future Website First Line decision engine. It does not create customer-facing
messages, call an LLM, own conversation episode state, or perform handoff.

Delivery:
- B1 — product price + variant factual core: PR #70;
- B2 — closed-world category/brand/money/store resolvers: PR #71;
- B3 — objective matched-cohort search: PR #72;
- B4 — specific-store stock + neutral ProductPresentation: PR #73;
- B5 — decision-ready neutral DTO requirements are realized across B1–B4 rather
  than as a second Catalog reader or renderer layer.

## Definition-of-Done matrix
### 1. Provider-neutral typed factual/query APIs — PASS

CatalogService provides:
- getProductPriceFact(...);
- getAvailableVariantsFact(...);
- getVariantPriceListFact(...);
- searchObjectiveProducts(...);
- getStoreStockFact(...).

Knowledge provides closed-world deterministic category/brand/store/money
resolvers with canonical IDs and Vocabulary revision provenance.

No API above depends on Drupal/Magento native IDs as AI authority.

### 2. Frozen Slice B acceptance vectors — PASS

Price / variants:
- trusted offer hole fails the whole relevant price cohort;
- zero current price => ZERO_PRICE_UNVERIFIED;
- mixed relevant currency => MIXED_CURRENCY;
- single/range price derives from the full relevant active + IN_STOCK cohort;
- available-now excludes EXPECTED / MADE_TO_ORDER;
- variant-price ordering is deterministic;
- label completeness is explicit.

Objective search:
- exact category or brand anchor required;
- NODE_ONLY / INCLUDE_DESCENDANTS are explicit;
- membership and displayed price use the same matched cohort;
- default-variant price cannot leak into another matched cohort;
- exact-store filter uses canonical store qty > 0;
- missing exact-store row or unsafe stock authority fails closed;
- relevant offer hole, zero price, mixed currency fail closed;
- stable price/product ordering;
- display limit never changes total_product_count.

Specific-store stock:
- exact selected variant + exact canonical store => deterministic boolean fact;
- product-only path auto-resolves only one active IN_STOCK variant;
- multi-variant product never aggregates model-level store stock;
- customer-selectable clarification labels must all be safe and unique;
- missing exact-store row is unknown authority, not zero;
- quantity is not exposed;
- pickup-today is not claimed.

### 3. Relevant freshness/completeness fail closed — PASS

Price/general objective facts depend on commercial authority.
Specific-store stock and store-filter objective search depend on commercial +
stock authority.
Unrelated stale layers do not poison a safe factual result.

Relevant STALE / need_reconcile / need_full states fail closed.

Stock freshness is layer-level in v1. No row-level stale/TTL semantics are
invented.

### 4. Canonical store IDs only at AI/query boundary — PASS

B2 resolves reviewed store phrases only to one active canonical BabyPark store.
B3/B4 validate canonical current stores. Provider-native Drupal/Magento store
IDs are rejected rather than used as fallback authority.

### 5. No LLM required for factual result — PASS

Critical IDs, price values, currency, stock boolean, counts, matched cohorts,
reason codes and provenance are deterministic values.

### 6. No customer-facing message creation — PASS

Slice B produces factual/query DTOs only.
ProductPresentation v1 is neutral data, not a Chatwoot card or final prose.

### 7. Existing regressions — PASS gate

Closeout gateway must include full unit, legacy/refactor characterization,
storage-policy validation, and git diff --check.
### 8. Docs point to Slice C — PASS on closeout merge

After this closeout merges, the next implementation slice is Website First Line
episode state + ObjectiveConstraintLatch + deterministic ANSWER / CLARIFY /
HUMAN + WebsiteRenderer/TextRenderer.

## Required machine-level outcomes

Slice B preserves or produces deterministic authority for:
- PRICE_COHORT_INCOMPLETE;
- ZERO_PRICE_UNVERIFIED;
- MIXED_CURRENCY;
- CATALOG_COMMERCIAL_STALE;
- CATALOG_STOCK_STALE;
- PRODUCT_VARIANT_NOT_RESOLVABLE;
- CATALOG_IDENTITY_COLLISION;
- ambiguous category / brand / money / store resolver states;
- MISSING_SHORTLIST_ANCHOR.

CATALOG_IDENTITY_COLLISION is a corruption boundary, not a normal user
ambiguity. A supposedly canonical selector resolving to multiple product IDs
fails closed and does not expose internal candidates.

## Acceptance ownership boundary
The following frozen vectors are intentionally NOT Slice B implementation gaps:

- C44 unsupported exclusion — Slice C ObjectiveConstraintLatch;
- C45 unsupported age/suitability constraint — Slice C ObjectiveConstraintLatch;
- C46 subjective recommendation — Slice C decision/routing;
- C47 compatibility mixed with an otherwise answerable fact — Slice C latch and
  no-partial-public-answer rule;
- C53 unresolved store phrase final CLARIFY routing — B2 supplies deterministic
  resolver ambiguity; Slice C owns episode/routing;
- C58 second unresolved variant clarification => CLARIFY_EXHAUSTED — Slice C
  episode state owns clarification-attempt counting.

Slice B supplies deterministic inputs and machine reasons required by those
vectors; it does not own their conversation-state decision.

## B5 decision-ready DTO coverage

B5 is not a separate data source. Across B1–B4, decision-ready DTOs expose:
- canonical IDs where applicable;
- exact matched variant cohort;
- trusted integer price min/max and currency;
- total count vs displayed count;
- label completeness;
- exact store constraint/match when applicable;
- same-generation Catalog metadata;
- per-layer freshness, need_reconcile and need_full authority;
- stable fail-closed reason codes.
Neutral ProductPresentation v1 carries only:
- canonical product_id;
- optional exact variant_id / sanitized variant_label;
- title;
- product_url;
- bounded-safe image_url.

Price/stock values remain in factual DTOs and are never rewritten by an LLM.

## Production evidence boundary

Read-only probes on the accepted production Catalog generation have confirmed:
- objective/store sparse-stock fail-closed semantics;
- exact-store qty > 0 => true;
- exact-store qty = 0 => false;
- missing exact-store row => CATALOG_STOCK_STALE;
- real multi-variant product => deterministic AMBIGUOUS_VARIANT when labels are
  safe and unique.

No production mutation is part of Slice B closeout.

## Closeout gate

This document becomes CURRENT only after:
1. C60 identity-collision regression passes;
2. focused Slice B contracts pass;
3. the full repository gateway passes;
4. closeout diff is reviewed and merged.

Issue #69 may be closed only after that merge.
