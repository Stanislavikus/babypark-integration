# Chatwoot backup — AWS S3 independent custody preflight, 2026-10-25

Status: EVIDENCE — NON-NORMATIVE. HISTORICAL candidate comparison; subsequent owner preference prioritizes single-provider DO Spaces. NOT approval to transfer customer data or incur costs.
Applies to: BabyPark production Chatwoot 4.18.0 backup/recovery research, Draft PR #155; separate from SES PR #150.
Supersedes: none.
Repository: `Stanislavikus/babypark-integration`; canonical base `1d5d8c00b7fdcdb54f37418ea60931c4292fd600`; Agreement `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.
PRODUCTION IMPLEMENTATION: NONE. No backup export, S3 creation/change, config change, restic installation, worker restart or PR merge in this research.

## A. Confirmed AWS state (read-only, 2026-10-25 UTC)

- `s3:ListBuckets` returned **one bucket**, assigned to the **SES email-receiving** flow; there is **no separate Chatwoot backup S3 bucket** in the listed AWS account.
- Existing SES bucket `GetBucketLocation`: `eu-central-1`; `GetBucketEncryption`: `AES256` (SSE-S3); `GetPublicAccessBlock`: all four block flags true; `GetBucketVersioning`: no enabled status returned; `GetBucketLifecycleConfiguration`: one rule, contents/policy **not inspected**; `GetObjectLockConfiguration`: configuration not found. These are NOT properties of a proposed new bucket.
- SES receipt bucket must not be reused as a Chatwoot backup target: different data scope, deletion rules, least privilege and service purpose. No existing S3 data was listed, read or changed.
- `pricing:GetProducts` query: service `AmazonS3`, location `EU (Frankfurt)`, `productFamily=Storage`, `storageClass=General Purpose`; SKU `NRYRNCXF5TWHB476`, `EUC1-TimedStorage-ByteHrs`, first 50 TB/month **USD 0.0245 per GB-month**. Illustrations for storage only: 10 GB-month ≈ $0.245; 100 GB-month ≈ $2.45. PUT/GET/DELETE/LIST requests, data retrieval/egress, any replication/KMS/retained versions, legal terms/tax not included. Actual backup bytes and monthly costs NOT measured; do not choose retention from estimates.

## B. Candidate options — safety/effort decision matrix

| Criterion | Dedicated AWS S3 Standard bucket, separate account from DO | Independent, separately administered SFTP server | DO Spaces in same DO account |
| --- | --- | --- | --- |
| Survive loss of Droplet AND DO account | CONDITIONAL PASS: prove AWS access, MFA, recovery & billing independent | CONDITIONAL PASS: must independently verify host, account and access | FAIL for whole DO account loss |
| Official restic destination | PASS (native S3 backend) | PASS (native SFTP backend) | PASS backend only, but failure domain inadequate |
| Encryption / independent key custody | PASS only when restic client encryption + separately recoverable password/key demonstrated | Same | Same, plus DO account limitation |
| Guard against malicious deletion / retention correctness | PARTIAL: separate principals/delete authority, tested recovery and lifecycle; Object Lock not a drop-in substitute | PARTIAL: server admin, append-only/write separation and restore rights need evidence | FAIL as sole independent custody |
| Legal/customer-data policy | UNVERIFIED: dedicated EU bucket, access logging, DPA, retention, controller/operator approval needed | UNVERIFIED: region/owner/hosting/data control | UNVERIFIED, AND wrong failure domain |
| Cost/operations | PARTIAL: metered GB, requests, restore/egress, access and recovery drills; no minimum storage commitment | PARTIAL: server cost, disks, patching, monitoring, SSH access | Paid and tied to original DO account |
| Provisional research priority at *this historical AWS-focused scan* | Previously preferred; superseded by owner simplicity preference, now optional hardening | Remains viable only if owner wants independent provider | **Current preferred operational-simplicity research candidate**; same-account loss is an explicit residual risk, not an undisclosed PASS |

Additional plausible candidate: a separately administered S3-compatible provider other than AWS/DO, with verified official restic compatibility and lawful data residency. Not assessed sufficiently to claim exclusion. Existing `server2181.babypark.ua` already holds *other* backups, but independent account/custody and customer-conversation PII approval are not proven and cannot be assumed.

## C. Important security and recovery distinctions

1. **Restic encrypts before sending.** S3 SSE-S3 is also enabled by default for new objects, but is not a substitute for restic's independent password or a recovery escrow. Restic's own docs say losing that password irreversibly loses access to archived data.
2. **S3 Object Lock != compatible native rotation.** `restic forget` and `prune` delete or repack repository objects; S3 Object Lock/version retention can block physical deletion, retain accumulating versions and disrupt/pricily complicate prune. No blanket WORM on a mutable restic repo without complete non-production compatibility, restore and lifecycle tests. Option for separately sealed immutable completed checkpoint is an *alternative for research*, not an already proven design.
3. **Backup writer != deletion/recovery administrator.** Least-privilege production upload scope and separately controlled destructive/restore access; owner can decrypt and restore even after entire DO account loss. Test genuine restore using independently recovered password, not only a key present on production.
4. **Recovery test:** isolated environment with public routing, outbound SMTP/webhooks and Sidekiq workers disabled; PostgreSQL, contacts, conversations and local `/home/chatwoot/chatwoot/storage` attachments successfully readable from archive; ensure no accidental external messages, duplicate job execution or leaked private data. Redis RDB/AOF/Sidekiq queue reconciliation remains an independent proof obligation.
5. **Provider Daily backup != proven restore.** Confirm actual image after first DO window and test isolated restoration only with separately approved resources. Layer B must remain off the live Droplet and independently encrypted; same-account loss remains uncovered by DO-only design and requires transparent owner risk acceptance, not an invented mandatory external-provider policy.

## D. Reproducible reference paths and remaining STOP gates

Sources: AWS Pricing API `GetProducts`, S3 `ListBuckets`, metadata `GetBucketLocation/Encryption/Versioning/PublicAccessBlock/LifecycleConfiguration/ObjectLockConfiguration`; https://aws.amazon.com/s3/pricing/ ; https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html ; https://docs.aws.amazon.com/AmazonS3/latest/userguide/serv-side-encryption.html ; https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html ; https://restic.readthedocs.io/en/stable/060_forget.html .

OPEN: exact target/account independence + credentials access; S3 user/IAM separation (no backup IAM role or bucket yet); realistic size and billed requests; region/privacy/legal retention; isolated restore key custody; preservation of last verified recovery generation and protection from writer compromise; compatibility with scheduled/pruned restic repositories; reproducible restore proof; exact frozen scan+fit digests, owner-bound fit GO, exact-tree HEAVY verification. No source supports declaring a production fit.

**Recommendation: reference.** This document captures why AWS S3 was investigated. **Subsequent owner feedback explicitly prioritizes operational simplicity and reuse of DigitalOcean.** The new research priority is DO Spaces Standard plus stock restic/pg_dump; AWS S3 becomes an optional future account-failure-domain resilience upgrade. Neither choice has final paid/PII configuration permission. Continue bounded architecture-fit under Agreement §§1–3 and keep production untouched.

## E. Owner simplification correction — retain evidence, reverse preference

The initial assessment overweighted total loss of a DigitalOcean account compared with the owner's stated constraint: reducing operational load and the number of accounts/services to monitor. The initial AWS recommendation was **not** a normative or owner-approved requirement. No separate AWS S3 backup bucket should be created under this research decision. Existing AWS work for SES remains separate.

The preferred **research-only** option is DigitalOcean Spaces Standard (official quoted base $5/month including 250 GiB, capacity/egress policy still to be verified) alongside the already-enabled DO Daily Droplet Backup. Official documentation: https://docs.digitalocean.com/products/spaces/details/pricing/ and https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/ . Client-side restic encryption protects copied data, but the backup and provider image remain subject to the same DO account suspension/compromise risk. This limitation must not be obscured by terminology such as 'off-host' or 'two backups'. Restore password should be held away from the live Droplet, and restoration must be proven independently, using only approved isolated resources.

Remaining questions (no production GO): ensure Spaces can support chosen stock restic backend, assess object deletion privileges and rotation, verify backup contents, legal/PII/data-region scope, actual charge and available capacity, demonstrate safe Sidekiq reconciliation and Chatwoot restore, then obtain Agreement-bound owner approval. This research checkpoint adds **zero new resources or infrastructure costs**.
