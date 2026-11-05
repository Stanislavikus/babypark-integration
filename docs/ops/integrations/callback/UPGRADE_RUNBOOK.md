# Callback V1 — controlled upgrade compatibility runbook

Status: RUNBOOK / NON-NORMATIVE. Applies to: target Chatwoot upgrade while keeping BabyPark Callback V1. Supersedes: none. Baseline observed 2026-10-28: stock v4.18.0, upstream SHA 9f920b549c14491a4e587687a3eed5d21c6ccc7d.

This gives any model a reproducible comparison path. It does **not** authorize upgrade/deploy or guarantee future undocumented behavior is fixable without independent evidence. Read canonical current-main Agreement and the exact approved rollback before any write.

## A. Freeze and inspect known-good (READ ONLY)

1. Current Chatwoot VERSION_CW, HEAD SHA, Ruby/Node/Rails if relevant, systemd web/worker/Redis/Postgres status, Nginx active vhost SHA, effective worker log-level and native label automation identity.
2. Drupal public index uses **three** released asset references under callback-v1-8ab5dd5c; capture live SHA256 of JS/CSS/config and the current template, no sensitive config content. Compare with RELEASES. Check optional phone/name/note UI behavior and widget readiness.
3. Confirm recoverability of actual Chatwoot DB, Active Storage, required Redis state and config, plus separate Drupal template/asset rollback. A snapshot name is insufficient proof of restoring the current data.
4. In Chatwoot native settings recheck Website Inbox identity, current callback label, active account rules (#1 legacy; #2 human prefix), Business Hours/standard queue. Never change rules during preflight.
5. Review target vendor release notes; record exact target version and code SHA, new endpoint/security changes, and approved availability window.

## B. Version-sensitive upstream contract matrix (must prove for NEW target)

| Source/API | Required fact to re-prove |
|---|---|
| app/controllers/api/v1/widget/messages_controller.rb | Signed Widget POST route; request fields; success HTTP 200 with positive id + conversation_id; new-vs-existing custom attrs/labels; after_commit/422 behavior; resolved state |
| app/controllers/api/v1/widget/base_controller.rb | Valid visitor JWT, correct Website inbox/conversation lookup, no cross-contact identity |
| app/controllers/concerns/website_token_helper.rb | X-Auth-Token session and token scoping; rejection of invalid visitor |
| Widget SDK / packs/js/sdk.js and JS cookie | chatwootSDK.run, chatwoot:ready, callable toggle, cw_conversation format/duplicate behavior |
| Native automation listener / conditions / actions | message_created incoming and two-line literal newline exact prefix, add_label callback for existing conversation |
| Rack::Attack / lifecycle | 403/429 pre-save rejection, other errors unknown-commit; resolved reopen and Business Hours |
| Nginx exact Widget route | OPTIONS 204, one Access-Control-Allow-Origin, accepted only babypark.ua and www, POST Content-Type/X-Auth-Token; no wildcard |
| Sidekiq/systemd native logging | Effective worker-only ERROR level, web WARN; no new WARN job-args dump. Log/Redis retention controls unchanged unless separately approved |

Never assume a vendor change preserved an **internal** endpoint; if not, first find proven stock/official migration path and maintained OSS; no Chatwoot core fork.

## C. Owner-authorized synthetic acceptance matrix

1. Browser menu open/hover/Telegram/Viber/phone doesn't start Website SDK; explicit Chat and Callback do, ready event eventually works.
2. Full Ukrainian paste (+380), trunk 0, nine local digits, foreign explicit +, >9 digits, controls, Unicode numerals, select-all replacement, caret/Backspace edits: no wrong recipient or silent truncation. Name optional 80/Unicode letters, digits stripped; comment optional 500 with counters.
3. Conflicting cw_conversation cookies fail closed; no admin token in browser. Only explicit deliberate click sends.
4. CORS preflight allowed origins, single ACAO; actual authorized browser request returns 200 with positive numeric message and conversation IDs. The content appears as **one** incoming message in Chatwoot.
5. With fictitious data and clear no-call note: NEW conversation → callback label and custom attribute; existing OPEN → same thread, native rule reapplies label even if custom attribute unchanged; RESOLVED → native reopened or explicit definite 403 rejection as proven target behavior. No Contact.name/phone_number changes.
6. Simulated timeout/422/failed JSON/network: no automatic retry or second enabled submit on unknown commit; 403/429 only deliberate reject if NEW target proves pre-save.
7. Ordinary Website two-way chat, standard Business Hours/Unassigned, Viber bridge, Telegram and WhatsApp remain as previously verified (run separate authorized end-to-end per channel if upgrade touches them).
8. App/web worker/DB/Redis health, protected rollback ready; record actual tests and observations without private data.

Tests on merged V1 code: root npm test (release R2: unit 1277, legacy 13, refactor 13), focused launcher + callback contract 85 pass, native-browser keyboard/clipboard 21 pass. These results belong to release HEAD **8ab5dd5c**, not new Chatwoot version. If JS changes, rerun current checked-in suites, required manifest and independent reviews on exact new tree; do not trust old green badge.

## D. Controlled repair / rollback

If only Drupal frontend failed, restore old template **only after approved exact preimage guard**, leaving Chatwoot DB intact. If stock Chatwoot Widget contract changed, halt new Callback public sends and re-evaluate a native supported method or approved restore of full Chatwoot version; don't patch installed Rails. If native automation changed, recheck the stock rule and context; do not remove old marker rule #1, add seller fanout or create new Inbox by improvisation. If privacy, identity, send confirmation or recovery unproven, stop rather than gamble on buyer messages.

After actual owner acceptance, record new version/Git SHA, all deployed file hashes, source differences, native rule IDs and effective settings, reproducible smoke results, remaining unknowns, recovery object and separate service ownership. Reflect this in docs/CURRENT_STATE.md, docs/INFRASTRUCTURE_REGISTRY.md, the release manifest and server mirror on an approved commit.
