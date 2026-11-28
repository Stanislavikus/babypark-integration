# BabyPark n8n 2.49.8 — isolated release and recovery runbook

Status: RUNBOOK — implementation candidate; not release approval.
Applies to: one isolated, loopback-only official n8n 2.49.8 service with an independent official PostgreSQL 16.16 service on `chatwoot-fra1-01`.
Supersedes: prior SQLite backup/restore directions only; `docs/N8N_SQLITE_BUSY_TIMEOUT_COMPATIBILITY_20261128.md` remains historical evidence.
Owner: BabyPark.

## Release boundary

- Use only `deploy/n8n/compose.yaml`, `deploy/n8n/compose.restore.yaml`, their official image digests, and the systemd mount/service units in `deploy/n8n/systemd/`. PostgreSQL is private to this n8n project; never use a Chatwoot database, cluster, volume or credential.
- Keep workflow definitions inactive. Do not configure real credentials, Chatwoot endpoints, Viber, buyer messages, public webhook routing, reverse-proxy routing, or TLS publication.
- The previous successful SQLite import of the 22-node `bpAiSellerChatwootHandoffShadowNov23` export (SHA-256 `7bcbb2b5dfb6a5e63209e4d163c42eeb04d95e6b513a159367ebe3cbeb963672`) and 6-node `bpAiSilenceWatchdogNov23` export (SHA-256 `18a1c9377236ed693420fc9f5f09351dab3e3f4fec80c06d2073866148c4cdec`) is complete and will not be repeated. Under a separate release GO, only the required PostgreSQL compatibility check may import those exact files once into the new blank PostgreSQL database through the official n8n CLI. Verify IDs/node counts and `active=false`; never import DEV DB/history/credentials. After every restart and restore, confirm those same two workflows remain present and OFF. Missing/different exports, unknown workflows or active state stop acceptance.
- The SQLite import is historical evidence only. It does not authorize a SQLite exception or define the selected backend; the only implementation backend is the independent PostgreSQL service above.
- The existing 4-GiB host remains the selected target. Compose hard limits are n8n 1,200 MiB / 1 CPU and PostgreSQL 512 MiB / 0.5 CPU, with swap disabled for both; neither cap is a measured peak. A separate release GO must require actual per-container `memory.current`, `memory.peak`, `memory.events`, host RAM/PSI/swap/CPU/I/O, PostgreSQL health and Chatwoot TTFB through pull, migration, start, import, restart and restore. Stop only this Compose project if the approved reserve or Chatwoot/Viber health fails.
- Do not install Docker, create host paths, or enable these units until a separate exact-basis `release GO` is recorded. Installation must not restart or edit Chatwoot or Viber.

## Install the files and key

After release GO and successful Chatwoot/Viber backup and host baseline checks, install the Docker Engine and Compose plugin only through Docker's official repository/packages. Record exact package versions and compare firewall/routing state before and after installation. Do not change daemon-wide firewall settings. Because Docker Engine releases before `28.0.0` can expose ports published to localhost to peers on the same L2 segment, fail closed unless the server Engine is at least `28.0.0`; this is a minimum for the approved loopback-only publication, not a request to upgrade Docker during this campaign.

Before creating host paths or starting any container, verify the Docker **server** version. Malformed, suffixed, or older versions fail closed:

```sh
set -euo pipefail
unset DOCKER_CONTEXT DOCKER_HOST
engine_version=$(/usr/bin/docker --host=unix:///var/run/docker.sock version --format '{{.Server.Version}}')
python3 - "$engine_version" <<'PY'
import re
import sys

match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", sys.argv[1])
if not match or tuple(map(int, match.groups())) < (28, 0, 0):
    raise SystemExit("Docker Engine server must be an unsuffixed version >= 28.0.0")
PY
printf 'Docker Engine server version gate: PASS (%s)\n' "$engine_version"
compose_version=$(/usr/bin/docker --host=unix:///var/run/docker.sock compose version --short)
python3 - "$compose_version" <<'PY'
import re
import sys

match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", sys.argv[1])
if not match or tuple(map(int, match.groups())) < (5, 8, 1):
    raise SystemExit("Docker Compose CLI must be an unsuffixed version >= 5.8.1")
PY
printf 'Docker Compose plugin version gate: PASS (%s)\n' "$compose_version"
if DOCKER_CONTEXT=babypark-n8n-invalid DOCKER_HOST=tcp://127.0.0.1:1 /usr/bin/docker --host=unix:///var/run/docker.sock info --format '{{.Name}}' >/dev/null; then
  printf '%s\n' 'wrong-context override check: PASS (explicit local socket selected)'
else
  printf '%s\n' 'STOP: explicit local Docker socket did not override the injected invalid context.' >&2
  exit 1
fi
```

Create `/opt/babypark-n8n` root-owned, copy `compose.yaml` and `compose.restore.yaml` there, and retain the non-secret example. Use Docker Compose plugin 5.8.1 or newer; it is the minimum tested for long-bind `create_host_path: false` and `!override` support. Before creating PostgreSQL state, use the pinned official PostgreSQL image to inspect its UID/GID. The registered `n8n_state_root` parent `/var/lib/babypark-n8n` must be a real, non-symlink `root:root` mode `0755` directory. First install requires `user`, `postgres`, and `restore-test` to be absent: create empty `user` as UID/GID 1000 mode `0700`, and empty `postgres` as the UID/GID reported by that pinned image mode `0700`. If either live target already exists or contains prior state, stop; never reuse Chatwoot or prior n8n paths. Create `/var/backups/babypark-n8n` and `/etc/babypark-n8n` root-owned mode `0700`.

```sh
set -euo pipefail
unset DOCKER_CONTEXT DOCKER_HOST
postgres_image=postgres:16.16@sha256:ce81150802644ddfac1db4da9e63be6f2a3818aa6ee98a7a28838aeea65dc37a
postgres_uid=$(/usr/bin/docker --host=unix:///var/run/docker.sock run --rm --entrypoint id "$postgres_image" -u postgres)
postgres_gid=$(/usr/bin/docker --host=unix:///var/run/docker.sock run --rm --entrypoint id "$postgres_image" -g postgres)
[[ "$postgres_uid" =~ ^[0-9]+$ && "$postgres_gid" =~ ^[0-9]+$ ]]
state_root=/var/lib/babypark-n8n
if [[ -e "$state_root" || -L "$state_root" ]]; then
  test -d "$state_root" && test ! -L "$state_root"
  test "$(stat -c '%U:%G:%a' "$state_root")" = root:root:755
else
  mkdir -m 0755 -- "$state_root"
  chown root:root "$state_root"
fi
test -z "$(find "$state_root" -mindepth 1 -maxdepth 1 -print -quit)"
test ! -e "$state_root/user" && test ! -L "$state_root/user"
test ! -e "$state_root/postgres" && test ! -L "$state_root/postgres"
test ! -e "$state_root/restore-test" && test ! -L "$state_root/restore-test"
mkdir -m 0700 -- "$state_root/user"
chown 1000:1000 "$state_root/user"
mkdir -m 0700 -- "$state_root/postgres"
chown "$postgres_uid:$postgres_gid" "$state_root/postgres"
test "$(stat -c '%U:%G:%a' "$state_root")" = root:root:755
test "$(stat -c '%u:%g:%a' "$state_root/user")" = 1000:1000:700
test "$(stat -c '%u:%g:%a' "$state_root/postgres")" = "$postgres_uid:$postgres_gid:700"
```

Before creating or starting the n8n container, verify the target's Docker storage and key-access boundary without changing shared Docker permissions. As root, record the Docker Engine version, `/usr/bin/docker --host=unix:///var/run/docker.sock info --format '{{.DockerRootDir}}'`, `/usr/bin/docker --host=unix:///var/run/docker.sock info --format '{{.Driver}}'`, `/usr/bin/docker --host=unix:///var/run/docker.sock info --format '{{json .DriverStatus}}'`, `namei -l "$(/usr/bin/docker --host=unix:///var/run/docker.sock info --format '{{.DockerRootDir}}')"`, and `stat -c '%a %U:%G %n' /var/run/docker.sock "$(/usr/bin/docker --host=unix:///var/run/docker.sock info --format '{{.DockerRootDir}}')"`. The registered Docker metadata root is `/var/lib/docker`; if the reported root differs, stop and update the reviewed storage inventory before release. Docker Engine 29.0 and later may use `/var/lib/containerd` for image content/snapshots, which is separately registered; record the active image-store path and stop if any writable Docker/containerd root is not registered. Access to a rootful Docker socket permits root-equivalent inspection of container environment metadata, including the n8n encryption key. Use the check below to require a root-owned socket with no world access and compare the union of supplementary-group members and all accounts whose primary GID equals the socket GID against the exact owner-approved host-admin roster. The roster must be supplied to the root shell in APPROVED_DOCKER_ADMINS as comma-separated account names. This check supports only the local `files` source for both passwd and group in `/etc/nsswitch.conf`; it verifies those configured NSS sources before accepting `getent` enumeration as complete. If either database uses another source (such as LDAP or SSSD), stop unless a reviewed provider-specific completeness proof replaces this check. A successful partial provider enumeration is not evidence of a complete roster. The command emits only PASS/FAIL and never displays account names or the environment value.

```sh
set -euo pipefail
docker_socket=/var/run/docker.sock
socket_stat=$(stat -c '%a %U:%G %g' "$docker_socket")
read -r socket_mode socket_owner_group socket_gid <<< "$socket_stat"
test "${socket_owner_group%%:*}" = root
if (( (8#$socket_mode & 0007) != 0 )); then
  printf '%s\n' 'Refusing world access to the rootful Docker socket.' >&2
  exit 1
fi
python3 - "$socket_owner_group" "$socket_gid" <<'PY'
import os
import re
import subprocess
import sys

def stop(message):
    raise SystemExit(message)

try:
    nsswitch_lines = open("/etc/nsswitch.conf", encoding="utf-8").read().splitlines()
except OSError:
    stop("UNVERIFIED: NSS source configuration is unavailable.")
configured = {}
for raw_line in nsswitch_lines:
    fields = raw_line.split("#", 1)[0].split()
    if not fields or ":" not in fields[0]:
        continue
    database = fields[0].split(":", 1)[0]
    if database in ("passwd", "group"):
        if database in configured:
            stop("UNVERIFIED: duplicate NSS source configuration is unsupported.")
        configured[database] = fields[1:]
for database in ("passwd", "group"):
    if configured.get(database) != ["files"]:
        stop("UNVERIFIED: only local files NSS enumeration is supported; provider-specific completeness proof is required.")

approved_text = os.environ.get("APPROVED_DOCKER_ADMINS", "")
approved = set(approved_text.split(","))
if not approved_text or "" in approved or any(not re.fullmatch(r"[A-Za-z0-9_.@$-]+", name) for name in approved):
    stop("UNVERIFIED: exact owner-approved Docker admin roster is required.")
owner_group = sys.argv[1]
if ":" not in owner_group:
    stop("UNVERIFIED: Docker socket group is unavailable.")
group_name = owner_group.split(":", 1)[1]
try:
    group_lines = subprocess.check_output(["getent", "group", group_name], text=True).splitlines()
    passwd_lines = subprocess.check_output(["getent", "passwd"], text=True).splitlines()
except (OSError, subprocess.CalledProcessError):
    stop("UNVERIFIED: complete NSS group/passwd enumeration is unavailable.")
if len(group_lines) != 1 or not passwd_lines:
    stop("UNVERIFIED: complete NSS group/passwd enumeration is unavailable.")
group_fields = group_lines[0].split(":")
if len(group_fields) != 4 or group_fields[0] != group_name or group_fields[2] != sys.argv[2]:
    stop("UNVERIFIED: Docker socket group identity does not resolve exactly.")
supplementary = set(filter(None, group_fields[3].split(",")))
primary = set()
for line in passwd_lines:
    fields = line.split(":")
    if len(fields) < 4:
        stop("UNVERIFIED: NSS passwd enumeration returned an invalid record.")
    if fields[3] == sys.argv[2]:
        primary.add(fields[0])
if not (supplementary | primary) <= approved:
    stop("Refusing an unapproved effective Docker socket group member.")
print("Docker socket effective-access roster: PASS")
PY
```

The owning group is not the complete access list: fail closed if `getfacl` is unavailable or if the socket has any named user/group ACL entry. The check below prints only a pass/fail result and does not reveal account names:

```sh
set -euo pipefail
docker_socket=/var/run/docker.sock
command -v getfacl >/dev/null 2>&1 || { printf '%s\n' 'getfacl is required to verify the Docker socket ACL.' >&2; exit 1; }
acl_output=$(getfacl --omit-header -- "$docker_socket")
if ! printf '%s\n' "$acl_output" | awk -F: '/^(user|group):[^:]+:/ { named=1 } END { exit named ? 1 : 0 }'; then
  printf '%s\n' 'Refusing an unreviewed named ACL entry on the Docker socket.' >&2
  exit 1
fi
printf '%s\n' 'Docker socket named-ACL check: PASS (none)'
```

Generate two independent random 32-byte hex values on the target and publish them to `/etc/babypark-n8n/n8n.env` only if that path does not already exist, including as a symlink. The n8n encryption key and PostgreSQL password must differ. Run in a root Bash shell with tracing disabled. Strict mode stops on OpenSSL or write failure; `noclobber` prevents replacing a secret file created between the absence check and publication. Never print a secret or pass one on a command line:

```sh
set -euo pipefail
set +x
umask 077
install -d -o root -g root -m 0700 /etc/babypark-n8n
key_file=/etc/babypark-n8n/n8n.env
if [[ -e "$key_file" || -L "$key_file" ]]; then
  printf '%s\n' 'Refusing to replace an existing n8n encryption key file.' >&2
  exit 1
fi
encryption_key=$(openssl rand -hex 32)
postgres_password=$(openssl rand -hex 32)
[[ "$encryption_key" =~ ^[[:xdigit:]]{64}$ && "$postgres_password" =~ ^[[:xdigit:]]{64}$ ]]
test "$encryption_key" != "$postgres_password"
(
  set -o noclobber
  printf 'N8N_ENCRYPTION_KEY=%s\nPOSTGRES_PASSWORD=%s\n' "$encryption_key" "$postgres_password" > "$key_file"
)
unset encryption_key postgres_password
chown root:root "$key_file"
chmod 0600 "$key_file"
test "$(stat -c '%U:%G:%a' "$key_file")" = root:root:600
```

The service rejects either missing/malformed secret and rejects equal values. Compose receives both through systemd's root-only environment file. The Docker data root and daemon socket are part of the key security boundary; complete the host access checks above before creating or starting the container.

Install `babypark-n8n.service` and the exactly named escaped mount unit from `deploy/n8n/systemd/` under `/etc/systemd/system/`, then run `systemctl daemon-reload`. The service has an explicit dependency on `run-babypark\x2dn8n\x2druntime.mount`, verifies that the exact mount point is tmpfs with `noswap`, and binds the mount lifecycle to the service. Each start also requires `/etc/babypark-n8n` to remain `root:root` mode `0700` and `n8n.env` to remain `root:root` mode `0600`, before validating the key. The mount unit has PartOf=babypark-n8n.service, which propagates service stop/restart to the mount; normal service stop clears execution/event data from tmpfs. After the mount, permission and key checks pass, its `ExecStartPre` creates the primary `/run/babypark-n8n-runtime/storage` and `/run/babypark-n8n-runtime/events` directories as UID/GID 1000 mode `0700`; this runs on every service start and never creates directories outside the verified mount. If any check fails or the host kernel/systemd rejects `noswap`, the service must remain stopped; do not replace it with a swap-capable container tmpfs.

Before enablement, render the Compose configuration and print only approved non-secret fields; omit the environment map because it contains both secrets. Verify the official n8n and PostgreSQL digests, loopback-only UI, independent durable paths, unpublished database port, internal bridge, hard resource caps and disabled container swap:

```sh
set -euo pipefail
unset DOCKER_CONTEXT DOCKER_HOST
/usr/bin/docker --host=unix:///var/run/docker.sock compose --env-file /etc/babypark-n8n/n8n.env --project-directory /opt/babypark-n8n -f /opt/babypark-n8n/compose.yaml config --format json \
  | python3 -c 'import json,sys; c=json.load(sys.stdin); n=c["services"]["n8n"]; p=c["services"]["postgres"]; networks=n.get("networks",{}); assert len(networks)==1; name=next(iter(networks)); assert c["networks"][name]["internal"] is True; assert n["environment"]["DB_TYPE"]=="postgresdb" and n["environment"]["DB_POSTGRESDB_HOST"]=="postgres"; assert not p.get("ports"); assert n["mem_limit"]=="1200m" and n["memswap_limit"]=="1200m"; assert p["mem_limit"]=="512m" and p["memswap_limit"]=="512m"; print("n8n image:",n["image"]); print("PostgreSQL image:",p["image"]); [print("port:",x.get("host_ip"),x.get("published"),"->",x.get("target"),x.get("protocol")) for x in n.get("ports",[])]; [print("bind:",v.get("source"),"->",v.get("target")) for s in (n,p) for v in s.get("volumes",[]) if v.get("type")=="bind"]; print("network count:",len(networks),"internal:",c["networks"][name]["internal"]); print("memory caps: n8n",n["mem_limit"],"PostgreSQL",p["mem_limit"])'
```

Require output to show the pinned n8n/PostgreSQL image digests, `127.0.0.1:5678`, `/var/lib/babypark-n8n/user -> /home/node/.n8n`, `/var/lib/babypark-n8n/postgres -> /var/lib/postgresql/data`, `/run/babypark-n8n-runtime -> /vol`, both hard memory caps and equal memory-swap caps, and exactly one service network marked `internal: true`; do not print rendered environment values. PostgreSQL has no published port. The restore overlay inherits the private bridge and overrides only the registered user/PGDATA restore paths, tmpfs paths and loopback UI port. Verify after start that each service has exactly one network attachment and `/usr/bin/docker --host=unix:///var/run/docker.sock network inspect` reports `Internal=true`; the editor answers only on `127.0.0.1:5678`. Verify the exact host `tmpfs,noswap` mount. Run the negative start test against only the new n8n units: stop the n8n service/runtime mount, temporarily mask `run-babypark\x2dn8n\x2druntime.mount`, and require the service to fail before a container appears. Unmask/reset only these n8n units. Then perform one positive start; do not repeat the successful workflow import. Never test against Chatwoot, Viber or DEV n8n units.

Immediately after the successful start, check the actual container attachment rather than relying on the rendered file alone. This inspects only the new n8n container/network and emits no credentials:

```sh
set -euo pipefail
container_id=$(/usr/bin/docker --host=unix:///var/run/docker.sock compose --env-file /etc/babypark-n8n/n8n.env --project-directory /opt/babypark-n8n -f /opt/babypark-n8n/compose.yaml ps --all --quiet n8n)
test -n "$container_id"
test "$(/usr/bin/docker --host=unix:///var/run/docker.sock inspect --format '{{len .NetworkSettings.Networks}}' "$container_id")" = 1
network_id=$(/usr/bin/docker --host=unix:///var/run/docker.sock inspect --format '{{range .NetworkSettings.Networks}}{{.NetworkID}}{{end}}' "$container_id")
test -n "$network_id"
test "$(/usr/bin/docker --host=unix:///var/run/docker.sock network inspect --format '{{.Internal}}' "$network_id")" = true
curl --fail --silent --show-error --max-time 5 --output /dev/null http://127.0.0.1:5678/
printf '%s\n' 'n8n internal network and loopback editor checks: PASS'
```

If any assertion fails, stop only `babypark-n8n.service`. Do not add a second network, alter host firewall rules, or expose another host address to restore local UI access.

The internal bridge inspection is the primary no-egress control. Add a bounded negative connection test from inside n8n to reserved documentation-only IP ranges. Only an explicit no-route/unsupported-family result counts as PASS; a connection, refusal, timeout, or any other result is UNVERIFIED/STOP. This confirms the container cannot route to an external integration endpoint without contacting a real service:

```sh
set -euo pipefail
/usr/bin/docker --host=unix:///var/run/docker.sock compose --env-file /etc/babypark-n8n/n8n.env --project-directory /opt/babypark-n8n -f /opt/babypark-n8n/compose.yaml exec --no-TTY n8n node -e '
const net = require("node:net");
const check = (host, family) => new Promise((resolve, reject) => {
  const socket = net.createConnection({ host, port: 443, family });
  const timeout = setTimeout(() => {
    socket.destroy();
    reject(new Error("egress test timed out"));
  }, 3000);
  socket.once("connect", () => {
    clearTimeout(timeout);
    socket.destroy();
    reject(new Error("external egress connection succeeded"));
  });
  socket.once("error", (error) => {
    clearTimeout(timeout);
    if (["ENETUNREACH", "EHOSTUNREACH", "EAFNOSUPPORT"].includes(error.code)) resolve(error.code);
    else reject(new Error(`egress test inconclusive (${error.code || "unknown"})`));
  });
});
Promise.all([check("203.0.113.1", 4), check("2001:db8::1", 6)])
  .then((results) => console.log(`external egress denial: PASS (${results.join(",")})`))
  .catch((error) => { console.error(`STOP: ${error.message}`); process.exitCode = 1; });
'
```

If either family connects, refuses, times out, or returns another error, stop only n8n and record this release gate as failed or unverified. Do not replace this check with a live URL or a real customer/partner endpoint.

The positive start test starts a blank n8n database. Confirm the container is running and the editor responds on `127.0.0.1:5678`; do not create credentials or import workflows before the Docker metadata access check below. Before accepting loopback-only reachability, run the following from a separate host on the same L2 segment, setting `SERVER_LAN_IP` to the target server's verified LAN address. Record the peer and target address. A successful TCP connection is a STOP; an explicit connection refusal is the only probe result accepted as PASS. A timeout, unreachable route, invalid address, DNS/tool error, missing peer, or any other inconclusive result is UNVERIFIED and requires leaving n8n stopped. If no same-L2 peer probe is available, leave the service stopped and record this network gate as unverified. Do not substitute a probe from the Docker host itself. The server Engine version gate above remains mandatory even if the peer probe is blocked by a host firewall.

```sh
set -euo pipefail
: "${SERVER_LAN_IP:?Set this to the target server LAN IP from the same-L2 peer}"
python3 - "$SERVER_LAN_IP" <<'PY'
import ipaddress
import socket
import sys

try:
    target = str(ipaddress.ip_address(sys.argv[1]))
    connection = socket.create_connection((target, 5678), timeout=3)
except ConnectionRefusedError:
    print("same-L2 n8n TCP probe: PASS (connection refused)")
except (OSError, ValueError) as error:
    raise SystemExit(f"UNVERIFIED: same-L2 n8n TCP probe inconclusive ({type(error).__name__})") from None
else:
    connection.close()
    raise SystemExit("STOP: n8n port 5678 accepted TCP from a same-L2 peer")
PY
```

The systemd unit starts Compose detached, so n8n stdout is not attached to journald; Docker logging also uses the `none` driver. The oneshot unit does not supervise the container, and the container has no automatic restart policy. Do not add a public reverse proxy or firewall opening.

Immediately after the first successful start and before accepting the service, as root resolve its generated Compose container ID from the project/service and verify the `config.v2.json` metadata file under the reported Docker root is owned by `root:root` with no group/other permission bits. Run with shell error-exit enabled, do not read or print the file contents, and record only the path, owner and mode:

```sh
set -eu
docker_root=$(/usr/bin/docker --host=unix:///var/run/docker.sock info --format '{{.DockerRootDir}}')
container_id=$(/usr/bin/docker --host=unix:///var/run/docker.sock compose --env-file /etc/babypark-n8n/n8n.env --project-directory /opt/babypark-n8n -f /opt/babypark-n8n/compose.yaml ps --all --quiet n8n)
test -n "$container_id"
metadata="$docker_root/containers/$container_id/config.v2.json"
test -f "$metadata"
test "$(stat -c '%U:%G' "$metadata")" = root:root
mode=$(stat -c '%a' "$metadata")
test "$((0$mode & 0077))" -eq 0
stat -c '%a %U:%G %n' "$metadata"
```

If the target Docker layout differs or any unapproved account can read the key-bearing metadata, stop and disable only n8n and escalate; do not blanket `chmod`/`chown` the shared Docker root, socket, or metadata because that can break Chatwoot/Viber containers.

Before creating credentials or workflows, check that `/var/lib/babypark-n8n/postgres` and `/var/lib/babypark-n8n/user` are the registered paths and PostgreSQL is healthy. Under separate release GO, stage only the exact two approved workflow exports from an owner-provided protected source into the registered host tmpfs. Do not add them to Git or another durable path:

```sh
set -euo pipefail
set +x
unset DOCKER_CONTEXT DOCKER_HOST
: "${WORKFLOW_SOURCE_DIR:?Set to the protected directory containing only the two owner-approved JSON exports}"
install -d -o 1000 -g 1000 -m 0700 /run/babypark-n8n-runtime/import
test "$(sha256sum "$WORKFLOW_SOURCE_DIR/bpAiSellerChatwootHandoffShadowNov23.json" | cut -d ' ' -f 1)" = 7bcbb2b5dfb6a5e63209e4d163c42eeb04d95e6b513a159367ebe3cbeb963672
test "$(sha256sum "$WORKFLOW_SOURCE_DIR/bpAiSilenceWatchdogNov23.json" | cut -d ' ' -f 1)" = 18a1c9377236ed693420fc9f5f09351dab3e3f4fec80c06d2073866148c4cdec
install -o 1000 -g 1000 -m 0600 "$WORKFLOW_SOURCE_DIR/bpAiSellerChatwootHandoffShadowNov23.json" /run/babypark-n8n-runtime/import/main.json
install -o 1000 -g 1000 -m 0600 "$WORKFLOW_SOURCE_DIR/bpAiSilenceWatchdogNov23.json" /run/babypark-n8n-runtime/import/watchdog.json
/usr/bin/docker --host=unix:///var/run/docker.sock compose --env-file /etc/babypark-n8n/n8n.env --project-directory /opt/babypark-n8n -f /opt/babypark-n8n/compose.yaml exec -T --user node n8n n8n import:workflow --input=/vol/import/main.json
/usr/bin/docker --host=unix:///var/run/docker.sock compose --env-file /etc/babypark-n8n/n8n.env --project-directory /opt/babypark-n8n -f /opt/babypark-n8n/compose.yaml exec -T --user node n8n n8n import:workflow --input=/vol/import/watchdog.json
```

This is the only PostgreSQL-backed compatibility import; the earlier successful SQLite import is not repeated. Verify the two exact workflow names/IDs and node counts (`22` and `6`) in the local UI/database and confirm both are inactive before proceeding. Remove only `/run/babypark-n8n-runtime/import/` after verification. Never reimport on restart or restore. If either protected export is missing or its hash differs, leave the PostgreSQL database blank and stop. Keep the n8n unit disabled for host boot until every release acceptance gate below has passed and the owner-authorized trial is accepted. After later restart/restore, verify presence and OFF state only. On failure stop only `babypark-n8n.service`; do not alter Docker, Chatwoot or Viber. After an authorized Docker daemon restart, restart only the n8n unit so its mount/key checks run again.

### Record resource peaks and Chatwoot latency

Before the image pull, create one root-only evidence file below the registered `/var/backups/babypark-n8n` path. Set `CHATWOOT_TTFB_URL` to the exact same low-rate, unauthenticated Chatwoot route used in the approved pre-install baseline; do not invent a route or send customer content. Run `capture_phase` before and after image pull, PostgreSQL initialization/migration, n8n start, the single PostgreSQL workflow import, restart, backup, and restore. Each container's cgroup `memory.peak` and `memory.events` retain the actual maximum/OOM counts for that container lifetime; the host samples capture Docker daemon and total-host overhead too.

```sh
set -euo pipefail
set +x
unset DOCKER_CONTEXT DOCKER_HOST
: "${CHATWOOT_TTFB_URL:?Use the identical Chatwoot route recorded in the pre-install baseline}"
install -d -o root -g root -m 0700 /var/backups/babypark-n8n
resource_log="/var/backups/babypark-n8n/resource-trial-$(date -u +%Y%m%dT%H%M%SZ).tsv"
( set -o noclobber; : > "$resource_log" )
chmod 0600 "$resource_log"
capture_phase() {
  phase=$1
  scope=${2:-primary}
  compose_args=(--env-file /etc/babypark-n8n/n8n.env --project-directory /opt/babypark-n8n -f /opt/babypark-n8n/compose.yaml)
  if test "$scope" = restore; then
    : "${backup_dir:?Set to the exact verified synthetic-only backup generation}"
    compose_args=(--env-file "$backup_dir/n8n.env" -p babypark-n8n-restore -f /opt/babypark-n8n/compose.yaml -f /opt/babypark-n8n/compose.restore.yaml)
  fi
  printf 'phase\t%s\tutc\t%s\n' "$phase" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$resource_log"
  awk '/^MemAvailable:/ {print "MemAvailable_kB\t" $2}' /proc/meminfo >> "$resource_log"
  awk '{print "memory_psi\t" $0}' /proc/pressure/memory >> "$resource_log"
  awk '/^(pswpin|pswpout) / {print "swap_pages\t" $0}' /proc/vmstat >> "$resource_log"
  awk '/^cpu / {print "cpu\t" $0}' /proc/stat >> "$resource_log"
  cat /proc/loadavg | awk '{print "load\t" $0}' >> "$resource_log"
  awk '{print "diskstats\t" $0}' /proc/diskstats >> "$resource_log"
  for service_name in postgres n8n; do
    container_id=$(/usr/bin/docker --host=unix:///var/run/docker.sock compose "${compose_args[@]}" ps --all --quiet "$service_name" 2>/dev/null || true)
    test -n "$container_id" || continue
    container_pid=$(/usr/bin/docker --host=unix:///var/run/docker.sock inspect --format '{{.State.Pid}}' "$container_id")
    test "$container_pid" -gt 0 || continue
    cgroup_rel=$(awk -F: '$1 == "0" {print $3}' "/proc/$container_pid/cgroup")
    cgroup_dir="/sys/fs/cgroup$cgroup_rel"
    test -r "$cgroup_dir/memory.current" && test -r "$cgroup_dir/memory.peak" && test -r "$cgroup_dir/memory.events"
    printf 'container\t%s\tid\t%s\tcurrent\t%s\tpeak\t%s\tevents\t%s\n' "$service_name" "$container_id" "$(cat "$cgroup_dir/memory.current")" "$(cat "$cgroup_dir/memory.peak")" "$(tr '\n' ';' < "$cgroup_dir/memory.events")" >> "$resource_log"
  done
  ttfb=$(curl --fail --silent --show-error --max-time 5 --output /dev/null --write-out '%{http_code} %{time_starttransfer}' "$CHATWOOT_TTFB_URL")
  printf 'chatwoot_ttfb\t%s\t%s\n' "$phase" "$ttfb" >> "$resource_log"
}
capture_phase before-image-pull
```

Require cgroup v2 (`test -r /sys/fs/cgroup/cgroup.controllers`) before relying on these measurements. In the same root Bash session, run `capture_phase after-image-pull` after `docker compose pull`; run `capture_phase after-first-start` after PostgreSQL initialization and n8n's initial schema migration; run `capture_phase after-postgres-import` after the sole PG-backed workflow import; run `capture_phase after-restart` after the n8n/PostgreSQL restart; then use `capture_phase before-restore restore`, `capture_phase after-restore-start restore` and `capture_phase after-restore-stop primary` around the clean restore. At each phase also record the exact command exit status and elapsed seconds. The file contains measurements only; keep owner/mode `root:root 0600`. Require host `MemAvailable` to remain at least 1 GiB, no OOM/limit events, no sustained PSI/swap churn, healthy PostgreSQL, and no repeatable Chatwoot TTFB/health regression. A failed threshold means stop only `babypark-n8n.service`, retain this evidence file, and do not resize RAM in this campaign. Include before/after readings for both services' peaks and report the numeric result before any release decision.

## Independent backup

Back up before every n8n/PostgreSQL configuration or image change and daily during the bounded trial. Keep seven verified same-host generations. This package does not claim off-host disaster recovery until an owner-approved encrypted target and key-handling procedure are configured.

The backup set consists of a PostgreSQL custom-format logical dump, the complete n8n user-settings directory, and the matching environment file containing the separate encryption and database secrets. The PostgreSQL dump is never sourced from Chatwoot. Stop n8n first so no workflow can write; start only the n8n PostgreSQL service for `pg_dump`; then stop PostgreSQL before archiving the user folder. Do not use `/usr/bin/docker --host=unix:///var/run/docker.sock compose down -v` or copy the DEV database.

```sh
set -euo pipefail
set +x
unset DOCKER_CONTEXT DOCKER_HOST
umask 077
/usr/bin/docker --host=unix:///var/run/docker.sock compose --env-file /etc/babypark-n8n/n8n.env --project-directory /opt/babypark-n8n -f /opt/babypark-n8n/compose.yaml stop n8n
/usr/bin/docker --host=unix:///var/run/docker.sock compose --env-file /etc/babypark-n8n/n8n.env --project-directory /opt/babypark-n8n -f /opt/babypark-n8n/compose.yaml up -d postgres
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="/var/backups/babypark-n8n/$stamp"
mkdir -m 0700 -- "$backup_dir"
dump_tmp="$backup_dir/n8n.pgdump.partial"
dump="$backup_dir/n8n.pgdump"
user_archive="$backup_dir/user-folder.tar.gz"
key_copy="$backup_dir/n8n.env"
/usr/bin/docker --host=unix:///var/run/docker.sock compose --env-file /etc/babypark-n8n/n8n.env --project-directory /opt/babypark-n8n -f /opt/babypark-n8n/compose.yaml exec -T postgres pg_dump --no-owner --format=custom --username=n8n --dbname=n8n > "$dump_tmp"
test -s "$dump_tmp"
mv -nT -- "$dump_tmp" "$dump"
/usr/bin/docker --host=unix:///var/run/docker.sock compose --env-file /etc/babypark-n8n/n8n.env --project-directory /opt/babypark-n8n -f /opt/babypark-n8n/compose.yaml stop postgres
tar --numeric-owner --xattrs --acls -czf "$user_archive" -C /var/lib/babypark-n8n/user .
tar -tzf "$user_archive" > /dev/null
install -o root -g root -m 0600 /etc/babypark-n8n/n8n.env "$key_copy"
(
  cd "$backup_dir"
  /usr/bin/docker --host=unix:///var/run/docker.sock compose --env-file /etc/babypark-n8n/n8n.env --project-directory /opt/babypark-n8n -f /opt/babypark-n8n/compose.yaml run --rm --no-deps -T --entrypoint pg_restore postgres --list < n8n.pgdump > /dev/null
  sha256sum n8n.pgdump user-folder.tar.gz n8n.env > SHA256SUMS.partial
  chmod 0600 SHA256SUMS.partial
  sha256sum -c SHA256SUMS.partial > /dev/null
  test ! -e SHA256SUMS
  mv -nT -- SHA256SUMS.partial SHA256SUMS
  sha256sum -c SHA256SUMS > /dev/null
)
printf '%s\n' 'n8n PostgreSQL backup generation: PASS'
```

If any command fails, leave the service stopped, preserve the incomplete generation for inspection, and do not call it a backup. Verify `(cd "$backup_dir" && sha256sum -c SHA256SUMS)` without printing secrets. Directories must be `0700`, files `0600`, owned by `root:root`. A verified generation is complete only when all three payload files and the final checksum manifest exist, and the pinned official PostgreSQL client's `pg_restore --list` succeeds. Never store decrypted credential exports in backups. After a complete verified generation, run `systemctl restart babypark-n8n.service`, then verify both Compose services are healthy and the mount/key preflights pass.

## Clean PostgreSQL and encryption-key restore

Perform this only under the release GO using synthetic state and exactly one unreferenced Basic Auth dummy credential named `BabyPark restore dummy (synthetic)`, username `restore-test-user`, password `NOT-A-REAL-CREDENTIAL-restore-test-2026-11-27`. Do not attach it to a workflow or execute a request. The values are public test fixtures, not real credentials. Use a verified backup from that synthetic-only instance.

1. Set `backup_dir` to one exact verified generation, stop the n8n service, verify the checksum manifest, and require the existing `/var/lib/babypark-n8n/restore-test` path to be absent including as a symlink. Never clear or reuse occupied restore state.
2. Create `/var/lib/babypark-n8n/restore-test` root-owned mode `0700`; create `user` owned by UID/GID 1000 mode `0700`. Create `postgres` with the verified PostgreSQL image UID/GID and mode `0700`. Extract the complete user-folder archive with numeric ownership. The live paths remain untouched.
3. Start only the restore PostgreSQL service with project name `babypark-n8n-restore`, both Compose files, the matching backup `n8n.env`, and `compose.restore.yaml`. It uses the separate registered `restore-test/postgres` path and no host database port. Wait for `pg_isready`, then restore the custom dump into its newly initialized empty `n8n` database using `pg_restore --exit-on-error --no-owner --username=n8n --dbname=n8n`. Verify PostgreSQL accepts a read-only connection and record schema/table counts without values.
4. Start the restore n8n service on `127.0.0.1:5679`, after explicitly starting the registered restore tmpfs root and subdirectories. Verify only the two approved workflows exist, expected node counts match, and both are `active=false`. Use the official n8n CLI to export the single dummy credential decrypted only into `/run/babypark-n8n-runtime/restore-test/`, validate its known synthetic name/type/fixture in-memory without printing values, and immediately remove the plaintext file. A key mismatch, export error, wrong fixture or cleanup failure is STOP.
5. Record both image digests, PostgreSQL restore exit status, table/workflow/credential counts, matching environment-file checksum, dump/archive hashes, permissions and elapsed time. Stop and remove only the restore Compose project; never add `-v`. Remove only the isolated restore directories after recording checksums and confirming the live DB/backups are untouched. If the main service remains stopped, run systemctl stop 'run-babypark\x2dn8n\x2druntime.mount' to clear the isolated restore tmpfs.

Restore failure, PostgreSQL corruption/error, key mismatch, wrong workflow state, or inability to decrypt the synthetic credential blocks acceptance. Do not run both projects against one PGDATA or user directory. Retain the restore evidence without recording secret values.

The following commands show the ordered restore operations. Replace `backup_dir` only with the selected checksummed generation. The mandatory tmpfs check is the same tuple enforced by the service before any restore runtime directory is created:

```sh
set -euo pipefail
set +x
unset DOCKER_CONTEXT DOCKER_HOST
backup_dir=/var/backups/babypark-n8n/REPLACE_WITH_VERIFIED_GENERATION
(cd "$backup_dir" && sha256sum -c SHA256SUMS >/dev/null)
postgres_image=postgres:16.16@sha256:ce81150802644ddfac1db4da9e63be6f2a3818aa6ee98a7a28838aeea65dc37a
/usr/bin/docker --host=unix:///var/run/docker.sock run --rm -i --entrypoint pg_restore "$postgres_image" --list < "$backup_dir/n8n.pgdump" >/dev/null
tar -tzf "$backup_dir/user-folder.tar.gz" >/dev/null
postgres_uid=$(/usr/bin/docker --host=unix:///var/run/docker.sock run --rm --entrypoint id "$postgres_image" -u postgres)
postgres_gid=$(/usr/bin/docker --host=unix:///var/run/docker.sock run --rm --entrypoint id "$postgres_image" -g postgres)
[[ "$postgres_uid" =~ ^[0-9]+$ && "$postgres_gid" =~ ^[0-9]+$ ]]
test ! -e /var/lib/babypark-n8n/restore-test && test ! -L /var/lib/babypark-n8n/restore-test
mkdir -m 0700 /var/lib/babypark-n8n/restore-test
chown root:root /var/lib/babypark-n8n/restore-test
install -d -o 1000 -g 1000 -m 0700 /var/lib/babypark-n8n/restore-test/user
install -d -o "$postgres_uid" -g "$postgres_gid" -m 0700 /var/lib/babypark-n8n/restore-test/postgres
tar --numeric-owner --xattrs --acls -xzf "$backup_dir/user-folder.tar.gz" -C /var/lib/babypark-n8n/restore-test/user
/usr/bin/docker --host=unix:///var/run/docker.sock compose --env-file "$backup_dir/n8n.env" -p babypark-n8n-restore -f /opt/babypark-n8n/compose.yaml -f /opt/babypark-n8n/compose.restore.yaml up -d postgres
for attempt in $(seq 1 30); do
  if /usr/bin/docker --host=unix:///var/run/docker.sock compose --env-file "$backup_dir/n8n.env" -p babypark-n8n-restore -f /opt/babypark-n8n/compose.yaml -f /opt/babypark-n8n/compose.restore.yaml exec -T postgres pg_isready -U n8n -d n8n >/dev/null; then break; fi
  test "$attempt" -lt 30
  sleep 2
done
/usr/bin/docker --host=unix:///var/run/docker.sock compose --env-file "$backup_dir/n8n.env" -p babypark-n8n-restore -f /opt/babypark-n8n/compose.yaml -f /opt/babypark-n8n/compose.restore.yaml exec -T postgres pg_restore --exit-on-error --no-owner --username=n8n --dbname=n8n < "$backup_dir/n8n.pgdump"
systemctl start 'run-babypark\x2dn8n\x2druntime.mount'
mount_row=$(findmnt --mountpoint /run/babypark-n8n-runtime --types tmpfs --noheadings --bytes --output FSTYPE,OPTIONS,SIZE)
set -f; set -- $mount_row
test "$#" -eq 3 && test "$1" = tmpfs && test "$3" = 134217728
opts=,$2,
for required in rw uid=1000 gid=1000 noswap nodev nosuid noexec; do case "$opts" in *,"$required",*) ;; *) exit 1;; esac; done
case "$opts" in *,mode=700,*|*,mode=0700,*) ;; *) exit 1;; esac
printf '%s\n' 'restore runtime tmpfs mount verification: PASS'
install -d -o 1000 -g 1000 -m 0700 /run/babypark-n8n-runtime/restore-test
install -d -o 1000 -g 1000 -m 0700 /run/babypark-n8n-runtime/restore-test/storage /run/babypark-n8n-runtime/restore-test/events
for path in /run/babypark-n8n-runtime/restore-test /run/babypark-n8n-runtime/restore-test/storage /run/babypark-n8n-runtime/restore-test/events; do
  test -d "$path" && test ! -L "$path"
  test "$(stat -c '%u:%g:%a' "$path")" = 1000:1000:700
done
/usr/bin/docker --host=unix:///var/run/docker.sock compose --env-file "$backup_dir/n8n.env" -p babypark-n8n-restore -f /opt/babypark-n8n/compose.yaml -f /opt/babypark-n8n/compose.restore.yaml up -d n8n
credential_id=REPLACE_WITH_THE_SINGLE_SYNTHETIC_CREDENTIAL_ID_FROM_THE_LOCAL_UI
test -n "$credential_id" && test "$credential_id" != REPLACE_WITH_THE_SINGLE_SYNTHETIC_CREDENTIAL_ID_FROM_THE_LOCAL_UI
plaintext=/run/babypark-n8n-runtime/restore-test/decrypted-credentials.json
test ! -e "$plaintext" && test ! -L "$plaintext"
trap 'rm -f -- "$plaintext"' EXIT HUP INT TERM
/usr/bin/docker --host=unix:///var/run/docker.sock compose --env-file "$backup_dir/n8n.env" -p babypark-n8n-restore -f /opt/babypark-n8n/compose.yaml -f /opt/babypark-n8n/compose.restore.yaml exec -T --user node n8n n8n export:credentials --id="$credential_id" --decrypted --output=/vol/restore-test/decrypted-credentials.json
/usr/bin/docker --host=unix:///var/run/docker.sock compose --env-file "$backup_dir/n8n.env" -p babypark-n8n-restore -f /opt/babypark-n8n/compose.yaml -f /opt/babypark-n8n/compose.restore.yaml exec -T --user node n8n node -e 'const fs=require("node:fs"); const rows=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!Array.isArray(rows)||rows.length!==1||rows[0].name!=="BabyPark restore dummy (synthetic)"||rows[0].type!=="httpBasicAuth"||rows[0].data?.user!=="restore-test-user"||rows[0].data?.password!=="NOT-A-REAL-CREDENTIAL-restore-test-2026-11-27") process.exit(1); console.log("dummy credential decryptability: PASS")' /vol/restore-test/decrypted-credentials.json
rm -f -- "$plaintext"
test ! -e "$plaintext"
trap - EXIT HUP INT TERM
```

After the checks, stop only the restore project with the matching files and without `-v`, remove only its registered restore targets, and clear the temporary tmpfs path. If the main service remains stopped, stop the runtime mount after the restore project is down. The original live PostgreSQL and user-state paths are not cleanup targets.

## Upgrade, rollback, and Hetzner move

For an n8n or PostgreSQL upgrade, pin an exact official version/digest in a separately reviewed change, retain the prior digests, take a complete verified PostgreSQL dump + user-folder archive + matching environment/key backup, and prove restore first. Stop only this n8n/PostgreSQL Compose project. If health, memory, no-swap or recovery fails, stop only this project and restore its own PGDATA/user state, matching secrets and prior image digests. Never use `down -v` or remove shared Docker/containerd data.

For a future Hetzner migration, register destination paths before use and install the same reviewed Compose/systemd package and mount gate. Transfer only the independent n8n PostgreSQL custom dump, user-folder archive, matching protected environment file, Compose configuration and checksums through an owner-approved encrypted channel. Restore into separate destination PGDATA/user paths, prove matching-key dummy-credential recovery and inactive workflow state, keep the service loopback-only, and cut over only after a separate owner GO. Never transfer Chatwoot's database, Viber state, DEV credentials/history or buyer messages.

After an authorized successful production launch, copy this exact runbook and its released checksum to `/var/backups/babypark-integration/operations/customizations/integrations/n8n/`; register that server copy in the handbook index and manifest. No server handbook write is part of this implementation PR.

## Release checks required before boot enablement and acceptance

- Production backup integrity/readiness for Chatwoot and Viber.
- Actual combined PostgreSQL+n8n `memory.current`, `memory.peak`, `memory.events`, host MemAvailable, memory PSI, swap-in/out, CPU/I/O, PostgreSQL health and same-route Chatwoot TTFB during image pull, PostgreSQL initialization/migration, startup, one PostgreSQL-backed import, restart, backup and restore on 4 GiB.
- Exact n8n 2.49.8 synthetic execution/binary persistence checks across PostgreSQL, the complete user folder, mounted host tmpfs, event log and container writable layer; verify Docker's configured `none` logging driver retains no stdout logs; positive/negative `tmpfs,noswap` startup tests.
- Independent clean PostgreSQL custom dump + user state + matching encryption-key and DB-password restore, with one synthetic dummy credential decrypted only on tmpfs.
- Host's actual support for `tmpfs,noswap` and Docker firewall/routing impact.

These are release gates, not evidence supplied by the Compose file or static tests. Do not enable `babypark-n8n.service` for host boot while any item remains pending, failed, or unverified. If any item fails, stop and disable only n8n. After every listed gate passes, its result is recorded on the exact release basis, both workflows remain OFF, and the owner-authorized trial is accepted, enable only n8n:

```sh
systemctl enable babypark-n8n.service
```

This is the final installation step; do not run it earlier in the release procedure.

## Official references

- n8n Docker installation: <https://docs.n8n.io/hosting/installation/docker/>
- n8n execution-data environment variables: <https://docs.n8n.io/hosting/configuration/environment-variables/executions/>
- n8n backup and restore: <https://docs.n8n.io/hosting/backup-restore/>
- n8n Sustainable Use License: <https://github.com/n8n-io/n8n/blob/n8n%402.49.8/LICENSE.md>
- Docker Compose specification and service resource limits: <https://docs.docker.com/reference/compose-file/services/>
- Docker Compose merge tags (`!override`): <https://docs.docker.com/reference/compose-file/merge/>
- Docker Engine daemon access and root-equivalent Docker-group permissions: <https://docs.docker.com/engine/security/> and <https://docs.docker.com/engine/install/linux-postinstall/>
- Docker Engine data root and containerd image store locations: <https://docs.docker.com/engine/daemon/>
