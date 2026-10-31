# BabyPark — SNS→SSE-SQS DLQ isolated proof alternatives scan (2026-10-25)

Status: EVIDENCE — NON-NORMATIVE; no AWS operational permission from this document.
Applies to: one synthetic-only test of Amazon SNS subscription failed delivery into the pre-existing encrypted SQS DLQ candidate. No real email, no Chatwoot change, no customer traffic.
Supersedes: none.
Source repository: Stanislavikus/babypark-integration ONLY. Canonical main 1d5d8c00b7fdcdb54f37418ea60931c4292fd600, Agreement blob e777fce4af8e8c3372f1f9de9ef7d00f786c2c89. Existing Draft PR #150 original base f3d92325e6b4ef04f0137c4c49dde07c05731bbe; no automatic repin/rebase.
UTC vendor scan: 2026-10-25.

## Contract, scope and exact initial AWS objects

AWS account 763345000395, region eu-central-1. SNS topic `arn:aws:sns:eu-central-1:763345000395:babypark-chatwoot-website-inbound` currently 0 subscribers; SES receipt rule set `babypark-chatwoot-website-inbound-inactive` not active, receipt rule `website-reply-uuid` disabled. Existing SQS Standard queue `arn:aws:sqs:eu-central-1:763345000395:babypark-chatwoot-website-sns-dlq` is empty, `SqsManagedSseEnabled=true`, no KMS key, `MessageRetentionPeriod=345600` (4 days). Queue policy permits `sns.amazonaws.com` `sqs:SendMessage` *only* from that exact SNS TopicArn and `aws:SourceAccount=763345000395`. S3 website-replies bucket is empty. Chatwoot v4.18.0 has not been configured for SES ingress, production staff SMTP unaffected. All test email/URI/message data are synthetic.

Requirements: (R1) prove **SNS subscriber failure → its subscription DLQ → SSE-SQS object**, not mere policy acceptance/direct SQS self-send; (R2) use only native official AWS APIs, no code/bridge/deployment; (R3) do not alter sender/Chatwoot/DNS/SES state, S3 objects or customer data; (R4) no permanent subscriber left after test; (R5) preserve source-scoped DLQ policy, empty queue on test exit, verify exact evidence without printing raw bodies/URLs/credentials; (R6) no KMS/new monthly bill; (R7) never evade API/tool security blocks; (R8) account and SNS topic must remain controlled/no outside real publishers for the test, with rechecks.

## Vendor discovery evidence and alternatives

Sources and reproducible queries (2026-10-25):
- AWS SNS DLQ official https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html: attached **per subscription**; client errors (including SQS access denied after endpoint queue policy change) are not retried; DLQ receives notifications.
- AWS SNS configure DLQ https://docs.aws.amazon.com/sns/latest/dg/sns-configure-dead-letter-queue.html: existing topic + separate SQS test endpoint + separate SQS DLQ; set subscription `RedrivePolicy` referencing `deadLetterTargetArn`.
- AWS SNS same-account SQS subscription https://docs.aws.amazon.com/sns/latest/api/API_Subscribe.html: same-account SQS subscription needs no manual HTTPS confirmation.
- AWS SNS retries https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html: permanent endpoint errors versus 5xx retries; avoid 23-day SQS server-failure paths.
- AWS SNS subscriber SQS failure https://repost.aws/knowledge-center/sns-sqs-subscriptions-notifications: misconfigured endpoint policy yields failures; SQS DLQ captures client errors.
- AWS SQS SSE-SQS https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-server-side-encryption.html: encryption without customer KMS.
- AWS SNS encrypted DLQ caveat https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html: general custom-KMS wording, does not explicitly distinguish SSE-SQS, so behavior requires test.
- SaaS/client app solution getmail6, custom Lambda/handler excluded: no relevant need and violates native-first.

| Candidate | Actual SNS DLQ proof | Isolation | Cost/burden | Result |
| --- | --- | --- | --- | --- |
| Read docs or IAM policy simulation | FAIL (no delivery) | PASS | None | Insufficient |
| Direct `sqs:SendMessage` synthetic | FAIL (not SNS DLQ) | PASS | Low | Insufficient (previous run blocked) |
| Native temporary confirmed HTTPS endpoint deliberately 403 | PARTIAL (requires confirmation and externally owned HTTPS app); risk to live Chatwoot | FAIL without own test service | Extra endpoint/service | Exclude |
| Native temporary same-account SQS subscriber, policy-denied delivery, RedrivePolicy→existing DLQ | PASS **if actual SNS-failure payload appears**, otherwise UNPROVEN | PASS with verified synthetic filter and no active SES receipt | Single temporary Standard queue/subscription + one SNS Publish | **Selected for bounded isolated PoC** |
| Customer KMS key then assume DLQ | FAIL (no actual failure proof) | PASS | ~$1/month plus API, premature | Fallback only if test shows unsupported SSE-SQS |
| SNS subscription without any failure condition | FAIL (cannot prove redrive) | PASS | Low | Not sufficient |

No KMS purchase/rotation, SSE toggle, unencrypted SQS, public HTTP listener, Chatwoot patch or external sender authorized by this scan. Current AWS data path remains inert.

## Safety-critical test logic for the selected ready-product route

Use exactly one new Standard SQS **primary test endpoint queue** (proposed name `babypark-chatwoot-sns-dlq-proof-primary-20261025`) in the same AWS account/region; SSE-SQS encryption. Create exact primary queue policy intentionally **denying** SNS SendMessage (e.g. explicit Deny for service principal `sns.amazonaws.com` and source topic); ensure legitimate customer delivery cannot route here. Subscribe primary queue ARN to existing SNS topic using official Subscribe protocol=sqs and subscription `RedrivePolicy` to the existing DLQ; use a narrow synthetic-only SNS message attribute filter, but do not rely on immediate policy propagation for isolation. No other SNS subscriptions or SES receipt active during test.

Publish precisely one bounded synthetic message with no customer fields, such as `BP-TEST-SNS-SSE-SQS-DLQ-20261025` and matching synthetic-only message attribute, using native SNS Publish **only if this is explicitly allowed by the execution tool's safety controls**. Record Publish MessageId only, never customer content. Expected: permanent SQS endpoint policy denial → immediate SNS DLQ redrive to existing SSE-SQS queue. Verify actual SQS ReceiveMessage with exact synthetic probe marker/MessageId and safe cleanup by exact ReceiptHandle; no other messages in DLQ. If AWS/tool denies execution, HALT and record UNTESTED — **never retry via alternate tool to circumvent**.

Finally unsubscribe the exact temporary subscriber and delete ONLY proven empty temporary primary queue under separately bounded rollback, subject to SNS no further deliveries; restore SNS zero subscriptions and DLQ empty, confirm existing DLQ SSE-SQS+source policy unchanged, SES inactive and no real messages. Do not auto-delete unexpected data; report any drift. No public real-customer receive or outbound authorization.

Critical caveats: subscription filter propagation can be eventually consistent; avoid all other publishers during the test, and check that SES rule stays inactive. Failing AWS-managed endpoint via authorization denial is different from HTTPS 403 but exercises identical SNS DLQ redrive destination. SNS HTTP endpoint/ActionMailbox still needs independent testing later. A tool safety denial makes the dynamic result *not proven*; docs-only cannot be promoted into PASS.
