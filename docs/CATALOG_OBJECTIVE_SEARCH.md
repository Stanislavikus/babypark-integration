# Catalog objective search — AI First Line Slice B3

Status: IMPLEMENTED IN REPOSITORY CANDIDATE / NOT DEPLOYED
Last verified: 2026-10-02
Owner: BabyPark
Normative design: docs/AI_FIRST_LINE_DESIGN.md
Implementation issue: #69

## Purpose

Slice B3 adds a dedicated provider-neutral factual shortlist contract:

`searchObjectiveProducts(...)`

It does not reuse broad `searchProducts()` as customer factual authority and does
not create customer-facing prose, recommendation ranking, or Chatwoot messages.

## Minimum anchor and exact targets

A query requires at least one exact canonical anchor:
- category_id with explicit NODE_ONLY or INCLUDE_DESCENDANTS; or
- brand_id.

Category, brand and store identifiers must exist in the same accepted Catalog
generation. Store must be active. Missing anchor fails closed as
`MISSING_SHORTLIST_ANCHOR`.

## Relevant variant universe

The base customer-purchasable universe is:
- active variants;
- commercial_availability == IN_STOCK;
- exact canonical category/brand constraints;
- when store_id is present, exact-store quantity > 0.

EXPECTED, MADE_TO_ORDER, OUT_OF_STOCK and DISCONTINUED variants do not participate
in this objective-search universe.

## Trusted-price completeness

Every variant in the relevant anchored universe must have trusted canonical price
and currency authority before the result may be used.

Fail closed:
- missing or malformed trusted offer/currency -> PRICE_COHORT_INCOMPLETE;
- zero current price -> ZERO_PRICE_UNVERIFIED;
- more than one relevant currency -> MIXED_CURRENCY;
- unsafe commercial authority -> CATALOG_COMMERCIAL_STALE;
- store-filter query with unsafe stock authority -> CATALOG_STOCK_STALE.

No incomplete product is silently removed from membership or total count.

## Currency boundary

A single non-UAH cohort is factual when no UAH price constraint is being applied.

A UAH money constraint is never numerically compared with a non-UAH cohort and no
currency conversion is invented. That combination fails closed as
`UNSUPPORTED_CONSTRAINT` with `constraint: PRICE_CURRENCY`.

## Price-filter matched cohort

When min/max price is supplied, product membership and displayed price derive from
the same matched variant cohort.

The contract never matches through one variant and then presents another/default
variant price.

Per returned product:
- matching_price_min_minor and matching_price_max_minor come only from matched variants;
- matching_variant_ids contains that exact matched cohort;
- labels are sanitized and label completeness is explicit;
- matched_store_id is present when an exact store constraint participated.

## all_available_variants_match_filters

`all_available_variants_match_filters` compares the final matched cohort against
the same customer-purchasable denominator used by objective search: active +
IN_STOCK variants after exact category/brand constraints and, when storeId is
present, only variants with confirmed quantity > 0 at that exact store.

Therefore an EXPECTED, MADE_TO_ORDER, OUT_OF_STOCK or DISCONTINUED variant does not
turn the flag false merely because it exists.

The flag is false when only part of the available-now purchasable cohort survives
the objective filters, for example when one IN_STOCK variant is 19,300 and another
IN_STOCK variant is 27,300 under a <=20,000 price filter.

Future messaging about additional non-purchasable variants is a separate concern
and is not represented by this flag.

## Category tree

NODE_ONLY matches direct category membership only.

INCLUDE_DESCENDANTS expands the category tree from the same pinned Catalog
generation before product matching.

There is no default category match mode.

## Store filter

An exact store filter:
- requires an active canonical BabyPark store_id;
- adds stock to relevant authority;
- requires an explicit store_stock row for every anchored active + IN_STOCK
  variant at that exact store;
- treats quantity = 0 as a confirmed non-participating store state;
- accepts only participating variants with quantity > 0 at that store.

A missing exact-store row is not a confirmed zero. B3 cannot distinguish
"structurally not stocked in stores" from "store-stock projection incomplete",
so the safe v1 behavior is CATALOG_STOCK_STALE for the whole store-filtered
result. No-store objective queries remain independent of store_stock.

Store freshness is layer-level authority in v1. source_updated_at is retained
evidence; B3 does not invent a row-level TTL or per-row stale state.

Commercial IN_STOCK never substitutes for store stock. Unknown or inactive store
never falls back to general availability.

## Ordering and count

Stable product ordering:
`matching_price_min_minor ASC, product_id ASC`.

Display limit defaults to 3 and is bounded. It affects only returned rows.

`total_product_count` is calculated before display limiting. An empty exact
result is `OBJECTIVE_SHORTLIST_EMPTY` and constraints are never widened.

## Neutral DTO boundary

B3 returns neutral factual values suitable for later Slice C rendering:
- canonical product and variant IDs;
- matched price cohort and currency;
- total vs displayed product count;
- sanitized label completeness;
- matched store constraint when used;
- same-generation Catalog authority metadata;
- explicit fail-closed reason codes.

No LLM is required to produce or alter these values.

## Explicit non-goals

B3 does not implement:
- customer episode state;
- ObjectiveConstraintLatch;
- ANSWER / CLARIFY / HUMAN routing;
- customer-facing wording/cards;
- specific-store single-product stock semantics;
- decision_context_id construction;
- private handoff-note creation/enrichment;
- Seller Assist;
- currency conversion.

The frozen downstream Slice D contract requires HUMAN / CATALOG_STOCK_STALE
handoff notes to retain independently authoritative confirmed facts where
available, without treating a failed B3 store-filtered shortlist as a confirmed
partial shortlist.
