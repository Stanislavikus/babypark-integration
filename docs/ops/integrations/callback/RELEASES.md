# Callback V1 — release identity, hashes, rollback

Status: EVIDENCE / non-normative release manifest. Applies to: Chatwoot v4.18.0 and Drupal V1 release on 2026-10-27, rechecked 2026-10-28. Supersedes: historic preview versions.

## Frozen source and owner approval

Repository Stanislavikus/babypark-integration. Final source HEAD **8ab5dd5c51a6fc2b6863323839ba9f5674b6bfba**, TREE **22c1962c95ed1277565a30a115133a2d980f3c50**, original BASE **1d5d8c00b7fdcdb54f37418ea60931c4292fd600**; Agreement blob **e777fce4af8e8c3372f1f9de9ef7d00f786c2c89**. Required-verification manifest SHA256 **9138b596a66de77e59801142bee71218315b119e4987a9515e32feedbc8e3c9e**. Final owner approval bundle SHA256 **ec34b5b09f8407a47a520dead38ace3cdfaf01895984a3952c1189275bc191e4**, explicit owner GO on 2026-10-27T22:00:12Z. Independent HEAVY R1 and context-isolated R2 **ZERO BLOCKERS**. Merge commit/main **bd1202ae614afcf59bc83e3c733e7e73db4e32ad**, same approved tree. [Primary PR #154](https://github.com/Stanislavikus/babypark-integration/pull/154) (owner approval comment 6454721674; deployment comment 6454895390).

R2 exact-tree checks passed: focused 85; root 1277 unit +13 legacy +13 refactor; native-browser keyboard/clipboard 21. Do not interpret historical tests as certification of later code or versions.

## Actual Drupal release asset bytes observed 2026-10-28

Root directory **/home/babypark/sites/babypark.ua/sites/all/themes/babypark2/assets/contact/releases/callback-v1-8ab5dd5c/** on **server2181.babypark.ua**:

| File | SHA256 |
|---|---|
| babypark-launcher.js | 8b5538d75b93678827698332201059f6866fef1255ebfae214e94f2f1c277c45 |
| babypark-launcher.css | d5ac67127df89df04e8cd7fff02d033947381445826403a8ace2c37dba5600ba |
| config.js (NEVER print contents) | 91c3a8e827a8058d6a17b57d3f3a031f39cb462b57708728ae71b3efbb80d865 |
| icons/bp-emblem-avatar-64.png | fa5a882453439306686df1e4c97387e601de6f9075e519082619fd29aa628d02 |
| icons/telegram.svg | 0aff9f342e7451a572fc88cb8716b13e03a2d29e9e97787a1d597f24acb323f9 |
| icons/viber.svg | 22666db7127efe7075c822b186299f08a918c26e6778176f8a3a1bea2a694028 |
| icons/whatsapp.svg | 5b2054497bf8bdc009569dcb19ec6c41a133e9d7e813aa9d18507edb33fedbe9 |
| icons/kyivstar.svg | 4cc950981fda2528cab34fa090e77e64abc68ff0668c222f8b176de23a000509 |

Live config's six enabled booleans (chat, callback, telegram, whatsapp, viber, phone) were all true on 2026-10-28. This does not independently prove roundtrip for every messenger; don't mistake config for provider status. Homepage HTTP 200 publicly references all three new CSS/config/JS files.

Atomic Drupal theme template html.tpl.php preimage SHA256 **78d1c0105fdce47716bb3cfb61f54efe05a35cd46706885b5b334b86abf25f0e**; installed SHA256 **e9bf21fdfd4406bbed65fe55333ef7d8726a3f76fe4cc9c9c6d3375f08df7873**. Protected rollback directory **/home/babypark/.babypark-release-backups/callback-v1-20261027-8ab5dd5c/** (0700), preimage template and prior L1 assets/config with manifest. Old L1 assets preserved, not overwritten. Do NOT delete rollback/preview folders. Any restore requires current file hash + preimage hash verification and explicit owner action.

## Actual Chatwoot platform

Chatwoot **VERSION_CW 4.18.0**, installed Git **9f920b549c14491a4e587687a3eed5d21c6ccc7d**; CORS Nginx active file **/etc/nginx/sites-enabled/nginx_chatwoot.conf** SHA256 **7486b927888cb0428009011920cffe8ac7dd34e73b2df89f1d7301b3be7f68ac**, verified 2026-10-28. Web and worker units active then. Native automation #1 old marker and #2 new two-line human prefix historically verified; recheck through native Admin UI before modifications.

Separate homepage alias cleanup 2026-10-28: two debug query URLs (bpwa=20261027-live; callback-release-check=8ab5dd5c) redirect 301 to https://babypark.ua/. Apache .htaccess original SHA256 **14f8220bd8bb2731d9e82eb9fe670373f4c11fbc72b2362565b327d0d7f71b1c**, installed **a116402ed491cf4ebbd9e74f4880d4fcc31d760375a0b9bf1060b7fa61d795c1**. Protected copy **/home/babypark/.babypark-release-backups/query-check-url-redirects-20261028T092707Z/**, evidence [Draft #160](https://github.com/Stanislavikus/babypark-integration/pull/160). These are not separate test pages.

## Historical—not active

Original Draft PRs #142 and #153 are source ancestors; **PR #154 merged release supersedes them**. Unlinked preview directories remain separately tracked in docs/INFRASTRUCTURE_REGISTRY.md. They are NOT live reference targets and may not be deleted unless per-folder owner approval, exact inventory and recoverable copy are proven. Email continuity PR #150 and privacy docs PR #159 are separate Drafts.
