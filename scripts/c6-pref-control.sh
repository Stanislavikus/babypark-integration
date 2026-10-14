#!/usr/bin/env bash
# C6 isolated PoC control. TEST-ONLY. This file creates no persistent unit.
# All operations after `inspect` require digest-bound owner authorization.
set -euo pipefail
PROJECT=bp-c6poc
ROOT=/var/tmp/bp-c6poc-20261011
SCRATCH="$ROOT/c6-synthetic"
CONTROL="$ROOT/c6-control"
SOURCE_MOUNT=/run/bp-c6-poc/source
SCRATCH_MOUNT=/run/bp-c6-poc/scratch
BASELINE="$CONTROL/catalog-baseline.tsv"
DEADLINE_FILE="$CONTROL/deadline-utc-epoch"
SIDEKIQ_IDENTITY="$CONTROL/sidekiq-identity.tsv"
PROVENANCE_MARKER="$CONTROL/database-provenance.tsv"
CATALOG_UNIT=babypark-catalog-rehearsal.service
C6_UNIT=bp-c6-poc-c6
DEADLINE_UNIT=bp-c6-poc-deadline
GUARD_UNIT=bp-c6-poc-memory-guard
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
NODE=/opt/babypark-rehearsal/runtime/node-v24.20.0/bin/node
STOP_SCRIPT="$REPO_ROOT/scripts/c6-pref-deadman.sh"
EXPECTED_BRANCH_BASE=565d8de08fbd8e85598e554cb91e59dfa4f8c1a4
failure() { printf 'C6_PREF_HALT:%s\n' "$*" >&2; exit 70; }
block() { command -v "$1" >/dev/null || failure "MISSING_EXECUTABLE:$1"; }
cat_status() {
  local state http
  state="$(systemctl show "$CATALOG_UNIT" -p MainPID -p ActiveEnterTimestamp -p NRestarts --no-pager | LC_ALL=C sort)" || return 1
  [[ -f "$BASELINE" && "$state" == "$(cat "$BASELINE")" ]] || return 1
  http="$(curl --max-time 3 --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:18081/health)" || return 1
  [[ "$http" == 200 ]]
}
mem_kib() { awk '/^MemAvailable:/ { print $2; exit }' /proc/meminfo; }
verify_source() {
  local head base
  [[ -n "${BP_C6_POC_TEST_HEAD:-}" && "${BP_C6_POC_TEST_HEAD}" =~ ^[0-9a-f]{40}$ ]] || failure TEST_HEAD_REQUIRED
  head="$(git -c "safe.directory=$REPO_ROOT" -C "$REPO_ROOT" rev-parse HEAD)"
  [[ "$head" == "$BP_C6_POC_TEST_HEAD" ]] || failure UNPINNED_RUNNER_HEAD
  base="$(git -c "safe.directory=$REPO_ROOT" -C "$REPO_ROOT" merge-base "$EXPECTED_BRANCH_BASE" "$head")"
  [[ "$base" == "$EXPECTED_BRANCH_BASE" ]] || failure PR128_SOURCE_REPLACED
  [[ -z "$(git -c "safe.directory=$REPO_ROOT" -C "$REPO_ROOT" status --porcelain --untracked-files=no)" ]] || failure DIRTY_TEST_SCRIPTS
  [[ "$(sha256sum "$STOP_SCRIPT" | awk '{print $1}')" == "${BP_C6_POC_DEADMAN_SHA256:-UNSET}" ]] || failure DEADMAN_HASH_MISMATCH
  [[ "$(sha256sum "$REPO_ROOT/scripts/c6-pref-runner.mjs" | awk '{print $1}')" == "${BP_C6_POC_RUNNER_SHA256:-UNSET}" ]] || failure RUNNER_HASH_MISMATCH
  [[ "$(sha256sum "$REPO_ROOT/scripts/c6-pref-control.sh" | awk '{print $1}')" == "${BP_C6_POC_CONTROL_SHA256:-UNSET}" ]] || failure CONTROL_HASH_MISMATCH
  [[ -x "$NODE" && "$("$NODE" --version)" == v24.20.0 ]] || failure NODE24_NOT_PINNED
}
inspect() {
  block docker; block systemd-run; block timeout
  [[ "$(timeout --kill-after=3s 8s docker network inspect bp-c6poc_isolated --format '{{.Internal}}')" == true ]] || failure NETWORK_EGRESS_BOUNDARY
  [[ "$(docker network inspect bp-c6poc_isolated --format '{{index .Options "com.docker.network.bridge.gateway_mode_ipv4"}}')" == isolated ]] || failure NETWORK_GATEWAY_CHANGED
  local name project bindings restart
  for name in bp-c6poc-rails-1 bp-c6poc-sidekiq-1 bp-c6poc-postgres-1 bp-c6poc-redis-1; do
    project="$(timeout 8s docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$name")"
    bindings="$(timeout 8s docker inspect --format '{{json .HostConfig.PortBindings}}' "$name")"
    restart="$(timeout 8s docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$name")"
    [[ "$project" == "$PROJECT" && "$bindings" == '{}' && "$restart" == no ]] || failure "POC_CONTAINER_IDENTITY_OR_EXPOSURE:$name"
  done
  [[ "$(df -Pk / | awk 'END{print $4}')" -ge 52428800 ]] || failure DISK_BELOW_50G
  [[ "$(mem_kib)" -ge 1048576 ]] || failure MEMAVAILABLE_BELOW_1024M
  printf 'POC_ISOLATION_INSPECT_PASS\n'
}
arm() {
  [[ "$(id -u)" -eq 0 ]] || failure ROOT_REQUIRED_FOR_TRANSIENT_SYSTEMD
  verify_source; inspect
  for name in bp-c6poc-rails-1 bp-c6poc-sidekiq-1 bp-c6poc-postgres-1 bp-c6poc-redis-1; do
    [[ "$(timeout 8s docker inspect --format '{{.State.Running}}' "$name")" == false ]] || failure "CONTAINER_ALREADY_RUNNING:$name"
  done
  [[ ! -e "$BASELINE" && ! -e "$DEADLINE_FILE" && ! -e "$PROVENANCE_MARKER" ]] || failure POC_ALREADY_ARMED
  [[ "$(stat -c '%u:%a' "$ROOT")" == "0:700" ]] || failure POC_ROOT_PARENT_NOT_PRIVATE
  [[ ! -L "$CONTROL" && ! -L "$SCRATCH" ]] || failure POC_DIRECTORY_SYMLINK
  getent passwd bpclaude >/dev/null || failure BPCLAUDE_USER_MISSING
  if [[ -e "$CONTROL" ]]; then [[ "$(stat -c '%u:%a' "$CONTROL")" == "0:700" ]] || failure CONTROL_DIRECTORY_NOT_PRIVATE; fi
  if [[ -e "$SCRATCH" ]]; then [[ "$(stat -c '%U:%a' "$SCRATCH")" == "bpclaude:700" ]] || failure SYNTHETIC_SCRATCH_WRONG_OWNER; fi
  install -d -m 700 -o root -g root "$CONTROL"
  install -d -m 700 -o bpclaude -g bpclaude "$SCRATCH"
  systemctl show "$CATALOG_UNIT" -p MainPID -p ActiveEnterTimestamp -p NRestarts --no-pager | LC_ALL=C sort > "$BASELINE"
  chmod 600 "$BASELINE"
  [[ "$(grep '^MainPID=' "$BASELINE" | cut -d= -f2)" -gt 1 ]] || failure CATALOG_NOT_RUNNING
  [[ "$(grep '^NRestarts=' "$BASELINE" | cut -d= -f2)" == 0 ]] || failure CATALOG_ALREADY_RESTARTED
  cat_status || failure CATALOG_BAD_AT_ARM
  date -u -d '+3 hours' +%s > "$DEADLINE_FILE"
  chmod 600 "$DEADLINE_FILE"
  # Arm BEFORE starting Postgres or any noncatalog activity. systemd owns both
  # independent timers after MCP process disconnects.
  systemd-run --unit="$DEADLINE_UNIT" --on-active=3h --collect \
    /usr/bin/bash "$STOP_SCRIPT" stop || failure DEADMAN_TIMER_ARM_FAILED
  systemd-run --unit="$GUARD_UNIT" --on-active=60s --on-unit-active=60s --collect \
    /usr/bin/bash "$REPO_ROOT/scripts/c6-pref-control.sh" guard || {
      /usr/bin/bash "$STOP_SCRIPT" stop || true
      failure MEMORY_GUARD_TIMER_ARM_FAILED
    }
  systemctl is-active --quiet "$DEADLINE_UNIT.timer" || failure DEADLINE_TIMER_INACTIVE
  systemctl is-active --quiet "$GUARD_UNIT.timer" || failure MEMORY_GUARD_TIMER_INACTIVE
  printf 'POC_ARMED_TIMERS=2 WINDOW_SECONDS=10800 BASELINE_CAPTURED=true\n'
}
guard() {
  if [[ ! -f "$DEADLINE_FILE" ]]; then
    printf 'DEADLINE_FILE_MISSING_STOPPING_STAND\n' >&2
    /usr/bin/bash "$STOP_SCRIPT" stop || true
    failure DEADLINE_FILE_MISSING
  fi
  local now="$(date -u +%s)"
  local side_changed=no side_pid side_id side_ns actual_pid actual_id actual_ns
  if [[ -f "$SIDEKIQ_IDENTITY" ]]; then
    IFS='|' read -r side_pid side_id side_ns < "$SIDEKIQ_IDENTITY"
    actual_pid="$(timeout 8s docker inspect --format '{{.State.Pid}}' bp-c6poc-sidekiq-1 2>/dev/null)" || actual_pid=INVALID
    actual_id="$(timeout 8s docker inspect --format '{{.Id}}' bp-c6poc-sidekiq-1 2>/dev/null)" || actual_id=INVALID
    actual_ns="$(readlink "/proc/$actual_pid/ns/net" 2>/dev/null)" || actual_ns=INVALID
    if [[ "$side_pid" != "$actual_pid" || "$side_id" != "$actual_id" || "$side_ns" != "$actual_ns" ]]; then
      side_changed=yes
    fi
  elif systemctl is-active --quiet "$C6_UNIT.service"; then
    side_changed=yes
  fi
  if [[ "$now" -ge "$(cat "$DEADLINE_FILE")" ]] ||
     [[ "$(mem_kib)" -lt 1048576 ]] || ! cat_status || [[ "$side_changed" == yes ]]; then
    printf 'POC_GUARD_TRIGGERED\n' >&2
    /usr/bin/bash "$STOP_SCRIPT" stop || failure DEADMAN_FAILED_FROM_GUARD
    return 70
  fi
  printf 'POC_GUARD_OK\n'
}
database_provenance() {
  # Only the already-approved isolated Postgres may be running for this gate.
  verify_source; inspect
  [[ -f "$DEADLINE_FILE" && "$(date -u +%s)" -lt "$(cat "$DEADLINE_FILE")" ]] || failure POC_NOT_ARMED
  for name in bp-c6poc-sidekiq-1 bp-c6poc-rails-1 bp-c6poc-redis-1; do
    [[ "$(timeout 8s docker inspect --format '{{.State.Running}}' "$name")" == false ]] || failure "EARLY_SERVICE_STARTED:$name"
  done
  [[ "$(timeout 8s docker inspect --format '{{.State.Running}}' bp-c6poc-postgres-1)" == true ]] || failure POC_POSTGRES_NOT_RUNNING
  local provenance volume_created
  volume_created="$(timeout 8s docker volume inspect bp-c6poc_postgres_data --format '{{.CreatedAt}}')"
  [[ "$volume_created" == 2026-10-11* ]] || failure POC_VOLUME_ORIGIN_UNPROVABLE
  # PostgreSQL is the isolated container's DB, not the host/production cluster.
  # This prints aggregate counts only; never customer/email/message bodies.
  if ! provenance="$(timeout --kill-after=3s 20s docker exec -i bp-c6poc-postgres-1 /bin/sh -c     'psql -XAt -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" -c "SELECT (SELECT count(*) FROM contacts), (SELECT count(*) FROM conversations), (SELECT count(*) FROM messages);"')"; then
    failure POC_DATABASE_COUNTS_UNAVAILABLE
  fi
  [[ "$provenance" =~ ^[0-9]+\|[0-9]+\|[0-9]+$ ]] || failure POC_DATABASE_COUNTS_MALFORMED
  printf 'POC_DB_COUNTS_AGGREGATE=%s\nVOLUME_CREATED=%s\n' "$provenance" "$volume_created"
  # Never mistake a 2026-10-11 volume creation time for positive synthetic provenance.
  # A nonempty DB requires separately verified frozen evidence; no arbitrary
  # owner-supplied Boolean or clean/reset bypass of unknown rows.
  if [[ "$provenance" != '0|0|0' ]]; then
    printf 'POC_DB_NONEMPTY_REQUIRES_INDEPENDENT_FIXTURE_PROOF\n' >&2
    return 72
  fi
  cat_status || failure CATALOG_CHANGED
  [[ ! -e "$PROVENANCE_MARKER" ]] || failure PROVENANCE_MARKER_ALREADY_EXISTS
  ( umask 077; printf '%s|%s\n' "$provenance" "$volume_created" > "$PROVENANCE_MARKER" )
  printf 'POC_DB_EMPTY_PROVENANCE_RECORDED\n'
}
launch() {
  [[ "$(id -u)" -eq 0 ]] || failure ROOT_REQUIRED_FOR_TRANSIENT_SYSTEMD
  verify_source; inspect
  [[ -f "$DEADLINE_FILE" && "$(date -u +%s)" -lt "$(cat "$DEADLINE_FILE")" ]] || failure POC_NOT_ARMED_OR_EXPIRED
  systemctl is-active --quiet "$DEADLINE_UNIT.timer" || failure DEADLINE_TIMER_MISSING
  systemctl is-active --quiet "$GUARD_UNIT.timer" || failure MEMORY_GUARD_TIMER_MISSING
  cat_status || failure CATALOG_CHANGED
  local side_pid side_id netns hostns resolv rails_ip
  side_id="$(timeout 8s docker inspect --format '{{.Id}}' bp-c6poc-sidekiq-1)"
  side_pid="$(timeout 8s docker inspect --format '{{.State.Pid}}' bp-c6poc-sidekiq-1)"
  [[ "$side_id" =~ ^[a-f0-9]{64}$ && "$side_pid" =~ ^[0-9]+$ && "$side_pid" -gt 1 ]] || failure SIDEKIQ_NOT_RUNNING
  netns="$(readlink "/proc/$side_pid/ns/net")"; hostns="$(readlink /proc/1/ns/net)"
  [[ "$netns" != "$hostns" ]] || failure HOST_NETNS_LEAK
  [[ "$REPO_ROOT" == /var/tmp/bp-c6poc-20261011/* ]] || failure CODE_OUTSIDE_APPROVED_ISOLATED_TREE
  resolv="$(timeout 8s docker inspect --format '{{.ResolvConfPath}}' bp-c6poc-sidekiq-1)"
  [[ "$resolv" == "/var/lib/docker/containers/$side_id/resolv.conf" && -f "$resolv" ]] || failure SIDEKIQ_DNS_MOUNT_NOT_PROVEN
  rails_ip="$(timeout 8s docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' bp-c6poc-rails-1)"
  [[ "$rails_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || failure RAILS_CONTAINER_IP_NOT_PROVEN
  [[ "$(timeout 8s docker inspect --format '{{.State.Running}}' bp-c6poc-rails-1)" == true ]] || failure RAILS_NOT_RUNNING
  [[ -f "$PROVENANCE_MARKER" && "$(stat -c '%u:%a' "$PROVENANCE_MARKER")" == '0:600' ]] || failure DATABASE_PROVENANCE_NOT_VERIFIED
  [[ -e "$SCRATCH/episode.sqlite" ]] || failure EXPLICIT_SYNTHETIC_DB_MISSING
  local envfile="$SCRATCH/c6-synthetic.env"
  [[ -f "$envfile" && "$(stat -c %a "$envfile")" == 600 ]] || failure SYNTHETIC_AUTH_ENV_NOT_PREPARED
  [[ "$(stat -c '%U:%a' "$SCRATCH")" == 'bpclaude:700' ]] || failure SCRATCH_NOT_OWNED_BY_UNPRIVILEGED_USER
  [[ -f "$SIDEKIQ_IDENTITY" ]] && failure STALE_SIDEKIQ_IDENTITY
  printf '%s|%s|%s\n' "$side_pid" "$side_id" "$netns" > "$SIDEKIQ_IDENTITY"
  chmod 600 "$SIDEKIQ_IDENTITY"
  systemd-run --unit="$C6_UNIT" --collect --service-type=simple \
    -p User=bpclaude -p WorkingDirectory="$SOURCE_MOUNT" \
    -p "EnvironmentFile=$envfile" \
    -p "Environment=BP_C6_POC_SIDEKIQ_NETNS=$netns" \
    -p "Environment=BP_C6_POC_HOST_NETNS=$hostns" \
    -p "Environment=BP_C6_POC_SIDEKIQ_HOST_PID=$side_pid" \
    -p "Environment=BP_C6_POC_RAILS_IP=$rails_ip" \
    -p "Environment=BP_C6_POC_SCRATCH_ROOT=$SCRATCH_MOUNT" \
    -p "NetworkNamespacePath=/proc/$side_pid/ns/net" \
    -p "BindReadOnlyPaths=$resolv:/etc/resolv.conf" \
    -p "BindReadOnlyPaths=$REPO_ROOT:$SOURCE_MOUNT" \
    -p "BindPaths=$SCRATCH:$SCRATCH_MOUNT" \
    -p MemoryMax=128M -p MemorySwapMax=0 -p CPUQuota=20% -p TasksMax=32 \
    -p RuntimeMaxSec=10800 -p TimeoutStopSec=10s -p Restart=no \
    -p NoNewPrivileges=yes -p ProtectSystem=strict -p ProtectHome=yes \
    -p "ReadWritePaths=$SCRATCH_MOUNT" -p PrivateTmp=no \
    "$NODE" --max-old-space-size=64 "$SOURCE_MOUNT/scripts/c6-pref-runner.mjs" serve
  local unit_props memory_quota cpu_quota runtime_max unit_user unit_ns
  unit_props="$(timeout --kill-after=3s 8s systemctl show "$C6_UNIT.service" \
    -p MemoryMax -p MemorySwapMax -p CPUQuotaPerSecUSec -p RuntimeMaxUSec -p User -p NetworkNamespacePath --no-pager)" || failure C6_UNIT_PROPERTIES_UNAVAILABLE
  memory_quota="$(printf '%s\n' "$unit_props" | sed -n 's/^MemoryMax=//p')"
  cpu_quota="$(printf '%s\n' "$unit_props" | sed -n 's/^CPUQuotaPerSecUSec=//p')"
  runtime_max="$(printf '%s\n' "$unit_props" | sed -n 's/^RuntimeMaxUSec=//p')"
  [[ "$memory_quota" == 134217728 ]] || failure C6_MEMORY_QUOTA_NOT_ENFORCED
  [[ "$cpu_quota" == '200ms' || "$cpu_quota" == '200000us' ]] || failure C6_CPU_QUOTA_NOT_ENFORCED
  [[ "$runtime_max" == '3h' || "$runtime_max" == '3h 0min' ]] || failure C6_RUNTIME_MAX_NOT_ENFORCED
  [[ "$unit_props" == *"MemorySwapMax=0"* && "$unit_props" == *"User=bpclaude"* ]] || failure C6_NO_SWAP_OR_USER_NOT_ENFORCED
  [[ "$unit_props" == *"NetworkNamespacePath=/proc/$side_pid/ns/net"* ]] || failure C6_NETWORK_NAMESPACE_NOT_ENFORCED
  if ! systemctl is-active --quiet "$C6_UNIT.service"; then
    /usr/bin/bash "$STOP_SCRIPT" stop || true
    failure C6_FAILED_TO_START
  fi
  printf 'C6_ISOLATED_SYSTEMD_STARTED\n'
}


prepare_db() {
  [[ "$(id -u)" -eq 0 ]] || failure ROOT_REQUIRED
  verify_source; inspect; cat_status || failure CATALOG_CHANGED
  [[ -f "$PROVENANCE_MARKER" && "$(stat -c '%u:%a' "$PROVENANCE_MARKER")" == '0:600' ]] || failure UNVERIFIED_CHATWOOT_DB_ORIGIN
  [[ -f "$DEADLINE_FILE" && "$(date -u +%s)" -lt "$(cat "$DEADLINE_FILE")" ]] || failure WINDOW_EXPIRED
  [[ ! -e "$SCRATCH/episode.sqlite" ]] || failure SYNTHETIC_DB_EXISTS_NO_AUTOREPLACE
  BP_C6_SYNTHETIC_ONLY=yes BP_C6_POC_DB_PATH="$SCRATCH/episode.sqlite" \
    timeout --kill-after=3s 20s "$NODE" "$REPO_ROOT/scripts/c6-pref-runner.mjs" bootstrap-synthetic-db || failure SYNTHETIC_DB_BOOTSTRAP_FAILED
  chown bpclaude:bpclaude "$SCRATCH/episode.sqlite" || failure SYNTHETIC_DB_CHOWN_FAILED
  chmod 600 "$SCRATCH/episode.sqlite"
  printf 'SYNTHETIC_DB_BOOTSTRAPPED_AND_OWNED_BY_BPCLAUDE\n'
}
prepare_auth() {
  # Only after a separately PINNED, owner-authorized native fixture has
  # created the in-sandbox AgentBot. Never synthesize or guess native IDs.
  [[ "$(id -u)" -eq 0 ]] || failure ROOT_REQUIRED
  verify_source; cat_status || failure CATALOG_CHANGED
  [[ -f "$PROVENANCE_MARKER" ]] || failure DATABASE_PROVENANCE_NOT_VERIFIED
  [[ -f "$SCRATCH/episode.sqlite" ]] || failure SYNTHETIC_DB_MISSING
  [[ ! -e "$SCRATCH/c6-synthetic.env" ]] || failure SYNTHETIC_AUTH_ALREADY_EXISTS
  [[ "${BP_C6_POC_ACCOUNT_ID:-}" =~ ^[0-9]{1,9}$ &&
     "${BP_C6_POC_INBOX_ID:-}" =~ ^[0-9]{1,9}$ &&
     "${BP_C6_POC_BOT_ID:-}" =~ ^[0-9]{1,9}$ ]] || failure NATIVE_FIXTURE_IDS_REQUIRED
  [[ "${BP_C6_POC_READ_TOKEN:-}" =~ ^[A-Za-z0-9_-]{16,128}$ &&
     "${BP_C6_POC_HMAC_SECRET:-}" =~ ^[A-Za-z0-9_-]{32,128}$ ]] || failure NATIVE_FIXTURE_SECRET_FORMAT_INVALID
  # A 600 synthetic file is writable by the isolated C6 user; no live keys.
  local dest="$SCRATCH/c6-synthetic.env"
  ( umask 077
    printf 'BP_C6_SYNTHETIC_ONLY=yes\nBP_C6_POC_DB_PATH=%s/episode.sqlite\nBP_C6_POC_CHATWOOT_BASE_URL=http://rails:3000\nBP_C6_POC_ACCOUNT_ID=%s\nBP_C6_POC_INBOX_ID=%s\nBP_C6_POC_BOT_ID=%s\nBP_C6_POC_READ_TOKEN=%s\nBP_C6_POC_HMAC_SECRET=%s\n' \
      "$SCRATCH_MOUNT" "$BP_C6_POC_ACCOUNT_ID" "$BP_C6_POC_INBOX_ID" "$BP_C6_POC_BOT_ID" \
      "$BP_C6_POC_READ_TOKEN" "$BP_C6_POC_HMAC_SECRET" > "$dest"
  )
  chmod 600 "$dest"; chown bpclaude:bpclaude "$dest"
  printf 'SYNTHETIC_NATIVE_FIXTURE_ENV_PREPARED\n'
}
stop_c6() {
  [[ "$(id -u)" -eq 0 ]] || failure ROOT_REQUIRED
  [[ -f "$DEADLINE_FILE" && "$(date -u +%s)" -lt "$(cat "$DEADLINE_FILE")" ]] || failure WINDOW_EXPIRED
  if systemctl is-active --quiet "$C6_UNIT.service"; then
    timeout --kill-after=3s 15s systemctl stop "$C6_UNIT.service" || failure C6_STOP_FAILED
  fi
  [[ ! -e "$SIDEKIQ_IDENTITY" ]] || rm -f -- "$SIDEKIQ_IDENTITY"
  printf 'C6_STOPPED_FOR_EXPLICIT_SIDEKIQ_REBIND\n'
}
reset() {
  [[ "$(id -u)" -eq 0 ]] || failure ROOT_REQUIRED
  # Reset only after the scoped deadman has actually restored all 4 containers.
  for name in bp-c6poc-sidekiq-1 bp-c6poc-rails-1 bp-c6poc-postgres-1 bp-c6poc-redis-1; do
    [[ "$(timeout 8s docker inspect --format '{{.State.Running}}' "$name")" == false ]] || failure "RESET_BLOCKED_RUNNING:$name"
  done
  systemctl is-active --quiet "$C6_UNIT.service" && failure RESET_BLOCKED_C6_ACTIVE
  systemctl is-active --quiet "$DEADLINE_UNIT.timer" && failure RESET_BLOCKED_TIMER_ACTIVE
  systemctl is-active --quiet "$GUARD_UNIT.timer" && failure RESET_BLOCKED_GUARD_ACTIVE
  cat_status || failure CATALOG_NOT_BASELINE_AT_RESET
  [[ "$(stat -c '%u:%a' "$CONTROL")" == '0:700' ]] || failure CONTROL_OWNER_INVALID
  rm -f -- "$SIDEKIQ_IDENTITY" "$PROVENANCE_MARKER" "$DEADLINE_FILE" "$BASELINE"
  printf 'POC_ROOT_CONTROL_RESET; SYNTHETIC_SCRATCH_PRESERVED\n'
}
case "${1:-}" in
  inspect) inspect ;;
  arm) arm ;;
  database-provenance) database_provenance ;;
  prepare-db) prepare_db ;;
  prepare-auth) prepare_auth ;;
  guard) guard ;;
  launch) launch ;;
  stop-c6) stop_c6 ;;
  reset) reset ;;
  stop) /usr/bin/bash "$STOP_SCRIPT" stop ;;
  *) printf 'usage: c6-pref-control.sh inspect|arm|database-provenance|prepare-db|prepare-auth|guard|launch|stop-c6|reset|stop\n' >&2; exit 64 ;;
esac
