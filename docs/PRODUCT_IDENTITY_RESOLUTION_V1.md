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

No single source SKU is sufficient authority, and v1 has **no automatic
`SAME_PHYSICAL_PRODUCT` approval path**.

Evidence must carry both an identifier scope and provenance.

Identifier scope examples:
- `MANUFACTURER_GTIN`;
- `MANUFACTURER_MPN`;
- `BABYPARK_CANONICAL_SKU`;
- `SUPPLIER_SKU` with supplier identity;
- `PROVIDER_NATIVE_ID`;
- `CHANNEL_LISTING_ID`.

Provenance examples:
- `SOURCE_OBSERVED`;
- `EXTERNAL_OFFICIAL`;
- `EXTERNAL_CORROBORATED`;
- `HUMAN_CONFIRMED`;
- `REVIEWED_BINDING`.

The resolver should collect evidence in this order of strength when available:

1. GTIN/EAN/UPC assigned to the exact trade item/variant, interpreted together
   with packaging/multipack/condition where relevant.
2. Manufacturer identity: Brand + manufacturer MPN/article.
3. Variant-defining attributes such as size, color, package, compatibility or
   other manufacturer-defined dimensions.
4. Provider-native identity and historical reviewed bindings.
5. Supplier SKU/article, always scoped to that supplier.
6. Content/image/category/title/price/availability as supporting context only.

Strong evidence may conflict. A GTIN mismatch, for example, can reflect a truly
different variant, packaging level, bad source data or a changed identifier. It is
not by itself a machine-approved DISTINCT decision.

When strong evidence conflicts, the proposal state is `CONFLICTING_EVIDENCE` and
human review is mandatory.

Price, availability, title, category and URL are never identity keys.
They may change without changing the physical product.

A supplier-specific raw SKU must be preserved exactly for supplier integration.
It must never enter canonical `variants.sku_key` merely because it is available.

A normalized identifier match, case-only match, title match, price match or
category match is never sufficient proof of SAME_PHYSICAL_PRODUCT.

## Resolution authority

AI may propose a classification from evidence but does not create durable truth.

The workflow has three authority levels:

```text
machine observation
  -> AI/operator proposal
  -> administrator/reviewer approval
```

### v1 authority home

Catalog Anomaly Runtime v1 explicitly states that `anomalies.sqlite` is not
canonical identity authority and that there is no authenticated SaaS admin layer.

Therefore Product Identity Resolution v1 uses this split:

```text
anomalies.sqlite / future UI
  -> observation + workflow + proposal only

reviewed resolution registry
  -> durable identity authority
  -> versioned/reviewed artifact
  -> digest-bound into IdentityStore config_state
  -> digest included in future D2b signed publication binding
```

The machine-readable registry path for the first implementation is reserved as:

`config/catalog-identity/resolutions.yaml`

This PR does not create or activate that registry.

Before any approved resolution can affect canonical output:
- its exact raw-byte SHA-256 must be recorded via
  `IdentityStore.setConfigHash('catalog-identity-resolutions-v1', sha256)`;
- the digest must participate in the publication dependency fingerprint;
- D2b must bind that digest into signed FULL publication authority;
- normal identity backup/recovery requirements continue to cover
  `identity.sqlite`.

`anomalies.sqlite` may store proposals, comments and workflow state, but an
approval stored only there must never change canonical identity or publication.

### Authorization boundary

No authenticated administrator API exists yet.

Until a separately reviewed authentication/authorization slice exists:
- Requires Attention UI is read/propose only;
- `approved_by` text from an unauthenticated caller is not authority;
- approval becomes authoritative only through the reviewed resolution registry
  change and its reviewed Git history.

A future authenticated UI may replace Git as the human interaction surface only
if it writes the same versioned, auditable, digest-bound authority semantics.

## Approval binding and stale behavior

An approval is valid only for the exact evidence it reviewed.

Every resolution record must bind at minimum:
- resolution schema/version and resolution ID;
- incident fingerprint;
- provider and source epoch;
- detector namespace/version;
- exact detector `material_evidence_sha256`;
- exact sorted collider/source-entity set;
- immutable detector evidence snapshot or canonical digest;
- `resolution_subject_digest` over the complete reviewed source-product/variant
  topology used by the action plan;
- exact sorted subject product IDs and source variant IDs;
- canonical digest of supplemental reviewed evidence;
- identity decision;
- root causes;
- identifier exception;
- variant alignment when required;
- ordered action plan;
- reviewed source / reviewer provenance and approval timestamp.

Supplemental operator, external or human evidence belongs to the resolution evidence
bundle. It must **not** mutate the frozen anomaly fingerprint or detector
`material_evidence_sha256` merely because a reviewer added context.

A materially different supplemental evidence bundle requires a new/superseding
reviewed resolution rather than rewriting the evidence behind an existing approval.

The anomaly fingerprint intentionally excludes the collider set, so fingerprint
equality alone can never authorize reuse of a resolution.

Before applying an approved resolution, the current authoritative source state must
match:
- the stored detector material evidence hash;
- the exact collider set;
- the exact reviewed subject product/variant set and `resolution_subject_digest`.

The subject digest must cover identity-relevant structural facts needed by the
approved action plan, including complete source variant membership/alignment. It
must not be driven by routine volatile price/title changes unless a specific
commercial/content action declares those values as its own precondition.

If any required authority/subject binding changes:
- effective resolution state becomes `STALE`;
- do not apply the old resolution;
- do not silently fall back to a weaker behavior;
- fail closed with a hard publication blocker for that reviewed resolution until
  it is re-reviewed or revoked.

This mirrors the existing stale-approved-mapping safety rule.

The frozen anomaly `review_state` is not silently rewritten by evidence drift.
A previously `RESOLVED` review may coexist with effective resolution `STALE`;
the UI must surface that contradiction and require explicit reopen/re-review.

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

Future vocabulary may include:
- `NONE`;
- `SHARED_IDENTIFIER_APPROVED`.

However, `SHARED_IDENTIFIER_APPROVED` is **non-executable in v1**.

Current `IdentityStore` enforces global `UNIQUE(variants.sku_key)`, so two
distinct canonical variants cannot intentionally publish the same normalized
canonical SKU.

For v1, confirmed distinct physical products that collide on canonical SKU must:
- remain separate identities;
- use `REQUIRE_SOURCE_CORRECTION`;
- remain unpublished/quarantined until unique canonical SKU identity is reviewed.

A future shared-identifier design would require an explicit identity/schema
contract change and cannot be smuggled in as an exception flag.

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


## Variant-level resolution subject

The reviewed subject is the exact set of **source variant identities**, not only
the containing product IDs.

This is required because the current collision detector and IdentityStore both
operate at variant granularity, and most historical collisions are within-product
variant conflicts.

For a product-level SAME_PHYSICAL_PRODUCT decision, the resolution must include a
complete `variant_alignment`.

A safe representation is a set of canonical candidate groups:

```text
group A -> source variant p1/v1 + source variant p2/v9
group B -> source variant p1/v2
group C -> source variant p2/v10
```

Rules:
- every currently affected source variant appears exactly once;
- a group with multiple members asserts SAME_VARIANT for those members;
- a singleton group preserves a source-only/distinct variant;
- no variant disappears merely because its containing products are merged;
- variant-defining attributes override product-level similarity;
- conflicting variant evidence blocks approval.

For apparel/size/color and similar families, product-level manufacturer identity
does not collapse variant distinctions. Merchant/channel variant IDs and
`item_group_id` grouping are downstream representations of this distinction, not
a substitute for the alignment review.

### Canonical SKU choice

Each proposed canonical variant group must explicitly state the canonical SKU
authority.

Allowed v1 directions:
- preserve an already-bound BabyPark canonical SKU;
- use a reviewed manufacturer article/MPN when its identifier scope is confirmed;
- use a separately assigned BabyPark canonical SKU under a reviewed source rule.

A supplier-only SKU must never become `variants.sku_key` merely because two
supplier rows normalize to the same text.

If source variants cannot be safely bound to one reviewed canonical SKU under the
current IdentityStore contract, the action remains non-executable and requires
source correction or a later identity-schema slice.

## Action axis

The approved identity decision must not be overloaded with migration action.

Initial action vocabulary:
- `NO_ACTION`;
- `BIND_TO_CANONICAL_PRODUCT`;
- `MERGE_SOURCE_RECORDS`;
- `CREATE_OR_BIND_SUPPLIER_OFFERS`;
- `MERGE_CATEGORY_ASSIGNMENTS`;
- `MERGE_CONTENT_FIELDS`;
- `RESOLVE_CUSTOMER_OFFER`;
- `CAPTURE_AND_REDIRECT_LEGACY_URLS`;
- `KEEP_DISTINCT`;
- `EXCLUDE_LEGACY_RECORD`;
- `REQUIRE_SOURCE_CORRECTION`;
- `MANUAL_MIGRATION_PLAN`.

A resolution may require several ordered actions.

### Validity matrix

Independent storage does not mean every combination is valid.

`UNDECIDED`:
- may use `NO_ACTION` / `MANUAL_MIGRATION_PLAN`;
- must remain quarantined;
- may not merge, bind or exclude a source record as a permanent identity action.

`SAME_PHYSICAL_PRODUCT`:
- requires complete source-variant alignment;
- may bind/merge only when current IdentityStore topology permits it;
- conflicting commercial facts require `RESOLVE_CUSTOMER_OFFER` before a
  customer offer is published.

`DISTINCT_PHYSICAL_PRODUCTS`:
- may `KEEP_DISTINCT`;
- a colliding canonical SKU requires `REQUIRE_SOURCE_CORRECTION`;
- v1 cannot use shared canonical `sku_key` as an executable exception.

`EXCLUDE_LEGACY_RECORD` is allowed only when reviewed evidence proves the record
is a disposable migration artifact and no unique product/variant/category/content/
URL/supplier fact is lost. It is forbidden for `UNDECIDED`.

### Action contract

Every approved action must declare:
- executor/owning subsystem;
- preconditions;
- exact affected source/canonical entities;
- expected postcondition;
- verification method;
- whether the action is executable in the current platform version.

Examples:
- Drupal source mutation is not executable because the exporter is read-only;
- supplier-offer creation is not executable until a supplier-offer schema exists;
- URL redirect is not executable unless all legacy URLs to preserve were captured
  in the reviewed evidence/action payload;
- customer-offer publication is not executable when price authority conflicts and
  no reviewed pricing policy has selected the trusted offer.

Identity approval may therefore be complete while the product remains quarantined
because its action plan is not yet executable.

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

For Adobe Commerce, category-path product URLs and canonical tags are configurable.

BabyPark's target policy is one stable product-centric canonical URL per canonical
product, with category assignments remaining separate. If category-path URLs are
enabled for navigation, the BabyPark SEO policy still points canonical product
metadata to the stable product-centric URL.

## Canonical product and supplier offers

One confirmed physical product/variant may have many supplier offers.

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

Supplier SKU is supplier-scoped evidence and lookup metadata. It is not written to
`variants.sku_key` unless a separate reviewed decision establishes that the same
value is BabyPark's canonical/manufacturer-facing SKU rather than supplier-only
identity.

The current Drupal exporter does not yet provide a normalized supplier-offer
contract. Therefore a Bugaboo resolution may approve the identity model while
`CREATE_OR_BIND_SUPPLIER_OFFERS` remains non-executable.

The supplier layer is primarily a BabyPark SaaS / 1C concern.

A supplier should become an Adobe Commerce inventory Source only when that source
represents actual inventory/fulfillment semantics such as a warehouse, shop or
drop-ship location. Merely buying from a supplier is insufficient.

## Customer offer and fulfillment selection

Customer-facing AI consumes a consolidated customer offer for the canonical
product/variant, not raw supplier rows.

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

"Cheapest supplier wins" is not a sufficient universal rule.

"Cheapest duplicate product wins" is forbidden as an identity rule.

When source cards proposed for merge have conflicting prices or availability,
identity approval does not choose commercial truth.

Until a reviewed pricing/customer-offer policy has an authoritative input:
- the merged customer offer is not published from an arbitrary source row;
- `RESOLVE_CUSTOMER_OFFER` remains pending;
- identity may be approved while publication remains quarantined.

This applies directly to the current Bugaboo evidence, where the two legacy cards
carry conflicting commercial facts.

AI may rank different canonical products by customer-visible price only after
identity and customer-offer authority are resolved.

## Merchant/channel identity

The same canonical **variant/item** should have a stable channel item identity.

Manufacturer identifiers preserve manufacturer meaning:
- GTIN identifies the manufacturer-defined trade item;
- Brand + MPN identifies the manufacturer product/variant when GTIN is unavailable;
- supplier SKU remains supplier-scoped;
- BabyPark/channel item ID remains stable for the same item.

Google Merchant Center `id` is item/variant-level. Related variants have unique
`id` values and may share `item_group_id`.

Do not manufacture distinct Merchant Center items by changing only letter case.

If the same physical product/variant is sold through multiple BabyPark supply
sources, the channel normally receives one customer-facing item/offer identity,
not one item per internal supplier.

Marketplace seller/listing models may legitimately require separate channel
listings. That is a channel-boundary rule and must not leak backward into
BabyPark canonical identity.

## Relationship to existing anomaly incident state

Product identity resolution does not replace the frozen anomaly incident axes.

Existing machine-owned observation state remains:
- `OBSERVED`;
- `NOT_OBSERVED`;
- `CLEARED`.

Existing human workflow review state remains:
- `NEW`;
- `ACKNOWLEDGED`;
- `INVESTIGATING`;
- `PENDING_ADMIN`;
- `RESOLVED`.

The reviewed resolution has its own effective status:
- `PROPOSED`;
- `APPROVED`;
- `STALE`;
- `APPLIED`;
- `SUPERSEDED`.

`review_state=RESOLVED` means human review produced an approved resolution for the
then-current evidence. It does not mean the anomaly disappeared and does not mean
all actions were applied.

A source correction may clear an observation without creating a permanent identity
rule. Conversely, an approved identity decision may remain durable after the
specific source anomaly disappears.

Evidence drift can make the effective resolution `STALE` without silently changing
the frozen anomaly review state.

## Current IdentityStore boundary

Product Identity Resolution v1 is constrained by the **actual** IdentityStore
implementation.

Current facts:
- `source_products(provider, native_product_id)` cannot be rebound to another
  canonical product once bound;
- `source_variants(provider, native_variant_id)` cannot be rebound to another
  canonical variant/product once bound;
- `variants.sku_key` is globally UNIQUE;
- there is no merge, unbind or split operation;
- reviewed SKU rename/alias exists, but it does not merge canonical identities.

Therefore executable v1 resolution is limited to:
- pre-first-publication cases; or
- cases where at most one side already owns the intended canonical identity and
  every other source identity is still unbound.

A new many-to-one source binding must reference the approved resolution ID and may
use existing explicit `ensureProduct({ productId })` / matching-variant behavior
only when no conflicting xref already exists.

If two affected source entities are already bound to different canonical
identities:
- do not rebind;
- do not tombstone one as a fake merge;
- return a hard `RESOLUTION_REBIND_UNSUPPORTED_V1` boundary;
- require a separately reviewed merge/split/rebind design.

### Rollback semantics

v1 does not promise reversible canonical merges that the IdentityStore cannot do.

Before application, an approved registry record may be superseded/revoked by a
reviewed registry change.

After an identity mutation is applied:
- automatic unbind/rebind rollback is unsupported;
- correction requires a separately designed migration/split operation.

This limitation must be visible in Requires Attention before approval.

## Future application order

The reviewed resolution registry is evaluated before residual anomaly quarantine
changes canonical output.

Conceptually:

```text
build source candidates
  -> collect deterministic collision/evidence snapshot
  -> match reviewed resolution by exact fingerprint + evidence/subject binding
       -> stale reviewed resolution: hard publication blocker
       -> applicable + executable resolution: apply reviewed identity/action step
       -> approved but non-executable: do not mutate identity; leave residual unsafe scope
       -> no approved resolution: leave residual unsafe scope
  -> recompute residual collisions
  -> residual collisions become anomaly observations/quarantine
  -> canonical-validate/chunk unaffected products
```

A detector snapshot may be used to validate resolution authority, but an
applicable/executed reviewed resolution should not continue generating the same
residual anomaly merely because the pre-resolution detector saw it.

Approved but non-executable resolutions remain visible workflow facts and keep
their affected entities quarantined; they do not pretend the canonical change
already happened.

This application stage is future implementation. It does not change the frozen
Catalog Anomaly Runtime v1 contract or PR #26 behavior.

## Requires Attention workflow v1

The first UI may be an incident detail screen, not a generic log.

Until authenticated admin authorization exists, this UI is **read/propose only**.
It must not turn a browser button into durable identity authority.

Production persistence is a separate gate. Before valuable proposals/comments are
written to production `anomalies.sqlite`, the already-required anomaly
backup/restore slice must be implemented. Until then, the workflow may be proven
from signed/report evidence and local/test state, while durable approved authority
remains the reviewed registry.

Minimum sections:

### Header
- incident fingerprint / anomaly type;
- observation state;
- review state;
- effective resolution status;
- first/last seen and recurrence;
- affected source records/variants;
- current quarantine/publication impact.

### Evidence
Side-by-side source records with:
- provider/source IDs;
- exact collider/source-variant set;
- material evidence hash;
- raw and normalized identifiers;
- identifier scope and provenance;
- GTIN;
- Brand + MPN/article;
- variant attributes;
- supplier;
- title;
- price and availability;
- categories;
- legacy/current URLs;
- image/content similarity evidence;
- provenance and observation timestamps;
- explicit conflicting-evidence indicators.

### Proposal
AI/operator may propose:
- identity decision;
- root-cause classification;
- identifier exception;
- complete variant alignment;
- ordered actions;
- concise rationale and missing/conflicting evidence.

AI proposal must be visibly marked as a proposal, not authority.

### Review controls

Before an auth slice, operator UI may:
- acknowledge;
- assign;
- add evidence/comments;
- request source correction;
- prepare a proposed resolution artifact.

It may not approve canonical identity.

Authoritative approval in v1 is the separately reviewed resolution-registry
change described above.

Future authenticated administrator UI may:
- approve/reject the proposal;
- modify the structured decision;
- approve durable identity binding/exception;
- approve the ordered migration/publication actions;
- supersede/reopen a prior reviewed resolution.

The authority record must preserve:
- reviewer provenance;
- timestamp;
- exact evidence hash and collider set;
- decision values;
- variant alignment;
- resulting action plan;
- registry revision/digest;
- durable identity/config binding reference.

A UI label such as "Approve" is not sufficient unless the authentication,
authorization and digest-bound authority path are implemented.

## AI consumption rule

Customer-facing AI consumes canonical product facts only when the relevant identity
resolution is applicable and its required publication actions are `APPLIED`.

An `APPROVED` but unapplied or non-executable resolution is internal workflow
context, not a customer-facing product fact.

Seller-assist AI may see that reviewed context to help a human investigate, but
must label it as pending and must not present quarantined identity/commercial data
as authoritative catalog truth.

`STALE`, `PROPOSED`, or unreviewed `NEW` / `ACKNOWLEDGED` /
`INVESTIGATING` / `PENDING_ADMIN` states are never identity truth for AI.

Prompt engineering is not the identity database.

Reviewed decisions may later become deterministic prevention rules, but the LLM
must not autonomously rewrite global policy from incident history.

## Learn/prevent boundary

A reviewed incident may justify a versioned deterministic prevention rule.

In v1, prevention rules may only make the system stricter or earlier: detect a
known bad shape, require identifier provenance, quarantine unsafe entities, reject
stale reviewed authority, require human review, or improve evidence collection.

A prevention rule must never auto-approve `SAME_PHYSICAL_PRODUCT`,
`DISTINCT_PHYSICAL_PRODUCTS`, a new canonical binding or an identifier exception
for a future incident. AI-generated proposals are not fed back as identity evidence
merely because the model proposed them before.

## Acceptance case A — Joolz `511000`

Current source evidence:
- product `79252`: RU+UK, richer content/images, live;
- product `139026`: newer UK-only card, correct Accessories category, live;
- same normalized article;
- equal observed price is context only, not identity evidence;
- existing review currently describes the cards as the same physical adapter,
  but that statement still requires reviewed resolution authority.

Expected v1 workflow:

1. Incident remains observable/quarantined until reviewed resolution and executable
   actions exist.
2. AI/operator may propose:
   - identity: `SAME_PHYSICAL_PRODUCT`;
   - root cause: `LEGACY_DUPLICATE_CARD` + `CATEGORY_SPLIT_DUPLICATE`;
   - complete variant alignment;
   - actions such as:
     `BIND_TO_CANONICAL_PRODUCT`,
     `MERGE_CONTENT_FIELDS`,
     `MERGE_CATEGORY_ASSIGNMENTS`,
     `CAPTURE_AND_REDIRECT_LEGACY_URLS`.
3. Reviewer sees that choosing one legacy row must not discard the correct category,
   richer content, variants or legacy URLs from the other row.
4. Approval binds the exact evidence/collider set; it does not itself execute a
   merge.
5. Application is allowed only while IdentityStore topology is v1-compatible.
6. Category assignment remains independent of product identity.
7. AI recommendations use the eventual canonical product URL; category links may
   be offered separately for navigation.

This fixture tests the workflow and lossless action plan. It does not make
SAME_PHYSICAL_PRODUCT true merely because both rows share article/title/price or
because one has the better category.

## Acceptance case B — Bugaboo `80401mc02`

Business evidence supplied by the BabyPark content manager on 2026-09-28:
- the two Drupal cards originated from different suppliers;
- their source articles differ only by letter case;
- legacy 1C treated those strings as different articles;
- two customer-facing cards resulted.

This business statement is provenance-tagged `HUMAN_CONFIRMED` evidence from the
content owner; it is not independently proven by the current exporter schema.

Expected v1 workflow:

1. Incident remains observable/quarantined until manufacturer and variant identity
   are reviewed.
2. Resolver collects:
   - scoped source/supplier identifiers;
   - Brand + manufacturer MPN/article;
   - GTIN where available;
   - complete variant-defining attributes;
   - supplier identity and source provenance.
3. Case-only similarity produces a candidate, never automatic SAME.
4. If reviewer confirms one physical product/variant set:
   - identity: `SAME_PHYSICAL_PRODUCT`;
   - complete variant alignment is mandatory;
   - root cause may include
     `MULTIPLE_SUPPLIERS` + `CASE_VARIANT_SOURCE_SKU`;
   - actions may include
     `BIND_TO_CANONICAL_PRODUCT`,
     `CREATE_OR_BIND_SUPPLIER_OFFERS`,
     `MERGE_SOURCE_RECORDS`,
     `RESOLVE_CUSTOMER_OFFER`,
     `REQUIRE_SOURCE_CORRECTION`.
5. Raw supplier SKU values stay supplier-scoped; they do not automatically become
   canonical `variants.sku_key`.
6. The current conflicting prices are not resolved by freshness, lower price or AI.
   Until pricing authority exists, customer-offer publication stays pending.
7. Supplier-offer creation remains non-executable until its schema/FULL contract
   is separately designed.
8. Merchant/channel output ultimately uses stable item/variant identity rather
   than one item per BabyPark supplier, unless a reviewed channel model requires
   separate seller/listing identities.

This fixture tests supplier-scope and case-normalization handling without assuming
that case-only equality proves physical identity.

## Definition of done for the first implementation slice

The first implementation after design review is successful when:

- the two existing anomaly incidents can be represented without changing the
  frozen anomaly fingerprint contract;
- proposals are stored outside canonical authority;
- an approved resolution registry has a strict schema and raw-byte digest;
- the registry digest is bound through IdentityStore `config_state` before any
  resolution affects canonical output;
- every approval is bound to exact material evidence hash and collider set;
- material evidence drift makes the resolution `STALE` and hard-blocking;
- identity decision, root cause, identifier exception and action plan are separate;
- product-level SAME requires complete variant alignment;
- action combinations are validated against the decision matrix;
- unsupported rebind/merge topology fails closed against the real IdentityStore;
- UI is read/propose only until authenticated authorization exists;
- Joolz can express lossless content/category/URL merge intent without a blind
  `exclude_product`;
- Bugaboo can express candidate same-product/multiple-supplier intent without
  turning supplier SKU or conflicting price into canonical truth;
- unresolved or non-executable cases remain safely quarantined;
- approved registry decisions are auditable and can be superseded before apply;
- no automated unbind/rebind rollback is promised after identity mutation;
- no customer-facing AI consumes unresolved/stale identity as fact;
- prevention rules may tighten detection/quarantine/validation but never
  auto-approve a future identity merge.

The first implementation does not need a complete generic PIM UI.
A narrow read/propose Requires Attention view plus reviewed registry workflow for
these two acceptance cases is sufficient to prove the model.

## Explicit non-goals

This v1 design does not yet define:
- an authenticated administrator mutation API;
- canonical merge/rebind/unbind/split operations;
- rollback of an already-applied identity binding;
- executable shared canonical `sku_key` across distinct variants;
- final supplier-offer schema or FULL contract;
- automatic SAME/DIFFERENT confidence thresholds;
- full supplier procurement optimization;
- Adobe Commerce source assignment policy for every supplier;
- Product Presentation Projection;
- marketplace-specific listing identity;
- automatic global-rule promotion.

This design also does not authorize:
- production anomaly-store wiring;
- permanent legacy mappings for `511000` or `80401mc02`;
- customer-facing AI;
- D2b implementation;
- first production FULL.

The operational exporter deploy/preflight and D2b design are independent safety
work and do not wait for implementation of this UI/design. The two anomaly cases
remain useful fixtures while quarantined.

## External standards checked — 2026-09-28

Google Merchant Center:
- `id` is unique per item/variant and Google warns not to use casing merely to
  make IDs unique:
  https://support.google.com/merchants/answer/6324405
- related variants use unique `id` values and may share `item_group_id`:
  https://support.google.com/merchants/answer/6324507
- duplicate GTIN can mean duplicate product data or incorrect identifier reuse,
  and variant distinctions/condition/multipack matter:
  https://support.google.com/merchants/answer/12470642
- duplicate identifiers can mean duplicate products or the same identity applied
  to different products:
  https://support.google.com/merchants/answer/15094056
- manufacturer UPIs are shared across retailers selling the same product:
  https://support.google.com/merchants/answer/160161

Adobe Commerce:
- products may be assigned to zero or more categories:
  https://experienceleague.adobe.com/en/docs/commerce-admin/catalog/categories/categories
- category paths in product URLs are configurable; canonical product tags are
  configurable and BabyPark chooses a stable product-centric canonical URL policy:
  https://experienceleague.adobe.com/en/docs/commerce-admin/catalog/catalog/catalog-urls
  https://experienceleague.adobe.com/en/docs/commerce-admin/marketing/seo/meta-data
- Inventory Sources represent inventory/fulfillment locations and source selection
  recommends shipment sources:
  https://experienceleague.adobe.com/en/docs/commerce-admin/catalog/products/settings/sources
  https://experienceleague.adobe.com/en/docs/commerce-admin/inventory/basics/selection-reservations

These external rules constrain channel/presentation behavior but do not replace
BabyPark's reviewed canonical identity authority.
