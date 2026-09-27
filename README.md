# BabyPark Integration

Canonical integration source for BabyPark customer messaging, catalog synchronization and AI tooling.

## Current production scope

- self-hosted Chatwoot 4.17.1
- custom Viber ↔ Chatwoot gateway
- deployed local canonical CatalogService (BOOTSTRAP; no FULL accepted yet)
- deployed isolated read-only Drupal catalog exporter/preflight path
- future seller-facing and customer-facing AI layers

## Start here

1. `docs/CURRENT_STATE.md`
2. `docs/SYSTEM_MAP.md`
3. `docs/CATALOG_IDENTITY.md`
4. `docs/CATALOG_IDENTITY_ANOMALY_MANAGEMENT.md` — durable identity/anomaly architecture and future research gate
5. `legacy/current/` — exact captured production Viber implementation
6. `deploy/chatwoot-host/` — sanitized current deployment snapshots

Secrets are never committed.
