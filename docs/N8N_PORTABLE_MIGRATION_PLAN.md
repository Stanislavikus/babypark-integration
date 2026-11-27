# BabyPark — portable n8n migration and upgrade plan

Status: EVIDENCE — NON-NORMATIVE / PROPOSED operational plan, **not permission to deploy**.
Applies to: isolated n8n DEV → fresh production n8n deployment, Chatwoot AI First Line only.
Supersedes: none.
Date: 2026-11-27 UTC. Owner requested server portability and safe future Chatwoot/n8n upgrades.
Canonical governing process: `Stanislavikus/babypark-integration/docs/AI_WORKING_AGREEMENT.md` from current `main`; base at proposal `2ae02a0ea8898f5d5b341fca6ed230a34fecce58`, agreement blob `e2d64856e85716d5c55e724e1babce441ae348ba`.

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
- Stage E DEV documented a restored **22-node primary workflow** and an inactive **6-node watchdog**, alongside **temporary 24-node** signed/synthetic test variants. The correct production candidates are **not assumed** to be those temporary JSON files. Read current DEV workflow IDs and use only verified, exact exports; no blind import of all old DEV database, credentials, execution history or event logs.
- Existing DEV Stage E synthetic evidence: public AI answer, native specialist handoff, private note, SKIP and silence watchdog PASS for n8n 2.43.7 / QA Chatwoot. This is **not** acceptance for n8n 2.49.8 / Chatwoot 4.20.1 in production.
- **Verified upstream on 2026-11-27:** n8n **2.49.8** stable (official GitHub release); 2.50.3 is prerelease. The official n8n 2.49.8 image was pulled and version-verified on rehearsal on 2026-11-27: **`docker.n8n.io/n8nio/n8n@sha256:9a83f64039070a846723cdf7d95b85db9ad1e6fadb38cad1ca12eceb04e04f33`**, CLI `n8n --version` = `2.49.8`; existing DEV 2.43.7 container ID and active status were unchanged. **Image availability/version PASS is not a workflow-import, tmpfs or customer-facing execution PASS.**
- **Proposed production host** `chatwoot-fra1-01`: Chatwoot 4.20.1 and separate Viber Gateway active. At 2026-11-27 13:55 UTC RAM MemAvailable approximately **1,832 MiB**, swap already in use ~**741 MiB**, 58 GiB disk free, no Docker installed; HTTP traffic real. **This is insufficient evidence for a zero-impact n8n deployment.** Run a bounded peak resource/CPU/memory/swap/load gate first; if headroom is inadequate use a separate small n8n VM with the **same portable stack**, rather than compromise Chatwoot/Viber. No permission to resize/pay for a new resource inferred.
- No Docker installation, migration, publication, production n8n port, credential copy, Chatwoot AgentBot rewiring or AI activation occurred in this evidence stage.

## 3. Official implementation choice and lifecycle

**Preferred design conditional on fit:** dedicated Docker Compose project for n8n, with independent managed database and n8n user-data storage, private loopback interface only until owner approves TLS/Access; no shared Chatwoot/Viber service or restart. Prefer the official maintained `n8n-io/n8n-hosting` `withPostgres` example for sustained production, with image digests fixed and only the needed services. PostgreSQL, if chosen, must have its **own container/data volume**, never Chatwoot's database. Avoid new AI Assistant sandbox, SearXNG and privileged helper services unless the two workflows actually need them.

**Small-footprint alternative:** official single-container n8n with default SQLite has simpler one-volume recovery and smaller resource use, but must be independently assessed against 24/7 workflow load and SQLite failure/backup behavior; official documentation recommends PostgreSQL for installations doing more than a handful of ongoing workflows/users. Do not choose default SQLite automatically merely to get n8n running on a 4 GiB Chatwoot host.

**Rejected coupling:** npm/RVM install inside Chatwoot app, shared Chatwoot database, Viber Gateway process, implicit upgrade scripts, unpinned `latest`, blindly copying DEV persistent SQLite or plaintext credential exports.

Before selecting this stage's deployable configuration, refresh and freeze a **new alternatives scan + SHA-256** under Agreement §1 with Chatwoot native, existing DEV n8n stock functions, official n8n Compose with SQLite/Postgres, maintained free tools such as Activepieces/Node-RED where relevant, and any owner-named candidate. Licensing: n8n community uses Sustainable Use License; independently confirm permitted BabyPark internal use and actual third-party/paid terms. No custom production code until official fit has been exhausted.

## 4. Versioned directory/volume and identity boundary

Directory map is a **proposal**, not a claim these paths exist:

```text
/opt/babypark-n8n/                      # independent Docker Compose project, only declarative config
  compose.yaml                         # versioned in canonical Git (no secrets)
  .env.example                         # versioned schema, no secret values
  .env                                 # root-only 0600 local values, never Git
  README.md                            # exact deploy / upgrade / restore runbook
/var/lib/babypark-n8n/                  # separately declared persistent volume(s)
  n8n-user/                            # .n8n config, encryption-key identity
  postgres/                            # only if official dedicated PG selected
/run/babypark-n8n-sensitive/            # noswap tmpfs only; NOT included in durable backups
/var/backups/babypark-integration/operations/n8n/   # restricted, timestamped checksummed backups
/var/backups/babypark-integration/operations/customizations/integrations/n8n/ # host handbook
```

Choose actual Compose volume and mount paths at review; never assume a Docker named volume is backed by these directories unless independently verified. Register every persistent class in `config/storage-policy.yaml` **before first production use**, including backup/retention/recovery owners; update `docs/INFRASTRUCTURE_REGISTRY.md` and `docs/CURRENT_STATE.md` with observed production identities in same approved campaign. Keep host handbook and Git release/checkpoint IDs in sync after launch.

## 5. Migration without importing old DEV baggage

1. Freeze canonical Git/Agreement, declared target capacity and two exact workflow candidates (names, IDs, node counts, SHA of export, version). Determine *which* 22-node primary and 6-node watchdog are authoritative; never import temporary Stage E test variants based on filename alone.
2. Stop/disable only temporary **DEV test triggers** if required; take protected consistent DEV backup as a recovery preimage, but **do not move its database/exec history/event logs/raw credentials wholesale into production**.
3. Bring up an **independent blank n8n 2.49.8** with a new persistent encryption key and its own empty database. Keep editor/port private, no live webhooks, no Chatwoot API token and no published workflow.
4. Import the selected official n8n JSON workflows via supported UI/CLI, inactive by default. Handle credential references by creating **new production credentials through the official UI** or approved secure secret delivery; never copy legacy DEV keys or decrypt exports to durable plaintext. Map production Chatwoot 4.20.1 API endpoints/ownership explicitly, not a DEV Chatwoot host.
5. Repeat only the **specific** synthetic real-world end-to-end paths from DEV on this exact version and approved target environment: AI answer, native specialist handoff, private note, SKIP, 45s silence/watchdog and error-to-HUMAN. Capture synthetic sentinel persistence in the exact persistent volume, DB/WAL, event logs and Docker logs, checking storage mode `filesystem` + noswap tmpfs on the target version. If anything unknown, **do not activate**; no real customer data used.
6. Freeze a GOOD known `compose.yaml`, env-schema, image digests, workflow exports, encrypted-credential identity, storage manifest + SHA and a protected off-host backup. Rebuild from scratch on a separate isolated host/VM to prove restore, including credential decryption **without printing secret values**, host/mount recreation and health. Only after independent owner GO connect production Chatwoot AgentBot/webhook and enable exact workflows with duplicate trigger guards.

## 6. Future host-to-host migration (always rehearsal first)

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

**GO to isolated deployment rehearsal (not customer activation):** validated target official image/digest, reviewed independent Compose and storage-policy declaration, acceptable peak resource margin, verified backup/restore approach, supported n8n 2.49.8 native workflow import, secret isolation and immutable workflow provenance.

**NO-GO to production installation for now:** no measured production peak-resource margin; no Docker on proposed host; image digest pinned for n8n 2.49.8, but its final Compose/environment/dependency set and any database image digest are not yet frozen; no exact 2.49.8 workflow compatibility/storage re-test; new persistent storage classes not yet declared on canonical Git; no final independently reviewed production release gate. These are bounded missing evidence, not a recommendation for a custom rewrite.

**NO-GO to real customer AI until separately owner-approved:** exact synthetic functional paths PASS on version and environment, no customer payload persistence, Chatwoot ownership/semantic/handoff safeguards and actual recovery constraints accepted, monitored HUMAN fallback, and frozen complete deployment/rollback evidence.

References: official n8n self-hosting/Compose, backup/restore and CLI documentation; existing DEV Stage E report `/opt/bp-ai-handoff-native-poc-20261123/owner-approval-20261123/stageE-tmpfs-dev-20261124/STAGE_E_TMPFS_NATIVE_DEV_VERIFICATION_20261124.md`; source `docs/AI_FIRST_LINE_DESIGN.md`, `docs/AI_FIRST_LINE_ACCEPTANCE.md`, `config/storage-policy.yaml` and `docs/INFRASTRUCTURE_REGISTRY.md`.
