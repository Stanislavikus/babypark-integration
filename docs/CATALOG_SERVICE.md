# Catalog Service

Status: CURRENT production read contract; Slice A canonical-store cutover DEPLOYED
Last verified: 2026-10-02
Owner: BabyPark
Source of truth: src/catalog/service/ + accepted production generation

Production canonical-store cutover completed on 2026-10-02. Current accepted
generation is `g_bcd3c2836b25ab4252f8f5510c769f260e0597092fea8aff`, published
against IdentityStore revision 65506. Physical store stock now uses BabyPark
canonical `store_id`; provider-native Drupal IDs are reviewed xrefs only.

Independent production Link A verified the replacement FULL with
`mismatch_count=0` and 48/48 FTS probes PASS. The previous pre-cutover generation
remains retained as PREVIOUS for rollback evidence.

## Purpose

CatalogService is the provider-neutral read boundary used by future copilot/AI tools.

It reads only the active canonical catalog generation through CatalogReader.

It never exposes:
- raw SQL;
- Drupal nid/vid/oid;
- Magento entity IDs;
- provider-specific field names;
- catalog write operations.

The first production FULL is accepted and CURRENT. CatalogService remains a
provider-neutral reader; it does not obtain live Drupal access.

## Private downstream snapshot

`scripts/catalog-snapshot.mjs` materializes the exact CURRENT generation as a local,
private, immutable `<snapshot-id>.ready` directory. It does not add an HTTP route.
Thirteen normalized NDJSON streams cover products, localized text, variants and
availability, offers, brands, category hierarchy/membership, stores and stock,
attribute definitions/values, images, and kit components. Empty optional streams are
present and valid.

Every stream is read in canonical key order with SQLite's row iterator. Thus memory
is bounded by one SQLite row plus write buffers, and there is one scan per domain—not
one aggregate lookup per product. JSON and boolean conversion uses the same canonical
value helpers as the service DTO mapper. Money is serialized only as integer minor
units.

The exporter holds the existing `CatalogPublicationLock` for the complete export,
pins one CatalogReader handle without retry, writes and fsyncs a private `.building`
directory, independently verifies it, checks CURRENT again, then atomically renames it
to `.ready` and fsyncs the parent. Holding the lock makes the proof linearizable with
normal Catalog publication and prevents an invisible A→B→A transition; operationally,
generation publication waits or receives the existing bounded lock-busy result while
a snapshot is running. The lock is coordination only and the exporter does not mutate
publication authority.
Existing `.ready` names and symlink artifact paths are rejected. The operation never
writes the catalog, identity, replay, recovery, publication, or source-acceptance
authorities.

`scripts/verify-catalog-snapshot.mjs` is the independent consumer-side invocation.
It checks schema and generation binding, the exact file set and every parent path
component, private regular-file paths, hashes, byte/record/total counts, NDJSON
validity, strictly ordered unique identities, and integer money. It independently
hashes and validates the embedded sealed generation manifest, reconciles source/layer
metadata and compares every stream count with the sealed generation table counts.
Verification is also streaming and accepts empty optional domains. Both exporter and
verifier require canonical `bp.release-provenance/1`; the production CLI refuses to
run without the immutable release's validated `RELEASE.json` and matching package
lock.

## Public methods

Current v1 surface:

- status()
- searchProducts(...)
- getProduct(productId | sku | url)
- getVariant(variantId | sku)
- getOffers(variantIds | skus) — returns variant-level `commercial_availability`
  beside an optional price-only `offer` (or `offer: null`)
- getStoreStock(variantId | sku, storeIds?)
- listCategories(...)
- listAttributes(...)
- compareProducts(...)
- getStores(...)
- lookupSku(...)
- getProductPriceFact(productId)
- getAvailableVariantsFact(productId)
- getVariantPriceListFact(productId)

The three `*Fact` methods are Slice B1 decision-ready factual contracts. They
remain provider-neutral, execute through the same one-generation CatalogReader
boundary and do not create customer-facing text. Their frozen semantics are
documented in `docs/CATALOG_FACTUAL_CONTRACTS.md`.

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
- never invents stock for KIT products;
- after the Slice A A2 production cutover, accepts/returns BabyPark canonical
  physical `store_id` only; provider-native Drupal/Magento IDs are adapter/xref
  inputs and never CatalogService authority IDs.

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

## Variant availability and offers

Commercial availability belongs to the variant, not to the offer.

- `getVariant` exposes `commercial_availability` on the variant DTO and a
  price-only `offer` when a trusted price exists.
- `getOffers` returns the same variant-level `commercial_availability` for each
  row, with `offer` containing price fields only (or `null` when no trusted
  price was ingested). Availability is never duplicated inside `offer`.

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

## Provider boundary and source cutover

Production ingest now populates this schema through an accepted canonical generation.
CatalogService still does not know whether canonical rows originated from:
- Drupal;
- Magento;
- a future first-party/source platform.

That provider boundary remains outside this service.

A source change must not require a CatalogService product/read-contract redesign.
Provider-specific admission, evidence and translation into the canonical contract belong
on the source-ingestion side. A transition to a different accepted `source_epoch` is a
separately reviewed controlled migration, not a CatalogService setting or hot switch.

CatalogService must continue to expose only canonical IDs and provider-neutral facts
before, during and after such a cutover.
