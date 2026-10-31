# Chatwoot SES classic email transport — bounded architecture fit and activation checklist

Status: EVIDENCE — NON-NORMATIVE; PROPOSED reference fit only, NOT authorization to deploy.
Applies to: BabyPark self-hosted Chatwoot 4.18.0 on `chatwoot-fra1-01`; Website same-conversation email continuity + system mail + native team alert.
Supersedes: none.
Candidate: AWS SES classic sending/receiving in `eu-central-1`, SMTP 2587 + SES receipt S3 action/SNS notification + native Chatwoot/Rails ActionMailbox SNS receiver, `aws-actionmailbox-ses` 0.1.0 (locked). No SES Mail Manager. No production core patch, n8n, adapter or new runtime dependency.
Alternatives scan: `docs/CHATWOOT_SES_ALTERNATIVES_SCAN_20261023.md` normalized UTF-8/LF/final-LF SHA-256 `048c1df03e7bc081bbb60bcf40f79a7969aea2e7c54cb64f133f58b7fa1c5ed7`.
Canonical main: `f3d92325e6b4ef04f0137c4c49dde07c05731bbe`, tree `ffb8953002feaeb5f417a09a832c86f24051afa2`, Agreement blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.

## Bounded functionality and boundaries

- Preserve production BabyPark Drupal contact launcher + Chatwoot Website Inbox, Zoho root-domain MX, Zoho `sales@` group alias `contact@babypark.ua`; do not create a separate Chatwoot Email Inbox.
- SMTP sends from two intended verified domain identities: `Chatwoot <support@babypark.ua>` for system mail and customer-facing `contact@babypark.ua` only where native Chatwoot sender/account/inbox state actually supports it. Do not silently assume two different global mailer senders work independently: `MAILER_SENDER_EMAIL` is a **single global default**. If stock Chatwoot cannot ensure the desired distinction through verified account/inbox settings, report the gap and use a single explicitly owner-approved sender instead, never custom code by default.
- Outbound mail to offline Website visitor only if native continuity is enabled, the Chatwoot contact has a proven email, and the visitor did not already see the response; the reply envelope must contain `reply+<conversation UUID>@reply.babypark.ua` and re-enter the **same** Website conversation. No personal agent email in From/Reply-To.
- Native notification intended: `message_created` with Website inbox ID and `message_type=incoming` AND non-private; action `send_email_to_team(Продажі)`. This is an alert, not assignment or ownership guarantee. Test every-message volume, mailer limits and already-open / absent agent cases. No unbounded duplicate notification storm.
- Internal helpdesk operations remain Chatwoot-native. Team triage responsibility and absent-agent routing MUST be proven separately before calling coverage reliable.
- Production customer message content stays authoritative in Chatwoot. SES/S3 are untrusted/transient transport only; raw MIME in an external S3 object requires separately reviewed retention, deletion, EU residency/DPA, access controls and an explicit Agreement §4 compatibility decision. Do not assume a 1-day lifecycle makes routine durable storage permissible.

## Product/version/terms and observed reality

- Native application: `chatwoot/chatwoot@v4.18.0`; `config/initializers/mailer.rb` supports `RAILS_INBOUND_EMAIL_SERVICE=ses` and `ACTION_MAILBOX_SES_SNS_TOPIC`. `app/services/messages/send_email_notification_service.rb` requires contact email + inbox `continuity_via_email`. `app/mailers/team_notifications/automation_notification_mailer.rb` requires SMTP_ADDRESS.
- Provider: AWS SES managed commercial metered service, no OSS license claim. `aws-actionmailbox-ses` shipped in Chatwoot dependency lock 0.1.0; official gem integrates SNS signature/topic and S3/raw emails; use stock API/initializers, no patch. Terms publicly observed 2026-10-23: à-la-carte $0.10 per 1,000 outbound emails and $0.10 per 1,000 inbound plus chunk, storage, SNS and possible ancillary usage. No minimum SES base fee, but costs and terms mutable; account billing guard not yet verified. Source https://aws.amazon.com/ses/pricing/ and https://github.com/aws/aws-actionmailbox-ses-ruby .
- Owner-supplied screenshots show SES `eu-central-1` identity domain `babypark.ua` Verified, SPF/DKIM sending, default à-la-carte, request to exit Sandbox Under review (as of 2026-10-23T12:14Z screenshot context; current status unknown), feedback forwarding enabled and suppression list for bounce+complaint enabled; IAM principal created with only group policy `ses:SendRawEmail` conditioned `ses:FromAddress` in [contact@babypark.ua, support@babypark.ua], no console access. AWS authoritative API recheck is NOT available from this session. Credentials are held by owner, never provided to assistant/GitHub.
- Direct read-only host `chatwoot-fra1-01` evidence: web + worker active; `https://chat.babypark.ua/` HTTP 200; SES host `email-smtp.eu-central-1.amazonaws.com:2587` TCP/EHLO/STARTTLS/TLS1.3 PASS. Public DNS all 3 `babypark.ua` DKIM CNAME PASS, apex Zoho MX intact, DMARC `p=quarantine`. Technical subdomain `reply.babypark.ua` MX missing. Env `SMTP_ADDRESS` blank, `SMTP_PORT=1025`, `MAILER_SENDER_EMAIL=Chatwoot <accounts@chatwoot.com>`, `MAILER_INBOUND_EMAIL_DOMAIN` unset, `RAILS_INBOUND_EMAIL_SERVICE` unset; `.env` owner `chatwoot` with mode 0600. Current sender would NOT satisfy IAM restriction.
- From earlier 2026-10-22 scoped live app inspection: Website Inbox ID 2, account ID 1, `EMAIL_COLLECT=false`, `CONTINUITY_VIA_EMAIL=true`, account support_email present BUT not same as contact alias, inbound domain absent, reply-mailer migration disabled. This evidence must be freshly verified before activation. Do not switch email-collect back on without approved UX/privacy.
- Provider API/management access, current actual team/inbox/automation/SMTP rates, S3/SNS resources and operational budget are presently **unknown**; nothing in a screenshot establishes existence of missing infrastructure.

## Failure isolation, concurrency, security and rollback

- Outbound: verify SES Production status and correct sender identity before **any** real-recipient use. Sandbox should be treated as non-production; no customer/employee bulk tests. Use SES SMTP on 2587 with STARTTLS; `SMTP_AUTHENTICATION=login`, `SMTP_ENABLE_STARTTLS_AUTO=true`, `SMTP_SSL=false` only after checking exact installed configuration defaults. Install `SMTP_USERNAME` + `SMTP_PASSWORD` into approved mode-0600 secret source; never echo/log or commit; never put secret in shell history or Git.
- Global SMTP activation affects *all* Chatwoot system notifications; Stage-0 test must use a scoped, isolated Chatwoot environment. Production service restart must have owner-bound fit, verified backup/recovery, rollback of exact nonsecret config, and no customer-facing unexpected send.
- Inbound: SES receipt rule for **technical subdomain only**; SNS topic subscribed to public HTTPS `/rails/action_mailbox/ses/inbound_emails`; topic allowlist/signature verification; S3 raw MIME only within explicitly approved transport TTL/PII envelope. Ensure AWS SDK credentials/role (separate from outbound SMTP principal) only `s3:GetObject` of controlled prefix; S3 bucket policies allow SES write; SNS topic subscription binding; bucket encryption compatible with the exact 0.1.0 client (avoid client-side KMS encryption unless native client support is proven). Direct SNS raw-content cap 150KB is not acceptable for typical attachments; use S3 path when legally allowed.
- Failure tests with purely synthetic data: wrong/expired SNS signature, wrong topic, S3 nonexistent/object denied, duplicate/replayed SNS events, concurrent delivery, worker downtime/Sidekiq dead set and retries; >150KB attachments, malformed MIME, unknown recipient UUID, email-only reply to already-open conversation; no personal agent reply address; no accidental new Email Inbox. Proven 204 response behavior must match SNS retry semantics. No leaks in debug logs or notification payload.
- Outbound fallback: before activation preserve exact nonsecret `.env` values and restore them atomically in failure; keep `.env` mode 0600, restore web+worker, verify HTTP/Sidekiq/website launcher unchanged and absent unauthorised mail activity.
- Incoming rollback: first disable SES receipt rule/SNS subscription and restore technical subdomain MX if touched; preserve Zoho apex MX and all validated DKIM. Minimize PII in CloudWatch/SNS, enforce retention and incident response.
- Service bounce/complaint: SES suppression enabled; separate SNS event-to-email subscription for `it@babypark.ua` is approved direction but not configured; mandatory real delivery check and assigned administrator SOP.
- Account limit: native `ACCOUNT_EMAILS_LIMIT` config default 100/day (actual runtime unknown). `Message Created` sends one team email addressed to multiple agents, and may hit limits; test cancellation, no assignment transfer, alert deliveries, employee absences and recipient privacy.

## Scope / proof / unresolved fit and exact stop

The AWS account and DNS owner has manually prepared verified sender identity, DNS DKIM, limited IAM SMTP user and requested Sandbox exit before any complete normalized fit approval. Their existence is evidence of preparation, **not** an excuse to skip Agreement §§2.0a,3,4 or to make production configuration changes. The proposed candidate is not yet an independently verified live production fit due to:
1. AWS console/API access to SES Production status and actual principal policy, current SES usage/price and confirmed resources not connected;
2. customer/employee addresses and current team / inbox / account.support_email / existing automations not freshly confirmed;
3. live Send-From split and Reply-To behavior unproven under exact v4.18.0 and IAM;
4. technically required inbound S3+SNS, SES receipt/MX route and external transport durable customer-data legality/retention/backup/monitoring unresolved;
5. global SMTP safety, rate limits, IT feedback delivery, unknown mailer failures and rollback rehearsal pending;
6. independent synthetic, fail-closed end-to-end test not run.

**Recommendation: reference** (not `integrate`, `PoC-only` or `build` authorization). A separately scoped test may later be proposed using strictly isolated non-production AWS credentials/endpoints and wholly synthetic contacts, with exact exit criteria and stop condition, then new digest-bound owner GO. Production may proceed only after complete scope-specific fit and explicit owner approval referencing normalized scan and fit digest, independently checked implementation evidence, and fresh production go-ahead. There is no grant here to insert SMTP secrets, restart production, enable SES receipt rules or send buyer emails.

## Operational gate checklist (not yet executable authorization)

- [x] Public DNS DKIM 3/3; Zoho MX preserved; TLS port 2587 and host live
- [x] Mode 0600 `.env`; SMTP principal group policy shown in owner AWS screenshots
- [ ] SES Production access approved or isolated verified-sender scope bound
- [ ] Evidence/frozen scan and production fit approved by owner via exact digest
- [ ] Account sender/Reply-To verified on exact Chatwoot runtime without customer exposure
- [ ] SES S3/SNS/Email Receiving data-processing/access/retention approved and tested
- [ ] Isolated synthetic end-to-end send → reply same Website conversation PASS
- [ ] Native team alert real delivery / multi-agent / absent-assignee / Open status and mail volume PASS
- [ ] System email sender `support@` and safe SMTP secret placement + test PASS
- [ ] SNS bounce + complaint delivery to `it@` and handler response PASS
- [ ] Final source/runtime consistency, backup rollback, deployment gate and owner GO
