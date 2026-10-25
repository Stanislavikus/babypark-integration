# Chatwoot production recovery — bounded alternatives scan (2026-10-25)

Status: EVIDENCE — NON-NORMATIVE; reference-only, not production activation authority.
Applies to: existing self-hosted BabyPark Chatwoot v4.18.0 on DigitalOcean Droplet `chatwoot-fra1-01`; independent backup/recovery campaign only.
Supersedes: none.
UTC scan checkpoint: 2026-10-25T21:48:25Z.
Repository: `Stanislavikus/babypark-integration` only.
Canonical target/base: `1d5d8c00b7fdcdb54f37418ea60931c4292fd600`.
Governance: `main:docs/AI_WORKING_AGREEMENT.md`, Git blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.
PRODUCTION IMPLEMENTATION: NONE. No install, backup export, retention cleanup, new infrastructure or production change is authorized by this document.

## 1. Frozen-for-research requirements and boundaries

R1. Preserve real customer Chatwoot conversations (PostgreSQL), local attachments/ActiveStorage and protected configuration; independently classify Redis/Sidekiq queued, scheduled, retry/dead jobs and data loss/reconciliation tolerance. Chatwoot remains transcript authority.
R2. Layer A: retain the owner's already-enabled DigitalOcean **Daily** Droplet Backup, seven-day provider rotation, as whole-host fallback; DO image is NOT application-consistency/restore proof.
R3. Layer B: create a distinct application-consistent PostgreSQL logical backup and matching asset/configuration state; encrypted off-host custody and independently proved non-destructive scratch restore. No production restore during validation.
R4. Minimize PII/secret exposure: never copy raw customer messages or secrets into Git, comments, logs or user chat; restrict off-host storage location, operators, access, encryption/key escrow and deletion; perform lawful retention/privacy review before raw-customer backup.
R5. Native/provider/maintained free OSS before custom; official installation/config/SDK/adapters only. No Chatwoot core patch, no custom production script or connector by default.
R6. A selected retention policy must rotate only validated recoverable generations, preserve last verified restore point and required rollback state, start as dry-run; storage-policy declaration/registry/current-state updates before any integration-owned production writable storage class.
R7. Verify recovery on a physically/logically isolated scratch target, including PostgreSQL restore, Chatwoot attachment read, service configuration equivalence (without exposing values) and Redis queue consistency/reconciliation. Define measured RPO/RTO after test, not guessed.
R8. No changes to SES PR #150, public Email Continuity, AWS receiving/DNS, Chatwoot web/worker, buyer traffic or customer-facing runtime as part of this docs-only stage.
R9. Any external storage/service terms, exact capacity/billing, retention, region, subprocessor/privacy, keys and backup deletion authority require separate exact-digest owner fit approval; existing hosting other workloads does not authorize new customer backup data.

## 2. Current observed environment (read-only, not a backup PASS)

- DO API Droplet ID `597177915`, Frankfurt fra1, `s-2vcpu-4gb-amd`, 2 vCPU/4 GiB/80 GiB disk, nominal $28/month. User enabled `backup_enabled=true`, plan `daily`, `retention_period_days=7`, four-hour window `2026-10-26T00:00–04:00Z` first scheduled. Provider fee estimate 30% = $8.40/month; actual invoice not verified. A scheduled image is not yet a completed image or restore proof.
- Read-only host command: Chatwoot web + worker, PostgreSQL and Redis all `active`. `pg_dump`, `pg_restore`, `redis-cli` available. `restic`, `kopia`, `borg`, `pgbackrest`, `wal-g`, `rclone` not installed. Root filesystem 77 GiB total, 59 GiB available at inspection; directories checked by aggregate size only. No credentials, content, row data or database dumps accessed.
- Existing DigitalOcean backup API now indicates policy enabled; there is **no evidence of a completed restore-tested PostgreSQL+assets+Redis backup**. Asset source path and ActiveStorage backend must be independently confirmed from current config; do not assume the small `/home/chatwoot/chatwoot/storage` directory is the whole footprint.
- Source authority: official Chatwoot backup guide names PostgreSQL, storage/uploads and environment/configuration; Redis additionally holds Sidekiq work and must be evaluated for preservation and reconciliation in this installation.

## 3. Reproducible discovery paths and named candidates

Queries/sources consulted as of this checkpoint:
- Official Chatwoot guide: https://developers.chatwoot.com/self-hosted/deployment/backup and mirrored https://chatwoot.xyd.dev/self-hosted/deployment/backup — database, asset storage, env and restore workflow.
- Official DO: https://docs.digitalocean.com/products/backups/getting-started/quickstart/ ; https://docs.digitalocean.com/products/backups/details/limits/ ; https://www.digitalocean.com/products/backups — daily rotation, backup consistency limits, pricing; live Droplet backup-policy read.
- GitHub releases/repo metadata: https://github.com/restic/restic ; https://github.com/kopia/kopia ; https://github.com/borgbackup/borg ; https://github.com/pgbackrest/pgbackrest ; https://github.com/wal-g/wal-g (read as candidates, not installed).
- Project guides: https://restic.net/ ; https://github.com/restic/restic/blob/master/doc/060_forget.rst ; https://kopia.io/docs/ ; https://kopia.io/docs/faqs/ ; https://github.com/borgbackup/borg/blob/master/README.rst ; https://pgbackrest.org/ .
- Search phrases: "Chatwoot backup PostgreSQL local ActiveStorage env", "DigitalOcean daily backups retention consistency", "restic encrypted backups retention prune S3", "Kopia encrypted snapshot policy", "Borg SSH backup encryption prune", "pgBackRest PostgreSQL physical backup WAL".
- Repository legacy `docs/INFRASTRUCTURE_REGISTRY.md`, `docs/CURRENT_STATE.md`, `docs/DATA_RETENTION.md`, `config/storage-policy.yaml` are background state/evidence subject to Agreement §2 classification, not inferred production approval.

## 4. Candidate matrix: PASS / PARTIAL / FAIL per requirement

`PASS` denotes capability evidence, **not** blanket production fit. All candidates must still pass R1–R9 together.

| Candidate / exact public identity | License / current maintenance | DB consistency | Assets/config | Encryption/off-host + rotation | Recovery burden / disposition |
| --- | --- | --- | --- | --- | --- |
| Native DO Daily Droplet Backup — current enabled policy | Commercial provider, priced at ~30% of Droplet; DO-operated | PARTIAL (online image, active DB I/O limitation) | PASS whole boot disk only; attached volumes excluded | PARTIAL (7-day automatic retention; DO says backups not encrypted at rest, externally inaccessible) | PASS whole-host recreation path; **keep existing layer A, not sufficient for R3** |
| PostgreSQL 16 `pg_dump` + `pg_restore`, installed | PostgreSQL core, open-source PostgreSQL License; native | PASS transactionally consistent logical DB snapshot on completed successful dump | FAIL for uploads and `.env`; must pair with separately verified assets/config | FAIL alone; requires transport/encryption/rotation solution | LOW implementation burden; **preferred DB primitive candidate**, not a complete backup product |
| restic `v0.19.1` (release 2026-07-05) | BSD-2-Clause, active upstream October 2026, free commercially | PARTIAL: captures output of completed native `pg_dump`, not live DB directory directly | PASS files/config when safely staged | PASS encrypted incremental off-host repository, explicit `forget` + `prune` with dry-run; target billing/immutability UNRESOLVED | LOW–MEDIUM: official CLI, stock timer/config; **plausible layer B**, pending full external storage fit |
| Kopia `v0.23.1` (release 2026-06-16) | Apache-2.0, active upstream, free commercially | PARTIAL: same native dump prerequisite | PASS file snapshots | PASS encryption/remote repositories/retention, backend unspecified | MEDIUM: policy/tooling choices and recoverability test; **viable alternative**, no exclusion without bounded benchmark |
| BorgBackup `1.4.5` (release 2026-07-18) | BSD-3-Clause, active upstream, free commercially | PARTIAL: same native dump prerequisite | PASS file archives | PASS encryption/prune; SSH remote/Borg target may increase operator burden | MEDIUM–HIGH with separate SSH destination; **conditional alternative** |
| pgBackRest (maintained free PostgreSQL MIT project) | MIT; version/compatible binary not frozen on host | PASS physical PostgreSQL backup/WAL/PITR when properly configured | FAIL alone for assets/config/Redis | PARTIAL: repository, encryption/retention require selection | Higher complexity for small single instance, potential option if RPO/PITR measured requirements demand it; **defer, not rejected** |
| WAL-G (maintained OSS) | License/version/dependencies not frozen at this checkpoint | PARTIAL pending exact binary/PG fit | FAIL alone for assets/config/Redis | PARTIAL pending backend/keys and WAL/archive integration | **Evidence gap: no recommendation to integrate now** |
| Existing BabyPark encrypted SQLite backup implementation | Implemented for other store, not Chatwoot/PostgreSQL | FAIL: does not back up this DB | FAIL: no demonstrated Chatwoot restore primitive | PARTIAL: other workload proof not transferable | **NOT a proven repository step-2 fit**; do not reuse assumptions from unrelated stores |
| A new custom BabyPark backup connector | No demonstrated need | UNPROVEN | UNPROVEN | UNPROVEN | **REJECT custom-by-default** until all ready paths demonstrably fail, then separate explicit owner decision |

External destination choices (not silently selected): protected existing `server2181.babypark.ua` SSH target (existing Knowledge backup != Chatwoot PII approval); DigitalOcean Spaces (paid S3-compatible object storage, region/price/immutability not accepted); AWS S3 (new commercial/privacy/keys/region scope, AWS SES sandbox irrelevant to S3 capability). A local-only restic repository on the same Droplet FAILS the off-host criterion. No storage target is frozen or provisioned.

## 5. Known independent STOP classes before production Layer B

BKP-B1: latest completed provider backup and **recovery** proof absent; checking `backup_enabled=true` is not proof that restoration works.
BKP-B2: exact Postgres DB/service identity, current ActiveStorage backend, installation root, `.env` secret custody and shared file consistency unverified; independent non-destructive data-shape inventory required.
BKP-B3: matching Redis/Sidekiq `queue`/`retry`/`scheduled`/`dead` persistence/reconciliation and cross-store cut unresolved; no claim of atomic PostgreSQL+Redis consistency.
BKP-B4: external ciphertext destination, locality, lawfulness, customer PII/key operator access, disaster recovery key custody, storage billing and deletion control unapproved.
BKP-B5: retention durations/RPO/RTO are not measured and owner-approved; automatic prune cannot delete last verified point or open rollback artifacts.
BKP-B6: new backup staging/storage writable classes and schedule/rotation do not yet have `config/storage-policy.yaml` declaration and reviewed deployment gate, with same-slice registry and operational state updates.
BKP-B7: isolated scratch restore with PostgreSQL+assets+config and side-effect-safe queue handling NOT tested; nothing is yet recoverable by proof.
BKP-B8: frozen fit SHA binding, owner specific go-ahead for new external product/storage+PII scope, exact-tree HEAVY R1/R2 and final deployment approval absent.

## 6. Research-only outcome

**Recommendation: reference** — keep owner-enabled DO Daily layer A, retain `pg_dump/pg_restore` as ready native DB primitive, advance *restic versus Kopia* as the bounded OSS evidence candidates for encryption/rotation only after destination/PII/restore requirements are pinned. Do not treat installed software, vendor docs or the owner agreement to the high-level plan as permission to export customer data, create billable storage, install packages or restart a production service.

No custom production code. No merge/deploy. This research result does not authorize a next production-code or configuration stage to skip a fresh alternatives scan and exact-digest architecture-fit approval.
