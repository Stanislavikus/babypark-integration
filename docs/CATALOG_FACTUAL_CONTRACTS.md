# Catalog factual contracts — AI First Line Slice B1

Status: IMPLEMENTED IN REPOSITORY CANDIDATE / NOT DEPLOYED
Last verified: 2026-10-02
Owner: BabyPark
Normative design: docs/AI_FIRST_LINE_DESIGN.md
Implementation issue: #69

## Purpose

Slice B1 converts existing provider-neutral CatalogService reads into narrow,
decision-ready factual contracts for the future AI First Line decision engine.

It does **not** create customer text, Chatwoot messages, recommendations or LLM
reasoning.

The factual layer answers only whether a catalog fact is safe to use and, when it
is safe, returns deterministic canonical values from one CatalogReader generation.

## Public B1 methods

- `getProductPriceFact({ productId })`
- `getAvailableVariantsFact({ productId })`
- `getVariantPriceListFact({ productId })`

All selectors use canonical BabyPark `product_id`. Product resolution from
customer phrases belongs to later resolver/decision slices.

Every result includes same-generation Catalog metadata and explicit
`relevant_layers: ['commercial']` so later decision provenance can bind only the
authority actually used by the fact.

## Result envelope

B1 uses three explicit states:

- `FACT` — the requested fact is safe and deterministic;
- `UNANSWERABLE` — relevant authority exists but is unsafe/incomplete;
- `NOT_FOUND` — no active canonical product exists for the supplied ID.

The status is separate from the machine-level `reason`.

No unsafe condition is converted into an empty successful result.

## Relevant authority

B1 price/variant facts depend on the Catalog `commercial` layer.

The commercial layer is answerable only when:

- `freshness_state === FRESH`;
- `need_reconcile === false`;
- `need_full === false`.

Otherwise B1 returns:

`UNANSWERABLE / CATALOG_COMMERCIAL_STALE`

An unrelated stale/blocked stock layer does not poison these B1 commercial facts.
Specific-store stock is a later Slice B contract and will require stock authority.

## Price-now cohort

For one active canonical product, the relevant current-price cohort is exactly:

- active variants;
- `commercial_availability === IN_STOCK`.

EXPECTED, MADE_TO_ORDER, OUT_OF_STOCK and DISCONTINUED do not enter current-price
facts.

Before any price is returned, every relevant cohort member must have a trusted
canonical offer with currency.

If any relevant IN_STOCK variant lacks an offer/currency:

`UNANSWERABLE / PRICE_COHORT_INCOMPLETE`

The cohort is never silently reduced to the priced subset.

If any trusted current price is zero:

`UNANSWERABLE / ZERO_PRICE_UNVERIFIED`

Zero is not interpreted as “free”.

If the relevant cohort contains more than one currency:

`UNANSWERABLE / MIXED_CURRENCY`

If there are zero active IN_STOCK variants:

`FACT / PRODUCT_NOT_IN_STOCK`

Otherwise `getProductPriceFact()` returns:

- `PRODUCT_PRICE_SINGLE` when min == max;
- `PRODUCT_PRICE_RANGE` when min != max.

Money remains integer minor units.

## Available-now variants

`getAvailableVariantsFact()` returns every active IN_STOCK canonical variant.

EXPECTED and MADE_TO_ORDER are not “available now”.

Variant presentation label is optional factual metadata. It is derived only from
the canonical `options_json` value, preferring reviewed/provider-supplied
`option_name` text when the option is an object.

The sanitizer:

- NFC-normalizes text;
- collapses whitespace;
- rejects empty/control/URL/blob-like values;
- bounds individual parts and the combined label;
- never exposes raw option IDs as labels;
- never infers semantic classes such as COLOR/SIZE/MATERIAL.

A missing safe label does **not** remove the variant.

The result always exposes:

- `total_variant_count`;
- `displayable_label_count`;
- `label_complete`;
- every canonical variant ID.

Therefore five displayable labels out of seven variants can never be presented as
“there are five variants”.

Reason:
- all labels displayable -> `VARIANT_LIST`;
- one or more labels unavailable -> `VARIANT_LIST_PARTIAL`.

## Variant price list

`getVariantPriceListFact()` uses the same complete IN_STOCK price cohort and the
same fail-closed rules as product price summary.

Stable order:

`current_minor ASC, variant_id ASC`

It returns exact canonical variant ID, SKU, optional sanitized label and integer
`current_minor`.

No customer prose or ranking is created.

## Production evidence used to validate B1 assumptions

Read-only probe against CURRENT production generation
`g_bcd3c2836b25ab4252f8f5510c769f260e0597092fea8aff` on 2026-10-02:

- active IN_STOCK variants: 8,673;
- products with active IN_STOCK variants: 4,258;
- missing offer/currency in that cohort: 0;
- zero current price: 0;
- currency: UAH for all 8,673;
- mixed-currency products: 0;
- variants with displayable option label: 7,486;
- variants without displayable option label: 1,187.

These are evidence for the current generation, not permanent invariants. Runtime
contracts still validate completeness/currency/zero/freshness on every factual
read.

## Explicit non-goals

B1 does not implement:

- customer-facing rendering;
- product phrase resolution;
- category/brand/money/store vocabulary resolution;
- objective shortlist search;
- specific-store stock decision semantics;
- ObjectiveConstraintLatch;
- clarification episodes;
- LLM calls;
- Chatwoot messages or handoff;
- Seller Assist;
- AI HUB.

Those remain later Slice B/C/D/E work as defined in the frozen design.
