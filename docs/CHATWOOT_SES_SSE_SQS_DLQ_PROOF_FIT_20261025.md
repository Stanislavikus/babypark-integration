# BabyPark — isolated SNS→SSE-SQS DLQ dynamic proof fit (2026-10-25)

Status: EVIDENCE — NON-NORMATIVE. This is a bounded *proposal*, NOT implementation permission.
Applies to: temporary synthetic-only AWS SNS failure-redrive verification against the existing SSE-SQS queue; no production customer data or service changes.
Supersedes: none.
Repo: Stanislavikus/babypark-integration. Canonical main 1d5d8c00b7fdcdb54f37418ea60931c4292fd600; Agreement blob e777fce4af8e8c3372f1f9de9ef7d00f786c2c89. Draft PR #150 original pinned base f3d92325e6b4ef04f0137c4c49dde07c05731bbe; no automatic branch rebase/merge.
Bound alternatives: `docs/CHATWOOT_SES_SSE_SQS_DLQ_PROOF_SCAN_20261025.md` SHA-256 `a6e5cad6a166b226ea23ba291f70cd673350a020ee4835a62c30c922ac475756` normalized UTF-8 LF final newline.

## Decision and exact operation ceiling

Recommendation: **isolated native AWS PoC**, then choose customer-KMS option only if actual no-KMS SNS redrive proves incompatible or is demonstrably unsupported. No KMS key/spend consent implied. Prior Phase2K KMS fit SHA256 `ca521f37dab368b7d4447cab7e572fc82156fe00615a82d5bd9db55003cc80ef` is NOT approved. This PoC needs the owner's separate explicit authorization naming THIS note's own SHA-256, as required by merged `docs/AI_WORKING_AGREEMENT.md` §3. The user's general direction to test alone does not identify this final immutable exact scope.

Account exclusively 763345000395, region eu-central-1. Existing topic `arn:aws:sns:eu-central-1:763345000395:babypark-chatwoot-website-inbound` must remain otherwise unchanged. Existing empty Standard queue `arn:aws:sqs:eu-central-1:763345000395:babypark-chatwoot-website-sns-dlq` remains SSE-SQS encrypted (`SqsManagedSseEnabled=true`), no KMS, source-scoped SNS SendMessage, four-day retention. Existing SES set/rule stay disabled; Website Chatwoot/Zoho/DNS untouched. A test MUST NOT modify existing DLQ policy/encryption/retention and must not publish customer data.

## Exact staged action protocol after digest-specific consent

1. Reverify current main/docs Agreement, PR HEAD/TREE/base; account identity and exact SNS topic/SQS DLQ source policy, 0 SQS messages, 0 topic subscribers, no SES active receipt set, disabled only receipt rule, no KMS keys and no customer ingress. HALT if any drift, external subscriber or object.
2. Create only `babypark-chatwoot-sns-dlq-proof-primary-20261025`, SQS Standard SSE-SQS and initially empty. Set restrictive queue policy with explicit Deny `sqs:SendMessage` for SNS from the above topic, ensuring intended permanent client-side endpoint delivery failure. No unrelated principals or unencrypted transport. Record created identity for rollback.
3. Create exactly one same-account `sqs` SNS test subscription to primary ARN with subscription-level `RedrivePolicy` pointing at the pre-existing DLQ. Apply synthetic-only subscription filter (message attribute `bp_test_only=20261025_sse_sqs_proof`); inspect `GetSubscriptionAttributes` and subscriber cardinality before any publish. Do NOT attach DLQ to a production HTTPS subscription or change existing customer path. If Subscribe/RedrivePolicy rejected, STOP and cleanup exact empty test subscription/queue.
4. **Publish exactly ONE synthetic SNS message** with fixed string `BP-TEST-SNS-SSE-SQS-DLQ-20261025` and matching test-only attribute, through native AWS SNS Publish. If tool runtime safety rejects any message mutation, STOP: never bypass through different action/tool. Prove failure→DLQ by obtaining the matching SNS MessageId / synthetic marker using native SQS ReceiveMessage, not by queue count alone. Do not expose a real payload or any customer address. If outcome remains uncertain, mark UNPROVEN, preserve only exact evidentiary identifiers.
5. On verified synthetic identity alone, native SQS DeleteMessage to remove exact synthetic DLQ object, unsubscribe exactly the one created test SNS subscriber, and delete only zero-content test primary SQS queue if no further delivery is possible. If cleanup cannot be proved, STOP with clear resource ARN and residual state; never purge unknown entries.
6. Independently verify SNS subscribers exactly 0; SES rule set inactive and rule disabled; existing DLQ 0 messages, same SSE-SQS+source policy; primary test queue removed if safe; no S3 items/customer traffic; no Chatwoot/Zoho/DNS/IAM/SQS KMS changes. Update Git `docs/INFRASTRUCTURE_REGISTRY.md`, `docs/CURRENT_STATE.md` in same bounded slice for created/deleted resources and rollback identity; post exact status+HEAD/tree/base to Draft PR #150.

## Pass/fail truth table

- **PASS (SSE-SQS adequate for this SNS DLQ scenario)**: SNS publish accepted, primary queue permanent denial confirmed (independent delivery evidence), exact published synthetic notification exists in DLQ and is read back, decrypted using SQS-managed encryption, no KMS key created.
- **FAIL (SSE-SQS not adequate)**: independent SNS DLQ delivery failure explicitly attributable to this encryption mode with queue policy proven sound; *absence of one message, mere delays, permission misconfiguration or tool safety rejection is NOT failure*.
- **UNPROVEN**: SNS accepted RedrivePolicy but no actual failed-delivery message proof, test timed out, AWS async/retries, or any read blocked. No key purchase based on UNPROVEN alone.

**Exclusions:** no Chatwoot HTTP subscription/ActionMailbox, SES enabled rule, Cloudflare MX, customer mail, KMS key, new hosted service/lambda/code, production SMTP IAM changes, data retention approvals, PR merge. After this PoC, real-customer go-live still requires privacy notice, native post-204 Sidekiq recovery, DLQ alert/replay, read credentials with secure custody, and independent HEAVY review.
