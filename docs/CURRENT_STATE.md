# CURRENT_STATE

Status: CURRENT
Last verified: 2026-09-27
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

Safe public-route verification:
- 2026-09-24: invalid Viber signature -> HTTP 401
- 2026-09-24: invalid Chatwoot signature -> HTTP 401
- 2026-09-26 after CatalogService deployment: both invalid-signature checks still -> HTTP 401
- gateway process was not restarted during CatalogService deployment
- `/opt/babypark-integration/current` remained on the 20260924 Viber release

Production bridge integrity after migration:
`PRAGMA integrity_check = ok`

Current row-count baseline immediately after cutover:
- sessions: 1
- processed_viber: 1
- processed_chatwoot: 2
- outgoing_viber: 1
- session_recovery_issues: 0

## CatalogService production

D1 deployment completed on 2026-09-26.

Merged deployment source:
`1956aba235f1771262235881701186cbc5bd884d`

Production release:
`/opt/babypark-integration/releases/20260926T205420Z-1956aba`

Catalog release symlink:
`/opt/babypark-integration/catalog-current`

Systemd:
`babypark-catalog-ingest.service`

Runtime state:
- enabled + active
- service identity: `babypark-catalog`
- local listener: `127.0.0.1:8081`
- observed idle RSS after enable: about 20 MiB
- `CATALOG_INGEST_ENABLED=true`

Durable state:
- parent: `/var/lib/babypark-catalog`
- owner: `babypark-catalog:babypark-catalog`
- mode: `0700`
- identity: `/var/lib/babypark-catalog/identity.sqlite`
- replay: `/var/lib/babypark-catalog/replay.sqlite`
- catalog generations: `/var/lib/babypark-catalog/catalog`
- recovery sets: `/var/lib/babypark-catalog/backup`

Environment:
`/etc/babypark-catalog-ingest.env`
- owner: `root:root`
- mode: `0600`
- secret values are NOT in Git

Current authenticated state:
- schema: `bp.catalog.state/1`
- state: `BOOTSTRAP`
- accepting_ingest: `true`
- blockers: `[]`
- current_generation: `null`
- accepted_run: `null`

No Drupal FULL has been sent yet.

Recovery:
- authority: `BOOTSTRAP`
- identity revision: `0`
- replay schema: `7`
- covering recovery set: `set-20260926T205746Z-35f3395efc6f8994`
- coverage: `COVERED`
- BOOTSTRAP `validate-restore`: PASS

Public Catalog ingress on `https://chat.babypark.ua`:
- `/api/catalog/ingest/v1/full`
- `/api/catalog/ingest/v1/state`

Ingress controls:
- Nginx exact locations only
- source allowlist: Drupal outbound IP `77.83.102.249`
- BP1 authentication remains mandatory
- Catalog `/health` is not exposed by a Catalog-specific public route
- public `https://chat.babypark.ua/health` remains Chatwoot and returns `{"status":"woot"}`

Production ingress verification on 2026-09-26:
- allowed Drupal host + unsigned Catalog state request -> HTTP 401 `AUTH_FAILED`
- different BabyPark host + same request -> HTTP 403 from Nginx
- `nginx -t` -> PASS
- Chatwoot root -> HTTP 200
- Chatwoot public health -> `{"status":"woot"}`

## Rollback assets

Legacy Viber runtime remains:
`/opt/babypark-integration/index.mjs`

Legacy Viber unit remains installed:
`babypark-integration.service`

Pre-v2 standalone bridge backup:
`/var/backups/babypark-integration/bridge.pre-v2.20260924T062925Z.sqlite`

Backup SHA-256:
`d3f63edc60bdaa2a1af6f3b4cdeba3c17924be47293923b9d8efbd52136f7509`

Pre-v2 Nginx snapshot:
`/var/backups/babypark-integration/nginx_chatwoot.pre-v2.20260924T062925Z.conf`

D1 pre-Catalog-ingress Nginx snapshot:
`/etc/nginx/sites-available/nginx_chatwoot.conf.bak.20260926T205920Z`

Normal Viber rollback does NOT restore the old database backup after v2 has accepted traffic.
The additive schema is intentionally compatible with the retained legacy gateway.

Catalog application rollback and catalog data/recovery rollback are separate operations.
Before the first FULL, `/var/lib/babypark-catalog` is preserved for diagnosis rather than
deleted automatically.

## Drupal exporter production preflight

D2a code is deployed on the Drupal production host as an isolated, non-scheduled exporter.
It is not a daemon and does not write Drupal data.

Current exporter release:
`/opt/babypark-exporter/releases/20260927T102742Z-7b4b630`

Current exporter symlink:
`/opt/babypark-exporter/current`

Runtime:
- dedicated OS identity: `babypark-exporter`
- private state: `/var/lib/babypark-exporter` mode `0700`
- dedicated MariaDB principal: `babypark_exporter@127.0.0.1`
- database grant: `SELECT` on `babypark_ua.*` only
- isolated Node runtime: `/opt/babypark-exporter/runtime/node-v22.23.2/bin/node`
- system `/usr/bin/node` remains unchanged at v20.20.2

First successful production preflight:
- 2026-09-27
- duration: about 3m14s
- mode: `preflight`
- result: `ok=false` due to source/canonical blockers, as designed
- no `.ready` spool
- no Catalog HTTP
- no FULL
- no Drupal writes
- live site remained serving traffic during the run

The first production preflight exposed a real source-model issue: Drupal availability may
remain trustworthy while an unavailable option's old price delta is stale. D2a.1 implements
the reviewed correction: FULL record schema v2 with variant-level `commercial_availability`,
trusted-price policy, snapshot currency precision, and deterministic degraded-source
warnings. Not deployed; no second production preflight has run yet.

## Catalog / AI next state

No AI copilot is active.
No Drupal FULL has been sent.

Immediate next slice:
- D2a.1 canonical/source-policy correction;
- repeat production preflight;
- review only the remaining true source ambiguities/collisions;
- produce a clean local spool;
- then D2b transport / first controlled FULL.

Before customer-facing AI catalog answers are launched, there is an explicit mandatory
research/design gate for **Product Presentation Projection**. It must study current best
practices and define provider-neutral reusable product-card/presentation templates, including
preview images, trusted price, availability, channel rendering, caching/CDN behavior,
answer/visual quality, click/select likelihood, latency and total delivery/model/channel cost.
See `docs/SYSTEM_MAP.md`.

Product Presentation Projection is intentionally a later layer above CatalogService and is not
part of D2a.1.

No Drupal writes are required for D2a/D2a.1.
