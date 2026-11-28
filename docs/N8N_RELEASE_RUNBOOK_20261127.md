# BabyPark n8n 2.49.8 — isolated release and recovery runbook

Status: RUNBOOK — implementation candidate; not release approval.
Applies to: one isolated, loopback-only official n8n 2.49.8 service on `chatwoot-fra1-01`.
Supersedes: none.
Owner: BabyPark.

## Release boundary

- Use only `deploy/n8n/compose.yaml`, the official image digest recorded there, and the systemd mount/service units in `deploy/n8n/systemd/`.
- Keep workflow definitions inactive. Do not configure real credentials, Chatwoot endpoints, Viber, buyer messages, public webhook routing, reverse-proxy routing, or TLS publication.
- The prior isolated 2.49.8 native-import check already passed for the 22-node `bpAiSellerChatwootHandoffShadowNov23` export (SHA-256 `7bcbb2b5dfb6a5e63209e4d163c42eeb04d95e6b513a159367ebe3cbeb963672`) and 6-node `bpAiSilenceWatchdogNov23` export (SHA-256 `18a1c9377236ed693420fc9f5f09351dab3e3f4fec80c06d2073866148c4cdec`); this implementation does not repeat that test. If a separate release GO authorizes a fresh production install, import only those exact files once into its blank database through the official n8n CLI, verify counts/IDs and `active=false`, and never import DEV DB/history/credentials. After every n8n restart and restore, confirm that the same two workflows are present with their expected node counts and `active=false`; any active, missing, or unknown workflow stops acceptance. If the export bytes are unavailable or hashes differ, leave the new instance empty and stop.
- The existing 4-GiB host remains the selected target. The 1,200-MiB memory cap is a hard ceiling, **not** a measured n8n peak. A separate release GO must require an isolated bounded launch window, actual cgroup peak/OOM and host reserve evidence, and unchanged Chatwoot/Viber health.
- Do not install Docker, create host paths, or enable these units until a separate exact-basis `release GO` is recorded. Installation must not restart or edit Chatwoot or Viber.

## Install the files and key

After release GO and successful Chatwoot/Viber backup and host baseline checks, install the Docker Engine and Compose plugin only through Docker's official repository/packages. Record exact package versions and compare firewall/routing state before and after installation. Do not change daemon-wide firewall settings. Because Docker Engine releases before `28.0.0` can expose ports published to localhost to peers on the same L2 segment, fail closed unless the server Engine is at least `28.0.0`; this is a minimum for the approved loopback-only publication, not a request to upgrade Docker during this campaign.

Before creating host paths or starting any container, verify the Docker **server** version. Malformed, suffixed, or older versions fail closed:

```sh
set -euo pipefail
engine_version=$(docker version --format '{{.Server.Version}}')
python3 - "$engine_version" <<'PY'
import re
import sys

match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", sys.argv[1])
if not match or tuple(map(int, match.groups())) < (28, 0, 0):
    raise SystemExit("Docker Engine server must be an unsuffixed version >= 28.0.0")
PY
printf 'Docker Engine server version gate: PASS (%s)\n' "$engine_version"
compose_version=$(docker compose version --short)
python3 - "$compose_version" <<'PY'
import re
import sys

match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", sys.argv[1])
if not match or tuple(map(int, match.groups())) < (5, 8, 1):
    raise SystemExit("Docker Compose CLI must be an unsuffixed version >= 5.8.1")
PY
printf 'Docker Compose plugin version gate: PASS (%s)\n' "$compose_version"
```

Create `/opt/babypark-n8n` root-owned, copy `compose.yaml` and `compose.restore.yaml` there, and retain the non-secret example. Use the official Docker Compose plugin version 5.8.1 or newer; it is the minimum tested for long-bind `create_host_path: false` and `!override` support. The registered `n8n_state_root` parent `/var/lib/babypark-n8n` must be a real, non-symlink directory owned by `root:root` mode `0755`: if absent, create it with exclusive `mkdir -m 0755` and `chown root:root`; if already present, verify the exact owner/mode and stop on any mismatch. Refuse any existing `/var/lib/babypark-n8n/user` path, including a symlink, on first install; create it empty, owned by UID/GID 1000, mode `0700`, and require that it contains no prior n8n state. If it is not empty, stop and investigate instead of reusing it. Create `/var/backups/babypark-n8n` root-owned mode `0700`; create `/etc/babypark-n8n` root-owned mode `0700`.

```sh
set -euo pipefail
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
mkdir -m 0700 -- "$state_root/user"
chown 1000:1000 "$state_root/user"
test "$(stat -c '%U:%G:%a' "$state_root")" = root:root:755
test "$(stat -c '%u:%g:%a' "$state_root/user")" = 1000:1000:700
```

Before creating or starting the n8n container, verify the target's Docker storage and key-access boundary without changing shared Docker permissions. As root, record the Docker Engine version, `docker info --format '{{.DockerRootDir}}'`, `docker info --format '{{.Driver}}'`, `docker info --format '{{json .DriverStatus}}'`, `namei -l "$(docker info --format '{{.DockerRootDir}}')"`, and `stat -c '%a %U:%G %n' /var/run/docker.sock "$(docker info --format '{{.DockerRootDir}}')"`. The registered Docker metadata root is `/var/lib/docker`; if the reported root differs, stop and update the reviewed storage inventory before release. Docker Engine 29.0 and later may use `/var/lib/containerd` for image content/snapshots, which is separately registered; record the active image-store path and stop if any writable Docker/containerd root is not registered. Access to a rootful Docker socket permits root-equivalent inspection of container environment metadata, including the n8n encryption key. Use the check below to require a root-owned socket with no world access and compare the union of supplementary-group members and all accounts whose primary GID equals the socket GID against the exact owner-approved host-admin roster. The roster must be supplied to the root shell in APPROVED_DOCKER_ADMINS as comma-separated account names. This check supports only the local `files` source for both passwd and group in `/etc/nsswitch.conf`; it verifies those configured NSS sources before accepting `getent` enumeration as complete. If either database uses another source (such as LDAP or SSSD), stop unless a reviewed provider-specific completeness proof replaces this check. A successful partial provider enumeration is not evidence of a complete roster. The command emits only PASS/FAIL and never displays account names or the environment value.

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

Generate a fresh key on the target and publish it to `/etc/babypark-n8n/n8n.env` only if that path does not already exist, including as a symlink. Run in a root Bash shell with tracing disabled. Strict mode stops on OpenSSL or write failure; `noclobber` prevents replacing a key created between the absence check and file publication. Never print the key or pass it on a command line:

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
key=$(openssl rand -hex 32)
[[ "$key" =~ ^[[:xdigit:]]{64}$ ]]
(
  set -o noclobber
  printf 'N8N_ENCRYPTION_KEY=%s\n' "$key" > "$key_file"
)
unset key
chown root:root "$key_file"
chmod 0600 "$key_file"
test "$(stat -c '%U:%G:%a' "$key_file")" = root:root:600
```

The service rejects a missing or malformed key. Compose receives it through systemd's root-only environment file. The Docker data root and daemon socket are part of the key security boundary; complete the host access checks above before creating or starting the container.

Install `babypark-n8n.service` and the exactly named escaped mount unit from `deploy/n8n/systemd/` under `/etc/systemd/system/`, then run `systemctl daemon-reload`. The service has an explicit dependency on `run-babypark\x2dn8n\x2druntime.mount`, verifies that the exact mount point is tmpfs with `noswap`, and binds the mount lifecycle to the service. Each start also requires `/etc/babypark-n8n` to remain `root:root` mode `0700` and `n8n.env` to remain `root:root` mode `0600`, before validating the key. The mount unit has PartOf=babypark-n8n.service, which propagates service stop/restart to the mount; normal service stop clears execution/event data from tmpfs. After the mount, permission and key checks pass, its `ExecStartPre` creates the primary `/run/babypark-n8n-runtime/storage` and `/run/babypark-n8n-runtime/events` directories as UID/GID 1000 mode `0700`; this runs on every service start and never creates directories outside the verified mount. If any check fails or the host kernel/systemd rejects `noswap`, the service must remain stopped; do not replace it with a swap-capable container tmpfs.

Before enablement, require `command -v sqlite3` to succeed. Render the Compose configuration and print only the approved non-secret fields; this deliberately omits the environment map, which contains the encryption key:

```sh
set -euo pipefail
docker compose --env-file /etc/babypark-n8n/n8n.env --project-directory /opt/babypark-n8n -f /opt/babypark-n8n/compose.yaml config --format json \
  | python3 -c 'import json,sys; c=json.load(sys.stdin); s=c["services"]["n8n"]; networks=s.get("networks",{}); assert len(networks)==1; name=next(iter(networks)); assert c.get("networks",{}).get(name,{}).get("internal") is True; print("image:",s["image"]); [print("port:",p.get("host_ip"),p.get("published"),"->",p.get("target"),p.get("protocol")) for p in s.get("ports",[])]; [print("bind:",v.get("source"),"->",v.get("target")) for v in s.get("volumes",[]) if v.get("type")=="bind"]; print("network count:",len(networks),"internal:",c["networks"][name]["internal"])'
```

Require the output to show the pinned image digest, `127.0.0.1:5678`, `/var/lib/babypark-n8n/user -> /home/node/.n8n`, `/run/babypark-n8n-runtime -> /vol`, and exactly one service network marked `internal: true`; do not print the full rendered configuration. The n8n service and restore overlay inherit only the project-scoped internal bridge definition, which has no default gateway or external connectivity. Verify after start that the generated container has exactly one attached network and `docker network inspect` reports `Internal=true`. The published localhost editor must still answer at `127.0.0.1:5678`; if it does not, stop n8n and investigate without adding a second network or weakening isolation. Verify `findmnt --mountpoint /run/babypark-n8n-runtime` reports `tmpfs` plus `noswap`. Run the negative start test against only the new n8n units: stop the n8n service and runtime mount, apply a temporary systemd runtime mask to `run-babypark\x2dn8n\x2druntime.mount`, and start `babypark-n8n.service`. Require the service to fail its mount dependency and verify that no `babypark-n8n` container exists. Remove the runtime mask and reset only the n8n unit's failed state. Then start `babypark-n8n.service` as the positive test and require the mount to be `tmpfs` with `noswap` before the container appears. This successful positive test is the first service start; do not issue a duplicate start. Never perform these tests against existing Chatwoot, Viber, or DEV n8n units.

Immediately after the successful start, check the actual container attachment rather than relying on the rendered file alone. This inspects only the new n8n container/network and emits no credentials:

```sh
set -euo pipefail
container_id=$(docker compose --env-file /etc/babypark-n8n/n8n.env --project-directory /opt/babypark-n8n -f /opt/babypark-n8n/compose.yaml ps --all --quiet n8n)
test -n "$container_id"
test "$(docker inspect --format '{{len .NetworkSettings.Networks}}' "$container_id")" = 1
network_id=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.NetworkID}}{{end}}' "$container_id")
test -n "$network_id"
test "$(docker network inspect --format '{{.Internal}}' "$network_id")" = true
curl --fail --silent --show-error --max-time 5 --output /dev/null http://127.0.0.1:5678/
printf '%s\n' 'n8n internal network and loopback editor checks: PASS'
```

If any assertion fails, stop only `babypark-n8n.service`. Do not add a second network, alter host firewall rules, or expose another host address to restore local UI access.

The internal bridge inspection is the primary no-egress control. Add a bounded negative connection test from inside n8n to reserved documentation-only IP ranges. Only an explicit no-route/unsupported-family result counts as PASS; a connection, refusal, timeout, or any other result is UNVERIFIED/STOP. This confirms the container cannot route to an external integration endpoint without contacting a real service:

```sh
set -euo pipefail
docker compose --env-file /etc/babypark-n8n/n8n.env --project-directory /opt/babypark-n8n -f /opt/babypark-n8n/compose.yaml exec --no-TTY n8n node -e '
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
docker_root=$(docker info --format '{{.DockerRootDir}}')
container_id=$(docker compose --env-file /etc/babypark-n8n/n8n.env --project-directory /opt/babypark-n8n -f /opt/babypark-n8n/compose.yaml ps --all --quiet n8n)
test -n "$container_id"
metadata="$docker_root/containers/$container_id/config.v2.json"
test -f "$metadata"
test "$(stat -c '%U:%G' "$metadata")" = root:root
mode=$(stat -c '%a' "$metadata")
test "$((0$mode & 0077))" -eq 0
stat -c '%a %U:%G %n' "$metadata"
```

If the target Docker layout differs or any unapproved account can read the key-bearing metadata, stop and disable only n8n and escalate; do not blanket `chmod`/`chown` the shared Docker root, socket, or metadata because that can break Chatwoot/Viber containers.

After this blank-database metadata check passes, and only under the separate release GO, import the two exact approved workflow export files once through the official n8n CLI. Verify that exactly those two workflow names/IDs and expected node counts are present and that both have `active=false`. Do not reimport them on later restarts or use DEV databases, execution history, credentials, or other workflow files. If an approved export is missing or its hash differs from the values above, leave the database blank and stop. Keep the n8n unit disabled for host boot until every release acceptance gate below has passed and the owner-authorized trial is accepted. After every later restart and restore, require the two workflows to remain present with their expected node counts and `active=false`; any active, missing or unknown workflow stops acceptance. If a release check fails, stop and disable only n8n with `systemctl disable --now babypark-n8n.service`; do not alter Docker, Chatwoot or Viber services. After a planned Docker daemon restart, restart the n8n unit so its mount/key gates run again.

## Independent n8n-only backup

Take a backup before every n8n version/configuration change and daily during Release 2. Because the default database is SQLite, stop only `babypark-n8n.service` before copying its user folder. Do not use `docker compose down -v` and do not copy the DEV database.

1. `systemctl stop babypark-n8n`; verify the n8n container is stopped and Chatwoot/Viber remain active.
2. In a Bash root shell, run the following. Exclusive `mkdir` allocates the generation; if that second-resolution timestamp already exists, the procedure aborts without touching it. `set -euo pipefail` stops on every command or pipeline failure. A generation counts as verified only after the final `SHA256SUMS` file is atomically published and passes its check. If a command fails, leave n8n stopped, preserve the incomplete directory for inspection, and do not reuse or label it as a backup.

   ```sh
   set -euo pipefail
   umask 077
   stamp=$(date -u +%Y%m%dT%H%M%SZ)
   backup_dir="/var/backups/babypark-n8n/$stamp"
   mkdir -m 0700 -- "$backup_dir"
   archive="$backup_dir/user-folder.tar.gz"
   key_copy="$backup_dir/n8n.env"
   sums_partial="$backup_dir/SHA256SUMS.partial"
   sums="$backup_dir/SHA256SUMS"
   test ! -e "$archive" && test ! -e "$key_copy" && test ! -e "$sums_partial" && test ! -e "$sums"
   sqlite_integrity=$(sqlite3 -readonly /var/lib/babypark-n8n/user/database.sqlite 'PRAGMA integrity_check;')
   test "$sqlite_integrity" = ok
   tar --numeric-owner --xattrs --acls -czf "$archive" -C /var/lib/babypark-n8n/user .
   test -s "$archive"
   tar -tzf "$archive" > /dev/null
   tar -tzf "$archive" | grep -Fx './database.sqlite' > /dev/null
   install -o root -g root -m 0600 /etc/babypark-n8n/n8n.env "$key_copy"
   (
     cd "$backup_dir"
     sha256sum user-folder.tar.gz n8n.env > SHA256SUMS.partial
     chmod 0600 SHA256SUMS.partial
     sha256sum -c SHA256SUMS.partial > /dev/null
     test ! -e SHA256SUMS
     mv -nT -- SHA256SUMS.partial SHA256SUMS
     test ! -e SHA256SUMS.partial
     sha256sum -c SHA256SUMS > /dev/null
   )
   ```

   The generation directory is created with mode `0700` under the root-owned backup parent. The archive is read to completion before its checksum manifest is staged, and it must contain `./database.sqlite`. The final checksum manifest is created only after both files verify. Do not show the environment file contents.
3. Confirm the command completed and verify the checksum pair with `(cd "$backup_dir" && sha256sum -c SHA256SUMS)` without printing file contents. The manifest uses relative filenames so it remains verifiable after an owner-approved transfer. A partial archive or `SHA256SUMS.partial` is not a valid recovery generation.
4. Start only n8n again. Retain at least seven verified local daily generations; never delete the only known-good restore set. These copies are same-host recovery only. No off-host disaster-recovery claim is made until an owner-approved encrypted destination and key-handling process exist.

The local archive and key file are sensitive even though Release 2 has no buyer data. Keep directories `0700`, files `0600`, and owner `root:root`. Never use `--decrypted` exports for backup, migration, or any persistent path. The sole exception is the restore acceptance check below: it exports only the synthetic dummy credential to the registered host tmpfs, validates it without printing values, and removes the file before acceptance. Never include the encryption key in a Git file or print it in terminal/log output.

## Clean restore and encryption-key recovery

Run a restore rehearsal before accepting the service and before any future migration. Use only a disposable backup containing synthetic state and exactly one dummy credential. In the local n8n UI, create an unreferenced Basic Auth credential named `BabyPark restore dummy (synthetic)` with user `restore-test-user` and password `NOT-A-REAL-CREDENTIAL-restore-test-2026-11-27`; do not attach it to an imported workflow or execute a request. This fixed value is public test data, not a usable account secret. Run steps 1–3 of the independent backup procedure to capture this exact synthetic state with the matching key. Restore the exact matching key file from that backup generation; never substitute another key.

1. In a Bash root shell, set `backup_dir` to the exact verified generation under `/var/backups/babypark-n8n`, stop only the n8n service, and run the preflight below. It checks the checksum pair, reads the complete archive, and requires the SQLite database member before creating or extracting into restore state.

   ```sh
   set -euo pipefail
   (cd "$backup_dir" && sha256sum -c SHA256SUMS > /dev/null)
   archive_members=$(tar -tzf "$backup_dir/user-folder.tar.gz")
   printf '%s\n' "$archive_members" | grep -Fx './database.sqlite' > /dev/null
   ```

2. Require `/var/lib/babypark-n8n/restore-test` to be absent, including as a symlink. Never clear or reuse it automatically. The exclusive `mkdir` must fail if any state already occupies that path. Restore the archive there with numeric ownership. Use the matching root-only `n8n.env` file directly from the selected registered backup generation; do not copy the key into an unregistered path or replace the live environment file:

   ```sh
   set -euo pipefail
   test ! -e /var/lib/babypark-n8n/restore-test && test ! -L /var/lib/babypark-n8n/restore-test
   mkdir -m 0700 -- /var/lib/babypark-n8n/restore-test
   chown 1000:1000 /var/lib/babypark-n8n/restore-test
   tar --numeric-owner --xattrs --acls -xzf "$backup_dir/user-folder.tar.gz" -C /var/lib/babypark-n8n/restore-test
   sqlite_integrity=$(sqlite3 -readonly /var/lib/babypark-n8n/restore-test/database.sqlite 'PRAGMA integrity_check;')
   test "$sqlite_integrity" = ok
   ```

   The `set -euo pipefail` from step 1 remains active. Any failed checksum, archive read, extraction or SQLite command aborts before the restore project can start. Do not start if checksums, integrity, ownership or modes differ. Leave failed scratch state for inspection; do not silently clean it.
3. Require SQLite `PRAGMA integrity_check` = `ok`; record workflow and credential row counts without values. Confirm modes/owners and elapsed restore time.
4. Keep the primary n8n service stopped. For this isolated restore only, run systemctl start 'run-babypark\x2dn8n\x2druntime.mount'. Run the complete mount check immediately afterward and before reading or creating anything under the mount point:

   ```sh
   set -euo pipefail
   mount_row=$(findmnt --mountpoint /run/babypark-n8n-runtime --types tmpfs --noheadings --bytes --output FSTYPE,OPTIONS,SIZE)
   set -f
   set -- $mount_row
   test "$#" -eq 3 && test "$1" = tmpfs && test "$3" = 134217728
   opts=,$2,
   for required in rw uid=1000 gid=1000 noswap nodev nosuid noexec; do
     case "$opts" in *,"$required",*) ;; *) exit 1 ;; esac
   done
   case "$opts" in *,mode=700,*|*,mode=0700,*) ;; *) exit 1 ;; esac
   printf '%s\n' 'runtime tmpfs mount verification: PASS'
   ```

   Only after that check passes, require /run/babypark-n8n-runtime/restore-test to be absent with test ! -e /run/babypark-n8n-runtime/restore-test && test ! -L /run/babypark-n8n-runtime/restore-test; if it exists, stop and inspect it instead of reusing unknown data. Create it with mkdir -m 0700 -- /run/babypark-n8n-runtime/restore-test, transfer ownership with chown 1000:1000 /run/babypark-n8n-runtime/restore-test, and create its isolated subdirectories with install -d -o 1000 -g 1000 -m 0700 /run/babypark-n8n-runtime/restore-test/storage /run/babypark-n8n-runtime/restore-test/events. Verify the parent and both subdirectories before starting the restore container:

   ```sh
   set -euo pipefail
   for path in /run/babypark-n8n-runtime/restore-test /run/babypark-n8n-runtime/restore-test/storage /run/babypark-n8n-runtime/restore-test/events; do
     test "$(stat -c '%u:%g:%a' "$path")" = 1000:1000:700
   done
   ```

   Start the override with project name `babypark-n8n-restore`, both Compose files, the backup-generation env file, and `compose.restore.yaml`: `docker compose --env-file "$backup_dir/n8n.env" -p babypark-n8n-restore -f /opt/babypark-n8n/compose.yaml -f /opt/babypark-n8n/compose.restore.yaml up -d n8n`. It binds only `127.0.0.1:5679`, uses the separate durable restore directory and separate tmpfs execution/event paths, and inherits the same official image digest, resource caps and data-retention settings. Keep the primary n8n service stopped during this test.
5. Confirm n8n starts. Before credential decryption, verify that the restored instance contains exactly the two approved workflow definitions with their expected node counts and that both have `active=false`. Stop acceptance if a workflow is active, missing, or unknown. Record workflow names/IDs, node counts and active state only. Prove the restored key decrypts the only credential by exporting it to the restore tmpfs, validating the synthetic fixture with the official image's Node runtime, then deleting the plaintext file. Run as root with shell tracing disabled; do not print file contents or decrypted values:

   ```sh
   set -eu
   docker compose --env-file "$backup_dir/n8n.env" -p babypark-n8n-restore -f /opt/babypark-n8n/compose.yaml -f /opt/babypark-n8n/compose.restore.yaml exec -T n8n n8n export:credentials --all --decrypted --output=/vol/restore-test/decrypted-credentials.json
   docker compose --env-file "$backup_dir/n8n.env" -p babypark-n8n-restore -f /opt/babypark-n8n/compose.yaml -f /opt/babypark-n8n/compose.restore.yaml exec -T n8n chmod 0600 /vol/restore-test/decrypted-credentials.json
   docker compose --env-file "$backup_dir/n8n.env" -p babypark-n8n-restore -f /opt/babypark-n8n/compose.yaml -f /opt/babypark-n8n/compose.restore.yaml exec -T n8n node -e 'const fs=require("node:fs"); const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(a.length!==1||a[0].name!=="BabyPark restore dummy (synthetic)"||a[0].type!=="httpBasicAuth"||a[0].data?.user!=="restore-test-user"||a[0].data?.password!=="NOT-A-REAL-CREDENTIAL-restore-test-2026-11-27") process.exit(1); console.log("dummy credential decryptability: PASS")' /vol/restore-test/decrypted-credentials.json
   docker compose --env-file "$backup_dir/n8n.env" -p babypark-n8n-restore -f /opt/babypark-n8n/compose.yaml -f /opt/babypark-n8n/compose.restore.yaml exec -T n8n rm -f /vol/restore-test/decrypted-credentials.json
   test ! -e /run/babypark-n8n-runtime/restore-test/decrypted-credentials.json
   ```

   A key mismatch, failed CLI export, wrong fixture, missing file, or nonzero verifier result fails restore acceptance. Record only PASS/FAIL, counts, checksums, permissions and duration.
6. Stop and remove only the restore project/container with the matching project/configuration (`docker compose --env-file "$backup_dir/n8n.env" -p babypark-n8n-restore -f /opt/babypark-n8n/compose.yaml -f /opt/babypark-n8n/compose.restore.yaml down`; never add `-v`), delete `/var/lib/babypark-n8n/restore-test` and `/run/babypark-n8n-runtime/restore-test`, then confirm the live backup hashes remain unchanged. Keep the selected backup-generation key file as part of that verified backup. If the original service will remain stopped, explicitly run systemctl stop 'run-babypark\x2dn8n\x2druntime.mount' to clear the restore tmpfs; if release permits a restart, start only the original n8n service and let its dependency bring the mount up.

The restore acceptance record must include image digest, archive and matching key-file checksums, SQLite integrity result, workflow/credential counts, permission checks, dummy credential decryption result, and elapsed time. A CLI workflow/credential export is not a complete backup: it omits users, instance settings, execution history and encryption key.

## Upgrade, rollback, and Hetzner move

For an n8n upgrade, first pin an exact official version/digest in a separate reviewed change, retain the prior image digest, take a complete verified backup, and rehearse restore. Stop only n8n. Update only its Compose project and service; never couple it to Chatwoot/Viber upgrade units. If n8n fails its own health, memory, no-swap, or restore gate, stop only n8n and restore its own known-good user folder, environment/key and prior image. Do not use `down -v` or remove Docker-wide data.

For Hetzner migration, install the same reviewed Compose/systemd package and mount gate on the destination. Transfer only the n8n user-folder backup, matching protected environment/key file, Compose configuration, and checksums via an owner-approved encrypted channel. Restore into a separate n8n path, verify key decryption and inactive workflow state, keep the service loopback-only, and switch only after an explicit cutover GO. Never transfer Chatwoot's database, Viber state, DEV credentials, DEV execution history, or buyer messages.

After an authorized successful production launch, copy this exact runbook and its released checksum to `/var/backups/babypark-integration/operations/customizations/integrations/n8n/`; register that server copy in the handbook index and manifest. No server handbook write is part of this implementation PR.

## Release checks required before boot enablement and acceptance

- Production backup integrity/readiness for Chatwoot and Viber.
- Actual n8n `memory.current`, `memory.peak`, OOM counters, host MemAvailable, PSI, swap-in/out and Chatwoot TTFB during install/migration/startup on 4 GiB.
- Exact 2.49.8 synthetic execution-data persistence checks across SQLite/WAL/SHM, the complete user folder and backup, the mounted tmpfs, event log and container writable layer; verify that Docker's configured `none` log driver retains no stdout log; plus positive/negative systemd mount tests.
- Independent clean SQLite + key + dummy-credential restore rehearsal.
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
