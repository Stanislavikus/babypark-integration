# Catalog Service

Status: CURRENT (code) / NOT DEPLOYED (catalog data)
Last verified: 2026-09-24
Owner: BabyPark
Source of truth: src/catalog/service/

## Purpose

CatalogService is the provider-neutral read boundary used by future copilot/AI tools.

It reads only the active canonical catalog generation through CatalogReader.

It never exposes:
- raw SQL;
- Drupal nid/vid/oid;
- Magento entity IDs;
- provider-specific field names;
- catalog write operations.

No production catalog generation or Drupal source access is enabled by this code.

## Public methods

Current v1 surface:

- status()
- searchProducts(...)
- getProduct(productId | sku | url)
- getVariant(variantId | sku)
- getOffers(variantIds | skus)
- getStoreStock(variantId | sku, storeIds?)
- listCategories(...)
- listAttributes(...)
- compareProducts(...)
- getStores(...)
- lookupSku(...)

Every response includes catalog metadata from the same active SQLite handle used for
the returned data.

Metadata includes:
- generation_id;
- source_epoch;
- identity_revision;
- dependency_fingerprint;
- per-layer accepted watermark/fingerprint;
- source/provider/integration timestamps;
- freshness state;
- need_reconcile / need_full.

## SKU lookup

SKU matching always uses canonical sku_key computed by the shared domain normalizer.

Raw provider/database collation is never used as the runtime identity rule.

Exact SKU lookup has priority over text search.

If a known SKU is unavailable and default search is sellable-only, the result is
reported as EXACT_SKU_FILTERED rather than silently falling through to unrelated
text results.

## Search

Default commercial availability:

- IN_STOCK
- EXPECTED
- MADE_TO_ORDER

OUT_OF_STOCK and DISCONTINUED require explicit inclusion/filtering.

Search order:

1. exact canonical SKU;
2. FTS5 unicode word search;
3. FTS5 trigram fallback;
4. browse when query is empty.

User text never enters FTS MATCH as raw syntax.

The query layer:
- NFC-normalizes text;
- bounds input to 256 characters;
- extracts at most 8 Unicode letter/number tokens;
- quotes tokens as literals;
- bounds result limits;
- parameterizes structured SQL filters.

This prevents FTS syntax injection and unbounded query shapes.

## Variant-aware filters

Price, commercial availability and physical-store filters operate on variants.

A product may match through a non-default variant.

Search summaries therefore contain both:
- default variant/price fields for product presentation;
- matched_variant for the actual variant satisfying the filter.

This avoids presenting a default price as if it were the price that satisfied a
structured query.

## Physical stock

Physical store stock remains separate from commercial availability.

getStoreStock:
- resolves by stable variant_id or canonical SKU;
- hides inactive stores by default;
- can explicitly include inactive stores for diagnostics/admin use;
- never invents stock for KIT products.

## Product DTO

getProduct returns provider-neutral:

- stable product_id;
- kind / product_type;
- brand;
- localized RU/UK presentation;
- stable variants + normalized offers;
- categories;
- attributes;
- images;
- kit component composition where relevant;
- provenance.

Money remains integer minor units.

## Same-generation guarantee

All public methods execute inside CatalogReader.withDb().

The reader:
- checks CURRENT before the callback;
- executes the service query synchronously;
- rejects async callbacks;
- checks CURRENT again;
- retries/discards if the pointer changed.

compareProducts therefore cannot combine products from different active generations.

## Limits

Current hard limits:

- search results: 50 maximum;
- variant/SKU offer batch: 100;
- compare: 4 products;
- query: 256 characters / 8 tokens.

These are service contract limits, not UI hints.

## D3 automated coverage

Synthetic tests cover:

- same-generation freshness metadata;
- exact SKU normalization;
- exact unavailable SKU filtering;
- FTS word search;
- trigram fallback;
- RU presentation/search;
- price filters matching non-default variants;
- positive physical-store filters;
- parameterized hostile store IDs;
- sellable browse defaults;
- product lookup by stable ID/SKU/URL;
- KIT composition without invented store stock;
- variant and offer lookup;
- inactive store suppression;
- categories/attributes/stores;
- one-generation compare;
- hostile FTS syntax;
- query length bounds;
- batch/selector bounds;
- lookupSku FOUND/NOT_FOUND;
- invalid availability/price ranges.

## Next boundary

Phase E ingest will be responsible for populating this schema safely.

CatalogService does not know whether canonical rows originated from:
- Drupal;
- Magento;
- future SaaS source.

That provider boundary remains outside this service.
