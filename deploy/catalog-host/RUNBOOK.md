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

> BP1 diagnostic probes that need to read `/etc/babypark-catalog-ingest.env` are
> operator/root actions. `catalog-ops` recovery and durable-state commands are
> service-identity actions and must run as `babypark-catalog`.

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

> Immediately before deployment, record the exact currently approved merged `main` SHA
> and verify `origin/main` equals it. Use only that SHA for the release; do not freeze
> a historical SHA into this reusable SOP.

1. Fetch and verify:

```sh
set -euo pipefail

APPROVED_SHA=<approved-exact-sha>

git -C /path/to/babypark-integration fetch origin
test "$(git -C /path/to/babypark-integration rev-parse origin/main)" = "$APPROVED_SHA"
```

2. Construct a fresh immutable release from the exact SHA (fail closed if the path
   already exists):

```sh
set -euo pipefail

SHORT_SHA=$(git -C /path/to/babypark-integration rev-parse --short "$APPROVED_SHA")
RELEASE_DIR=/opt/babypark-integration/releases/$(date -u +%Y%m%dT%H%M%SZ)-${SHORT_SHA}

mkdir "$RELEASE_DIR"
git -C /path/to/babypark-integration archive "$APPROVED_SHA" | tar -x -C "$RELEASE_DIR"
/usr/bin/node "$RELEASE_DIR/scripts/create-exporter-release-provenance.mjs" \
  --repo /path/to/babypark-integration \
  --ref "$APPROVED_SHA" \
  --package-lock "$RELEASE_DIR/apps/drupal-exporter/package-lock.json" \
  --output "$RELEASE_DIR/RELEASE.json"
chown -R root:root "$RELEASE_DIR"
chmod -R a+rX "$RELEASE_DIR"
```

The explicit `--ref` contract is mandatory for Catalog releases. The generator
resolves that ref to an exact 40-character commit, derives its tree, reads the
required package-lock bytes directly from that commit, and compares them with the
archived release before writing canonical `bp.release-provenance/1`. It does not use
the checkout's `HEAD`; therefore a repository checked out on a historical branch
cannot mislabel the approved archive. Missing refs, non-commit refs, missing lock
content, or archive/ref lock mismatch fail closed. `RELEASE.json` must be created
before the root-owned/read-only transition.

`mkdir "$RELEASE_DIR"` must fail if the release path already exists. Do not delete or
reuse an existing immutable release automatically.

Requirements:

- release directory root-owned;
- readable and traversable by `babypark-catalog`;
- no editing inside the immutable release;
- no `npm install` required for Catalog runtime (no external runtime npm dependencies).

3. Atomically point the Catalog release symlink (same filesystem/directory; failure
   before rename leaves the old `catalog-current` intact):

```sh
set -euo pipefail

CATALOG_LINK=/opt/babypark-integration/catalog-current
CATALOG_LINK_NEW=/opt/babypark-integration/.catalog-current.new

rm -f "$CATALOG_LINK_NEW"
ln -s "$RELEASE_DIR" "$CATALOG_LINK_NEW"
mv -Tf "$CATALOG_LINK_NEW" "$CATALOG_LINK"
```

Do not modify `/opt/babypark-integration/current`.

## Provisioning order

### Root actions

1. Verify approved Git SHA (`origin/main` equals the approved exact SHA).
2. Stage immutable release (see above) and update `catalog-current`.
3. Create system user/group if absent:

```sh
set -euo pipefail

getent group babypark-catalog >/dev/null || groupadd --system babypark-catalog
getent passwd babypark-catalog >/dev/null || useradd --system --gid babypark-catalog \
  --home-dir /var/lib/babypark-catalog --shell /usr/sbin/nologin babypark-catalog
```

4. Create and chown the private durable parent:

```sh
install -d -o babypark-catalog -g babypark-catalog -m 0700 /var/lib/babypark-catalog
install -d -o babypark-catalog -g babypark-catalog -m 0700 \
  /var/lib/babypark-catalog/snapshots
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
set -euo pipefail

CATALOG_RELEASE=/opt/babypark-integration/catalog-current
CATALOG_DATA=/var/lib/babypark-catalog

runuser -u babypark-catalog -- \
  /usr/bin/node "$CATALOG_RELEASE/scripts/catalog-ops.mjs" bootstrap \
  --identity="$CATALOG_DATA/identity.sqlite" \
  --replay="$CATALOG_DATA/replay.sqlite" \
  --catalog-dir="$CATALOG_DATA/catalog" \
  --backup-root="$CATALOG_DATA/backup"

BACKUP_JSON=$(runuser -u babypark-catalog -- \
  /usr/bin/node "$CATALOG_RELEASE/scripts/catalog-ops.mjs" backup \
  --identity="$CATALOG_DATA/identity.sqlite" \
  --replay="$CATALOG_DATA/replay.sqlite" \
  --catalog-dir="$CATALOG_DATA/catalog" \
  --backup-root="$CATALOG_DATA/backup")

STATUS_JSON=$(runuser -u babypark-catalog -- \
  /usr/bin/node "$CATALOG_RELEASE/scripts/catalog-ops.mjs" backup-status \
  --identity="$CATALOG_DATA/identity.sqlite" \
  --replay="$CATALOG_DATA/replay.sqlite" \
  --catalog-dir="$CATALOG_DATA/catalog" \
  --backup-root="$CATALOG_DATA/backup")
```

Expected `backup-status` output:

```text
authority.state = BOOTSTRAP
coverage = COVERED
```

Obtain the exact completed covering set ID from either command:

- `backup` → `set_id` (capture from `BACKUP_JSON`), or
- `backup-status` → `covering_set` (capture from `STATUS_JSON`).

They must match for a fresh BOOTSTRAP backup. Extract the covering set ID and validate
the BOOTSTRAP recovery set (mandatory `--set-id`; omit `--generation`):

```sh
set -euo pipefail

CATALOG_RELEASE=/opt/babypark-integration/catalog-current
CATALOG_DATA=/var/lib/babypark-catalog

COVERING_SET_ID=$(printf '%s\n' "$BACKUP_JSON" | /usr/bin/node -e '
  const input = require("fs").readFileSync(0, "utf8");
  const value = JSON.parse(input).set_id;
  if (!value) { console.error("missing set_id"); process.exit(1); }
  process.stdout.write(value);
')

runuser -u babypark-catalog -- \
  /usr/bin/node "$CATALOG_RELEASE/scripts/catalog-ops.mjs" validate-restore \
  --identity="$CATALOG_DATA/identity.sqlite" \
  --replay="$CATALOG_DATA/replay.sqlite" \
  --catalog-dir="$CATALOG_DATA/catalog" \
  --backup-root="$CATALOG_DATA/backup" \
  --set-id="$COVERING_SET_ID"
```

Expected BOOTSTRAP `validate-restore` output:

```json
{
  "set_id": "<exact-covering-set-id>",
  "ok": true,
  "state": "BOOTSTRAP",
  "generation_id": null,
  "identity_revision": <non-negative-integer>,
  "catalog_identity_revision": null
}
```

## Install systemd unit

```sh
cp deploy/catalog-host/systemd/babypark-catalog-ingest.service \
  /etc/systemd/system/babypark-catalog-ingest.service
```

## First disabled service verification

While `CATALOG_INGEST_ENABLED=false`:

```sh
set -euo pipefail

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

Authenticated local state check uses BP1 `X-BP-*` headers (not `Authorization: Bearer`).
CatalogService signs and verifies via `signCanonicalRequest` in
`src/catalog/ingest/auth.mjs`.

For `GET /api/catalog/ingest/v1/state`, the signed tuple is:

```text
method = GET
path = /api/catalog/ingest/v1/state
audience = configured CATALOG_BP1_AUDIENCE
kid = D1 probe kid
timestamp = current Unix seconds
run_id = state
seq = 0
final = 0
content_encoding = identity
body = empty bytes
```

Secret-safe local probe (root operator action: reads the root-only env file; computes
an HMAC signature; sends a loopback GET; does not modify Catalog durable state; does
not echo the secret or place it in shell history):

```sh
set -euo pipefail

CATALOG_RELEASE=/opt/babypark-integration/catalog-current

env CATALOG_RELEASE="$CATALOG_RELEASE" \
  /usr/bin/node --input-type=module - <<'EOF'
import fs from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const release = process.env.CATALOG_RELEASE;
const envText = fs.readFileSync('/etc/babypark-catalog-ingest.env', 'utf8');
const env = {};
for (const line of envText.split('\n')) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match) env[match[1]] = match[2];
}
const audience = env.CATALOG_BP1_AUDIENCE;
const host = env.CATALOG_INGEST_HOST || '127.0.0.1';
const port = Number(env.CATALOG_INGEST_PORT || 8081);
const keys = JSON.parse(env.CATALOG_BP1_KEYS_JSON);
const kid = Object.keys(keys)[0];
const secret = keys[kid];
const route = '/api/catalog/ingest/v1/state';
const timestamp = String(Math.floor(Date.now() / 1000));
const { signCanonicalRequest } = await import(
  pathToFileURL(`${release}/src/catalog/ingest/auth.mjs`).href
);
const signed = signCanonicalRequest({
  secret,
  bodyBytes: Buffer.alloc(0),
  method: 'GET',
  path: route,
  audience,
  kid,
  timestamp,
  runId: 'state',
  seq: 0,
  final: '0',
  contentEncoding: 'identity',
});
const headers = {
  'X-BP-Version': '1',
  'X-BP-Aud': audience,
  'X-BP-Kid': kid,
  'X-BP-Timestamp': timestamp,
  'X-BP-Run': 'state',
  'X-BP-Seq': '0',
  'X-BP-Final': '0',
  'X-BP-Content-Encoding': 'identity',
  'X-BP-Signature': signed.signature,
};
const req = http.request({ host, port, method: 'GET', path: route, headers }, (res) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks));
    console.log(JSON.stringify({ status: res.statusCode, body }, null, 2));
  });
});
req.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
req.end();
EOF
```

Expected while `CATALOG_INGEST_ENABLED=false`:

```text
HTTP 200
schema = bp.catalog.state/1
state = BOOTSTRAP
accepting_ingest = false
blockers = ["INGEST_DISABLED"]
current_generation = null
accepted_run = null
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
set -euo pipefail

nginx -t
systemctl reload nginx
```

Do not restart Nginx.

### Nginx rollback

If Catalog Nginx changes must be reverted:

```sh
set -euo pipefail

# remove or comment out the Catalog include
# restore timestamped Nginx site config if needed
nginx -t
systemctl reload nginx
```

## Public verification matrix (ingest disabled)

### From Drupal host (`77.83.102.249`)

Without valid BP1, capture both status and body (do not discard the response):

```sh
set -euo pipefail

curl -sS -D /tmp/catalog-state.headers \
  -o /tmp/catalog-state.json \
  https://chat.babypark.ua/api/catalog/ingest/v1/state

grep -q 'HTTP/[^ ]* 401' /tmp/catalog-state.headers
jq -e '.schema == "bp.catalog.error/1" and .code == "AUTH_FAILED"' /tmp/catalog-state.json
```

Expected:

```text
HTTP status = 401
body.schema = bp.catalog.error/1
body.code = AUTH_FAILED
```

Meaning: request passed Nginx IP allowlist → reached CatalogService → CatalogService
BP1 auth rejected it. This is not merely “some component returned 401”.

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
set -euo pipefail

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
Drupal IP → Catalog route → 401 AUTH_FAILED (Catalog error body)
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

After restart, rerun the secret-safe local `/state` probe above. Expected:

```text
HTTP 200
state = BOOTSTRAP
accepting_ingest = true
blockers = []
current_generation = null
accepted_run = null
```

No FULL request is sent during D1. D1 ends here.

## Canonical downstream snapshot (separate owner-authorized operation)

The dedicated derived-artifact location is:

```text
/var/lib/babypark-catalog/snapshots
```

It is owned by `babypark-catalog:babypark-catalog`, has directory mode `0700`, and
snapshot files have mode `0600`. It is not Link A staging, Catalog authority, or a
durable identity/recovery backup. Do not run this procedure as part of deployment.

For a separately owner-authorized snapshot operation, choose a new immutable name
that includes the expected exact generation and run:

```sh
set -euo pipefail

CATALOG_RELEASE=/opt/babypark-integration/catalog-current
CATALOG_DATA=/var/lib/babypark-catalog
SNAPSHOT_ID=<new-snapshot-id-bound-to-expected-generation-and-run>

runuser -u babypark-catalog -- \
  /usr/bin/node "$CATALOG_RELEASE/scripts/catalog-snapshot.mjs" \
  "$CATALOG_DATA/catalog" \
  "$CATALOG_DATA/snapshots" \
  "$SNAPSHOT_ID"

runuser -u babypark-catalog -- \
  /usr/bin/node "$CATALOG_RELEASE/scripts/verify-catalog-snapshot.mjs" \
  "$CATALOG_DATA/snapshots/${SNAPSHOT_ID}.ready" \
  <exact-generation-id>
```

The exporter holds `CatalogPublicationLock` for the complete bounded streaming
operation, validates the immutable release's root `RELEASE.json`, refuses reuse of a
`.ready` name, and publishes only after independent verification. Preserve an
artifact while its downstream materialization or evidence is required. Cleanup is an
explicit recorded operator decision—never age-only—and must not target a live
`.building` directory. A deleted snapshot may be rebuilt only from the same still
available sealed generation under a new artifact name.

## Recovery operations

Stop or disable ingest (`CATALOG_INGEST_ENABLED=false` and restart CatalogService only).

Inspect status as `babypark-catalog`:

```sh
set -euo pipefail

CATALOG_RELEASE=/opt/babypark-integration/catalog-current
CATALOG_DATA=/var/lib/babypark-catalog

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

Validate recovery evidence (`--set-id` is mandatory for every `validate-restore`; the
tool does not auto-select a recovery set):

```sh
runuser -u babypark-catalog -- \
  /usr/bin/node "$CATALOG_RELEASE/scripts/catalog-ops.mjs" validate-restore \
  --identity="$CATALOG_DATA/identity.sqlite" \
  --replay="$CATALOG_DATA/replay.sqlite" \
  --catalog-dir="$CATALOG_DATA/catalog" \
  --backup-root="$CATALOG_DATA/backup" \
  --set-id=<set-id> \
  [--generation=<exact-generation-id>]
```

Contract:

- `--set-id=<set-id>` — **required** for every `validate-restore`.
- BOOTSTRAP recovery set — omit `--generation`.
- CURRENT recovery set — `--generation=<exact-generation-id>` is **required**.

Obtain `<set-id>` from `backup` (`set_id`) or `backup-status` (`covering_set`). For
CURRENT sets, obtain `<exact-generation-id>` from the recovery manifest or operator
status output.

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

> The Catalog unit may not exist yet when rollback is invoked after an early deployment
> failure; absence of the unit is therefore a valid rollback state.

```sh
set -euo pipefail

systemctl disable --now babypark-catalog-ingest.service 2>/dev/null || true
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
