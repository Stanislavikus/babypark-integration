# BabyPark n8n — Worker continuation: prove 4 GiB co-location before requesting resize

Status: EVIDENCE / bounded task — NON-NORMATIVE, no production deployment permission.
Applies to: bounded implementation and release-gate preparation for inactive n8n 2.49.8 on `chatwoot-fra1-01`.
Supersedes: none.
Date: 2026-11-27. Repository: only `Stanislavikus/babypark-integration`.
Owner decision: **keep the existing 4 GiB Chatwoot host for now; prove an actual insufficient headroom before proposing a shared-host RAM increase. n8n must co-locate with Chatwoot; never propose a separate n8n production VM.**

## Source of truth and baseline

At start, list `docs/` fresh, read current canonical `main` `docs/AI_WORKING_AGREEMENT.md` and validate the campaign base/HEAD/tree before any Git change. The previous `main` was `2ae02a0ea8898f5d5b341fca6ed230a34fecce58`, Agreement blob `e2d64856e85716d5c55e724e1babce441ae348ba`. The predecessor Worker evidence is Draft PR [#173](https://github.com/Stanislavikus/babypark-integration/pull/173), report `docs/N8N_COHOST_WORKER_RESULT_20261127.md` at HEAD `3fff502df07c33bfbbf10c6da534375a0427a3d0`, with sidecar `docs/N8N_COHOST_WORKER_RESULT_20261127.sha256`. Read its full matrix before proceeding; do not replace it with earlier recollections.

Other inputs in the same draft branch:
- `docs/N8N_PORTABLE_MIGRATION_PLAN.md`;
- `docs/N8N_COHOST_OPTIONS_SCAN_20261127.md` (frozen alternatives-scan SHA-256 `4b636047c76e5842c551ad93e59e03af857b1b19a6629c5d80efcd9eedf1bda7`);
- `docs/N8N_COHOST_FIT_NOTE_DRAFT_20261127.md`;
- `docs/N8N_COHOST_WORKER_TASK_20261127.md`.

**Do not repeat prior PASS:** official n8n 2.49.8 image identity (digest `sha256:9a83f64039070a846723cdf7d95b85db9ad1e6fadb38cad1ca12eceb04e04f33`), native clean import of **exactly two inactive** workflows (22 and 6 nodes), export hashes, existing DEV `tmpfs,noswap` presence. Existing DEV 2.43.7 container stays untouched.

## A. Correct the memory decision: measure *usage*, not cap

The old report compared a successful **1,200 MiB container limit** with the historical minimum **1,269 MiB `MemAvailable`**. This comparison alone **does not establish 1,200 MiB peak usage or a mandatory 6 GiB server**. Equally, the owner's ~5 chats/day and idle DEV n8n ~290 MiB **do not prove** safe co-location.

On production do **read-only, bounded, low-impact** measurements: `MemAvailable` distribution / worst observed during representative hours, swap-in/out rate (not just occupied swap), memory PSI, CPU/load and I/O wait, RSS/cgroup pressure of Chatwoot Web/Worker and independent Viber, disk, and sampled uncached/cached Chatwoot health/request latency without excessive traffic. Record snapshot timestamps, sampling periods, low/high watermarks and whether a 1+ GiB safety reserve is realistic. **Do not run Docker, Docker installation, n8n, synthetic load, package upgrades or service restarts on production in this task.** Stop read-only probes on performance regression.

On an **isolated existing rehearsal environment with objectively adequate current capacity**, measure the *actual* official n8n **2.49.8** container `memory.current`, `memory.peak`, container OOM/kills, host `MemAvailable`, memory PSI, disk/swap and runtime startup plus **cold first SQLite migration/import** under a 1,200–1,536 MiB memory limit and swap disabled. Distinguish `limit`, `actual peak`, `steady state`, and native initial schema migration. Capture sustained startup after import with both workflows inactive. **Do not reimport/revalidate the previously accepted node definitions unless this exact workload is essential to measure the peak; never repeat node-content research.** Separate Docker daemon overhead from n8n RSS. Do not run this rehearsal on the current overloaded DEV when it fails the prior Worker resource gates; no purchase/new paid VM without owner permission. If rehearsal capacity is unavailable, report a narrow measurement blocker and executable safe plan, **not a guessed 6 GiB requirement**.

Output an evidence-based **4 GiB GO/NO-GO for a *bounded inactive co-host install*** with explicit memory/time budget and a no-swap cgroup. If measured peaks plus Chatwoot/Viber/OS reserve overlap or swap churn/latency worsens, state NO-GO and recommend a shared-host resize. Otherwise do not block merely because the container **limit** exceeds worst historical `MemAvailable`.

## B. Finish the remaining portable/native tests (synthetic only)

Use exactly the pinned 2.49.8 official image and **official n8n CLI/config/examples**; no custom production code, no Chatwoot core patch, no additional customer data paths.

1. Use a **valid official CLI/UI-exported synthetic fixture**, not the previously hand-constructed JSON which failed import. Test normal, error, manual and bounded-wait execution where applicable; record whether the version's stock execution controls (`EXECUTIONS_DATA_SAVE_ON_SUCCESS`, `EXECUTIONS_DATA_SAVE_ON_ERROR`, `EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS`, `EXECUTIONS_DATA_SAVE_ON_PROGRESS`, `N8N_EXECUTION_DATA_STORAGE_MODE`, `N8N_STORAGE_PATH`, `N8N_EVENTBUS_LOGWRITER_LOGFULLPATH`) actually keep synthetic sentinel out of **durable SQLite/WAL/SHM, backed-up user folder, event logs and Docker logs**. Do not print sentinel payload or secret in output; report aggregate scan results only.
2. Verify the **host-mounted** `tmpfs,noswap` layout works with n8n 2.49.8. Confirm a native systemd unit plus exact `.mount` dependency **fails closed** without the mount and starts with it; use an isolated n8n-specific service/mount, never existing DEV or Chatwoot/Viber services. Docker-native `--tmpfs ... noswap` had been rejected; do not silently substitute swap-capable tmpfs.
3. Prove **independent backup and clean restore** of the same-version user folder, consistent SQLite database and *dummy* encryption key; verify dummy credential decryptability on isolated destination without revealing its plaintext. Record checksums, `PRAGMA integrity_check`, workflow counts, permissions and recovery time. Separate durable database/key from ephemeral execution tmpfs.
4. Prefer the **stock n8n SQLite** layout for the owner-approved small, two-inactive-workflow installation if restore/concurrency/memory fit is proven. Only add a standalone PostgreSQL benchmark if a specific material SQLite weakness makes its choice unsafe/unsupported; do not introduce a second DB merely for theoretical comparison or share Chatwoot's PostgreSQL.
5. If either stock n8n 2.49.8 cannot meet no-persistence/noswap requirements or official recovery fails, report precise vendor-owned residual and bounded supported options under Agreement §7.3; do not write a custom replacement.

**Scope distinction:** Release 2 installs **inactive n8n without production credentials, public UI, Chatwoot hooks or real messages**. Release 3 (customer AI) requires its own tested normal/error/wait privacy controls and explicit owner authorization. Do not incorrectly mark Release 2 customer-data-safe merely because workflows are inactive; record untested Release 3 separately. The owner wants future move to Hetzner with Chatwoot+Odoo, not a second production VM now.

## C. Finish Git-ready release package, not a production rollout

Complete the existing Draft PR #173 fit and alternatives trace from actual new evidence. Freeze the normalized UTF-8/LF/final-newline **complete architecture fit note** SHA-256; update a materially changed alternatives scan and its digest if needed. Keep stock official internal-use **n8n Sustainable Use License** limits explicit, with owner-facing acceptance of internal use.

After the required exact-SHA `integrate` owner authorization **before config/implementation work** under Agreement §3, prepare one bounded **implementation PR** on the validated canonical base:
- official pinned `compose.yaml` and `.env.example` (no secrets), private loopback-only editor, stock host `tmpfs,noswap` mount/systemd gate;
- **register every new writable class in `config/storage-policy.yaml` before first production write**; update `docs/INFRASTRUCTURE_REGISTRY.md`, `docs/CURRENT_STATE.md` with staged vs actually deployed identifiers accurately;
- independent n8n-only restore/upgrade/rollback instructions, backup schedule and encrypted secret handling, no copy of DEV DB/credentials/history;
- actual 2.49.8 official-image digest and validated no-swap/memory caps. Keep Chatwoot and Viber releases and upgrade processes unchanged.
Run mandated verification `npm test` for `config/**` and base-scoped `git diff --check`, traceability matrix, exact HEAD/tree/base and exhaustive independent gating review (HEAVY if so classified). **No merge and no production install before required owner GO**. Do not patch an in-flight reviewer tree.

## D. Required output and escalation

Provide **one concise blocker inventory** (continue past the first) with `invariant → actual evidence/measurement + source SHA → PASS/FAIL/UNVERIFIED → minimal stock remedy → regression test → allowed next action`. Explicitly distinguish:
- **4 GiB capacity feasibility** for a protected inactive install;
- independent n8n 2.49.8 **backup/restore/credential recovery**;
- exact-version execution-data persistence;
- **Git/approval** gate.

If all applicable **Release 2** technical checks PASS, output the **complete frozen fit-note SHA-256** and exactly one bounded recommendation **`integrate`**, then request the owner's specific SHA-bound authorization. If 4 GiB is demonstrably insufficient, show the **measured peak and reserve shortfall**, request shared-server RAM increase, and do not propose a separate production n8n VM.

**At the end of this assignment production must remain unchanged**. No network-facing n8n endpoint, no real credentials, no production Docker install, no Chatwoot/Viber restart, no customer workflow activation or automatic merge.
