# Worker / Grok — independent n8n 2.49.8 co-host install gates

Status: EVIDENCE — NON-NORMATIVE / TASK, NO PRODUCTION INSTALL AUTHORIZATION.
Applies to: exact release 2 only (official clean inactive n8n 2.49.8 on existing `chatwoot-fra1-01` beside Chatwoot 4.20.1 and Viber Gateway).
Supersedes: none.
Date: 2026-11-27.
Owner decision: same-server co-location now; later migrate Chatwoot+n8n+Odoo to Hetzner; independent lifecycle and backups; scale shared-host resources with demand.

## Worker bounded assignment

Use **only** canonical repo `Stanislavikus/babypark-integration`; at the start list `docs/` fresh and read the current canonical `main` `docs/AI_WORKING_AGREEMENT.md` (previous basis `2ae02a0ea8898f5d5b341fca6ed230a34fecce58`, Agreement blob `e2d64856e85716d5c55e724e1babce441ae348ba`; revalidate immediately).

Read the candidate docs from Draft PR #173:
- `docs/N8N_PORTABLE_MIGRATION_PLAN.md`
- `docs/N8N_COHOST_OPTIONS_SCAN_20261127.md` — frozen UTF-8/LF/final-newline SHA-256 `4b636047c76e5842c551ad93e59e03af857b1b19a6629c5d80efcd9eedf1bda7`
- `docs/N8N_COHOST_FIT_NOTE_DRAFT_20261127.md`.

**No production modifications in this assignment.** Do not install Docker/n8n, alter Chatwoot/Viber, use real customer messages, copy DEV credentials/SQLite/history, create public routes or turn on customer AI. Do not let a successful n8n CLI import stand in for full functional/retention acceptance. Never print tokens, credential content or actual customer messages.

### 1. Check the evidence without redoing finished work

Known verified:
- Official stable n8n v2.49.8, image `docker.n8n.io/n8nio/n8n@sha256:9a83f64039070a846723cdf7d95b85db9ad1e6fadb38cad1ca12eceb04e04f33`.
- Exact DEV 2.43.7 inactive source workflows: `bpAiSellerChatwootHandoffShadowNov23` 22 nodes, export SHA `7bcbb2b5dfb6a5e63209e4d163c42eeb04d95e6b513a159367ebe3cbeb963672`, and `bpAiSilenceWatchdogNov23` 6 nodes, SHA `18a1c9377236ed693420fc9f5f09351dab3e3f4fec80c06d2073866148c4cdec`. Both officially imported **sequentially** into a clean offline 2.49.8 DB; DB shows exactly 2 rows/0 active, node counts [6,22], SQLite integrity ok. Do **not** repeat this proof absent contrary evidence.
- DEV 2.43.7 synthetic Stage E `tmpfs,noswap` persistence proof was PASS for tested paths; it does NOT certify 2.49.8. Docker's `--tmpfs ... noswap` option is rejected by the DEV daemon; a verified host `tmpfs,noswap` bind is the stock working approach.
- Target host 2vCPU/~4GiB, ~1.85GiB MemAvailable, 739MiB swap used, load near zero, disk free 58GiB, no Docker. Chatwoot/Viber services active, API HTTP 200. Current workload reported by owner ~5 chats/day.
- DEV n8n idle 290MiB within 800MiB cap; fresh 2.49.8 native migrations require separate **up to 1200MiB** cap without swap, not a proven steady state.
- Scratch artificial `ManualTrigger→Set` fixture import returned native error in first test (manually fabricated JSON may be invalid). Investigate its **format** before treating this as version incompatibility. Do not alter the two known-good source workflows or run them with real credentials.

### 2. Complete the still-open version-specific requirements (synthetic only)

A. Using official n8n 2.49.8 CLI/UI and a valid native synthetic workflow fixture, test normal/error/manual/wait execution data and eventbus/bundle under the exact environment variables:
`N8N_EXECUTION_DATA_STORAGE_MODE=filesystem`, `N8N_STORAGE_PATH=/vol/storage`, `N8N_EVENTBUS_LOGWRITER_LOGFULLPATH=/vol/events/n8nEventLog.log`, `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`, `EXECUTIONS_DATA_SAVE_ON_ERROR=none`, `EXECUTIONS_DATA_SAVE_ON_PROGRESS=false` (verify exact 2.49.8 variable names), and no real credentials. Use a verified host `tmpfs,noswap` for `/vol`, while intentionally keeping a separate synthetic DB on a protected ordinary disk to detect accidental durable text. Use only a synthetic sentinel, never customer text. Scan SQLite main/WAL/SHM, event logs and Docker JSON logs for sentinel. Test that the systemd-controlled service *refuses to start* when the required noswap mount is absent; do not restart the old DEV container or change unrelated systemd units.

B. Confirm official n8n 2.49.8 native backup/restore, including SQLite consistency and preservation/decryption of the test encryption key, on a **clean isolated instance**; do not export existing DEV credentials into production. Prove no simultaneously active production webhooks in the proposed migration. Compare SQLite vs separate PostgreSQL under the **same shared-host memory limit** and exact two-workflow concurrency; recommend one stock option, not a custom connector.

C. Read-only shared-host headroom: verify sustained/worst observed memory and CPU/load/PSI, disk, swap-in/out, and Chatwoot latency baseline from prod. Estimate Compose daemon/PG/n8n migration peaks independently of idle; propose explicit cgroup MemoryMax, CPUQuota, swap=0 and host/DB OS reserve. If unproven or insufficient, **NO-GO and propose enlarging the shared host**; never choose a separate production n8n VM contrary to owner decision. Do not execute load generators against actual customers.

D. Confirm official n8n internal-use Community SUL restriction, mutable licensing terms, fully native API/SDK/Compose support; no extra paid features for the exact 22+6 nodes. Refresh actual alternatives scan if a material fact differs; compare Chatwoot native, existing n8n, Activepieces CE v0.94.0 (MIT core), Node-RED v5.0.10 (Apache-2.0) and no-custom-code rule.

E. Design the **new** n8n-only persistent writable classes in `config/storage-policy.yaml` and recovery inventory, with independent paths `/opt/babypark-n8n`, `/var/lib/babypark-n8n`, `/run/babypark-n8n-sensitive`, protected `/var/backups/babypark-integration/operations/n8n`, plus any Docker-managed writable class. **Do not create these on production yet.** Keep `docs/CURRENT_STATE.md` and `docs/INFRASTRUCTURE_REGISTRY.md` in the exact bounded release proposal.

### 3. Required result and limits

Return a concrete matrix:
`invariant → exact official artifact/version → verified native test and immutable result digest → PASS/FAIL/UNVERIFIED → recovery/rollback → persistent-state impact`.
Continue beyond the first finding and cluster independent root causes. Every BLOCKER needs trace, violated Agreement/frozen invariant, minimal stock correction and regression test. Avoid writing custom production code, patching Chatwoot core or running a new model-vulnerability investigation. If any mandatory field remains unknown, say **NO-GO** rather than infer success.

Prepare a single bounded Git implementation PR **only after** a frozen, complete architecture fit/alternatives scan and exact SHA-bound owner pre-code permission under Agreement §3. Any `config/**` change requires final-HEAD root `npm test`, exact base-scoped `git diff --check`, full §6 traceability and §7 HEAVY independently isolated exhaustive review/confirmation. **No merge and no production deployment without exact owner go-ahead.**

**This assignment ends at evidence and release readiness, not automatic install.** When a complete fit is proven, provide the exact normalized fit-note SHA-256 and single owner decision `integrate` for explicit authorization.
