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

The next implementation phase is offline/local canonical identity + catalog core.
No Drupal writes are required.
