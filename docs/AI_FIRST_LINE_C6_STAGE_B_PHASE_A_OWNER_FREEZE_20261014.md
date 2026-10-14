# C6 Stage B Phase A — owner-freeze packet (2026-10-14)

**Status: DRAFT / EVIDENCE / NON-NORMATIVE / NOT AN AUTHORIZATION.** This file records proposed parameters and first-party discovery transcripts for **review only**. It does not authorize staging, provisioning, privilege changes, namespace probes, execution, retries, cleanup or merge. All unsigned fields are **OPEN / HALT**. Source of truth is the repository `Stanislavikus/babypark-integration` only; do not mix with `babypark-b2b`.

## 1. Immutable Git basis and decision scope

- Canonical `main`: `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729`; governing `docs/AI_WORKING_AGREEMENT.md` Git blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.
- PR #128 runtime HEAVY head and PR #135 exact campaign base: `565d8de08fbd8e85598e554cb91e59dfa4f8c1a4`; `CAMPAIGN_BASE_OID` must equal this **full** OID in the proposed checkout until separately repinned.
- Prior independently Sonnet-reviewed fixture+protocol HEAD: `66ec10da60f0f048550898815887c60e023d0e2a`, TREE `1bd9b36fe46eb912d82f99aeebb1d2e2faea8fe6`, with ZERO BLOCKER / ZERO SHOULD FIX **for that exact old tree**.
- THIS docs-only addition moves the PR #135 HEAD and tree. Final HEAD, tree and document digest **must be recorded after committing this file** in PR checkpoint and included in an independent fresh freeze-document review. None of the previous zero-BLOCKER reviews automatically attest this new file or its proposed operational command.
- Frozen Scan SHA-256 `5f43c0cda1b23c3003e92cfbae8d33ea88ef213929eeed0aa0323c8cad047c6d`; Fit SHA-256 `9d8ba74c3c998c66fbabc6adc89599cf152ee20f0683cbbf17d2ead6cae25427`; protocol `docs/AI_FIRST_LINE_C6_STAGE_B_PHASE_A_EXECUTION_PROTOCOL_20261014.md` blob `90668a6c543b2605290288e0ecfc1b9ff6030d52`, SHA-256 `9a7daaa3099b4b23304a4da9e6c0f5c7e4cef1e2090d915a9ec9cb707ea31cce`.
- Exact unmodified inputs: `tests/fixtures/c6-stage-b-phase-a.mjs`, blob `652dffeaf6d4ad0020a2bb1463f6c513bfb077df`, SHA-256 `1aa63787d30e3b48938319a230fd67eb477f4e1402f2c238c514018957e123c6`; `tests/fixtures/c6-stage-b-phase-a-holder.mjs`, blob `31f148df079f7100b02bcddc1370aafef53f77e6`, SHA-256 `b66f02de1dafc6f00fc5a22044e943a0336cc2354ff056e26e5882814fa8572a`. Fixture-review manifest blob `3d9dafe62529d7240482450b9d718401e084706d`; the final owner freeze must include its SHA-256 too.
- PR #135 is **stacked** on #128, not a branch targeting the current canonical `main`. Source/test-run review is **not** the Working Agreement's final merge gate. Any later merge requires re-pin to actual main and a fresh exact-tree verification campaign, plus separately explicit owner approval.

**Expected changed-surface assertion for the final docs-only freeze HEAD (five files, all `A`)**: the earlier four-file list is **superseded**, because THIS new document is a legitimate fifth path. A fifth path is **not acceptable** when running a frozen four-file approval; this proposed five-file basis itself requires a *new* owner freeze. Exact expected UTF-8 bytes, with tabs, LF and final LF:

~~~text
A	docs/AI_FIRST_LINE_C6_STAGE_B_PHASE_A_EXECUTION_PROTOCOL_20261014.md
A	docs/AI_FIRST_LINE_C6_STAGE_B_PHASE_A_OWNER_FREEZE_20261014.md
A	docs/AI_FIRST_LINE_C6_STAGE_B_PHASE_A_POC_REVIEW_20261014.md
A	tests/fixtures/c6-stage-b-phase-a-holder.mjs
A	tests/fixtures/c6-stage-b-phase-a.mjs
~~~

The proposed external supervisor must do a byte-equality assertion, **not print-only**, on the result of `git -C "$CHECKOUT" diff --no-renames --name-status "$CAMPAIGN_BASE_OID..HEAD"` against those exact five newline-terminated lines. `--no-renames` is mandatory so a rename cannot be silently presented as a deletion/addition under different classification. Assert Git identity/history first: `/usr/bin/git` present and provenance-approved, full base object via `git cat-file -e`, non-shallow, clean worktree and `git diff --check`. If any new commit changes the file list, TREE or HEAD: **cancel and freeze again**, no silent acceptance.

## 2. Discovery provenance — existing raw command transcripts, NOT a new host operation

Authorized read-only discovery was conducted on 2026-10-14 via **Remote Desktop Commander device** `db266e66-2862-4924-b0c6-d9761d3d55cd`, reported as `babypark-catalog-rehearsal-fra1`, observed `MACHINE_ID_SHA256=886acdf18e90e7a4061f546fe03418ea53b4c6fb07e8d5d5eb4fcc23dbc60f81` (a digest, not the underlying machine-id), and DigitalOcean `droplet_list` identified droplet `604879613` (Frankfurt, 2 vCPU, 4096 MiB provisioned, rehearsal/nonproduction tags). These are **controller-observed connector responses, not independently reproduced by Sonnet or the owner**. The tool returned `Process started ... Initial output`; **a separate final remote-process exit status was not captured for each command**. Do not invent `rc=0`, complete stdout/stderr, or attestation of host health from those partial transport responses. A reviewer can inspect the literal command/output below. Final owner freeze must separately approve fresh **bounded, read-only** preflight attestation before any Phase A run.

### 2.1 Host/runtime/Bash — observed raw command and initial output

~~~sh
/usr/bin/timeout 12s /bin/sh -c 'set -eu; printf "DISCOVERY_UTC="; /usr/bin/date -u +%FT%TZ; printf "HOSTNAME="; /usr/bin/hostname; printf "UID_GID="; /usr/bin/id -u; /usr/bin/id -g; printf "MACHINE_ID_SHA256="; /usr/bin/sha256sum /etc/machine-id | /usr/bin/cut -d" " -f1; printf "KERNEL="; /usr/bin/uname -sr; printf "CPU_COUNT="; /usr/bin/nproc; printf "MEMORY="; /usr/bin/free -m | /usr/bin/head -n 3; printf "DISK="; /usr/bin/df -BM /tmp /opt /var/lib 2>&1; printf "COMMANDS="; for c in /bin/bash /bin/sh /usr/bin/git /usr/bin/unshare /usr/bin/setpriv /usr/bin/timeout /usr/bin/sha256sum /usr/bin/pgrep /usr/bin/systemctl; do if test -x "$c"; then echo "$c PRESENT"; else echo "$c ABSENT"; fi; done; printf "BASH_VERSION="; /bin/bash --version | /usr/bin/head -n1; printf "BASH_SHA256="; /usr/bin/sha256sum /bin/bash | /usr/bin/cut -d" " -f1; printf "BINSH_LINK="; /usr/bin/readlink -f /bin/sh; printf "GIT_VERSION="; /usr/bin/git --version'
~~~

~~~text
Process started with PID 186923 (shell: /bin/bash)
Initial output:
DISCOVERY_UTC=2026-10-14T12:39:08Z
HOSTNAME=babypark-catalog-rehearsal-fra1
UID_GID=0
0
MACHINE_ID_SHA256=886acdf18e90e7a4061f546fe03418ea53b4c6fb07e8d5d5eb4fcc23dbc60f81
KERNEL=Linux 6.8.0-142-generic
CPU_COUNT=2
MEMORY=               total        used        free      shared  buff/cache   available
Mem:            3915         929         457           3        2855        2985
Swap:           2047           0        2047
DISK=Filesystem     1M-blocks   Used Available Use% Mounted on
/dev/vda1         88204M 16892M    71297M  20% /
/dev/vda1         88204M 16892M    71297M  20% /
/dev/vda1         88204M 16892M    71297M  20% /
COMMANDS=/bin/bash PRESENT
/bin/sh PRESENT
/usr/bin/git PRESENT
/usr/bin/unshare PRESENT
/usr/bin/setpriv PRESENT
/usr/bin/timeout PRESENT
/usr/bin/sha256sum PRESENT
/usr/bin/pgrep PRESENT
/usr/bin/systemctl PRESENT
BASH_VERSION=GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)
BASH_SHA256=bc5945feb8bd26203ebfafea5ce1878bb2e32cb8fb50ab7ae395cfb1e1aaaef1
BINSH_LINK=/usr/bin/dash
GIT_VERSION=git version 2.43.0
[executed on device: babypark-catalog-rehearsal-fra1 (db266e66-2862-4924-b0c6-d9761d3d55cd)]
REMOTE_PROCESS_FINAL_RC=NOT_CAPTURED
~~~

### 2.2 Native tools, catalog unit and staging absence — observed raw command and initial output

~~~sh
/usr/bin/timeout 12s /bin/sh -c 'set -eu; printf "UTC="; /usr/bin/date -u +%FT%TZ; printf "SERVICE_MATCHES_BEGIN\n"; /usr/bin/systemctl list-units --all --type=service --no-pager --plain --no-legend | /usr/bin/grep -Ei "catalog|babypark|gateway|rehearsal" || true; printf "SERVICE_FILES_MATCHES_BEGIN\n"; /usr/bin/systemctl list-unit-files --type=service --no-pager --plain --no-legend | /usr/bin/grep -Ei "catalog|babypark|gateway|rehearsal" || true; printf "TCP_LOCAL_LISTENERS_BEGIN\n"; /usr/bin/ss -ltnH | /usr/bin/awk "{print \$1,\$4}" | /usr/bin/head -n 30; printf "TOOLCHAIN_BEGIN\n"; /usr/bin/unshare --version; /usr/bin/setpriv --version; /usr/bin/timeout --version | /usr/bin/head -n1; printf "NODE_PATH_BEGIN\n"; for f in /opt/babypark-rehearsal/runtime/node-v24.20.0/bin/node /opt/babypark-rehearsal/c6-stage-b-phase-a-ro /var/lib/babypark-rehearsal/c6-stage-b-phase-a-evidence; do if test -e "$f"; then /usr/bin/stat -c "%n TYPE=%F OWNER=%U:%G MODE=%a SIZE=%s" "$f"; else echo "$f ABSENT"; fi; done; printf "SYSTEM_PRESSURE_BEGIN\n"; /usr/bin/cat /proc/loadavg; for f in /proc/pressure/cpu /proc/pressure/memory /proc/pressure/io; do printf "%s " "$f"; /usr/bin/head -n1 "$f"; done'
~~~

~~~text
Process started with PID 186950 (shell: /bin/bash)
Initial output:
UTC=2026-10-14T12:39:54Z
SERVICE_MATCHES_BEGIN
babypark-catalog-rehearsal.service             loaded    active   running /opt/babypark-rehearsal/runtime/node-v24.20.0/bin/node /opt/babypark-rehearsal/releases/babypark-rehearsal-c562c2ea/scripts/run-catalog-rehearsal.mjs
bp-c6poc-desktop-commander.service             loaded    active   running BabyPark PoC Desktop Commander Remote MCP (pinned 0.2.52)
bp-rehearsal-finalize.service                  loaded    failed   failed  /root/bp-finalize-rehearsal.sh
systemd-journal-catalog-update.service         loaded    inactive dead    Rebuild Journal Catalog
SERVICE_FILES_MATCHES_BEGIN
babypark-catalog-rehearsal.service           transient       -
bp-rehearsal-finalize.service                transient       -
systemd-journal-catalog-update.service       static          -
TCP_LOCAL_LISTENERS_BEGIN
LISTEN 0.0.0.0:22
LISTEN 127.0.0.1:18081
LISTEN 127.0.0.53%lo:53
LISTEN 127.0.0.54:53
LISTEN [::]:22
TOOLCHAIN_BEGIN
unshare from util-linux 2.39.3
setpriv from util-linux 2.39.3
timeout (GNU coreutils) 9.4
NODE_PATH_BEGIN
/opt/babypark-rehearsal/runtime/node-v24.20.0/bin/node TYPE=regular file OWNER=bpclaude:bpclaude MODE=755 SIZE=126458664
/opt/babypark-rehearsal/c6-stage-b-phase-a-ro ABSENT
/var/lib/babypark-rehearsal/c6-stage-b-phase-a-evidence ABSENT
SYSTEM_PRESSURE_BEGIN
0.00 0.00 0.00 1/221 186969
/proc/pressure/cpu some avg10=0.00 avg60=0.00 avg300=0.00 total=1051114004
/proc/pressure/memory some avg10=0.00 avg60=0.00 avg300=0.00 total=1047357
/proc/pressure/io some avg10=0.00 avg60=0.00 avg300=0.00 total=942227995
[executed on device: babypark-catalog-rehearsal-fra1 (db266e66-2862-4924-b0c6-d9761d3d55cd)]
REMOTE_PROCESS_FINAL_RC=NOT_CAPTURED
~~~

### 2.3 Node/SQLite, catalog unit metadata — observed raw command and initial output

~~~sh
/usr/bin/timeout 15s /bin/sh -c 'set -eu; printf "UTC="; /usr/bin/date -u +%FT%TZ; printf "CATALOG_SYSTEMD_BEGIN\n"; /usr/bin/systemctl show babypark-catalog-rehearsal.service -p Id -p LoadState -p ActiveState -p SubState -p MainPID -p ActiveEnterTimestamp -p ActiveEnterTimestampMonotonic -p NRestarts -p MemoryCurrent -p CPUUsageNSec -p FragmentPath -p ExecMainStartTimestamp --no-pager; printf "CATALOG_READONLY_STATUS="; /usr/bin/systemctl is-active babypark-catalog-rehearsal.service; printf "NODE_VERSIONS="; /opt/babypark-rehearsal/runtime/node-v24.20.0/bin/node -p "JSON.stringify({node:process.version,sqlite:process.versions.sqlite})"; printf "NODE_SHA256="; /usr/bin/sha256sum /opt/babypark-rehearsal/runtime/node-v24.20.0/bin/node | /usr/bin/cut -d" " -f1; printf "CATALOG_SCRIPT_STAT="; /usr/bin/stat -c "%n %F %U:%G %a %s" /opt/babypark-rehearsal/releases/babypark-rehearsal-c562c2ea/scripts/run-catalog-rehearsal.mjs; printf "CATALOG_HEALTH_CODE_REFERENCES_BEGIN\n"; /usr/bin/grep -nE "health|/ready|/live|createServer|listen\\(|18081" /opt/babypark-rehearsal/releases/babypark-rehearsal-c562c2ea/scripts/run-catalog-rehearsal.mjs | /usr/bin/head -n 30 || true; printf "BASH_PACKAGE="; /usr/bin/dpkg-query -W -f="${Package} ${Version}\n" bash 2>/dev/null || true'
~~~

~~~text
Process started with PID 186978 (shell: /bin/bash)
Initial output:
UTC=2026-10-14T12:40:40Z
CATALOG_SYSTEMD_BEGIN
MainPID=1525
NRestarts=0
ExecMainStartTimestamp=Wed 2026-09-30 13:22:28 UTC
MemoryCurrent=552194048
CPUUsageNSec=273359305000
Id=babypark-catalog-rehearsal.service
LoadState=loaded
ActiveState=active
SubState=running
FragmentPath=/run/systemd/transient/babypark-catalog-rehearsal.service
ActiveEnterTimestamp=Wed 2026-09-30 13:22:28 UTC
ActiveEnterTimestampMonotonic=273495035
CATALOG_READONLY_STATUS=active
NODE_VERSIONS={"node":"v24.20.0","sqlite":"3.53.4"}
NODE_SHA256=89af8424dd53e560b1933f87ba650d8bf57c83ca5a04600eefb31f416aabbae7
CATALOG_SCRIPT_STAT=/opt/babypark-rehearsal/releases/babypark-rehearsal-c562c2ea/scripts/run-catalog-rehearsal.mjs regular file root:root 555 642
CATALOG_HEALTH_CODE_REFERENCES_BEGIN
5:const config=parseCatalogHttpConfig();const guard=validateRehearsalConfig(config);const runtime=openCatalogHttpRuntime(config,{implementations:{coordinator:rehearsalCoordinator(guard.failpoint)}});await runtime.listen({host:config.host,port:config.port});for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{await runtime.shutdown();process.exit(0);});
BASH_PACKAGE=/bin/sh: 1: Package: parameter not set
[executed on device: babypark-catalog-rehearsal-fra1 (db266e66-2862-4924-b0c6-d9761d3d55cd)]
REMOTE_PROCESS_FINAL_RC=NOT_CAPTURED
~~~

Note: that `dpkg-query` subcommand FAILED because of nested-shell expansion. It is **NOT** package evidence; a later independent read-only command returned `BASH_PKG=bash\\t5.2.21-2ubuntu4`, **but its full invoking command was not embedded in this packet and its final remote rc was not captured**. Label this follow-up evidence `COMMAND_NOT_PRESERVED / REVERIFY_IN_APPROVED_PREFLIGHT`; do not silently erase the failed attempt or claim a successful full script exit. Package provenance must be rechecked during approved preflight.

### 2.4 Catalog health and restart evidence — observed raw command and initial output

Source inspection established `GET /health` is a native route in `src/catalog/http/app.mjs` and reports `ok/service/state/accepting_ingest/blockers`. No customer data read. Read-only request (made **only** under the preceding discovery authorization):

~~~sh
/usr/bin/timeout 12s /bin/bash -c 'set -euo pipefail; printf "UTC_START="; /usr/bin/date -u +%FT%TZ; printf "CATALOG_BEFORE\n"; /usr/bin/systemctl show babypark-catalog-rehearsal.service -p ActiveState -p SubState -p MainPID -p ActiveEnterTimestamp -p NRestarts -p MemoryCurrent -p CPUUsageNSec --no-pager; printf "HEALTH_STATUS\n"; /usr/bin/curl --silent --show-error --max-time 3 --output /dev/null --write-out "HTTP_CODE=%{http_code} TOTAL_TIME_S=%{time_total}\n" http://127.0.0.1:18081/health; printf "CATALOG_AFTER\n"; /usr/bin/systemctl show babypark-catalog-rehearsal.service -p ActiveState -p SubState -p MainPID -p ActiveEnterTimestamp -p NRestarts -p MemoryCurrent -p CPUUsageNSec --no-pager; printf "UTC_END="; /usr/bin/date -u +%FT%TZ'
~~~

~~~text
Process started with PID 187046 (shell: /bin/bash)
Initial output:
UTC_START=2026-10-14T12:42:42Z
CATALOG_BEFORE
MainPID=1525
NRestarts=0
MemoryCurrent=552194048
CPUUsageNSec=273359761000
ActiveState=active
SubState=running
ActiveEnterTimestamp=Wed 2026-09-30 13:22:28 UTC
HEALTH_STATUS
HTTP_CODE=200 TOTAL_TIME_S=0.005645
CATALOG_AFTER
MainPID=1525
NRestarts=0
MemoryCurrent=552300544
CPUUsageNSec=273366485000
ActiveState=active
SubState=running
ActiveEnterTimestamp=Wed 2026-09-30 13:22:28 UTC
UTC_END=2026-10-14T12:42:42Z
[executed on device: babypark-catalog-rehearsal-fra1 (db266e66-2862-4924-b0c6-d9761d3d55cd)]
REMOTE_PROCESS_FINAL_RC=NOT_CAPTURED
~~~

Additional read-only response body transcript from the **separate** prior `curl --silent --show-error --fail --max-time 3 http://127.0.0.1:18081/health`: **the complete containing shell command is not preserved in this packet**, its final remote rc is unknown, and the `ROOT_PARENTS` / `CATALOG_PS` / `FINALIZE_UNIT_METADATA` subsections below do **not** have their exact invocation included. Classification: `COMMAND_NOT_PRESERVED / REVERIFY_IN_APPROVED_PREFLIGHT`. Treat the output as preliminary metadata, not a reproducible host attestation.

~~~text
UTC=2026-10-14T12:44:10Z
HEALTH_METADATA_ONLY={"ok":true,"service":"babypark-catalog-ingest","state":"CURRENT","accepting_ingest":true,"blockers":[]}
ROOT_PARENTS
/var/lib/babypark-rehearsal ABSENT
/opt/babypark-rehearsal OWNER=root:root MODE=755
/tmp OWNER=root:root MODE=1777
CATALOG_PS=   1525  0.0  5.6 13-23:21:41 MainThread
FINALIZE_UNIT_METADATA
Result=exit-code
ExecMainStatus=1
ActiveState=failed
~~~

A separate preceding read-only `systemctl show bp-rehearsal-finalize.service` returned (exact containing shell command **not preserved in this packet**, terminal rc **not captured**; `COMMAND_NOT_PRESERVED / REVERIFY_IN_APPROVED_PREFLIGHT`):

~~~text
Result=exit-code
ExecMainStartTimestamp=Wed 2026-09-30 16:56:55 UTC
ExecMainExitTimestamp=Wed 2026-09-30 17:06:03 UTC
ExecMainStatus=1
Id=bp-rehearsal-finalize.service
Description=/root/bp-finalize-rehearsal.sh
LoadState=loaded
ActiveState=failed
SubState=failed
FragmentPath=/run/systemd/transient/bp-rehearsal-finalize.service
~~~

A prior attempt to parse JSON through `node -e` FAILED due to quoting (`SyntaxError: Invalid or unexpected token`), with no runtime write. No successful substitute is claimed for that parser. A future **approved** preflight must validate the expected health fields with an independently reviewed read-only parser and record its actual rc.

## 3. Proven gaps and planned staging (NOT authorized)

**3.1 Binary immutability.** The live Node `/opt/babypark-rehearsal/runtime/node-v24.20.0/bin/node` is owned by **`bpclaude:bpclaude`**, mode `0755` (mutable by that owner). Do **NOT** chown, replace or modify this live catalog executable: doing so could alter the shared catalog runtime. Instead, after a *separate explicit staging authorization*, create a new **root-owned, read-only immutable campaign-specific** runtime tree under an owner-frozen path (candidate `/opt/babypark-rehearsal/c6-stage-b-phase-a-runtime-ro/bin/node`, **not yet existing**), with root-owned non-user-writable parents and file (e.g. dirs `0755`, node `0555`), separately recorded SHA-256 equal to `89af8424dd53e560b1933f87ba650d8bf57c83ca5a04600eefb31f416aabbae7`. Final **one-command freeze must substitute that pinned new path for the old live Node path**, and check identity/ownership, symlink absence and SHA immediately **before** invoking the fixture. No mutable executable or ancestor may be modifiable by `bpclaude` or UID 65534. Merely hashing the live `bpclaude` binary once at preflight is insufficient. Only a separately approved host preparation may create the copy; none was performed during discovery.

**3.2 UID 65534 access, *without* evidence access.** Approved staging must create an exact-root-owned, nonwritable checkout with full Git history and all source/dependency files, with **execute/traverse permission on every parent directory** from `/opt` to fixture and on staged Node parent(s), plus read access to fixture, holder and needed read-only dependencies by UID/GID 65534. A separate bounded probe under `setpriv --reuid=65534 --regid=65534 --clear-groups --no-new-privs` must verify the ability to execute the **staged** immutable Node and read the fixture/holder and their imports without writing; failure HALT. This access probe is **not** authorization to run the fixture or create SQLite. Conversely, evidence directory is host-owned **`0700 root:root`**, not accessible by 65534; stdout/stderr redirection occurs in the root host supervisor *before* privilege drop. Preserve no-customer-data requirement.

**3.3 Toolchain provenance.** Presence/version observed for `/bin/bash` 5.2.21 and hash `bc5945feb8bd26203ebfafea5ce1878bb2e32cb8fb50ab7ae395cfb1e1aaaef1`; `/bin/sh` resolves to `/usr/bin/dash`; util-linux `2.39.3` for `unshare` and `setpriv`; coreutils `9.4` for `timeout`; Git 2.43.0. Before operator approval verify *no installation* needed, tool executable provenance/permissions and packages via **read-only** `dpkg -S`, `dpkg -V`, and `dpkg-query -W` for **`bash`, `dash`, `coreutils`, `util-linux`, `git`, `procps`** and the exact binary paths: `timeout`, `unshare`, `setpriv`, `env`, `nice`, `mktemp`, `realpath`, `stat`, `awk` (package often `mawk`, VERIFY), `pgrep`, `git`, `sha256sum`, `curl`. A missing/unclassified binary or `dpkg -V` unexpected output HALTs for manual review; package/version evidence can substitute for an individual SHA only after consistent binary ownership/integrity proof. Record absolute interpreter/shebang for **external** supervisor as `#!/bin/bash` or `/bin/bash /exact/approved/script`, freeze Bash SHA/version. **Inside network namespace keep `/bin/sh -ceu` (dash)**; never automatically unify the shells.

**3.4 Scratch filesystem and resources.** `/tmp` currently root-owned mode 1777. The read-only `df -BM /tmp /opt /var/lib` transcript reports `/tmp` on **`/dev/vda1`** with the root filesystem and 71,297 MiB available (i.e. **not reported as tmpfs by that sample**); **actual filesystem type/mount topology is still UNATTESTED** because `df -T`/`findmnt` were not captured. Require read-only `df -T /tmp`, `df -P`, `findmnt -T /tmp` (or exact equivalent) before freeze and again within approved preflight; if tmpfs, account for **shared RAM** and the >=1.5 GiB available-memory floor *concurrently* with >=1 GiB scratch headroom. Do not imply 1 GiB reserved disk consumption; it is a **minimum free-space condition**. Preserve at least **64 MiB** in evidence area, stdout max **32 MiB**; no evidence inside scratch. `/var/lib/babypark-rehearsal` and `/var/lib/babypark-rehearsal/c6-stage-b-phase-a-evidence` currently absent and must be separately created/attested root:root only after owner staging approval. `/opt/babypark-rehearsal/c6-stage-b-phase-a-ro` checkout also absent.

**3.5 Catalog health baseline and ingest policy.** Independently discovered native read-only service contract:
- Systemd `babypark-catalog-rehearsal.service` must be `active/running`; compare **MainPID**, **ActiveEnterTimestamp** and **NRestarts** before/after, not just HTTP.
- Read-only `GET http://127.0.0.1:18081/health` must have HTTP **200**, `ok:true`, `service:"babypark-catalog-ingest"`, `state:"CURRENT"`, `blockers:[]`. Its observed `accepting_ingest:true` means the shared 2-vCPU host may face active ingest during the measurement. **Owner must choose before freeze**: (A) ingest stays enabled, accept/record all contention and prohibit reruns for outliers; or (B) obtain a verified no-ingest **window without service changes**; or (C) request a separately scoped change to pause ingest (NOT authorized here, requires new safety/change gate). Any ambiguous ingest/busy state or failed health check => HALT. Do not silently stop ingest.
- Owner must independently specify **CPU and RAM pre/post thresholds** (not invented from today's quiet snapshot), the approved read-only health parser/commands, the expected pre/post equality contract, and what constitutes unacceptable interference. Measured `MemoryCurrent` in discovery was ~552 MiB; CPUUsageNSec is cumulative, not a momentary CPU percentage. Declare an appropriate bounded sampling period if deriving CPU use; do not infer limits from `ps` instantaneous noise.
- Existing `bp-rehearsal-finalize.service` is **failed** since 2026-09-30; `Result=exit-code`, `ExecMainStatus=1`. Treat as a **known baseline exception**, preserve the same `ActiveState/Result/ExecMainStatus` after Phase A, but do **not** read its logs/secrets or manipulate the unit as part of Phase A. A change or unknown state HALTs. A known failed unrelated unit does not by itself invalidate a healthy catalog service.

**3.6 Network namespace probe.** Merely having util-linux 2.39.3 does **not** prove `unshare --net` works on this Ubuntu kernel. The owner must separately authorize the one-time **root** `unshare --net --fork --kill-child` probe from execution-protocol §4.2, retaining rc, UTC and *restricted raw stderr* and verifying UID/GID 65534, absent external routes/interfaces, without bypasses. **NO namespace capability test was executed in this discovery.** `--kill-child` alone does not prove orphan-free descendant teardown; require read-only scoped census after attempt. If probe nonzero or evidence incomplete: HALT, no fallback root fixture/host-network execution.

**3.7 Launch transport & survivability (F1 — NOT YET SELECTED OR APPROVED).** The **executor** is the appointed BabyPark AI/operator acting **only under the owner's exact, separately signed staging and Phase A authorizations**; Remote Desktop Commander is merely an authorized **control/readout channel**, never the 1200-second process lifetime, stdout/rc authority or a reason to re-run after a client disconnect. Before approval, freeze exactly one **host-resident independently supervised** launch mechanism: the approved root-owned Bash supervisor is started once by a locally supervised process independent of the Remote MCP interactive session; client loss cannot kill, restart, duplicate or detach the run into an unaccounted state. The host-side supervisor itself (not the client) records **UTC start/end and monotonic elapsed for preflight, namespace probe, Phase A, postflight and whole run**, together with raw command rc, status/error classification and exit reason, exact source/binary identifiers, stdout/stderr file paths, byte counts, SHA-256 and scoped process/scratch census into uniquely named, root-owned `0600` files under the owner-frozen `0700` evidence directory OUTSIDE scratch. It must securely retain both **success** and **HALT/partial** evidence before exiting when catchable; the operator reads results and host service status afterward, does not generate missing rc from chat logs. Host-level SIGKILL, supervisor crash or power loss may prevent its final file: in that case an independent service-manager disposition / absence of a complete signed-off result => **HALT/UNKNOWN**, never PASS.

**Optional maintained native choice — only if owner elects it:** `systemd-run` for a **uniquely named transient service with a pinned host-resident supervisor script**, a reviewed `RuntimeMaxSec` envelope protecting the ENTIRE 1200s including pre/post, isolated service cgroup, explicit `KillMode`/termination and read-only `systemctl show` result evidence. Native systemd scope/reaper is preferred over treating `pgrep -u` alone as cleanup proof, but the cgroup and child census remain independently checked: do **not** claim `RuntimeMaxSec` or `--kill-child` guarantees a safe JSON or that every descendant is gone. Dispatch success (`systemd-run rc=0`) means only that the service was submitted, **not** that Phase A ran or passed. The supervisor must write a **no-clobber, restricted** terminal record with rc (if observable), phase timestamps and SHA-bound output; an independent service-manager record of `Result`, `ExecMainCode`, `ExecMainStatus`, `ActiveState` and `InactiveExitTimestamp`/termination metadata must reconcile with that record. An unexpected status, uncaught signal, missing terminal record or orphan => HALT. Alternative transport mechanisms remain **UNSELECTED** and require their own independently reviewed exactly specified equivalent detach, outer-cap, cgroup/census and evidence guarantees.

**Pre-run survivability test gate (separately authorized staging only):** before permitting a real Phase A command, a *harmless, synthetic, bounded, separately approved* dry-run of the chosen host-resident supervisor must demonstrate that deliberately disconnecting the Remote MCP client does **not** cancel the host job, the host itself writes the correct synthetic exit code and UTC markers to the restricted evidence folder, and a second read-only session independently retrieves and confirms result integrity. This is **NOT approved by this file**, does not run Phase A or alter any catalog state. If client disconnect strands a process, result provenance is ambiguous, or the supervisor lacks authority/identity/time proof, HALT and **do not proceed or auto-retry**.

## 4. The single future owner decision — OPEN

All fields below are **UNSIGNED / NOT APPROVED**. An owner approval must explicitly bind this exact completed tuple, not a generic "OK"; a changed HEAD/TREE/base/command invalidates earlier review/approval. **Owner sign-off lives OUTSIDE this immutable Git tree** (for example, the authenticated, timestamped owner instruction in the conversation), and MUST bind the final full HEAD, TREE, freeze-document SHA-256, five-path changed-surface digest, checkout/host identity and exact approved command/script digest. This checked-in packet intentionally remains DRAFT/OPEN even after an external approval; never edit it to claim its own authorization or accept a generic signature not pinned to those values.

| Freeze field | Candidate / required exact value | Owner decision |
|---|---|---|
| Host | `babypark-catalog-rehearsal-fra1`, DigitalOcean droplet `604879613`, observed `MACHINE_ID_SHA256=886acdf18e90e7a4061f546fe03418ea53b4c6fb07e8d5d5eb4fcc23dbc60f81`; independent identity inventory attestation required | **OPEN** |
| Approved staging window and operations | Root-owned **campaign-only runtime copy**, 5-path checkout with Git history, restrictive evidence parent, UID65534 non-writing readability probe | **OPEN — NO STAGING ALLOWED** |
| One-time Phase A UTC window | Exact start UTC and latest stop UTC; shared catalog scheduling | **OPEN** |
| Final HEAD/TREE/base and five-path byte-exact expected diff | Final Git OIDs plus `CAMPAIGN_BASE_OID=565d8de08fbd8e85598e554cb91e59dfa4f8c1a4` | **OPEN** |
| Runtime & supervisor | Campaign-only root-owned staged Node 24.20/SQLite3.53.4, SHA above; external `/bin/bash` hash above; internal `/bin/sh` dash | **OPEN** |
| Installed tools & package provenance | Exact paths, versions/owners, `dpkg -S`/`dpkg -V` attested; missing tools deny | **OPEN** |
| Owner-accepted time allocation | Fit total **1200s**; proposed **60/10/1050/70/10**; inner TERM 1045s + kill-after 5s within 1050s; all nine group hard caps unchanged | **OPEN** |
| Outer supervisor and EXACT single command | Final approved `#!/bin/bash` script, root-owned SHA, global 1200s monotonic cap including pre/post, one `unshare` probe and one Phase A, persisted rc/UTC with `set -C` no-clobber, source/binary pins, independently reconciled supervisor/service-manager exit status | **OPEN** |
| Launch transport & survivability | Freeze ONE detached, host-resident, authorized launcher with executor/permission, cgroup/PID identity, failure/kill policy, evidence written BY HOST regardless of Remote MCP client; `systemd-run` with `RuntimeMaxSec` is an **option**, not approved; require owner-authorized harmless client-disconnect dry-run and reconciled host rc/UTC/proof | **OPEN — NOT SELECTED** |
| Evidence custody | Approved root-owned run-specific `0700` directory **outside scratch**, 0600 files, >=64 MiB free, <=32 MiB stdout, SHA/byte count/rc even HALT (uncatchable loss => HALT/UNKNOWN + service-manager record) | **OPEN** |
| Scratch and residue | `df -T /tmp`, 1 GiB free, RAM accounting if tmpfs; exact `BP_C6_SCRATCH` census, no auto-clean on SIGTERM | **OPEN** |
| Service health contract | `babypark-catalog-rehearsal.service` + localhost `18081/health`; exact full read-only parser, CPU/RAM thresholds, PID/ActiveEnterTimestamp/NRestarts equality | **OPEN** |
| Ingest competition policy | Explicit choice A/B/C from §3.5, no hidden service changes | **OPEN** |
| Existing unit baselines | `bp-rehearsal-finalize.service` failed/exit1 remains unchanged; **`bp-c6poc-desktop-commander.service`** observed `loaded/active/running` in the 2026-10-14 discovery, monitor its state pre/post without changing it | **OPEN** |
| Failure rule | Any unproven host/process/route/toolchain/immutable input, nonzero probe, resource failure, stale refs, incomplete evidence => HALT, no retry, no automatic cleanup | **OPEN** |
| Owner identity / exact authorization message | Owner states approved fields, actions, UTC window, timestamp; separate signed permission for staging and later run | **OPEN** |

**Gate C data contract (precommitted):** Nine synthetic groups provide observational inputs for DELETE-mode `B_wait/B_site`, whole-reader timer/overrun behavior relevant to later `R_seq`, and provisional non-double-counted `K_total`; finite timing samples are **NOT hard conservative production envelopes**, fake UDS server is **NOT live Chatwoot**, and absence of production HTTP/retry/HUMAN/B2 proofs remains HALT for activation. A complete eligible synthetic run must output exactly one validated `PASS_SYNTHETIC_EXECUTION_ONLY` object, rc0, nine correctly ordered groups, expected trial counts and no process/scratch residue. Early PARTIAL_HALT, SIGKILL, unexpected missing files, no full JSON, changed baseline or insufficient resources => HALT, keep evidence, no automatic rerun.

**Separate PR #133 decision:** Docs/ops SidekiqAlive PR #133 at `da739437629df2394f00513402a1688c5dc950fe` remains Draft and must not be merged under this staging/run authorization. Exact-tree/base/Working Agreement merge checks and owner approval for #133 are independent.

## 5. Review checkpoint and sign-off

Independent Sonnet reviewer should audit **this whole new file**, the unchanged reviewed protocol, fixture, manifest and frozen Fit/Scan under one new exact HEAD/TREE/base; verify F1 launch transport independence, host-written raw rc/UTC/evidence and candidate `systemd-run` completeness, N1–N5, raw transcript labels and limitations; ensure unreviewed `bpclaude` Node substitution is impossible, no accidental privilege/ingest/config write, UID65534 accessibility vs root evidence confidentiality, tool/provenance and scratch filesystem classification, exact five-path diff assertion, 1200s total, cleanup authority, and incomplete-owner field denial. Every finding must identify a violated invariant, concrete counterexample, minimal fix and regression. Do not re-run Phase A on a host for this docs review.

**Reviewer result:** OPEN (review not yet performed on this new exact tree).
**Owner staging approval:** OPEN.
**Owner Phase A run approval:** OPEN.
**Owner selected UTC window:** OPEN.
**Owner timestamp / approved command digest:** OPEN.
**Owner #133 merge decision:** SEPARATE / OPEN.
