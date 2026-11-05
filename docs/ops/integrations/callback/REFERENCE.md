# Callback V1 — exact deployed technical reference

Status: EVIDENCE / REFERENCE; not normative, not an upgrade authorization.
Applies to: BabyPark Drupal launcher + stock Chatwoot 4.18.0 Website Widget API and native automation.
Supersedes: historical marker-based staging implementation.
Verified: 2026-10-28 for source identities and host version; native rule details inherited from dated 2026-10-25–27 evidence, must be freshly inspected before edits.

## 1. Architecture and responsibility map

~~~text
Buyer browser: https://babypark.ua/
  Drupal 7 html.tpl.php
    -> CSS + versioned config.js + babypark-launcher.js (BabyPark code)
    -> user selects «Замовити дзвінок»
    -> lazy native Chatwoot SDK, visitor session/cw_conversation JWT
    -> POST https://chat.babypark.ua/api/v1/widget/messages?website_token=<public>
      X-Auth-Token: <visitor JWT> ; JSON content (no admin API token)
  Chatwoot server: chatwoot-fra1-01
    -> Nginx: exact location /api/v1/widget/messages, strict CORS
    -> stock Rails Widget message controller (v4.18.0, unpatched)
    -> stock Chatwoot Message + Conversation, transcript owner
    -> native AutomationRule #2 (incoming + exact two-line content prefix)
    -> native add_label: callback
    -> ordinary Website Inbox + native Business Hours + agents
~~~

- **Drupal host:** server2181.babypark.ua. Webroot: /home/babypark/sites/babypark.ua; active theme: sites/all/themes/babypark2; CMS template: templates/html.tpl.php. Versioned assets: assets/contact/releases/callback-v1-8ab5dd5c/ under the theme. Release files are babypark-launcher.js, babypark-launcher.css, config.js and icons/.
- **Canonical source repo:** Stanislavikus/babypark-integration, merged PR #154. Code: web/contact-launcher/babypark-launcher.js, babypark-launcher.css, config.example.js, icons/*; tests: tests/unit/contact-launcher.test.mjs, tests/unit/contact-callback-contract.test.mjs, tests/browser/contact-callback-keyboard.test.mjs.
- **Chatwoot app:** /home/chatwoot/chatwoot on chatwoot-fra1-01. VERSION_CW **4.18.0**, upstream Git HEAD **9f920b549c14491a4e587687a3eed5d21c6ccc7d** (verified on host 2026-10-28). Systemd: chatwoot-web.1.service and chatwoot-worker.1.service, Postgres and Redis native services.
- **Proxy:** /etc/nginx/sites-enabled/nginx_chatwoot.conf, SHA256 7486b927888cb0428009011920cffe8ac7dd34e73b2df89f1d7301b3be7f68ac on 2026-10-28. Exact /api/v1/widget/messages location; allowed Website origins, OPTIONS 204, one ACAO, allowed POST,OPTIONS and Content-Type,X-Auth-Token. Do not copy whole vhost or change global CORS.
- **Automation reference:** config/chatwoot/callback-v1-automation.example.json in repo is a fixture, NOT proof of account settings. Account #1 rule #2 (current human prefix) and rule #1 (legacy marker) were installed and checked in earlier campaign. Before future changes, inspect actual active rules in Chatwoot Administration; no assumption IDs remain same after migration.

## 2. UI and channel availability

Launcher has Chat, Telegram, WhatsApp, Viber, Phone and Callback. Callback displayed only when callback and chat channels are enabled, public Website token shape is valid and document origin is https://babypark.ua or https://www.babypark.ua. The host environment's config.js is different from generic config.example.js; never overwrite with example or publish its contents.

Assets load in order **CSS → environment config.js → JS** from Drupal template. UI is generated as DOM nodes, with a one-time initialization guard. Icon base URL must be same-origin. Chatwoot SDK https://chat.babypark.ua/packs/js/sdk.js loads **only** after explicit buyer selection of Chat or Callback, not while hovering, expanding menu or clicking messenger links. Configures hideMessageBubble=true, locale=uk and showUnreadMessagesDialog=false. Browser event chatwoot:ready and callable window.$chatwoot.toggle determine readiness. Slow indication after 12s isn't terminal SDK failure.

Form: Ukrainian compact mobile-appropriate layout, BabyPark emblem and Chatwoot colors. Phone mandatory, name and comment optional. Closing/reopening preserves an unsent draft during page lifetime; terminal sent/unknown status stays disabled through close/reopen in that page. Confirmed success persists legibly about 3500 ms before conditional close, with focus-safety.

## 3. Phone correctness — hardest historical class

Displayed country prefix **+380 is fixed**. Buyer fills **exactly nine digits** after it, with valid national-shape first digit [3-9]. Normal output format +380XXXXXXXXX. This validates syntactic shape only; not carrier assignment or phone ownership.

The FINAL implementation cannot be replaced with regex replace-non-digits:
- explicitCountryCode(raw) preserves an explicit + signal even if separated by spaces/parentheses; foreign +code must NOT be silently converted to +380.
- allowedPhoneRaw rejects control/Unicode/unknown characters and overlong raw input (>30 browser string units) rather than stripping into a plausible phone.
- localPhoneDigits accepts Ukrainian +380 form, national trunk 0 form or local nine-digit input. Strips prefix **from the original raw input only**, never repeatedly from already displayed/edited national digits.
- normalizePhone and normalizeCurrentPhone enforce exactly nine local digits starting [3-9].
- phoneNationalEdit/phoneWholeReplacement/phoneRejectNextInput and beforeinput/clipboard/caret handling preserve input provenance across Backspace, select-all replacement, mid-caret edits and noncancelable inputs. A tenth digit must not silently replace or truncate a valid existing one.
- Foreign-country +, overlength paste or malformed control input is visibly invalid or fail-closed, not auto-normalized to a different recipient.

Regression gates: typed 380 and 0; full +380 paste; spaces/parenthesis formatting; foreign +40/+44; repeated prefix; 10th digit; illegal symbol/Unicode numeral; selected range, Backspace, cursor in middle; invalid 1/2 first national digit. Run the committed focused unit AND native-browser keyboard/clipboard suite. **Wrong-recipient reproduction is a BLOCKER**, not a UI quirk.

## 4. Name/comment contracts

- optionalCallbackName/cleanCallbackName accept Unicode letters and combining marks across languages, normal/curl apostrophe, hyphen and spaces; strip digits/other punctuation and normalize repeated spaces.
- Preferred name maximum **80 JavaScript UTF-16 code units**, live counter, one line. Name exists only as line of message.content; **does not set Contact.name**.
- Optional textarea comment maximum **500 UTF-16 code units**, native maxlength + direct submit guard, live remaining counter. Trim for presentation only. Do not confuse with stock Chatwoot Message model's much larger max.
- Never convert a preferred name or phone into Chatwoot Contact identity/phone_number; this was an explicit owner decision.

## 5. Widget request and message format

Actual buyer-visible incoming text begins with TWO lines (actual newline):

~~~text
Ви замовили дзвінок
Зворотний дзвінок: +380XXXXXXXXX
Ім’я: <optional, omitted when empty>
Повідомлення: <optional, omitted when empty>
~~~

X and angle placeholders are fictitious, never an actual customer number. The human first line replaced old public BABYPARK_CALLBACK_V1 marker. Native Chatwoot Website conversation displays this message to the buyer later; it is not a private hidden note.

Single browser request:
- URL: https://chat.babypark.ua/api/v1/widget/messages?website_token=<public Website token>
- Method POST; JSON; headers Content-Type: application/json, Accept: application/json, X-Auth-Token: signed **visitor JWT**.
- Browser fetch mode=cors, credentials=omit, redirect=error.
- JSON body structure (pseudodata only):

~~~json
{
  "message": {"content": "<human two-line prefix + optional fields>"},
  "custom_attributes": {"callback_phone": "<Ukrainian +380 number>"},
  "labels": ["callback"]
}
~~~

**This route is stock but internal/version-sensitive; official Chatwoot SDK does not expose a sendMessage for this use.** Upstream v4.18.0 source frozen in PR:
- app/controllers/api/v1/widget/messages_controller.rb blob c4fd9c82027a5a5fa9987a8af25a789c374d8b15;
- app/controllers/api/v1/widget/base_controller.rb blob 90f3728fbf5ce6597a592935bd5d4f146f9ae434;
- app/controllers/concerns/website_token_helper.rb for X-Auth-Token and inbox scoping;
- frontend widget stock js-cookie cw_conversation behavior;
- native AutomationRule listener/condition/action service and Rack::Attack.

**New-vs-existing:** Widget controller accepts labels/custom_attributes for **new conversation creation only** on pinned version. A follow-up message in existing Website thread can carry same content but not update callback_phone; native rule #2 must apply label. A resolved non-bot Website conversation can reopen on incoming message when platform rules allow it. Do not treat missing custom attribute in existing thread as message loss.

**Session identity guard:** getWidgetJwt parses all same-named cw_conversation cookies and valid JWT shape. Conflicting copies, malformed encoded names or values fail closed to prevent wrong visitor association. No JWT value may appear in logs/docs, and **never** fall back to admin API token.

## 6. ACK, timeouts, retry behavior

One user-initiated submission per safe page state, and in-flight button disabled. Complete fetch INCLUDING response JSON has a 15-second bound with AbortController where available and a promise race fallback. A timeout or abort does **not** prove that Rails rolled back.

- Confirmed send: HTTP **200** AND response body has positive safe-integer **id** AND **conversation_id**. Only then display success and keep sent terminal.
- Known rejected before commit: **403 or 429** according to observed pinned stock v4.18.0 path. Show error; only deliberate later attempt allowed. Never auto-retry.
- Unknown commit: timeout, browser/network/CORS failure, 422, unexpected 5xx, JSON parse failure or absent/invalid positive IDs. Show “Не вдалося підтвердити надсилання. Щоб уникнути дублювання, зателефонуйте нам.” and disable retry for current page, even after reopening. **422 can occur after message commit via after_commit callback**. This client is not cross-tab/reload exactly-once; never claim otherwise.
- A native Rack::Attack per-IP/Website token throttle is NOT an idempotency primitive.

## 7. Label, routing and after-hours

Account #1 native AutomationRule **#2** expected on message_created, message_type=incoming, content contains exact **two-line prefix with literal newline**: “Ви замовили дзвінок” + newline + “Зворотний дзвінок: ”, sole action add_label callback. It is not authorization; do not add assign_team, inbox-only scope, paging, separate tickets or automatic dialing without new design approval. Rule #1 matches legacy marker and remains during cached-client transition. Confirm current active state via native UI before upgrades.

Existing ordinary Website Inbox, Unassigned queue and standard Business Hours continue. A stock after-hours template may follow the single incoming request, and the dashboard last-message preview may show this template or seller's next reply instead of Callback first line: NOT a duplicate submission. Green presence dot for Website visitor is not a read receipt nor seller online.

## 8. Security, privacy and upgrade-sensitive paths

Native Chatwoot owns transcript; no BabyPark callback DB, alternate message copy or routine long-lived customer-body logs. Worker-only LOG_LEVEL=error was used as native Sidekiq WARN job-context dump mitigation (web warn); residual ERROR/FATAL/historical logs/backups/Redis Dead Set require owner-approved native retention/erasure disposition, **not** a claim that data is deleted. Exact supporting Draft PR #159. Verify actual unit drop-ins and effective process environment after every Chatwoot upgrade.

Nginx CORS rule only for allowed website origins with a single ACAO: duplicate Rails/Nginx headers or wildcard are errors. Upgrade must inspect messages_controller.rb, base_controller.rb, website_token_helper.rb, SDK readiness, cookie identity, automations, Rack::Attack and Business Hours on actual target version before publishing.

Sources: merged PR #154, docs/BP_CALLBACK_V1_IMPLEMENTATION_TRACEABILITY_20261024.md, docs/CONTACT_LAUNCHER_L1_B_IMPLEMENTATION_TRACEABILITY.md, official Chatwoot v4.18.0 source pinned above. History in those traceability files is not itself an active rollout instruction.
