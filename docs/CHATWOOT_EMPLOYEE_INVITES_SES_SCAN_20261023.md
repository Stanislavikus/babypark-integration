# Employee invitations: bounded transport alternatives scan

Status: EVIDENCE — NON-NORMATIVE; no production authorization.
Applies to: employee-only invitation/confirmation/password-reset mail from live Chatwoot v4.18.0 to verified employee mailboxes on `@babypark.ua` using AWS SES `eu-central-1` Sandbox. Explicitly excludes customer/marketing emails and all inbound email continuity.
Supersedes: none.
UTC scan: 2026-10-23; canonical main `f3d92325e6b4ef04f0137c4c49dde07c05731bbe` / Agreement blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.

## Requirements

E1 stock Chatwoot v4.18.0 Devise confirmation/invite/reset delivery for existing pending agents; account roles unchanged. E2 do not rely on SES Production access, explicitly only internal verified-domain recipients. E3 no customer mail or email continuity activated; no Chatwoot core patch, no bridge, no code. E4 working TCP/TLS egress from DigitalOcean droplet via officially supported SMTP endpoint. E5 restricted sender identity, TLS, secrets protected with owner-controlled entry, no raw secrets in logs/terminal history/Git. E6 delivery confirmation to own real employee mailbox via Zoho Mail; explicit rollback/restart and team unaffected until proof; do not recreate existing unconfirmed agents. E7 retain minimal employee PII and standard AWS processing terms, complete legal/access/security check before actual send.

## Reproducible discovery paths/sources

- Official Chatwoot agent guide https://app.chatwoot.com/hc/user-guide/articles/1677482414-adding-agents
- Exact deployed-source tuple `chatwoot/chatwoot@v4.18.0`: `app/builders/agent_builder.rb` (new agent `send_confirmation_instructions`), `app/models/user.rb` (Devise async `deliver_later`), `app/controllers/auth/resend_confirmations_controller.rb` (native POST resend, captcha and rate limits), `app/controllers/api/v1/accounts/agents_controller.rb` (update does not resend), `config/initializers/mailer.rb` (stock SMTP).
- AWS https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html : Sandbox **permits sends to verified domains**, 200/24h, 1/s. AWS verified `babypark.ua` and DKIM PASS observed via AWS API; SendingEnabled=true; ProductionAccessEnabled=false. AWS SES SMTP https://docs.aws.amazon.com/ses/latest/dg/smtp-connect.html and DigitalOcean https://docs.digitalocean.com/support/why-is-smtp-blocked/.
- Zoho Mail existing https://help.zoho.com/portal/en/kb/mail/mail-add-on/articles/what-are-the-ports-supported-by-zoho-mail
- Mailgun free https://www.mailgun.com/pricing/ ; SMTP2GO free https://support.smtp2go.com/hc/en-gb/articles/223087947-Free-Plan ; legacy post-processing getmail6 https://getmail6.org/configuration.html .
- Discovery/query equivalents: `Chatwoot v4.18.0 resend confirmation invite`, `SES Sandbox send to verified domain recipients`, `DigitalOcean SMTP 2587`, `Zoho outgoing SMTP 465 587`, `SMTP2GO free outbound limits`, `Mailgun free sending domain limit`.

## Options per E1–E7

| Candidate | E1/E3 stock Chatwoot | E2 verified-domain sandbox | E4 endpoint | E5 security | E6 integration burden | E7 privacy | Result |
|---|---|---|---|---|---|---|---|
| Native Chatwoot 4.18.0 Devise + current unauthenticated local sendmail | PASS user flow | N/A | FAIL local sendmail not configured | PARTIAL | low but inoperative | PASS local | FAIL for live delivery |
| Native Chatwoot 4.18.0 SMTP + existing AWS SES classic `eu-central-1`, usage metered (0.10 USD/1k outbound published), 200/day Sandbox | PASS | PASS for @babypark.ua *only* | PASS port2587 and STARTTLS TLS1.3 verified | PARTIAL owner-held secret and activation pending | lowest; AWS IAM and identity already configured | PARTIAL AWS DPA/data scope/owner approval needed | **preferred bounded employee-only candidate** |
| Native Chatwoot SMTP + Zoho Workplace existing (paid, mailboxes available) | PASS | N/A | FAIL DigitalOcean denies 465/587 | PARTIAL | high without an SMTP relay | PARTIAL | FAIL from live droplet |
| Native Chatwoot SMTP + Mailgun EU Free (100/day; Free custom domain features conflicting documentation) | PASS | N/A | PASS port2525 previously probed | PARTIAL new account+DNS | higher than preconfigured SES; change provider first | PARTIAL | PARTIAL |
| Native Chatwoot SMTP + SMTP2GO Free (1000/mo) | PASS | N/A | PARTIAL test endpoint/version needed | PARTIAL new account/DNS | higher than preconfigured SES | PARTIAL | PARTIAL |
| Chatwoot UI resend confirmation without transport | PASS initiate | N/A | FAIL without SMTP | PASS | no improvement | PASS | FAIL |
| Custom bridge/n8n/SMTP relay/core patch | FAIL custom-last/core patches forbidden | PARTIAL | PARTIAL | PARTIAL | worse than native | PARTIAL | REJECT |

All mutable prices/terms must be rechecked before adoption. No owned free ready candidate is proven to deliver faster/safer from the live DigitalOcean server than pre-configured SES using **verified-domain-only** mail. No new runtime dependency is required. This evidence is a stage-specific scan, not a statement that customer-email transport is ready.

Decision state: **reference** until separate immutable architecture fit and owner exact-digest production-only activation GO; then owner may approve bounded `integrate` path. Explicit stop if any pending user uses a domain other than `@babypark.ua`, provider restrictions change, or agent status/recipient provenance unknown. Never silently test customer emails or send to non-verified domains.
