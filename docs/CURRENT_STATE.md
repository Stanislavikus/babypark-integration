# CURRENT_STATE

Status: CURRENT
Last verified: 2026-09-24
Owner: BabyPark
Source of truth: production runtime + this repository

## Viber gateway

Production release:
`/opt/babypark-integration/releases/20260924-1809c564`

Current symlink:
`/opt/babypark-integration/current`

Production code:
`/opt/babypark-integration/current/src/gateway/index.mjs`

Systemd:
`babypark-integration-v2.service`

Boot state:
- v2: enabled + active
- legacy `babypark-integration.service`: disabled + inactive, retained for manual rollback

Data:
`/var/lib/babypark-integration/bridge.sqlite`

Bridge schema:
`PRAGMA user_version = 2`

Environment:
`/etc/babypark-integration.env`
(secret values are NOT in Git)

Local listener:
`127.0.0.1:3102`

Health:
`GET /health`

Public routes:
- `POST /api/viber/webhook`
- `POST /api/chatwoot/viber`

Nginx routes both public endpoints to port 3102.

Safe public-route verification on 2026-09-24:
- invalid Viber signature -> HTTP 401
- invalid Chatwoot signature -> HTTP 401

Production bridge integrity after migration:
`PRAGMA integrity_check = ok`

Current row-count baseline immediately after cutover:
- sessions: 1
- processed_viber: 1
- processed_chatwoot: 2
- outgoing_viber: 1
- session_recovery_issues: 0

## Rollback assets

Legacy runtime remains:
`/opt/babypark-integration/index.mjs`

Legacy unit remains installed:
`babypark-integration.service`

Pre-v2 standalone bridge backup:
`/var/backups/babypark-integration/bridge.pre-v2.20260924T062925Z.sqlite`

Backup SHA-256:
`d3f63edc60bdaa2a1af6f3b4cdeba3c17924be47293923b9d8efbd52136f7509`

Pre-v2 Nginx snapshot:
`/var/backups/babypark-integration/nginx_chatwoot.pre-v2.20260924T062925Z.conf`

Normal rollback does NOT restore the old database backup after v2 has accepted traffic.
The additive schema is intentionally compatible with the retained legacy gateway.

## Catalog / AI

No Drupal catalog exporter is active.
No CatalogService is active.
No AI copilot is active.

The offline/local canonical identity and catalog core phases are complete.
No Drupal writes are required.

## E6b-1 status

The authenticated catalog HTTP boundary is implemented as an isolated process,
with writes disabled by default. It is not deployed or live-ready. E6b remains
open until E6b-2 operational recovery, backup, and capacity gates close. See
`CATALOG_INGEST_E6B1.md`.

## E6b-2a mechanism status

The local recovery core is implemented for review: replay statistics,
publication-locked immutable identity/replay recovery sets, full verification,
coverage predicates, read-only restore reconciliation, replay-loss
provisioning, and the `catalog:ops` CLI. It is not deployed and does not change
HTTP admission or readiness. E6b remains open; E6b-2b is still required. See
`CATALOG_RECOVERY_E6B2A.md`.
