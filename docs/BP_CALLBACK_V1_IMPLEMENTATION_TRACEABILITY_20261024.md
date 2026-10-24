# BabyPark Callback V1 — bounded implementation evidence

Status: EVIDENCE — NON-NORMATIVE, draft only. No merge, customer activation or production-deploy authorization.
Applies to: existing BabyPark Drupal→Magento-portable contact launcher / Chatwoot Website Widget callback V1.
Supersedes: none. Earlier L1 PR #142 and Website Widget research PR #152 remain separate proposed work.

## Owner's exact bounded authorization — 2026-10-24

One implementation campaign in repository `Stanislavikus/babypark-integration`, citing independent PR #152 evidence: alternatives Scan SHA-256 `60870aa7ba06d2aa6aef2e2efd1d4f25bebd42765c57bb79d312b5a1a385002b`, fit SHA-256 `110c186549a14f78378f793a928e831d39872a7a03879cd466d6c42d0d97affd`. Owner explicitly allowed last-resort external use of Chatwoot 4.18.0's internal Website Widget message route (no official SDK sendMessage) **only in a draft implementation** with an upgrade contract test, one bounded fake-data C6 PoC, no Chatwoot core fork, no new runtime dependencies, no extra server and no live configuration/site changes. Rails runner only for create/cleanup of owned synthetic test Account/Inbox/Team/Label/Automation; any actual test messages only via `http://127.0.0.1:3180`. No existing C6 account/rows/SMTP/Cloudflare/n8n/catalog changes, no merge/deploy.

The L1 changes are based on PR #142 exact HEAD `8e7f22a39c2c18a86ffa7e619c83c61b28b1c577`; the campaign is **stacked atop L1** and does not re-pin or merge PR #142. Governance read from current canonical `main` (not from the stacked PR's old base).

## Explicit accepted requirements

- Existing anchored launcher option directly after direct-call button: **«Зворотний зв’язок»**.
- Single form: Ukrainian phone **required**, text «Повідомлення» **optional**, back/close, accessible numeric-oriented input; no mandatory full name/email, no time picker.
- On deliberate selection of Chat or Callback only, initialize official Website SDK; **not** on menu-open, hover, click on Telegram/Viber/call.
- Use signed `cw_conversation` widget JWT in memory only; send exactly one `POST /api/v1/widget/messages` via CORS; fixed marker `BABYPARK_CALLBACK_V1`, normalized phone in *message content* and `Conversation.custom_attributes.callback_phone` for new conversation only. **Never set Contact.phone_number**. Optional note included only if entered. This internal endpoint is not an official public SDK contract.
- Never claim success until HTTP 200 with valid positive message AND conversation numeric IDs. A network error can have unknown commit status — show ambiguity and do not automatically retry; an in-flight/uncertain submission disables the button.
- No new PII/log/queue store outside existing Chatwoot. No identity merge by a supplied phone field. A Contact may still be created by normal widget session initiation.

## SOURCE contract (v4.18.0 pinned)

Upstream `chatwoot/chatwoot` tag `v4.18.0` commit `9f920b549c14491a4e587687a3eed5d21c6ccc7d`.

- `app/controllers/api/v1/widget/messages_controller.rb` blob `c4fd9c82027a5a5fa9987a8af25a789c374d8b15`: POST creates message/new conversation; for an **existing conversation**, payload labels/custom_attributes are not re-applied.
- `app/controllers/api/v1/widget/base_controller.rb` blob `90f3728fbf5ce6597a592935bd5d4f146f9ae434`: conversation creation and JWT-based inbox scoping.
- `app/controllers/concerns/website_token_helper.rb`: signed `X-Auth-Token` and `Channel::WebWidget` inbox scoping.
- `app/javascript/sdk/IFrameHelper.js` blob `e38f4e02fbdcf66c091c32af7f57cb27d91cd1a8`: stock widget JWT written into first-party `cw_conversation` cookie on ready.
- `app/listeners/automation_rule_listener.rb` blob `e4d2da0b3fb4c233349d5394792ed3bf91627823`: `message_created` executes conditions on triggering incoming message, including in existing Conversation.
- `app/services/automation_rules/conditions_filter_service.rb` blob `728174d378caf15eca6e810222023dbd648396fd`, `app/services/action_service.rb` blob `314d510a9c373f4cdb4ad346c218178a0461eef8`: message content predicate and stock `add_label` / `assign_team`.
- `config/initializers/rack_attack.rb` blob `f5e5935caed0be564f906a78c71a9582ced7da05`: default Widget message throttle 60/min per IP+website token, does not ensure exactly-once.

**Proposed native rule** in real Website Inbox (not configured here): `message_created`, AND: `message_type = incoming`, `inbox_id = verified Website Inbox`, `message.content contains BABYPARK_CALLBACK_V1`; actions: `add_label callback` and `assign_team Продажі`. **Never use broad `conversation_created` + inbox-only rule.** On an already active conversation the phone remains in its new message; `callback_phone` may not refresh. Do not misreport this as a passed invariant.

## Integration gate and unresolved facts

- This draft is **HEAVY**; code commit and synthetic PoC do not waive the full independent adversarial manifest/review on exact HEAD/tree/base.
- Actual CORS endpoint not enabled: template `deploy/contact-launcher/chatwoot-widget-cors.nginx.example` is non-operational. No prod Nginx reload/Chatwoot settings modified. The template's commented proxy block must be completed from live config and `nginx -t` checked in an separately owner-approved cutover.
- Account-wide identity mutation risk on other Widget contact endpoints not eliminated by this one POST.
- Customer number/optional note appeared in synthetic Rails/Sidekiq Docker `json-file` logs in earlier PoC (verified). **Blocking privacy/retention policy proof remains**; rotate and filter sensitive params with maintained stock configuration without patching Chatwoot core. Generic finite log retention alone does not erase routine durable copies during retention.
- Existing Conversation labels/phone attr and async Sales handoff must be proven by synthetic test, not inferred from frontend HTTP status.
- Only local simulated unit tests and version-pinned expected contract can pass offline. Contract requires a synthetic real 4.18.0 test and a recheck at **every Chatwoot upgrade** (including normalized source body/response shape, marker, JWT and 403/resolved behavior).
- No customer-facing dynamic pricing/stock actions are part of Callback V1.

## Operational acceptance before deployment

Fresh exact-tree external HEAVY reviews with ZERO BLOCKERS; verify all mandatory tests, suite in a clean checkout, all independent blocker classes in one inventory. Verify CORS allows site origin, denies untrusted origins, normal chat unaffected, no inadvertent Chatwoot cookie on menu-open, valid phone, optional text, new/existing/resolved conversations, unknown ACK & duplicate-click. Verify seller agent access, label and team via native message_created rule. Read current production 4.18.0 exact binary/config; pre- and post-cutover rollback; separate owner approval for **specific** merge/deploy. This document does not approve activation.
