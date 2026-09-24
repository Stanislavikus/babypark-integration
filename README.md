# BabyPark Integration

Canonical integration source for BabyPark customer messaging, catalog synchronization and AI tooling.

## Current production scope

- self-hosted Chatwoot 4.17.1
- custom Viber ↔ Chatwoot gateway
- future read-only Drupal catalog exporter
- future local canonical CatalogService
- future seller-facing copilot

## Start here

1. `docs/CURRENT_STATE.md`
2. `docs/SYSTEM_MAP.md`
3. `legacy/current/` — exact captured production Viber implementation
4. `deploy/chatwoot-host/` — sanitized current deployment snapshots

Secrets are never committed.
