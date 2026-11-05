# Callback V1 — one-pass fault isolation

Status: RUNBOOK / NON-NORMATIVE. Applies to: BabyPark live Callback V1 and stock Chatwoot Website channel. Supersedes: none. Verified 2026-10-28.

**Safety:** begin read-only. Never print JWT/cookies, real phone/customer content, complete production .env or job args; never run live Widget POST without specific synthetic test permission. Unknown authorization, recipient, send ACK or privacy state ⇒ STOP/HUMAN, not speculative edits.

## Diagnostic routing — match the symptom to its owner

| Symptom | First **read-only** proof | Probable owning layer | Safe correction direction / STOP |
|---|---|---|---|
| Callback row missing | babypark.ua HTML references versioned CSS/config/JS, channel chat+callback enabled, origin allowed | Drupal theme/config/cache | Restore verified versioned template/config under approval; never edit Chatwoot core |
| Design old or menu broken | server release SHA matches RELEASES; HTML load order CSS, config, JS; console CSP/errors | Drupal assets/cache/permissions | Check Drupal cache HIT, asset traverse permissions; no blind cache purge |
| “Підключення до чату…” | SDK loaded only after click, chatwoot:ready, callable $chatwoot.toggle; public sdk.js reachable | Browser / Chatwoot SDK | Reconcile actual target SDK contract; 12s slow timer isn't terminal |
| Invalid phone/paste | compare raw vs displayed data in local synthetic browser; exact parser functions in REFERENCE | Browser validation | Never strip unknown foreign +, truncate >9 or reparse edited 380; require focused+browser regression |
| Disabled valid-looking form | local validity, 500 cap, ready JWT, pending/sent/uncertain, cookie ambiguity | Browser state/auth | Disabled may be intentional; conflicting cw_conversation ⇒ fail closed |
| 403/429 | authenticated visitor session, closed conversation, stock controller rejection, rate limit metadata | Chatwoot Widget | Only pinned 403/429 permit deliberate retry, no auto-resend; recheck after upgrade |
| Timeout/422/500/invalid ACK | native Chatwoot conversation may contain saved message; avoid exporting body | Chatwoot send/ACK/network | **UNKNOWN COMMIT**; do not resend. Check transcript with proper permissions |
| Message visible but no label | new vs existing convo; native rule #2 event, incoming, actual newline prefix, add_label; worker healthy | Chatwoot native automation | Do not add a custom bridge/assign_team; verify existing rule, preserve legacy #1 |
| callback_phone missing | if message in previously existing conversation, stock v4.18.0 does not reapply custom attrs | Chatwoot Widget controller | Expected; label rule works independently; don't mutate contact identity |
| After-hours message replaces preview | stock Business Hours template follows incoming; labels still present | Chatwoot native | Not duplicate Callback; avoid disabling hours |
| CORS failure | nginx exact location, allowed origin, OPTIONS 204, single ACAO; no wildcard | nginx Chatwoot host | Use native config compare and nginx -t in approved change only |
| All Chatwoot channels failing | public HTTPS/web+worker/DB/Redis health, gateway not necessarily failing | Chatwoot platform | Follow separate incident/restore procedure; do not change Drupal blindly |
| Viber works, callback fails | gateway health vs Website SDK and Widget route | Separate components | Do not replace or restart Viber bridge |

## Highest-risk regressions known from earlier review

**A. Wrong recipient:** leading +380/0 parsing on full-number paste differs from caret/Backspace edits of already-shortened national digits. A foreign + prefix with spaces/parentheses must never silently turn into local UA number; overlong paste must not be trimmed into another valid phone. Review phoneRaw, phoneNationalEdit, beforeinput, phoneWholeReplacement and normalizeCurrentPhone. A successful “green” form with wrong recipient is worse than a rejected form.

**B. Different visitor:** multiple cw_conversation cookies or invalid encoded-name can make a naive parser pick wrong JWT. getWidgetJwt deliberately rejects conflicting cookie candidates. Never force an arbitrary token, send from admin API or put JWT in logs.

**C. Duplicate callback:** a 15s deadline, malformed response, 422 or fetch error may arrive after commit; frontend terminal uncertainty prevents immediate resend. Do not convert 422 or 5xx into “definite failed” without source proof on exact installed target.

**D. Label missing only on existing thread:** the Widget labels/custom_attributes apply to NEW conversation. Native message_created rule #2 (incoming + two-line literal newline content) owns existing-thread labeling. Rule #1 for cached marker may still be needed. Never solve by assigning all website conversations to Sales or forcing new Inbox.

**E. Mobile field overlap/focus:** inspect released compact CSS and native-browser tests, correct viewport/keyboard/landscape, success focus not stolen. A purely visual edit still requires exact tests and owner-approved publication.

## Safe probes (authorized environment only)

- On Chatwoot host: read VERSION_CW and Git SHA, systemctl is-active chatwoot-web.1/chatwoot-worker.1/nginx/redis-server/postgresql@16-main; hash /etc/nginx/sites-enabled/nginx_chatwoot.conf. Public HEAD/GET to chat.babypark.ua doesn't create buyer data.
- On Drupal host: hash versioned JS/CSS/config (do NOT print config), HEAD/GET babypark.ua/ and compare HTML source links. Consult RELEASES for expected digests.
- Authorized Chatwoot Admin UI: inspect account-native Website Inbox, callback label, AutomationRule #1/#2 metadata and native Business Hours. Do not use raw conversation exports for debugging notes.
- Full browser synthetic POST is a separate operation that changes Chatwoot transcript and needs an explicit scoped owner GO. Never test with a buyer's phone.

## Recovery branches

Only webpage template/assets broken → guarded template-only restore from protected Drupal rollback (owner approval), then verify exact old/new hashes and current page source. Internal Widget route/SDK changed after upstream upgrade → stop rollout, compare upstream source/version and use native upgrade-compatible path or controlled Chatwoot rollback. Message/identity/privacy wrong → halt customer-facing actions and preserve evidence safely; never erase DB/queue/Dead Set/transcript as shortcut. Record exact SHA, timestamps, status/IDs only; do not promise one-pass correction without observed root cause.
