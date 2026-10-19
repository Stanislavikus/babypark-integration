# BabyPark Contact Launcher L1-B — implementation requirements traceability

Status: EVIDENCE — NON-NORMATIVE
Applies to: Draft PR #142, bounded L1-B hardening of browser launcher and official Chatwoot Website SDK.
Supersedes: none
Canonical governing base on L1-B pre-code approval: f3d92325e6b4ef04f0137c4c49dde07c05731bbe; Agreement blob e777fce4af8e8c3372f1f9de9ef7d00f786c2c89.
RISK CLASSIFICATION: HEAVY.
Bound owner-approved refreshed Scan SHA-256: 509c53e6891b270d5a6490e0e72c5951c089378c19d12d9ffdfcdfa518473302.
Bound owner-approved refreshed Fit SHA-256: a94593eeac4c8b271a351ac480fdb5cba2417c7fa421a2d41e9bb5678bbeee85.

## Applicable requirement → implementation → verification → failure mode → durable-state effect → status

| Requirement | Exact implementation / artifact | Verification | Fail-closed behavior | Durable-state impact | Status |
|---|---|---|---|---|---|
| L1-B P1: no passive Chatwoot initialization/contact/cookie | `web/contact-launcher/babypark-launcher.js` `initializeChatwoot`, `init` trigger listener | `tests/unit/contact-launcher.test.mjs` lazy SDK first gesture, real run/ready ordering; browser network/cookie probe required | Before click no SDK request/iframe from L1; chat row hidden until ready | No BabyPark storage; after click Chatwoot may create Contact and `cw_conversation` | DONE (code), IN PROGRESS (real-site evidence) |
| L1-B V1: SDK available is not proof of ready | `syncVisible`, `chatConfigured`, Chatwoot ready listener | SDK test sets `$chatwoot.toggle` synchronously in `run()`, asserts hidden until separate ready event | Unready/broken SDK option hidden | None in BabyPark | DONE |
| L1-B V1: SDK network/error/exception/late-ready | `initializeChatwoot` SDK onerror/onload, `state.sdkFailed`, status | SDK failure tests: load error, run throws, no run, late ready | No false chat option; explicit unavailable message | None in BabyPark | DONE |
| L1-B V1: keyboard and outside click | `closeMenu`; `pointerdown` / `keydown` listeners | Escape and outside-click regression | Dismiss menu without leaving invisible interactive controls; Esc restores focus | None | DONE |
| S1: stylesheet missing/late | `styled` + `syncVisible`, `window load` re-evaluation; inline SVG width/height | CSS failure and late-load test; browser no-CSS required | Entire launcher stays hidden if no fixed positioning | None | DONE (code), IN PROGRESS (browser) |
| S2: asset path after bundling / currentScript missing | `resolveAssetBase`, `iconFor`; `config.example.js` `assetBase` | Aggregated, inline, external and malicious `document.baseURI` test | No arbitrary icon origin; phone/chat work without image directory | None | DONE |
| S3: viewport offset knobs | `web/contact-launcher/babypark-launcher.css` mobile/tablet and max-height variables | CSS regression + 320/375/390/430, 600x360, 800x360 and live checkout visual required | Reject activation if occlusion measured | None | DONE (code), IN PROGRESS (real-site evidence) |
| S4: menu accessible and keyboard focus | JS `role=group`, status `aria-live`, trigger focus and external link hints; CSS outline `#004b78` | Escape/outside/keyboard tests; browser accessibility and focus required | No unannounced failed chat or lost focus on select | None | DONE (code), IN PROGRESS (browser) |
| S5: no unsolicited Chatwoot unread popup | `initializeChatwoot` sets `showUnreadMessagesDialog:false`; runbook | Unit SDK settings assertion, production Website Inbox 2 campaigns check required | No activation while upstream campaign can still auto-display | Chatwoot may still create Contact/cookie AFTER first menu open | DONE (code), IN PROGRESS (deployment config evidence) |
| S6: transparent measured vs preview geometry | CSS offset knobs; `docs/CONTACT_LAUNCHER_L1_PREVIEW_RUNBOOK.md` | Media query test; actual site measurement required | Unknown site geometry blocks production activation | None | DONE (document), IN PROGRESS (measurement) |
| S7: provenance of Kyivstar icon | `web/contact-launcher/icons/kyivstar.svg`; runbook source and matching path/hash | Upstream Wikimedia HTTP200 bytes+sha / local compressed path comparison; independent Chromium image verification required | No unsupported byte-identical source assertion | None | DONE |
| Every disabled or invalid channel hidden | `channelConfig`, `targetFor`, `syncVisible`; example flags | URL/protocol/flag negative tests | Disabled, unknown, unsupported link never shown | None | DONE |
| Approve no Chatwoot core patch and no custom server/AI | Only `web/contact-launcher/**`, scoped doc/test changes | Exact git diff changed-surface; root suite | No custom fallback connector or customer send | None beyond native Website Chatwoot | DONE |
| L1 lacks callback and WhatsApp activation | Example config false, no callback node/backend; runbook/frozen L1-B Fit exclusions | No-callback and disabled-channel tests | No fake callback success or unverified WhatsApp entry | No new callback/contact storage | DONE |
| Actual Drupal theme integration and channel roundtrips | `docs/CONTACT_LAUNCHER_L1_PREVIEW_RUNBOOK.md` only (no live theme change) | Website/Telegram/Viber roundtrips, CSS/CSP/cache/privacy/rollback smoke | Never activate until independently verified and owner-approved | Chatwoot sole transcript store | IN PROGRESS — blocks production activation and manifest final closure |
| Independent HEAVY gate on final committed HEAD/tree/base | Frozen manifest, Sonnet exhaustive review + isolated confirmation, §7 bundle | Required final HEAD `npm test`, diff --check, review whole surface | Zero BLOCKERS absent ⇒ no merge | None | IN PROGRESS — blocks merge |

## Explicit deferred non-goals

- Drupal production deployment and Bitrix24 removal are separate owner-gated activation, not a code change in PR #142. See frozen L1-B Fit; status DEFERRED until separate approved deploy.
- Callback submission, n8n backend, WhatsApp registration, header links cleanup and Magento adapter are explicitly OUT OF SCOPE under frozen L1-B Scan/Fit; status DEFERRED.
- None of these rows claim real-site correctness, cookie-policy signoff, merge authority or no open BLOCKERs. Continue exhaustive review after implementation is committed, and pin a **new** final-tree manifest for any changed HEAD.
