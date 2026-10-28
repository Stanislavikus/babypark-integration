# BabyPark SES Receiving — KMS DLQ Phase 2K alternatives scan (2026-10-25)

Status: EVIDENCE — NON-NORMATIVE; not an AWS write authorization.
Applies to: **inactive only** conversion of existing SQS SNS-delivery recovery candidate from SSE-SQS to vendor-documented SSE-KMS with exactly one customer-managed symmetric KMS key in eu-central-1.
Supersedes: none.
Repository: Stanislavikus/babypark-integration exclusively. Canonical main 1d5d8c00b7fdcdb54f37418ea60931c4292fd600; Agreement blob e777fce4af8e8c3372f1f9de9ef7d00f786c2c89. Existing campaign PR #150 (old pinned base f3d92325e6b4ef04f0137c4c49dde07c05731bbe; no automatic repin/merge).
Research checkpoint (UTC): 2026-10-25.

## Existing state and requirements

- AWS account 763345000395, eu-central-1. Live KMS ListKeys returned zero; custom aliases none. Existing SQS Standard queue `arn:aws:sqs:eu-central-1:763345000395:babypark-chatwoot-website-sns-dlq` has `SqsManagedSseEnabled=true`, no KMS key, four-day retention (345600s), 0 messages, one queue policy statement allowing `sns.amazonaws.com` SendMessage only from exact `arn:aws:sns:eu-central-1:763345000395:babypark-chatwoot-website-inbound` and SourceAccount. SNS topic has zero subscriptions. SES receipt rule set inactive/rule disabled. Existing S3/Chatwoot DNS and staff SMTP untouched.
- Hard requirements: same account/region SNS+SQS; no receipt/MX/HTTPS subscription/Chatwoot activation or real/synthetic customer data. Only vendor AWS KMS/SQS config; no custom apps or Chatwoot patches, getmail6 excluded. Narrow service-principal cryptographic rights and owner-admin recovery. No KMS credentials, IAM long-term keys, unrelated principal or broad customer-data exposure. Preserve queue ARN, S3 lifecycle, empty state and SNS disabled. Document actual key ID, policy, cost, rollback/recovery before later go-live.
- Commercial budget: one **customer-managed** AWS KMS symmetric key costs **$1/month pro rated hourly** plus possible API fees, with 20,000 standard requests/month KMS Free Tier (eligibility depends on usage/account); rotations can add monthly cost. Owner must approve this metered recurring cost explicitly before creation.

## Official AWS discovery and source matrix

Discovery paths/queries: AWS SNS subscription DeadLetterQueue encryption custom KMS; AWS SQS KMS event-source permissions; SNS encrypted SQS SNS principal kms permissions; AWS KMS pricing key storage; SQS SetQueueAttributes change SSE-SQS to SSE-KMS; SNS DLQ retry, retention and recovery.

- https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html — SNS encrypted subscription DLQ note requires customer-managed KMS and access for SNS service principal; subscription-level RedrivePolicy, not topic-level. Also recommends DLQ retention up to 14 days.
- https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-key-management.html — AWS services as SQS event sources require customer-managed KMS key; after key change old messages require their historical key (currently queue EMPTY).
- https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-least-privilege-policy.html — SNS service `kms:Decrypt`, `kms:GenerateDataKey` with `aws:SourceAccount` scoped to current account. Separately account admin and later named consumers with decrypt, not an anonymous/wildcard application principal.
- https://docs.aws.amazon.com/sns/latest/dg/sns-enable-encryption-for-topic-sqs-queue-subscriptions.html — symmetric key and SNS access.
- https://docs.aws.amazon.com/cli/latest/reference/sqs/set-queue-attributes.html — only ONE queue encryption mode; KmsMasterKeyId / SqsManagedSseEnabled; attribute propagation may take ~60s.
- https://aws.amazon.com/kms/pricing/ — $1/month per customer-managed KMS key, pro rata, plus API usage; first two automatic/on-demand rotations have additional recurring price.
- https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html — SNS DLQ only protects delivery failures before recipient HTTP acknowledgement.

## Alternatives, explicit disposition

- (A) Existing SSE-SQS (no customer KMS): native and no key monthly fee; AWS documents custom key for encrypted SNS DLQ, does not document SSE-SQS exception. **UNPROVEN** for required SNS-delivery recovery; do NOT claim failure occurred without attempted E2E.
- (B) Existing Standard SQS + single customer-managed symmetric regional KMS key: native vendor documented setup, estimated key ~$1/mo plus usage. **PREFERRED**, provided key policy, SSE transition, consumer/replay scope and later synthetic verification.
- (C) Unencrypted SQS: avoids KMS but stores SES email-routing metadata; **FAIL** customer-PII/privacy baseline without exceptional approval. Not chosen.
- (D) No DLQ, only 14-day S3: SNS discard and no automatic notification/reconciliation; **FAIL** reliable pre-ack delivery recovery.
- (E) Own bridge/Lambda/new runtime solely to save $1: unnecessary new code/service/cost; **FAIL** Integration-first.
- (F) Additional Sonnet review solely about SSE-SQS exception: no new normative proof unless a real provider test; **DEFER** as uneconomic for $1/month. Not part of production HEAVY review.

**Decision:** one AWS customer KMS CMK for existing queue is the conservative documented option, but this scan does NOT authorize creation. Phase 2K fit SHA and fresh explicit owner approval needed. Do not invoke synthetic AWS messaging blocked by tool safety checks; do not bypass via other tools.
