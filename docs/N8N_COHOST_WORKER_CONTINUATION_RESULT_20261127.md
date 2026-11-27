# BabyPark n8n 2.49.8 — continuation result: 4-GiB co-host measurement

Status: EVIDENCE — NON-NORMATIVE; **fit incomplete, production NO-GO, no install/merge authorization**.
Applies to: Release 2 only, official n8n 2.49.8 inactive install on `chatwoot-fra1-01` beside Chatwoot 4.20.1 and the independent Viber/Chatwoot gateway.
Supersedes: only the prior report's inference that a 1,200-MiB cgroup limit versus the host's historical MemAvailable proves 4 GiB insufficient or makes 6 GiB a required floor. Prior raw observations and successful workflow-import evidence remain historical facts.
Evidence period: production read-only telemetry 2026-11-27 00:10–15:26 UTC; current rehearsal-host snapshot 15:24 UTC.
Input pin: Draft PR #173 base `2ae02a0ea8898f5d5b341fca6ed230a34fecce58`; task HEAD `dc7520fe46e8e25b41eda57880a07175390360aa`, tree `a8d6d18aa6fa0c44e8735c8c1482487b2d511932`; Agreement blob `e2d64856e85716d5c55e724e1babce441ae348ba`.
Frozen alternatives scan remains `4b636047c76e5842c551ad93e59e03af857b1b19a6629c5d80efcd9eedf1bda7`; this continuation found no changed candidate/license fact that requires refreshing it.
The final report SHA-256 is recorded in the adjacent `N8N_COHOST_WORKER_CONTINUATION_RESULT_20261127.sha256` sidecar.

Evidence provenance: production figures are read-only observations from `/var/log/sysstat/sa27`, live `/proc` and cgroup counters, service status, and low-rate unauthenticated HTTP GETs on the named host; rehearsal figures are a read-only snapshot of the named DEV host and Docker inventory. The source checkout, task, and governance are pinned above. Raw host command output was not retained as a separate artifact, so the report checksum pins this normalized record but is not a cryptographic attestation of the remote host readings.

## Decision

**Do not resize the 4-GiB host now. Do not install n8n yet.** Production shows low current pressure and a stable, mostly idle service baseline, but there is no valid measurement of actual n8n 2.49.8 memory usage. The previous `1,200 MiB` was a container limit, not a measured `memory.peak`; comparing that limit directly to MemAvailable was not a valid proof of insufficiency. The actual 4-GiB feasibility result is **UNVERIFIED**, not FAIL.

The existing rehearsal host assessed still fails the previous Worker's preflight: it has about 2,045 MiB MemAvailable, 2,014,797,824 bytes swap occupied, 87% disk use and unrelated active projects. The exact 2.49.8 runtime, tmpfs, systemd, backup/restore and dummy-credential tests were not run there. No eligible existing rehearsal environment was available in this continuation. Production remained read-only; no Docker, n8n, backup or storage path was created there.

## Production read-only evidence

Sysstat file `/var/log/sysstat/sa27` was read through the 15:20:02 UTC sample. Ninety-two samples, approximately ten minutes apart, covered 00:10:23–15:20:02 UTC. Current readings were also sampled around the low-impact HTTP checks at 15:19–15:26 UTC.

| Measure | Observed result | Interpretation |
| --- | --- | --- |
| Host | 2 vCPU; RAM 4,106,100,736 bytes; root free 62,183,518,208 bytes (~57.9 GiB) | Production remains the owner-selected shared host |
| MemAvailable, daily sample range | min 1,299,876 kB (~1,269 MiB); average 1,713,766 kB (~1,674 MiB); max 2,566,428 kB (~2,506 MiB) | With the task's 1-GiB reserve check, the minimum leaves ~245 MiB for added workload; the 15:19 snapshot leaves ~819 MiB. This is an available-memory envelope, not n8n usage |
| Current memory and swap | At 15:19:10 UTC, MemAvailable 1,931,976,704 bytes (~1,843 MiB); swap used 768,495,616 bytes (~733 MiB of 2 GiB) | Current available memory remained near 1.84 GiB during checks |
| CPU/load | Busy average/max 2.54% / 57.50%; load-1 average/max 0.06 / 0.96 | The maximum was one recorded sample, not sustained load |
| I/O | iowait average/max 0.04% / 0.68%; `vda` utilization average/max 0.13% / 3.44%; await average/max 1.30 / 2.75 ms | No sustained disk saturation observed |
| Swap rate | 2.39 pages/s in and 6.21 pages/s out on average over the sample file | Some swapping occurs despite low current memory PSI; occupancy alone is not treated as proof of active pressure |
| Memory PSI | Current `some` and `full` avg10/60/300 were 0.00 | No measured memory-stall pressure during the snapshots |
| Chatwoot web cgroup | Active; current 557,428,736 bytes, peak 557,940,736 bytes; `memory.events` OOM counters all zero | No Chatwoot web cgroup OOM evidence |
| Chatwoot worker cgroup | Active; current 513,830,912 bytes, peak 514,383,872 bytes; `memory.events` OOM counters all zero | No Chatwoot worker cgroup OOM evidence |
| Viber/Chatwoot gateway cgroup | `babypark-integration-v2.service` active; current 35,913,728 bytes, peak 42,987,520 bytes; OOM counters all zero | Independent gateway remained active; no restart or config change |

### Low-impact Chatwoot request sample

No authenticated endpoint or customer conversation was accessed. Across four initial GETs, `/api` returned 200 with TTFB 71.6 ms (default) and 52.8 ms (`Cache-Control: no-cache`); `/app/login` returned 200 at 194.3 ms and 140.3 ms. A second login pair returned 168.5 ms and 139.9 ms. The login response is `private, must-revalidate`, so it is not a cache-hit sample. Cacheable `/manifest.json` returned 200 at 38.8 ms with `Cache-Control: public, max-age=31556952`; no `Age` or cache-hit header was exposed, so an actual cache HIT is unverified. Between the request sample's start/end, MemAvailable stayed about 1.84 GiB, load fell to 0.00/0.00/0.00 and memory PSI stayed zero. No probe-related regression was observed.

These measurements describe the current host workload only. They do not estimate the additional n8n migration or runtime peak.

## Rehearsal capacity and prior evidence

At 2026-11-27 15:24:48 UTC, `babypark-catalog-rehearsal-fra1` showed 2 vCPU, 4,106,104,832 bytes RAM, MemAvailable 2,143,895,552 bytes (~2,045 MiB), swap used 2,014,797,824 bytes (~1,922 MiB of 2 GiB), root free 12,519,006,208 bytes (~11.7 GiB, 87% used), and CPU PSI some avg10 0.69%. Existing n8n 2.43.7 was using 384.2 MiB under its 800-MiB cap; unrelated services were active. The official 2.49.8 image digest is already local and its image size is 2.17 GB, but `docker ps -a` listed no 2.49.8 container. The current local work environment has no Docker and is not the project's existing isolated rehearsal host.

The previous successful 2.49.8 migration/import used a 1,200-MiB cgroup limit with swap disabled; the earlier 800-MiB attempt did not complete. Neither the predecessor report nor a retained 2.49.8 container provides `memory.peak`, phase timing, or OOM counters. The successful import of the selected 22-node and 6-node workflows remains accepted and was not repeated. Docker inventory confirms the old 2.43.7 container is the only running n8n container on rehearsal.

**Capacity conclusion:** the owner-approved 1-GiB available-memory reserve is present in the observed baseline, but at the historical MemAvailable minimum only about 245 MiB remains above that reserve for an added workload. Since target-version actual peak is unknown, this cannot be converted into a 4-GiB GO or a measured NO-GO. The earlier suggested 6-GiB floor is withdrawn. Keep the current 4-GiB server; request a shared-host resize only if an eligible test produces an actual peak/latency shortfall. No separate production VM is proposed.

## Blocker inventory

| Invariant | Evidence and source identity | Result | Minimal stock remedy | Regression check | Allowed next action |
| --- | --- | --- | --- | --- | --- |
| 4-GiB capacity is proven for bounded inactive n8n | Production 92-sample range above; prior 2.49.8 migration has a 1,200-MiB limit but no `memory.peak` result | **UNVERIFIED**; do not call 4 GiB insufficient from the limit alone | Use an eligible existing isolated rehearsal host; pin the 2.49.8 image, set 1,200 and 1,536 MiB test caps separately with zero container swap, retain at least the task's 1-GiB host reserve, record actual cgroup current/peak/OOM by startup, migration and steady state | Capture cgroup `memory.peak`, `memory.events`, host MemAvailable/PSI/swap and bounded Chatwoot/Viber latency comparison before/after | No production install or resize; obtain/identify an eligible nonproduction host |
| 2.49.8 execution data uses host `tmpfs,noswap` and leaves no sentinel in durable state | Existing mount evidence is only from 2.43.7; no 2.49.8 synthetic normal/error/manual/wait runtime was run | **UNVERIFIED** | On the eligible rehearsal host, use valid official CLI/UI-exported synthetic fixtures, the exact pinned image and host-mounted `tmpfs,noswap`; keep synthetic DB on disk | Scan SQLite/WAL/SHM, user-folder backup, `/vol`, eventBus and Docker logs for an aggregate sentinel match result; never print sentinel | Synthetic-only validation; no customer content |
| Missing mount prevents the 2.49.8 service starting | Existing 2.43.7 systemd service/mount units were inactive and had no active mount dependency; no new 2.49.8 unit exists | **UNVERIFIED** | Add the explicit `.mount` dependency only in the later authorized release configuration | Negative start with absent mount must fail; positive start with verified `tmpfs,noswap` must pass; never restart existing DEV or production services | No systemd/config change now |
| SQLite backup restores with the same key and decrypts a dummy credential | No clean same-version restore/key-recovery test exists | **UNVERIFIED** | Use official same-version n8n and a test-only key/credential; backup the complete user state and a consistent SQLite copy | Check backup checksums, `PRAGMA integrity_check`, workflow counts, file permissions and restore duration; verify decryption without emitting plaintext | No real credential access or production backup |
| Stock DB/Compose/storage choice is release-ready | SQLite/PostgreSQL same-limit benchmark absent; Compose and storage classes are not registered; §3 exact-SHA `integrate` approval absent | **BLOCKED** | Complete fit on exact measured evidence; only after a frozen fit and exact-SHA owner authorization, prepare one bounded Compose/storage implementation PR | `docker compose config`, required `config/**` tests, exact-base diff check, traceability and independent review after authorization | Docs-only updates in this PR; no executable Compose or `config/**` mutation |
| Current operations are stable while measuring | 92 sysstat records, current pressure snapshots, service cgroups and low-impact request samples above | **PASS for observed period only**; not a future n8n load test | Recheck under any later bounded install run; stop probes on regression | Capture comparable before/after service and latency samples | No production write; existing 4-GiB placement retained |

## Safe next run

No existing eligible rehearsal host is presently available. Do not buy/provision a VM or use production to work around this. The owner must identify or authorize an already owned nonproduction environment that can run the official image and a no-swap container without pressure on unrelated projects. Before test start, verify the host can accommodate the selected 1,200–1,536 MiB cgroup limit **plus the task's 1-GiB reserve check**, has no active memory pressure and has disk space for the 2.17-GB image plus measured DB/backup/restore copies.

Then, without touching the old DEV container:

1. Use the pinned official 2.49.8 image and collect host/cgroup baselines. Run a fresh blank-DB start and first migration, recording `memory.current`, `memory.peak`, `memory.events`, time, MemAvailable, PSI, swap and disk before, during and after. Keep the two previously accepted workflow imports out unless their presence is strictly necessary to measure the bounded inactive profile; if needed, import once for memory measurement only, not structural revalidation.
2. Mount a new n8n-specific host `tmpfs,noswap`; test the explicit systemd `.mount` dependency both absent and present. Use a valid official-exported synthetic fixture to cover normal, error, manual and bounded wait execution. Scan durable SQLite/WAL/SHM, the user-folder backup, runtime storage, eventBus and Docker logs without emitting the sentinel.
3. Create only a dummy credential with a disposable test key. Take a consistent same-version SQLite/user-folder backup, restore to a clean isolated destination with the same key, then record checksums, integrity result, counts, permissions, decryption success and recovery duration without printing secret values.
4. Compare actual n8n peak against the production baseline and 1-GiB reserve, plus bounded pre/post Chatwoot/Viber health and latency. **Only measured shortfall** justifies requesting a resize of this same shared host. If the reserve and latency remain within the bounded baseline, keep the 4-GiB host and finish the fit evidence.
5. After all Release 2 technical checks pass, freeze the complete normalized fit note and its SHA-256. Request owner `integrate` approval bound to that exact digest before any Compose or `config/**` work. No merge, Docker install or production activation is included here.

## Current release boundary

This continuation did not create a Compose file, storage-policy entry, host path, service unit, backup, credential, container or production change. The fit note remains draft/unfrozen; no `integrate` authorization is requested because the mandatory runtime and recovery evidence is still missing. Release 3 customer traffic remains outside scope and requires separate authorization.

