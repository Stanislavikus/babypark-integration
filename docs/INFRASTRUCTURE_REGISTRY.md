# BabyPark Infrastructure Registry

Status: CURRENT
Last verified: 2026-10-27 for this worker operational entry (other entries remain date-specific).
Owner: BabyPark
Purpose: human-readable inventory of production objects that exist outside Git or whose runtime identity/path must remain recoverable from Git.

## Operating rule

Every manually created production object must be recorded here in the same change that creates or materially changes it.

Never store passwords, API secrets, private keys, session cookies or recovery plaintext keys in this file. Record only object identity, purpose, location, owner, expected state and where secret material is stored.

`docs/CURRENT_STATE.md` records current system truth and acceptance state. This file answers a different question: **what objects exist, where are they, and why do they exist?**

## 2026-10-27 — Existing native retention/recovery inventory confirmed for B1 (no objects created)

No destructive action or new data-storage object was introduced during this read-only residual-copies check. See the detailed 2026-10-27 B1 lifecycle section of `docs/CURRENT_STATE.md` on this same Draft branch for full runtime evidence and data-category-specific erasure limitations.

- **Droplet recovery identity:** DigitalOcean `chatwoot-fra1-01`, Droplet ID `597177915`; native backups enabled, **daily** and **7-day** provider retention. This day's existing private recovery images for this droplet: backup IDs `251542648` (2026-10-26 00:26:36 UTC) and `251684286` (2026-10-27 00:18:19 UTC). These are **pre-existing recoverable assets, not newly made backups**; do not delete them merely due to a later image. Provider manages rotation; snapshot restore can reintroduce old customer data and must be followed by human verification of pending lawful erasure obligations.
- **Redis local persistence:** `/var/lib/redis/dump.rdb` under root-controlled/Redis-owned host storage; `appendonly=no`, RDB `save=3600 1 300 100 60 10000`. This stores operational job data from existing Sidekiq queues and Dead Set. It is part of host recovery; do not equate conversation deletion with removal from this asset or the host snapshots. Redis binds loopback.
- **Operational logs:** journald persisted at `/var/log/journal` (no explicit calendar `MaxRetentionSec`), additionally forwarded by native journald/rsyslog to `/var/log/syslog` (mode 0640, weekly/rotate4). Chatwoot Nginx access logs rotate daily/14. These are existing shared host logging/recovery resources. Do not indiscriminately vacuum/delete logs, which would destroy cross-service diagnostics and may defeat legal/operational holds.
- **Native erasure authority:** Chatwoot Contact/Conversation deletion via authorized administrators and asynchronous completion; outstanding data rights requests `contact@babypark.ua` and lawful retention exceptions handled manually. The authorized procedure (PR #154 comment `6442060681`) does not imply historical backups/journals have been selectively scrubbed.
- **Important boundary:** existing worker `LOG_LEVEL=error` stops the specific native Sidekiq WARN job-context dump, not Redis job serialization or historical and ERROR/FATAL sinks. This is a risk inventory, **not a B1 legal sign-off or an approval to activate Callback**.

## 2026-10-27 — CURRENT: worker-only native WARN suppression APPLIED and verified

**Status: Production applied successfully; unrelated B1/PR #154 gates remain OPEN.** On `chatwoot-fra1-01`, a second owner-authorized bounded operational attempt used only **one new native systemd worker drop-in**. This followed Opus 5.5's independent native-options study (PR #154 comment `6444683330`) and Grok 4.7's independent concurrence (PR #154 comment `6444899424`). It supersedes the **historical rolled-back attempt documented below** without erasing that incident.

**Precise objects, no code patches:**
- Existing worker drop-in `/etc/systemd/system/chatwoot-worker.1.service.d/log-level.conf` remains **byte-for-byte unchanged**, SHA-256 `4020d27a099bd301e41d1049abd38f06fa1dccd2665035fc15ab91152ad41524` (sets `warn`; earlier sorting position).
- New worker-only, later-sorting drop-in `/etc/systemd/system/chatwoot-worker.1.service.d/zz-babypark-log-level-error.conf` contains exactly `[Service]\nEnvironment=LOG_LEVEL=error\n`, SHA-256 `96a4fe460f06c36307815e193972accd06ba62c01b093f83db3c3e3fb75443d1`; mode `0644`, root-owned. `systemctl daemon-reload` and restart of **only** `chatwoot-worker.1.service` completed.
- A **separate root-only protected recovery/preimage directory** was created: `/root/babypark-ops-backups/20261027-chatwoot-worker-loglevel-verified-application/` (mode `0700`; recorded files `0600`). It stores prior worker unit, unchanged original drop-in, worker/web `systemctl cat` snapshots and `manifest.json` SHA-256 `3c595a70211266a66c90f88dfbe10d634212b274418a773ce69109bd3061784e`. The earlier aborted attempt's independent protected preimage remains retained separately and must not be auto-deleted.

**Read-only preflight and postchecks:**
1. Installed Chatwoot Git HEAD `9f920b549c14491a4e587687a3eed5d21c6ccc7d`, tree `16432eeeef9153f7aff66be382e04a20e6f5683a`, clean worktree. Systemd 255, native Sidekiq 7.3.10. No `EnvironmentFile` or `UnsetEnvironment`. Three **fictional** `LOG_LEVEL` probes (pre-login P0, after `bash -l` P1, after dotenv P2) each preserved the same sentinel; no secrets or customer data were printed.
2. Before modification, both effective worker and web processes were `warn`, SidekiqAlive 200. New unit Environment showed one effective `LOG_LEVEL=error`, web stayed `warn`. After worker-only restart and **waiting until the actual worker's Sidekiq process completed boot**, every worker process in its systemd cgroup exposed `LOG_LEVEL=error`; web PID unchanged and `LOG_LEVEL=warn`. SidekiqAlive returned HTTP 200.
3. **Six successive ten-second checks**: worker remained active, unchanged new PID, environment `error`, SidekiqAlive HTTP 200. Website Chatwoot HTTPS returned HTTP 200; Redis and Nginx active. Fresh independent Rails metadata query: Sidekiq 1 process, concurrency 12, busy 0, heartbeat age 4 seconds; all monitored queues (including `critical/default/low`) length 0 and latency 0; RetrySet 0, DeadSet 20, Scheduled 1, **unchanged from immediately before**. No Dead/Retry message payload was viewed or deleted.
4. A *bounded* journal metadata scan since 14:45 UTC counted 7 worker records and 0 recognizable Sidekiq argument/context dump candidates. This passive observation does **not** prove zero historical disclosures or prevent future ERROR/FATAL payloads. The native installed-gem synthetic Sidekiq default-handler experiment separately proved that its WARN job-context output is suppressed by effective `error`.
5. No web restart, shared `.env` change, Chatwoot core patch, Callback change, consumer conversation, synthetic live job/fault injection, customer deletion, Redis queue purge, or merge.

**Cause of the earlier attempt:** not proven beyond the failed anonymous assertion. The successful run differs in that it waits until the real Sidekiq process is fully booted before asserting its effective environment; this is **consistent with**, not conclusive proof of, an earlier premature verification race.

**Rollback identity and native procedure — only upon separately authorized rollback:** first confirm the new `zz-babypark-log-level-error.conf` SHA-256 exactly matches `96a4fe46...` and that the original `log-level.conf` matches the protected preimage. Remove **only the new exact worker drop-in**, `systemctl daemon-reload`, restart **only** `chatwoot-worker.1.service`, wait until native Sidekiq finishes boot, confirm all worker-process `LOG_LEVEL=warn`, web unchanged `warn`, SidekiqAlive 200, and queue/heartbeat health. Never alter `.env`, web config, customer transcripts, Redis jobs, or retained recovery images automatically.

**Residual privacy boundary:** The default Sidekiq WARN job-context sink is now suppressed on the worker; the stock job still serializes full content and routing tokens into Redis queues/Dead Set. Existing journals/backups and ERROR/FATAL paths remain outside this particular mitigation and require the owner-approved native access/retention disposition. This operational success does **not** grant `B1 — ZERO BLOCKERS`, R1/R2 closure, merge authorization, or Callback go-live GO.

## HISTORICAL 2026-10-27 — first worker LOG_LEVEL attempt FAILED, auto-rollback PASS (now superseded)

**Historical status at the time of first attempt: BLOCKED; production was restored to `LOG_LEVEL=warn`.** A bounded native-only correction to the upstream Sidekiq WARN job-context logging exposure was conditionally authorized by the owner ("if no better native solution found, apply worker-only setting") and Opus 5.5's independently sourced research concluded that no better permitted native solution was proven. Verified published research: Draft PR #154 comment `6444683330`, frozen normalized author report SHA-256 `f7b12e02860d593d9d4239bba6c4f6b7bb673d2bb449dc36ddecf39b0f851b7b`. **A single guarded production application was attempted, failed its required effective-process-level check, and was automatically rolled back. A later attempt to edit the existing drop-in was blocked by the execution host's safety checks and NOT performed. No alternative mutation method was attempted.**

- Host: `chatwoot-fra1-01`, installed upstream Chatwoot HEAD `9f920b549c14491a4e587687a3eed5d21c6ccc7d`, tree `16432eeeef9153f7aff66be382e04a20e6f5683a`, clean tracked worktree; Sidekiq 7.3.10, systemd 255.
- **Original effective web/worker**: both `LOG_LEVEL=warn`, service health active, SidekiqAlive HTTP 200. Before attempt queues `critical/default/low` all 0; Sidekiq processes: one, concurrency 12, busy 0, heartbeat age 2 seconds; RetrySet 0, DeadSet 20, ScheduledSet 1; dead-job types 19 `ActionMailer::MailDeliveryJob/Errno::ENOENT` and 1 `ActionMailer::MailDeliveryJob/Net::SMTPFatalError` (no payloads inspected). This is an instant snapshot.
- Existing native worker drop-in `/etc/systemd/system/chatwoot-worker.1.service.d/log-level.conf`, exactly `[Service]\nEnvironment=LOG_LEVEL=warn\n`, SHA-256 `4020d27a099bd301e41d1049abd38f06fa1dccd2665035fc15ab91152ad41524`; web separate drop-in remains unchanged.
- **Protected backup object:** `/root/babypark-ops-backups/20261027-chatwoot-worker-loglevel-preimage/`, mode 0700 and root-owned, original worker drop-in plus both systemd unit cat/show snapshots in mode 0600; manifest SHA-256 `fc65a89df0a580946c2b1938432b21bbb4d6de993be67b224e99ab1a356dfb2f`. May include systemd metadata: never publish raw snapshots or remove protected rollback object automatically.
- **Attempted limited native change:** temporary additional worker-only systemd drop-in `/etc/systemd/system/chatwoot-worker.1.service.d/zz-babypark-log-level-error.conf` containing `[Service]\nEnvironment=LOG_LEVEL=error\n`; after `daemon-reload` the effective worker unit settings passed a presence check for `error` but after a controlled worker restart the **actual MainPID `/proc/<pid>/environ` still yielded `warn`**. The guarded script aborted at that exact assertion, deleted only its own new drop-in, issued `daemon-reload`, restarted only worker, and independently verified restored `warn`.
- **Current final read-back:** web active `warn`; worker active `warn`; Redis active; Nginx active; SidekiqAlive HTTP 200; original worker drop-in byte-for-byte matches protected copy; new extra drop-in **absent**; bounded worker journal since 14:30 UTC had 0 recognizable job-context dumps (absence is not proof). No real user messages, PII, job payloads, backlog deletion, Chatwoot core changes, web restart, or Callback code changes.
- A second application method (editing the existing native `log-level.conf` instead of adding a later one) was **blocked by safety controls**, therefore never executed. No bypass/retry through another interface is approved. Root cause of actual process env staying warn is **not proven** from this failure; unit Environment display alone is insufficient, and shell/dotenv precedence needs controlled investigation in an authorized environment.

**Rollback/recovery:** No rollback is pending: live state already equals protected preimage. To recover original guard after any *future separately permitted* change, restore only the protected exact `log-level.conf`, `systemctl daemon-reload`, restart only `chatwoot-worker.1.service`, verify worker and web `LOG_LEVEL=warn` and SidekiqAlive HTTP 200. Do not touch the web process, `.env`, Sidekiq Dead/Retry sets, or parent logs as part of this object. Retain protected snapshot/manifest. Future rollouts must use an authorized change mechanism and prove `/proc/<actual worker PID>/environ` after restart; do not assume an extra drop-in is sufficient.

**Gate:** Native Sidekiq WARN exposure mechanism remains reachable; B1 remains **NOT CLOSED** and PR #154 remains Draft; R1/R2/final owner GO absent. This ops record is documentation of a safe but ineffective application/rollback, **not a successful mitigation**.

## Public DNS and Cloudflare

### `ai.babypark.ua`

Purpose:
- direct BabyPark Knowledge Authority control plane;
- future administrative surface for AI First Line configuration.

Cloudflare DNS:
- type: A;
- name: `ai`;
- origin IPv4: `161.35.78.167`;
- expected proxy state: **Proxied**;
- final public hostname: `https://ai.babypark.ua`.

Cloudflare Zero Trust:
- plan: Zero Trust Free;
- team domain: `babypark.cloudflareaccess.com`;
- Access application: `BabyPark AI Knowledge`;
- destination: `ai.babypark.ua`;
- application type: Self-hosted / Public DNS;
- Access policy: `Allow BabyPark AI Admins`;
- policy ID: `8f7c8df2-11c4-47be-85db-6d3ed9f98088`;
- policy rule: exact approved email identities only;
- browser RDP/SSH/VNC rendering: disabled;
- current actor mapping includes `approved Cloudflare identity -> actor_stanislav`;
- Application Audience (AUD) tag:
  `69f5c09169a09bd631e4647d6dd71ddf3558563d1c56b39e20d7209d0960dbc2`.

Security contract:
- Cloudflare Access is the external identity gate;
- origin independently verifies RS256 JWT signature, issuer, audience, expiry and nbf;
- origin signing keys are fetched from `https://babypark.cloudflareaccess.com/cdn-cgi/access/certs` and refreshed automatically;
- direct-origin HTTPS without a valid Access JWT must return HTTP 401;
- public `/health` must remain unavailable.

### Existing `chat.babypark.ua`

Purpose:
- Chatwoot public UI and messaging ingress;
- Catalog ingest exact routes under the same nginx host.

Do not repoint or reuse this hostname for Knowledge Authority.

## Integration host: `chatwoot-fra1-01`

Current public/origin IPv4 used by `ai.babypark.ua`: `161.35.78.167`.

### Nginx — BabyPark AI

Config: `/etc/nginx/sites-available/babypark_ai.conf`

Enabled symlink: `/etc/nginx/sites-enabled/babypark_ai.conf`

Behavior:
- HTTP -> HTTPS except ACME challenge;
- HTTPS reverse proxy -> `127.0.0.1:3210`;
- forwards `CF-Access-Jwt-Assertion`;
- external `/health` returns 404;
- direct-origin request without Access JWT reaches the app and fails closed 401.

TLS:
- certificate: `/etc/letsencrypt/live/ai.babypark.ua/fullchain.pem`;
- private key: `/etc/letsencrypt/live/ai.babypark.ua/privkey.pem`;
- issuance method: Certbot HTTP-01 via `/var/www/letsencrypt`;
- initial certificate issued 2026-10-02;
- Certbot renewal remains the certificate lifecycle authority.

### Knowledge Authority runtime

Systemd: `babypark-knowledge.service`

Expected state:
- enabled;
- active/running.

Release symlink: `/opt/babypark-integration/knowledge-current`

Current release: `/opt/babypark-integration/releases/20261002T1140Z-41c6916a-knowledge`

Repository source: `41c6916ad7eea32c88076cfba2e84576095e3198`

Listener: `127.0.0.1:3210` only.

Production DB: `/var/lib/babypark-integration/knowledge.sqlite`

Expected DB ownership/mode: `www-data:www-data 0600`

Environment:
- `/etc/babypark-knowledge.env` — non-secret runtime location/listener config;
- `/etc/babypark-knowledge-access.env` — Access issuer/audience, actor map and grants; root-readable only;
- secret values must never be committed.

Current authority bootstrap state on 2026-10-02:
- valid production SQLite authority;
- immutable ledger verified;
- initial ledger contains zero business revisions/events;
- no fake store hours/policies were inserted merely to populate the database.

### Knowledge production recovery

Local data-encryption-key env: `/etc/babypark-knowledge-backup.env` (root-only).

Local staging: `/var/lib/babypark-integration/knowledge-backup-staging/20261002`

Off-host target: `server2181.babypark.ua`

Off-host backup: `/var/backups/babypark-knowledge/20261002`

Recovery objects:
- `knowledge.bpenc` — AES-256-GCM ciphertext;
- `knowledge.manifest.json` — signed recovery manifest;
- `knowledge.keywrap.bin` — data key wrapped for off-host recovery;
- `restore-proof.json` — scratch restore evidence.

Ciphertext SHA-256:
`72ce2db14c2b14afb84b93fc0e8a5fc6f1f7db1a840fd2eb6237194824b9ec62`

Restored plaintext SHA-256:
`c74864a4cc12744d6572724ab1f4a43b76ad2b52d33bd4dfa1eb24800ed55f7e`

Semantic evidence SHA-256:
`94344d926936e457997ca587ad2d6afbc827fb85c7fcb99b9e9d2252008dac80`

Result:
- off-host copy verified;
- scratch SQLite integrity: ok;
- ledger/hash semantic restore: PASS.

### CatalogService runtime

Systemd: `babypark-catalog-ingest.service`

Expected state:
- enabled;
- active.

Release symlink: `/opt/babypark-integration/catalog-current`

Current release: `/opt/babypark-integration/releases/20261002T1038Z-e63a4dfc`

Current accepted generation:
`g_bcd3c2836b25ab4252f8f5510c769f260e0597092fea8aff`

Previous generation:
`g_3f82b2487806f6caaea95ad9aca94552f2eeb39844a2de87`

IdentityStore: `/var/lib/babypark-catalog/identity.sqlite`

Identity schema/revision:
- schema v2;
- revision 65506.

Reviewed physical-store xrefs:
- Drupal `1575` -> `store_a939ba30-11cb-4a08-b71a-7b7947d44747`;
- Drupal `747` -> `store_83cff1ad-fb41-4ec9-aeb1-7c4b184d084c`.

These canonical IDs are BabyPark authority. Drupal IDs and future Magento MSI `source_code` values are xrefs only.

Replacement FULL accepted run:
- run_id: `79c1d873_0b68_4ac0_94e0_d4a62c573e04`;
- run_digest: `644de366d5f7c2b843daaf4568e4fd0e3bbae1a981469b46310f10f078a5d2ca`;
- final_seq: 176;
- source spool manifest SHA-256:
  `c18bbb1740e7722f2c0f0138b37bf162dbedd1874b481cdde505bd4fa3491935`.

Independent production Link A:
- work root: `/var/lib/babypark-catalog/link-a-work-prod-20261002-canonical`;
- result: PASS;
- mismatch_count: 0;
- FTS probes: 48/48 PASS;
- generation manifest SHA-256:
  `ba157e2cdc2b01b3ba692ba0a9ef20d17790d2528cc3b0af74969a3b2fb53335`.

Recovery roots retained intentionally:
- normal: `/var/lib/babypark-catalog/backup`;
- pre-cutover v1: `/var/lib/babypark-catalog/backup-cutover-20261002`;
- post-migration v2: `/var/lib/babypark-catalog/backup-cutover-v2-20261002`.

Do not delete the v1 cutover set solely because v2 is current; it is explicit pre-cutover rollback evidence.

## Drupal/exporter host: `server2181.babypark.ua`

Production source role:
- Drupal read-only export;
- D2b producer/sender;
- independent off-host recovery target for Knowledge.

Frozen source spool used for canonical-store replacement:
`/var/lib/babypark-exporter/spools/snapshot-1790790967512290.ready`

Spool manifest SHA-256:
`c18bbb1740e7722f2c0f0138b37bf162dbedd1874b481cdde505bd4fa3491935`

Producer provenance remains:
`/opt/babypark-exporter/releases/prod-20260930-7d98905b`

Replacement sender release:
`/opt/babypark-exporter/releases/sender-20261002-41c6916a`

Replacement sender durable state:
`/var/lib/babypark-exporter/sender-runs-replacement-20261002`

Replacement systemd proof unit:
`bp-prod-catalog-replacement-20261002.service`

The producer release remains intentionally separate from the sender release: changing sender/control logic must not rewrite the provenance of the frozen source spool.

## Existing BabyPark integration runtime

Viber/Chatwoot bridge:
- systemd: `babypark-integration-v2.service`;
- release symlink: `/opt/babypark-integration/current`;
- durable DB: `/var/lib/babypark-integration/bridge.sqlite`;
- listener: `127.0.0.1:3102`.

This runtime is independent from Knowledge and Catalog release symlinks.

## Change discipline

Before changing any object in this registry:

1. identify the authority it belongs to;
2. capture current runtime state and recovery coverage;
3. make the smallest isolated change;
4. verify the security/fail-closed path, not only the happy path;
5. update this registry and `CURRENT_STATE.md` in the same operational slice;
6. never delete rollback/recovery objects merely because a newer release exists;
7. never put secrets into Git.

For future automation, this registry should become machine-readable in addition to this human document, but the first implementation must preserve the same explicit ownership and authority boundaries.
