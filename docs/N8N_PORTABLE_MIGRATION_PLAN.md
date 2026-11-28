# BabyPark — portable n8n migration and upgrade plan

Status: HISTORICAL EVIDENCE — NON-NORMATIVE; its SQLite Release 2 implementation choice is superseded by the owner-selected PostgreSQL package in Draft PR #173, **not permission to deploy**.
Owner's placement decision confirmed 2026-11-27: **n8n must be co-located with Chatwoot**, first on `chatwoot-fra1-01`, later migrated together to the planned Hetzner host, where Odoo will also run. The separate DEV host is the source of the workflow candidates, not the target production placement. This placement choice supersedes any fallback recommendation elsewhere in this document to run n8n on a separate production VM; resizing the shared host as demand grows is preferred, with an isolated service lifecycle throughout.
Applies to: isolated n8n DEV → fresh production n8n deployment, Chatwoot AI First Line only.
Supersedes: the SQLite-backed Release 2 choice below, only for the 2026-11-28 Draft PR #173 package; use `docs/N8N_COHOST_FIT_NOTE_20261127.md`, `docs/N8N_COHOST_OPTIONS_SCAN_20261127.md`, and `docs/N8N_RELEASE_RUNBOOK_20261127.md` for the current PostgreSQL selection and release boundary.
Date: 2026-11-27 UTC. Owner requested server portability and safe future Chatwoot/n8n upgrades.
Canonical governing process: `Stanislavikus/babypark-integration/docs/AI_WORKING_AGREEMENT.md` from current `main`; base at proposal `2ae02a0ea8898f5d5b341fca6ed230a34fecce58`, agreement blob `e2d64856e85716d5c55e724e1babce441ae348ba`.

## Historical Release 2 implementation proposal — superseded

This section records the earlier SQLite candidate decision and its former fit/scan hashes. The owner has since rejected a session-only SQLite exception and selected an independent official PostgreSQL 16.16 service for Draft PR #173. The current PostgreSQL fit note, options scan and release runbook named above supersede the SQLite deployment details here. The earlier successful SQLite workflow import remains historical evidence and must not be repeated.

The candidate uses a separate bind-mounted user folder and key file, a unique Compose project network, and an n8n-only systemd unit. The container has no restart policy; the `Type=oneshot` systemd unit starts and stops the Compose service but does not supervise container health. Restart the n8n unit after a Docker daemon restart. This resolves the earlier generic “service restart policy” proposal in §3. No service is installed or enabled before a separate exact-basis `release GO`.

## 1. Invariants — portable means tested restore, not just Docker

- The n8n runtime, database, credentials, Compose deployment configuration and backups are independently owned; **do not** install it in `/home/chatwoot/chatwoot`, share Chatwoot's PostgreSQL schema, edit Chatwoot core, embed a new script into Chatwoot systemd units or couple Chatwoot upgrade/restart to n8n service lifecycle.
- Use only official n8n Docker images, documented Compose/CLI/API and supported systemd/host mount controls. No BabyPark-authored workflow runner or custom n8n code by default. A future Chatwoot release must not implicitly update n8n, and a future n8n release must not implicitly change Chatwoot/Viber.
- Fix exact n8n version **and immutable image digest** at every release; never `latest`, `stable` or floating major tags in deployed Compose. The same rule applies to an independently owned database image, if chosen. Keep the previous exact version and state snapshot for recovery.
- Persistent state is always explicit, documented, protected and portable: n8n user folder (encryption key, instance config), the selected **independent** database, exact workflow exports/IDs, non-secret environment template, and separately stored secret/credential source. Never store secrets, exported decrypted credentials, customer payloads or tokens in Git, README, logs or ordinary archives.
- **Chatwoot is the sole customer transcript authority.** No routine durable storage of raw/normalized customer message, PII, content-derived digest or attachment URL in n8n metadata, execution logs, SQLite/PostgreSQL, Docker logs, event bus or backups. Any unproven data path fails closed to HUMAN; do not activate workflows using real customer data until the exact n8n version and storage configuration pass synthetic sentinel checks.
- n8n execution bundles/event logs must use a verified ephemeral **host tmpfs `noswap`**, with a fail-closed service startup dependency that refuses to start if the mount is absent or has wrong options. The full persistent database and encryption key must NOT be on this tmpfs. A restart/reboot can lose active 45s waits; accepted DEV limitation is **not** a production liveness guarantee. HUMAN handoff/outage recovery must be separately demonstrated or bounded before customer activation.
- A migration or rollback is complete only after a **fresh, isolated restore rehearsal** and real service smoke: exact version, user configuration, encrypted credentials, workflow structure, assignment behavior, correct Chatwoot connection, no duplicate sends, bounded data retention and acceptable outage handling. Avoid running old and new n8n instances simultaneously with active copies of the same production webhook/workflows.

## 2. Verified starting point, not a production GO

- **DEV host** `babypark-catalog-rehearsal-fra1`: Docker container `bp-n8n-poc`, official image `docker.n8n.io/n8nio/n8n@sha256:aaa5cd750a76ba08d7611b15df2e3521122d5d7846b15648656ad0db704ce7b6`, **n8n v2.43.7**, local port `127.0.0.1:5678`, Docker memory=800 MiB with swap disabled; 128 MiB noswap tmpfs `/run/bp-n8n-poc-sensitive` bound to `/vol`. Existing DEV n8n instance and its database/credentials remain unchanged. No active customer workflows.
- Stage E DEV currently contains exactly identified candidate workflow IDs: **`bpAiSellerChatwootHandoffShadowNov23`**, main 22 nodes, export SHA-256 `7bcbb2b5dfb6a5e63209e4d163c42eeb04d95e6b513a159367ebe3cbeb963672` (9 nodes with credential references); **`bpAiSilenceWatchdogNov23`**, watchdog 6 nodes, export SHA-256 `18a1c9377236ed693420fc9f5f09351dab3e3f4fec80c06d2073866148c4cdec` (3 nodes with credential references). Both were **inactive** when exported via existing official n8n CLI on 2026-11-27. Export bytes were used only on a `noswap` DEV tmpfs and temporary exports removed; original DEV n8n 2.43.7 container remained running. This confirms candidate identity, **not** approval that TEMP / SYNTHETIC workflow definitions are safe to activate for customers. Do not import the separate 24-node temporary variant or old DEV database/credentials/history.
- Existing DEV Stage E synthetic evidence: public AI answer, native specialist handoff, private note, SKIP and silence watchdog PASS for n8n 2.43.7 / QA Chatwoot. This is **not** acceptance for n8n 2.49.8 / Chatwoot 4.20.1 in production.
- **Verified upstream on 2026-11-27:** n8n **2.49.8** stable (official GitHub release); 2.50.3 is prerelease. The official n8n 2.49.8 image was pulled and version-verified on rehearsal on 2026-11-27: **`docker.n8n.io/n8nio/n8n@sha256:9a83f64039070a846723cdf7d95b85db9ad1e6fadb38cad1ca12eceb04e04f33`**, CLI `n8n --version` = `2.49.8`; existing DEV 2.43.7 container ID and active status were unchanged. **Official image/version and both inactive workflow structural imports PASS on isolated 2.49.8. Functional execution, credential mapping and data-retention acceptance still pending.**
- **Owner-chosen production placement** `chatwoot-fra1-01`: Chatwoot 4.20.1 and separate Viber Gateway active. At 2026-11-27 14:07 UTC the 2-vCPU, ~4-GiB host showed **1,842 MiB MemAvailable**, ~740 MiB swap occupied, load average 0.00/0.04/0.04, 58 GiB free disk, no Docker installed. Owner reports current usage around **five chats per day** (reported workload, not a measured peak). The existing DEV n8n 2.43.7 container consumed about **290 MiB RSS/working memory** during observation, with a verified 800 MiB Docker limit and no container swap. This makes co-location technically plausible, not a guarantee of production peak suitability. **Do not substitute a separate production VM**: reserve n8n's CPU/RAM with independently scoped Compose limits, run a short bounded resource/response-time gate on the target and, if that fails, pause deployment and request owner approval to resize the **shared host** instead. No paid resize or additional VM authorized by this document.
- No Docker installation, migration, publication, production n8n port, credential copy, Chatwoot AgentBot rewiring or AI activation occurred in this evidence stage.

## 3. Official implementation choice and lifecycle

**Historical SQLite candidate:** the previous bounded package proposed the official n8n 2.49.8 image with SQLite under `/var/lib/babypark-n8n/user`, loopback-only port 5678 and a host `tmpfs,noswap` mount. The active Draft PR #173 package instead uses an independent official PostgreSQL 16.16 service with separate PGDATA; see the current fit note and release runbook. Target-kernel support and runtime behavior are not yet verified and remain release gates. The project uses its own Compose network and host bind paths; it does not share Chatwoot's database, Docker Compose project, systemd units or lifecycle. The 1,200-MiB limit is not a measured peak. Actual install, migration and startup measurements remain release gates.

**Historical decision superseded:** an earlier owner-approved candidate selected SQLite and recorded the old fit/scan hashes above. On 2026-11-28, the owner selected the official PostgreSQL backend and rejected a session-only SQLite exception. For the current PR #173 package, use only the independent PostgreSQL service, separate PGDATA, user folder, key and PostgreSQL backup/restore path in the current fit note and runbook. The Compose container has no automatic restart policy, and its systemd `Type=oneshot` unit does not supervise it. This bounded behavior is explicit in the release runbook; it must not be described as automatic recovery.

**Rejected coupling:** npm/RVM install inside Chatwoot app, shared Chatwoot database, Viber Gateway process, implicit upgrade scripts, unpinned `latest`, blindly copying DEV persistent SQLite or plaintext credential exports.

The current implementation fit and alternatives scan are being reissued once for the owner-selected PostgreSQL backend; their final exact SHA-256 values and owner `integrate` rebind are recorded in those artifacts. The earlier approval bound to the SQLite fit/scan does not authorize this materially revised backend. The owner accepted SUL v1.0 for internal-only use. Revalidate mutable license/package facts immediately before any release decision. No custom n8n production code is part of this package.

### 2026-11-27 — official 2.49.8 native import on offline rehearsal

- Re-exported and SHA-256-verified the exact **22-node main** and **6-node watchdog** from DEV v2.43.7. Official n8n `import:workflow` was run **sequentially** in a disposable 2.49.8 container with `--network none`, no real credentials, a random ephemeral test encryption key, and n8n state only on verified host `tmpfs,noswap`. DEV runtime and production remained unchanged.
- Native import **PASS** for both workflow IDs. The disposable n8n 2.49.8 SQLite database was inspected read-only: **2 workflow rows, 0 active, node counts [6, 22], `PRAGMA integrity_check=ok`**. Temporary test database and exported JSON deleted from tmpfs. This is import/structure PASS, **not** execution, customer data-retention proof, credential readiness or production activation.
- Fresh database migrations/import completed with a temporary **1,200 MiB RAM cap and swap disabled**; an earlier 800 MiB migration cap did not complete. Reserve a separate **install/migration peak**, never equate a steady-state ~290 MiB DEV observation to production peak requirements. The n8n 2.49.8 user-facing workflow tests remain pending.
- Docker's own `--tmpfs ... noswap` flag was rejected by this daemon; the proven working layout binds the separately mounted, verified **host tmpfs with `noswap`** into the container. Host mount availability and exact options must be a fail-closed startup precondition. This is portable through explicit host provisioning, not through reliance on Docker `--tmpfs noswap`.

## 4. Versioned directory/volume and identity boundary

Directory map reflects the current implementation candidate, not a claim these paths already exist:

```text
/opt/babypark-n8n/                      # independent Docker Compose project, only declarative config
  compose.yaml                         # versioned in canonical Git (no secrets)
  compose.restore.yaml                 # isolated synthetic restore override
  n8n.env.example                      # placeholder only; versioned in Git
/etc/babypark-n8n/n8n.env              # root-only 0600 key file, never Git
/var/lib/babypark-n8n/                  # separately declared durable state
  user/                                # independent n8n user folder and settings
  restore-test/                        # disposable synthetic restore target
/run/babypark-n8n-runtime/               # 128-MiB host tmpfs,noswap; NOT in durable backups
/var/backups/babypark-n8n/               # restricted local generations with matching key
/etc/systemd/system/                    # n8n-only unit and exact escaped mount unit
/var/backups/babypark-integration/operations/customizations/integrations/n8n/ # host handbook
```

Every writable class above is registered as `PLANNED` in `config/storage-policy.yaml` and `docs/INFRASTRUCTURE_REGISTRY.md` before use. Do not infer any production path exists until the separately authorized installation is observed. After release, update `docs/INFRASTRUCTURE_REGISTRY.md` and `docs/CURRENT_STATE.md` with observed identities and synchronize the server handbook with the released Git checksum.

## 5. Migration without importing old DEV baggage

1. Freeze canonical Git/Agreement, declared target capacity and two exact workflow candidates (names, IDs, node counts, SHA of export, version). Determine *which* 22-node primary and 6-node watchdog are authoritative; never import temporary Stage E test variants based on filename alone.
2. Stop/disable only temporary **DEV test triggers** if required; take protected consistent DEV backup as a recovery preimage, but **do not move its database/exec history/event logs/raw credentials wholesale into production**.
3. Bring up an **independent blank n8n 2.49.8** with a new persistent encryption key and its own empty official PostgreSQL 16.16 database. Keep editor/port private, no live webhooks, no Chatwoot API token and no published workflow.
4. Import the selected official n8n JSON workflows via supported UI/CLI, inactive by default. Handle credential references by creating **new production credentials through the official UI** or approved secure secret delivery; never copy legacy DEV keys or decrypt exports to durable plaintext. Map production Chatwoot 4.20.1 API endpoints/ownership explicitly, not a DEV Chatwoot host.
5. Repeat only the **specific** synthetic real-world end-to-end paths from DEV on this exact version and approved target environment: AI answer, native specialist handoff, private note, SKIP, 45s silence/watchdog and error-to-HUMAN. Capture synthetic sentinel persistence in the exact persistent volume, DB/WAL, event logs and Docker logs, checking storage mode `filesystem` + noswap tmpfs on the target version. If anything unknown, **do not activate**; no real customer data used.
6. Freeze a GOOD known `compose.yaml`, env-schema, image digests, workflow exports, encrypted-credential identity, storage manifest + SHA and a protected off-host backup. Rebuild from scratch on a separate isolated host/VM to prove PostgreSQL restore, including credential decryption **without printing secret values**, host/mount recreation and health. Only after independent owner GO connect production Chatwoot AgentBot/webhook and enable exact workflows with duplicate trigger guards.

## 6. Planned Hetzner move (Chatwoot + n8n + Odoo) and future host-to-host migration

The owner intends to consolidate **Chatwoot, the independent Viber Gateway, n8n and Odoo** on a future **Hetzner** server and then increase the shared host's CPU/RAM/storage as actual demand grows. Odoo is a future independently owned service; its runtime, addons, database and backup/restore requirements need their own bounded review and cannot be silently inferred from the n8n deployment. Do not create a new production n8n VM or move it independently at this stage. Preserve a clean service boundary so all three application families can share a host without sharing their code, credentials, application databases or rollout lifecycles.

- Export exact versions/digests, Compose definition, non-secret configuration, workflow exports/IDs and exact persistent volume/database backups **plus the encryption-key recovery secret** using approved encrypted transport. Never back up ephemeral n8n execution tmpfs as if it were durable state.
- Restore on a clean alternate VM with the **same pinned versions**; verify database schema consistency, credentials decryptability and published-state disabled. Recreate the `noswap` mount and fail-closed startup guard before starting. Compare workflow objects/IDs, required environment and HTTP status.
- Fence old instance's production webhooks/workflows before enabling new; repoint the dedicated n8n hostname/proxy or Chatwoot callback only at approved cutover, so exactly **one** instance can send to Chatwoot. Test with synthetic events and no duplicates; retain the old VM as passive rollback until owner sign-off.
- Rollback after n8n DB migration is **NOT** just `docker compose pull oldversion`: restore the corresponding **pre-upgrade database + n8n config/encryption key** as a unit, reconcile any accepted events, and require explicit owner recovery GO. Never run `docker compose down -v` on persistent business state.

## 7. Future upgrades (independent release boundaries)

1. Snapshot and verify recoverability and exact target image + migration notes. Inspect n8n's native Migration Report/official release notes.
2. Upgrade **only n8n Compose stack** during its maintenance window, leaving Chatwoot Web/Worker, PostgreSQL, Gateway, Nginx Viber hooks untouched.
3. Reconfirm native webhook and AI paths against the installed Chatwoot version, no durable customer payload and no double delivery; hold workflows unpublished if FAIL.
4. For Chatwoot upgrades, keep the n8n image/volumes/credentials unchanged; re-test n8n↔Chatwoot contract and previously released AgentBot/HUMAN handoff. No implicit redeployment or n8n source patch.
5. Each production launch/upgrade requires a host handbook update, protected backup/rollback and exact owner acceptance.

## 8. Explicit GO / NO-GO criteria

**Implementation decision:** owner `integrate` authorizes preparation of this bounded implementation PR only. Passing repository tests and independent implementation review do not authorize merge, Docker installation, or production service start.

**NO-GO to production installation until a separate exact-basis release GO:** verify Chatwoot/Viber backups and baseline, install Docker only from official packages without changing their configuration, test the target kernel's `tmpfs,noswap` positive/negative start behavior, measure actual n8n and PostgreSQL cgroup peaks/OOM and host reserve through install/migration/startup on the existing 4-GiB host, run the exact-version persistence sentinel and independent PostgreSQL/key/dummy-credential restore, inspect Docker key-bearing metadata access, and confirm unchanged Chatwoot/Viber health. The package's Compose/storage declarations and static checks do not satisfy these target runtime gates. Do not change the placement to a separate VM or increase RAM without separate owner approval.

**NO-GO to real customer AI until separately owner-approved:** exact synthetic functional paths PASS on version and environment, no customer payload persistence, Chatwoot ownership/semantic/handoff safeguards and actual recovery constraints accepted, monitored HUMAN fallback, and frozen complete deployment/rollback evidence.

References: official n8n self-hosting/Compose, backup/restore and CLI documentation; existing DEV Stage E report `/opt/bp-ai-handoff-native-poc-20261123/owner-approval-20261123/stageE-tmpfs-dev-20261124/STAGE_E_TMPFS_NATIVE_DEV_VERIFICATION_20261124.md`; source `docs/AI_FIRST_LINE_DESIGN.md`, `docs/AI_FIRST_LINE_ACCEPTANCE.md`, `config/storage-policy.yaml` and `docs/INFRASTRUCTURE_REGISTRY.md`.
