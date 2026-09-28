# Product Identity Resolution v1

Status: DRAFT DESIGN / REVIEW REQUIRED
Last verified: 2026-09-28
Owner: BabyPark

Related:
- `docs/CATALOG_IDENTITY.md`
- `docs/CATALOG_IDENTITY_ANOMALY_MANAGEMENT.md`
- `docs/CATALOG_ANOMALY_RUNTIME_V1.md`
- `docs/DRUPAL_LEGACY_COLLISION_REVIEW_20260927.md`

## Purpose

This slice defines the first provider-neutral workflow that turns a catalog anomaly
into a reviewed identity decision and a deterministic downstream action.

It is deliberately separate from Catalog Anomaly Runtime v1.

Anomaly Runtime answers:

```text
What is unsafe right now, what must be quarantined, and what evidence must survive?
```

Product Identity Resolution answers:

```text
What do these source records actually represent, what reviewed decision is true,
and what deterministic product/supply/category action follows from that decision?
```

No runtime implementation is authorized by this draft.

## Core separation

The system must model these concepts independently:

```text
physical product / variant identity
    != source listing
    != supplier offer
    != category assignment
    != customer offer
    != channel listing / URL
```

A duplicated source record is therefore not automatically a duplicated physical
product.

Likewise, two supplier records are not automatically two customer-facing products.

## Identity evidence hierarchy

No single source SKU is sufficient authority.

The resolver should collect evidence in this order of strength when available:

1. GTIN/EAN/UPC assigned to the exact physical product/variant.
2. Manufacturer identity: Brand + manufacturer MPN/article.
3. Variant-defining attributes such as size, color, package, compatibility or
   other manufacturer-defined dimensions.
4. Provider-native product/variant identity and historical reviewed bindings.
5. Supplier SKU/article, always scoped to that supplier.
6. Content/image/category/title/price/availability evidence as supporting context.

Price, availability, title, category and URL are not identity keys.
They may change without changing the physical product.
A supplier-specific raw SKU must be preserved exactly for supplier integration,
but its normalized form may participate in anomaly detection.

Case-only SKU differences are never sufficient proof that two records are
different products.

Likewise, a normalized match is never sufficient proof that they are the same
product.

## Resolution authority

AI may propose a classification from evidence but does not create durable truth.

The workflow has three authority levels:

```text
machine observation
  -> AI/operator proposal
  -> administrator/reviewer approval
```

Only the approved structured decision becomes durable identity authority.

Prompt text, seller behavior, one conversation, or an unreviewed operator click
must not create a global identity rule.

## Identity decision axis

Identity must be stored separately from publication/migration action.

Initial v1 decision vocabulary:

- `UNDECIDED`
- `SAME_PHYSICAL_PRODUCT`
- `DISTINCT_PHYSICAL_PRODUCTS`

### UNDECIDED

Evidence is insufficient. The anomaly remains unresolved and the smallest unsafe
scope stays quarantined.

### SAME_PHYSICAL_PRODUCT

The reviewed records represent one physical product/variant.

This decision does not by itself say which source record survives or how content,
categories, URLs or supply records are merged.

### DISTINCT_PHYSICAL_PRODUCTS

The records are confirmed to represent different products/variants despite a
colliding or similar identifier.

The source identifier must be corrected or an explicit reviewed exception must
explain the intentional conflict.

## Identifier-exception axis

Intentional identifier reuse is not an identity state.

A separate reviewed exception may record, for example:

- `NONE`
- `SHARED_IDENTIFIER_APPROVED`

`SHARED_IDENTIFIER_APPROVED` requires an auditable reason, explicit scope and
downstream policy. It may coexist with `DISTINCT_PHYSICAL_PRODUCTS`; it must not
be used as a shortcut around deciding what the records physically represent.

## Root-cause axis

Root cause is independent of identity truth.

Initial vocabulary may include:

- `LEGACY_DUPLICATE_CARD`
- `CATEGORY_SPLIT_DUPLICATE`
- `MULTIPLE_SUPPLIERS`
- `CASE_VARIANT_SOURCE_SKU`
- `SYNTHESIZED_DEFAULT_ARTIFACT`
- `WHITESPACE_NORMALIZATION_ARTIFACT`
- `SOURCE_IDENTIFIER_ERROR`
- `VARIANT_MODELING_ERROR`
- `HISTORICAL_CHANNEL_WORKAROUND`
- `UNKNOWN`

Multiple causes may apply to one incident.

## Action axis

The approved identity decision must not be overloaded with the migration action.

Initial v1 action vocabulary:

- `NO_ACTION`
- `MERGE_SOURCE_RECORDS`
- `BIND_TO_CANONICAL_PRODUCT`
- `CREATE_OR_BIND_SUPPLIER_OFFERS`
- `MERGE_CATEGORY_ASSIGNMENTS`
- `MERGE_CONTENT_FIELDS`
- `REDIRECT_DUPLICATE_URL`
- `KEEP_DISTINCT`
- `EXCLUDE_LEGACY_RECORD`
- `REQUIRE_SOURCE_CORRECTION`
- `MANUAL_MIGRATION_PLAN`

A resolution may require several ordered actions.

## Canonical product and categories

A canonical product may belong to zero or more categories.

Category membership is navigation/classification, not product identity.

BabyPark should distinguish:

- taxonomy categories: stable product classification/navigation;
- merchandising collections: promotions, campaigns, seasonal collections,
  "new", "sale", brand showcases and other temporary merchandising contexts.

The future platform may additionally mark one taxonomy category as a preferred
navigation context for breadcrumbs, AI explanations or category links.

That preferred category is a BabyPark presentation/navigation decision, not an
identity key and not proof that a duplicate source product is different.

For Magento/Adobe Commerce, the target default is one stable customer-facing
product URL per canonical product, with category assignments remaining separate.
If category-path product URLs are enabled, canonical metadata must still point to
the canonical product URL.

## Canonical product and supplier offers

One confirmed physical product may have many supplier offers.

Conceptually:

```text
Canonical Product / Variant
  -> Supplier Offer A
       supplier_id
       supplier_sku_raw
       supplier_sku_normalized
       cost
       supplier availability
       lead time
       MOQ / pack rules
       freshness / observed_at
  -> Supplier Offer B
       ...
```

Supplier offers must not become customer-facing duplicate products merely because
the supplier SKU differs, including case-only differences.

The supplier layer is primarily a BabyPark SaaS / 1C concern.
A supplier should become a Magento Inventory Source only when the supplier or
location actually participates in fulfillment semantics such as drop shipping or
source-level stock, not merely because it supplies BabyPark.

## Customer offer and fulfillment selection

Customer-facing AI must consume a consolidated customer offer for the canonical
product, not choose between raw supplier rows.

Supplier/source selection is deterministic policy, not LLM reasoning.

Future policy may consider:

- trusted availability;
- landed cost;
- customer price and margin floor;
- source freshness;
- fulfillment lead time;
- own stock versus supplier/drop-ship stock;
- MOQ/pack constraints;
- supplier priority/reliability.

"Cheapest supplier wins" is therefore not a sufficient universal rule.

Likewise, "cheapest duplicate product wins" is forbidden as an identity rule.

AI may rank different canonical products by customer-visible price after identity
is already resolved.

## Merchant/channel identity

The same canonical product should have a stable channel item identity.

Manufacturer identifiers must preserve their manufacturer meaning:

- GTIN identifies the manufacturer-defined trade item;
- Brand + MPN identifies the manufacturer product when GTIN is unavailable;
- supplier SKU remains supplier-scoped;
- BabyPark/channel item ID remains stable for the same product.

Do not manufacture distinct Merchant Center products by changing only letter case.

If the same physical product is sold through multiple BabyPark supply sources,
the channel should normally receive one customer-facing product/offer identity,
not one item per internal supplier.

Channel-specific duplication required by a marketplace model must be reviewed as
a separate channel rule rather than leaking back into canonical product identity.

## Relationship to existing anomaly incident state

Product identity resolution does not replace the frozen anomaly incident axes.

Existing machine-owned observation state remains:

- `OBSERVED`
- `NOT_OBSERVED`
- `CLEARED`

Existing human workflow review state remains:

- `NEW`
- `ACKNOWLEDGED`
- `INVESTIGATING`
- `PENDING_ADMIN`
- `RESOLVED`

The identity decision, root cause, identifier exception and ordered action plan
belong to a reviewed resolution record linked to the incident.

A source correction may clear an observation without creating a permanent identity
rule. Conversely, an approved identity decision may remain durable after the
specific source anomaly disappears.

## Requires Attention workflow v1

The first admin workflow should be an incident detail screen, not a generic log.

Minimum sections:

### Header
- incident fingerprint / anomaly type;
- observation state;
- review state;
- first/last seen and recurrence;
- affected source records;
- current quarantine/publication impact.

### Evidence
Side-by-side source records with:
- provider/source IDs;
- raw and normalized identifiers;
- GTIN;
- Brand + MPN/article;
- variant attributes;
- supplier;
- title;
- price and availability;
- categories;
- URLs;
- image/content similarity evidence;
- provenance and observation timestamps.

### Proposal
AI may propose:
- identity decision;
- root-cause classification;
- ordered actions;
- concise rationale and missing evidence.

AI proposal must be visibly marked as a proposal, not authority.

### Review controls

Operator/content role may:
- acknowledge;
- assign;
- add evidence/comments;
- request source correction;
- propose identity/root-cause/action.

Administrator/reviewer may:
- approve/reject the proposal;
- modify the structured decision;
- approve durable identity binding/exception;
- approve the ordered migration/publication actions;
- reopen/rollback a prior decision.

Approval must record:
- reviewer;
- timestamp;
- evidence version/snapshot;
- decision values;
- resulting action plan;
- durable rule/binding reference when one is created.

## AI consumption rule

Customer-facing and seller-assist AI consume only approved structured identity
facts.

Unapproved `NEW`, `ACKNOWLEDGED`, `INVESTIGATING` or `PENDING_ADMIN`
incidents remain evidence/workflow state.

Prompt engineering is not the identity database.

Reviewed decisions may later become deterministic prevention rules, but the LLM
must not autonomously rewrite global policy from incident history.

## Acceptance case A — Joolz `511000`

Current source evidence:
- product `79252`: RU+UK, richer content/images, live;
- product `139026`: newer UK-only card, correct Accessories category, live;
- same article and price;
- existing review indicates the cards describe the same physical Joolz adapter.

Expected v1 workflow:

1. Incident remains observable/quarantined until reviewed action exists.
2. AI/operator proposal:
   - identity: `SAME_PHYSICAL_PRODUCT`;
   - root cause: `LEGACY_DUPLICATE_CARD` + `CATEGORY_SPLIT_DUPLICATE`;
   - action proposal:
     `BIND_TO_CANONICAL_PRODUCT`,
     `MERGE_CONTENT_FIELDS`,
     `MERGE_CATEGORY_ASSIGNMENTS`,
     `REDIRECT_DUPLICATE_URL`.
3. Reviewer sees that choosing one legacy row must not discard the correct category
   or the richer content from the other row.
4. Approval creates one canonical product with merged, provenance-aware facts.
5. Category assignment remains independent of product identity.
6. AI recommendations use the canonical product URL; category links may be offered
   separately for navigation.

This acceptance case specifically rejects "choose the row in the better category"
as an identity algorithm.

## Acceptance case B — Bugaboo `80401mc02`

Business evidence from the content manager:
- two Drupal cards were created for different suppliers;
- supplier articles differ only by letter case;
- legacy 1C treated those values as different articles;
- this produced two customer-facing cards.

Expected v1 workflow:

1. Incident remains observable/quarantined until manufacturer identity is reviewed.
2. Resolver collects Brand + MPN/article and GTIN when available, plus variant
   attributes, supplier identity and source provenance.
3. If reviewer confirms one physical product:
   - identity: `SAME_PHYSICAL_PRODUCT`;
   - root cause:
     `MULTIPLE_SUPPLIERS` + `CASE_VARIANT_SOURCE_SKU`;
   - actions:
     `BIND_TO_CANONICAL_PRODUCT`,
     `CREATE_OR_BIND_SUPPLIER_OFFERS`,
     `MERGE_SOURCE_RECORDS`,
     `REQUIRE_SOURCE_CORRECTION` where needed.
4. Raw supplier SKU values remain preserved under their supplier offers.
5. Magento/customer-facing catalog receives one product identity.
6. Merchant/channel feed receives one stable product identity unless a separately
   reviewed channel contract requires otherwise.
7. Supply/fulfillment policy chooses the source deterministically; AI does not
   choose between duplicate product cards.

Case-only similarity alone is not sufficient to auto-approve SAME_PHYSICAL_PRODUCT.

## Definition of done for the first implementation slice

The first implementation after design review is successful when:

- the two existing anomaly incidents can be represented without changing the
  current anomaly fingerprint contract;
- identity decision, root cause and action plan are separate structured fields;
- AI proposal and reviewer authority are distinguishable;
- Joolz can express "same product, merge content/categories/URL" without a lossy
  `exclude_product` shortcut;
- Bugaboo can express "same product, multiple supplier offers" without creating
  duplicate canonical products;
- unresolved incidents remain safely quarantined;
- approved decisions are auditable and reversible;
- no customer-facing AI consumes an unresolved identity as fact;
- reviewed decisions can later feed deterministic prevention rules without
  changing global policy automatically.

The first implementation does not need a complete generic PIM UI.
A narrow Requires Attention workflow for these two acceptance cases is sufficient
to prove the model.

## Explicit non-goals

This v1 design does not yet define:
- final database table names or ORM models;
- final confidence-scoring algorithm;
- automatic merge thresholds;
- full supplier procurement optimization;
- Magento source assignment policy for every supplier;
- Product Presentation Projection;
- marketplace-specific identity exceptions;
- automatic global-rule promotion;
- first production FULL transport binding.

Those remain separate implementation/research decisions.

## External standards checked — 2026-09-28

Google Merchant Center:
- ID must be stable for a product and Google warns not to use casing merely to
  make product IDs unique:
  https://support.google.com/merchants/answer/6324405
- duplicate GTIN/MPN/brand identifiers indicate duplicate products or incorrect
  identifiers:
  https://support.google.com/merchants/answer/15094056
- Brand + MPN and GTIN are recognized product matching identifiers:
  https://support.google.com/merchants/answer/14779112

Adobe Commerce / Magento:
- products may be assigned to zero or more categories:
  https://experienceleague.adobe.com/en/docs/commerce-admin/catalog/categories/categories
- product canonical metadata remains product-centric even when category-path URLs
  are enabled:
  https://experienceleague.adobe.com/en/docs/commerce-admin/marketing/seo/meta-data
- Inventory Management supports multiple sources and source-selection behavior:
  https://experienceleague.adobe.com/en/docs/commerce-admin/inventory/basics/product-types

These external rules constrain channel/presentation behavior but do not replace
BabyPark's reviewed canonical identity authority.
