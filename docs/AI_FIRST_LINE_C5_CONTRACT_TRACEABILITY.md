# C5 renderer contract freeze — docs-only traceability

Status: EVIDENCE — NON-NORMATIVE
Applies to: BabyPark AI First Line Website v1 / Slice C5 pre-code contract amendment.
Supersedes: none.

Exact proposal base:
- canonical repository: `Stanislavikus/babypark-integration`;
- base/main: `565f8eb30bf39afa80bb4d59258cc2fd13aa67d5`;
- base tree: `2d5a1bdb8e85c4324d7235d7b40d311b66ce40c4`;
- governance Agreement blob:
  `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`;
- deployed Chatwoot capability inspected: v4.18.0.

PRODUCTION IMPLEMENTATION: NONE.

This artifact maps the complete docs-only change. It is evidence only; the
proposed DESIGN/ACCEPTANCE bytes remain non-authoritative until merged.

| Requirement / invariant | Proposed artifact clause | Verification / future regression | Fail-closed behavior | Durable-state impact | Status |
|---|---|---|---|---|---|
| G1 exact uk/ru wording | DESIGN §40.4 | ACCEPTANCE T07 golden bytes | missing/unknown branch => `FIRST_LINE_RENDERER_INVALID`, zero send | NONE | DONE |
| G2 exact critical formatting + TextRenderer bytes | DESIGN §40.2–§40.4 | T08/T10/T07 | invalid/unsupported value => renderer failure, no fallback | NONE | DONE |
| G3 fixed payment names/no hidden terms | DESIGN §40.3/§40.4 | existing T04 + T07 | unknown code/term cannot render | NONE | DONE |
| G4 WebsiteRenderer exact envelope | DESIGN §40.2 | T08 + T12 | non-exact shape/content type rejected | NONE | DONE |
| G5 TextRenderer exact output | DESIGN §40.2/§40.4 | T08 + T07 | non-exact shape/branch rejected | NONE; adapter remains unconnected | DONE |
| G6 single renderer error contract | DESIGN §40.2 | T13 | `FIRST_LINE_RENDERER_INVALID`, no fallback/old render reuse | NONE | DONE |
| G7 Chatwoot Liquid safety | DESIGN §40.3 | T09 | unsafe delimiter => renderer failure before output; final recheck | NONE | DONE |
| G8 Chatwoot Widget/Dashboard display neutrality | DESIGN §40.2/§40.3 | T09a | Website dynamic text uses reversible numeric-entity transport; Widget Markdown and Dashboard input-select DOMPurify display exact text with zero dynamic markup | NONE | DONE |
| G8a exact product-URL transport | DESIGN §40.2–§40.4 | T09/T09a/T12 | canonical Website `product_url` uses the same reversible numeric-entity encoding and remains exact visible **non-clickable** text; literal Liquid opening delimiter rejects | NONE | DONE |
| G8b submitted select title is untrusted | DESIGN §40.3 | T09c + existing C4 exact-read tests | C5 creates ordinal titles, but BabyPark authority consumes only exact `submitted_values[0].value`; tampered title cannot authorize a fact | NONE | DONE |
| G9 Chatwoot message-content ceiling | DESIGN §40.2/§40.3 | T08 + T13 | final Website content uses Unicode code-point count, including astral controls; >150000 => `FIRST_LINE_RENDERER_INVALID`, zero send | NONE | DONE |
| G10 template semantic edge invariants | DESIGN §40.4 closing invariants | T07 + T10 | equal RANGE / impossible full-partial counts reject; partial named=0 uses explicit branch | NONE | DONE |
| G11 Chatwoot transport/build drift | DESIGN §40.3 activation revalidation rule | T09b | unproven/changed package/source/manifest-selected bundle or missing source-map/build provenance blocks WebsiteRenderer activation/send; no v4.18 assumption fallback/core patch | NONE | DONE |
| genuine C4 decision provenance | DESIGN §40.2 | T11 | clone/forgery rejected | NONE | DONE |
| exact public `reason -> template_id` relation | DESIGN §40.2 + existing §16.2 | T11 + T03 | impossible public tuple rejected; private family not reconstructed | NONE | DONE |
| no cards/network/image fetch in C5 v1 | DESIGN §40.2/§40.4 | T12 | only frozen text/input_select outputs are representable | NONE | DONE |
| HUMAN public silence | DESIGN §40.2 + existing §16.2 | T08 + existing T03 | HUMAN => `null`, not fallback text | NONE | DONE |
| exact-locale/no fallback | DESIGN §40.2–§40.4 + existing §16.2 | T07/T10 + existing T01/T03 | unsupported/missing locale => renderer failure | NONE | DONE |
| C6 send/activation stays downstream | DESIGN §40.2 and unchanged §29.7–§29.9 | T13 + U01–U07 remain C6 | C5 performs no Chatwoot/network call | NONE | DONE |
| C5 wording makes no downstream C25 capability promise | DESIGN §21 + §40.4 `TPL_PRODUCT_PRICE_RANGE_V1` | T07 exact golden wording | renderer states only current proven price range; public invitation waits for reviewed C25 routing | NONE | DONE |
| C5 render output remains transient / Chatwoot transcript authority | DESIGN §40.2 + §29.8 | T08 + T13 | no DB/file/cache/outbox/log/content-digest persistence in C5 | NONE | DONE |
| normative lifecycle prose no longer claims C4/prerequisite absent | DESIGN §29.4 + DESIGN/ACCEPTANCE closing lifecycle prose | static review against merged PR #107 / base main `565f8eb3…` | stale lifecycle claims removed; historical C1 evidence preserved; proposal still non-authorizing | NONE | DONE |

Deployed Chatwoot transport evidence (2026-10-07):
- `chatwoot-web.1.service` and `chatwoot-worker.1.service` both use
  `WorkingDirectory=/home/chatwoot/chatwoot`; live Puma/Sidekiq processes have
  that same cwd;
- that deployed runtime directory is a clean Git checkout with package
  `4.18.0`, exact HEAD
  `9f920b549c14491a4e587687a3eed5d21c6ccc7d`, tree
  `16432eeeef9153f7aff66be382e04a20e6f5683a`, exact tag `v4.18.0`, and
  origin `https://github.com/chatwoot/chatwoot.git`;
- the following inspected deployed tracked files byte-match that exact deployed
  Git tree by SHA-256; the exact Git HEAD/tree above binds the remaining tracked
  source, while this subset names the surfaces directly exercised by the C5
  transport proof:
  - `app/models/concerns/liquidable.rb` =
    `acca8cff5ff2b9828918c2a6a856148831383a4d4c09eedfd2f07849c07ff05f`;
  - `app/models/message.rb` =
    `b31b98c28bbe2fe6bed2b78d6cc2553830a9217236c179c78791e8b6c9cb7701`;
  - `app/builders/messages/message_builder.rb` =
    `5934d5e80388f5d7a6cd7bfe5b77e4946cf1b786d47e6fcf151eb54796379c2a`;
  - `app/controllers/api/v1/accounts/conversations/messages_controller.rb` =
    `d80ccb5ae741cdd8f8565ece81ec45b0a20c189b8c2516635bfca1c8459f9c07`;
  - `app/controllers/api/v1/widget/messages_controller.rb` =
    `d4085a98ddb5d53efa54cb9bcfe309556b40cea5ef0808a6fd6dee93067ba3c5`;
  - `app/models/concerns/content_attribute_validator.rb` =
    `9b27c1eb9a19cbb30ed764934d3ec6870ce17d22e2af16ab68513154f96fb3d5`;
  - `app/javascript/shared/helpers/MessageFormatter.js` =
    `9b0624c797868ba8e3f486b4a92465fbea626c3e4a988c927a2606ec2bc805c1`;
  - `app/javascript/shared/helpers/markdownIt/link.js` =
    `81dbdabeb17a5e3dbee645bd5cf1d32b5f539fc92e94990182e7ca940272e415`;
  - `app/javascript/widget/store/modules/message.js` =
    `54c0de34a9d32f254451daf424f22ef93926a02044f96028a2cc9dc85d239c9f`;
  - `app/javascript/widget/api/message.js` =
    `4a9f1858f8417b135b93a4751ca7f160bbb9b9af1bd2b2f56e207216280fb6c8`;
  - `app/javascript/widget/components/AgentMessage.vue` =
    `c79abf6b2a0bbd82789ea3481aa01d9228a006ae51da770970c0328cc10a4cf0`;
  - `app/javascript/widget/components/AgentMessageBubble.vue` =
    `fc6486b9cbe6b99519be3ae58312a11aceba00ba9abf79b484e06a12999e4ff2`;
  - `app/javascript/widget/components/UserMessage.vue` =
    `3c109084a3c6589f97fc7d2f4a26d2c48a3e8d2515f8ddf46655c252b8f5353f`;
  - `app/javascript/widget/components/UserMessageBubble.vue` =
    `fe94b6b6d81f30110d7c905c98daf597ea7149c6d0e54bc770b28fd080290eda`;
  - `app/javascript/shared/components/ChatOptions.vue` =
    `f739d69b9ed1816a467c18d805db60dc4252ee13a48f15c167b4fe045b3f75da`;
  - `app/javascript/shared/components/ChatOption.vue` =
    `6458a84c3657b77178944fbb698adf4064690d8353d4b6d739c1348bfa44ef8b`;
  - `app/javascript/dashboard/components-next/message/bubbles/Form.vue` =
    `36cecb98a730c7366f52a931c5df380a8e693d39b6ea97f10e62c882b421a22b`;
  - `app/javascript/shared/helpers/HTMLSanitizer.js` =
    `fff010cefdea9fb3f7a5329139d4a6c48bc42ff1b8c69de969599f9b76831de5`.
- production Rails/ViteRuby reports `public_output_dir=vite`, so the active
  production browser output is `public/vite`; those artifacts are gitignored,
  so their proof is recorded separately from the Git-tree proof:
  - `public/vite/.vite/manifest.json` =
    `457fa387c7aaf9535120dc853ee6ffed13683ade1c3a078630f718248575c386`;
  - manifest-selected Widget entry `widget-HNkSWIvT.js` =
    `a6984ec64e4ed58257d5fe2a327e7e38318ae885d9f99f5e56924b6f8de6b039`,
    map = `6a521baa29e09df30df8d42c55894d9f1dddf481576ae6346006bbf88b168f4d`;
  - Widget Messages chunk `Messages-D0A25Cnc.js` =
    `0d737fc10d0b90c95cfd7f1c0442f1099a0d46dad29b5a8a90980104c066c87d`,
    map = `6c323e54c4396558264584d27744304258938e4291baceeaad7e0d34a73f8f47`;
  - shared formatter chunk `vue-dompurify-html-BBBlF4HL.js` =
    `461360d9fc7518ed6f34a05030f0df50224e2b604f555fcc6bd79743e43e451f`,
    map = `30848032d6fc6559311f85a935e3f69335642fa0c3ca116944b7ff53ad7182d3`;
  - manifest-selected Dashboard entry `dashboard-TxcAcOOW.js` =
    `980d1d757f28042b224bfa50e2a34e8c07c6806e05af4e3dc4d0ef2d9d29ee1b`,
    map = `b52666255f7b19d20b2ed953a06d91344848bfc973cb1ac1edc5bb558796917d`;
  - Dashboard sanitizer chunk `HTMLSanitizer-t5CP4hmt.js` =
    `3c8ff53c97e2a7ce45258140df9655062c9007dd0327bef4eaa8ca663284e2c3`,
    map = `6c7861d8dfa934c5c3e0133b9c5cee03c4782dfc3e3270f81970e033839831de`;
  - DOMPurify chunk `purify.es-yM5BOMUm.js` =
    `2742409cbb786796e83a82f7dfed4fbcca6756ce2ba5dd93c0902658a95e62f4`,
    map = `4d1d18cc786620eb992d684599650d820fa1de733176c55cfe042013f5bd02d5`;
    that map's `dompurify@3.4.13/dist/purify.es.mjs` `sourcesContent` SHA-256
    `1939de7b9b248a4ffdf7f8065af45116a1babb96362eaf84d8f9fc3756c26fad`
    byte-matches the installed package source, whose pnpm integrity is
    `sha512-2vmYIoqjze2d+kakP8S/nS5shfsl587kzwEjcGlTdiksUVgFHnFCsLYDVj/JNqJVOQZGSYBTmuycv0PodwmnMQ==`.
- the current source maps byte-match the tracked Widget store/API,
  AgentMessage/AgentMessageBubble/UserMessage/UserMessageBubble/ChatOptions/
  ChatOption, MessageFormatter/mention-plugin, Dashboard Form and HTMLSanitizer
  source bytes listed above. The current locked behavior uses
  `markdown-it 14.1.1`, `markdown-it-link-attributes 4.0.1`,
  `DOMPurify 3.4.13` and `vue-dompurify-html 5.3.0`.

Catalog representability check motivating ordinal button titles:
- production `CURRENT` points to
  `catalog.g_bcd3c2836b25ab4252f8f5510c769f260e0597092fea8aff.sqlite`; the
  generation reports `state=ready`, IdentityStore revision `65506`, and
  manifest SHA-256
  `ba157e2cdc2b01b3ba692ba0a9ef20d17790d2528cc3b0af74969a3b2fb53335`;
- the exact conservative button-label reject predicates from the historical
  pre-ordinal proposal commit
  `1c11403c114c57cafcfbf5573d2537aa03a0527a` were replayed read-only against
  that CURRENT generation using the merged CatalogService variant-label
  semantics;
- the replay rejected 90/32311 exact-locale product-title rows (0.279%) and
  24/7486 displayable active IN_STOCK variant labels (0.321%; active IN_STOCK
  total 8673);
- observed legitimate shapes included `Zero.Zero`, `2.Go`, `MK.VB`,
  `200*90 см`, `Black_1` and `Authentic Cognac*2`. The proposal therefore
  keeps factual labels in transport-neutral entity-encoded message content and uses only
  the generated ordinal as native button title. No catalog bytes are persisted
  by C5.

Research findings motivating the Website transport-safety amendment:
Chatwoot v4.18.0 `Message` includes `Liquidable`; outgoing message content is
processed during create and Liquid errors are not a BabyPark fail-closed
renderer boundary. WebsiteRenderer therefore rejects literal Liquid opening
delimiters in dynamic/final Website content rather than attempting raw-tag
escaping. The customer Web Widget renders content through `markdown-it` with
`linkify=true`, while the agent Dashboard `input_select` Form path feeds the
stored content directly to DOMPurify. Backslash Markdown escaping is therefore
not presentation-neutral: e.g. `Black\_1` displays as `Black_1` in the
Widget but leaks the backslash in Dashboard, and HTML-shaped labels can tokenize
differently. The verified dual-surface solution is the exact §40.3 uppercase-hex
numeric-entity encoder; it preserves visible punctuation/URLs while preventing
dynamic Markdown/HTML/link/image creation on both applicable native views.
TextRenderer remains transport-neutral and unconnected in C5.

Chatwoot Widget submission also accepts client-supplied
`submitted_values[:title,:value]` without server-binding title to the original
item. C5 therefore owns only the pre-submit ordinal title; BabyPark selection
authority remains the exact submitted `value` plus C2/C4/C6 provenance. A
tampered title is customer presentation data, not factual authority.

Implementation-order status:
- this docs-only stage makes no production implementation choice and therefore
  binds no alternatives-scan digest;
- after this contract merges, prior C5 alternatives research is stale because
  the bounded requirements changed;
- production C5 must run/freeze a fresh Agreement §§1/3 alternatives scan and
  obtain owner approval before production code.

Correction inventory from the first exhaustive V1-tree review:
- B1 false deployed-runtime provenance -> exact systemd/process/Git tuple above;
- B2 stale “existing C6 renderer-failure path” -> T13 now states a future C6
  requirement and preserves C6 ownership;
- B3 bare-link URL target drift -> Website product URLs are Markdown-neutral
  non-clickable text; T09/T09a/T12 cover literal-Liquid and URL edge cases;
- B4 incomplete DESIGN tail scope -> review-status prose now binds the complete
  §40.2–§40.4 contract;
- B5 UTF-16/code-point ambiguity -> DESIGN and T08/T13 explicitly require
  Unicode code-point counting with astral controls.

Correction inventory from the second exhaustive V2-tree review:
- B6 tracked-source-only runtime proof omitted gitignored production Vite
  artifacts -> exact production manifest/chunk/map hashes and source-map
  equivalence are now recorded; T09b requires this bundle/build proof;
- B7 deployed typographer changed ASCII apostrophe in UK CASH_COURIER ->
  frozen spelling now uses stable U+2019 and T07 checks it;
- B8 native Widget PATCH does not bind submitted title to original ordinal ->
  DESIGN/T09c mark title untrusted and keep BabyPark authority on exact
  `submitted_values[0].value` only;
- B9 backslash Markdown escaping leaked/distorted finite-CLARIFY content in the
  agent Dashboard DOMPurify path -> Website dynamic punctuation now uses the
  proven dual-surface uppercase-hex numeric-entity encoder and T09a covers both
  Widget and Dashboard.

Correction inventory from the third exhaustive current-tree review:
- B10 active DESIGN prose still named the superseded Markdown/backslash
  transport algorithm -> all normative active-algorithm wording now says
  Website transport entity encoding / transport-neutral entity-encoded text;
- B11 T09b claimed complete relevant browser chunk/source-map binding while the
  DOMPurify sidecar map was omitted -> its map SHA, exact `sourcesContent`
  equivalence to installed `dompurify@3.4.13`, and pnpm integrity are now bound
  in the deployed-runtime evidence above.
Risk classification proposal: HEAVY. The amendment freezes new customer-visible
wording/presentation-safety/provenance behavior and uses the conservative HEAVY
closure path.
