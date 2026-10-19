# BabyPark Contact Launcher L1 — preview and site runbook

Status: RUNBOOK
Applies to: web/contact-launcher/**, Drupal 7 active babypark2 theme, existing Chatwoot Website Inbox.
Supersedes: none.

## Fixed approval and scope
Owner pre-code GO (2026-10-19) binds alternatives scan SHA-256 8f1c0dc9562bd2c7e4383f3dc8972c329061bac04f5ae8e068d416a0dfe5f7eb and architecture fit SHA-256 4f930276a7db2b1907a5f94e058df32b590ee29673693af4dcca2d1aff958cc6. Canonical main when approved: f3d92325e6b4ef04f0137c4c49dde07c05731bbe; Agreement blob e777fce4af8e8c3372f1f9de9ef7d00f786c2c89.

This approval covers preparatory L1 branch code only. It is NOT merge, live site deployment, header editing, callback collection or n8n authorization.

## Solution
Pure static, CMS-neutral JS/CSS; local SVGs. Existing official Chatwoot 4.18.0 Website SDK from https://chat.babypark.ua/packs/js/sdk.js, configured hideMessageBubble=true and locale=uk. Website chat entry remains hidden until chatwoot:ready + callable window.$chatwoot.toggle. No API bearer tokens in JS. External messengers open customer apps directly, existing Chatwoot inboxes handle seller traffic. No callback form in L1; callback delivery/PII and n8n belong to separately approved L2.

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
3. Place babypark-launcher.js, babypark-launcher.css and icons/ under a static, versioned theme asset directory; copy config.example.js to local deployment config, setting the PUBLIC Chatwoot Website token and only independently verified channel enabled flags. Never embed Chatwoot API token or Viber token.
4. Check 320/375/390/430px and desktop pages for product/cart/checkout overlays, CSP, cache, script order, duplicate floating Chatwoot default bubble, chat panel opening and closing, no clipping, actual deep links/dialer; keyboard tab/Escape/outside click.
5. CSS right inset mobile is 22px (half of V4 preview's 44px), NOT a known site-wide fact. Tune --bp-mobile-right and --bp-mobile-bottom against the real site sticky/footer navigation before activation.
6. Run exact immutable HEAD/tree/base root npm test, diff --check and all applicable normative verification/review requirements. Obtain a separate owner merge GO and a separate production deployment GO. No automatic merge.
7. Record deployed assets, actual version, rollback reference, health/channel activation and manually created objects in docs/INFRASTRUCTURE_REGISTRY.md and docs/CURRENT_STATE.md during the approved production release.

## Rollback
If site UI regresses, remove new CSS/JS includes and restore pinned template, keeping defunct Bitrix24 loader OFF. For a failing channel disable only that channel, purge relevant static config cache, do not imply delivery succeeded. No changes to Chatwoot transcript authority.

## Logo provenance and usage
Local Telegram, WhatsApp and Viber icons are from Font Awesome Free 6.7.2, CC BY 4.0, https://fontawesome.com/license/free . Source GitHub blob IDs respectively: 29a1d267ebe1112bca2741f02f69411bf6e88dc1, 47544750d64bd4c06b6df25d660678eb8576d7e3, dca0b14dfb58f6889b28f82ac072b73aebfd69b1. Kyivstar five-ray brandmark follows public-domain-simple-logo media at https://commons.wikimedia.org/wiki/File:Kyivstar_2015_logo_-_Brandmark.svg ; logo remains a trademark. No brand endorsement implied.
