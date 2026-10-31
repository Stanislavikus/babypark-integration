# BabyPark Infrastructure Registry

Status: EVIDENCE — NON-NORMATIVE production object inventory.
Applies to: BabyPark integration-owned infrastructure and recovery identities.
Supersedes: earlier snapshots of this registry; historical entries retained below.
Last verified: 2026-10-26 for the preview observations below; other dates remain entry-specific.
Owner: BabyPark
Purpose: human-readable inventory of production objects that exist outside Git or whose runtime identity/path must remain recoverable from Git.

## Operating rule

Every manually created production object must be recorded here in the same change that creates or materially changes it.

Never store passwords, API secrets, private keys, session cookies or recovery plaintext keys in this file. Record only object identity, purpose, location, owner, expected state and where secret material is stored.

`docs/CURRENT_STATE.md` records current system truth and acceptance state. This file answers a different question: **what objects exist, where are they, and why do they exist?**

## SES Email Continuity infrastructure — observed 2026-10-28 (NOT CUSTOMER ACTIVE)

Status: current **observed** external resources; operator BabyPark. This inventory includes manual AWS/DNS/Chatwoot configuration changes performed during PR #150 and the synthetic-only pilot; see linked checkpoints in [PR #150](https://github.com/Stanislavikus/babypark-integration/pull/150). No secrets or buyer email addresses are recorded here.

| Resource | Identity / location | Observed current state and purpose | Recovery / ownership |
| --- | --- | --- | --- |
| Chatwoot WebWidget continuity | Host `chatwoot-fra1-01`, application `/home/chatwoot/chatwoot`, account 1, Website Inbox 2, channel 2 | `continuity_via_email=false`, `enable_email_collect=false`, pre-chat off; account incoming email domain remains `reply.babypark.ua`, email account feature enabled | BabyPark; native Chatwoot Inbox configuration; no change to other inboxes; current .env original copy `/home/chatwoot/chatwoot/.env.before-pr150-ses-20261027` (protected, do not publish) |
| SES classic Receiving (eu-central-1, AWS account 763345000395) | Rule set `babypark-chatwoot-website-inbound-inactive`, rule `website-reply-uuid` | **No active rule set**; single disabled rule, configured recipient `reply@reply.babypark.ua`, SNSAction UTF-8 | BabyPark; do not activate except after exact fit/approval; retain rollback identity |
| SNS HTTPS delivery | `arn:aws:sns:eu-central-1:763345000395:babypark-chatwoot-website-inbound`; HTTPS endpoint `https://chat.babypark.ua/rails/action_mailbox/ses/inbound_emails` | Confirmed subscriber, native `numRetries=63` retry policy; SNS subscription ARN suffix `ab2c3d8a-d35a-4e93-a339-af3324a9c510`; raw SNS envelope preserved | BabyPark/AWS; do not unsubscribe/rewrite topic on ordinary release |
| SNS DLQ | `arn:aws:sqs:eu-central-1:763345000395:babypark-chatwoot-website-sns-dlq` | Native subscription RedrivePolicy target; `MessageRetentionPeriod=345600` (4 days); SSE-SQS; read-back queue empty on 2026-10-28 | BabyPark; queue retention is **not** delivery/replay automation; recovery/alerting still to verify |
| Reply mail DNS | `reply.babypark.ua` (technical subdomain), Cloudflare MX `10 inbound-smtp.eu-central-1.amazonaws.com` | Published and resolves; apex `babypark.ua` Zoho MX preserved | BabyPark/Cloudflare; never alter apex corporate MX as part of SES release |
| Chatwoot inbound runtime | `/home/chatwoot/chatwoot/.env`, systemd `chatwoot-web.1` + `chatwoot-worker.1` | `RAILS_INBOUND_EMAIL_SERVICE=ses`, `MAILER_INBOUND_EMAIL_DOMAIN=reply.babypark.ua`, `ACTION_MAILBOX_SES_SNS_TOPIC` set to above SNS topic; sender `support@babypark.ua`; values/credentials remain in protected env | BabyPark; preserve domain even when continuity off, no new credentials and no core patch |
| Synthetic-only evidence | Website Contact #134, ContactInbox #136, conversation #55, UUID stored by Chatwoot | Approved one-address pilot Gmail↔SES↔Chatwoot completed and reverted; no real customer-data cohort | BabyPark; do not delete/merge synthetic record as accidental cleanup; no customer contact identifiers in Git |
| Recovery | DigitalOcean Droplet 597177915, daily backups enabled, prior isolated backup restore drill | Backup IDs/restore evidence documented in PR #155 and PR #150; recovery drill does not establish zero data loss | BabyPark/DO; verify latest recoverability before activation |

**Drift and rollback:** do not treat the frozen historical inventory below as current for SNS subscriber, S3 staging, SES sandbox or email receipt status. For routine stop of future outgoing continuity, disable channel setting, drain scheduled `ConversationReplyEmailJob`, leave SES inbound **receiving** active for previously mailed Reply-To values. Disabling all inbound while mail recipients can still reply causes an SMTP 550 bounce (observed after the synthetic test). An AWS maintenance BounceAction is an emergency refusal, **not** ordinary customer-safe rollback.

## 2026-10-26 — five existing Callback previews (R2 G2 current inventory)

Source: owner-supplied independent read-only filesystem inspection on host
`server2181.babypark.ua`, PR #154 [comment #6423267053](https://github.com/Stanislavikus/babypark-integration/pull/154#issuecomment-6423267053).
These are observed existing manually placed production-webroot artifacts,
classified as unlinked testing/visual previews, **not production Callback
activation**. Owner: BabyPark. The originating owner-approved staging/visual
work is recorded in the PR; this inventory authorizes no new files or actions.
No cleanup or deletion was performed. Unlinked/noindex is not access control;
use synthetic data only. Filesystem UID/mode and a complete listing of every
folder's auxiliary assets were not supplied; no such measurements are claimed.

| Purpose / classification | Confirmed exact file path | Observed index.html SHA-256 |
| --- | --- | --- |
| V11 candidate, retained testing preview | `/home/babypark/sites/babypark.ua/sites/all/themes/babypark2/assets/contact/preview-callback-v11-5c6586d9/index.html` | `c9a79677de52238abe451c1b64a4d8546ec3794cb216fd79d35cf0de6dbf9c8c` |
| Earlier V1 candidate, retained historical staging preview | `/home/babypark/sites/babypark.ua/sites/all/themes/babypark2/assets/contact/preview-callback-v1-4432d4a895546c29ce630503675da359/index.html` | `121ae5d84a3436c6d0f99aedb1b881c6222bd40390013e9cdb8322cf6c96ae7b` |
| Owner-approved visual iteration, retained visual preview | `/home/babypark/sites/babypark.ua/sites/all/themes/babypark2/assets/contact/preview-callback-visual-approved-20261026/index.html` | `060f378586899a75d38550343809599e554da07a1c9063aa00cbcbdced031714` |
| Font iteration, retained visual preview | `/home/babypark/sites/babypark.ua/sites/all/themes/babypark2/assets/contact/preview-callback-visual-chatwoot-font-20261026/index.html` | `53c1eb1a8b092cb092eefb8a065f10488532aadaec7f9b8dec2e57717020d186` |
| Emblem iteration, owner-approved V12 visual reference (synthetic success, not V12 send proof) | `/home/babypark/sites/babypark.ua/sites/all/themes/babypark2/assets/contact/preview-callback-visual-chatwoot-emblem-20261026/index.html` | `772420cfc6914c1c03c15f1435900674b3aa597a3d39615bb47257ed49697cd0` |

The same inspection reports `bp-emblem-avatar-64.png` for the emblem preview:
SHA-256 `fa5a882453439306686df1e4c97387e601de6f9075e519082619fd29aa628d02`,
URL GET 200. Its exact on-host asset path was not provided; do not infer one.
The separately active live launcher remained JS SHA-256
`b763b3deeffddc42cc88b2d6589b500673a933685d24c224ef7eda8afbdc4f17`,
CSS `133c212c33302a3e172a703fa429ac1b906b6e14f7c7ab76d1eea21d99718240`.
Those live hashes do not identify any preview JS/CSS or certify V12 deployment.

Owner/recovery/cleanup strategy applies individually to **each of the five**:
retain unchanged under BabyPark ownership until explicit owner cleanup GO.
Before any separately authorized removal, resolve and confirm the exact named
directory beneath the contact asset root, inventory all contained files and
symlinks, check current hashes against fresh approved evidence, and preserve a
verified recoverable copy outside the webroot. Unexpected contents/hash drift
must stop cleanup. Delete only specifically approved files, never parent assets,
live config, sibling previews or rollback copies; remove the named directory
only when empty. Then verify both index and directory URLs return 404 and live
L1 assets remain unchanged. **No recovery archive, removal, or 404 check for
these five is claimed here.** Existing historical three-file guards below are
not sufficient authority for deleting any currently observed folder.

## Historical 2026-10-25 — temporary Callback preview asset refresh

**Current isolated preview assets, updated after user asked about visible comment limit and name validation:** exact folder remains `/home/babypark/sites/babypark.ua/sites/all/themes/babypark2/assets/contact/preview-callback-v1-4432d4a895546c29ce630503675da359/`; there are still exactly three owned files. As of this entry the temporarily staged JS is SHA256 `f46526e052bfbea0ff03c054f702246ef078e3c5f5360b6c045e9b694a688ba3`, CSS `7b2e9f96cd1a08f47faa7a3a51202ba58fc98ca22dd811d1e95c6ee8e2ec4b52`, and index.html `121ae5d84a3436c6d0f99aedb1b881c6222bd40390013e9cdb8322cf6c96ae7b`. Exact source at Draft PR #154 commit `c87e6b3c3e872d2fda23ef4e41140f1e64a4be96`, tree `7e6f6ef9c9a4149c350669e92b02babecb82c861`; page references version-busted `?v=c87e6b3c`, loads only the existing public `../config.js` and enables Callback only inside that isolated document. **These SHA values supersede the older 14a795 stage asset digests immediately below; historical browser POST IDs there were observed only with the older JS and must not be attributed to the new commit.** Current CSS/JS URL HTTPS 200 and served SHA256 exact-match confirmed, public main launcher and config hashes still unchanged. The new counter is an interface-only change retaining native textarea maxlength=500. When owner completes acceptance, delete the isolated preview with the existing specific realpath/single-directory/three-file hash guards updated for these current hashes; both URL variants must return 404. No owner exact release/merge GO has been received.

## Historical 2026-10-25 — owner-approved Callback testing objects

**Host `chatwoot-fra1-01`; stock Chatwoot 4.18.0; account #1:** a new active native `AutomationRule` **ID #2**, name `BabyPark — Callback (friendly confirmation V1, staging)`, event `message_created`, no execution delay; two conditions `message_type = incoming` AND `content contains` **two-line string** `Ви замовили дзвінок\nЗворотний дзвінок: ` (literal newline stored, not a backslash+n string), only action `add_label callback`. Scope account-wide, no fixed team/inbox/assignee. Rule #2 was created under owner-approved staging on 2026-10-25 with native Chatwoot model validation. Existing native **rule #1** remains active and unchanged, matching legacy `BABYPARK_CALLBACK_V1`; the `callback` label and Website Inbox #2 stay unchanged. Active rule #2 must be retained while new cached clients may submit the friendly first line; do not remove or disable #1 while old clients may submit its legacy marker. **Staging rollback, only if separately authorized:** confirm exact object IDs/conditions and disable **only #2** using the native Automation UI/API, leaving #1 active; reverting site customer activation is NOT required because public Callback remains off. Native DB object is not a Chatwoot source patch and persists across app upgrades, but re-run precise installed-version Widget + automation smoke after upgrades.

**Host `server2181.babypark.ua`, same-origin unlinked staging page only:** temporary folder `/home/babypark/sites/babypark.ua/sites/all/themes/babypark2/assets/contact/preview-callback-v1-4432d4a895546c29ce630503675da359/` with `index.html` SHA256 `026c31c74e1af913ff195f78224f0c52b4bd587d0b62ce3e123ee25334d2d66b`, `babypark-launcher.js` SHA256 `d5502eaf7d8a713459c94b3f5858613506a92633b5ab37c1ff4d26e1ec841e4b`, `babypark-launcher.css` SHA256 `2248cf7dad143f26a13dcb540e8aa6583f38b8accd315ad5ec982ee329752404`. The runtime JS/CSS comes from Draft PR #154 HEAD `14a7953931ae4a6e8f2f65255741b74555406006` (tree `ce25ae2900672aa9028d1dd7b3420085f6edf6a7`); page loads parent `../config.js` without copying Website token and enables Callback **only within that page's in-memory config**. Publicly reachable if URL is known; unlinked + `noindex` are **not access control**, so no real customer PII may be used for tests. **Cleanup after owner check:** guard `realpath` exactly equal to the named directory, verify the three allowed files and exact SHA256, remove ONLY those three files, `rmdir` the empty named directory, verify its test URL 404; never delete parent production launcher assets or previous rollback copies.

**Staging test evidence identities, synthetic only, Chatwoot is transcript owner:** browser new-message #139 conversation #43, new→open→resolved case messages #140, #141, #148 in conversation #44 (Website Inbox #2). All real Widget form POSTs returned HTTP200 with positive IDs and one browser-exposed allowed ACAO header name. An additional independent signed HTTP/1.1 Widget request using a fresh stock SDK JWT in memory (synthetic message #150, conversation #45) returned HTTP200 and **one exact unmerged raw ACAO header** for `https://babypark.ua`; visitor JWT/browser profile were immediately discarded. This is a separate HTTP-header proof from the actual form-click evidence. The labels were explicitly removed only on synthetic conversation #44 before its open and resolved POSTs, then native rule #2 re-applied `callback`; the resolved thread reopened on incoming message. Synthetic browser profiles deleted. Keep records as governed Chatwoot messages; do not introduce a separate test transcript store. This staging approval is NOT an owner merge/go-live GO. Actual live deployed L1 asset hashes remain as captured in the 2026-10-24 section below. Detailed permanent production operation/rollback/upgrade records follow only after separate owner-approved customer cutover.

## 2026-10-24 — existing website launcher and native Callback staging objects

**Drupal production (L1 only; L2 customer form OFF):** `server2181.babypark.ua`, site root `/home/babypark/sites/babypark.ua`, active Drupal theme `babypark2`. Site attachment `sites/all/themes/babypark2/templates/html.tpl.php`; assets `sites/all/themes/babypark2/assets/contact/babypark-launcher.js`, `babypark-launcher.css`, `config.js` and local icons. The old Bitrix24 button loader was replaced on 2026-10-22 under an earlier owner-approved L1 cutover (Draft PR #148 records actual runtime). Pre-L2 L1 asset SHA256 from verified production: JS `b763b3deeffddc42cc88b2d6589b500673a933685d24c224ef7eda8afbdc4f17`, CSS `133c212c33302a3e172a703fa429ac1b906b6e14f7c7ab76d1eea21d99718240`, site config `2d31018517b2d15fc0073131bf91c806364c254ad766de7f636d017df761f078`. The `callback` config switch is NOT deployed. Existing L1 rollback preimages at `/home/babypark/.babypark-launcher-rollback/20261022-pr142/`; before L2 cutover create a separate versioned L1-preimage of JS/CSS/config/template and confirm restore + cache invalidation. Retain old L1 browser/cache behavior until L2 explicitly approved.

**Chatwoot production native callback objects (already staged by owner approval):** host `chatwoot-fra1-01`, installed upstream Chatwoot `v4.18.0`, account #1, Website Inbox #2. One account label `callback` (sidebar visible), one active rule `BabyPark — Callback (all inboxes)`, `message_created` for incoming messages containing `BABYPARK_CALLBACK_V1`, action **only** `add_label callback`; no team/agent/inbox hardcode. Existing shared Inbox and Unassigned queue remain unchanged; no Assignment Policy was installed as part of Callback. Rollback of Callback intake: disable the L2 site flag/assets; do **not** remove standard Widget chat, existing customer transcripts or unrelated team access. Native rule may be disabled through Chatwoot administration if explicitly required, with its current configuration recorded first.

**Nginx origin-scoped CORS (installed):** `/etc/nginx/sites-available/nginx_chatwoot.conf` on `chatwoot-fra1-01`, with `map $http_origin $bp_callback_cors_origin`, exact `location = /api/v1/widget/messages`, allowed `https://babypark.ua` and `https://www.babypark.ua`, methods POST/OPTIONS and `Content-Type, X-Auth-Token`; untrusted origins do not receive ACAO, actual valid L2 form POST not yet proven. Reload requires `nginx -t`, external preflight/POST header verification, and an owner-approved maintenance action. Rollback requires a fresh pinned pre-change Nginx preimage and reload; removal of this location does **not** disable regular Website chat.

**Chatwoot systemd log-level hardening (installed):** `/home/chatwoot/chatwoot/.env` contains `LOG_LEVEL=warn`. External drop-ins `/etc/systemd/system/chatwoot-web.1.service.d/log-level.conf` and `/etc/systemd/system/chatwoot-worker.1.service.d/log-level.conf` each contain `[Service]\nEnvironment=LOG_LEVEL=warn`. This is native runtime configuration outside Chatwoot's Git checkout, no core patch. After any upgrade, confirm both running processes have `LOG_LEVEL=warn`, Rails + ActiveJob logger level 2 and zero routine `Parameters:`/ActiveJob `with arguments:` events after restart. ERROR/WARN PII remains residual, journald historical data isn't retroactively erased. To roll back only the systemd hardening, remove both drop-ins, run `systemctl daemon-reload` and restart Web/Worker (the `.env` line remains `warn` unless separately changed); do not equate drop-in removal with restoration to INFO.

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

## SES Email Continuity — historical resources/inactive preparation (2026-10-23 to 2026-10-25)

The following PR #150 entries describe **prior resource states**. They do not override the 2026-10-28 as-built inventory above.

### Chatwoot employee system SMTP — AWS SES (2026-10-23)

Authority/owner: BabyPark infrastructure administrator (external mail transport: AWS SES classic, `eu-central-1`); canonical Chatwoot platform v4.18.0. Source/provenance: owner-authorized staff-only SES fit in Draft PR #150; no Chatwoot core patch, no custom email connector, no new Chatwoot inbox.

Operational identity:
- Live host: `chatwoot-fra1-01`, self-hosted Chatwoot application path `/home/chatwoot/chatwoot`.
- Recovery/diagnostic runbook (Git authority): [`docs/CHATWOOT_SES_MAIL_OPERATIONS_20261023.md`](CHATWOOT_SES_MAIL_OPERATIONS_20261023.md). Installed independent server mirror: `/home/chatwoot/operations/CHATWOOT_SES_MAIL_OPERATIONS.md` (`chatwoot:chatwoot`, `0644`, parent `0750`), verified byte-for-byte via Git blob `afedbe71e55e9a63c70705e84e74fa3e782dea68`, SHA-256 `9cbd4ef2b3d3d92b07b74b428b393570d257563d6107d9ae2999498e1b1add44`. No secrets stored in the runbook.
- Main Chatwoot config: `/home/chatwoot/chatwoot/.env`; owner `chatwoot:chatwoot`, mode `0600`; contains SMTP credential values: **never copy contents to Git/logs/diagnostics**.
- Original env recovery snapshot: `/root/.babypark-chatwoot-smtp/pre-ses.env` (root-only `0600`) and root-only staged source `/root/.babypark-chatwoot-smtp/staged.env` (root-only `0600`). Directory `0700`. These are sensitive recovery objects, not removable merely because deployment is active.
- Service units: `chatwoot-web.1.service`, `chatwoot-worker.1.service`; restart required after changing SMTP env.
- SES SMTP endpoint: `email-smtp.eu-central-1.amazonaws.com:2587`, STARTTLS, TLS peer verification; IAM SMTP user name `babypark-chatwoot-ses-smtp`. Its SMTP credentials are held only in server-protected secret location and owner's private AWS record; not in Git.
- Application sender: `BabyPark <support@babypark.ua>`, global `MAILER_SENDER_EMAIL`. `contact@babypark.ua` remains Zoho group alias/public contact; technical `reply.babypark.ua` email ingress NOT implemented or activated.
- IAM group `AWSSESSendingGroupDoNotRename`, inline policy `AmazonSesSendingAccess`: `ses:SendRawEmail`, From limited to `support@babypark.ua` or `contact@babypark.ua`; recipient `ForAllValues:StringLike ses:Recipients=[*@babypark.ua]` and `Null ses:Recipients=false`. AWS IAM policy simulation confirmed internal recipient ALLOW, outside or mixed recipients DENY, forbidden sender DENY.
- SES `babypark.ua` verified, DKIM SUCCESS; domain/root MX remains Zoho; SES Production access not enabled, Sandbox 200/24h and 1/s. Bounce/complaint suppression enabled.
- Recovery: copy `pre-ses.env` back to a secure temporary file under Chatwoot directory, retain `chatwoot:chatwoot` mode `0600`, atomically replace `.env`, restart both listed services, verify local/public Chatwoot HTTP and Sidekiq active. Rollback intentionally disables this SMTP transport; do not delete backup until an explicit recovery-lifecycle decision.
- Do **not** weaken recipient IAM restriction or use SES for customer email based on this employee-only stage. Staff email recipient access is distinct from Website conversation continuity, SES S3/SNS ingress and team customer-coverage automation.

Verified after cutover: SMTP endpoint authentication PASS via owner local TTY *without email send*; application configuration and both systemd units active; local Chatwoot HTTP 200 and public `https://chat.babypark.ua/` HTTP 200. **First employee password reset reportedly succeeded** and SES aggregate send metrics corroborated one new delivery attempt with no bounce/reject/complaint; independent account-login confirmation was not collected. The receiving side of `support@babypark.ua` in Zoho has not been proven.

### Chatwoot Website Email Continuity — inactive SES Receiving scaffold (2026-10-24)

Status: **AWS resources exist; SES rule set NOT active, rule disabled, no SNS subscribers, S3 bucket empty. No customer inbound email enabled.** Owner approved only this exact inactive slice, bound to the SHA-256 `6d9ddd3e7a2c608cabf1a09abe053fc0aeb8fa3f5cc8d4c5c17b9000b4b1318f` of `docs/CHATWOOT_SES_RECEIVING_INACTIVE_FIT_20261024.md`, binding alternatives scan `2928d8be42b508deaac4a036f869d538cc9c63ddb71a897840fb62138c1f4932`. AWS account `763345000395`, region exclusively `eu-central-1`. Owned by BabyPark infrastructure administration. Check current AWS before acting; these facts were independently read back after creation.

- **S3 bucket:** `babypark-chatwoot-ses-receiving-763345000395-euc1`; location `eu-central-1`; object prefix `website-replies/`; bucket-level BlockPublicAcls / IgnorePublicAcls / BlockPublicPolicy / RestrictPublicBuckets all true. Object Ownership `BucketOwnerEnforced`; default `AES256` SSE-S3; no SES client-side KMS key; versioning not enabled and no Object Lock/default retention. Bucket policy: only `ses.amazonaws.com` allowed `s3:PutObject` to `arn:aws:s3:::babypark-chatwoot-ses-receiving-763345000395-euc1/website-replies/*`, with exact `aws:SourceAccount=763345000395` and `aws:SourceArn=arn:aws:ses:eu-central-1:763345000395:receipt-rule-set/babypark-chatwoot-website-inbound-inactive:receipt-rule/website-reply-uuid`; deny insecure S3 transport. Lifecycle: expire `website-replies/` objects after 14 days. This 14-day staging value does not authorize storage of real customer mail; privacy/retry/retention must be gated again before activation.
- **SNS Standard topic:** `arn:aws:sns:eu-central-1:763345000395:babypark-chatwoot-website-inbound`; exactly **zero** subscriptions (no Chatwoot callback). Standard owner-account topic policy preserved; separately added `ses.amazonaws.com` `SNS:Publish` with the exact same rule `SourceArn` and `SourceAccount`. No SNSAction, notifications or customer messages. No new Lambda, container, bridge, getmail6 or Chatwoot patch.
- **Classic SES rule set:** `babypark-chatwoot-website-inbound-inactive`, **NOT active** (verified `DescribeActiveReceiptRuleSet` returns no metadata); sole receipt rule `website-reply-uuid` has `Enabled=false`, `ScanEnabled=true`, `TlsPolicy=Optional`, sole recipient `reply@reply.babypark.ua` (classic SES rule also matches `reply+UUID@reply.babypark.ua`). Exactly one action, `S3Action` with the above bucket, prefix and `TopicArn`. No separate SNSAction, no KMS key.
- **AWS creation-time S3 probe:** SES created the single 645-byte noncustomer `website-replies/AMAZON_SES_SETUP_NOTIFICATION` test object while validating the S3 action; its exact key and size were independently identified and this *only* probe was removed. The final bucket inventory shows **0 objects**.
- **Unaffected services:** no DNS MX for `reply.babypark.ua`; apex `babypark.ua` MX still Zoho, Zoho mailboxes unaffected; live Chatwoot 4.18.0 `.env` / web / worker unchanged; outbound SES SMTP `babypark-chatwoot-ses-smtp` staff-only IAM unchanged (external recipients still denied), SES `ProductionAccessEnabled=false` Sandbox. No SES subscription and no user/customer email test occurred.

**Recovery / rollback identity:** inactive rule and entire rule set may be deleted only after a separate owner approval and independent readback of *continued inactive state*; SNS topic has zero subscribers; S3 bucket requires verified zero objects before deletion and separate owner authorisation. Do not remove any unknown object or modify staff SMTP, main MX or verified identities. For later activation, separately approve privacy/DPA, real-customer ingress, S3/GetObject IAM reader, DNS, SNS HTTPS endpoint, Chatwoot SES settings, independent synthetic/retry/attachment tests and SES external-sending permissions. This inactive checkpoint grants NONE of them.

### Chatwoot SES Receiving Phase 2 — SQS recovery candidate + uncredentialed S3 reader (2026-10-25)

**State: created, INACTIVE, synthetic-only permission; NOT a live SNS DLQ or production ingress.** Explicit owner approval bound to Phase-2 fit SHA-256 `72edc630b3da8029595967253cf3bdb72bdcc263dc6c4743df3b24137187b2c4` and scan SHA-256 `1216f93900ace623e7a5870c465ba0cd3bfe93dc566d2fd0162bf0ef558bdf97`, documents `docs/CHATWOOT_SES_RECEIVING_PHASE2_FIT_20261025.md` / `docs/CHATWOOT_SES_RECEIVING_PHASE2_SCAN_20261025.md`.

- AWS account `763345000395`, region `eu-central-1`.
- IAM user **`arn:aws:iam::763345000395:user/babypark-chatwoot-ses-s3-reader`** (tags Project BabyPark-Chatwoot, Purpose SES-Receiving-S3-Read, Deployment inactive-no-credentials). Inline identity policy **`ChatwootInboundS3GetObjectOnly`**: sole action `s3:GetObject`, sole resource `arn:aws:s3:::babypark-chatwoot-ses-receiving-763345000395-euc1/website-replies/*`. No group or managed policy. **Zero access keys**, no console-login profile created, no Chatwoot credentials or SDK client configured, no SMTP IAM/user change. Principal-policy simulation **8/8 expected allow/deny**: GetObject in prefix allowed; PutObject, DeleteObject, GetObjectVersion, GetObject outside prefix, ListBucket, GetBucketPolicy, IAM CreateAccessKey denied. This is policy simulation, not a real SDK credential/S3 read test.
- SQS Standard queue **`arn:aws:sqs:eu-central-1:763345000395:babypark-chatwoot-website-sns-dlq`** at `https://sqs.eu-central-1.amazonaws.com/763345000395/babypark-chatwoot-website-sns-dlq`. Queue attribute `SqsManagedSseEnabled=true` (SSE-SQS, no customer KMS key), four-day staging/default `MessageRetentionPeriod=345600`, **0** visible/not-visible/delayed messages. Queue policy allows only `sns.amazonaws.com` `sqs:SendMessage` from **exact** `arn:aws:sns:eu-central-1:763345000395:babypark-chatwoot-website-inbound` SourceArn and account `763345000395`. No SQS consumer, no subscription redrive attachment. This queue is a **candidate**, not yet a proven encrypted SNS DLQ.
- **Compatibility HALT:** AWS SNS DLQ documentation states an encrypted SQS DLQ requires a customer-managed KMS key/policy granting SNS KMS rights. The created queue is SSE-SQS only; *actual SNS→SQS DLQ compatibility remains UNPROVEN*, and SSE-SQS alone may not satisfy the documented SNS DLQ prerequisite. No extra KMS key/cost authorized, and NO SNS subscription/redrive policy configured. Direct synthetic SQS SendMessage/read/delete execution was blocked by a tool safety check, was **not retried or claimed PASS**. Configuration readback PASS, synthetic message roundtrip **NOT RUN**. Resolve through official AWS native configuration and a separate bounded test before customer ingress.
- As-of creation readback: SES classic rule set remains unselected, rule `website-reply-uuid` Enabled=false; SNS topic has zero subscriptions; S3 bucket `babypark-chatwoot-ses-receiving-763345000395-euc1` contains **0 objects**; Zoho/DNS/Chatwoot/SMTP untouched. These objects do not accept customer messages.
- **Recovery/rollback identity:** before deletion, require fresh AWS identity/empty queue/no access keys/no SNS redrive attachment and separate owner approval. Preserve queue and IAM user for bounded follow-up; do not silently create KMS, keys, subscribers, DNS, customer delivery or real messages. No raw customer mail or secrets exist in this phase.

### Chatwoot SNS encrypted DLQ — synthetic operational proof, no KMS (2026-10-25)

**Change and recovery evidence:** isolated owner-approved `SNS → deliberate denied SQS subscriber → existing SSE-SQS DLQ` end-to-end proof, detailed in `docs/CHATWOOT_SES_SSE_SQS_DLQ_PROOF_RESULT_20261025.md`. Bound owner approved exact fit SHA-256 `765243fb0ddb9772a01e608a7222b525e9d2cd0eb54f26f3357b5d94690b13f4`; no customer messages, sender/SMTP, DNS, Chatwoot or SES activation.

- Existing permanent resource: `arn:aws:sqs:eu-central-1:763345000395:babypark-chatwoot-website-sns-dlq`, Standard `SqsManagedSseEnabled=true`, no customer KMS key, retention 345600 seconds, source policy allows `sns.amazonaws.com` `sqs:SendMessage` only from `arn:aws:sns:eu-central-1:763345000395:babypark-chatwoot-website-inbound` and account 763345000395.
- Temporary primary SQS queue CREATED THEN DELETED: `arn:aws:sqs:eu-central-1:763345000395:babypark-chatwoot-sns-dlq-proof-primary-20261025`; had intentional SNS SendMessage Deny and SSE-SQS enabled. Verified zero contents and no subscribers before deletion; post-delete queue not found.
- Temporary SNS `sqs` subscription CREATED THEN UNSUBSCRIBED: `arn:aws:sns:eu-central-1:763345000395:babypark-chatwoot-website-inbound:9e9f8c9f-8226-46be-9404-d44afc9f1788`. It carried `RedrivePolicy` to the permanent DLQ and filter `bp_test_only=20261025_sse_sqs_proof`; no subscriber remains.
- Exactly one synthetic SNS notification MessageId `fea45289-972a-5819-975e-31de2b47efbe` was published. **Proof PASS:** direct SQS read from existing SSE-SQS DLQ returned `Notification.MessageId` exactly matching the SNS Publish result and exact synthetic marker; deleted this *specific matching test message* and verified queue empty. No KMS operations or keys added; supports native SNS DLQ even though some vendor notes broadly mention custom KMS for encrypted queues.
- Independent **13/13 AWS final readback** 2026-10-25T08:16:42Z: original DLQ remains solely, empty, SSE-SQS without KMS, policy/retention retained, zero SNS subscribers, SES rule set inactive and rule disabled, S3 zero objects, IAM S3 reader zero credentials, no customer-data flow. No new permanent objects from this PoC.
- **Remaining recovery boundary:** this is SQS recipient failure → SNS DLQ proof only. Chatwoot HTTPS error/retry, post-204 Sidekiq, actual synthetic email MIME→same conversation, alert/replay and privacy review untested. Before production SNS HTTPS subscription, separately scope/freeze required changes and approval; do not reactivate receipt rules or publish technical MX based only on this test. Existing permanent DLQ and recovery metadata must not be deleted as cleanup.

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
