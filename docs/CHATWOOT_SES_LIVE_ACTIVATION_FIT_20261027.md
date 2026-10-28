# BabyPark Chatwoot Email Continuity - production activation decision and fit (2026-10-27)

Status: EVIDENCE - NON-NORMATIVE / PROPOSAL, NOT A PRODUCTION GO.
Applies to: Website Inbox 2 only, self-hosted Chatwoot 4.18.0 on chatwoot-fra1-01, existing AWS SES classic email receiving and SMTP in eu-central-1.
Supersedes: none. This is a new narrower activation-stage proposal; prior inactive-resource fits are still historical evidence, not authorization for real buyer mail.
Repository: Stanislavikus/babypark-integration only.
Governance at record time: canonical main 1d5d8c00b7fdcdb54f37418ea60931c4292fd600; Agreement blob e777fce4af8e8c3372f1f9de9ef7d00f786c2c89. Original PR #150 campaign base f3d92325e6b4ef04f0137c4c49dde07c05731bbe is stale. No implicit rebase/repin/merge.

## Exact intended function and boundaries

A buyer initiates a Website Inbox 2 Chatwoot conversation. If their email is legitimately present in the Chatwoot contact and the agent answers after the visitor leaves, Chatwoot sends the continuity email from an authorized BabyPark sender via SES SMTP. Buyer replies to reply+conversation-UUID@reply.babypark.ua. Only the technical reply subdomain MX routes to SES classic Receiving, which writes temporary MIME to the already existing private S3 receiving bucket and publishes SNS to the already installed aws-actionmailbox-ses 0.1.0 receiver on Chatwoot. The native ActionMailbox/Sidekiq/Chatwoot application joins the message to the exact existing Website conversation, retaining Chatwoot as customer transcript authority. Zoho apex babypark.ua MX stay unchanged; no new Email Inbox, framework, worker, custom connector, code or permanent VM. No marketing, bulk campaigns, or unauthorised buyers. Preserve native human handoff/team inbox.

## Reproducible bounded native-first alternatives scan (2026-10-27)

Sources checked:
- Chatwoot official continuity and email collection: https://www.chatwoot.com/hc/user-guide/articles/1677587761-how-to-continue-conversations-through-email
- Chatwoot upstream self-hosted environment keys: https://github.com/chatwoot/chatwoot/blob/develop/.env.example (upstream reference; installed 4.18.0 runtime is the deciding authority)
- AWS SES account/region/sandbox: https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html
- AWS classic SES receipt rules/plus aliases: https://docs.aws.amazon.com/ses/latest/dg/receiving-email-receipt-rules-console-walkthrough.html
- AWS SES S3 action and SNS event metadata: https://docs.aws.amazon.com/ses/latest/dg/receiving-email-action-s3.html
- AWS inbound MX: https://docs.aws.amazon.com/ses/latest/dg/receiving-email-mx-record.html
- AWS SES current pricing/terms: https://aws.amazon.com/ses/pricing/
Search/discovery: official Chatwoot conversation-continuity user guide + deployed native 4.18.0/ActionMailbox gem; AWS SES classic receiving S3+SNS and native SMTP; compare no-code provider substitutes Mailgun, Zoho/IMAP, Brevo/SMTP as already discussed and owner rejected for this specific production launch.

Candidate matrix (PASS means conditional technical fit, not release authorization):
| Candidate | Website same-thread reply | Ready integration | Security/privacy | Cost/maintenance | Verdict |
| --- | --- | --- | --- | --- | --- |
| Existing Chatwoot 4.18.0 + SES classic SNS/S3 + installed aws-actionmailbox-ses 0.1.0 | Native receiver routes reply UUID when properly configured | Existing adapter, stock env, SES SMTP; no Chatwoot core patch | Requires scoped S3 read IAM/credential custody, SNS signature/topic, retention, post-204 worker reconciliation, tested customer authorization | Existing metered SES, S3/SNS; no new provider | CONDITIONAL PASS; first choice |
| Mailgun SMTP/inbound | Potential provider replacement, not proven same installed adapter path | Extra account/DNS/approval | New data processor/credentials; production controls need review | New service and possible send limits | DEFERRED at owner's explicit request; not faster than finishing existing approved SES |
| Zoho IMAP/SMTP standalone Email Inbox | Native Email Inbox, but not demonstrated same Website conversation UUID continuity | Corporate Zoho exists | Separates inbox/thread and changes workflow | Existing provider | FAIL same-Website-thread requirement on current evidence |
| Brevo outbound SMTP | Sending possible, but inbound Website UUID path still needs SES | New account and authorization | Additional data processor | Separate provider | FAIL complete required two-way path alone / DEFERRED |
| Custom bridge/Chatwoot core patch | Unneeded; native path exists | More code | Additional unproven privacy, crash/replay semantics | Higher ongoing burden | REJECTED |

SES plan/terms: SES is metered and may have an account-specific Essentials vs a-la-carte price plan; do not claim a fixed cost or that the already-existing account is free. No paid Mail Manager endpoint, dedicated IP, third-party provider or custom KMS key selected. Revalidate the account's actual active billing plan before authorising large volume.

## Read-only evidence from live production, 2026-10-27

- SES eu-central-1 account 763345000395 GetAccount: ProductionAccessEnabled=true, SendingEnabled=true, EnforcementStatus=HEALTHY, ReviewDetails.Status=GRANTED; Max24HourSend=50000, MaxSendRate=14. babypark.ua verified and DKIM SUCCESS.
- Existing staff SMTP IAM principal babypark-chatwoot-ses-smtp is active, but inline group policy limits from addresses to contact@babypark.ua and support@babypark.ua and all recipients to *@babypark.ua. SES sandbox approval does NOT alter IAM. No external buyer send presently authorized.
- Existing limited S3 reader principal babypark-chatwoot-ses-s3-reader has the single inline policy ChatwootInboundS3GetObjectOnly, no group/managed attachment and ZERO access keys as checked; production Chatwoot therefore lacks proven S3 object-read credential.
- Existing SES rule set babypark-chatwoot-website-inbound-inactive has one disabled website-reply-uuid rule with recipient reply@reply.babypark.ua, one S3Action and SNS. Official SES classic recipient conditions match plus-address variants. Active SES receipt ruleset is absent. Topic arn:aws:sns:eu-central-1:763345000395:babypark-chatwoot-website-inbound has ZERO subscriptions.
- Existing S3 bucket babypark-chatwoot-ses-receiving-763345000395-euc1 in eu-central-1 has 14-day expiry rule. It is transient MIME staging rather than a second customer transcript archive.
- DNS read-only: reply.babypark.ua has no MX; apex babypark.ua MX remains Zoho EU (mx.zoho.eu, mx2.zoho.eu, mx3.zoho.eu).
- Host systemd web/worker/Postgres/Redis are active; production /home/chatwoot/chatwoot/.env has RAILS_INBOUND_EMAIL_SERVICE, MAILER_INBOUND_EMAIL_DOMAIN, ACTION_MAILBOX_SES_SNS_TOPIC all empty.
- Live PostgreSQL read-only Website Inbox 2: Channel::WebWidget, continuity_via_email=true, enable_email_collect=false, pre_chat_form_enabled=false. Under official Chatwoot rules, contacts without email cannot receive continuity messages. Decide whether email collection prompt is deliberately enabled or only already-known-email contacts are served; do not silently alter UX.
- Isolated 2026-10-26 real DO image restore of Chatwoot, Postgres, and 3/3 Active Storage files passed; see PR #155 comment #6412156326. This does not prove Sidekiq post-204 recovery.
- Earlier adapter isolated mock tests, HTTPS rejection paths and SNS->SSE-SQS DLQ synthetic delivery are useful evidence, but do not prove live full-stack receipt or queued-mail recovery.

## Production-specific fit and unclosed gates

A. Security: preserve sender allowlist and never expose secrets in Git/logs. For external buyer SMTP, change or separate authorization with an exact scoped and reviewed IAM policy, protect credentials, test rejection for foreign sender, allow intended buyer, and preserve internal staff mail; do not silently remove staff-only restriction. At least one external recipient is necessary for practical service. No arbitrary bulk send.
B. Incoming: stock Chatwoot SES env, native signed SNS HTTPS receiver at /rails/action_mailbox/ses/inbound_emails, exact SNS ARN, minimal off-AWS S3 GetObject on website-replies/* with secure secret custody, verified HTTPS subscription and DLQ, public MX only reply.babypark.ua, enable the exact SES rule/set after synthetic verification. No blanket SES receiving rule or touching apex Zoho.
C. Data and fail-closed: verify recipient is exact reply+valid-conversation-UUID and correct account/inbox, reject unknown sender/UUID/message state, legitimate buyer conversation continuing only; Chatwoot retains transcript authority, AWS S3 stages raw MIME only 14 days. Confirm public privacy notice, retention, access roles, suppression and bounce handling before processing actual customer mail.
D. Reliability: receipt webhook HTTP 204 means accepted/queued, NOT routed to Chatwoot. Verify one synthetic S3Action SNS signed event through live Rails ActionMailbox, Postgres ActiveStorage and Sidekiq to exactly one synthetic Website message, then duplicate/replay/fail/retry recovery and operator alert/single-message reroute on post-204 failed/dead jobs. Test unavailable S3, bad signature/topic, unknown UUID and valid MIME attachments within actual capabilities. Keep production Sidekiq running; do not use real customer data to test.
E. Change isolation: safely snapshot/restore exact web-only env/service configuration, verify browser widget, Website inbox, team automations and live chat health before and after. No custom Chatwoot code/patch. Avoid changing employee mail until synthetic tests pass; exact rollback for IAM/SNS/DNS/Chatwoot settings.
F. Go-live acceptance: one synthetic outward email to an owner-controlled TEST address, reply into SAME synthetic Website conversation, no duplicate or wrong-account message, no other inbox effects. Monitor suppression, delivery, mailbox jobs, DLQ/Sidekiq, sending consumption. Real customer path only after these checks; rollback on failed routing.

## Staged decision, not a release authorization

STAGE 0 complete: SES ProductionAccess is granted, core runtime/registry and existing off scaffolding confirmed.
STAGE 1 NOT COMPLETE: full production-stage scan/fit verification and exact digest-bound owner authorization; frozen current-main HEAD/TREE/BASE review. Existing PR #150 original base is stale. Resolve base under explicit owner strategy, never silently re-pin/rebase.
STAGE 2 NOT COMPLETE: exhaustive HEAVY R1 + independent context-isolated R2 zero BLOCKERs on one exact immutable tree and manifest; approval of exact scope. No customer-data, production inbound, SMTP IAM broadening, MX or production restart before gate.
STAGE 3 NOT COMPLETE: synthetic real-path test with bounded and rollback-capable controls.
STAGE 4 NOT COMPLETE: activate customer continuity and inspect full same-conversation send+reply test with team coverage.

Owner requested to begin launch 2026-10-27. This authorizes preparation and read-only checks, not an implicit bypass of current merged Agreement. No AWS, DNS, host or buyer-data production mutation performed by this document. Record exact proofs in this existing Draft PR; never auto-merge.
