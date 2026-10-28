# Universal Contact Launcher — standalone Drupal frontend

Status: EVIDENCE / LIVE VERIFIED as of 2026-10-28. Applies to: Drupal 7 BabyPark storefront launcher. Supersedes: historical L1 draft deployment notes.

**Do not mistake Drupal launcher for Chatwoot core.** Live public host is server2181.babypark.ua. Drupal root: /home/babypark/sites/babypark.ua; active theme: sites/all/themes/babypark2; template: templates/html.tpl.php. Public production versioned assets are under assets/contact/releases/callback-v1-8ab5dd5c/ of that theme. Source is in canonical babypark-integration repo, web/contact-launcher/*. Detailed exact hashes and template rollback are in [Callback RELEASES](../callback/RELEASES.md).

## Structure and lifecycle

Template load order **babypark-launcher.css → config.js → babypark-launcher.js**. Config is environment-specific and carries Website public token and channel destinations; do not copy it into Git, display raw contents, or replace with config.example.js. JS checks same-origin assetBase, builds a menu, uses locally pinned icons, guards double initialization with window.__babyParkLauncherL1 and accepts only strict expected channel URL patterns.

The actions are Chat with seller, Telegram, WhatsApp, Viber, Call and Callback (“Замовити дзвінок”). On 2026-10-28 all six live config enabled flags were true, but that proves only menu activation, not each provider connection. The Chatwoot Website SDK is lazy: loaded on **explicit Chat or Callback** selection, NOT on menu open, hover or clicking an external messenger. Stock SDK path https://chat.babypark.ua/packs/js/sdk.js; chatwoot:ready and callable toggle are required. Locale uk, Chatwoot bubble hidden. No new runtime packages, no Chatwoot fork, no customer local storage.

## Site-specific release history

PR #154 is the merged release. The Drupal theme template was atomically switched to versioned CSS/config/JS; the previous template and root L1 assets are protected off-webroot at /home/babypark/.babypark-release-backups/callback-v1-20261027-8ab5dd5c/. Old assets were not overwritten. Never delete release/backups/preview directories without specific permission. A template rollback must be hash-guarded and owner-approved.

After initial deployment Drupal page cache temporarily returned old HTML to main URL; a cache-busted query returned new HTML. Later the normal homepage self-updated (HTTP 200 with all new asset links). Two obsolete homepage query checks (bpwa=20261027-live; callback-release-check=8ab5dd5c) were independently redirected with owner-approved native Apache 301 on 2026-10-28; not separate CMS pages. Exact preimage/installed .htaccess SHA and recovery are in [Callback RELEASES](../callback/RELEASES.md) and [Draft #160](https://github.com/Stanislavikus/babypark-integration/pull/160).

## Upgrade diagnosis

If menu missing: GET main HTML, count versioned CSS/config/JS references, check asset GET and SHA, effective enabled flags without printing public token, CSP, site origin, mobile view and console errors. **Never first edit Chatwoot Rails**. If chat icon works but Callback fails, follow Callback internal Widget/automation runbook. If Viber/Telegram/WhatsApp link navigates but no message reaches operator, investigate the channel's native provider-to-Inbox route; external deep links are not Widget POSTs.

Frontend code changes require relevant unit/browser regression and governed owner deployment; changes to Chatwoot itself do not automatically require re-publishing Drupal JS. Use only the approved release and verified source digests.
