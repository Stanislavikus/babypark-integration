# Catalog ingest operator runbook (production deployment)

This runbook covers BabyPark production deployment of CatalogService only. It does not
connect Drupal or send a FULL ingest request.

CatalogService uses a dedicated release pointer separate from the Viber/Chatwoot gateway:

```text
/opt/babypark-integration/catalog-current
```

The existing gateway continues using:

```text
/opt/babypark-integration/current
```

Do not modify `/opt/babypark-integration/current` during Catalog deployment.

## Production topology

```text
Drupal outbound IP:        77.83.102.249
chat.babypark.ua origin:   161.35.78.167
Catalog local listener:  127.0.0.1:8081
Public ingress host:       https://chat.babypark.ua
```

Public Catalog paths (exact only):

```text
/api/catalog/ingest/v1/full
/api/catalog/ingest/v1/state
```

Catalog `/health` is **not** exposed publicly. Test Catalog health only at:

```text
http://127.0.0.1:8081/health
```

Existing public Chatwoot health remains:

```text
GET https://chat.babypark.ua/health → {"status":"woot"}
```

D1 must not break, replace, or intercept that route.

### Nginx IP allowlist assumption

The Catalog Nginx snippet allows only `77.83.102.249` (Drupal exporter outbound IP).
There is currently no Cloudflare or other reverse proxy between Drupal and the
`chat.babypark.ua` Nginx listener.

> If the Drupal exporter outbound IP changes, or a reverse proxy/CDN is introduced in
> front of `chat.babypark.ua`, this allowlist assumption must be revalidated before
> ingestion continues.

BP1 authentication remains mandatory regardless of the IP allowlist.

### Body size invariant

Nginx `client_max_body_size 1m` must remain aligned with the application limit of
`1,048,576` bytes. Do not enlarge either boundary in D1.

### Timeout rationale

Nginx proxy timeouts are:

```text
proxy_connect_timeout 3s
proxy_send_timeout 60s
proxy_read_timeout 300s
```

A FULL request may synchronously perform finalization, certification, FTS rebuild,
publication, and recovery coverage. Node `requestTimeout=30000` is a request-receive
timeout, not an application-processing deadline after the body has been received.

## Operator variables

Use these in all examples on the production host:

```sh
CATALOG_RELEASE=/opt/babypark-integration/catalog-current
CATALOG_DATA=/var/lib/babypark-catalog
```

Every `catalog-ops` invocation must run as `babypark-catalog`, not root:

```sh
runuser -u babypark-catalog -- \
  /usr/bin/node "$CATALOG_RELEASE/scripts/catalog-ops.mjs" <command> \
  --identity="$CATALOG_DATA/identity.sqlite" \
  --replay="$CATALOG_DATA/replay.sqlite" \
  --catalog-dir="$CATALOG_DATA/catalog" \
  --backup-root="$CATALOG_DATA/backup"
```

Do **not** use `npm run catalog:ops` in production operator commands. Recovery
directories require ownership by `process.geteuid()`; running as root is invalid for
the production service ownership model.

## Durable paths (frozen)

```text
/var/lib/babypark-catalog/identity.sqlite
/var/lib/babypark-catalog/replay.sqlite
/var/lib/babypark-catalog/catalog
/var/lib/babypark-catalog/backup
```

Parent directory `/var/lib/babypark-catalog` must be owned `babypark-catalog:babypark-catalog`
with mode `0700`.

## Release construction

The production server may have an old working checkout on a historical branch. Do **not**
deploy its working tree.

1. Record the approved Git SHA for this deployment (example: `98d20c213cf214dd0529cc7b4487985fd372fcee`).
2. Fetch and verify:

```sh
git -C /path/to/babypark-integration fetch origin
git -C /path/to/babypark-integration rev-parse origin/main
# must equal the approved exact SHA
```

3. Construct a fresh immutable release from the exact SHA:

```sh
APPROVED_SHA=<approved-sha>
SHORT_SHA=$(git -C /path/to/babypark-integration rev-parse --short "$APPROVED_SHA")
RELEASE_DIR=/opt/babypark-integration/releases/$(date -u +%Y%m%dT%H%M%SZ)-${SHORT_SHA}

mkdir -p "$RELEASE_DIR"
git -C /path/to/babypark-integration archive "$APPROVED_SHA" | tar -x -C "$RELEASE_DIR"
chown -R root:root "$RELEASE_DIR"
chmod -R a+rX "$RELEASE_DIR"
```

Requirements:

- release directory root-owned;
- readable and traversable by `babypark-catalog`;
- no editing inside the immutable release;
- no `npm install` required for Catalog runtime (no external runtime npm dependencies).

4. Atomically point the Catalog release symlink:

```sh
ln -sfn "$RELEASE_DIR" /opt/babypark-integration/catalog-current
```

Do not modify `/opt/babypark-integration/current`.

## Provisioning order

### Root actions

1. Verify approved Git SHA (`origin/main` equals the approved exact SHA).
2. Stage immutable release (see above) and update `catalog-current`.
3. Create system user/group if absent:

```sh
getent group babypark-catalog >/dev/null || groupadd --system babypark-catalog
getent passwd babypark-catalog >/dev/null || useradd --system --gid babypark-catalog \
  --home-dir /var/lib/babypark-catalog --shell /usr/sbin/nologin babypark-catalog
```

4. Create and chown the private durable parent:

```sh
install -d -o babypark-catalog -g babypark-catalog -m 0700 /var/lib/babypark-catalog
```

5. Create `/etc/babypark-catalog-ingest.env` (see Environment file below).
6. Install systemd and Nginx assets when appropriate (Nginx after local disabled
   verification; see below).

### Service-identity actions

After `/var/lib/babypark-catalog` is `babypark-catalog:babypark-catalog` mode `0700`,
run bootstrap and recovery steps as `babypark-catalog`.

Correct first-bootstrap order:

```text
service user exists
→ durable parent owned 0700
→ catalog-ops bootstrap as babypark-catalog
→ catalog-ops backup as babypark-catalog
→ catalog-ops backup-status as babypark-catalog
→ validate BOOTSTRAP recovery set as babypark-catalog
→ only then start CatalogService
```

## Environment file

Path: `/etc/babypark-catalog-ingest.env`
Ownership: `root:root`
Mode: `0600`

Initial fuse:

```text
CATALOG_INGEST_ENABLED=false
```

Frozen values:

```text
CATALOG_INGEST_HOST=127.0.0.1
CATALOG_INGEST_PORT=8081

CATALOG_BP1_AUDIENCE=babypark-catalog-prod
CATALOG_BP1_MAX_AGE_SEC=300

CATALOG_IDENTITY_PATH=/var/lib/babypark-catalog/identity.sqlite
CATALOG_REPLAY_PATH=/var/lib/babypark-catalog/replay.sqlite
CATALOG_STORAGE_DIR=/var/lib/babypark-catalog/catalog
CATALOG_BACKUP_ROOT=/var/lib/babypark-catalog/backup
```

BP1 secret requirements:

- cryptographically generated on the production host;
- never committed to Git;
- never logged or echoed in operator output;
- initially a D1-local probe KID (not yet copied to Drupal);
- set via `CATALOG_BP1_KEYS_JSON` in the env file.

See `deploy/catalog-host/catalog-ingest.env.example` for the JSON key format. Future
Drupal exporter credential provisioning is D2 scope.

## BOOTSTRAP recovery proof

Before first service start, as `babypark-catalog`:

```sh
runuser -u babypark-catalog -- \
  /usr/bin/node "$CATALOG_RELEASE/scripts/catalog-ops.mjs" bootstrap \
  --identity="$CATALOG_DATA/identity.sqlite" \
  --replay="$CATALOG_DATA/replay.sqlite" \
  --catalog-dir="$CATALOG_DATA/catalog" \
  --backup-root="$CATALOG_DATA/backup"

runuser -u babypark-catalog -- \
  /usr/bin/node "$CATALOG_RELEASE/scripts/catalog-ops.mjs" backup \
  --identity="$CATALOG_DATA/identity.sqlite" \
  --replay="$CATALOG_DATA/replay.sqlite" \
  --catalog-dir="$CATALOG_DATA/catalog" \
  --backup-root="$CATALOG_DATA/backup"

runuser -u babypark-catalog -- \
  /usr/bin/node "$CATALOG_RELEASE/scripts/catalog-ops.mjs" backup-status \
  --identity="$CATALOG_DATA/identity.sqlite" \
  --replay="$CATALOG_DATA/replay.sqlite" \
  --catalog-dir="$CATALOG_DATA/catalog" \
  --backup-root="$CATALOG_DATA/backup"
```

Expected `backup-status` output:

```text
authority.state = BOOTSTRAP
coverage = COVERED
```

Then validate the BOOTSTRAP recovery set (no `--generation` argument for BOOTSTRAP):

```sh
runuser -u babypark-catalog -- \
  /usr/bin/node "$CATALOG_RELEASE/scripts/catalog-ops.mjs" validate-restore \
  --identity="$CATALOG_DATA/identity.sqlite" \
  --replay="$CATALOG_DATA/replay.sqlite" \
  --catalog-dir="$CATALOG_DATA/catalog" \
  --backup-root="$CATALOG_DATA/backup"
```

## Install systemd unit

```sh
cp deploy/catalog-host/systemd/babypark-catalog-ingest.service \
  /etc/systemd/system/babypark-catalog-ingest.service
```

## First disabled service verification

While `CATALOG_INGEST_ENABLED=false`:

```sh
systemd-analyze verify /etc/systemd/system/babypark-catalog-ingest.service
systemctl daemon-reload
systemctl enable --now babypark-catalog-ingest.service
```

Verify local health:

```sh
curl -sS http://127.0.0.1:8081/health
```

Expected:

```text
HTTP 200
service = babypark-catalog-ingest
state = BOOTSTRAP
accepting_ingest = false
blockers contains INGEST_DISABLED
```

Authenticated local state check (use the D1-local probe KID; do not print the secret):

```sh
# Example: construct BP1 header with probe KID from /etc/babypark-catalog-ingest.env
curl -sS -H 'Authorization: Bearer <bp1-token>' \
  http://127.0.0.1:8081/api/catalog/ingest/v1/state
```

Expected:

```json
{
  "schema": "bp.catalog.state/1",
  "state": "BOOTSTRAP",
  "accepting_ingest": false,
  "blockers": ["INGEST_DISABLED"],
  "current_generation": null,
  "accepted_run": null
}
```

## Nginx deployment

Only after local disabled verification succeeds:

1. Preserve current production Nginx site config to a timestamped backup file.
2. Install the repo-controlled Catalog snippet:

```sh
cp deploy/catalog-host/nginx/catalog-ingest.locations.conf \
  /etc/nginx/snippets/babypark-catalog-ingest.locations.conf
```

3. Add exactly one include inside the existing HTTPS `chat.babypark.ua` server block:

```nginx
include /etc/nginx/snippets/babypark-catalog-ingest.locations.conf;
```

Do not add the include to unrelated server blocks.

4. Test and reload:

```sh
nginx -t
systemctl reload nginx
```

Do not restart Nginx.

### Nginx rollback

If Catalog Nginx changes must be reverted:

```sh
# remove or comment out the Catalog include
# restore timestamped Nginx site config if needed
nginx -t
systemctl reload nginx
```

## Public verification matrix (ingest disabled)

### From Drupal host (`77.83.102.249`)

```sh
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://chat.babypark.ua/api/catalog/ingest/v1/state
```

Without valid BP1. Expected: `401` with `AUTH_FAILED`.

Meaning: Drupal source IP passed Nginx allowlist, request reached CatalogService, and
CatalogService BP1 rejected it.

### From another BabyPark host (different public IP)

Same request without a valid secret. Expected: `403` from Nginx.

Meaning: IP allowlist works before CatalogService. Do not copy a valid secret to that
host.

### Public `/health` regression

```sh
curl -sS https://chat.babypark.ua/health
```

Expected: `HTTP 200` and `{"status":"woot"}` (Chatwoot, not CatalogService).

## Existing gateway regression proof

Before Catalog deployment, record:

```sh
systemctl show -p MainPID babypark-integration-v2.service
readlink /opt/babypark-integration/current
```

After Catalog deployment, verify:

```text
same gateway PID
same /current symlink target
babypark-integration-v2.service active
127.0.0.1:3102 listening
```

Do not restart the gateway during D1.

Also recheck existing public safety behavior:

```text
invalid Viber signature → 401
invalid Chatwoot/Viber signature → 401
Chatwoot root reachable
Chatwoot /health → {"status":"woot"}
```

Catalog D1 must not alter these behaviors.

## Enable ingest

Only after all of the following pass:

```text
bootstrap OK
BOOTSTRAP recovery coverage COVERED
validate-restore OK

service healthy while disabled
authenticated local /state OK

Nginx syntax OK
Drupal IP → Catalog route → 401
other IP → Catalog route → 403

existing Viber gateway PID unchanged
existing /current unchanged
Chatwoot/Viber regression checks OK
```

Change only:

```text
CATALOG_INGEST_ENABLED=false → true
```

in `/etc/babypark-catalog-ingest.env`, then restart **only** CatalogService:

```sh
systemctl restart babypark-catalog-ingest.service
```

Do **not** restart gateway, Nginx, or Chatwoot.

After restart, authenticated local `/state` must report:

```text
state = BOOTSTRAP
accepting_ingest = true
blockers = []
current_generation = null
accepted_run = null
```

No FULL request is sent during D1. D1 ends here.

## Recovery operations

Stop or disable ingest (`CATALOG_INGEST_ENABLED=false` and restart CatalogService only).

Inspect status as `babypark-catalog`:

```sh
runuser -u babypark-catalog -- \
  /usr/bin/node "$CATALOG_RELEASE/scripts/catalog-ops.mjs" status \
  --identity="$CATALOG_DATA/identity.sqlite" \
  --replay="$CATALOG_DATA/replay.sqlite" \
  --catalog-dir="$CATALOG_DATA/catalog" \
  --backup-root="$CATALOG_DATA/backup"

runuser -u babypark-catalog -- \
  /usr/bin/node "$CATALOG_RELEASE/scripts/catalog-ops.mjs" backup-status \
  --identity="$CATALOG_DATA/identity.sqlite" \
  --replay="$CATALOG_DATA/replay.sqlite" \
  --catalog-dir="$CATALOG_DATA/catalog" \
  --backup-root="$CATALOG_DATA/backup"
```

Validate recovery evidence:

```sh
runuser -u babypark-catalog -- \
  /usr/bin/node "$CATALOG_RELEASE/scripts/catalog-ops.mjs" validate-restore \
  --identity="$CATALOG_DATA/identity.sqlite" \
  --replay="$CATALOG_DATA/replay.sqlite" \
  --catalog-dir="$CATALOG_DATA/catalog" \
  --backup-root="$CATALOG_DATA/backup" \
  [--set-id=...] [--generation=...]
```

For BOOTSTRAP validation, omit `--generation`. For CURRENT-era validation, supply
`--generation` as required by the recovery set.

If replay recovery is required, preserve old replay evidence, create a new replay path,
update `CATALOG_REPLAY_PATH`, and restart CatalogService under operator control.

Restarting CatalogService reloads the trusted startup recovery cache after external
recovery file changes.

## Rollback (before any future FULL)

Preserve before change:

```text
old catalog-current target, if any
timestamped Nginx site config snapshot
installed Catalog unit/env/snippet state
```

If CatalogService deployment fails:

```sh
systemctl disable --now babypark-catalog-ingest.service
# restore/remove Catalog Nginx include
# restore timestamped Nginx config if needed
nginx -t
systemctl reload nginx
# restore catalog-current pointer if needed
```

Preserve `/var/lib/babypark-catalog` for diagnosis.

Never modify or restore `/var/lib/babypark-integration/bridge.sqlite` during Catalog
rollback. Do not restart the Viber gateway unless independently necessary.

Once a future CURRENT exists, application rollback and data recovery remain separate
procedures.

## Resource handling

Before the first large D2 FULL, operators should:

- observe current host load;
- optionally close unnecessary VS Code or remote-development sessions;
- collect CatalogService peak RSS, CPU, and I/O during the controlled first FULL.

Dev-process shutdown is not a functional requirement. D1 does not set systemd
`MemoryMax` or `CPUQuota`; measure real peak resources during the first controlled FULL.

## Dynamic source note

Future Drupal taxonomy and product discovery are dynamic. D1 does not hardcode category
counts, category IDs, category names, or current Drupal product content types. Drupal
exporter logic is D2 scope.
