# BabyPark — Chatwoot v4.18.0 SES Receiving activation runbook

Status: RUNBOOK — non-normative; **does not itself authorize live receiving, sending, or new credentials**.
Applies to: BabyPark Website Inbox 2, self-hosted Chatwoot 4.18.0 + AWS SES classic Receiving in account 763345000395, eu-central-1.
Supersedes: none.
Recorded: 2026-10-24, all existing resources inactive.
Repository: only Stanislavikus/babypark-integration. Canonical main read 1d5d8c00b7fdcdb54f37418ea60931c4292fd600, Agreement blob e777fce4af8e8c3372f1f9de9ef7d00f786c2c89.
Campaign: Draft PR #150, fixed original base f3d92325e6b4ef04f0137c4c49dde07c05731bbe; never automatically move/merge. Evidence frozen in `docs/CHATWOOT_SES_RECEIVING_INACTIVE_SCAN_20261024.md` (SHA-256 `2928d8be42b508deaac4a036f869d538cc9c63ddb71a897840fb62138c1f4932`) and `docs/CHATWOOT_SES_RECEIVING_INACTIVE_FIT_20261024.md` (SHA-256 `6d9ddd3e7a2c608cabf1a09abe053fc0aeb8fa3f5cc8d4c5c17b9000b4b1318f`); **those digests authorized only creation of inactive resources**. A fresh scope-specific §1–§3 scan, fit and explicit digest-identified owner GO are required for later runtime, synthetic delivery over production connectivity, or customer-data handling.

## 1. Today: independently checked, no live customer path

AWS identity babypark.ua verified with DKIM SUCCESS, SES Sandbox (external sending forbidden), employee-only SES SMTP user/recipient IAM guard unchanged.

Created and AWS read back:
- S3 bucket `babypark-chatwoot-ses-receiving-763345000395-euc1`, prefix `website-replies/`, private, four PublicAccessBlock flags true, SSE-S3 AES256, BucketOwnerEnforced, SES write policy exact source receipt-rule ARN + Account, 14-day expiration for prefix, current objects 0. No AES-KMS SES client-side mail encryption.
- SNS topic `arn:aws:sns:eu-central-1:763345000395:babypark-chatwoot-website-inbound`, 0 confirmed or pending subscriptions, policy permits rule-scoped SES Publish.
- SES classic Rule Set `babypark-chatwoot-website-inbound-inactive`, NOT ACTIVE; sole rule `website-reply-uuid` Enabled=false, recipient `reply@reply.babypark.ua` (plus addressing included), ScanEnabled=true, one S3Action with the SNS TopicArn. No duplicate SNSAction.
- AWS SES setup probe `website-replies/AMAZON_SES_SETUP_NOTIFICATION` (645 bytes) was the sole object at rule-create validation and deleted after verified exact key/size; current S3 count 0.
- Public DNS: apex babypark.ua MX are Zoho EU; no reply.babypark.ua MX. Chatwoot web and worker systemd active; live `.env` MAILER_INBOUND_EMAIL_DOMAIN, RAILS_INBOUND_EMAIL_SERVICE, ACTION_MAILBOX_SES_SNS_TOPIC are unset.

**Live Rails read-only metadata query 2026-10-24:** Website Inbox 2; `continuity_via_email=true`; `enable_email_collect=false`; `pre_chat_form_enabled=false` (intentional privacy/UX), `Account#inbound_email_domain` absent. Neither need a new Email Inbox nor a mandatory pre-chat form.

**Isolated actual-adapter synthetic test 2026-10-24:** loaded installed gem `aws-actionmailbox-ses` `SNSNotification` class under standalone Ruby 3.4.4, stubbed S3 GetObject with exclusively synthetic in-memory MIME. PASS: decoded S3 pointer; raw MIME To `reply+12345678-1234-1234-1234-123456789012@reply.babypark.ua` kept; non-`Received` event rejected by `MessageContentError`. No customer email, AWS data write, app/DB write, SMTP or service restart. **This is NOT SES/SNS/ActionMailbox end-to-end or an SNS signature test.**

## 1a. Additional non-production IAM simulation (2026-10-24)

Executed AWS native `iam:SimulateCustomPolicy` from connected AWS account, **without IAM CreateUser, CreateAccessKey or production configuration change**, to preflight a prospective dedicated off-AWS Chatwoot S3 read principal. Proposed identity policy has exactly one allow statement: `s3:GetObject` of `arn:aws:s3:::babypark-chatwoot-ses-receiving-763345000395-euc1/website-replies/*`.

Results (6/6 expected decisions):
- `s3:GetObject`, matching `website-replies/synthetic.eml`: **allowed**.
- `s3:PutObject`, matching object: **implicitDeny**.
- `s3:DeleteObject`, matching object: **implicitDeny**.
- `s3:GetObject`, unrelated prefix: **implicitDeny**.
- `s3:ListBucket`, bucket itself: **implicitDeny**.
- `s3:GetBucketPolicy`, bucket itself: **implicitDeny**.

**Scope of this proof:** confirms the standalone proposed IAM *identity policy only*, not the combined existing bucket resource policy, session policy, trust semantics, credential placement or real Chatwoot SDK S3 access. No principal/key exists. Before creating one, evaluate maintained native AWS credential modes for external DigitalOcean workloads and (if applicable) source-IP restriction for the verified outbound host. Require a new digest-approved architecture fit before cloud writes.

## 2. Native components, official sources and fixed mechanism

Installed `config/initializers/mailer.rb`: `RAILS_INBOUND_EMAIL_SERVICE=ses` selects SES ingress; `ACTION_MAILBOX_SES_SNS_TOPIC` must match exact SNS ARN. `MAILER_INBOUND_EMAIL_DOMAIN=reply.babypark.ua` is the reply address domain; also verify account-specific `Account#domain` and mailer From/Reply-To on a synthetic instance. Installed `aws-actionmailbox-ses 0.1.0` path `/rails/action_mailbox/ses/inbound_emails` uses SNS signed-request verification + exact topic, loads S3 `receipt.action.bucketName/objectKey` through stock Aws::S3::Client GetObject; incoming mail routes through ApplicationMailbox/ReceiverUuidStrategy to existing Website conversation. Outgoing SES SMTP config currently employees-only remains unchanged.

Official docs:
- https://developers.chatwoot.com/self-hosted/configuration/features/email-channel/amazon-ses-ingress
- https://developers.chatwoot.com/self-hosted/configuration/features/email-channel/conversation-continuity
- https://docs.aws.amazon.com/ses/latest/dg/receiving-email-action-s3.html
- https://docs.aws.amazon.com/ses/latest/dg/receiving-email-permissions.html
- https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html
- https://docs.aws.amazon.com/sns/latest/dg/http-subscription-confirmation-json.html
- https://docs.aws.amazon.com/ses/latest/APIReference/API_S3Action.html

Prefer one native S3Action with TopicArn to direct SNSAction, whose raw email cap is 150 KB. AWS currently documents 40 MB for S3Action including headers; SES over-limit email bounces. Do NOT configure additional per-email client-side SES KMS encryption: installed adapter reads plaintext MIME through S3 after SSE-S3 server-side decryption.

## 3. Minimum next approved implementation slice — isolated synthetic ingress

Before executing **any** item in this section, freeze updated scope-specific alternatives and fit (commercial SES Essentials terms, privacy/retention, deployment/security) and receive explicit owner approval naming fit SHA-256, exact nonproduction/test credentials and connection/data scope. Do not reuse the inactive-only fit to authorize it. Limit tests to synthetic email identities and conversations; avoid accidental staff/customer notifications.

1. **Read access:** choose a stock AWS identity suitable for an off-AWS DigitalOcean host. Create a dedicated least-privilege credential only after approval, limited to `s3:GetObject` for `arn:aws:s3:::babypark-chatwoot-ses-receiving-763345000395-euc1/website-replies/*` (and strictly necessary SDK actions). Do not grant S3 write/list/admin or share the staff-only SES SMTP IAM principal. Ensure AWS SDK region eu-central-1 and secret custody only in approved root/Chatwoot file (never Github/shell argv/log); backup/revocation documented. Investigate managed identity alternatives before choosing long-lived credentials.
2. **Private test endpoint first:** run a separate non-production isolated Chatwoot/ActionMailbox instance and synthetic mailbox records; do not configure production Chatwoot or publish real MX as part of PoC. No duplicate durable storage of real customer messages. Prepare exact rollbacks and no-op fallbacks.
3. **SNS subscription:** HTTPS `/rails/action_mailbox/ses/inbound_emails` only after the endpoint is correctly configured, TLS-valid, and restricted to signed SNS messages and topic ARN. Validate subscription confirmation and retries using only synthetic SNS traffic. A real HTTPS subscription on production is a separate deployment boundary requiring owner approval.
4. **Test S3 write + SNS message + native ActionMailbox route:** synthetic MIME `To: reply+validuuid@reply.babypark.ua`; assert same synthetic Website conversation, correct MIME attachments, dedup, source and sender attribution, no unrelated conversation. Test >150KB and attachment-rich MIME. Verify unknown UUID, malformed To, wrong SNS topic, bad signature and S3 read denied produce fail-closed behavior. Do not assume 204 means successful processing: record job completion/reconciliation at receiving DB boundary.
5. **Failure/recovery:** test SNS HTTP 5xx/429 retry; HTTP 401/403/404 are permanent failures, NOT general retry. AWS SNS HTTP/S retry time is capped at 1 hour; if delivery exhausts, SNS discards unless a DLQ is set. Audit native SNS DLQ/SQS alternative with no custom connector, and for post-204 Rails/job failure audit the native Active Job/Sidekiq retry/dead queues and whether reprocessing is supported without writing a custom bridge. Use no production service stop tests. Separately assess S3 14-day staging retention, ActiveStorage raw email incineration (Rails default 30 days), privacy and recovery.
6. **Buyer-facing activation later:** separate owner approval to create technical reply subdomain MX only, enable SES rule/rule set, SNS production HTTPS, Chatwoot env and optional Email Collect UX. Never replace apex Zoho MX. Leave outbound customer mail barred until AWS ProductionAccessEnabled=true **and** a separate IAM sender/recipient permission exists; preserve employee-only SMTP policy until its own approved replacement. Native Sales team-coverage automations and privacy notice independently verified before any real customer data.

## 4. Read-only verification and evidence gates

For AWS: GetAccount (Sandbox), DescribeActiveReceiptRuleSet (none), DescribeReceiptRuleSet (disabled), GetPublicAccessBlock/GetBucketEncryption/GetBucketPolicy/ListObjectsV2 (private/empty), GetTopicAttributes/ListSubscriptionsByTopic (0 subscriptions), staff IAM GetGroupPolicy recipient condition; inspect account SES Essentials pricing. For Chatwoot: source versions and live Website Inbox/Account flags; systemd web/worker health; only metadata of env values (never credentials); DNS root and technical MX. No external emails or new contact records in this stage.

**HALT if:** a receipt rule unexpectedly active; any S3 customer object before opt-in; unexpected SNS subscription; external recipient IAM guard change; base/HEAD/governance drift during gating; missing verified isolated test environment, exact fit/scan digest, secret custody, privacy retention approval, signed SNS verification, ability to recover failed jobs. Do not auto-merge PR #150 or treat it as production release.

## 5. Follow-up checkpoint / owner decision

Confirmed today: inactive AWS S3/SNS/SES scaffold + native Chatwoot plugin/inbox flags + isolated adapter fixture. **Not yet done:** credentials/read access, nonproduction Chatwoot, real SNS subscription, inbound active receipt set and DNS, data-retention legal approval, customer SES Production access. Next campaign scope must be approved with its own digest and failure model before any further external-product changes.
