# BabyPark — Website Email Continuity native customer-release FIT (2026-10-28)

Status: EVIDENCE — NON-NORMATIVE; DRAFT / **not a customer activation approval, not ZERO BLOCKERS**.
Applies to: only Chatwoot 4.18.0 Website Inbox #2, AWS eu-central-1 SES classic SNSAction/SMTP and the existing reply subdomain.
Supersedes: `docs/CHATWOOT_SES_LIVE_ACTIVATION_FIT_20261027.md` **for the proposed customer release**; old fit and synthetic PoC evidence remain historical and are not rewritten.
Owner: BabyPark. Canonical repo `Stanislavikus/babypark-integration`; governance at proposal start: main `bd1202ae614afcf59bc83e3c733e7e73db4e32ad`, Agreement blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.
Frozen alternatives source: `docs/CHATWOOT_SES_RELEASE_OPTIONS_SCAN_20261028.md`, UTF-8 LF final newline, **SHA-256 `d7e57f53b93bb056a76a8db2923103e09f0923bce7ffa99f5b88fa98f949db00`**.
Recommendation: **keep-existing** stock Chatwoot + native SES Email Continuity, **CONDITIONAL** technical fit, release **HALT until exact review and risk decision**.

## Capability and ownership

Website visitor conversation remains in Chatwoot Inbox #2. When a legitimate, confirmed contact email is associated with the conversation and the visitor is offline, a human agent's nonprivate response may schedule one continuity email from the configured authorised BabyPark sender. Email contains a conversation-scoped `Reply-To: reply+UUID@reply.babypark.ua`; when buyer replies, `reply.babypark.ua` MX leads to SES Frankfurt classic receipt rule, SNSAction UTF-8 publishes to the existing SNS topic, signed HTTPS SNS delivery enters native Chatwoot ActionMailbox/Sidekiq and attaches message to the Chatwoot Website conversation. Chatwoot remains transcript/contact authority, not our repository. The canonical DNS apex `babypark.ua` Zoho MX, all working Chatwoot channels and published BabyPark Launcher/Callback stay untouched. No code, Chatwoot fork, third-party gateway, n8n, new email-provider account or additional mailbox.

Verified **one synthetic-only real bidirectional test** on 2026-10-28: account #1 Website Inbox #2, Contact #134 and Conversation #55. Native outgoing notification was received in owner's Gmail, Gmail synthetic incoming became native Chatwoot `incoming_email` message #229 in exactly conversation #55; owner saw email headers and original From on screen. Multiple distinct outgoing messages #226–228 were observed; no evidence of three duplicate delivered emails. The temporary single-recipient rule was disabled after canary; later Gmail 550 was caused by deliberate no-active-SES-rule rollback. This does not qualify as a customer-wide safety gate or reproduce a sender/recipient mismatch.

## Live configuration at fit preparation; validate afresh before GO

- Chatwoot 4.18.0 account #1 Website Inbox #2 `continuity_via_email=false` **owner-approved on 2026-10-28**. `enable_email_collect=false`, prechat disabled, `hmac_mandatory=false` (do not silently change), no AgentBots observed; two active automation rules only add `callback` label. Website Inbox has **zero real contact-inboxes associated with populated email** at the observed checkpoint, plus the one test contact. No unapproved broad release.
- SES active classic receipt rule set: **NONE**. Existing `babypark-chatwoot-website-inbound-inactive` rule `website-reply-uuid` is disabled and targets `reply@reply.babypark.ua`; AWS SNSAction UTF-8 is current live installed receiver (older proposal's S3Action is stale). Keep original other AWS objects safe.
- SNS topic `arn:aws:sns:eu-central-1:763345000395:babypark-chatwoot-website-inbound`, confirmed HTTPS subscriber `https://chat.babypark.ua/rails/action_mailbox/ses/inbound_emails` with a native 63-retry DeliveryPolicy and the SSE-SQS DLQ `arn:aws:sqs:eu-central-1:763345000395:babypark-chatwoot-website-sns-dlq`, retention 4 days. HTTP 204 from ActionMailbox is only acceptance; downstream Sidekiq handling needs separate monitoring/recovery.
- Cloudflare reply subdomain `reply.babypark.ua` MX points at `inbound-smtp.eu-central-1.amazonaws.com`; apex Zoho MX unchanged. Runtime `RAILS_INBOUND_EMAIL_SERVICE=ses`, `MAILER_INBOUND_EMAIL_DOMAIN=reply.babypark.ua`, SNS topic configured in protected `.env`; never publish secrets. Preserve inbound domain even when continuity off.
- AWS SES Production Access previously GRANTED; IAM sender `support@babypark.ua` established, external mail delivery proven by one synthetic Gmail delivery. Refresh SES account standing, IAM exact sender/recipient guards, actual commercial terms/quotas, SES destination and DKIM before release. Do not claim all buyer sending authorised from a one-address test.

## Security and contact identity — release decision required

**B01 (Codex):** standard Chatwoot globally locates a conversation by UUID from MIME threading, not a proof of authorised sender/SES RCPT-to-UUID binding. **B02:** inbound sender is stored as `conversation.contact` even where actual email sender differs; agent UI's displayed `email.from` may be `Reply-To` rather than original MIME `From`. UUID possession may let a third party append forged messages to the right conversation; no automatic read of old transcript or third-party receipt of subsequent agent mail was demonstrated. No verified native setting or v4.19.1 remediation for these behaviours. Human-only does NOT prevent misattribution inside Chatwoot; it can reduce downstream authorisation errors but is not an upstream code fix.

**Independent upstream website contact identity risk:** open [Chatwoot #16186](https://github.com/chatwoot/chatwoot/issues/16186) concerns unverified widget visitor merging with another CRM contact by supplied email, with modification/conversation attribution risk under `hmac_mandatory=false`. This is separate from B01/B02, exists independently of SES and may remain reachable when the visible Email Collect form is off. Turning on HMAC alone is NOT assumed sufficient across all widget routes; isolate/independently validate concrete native mitigation and its effect on anonymous visitors/Callback before authorising broader contact-based email or claiming fail-closed identity.

**Boundary for any future owner risk acceptance:** 
- Incoming email, Reply-To, MIME From, website visitor claims, display name and existing Chatwoot CRM association are **unverified identity claims**, not authorisation; no AgentBot/AI/automatic customer-sensitive action on these messages.
- Human agents must independently confirm identity via an already trusted order-linked channel before modifying order, delivery, contact fields, payments/refunds, or sending confidential/previous correspondence to a new address.
- Never merge contacts by unverified email. Email Collect stays OFF unless separately owner-approved after vendor/identity validation.
- New webhook, AgentBot, Captain or AI First Line integration into Inbox #2 invalidates this human-only fit until a separately proven fail-closed email gate. 
- Owner must explicitly accept/reject the residual B01/B02 sender-integrity and #16186 cross-contact impact after independent review. Owner preference alone is not evidence of satisfying the Agreement §4 unknown-sender fail-closed invariant; if no native safe fit is demonstrable, **HALT and escalate to Chatwoot** rather than invent a waiver/custom patch.

## Privacy, retention and limits

No new BabyPark text store or content digest. Raw MIME is ingested by stock ActionMailbox/Chatwoot ActiveStorage; earlier assessment suggests ~30 days for `inbound_emails` records but this is **not yet a production-verified retention policy**. SNS DLQ holds notification content up to four days (verified queue setting); queue items may be lost after retention unless monitored/recovered. Native SNSAction hard maximum **150 KB total email including headers**; large photos bounce, not silently accepted. Confirm backup retention, Access and admin roles, vendor subprocessors, applicable Ukraine privacy notice, actual controller/processor arrangements and data minimisation with privacy/legal owner before customer activation. Do not deploy a 14-day S3Action lifecycle on an SNSAction route or claim staged S3 objects exist. Human agent instructions must explain photo/large-attachment alternative (Website chat or verified alternate channel).

## Operational states and transitions

| State | Website continuity | SES receipt set | What happens |
| --- | --- | --- | --- |
| **PARKED — NOW** | OFF | NONE; prepared rule disabled | No new continuity mails; previous emails' Reply-To can return SMTP 550. This is interim pre-launch state, not valid rollback after public launch |
| **RECEIVE-READY** | OFF | Working rule active for `reply@reply.babypark.ua` only | Replies to already sent emails can arrive, no new continuity mails |
| **LIVE** | ON | Same working rule active and verified | Both directions enabled; human-only processing |
| **OUTGOING STOP** | OFF | **Keep working rule active** | Let delayed Sidekiq `ConversationReplyEmailJob` finish, preserve all previously issued reply addresses |
| **EMERGENCY REJECT** | OFF first, jobs drained; emergency set active only with owner authorisation | SES maintenance BounceAction with verified Sender, informative message | Intentionally reject inbound replies (incident response ONLY); not the normal rollback or continued receiving |

**Activation sequencing:** verify backups, legal/access/retention, human instructions, upstream identity handling and release evidence; finish all synthetic/native test cases. Activate scoped **inbound SES first** (only reply technical domain, not apex Zoho); verify it accepts expected synthetic reply and rejects off-domain/invalid identifiers without routing to other conversations; then enable outgoing `continuity_via_email` last. Verify support-email From, Reply-To and actual Gmail receipt. Re-read all state after each write; unknown mismatch => stop. Identity/path test involving spoofing or third-party contact merge belongs in **isolated synthetic environment**, not production buyer records.

**Routine stop/rollback:** set continuity OFF first, independently verify no remaining delayed `ConversationReplyEmailJob` in Sidekiq Scheduled/Retry/executing/mailers, but leave working SES inbound active indefinitely for already-issued Reply-To URLs. If the SES backend is impaired, use the existing ~58-minute retry + DLQ window, monitor Sidekiq Dead and provider bounces; escalate rather than destroy live reply routing. Emergency BounceAction is a separate approval/mode, not a simple rollback. The one-address synthetic canary had an intentionally different rollback contract, not reusable for customers.

## Acceptance/tests required before LIVE

1. Freeze exact owner-approved target and required-verification-manifest SHA-256, classify HEAVY, trace requirements to stock settings+tests; preserve exact HEAD/tree/base/governance tuple. Complete exhaustive independent R1 + context-isolated R2 on unchanged final tree, zero open BLOCKERs. Never auto-merge or activate.
2. Read-only preflight: Chatwoot 4.18.0, Inbox 2, agent access/allowed contact editing, zero bots/automations with customer send, no unexpected webhooks, `continuity=false`, `EmailCollect=false`, DNS and SES identities, exact SRC/DST; backups/recoverability, privacy retention, IAM sending least privilege, Sidekiq/ActionMailbox health and quotas.
3. **Prove #16186/native widget contact mitigation or obtain clearly bounded risk decision consistent with Agreement §4**: include non-identifying isolated 2-visitor synthetic tests, with HMAC mandatory/optional and no identifier, alternate contact update/merge paths; no real customer contact manipulation. A blind HMAC checkbox is NOT sufficient proof.
4. T1 existing #55 or fresh synthetic contact: real external Gmail → exact original Website conversation, one incoming email, correct displayed headers, actual MIME From and Reply-To audit where supported. T2 outbound nonprivate operator message offline → exactly one email notification received and Reply-To functional. Do not send customer data, bulk test, or add duplicate external recipients.
5. T3 isolated synthetic mismatch From≠Reply-To and wrong/unknown UUID, no wrong-conversation assignment; document observed default behaviour and issue owner risk decision. T4 synthetic 150 KB boundary with sender bounce and readable error (isolated or approved narrow producer test); verify no silent success claim. T5 Ukrainian subject/body and safe handling of attachments/no unexpected raw duplicates.
6. T6 controlled Sidekiq scheduled-job transition: turn OFF continuity after a synthetic operator reply and prove already-scheduled mail can still be delivered; verify drain before stop. T7 emergency maintenance BounceAction with SES verified Sender and approved message, only if emergency-mode deployment is separately authorised; verify switching back to working receipt set without sending real customer data.
7. Monitor SNS HTTP delivery, SQS DLQ counts/age/redrive manual runbook, ActionMailbox/Sidekiq Dead/Retry, SES bounces/complaints, anomalous contact merges and nonreplyable addresses. Configure owned alert route; no unapproved alarm costs or IAM changes.
8. Independent runtime + exact Git + human procedure verification, explicit owner GO on final digest/bundle only; LIVE is a distinct write with separately reconfirmed state.

## Open decisions (BLOCK for customer launch until resolved)

- D1: owner acceptance of B01/B02 and #16186 contact-risk **after** validated test and maintained vendor evidence; does it comply with §4 fail-closed? If not: stock workaround/provider fix or HALT, no core patch.
- D2: legal/privacy owner confirmation of actual ActionMailbox raw-mail retention, DLQ 4-day lifecycle, privacy terms/processor locations and handling of personal documents; verify before real buyer ingress.
- D3: agent SOP approval, explicit no automatic bot/AI routing for email message, trusted-contact confirmation workflow and email/address correction procedure.
- D4: native AWS incident-mode choice: whether to prepare a maintenance SES BounceAction rule set, verified sender, associated cost, alarm and approval; no automatic bounce deployment by this document.
- D5: separate immutable manifest, exact HEAD/tree/base recheck, exhaustive HEAVY ZERO BLOCKERS closure, final owner GO. This document is a candidate artifact only.

No changes to code, Chatwoot, DNS, SES, Cloudflare, Gmail, SMTP or contact data were authorised by writing this FIT.
