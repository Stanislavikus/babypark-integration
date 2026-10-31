# Chatwoot Website Email Continuity + System Mail: alternatives scan

Status: EVIDENCE — NON-NORMATIVE; unmerged and not an implementation authorization.
Applies to: BabyPark self-hosted Chatwoot v4.18.0; one bounded SES email-transport and native Sales-team-alert slice.
Supersedes: none.
Scan UTC: 2026-10-23T13:00:53Z.
Canonical base: `f3d92325e6b4ef04f0137c4c49dde07c05731bbe`; tree `ffb8953002feaeb5f417a09a832c86f24051afa2`; Agreement blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.
Purpose: fulfill Agreement §§1–3 options inventory, not to waive §§2.0a/4 or represent a completed §3 production fit.

## Frozen bounded requirements

R1: stock Chatwoot Website conversation continuity; inbound email must join the **same Website conversation** via `reply+UUID`, not a new Email Inbox.
R2: all outbound system mail (invites/password resets/team alerts) through stock Chatwoot SMTP; customer conversations use public identity, system notices `support@babypark.ua`, no agent personal address disclosure; validate actual account support/reply-from configuration.
R3: no root `babypark.ua` MX/SPF/DMARC replacement; Zoho `contact@babypark.ua` remains group alias; inbound technical `reply.babypark.ua` may have isolated MX after approval.
R4: works with DigitalOcean SMTP 25/465/587 restriction and existing Chatwoot v4.18.0 without core patch or new BabyPark production code.
R5: low, controlled cost; no fixed-fee Mail Manager; managed-service fees permitted only by owner after evidence; free ready alternative preferred if complete proven fit.
R6: email/SNS authentication, least-privilege IAM, safely stored secrets, verified TLS, bounce/complaint suppression, safe retries/duplicates, monitoring, fail-closed and deterministic rollback.
R7: protect personal data, transient transport retention, explicit privacy/legal/DPA and backup/access boundary; no routine BabyPark-owned raw customer transcript storage outside Chatwoot.
R8: all new inbound mail states/attachments/unknown MIME and reply mapping fail closed; no customer-facing activation before isolated synthetic tests and exact approved production fit.
R9: notify `Продажі` for *incoming* messages even if Website conversation remains Open and assigned; avoid outgoing/private-note loops, rate-limit exhaustion and duplicates; team email alert is not handoff/reassignment.
R10: documented operational ownership/recovery; retain existing launcher/widget, no AI or other customer messaging modifications.

## Actual sources and discovery paths, checked 2026-10-23

- Native deployed-version source: `chatwoot/chatwoot@v4.18.0` (GitHub exact tag); `config/initializers/mailer.rb`, `app/listeners/automation_rule_listener.rb`, `app/services/automation_rules/action_service.rb`, `app/mailers/team_notifications/automation_notification_mailer.rb`, `app/services/messages/send_email_notification_service.rb`, `Gemfile.lock`.
- Chatwoot official: https://developers.chatwoot.com/self-hosted/configuration/features/email-channel/conversation-continuity ; https://developers.chatwoot.com/self-hosted/configuration/features/email-channel/amazon-ses-ingress
- AWS official: https://aws.amazon.com/ses/pricing/ ; https://docs.aws.amazon.com/ses/latest/dg/smtp-connect.html ; https://docs.aws.amazon.com/ses/latest/dg/receiving-email-action-s3.html ; https://docs.aws.amazon.com/ses/latest/dg/receiving-email-action-sns.html ; https://github.com/aws/aws-actionmailbox-ses-ruby
- Mailgun EU Free: https://www.mailgun.com/pricing/ ; https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/receive-http ; https://www.mailgun.com/about/regions/
- Zoho official ports: https://help.zoho.com/portal/en/kb/mail/mail-add-on/articles/what-are-the-ports-supported-by-zoho-mail
- DigitalOcean official restriction: https://docs.digitalocean.com/support/why-is-smtp-blocked/
- Other owner/discovered candidates: SMTP2GO Free https://support.smtp2go.com/hc/en-gb/articles/223087947-Free-Plan ; maintained getmail6 https://getmail6.org/configuration.html ; Zoho Mail outgoing webhooks https://www.zoho.com/mail/help/dev-platform/webhook.html .
- Previous reference-only research: PR #142 comments 6348368072, 6350961229, 6358513047, 6362282684. Queries represented above: `Chatwoot v4.18.0 SES ingress SNS`, `Amazon SES classic S3 SNS SMTP 2587`, `Mailgun free incoming route 204`, `Zoho Mail SMTP supported ports`, `DigitalOcean SMTP blocked`, `SMTP2GO free inbound route`, `getmail6 Zoho IMAP ActionMailbox relay`.

## Candidate fit by requirement class (PASS / PARTIAL / FAIL)

| Candidate, identity/version and terms | R1 same thread | R2+R4 SMTP/native | R3 root MX | R5 commercial | R6–R8 privacy/operations | R9 team coverage | Conclusion |
|---|---|---|---|---|---|---|---|
| Stock Chatwoot 4.18.0 alone; self-hosted OSS | PARTIAL (native continuity needs ingress) | PARTIAL (native SMTP needs transport) | PASS | PASS | PARTIAL | PARTIAL (rule exists, untested) | retain as application foundation, not full email transport |
| Zoho Mail EU SMTP+JSON webhooks; paid Workplace existing | FAIL (webhook payload not raw MIME relay) | FAIL (ports only 25/465/587 blocked) | PASS | PASS existing subscription | PARTIAL | PARTIAL | no complete native fit; no custom Deluge bridge |
| AWS SES classic SMTP 2587 + S3+SNS ingress, managed à-la-carte, `aws-actionmailbox-ses` 0.1.0 | PASS in source, E2E unproven | PASS transport; live TCP/STARTTLS TLS1.3 verified | PASS with isolated MX | PARTIAL (metered $0.10/1k outbound, $0.10/1k inbound + S3/SNS, no fixed base) | PARTIAL (sandbox, isolated fit, durable S3 PII/retention, IAM/SNS/retries unresolved) | PARTIAL (native action exists, never validated live) | preferred candidate for bounded evidence/PoC, NOT production-ready |
| Mailgun EU Free, managed Free 100 sends/day, 1 custom sending domain, 1 inbound route, 1-day message/log retention | PARTIAL (Mailgun docs HTTP 200, native Rails endpoint 204 mismatch untested) | PASS native SMTP on 2525; live port seen open previously | PARTIAL (signing/DMARC alignment must prove) | PASS subject to live signup/version/account limits | PARTIAL (DPA, 204 retry semantics, exact payload and no lost mails) | PARTIAL | free ready candidate materially plausible but unproven, cannot dismiss or declare complete fit |
| SMTP2GO Free outbound + AWS/Mailgun ingress | PARTIAL | PARTIAL (two providers) | PASS | PARTIAL (free SMTP2GO limits) | PARTIAL (two vendor credentials and failure points) | PARTIAL | no single-provider complete native fit |
| Zoho IMAP mailbox + getmail6 (maintained OSS GPL) + Rails relay + separate outbound SMTP | PARTIAL (requires real IMAP mailbox/catch-all, not current group alias) | PARTIAL | PARTIAL | PARTIAL (extra mailbox/provider) | PARTIAL (polling/relay/retries and durable MIME) | PARTIAL | operationally heavier; no native full fit |
| SES Mail Manager ingress (managed, priced) | PARTIAL | PARTIAL (still need continuity ingress integration) | PASS | FAIL fixed $50/month Open Ingress Endpoint | PARTIAL | PARTIAL | excluded; unnecessary paid SKU |
| Custom n8n/Deluge/Chatwoot core patch | PARTIAL (hypothetical) | PARTIAL | PARTIAL | PARTIAL | FAIL maintenance/fail-closed proof | PARTIAL | excluded by native-first/no-custom and no core-patch rules |

Versions and availability: Chatwoot exact deployed v4.18.0 source, Rails SES integration gem `0.1.0` from lock. Managed provider APIs, tariffs, support and DPA are mutable and MUST be revalidated before production activation. No paid provider has been licensed by this scan; Mailgun free tier is not proven an operational fit despite published feature list. This matrix records independent requirement-class results; no single aggregate PASS.

## Direct observed evidence (no customer traffic)

Owner screenshots (not AWS API attestation): SES Frankfurt `eu-central-1` à-la-carte, identity `babypark.ua` Verified, SES Sandbox production-access request Under review, suppression list Enabled for Bounce + Complaint, email-feedback forwarding Enabled, SMTP IAM principal `babypark-chatwoot-ses-smtp` in single-member group with `ses:SendRawEmail` and `ses:FromAddress` values contact@ and support@. IAM scopes NOT independently verified by provider API.
Live authorized read-only server probe: port 2587 TCP, EHLO STARTTLS, TLS1.3 PASS; HTTPS Chatwoot HTTP 200; systemd web+worker active; `.env` owner chatwoot mode 600; SMTP_ADDRESS/username/password missing, SMTP_PORT 1025, MAILER_SENDER_EMAIL still `Chatwoot <accounts@chatwoot.com>` (incompatible with restricted IAM); `reply.babypark.ua` no MX; public 3/3 SES DKIM CNAME PASS; apex MX still Zoho; root DMARC quarantine intact. No credential has been read or copied; no live application SMTP activation.

## Decision and stop boundary

Recommendation: **reference**. AWS SES classic is the currently preferred provider for **a separately approved bounded synthetic PoC**, not a proven production fit. Continue *reference-only* until the §3 fit note and reproducible scan are frozen and their digests explicitly approved for the exact bounded scope. No Chatwoot runtime configuration writes, AWS resource mutations, DNS ingress/receipt activation, customer messages or SMTP credential installation are authorized by this scan. Do not let incidental owner-created IAM/domain objects count as integration approval.
