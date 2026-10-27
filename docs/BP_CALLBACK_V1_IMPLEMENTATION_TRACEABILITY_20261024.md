# BabyPark Callback V1 — bounded implementation evidence

Status: EVIDENCE — NON-NORMATIVE, draft only. No merge, customer activation or production-deploy authorization.
Applies to: existing BabyPark Drupal→Magento-portable contact launcher / Chatwoot Website Widget callback V1.
Supersedes: none. Earlier L1 PR #142 and Website Widget research PR #152 remain separate proposed work.

## 2026-10-26 owner-frozen scope correction — stock Chatwoot routing

The owner explicitly confirms that Callback V1 uses **unchanged stock Chatwoot
Website Inbox routing, auto-assignment and native notifications**. The form
adds a normal incoming Widget message to the existing visitor conversation
and uses the existing native account-level automation solely to add the
`callback` label. No custom callback queue, guaranteed off-browser staff
fanout, team-email automation, new team/assignee policy, duty roster or
offline-agent reassignment is a release requirement. These were assistant-added
operational expectations, **not owner-approved Callback requirements**. Their
absence must not be reported as an implementation/merge BLOCKER for Callback.
Staff may change native Chatwoot notification settings later, independently
of this release. Existing stock limitations remain explicit and are not
misrepresented as guaranteed delivery.

Existing real Website Widget new/Open/Resolved staging evidence (#139–#150)
covers the unchanged signed Widget delivery/routing contract; no second
server restore is required for the V12 frontend-only presentation/phone-editor
changes. The already successful separate DigitalOcean snapshot restore
(PR #155, image 251542648; PostgreSQL, Rails, attachments) is reused for
the existing Chatwoot durable-state recovery boundary. Callback adds no
independent database/storage system or Chatwoot core patch. The normal
pre-cutover asset rollback and security/privacy obligations still apply;
neither an unperformed final cutover nor a privacy/security proof is invented.

The separate governance proposal PR #156 is not a Callback V1 implementation
dependency or a substitute for the **currently merged** Agreement §7 review.
This scope correction does not claim an R1/R2 review result or authorize merge
or live activation.

## Current V12 §6 traceability — R2 blocker batch (2026-10-26)

This section supersedes earlier name-policy and UI statements below for the
current V12 candidate. Earlier dated sections are historical development
evidence, including historical tests and operational gates, not proof on the
new HEAD. R2 #6423235397 identified B1/G1/G2; read-only owner evidence
#6423267053 supplies the five-preview observations. Options scan for this
batch: `docs/BP_CALLBACK_V12_R2_BATCH_OPTIONS_SCAN_20261026.md`, frozen SHA-256
`aa60046bcd1e4d5d4a393fb3e577481bf64345ca766f890dc928c442a941ef02`.
The exact final HEAD/TREE/BASE and result digests are recorded in the new PR
manifest/report after commit, not inferred from this candidate document.

`JS` below means `web/contact-launcher/babypark-launcher.js`; `CSS` means
`web/contact-launcher/babypark-launcher.css`. Focused tests are in
`tests/unit/contact-launcher.test.mjs` unless another path is given. DONE
denotes implemented candidate code/documentation with the named regression,
never a production deployment or formal review certificate.

| Requirement ID / current requirement | Exact implementation/artifact | Focused test / verification | Fail-closed behavior | Durable-state impact | Status |
| --- | --- | --- | --- | --- | --- |
| V12-PHONE-DISPLAY: fixed +380, nine visible NSN digits, cancelable tenth key blocked | JS `init` phoneField beforeinput handler, `renderPhoneRaw`, `normalizeCurrentPhone` | `APPROVED V12: tenth keyboard digit blocked, full selection remains possible`; native browser full-source cases | Invalid/overlong/direct-submit values cannot POST | Memory-only draft; unchanged Chatwoot transcript | DONE |
| V12-PHONE-SOURCE: full 0/380/+380/formatted keyboard, paste, select-all replacement; foreign/Unicode/controls cannot become another recipient | JS `allowedPhoneRaw`, `localPhoneDigits`, paste/beforeinput/input handlers, `submitCallback` | `HEAVY V10 B-R1-1: select-all replacement typed key by key equals a fresh source`; `HEAVY R1 A1` source/clipboard tests; `tests/browser/contact-callback-keyboard.test.mjs` keyboard/clipboard/rejection cases | Explicit invalid source retained/rejected; no previous recipient fallback | No new storage or API fields | DONE |
| V12-PHONE-EDIT-B1: plain typed mid-caret/Backspace/range edits preserve literal NSN 380; end Backspace retains source-mode full typing | JS `init` phoneField beforeinput `phoneNextNationalEdit` and input `nationalMidEdit` | `HEAVY V12 R2 B1: plain typed middle edits preserve national 380 with and without beforeinput`; source end Backspace and generated literal-edit tests; native keyboard/caret/range browser test | Overlength national edit stays non-sendable; posted phone equals visible NSN +380 | Memory-only provenance flag | DONE |
| V12-NAME-LETTERS: optional Unicode letters/marks, spaces, hyphens/apostrophes; no digits even on direct POST; single-line only | JS `cleanCallbackName`, `optionalCallbackName`, nameField input, `submitCallback` | `APPROVED V12: optional Unicode name rejects numbers, counts characters, guards direct POST`; optional-name Unicode/single-line tests | Same cleaner at input and submit; no forged message row or Contact mutation | Optional line in existing Widget transcript only | DONE |
| V12-NAME-80: 80 UTF-16 units and remaining counter/description | JS `cleanCallbackName`, `syncCallback`, `init` nameField/nameHint | `APPROVED V12: optional Unicode name rejects numbers, counts characters, guards direct POST` | Submit cleaner caps direct-script value too; name optional | No extra identity store | DONE |
| V12-COMMENT-500: unchanged raw 500-unit cap and counter | JS `syncCallback`, `submitCallback`, commentField maxlength | `HEAVY R1: raw textarea maxlength` and comment counter/overlength tests | Raw >500 blocked before trim, including direct submit | Existing Widget message only | DONE |
| V12-HINT: complete valid green Номер заповнено; first-digit 1/2 complete invalid bold red Перевірте номер; incomplete remaining count | JS `syncCallback`; CSS `.bp-contact__callback-phone-hint--valid`, `--error` | `APPROVED V12: emblem inset, compact mobile size, name and phone state styling` | Invalid phone cannot enable submit; malformed-source neutral hint is separate R2 S2 | None | DONE |
| V12-GEOMETRY-EMBLEM: compact 490px-or-viewport form, native font, white avatar/inset owner emblem | CSS `.bp-contact__menu--callback`, `.bp-contact__brand-avatar`, image rules; JS `init` brandAvatar/brandImage | `APPROVED V12: emblem inset, compact mobile size, name and phone state styling`; existing compact-success tests; broader device checks remain external below | Missing configured callback cannot send; R2 S3/S5 limitations retained separately | Static asset only, owner PNG SHA-256 fa5a882453439306686df1e4c97387e601de6f9075e519082619fd29aa628d02 | DONE |
| V12-SEND: existing identity, SDK selective load, ACK/idempotency, native label fixture and no Contact mutation | JS `getWidgetJwt`, `initializeChatwoot`, `submitCallback`; `config/chatwoot/callback-v1-automation.example.json` | Focused `HEAVY R1 A4/A5`, `HEAVY V10 B2`, ACK/timeout/terminal tests; `tests/unit/contact-callback-contract.test.mjs` | Uncertain ACK terminal; only proven 403/429 deliberate retry; missing/ambiguous JWT blocks | Existing Chatwoot transcript authority only | DONE |
| V12-PREVIEW-G2: all five observed preview identities and current name policy | `docs/INFRASTRUCTURE_REGISTRY.md` 2026-10-26 inventory; `docs/CURRENT_STATE.md` current V12 section | `V12 G2: all documented callback previews have exact observed registry identities`; source comment #6423267053 | Unknown auxiliary assets/path drift stops future cleanup; no deletion claimed | Evidence only, production unchanged | DONE |
| OPS-PRIVACY: WARN/ERROR/Sidekiq PII, security/IP/consent/CSP and header inheritance | Preview runbook production safety/security gates | No new live verification; historical staging does not establish current V12 safety | No production activation; no unverified fact marked DONE | Existing infrastructure only | IN PROGRESS |
| OPS-RECOVERY-SNAPSHOT: accurately record the existing snapshot-specific restore proof | PR #155 comment #6412156326, independently re-read 2026-10-26; DO image 251542648 / temporary restored Droplet 612711769 | Restored PostgreSQL SQL reads and full pg_dump exit 0, local Rails HTTP 200, 3/3 nonempty attachment blobs; temporary Droplet/key deletion recorded | Evidence is limited to this overnight image; no assertion of future continuity or full integration/point-in-time crash consistency | Existing backup image only; no new production action | DONE |
| OPS-CUTOVER: current runtime, Drupal/CORS/IP, approved in-place deployment and devices | Preview runbook live-cutover and device gates | No deploy/real Widget POST authorized in this batch; mock browser results prove local editing only | Customer Callback remains off until separate GO and actual evidence | No production mutation in this batch | IN PROGRESS |
| GATE-HEAVY: new manifest, immutable required checks, independent R1 then isolated R2 | Agreement §7/§7.0a/§7.1; new exact-basis PR evidence | Old R1/R2/manifest invalid after changes; new cycle required | NOT CLOSED until complete exact-basis evidence and owner approval | No runtime state | IN PROGRESS |

G1 scope disposition: the owner has now explicitly frozen the stock
Chatwoot routing contract and excluded invented Callback-specific duty and
alert-delivery guarantees. The historical OPS-NOTIFY merge gate is removed;
no new Team, seller routing, staff notification service or staff-coverage
policy is introduced. The redundant second full-server restore requirement
is likewise removed: the existing successful Chatwoot restore is the
applicable recovery proof, with any frontend rollback handled by the
existing launcher deployment runbook. Remaining privacy/security, actual
cutover and final §7 review rows retain their honest state; this document
does not manufacture missing evidence or authorize an unperformed deploy.

R2 SHOULD FIX remain a separate inventory, not automatically BLOCKERs:
S1 invalid-key draft loss; S2 malformed-source neutral hint; S3 eager emblem
request/invalid assetBase; S4 owner-approved hint contrast; S5 short-height
geometry/avatar discrepancy; S6 historical document classification; S7 old
scan unpinned excluded candidates; S8 VM-only native-device gap. This batch
adds maintained Chromium coverage for S8 and classifies the touched registry
for G2; historical V7 scan and other SHOULD FIX are not silently declared
resolved. Real Android/iOS, screen readers and broad device evidence remain
unverified. N1 surrogate cap, N2 self-authored note prefix and N3 hypothetical
post-ready cookie remain NON-BLOCKING as classified by R2.

## 2026-10-26 V9 residual R1 follow-up — bounded correction candidate (NOT CLOSED)

The owner supplied another independent exhaustive V9 review of published HEAD f14c5f57fb6674e050c8ef47b21a598e6743f0e4, tree 9e51a5124a0fa7437c27ea7a8e7b2b461765fd3b. R1 NOT CLOSED: B1 compact-NSN mid-edit/Backspace incorrectly re-parsed the NSN's own 380 prefix; B2 SDK js-cookie 3.x URI-decodes %63w_conversation cookie names that launcher skipped; A1 noncancelable invalid beforeinput rejection was cleared by ensuing sanitized input (synthetic counterexample only, native autofill reachability unknown). Additionally, runbook erroneously described pre-ready Chat row as unclickable although user click must initialize SDK. Pre-code frozen native scan PR #154 comment #6411826763 selected existing browser event model and SDK-aligned cookie name decoding, no new runtime library or Chatwoot core patch.

Candidate B1: preserve distinct in-page national-edit mode when caret moves inside a compressed NSN; mid-field insertion/deletion, Backspace and selection replacement are edits to NSN, and only full replacement/paste may introduce a new foreign/country-form source. Candidate B2: decode cookie names as well as values and fail closed for conflicting/malformed equivalent names in either cookie order; do not mutate SDK cookies. Candidate A1: invalid beforeinput sets a transaction fence so subsequent noncancelable/sanitized input cannot silently change disabled into enabled; a later independent explicit valid edit can recover. No actual real-browser proof is claimed by VM tests; next reviewer must repeat native Chromium/Safari permutations and whole-surface checks. Historical V9 manifest and review are not evidence for a new exact tree.

## 2026-10-26 independent Codex HEAVY R1 inventory and bounded candidate fixes

R1 NOT CLOSED on prior HEAD 5764e299e56452328f2e6b3163c70fbda8a86647, TREE eed85c0ff6e7011de11da72b7a4fdb064c6ef139, V8 manifest PR comment 6404534196 SHA256 beac42fb35a0c49408c8f1305a8d5106d813c50cd398e26a7fbaa321a01e48cc. Five independent implementation BLOCKER classes and two SHOULD FIX; immutable execution evidence in Codex environment unqualified. Bounded pre-code native-first alternatives scan in PR comment 6410874822, KEEP EXISTING: browser-native DOM plus existing Chatwoot 4.18.0 Widget, no new runtime dependency or PII storage.

A1: Reject malformed raw domestic/international phones, controls, letters, Unicode numerals and overlong data BEFORE digit deletion. Native tel strips CR/LF and maxlength truncates input before JS input event; intercept paste/beforeinput, remove native maxlength and guard current raw source at submit. A2: Keep separate in-page raw source and compressed visible nine-digit NSN to avoid repeating removal of country/trunk prefix after input rewrites; never silently change recipient. A3: Remove previous-phone restoration on invalid replacement/overlong paste; extra key remains visibly invalid. A4: 422 is UNKNOWN COMMIT, even if Widget message already saved; never re-POST. A5: reject conflicting/malformed duplicate cw_conversation cookies, instead of selecting last one vs SDK first. A-S1: compact short-landscape success so essential confirmation is immediately legible; A-S2: correct L1-only obsolete menu-open SDK runbook. Existing Chatwoot, automation labels, Nginx, site and production stay unchanged.

Regressions to run: source/provenance validation before native clipboard sanitation, paste and raw keyboard number equivalence, overlong replacement after valid source, 422 postcommit, duplicate identity in either cookie order, source-lifetime immutable focused and root tests, separate exhausted R1/R2 on new tree, live external gates. This documentation is candidate evidence, NOT owner production/merge approval.

## 2026-10-25 V8 Sonnet supplementary phone-format regression — bounded candidate

**Basis:** published Draft PR #154 previous HEAD `46da00723170af402a95f50e846770918f36a098`, TREE `b9a881620852264e33c72fc784f7fae7ffddd918`, unchanged BASE/main `1d5d8c00b7fdcdb54f37418ea60931c4292fd600`, current Agreement blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`. Re-read `main:docs/` (81 entries) and complete main Agreement. Regression reproduced independently before edit: `+38 (067) 123-45-67`, `+38 067 123 45 67`, `+38(067)1234567` were incorrectly treated as partial country code because the `+` classifier used contiguous digits only. Mandatory pre-code native-first scan in PR #154 comment #6404459958 chose the existing browser `type=tel`, stock Widget and current JS with no new OSS dependency, Chatwoot core patch or customer PII store.

**Bounded correction:** `explicitCountryCode` still requires precisely one `+` at a legal leading position; detects C0/C1/newline controls as foreign and does not silently erase unknown letters/punctuation; determines country from the *entire* ASCII-digit sequence after separators. Total `380` prefix is Ukrainian; shorter `+`, `+3`, `+38` remains non-sendable partial; `+48`, `+1`, `(+687)`, multiple/misplaced plus and malformed controls remain non-sendable. No change to customer message prefix, rule #1/#2, JWT/ack, normalization of accepted digits or seller routing.

**Test evidence requirement:** assert all three Sonnet paste formats become `+380671234567`, exactly one fictional Widget POST and positive mocked ACK; key-by-key input for each works and cannot enable early with wrong phone; additional separated `+3 8 0`, NBSP, and bracketed domestic; foreign and ambiguous with prior valid local phone must show invalid source and zero POST even on forced submit; multiline/control phone must not become valid. Exact immutable focused and full root test evidence and dedicated mutations on NEW HEAD will follow. Old V7 browser/source/test results are historical. This addendum is not R1 ZERO BLOCKERS, R2 or a merge/deploy permission.

## 2026-10-25 V7 draft-only unified adversarial review follow-up

Owner agreed to fix the newly exposed foreign-country prefix BLOCKER and appropriate SHOULD FIX classes without waiting for the *first scheduled DigitalOcean Droplet backup*. Backup timing does not authorize public merge/cutover or production change. The frozen bounded native-first scan has SHA256 `a96f72cf3a43040cf54a38d32d3b869fa2466c61f89fb0064e45bcd27d80a927` and is included as `docs/BP_CALLBACK_V1_V7_NATIVE_OPTIONS_SCAN_20261025.md`. No custom Chatwoot core patch, new third-party dependency or customer PII storage; Browser DOM/HTML/CSS remains native.

Codex supplementary R1 on prior exact V6 pin independently reproduced a new **implementation BLOCKER**: pasted ` +687 20 00 00` or `(+687) 20 00 00` silently became a +380 number despite visible fixed country prefix. V7 corrects the **raw provenance**, checking all explicit `+` country signals before deleting formatting. Tests force direct form submit with foreign code, assert zero POST, no stale-number fallback, valid Ukraine paste one normalized POST. Other bounded fixes: prevent silent `pattern` browser veto of autofill while keeping strict JS guards; system-color keyboard focus, scroll-safe short landscape success, phone hint outside label, contrast and Nginx example inheritance warning, cleanup of historical traceability truncations. 401/404 remain fail-closed until runtime proof; rule #1 old marker + rule #2 human phrase remain untouched.

This is a Draft local candidate, not a remotely verified PR commit or gate certificate. Current exact HEAD/TREE/manifest and immutably-run root tests will be recorded only after commit; NO production actions. Owner approvals for repository merge and public Callback activation remain separate, and DO full restore evidence is still open.

## 2026-10-25 Codex 6.1 R1 complete known-code findings — one bounded batch

Code review input: exact previous HEAD `431eb148d23bbd5a3a5a24f841065f77dccb1d72`, TREE `79492d1cecd6cd4b30ae7e959dbbf2d18305fa82`, V5 manifest #6400509213 SHA256 `03683842494a490a48a127cc635b32974350189131f6ea2425bc42a00b554009`; reviewer found one BLOCKER and two SHOULD FIX, explicitly not ZERO BLOCKERS. All are addressed as the same bounded batch in Draft PR. Mandatory refreshed pre-code native scan #6400777473 normalized SHA256 `992574e8d12ec37c0e597cf1a59247d26b2b025a9a3d435b3bed38f21fb876d0`. Recommendation KEEP-EXISTING browser native and current supported Chatwoot 4.18.0 Widget. Neither Chatwoot account nor production website changed.

Traceability §6 (candidate code, not authorizing merge):
- 500-character raw input control: `web/contact-launcher/babypark-launcher.js:submitCallback` validates `rawComment.length` BEFORE `trim`; UI `syncCallback` checks same raw length. Direct event for leading/trailing spaces or all 501 spaces yields zero POST/error/disabled; exactly 500 raw units allowed. Test `HEAVY R1: raw textarea maxlength...`. Fail closed. No added customer storage.
- Interrupted Callback from delayed Chat ready: `openCallback` clears earlier `requestedChat`; ready event verifies current `!callbackView` and active menu. Test `HEAVY R1: stale pending Chat...`. No unsolicited Widget toggle. No persisted state.
- Success timer focus: 3.5 second timer calls `closeMenu(restoreFocus)` only when `document.activeElement` remains within launcher menu. External page input never loses focus; success panel focus returns to trigger when still inside. Test `HEAVY R1: success auto-close...`. No new PII/queue.

This changes exact HEAD/TREE and invalidates older manifest/review closure. New manifest, immutable focused/root tests, full independent exhaustive R1 and separately context-isolated R2 are mandatory; operational release blockers (Unassigned notifications, Chatwoot recoverable backup, WARN/ERROR PII, new/Open/Resolved exact live/CORS/IP/browser/Drupal) remain unresolved. No auto-merge or public site activation.

## 2026-10-25 Sonnet review follow-up — bounded draft refinement, no customer activation

Reproducible native-first §1/§3 scan precedes implementation: PR #154 issue comment #6400392706, normalized SHA256 2529d1726bd932a685d9843f8e5ff455ff93a69bb5aca17b30041d73c288755a. Recommendation KEEP-EXISTING browser HTML/DOM and stock Chatwoot 4.18.0. This addendum is a proposal until merge, NOT production authority or review closure.

Traceability under Agreement §6:
- S1 lost draft → `web/contact-launcher/babypark-launcher.js:openCallback` retains existing DOM values; focused close/reopen multi-path test, absent cross-page storage; no Chatwoot POST on close. DONE draft-only.
- S4 origin/Unicode/500 script-bypass test gaps → focused Launcher tests deny disallowed origins, constrain single-line preferred-name and block raw direct overlength send; no new handling/durable state. DONE draft-only.
- N-2/3/4 accessibility → CSS ruby-11 normal-text contrast, DOM hint outside label, native CSS vh before dvh fallback; static/accessibility tests. DONE draft-only; real screen-reader and mobile device proof still required for release.
- S2 live-rule drift → runbook post-change synthetic callback smoke for changed first-line phrase, both rules old/new, fresh and existing open/resolved messages; `contact-callback-contract.test.mjs` runbook assertion. DONE as operational test contract; actual production cutover smoke OPEN.
- S3 reliable vendor-native notifications for new and already-open Unassigned conversations → no speculative routing change; profile Email/Push/audio and collaborator restrictions require stock Chatwoot live proof plus explicit staffing policy. IN PROGRESS, **merge/release gate OPEN**; not waived.
- WARN/ERROR PII, verified recoverable backup, in-place Drupal cutover, security/IP/consent/CSP and exact independent HEAVY R1 then isolated R2 remain IN PROGRESS (no merge). Do not treat an isolated manual UI success as release authorization.

This changes customer-side local draft/display only; Chatwoot rule #1/#2, API transport, inbox/assignment and public production assets are untouched. All prior exact-tree test/manifests and review summaries become historical once HEAD moves; produce a new complete manifest, full immutable tests and independent review on the new exact HEAD/TREE/BASE.

## 2026-10-25 Native textarea-limit discovery and counter refinement (candidate, not launched)

The owner verified the actual staged Callback: human-facing confirmation `Ви замовили дзвінок` present in common Chatwoot, native `callback` label persists, numeric preferred-name text and multi-line message delivered intact. Then asked whether there are any actual character limits, how Chatwoot validates its name field, and whether to visibly count remaining characters. The owner's final sentence in that message was cut off; do not infer unrelated restrictions.

**Verified Chatwoot v4.18.0 code on installed host:**
- `app/models/message.rb` validates both `content` and `processed_message_content` at maximum **150,000 characters**, and the Website Widget `api/v1/widget/messages` uses this ordinary Message model. This is a Chatwoot backend bound; it is **not** the BabyPark Callback field limit.
- Native Website Widget `app/javascript/widget/components/ChatInputWrap.vue` uses `ResizableTextArea` with no displayed character counter or explicit textarea maxlength; `app/javascript/widget/components/PreChat/Form.vue` uses a FormKit textarea required rule with no character counter/max. Importing those Vue components into our tiny cross-origin-independent Drupal launcher would add unsupported extra runtime.
- Native pre-chat `fullName` is an ordinary FormKit text input with only required/optional standard validation (`getValidation`, no "letters only" pattern); `app/models/contact.rb` does not impose a letters-only rule on `name`. The BabyPark field remains optional free text, capped to 80 characters and normalized to one line, sent **only within Chatwoot Message.content** and not used to mutate Contact.name. A numeric nickname such as `1234567` is permitted. GOV.UK <https://design-system.service.gov.uk/patterns/names/> explicitly recommends supporting numbers and symbols; W3C <https://www.w3.org/International/questions/qa-personal-names> recommends nonrestrictive Unicode name handling. No custom name validator or Chatwoot core patch.
- The existing BabyPark Callback textarea already has **native HTML maxLength = 500** plus a JS submitted-content guard (`comment.length > 500`). The owner may not have seen the limit because no counter or hint was rendered. **500 is a BabyPark form choice, not a Chatwoot-wide hard limit.** Do not change it as part of an unreviewed side effect.

**Native-first options scan** was frozen before this edit in PR #154 comment `6399682488`: use built-in HTML textarea maxlength, existing `input` listener, a neutral stock Chatwoot `slate-11` color `#60646c`, and a small accessible `aria-describedby` helper showing remaining length. Avoid importing a third-party counter or the cross-origin Widget Vue code; no live-region announcement on every keystroke (too noisy for assistive technology), no new dependency or persistent data. The counter uses the same JavaScript UTF-16 units as the native HTML maxlength; an emoji can occupy two units. It supports correct Ukrainian 1/2–4/11–14 forms and 0. For programmatically injected over-limit values, a clear validation message replaces generic phone/connection error and submit is disabled; normal browser input is constrained by maxlength. Multiline notes and values up to 500 remain accepted, otherwise ordinary Chatwoot send, native rule #2 and existing Business Hours are unchanged.

**Boundary:** This is only an unmerged Draft PR JS/CSS/test/documentation refinement after the user tested older HEAD `14a79539`. It changes the exact HEAD/tree and invalidates earlier exact-manifest runtime/gating evidence. Main production L1 launcher and live Chatwoot native rules #1/#2 remain unchanged; refresh isolated preview asset only under the staging scope, bind actual new HEAD/tree, run fresh immutable focused+root suite and adversarial independent R1 then isolated R2 before any main-site production merge/deploy. The published operator instructions remain untouched until the owner supplies their current copy.

## 2026-10-25 owner-approved B-1 staging proof — new/open/resolved

**Actual runtime, not a mocked Widget request:** Owner explicitly authorized an isolated live-origin `babypark.ua` staging page and a second native account-wide Chatwoot rule, NOT public Callback activation or PR merge. On the exact source candidate `14a7953931ae4a6e8f2f65255741b74555406006` / tree `ce25ae2900672aa9028d1dd7b3420085f6edf6a7` against BASE `1d5d8c00b7fdcdb54f37418ea60931c4292fd600`, stock Chatwoot 4.18.0 account #1 now has two active *native* `message_created`/add-label rules: legacy **#1** for historical marker unchanged, and new **#2** for `Ви замовили дзвінок\nЗворотний дзвінок: ` with an actual newline. Both rules have no team/inbox/agent condition, no delay, and action only `add_label callback`. Nginx CORS trust set and normal Business Hours are unchanged. The public L1 button still has Callback OFF; the owner-unlinked test page uses the existing Website Inbox #2.

**Exactly observed through Chromium real Website SDK + signed Widget POST:** new message #139 / conversation #43 and new→open→resolved messages #140, #141, #148 / same conversation #44. Each POST: HTTPS response 200; positive numeric `id` and `conversation_id`; one browser-visible `Access-Control-Allow-Origin: https://babypark.ua` header entry; positive form success; no page JavaScript error. Browser DevTools extra headers did not expose raw wire header text for HTTP/2, so this result proves **one browser-visible field** rather than byte-level raw header duplication absence. Server-side Nginx currently owns the allowed-origin ACAO; Rails `ENABLE_API_CORS` is unset, preflight on both authorized origins returns 204 with one ACAO and a rejected unauthorized origin returns zero. **Independent raw header confirmation was subsequently completed during this owner-approved staging:** another signed Widget POST authenticated by a fresh official browser SDK visitor cookie, with the JWT held only in test-process memory (not logged), was sent using an HTTP/1.1 client that exposes unmerged `rawHeaders`. It returned positive message #150 / conversation #45, HTTP 200, and **exactly one raw `Access-Control-Allow-Origin: https://babypark.ua`**. The fresh visitor browser profile and in-memory JWT were discarded; no non-Chatwoot customer transcript was written. This complements, but does not replace, the real user-interface POSTs that proved the success UI/new/open/resolved handling.

**Seller/metadata read-back:** All synthetic incoming messages begin exactly with human confirmation `Ви замовили дзвінок`, have a normalized Ukraine phone in content, optional name/note in content only, and no visible `BABYPARK_CALLBACK_V1`. A new conversation has `callback_phone` in its custom attributes and `Contact.name` is not overwritten. A new conversation receives `callback`; for existing/open and pre-resolved #44, `callback` was intentionally removed **only** from that owned test conversation and was re-applied by native rule #2 on the subsequent incoming Widget POST (proof beyond new-conversation `labels` initial assignment). Before the resolved test the synthetic conversation was explicitly status `resolved`; after the real incoming Widget POST, stock Chatwoot reopened the same conversation, and `callback` reappeared. The inbox still has four sellers and Unassigned behavior. All test browser profiles were deleted; synthetic records remain only within Chatwoot's own transcript authority.

**Gate status:** this closes the old R1 B-1 *missing-real-form-submission* evidence class for this tested exact source. It is **not** independently completed HEAVY R1/R2 ZERO BLOCKERS, owner exact bundle merge GO, nor authorization to deploy main L1. Registry and current-state record identify the manually created rule #2/temporary preview and safe removal/rollback. All prior test and no-live-proof statements in historic sections below belong to the earlier time/old markers. After final production cutover update server docs in detail, and amend operator instructions only after the owner provides the current published guide. Revalidate native rule and internal Widget endpoint on every Chatwoot upgrade.

## Current release candidate supersedes historical marker (2026-10-25)

**This new section is the authoritative current candidate.** Repeated older material below records the original staging flow when the live automation matched `BABYPARK_CALLBACK_V1`; keep that material as historical evidence, not as instructions for the new customer-facing release. Do not edit, delete or rewrite earlier real customer transcripts.

Owner explicitly chose the **same normal Website chat conversation**, including the buyer-visible callback request and standard out-of-office reply. This enables the seller to explain failed calls or answer the buyer later in the same channel; no second Inbox, Chatwoot core modification, callback-only agent routing or automatic dialing.

**New customer message** (omitting name/note if empty):
```text
Ви замовили дзвінок
Зворотний дзвінок: +380XXXXXXXXX
Ім’я: [необов'язково]
Повідомлення: [необов'язково]
```

Customer-first “Ви замовили дзвінок” confirms a completed action; “Послуга «Замовити дзвінок»” was rejected as a less natural label for a sent request. The seller sees the same first line and native `callback` label. The dashboard «Всі» shows the **last non-activity message preview**, not a persistent subject: the stock Business Hours auto-reply or seller reply can subsequently replace this preview. Neither is a duplicate callback request.

**Stock automation contract:** `message_created`, `message_type=incoming`, `content contains` the exact multiline prefix `Ви замовили дзвінок\\nЗворотний дзвінок: ` (JSON escape notation; in Chatwoot the stored value has an actual newline); sole action `add_label callback`. Use the versioned native rule fixture `config/chatwoot/callback-v1-automation.example.json`. The stock Widget API accepts `labels: ['callback']` for **new** conversations, but only native AutomationRule labels messages in **existing** threads; confirmed in the installed Chatwoot v4.18.0 Widget controller. The two-line predicate avoids matching an ordinary mention of just the first phrase. It is routing metadata, not an authorization mechanism.

**Release boundary (current):** Active native AutomationRule #1 still matches the OLD marker for cached clients; account-wide native rule #2 matching the current two-line human prefix was installed on the owner-approved isolated staging environment and read back successfully (see staging proof above). Neither rule alone authorizes public Callback activation. Do not deploy only new JS or only rule; on production cutover reverify both, verify new/open/resolved conversations and preserve #1 through the measured browser-cache transition. Never change Inbox/team assignment implicitly. A rollback must retain the old rule and restore the approved old public assets; customer messages remain intact. After production launch, record actual rule IDs/contents, exact deployed asset digests, effective Chatwoot configuration, owner test and rollback on server and in repo. Operator instructions wait until the owner provides the existing published guide.

**Gate:** This is HEAVY customer transcript/classifier behavior. Changes invalidate older manifest/reviewer findings; strict immutable full tests, exhaustive independent R1 and isolated R2, real successful POST/CORS proof, and separate owner exact-GO for merge and Drupal production cutover remain mandatory.

## Historical authorization / pre-upgrade implementation evidence (2026-10-24)

Sections below document the earlier marker-based stage; they are **NOT** current instructions to revert to a technical public marker or remove native rule #2.

### Owner's exact bounded authorization — 2026-10-24

One implementation campaign in repository `Stanislavikus/babypark-integration`, citing independent PR #152 evidence: alternatives Scan SHA-256 `60870aa7ba06d2aa6aef2e2efd1d4f25bebd42765c57bb79d312b5a1a385002b`, fit SHA-256 `110c186549a14f78378f793a928e831d39872a7a03879cd466d6c42d0d97affd`. Owner explicitly allowed last-resort external use of Chatwoot 4.18.0's internal Website Widget message route (no official SDK sendMessage) **only in a draft implementation** with an upgrade contract test, one bounded fake-data C6 PoC, no Chatwoot core fork, no new runtime dependencies, no extra server and no live configuration/site changes. Rails runner only for create/cleanup of owned synthetic test Account/Inbox/Team/Label/Automation; any actual test messages only via `http://127.0.0.1:3180`. No existing C6 account/rows/SMTP/Cloudflare/n8n/catalog changes, no merge/deploy.

The L1 changes are based on PR #142 exact HEAD `8e7f22a39c2c18a86ffa7e619c83c61b28b1c577`; the campaign is **stacked atop L1** and does not re-pin or merge PR #142. Governance read from current canonical `main` (not from the stacked PR's old base).

## Owner's later bounded staging permission — 2026-10-24

The owner subsequently approved Callback staging and corrected the scope: **universal native Chatwoot callback for current/future eligible agents, teams, and inboxes**, not a rule pinned to the existing «продажі» team. With this permission, exactly one account-level callback label and `message_created` label-only automation were installed using the stock Chatwoot API. A narrow Nginx CORS location was staged and preflight-tested; the site Callback button was not enabled. See PR #153 operational checkpoint comment `6384307999`. The owner subsequently requested a visible synthetic Widget test and customer rollout. That request does not waive the current authoritative Agreement's mandatory exact-tree checks, independently isolated HEAVY review and exact-basis owner merge approval. **Authenticated synthetic Widget POST and agent-visible handoff remain unverified** because the remote executor blocked both scripted attempts before execution.

## Explicit accepted requirements

- Existing anchored launcher option directly after direct-call button: **«Замовити дзвінок»**; this is the sole action label in the row, Callback header subtitle, form accessible name and submit control. The body starts directly with **«Залиште номер для зв’язку»** (no duplicated «Зворотний зв’язок» heading).
- Single form: Ukrainian phone **required** with fixed non-editable `+380` country prefix and sanitized nine-digit local entry, **«Ім’я (необов’язково)»** as an optional single-line textual preferred-name field immediately after phone, text «Повідомлення» **optional** next; one close X (no Back), numeric-only phone entry with missing-digit hint; no mandatory name/surname/email or time picker.
- On deliberate selection of Chat or Callback only, initialize official Website SDK; **not** on menu-open, hover, click on Telegram/Viber/call.
- Use signed `cw_conversation` widget JWT in memory only; send exactly one `POST /api/v1/widget/messages` via CORS; fixed marker `BABYPARK_CALLBACK_V1`, normalized phone in *message content* and `Conversation.custom_attributes.callback_phone` for new conversation only. The optional name, if present, is sent **only** as a single line `Ім’я: …` in that same Chatwoot message, followed by optional note `Повідомлення: …`. Neither `Contact.name` nor `Contact.phone_number` is set or merged. This internal endpoint is not an official public SDK contract.
- Never claim success until HTTP 200 with valid positive message AND conversation numeric IDs. A network error can have unknown commit status — show ambiguity and do not automatically retry; an in-flight/uncertain submission disables the button. The entire fetch plus response-body decoding uses a **15-second first-party deadline** (AbortController where available, Promise.race fallback); a timed-out response is **unknown commit**, not verified failure. A sent/uncertain outcome persists if the panel is closed and reopened in the same page lifetime; both the disabled UI and submit handler refuse a second POST. Page reload is not globally idempotent; do not claim an exactly-once guarantee.
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

**Current native universal staging rule (installed/read-back 2026-10-24):** account-level `message_created`, AND: `message_type = incoming`, `message.content contains BABYPARK_CALLBACK_V1`; sole action `add_label callback`. **No fixed team/agent/inbox**: stock Chatwoot inbox membership and automatic assignment remain authoritative for all eligible current and future agents/teams. This does not guarantee proactive notification if no agent is available; the Unassigned queue still needs operational coverage. The marker is public, so a normal incoming message containing it can be labeled; it is not an authorization mechanism. On an already active conversation the phone remains in its new message; `callback_phone` may not refresh.

## Integration gate and unresolved facts

- This draft is **HEAVY**; code commit and synthetic PoC do not waive the full independent adversarial manifest/review on exact HEAD/tree/base.
- Live Nginx CORS was staged 2026-10-24 for exact `/api/v1/widget/messages`: `https://babypark.ua` and `https://www.babypark.ua` OPTIONS returned HTTP 204 with matching allow-origin; untrusted origin received none; `nginx -t` and Chatwoot public GET passed. Actual authenticated browser Widget POST still requires positive synthetic verification. The repository's example remains reference-only; an additional future site requires explicit origin configuration.
- Account-wide identity mutation risk on other Widget contact endpoints not eliminated by this one POST.
- Previous isolated C6 PoC recorded fake phone/text in Rails/Sidekiq Docker INFO logs. Actual production runs under systemd/journald and separately owner-approved `LOG_LEVEL=warn` in both `.env` and Web/Worker systemd drop-ins; live Rails/ActiveJob loggers verified at level 2 (INFO disabled). Old logs remain; WARN/ERROR job failures may still contain PII and are **not** redacted by `warn`. The exact residual risk must be accepted or mitigated before customer activation, with no Chatwoot core patch.
- Native universal account-level automation and label are installed/read-back verified; new/existing conversation label application, phone attribute on new conversations, and per-Inbox assignment are **not yet proven by a successful synthetic Widget POST**. No `assign_team` should occur.
- Unit tests and the source-pinned contract are not a substitute for one real authenticated v4.18.0 Widget POST plus agent-visible verification. Two direct remote scripted synthetic POST attempts were blocked before execution by safety checks; no success must be claimed. Contract must be revalidated on every upgrade, including response shape, JWT, CORS and resolved behavior.
- No customer-facing dynamic pricing/stock actions are part of Callback V1.

## Sonnet R1 findings and current bounded disposition — 2026-10-24

Owner-supplied independent Sonnet 5.5 R1 on release HEAD `6ab24a5b80d4bf766cd6f0e1ea380a3d5d1d5313` reported 1 evidence BLOCKER (no actual **form** POST), 4 SHOULD FIX and 8 non-blocking findings. This is **not** a zero-BLOCKER gate. The current later HEAD supersedes the old immutable manifest; replace/re-run mandatory review once the entire bounded batch is closed. **B-1 remains OPEN:** a message from normal Widget chat (#42) is not evidence of L2-form `custom_attributes`, HTTP 200 ACK or all browser CORS header counts. Preview with fake SDK and stub server is not sufficient.

- S-1 correction in launcher code and focused tests: definite rejected Widget statuses `403` (resolved conversation forbidden before save), `422` (validation failed without saved message) and `429` (rate limit before controller) allow **manual** retry only; they do not claim commit uncertainty. All other non-200/invalid ACK/network/timeouts stay uncertain, no automatic retry and no in-page re-submit. This is limited to exact v4.18.0 Widget contract; rerun after upgrade.
- S-2: existing test `contact-callback-contract.test.mjs` is a **static source-reference regression**, not a live-upgrade detector. L2 runbook now requires installed-version source pin + an actual authenticated Widget smoke after upgrade; a synthetic test result must not be fabricated. No new production runtime dependency or test-customer durable store.
- S-3: historical L1-only runbook/traceability retained as historical L1 scope; new L2 release extension and current operational records in `docs/CURRENT_STATE.md` and `docs/INFRASTRUCTURE_REGISTRY.md` identify manual Chatwoot/Nginx/systemd changes, rollback, and customer form OFF.
- S-4 deferred C6 invariant: any future BabyPark AI webhook/First Line consuming `message_created` events **must classify `BABYPARK_CALLBACK_V1` as DIRECT_HUMAN with no public AI reply**; do not introduce this customer-facing behavior into Callback L2 by modifying C6 contracts unilaterally. Capture explicit C6 activation gate when that separately approved campaign starts.
- Nonblocking N-1..N-8 remain listed in Sonnet review. Current v1 decisions: normal Inbox/Unassigned queue; phone in message content when existing conversation; no preferred time or SLA, no custom agent routing; only exact authorized BabyPark browser origins; native label marker is not authentication.

## 2026-10-24 UI alignment — frozen option fit and user acceptance scope

Owner approved a visual Callback form consistent with the **stock Chatwoot v4.18.0 Website chat header**: white ~400px responsive panel, BabyPark avatar/title, one close X, no duplicate «Як Вам зручніше?» or Back, large readable phone, optional note and a separate success screen. The owner explicitly requested reuse of Chatwoot settings wherever a supported mechanism exists, but permits local design adaptation where such reuse is not supported. The source options decision is frozen in PR #154 comment `6389761292`, normalized UTF-8/LF SHA256 `ee0539418e0d95212e395c4a4beb482975d004ea469eb92a12ca92158ab4a68d`.

**Native fit boundary:** Chatwoot `ChatHeader.vue` and availability calculations operate inside a cross-origin widget iframe. The upstream v4.18.0 `POST /api/v1/widget/config` populates avatar/working-hours details **but also builds a visitor contact**; it must never be invoked just to populate a passive BabyPark form header. No supported read-only external header/availability SDK getter was proven. The Callback header is visually consistent and uses `BabyPark / Замовити дзвінок` copy from the same existing launcher labels object; it does **not** claim real-time agent availability or maintain an independent working-hours calculator. Neither Chatwoot core nor the existing chat iframe is patched. Current brand display is a local static fallback, **not** dynamically synced to Chatwoot; any future live source must first be verified under the native-first gate.

**Form behavior:** only a genuine 200 Widget ACK containing positive numeric `id` and `conversation_id` opens the success panel, with «Заявку успішно надіслано. Ми зателефонуємо Вам.»; 3.5-second informational dwell auto-closes the whole Callback panel to the launcher. The same page preserves the sent/uncertain terminal state, with no resubmission on reopen. On timeout/network/5xx/ambiguous-200, the form must stay available for status inspection, not auto-close. Only source-proven precommit 403/429 responses permit deliberate manual retry; 422 is UNKNOWN COMMIT and blocks resubmission. Numeric display is programmatically reduced to nine digits, accepts valid whole Ukrainian mobile/landline prefixes pasted from clipboard without silently losing a valid country prefix, and refuses ambiguous overlong foreign data. Native `inputmode`/`pattern` and `aria-describedby` provide mobile keypad/accessible hint without a masking library or extra runtime dependency.

**Layout regression:** preserve the ordinary options menu's original 279px width, stable chat row height and lazy SDK behavior. Switch the same menu container into a 400px chat-like Callback panel only on deliberate Callback selection; responsive height is bounded by `100dvh`, existing launcher bottom inset and 76px trigger reserve, with internal overflow scrolling on short mobile viewports. Verify actual device/Chromium geometry at 320/375/390/430px, 600×360 landscape and desktop, CSS focus/keyboard Escape, close while pending, and full success dwell. Static source tests alone do not prove real browser geometry or actual signed customer-facing POST; keep HEAVY release gates open until independently verified.

## Optional preferred-name field — owner-approved 2026-10-25 bounded addendum

The owner requested an optional text-only `Ім’я` field below the required phone and above optional message, explicitly asking for an evidence-grounded Ukrainian label. Before code changes, frozen alternatives scan [PR #154 comment 6394652800] SHA256 `755afdf1369945173717625f927fec8b4645220852b75ec79b4eda421e19afdd` (UTF-8, LF, final LF). Compared the stock Chatwoot v4.18.0 Website pre-chat Name field with the **already proven** BabyPark Callback DOM/form/message primitive, maintained OSS form/mask libraries, external form products and a new custom service. Native pre-chat allows a standard optional name but would **change onboarding of ordinary Website chat and automatically store Contact identity**, so it does not fulfill the bounded isolated Callback requirement. Chosen: existing launcher `input type=text` and Chatwoot Widget message only, zero dependencies or core patches. External sources: <https://www.chatwoot.com/hc/user-guide/articles/1677688647-how-to-use-pre_chat-forms>, <https://design-system.service.gov.uk/components/text-input/>, <https://design-system.service.gov.uk/patterns/names/>, <https://www.w3.org/WAI/tutorials/forms/labels/>, <https://www.w3.org/International/questions/qa-personal-names>.

**Label choice:** `Ім’я (необов’язково)` is more compact and scan-friendly than `Як до Вас звертатися? (необов’язково)` in a 400px widget, while allowing a preferred name rather than demanding a legal identity or surname. A visible associated label, text keyboard, `autocomplete=given-name`, disabled spellcheck and bounded 80-character single-line value are used. Unicode names, apostrophes, accents, hyphens, mixed scripts, case and reasonable numerals/symbols are preserved; GOV.UK/W3C specifically caution against English-only or restrictive name validation. Browser input sanitizes only line/control characters and normalizes whitespace before transmission so a pasted newline cannot forge another `Ім’я` or `Повідомлення` row. No name line when blank or whitespace-only. User-entered name is visible to seller and to the same visitor when opening Chatwoot chat (existing Widget conversation behavior).

**Privacy and invariants:** no new durable store, contact identity mutation, API data fields or public AI response. Chatwoot remains transcript authority, one controlled Widget POST after explicit deliberate Callback submit only; optional name never gates button (phone+JWT readiness only), unchanged ACK/duplicate prevention/timeout and existing native `callback` label/Unassigned routing. Owner did not authorize customer-wide production activation or bypass of HEAVY review. Exact final source tree and synthetic browser/Widget real request are required before deployment.

## 2026-10-25 Sonnet R1 078cb9e B-2 — independently reproduced and corrected

Owner requested independent verification of Sonnet's 2026-10-25 review **before** another real-browser form test. We reproduced the *current committed* `localPhoneDigits`, `normalizePhone` and `input` mutation path (source-extracted functions run in Node's VM) and confirmed: per-key `380671234567` or `+380671234567` became `+380380671234`, nine-key short `067123456` became `+380067123456`, and `0000000000` became `+380000000000`. The violation is an unsafe **silent recipient change**, not merely a cosmetic input hint.

The implementation alternatives scan was frozen before edits in PR #154 comment [#6395082458](https://github.com/Stanislavikus/babypark-integration/pull/154#issuecomment-6395082458). Reuse of existing browser-native `type=tel`/`inputmode` and BabyPark's already present normalizer won over changing all chat onboarding to stock Chatwoot pre-chat phone, adding libphonenumber-js metadata/dependencies, or inventing another service. Note that `inputmode` is a **keyboard hint**, not validation: <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inputmode>. Maintained global-scale parsers remain available for future international sites, not the current single-country `+380` form: <https://github.com/catamphetamine/libphonenumber-js>.


## 2026-10-25 source-level phone normalizer and UX correction, current bound

The national-number input is always presented alongside a fixed visible `+380`. It accepts a nine-digit structurally valid Ukrainian NSN, `0` trunk format, or `380` international country prefix. It **must never silently change an explicitly foreign country code** to a Ukrainian callback recipient. Exact current code checks whether any `+` appears even after whitespace/parentheses; its position and leading numeric country code are validated before removing formatting. Examples ` +687 20 00 00`, `(+687) 20 00 00`, NBSP plus-prefix, duplicate/mid-string plus all fail closed and remain visible until corrected; `(+380) 67 123 45 67` normalizes to nine digits. No carrier-allocation claim is made: shape-check only. Regressions verify that an input with explicit foreign plus cannot fall back to a prior valid phone.

The form uses native `noValidate` because browser `pattern` may reject a valid autofilled Ukrainian trunk number before the existing JS-controlled `submitCallback` can normalize it. This does not bypass the actual JS guard: raw note length <=500 UTF-16 units, normalized phone, Widget JWT, Chatwoot ready, idempotency and ACK checks remain necessary before POST. The `aria-describedby` phone hint is **outside** its `label` so assistive technology does not read it twice. The label remains a native associated HTML label.

The phone focus outline uses a system `Highlight` outline in `forced-colors` mode (where `box-shadow` disappears). The confirmed-success overlay uses scroll-safe alignment/overflow in short 600×360 landscape instead of clipping the checkmark/caption. Browser-level visual/VoiceOver/Safari/forced-colors tests remain **NOT VERIFIED** until separately executed on the new exact source.

Historical explicit old technical marker `BABYPARK_CALLBACK_V1` in older proof is intentionally preserved **only in this historical documentation and the legacy native rule**, never reinserted into customer-facing messages. Current account-wide rule #2 is `message_created`, `incoming`, message content containing exact two-line `Ви замовили дзвінок\nЗворотний дзвінок: ` (actual newline in stored matcher), sole action `add_label callback`. Only Chatwoot is transcript authority.

## Historical exact-source evidence preservation (non-normative)

Older raw/duplicated evidence content (including concatenated Markdown copies and malformed regex fences) is recoverable from the Git blob `7d7b506abc082dafaa4b10afc8e592b501ba869e` at previous PR HEAD `db7bb37c3c3f6d3be86405c8f0bc2155ee762856` by `git show HEAD:docs/BP_CALLBACK_V1_IMPLEMENTATION_TRACEABILITY_20261024.md`. The repeated appended copies were not an additional authoritative contract. The original isolated staging POSTs on older source `14a79539...` and owner live incoming marker message on earlier source prove that historical stage only. They **do not** verify current V7 JS.

### Previous owner proof — 2026-10-25 (historical old marker)

## 2026-10-25 owner live test + Chatwoot-native semantic/error and Widget side-effects research

**Confirmed owner test on production account 1 Website Inbox #2, read-only:** message #136, conversation #1, 2026-10-25T09:21:50Z, incoming public `BABYPARK_CALLBACK_V1`, native `callback` label present, valid +380 callback phone line, optional name line, optional message line. Conversation open/unassigned; its previously existing custom attributes do not need a new `callback_phone` for subsequent messages. No raw customer PII copied into docs. Owner reported the same operator view, so this is stronger than mock SDK/network tests. A production **positive HTTP response header count and exact browser ACK were not captured**; the frozen B-1 gate must not claim them.

**User-visible echo root cause:** the Callback POST is an ordinary **public incoming Website message** in the existing Widget conversation, with its technical marker and phone/name/note. The standard Chatwoot Widget message list displays that public conversation history on later Chat open. This is not another outgoing callback POST, nor a new conversation; it is the same buyer-visible transcript. Current Widget messages controller accepts `message.content` as incoming and does not accept a `private` field from Widget clients; setting a private note from the browser is not a supported replacement. Buyer seeing the technical marker is a **real UX/privacy downside**. Do not misreport it as fixed by CSS or by sending a second hidden message. Chatwoot-native alternative to investigate separately, only with explicit owner architecture GO, is separate Callback Website Inbox/visitor session (different native token, same agents/account, independent per-inbox Business Hours); this changes current single-inbox contract and needs its own fit/proof and may be worse than retaining continuity. Do not roll it into this bounded color stage.

**After-hours source proof:** Inbox #2 `working_hours_enabled=true`, `out_of_office_message` configured. User's prior request #133 was incoming 2026-10-24T20:24:36Z, followed by native `template` #134 at 20:24:37Z equal to configured out-of-office message; no additional request POST was necessary when opening ordinary chat. Today's incoming #136 during working hours created no such after-hours template. Stock v4.18.0 `app/services/message_templates/hook_execution_service.rb#should_send_out_of_office_message?` triggers on any normal incoming message when Inbox is outside business hours, once/day/conversation and excluding recent human outgoing; `app/services/message_templates/template/out_of_office.rb` creates the template. No native per-callback-marker exemption in this path. Keeping the current standard Business Hours for ordinary chat means no indiscriminate disabling. Official <https://www.chatwoot.com/hc/user-guide/articles/1777421876-business-hours-and-auto_responder> describes this.

**Name digits decision:** visible optional preferred-name field remains `type=text`, accepts nicknames/numerals/symbols, does not modify Contact.name or become required. GOV.UK names guidance <https://design-system.service.gov.uk/patterns/names/> explicitly recommends support for all characters including numbers/symbols; W3C <https://www.w3.org/International/questions/qa-personal-names> warns about rejecting legitimate characters. An all-digit input is not a useful preferred address but is not grounds to discard a valid callback or silently remove user-entered content. No hard validation or field conversion added.


## Mandatory operating and release gates (OPEN)

- On one immutable exact final HEAD/TREE/BASE and the same verified manifest hash: all mandated root tests, package suites, full independent exhaustive HEAVY R1 ZERO BLOCKERS, then context-isolated R2; neither old R1 nor old manifest is qualifying.
- Real user-device browser checks including landscape 600×360 scrollable success/forced colors, iOS Safari/VoiceOver as available, Drupal aggregation/CSP/cookies/cache, apex and www.
- With *authorized synthetic* source, prove new/Open/Resolved Chatwoot 4.18.0 incoming message, fresh label via rule #2, one raw ACAO on accepted POST, proper effective client IP and Rack::Attack, ordinary Website chat and Business Hours remain unchanged, and strong no-double-send on ACK timeout.
- Verify native notifications and an actual staffed duty plan for both new and already Open Unassigned conversations; no speculative `assign_team` or hardcoded Sales team in universal rule.
- Production safety: first DigitalOcean Droplet backup actually completed, PostgreSQL/ActiveStorage/config (and required Redis) independently restorable at a separate location; privacy/legal WARN/ERROR/Sidekiq PII and retention disposition; verify Nginx security-header inheritance before any new callback location cutover.
- No production merge or deploy or Preview cleanup without explicit owner exact basis GO. Update operator manual only when the owner supplies its current version and production activation is real.

This is traceability evidence, NOT permission to merge, activate Callback on babypark.ua, or change a customer transcript.


## Owner-approved Callback V12 visual transfer (2026-10-26)

Status: Draft PR only; visual acceptance is not production approval, nor
is it proof of a real Chatwoot POST. Exact current-base Agreement governs.

Owner reviewed an isolated visual demo on a Samsung mobile and approved:
compact 490px-or-viewport height with closed keyboard, Chatwoot-like system
font, circular BP emblem on white, fixed +380 and nine visible national digits
with full-number paste, Unicode-letter optional name (80 with remaining
counter), comment (500 with remaining counter), green valid
"Номер заповнено" (Chatwoot light teal-11), and bold red invalid
"Перевірте номер" (Chatwoot light ruby-10) for complete invalid numbers.
Source visual demo:
https://babypark.ua/sites/all/themes/babypark2/assets/contact/preview-callback-visual-chatwoot-emblem-20261026/index.html?hint-v=3
The logo slightly overflows the avatar in that demo on mobile; the PR CSS
keeps an internal four-pixel margin (40px circle, 32px image; 31/25px on
short landscape) so its ring cannot protrude. No art asset modification.

Refreshed pre-code native-first fit scan frozen in this PR comment 6420208747:
UTF8/LF scan SHA256
1dccfa76db5f2111b4783b4aede97a9f87ddebce73792c76b633e7fb8225c326
Existing site-owned DOM/CSS, official Chatwoot Widget SDK and native browser
InputEvent were selected over stock Chatwoot pre-chat form (insufficient
external callback menu semantics) and extra runtime OSS phone validators.
No new external runtime, Chatwoot patch, or persistent customer PII storage.

Safety distinction: approved visual demo used a simpler parser and synthetic
success, whereas actual launcher preserves V11 raw phone provenance, native
visitor JWT, fail-closed uncertain POST and never-resend invariants. Invalid
foreign and overlong pasted values may remain visibly rejected rather than
being silently truncated into another customer's number. Tenth manually
typed digit is prevented on cancelable keyboard events. Native phone
maxlength=9 would corrupt a full +380 clipboard paste and is not used.
Noncancelable, IME and programmatic input remain guarded on submit.

Verification before release: focused callback suites plus npm test, a new
manifest binding exact committed HEAD/tree/base and this frozen scan,
independent exhaustive HEAVY R1 then context-isolated R2, and live
Website inbox label/agent notification smoke after owner authorizes
a controlled test. No automatic merge/deploy. Exact-pin owner merge GO
and separate production cutover GO are required.
