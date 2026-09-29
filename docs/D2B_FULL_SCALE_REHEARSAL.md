# D2b full-scale isolated rehearsal

Status: **operations tooling only; do not run against production**. The rehearsal
spool is **NOT FOR PRODUCTION**.

## Frozen topology and gates

Use a disposable DigitalOcean Premium AMD VM: 2 vCPU, 4 GiB RAM, 80 GiB ext4,
Ubuntu 24.04, 2 GiB swap, Catalog Node 24.20.0. Exporter/sender remains Node 24.21.0.
Before copy/start require at least 60 GiB free:

```sh
test "$(df --output=avail -B1 /srv/babypark-rehearsal | tail -1)" -ge 64424509440
```

Build the exact `.ready` spool on Drupal, copy the immutable sender release and spool
to the VM, and run the real durable sender against loopback rehearsal CatalogService.
Do not simulate Nginx. After ACK/CURRENT, independently rrsync-pull the original
Drupal `.ready` into Link A staging and run Link A and Link B on that same artifact.

## One-time restricted rrsync

Do not use ACLs or change 0700/0600 modes. Preflight without mutation:

```sh
getent passwd babypark-exporter
test "$(getent passwd babypark-exporter | cut -d: -f7)" = /bin/dash
sudo -u babypark-exporter test -r "$EXACT_READY_DIR/manifest.json"
sudo test -O /etc/ssh/authorized_keys/babypark-exporter-link-a
sudo sshd -T | grep -E 'passwordauthentication no|kbdinteractiveauthentication no'
```

Root manages `/etc/ssh/authorized_keys/babypark-exporter-link-a` outside the writable
home. One dedicated key binds one directory:

```text
from="<catalog-or-rehearsal-source-IP>",restrict,command="/usr/bin/rrsync -ro <EXACT_READY_DIR>" ssh-ed25519 <ONE_TIME_KEY> d2b-link-a
```

No password/keyboard interactive, unrestricted key, PTY, forwarding, agent
forwarding, or user rc. Forced commands use the login shell: require root-controlled
`/bin/dash`, never `nologin` or bash. Roll back after successful transfer:

```sh
sudo rm -f /etc/ssh/authorized_keys/babypark-exporter-link-a
```

The trusted accepted/run authority supplies the manifest SHA; it is never learned
from remote. Root also installs a one-use mode-0755 SSH wrapper containing only
`exec /usr/bin/ssh -i /root/<KEY> -oBatchMode=yes -oPasswordAuthentication=no
-oKbdInteractiveAuthentication=no "$@"`; the rsync adapter receives that absolute
wrapper as `--rsh`, and spawns rsync with an argv array and `shell:false`. Remote and
local paths are never interpolated into a shell command. Remove the wrapper with the
key after transfer.

## Runtime and clean-state drills

Use `BABYPARK_REHEARSAL=1`, an absolute `BABYPARK_REHEARSAL_ROOT`, loopback, a
non-production port, audience `babypark-catalog-rehearsal-v1`, rehearsal-prefixed
KIDs, ingest enabled, and all state/backup paths canonicalized below the root.
The dedicated port is exactly 18081. CatalogService uses MemoryMax=1G and
MemoryHigh=768M.

Run clean-state drills: A baseline; B terminate sender after durable non-final ACK,
`lock-inspect`, prove owner dead, explicit `lock-break`, restart and prove identical
spool/run/header/trailer plus STATE_CONFIRMED; C SIGKILL at
`certification.afterCommit`; D SIGKILL at `publication.after`; E lost final response
through `run-d2b-lost-final-response.mjs` and prove exact final retry. Restart C/D via
the normal production entrypoint with no wrapper or special recovery path.

Pass: no OOM/pressure termination or disk exhaustion; non-final <=30s; final
certification/seal/publication/recovery <=180s; ACK/CURRENT; recovery coverage; FTS
smoke; peak RSS/CPU/disk recorded.

## Link A resource gate and evidence

Use `systemd-run --no-block --service-type=oneshot --remain-after-exit` with:

```text
User=babypark-catalog Group=babypark-catalog UMask=0077
MemoryAccounting=yes CPUAccounting=yes IOAccounting=yes
MemoryMax=512M MemoryHigh=384M CPUWeight=10 IOWeight=10 Nice=10
NoNewPrivileges=yes PrivateTmp=yes ProtectSystem=strict ProtectHome=yes
ReadWritePaths=<EXACT_LINK_A_WORK_ROOT>
```

Everything else (staged spool, catalog, identity, release) is read-only. The unit
starts `catalog-link-a-gate.mjs`; controller polls `systemctl show`, exactly validates
all properties, then creates the absent private gate. Wrapper execs Link A. Wait for
`ActiveState=active,SubState=exited` or failure. Before cleanup collect Result,
ExecMainStatus, MemoryPeak, CPUUsageNSec, IOReadBytes, IOWriteBytes, and monotonic
start/exit. Write bounded resource evidence beside Link A report. PASS requires Link
A PASS/zero mismatches, MemoryPeak <384 MiB, wall <=15m, unchanged spool/catalog/
identity/CURRENT evidence, and readable health/state. Then stop, reset-failed, verify
unit removed/inactive, and run Link B in a separate private root against the same
staged spool and candidate-commit collision config. No second transfer.
