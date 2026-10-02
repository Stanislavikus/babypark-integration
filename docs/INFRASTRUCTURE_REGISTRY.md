# BabyPark Infrastructure Registry

Status: CURRENT
Last verified: 2026-10-02
Owner: BabyPark
Purpose: human-readable inventory of production objects that exist outside Git or whose runtime identity/path must remain recoverable from Git.

## Operating rule

Every manually created production object must be recorded here in the same change that creates or materially changes it.

Never store passwords, API secrets, private keys, session cookies or recovery plaintext keys in this file. Record only object identity, purpose, location, owner, expected state and where secret material is stored.

`docs/CURRENT_STATE.md` records current system truth and acceptance state. This file answers a different question: **what objects exist, where are they, and why do they exist?**

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
