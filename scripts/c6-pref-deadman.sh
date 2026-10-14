#!/usr/bin/env bash
# C6 PRE-FIX PoC-only deadline stopper. Stop only the four exact PoC containers
# and named transient C6 unit. Do NOT stop catalog or remove Docker volumes.
set -euo pipefail
[[ "${1:-}" == "stop" ]] || { echo 'usage: c6-pref-deadman.sh stop' >&2; exit 64; }
PROJECT=bp-c6poc
C6_UNIT=bp-c6-poc-c6.service
NAMES=(bp-c6poc-sidekiq-1 bp-c6poc-rails-1 bp-c6poc-redis-1 bp-c6poc-postgres-1)
# Fail-safe ordering: shut down C6 first, even when a container is missing.
systemctl stop "$C6_UNIT" 2>/dev/null || true
failure=0
for name in "${NAMES[@]}"; do
  if ! project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$name" 2>/dev/null)"; then
    echo "POC_CONTAINER_NOT_FOUND: $name" >&2
    failure=1
    continue
  fi
  if [[ "$project" != "$PROJECT" ]]; then
    echo "POC_CONTAINER_IDENTITY_MISMATCH: $name" >&2
    failure=1
    continue
  fi
  if [[ "$(docker inspect --format '{{.State.Running}}' "$name")" == true ]]; then
    docker stop --time 10 "$name" >/dev/null || failure=1
  fi
done
printf 'C6_POC_STOPPED_UTC=%s\n' "$(date -u +%FT%TZ)"
systemctl show babypark-catalog-rehearsal.service \
  -p ActiveState -p MainPID -p NRestarts -p ActiveEnterTimestamp --no-pager
curl --max-time 3 --silent --output /dev/null \
  --write-out 'CATALOG_HTTP=%{http_code}\n' http://127.0.0.1:18081/health
free -m | head -n 2

exit "${failure}"
