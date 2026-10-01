# CURRENT_STATE

Status: CURRENT
Last verified: 2026-09-30
Owner: BabyPark
Source of truth: production runtime + this repository

## D2b acceptance status (2026-09-30)

Link A PR #37 merged at `c89fd25a6fac2f48d025527531b9601bdf817d22` and
Link B PR #38 merged at `ca8b748aa8e845403debf31b6133b08d0e59e640`.
The first controlled production FULL is complete. Its operational truth snapshot is:
- CURRENT generation: `g_3f82b2487806f6caaea95ad9aca94552f2eeb39844a2de87`;
- source epoch: `drupal-prod-v1`;
- accepted run: `d946fe5d_e1e6_4cc0_88a2_1cde031a81d1`;
- run digest: `43306e8b47ab9ad618376f168f552b2a24f79e98a292098ba9301a583479ccc6`;
- final sequence: `176`;
- production spool manifest SHA-256:
  `c18bbb1740e7722f2c0f0138b37bf162dbedd1874b481cdde505bd4fa3491935`.

These exact documentation values are an operational truth snapshot, not a new
authority. The sealed generation `catalog_meta.manifest_json` and its SHA-256 remain
the machine authority for generation, source, accepted run, digest, final sequence,
and spool provenance.

Current accepted entity counts are:
- products: 16,245;
- variants: 49,257;
- categories: 92;
- brands: 821;
- images: 136,241;
- offers: 8,673;
- store-stock rows: 14,364;
- localized product-text rows: 32,311;
- attributes / attribute definitions: 0 (valid optional domains).

Post-FULL local recovery coverage is `COVERED`. Production Link A is `PASS`, and the
independent Link B is `PASS`, both against the accepted generation and frozen spool.

The first-FULL acceptance tail is now **CLOSED / ACCEPTED**:
- covering recovery set:
  `set-20260930T181032Z-d5f1cd5906a4a838`;
- encrypted off-host recovery copy: PASS;
- scratch restore from that off-host ciphertext on a separate host: PASS;
- SEALED technical acceptance package: PASS;
- explicit BabyPark owner acceptance: ACCEPTED;
- immutable owner-acceptance record SHA-256:
  `47d55de9d653fff14302bd15f22a9193ebdaa848172072c0902bd1de6707b1f4`.

The first owner-authorized production canonical downstream snapshot is also complete:
- snapshot ID:
  `full-g3f82b248-d946fe5d-20260930T2128Z`;
- generation:
  `g_3f82b2487806f6caaea95ad9aca94552f2eeb39844a2de87`;
- snapshot manifest SHA-256:
  `6dac402a0f423cf2b77d82114c262df5565855233c78252718fd5d74f32b8883`;
- source generation manifest SHA-256:
  `067cb115aff02ef7e53cdefa405e7f8cc29b1087f94000aad9bd7f5504123a19`;
- total canonical records: 274,231;
- artifact bytes: 220,908,827;
- export: 13.16 s wall, max RSS 112,332 KiB, swap 0;
- independent verifier: PASS, 2.55 s wall, max RSS 96,580 KiB, swap 0.

The snapshot exporter/verifier ran from a separate immutable release at commit
`3076b03c508eb4c4517579aaea70c1ae6dfd5832`, tree
`5846bb45d8e24d2f1d6695e1b9737432018dfadc`. The operation did not switch the
running CatalogService release and did not change CURRENT.

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

Initial D1 deployment source (historical):
`1956aba235f1771262235881701186cbc5bd884d`

Current production runtime source:
- commit: `7d98905b6538b395488bf69f318b56f683569bcd`;
- tree: `849154c233ebf2fa0491822fe6c67a7a061e0804`;
- release provenance SHA-256:
  `39de7b5782e73fedf138c20236cba48be6fff3954989441bf4663f6388bccef4`.

Current production release:
`/opt/babypark-integration/releases/20260930T1718Z-7d98905b`

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

Current authenticated state is post-FULL and bound to the exact CURRENT generation
and accepted run. Operational identifiers are read from authenticated state and the
sealed generation manifest; no credentials or private authentication material are
recorded here.

Recovery:
- authority: `CURRENT`
- replay schema: `7`
- published/live identity revision: `65504`
- covering recovery set: `set-20260930T181032Z-d5f1cd5906a4a838`
- coverage: `COVERED`
- post-FULL local coverage: `COVERED`
- off-host encrypted recovery + separate scratch restore: `PASS`

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
The accepted CURRENT generation, recovery evidence and derived snapshot artifacts are
preserved under explicit operator control; no age-only cleanup is authorized.

## Drupal exporter production preflight

D2a/D2a.1 plus D2b exporter slice 1 code is deployed on the Drupal production host
as an isolated, non-scheduled exporter. It is not a daemon and does not write Drupal
data.

Web-origin protection changed during the 2026-09-28 preflight investigation:
- the Cloudflare wildcard `*.babypark.ua` was disabled by renaming the DNS record to
  `wildcard-disabled-20260928`; exact service records remain unchanged;
- existing static `jpg/jpeg/png/gif/webp/svg/ico/css/js/woff/woff2/ttf/eot` files are
  now served directly by Nginx, with missing files falling back to Apache/Drupal so
  image-style generation remains intact;
- Nginx vhost backups:
  `/etc/nginx/sites-available/babypark.ua.conf.bak.static-direct.20260928T193301Z`
  and
  `/etc/nginx/sites-available/ssl.babypark.ua.conf.bak.static-direct.20260928T193301Z`;
- verification proved existing JS/JPG requests no longer hit Apache while a missing
  JPG still reaches the Drupal fallback.

Current exporter release:
`/opt/babypark-exporter/releases/20260928T195344Z-8c78bd5`

Production source:
`8c78bd51a7b73a0a29209d5f6c43f6f13ad09bc3`
(PR #31 merge; tree `ff6a1578cc53fc22a16644e32accf8ad6d085334`)

Current exporter symlink:
`/opt/babypark-exporter/current`

Runtime:
- dedicated OS identity: `babypark-exporter`
- private state: `/var/lib/babypark-exporter` mode `0700`
- dedicated MariaDB principal: `babypark_exporter@127.0.0.1`
- database grant: `SELECT` on `babypark_ua.*` only
- production exporter runtime is pinned Node `24.21.0` LTS at
  `/opt/babypark-exporter/runtime/node-v24.21.0/bin/node`;
- the pinned archive SHA-256 was verified against the official Node release checksum,
  and the installed runtime passed `node:sqlite`/FTS5 probing;
- legacy side Node `22.23.2` remains installed but is no longer production execution
  authority;
- system `/usr/bin/node` remains unchanged at v20.20.2

D2a.1 historical merge/deployment source:
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

D2b Slice 1 candidate preflight after PR #30 merge:
- candidate commit: `a251275b4ccd0019cf5d22bdbbd2eb027555430e`;
- executed against live Drupal without switching `current` and without FULL;
- result: `ok=true`, zero hard blockers;
- current residual anomaly: only `80401mc02`;
- quarantined source product groups: `118670`, `12605`;
- historical Joolz `511000` collision no longer appears in the current collision report;
- warning count/classification remained the established 78-warning baseline;
- the successful run proved the existing side Node 22.23.2 has `node:sqlite` + FTS5,
  while system Node 20 cannot import the new exporter;
- observed runtime was materially longer than the old D2a preflight, so PR #31 adds
  pinned Node 24.21.0 plus stage timing diagnostics before cutover;
- at this candidate-proof point, the production exporter symlink still remained on
  the previous release.

PR #31 production hardening and cutover completed on 2026-09-28:
- PR #31 merged as
  `8c78bd51a7b73a0a29209d5f6c43f6f13ad09bc3`;
- exact merge tree equals the reviewed PR-head tree:
  `ff6a1578cc53fc22a16644e32accf8ad6d085334`;
- immutable production release:
  `/opt/babypark-exporter/releases/20260928T195344Z-8c78bd5`;
- pre-cutover and post-switch production preflights both returned `ok=true`;
- each had zero hard blockers, warning_count 78, anomaly_count 1,
  quarantined_product_count 2 and prepared_chunk_count 175;
- post-switch `current` remained on the new immutable release before/after the proof;
- no `.ready` spool, Catalog HTTP, FULL or Drupal write occurred;
- post-switch stage timings: snapshot extract about 10.3s, canonical build about
  41.0s, chunk preparation about 126.8s, total about 183.5s;
- measured post-switch envelope: peak RSS about 650 MiB, peak temporary scratch about
  170 MiB, peak building spool about 537 MiB, minimum free disk about 10.57 GiB;
- successful cleanup left no exporter `.building` or chunk-scratch directory.

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
- the fix is now included transitively in the current production exporter release
  `8c78bd51a7b73a0a29209d5f6c43f6f13ad09bc3`;
- no intermediate production cutover was made solely for this fix.

Current collision findings are migration evidence, not universal future identity
rules. Durable future architecture lives in:

`docs/CATALOG_IDENTITY_ANOMALY_MANAGEMENT.md`

## Catalog Anomaly Runtime v1

Status: **MERGED / EXPORTER QUARANTINE INTEGRATION DEPLOYED / PERSISTENT CATALOG ANOMALY STORE NOT DEPLOYED**
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

Production Drupal exporter is now:
`/opt/babypark-exporter/releases/20260928T195344Z-8c78bd5`

The exporter-side anomaly quarantine/publication-policy integration is therefore
deployed for future controlled batch runs. Persistent Catalog `anomalies.sqlite`
runtime/application work remains not deployed.

Regression proof from sanitized 2026-09-27 collision fixtures remains:
- 21 reviewed test mappings resolve first;
- fixture data leaves `511000` and `80401mc02` as 2 cross-product anomalies;
- both quarantine all fixture colliding source products;
- unrelated products continue into canonical chunks.

That fixture is historical regression evidence, not a claim that live Drupal remains
unchanged. A read-only live-source probe on 2026-09-28 found source group/node
`139026` absent; current `511000` rows belong only to product group `79252`.
`80401mc02` still appears under groups `12605` and `118670`.

The accepted first controlled FULL cryptographically bound its anomaly report and
behavior-affecting publication-policy authority through the signed D2b publication
evidence. Persistent production `anomalies.sqlite` remains a separate later capability
and still requires its own backup/restore slice before deployment.

Current operational state:
- exporter/runtime hardening and the D2b producer/sender path have completed the first
  controlled production FULL;
- the accepted generation intentionally excludes the residual live anomaly
  `80401mc02` through quarantine; source groups `118670`/`12605` remain the
  current known incident scope from the accepted source evidence;
- receiver authority/recovery, sender/control, Link A and Link B have all been exercised
  on the accepted production run;
- the acceptance tail and first canonical downstream snapshot are closed/verified;
- persistent anomaly application/Requires Attention and reviewed identity-resolution
  application remain separate later work.

Product Identity Resolution v1 is already frozen/merged. Its two original cases
remain historical acceptance fixtures, while the current live incident set is
re-established by candidate preflight.

Requires Attention/application remains a separate later track and is not a safety
prerequisite for exporter candidate preflight or the remaining D2b implementation.

## Catalog / AI next state

No customer-facing AI catalog answering is active.

Two independent tracks are active:

1. **Operational ingestion / downstream boundary**
   - the first controlled Drupal FULL is accepted as CURRENT;
   - production Link A and independent Link B are both PASS;
   - encrypted off-host recovery, separate scratch restore, SEALED evidence and
     explicit owner acceptance are complete;
   - the first generation-bound canonical downstream snapshot is independently
     verified and available as the provider-neutral consumer boundary;
   - further consumers must use the verified snapshot/Catalog boundary rather than
     live Drupal or Catalog SQLite internals.

2. **Identity-resolution application (later)**
   - frozen design: `docs/PRODUCT_IDENTITY_RESOLUTION_V1.md`;
   - keep both historical identifiers unmapped unless a separately reviewed
     resolution is approved;
   - current source absence of a historical card is evidence, not an implicit legacy
     mapping or permanent identity decision;
   - do not pull Requires Attention/application work back into the first-FULL
     critical path.

No identity-resolution application is authorized by this exporter slice.

Previously frozen exporter-side design items are now implemented and deployed:

Before the first production FULL, BabyPark must reach one explicitly reviewed safe
state:
- either all remaining legacy collisions are resolved by approved migration
  mappings; or
- unresolved entities are handled by an implemented/tested anomaly quarantine
  contract that makes their exclusion/handling explicit and auditable.

No untracked ambiguity may silently enter the first canonical generation.

That first-FULL gate is now closed:
- immutable exporter/runtime release remains production `current`;
- the controlled production FULL completed and published one CURRENT generation;
- receiver authority/recovery and sender/control paths were exercised in production;
- Link A and Link B both passed against the accepted generation/frozen source evidence;
- the off-host restore and owner-acceptance tail is closed;
- the first verified canonical downstream snapshot has been produced without changing
  CURRENT.

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

These governance files are indexed in Git. The production exporter now loads the
reviewed publication/collision authority during controlled batch runs; persistent
Catalog anomaly-store/application runtime remains a later deployment.

The two identifiers `511000` and `80401mc02` remain intentionally unmapped in
configuration and useful historical acceptance cases. They are no longer both live
duplicate incidents: the 2026-09-28 read-only source probe found the former Joolz
duplicate group `139026` absent, while the accepted first-FULL source evidence retains
`80401mc02` as the residual quarantined incident under groups `118670`/`12605`.

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

Status: **PRODUCTION FULL ACCEPTED / RECOVERY + LINK A + LINK B PASS / OWNER ACCEPTED / CANONICAL SNAPSHOT VERIFIED**

Design source:
`docs/DRUPAL_EXPORT_D2B.md`

Historical pre-FULL research after Product Identity Resolution v1 identified four
material gates on the critical ingestion path; all four were subsequently closed for
the accepted first production FULL:

1. before the D2b cutover, production CatalogService was on FULL record v1 /
   catalog schema 5 / production mapper 1, while the candidate exporter emitted FULL
   record v2 and required catalog schema 6 / mapper 2; receiver compatibility therefore
   had to be deployed with the planned cutover;
2. exporter payload spool lifecycle had been represented in repository storage policy
   by dedicated transient `exporter_ready_spools` and `catalog_link_a_staging`
   objects before their production activation;
3. sender retry durability had been implemented by PR #35:
   `bp.drupal-d2b.run-state/1` freezes one run ID plus exact header/chunk/trailer
   semantics across restart, and one cross-process sender lock owns each ready spool;
4. the BOOTSTRAP config-state recovery gap had been corrected by PR #33: verified
   recovery sets derive the snapshot config-state digest and live BOOTSTRAP
   admission/state revalidates it; production CatalogService stayed on the previous
   release until the planned D2b cutover.

Current production capability facts:
- CatalogService host supports `node:sqlite` and SQLite FTS5;
- CatalogService is `CURRENT`, `/health` is green, ingest is enabled and there are
  no current health blockers;
- current service has no systemd `MemoryMax`/`MemoryHigh` envelope;
- catalog Nginx `proxy_read_timeout` is 300 seconds;
- the production FULL, certification/seal/publication and post-ACK acceptance path
  have completed successfully for the accepted generation.

Receiver implementation status:
- PR #33 merged at `54763804fbceb34ab107d94d44bdf993b59d3152`;
- structural historical `bp.catalog.run-header/1` parsing is retained;
- new production FULL admission requires exact `bp.catalog.run-header/2`;
- signed `bp.catalog.publication-authority/1` is validated against the exact two-key
  IdentityStore config map before NEW seq0 durable admission and on v2 seq0 retry;
- config hash mutation and decisive seq0 admission share
  `CatalogPublicationLock`, closing the cross-process config/admission race;
- accepted generation manifests bind the exact authority recovered from durable seq0,
  including seal/recovery/publication tamper checks;
- BOOTSTRAP recovery coverage binds snapshot/live config-state digest and cached
  coverage is invalidated live; CURRENT recovery semantics remain unchanged;
- explicit D2b HTTP authority/config/version errors are non-500;
- no ReplayStore, recovery-set, Catalog DB or IdentityStore schema bump was required;
- this receiver support is deployed in the current production CatalogService release
  and was exercised by the accepted first FULL.

Frozen direction used for the completed first-FULL campaign (historical design record):
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

The original first-FULL critical path is complete. Rehearsal hardening, production
CatalogService cutover, the controlled FULL, post-ACK two-link acceptance, off-host
recovery/restore and owner acceptance have all been completed. Future ingestion runs
are separate owner/operator decisions and must preserve the accepted authority and
recovery invariants.

Repository receiver support for run-header/2, publication-authority validation,
accepted-generation authority binding and BOOTSTRAP recovery correction was merged by
PR #33. Repository sender/control support with exact durable run-state, exclusive
per-spool ownership, bounded retry/resume and authenticated BP1 transport was merged
by PR #35. These capabilities were subsequently deployed/exercised for the accepted
first production FULL; their original PR-level non-production claims below remain
historical closure evidence for those individual PRs.

Production exporter cutover remains at
`/opt/babypark-exporter/releases/20260928T195344Z-8c78bd5`
(commit `8c78bd51a7b73a0a29209d5f6c43f6f13ad09bc3`). Both pre-cutover and
post-switch preflight passed with the established live-source baseline. A later
owner-authorized D2b producer/sender release sent the accepted first FULL; CatalogService
is now CURRENT at generation
`g_3f82b2487806f6caaea95ad9aca94552f2eeb39844a2de87`.

PR #33 receiver closure evidence:
- reviewed PR HEAD `43974f1105bf11276dbe24cdf7e73b8590358cd0`,
  tree `eda43ffc34acdaee30d068c80db1be0a13a08b4d`;
- merge commit `54763804fbceb34ab107d94d44bdf993b59d3152`;
- independent exact crash-window reproduction proves config A -> pending seq0 ->
  config B -> exact retry now fails `CONFIG_AUTHORITY_MISMATCH` before builder/stage;
- root unit 330/330, focused correction 75/75, legacy 13/13, refactor 13/13,
  exporter 181/181 and storage-policy validation all passed on the reviewed tree;
- no production deployment, CatalogService mutation or FULL occurred as part of PR #33.

PR #35 sender/control closure evidence:
- reviewed PR HEAD `b7fa3f7816d6b3529775305b8e5a7bd59c649e39`,
  tree `ae9b176dfb267adc5c58cf46dc43770714f41e44`;
- merge commit `46cc19e3389efdf202be6ad8aed21c05c45c693a`;
- exact spool/3 verification reuses FULL decoding/record validation before network;
- durable `bp.drupal-d2b.run-state/1` freezes run/header/chunk/trailer evidence;
- `bp.drupal-d2b.sender-lock/1` fails closed on malformed owner evidence and requires
  explicit stale-lock breaking only after dead ownership is proven;
- redirects are non-retryable `D2B_REDIRECT_REJECTED`; valid CatalogService terminal
  errors preserve remote `code/action/request_id` through `D2B_CATALOG_ERROR`;
- focused sender/storage 62/62, isolated real SIGKILL 10/10, root unit 377/377,
  legacy 13/13, refactor 13/13, exporter 181/181 and storage-policy validation
  21 objects / 6 durable all passed on the reviewed tree;
- no production deployment, production spool, CatalogService mutation, FULL, Link A
  or acceptance package occurred as part of PR #35.
