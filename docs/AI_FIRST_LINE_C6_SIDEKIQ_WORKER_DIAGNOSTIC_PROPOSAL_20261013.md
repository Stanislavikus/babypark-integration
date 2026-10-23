# C6 A-prime — Sidekiq Worker CPU diagnostic proposal (2026-10-13)

Status: NON-NORMATIVE PROPOSAL ONLY; NOT AUTHORIZED OR EXECUTED. No customer/Chatwoot/runtime/production modification or merge.
Project/repository: `Stanislavikus/babypark-integration` only; part of existing Draft PR #128, not a new implementation campaign.
Proposal basis: main `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729`; Agreement blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`; prior PR head `aeb9025d1eecd1850dab017581a014c8951dfbbb` / tree `cb071932a652f4091a5c0302064ca7f3ef49d3c2`.
Prior evidence: 21 passive read-only samples on preproduction `chatwoot-fra1-01` 2026-10-13 20:26:34–20:36:37 UTC; approximately 100.5% of ONE vCPU continually attributed to `chatwoot-worker.1.service`. No material swapping or IO/pressure during that interval. Cause UNKNOWN; high CPU does NOT by itself establish busy-loop, retries, job failures or a software defect.

## Exact purpose and privacy boundary
Confirm whether Sidekiq-native aggregate task statistics and per-class execution metrics explain sustained worker CPU before any active load or target-calibrated ingress timing. Report only: aggregate counts for named queues, retry/dead/scheduled counts, per-class executed-job COUNTS/aggregate durations, and numeric CPU/memory consumption for the worker service. **No job arguments, JIDs, retry errors/backtraces, task payloads, Rails logs, process environment, command lines, customer transcript, sender data, network identifiers, DB tables, credentials or raw Redis job list.**
No package installation, write command, remote production data copy, configuration change, Restart/Retry/Delete/Kill action, new port, stress workload, Chatwoot API invocation, or Chatwoot core modification. No publication of raw host/process time-series or sensitive operational detail into public GitHub. Only sanitized totals and integrity/UTC evidence may be reported. ChatGPT/connector audit retention is not owner-controlled; no promise to delete those provider logs.

## NATIVE FIRST: exact source-authenticated option (preferred; requires separately scoped approval)
- Chatwoot upstream `chatwoot/chatwoot` tag `v4.18.0`, `Gemfile.lock` blob `c9edf7e36e682f8a733d8c04ebed6dcd21dcd86d` pins Sidekiq **7.3.10**; `config/routes.rb` blob `f15e1cfbb5653bf1726b285119fc16b29bbf1b6d` mounts native `Sidekiq::Web` at `/monitoring/sidekiq` under authenticated `super_admin` (source lines 721–764).
- Sidekiq OSS 7+ ships `/metrics` and built-in class-level execution time/count. Official references: https://github.com/sidekiq/sidekiq/wiki/Metrics and https://github.com/sidekiq/sidekiq/wiki/API . Metrics typically retains up to 8 hours and primarily counts successful execution time; errors, long-running in-flight tasks and CPU spinning without completed jobs may not be represented.
- **Entry:** using an already-authorized super-admin session only, navigate in the existing Chatwoot UI to the same-origin path `/monitoring/sidekiq`; view the read-only Dashboard/overview and `Metrics` tab (relative path `/monitoring/sidekiq/metrics` if present). Do NOT expose or enable the interface, weaken auth, request a password, or guess the public host URL.
- **View-only data to transcribe:** (a) timestamp UTC; (b) total enqueued and per-queue counts, retry, dead, scheduled and busy as visible; (c) per-class job counts, elapsed aggregate wall time and/or mean from Metrics, with no more than top 20 class names. If no metrics or zero completed jobs, record that fact; do not infer the worker idles.
- **Forbidden UI actions:** do not open individual job detail, Retry/Dead item list if it automatically reveals argument fields, raw exception messages/backtraces or `args`; do not click Retry, Delete, Clear, Quiet, Stop or other action endpoints. No screenshots of pages containing task arguments or customer content.
- **Source-vs-runtime caveat:** the verified upstream tag is NOT proof of deployed exact version or that the mounted page is currently reachable/authenticated. If authentication, UI privacy or version compatibility is uncertain, stop; do not work around protection or collect data another way.

## Optional host-side numeric corroboration, NOT to run before approval
If additional temporal correlation is needed, exactly four snapshots at 30-second spacing (90 seconds total) may be collected on the previously-authorized preproduction `chatwoot-fra1-01` device using only these read-only allowlisted commands and fixed service identity. No Rails runner, Redis CLI/SCAN, cgroup process enumeration, network call, logs, `ps`, SIGQUIT/TTIN, profiler, GDB or application inspection. No file output on host. Outer controller applies `timeout --signal=TERM --kill-after=5s 125s bash --noprofile --norc -c <body>`.

```bash
set -euo pipefail
export LC_ALL=C
cg=$(systemctl show chatwoot-worker.1.service --property=ControlGroup --value)
test "$cg" = "/system.slice/chatwoot-worker.1.service" || { printf 'HALT_CGROUP_MISMATCH\n'; exit 2; }
test -r "/sys/fs/cgroup$cg/cpu.stat" || exit 2
test -r "/sys/fs/cgroup$cg/memory.current" || exit 2
for i in 0 1 2 3; do
  printf 'SAMPLE=%s UTC=' "$i"; date -u +%FT%TZ
  awk '$1=="usage_usec" || $1=="nr_throttled" || $1=="throttled_usec" { print "WORKER_CPU", $1, $2 }' "/sys/fs/cgroup$cg/cpu.stat"
  awk '{ print "WORKER_MEM_BYTES", $1 }' "/sys/fs/cgroup$cg/memory.current"
  awk '$1=="some" || $1=="full" { print "CPU_PSI", $1,$2,$3,$4,$5 }' /proc/pressure/cpu
  if test "$i" != 3; then sleep 30; fi
done
```

The optional host-side sampler is independent of the browser-side counts: if only one is approved, do not infer authorization for the other. The official Sidekiq JobRecord API normally deserializes full job objects containing `args`. **No code iterating `Sidekiq::Queue.each`, `RetrySet.each`, `DeadSet.each`, `Workers.each`, Redis LRANGE/ZRANGE or reading per-job payloads is authorized**, even if output filters claim to print only class names. Use native aggregated Sidekiq Metrics for class names. No custom reader is needed.

## Interpretation / evidence gate
- If total processed/failed changes rapidly or one class dominates aggregate execution time, it is an investigation lead, NOT proof that this class exclusively consumes CPU. Sidekiq's metrics are primarily execution wall time, not CPU profiler attribution. A task that spins without completing may not appear in completed-class metrics.
- If queues/retry/dead counts remain low and native per-class metrics have no explanatory signal, report UNKNOWN and propose another separately approved safe approach; never infer broken looping behavior without evidence.
- Do not auto-reconfigure Sidekiq threads, Redis, Postgres, cron, scheduler, Gateway or worker service based on these observations. Any future fix to Chatwoot service is a separate owner decision and compatibility/governance review. Do not put it inside the C6 ingress production-code campaign.
- Post-diagnostic Fit remains HALT without target-matched CPU/REST/callback/per-site SQLite bounds and independent native HUMAN/B2 gates. No HEAVY final review or merge is authorized by this diagnostic proposal.

## Owner decisions
Two separately approvable scopes: **A** = native authenticated Sidekiq view-only Dashboard+Metrics, only counts/class names/aggregate durations; **B** = exactly the optional 90-second read-only worker cgroup/CPU PSI shell sequence above. Owner explicit approval must bind normalized SHA-256 of this document, host `chatwoot-fra1-01`, permitted scope A/B, and ChatGPT/connector log-retention caveat. No interpretation of the prior 10-minute passive telemetry permission as automatic extension. If the UI displays arguments unexpectedly, **HALT** without collecting them.
