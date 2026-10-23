# C6 A-prime — Proposed limited production read-only telemetry pilot (2026-10-13)

Status: PROPOSAL ONLY — NO OWNER AUTHORIZATION OR EXECUTION. Non-normative pre-approval document.
Repository `Stanislavikus/babypark-integration` only; PR #128, C6 A-prime timing work. No Chatwoot/customer activation, no production write, no merge.
Source authority at proposal: canonical main 0dfb9b0a1cfe23d455fd436ae9abeac626d0d729; Agreement blob e777fce4af8e8c3372f1f9de9ef7d00f786c2c89; Draft PR HEAD before this document ef8d76e9940faef5d4a56b56a12a9bc3dc74dd4f, TREE 3ebd30140048b38eda1e4b163eab5a14578fa701.
Background: Scan SHA-256 db9d02d6ae7d012f8edc48dc04d4792bd82035e27d7801ec8175e4561c1736b2; synthetic Fit SHA-256 504929dd2f79495256a243dd5c5cd7f575deee611c6b4555ef7b7637db358dc9; V1/V2 synthetic results documented separately. The existing synthetic Fit approval does NOT cover ANY production host observation.

## Purpose and strict non-authority
Collect a low-overhead 10-minute NUMERIC-ONLY read-only pilot of production host load over 21 timestamps at 30-second intervals. The purpose is to validate feasibility of allowed host monitoring and capture a short baseline. It is NOT a representative daily peak profile, AMD/Intel compute-speed benchmark, CPU/disk calibration or target-matched ingress code-stage Fit. Subsequent representative peak telemetry window, safe synthetic control benchmark on target, provider callback settings, direct Chatwoot/SQLite access, performance configuration or any deployment changes require new separately scoped owner approvals. Never treat an absent cgroup counter or unobserved peak as zero.

## Host scope, access and execution
Target: existing authorized Desktop Commander connection to `chatwoot-fra1-01` ONLY, if currently online. No SSH credentials in messages; no package installation, root/sudo escalation, new daemon, cron/systemd task, production config mutation or service restart. Run a single bounded shell command, with a hard outer timeout of 660 seconds, manually watched until process finishes. All reads limited to `/proc/stat`, `/proc/meminfo`, `/proc/vmstat`, `/proc/pressure/{cpu,memory,io}`, `/proc/diskstats`, Linux cgroup-v2 numeric `cpu.stat` and `memory.current` for allowlisted units; `systemctl show <unit> --property=ControlGroup --value` merely resolves existing service cgroup paths; `df -P /` is read-only filesystem counters; `date`, `awk`, `sleep`, `printf`, `seq`, `test` are existing shell tools. Do NOT run `ps` full args, read proc environ/cmdline, enumerate customer directories, inspect database, Rails/Chatwoot API, application logs, secret files, network interfaces/requests, or collect individual customer identifiers.

No /tmp file, shell redirection to a file, SQLite write, daemon or cron on production. Output contains timestamps, numeric counters, allowlisted unit names and UNAVAILABLE markers. It contains no host IP, customer text, email, phone, path to transcript, command line of application, secrets or PIDs. The command stdout is transferred to the tool invocation and can be retained by the ChatGPT/tool service according to provider policies outside BabyPark's direct deletion control; a time-limited deletion guarantee for those backend logs CANNOT be made. Explicit owner acceptance of this limitation is required. Since GitHub repository is PUBLIC, do NOT put full raw time-series or precise live host operational metrics in commits/PR comments. Only high-level non-sensitive aggregation plus source command SHA/date and explicitly stated limits may be placed in public GitHub. If raw numeric evidence must be stored/retrieved privately under BabyPark-set deletion deadlines, STOP and plan a separate approved private store before gathering it.

## Exact proposed collection command (not executed)
This exact script body is passed to `bash --noprofile --norc -c` after owner approval. Outer wrapper `timeout --signal=TERM --kill-after=5s 660s bash --noprofile --norc -c <this-script>` is applied by the controller. If one of the required reads is inaccessible, record UNAVAILABLE and leave any dependent fit HALT.

```bash
set -euo pipefail
export LC_ALL=C
for tool in awk date sleep systemctl df; do command -v "$tool" >/dev/null || exit 70; done
printf 'C6_TELEMETRY_PILOT_V1\n'
printf 'START_UTC='; date -u +%FT%TZ
printf 'FS_BASE='; df -P / | awk 'NR==2 {print $2,$3,$4,$5}'
for i in $(seq 0 20); do
  printf 'SAMPLE=%s UTC=' "$i"; date -u +%FT%TZ
  awk '$1=="cpu" {print "CPU_TICKS", $2,$3,$4,$5,$6,$7,$8,$9,$10,$11}
       $1=="procs_running" {print "RUNNABLE", $2}' /proc/stat
  awk '$1=="MemAvailable:" || $1=="MemTotal:" ||
       $1=="SwapFree:" || $1=="SwapTotal:" {print "MEM", $1,$2}' /proc/meminfo
  awk '$1=="pgmajfault" || $1=="pswpin" || $1=="pswpout" ||
       $1=="pgpgin" || $1=="pgpgout" {print "VM", $1,$2}' /proc/vmstat
  for resource in cpu memory io; do
    file="/proc/pressure/$resource"
    if test -r "$file"; then
      awk -v kind="$resource" '$1=="some" || $1=="full" {
        print "PSI",kind,$1,$2,$3,$4,$5
      }' "$file"
    else printf 'PSI %s UNAVAILABLE\n' "$resource"; fi
  done
  awk '$3=="vda" {print "DISK_VDA", $4,$6,$7,$8,$10,$11,$12,$13,$14,$15,$16,$17,$18}' /proc/diskstats
  for unit in chatwoot-web.1.service chatwoot-worker.1.service postgresql@16-main.service redis-server.service babypark-integration-v2.service; do
    cg=$(systemctl show "$unit" --property=ControlGroup --value 2>/dev/null || :)
    case "$cg" in
      /system.slice/*.service)
        cpu_file="/sys/fs/cgroup$cg/cpu.stat"
        mem_file="/sys/fs/cgroup$cg/memory.current"
        if test -r "$cpu_file" && test -r "$mem_file"; then
          cpu_us=$(awk '$1=="usage_usec" {print $2}' "$cpu_file")
          mem_b=$(awk '{print $1}' "$mem_file")
          printf 'CG %s %s %s\n' "$unit" "$cpu_us" "$mem_b"
        else printf 'CG %s UNAVAILABLE\n' "$unit"; fi ;;
      *) printf 'CG %s UNAVAILABLE\n' "$unit" ;;
    esac
  done
  if test "$i" -ne 20; then sleep 30; fi
done
printf 'END_UTC='; date -u +%FT%TZ
printf 'FS_END='; df -P / | awk 'NR==2 {print $2,$3,$4,$5}'
```

## Preconditions and abort
Before invocation (but only after explicit owner approval): verify host identity through the already connected device name, confirm no unexpected lack of access, `/proc/pressure` and cgroup-v2 availability, current repo main/GOV, shell and installed tool existence without apt/package change, and health/CPU/memory headroom using the same read-only allowlist. Do not run if limited read-only access is unavailable or connection identity is ambiguous; no fallback to sudo. Stop on unexpected sensitive output or if host becomes unstable; do not access customer data. The 21x30-second schedule is a bounded short pilot, NOT a statistically justified peak capture or final Fit.

## Ownership/retention and next gate
Raw numeric stdout: only the controller’s ephemeral command result / ChatGPT connection transcript; no new production/test-host files, no public git raw output. The tool/chat retention cannot be promised or manually forced by the assistant. Do not claim raw evidence was destroyed after a certain period. A public PR may record a digest of the command, UTC window, aggregation of peak ranges with no service-level secrets, and the unresolved provider log-retention limitation, but NOT the raw captured telemetry. No future automatic recurring collection. Under current evidence absence of multi-day representative peaks and cross-host source calibration keeps code-stage Fit HALT. Owner go-ahead must explicitly approve this plan document by normalized SHA-256, the one named host, 21 samples/10 minutes, read-only allowlist and ChatGPT/tool capture retention caveat; approval cannot authorize any other endpoint, host, method or customer action.
