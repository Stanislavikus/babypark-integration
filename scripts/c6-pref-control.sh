#!/usr/bin/env bash
# C6 isolated PoC control. TEST-ONLY. This file creates no persistent unit.
# All operations after `inspect` require digest-bound owner authorization.
set -euo pipefail
PROJECT=bp-c6poc
SCRATCH=/var/tmp/bp-c6poc-20261011/c6-synthetic
BASELINE="$SCRATCH/catalog-baseline.tsv"
DEADLINE_FILE="$SCRATCH/deadline-utc-epoch"
SIDEKIQ_IDENTITY="$SCRATCH/sidekiq-identity.tsv"
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
  [[ "$(docker network inspect bp-c6poc_isolated --format '{{.Internal}}')" == true ]] || failure NETWORK_EGRESS_BOUNDARY
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
  [[ ! -e "$BASELINE" && ! -e "$DEADLINE_FILE" ]] || failure POC_ALREADY_ARMED
  [[ ! -e "$SCRATCH" ]] || [[ "$(stat -c '%U' "$SCRATCH")" == root ]] || failure FOREIGN_SCRATCH_OWNER
  install -d -m 700 -o root -g root "$SCRATCH"
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
  [[ -f "$DEADLINE_FILE" ]] || failure DEADLINE_FILE_MISSING
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
  if [[ "$provenance" != '0|0|0' ]]; then
    printf 'POC_DB_NONEMPTY_REQUIRES_PROVEN_SYNTHETIC_ORIGIN_BEFORE_NEXT_STAGE\n' >&2
    return 72
  fi
  cat_status || failure CATALOG_CHANGED
  printf 'POC_DB_EMPTY_PASSED\n'
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
  [[ -e "$SCRATCH/episode.sqlite" ]] || failure EXPLICIT_SYNTHETIC_DB_MISSING
  local envfile="$SCRATCH/c6-synthetic.env"
  [[ -f "$envfile" && "$(stat -c %a "$envfile")" == 600 ]] || failure SYNTHETIC_AUTH_ENV_NOT_PREPARED
  [[ "$(stat -c %U "$SCRATCH")" == bpclaude ]] || failure SCRATCH_NOT_OWNED_BY_UNPRIVILEGED_USER
  printf '%s|%s|%s\n' "$side_pid" "$side_id" "$netns" > "$SIDEKIQ_IDENTITY"
  chmod 600 "$SIDEKIQ_IDENTITY"
  systemd-run --unit="$C6_UNIT" --collect --service-type=simple \
    -p User=bpclaude -p WorkingDirectory="$REPO_ROOT" \
    -p "EnvironmentFile=$envfile" \
    -p "Environment=BP_C6_POC_SIDEKIQ_NETNS=$netns" \
    -p "Environment=BP_C6_POC_HOST_NETNS=$hostns" \
    -p "Environment=BP_C6_POC_SIDEKIQ_HOST_PID=$side_pid" \
    -p "Environment=BP_C6_POC_RAILS_IP=$rails_ip" \
    -p "NetworkNamespacePath=/proc/$side_pid/ns/net" \
    -p "BindReadOnlyPaths=$resolv:/etc/resolv.conf" \
    -p MemoryMax=128M -p MemorySwapMax=0 -p CPUQuota=20% -p TasksMax=32 \
    -p RuntimeMaxSec=10800 -p TimeoutStopSec=10s -p Restart=no \
    -p NoNewPrivileges=yes -p ProtectSystem=strict -p ProtectHome=yes \
    -p "ReadWritePaths=$SCRATCH" -p PrivateTmp=yes \
    "$NODE" --max-old-space-size=64 "$REPO_ROOT/scripts/c6-pref-runner.mjs" serve
  systemctl is-active --quiet "$C6_UNIT.service" || failure C6_FAILED_TO_START
  printf 'C6_ISOLATED_SYSTEMD_STARTED\n'
}
case "${1:-}" in
  inspect) inspect ;;
  arm) arm ;;
  database-provenance) database_provenance ;;
  guard) guard ;;
  launch) launch ;;
  stop) /usr/bin/bash "$STOP_SCRIPT" stop ;;
  *) printf 'usage: c6-pref-control.sh inspect|arm|database-provenance|guard|launch|stop\n' >&2; exit 64 ;;
esac
