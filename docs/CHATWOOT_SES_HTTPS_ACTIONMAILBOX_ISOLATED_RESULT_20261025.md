# BabyPark — Chatwoot 4.18.0 SES ingress isolated source and HTTP controller verification (2026-10-25)

Status: EVIDENCE — NON-NORMATIVE; no public HTTP/SNS subscription, no real MIME delivery, no production activation.
Applies to: installed Chatwoot 4.18.0, Ruby 3.4.4, Rails ActionMailbox 7.2.3.1, aws-actionmailbox-ses 0.1.0, SNS ingress with Website Email Continuity Inbox 2.
Supersedes: none. Distinct from prior successful SNS→SSE-SQS DLQ PoC (transport proven, actual Chatwoot HTTPS not yet).
Repository: Stanislavikus/babypark-integration only; one Draft PR #150 on original base f3d92325e6b4ef04f0137c4c49dde07c05731bbe. Main on this verification date 1d5d8c00b7fdcdb54f37418ea60931c4292fd600; current main Agreement blob e777fce4af8e8c3372f1f9de9ef7d00f786c2c89. Main docs/ listed fresh.
Execution: 2026-10-25, read-only application observations and standalone in-memory Ruby/ActionController test processes on authorized host `chatwoot-fra1-01`. Only synthetic values `example.invalid`, fixed UUID, fixture MIME and explicitly mock AWS S3 + SNS positive verification and Rails inbound persistence. No Chatwoot Rails app initialization, no production Postgres/Redis connection, no production log/secret output, no AWS calls for those tests, no process restart, no public HTTP POST, no site/DNS configuration changes. Ephemeral test scripts were passed to `ruby -` via stdin, not written as production code.

## Version and infrastructure read-back

- Ruby 3.4.4, Chatwoot v4.18.0, aws-actionmailbox-ses 0.1.0, aws-sdk-sns 1.70.0, Rails ActionMailbox 7.2.3.1.
- Chatwoot systemd `chatwoot-web.1` and `chatwoot-worker.1` active, `https://chat.babypark.ua` returned HTTP 200; production SMTP configured and unchanged.
- Live `.env`: `RAILS_INBOUND_EMAIL_SERVICE`, `MAILER_INBOUND_EMAIL_DOMAIN`, `ACTION_MAILBOX_SES_SNS_TOPIC`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` are currently UNSET/empty. Never collect their secret values.
- No technical `reply.babypark.ua` MX. Prior AWS independent proof and current state: receipt rule disabled, no active receipt set, SNS zero subscribers, existing SSE-SQS DLQ empty, no KMS keys. Website Inbox 2 had Email Continuity enabled during prior read, but new live app model flags were not re-queried by this pass.

## Actual standalone adapter behavior (12 cases)

Executed directly against shipped gem `SNSMessageVerifier`, `SNSNotification`, `S3Client` with a synthetic S3 client in memory, not live AWS:
1. S3Action precise bucket/key -> synthetic MIME bytes: PASS.
2. `To: reply+valid-UUID@reply.babypark.ua` preserved: PASS.
3. TopicArn returned unchanged: PASS.
4. Non-`Received` notification rejected: PASS.
5. Missing `notificationType` rejected: PASS.
6. Missing S3 receipt/action raises a hard error: **FAIL of the originally assumed behavior** — the adapter instead returns `nil` on its non-S3 branch. This case must be tested through the actual controller/DB boundary and not counted as valid inbound processing.
7. Synthetic S3 `NoSuchKey` propagated: PASS.
8. SNS-inline mail path injects `X-Original-To`: PASS (not the selected S3 transport).
9. Invalid SNS signature version returns false from AWS SDK verifier: PASS.
10. HTTP (non-TLS) SigningCertURL rejected: PASS.
11. Non-AWS cert host rejected: PASS.
12. Wrong certificate path extension rejected: PASS.
**Adapter summary: 11/12 expected checks met; one malformed-input behavior needs a specifically defined rejection test.** The negative signature tests used the actual AWS verifier and deliberately malformed/no-trust inputs; no remote certificate fetch was performed. **No valid genuine AWS SNS signature has been verified in this test.**

## Real installed HTTP controller called in memory with fakes

Loaded deployed `ActionMailbox::BaseController` and `ActionMailbox::Ingresses::Ses::InboundEmailsController` under a minimal standalone ActionController/Rack stack. **The positive SNS signature verifier, S3 GetObject and InboundEmail persistence were stubbed**; it is an HTTP controller unit/integration check, NOT an external AWS↔HTTPS↔Rails DB test.

- `ActionMailbox.ingress=:relay`: HTTP **404**; no SES accepted.
- Mocked non-authentic SNS notification: HTTP **401**.
- Mocked authentic notification with wrong SNS topic: HTTP **401**.
- Mocked authentic, right topic, `Received` S3Action + synthetic MIME: HTTP **204**; exact MIME bytes passed to the stubbed `ActionMailbox::InboundEmail.create_and_extract_message_id!` path.
- Malformed `Received` missing action: test produced `ArgumentError` from fake InboundEmail persistence on `nil` input; cannot infer actual production status without separate real Rails test DB. Treat as unproven failure outcome, **not** a successful customer message.
- Unexpected `Bounce` event: propagated `Aws::ActionMailbox::SES::SNSNotification::MessageContentError` in the isolated controller; not accepted; production exception/HTTP translation not exercised.

**SNS subscription confirmation tests against same installed controller**, with external Net::HTTP confirmation mocked in-memory and signer mocked:
- Mock valid signature/topic and simulated HTTP 200 confirm -> controller **200** PASS.
- Mock valid signature/topic and simulated HTTP 403 confirm -> controller **422** PASS.
- Mock invalid signature -> **401** PASS.
- Mock wrong topic -> **401** PASS.
Do not interpret this as a real SNS subscription confirmation, TLS or remote authenticity proof.

## Delivery and state ownership: critical post-HTTP-204 boundary

Installed code trace:
- `aws-actionmailbox-ses-0.1.0/.../inbound_emails_controller.rb` verifies SNS signature + configured topic, reads MIME from S3 via `SNSNotification#message_content`, calls `ActionMailbox::InboundEmail.create_and_extract_message_id!`, then HTTP `204`. It does NOT synchronously prove Chatwoot Message or reply+UUID conversation persisted.
- Rails `actionmailbox-7.2.3.1/app/models/action_mailbox/inbound_email/message_id.rb` uploads original raw MIME to ActiveStorage and creates record. `Routable` triggers `ActionMailbox::RoutingJob.perform_later` upon pending-email record commit.
- Installed `config/sidekiq.yml` has `:max_retries: 3` and queue `action_mailbox_routing`. Whether retry proceeds cleanly after a DB failure must be verified under actual isolated Redis/Postgres before asserting losslessness.
- Installed `actionmailbox-7.2.3.1/lib/action_mailbox/base.rb` marks an exception during mailbox processing as `failed!` and re-raises. Rails `InboundEmail::Incineratable` includes `failed` among processed terminal statuses and schedules incineration when status changes; default expiry is **30 days after processing**. Chatwoot Website conversation append uses separate `ReplyMailbox` transaction; no proof yet that failed/retried deliveries are automatically recovered after Sidekiq retry exhaustion.
- Installed `app/services/mailbox/conversation_finder_strategies/receiver_uuid_strategy.rb` selects a conversation by recipient `reply+UUID`, without using sender address for proof of identity. Sender/UUID-based authorization and contact-inbox attribution remain independently unverified, especially spoofed From, wrong UUID, cross-account message and attachment cases.

**Operational risk classification, HEAVY for any live customer ingress**:
B1 invalid/foreign SNS signatures/topics = supported negative unit behavior; genuine AWS signed inbound positive and real SNS HTTPS subscription still unproven.
B2 malformed content and S3 access-denied/missing object = actual response code + AWS 429/5xx versus permanent 4xx classification must be tested. AWS SNS retries 5xx and 429, not 401/403/404/422; source https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html . Our proven SSE-SQS DLQ covers failure before HTTP acceptance only.
B3 post-204 Rails/Sidekiq failures, failed state/incineration, duplicate Message-ID and idempotent append require isolated database/queue crash-window tests and native recovery runbook, never claim 204=delivered.
B4 private raw MIME transient copies in SES S3 (14d) and Rails ActionMailbox/ActiveStorage (default 30d after processing) require retention/privacy and operator replay window approval before real customer data.
B5 signature/topic TLS and real MIME To/Envelope, reply+UUID routing and team visibility require actual isolated full-stack proof.

## Next gate / supported native components

Chosen native solutions: installed official Chatwoot SES ingress + bundled AWS gem 0.1.0 and its shipped RSpec fixtures (`lib/aws/action_mailbox/ses/rspec.rb`), Rails ActionMailbox/RoutingJob, Sidekiq and AWS SNS/S3/SQS. No code/application adapter or getmail6 required. Vendor docs https://developers.chatwoot.com/self-hosted/configuration/features/email-channel/amazon-ses-ingress ; https://guides.rubyonrails.org/action_mailbox_basics.html ; https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html ; https://docs.aws.amazon.com/sns/latest/dg/SendMessageToHttp.prepare.html .

For true end-to-end isolated tests use a **separate non-production Chatwoot 4.18.0** with separately proven Postgres, Redis, ActiveStorage and test Website conversation, preconfigured official SES ingress and controlled TLS URL before any SNS subscription; no production service restart, no live Website inbox or customer contact. Owner-approved new fit must settle instance/host/cost, secret custody for synthetically scoped S3 GetObject, retention, SNS delivery and rollback. Tests: genuine SNS signed SubscriptionConfirmation and Notification; S3 synthetic MIME >150 KB and attachments; exact reply+valid UUID matched to same synthetic conversation; wrong/unknown UUID, malformed and spoofed headers, foreign topic/signature, 401/404/422 vs 429/5xx handling + DLQ, Sidekiq crash before/after 204, idempotent replay/failed state recovery; native alert/operations evidence. No customer-domain MX/SES active receipt rule or external sender yet.

**Current verdict:** bounded source/adapter/controller verification partially passed; no actual full-stack E2E or production activation done. Keep public SES Receiving switched OFF and PR Draft/unmerged. Do not claim complete operational readiness until exact-tree HEAVY zero-blocker review, approved privacy and separate owner go-live.
