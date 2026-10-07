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
| G8 Chatwoot Markdown/display neutrality | DESIGN §40.2/§40.3 | T09a | Website dynamic labels are reversibly encoded in content; input-select titles are generated ordinals only | NONE | DONE |
| G8a exact product-URL transport | DESIGN §40.2–§40.4 | T09/T09a/T12 | canonical Website `product_url` uses the same reversible encoding and remains exact visible **non-clickable** text; literal Liquid opening delimiter rejects | NONE | DONE |
| G9 Chatwoot message-content ceiling | DESIGN §40.2/§40.3 | T08 + T13 | final Website content uses Unicode code-point count, including astral controls; >150000 => `FIRST_LINE_RENDERER_INVALID`, zero send | NONE | DONE |
| G10 template semantic edge invariants | DESIGN §40.4 closing invariants | T07 + T10 | equal RANGE / impossible full-partial counts reject; partial named=0 uses explicit branch | NONE | DONE |
| G11 Chatwoot transport-version drift | DESIGN §40.3 activation revalidation rule | T09b | unproven/changed target runtime blocks WebsiteRenderer activation/send; no v4.18 assumption fallback/core patch | NONE | DONE |
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
- the following deployed files byte-match that exact deployed Git tree by
  SHA-256:
  - `app/models/concerns/liquidable.rb` =
    `acca8cff5ff2b9828918c2a6a856148831383a4d4c09eedfd2f07849c07ff05f`;
  - `app/models/message.rb` =
    `b31b98c28bbe2fe6bed2b78d6cc2553830a9217236c179c78791e8b6c9cb7701`;
  - `app/builders/messages/message_builder.rb` =
    `5934d5e80388f5d7a6cd7bfe5b77e4946cf1b786d47e6fcf151eb54796379c2a`;
  - `app/models/concerns/content_attribute_validator.rb` =
    `9b27c1eb9a19cbb30ed764934d3ec6870ce17d22e2af16ab68513154f96fb3d5`;
  - `app/javascript/shared/helpers/MessageFormatter.js` =
    `9b0624c797868ba8e3f486b4a92465fbea626c3e4a988c927a2606ec2bc805c1`;
  - `app/javascript/widget/components/AgentMessageBubble.vue` =
    `fc6486b9cbe6b99519be3ae58312a11aceba00ba9abf79b484e06a12999e4ff2`;
  - `app/javascript/shared/components/ChatOptions.vue` =
    `f739d69b9ed1816a467c18d805db60dc4252ee13a48f15c167b4fe045b3f75da`;
  - `app/javascript/shared/components/ChatOption.vue` =
    `6458a84c3657b77178944fbb698adf4064690d8353d4b6d739c1348bfa44ef8b`.

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
  keeps factual labels in Markdown-neutral encoded message content and uses only
  the generated ordinal as native button title. No catalog bytes are persisted
  by C5.

Research findings motivating the Website transport-safety amendment:
Chatwoot v4.18.0 `Message` includes `Liquidable`; outgoing message content is
processed during create and Liquid errors are not a BabyPark fail-closed
renderer boundary. WebsiteRenderer therefore rejects literal Liquid opening
delimiters in dynamic/final Website content rather than attempting raw-tag
escaping. Chatwoot also renders ordinary Website content through
`markdown-it` with `linkify=true`: bare/angle links can normalize C4-safe URL
boundaries/bytes, so Website v1 applies the reversible punctuation encoder to
`product_url` too and emits it as exact visible non-clickable text. TextRenderer
remains transport-neutral and unconnected in C5.

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

Risk classification proposal: HEAVY. The amendment freezes new customer-visible
wording/presentation-safety/provenance behavior and uses the conservative HEAVY
closure path.
