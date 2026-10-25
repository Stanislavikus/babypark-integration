# Chatwoot backup/recovery — conditional architecture fit and safe restore plan (2026-10-25)

Status: EVIDENCE — NON-NORMATIVE. Draft reference-only assessment, NOT production approval.
Applies to: BabyPark self-hosted Chatwoot v4.18.0 on `chatwoot-fra1-01`, backup/recovery planning only.
Supersedes: none.
Proposed campaign base: `1d5d8c00b7fdcdb54f37418ea60931c4292fd600`.
Governance: `main:docs/AI_WORKING_AGREEMENT.md` blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.
PRODUCTION IMPLEMENTATION: NONE.

## 1. Scope and architectural boundaries

The owner has activated paid DigitalOcean Daily Droplet Backups with seven-day provider rotation. This is **host disaster fallback**, not an application-consistent or verified restore. The proposed independent Layer B is official PostgreSQL `pg_dump` with self-managed encrypted off-host archive using maintained stock OSS (`restic` or `Kopia`) for completed dump, attachments and protected config, plus explicit Redis/Sidekiq recovery policy. Chatwoot remains sole customer transcript authority; no new customer-data read model or Chatwoot patch. No new customer-facing path, SMTP, AWS SES or email receiving rule.

The native `pg_dump/pg_restore` versions are installed; no new OSS tool installed. The actual deployed Chatwoot version must be independently reconfirmed at the activation cut. The encrypted destination has NOT been selected or authorized; using existing server storage for Knowledge does not imply permission for raw Chatwoot transcripts.

**Decision stage: REFERENCE only.** The alternatives scan `docs/CHATWOOT_BACKUP_ALTERNATIVES_SCAN_20261025.md` is a discovery draft, not the frozen hash-bound implementation decision. Before an `integrate` recommendation, freeze SHA-256 of the scan and this fit as UTF-8/LF/final newline, bind exact selected OSS/version/backend/license/billing/region/PII scope and obtain an explicit SHA-bound owner GO. Update scan if requirements/candidates change.

## 2. Layer A — observed current provider configuration

- DigitalOcean Droplet `597177915`, `fra1`. DigitalOcean account action `3496623668` (`enable_backups`) began **2026-10-25T21:14:34Z**, completed **21:14:35Z** for this Droplet. This directly explains the earlier read showing backups disabled versus the later read showing them enabled; neither observation was intrinsically erroneous. Live policy API: `backup_enabled=true`, `plan=daily`, `retention_period_days=7`, `window_length_hours=4`, first observed upcoming 2026-10-26 00:00–04:00 UTC. DO retains its window and backup lifecycle; **not proof any backup has finished**. The read-only DO user-image inventory returned no snapshot or backup of Droplet `597177915` at this checkpoint; the one listed snapshot belonged to another Droplet. Do not infer a completed backup image from `enable_backups`.
- No mutation of the provider backup policy in this campaign. Wait for completed recoverable backup image, independently inspect image ID and retention. Test restoration on an isolated target only after a separate cloud spend and customer-data handling authorization; no in-place production restore.
- This Layer A may be considered an additional rollback point only after image and dry-run restore proof; no statement that active PostgreSQL or Redis app-consistency is guaranteed.

## 3. Layer B — data coverage and precise unresolved items

| Data/capability | Tentative ready-made mechanism | Verification / STOP before backup activation |
| --- | --- | --- |
| Chatwoot database | Installed PostgreSQL `pg_dump`, `pg_restore`; archive only after successful completed logical dump | Exact PG cluster+role+DB/extension/encoding/migration version, permissions, reproducible scratch restore and Chatwoot model-level smoke |
| Uploads / ActiveStorage | Production `.env` key `ACTIVE_STORAGE_SERVICE=local`; Chatwoot's stock `storage.yml` local Disk root resolves to `/home/chatwoot/chatwoot/storage` | Path and provider **verified read-only**, ~72 KiB at checkpoint; prove whether any historical/external/auxiliary asset stores are in use, ensure object identity/attachment read after restore, synchronize file copy with DB cut, no customer content in logs |
| Config & encryption secrets | Live `.env`: `/home/chatwoot/chatwoot/.env`, mode `0600` (read-only stat); capture necessary service settings only inside authenticated encrypted backup; independent key custody | No secret values printed/stored in PR; owner-approved custodians, chmod/access, disaster recovery without sole live-server key |
| Redis / Sidekiq state | Redis live read-only configuration: RDB `save 3600 1 300 100 60 10000`, persistence directory `/var/lib/redis`, file `dump.rdb`; AOF **disabled** (`appendonly no`). | PG backup cannot atomically cover Redis; RDB can omit recent queue changes; verify queue/retry/scheduled/dead sets and ambiguous/replay sends, idempotency and reconciliation. Do not treat Redis as disposable cache without proving every Sidekiq side-effect safe |
| Storage transport | Official restic 0.19.1 or Kopia 0.23.1 as candidates, not installed | **Account/provider-independent** off-host recovery from loss/suspension of the whole DO account (e.g. separately controlled external account/provider), lawful region and privacy, access separation, provider terms/fee, bucket/SSH hardening, encryption/key custody, immutable/last-restorable copy; test read+restore without DO account |
| Rotation | Stock retention policy `forget/prune` or Kopia retention | First dry-run; preserve independently verified generation, required rollback history, customer deletion/retention legal review, deletion privileges separation; do not guess numbers |

No new integration-owned storage or job is authorized before `config/storage-policy.yaml`, `docs/INFRASTRUCTURE_REGISTRY.md`, and `docs/CURRENT_STATE.md` are updated in the relevant operational campaign with validated exact paths, ownership, retention and recovery status. Never modify registry to claim deployment during docs-only research.

## 4. Isolated end-to-end recovery test, future and not yet performed

1. Identify the exact immutable source release, database/asset/config paths, storage/queue semantics, backup versions and target; register non-secret inventory. Verify legal/privacy/access and required spend/storage terms before any off-host PII export.
2. Produce consistent completed PostgreSQL logical dump, collect matching asset/config state with a known cut/provenance, and encrypt immediately. Document expected differences/atomicity limits and prepare bounded reconciliation policy for cross-store race, Sidekiq callbacks and in-flight email messages. Do not stop/restart production to force a cut without a distinct deployment gate.
3. Verify encrypted backup and independent key recovery; seal manifest/checksum/provenance without customer-derived hashes in public PR. Backup ciphertext checksum may be recorded if it cannot expose customer-derived digest; restrict evidence to identifiers/status where possible.
4. Restore into an **isolated scratch environment** with no public routes, no outbound SMTP, no real webhooks, no production credentials/active Sidekiq and no contact to the live Chatwoot application. Check PG integrity, schema readiness, attachment availability, protected config and safe worker/queue semantics. Do not publish raw data or screenshots of customer chats.
5. Independently check restore success, set *measured* RPO/RTO and loss/replay limitations, record sanitized attestation. Verify end-to-end restore before calling the backup protective; operational recovery requires separate explicit owner go-ahead.
6. Only after owner-bound rollout, introduce official stock scheduling and verified retention; monitor last success/age, disk space, off-host replication and restore key availability. A failed backup or no verified recovery point alarms and **must not trigger destructive retention**.

## 5. Safety blockers and stop/go

- Backup policy ON ≠ completed backup ≠ verified restore. Provider snapshot cannot close app-consistency gate.
- Encrypted off-host destination and its fees, operator/customer-PII lawful basis, exact keys/permissions, retention and geo not yet selected/approved.
- No independent Redis/Sidekiq job consistency/replay proof; no credible zero-loss claim.
- No measured RPO/RTO, no real data export or isolated full restoration performed.
- No frozen implementation scan/fit hashes or owner exact-bound GO for new third-party backup service/storage.
- No final campaign tests, HEAVY R1 + context-isolated R2, zero-blocker gate or merge GO. PR #150 is a separate SES campaign with stale original base and must not be re-pinned or rewritten as part of this task.

### Exact implementation gate for future stage

Proposed outcome `reference`. A future implementation cannot start until alternatives scan and fit are materially complete/frozen, owner-go-ahead binds the exact digests and scope, target billing/data boundary is accepted, a scratch recovery plan protects public customer data, and independent final-tree review/verification closure requirements are satisfied. No automatic merge or live activation.

## 6. Independent read-only review reconciliation (2026-10-25; not a HEAVY gate)

An external reviewer (Sonnet) assessed the campaign summary but did not inspect PR #155. The factual objections and safety improvements were treated as preliminary review input, **not** independent final-tree ZERO BLOCKERS or merge evidence.

- Earlier backup-off and later backup-on observations reconcile to DO action `3496623668` at `2026-10-25T21:14:34–35Z`. No completed Chatwoot restore point or restore drill has been observed; Layer A image remains an OPEN gate.
- Explicitly require Layer B ciphertext and separately escrowed restore key to remain accessible **without** the original host **and** without access to the original DO account. A second VM or Spaces in the same DO account alone is not a sufficient independent-custody proof. No off-host destination/account/key configured or accepted yet.
- Read-only storage inventory has now confirmed native local ActiveStorage path `/home/chatwoot/chatwoot/storage`, not a guessed path; service-migration/legacy object coverage is still a separate verification item.
- Redis RDB is enabled, AOF disabled. Chatwoot's Sidekiq queues are a customer-operation recovery boundary, not something to waive as disposable cache. No RDB-to-PostgreSQL lossless cut has been shown.
- Require a **safe isolated restore** to prove that conversations, contacts and attachments are readable; no outbound email, webhook, live credentials, production worker, or route in the restoration sandbox. Positive Chatwoot business-object read verification is required, not merely `pg_restore` exit status.
- `pgBackRest`/`WAL-G` remain alternatives **deferred** due to added WAL/PITR operational burden and unknown recovery-point objective, not rejected purely because data volume is small. Record an explicit change-of-requirements trigger if future measured RPO requires PITR.
- No production mutation, PII export, backup snapshot creation, new storage expense, installation, review closure, or merge is authorized by this evidence correction.
