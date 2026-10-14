# C6 Stage B Phase A — synthetic PoC fixture review manifest (2026-10-14)

Status: EVIDENCE — NON-NORMATIVE; SOURCE-ONLY, NOT EXECUTED, NOT APPROVED TO RUN.
Applies to: C6 PR #128 ingress-only Stage B Phase A PoC preparation; no Phase B implementation or production behavior.
Supersedes: none. The PoC branch is separate from frozen #128, #134 and merged Design.

Owner authorization 2026-10-14T07:34:57Z: WRITE FIXTURE ONLY, in separate PoC branch, bound to Scan SHA-256 5f43c0cda1b23c3003e92cfbae8d33ea88ef213929eeed0aa0323c8cad047c6d and Fit SHA-256 9d8ba74c3c998c66fbabc6adc89599cf152ee20f0683cbbf17d2ead6cae25427, #134 HEAD fed367a7902e8c4c962e9a6bcd4f0ec16b401cf0. Never interpret this as permission to run the tests, inspect hosts, install anything or merge.
Source base: Stanislavikus/babypark-integration ONLY; PR #128 HEAD 565d8de08fbd8e85598e554cb91e59dfa4f8c1a4 / TREE 93b902754a56209a78b7765af1eab188b4d45bc0 / BASE(main) 0dfb9b0a1cfe23d455fd436ae9abeac626d0d729 / GOV blob e777fce4af8e8c3372f1f9de9ef7d00f786c2c89.

## 1. Immutable prepared source (Git blobs and UTF-8/LF/final-LF SHA-256)

- tests/fixtures/c6-stage-b-phase-a.mjs — SHA-256 f0654c96b009e5c429cf5b066c082b153460b646b6ca83ebfdf45b8147bf91b8; Git blob recorded in PR checkpoint after this batch commit.
- tests/fixtures/c6-stage-b-phase-a-holder.mjs — blob 31f148df079f7100b02bcddc1370aafef53f77e6, SHA-256 b66f02de1dafc6f00fc5a22044e943a0336cc2354ff056e26e5882814fa8572a.
- This manifest itself is evidence only. Its blob/digest and the PoC HEAD/TREE/BASE are reported after creation, not asserted by a self-referential file.

Scope: Native Node v24.20.0 and bundled SQLite 3.53.4; existing node:test, node:sqlite, node:perf_hooks, V1/V2 v4 store fixture patterns; no new runtime dependency or custom production code. Exactly nine Phase A SB groups. Isolated SQLite files, separate IPC-only lock-holder process, Unix-domain HTTP only, synthetic HMAC secret, invented metadata and no real Chatwoot/production network calls. All writable files belong under a newly created private scratch path. Group processes are spawned as their own process groups and have independently bounded timeouts. The harness verifies nonroot uid/gid 65534, 0700 scratch ownership, absence of IPv4/IPv6 external routes and exact Node/SQLite versions before admitting any group.

Evidence limitation: SB-01 verifies existing v4 semantics and a separate surrogate thenable guard/rollback, not the future one-transaction ingress. SB-02/03/04 record observable SQLite call time, errors and per-INSERT timings; SB-03 now uses 128 synthetic 4096-byte writes under measured-connection cache -64 and explicit spill ON/OFF read-back; this is a stress contrast, not proof of an internal SQLite spill site or proof that a reader survives until COMMIT. SB-04 specifies 2280 independent writable SQLite files, with 90 per light control and 10 per large control, randomized by a pinned seed. A single closed initialized DELETE-mode SQLite template is copied with native COPYFILE_EXCL into a new unique inode before each trial; each measured connection repeats PRAGMA readbacks. Each next holder.prepare acknowledges prior handle closure before the prior DB is unlinked. This reduces repeated schema initialization but does NOT prove target-host latency; internal SQLite retry/poll/EXCLUSIVE site identities are not proved just from observations. SB-10 tests pending-connect cancellation through a stub and local UDS no-header/body-stall/truncation, not the live Chatwoot REST boundary. A fast mocked GET is NOT native R_seq and finite synthetic samples are NOT hard production bounds. Future atomic ingress implementation, provider retry/HUMAN, whole C6 ING-1…ING-6 and B2 are still HALT.

## 2. Review-only time/priority plan

The following planning ranges are UNMEASURED estimates based on finite loop counts and fixture timer durations, not observed test-host performance, and must be reviewed before executable approval. Hard group caps and the 210s pre/post/cleanup reserve are exactly those in the approved Fit; no silent shortening, sampling reduction or skipped mandatory group.

| Priority | ID | Fixed source work | Unmeasured planning range | Hard group limit |
|---:|---|---|---:|---:|
| 1 | SB-00 | Two disposable DELETE DBs + readbacks | 1–5 s | 30 s |
| 2 | SB-01 | 90 existing v4 surrogate/duplicate/HUMAN + one thenable rollback case | 5–40 s | 120 s |
| 3 | SB-11 | Seven synthetic E_test=100ms guard branches + blocked SQLite counterexample | 1–10 s | 60 s |
| 4 | SB-10 | 5 hang/error classes ×10, 4 mock latency cells ×90, N=1/4 ×40 batches | 15–60 s | 120 s |
| 5 | SB-02 | 4 gaps ×3 busy timeout ×3 holds ×10 = 360 lock trials | 40–140 s | 180 s |
| 6 | SB-03 | 2 spill modes ×3 reader holds ×10 = 60 trials, 128×4096B synthetic writes; COMMIT/WRITE sites separated | UNMEASURED; prior 5–40 s may not apply | 120 s |
| 7 | SB-04 | 2 caches ×2 spill modes ×3 independent controls ×(90 one-row +90 eight-row +10 128-row) = 2280 trials; copies one CLOSED SQLite template using native fs COPYFILE_EXCL | UNMEASURED on target; Sonnet pre-optimization 69 s is not an authoritative host bound | 180 s |
| 8 | SB-08 | 10 high-timeout negative second-connection trials; measured timer overshoot, no target topology claim | 2–20 s UNMEASURED | 90 s |
| 9 | SB-09 | Body lengths 0/1/1MiB/1MiB+1, HMAC/slow/incomplete and 90 ordinary cases | 5–40 s | 90 s |
| | TOTAL | Group caps 990 s + reserve 210 s | Not validated against a host | 1200 s / 20 min |

Both local client and server operate on Unix-domain sockets. A lock-holder child executes read or write transaction holds of 0, 10 or 50 ms and inter-hold gaps of 0, 1, 5 or 20 ms, including repeated write acquisitions. The parent synchronously measures its own actual SQLite calls while the independent child can release its lock. No JS timer is claimed to interrupt a synchronous blocked DatabaseSync call. All future runtime thresholds are UNKNOWN regardless of simulated E_test=100ms, synthetic busy values or measured mock latencies.

## 3. Proposed future commands — NOT EXECUTABLE AUTHORITY

Host must first be positively proven to be babypark-catalog-rehearsal-fra1, NOT chatwoot-fra1-01. The approved exact PoC HEAD must be materialized into a root-owned, read-only fresh checkout at /opt/babypark-rehearsal/c6-stage-b-phase-a-ro/; this path is only a proposal and is NOT established as existing. Before ANY run, independently check its exact Git HEAD/TREE, the SHA-256 values above, owner-approved immutable Node binary hash 89af8424dd53e560b1933f87ba650d8bf57c83ca5a04600eefb31f416aabbae7, actual permissions, absence of inherited executable outputs, available memory ≥1.5 GiB, free scratch disk ≥1 GiB and catalog service health. No real production DB may be mounted.

Proposed one-time test-host namespace capability probe (future approval required); record UTC, exit code and sanitized stdout/stderr (including failures), then independently verify uid/gid and empty external route table:

~~~sh
/usr/bin/timeout --signal=TERM --kill-after=1s 6s \
  /usr/bin/unshare --net --fork --kill-child -- \
  /usr/bin/setpriv --reuid=65534 --regid=65534 --clear-groups --no-new-privs -- \
  /usr/bin/id -u
~~~

The proposed --kill-child option sends SIGKILL to the immediate forked child when unshare terminates; WITHOUT a separately approved PID namespace this does not guarantee cleanup of detached grandchildren. Both probe and run still require host-side process-identity-scoped residual verification after success, signal, timeout or failure. The above probe alone does NOT verify network routes; the approved operator must also capture /proc/net/route, /proc/net/ipv6_route and actual post-drop identity using a bounded, non-secret read-only command before any fixture. No fallback to host network, running as root, enabling user namespace or replacing failed tools is allowed.

Proposed command shape for Phase A, ONLY after distinct exact owner go-ahead and independently provisioned immutable checkout. Its shell scratch is newly created under /tmp after privilege drop; root only creates network namespace. Standard-output collection and redacted stderr/exit reporting need a separate approved evidence location before launch.

~~~sh
/usr/bin/timeout --signal=TERM --kill-after=5s 1200s \
  /usr/bin/unshare --net --fork --kill-child -- \
  /usr/bin/setpriv --reuid=65534 --regid=65534 --clear-groups --no-new-privs -- \
  /bin/sh -ceu '
    umask 077
    scratch=$(/usr/bin/mktemp -d /tmp/bp-c6-sb-a-XXXXXXXX)
    trap "/usr/bin/rm -rf -- \"\$scratch\"" EXIT
    /usr/bin/nice -n 10 \
      /opt/babypark-rehearsal/runtime/node-v24.20.0/bin/node --no-warnings \
      /opt/babypark-rehearsal/c6-stage-b-phase-a-ro/tests/fixtures/c6-stage-b-phase-a.mjs \
      --phase=A --scratch="$scratch"
  '
~~~

NOT YET RUNNABLE: after any attempt or external timeout, the *operator outside the child namespace* must perform a read-only scoped residual census, recording exit code and count (never raw argv/customer content). Proposed check (not authorization to run):

~~~sh
/usr/bin/pgrep -c -u 65534 -f '/opt/babypark-rehearsal/c6-stage-b-phase-a-ro/tests/fixtures/c6-stage-b-phase-a(-holder)?[.]mjs'
~~~

For this scoped check, exit 1 with count 0 is the only clean result; exit 0 (surviving matching PID) or any unexpected status is HALT. In the same owner-approved post-run inventory, record the exact retained `$scratch` path and enumerate campaign-owned `bp-c6-sb-a-*` group directories under **that exact parent only**, recording names/counts without viewing customer data or recursively deleting anything. If scratch no longer exists after normal cleanup, explicitly record ABSENT. If outer SIGKILL/timeout prevents capturing the exact scratch path or leaves unclassified ownership, HALT rather than probing or deleting unrelated `/tmp` content. Do not interpret a generic `pgrep -u 65534` match as campaign-owned, and do not use `pkill -u 65534`. If children/scratch remain after SIGKILL, record identity and obtain separate authorization for precise cgroup/PID-start-time-scoped cleanup; no blind kill or path-wide `rm -rf`. `--kill-child` is defense-in-depth, not proven total process-tree teardown. This proposed lifecycle change and full 2280-trial workload must be independently reviewed and included in a NEW exact owner run command approval.

NOT YET RUNNABLE: source checkout must be pinned to the PoC HEAD emitted after this authoring stage and rechecked by the reviewer. Group runner checks remaining elapsed wall time against each prospective group cap; the 210s reserve is shared across startup/IPC/cleanup and is NOT recharged before each group. The 1200s external hard timeout still bounds the total, so if overhead exhausts it a mandatory group must HALT rather than be skipped. Group runner has a 1200s aggregate allowance plus per-group timers; outer timeout is an independent stop. SIGTERM/SIGKILL may target only the newly spawned campaign process group, not any live host process. At preflight, teardown or executable checksum ambiguity: HALT, do not rerun or disable network restrictions. Capture raw synthetic JSON and its digest only after separately authorized execution. No B2/WAL Phase B code or run is authorized by this plan.

## 4. Sonnet 5.5 preliminary findings and batch remedy (not a gate closure)

Initial independent review on old HEAD 293bf6aa reported three BLOCKER (SB-11 Buffer vs Uint8Array; SB-04 connection-local PRAGMA missing; SB-03 false spill ON/OFF labels) and four SHOULD FIX (SB-04 control, SB-08 hardcoded observations, wall-reserve accounting, HALT group identity). This batch addresses the cited source mechanics together; no executable test or claim of successful verification has occurred on the new tree. New measured connections also read back connection-local synchronous=FULL; the initial database-creation connection does not establish this setting for a reopened handle. SB-03 spill trigger/internal exclusive site and actual COMMIT reader overlap remain explicitly UNPROVEN by timing alone. Potential SB-09 413 EPIPE/ECONNRESET remains a review item, not a silently accepted PASS. New group status remains UNVERIFIED.

Independent Sonnet re-review on old HEAD b2ad2c45 (TREE 5ea8f917) independently reports ZERO BLOCKER with B1–B3/S1–S4 closed in a NON-AUTHORIZING Node 22.22/SQLite 3.50.4 smoke (nine groups, ~63s whole phase, SB-09 repeated 15 times). Two SHOULD FIX: old SB-04 controlled sampling divided n=90/10 into three groups (30 or 3–4 each), and an outer SIGKILL can orphan detached group processes. This batch restores Fit's *per-control* n and adds defense-in-depth --kill-child plus mandatory scoped post-run census. The old smoke is not evidence for this NEW exact source, Node 24/SQLite 3.53, scratch bound, or host timing. A fresh exhaustive reviewer pass must verify all groups, 2280-cardinality, output-size cap, cleanup and wall limit; ZERO BLOCKER cannot be inherited from old HEAD.

### N5 — classified partial evidence (unverified new HEAD)

The independent Sonnet review on prior HEAD `5974c14b` found 0 BLOCKER and behaviourally confirmed N3/N4 in a NON-AUTHORIZING Node 22.22 / SQLite 3.50.4 synthetic smoke (~103s full Phase A, SB-04 ~62s). It identified SHOULD FIX N5: distinct reasons for failed group execution were collapsed into `GROUP_PROCESS_FAILED`. This source-only amendment attaches structured, strictly sanitized fields to GROUP failure objects, then returns them on catchable `PARTIAL_HALT`: `failure_kind` (TIMEOUT / EXIT / SIGNAL / OUTPUT_CAP / INVALID_RESULT), `exit_code` (integer or null), `signal` (whitelisted OS signal name or null), `group_halt_code` (`SB_A_HALT_[A-Z0-9_]` prefix with fixed max length, or null). An external SIGTERM reports SIGNAL/SIGTERM while preserving exit 143. The top-level `halt_code` and completed group evidence remain, and every partial result exits nonzero. Raw stderr/stdout, exception messages, paths, and PID are never included in these fields. For non-group startup/guard HALT, group fields are null rather than invented. The exit reason is not inferred from signal alone: output cap and timed-out child have priority over the TERM signal used to stop them. Uncatchable SIGKILL remains no final JSON / HALT/UNKNOWN.

**Fresh review probes:** late group normal nonzero EXIT, group cap TIMEOUT, output cap OUTPUT_CAP, explicit signal SIGNAL, invalid/partial JSON INVALID_RESULT, a fixture-thrown `SB_A_HALT_*` code, external SIGTERM, exact 2280-count, scratch lifecycle and no raw diagnostic leak. No smoke/test-host execution by the controller; old Sonnet results do not authorize this new HEAD.

### N3/N4 corrections — unverified new HEAD

Independent Sonnet review of old HEAD `13229bdc` verified ZERO BLOCKER and N1/N2 in a non-authorizing Node 22.22/SQLite 3.50.4 container smoke (all nine groups, ~108 s, 1.13 MB JSON, SB-04 ~69 s). That older pass found two SHOULD FIX: N3 repeated schema creation dominates SB-04's 2280 trials; N4 complete-group measurements were discarded if a later group HALTed.

N3 retains exactly 2280 independent trial DB paths and cache/spill/reader controls, while creating the schema once in a CLOSED DELETE-mode template and cloning with `fs.copyFileSync(..., fs.constants.COPYFILE_EXCL)`. The selected journal/cache PRAGMAs are still explicitly read back on each measurement connection; the unchanged 180s SB-04 cap and 1200s total are enforced without a guessed host performance gain.

N4 returns one structured `status:PARTIAL_HALT` JSON containing *only successfully validated completed groups*, `failed_or_incomplete_group`, `pending_group_ids`, a sanitized code and `not_a_pass:true`. Exit code is nonzero (143 on SIGTERM). This is never PASS, a resumable checkpoint or authorization to skip mandatory groups. Abrupt SIGKILL, host loss or outer timeout before process response cannot trigger application-level final JSON: absence of an intact final record is HALT/UNKNOWN, not inferred completion. The operator's separately authorized evidence collection must preserve stdout/stderr, exit code and scoped post-abort process census.

Both modifications require fresh independent complete-source review, exact SHA/tree verification and synthetic smoke including injected late-group failure, timeout, and SIGTERM; container timing is not target-host timing. **No Phase A approval issued.**

## 5. Independent review checklist and HALT

Review the exact two full source files and this manifest on one new PoC HEAD/tree/base, not merely the D1–D10 summary. Verify: the namespace is made BEFORE setpriv, no external TCP, UID/route refusal, no customer/secrets, scratch and fixture cleanup, parent/holder timers and process-group shutdown on timeout, negative no-header/body cases, no ignored Promise/thenable in test-only guard, no real Chatwoot request, no frozen main/PR128/PR134 changes, exact trial counts, per-group budgets, raw/sanitized evidence, and appropriate classification of every partial/unproven scenario. Any unexpected process, endpoint, fail-open result, stale ref, timeout, missing proven isolation, wrong journal/PRAGMA, incomplete data, unauthorized fixture execution, or evidence that the 20min cap cannot contain a mandatory grid => HALT and batch-report the independent root causes; do not weaken the gates or auto-retry.

No approved test-host execution has occurred; the earlier Sonnet smoke ran only in an isolated altered container and is explicitly non-authorizing. No server commands, package installations, C6 production code changes, public actions, or Git merge are authorized. This is a proposed review basis, NOT Stage B measurement PASS or permission to execute.
