# C6 A-prime V2 — Synthetic remaining-matrix execution report (2026-10-13)

Status: EVIDENCE — NON-NORMATIVE; synthetic component proof only. **FULL INGRESS FIT HALT; no production code, customer execution, merge or Chatwoot changes authorized.**
Repository: Stanislavikus/babypark-integration ONLY. Runtime campaign Draft PR #128.
Execution HEAD 5cea98dca1cee067f2c0ed144787e0873dff8d53; execution tree a114d1fab3118f8037f3f3c7a453a68ba65bce84; base main 0dfb9b0a1cfe23d455fd436ae9abeac626d0d729; Agreement blob e777fce4af8e8c3372f1f9de9ef7d00f786c2c89. Freeze was BEFORE experiment.

## Approval and exact experiment material
Owner approved only synthetic non-production stage on existing host in authenticated chat 2026-10-13T19:54:03Z. Scan SHA-256 db9d02d6ae7d012f8edc48dc04d4792bd82035e27d7801ec8175e4561c1736b2; Fit SHA-256 504929dd2f79495256a243dd5c5cd7f575deee611c6b4555ef7b7637db358dc9. V2 incremental pre-run plan `docs/AI_FIRST_LINE_C6_INGRESS_TIMING_PRE_RUN_V2_20261013.md` SHA-256 fe3a96ae3614f672496f250cbbd2da01b7e751483effb46c6c6ecfff78985b6f; V2 test-only fixture `tests/fixtures/c6-ingress-native-timing-v2.mjs` SHA-256 1b54c4d06436c980c32c6cdf6ae3cdacc9c80e4dfbaf469cac5452c52e0bb4b6. Source code/tests under src and production deps untouched. V1 artifacts remain immutable.

Run on babypark-catalog-rehearsal-fra1, UTC 2026-10-13T20:11:17Z to 20:11:53Z, exit 0, runtime 37.23 seconds. Exact node executable SHA-256 89af8424dd53e560b1933f87ba650d8bf57c83ca5a04600eefb31f416aabbae7, Node 24.20.0, bundled SQLite 3.53.4; target Debian/Chatwoot not touched. Host DO-Premium-Intel 2vCPU/3.8GiB plus swap, ext4; test-only unprivileged uid65534, `unshare --net` with zero network routes, Unix domain socket only (no public TCP listener), native built-ins with 180s outer timeout, synthetic v4 and SQLite DBs in temp. Before: available RAM 3,072,652 KiB, tmp disk free 73,001,840 KiB; catalog service active, zero Docker containers; exact HEAD/tree/GOV, script syntax SHA and `git diff --check base..HEAD` PASS. After: original Git worktree CLEAN, catalog still active, zero containers. Raw stdout evidence `docs/AI_FIRST_LINE_C6_INGRESS_TIMING_RUN_V2_RAW_20261013.json`, **verbatim** UTF-8 with LF, 6279 bytes, SHA-256 **f23da7f3f17764bee20467fd886b97b7ba045d812b15d998b6810b7a829629dc**, Git blob a87357458dc51dd638414279f220935400f9c420. No production secrets, transcripts or customer message data.

## Precise results (units ms, raw per-trial values in JSON)
| Scenario | n | p50 | p95 nearest-rank | max | Functional outcome |
| --- | ---: | ---: | ---: | ---: | --- |
| A2 existing actual v4 ingest + DIRECT_HUMAN absorb | 59 | 6.0555 | 6.9243 | 13.7073 | PASS, **existing multiple-transaction surrogate** |
| B4 `cache_spill=ON`, SQLite DELETE, 128 x 4096-byte INSERTs with competing reader and 25-ms `busy_timeout` | 10 | 3045.1733 | 3046.7588 | 3046.7588 | All 10 succeeded, `SQLITE_BUSY=0`; **critical unbounded-multi-site signal** |
| B4 `cache_spill=OFF`, same test workload | 10 | 0.4451 | 0.9471 | 0.9471 | All 10 succeeded, `SQLITE_BUSY=0`; not an automatic production setting |
| C1 Unix-domain socket mock HTTP, three 6ms sequential synthetic awaits | 59 | 19.9444 | 22.3602 | 22.8933 | PASS; synthetic surrogate, **NOT production Chatwoot R_seq** |
| C2 8 concurrent arrivals, N=4 (functional synthetic over-N) | 59 waves | 21.6608 | 25.1410 | 27.0291 | PASS, rejected excess using synthetic HTTP 503, NOT native Chatwoot effect |
| C2 repeated replenish waves (4 waves x 8 arrivals, ten repeats) | 320 requests | — | — | — | PASS, 160 admitted, 160 synthetic rejects; bounded generator workload |
| C2 co-resident 64 SQLite SELECT / accepted synthetic callback plus three asynchronous resumes | 59 | 20.5084 | 21.9359 | 26.0076 | PASS as synthetic work/queue observation |
| C2 slow/partial body | 10 | — | — | — | 10/10 rejected synthetic HTTP 408, zero REST reads |
| C2 byte-cap violation | 10 | — | — | — | 10/10 rejected synthetic HTTP 413, zero REST reads |
| C2 wrong HMAC | 10 | — | — | — | 10/10 rejected synthetic HTTP 401, zero REST reads |

Mock service counters over whole run: highest inflight 4; admitted 604; rejected over-N 436; 1722 synthetic REST timer phases/resumptions; 4416 synchronous SQLite SELECT statements; zero inflight at completion. Event-loop-delay mean 10.2903ms, maximum 15.5566ms for this run (not additive budget Q after overlapping CPU/SQLite is included). Node process CPU user 1,390,928 microseconds / system 299,149 microseconds. 59-sample percentiles do not prove hard tail or timeout guarantees. Same-host request generator consumes the same two CPU cores as measured service.

## Key independent finding: B4 repeated lock stalls without error
The `cache_spill=ON` workload took **~3.045 seconds** with each INSERT associated with a lock-constrained reader, yet the owning connection read back **25ms busy_timeout** and no trial failed. `cache_spill=OFF` under the same fixture took ~0.45ms median (both batches have just ten trials). This is empirical proof that *one timeout per transaction* is an invalid bound. It is consistent with repeated statement-level spills/reacquisitions, but the exact number and identity of blocked EXCLUSIVE acquisitions were NOT instrumented. Therefore **K and per-site B_wait[j] remain UNPROVEN**. Do not infer one-sided production improvement or choose `cache_spill=OFF` globally without a separate owner-approved code-stage impact Fit, memory/large-write audit, backup/DELETE-vs-WAL concurrency and per-connection startup-readback proof. Do not drop high-timeout co-resident readers/writers from the event-loop budget.

## Coverage / residual HALTs
- A2 COMPLETE as existing v4 fixture: unique synthetic streams, event append, DIRECT_HUMAN, no autonomous continuation, PRAGMA v4=5000ms; final future ingress atomic one-BEGIN and no-thenable guard NOT PROVEN.
- B4 PARTIAL: ON/OFF PRAGMA readback and opposing-reader timing; **K per-statement source-site inventory NOT PROVEN**. B3 repeated short-gapped lock reacquisition (zero/nonzero polling windows) NOT TESTED.
- C1/C2 synthetic HTTP/body/HMAC/REST wave, over-N and a finite test generator PASS. Actual deployed Chatwoot REST authoritative GET latency, real provider timeout and HTTP side effects NOT TESTED.
- Actual extra recovery worker/backup interference, peak production Chatwoot Web/Worker/Postgres/Redis/Gateway CPU/disk, AMD-vs-Intel conservative calibration, model end-to-end callback and true HUMAN/operator attention remain **NOT AUTHORIZED or NOT TESTED**.
- The mock HTTP status map (401/408/413/503) is NOT selected for production, does not establish Chatwoot native retry or ownership, and must not be reused as authority.
- The ingress `I+R_seq+C_sync+SUM B_wait[j]+Q+O < T_webhook-M` budget still has unknown bounded K, target workload/Q, REST R_seq, safe M and per-connection B_site, thus **TARGET-MATCHED CODE-STAGE HALT**; public-send/HUMAN/activation/B2 gates independent and open.
- This first-pass synthetic evidence is *not* qualifying exact-final-HEAD `npm test`, traceability terminal, HEAVY R1/R2 verification or merger permission. Those remain a single whole-C6 campaign closure at the proper boundary.

## Next bounded work
Address only residual scenario B3 lock-gap polling/statement-level K source inventory with tests on the same synthetic host if justified under the already-approved test-only scope. Prepare separately scoped, explicit owner permission request for non-secret **read-only** production telemetry with exact command allowlist, time window, no installed packages/side effects, raw-output hashing/retention; absent approval, production telemetry and AMD/Intel calibration HALT. Independently test native Chatwoot provider behavior in its previously approved/isolated PoC only after that PoC's own pre-execution owner gate, NOT with this synthetic approval. No new server or production change is needed for this report.
