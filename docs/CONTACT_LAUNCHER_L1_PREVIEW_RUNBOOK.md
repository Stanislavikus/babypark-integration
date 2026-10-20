# BabyPark Contact Launcher L1 — preview and site runbook

Status: RUNBOOK
Applies to: web/contact-launcher/**, Drupal 7 active babypark2 theme, existing Chatwoot Website Inbox.
Supersedes: none.

## Fixed approval and scope
RISK CLASSIFICATION: HEAVY — customer-facing website SDK initialization and Chatwoot privacy/contact boundary.
Original L1 owner pre-code GO (2026-10-19) binds Scan SHA-256 8f1c0dc9562bd2c7e4383f3dc8972c329061bac04f5ae8e068d416a0dfe5f7eb and Fit SHA-256 4f930276a7db2b1907a5f94e058df32b590ee29673693af4dcca2d1aff958cc6.
**Owner L1-B pre-code GO (2026-10-19):** bounded V1/P1/S1–S7 batch inside Draft PR #142, refreshed Scan SHA-256 509c53e6891b270d5a6490e0e72c5951c089378c19d12d9ffdfcdfa518473302 and Fit SHA-256 a94593eeac4c8b271a351ac480fdb5cba2417c7fa421a2d41e9bb5678bbeee85. L1-B refreshed Scan/Fit published as PR #142 comments 6273732298 and 6274015249; original L1 evidence lives in comments 6273467945 / 6273469598. This authorizes branch implementation only; not merge, deployment, data activation or site modifications.
Canonical main when GO approved: f3d92325e6b4ef04f0137c4c49dde07c05731bbe; Agreement blob e777fce4af8e8c3372f1f9de9ef7d00f786c2c89.

**Owner L1-C V2 pre-code GO (2026-10-20):** exact Scan SHA-256 `74237eddbf8b0225b6728007eb0344b224f15ff8d5660ee705740ecc9472a4d0` (comment #6295431838) and bound Fit SHA-256 `75d9769eb3fbce563421a247cab81d2314319873930afdc39920f457bdb9dc6d` (comment #6295473828). Allowed only stable disabled chat row, informational one-shot 12s notice with late-ready recovery, symmetrical X SVG, accessible two-tone focus and scoped tests/docs in Draft PR #142. No runtime dependency, prefetch/preconnect, auto-open, callback/L2, merge or live deployment. Previous L1-C V1 Scan/Fit/GO superseded for this behavior.

These approvals cover preparatory L1 branch code only. They are NOT merge, live site deployment, header editing, callback collection or n8n authorization.

## Solution
Pure static, CMS-neutral JS/CSS; local SVGs. The existing official Chatwoot 4.18.0 Website SDK at https://chat.babypark.ua/packs/js/sdk.js is **not requested on passive page load**. On the first manual opening of the contact menu, an enabled/configured Website channel loads the SDK with hideMessageBubble=true, showUnreadMessagesDialog=false and locale=uk. A configured Website chat row is present from the start in a muted gray disabled state, at its final fixed 64px height; no visible loading message/animation in the first 12 seconds. It is enabled ONLY after `chatwoot:ready` plus callable `window.$chatwoot.toggle`. A single 12,000ms browser timer changes a compact in-row note to `Підключення триває довше, ніж зазвичай`, but does not abort the SDK or block legitimate late readiness, which clears the note and enables the row. Explicit errors (SDK onerror, missing/throwing SDK.run, ready without toggle) stay disabled with in-row unavailable text. No SDK retry, prefetch/preconnect, hover initiation or automatic open. The existing `aria-live` status exists in a visually hidden region that **never moves other menu options**. Chat-only enabled config must keep launcher trigger available before SDK readiness. No API bearer tokens in JS. External messengers open customer apps directly, existing Chatwoot inboxes handle seller traffic. No callback form in L1; callback delivery/PII and n8n belong to separately approved L2. **Residual privacy impact:** the first menu-open event loads a Website iframe, and Chatwoot can create an anonymous Contact/ContactInbox and first-party cw_conversation cookie even when the visitor then selects Telegram, Viber or phone. Depending on deployed ip_lookup setting, Chatwoot may store the visitor IP on that Contact. This is not a passive-pageview effect after L1-B lazy integration; audit actual cookie domain/lifetime, contact retention and disclosures before production activation. Chatwoot remains the sole transcript/customer identity authority; BabyPark launcher stores no new PII. Verify no campaigns active on Website Inbox id 2 to prevent unsolicited popups; showUnreadMessagesDialog=false is not a general server-side campaign disable.

## Explicit per-channel operator switches
See web/contact-launcher/config.example.js: each channel enabled is strict true/false, unverified states default false. This is NOT automatic uptime monitoring. Actual fresh buyer-device inbound message + seller reply must be proven before enabling; liveness HTTP 200 or existence of Chatwoot Inbox is insufficient.
- Website chat: initially false, requires public website token and real browser/inbox test.
- Telegram: initially false, https://t.me/Babyparkua_bot, inbox 4.
- Viber: initially false, viber://pa?chatURI=babypark, inbox 5 (Viber get_account_info status=0/uri=babypark only validates bot identity).
- WhatsApp: false, missing active Chatwoot inbox and verified wa.me destination.
- Phone: true, tel:+380982908838, test actual dialer link.
- Callback: not included, never fake a success response.

## Production site attachment point (READ ONLY until separate GO)
Live root: /home/babypark/sites/babypark.ua; active Drupal 7 theme babypark2. Existing Bitrix24 loader is in sites/all/themes/babypark2/templates/html.tpl.php after page_bottom and points to cdn.bitrix24.eu/b25684245/crm/site_button/loader_1_sfkqzu.js. This is a script inclusion point, NOT a reusable DOM container. In an approved deployment, replace ONLY that stale loader with versioned CSS + config + JS, in deterministic load order. No header cleanup until the launcher actually works.

## Staging preview and release checks
1. Reconfirm canonical main and fresh git agreement. Revalidate frozen scan/fit, deployed Chatwoot version, privacy and provider conditions.
2. Use a test copy of Drupal theme. Record live target html.tpl.php SHA-256 and backup before writing, and a restore plan. Do not use production customer conversations for staging tests.
3. Place babypark-launcher.js, babypark-launcher.css and icons/ under a static, versioned theme asset directory; copy config.example.js to local deployment config. Set explicit **same-origin assetBase** ending with a slash (mandatory if JS aggregation/bundling rewrites script URL), PUBLIC Chatwoot Website token and only independently verified channel enabled flags. Never embed Chatwoot API token or Viber token. Verify config comes **before** JS and CSS loads before JS; if CSS is absent the JS leaves the launcher hidden, never in normal document flow.
4. Check 320/375/390/430px, 600x360/800x360 landscape and desktop pages for product/cart/checkout overlays, consent banner, payment modal, CSP, cache, script order, duplicate default Chatwoot bubble, chat panel opening and closing, no clipping, actual deep links/dialer; keyboard tab/Escape/outside click, focus after chat. Check no Chatwoot SDK request, Contact or cw_conversation cookie before first menu open; check Contact/cookie after first open as disclosed. Test missing/late CSS, SDK failure, and aggregated/inline JS with explicit assetBase. Use actual Chromium getBoundingClientRect() for Telegram/Viber/phone at initial, ready, 12s informational and explicit-error transitions: require unchanged row top coordinates within 1 CSS px across desktop and 320/375/390/430 mobile and short landscape. Verify non-clickable chat row before ready, active only on genuine ready, late ready after 12 seconds, live announcements, symmetric centered X on mobile/desktop and two-tone keyboard focus on dark/white surfaces including forced-colors. Synthetic browser tests do not replace the Drupal-site/real-inbox consent/device checks.
5. CSS 22px mobile right and 76px+safe-area bottom are approved **preview defaults**, NOT site-specific measured values. Tune --bp-desktop-right, --bp-desktop-bottom, --bp-mobile-right, --bp-mobile-bottom and --bp-compact-bottom via theme CSS against actual sticky/footer navigation (including landscape, checkout and tablet widths to 767px). Disabled/missing CSS or unsafe icon origin must fail closed. Avoid making unmeasured CSS values authoritative.
6. Run exact immutable HEAD/tree/base root npm test, diff --check and all applicable normative verification/review requirements. Obtain a separate owner merge GO and a separate production deployment GO. No automatic merge.
7. Record deployed assets, actual version, rollback reference, health/channel activation and manually created objects in docs/INFRASTRUCTURE_REGISTRY.md and docs/CURRENT_STATE.md during the approved production release.

## Rollback
If site UI regresses, remove new CSS/JS includes and restore pinned template, keeping defunct Bitrix24 loader OFF. For a failing channel disable only that channel, purge relevant static config cache, do not imply delivery succeeded. No changes to Chatwoot transcript authority.

## Close icon provenance — L1-C V2
Both close controls use the same static symmetric X icon geometry from Lucide/Feather (24×24 viewBox; two crossing diagonals `M18 6 6 18M6 6l12 12`), no package/network runtime dependency. Lucide: https://lucide.dev/icons/x, https://github.com/lucide-icons/lucide ; the Feather-derived X is MIT licensed (Copyright 2013–2023 Cole Bemis and Feather Contributors), reproduced under MIT terms (https://github.com/feathericons/feather/blob/main/LICENSE). Required original MIT copyright/license notices must accompany distribution where applicable; the existing runbook and inline source comment identify it. The icon is centred with CSS flex rather than independent pixel translations.

Feather MIT license notice retained with the icon distribution (https://github.com/feathericons/feather/blob/main/LICENSE):

> MIT License
>
> Copyright (c) 2013-2023 Cole Bemis and Feather Contributors
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


## Logo provenance and usage
Local Telegram, WhatsApp and Viber icons are from Font Awesome Free 6.7.2, CC BY 4.0, https://fontawesome.com/license/free . Source GitHub blob IDs respectively: 29a1d267ebe1112bca2741f02f69411bf6e88dc1, 47544750d64bd4c06b6df25d660678eb8576d7e3, dca0b14dfb58f6889b28f82ac072b73aebfd69b1. Kyivstar is a **BabyPark compact whitespace/format derivative, NOT byte-identical copy**, of https://commons.wikimedia.org/wiki/File:Kyivstar_2015_logo_-_Brandmark.svg ; upstream source fetched independently via Wikimedia HTTP 200 2026-10-19, 421 bytes SHA-256 169cae268d33419168c096cf146fece2e780580ccb6b2a3d9d5c9b739c462357. Path data (all five rays) match exactly; checked-in condensed version is 388 bytes SHA-256 4cc950981fda2528cab34fa090e77e64abc68ff0668c222f8b176de23a000509. Public-domain-simple-logo rationale is not trademark permission; mark remains a Kyivstar trademark. No endorsement implied.
