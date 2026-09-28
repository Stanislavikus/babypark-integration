# CURRENT_STATE

Status: CURRENT
Last verified: 2026-09-28
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

D2a/D2a.1 code is deployed on the Drupal production host as an isolated,
non-scheduled exporter. It is not a daemon and does not write Drupal data.

Current exporter release:
`/opt/babypark-exporter/releases/20260927T122537Z-712f09c`

Current exporter symlink:
`/opt/babypark-exporter/current`

Runtime:
- dedicated OS identity: `babypark-exporter`
- private state: `/var/lib/babypark-exporter` mode `0700`
- dedicated MariaDB principal: `babypark_exporter@127.0.0.1`
- database grant: `SELECT` on `babypark_ua.*` only
- isolated Node runtime: `/opt/babypark-exporter/runtime/node-v22.23.2/bin/node`
- system `/usr/bin/node` remains unchanged at v20.20.2

D2a.1 merged/deployed source:
`712f09cd390df71821b1315c47fac30a620a4636`

D2a.1 established:
- FULL record schema v2;
- variant-level `commercial_availability`;
- optional price-only offer;
- trusted-price policy;
- snapshot currency precision;
- deterministic degraded-source warnings.

Second production preflight:
- 2026-09-27
- duration: about 2m58s
- mode: `preflight`
- result: `ok=false`, as expected while reviewed SKU collisions remain
- blocker rows: 43
  - 3 `SKU_COLLISION_CROSS_PRODUCT`
  - 20 `SKU_COLLISION_WITHIN_PRODUCT`
  - 20 secondary `FULL_RECORD_INVALID` duplicate-SKU diagnostics for those same
    within-product collisions
- unique collision decisions requiring review: 23
- warning_count: 78
- no `.ready` spool
- no Catalog HTTP
- no FULL
- no Drupal writes
- live site remained operational during the run

Collision review state:
- 21 of 23 unique collisions have sufficient technical evidence and are approved
  as legacy migration mappings;
- durable evidence ledger:
  `docs/DRUPAL_LEGACY_COLLISION_REVIEW_20260927.md`;
- `config/drupal/legacy-sku-collisions.yaml` contains exactly those 21 mappings;
- `511000` and `80401mc02` remain intentionally unmapped pending
  business/source-process investigation and are handled by anomaly quarantine.

Default-promotion safety fix:
- PR #19 merged to main;
- main merge commit: `b21edcf101116eea3ad93b53430f944725029833`;
- this fix is intentionally not deployed yet;
- production exporter remains on `712f09c` until the reviewed collision mapping
  is ready, so the live host can be switched once rather than repeatedly.

Current collision findings are migration evidence, not universal future identity
rules. Durable future architecture lives in:

`docs/CATALOG_IDENTITY_ANOMALY_MANAGEMENT.md`

## Catalog Anomaly Runtime v1

Status: **MERGED / NOT DEPLOYED**
Implementation source: `main`, PR #26 merge `eb70c08c8917550bfe2666d85b845328e38b02a4`
Design contract: `docs/CATALOG_ANOMALY_RUNTIME_V1.md`

What landed in repository code (not production):
- provider-neutral anomaly core under `src/catalog/anomaly/` with separate
  `AnomalyStore` SQLite schema v1;
- machine-readable publication policy:
  `config/catalog-anomalies/publication-policy.yaml`;
- Drupal exporter integration:
  reviewed legacy mappings first, residual SKU collisions become anomaly
  observations, whole-product quarantine and deterministic `anomaly-report.json`;
  PR #26 originally emitted `bp.drupal-exporter.spool/2`, while current D2b
  implementation slice 1 upgrades the repository exporter to transportable
  `bp.drupal-exporter.spool/3`;
- local/test operator CLI: `npm run catalog:anomaly-ops -- ...`.

Explicit non-actions in this slice:
- no production deploy;
- no production `anomalies.sqlite`;
- no production quarantine activation;
- no FULL send;
- no D2b transport binding;
- no mutation of integration-host `identity.sqlite`;
- no permanent mappings for `511000` or `80401mc02`;
- the production collision config contains only the 21 reviewed legacy migration mappings.

Production Drupal exporter remains:
`/opt/babypark-exporter/releases/20260927T122537Z-712f09c`

Regression proof from sanitized 2026-09-27 collision fixtures remains:
- 21 reviewed test mappings resolve first;
- fixture data leaves `511000` and `80401mc02` as 2 cross-product anomalies;
- both quarantine all fixture colliding source products;
- unrelated products continue into canonical chunks.

That fixture is historical regression evidence, not a claim that live Drupal remains
unchanged. A read-only live-source probe on 2026-09-28 found source group/node
`139026` absent; current `511000` rows belong only to product group `79252`.
`80401mc02` still appears under groups `12605` and `118670`.

Before first controlled FULL, D2b must cryptographically bind
`anomaly_report_sha256` and behavior-affecting publication-policy digest.
Before production anomaly persistence, a separate `anomalies.sqlite`
backup/restore slice is required.

Next operational steps:
- finish/review implementation slice 1 and build one immutable exporter candidate;
- run candidate production preflight without switching `current`;
- require zero unaccounted hard blockers and let the candidate establish the current
  residual anomaly/quarantine set from live Drupal;
- preserve acceptance evidence for the historical `511000`/`80401mc02` cases,
  including an explicit missing-source outcome for `139026`;
- continue D2b implementation only from that reviewed source truth.

Product Identity Resolution v1 is already frozen/merged. Its two original cases
remain historical acceptance fixtures, while the current live incident set is
re-established by candidate preflight.

Requires Attention/application remains a separate later track and is not a safety
prerequisite for exporter candidate preflight or the remaining D2b implementation.

## Catalog / AI next state

No AI copilot is active.
No Drupal FULL has been sent.

Two independent tracks are active:

1. **Operational ingestion**
   - review implementation slice 1 and build an immutable exporter candidate with
     anomaly quarantine + spool v3;
   - run candidate preflight against live Drupal without switching production
     `current`;
   - confirm deterministic anomaly report/quarantine from the current source rather
     than forcing the historical 2026-09-27 2/4 count;
   - only after candidate proof install/switch the reviewed exporter release;
   - continue D2b runtime/sender implementation toward first controlled FULL.

2. **Identity-resolution application (later)**
   - frozen design: `docs/PRODUCT_IDENTITY_RESOLUTION_V1.md`;
   - keep both historical identifiers unmapped unless a separately reviewed
     resolution is approved;
   - current source absence of a historical card is evidence, not an implicit legacy
     mapping or permanent identity decision;
   - do not pull Requires Attention/application work back into the first-FULL
     critical path.

No identity-resolution application is authorized by this exporter slice.

Previously frozen design items now implemented in code (awaiting deploy):

Before the first production FULL, BabyPark must reach one explicitly reviewed safe
state:
- either all remaining legacy collisions are resolved by approved migration
  mappings; or
- unresolved entities are handled by an implemented/tested anomaly quarantine
  contract that makes their exclusion/handling explicit and auditable.

No untracked ambiguity may silently enter the first canonical generation.

After that gate:
- deploy one immutable exporter/runtime release;
- run production preflight;
- target: zero unaccounted hard blockers and a clean local spool;
- then proceed to D2b transport / first controlled FULL.

Two mandatory future research/design gates exist before customer-facing AI catalog
answers are production-ready:

1. **Catalog Identity & Anomaly Management**
   - provider-neutral identity model;
   - duplicate/conflicting identifier detection;
   - safe runtime behavior;
   - durable anomaly incidents;
   - notifications/handoff;
   - human resolution;
   - reviewed prevention rules;
   - future Data Quality / Requires Attention SaaS UI.
   - source of truth:
     `docs/CATALOG_IDENTITY_ANOMALY_MANAGEMENT.md`

2. **Product Presentation Projection**
   - provider-neutral reusable product cards/templates;
   - preview images;
   - trusted price;
   - availability;
   - channel rendering;
   - caching/CDN behavior;
   - answer/visual quality;
   - click/select likelihood;
   - latency and total delivery/model/channel cost.
   - overview:
     `docs/SYSTEM_MAP.md`

Identity/anomaly resolution logically precedes product presentation: an ambiguous
identity set must not become a polished AI recommendation/card.

Neither future architecture should be hidden only in an LLM prompt. Deterministic
business policy belongs in structured/versioned configuration and ultimately the
SaaS UI; Chatwoot/email are operational surfaces rather than the policy source of
truth.

Agreed anomaly governance is already indexed from:
- `config/catalog-anomalies/README.md`
- `config/catalog-anomalies/POLICY_CATALOG.md`
- `docs/CATALOG_ANOMALY_RUNTIME_V1.md`

These governance files are indexed in Git. Production runtime still does not load
them until the reviewed exporter release above is deployed.

The two identifiers `511000` and `80401mc02` remain intentionally unmapped in
configuration and useful historical acceptance cases. They are no longer both assumed
to be live duplicate incidents: the 2026-09-28 read-only source probe found the former
Joolz duplicate group `139026` absent. Candidate preflight must determine the current
runtime incident set.

Current design slice:
- `docs/PRODUCT_IDENTITY_RESOLUTION_V1.md`;
- Joolz `511000`: acceptance case for a candidate same-product resolution where
  useful content, category and URL facts are split across legacy cards;
- Bugaboo `80401mc02`: acceptance case for a candidate same-product resolution
  involving multiple suppliers and case-variant source articles;
- product/variant identity, root cause, identifier exception and action plan are
  separate structured decisions;
- approval binds exact material evidence and collider/source-entity set;
- AI may propose; until authenticated admin approval exists, reviewed digest-bound
  registry changes are the durable authority.

No production deployment or FULL is part of this design slice.

## D2b / first controlled FULL

Status: **FROZEN DESIGN / IMPLEMENTATION SLICE 1 IN REPOSITORY / NOT DEPLOYED**

Design source:
`docs/DRUPAL_EXPORT_D2B.md`

Research after Product Identity Resolution v1 freeze found four material gates on the
critical ingestion path:

1. production CatalogService is still on FULL record v1 / catalog schema 5 /
   production mapper 1, while current exporter/main emits FULL record v2 and expects
   catalog schema 6 / mapper 2; D2b server support and that compatibility upgrade must
   be deployed together before first FULL;
2. exporter payload spool lifecycle is now represented in repository storage policy
   by dedicated transient `exporter_ready_spools` and `catalog_link_a_staging`
   objects; production directories/retention are not yet activated;
3. sender retries require durable exact run-state so one run ID never acquires changed
   header/trailer bytes after restart;
4. current BOOTSTRAP recovery coverage does not bind the snapshotted/live
   IdentityStore `config_state` authority, so an older BOOTSTRAP recovery set can
   still appear covering after reviewed config hashes change. Coverage must compare
   exact config-state digest, not the whole live identity revision, so restart/resume
   remains valid after unpublished xref/UUID growth.

Verified production capability facts:
- CatalogService host supports `node:sqlite` and SQLite FTS5;
- CatalogService is BOOTSTRAP and `/health` is green;
- current service has no systemd `MemoryMax`/`MemoryHigh` envelope;
- catalog Nginx `proxy_read_timeout` is 300 seconds;
- full-scale production-shape certification/seal/publication has not yet been timed;
- first full-scale isolated rehearsal is therefore mandatory before production
  CatalogService cutover.

Frozen direction:
- keep BP1 transport v1 and existing `/api/catalog/ingest/v1/full` route;
- introduce exact signed `bp.catalog.run-header/2` with
  `bp.catalog.publication-authority/1`;
- preserve existing D2a `bp.drupal-exporter.spool/2` semantics and introduce
  D2b-transportable `bp.drupal-exporter.spool/3` with producer provenance and
  `source-acceptance.json` hash binding;
- publication authority uses a versioned `config_digests` map, spool/anomaly hashes,
  source contract versions, `native_identity_scheme`, producer commit and release
  provenance digest;
- CatalogService compares the signed config map to exact current `config_state` before
  accepting seq0; while catalog authority is BOOTSTRAP, recovery gate also revalidates
  the covering-vs-live config-state digest on every ingest admission/`/state` blocker
  computation; CURRENT recovery semantics are intentionally unchanged in D2b;
- D2a keeps the no-HTTP invariant; D2b is a separate sender/control module with atomic
  run-state and an exclusive per-spool sender lock;
- accepted authority is preserved in generation manifest extra plus a small producer
  acceptance-audit package;
- full-scale rehearsal runs on a disposable dedicated production-class VM after D2b
  implementation, with predeclared 30s nonfinal / 180s final gates, failure drills and
  the complete Link A staging/exhaustive verifier under a separate 512/384 MiB
  low-priority transient-unit envelope;
- production Link A uses the same or stricter rehearsed bounded-memory transient-unit
  envelope on the CatalogService host and is safely abortable/read-only;
- rehearsal spool is never reused as production: after final release freeze, production
  builds a fresh spool from the same immutable producer/sender commit and starts seq0
  within 30 minutes of the snapshot watermark;
- heavy spool data remains available through ACK/state, Link A and owner accept/reset
  decision; CatalogService Link A staging is a separate transient storage-policy
  object;
- acceptance is two-link: exhaustive spool-to-catalog plus independent retained
  source-snapshot-to-spool evidence; live Drupal is only rechecked when unchanged
  status can be proven by source markers;
- one production CatalogService cutover occurs only after rehearsal;
- off-host identity/recovery copy + restore drill and two-link acceptance are gates
  before Seller AI/catalog consumers are enabled.

Implementation slice 1 now changes repository exporter/storage-policy code only:
- exporter writes exact `bp.drupal-exporter.spool/3` with producer release provenance
  and `source-acceptance.json` hashes;
- production source-acceptance evidence is gathered by separate targeted SELECTs inside
  the same repeatable-read snapshot transaction, with exact catalog-vocabulary
  taxonomy/hierarchy, provider brand terms and NFC-correct streamed stock matching;
- reviewed acceptance cases are bounded to 128 product-group IDs;
- preflight/spool fail closed on explicit existing temp/spool/MariaDB directory
  free-space gates;
- immutable `RELEASE.json` creation/validation is canonical and rejects dirty or
  non-normal Git index state plus source-tree output paths;
- ready-spool and future CatalogService Link A staging are required transient storage
  classes with frozen private `0700/0600` permissions;
- production storage ownership is recorded as
  `babypark-exporter:babypark-exporter`.

Still not implemented in this slice: D2b HTTP sender, run-header/2, CatalogService
publication-authority validation, BOOTSTRAP recovery fix, Link A verifier, rehearsal,
production CatalogService upgrade or first FULL.

Production exporter remains on its previous release until candidate review/preflight;
no production state has been changed by this repository slice.
