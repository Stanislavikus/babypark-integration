# BabyPark SES Receiving — SNS→SSE-SQS DLQ synthetic end-to-end result (2026-10-25)

Status: EVIDENCE — NON-NORMATIVE, operational result; does not authorize live SNS HTTPS/SES incoming or sending.
Applies to: one isolated AWS-managed SNS subscriber failure to SQS Dead-Letter Queue demonstration. No customer data.
Supersedes: prior **UNPROVEN** assessment of whether SSE-SQS can receive failed SNS deliveries. Does not supersede any frozen requirements or act as a production-readiness certificate.
Repository: Stanislavikus/babypark-integration ONLY; existing Draft PR #150, fixed campaign base `f3d92325e6b4ef04f0137c4c49dde07c05731bbe`.
Governance basis freshly read: canonical main `1d5d8c00b7fdcdb54f37418ea60931c4292fd600`, Agreement blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.
**Owner authorization**: chat confirmation of exact test fit SHA-256 `765243fb0ddb9772a01e608a7222b525e9d2cd0eb54f26f3357b5d94690b13f4` (scan SHA-256 `a6e5cad6a166b226ea23ba291f70cd673350a020ee4835a62c30c922ac475756`). One-message synthetic AWS PoC only, not prod activation.

## Test design, actual actions, evidence

AWS account `763345000395`, region `eu-central-1`. Source SNS topic `arn:aws:sns:eu-central-1:763345000395:babypark-chatwoot-website-inbound`. Existing recovery DLQ `arn:aws:sqs:eu-central-1:763345000395:babypark-chatwoot-website-sns-dlq`: Standard SQS, **SSE-SQS** (`SqsManagedSseEnabled=true`), **no KMS key**; message retention remains 4 days. Existing DLQ queue policy allows `sns.amazonaws.com` `sqs:SendMessage` only for exact topic/source account.

- **Preflight 2026-10-25T08:11:53Z PASS**: account correct; only existing DLQ; 0 SNS subscriptions; no active SES receipt rule set; `website-reply-uuid` rule disabled; S3 0 objects, DLQ empty, no KMS keys; IAM S3 reader still without credentials.
- **Temporary primary created**: `arn:aws:sqs:eu-central-1:763345000395:babypark-chatwoot-sns-dlq-proof-primary-20261025`, Standard/SSE-SQS, empty. Exact SQS resource policy had one explicit Deny `sqs:SendMessage` from `sns.amazonaws.com` conditioned on topic ARN/account, intentionally generating a permanent subscriber-side authorization error. Did not modify existing recovery DLQ queue policy/encryption.
- **Temporary SNS subscription** `arn:aws:sns:eu-central-1:763345000395:babypark-chatwoot-website-inbound:9e9f8c9f-8226-46be-9404-d44afc9f1788`: protocol `sqs` pointing at temporary primary queue; `RedrivePolicy.deadLetterTargetArn` pointed to existing SSE-SQS recovery DLQ; synthetic test attribute filter `bp_test_only=20261025_sse_sqs_proof`. Readback verified one such subscriber and exact redrive target.
- Exactly **one** SNS `Publish` sent synthetic-only `BP-TEST-SNS-SSE-SQS-DLQ-20261025` with the test filter attribute. AWS assigned **SNS MessageId `fea45289-972a-5819-975e-31de2b47efbe`**. No customer email/body/recipient/attachment and no real SES event.
- AWS SQS inventory after publish: temporary primary queue visible=**0**; existing DLQ visible=**1**, `SqsManagedSseEnabled=true`. This alone is delivery evidence but not used as the sole PASS criterion.
- Native `sqs:ReceiveMessage` from **existing DLQ** successfully decrypted and returned an SNS `Notification` envelope with `MessageId` **equal to** `fea45289-972a-5819-975e-31de2b47efbe` and `Message` exactly equal to the synthetic marker. No raw customer content existed or was printed. This uniquely proves SNS subscription failure redrive → SSE-SQS DLQ data delivery and consumer decrypt/read **without any customer-managed KMS key** for this AWS account/scenario.
- Native `sqs:DeleteMessage` removed only that exact verified synthetic record, followed by `ReceiveMessage` empty. Exactly one temporary subscription was `Unsubscribe`d, then temporary primary SQS queue deleted only after verified 0 visible/in-flight/delayed items and zero SNS subscriptions. Post-delete `GetQueueUrl` returned not found.
- **Final independent readback 2026-10-25T08:16:42Z**: **13/13 PASS**: exact AWS account; test queue gone; only original DLQ remains; SNS 0 subscriptions; SES set inactive/rule disabled; S3 0 objects; KMS key count 0; S3-reader keys count 0; DLQ SSE-SQS and no KMS; DLQ empty; retention still 345600 seconds; expected topic source constraint still on DLQ.
- No changes to Chatwoot `.env`, app/db, existing SMTP IAM, DNS, Zoho or callback launcher.

## Decision and precise limits

**PASS: SSE-SQS is operationally compatible with this SNS subscription dead-letter path.** It is no longer necessary to buy customer-managed KMS simply because the SNS DLQ is encrypted. AWS documentation's broad generic note about encrypted DLQs and custom KMS does **not** invalidate the observed SNS→SSE-SQS delivery. Prior Phase2K KMS-fit SHA-256 `ca521f37dab368b7d4447cab7e572fc82156fe00615a82d5bd9db55003cc80ef` remains an **UNAPPROVED fallback**, not an implementation recommendation.

This isolated PoC uses a **SQS recipient denial**, not an HTTPS ActionMailbox failure. It proves native SNS subscription DLQ transport with SSE-SQS and exact decryption/receipt, **NOT** Chatwoot webhook signature/topic validation, HTTPS 4xx/5xx retry policy, unknown UUID failure, ActionMailbox 204/Sidekiq failures, PII/retention legal alignment, S3 MIME retrieval, or actual buyer email continuity. Existing DLQ is NOT attached to a production SNS HTTPS subscriber; SNS currently has none and SES receiving remains inactive. A separate HEAVY-gated production activation, privacy-page publication before new real customer data, staff alerts and replay runbook are still required.

Provider docs for test path: https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html ; https://docs.aws.amazon.com/sns/latest/dg/sns-configure-dead-letter-queue.html ; https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html .
