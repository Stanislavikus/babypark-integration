# SYSTEM_MAP

Status: CURRENT + PLANNED
Last verified: 2026-09-27
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

Future Magento replaces only the catalog source/provider side; CatalogService, AI tools and Chatwoot flow stay stable.

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
