# Drupal Legacy Collision Review — 2026-09-27

Status: 21 APPROVED LEGACY MIGRATION MAPPINGS / 2 BUSINESS DECISIONS PENDING
Last verified: 2026-09-28
Owner: BabyPark
Repository main at review handoff: `583bfb5bd22df15c76c477a751b224c656dcc8d6`

Related:
- `docs/CATALOG_IDENTITY.md`
- `docs/CATALOG_IDENTITY_ANOMALY_MANAGEMENT.md`
- `docs/DRUPAL_EXPORT_D2A.md`
- `config/drupal/legacy-sku-collisions.yaml`

## Purpose

This document is the durable evidence ledger for the historical Drupal SKU
collisions discovered by the production D2a.1 preflight.

It preserves the investigation even after temporary server scratch files are
deleted.

The 21 technically evidenced decisions below are approved as legacy migration
exceptions and are represented in `config/drupal/legacy-sku-collisions.yaml`.
Their production deployment is still a separate controlled release step.

The two unresolved identifiers `511000` and `80401mc02` are intentionally absent
from the mapping config and remain subject to Catalog Anomaly Runtime v1 quarantine
until a separate business/source-process decision is reviewed.

These decisions are legacy migration exceptions. They must not be generalized
into Magento, supplier, marketplace or AI identity policy. Durable provider-neutral
architecture is defined in `docs/CATALOG_IDENTITY_ANOMALY_MANAGEMENT.md`.

## Production evidence

Second production preflight on 2026-09-27:

- 43 blocker rows;
- 3 `SKU_COLLISION_CROSS_PRODUCT`;
- 20 `SKU_COLLISION_WITHIN_PRODUCT`;
- 20 secondary `FULL_RECORD_INVALID` duplicate-SKU diagnostics for the same
  within-product collisions;
- therefore 23 unique identity decisions;
- 78 non-blocking warnings;
- no FULL;
- no Catalog HTTP;
- no Drupal writes;
- no `.ready` spool.

The merged default-promotion safety fix ensures that a reviewed
`exclude_variant` mapping can retain/promote the explicitly reviewed variant when
the excluded collider was the old default. It does not choose by price, status or
row order.

## Evidence classification

`SAFE_TO_MAP` in this document means there is sufficient technical evidence for a
legacy migration decision. For the 21 decisions listed below, BabyPark approved
activation in the repository mapping set on 2026-09-28. This approval remains
limited to Drupal legacy migration and is not a universal identity rule.

Evidence used includes:
- production preflight/source semantics;
- exact Drupal adjustment identity;
- exact raw SKU bytes;
- current BabyPark storefront identity;
- manufacturer/GTIN identity where independently corroborated;
- content/image equivalence for historical split cards.

### 2026-09-28 production recheck of default-fallback decisions

A read-only query through the dedicated `babypark_exporter` SELECT-only database
principal reverified the six decisions whose ledger evidence was previously
descriptive rather than option-ID-specific.

| SKU key | Product | Retain option | Exclude/default option | Production evidence |
|---|---:|---:|---:|---|
| `106-2.45.44` | `67463` | `19792` | `19789` | default=19789; retain adjustment model `106-2.45.44`; weights 1 vs 3 |
| `154.6.01ver` | `39988` | `25587` | `12377` | default=12377; retain adjustment model `154.6.01ver`; weights 1 vs 3 |
| `1801blbf01` | `42887` | `9795` | `9796` | default=9796; retain adjustment model `1801BLBF01`; weights 1 vs 3 |
| `216.04.7ver` | `38223` | `20655` | `17828` | default=17828; retain adjustment model `216.04.7ver`; weights 1 vs 3 |
| `23241eu4ep` | `62506` | `20157` | `20022` | default=20022; retain adjustment model `23241EU4ep`; weights 1 vs 3 |
| `o3sumc` | `77502` | `31713` | `31539` | default=31539; retain adjustment model `O3SUMC`; weights 1 vs 3 |

For all six rows, the excluded/default option has no corresponding
`uc_product_adjustments` row for the colliding SKU. This confirms the mapped
direction without relying on numeric option-ID ordering.

## 21 technically evidenced decisions

| Type | SKU key | Product | Action | Retain | Exclude | Evidence basis |
|---|---|---:|---|---|---|---|
| cross_product | `1003ig` | — | `exclude_product` | `55677` | `55682` | Old group 55682 is subsumed by group 55677: SKU 1003ig already exists as a structural option in retained group; RU/UK summaries match; all three old images are byte-identical SHA-256 matches inside retained group; same brand/category family; old group last changed 2018 vs retained 2024. |
| within_product | `106-2.45.44` | `67463` | `exclude_variant` | `67463\|opts:255=19792` | `67463\|opts:255=19789` | Sole IN_STOCK collider is a real adjustment-row variant updated by legacy 1C sync; the colliding OUT_OF_STOCK variant is synthesized default fallback with no adjustment row. Retain explicit current adjustment and promote it to default via reviewed mapping. |
| within_product | `11009873-blackcabfpar` | `133434` | `exclude_variant` | `133434\|opts:47=33395` | `133434\|opts:47=33401` | Current BabyPark storefront shows article 11009873-BlackCabFpar as Fresh Black Cab, black; this is option 33395. Both Drupal colliders are IN_STOCK, so storefront identity is the deciding evidence. |
| within_product | `1412/03bo` | `80520` | `exclude_variant` | `80520\|opts:306=26041` | `80520\|opts:306=26040` | Current BabyPark storefront shows article 1412/03bo as Minky-koala at 389 UAH; this matches option 26041 and its trusted price 38900. |
| within_product | `154.6.01ver` | `39988` | `exclude_variant` | `39988\|opts:255=25587` | `39988\|opts:255=12377` | Sole IN_STOCK collider is a real adjustment-row variant updated by legacy 1C sync; the colliding OUT_OF_STOCK variant is synthesized default fallback with no adjustment row. Retain explicit current adjustment and promote it to default via reviewed mapping. |
| within_product | `1801blbf01` | `42887` | `exclude_variant` | `42887\|opts:14=9795` | `42887\|opts:14=9796` | Sole IN_STOCK collider is a real adjustment-row variant updated by legacy 1C sync; the colliding OUT_OF_STOCK variant is synthesized default fallback with no adjustment row. Retain explicit current adjustment and promote it to default via reviewed mapping. |
| within_product | `216.04.7ver` | `38223` | `exclude_variant` | `38223\|opts:255=20655` | `38223\|opts:255=17828` | Sole IN_STOCK collider is a real adjustment-row variant updated by legacy 1C sync; the colliding OUT_OF_STOCK variant is synthesized default fallback with no adjustment row. Retain explicit current adjustment and promote it to default via reviewed mapping. |
| within_product | `23241eu4ep` | `62506` | `exclude_variant` | `62506\|opts:530=20157` | `62506\|opts:530=20022` | Sole IN_STOCK collider is a real adjustment-row variant updated by legacy 1C sync; the colliding OUT_OF_STOCK variant is synthesized default fallback with no adjustment row. Retain explicit current adjustment and promote it to default via reviewed mapping. |
| within_product | `25199` | `16553` | `exclude_variant` | `16553\|opts:118=2060` | `16553\|opts:118=2059` | External catalog identifies Eurasia SKU 25199 as Winnie the Pooh neck pillow, matching option 2060; Cars option 2059 conflicts with that exact SKU identity. |
| within_product | `2822827000` | `48595` | `exclude_variant` | `48595\|opts:351=27077` | `48595\|opts:351=13366` | External retailer identifies manufacturer code 2822827000 as Safety 1st Koala Red Campus, matching option 27077; Grey Patch option 13366 conflicts with exact code identity. |
| within_product | `3110iti` | `16680` | `exclude_variant` | `16680\|opts:132=2036` | `16680\|opts:132=2035` | Raw adjustment model 3110iti maps to option 2036 (7 items) in both RU nid 16680 and UK nid 18160; option 2035 is the synthesized default fallback. |
| within_product | `391589` | `39002` | `exclude_variant` | `39002\|opts:344=16159` | `39002\|opts:344=9779` | Raw adjustment model 391589 maps to option 16159 (Sheep) in RU/UK; BabyFehn EAN 4001998391589 / 391589 identity also corresponds to the sheep hot/cold compress. |
| within_product | `80210zw01` | `12871` | `exclude_variant` | `12871\|opts:14=2572` | `12871\|opts:14=2571` | Raw adjustment model 80210ZW01 maps to option 2572 (Brown fabric) in both RU nid 12871 and UK nid 17471; option 2571 is synthesized fallback. |
| within_product | `8710103876397` | `114708` | `exclude_variant` | `114708\|opts:380=12398` | `114708\|opts:380=28097` | GTIN/EAN 8710103876397 is independently identified as Philips Avent Natural 260 ml, matching option 12398; 125 ml option 28097 is a different product size. |
| within_product | `ab10256-ws/18f` | `61907` | `exclude_variant` | `61907\|opts:529=21616` | `61907\|opts:529=25900` | Current BabyPark storefront shows article AB10256-WS/18F for Morgenroth Frog; indexed product identity specifies 28 cm, matching option 21616 rather than the sitting-with-heart 29 cm fallback. |
| within_product | `abx20408/58sk` | `71198` | `exclude_variant` | `71198\|opts:529=25894` | `71198\|opts:529=25893` | Current BabyPark HTML identifies ABX20408/58SK as the floral-shirt 'Для тебя' 56/77 cm variant, matching option 25894. |
| within_product | `evo19brgrs` | `21136` | `exclude_variant` | `21136\|opts:26=24401` | `21136\|opts:26=25350` | Option 24401 owns exact raw EVO19BRGRS (length 10); markdown Graphite option 25350 owns EVO19BRGRS plus trailing ASCII space (length 11, hex suffix 20). normalizeSku collapses that legacy whitespace error. |
| within_product | `m008071` | `49533` | `exclude_variant` | `49533\|opts:375=11561` | `49533\|opts:375=11565` | External catalog maps m008071 to Mariposa De Luxe Tencel Natural Life Cream V3 (option 11561); White V1 has a distinct SKU m011684, so option 11565 must not own m008071. |
| within_product | `nio19grgrs` | `70541` | `exclude_variant` | `70541\|opts:26=24548` | `70541\|opts:26=5504` | External product page maps NIO19GRGRS to Mutsy NIO Standard - Grey Grip, matching option 24548. Current BabyPark page also exposes article NIO19GRGRS. |
| within_product | `o3sumc` | `77502` | `exclude_variant` | `77502\|opts:452=31713` | `77502\|opts:452=31539` | Sole IN_STOCK collider is a real adjustment-row variant updated by legacy 1C sync; the colliding OUT_OF_STOCK variant is synthesized default fallback with no adjustment row. Retain explicit current adjustment and promote it to default via reviewed mapping. |
| within_product | `wk21-h27-003` | `38178` | `exclude_variant` | `38178\|opts:249=21060` | `38178\|opts:249=9423` | Multiple external listings identify WK21-H27-003 as WonderKids Voyager graphite, matching option 21060; green/orange option 9423 conflicts with exact SKU identity. |

## Two business/source-process decisions intentionally pending

### SKU `511000` — Joolz Day2/Day3/Day+ Maxi-Cosi adapter

Source card `79252`:
- RU+UK product group;
- 3 images;
- current observed price 1999;
- status IN_STOCK;
- live RU page;
- no current catalog category membership found during review.

Source card `139026`:
- newer UK-only group;
- 1 image;
- current observed price 1999;
- status IN_STOCK;
- correct Accessories category and newer UK URL.

Current review hypothesis: the cards appear to describe the same physical adapter,
but that identity decision is **not approved**.

Equal price is volatile commercial context, not identity evidence.

A plain `exclude_product` would discard useful data from one side and is no longer
the proposed resolution path.

This incident is the Joolz acceptance fixture for
`docs/PRODUCT_IDENTITY_RESOLUTION_V1.md`: collect scoped manufacturer/variant
evidence, review complete variant alignment, then if SAME is approved create a
lossless action plan for canonical binding, content/category merge and legacy URL
handling.

### SKU `80401mc02` — Bugaboo Cameleon3 Maxi-Cosi adapter

Source card `12605`:
- RU+UK;
- Accessories category;
- live page;
- observed price 2475;
- status IN_STOCK;
- changed 2026-09-24.

Source card `118670`:
- RU+UK;
- same category/brand;
- newer structured URL;
- live page;
- observed price 1599;
- status OUT_OF_STOCK;
- changed 2025-04-30.

The normalized SKU currently has zero stock, so stock does not distinguish identity.
Both public pages exist and commercial facts conflict.

Business evidence supplied by the BabyPark content manager on 2026-09-28:
- the two cards originated from different suppliers;
- their source articles differ only by letter case;
- legacy 1C treated those strings as different articles;
- that produced two customer-facing cards.

This is human-confirmed business provenance, not yet proof that the value is a
manufacturer MPN rather than a supplier-scoped SKU, and not yet approved proof
that all variants are the same physical item.

Price, freshness and availability must not choose a winner.

This incident is the Bugaboo acceptance fixture for
`docs/PRODUCT_IDENTITY_RESOLUTION_V1.md`: verify identifier scope and
manufacturer/variant identity first; if SAME is approved, preserve supplier-specific
raw SKUs as supplier-offer data and resolve customer-offer pricing separately.

## Remaining identity/process questions

For Joolz `511000`:
1. What historical process created the second card?
2. Do manufacturer identifiers and complete variant attributes confirm one
   physical product/variant set?
3. Which unique content/category/URL facts from each card must survive migration?

For Bugaboo `80401mc02`:
1. Is the case-variant article a manufacturer MPN/article or only a supplier-scoped
   SKU?
2. Do manufacturer identifiers and complete variant attributes confirm one
   physical product/variant set across the two supplier records?
3. Which source-system rule should prevent supplier identity from creating a
   duplicate customer-facing product in 1C/SaaS/Magento?
4. What reviewed pricing/customer-offer policy resolves the conflicting commercial
   facts if identity is confirmed SAME?

For both cases, preserve legacy URLs needed for future redirect/SEO handling.

Do not approve an `exclude_product` merely to make preflight green.

## Next step

Identity-resolution track:
1. Keep `511000` and `80401mc02` unresolved and unmapped.
2. Review/freeze `docs/PRODUCT_IDENTITY_RESOLUTION_V1.md`.
3. Use these two incidents as live acceptance fixtures; do not replace that
   workflow with a legacy retain/exclude mapping.

Operational ingestion track may proceed independently:
1. Deploy one immutable exporter release containing the merged default-promotion
   fix, Catalog Anomaly Runtime v1 and the 21 reviewed mappings.
2. Run production preflight.
3. Expected result: exactly two residual anomaly incidents (`511000`,
   `80401mc02`), four quarantined source products and zero unaccounted hard
   blockers.
4. Produce a deterministic local spool only after the preflight is clean under
   that policy.
5. Proceed to D2b / first controlled FULL only after the spool and signed binding
   design are reviewed.

The identity-resolution design is not a prerequisite for quarantined preflight or
D2b design; it is required before any durable resolution of these two incidents.

## Audit rule

If future evidence contradicts one of the 21 technically evidenced decisions,
do not silently edit the active mapping.

Reopen the review, record the new evidence, and make a reviewed configuration
change with the identity/config-hash safety process.

