# BabyPark Website Email Continuity — release-stage native-first options scan (2026-10-28)

Status: EVIDENCE — NON-NORMATIVE; release proposal, not activation approval.
Applies to: `Stanislavikus/babypark-integration`, Chatwoot self-hosted v4.18.0 Website Inbox #2 and existing AWS SES Frankfurt native email continuity only.
Supersedes: `docs/CHATWOOT_SES_ALTERNATIVES_SCAN_20261023.md` **for the 2026-10-28 release decision only**; older evidence retained for historical stages.
Owner: BabyPark. Scope: same Website conversation, offline agent reply by email and buyer reply into that same thread, human-only handling, ordinary staff SMTP/Zoho unaffected.

## Verification basis and requirements

Scan date UTC: 2026-10-28. Canonical main `bd1202ae614afcf59bc83e3c733e7e73db4e32ad`; governance Agreement blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`. The release carrier is Draft PR #150, never an automatic merge. Confirm exact final HEAD/tree/base again before gating.

Mandatory requirements:
R1 — Chatwoot-native Website Inbox #2 and same original conversation; no Email Inbox substitution that changes thread identity.
R2 — live bidirectional email via SES SMTP, `reply+UUID@reply.babypark.ua`, SES classic SNSAction → confirmed SNS HTTPS → installed native ActionMailbox; no Chatwoot core patch or bespoke adapter.
R3 — preserve original Zoho apex MX, all messaging channels, existing launcher/Callback and employee SMTP.
R4 — PII, identity and contact integrity: anonymous/unknown email is NOT verified identity; no automated trusted business action, no bots/AI on email conversations; any contact rebind by unverified email is a separate unresolved upstream risk.
R5 — keep already-issued Reply-To addresses functional after disabling new continuity notifications; Sidekiq delayed mail jobs require a drain check.
R6 — failures after SNS HTTP 204 need Sidekiq/ActionMailbox recovery monitoring; SNS's ~58-minute retries/DLQ do not cover accepted-but-unprocessed jobs.
R7 — data-processing authorization/retention/privacy, protected credentials, accurate infrastructure inventory and rollback identities, independent HEAVY review and exact-owner GO before customer ingress.
R8 — control known limitations: 150 KB SNSAction total MIME limit, email spoofing/Reply-To vs MIME From, UUID disclosure via forwarding, incorrect email addresses, external-service pricing and usage caps.
R9 — official paths first, license compatible with commercial operation, no new account/provider or extra paid endpoint by default.

## Source and market/implementation discovery

Explicit re-check paths: Chatwoot official conversation-continuity guide `https://developers.chatwoot.com/self-hosted/configuration/features/email-channel/conversation-continuity`; SES ingress `https://developers.chatwoot.com/self-hosted/configuration/features/email-channel/amazon-ses-ingress`; native Chatwoot release v4.18.0 `https://github.com/chatwoot/chatwoot/tree/v4.18.0`; 4.19.1 release `https://github.com/chatwoot/chatwoot/releases/tag/v4.19.1`; Chatwoot widget identity-validation guide `https://www.chatwoot.com/hc/user-guide/articles/1677587479-how-to-enable-identity-validation-in-chatwoot`; upstream widget identity report `https://github.com/chatwoot/chatwoot/issues/16186`; AWS classic receipt rules `https://docs.aws.amazon.com/ses/latest/dg/receiving-email-receipt-rules-console-walkthrough.html`; SNSAction `https://docs.aws.amazon.com/ses/latest/APIReference/API_SNSAction.html`; BounceAction `https://docs.aws.amazon.com/ses/latest/dg/receiving-email-action-bounce.html`; SNS retries `https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html`; AWS SES current plan `https://aws.amazon.com/ses/pricing/`.

Candidate scope/cost/license references: Chatwoot self-hosted community MIT (check current edition/install entitlements before customer GO), installed `aws-actionmailbox-ses 0.1.0` Apache-2.0, existing AWS managed SES/SNS/SQS metered under the account's actual plan. No Chatwoot paid seat requirement assumed for stock Website continuity. Re-check terms/fees/retention and operational limits at the final activation gate; unchanged history is not proof of immutable managed-provider terms.

| Candidate | Same Website conversation | Delivery / fit | Risk and deployment cost | Decision |
| --- | --- | --- | --- | --- |
| **A: existing Chatwoot 4.18.0 + SES classic SNSAction/SMTP** | YES; one real synthetic Gmail↔Chatwoot E2E passed on 2026-10-28 | All stock, confirmed SNS, native SMTP, 63 retries + SQS DLQ; no core patch | B01/B02 source attribution; widget contact merge #16186; 150 KB MIME; provider retention/Sidekiq; existing metered SES | **PoC PASS / proposed conditional integrate**, ONLY after documented risk decision and release gates |
| Existing SES S3Action + SNS (older plan) | Possible, not proven live on current active receiver | Needs different AWS action and S3 SDK access/credential custody | 40 MB path more complex and not current production transport | DEFERRED; no silent change from proven SNSAction |
| Separate Chatwoot Email Inbox with Zoho IMAP/SMTP or SES | Different Email conversation | Stock for standalone email | Loses original Website conversation continuity; still subject to email spoofing | FAIL R1; possible future standalone channel, out of scope |
| Mailgun/SendGrid/Brevo or SES Mail Manager | No proven drop-in for current Chatwoot Website UUID receiver | Requires new provider/plugin or unproven adapter compatibility | More processors, money, DNS and integration complexity; Mail Manager additional standing cost | PARTIAL/DEFERRED; not faster/proven than already installed native path |
| Chatwoot 4.19.1 upgrade alone | No difference to required trust boundaries per independent Codex review | General security hardening useful separately | Not a B01/B02 remediation and upgrades whole platform | DEFERRED until after email release per owner |
| Custom relay, Chatwoot fork/core patch | Could theoretically enforce further checks | Unnecessary bespoke implementation versus native function | Violates integration-first and core-patch prohibition | REJECTED |

## Fit boundary and resolution

Recommendation for release preparation: **keep-existing / CONDITIONAL integration proposal**, not permission to activate. Freeze and separately approve exact release Fit (SHA-256) and risk acceptance, including response to upstream #16186. The native path works in a single synthetic controlled test; that does not certify arbitrary customer sender identities, all mailbox outcomes or safe contact merges.

**Non-negotiable stop:** if the applicable Agreement's fail-closed sender/contact-ownership rule cannot be met by native behavior or explicitly owner-approved bounded human handling after full independent review, do not reinterpret this scan as a waiver. Escalate to maintainer (private security disclosure) and retain customer Email Continuity OFF.

No scripts/services/code/secret material were introduced by this scan.
