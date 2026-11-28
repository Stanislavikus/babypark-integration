# BabyPark n8n 2.49.8 — STOCK-DEPLOY preflight record

**Status:** prepared for owner review; exact STOCK-DEPLOY GO is absent. No production write has occurred. This is a preflight record, not installation acceptance.

## Target and approved stock package

- Host: `chatwoot-fra1-01`; Ubuntu 24.04.4 LTS, x86_64, 2 vCPU, 4 GiB RAM.
- Product: official n8n 2.49.8, `docker.n8n.io/n8nio/n8n@sha256:9a83f64039070a846723cdf7d95b85db9ad1e6fadb38cad1ca12eceb04e04f33`.
- Database: independent official PostgreSQL 16.16, `postgres:16.16@sha256:ce81150802644ddfac1db4da9e63be6f2a3818aa6ee98a7a28838aeea65dc37a`. Existing Chatwoot PostgreSQL 16-main on loopback port 5432 is excluded.
- Terms: n8n Sustainable Use License v1.0 accepted by the owner for BabyPark internal use; no customer access to the editor or hosting. PostgreSQL License.
- Docker: official Engine and Compose plugin only; existing runbook minimums are Engine 28.0.0 and Compose 5.8.1. Actual target package versions remain uninstalled/unverified.

## Read-only host preflight

Captured 2026-11-28 UTC (host clock 14:57:59Z at the end of the check window):

- `MemTotal` 4,009,864 KiB (3,915 MiB); `MemAvailable` 1,872,948 KiB (1,829 MiB).
- Swap 2,097,148 KiB total, 695,956 KiB used (680 MiB). In the 3-second vmstat sample, the first interval showed 1 page in / 2 pages out; the next two showed 0/0. CPU idle was 85%, then 97%; load average was 0.01 / 0.04 / 0.00. Current CPU, memory and I/O PSI averages were 0.00.
- Root filesystem: 58 GiB free. cgroup v2 is present.
- Chatwoot web and worker services are active. Viber Gateway `babypark-integration-v2.service` is active. Existing PostgreSQL listens on loopback only.
- Docker CLI, daemon, default socket, n8n systemd units, and all proposed n8n host paths are absent.
- Chatwoot backup `/var/backups/chatwoot-upgrade-20261127T0932Z`: all six entries in `SHA256SUMS` verified PASS on 2026-11-28.
- Viber backup `/var/backups/babypark-integration/operations/viber-verified-after-repair-20261127T1351Z/bridge-verified.sqlite`: SHA-256 `adb990c19f312a7b11b81f7eaa73a8d7ae8c94d35248de3b5be821d3a1fef2a9` matches backup metadata; metadata reports SQLite integrity `ok`.

## Paths, secrets, rollback, and limits

Proposed paths (not created): `/opt/babypark-n8n`, `/var/lib/babypark-n8n/{user,postgres,restore-test}`, `/etc/babypark-n8n/n8n.env`, `/var/backups/babypark-n8n`, and host `tmpfs,noswap` at `/run/babypark-n8n-runtime`. The env file will contain separate `N8N_ENCRYPTION_KEY` and `POSTGRES_PASSWORD`; values must be generated on host and never committed or printed. Backup pairs the PostgreSQL dump, complete n8n user folder, and matching protected env/key file.

- n8n: 1,200 MiB / 1 CPU / container swap disabled. PostgreSQL: 512 MiB / 0.5 CPU / container swap disabled. UI binds only to `127.0.0.1:5678`; PostgreSQL has no published port; one internal Compose network; workflows OFF.
- Current canonical storage policy has 24 objects and no n8n registrations. The proposed stock-only change adds 13 planned objects before any path use.
- Combined cgroup caps are 1,712 MiB; current MemAvailable exceeds them by only 117 MiB. These are ceilings, not measured peaks, and do not prove that 4 GiB is sufficient. The live test must retain at least 1 GiB host `MemAvailable`.
- Stop only the n8n service/project if host `MemAvailable` falls below 1 GiB, any OOM or memory-limit event occurs, PSI/swap churn is sustained, PostgreSQL fails health, Chatwoot TTFB/health regresses repeatably, Viber health regresses, the tmpfs `noswap` gate fails, or a required network/socket gate is unverified. Capture actual cgroup `memory.current`, `memory.peak`, `memory.events`, host RAM/PSI/swap/CPU/I/O and same-route Chatwoot TTFB across image pull, initialization/migration, start, the single permitted PostgreSQL-backed import, restart, backup and restore.
- Rollback retains the n8n-specific PGDATA, user state, key, backup and evidence; restore only this project's pinned images/state. Never change Chatwoot/Viber or delete shared Docker/containerd data.
- No workflow import, secret generation, Docker installation, path creation, service start, or restore test occurred. The earlier SQLite import of 22 + 6 nodes is not repeated.

## Required owner decision

`STOCK-DEPLOY GO — n8n 2.49.8 + independent PostgreSQL 16.16 on chatwoot-fra1-01`: **ABSENT**.

The package is a draft and is not merged. STOCK-DEPLOY GO and merge GO remain distinct gates under the current Agreement.
