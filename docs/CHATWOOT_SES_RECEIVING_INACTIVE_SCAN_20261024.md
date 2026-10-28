# BabyPark Chatwoot — SES Receiving inactive resource alternatives scan (2026-10-24)

Status: EVIDENCE — NON-NORMATIVE; this document alone is not AWS authorization.
Applies to: exactly the **inactive, empty AWS resource preparation** slice in account 763345000395, eu-central-1, for future Website Email Continuity of self-hosted Chatwoot 4.18.0.
Supersedes: none. Existing SES sending and previous docs are not changed by this evidence.
Authority: Stanislavikus/babypark-integration; canonical main 1d5d8c00b7fdcdb54f37418ea60931c4292fd600; current main Agreement blob e777fce4af8e8c3372f1f9de9ef7d00f786c2c89. Campaign PR #150 pinned base f3d92325e6b4ef04f0137c4c49dde07c05731bbe; previous HEAD 9adf561e97a6328552cacc390b765a310276f6ff.
UTC scan: 2026-10-24, official documentation rechecked this session.

## Frozen slice requirements

S0.1 Existing Website Inbox and its conversation UUID must remain authoritative; not a new Email Inbox, no custom Chatwoot patches, bridges, Docker or getmail6.
S0.2 Prepare in AWS **only inactive** receipt configuration, one private empty S3 bucket, one SNS Standard topic without subscriptions, and necessary source-scoped permissions. Do not set receipt rule set active. Set individual rule Enabled=false. No messages may flow.
S0.3 No changes to DNS, Zoho apex MX, Website chat, Chatwoot .env, agent mail, existing SES SMTP credentials/IAM, or buyers; no outgoing sends or real inbound messages.
S0.4 eu-central-1 only; one classic SES S3Action with TopicArn in one rule; narrow recipient reply@reply.babypark.ua covering reply+UUID; enable spam/virus scan; support at least 150KB+ emails through S3 (maximum 40 MB).
S0.5 Bucket-level full S3 Public Access Block, BucketOwnerEnforced, SSE-S3 AES256, no object lock/default immutable retention, no SES S3Action KmsKeyArn; scope SES PutObject to exact rule-set/rule SourceArn, account and prefix; SNS topic unsubscribed. Do not create AWS credentials/Chatwoot S3 reader in this phase.
S0.6 Empty staging bucket lifecycle proposal: expire transport objects after 14 days as owner-proposed preliminary value; final retention, privacy/DPA, replay/backup semantics require a separately approved activation gate. The empty bucket is not approval to persist customer text.
S0.7 No SES Production access needed for inactive resource setup; preserve existing SES Sandbox / staff-only SMTP policy. No new AWS budget/account-wide security settings in this slice.
S0.8 Every resource name/region/security/rollback recorded; read-back verify after each write; stop if existing resource unexpectedly differs or required protection cannot be applied. Upstream Chatwoot source remains unchanged.

## Verified discovery paths and candidates

References: https://developers.chatwoot.com/self-hosted/configuration/features/email-channel/amazon-ses-ingress ; https://docs.aws.amazon.com/ses/latest/dg/receiving-email-receipt-rules-console-walkthrough.html ; https://docs.aws.amazon.com/ses/latest/dg/receiving-email-action-s3.html ; https://docs.aws.amazon.com/ses/latest/dg/receiving-email-action-sns.html ; https://docs.aws.amazon.com/ses/latest/dg/receiving-email-permissions.html ; https://docs.aws.amazon.com/ses/latest/dg/receiving-email-notifications-contents.html ; https://aws.amazon.com/ses/pricing/ ; https://aws.amazon.com/sns/pricing/ ; https://getmail6.org/configuration.html ; https://www.chatwoot.com/hc/user-guide/articles/1677843043-how-to-setup-an-email-channel .
Discovery queries: classic SES receipt rules plus addressing; S3Action TopicArn; SNS 150 KB limit; SES verified parent domain and subdomains; SES Frankfurt receiving; AWS source-account/rule S3 policy; SNS same-account SES publish; Chatwoot 4.18.0 SES ingress; Zoho IMAP forwarding getmail6; SES Essentials plans July 2026.

Candidate A: native Chatwoot + SES direct SNSAction: PASS same Website thread and zero new BabyPark code; FAIL attachment/large-message need (SES 150KB limit); security/privacy activation TBD.
Candidate B: native Chatwoot aws-actionmailbox-ses 0.1.0 + classic SES S3Action with **TopicArn** (S3+SNS): PASS same-thread implementation path; PASS 40MB SES S3 limit; PASS no new BabyPark runtime; PASS bounded inactive-only AWS prep with source-scoped policies; privacy/retention PASS for empty inactive scope only, later real-customer activation UNPROVEN. **Preferred for inactive stage.**
Candidate C: native Chatwoot separate Zoho Email Inbox IMAP: FAIL same original Website conversation (IMAP processes own inbox); PASS generic shared helpdesk.
Candidate D: Zoho IMAP + maintained OSS getmail6 (GPL-2.0; exact 6.20.x versions examined): PARTIAL same thread via stock ActionMailbox Relay; PASS free OSS; FAIL operational simplicity for BabyPark because new mailbox, credentials, polling/IDLE/replay process and additional raw copies while outbound still requires SES. Owner has closed this optional bridge for this bounded stage.
Candidate E: Mailgun/other managed inbound webhook and separate outbound provider: PARTIAL stock ingress, higher setup/terms/change burden than existing SES; no stronger proven fit for empty inactive stage.
Candidate F: custom connector/n8n/Docker/Chatwoot patch: FAIL decision order; no proven need; excluded.

**Choice for bounded inactive preparation:** B (one S3 action carrying its own SNS TopicArn). Do NOT also add SNSAction; SNSAction sends full email and caps at 150KB. Official classic receipt rules match user@example.com against user+tag@example.com. Mail Manager rule syntax is a different product and not authority for this classic route. Root babypark.ua verified in this region; this does not remove need for future reply subdomain MX.
**Price snapshot:** AWS now reports CurrentPlan=ESSENTIALS (2026-07 plan change); old references assuming account à-la-carte unconditionally are obsolete. SES, S3 and SNS charge for actual usage. No fixed new service is required for empty, untriggered resources; no zero-cost guarantee. Exact charges before activation require current billing terms and traffic estimates.
**Review classification:** HEAVY at eventual activation due to customer content and public ingress. This stage is explicitly inactive, no production data or public network cutover.
**Decision status:** scan evidence only, not an integration owner GO. The bound fit note and its digest are required first.
