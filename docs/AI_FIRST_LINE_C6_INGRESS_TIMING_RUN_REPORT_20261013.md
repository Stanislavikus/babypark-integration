# C6 A-prime synthetic timing — initial executable checkpoint, 2026-10-13

Status: EVIDENCE — NON-NORMATIVE; measured component subset only, NO ingress code-stage or customer authorization.
Applies to: Draft PR #128; original synthetic test exact HEAD 9a7cafd95c09c6a209019350966ed82275a98ff5; tree 0adb2d3abde6a793a30182421c2c4d2004296bac; canonical main 0dfb9b0a1cfe23d455fd436ae9abeac626d0d729; Agreement blob e777fce4af8e8c3372f1f9de9ef7d00f786c2c89.
Supersedes: none. Run date (UTC): 2026-10-13T20:00:11Z to 20:00:23Z. Owner stage approval: authenticated user 2026-10-13T19:54:03Z for bound Scan + Fit and synthetic test host only; no production telemetry permission.

## Immutable input/evidence identities
- Scan normalized SHA-256 db9d02d6ae7d012f8edc48dc04d4792bd82035e27d7801ec8175e4561c1736b2.
- Fit normalized SHA-256 504929dd2f79495256a243dd5c5cd7f575deee611c6b4555ef7b7637db358dc9.
- Pre-run plan `docs/AI_FIRST_LINE_C6_INGRESS_TIMING_PRE_RUN_20261013.md` normalized SHA-256 4d994a448390d221127dccb98f7eb05cb2e7791317cc85eace72bf23c1b15a8c.
- Test-only script `tests/fixtures/c6-ingress-native-timing.mjs` SHA-256 c0459064f61bb6494c3e6e30750cfbf8c1bbe91af7413c2b9766821079e473a4.
- Node binary /opt/babypark-rehearsal/runtime/node-v24.20.0/bin/node SHA-256 89af8424dd53e560b1933f87ba650d8bf57c83ca5a04600eefb31f416aabbae7; Node 24.20.0, bundled SQLite 3.53.4. No package installation.
- Published verbatim synthetic raw timing evidence: `docs/AI_FIRST_LINE_C6_INGRESS_TIMING_RUN_RAW_20261013.json`; 3781 UTF-8 bytes plus final newline, SHA-256 7942b56a3e702ca87b05872c4b3b3e8ff2b60ef8cb5d530910eab28be2d4b54d; Git blob bb77e26a4d41e241d46ba9bca87fc4b3721d51e3.
- Run host: babypark-catalog-rehearsal-fra1, DO-Premium-Intel x64 KVM 2 vCPU, 3.8 GiB RAM + 2 GiB swap, ext4 90GB. Host time before preflight 2026-10-13T19:55:04Z, memory available 3,080,048 KiB and free disk 73,002,428 KiB before cloning. Source Git clone exact HEAD/tree/GOV and clean worktree. `unshare --net` network namespace had no routes; uid 65534, not root; `nice -n 10`, explicit 180-second outer timeout. No public listener/production endpoint/credential/API or real data; temp synthetic v4 SQLite created and deleted. Catalog service active both before and after, zero running Docker containers before and after, source clean after.
- An earlier 2026-10-13T19:59:42Z pre-execution attempt returned exit 1 `MODULE_NOT_FOUND` before test code loaded because root-owned scratch clone ancestor initially had mode 0700 and uid 65534 could not traverse it. Log SHA-256 24a95cff18b329051f4cd5d9fdc438524d35353f981b00404ba55a40b2af381a (796 bytes); NOT COUNTED as timing trial. Changed only scratch ancestor permission to 0755, independently confirmed nonroot `node --check` PASS, and reran same HEAD/script/plan SHA without code changes. This failed pre-exec invocation is disclosed, not relabelled PASS.

## Numeric findings — descriptive only, from raw arrays
| Group | Measurements | Median ms | Nearest-rank p95 ms | Maximum ms | Functional outcome |
| --- | ---: | ---: | ---: | ---: | --- |
| Existing v4 synthetic new customer-event ingest A1 | 59 | 4.0950 | 6.6069 | 10.6065 | PASS / metadata-only existing store |
| Exact v4 idempotent duplicate A1 | 59 | 0.5401 | 0.6690 | 0.6963 | PASS / duplicate rejected |
| B1 another process holds BEGIN IMMEDIATE 20ms | 59 | 34.0223 | 34.2154 | 34.4695 | PASS / eventual acquisition |
| B2 competing SHARED reader 20ms, DELETE COMMIT waits | 59 | 36.1611 | 36.8846 | 43.1275 | PASS / eventual commit |
| B3 busy_timeout=15ms vs hold 60ms | 10 | 15.8119 | descriptive only | 16.0435 | PASS / all 10 SQLITE_BUSY, no success |
| B3 diagnostic hold 60ms and ingress 250ms | 3 | 79.2544 | not statistical | 79.2613 | PASS / diagnostic only |

A child connection configured 5000ms `PRAGMA busy_timeout` and the parent test connection read back 250ms (or 15ms for the negative) for the corresponding sites. A child holding a lock for 20ms produced observed blocking time approximately 34–43ms: SQLite scheduling/polling and other actual execution contribute beyond duration of the hold; not a bound on overshoot. The 5000ms connection was the lock holder rather than an independently blocked non-ingress co-resident event-loop site; it DOES NOT satisfy the heterogeneous `B_site[j]` full-system coverage or make 5000ms safe under a 5s callback deadline. SQLITE_BUSY from low bound remains a failure state; native HTTP response and actual durable HUMAN were NOT tested.

Event-loop-delay monitor observed mean 17.1014ms / max 89.5222ms during this one synthetic process, which includes synchronous SQLite blocking; these numbers cannot be added again as independent Q without overlap analysis. Benchmark generator and child holder share this same 2-vCPU host and are measured as co-resident; no claim of uncontended callback time or production AMD equivalence. Rehearsal host is DO-Premium-Intel, not Basic. No raw production metrics or target calibration.

## Coverage/status by pre-registered matrix
- A1: PASS for existing v4 metadata new/duplicate; schema create/open was setup and not separately benchmarked. A2 deferred/HUMAN/deferred parent: NOT TESTED.
- B1 and B2: PASS for synthetic BEGIN/DELETE-COMMIT under two real processes with relevant readbacks.
- B3: PARTIAL (ten SQLITE_BUSY negatives + three 60ms diagnostic successes); chained reacquisition, zero/nonzero free-gap polling, independently blocked other-connection 5000ms sites remain NOT TESTED.
- B4 statement-level cache_spill: NOT TESTED.
- C1/C2 mock HTTP/body, REST-resume/replenishment, overload rejection, bounded total CPU and recovery sweeps: NOT TESTED.
- D1 basic Node/event-loop-delay monitor PASS for observation, but no separate statistically representative competitor/peak profile. D2 target-match production peaks: NOT AUTHORIZED / NOT TESTED.
- E1 full formula/positive M/enforced `K,C_sync,B_site,Q,O`: HALT / UNPROVEN. E2 native Chatwoot ownership, HUMAN attention, B2 restore: NOT AUTHORIZED / NOT TESTED.
- Statement `1-0.95^59≈95.15%` in pre-run plan is conditional p95-tail encounter reasoning, NOT 95% confidence in a latency bound, nor a fitted distribution under independent traffic. Observed percentile and maximum never enforce hard deadline.

## Conclusion and next gate
Initial synthetic component measurements COMPLETE with their limited scope; no external package, paid server or production change. This supports keeping existing native tooling for basic latency instrumentation, but the *entire timing Fit is NOT COMPLETE* and cannot authorize ingress code, Chatwoot activation, public POST, merge, B2 first production DB, or customer execution. To continue, plan and execute the remaining finite test-only scenario groups under the existing approved scope (or freeze a revised plan first if changing sample/config/procedure); obtain separate explicit owner permission for bounded read-only production load/SQLite HTTP timeout provenance collection and a conservative cross-host calibration before code-stage timing Fit. Do not force success by treating absent target peaks, unknown external provider behavior or unbounded K/C_sync as zero.
