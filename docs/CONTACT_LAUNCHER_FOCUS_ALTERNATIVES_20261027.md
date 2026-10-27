# L1 focus-modality adjustment — alternatives scan

Status: EVIDENCE — NON-NORMATIVE
Applies to: existing BabyPark Contact Launcher L1 in Draft PR #142, user-approved pointer vs keyboard focus correction, 2026-10-27.
Supersedes: none
UTC scan time: 2026-10-27T14:02:26.210Z
Governance: `Stanislavikus/babypark-integration`, canonical main `1d5d8c00b7fdcdb54f37418ea60931c4292fd600`, Agreement blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.
Source identity: Draft PR #142 branch `feat/contact-launcher-l1-20261019`, existing live launcher JS blob `86b874e994ff33eb8bb3f671612d6fd0df786d57`.

## Frozen bounded requirements and invariants

- Opening existing menu with mouse/pointer/touch does not automatically move focus to Telegram, chat, or another menu action.
- After pointer opening, subsequent Tab from the still-focused launcher trigger must enter the open menu at its first actionable option (or the close control while all channels are disabled), not skip the options because the visual menu precedes the trigger in DOM.
- Opening with keyboard/assistive-technology click (zero-detail click) retains existing focus on first enabled channel and a visible `:focus-visible` outline.
- Native disabled state of pending Chatwoot Website channel remains `disabled`, never actionable before the real `chatwoot:ready` plus callable SDK toggle; malformed/unavailable channel links remain hidden.
- Delayed Chatwoot readiness must not transfer focus after pointer opening. Chat-only keyboard opening may focus Chatwoot when genuinely ready if opener remains focused; never steal from a different focused option.
- No changes to links, WhatsApp/Telegram/Viber behavior, chat transcript, CSS branding, loader activation, Chatwoot core, dependencies, Drupal configuration, credentials, privacy, or state storage. No spontaneous SDK start before first actual menu opening.
- No unreviewed production deployment/merge: preserve Agreement exact-tree review and distinct owner GO.

## Native/ready alternatives (in decision order)

Sources/discovery: deployed `babypark-launcher.js` and `babypark-launcher.css` (production and Draft PR #142 exact matching JS Git blob); checked-in launcher tests; HTML UIEvent.detail MDN https://developer.mozilla.org/en-US/docs/Web/API/UIEvent/detail ; MDN HTML disabled https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/disabled ; W3C https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/ ; Chatwoot SDK https://www.chatwoot.com/hc/user-guide/articles/1677587234-how-to-send-additional-user-information-to-chatwoot-using-sdk ; search terms: 'Chatwoot custom launcher focus management', 'click detail keyboard activation', 'focus-trap', 'focus-visible polyfill', 'what-input input modality'.

| Candidate | Current version/license | Requirement fit | Burden/result |
|---|---|---|---|
| Browser-native `UIEvent.detail`, `HTMLElement.focus()`, native disabled, `:focus-visible`, inside *existing* BabyPark launcher | DOM/UI Events/CSS browser standards; no extra package/license/dependency | PASS pointer vs keyboard, pending-disabled gate, late-ready guard, links unchanged | One bounded adjustment to already deployed/approved launcher, focused regression tests; fastest/no additional runtime |
| Native Chatwoot 4.18.0 Website SDK/config only | Existing self-hosted Chatwoot 4.18.0; Chatwoot open source | FAIL: SDK controls chat iframe/toggle, not external BabyPark launcher trigger's focus modality | Cannot change unrelated DOM focus via Chatwoot admin settings; no core patch allowed |
| Existing BabyPark CSS `:focus-visible` without JS correction | Existing file/standard | PARTIAL: keyboard outline correct but unconditional `first.focus()` causes observed pointer-open focus transfer; asynchronous `chatwoot:ready` may also transfer | Configuration-only CSS is not sufficient; do not hide keyboard outlines |
| `focus-trap` npm / github.com/focus-trap/focus-trap | v8.2.4, MIT, active Oct 2026 | FAIL: intentionally traps focus (dialog behavior) and auto-focuses initial element; BabyPark menu is not a modal dialog | Adds dependency and unwanted focus trap; slower and higher regression burden |
| WICG `focus-visible` polyfill | WICG/focus-visible; upstream recommends native CSS and no planned routine new versions | FAIL: manages focus-ring heuristics, does not remove unwanted `first.focus()` | Extra dependency, zero benefit over present native CSS |
| Separate custom focus-manager/other third-party connector | Not selected (no owner-named specific candidate) | FAIL or unknown: unnecessary framework/new state for a small existing DOM behavior | Higher complexity, not justified |

Decision: **keep-existing** — use browser-native `click.detail===0` to distinguish keyboard-equivalent activation within the existing JS opener; guard late-ready focus against pointer-open; and hand off the first Tab from a pointer-focused opener to the first enabled menu action via native keydown/focus. No new product, library, backend, core patch, secret or storage; no integration-fit delta. Change belongs to existing Draft PR #142. Documentation/scan is frozen by external SHA-256 calculated from normalized UTF-8/LF/final-newline bytes before code change. This record authorizes preparation only, not merging or production cutover.
