# BabyPark Chatwoot SES Receiving — Phase 2 native-readiness alternatives (2026-10-25)

Status: EVIDENCE — NON-NORMATIVE, no new AWS authorization.
Applies to: Phase 2 — isolated synthetic-only preparation of IAM S3 reader and SNS→SQS failure recovery in AWS 763345000395 / eu-central-1 for Chatwoot 4.18.0 Website conversation continuity.
Supersedes: none. No Chatwoot/Drupal production activation in scope.
Canonical repo: Stanislavikus/babypark-integration. Current main 1d5d8c00b7fdcdb54f37418ea60931c4292fd600, Agreement blob e777fce4af8e8c3372f1f9de9ef7d00f786c2c89. Draft PR #150 original base f3d92325e6b4ef04f0137c4c49dde07c05731bbe (stale, no implicit re-pin).
UTC refreshed options research: 2026-10-25.

## Requirements / invariants

R1 Keep Chatwoot v4.18.0 Website Inbox 2 transcript authority; no new Email Inbox, patches, getmail6, Docker or BabyPark production bridge.
R2 SES→S3 S3Action+SNS already exists **inactive** in eu-central-1. Phase 2 may prepare a least-privilege S3 reader and one SNS failed-HTTP-delivery recovery resource only on a new digest-approved scope; do not activate any receipt rule/MX/SNS HTTPS subscriber or customer delivery.
R3 All test messages, UUIDs, email headers, objects and conversation stubs must be synthetic. No real buyer body/email/attachments, domain/customer send, live Chatwoot DB modifications or production service interruptions.
R4 Guarantee network delivery isolation: SNS HTTP/S 5xx/429 retry, 4xx non-retry; a subscription DLQ must retain failed SNS notification; capture/alert/replay procedure must not silently lose messages. DLQ cannot cover **after** Rails 204 internal job failure, which needs separate native Sidekiq/ActionMailbox recovery proof.
R5 S3 GetObject only on exact bucket/prefix; no list/write/delete/admin; no reuse existing staff-only SMTP credentials; secrets never returned in tool output, source code, GitHub or logs; least-privilege revocation and rotation.
R6 DLQ must remain without production SNS HTTPS subscription until separately authorized; encryption at rest plus source-ARN policy, bounded retention and minimal metadata access. Avoid unnecessary KMS service/cost unless required by proven provider behavior.
R7 Recovery timeline ties S3 object retention (currently 14 days) to DLQ retention plus operator response; no arbitrary TTL promises. Captured SNS message contains S3 pointer, not necessarily full raw MIME; deleting S3 earlier defeats replay.
R8 Preserve babypark.ua Zoho MX, separate callback-launcher implementation, existing Chatwoot SMTP and SES Sandbox/IAM guard; no modification of public privacy page in this cloud slice. Complete privacy notice/update by real customer activation.
R9 AWS managed product prices and rights must be revalidated immediately before any usage; no fixed-fee/paid service committed silently.

## Reproducible sources and options

Vendor sources checked 2026-10-25:
- AWS SNS HTTP/S retry https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html
- SNS DLQ attachment to **subscription**, not topic; max 14d SQS retention https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html and https://docs.aws.amazon.com/sns/latest/dg/sns-configure-dead-letter-queue.html
- SQS SSE modes https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-server-side-encryption.html
- IAM Role default/preference and exception for off-cloud tools https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html
- IAM Roles Anywhere credential helper https://docs.aws.amazon.com/rolesanywhere/latest/userguide/credential-helper.html
- Managed KMS key cost https://aws.amazon.com/kms/pricing/
- AWS-maintained Apache-2.0 gem 0.1.0 (installed) https://rubygems.org/gems/aws-actionmailbox-ses/versions/0.1.0 ; upstream v0.2.0 since 2026-04-28, but upgrading Chatwoot/gem is not part of this stage.
- Chatwoot v4.18.0 core MIT (enterprise/ exceptions) https://github.com/chatwoot/chatwoot/blob/develop/LICENSE ; stock installed code verified: SNS signature+topic / S3Client GetObject.
- Existing owner candidate getmail6/Zoho: excluded after explicit owner decision; separate email channel would fail same Website thread.

Discovery queries/recheck: SNS subscription DLQ HTTP retries AWS 2026; SQS SSE-SQS and SNS DLQ compatibility; Roles Anywhere DigitalOcean AWS SDK credential_process; IAM keys vs roles for off-AWS; SES/S3 signed SNS callback; Chatwoot 4.18.0 native ingress and gem version.

| Candidate | R1 native same thread | R2-R3 isolated | R4 recovery | R5 access | R6-7 privacy/ops | Burden, result |
| --- | --- | --- | --- | --- | --- | --- |
| Existing SNS only, no DLQ | PASS | PASS | FAIL dropped notifications | N/A | FAIL recovery | Excluded |
| Native SNS HTTPS subscription + SQS Standard DLQ, policy source topic ARN | PASS | PARTIAL (needs isolated subscribe later) | PASS for SNS pre-ack failures, NOT post-204 Rails jobs | N/A | PARTIAL security/retention until tested | **Chosen ready AWS recovery mechanism** |
| SQS DLQ encrypted with SSE-SQS without customer KMS | PASS | PASS for empty/no subscription | PASS if SNS→SQS successful | N/A | PARTIAL: vendor SNS DLQ guide emphasizes customer-managed KMS for encrypted queues; empirically verify SSE-SQS before acceptance | Preferred test-first; never assume PASS |
| SQS DLQ with customer-managed KMS | PASS | PASS after owner cost/authorization | PASS if key policy grants SNS kms:GenerateDataKey/Decrypt | N/A | PASS technical encryption if tested; adds ~$1/mo key + usage and key custody | Fallback ONLY after owner charge approval, not silently added |
| Chatwoot AWS SDK with IAM Roles Anywhere temporary creds | PASS | PARTIAL needs certificate/trust anchor/helper | N/A | PASS short-lived creds | PARTIAL new CA/key and helper operational risk | More complex; candidate if managed trust/cert deployment exists |
| Chatwoot AWS SDK with dedicated IAM user GetObject-only, mode0600 isolated secret | PASS | PASS for synthetic setup | N/A | PARTIAL long-lived secrets + rotation; least integration burden | PARTIAL secret lifecycle | Preferred integration-first candidate subject to exact secret handling/owner authorization |
| Existing SMTP IAM user for S3 read | PASS | FAIL sender/consumer isolation | N/A | FAIL privilege separation | FAIL | Excluded |
| Custom Lambda/worker/Cron/bridge | PARTIAL | FAIL native-first | PARTIAL | PARTIAL | PARTIAL | Excluded until ready products fail; no custom code by default |

**Decision: candidate native AWS SNS+SQS DLQ and AWS SDK GetObject are valid; production activation not yet evidenced.** The Phase-2 fit note binds this exact scan, and any new AWS write still needs digest-specific owner GO. No customer data until separate privacy/gated release. This is not an entitlement to change paid plans or security posture beyond this slice.
