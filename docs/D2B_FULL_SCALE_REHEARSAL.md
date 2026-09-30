# D2b full-scale isolated rehearsal

Status: **operations tooling only; do not run against production**.

The rehearsal spool is **NOT FOR PRODUCTION**. A successful rehearsal authorizes only
the next production cutover gate; production must build a fresh spool from the same
reviewed release.

This runbook is intentionally executable. Values in `<ANGLE_BRACKETS>` are operator
inputs that must be recorded in the rehearsal evidence package before execution.

## 0. Frozen identities

Record these before provisioning:

```sh
export PR39_COMMIT='<reviewed PR #39 commit>'
export PR39_TREE='<reviewed PR #39 tree>'
export DRUPAL_READY='<absolute Drupal .ready path>'
export MANIFEST_SHA='<trusted accepted/run authority SHA-256>'
export REHEARSAL_VM_IP='<disposable VM public IP>'
export DRUPAL_HOST='<Drupal SSH hostname>'
export DRUPAL_HOST_KEY_LINE='<pinned known_hosts line obtained out-of-band>'
export ONE_TIME_PUBLIC_KEY='<one-use ssh-ed25519 public key>'
```

Required runtimes:

```text
CatalogService: Node 24.20.0
Exporter/sender: Node 24.21.0
```

The manifest SHA is supplied by trusted local acceptance/run evidence. Never discover
or replace it from the remote rsync source.

## 1. Disposable rehearsal VM

Create a **DigitalOcean Premium AMD** VM with exactly:

```text
2 vCPU
4 GiB RAM
80 GiB ext4
Ubuntu 24.04
2 GiB swap
```

If using `doctl`, resolve the currently available Premium AMD size slug first and then
create the droplet:

```sh
doctl compute size list | grep -E '2.*4.*AMD|AMD.*2.*4'
doctl compute droplet create babypark-d2b-rehearsal \
  --region '<REGION>' \
  --image ubuntu-24-04-x64 \
  --size '<PREMIUM_AMD_2VCPU_4G_SIZE_SLUG>' \
  --ssh-keys '<ADMIN_SSH_KEY_ID>' \
  --wait
```

On the VM verify resources and create swap if required:

```sh
nproc
free -h
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINTS
findmnt -no FSTYPE /
sudo fallocate -l 2G /swapfile
sudo chmod 0600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
swapon --show
```

Create service users and the rehearsal root:

```sh
sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin babypark-catalog || true
sudo useradd --system --home /nonexistent --shell /bin/dash babypark-exporter || true

sudo install -d -o root -g root -m 0755 /srv/babypark-rehearsal
sudo install -d -o babypark-catalog -g babypark-catalog -m 0700 \
  /srv/babypark-rehearsal/catalog-state
sudo install -d -o babypark-exporter -g babypark-exporter -m 0700 \
  /srv/babypark-rehearsal/sender-state \
  /srv/babypark-rehearsal/sender-spool
sudo install -d -o babypark-catalog -g babypark-catalog -m 0700 \
  /srv/babypark-rehearsal/acceptance-staging
sudo install -d -o root -g root -m 0755 \
  /srv/babypark-rehearsal/link-a-work-parent
sudo install -d -o root -g root -m 0700 \
  /srv/babypark-rehearsal/evidence
```

Free-space gate before any release/spool copy and again before every clean drill:

```sh
test "$(df --output=avail -B1 /srv/babypark-rehearsal | tail -1)" -ge 64424509440
```

Expected: command exits `0`, proving at least 60 GiB free.

## 2. Immutable reviewed release and runtime

Copy the reviewed repository release archive and its independently recorded SHA-256 to
the VM. Do not build from a moving branch.

```sh
sudo install -d -o root -g root -m 0755 /opt/babypark-rehearsal/releases
sudo tar -xzf '<REVIEWED_RELEASE_TARBALL>' \
  -C /opt/babypark-rehearsal/releases
export RELEASE="/opt/babypark-rehearsal/releases/<IMMUTABLE_RELEASE_DIR>"
cd "$RELEASE"
git rev-parse HEAD 2>/dev/null || true
sha256sum '<REVIEWED_RELEASE_TARBALL>'
```

The release evidence package must record `PR39_COMMIT`, `PR39_TREE`, archive SHA-256
and the exact extracted path.

Install/pin the Catalog Node runtime so:

```sh
CATALOG_NODE='<absolute Node 24.20.0 binary>'
test "$("$CATALOG_NODE" --version)" = 'v24.20.0'
"$CATALOG_NODE" -e "require('node:sqlite'); console.log('node:sqlite ok')"
```

The copied sender release must use the already-pinned exporter runtime:

```sh
SENDER_NODE='<absolute Node 24.21.0 binary>'
test "$("$SENDER_NODE" --version)" = 'v24.21.0'
```

## 3. BOOTSTRAP rehearsal state and config authority

Use only rehearsal paths:

```sh
export RROOT=/srv/babypark-rehearsal
export IDENTITY="$RROOT/catalog-state/identity.sqlite"
export REPLAY="$RROOT/catalog-state/replay.sqlite"
export CATALOG_DIR="$RROOT/catalog-state/catalog"
export BACKUP_ROOT="$RROOT/catalog-state/backup"

sudo -u babypark-catalog "$CATALOG_NODE" "$RELEASE/scripts/catalog-ops.mjs" bootstrap \
  --identity="$IDENTITY" \
  --replay="$REPLAY" \
  --catalog-dir="$CATALOG_DIR" \
  --backup-root="$BACKUP_ROOT"
```

Hash the exact behavior-affecting configuration from the immutable release:

```sh
COLLISION_SHA="$(sha256sum "$RELEASE/config/drupal/legacy-sku-collisions.yaml" | awk '{print $1}')"
ANOMALY_SHA="$(sha256sum "$RELEASE/config/catalog-anomalies/publication-policy.yaml" | awk '{print $1}')"
```

Bind those two hashes into the rehearsal IdentityStore using the existing
`IdentityStore.setConfigHash` API:

```sh
sudo -u babypark-catalog "$CATALOG_NODE" --input-type=module - "$IDENTITY" \
  "$COLLISION_SHA" "$ANOMALY_SHA" <<'NODE'
import { IdentityStore } from './src/catalog/identity/store.mjs';
const [identity, collision, anomaly] = process.argv.slice(2);
const store = IdentityStore.openExisting(identity);
try {
  store.setConfigHash('drupal-collisions', collision);
  store.setConfigHash('drupal-anomaly-publication-policy', anomaly);
  console.log(JSON.stringify({ok:true, metadata:store.metadata()}));
} finally { store.close(); }
NODE
```

Create and verify BOOTSTRAP recovery coverage:

```sh
sudo -u babypark-catalog "$CATALOG_NODE" "$RELEASE/scripts/catalog-ops.mjs" backup \
  --identity="$IDENTITY" \
  --replay="$REPLAY" \
  --catalog-dir="$CATALOG_DIR" \
  --backup-root="$BACKUP_ROOT"

sudo -u babypark-catalog "$CATALOG_NODE" "$RELEASE/scripts/catalog-ops.mjs" backup-status \
  --identity="$IDENTITY" \
  --replay="$REPLAY" \
  --catalog-dir="$CATALOG_DIR" \
  --backup-root="$BACKUP_ROOT"
```

PASS requires `coverage: "COVERED"`. Record the recovery set ID. Run
`validate-restore` against that set before the first drill.

## 4. Root-owned rehearsal environment

Create a root-owned mode-0600 Catalog environment file:

```sh
sudo install -o root -g root -m 0600 /dev/null /run/babypark-catalog-rehearsal.env
sudoedit /run/babypark-catalog-rehearsal.env
```

Required values:

```text
BABYPARK_REHEARSAL=1
BABYPARK_REHEARSAL_ROOT=/srv/babypark-rehearsal
CATALOG_INGEST_HOST=127.0.0.1
CATALOG_INGEST_PORT=18081
CATALOG_INGEST_ENABLED=true
CATALOG_BP1_AUDIENCE=babypark-catalog-rehearsal-v1
CATALOG_BP1_KEYS_JSON={"rehearsal-<KID>":"<REHEARSAL_SECRET_AT_LEAST_32_CHARS>"}
CATALOG_IDENTITY_PATH=/srv/babypark-rehearsal/catalog-state/identity.sqlite
CATALOG_REPLAY_PATH=/srv/babypark-rehearsal/catalog-state/replay.sqlite
CATALOG_STORAGE_DIR=/srv/babypark-rehearsal/catalog-state/catalog
CATALOG_BACKUP_ROOT=/srv/babypark-rehearsal/catalog-state/backup
```

No production KID, secret, audience, state path, port or hostname is permitted.

Start rehearsal CatalogService with its resource fence:

```sh
sudo systemd-run \
  --unit=babypark-catalog-rehearsal \
  --service-type=exec \
  --property=User=babypark-catalog \
  --property=Group=babypark-catalog \
  --property=EnvironmentFile=/run/babypark-catalog-rehearsal.env \
  --property=MemoryAccounting=yes \
  --property=CPUAccounting=yes \
  --property=IOAccounting=yes \
  --property=MemoryMax=1G \
  --property=MemoryHigh=768M \
  --property=NoNewPrivileges=yes \
  "$CATALOG_NODE" "$RELEASE/scripts/run-catalog-rehearsal.mjs"
```

Verify the exact effective boundary:

```sh
systemctl show babypark-catalog-rehearsal \
  -p User -p Group -p MemoryMax -p MemoryHigh \
  -p MemoryAccounting -p CPUAccounting -p IOAccounting
curl --fail --silent http://127.0.0.1:18081/health
```

There is no Nginx simulation in rehearsal.

## 5. Immutable local sender/spool

Copy the exact reviewed sender release and exact `.ready` spool to the VM without
changing spool bytes. Preserve private modes:

```sh
sudo -u babypark-exporter install -d -m 0700 "$RROOT/sender-spool/<RUN>.ready"
# Copy exact files here using the approved transfer mechanism.
sudo -u babypark-exporter find "$RROOT/sender-spool/<RUN>.ready" -type d -exec chmod 0700 {} +
sudo -u babypark-exporter find "$RROOT/sender-spool/<RUN>.ready" -type f -exec chmod 0600 {} +
sha256sum "$RROOT/sender-spool/<RUN>.ready/manifest.json"
```

The manifest SHA must equal the trusted `MANIFEST_SHA`.

Create root-owned mode-0600 sender environment material and run the sender as
`babypark-exporter`:

```text
BABYPARK_REHEARSAL=1
BABYPARK_REHEARSAL_ROOT=/srv/babypark-rehearsal
BP_CATALOG_ORIGIN=http://127.0.0.1:18081
BP_CATALOG_AUDIENCE=babypark-catalog-rehearsal-v1
BP_CATALOG_KID=rehearsal-<KID>
BP_CATALOG_SECRET=<SAME_REHEARSAL_SECRET>
BP_D2B_STATE_DIR=/srv/babypark-rehearsal/sender-state
BP_D2B_MAX_ATTEMPTS=4
BP_D2B_TIMEOUT_MS=60000
```

Baseline send:

Do not execute `src/drupal-d2b/cli.mjs` directly; it exports the CLI `main()` for the pinned launcher and does not self-invoke.

```sh
sudo -u babypark-exporter env $(sudo cat /run/babypark-sender-rehearsal.env | xargs) \
  "$SENDER_NODE" "$RELEASE/scripts/run-drupal-d2b-sender.mjs" \
  send "$RROOT/sender-spool/<RUN>.ready"
```

Do not place the real secret on an interactive shell history in production; the
rehearsal operator may instead use a root-owned wrapper that imports the environment.

PASS requires final `STATE_CONFIRMED`, durable final ACK and authenticated `/state`
binding the same run ID/digest/final sequence.

## 6. Clean reset between drills

Every drill starts from the same pre-FULL BOOTSTRAP baseline and a fresh sender-state
directory. Never reuse a partially exercised state tree as a "clean" drill.

Before the first drill archive the pristine BOOTSTRAP state:

```sh
sudo systemctl stop babypark-catalog-rehearsal
sudo tar --xattrs --numeric-owner -C "$RROOT" \
  -czf "$RROOT/evidence/bootstrap-pristine.tgz" catalog-state
sha256sum "$RROOT/evidence/bootstrap-pristine.tgz"
```

For each new drill:

```sh
sudo systemctl stop babypark-catalog-rehearsal || true
sudo rm -rf "$RROOT/catalog-state" "$RROOT/sender-state"
sudo tar --xattrs --numeric-owner -C "$RROOT" \
  -xzf "$RROOT/evidence/bootstrap-pristine.tgz"
sudo install -d -o babypark-exporter -g babypark-exporter -m 0700 "$RROOT/sender-state"
test "$(df --output=avail -B1 "$RROOT" | tail -1)" -ge 64424509440
# Start babypark-catalog-rehearsal again using section 4.
```

Re-run BOOTSTRAP `backup-status` before sender start. PASS requires `COVERED`.

## 7. Failure drills

### A — baseline

Run the normal sender. Record start/end monotonic timestamps, journal, memory/CPU/disk,
ACK and final `/state`.

### B — sender killed after durable non-final ACK

Start the normal sender. After a non-final STAGED ACK is durably recorded, terminate
the sender process. Do not delete its lock.

Inspect:

```sh
sudo -u babypark-exporter "$SENDER_NODE" "$RELEASE/scripts/run-drupal-d2b-sender.mjs" \
  lock-inspect "$RROOT/sender-spool/<RUN>.ready"
```

Prove `alive:false`, record the reason, then explicitly break:

```sh
sudo -u babypark-exporter "$SENDER_NODE" "$RELEASE/scripts/run-drupal-d2b-sender.mjs" \
  lock-break "$RROOT/sender-spool/<RUN>.ready"
```

Restart with the normal `send` entrypoint. PASS requires the exact same durable
run ID, frozen header, frozen trailer and next sequence, followed by
`STATE_CONFIRMED`.

### C — SIGKILL at `certification.afterCommit`

Set only:

```text
BABYPARK_REHEARSAL_FAILPOINT=certification.afterCommit
```

Run sender, allow the Catalog process to be SIGKILLed by the injected hook, then
restart CatalogService through the normal `run-catalog-rehearsal.mjs` entrypoint with
the failpoint removed. Resume the normal sender. No special recovery wrapper is
allowed.

### D — SIGKILL at `publication.after`

Repeat section C using:

```text
BABYPARK_REHEARSAL_FAILPOINT=publication.after
```

Again restart only through the normal entrypoint and resume the exact durable sender.

### E — lost successful final response

Use the hardened rehearsal-only wrapper:

```sh
sudo -u babypark-exporter env $(sudo cat /run/babypark-sender-rehearsal.env | xargs) \
  "$SENDER_NODE" "$RELEASE/scripts/run-d2b-lost-final-response.mjs" \
  "$RROOT/sender-spool/<RUN>.ready"
```

The script fails closed unless the spool, sender state, loopback origin, rehearsal
audience and rehearsal KID are all inside the isolated rehearsal namespace.

PASS requires the first successful final response to be dropped, then an exact retry
of the same run ID, final sequence and request body/hash, a durable ACK, and final
`STATE_CONFIRMED`.

## 8. Drill timing and resource evidence

For each drill record:

```sh
journalctl -u babypark-catalog-rehearsal --since '<START_ISO>' --until '<END_ISO>' \
  > "$RROOT/evidence/<DRILL>-catalog.journal"

systemctl show babypark-catalog-rehearsal \
  -p MemoryPeak -p CPUUsageNSec -p IOReadBytes -p IOWriteBytes \
  -p ExecMainStartTimestampMonotonic -p ExecMainExitTimestampMonotonic \
  -p Result -p ExecMainStatus \
  > "$RROOT/evidence/<DRILL>-catalog.resources"

df -B1 "$RROOT" > "$RROOT/evidence/<DRILL>-disk.txt"
```

Pass gates:

```text
no OOM/pressure termination
no disk exhaustion
non-final request <= 30 s
final certification/seal/publication/recovery <= 180 s
ACK/CURRENT present
required recovery path exercised
FTS smoke passes
peak RSS/CPU/disk recorded
```

## 9. One-time restricted Drupal pull for Link A

The Link A spool copy is a new independent pull from the original Drupal `.ready`.
It is not the local sender copy.

On Drupal, root creates a dedicated sshd Match block for only
`babypark-exporter` and the rehearsal source IP:

```text
Match User babypark-exporter
    AuthorizedKeysFile /etc/ssh/authorized_keys/babypark-exporter-link-a
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PermitTTY no
    AllowAgentForwarding no
    AllowTcpForwarding no
    PermitUserRC no
```

Validate the **effective** context, not generic sshd defaults:

```sh
sudo sshd -t
sudo sshd -T -C "user=babypark-exporter,addr=$REHEARSAL_VM_IP,host=$(hostname -f)" \
  | grep -E '^(authorizedkeysfile|passwordauthentication|kbdinteractiveauthentication|permittty|allowagentforwarding|allowtcpforwarding|permituserrc) '
```

`authorizedkeysfile` must include exactly the root-managed path used below.

Preflight source account and artifact without mutating them:

```sh
getent passwd babypark-exporter
test "$(getent passwd babypark-exporter | cut -d: -f7)" = /bin/dash
sudo -u babypark-exporter test -r "$DRUPAL_READY/manifest.json"
sudo test -O /etc/ssh/authorized_keys/babypark-exporter-link-a
```

Install exactly one restricted key:

```text
from="<REHEARSAL_VM_IP>",restrict,command="/usr/bin/rrsync -ro <EXACT_READY_DIR>" ssh-ed25519 <ONE_TIME_PUBLIC_KEY> d2b-link-a
```

On the rehearsal VM, install the one-use private key and the **out-of-band pinned**
Drupal host-key line as root-owned mode-0600 files:

```sh
sudo install -o root -g root -m 0600 '<ONE_TIME_PRIVATE_KEY_FILE>' /root/babypark-link-a-key
printf '%s\n' "$DRUPAL_HOST_KEY_LINE" | sudo tee /root/babypark-link-a-known-hosts >/dev/null
sudo chmod 0600 /root/babypark-link-a-known-hosts
```

Create the wrapper from the repository-controlled template. Replace only the two
placeholder paths, then verify its ownership/mode and required options:

```sh
sudo cp "$RELEASE/scripts/link-a-ssh-wrapper.sh.template" /root/babypark-link-a-ssh
sudo sed -i \
  -e 's#<ONE_TIME_PRIVATE_KEY>#babypark-link-a-key#' \
  -e 's#<PINNED_KNOWN_HOSTS>#babypark-link-a-known-hosts#' \
  /root/babypark-link-a-ssh
sudo chown root:root /root/babypark-link-a-ssh
sudo chmod 0755 /root/babypark-link-a-ssh
sudo test -O /root/babypark-link-a-ssh
test "$(stat -c '%a' /root/babypark-link-a-ssh)" = 755
```

Pull using the executable operator path. The expected SHA comes from `MANIFEST_SHA`,
never remote:

```sh
sudo "$CATALOG_NODE" "$RELEASE/scripts/catalog-link-a-pull.mjs" \
  --host="$DRUPAL_HOST" \
  --ssh-wrapper=/root/babypark-link-a-ssh \
  --staging-root="$RROOT/acceptance-staging" \
  --manifest-sha="$MANIFEST_SHA"
```

PASS requires exactly `<MANIFEST_SHA>.staged`, mode `0700`, owned by
`babypark-catalog:babypark-catalog`, with regular mode-0600 files owned by the same
account. Failed `.building` is retained for diagnosis and is never promoted.

Immediately remove the one-use credentials after a successful transfer:

```sh
sudo rm -f /root/babypark-link-a-key \
  /root/babypark-link-a-known-hosts \
  /root/babypark-link-a-ssh
```

On Drupal remove the dedicated authorized key and sshd Match drop-in, validate
`sshd -t`, and reload sshd.

## 10. Link A bounded systemd verification

Use a fresh work root name under the pre-created parent:

```sh
export STAGED="$RROOT/acceptance-staging/$MANIFEST_SHA.staged"
export LINK_A_WORK="$RROOT/link-a-work-parent/link-a-$(date -u +%Y%m%dT%H%M%SZ)"
```

The root controller resolves `babypark-catalog` UID/GID, safely creates/chowns the
mode-0700 work root, validates no symlinked parent/component, and only then admits it
as the transient unit's sole writable path.

Run:

```sh
sudo env $(sudo cat /run/babypark-sender-rehearsal.env | xargs) \
  BABYPARK_REHEARSAL=1 \
  "$CATALOG_NODE" "$RELEASE/scripts/run-link-a-systemd.mjs" \
  --staged-spool="$STAGED" \
  --work-root="$LINK_A_WORK" \
  --catalog-dir="$CATALOG_DIR" \
  --identity="$IDENTITY" \
  --generation='<CURRENT_GENERATION_ID>' \
  --run-id='<ACCEPTED_RUN_ID>' \
  --run-digest='<ACCEPTED_RUN_DIGEST>' \
  --final-seq='<ACCEPTED_FINAL_SEQ>'
```

The controller requires:

```text
User=babypark-catalog
Group=babypark-catalog
UMask=0077
MemoryAccounting=yes
CPUAccounting=yes
IOAccounting=yes
MemoryMax=512M
MemoryHigh=384M
CPUWeight=10
IOWeight=10
Nice=10
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=<exact work root only>
ReadOnlyPaths=<staged spool> <catalog dir> <identity> <immutable release root>
```

It validates the effective properties before releasing the private gate, bounds the
gated start and 15-minute execution, and cleans the transient unit on every success,
failure or timeout path.

PASS requires:

```text
link-a-report.json: PASS, mismatch_count=0
link-a-resource-evidence.json: PASS
MemoryPeak < 384 MiB
wall_ms <= 900000
exact report SHA-256 recorded
staged spool independently unchanged
accepted catalog generation independently unchanged
identity independently unchanged
CURRENT independently unchanged
health readable before/after
authenticated state bound to exact generation/run before/after
transient unit cleanup verified
```

## 11. Link B on the same staged artifact

Do not transfer again. Run Link B against exactly `$STAGED`:

```sh
sudo -u babypark-catalog "$CATALOG_NODE" "$RELEASE/scripts/catalog-link-b.mjs" \
  --spool="$STAGED" \
  --collision-config="$RELEASE/config/drupal/legacy-sku-collisions.yaml" \
  --work-root="$RROOT/link-b-<RUN_ID>"
```

Use a fresh private Link B work root and preserve its report.

## 12. Final PASS package

The rehearsal is complete only when the evidence directory contains:

```text
release commit/tree/archive SHA-256
exact config hashes
BOOTSTRAP backup-status + validate-restore PASS
baseline sender result + authenticated final state
drill B lock-inspect/dead-owner/break/restart evidence
drill C journal/state/recovery evidence
drill D journal/state/recovery evidence
drill E exact-final-retry evidence
per-drill timing/journal/CPU/RSS/IO/disk evidence
restricted pull result and trusted manifest SHA
Link A report
Link A resource evidence
Link B report
final authenticated Catalog state
```

Final gate:

```text
A baseline PASS
B sender restart PASS
C certification.afterCommit recovery PASS
D publication.after recovery PASS
E lost-final exact retry PASS
Link A PASS
Link A resource evidence PASS
Link B PASS
no OOM / pressure kill
no disk exhaustion
non-final <=30 s
final/recovery <=180 s
```

A rehearsal PASS does **not** authorize reuse of this spool in production. Production
must freeze the reviewed release, cut over CatalogService through the separately
approved production procedure, build a fresh production spool and repeat the
production ACK + Link A + Link B + recovery/restore gates.