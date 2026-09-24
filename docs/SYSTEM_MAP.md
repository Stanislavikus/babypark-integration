# SYSTEM_MAP

Status: CURRENT + PLANNED
Last verified: 2026-09-23
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
