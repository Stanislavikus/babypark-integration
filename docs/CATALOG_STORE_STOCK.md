# Catalog specific-store stock — AI First Line Slice B4

Status: IMPLEMENTED IN REPOSITORY CANDIDATE / NOT DEPLOYED
Last verified: 2026-10-02
Owner: BabyPark
Normative design: docs/AI_FIRST_LINE_DESIGN.md
Implementation issue: #69

## Purpose

Slice B4 adds the provider-neutral factual contract:

`getStoreStockFact({ productId?, variantId?, storeId, language? })`

It answers only exact specific-store stock facts and deterministic variant
clarification. It does not create customer wording, Chatwoot messages, or episode
state.

## Authority boundary

Only canonical IDs are accepted as authority:
- canonical product_id and/or variant_id;
- exact active canonical store_id.

Provider-native Drupal/Magento store identifiers are not accepted as store
authority.

Relevant layers:
- commercial;
- stock.

Both must be FRESH with no need_reconcile / need_full blocker.

## Variant resolution

Specific-store stock may become factual when:
1. an exact active canonical variant is already selected; or
2. the resolved active product has exactly one active IN_STOCK variant.

For product-only input with multiple active IN_STOCK variants:
- every candidate must have a safe, non-empty, unique display label;
- if so, return CLARIFY / AMBIGUOUS_VARIANT with deterministic candidate IDs and
  sanitized labels;
- otherwise return UNANSWERABLE / PRODUCT_VARIANT_NOT_RESOLVABLE.

Duplicate-equivalent safe labels are not sufficient customer identifiers.

For product-only input with zero active IN_STOCK variants, B4 does not invent a
model-level store-stock fact and returns PRODUCT_VARIANT_NOT_RESOLVABLE.

CLARIFY_EXHAUSTED is not a B4 responsibility. Slice C episode state decides
whether a later unresolved clarification attempt is exhausted.

## Exact store fact

After exact variant resolution:
- exact `(variant_id, store_id)` store_stock row is required;
- quantity > 0 => STORE_STOCK with `in_stock=true`;
- quantity = 0 => STORE_STOCK with `in_stock=false`;
- missing row => CATALOG_STOCK_STALE.

A missing row is never interpreted as quantity=0.

The factual DTO never exposes quantity and never claims pickup-today.

## Contract shape

Successful factual result:

```text
{
  contract: bp.catalog.store-stock-fact/1
  status: FACT
  reason: STORE_STOCK

  product_id
  variant_id
  store_id
  selection_mode:
    EXACT_VARIANT | SINGLE_ACTIVE_IN_STOCK_VARIANT
  in_stock: boolean

  presentation: ProductPresentation
  catalog
  relevant_layers: [commercial, stock]
}
```

Clarification result:

```text
{
  status: CLARIFY
  reason: AMBIGUOUS_VARIANT
  product_id
  store_id
  candidate_variants: [{ variant_id, label }]
  total_candidate_variant_count
  displayable_label_count
  label_complete: true
  labels_unique: true
  presentation
}
```

No raw provider IDs or unsafe labels are emitted as customer-selectable
candidate labels.

## ProductPresentation v1

B4 returns a neutral presentation object:

```text
{
  contract: bp.catalog.product-presentation/1
  product_id
  variant_id?
  variant_label?
  title?
  product_url?
  image_url?
}
```

It is not a Chatwoot card and contains no final customer prose.

Image fallback is bounded to the already selected/proven variant cohort. An
unrelated variant image is never chosen merely because it is the default or first
available image.

Price and store quantity do not live inside ProductPresentation. Those remain
separate deterministic factual values.

## Explicit non-goals

B4 does not implement:
- customer episode state;
- CLARIFY_EXHAUSTED turn counting;
- ObjectiveConstraintLatch;
- final ANSWER / CLARIFY / HUMAN rendering;
- WebsiteRenderer/TextRenderer;
- Chatwoot message creation;
- private handoff note creation;
- pickup-today claims;
- provider-native store mapping;
- row-level stock TTL semantics;
- currency conversion.
