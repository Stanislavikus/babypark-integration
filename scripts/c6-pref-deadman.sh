#!/usr/bin/env bash
# Test-only, deadline-triggered fail-closed teardown of the isolated bp-c6poc.
# Never touches unrelated Docker projects, BabyPark catalog, volumes or images.
set -euo pipefail
[[ "${1:-}" == stop ]] || { echo 'usage: c6-pref-deadman.sh stop' >&2; exit 64; }
PROJECT=bp-c6poc
C6_UNIT=bp-c6-poc-c6.service
BASELINE=/var/tmp/bp-c6poc-20261011/c6-synthetic/catalog-baseline.tsv
EXPECTED=(bp-c6poc-sidekiq-1 bp-c6poc-rails-1 bp-c6poc-redis-1 bp-c6poc-postgres-1)
error=0
fail() { printf '%s\n' "$*" >&2; error=1; }
# ALWAYS stop the C6 receiver FIRST. A broken Docker daemon must not skip this.
unit_loaded=''
if ! unit_loaded="$(timeout --kill-after=3s 8s systemctl show "$C6_UNIT" -p LoadState --value)"; then
  fail 'C6_UNIT_IDENTITY_UNPROVABLE'
elif [[ "$unit_loaded" != not-found ]]; then
  if ! timeout --kill-after=3s 15s systemctl stop "$C6_UNIT"; then
    fail 'C6_STOP_TIMED_OUT'
    timeout --kill-after=3s 8s systemctl kill --kill-who=all --signal=SIGKILL "$C6_UNIT" || fail 'C6_KILL_FAILED'
  fi
fi
# No reliance on hand-written container ID list; discover the Docker project
# by exact official Compose label. Only this project's containers can be stopped.
ids=''
if ! ids="$(timeout --kill-after=3s 20s docker ps -a -q --filter "label=com.docker.compose.project=$PROJECT")"; then
  fail 'DOCKER_PROJECT_ENUMERATION_FAILED'
else
  for id in $ids; do
    name=''; project=''; policy=''; running=''
    if ! name="$(timeout 10s docker inspect --format '{{.Name}}' "$id")" ||
       ! project="$(timeout 10s docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$id")" ||
       ! policy="$(timeout 10s docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$id")" ||
       ! running="$(timeout 10s docker inspect --format '{{.State.Running}}' "$id")"; then
      fail 'CONTAINER_INSPECT_FAILED'; continue
    fi
    name="${name#/}"
    [[ "$project" == "$PROJECT" ]] || { fail 'CONTAINER_PROJECT_MISMATCH'; continue; }
    matched=no
    for expected in "${EXPECTED[@]}"; do [[ "$name" == "$expected" ]] && matched=yes; done
    [[ "$matched" == yes ]] || fail "UNEXPECTED_POC_CONTAINER:$name"
    [[ "$policy" == no ]] || fail "UNSAFE_RESTART_POLICY:$name"
    if [[ "$running" == true ]]; then
      if ! timeout --kill-after=3s 30s docker stop --time 10 "$id" >/dev/null; then
        fail "CONTAINER_STOP_TIMEOUT:$name"
        timeout --kill-after=3s 15s docker kill "$id" >/dev/null || fail "CONTAINER_KILL_FAILED:$name"
      fi
    fi
  done
fi
if ! unit_state="$(timeout --kill-after=3s 8s systemctl show "$C6_UNIT" -p ActiveState --value)"; then
  fail 'C6_UNIT_STATE_UNPROVABLE'
elif [[ "$unit_state" != inactive && "$unit_state" != failed && "$unit_state" != '' ]]; then
  fail "C6_STILL_ACTIVE:$unit_state"
fi
for expected in "${EXPECTED[@]}"; do
  if ! state="$(timeout --kill-after=3s 10s docker inspect --format '{{.State.Running}}|{{index .Config.Labels "com.docker.compose.project"}}' "$expected")"; then
    fail "POC_CONTAINER_MISSING:$expected"
  elif [[ "$state" != "false|$PROJECT" ]]; then
    fail "POC_CONTAINER_NOT_STOPPED:$expected:$state"
  fi
done
# Verify catalog continuity against an ARM-TIME immutable baseline, not only
# a current one-off health status. No write to the catalog is ever attempted.
if [[ ! -f "$BASELINE" ]]; then
  fail 'CATALOG_BASELINE_MISSING'
else
  if ! current="$(timeout --kill-after=3s 8s systemctl show babypark-catalog-rehearsal.service \
    -p MainPID -p ActiveEnterTimestamp -p NRestarts --no-pager | LC_ALL=C sort)"; then
    fail 'CATALOG_STATE_READ_FAILED'
  elif [[ "$current" != "$(cat "$BASELINE")" ]]; then
    fail 'CATALOG_BASELINE_CHANGED'
  fi
fi
if ! http="$(curl --max-time 3 --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:18081/health)" || [[ "$http" != 200 ]]; then
  fail 'CATALOG_HEALTH_NOT_200'
fi
# Clean up only our two transient timers after stopping their scoped services.
for timer in bp-c6-poc-deadline.timer bp-c6-poc-memory-guard.timer; do
  timer_active=''
  if ! timer_active="$(timeout 5s systemctl show "$timer" -p ActiveState --value)"; then
    fail "POC_TIMER_STATE_UNPROVABLE:$timer"
  elif [[ "$timer_active" == active ]]; then
    timeout --kill-after=3s 8s systemctl stop "$timer" || fail "POC_TIMER_STOP_FAILED:$timer"
  fi
done
printf 'C6_POC_SHUTDOWN_UTC=%s\nSTOP_VERIFIED=%s\n' "$(date -u +%FT%TZ)" "$([[ "$error" -eq 0 ]] && echo true || echo false)"
exit "$error"
