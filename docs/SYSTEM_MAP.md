# SYSTEM_MAP

Status: CURRENT + PLANNED
Last verified: 2026-10-01
Owner: BabyPark

## Current

```text
Viber customer
  -> Viber API
  -> https://chat.babypark.ua/api/viber/webhook
  -> Nginx
  -> babypark-integration.service
  -> Chatwoot API Inbox
  -> sellers

Seller outgoing message
  -> Chatwoot Channel::Api signed callback
  -> https://chat.babypark.ua/api/chatwoot/viber
  -> Nginx
  -> babypark-integration.service
  -> Viber API
```

## Planned catalog/AI boundary

```text
1C -> Drupal/Ubercart
      -> read-only outbound exporter
      -> Integration host ingest
      -> canonical identity + local catalog
      -> CatalogService
      -> seller copilot
      -> Chatwoot private note
```

If Magento later becomes the catalog source, it replaces only the source/provider side;
CatalogService, AI tools and the Chatwoot flow remain stable. This is an allowed future
source role, not a committed migration design or a requirement to build a Magento source
adapter now.

## Source/provider seam and controlled epoch cutover

The production source profile is currently Drupal/Ubercart with source epoch
`drupal-prod-v1`.

The current production admission code intentionally supports the exact reviewed Drupal
profile (`bp.drupal-exporter.spool/3`, `bp.drupal.native-identity/1` and the reviewed
Drupal behavior-config authority). These values are **capability gates**, not free-form
operator configuration. A future source profile requires reviewed code, tests,
certification and deployment proving that the receiver understands that profile; changing
an environment/config value alone must never make an unknown source profile acceptable.

**Role over brand:** classify an integration by the role it plays. A commerce platform
used as a downstream target/channel is not part of the Catalog source boundary. The same
platform may later act as a SOURCE only through a separately reviewed source-ingestion
profile. Provider-specific IDs, fields and business semantics must not become canonical
Catalog semantics.

A transition from one accepted `source_epoch` to another is a rare **controlled source
cutover**, not a normal runtime/configuration operation. The current
`INGEST_RUN_SOURCE_EPOCH_CHANGED` rejection is therefore intentional and must remain
fail-closed until a separately reviewed cutover slice exists.

Before any source-epoch cutover, that slice must define and prove at least:
- the exact new supported source profile and source-acceptance evidence;
- canonical identity continuity for products and variants;
- explicit reviewed authority for every new source identity that binds to an existing
  canonical identity;
- recovery/rollback behavior and acceptance/certification gates;
- explicit BabyPark owner authorization for the cutover.

Matching SKU/article, labels or model inference alone never authorizes cross-provider
identity continuity. `IdentityStore.ensureProduct(..., productId)` is only a low-level
binding primitive; reviewed resolution/application authority is defined by
`docs/PRODUCT_IDENTITY_RESOLUTION_V1.md` and its still-unimplemented application
prerequisites.

The current quarantined `80401mc02` incident is an independent, already-real reason to
eventually implement that reviewed identity-resolution application layer. It must not be
used as justification to weaken source-epoch protection or to invent a future provider
contract prematurely.

## Future research gate — Product Presentation Projection

Before customer-facing AI is enabled against the catalog, BabyPark must run a separate
research/design slice for a provider-neutral **Product Presentation Projection**.

The goal is not only to expose product data to the model. The projection must be designed
around the final customer/seller experience and the economics of each channel.

The research must compare current best practices for:

- compact product cards/templates that can be rendered from structured data rather than
  generated ad hoc by the LLM;
- deterministic preview-image selection from canonical media (`position`/future provider
  roles), without Drupal/Magento/Shopify knowledge inside the AI;
- title, URL, `thumbnail`, trusted price (when present), availability and other fields that
  materially improve answer usefulness;
- Web/Chatwoot, Telegram, WhatsApp, Viber and future channel-specific rendering/fallbacks;
- image-size/CDN/cache strategy so thumbnails do not create avoidable bandwidth, latency or
  origin load;
- impact of presentation on answer quality, visual comprehension and the likelihood that a
  customer opens/selects the proposed product;
- token/model cost, channel/media delivery cost, bandwidth and latency, including whether
  richer cards reduce follow-up turns enough to lower total conversation cost;
- reusable templates for common AI operations such as one-product answer, comparison,
  shortlist, alternative and related/accessory recommendation;
- observability/A-B measurement needed to evaluate usefulness, click/select rate, handoff
  rate, conversation length and cost.

Expected downstream interface is provider-neutral, conceptually:

```text
CatalogService -> Product Presentation Projection
               -> title
               -> product URL
               -> preview/thumbnail URL
               -> trusted price when available
               -> commercial availability
               -> structured presentation metadata
               -> channel renderer
               -> AI/customer or seller UI
```

This research/design gate is mandatory before customer-facing AI catalog responses are
considered production-ready.

It is deliberately **not part of D2a/D2a.1**. D2a only preserves the canonical media facts
needed later. Current canonical image `position` is the deterministic ordering primitive;
`images.role` remains provider-neutral/free-form until evidence from multiple real providers
justifies a normalized role vocabulary.


## Planned Catalog Anomaly Runtime v1

```text
source/import/snapshot
  -> deterministic validation / anomaly detection
  -> fingerprint + incident store
       -> known approved policy? -> deterministic action
       -> unknown/ambiguous?     -> quarantine smallest unsafe entity
                                 -> continue unaffected catalog
                                 -> notify responsible role
                                 -> Data Quality / Requires attention

customer/seller query
  -> CatalogService
  -> identity resolution state
       -> resolved -> normal product selection/presentation
       -> ambiguous -> safe handoff / unaffected alternatives
                    -> internal links/context for seller
                    -> same deduplicated anomaly incident

content/operator
  -> acknowledge / investigate / add evidence / fix source
  -> review_state changes only
  -> no authority to create global AI truth

administrator/reviewer
  -> approve durable same/different identity
  -> approve exception / permanent rule
  -> auditable policy version

authoritative detector snapshots
  -> observation_state=OBSERVED when present
  -> first clean complete batch -> NOT_OBSERVED
  -> clean threshold -> CLEARED
  -> recurrence -> OBSERVED again + recurrence_count
  -> review_state remains an independent axis
```

Repository navigation:
- architecture: `docs/CATALOG_IDENTITY_ANOMALY_MANAGEMENT.md`;
- identity-resolution workflow draft: `docs/PRODUCT_IDENTITY_RESOLUTION_V1.md`;
- frozen v1 implementation contract: `docs/CATALOG_ANOMALY_RUNTIME_V1.md`;
- rule/governance entry point: `config/catalog-anomalies/README.md`;
- agreed human-readable policies: `config/catalog-anomalies/POLICY_CATALOG.md`;
- current implementation state: `docs/CURRENT_STATE.md`.

Runtime incident storage/UI is not implemented yet. Git is for durable policy,
not for one file per incident.

## Future research gate — Catalog Identity & Anomaly Management

Before customer-facing AI is production-ready, BabyPark must run a dedicated
provider-neutral **Catalog Identity & Anomaly Management** research/design slice.

Durable architecture:

`docs/CATALOG_IDENTITY_ANOMALY_MANAGEMENT.md`

Required lifecycle:

```text
source / provider / supplier data
  -> identity validation
  -> detect anomaly
  -> classify
  -> safe runtime behavior
  -> anomaly incident
  -> alert / human resolution
  -> reviewed rule or source correction
  -> prevent recurrence
```

Key invariants:
- SKU/article alone is not canonical product identity;
- duplicate identifiers are not silently merged;
- cheapest-price selection is allowed only after records are confirmed to be
  the same physical product/variant;
- ambiguous identity is never resolved by the LLM;
- policy/contacts/routing live in structured configuration and later SaaS UI,
  not only in prompts;
- Chatwoot/email are notification and workflow surfaces, not the source of truth;
- current Drupal collision mappings are migration exceptions only;
- the future SaaS should expose a durable Data Quality / Requires Attention
  anomaly inbox with audit history.

This research gate is separate from, but ordered before/alongside,
**Product Presentation Projection**. Identity must be safely resolved before a
product is rendered as an AI recommendation/card.
