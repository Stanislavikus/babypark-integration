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
| G9 Chatwoot message-content ceiling | DESIGN §40.2/§40.3 | T08 + T13 | final Website content >150000 Unicode code points => `FIRST_LINE_RENDERER_INVALID`, zero send | NONE | DONE |
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
- deployed package reports `4.18.0`; the deployment tree has no `.git`, so no
  deployed Git HEAD is claimed;
- the following deployed files byte-match upstream Chatwoot v4.18.0 commit
  `9f920b549c14491a4e587687a3eed5d21c6ccc7d` by SHA-256:
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
- current catalog generation inspected:
  `g_bcd3c2836b25ab4252f8f5510c769f260e0597092fea8aff`;
- a reject-on-Markdown-syntax button-label design would have rejected 90/32311
  exact-locale product-title rows (0.279%) and 24/7486 active IN_STOCK joined
  variant labels (0.321%);
- observed legitimate shapes included dot-separated model names, dimensions with
  `*`, and underscore-suffixed option labels. The proposal therefore keeps the
  factual label in Markdown-neutral encoded message content and uses only the
  generated ordinal as native button title. No catalog bytes are persisted by C5.

Research finding motivating the Liquid safety amendment:
Chatwoot v4.18.0 `Message` includes `Liquidable`; outgoing message content is
processed during create and Liquid errors are not a BabyPark fail-closed
renderer boundary. WebsiteRenderer therefore rejects Liquid opening delimiters
in dynamic/final Website content rather than attempting raw-tag escaping.
TextRenderer remains transport-neutral and unconnected in C5.

Implementation-order status:
- this docs-only stage makes no production implementation choice and therefore
  binds no alternatives-scan digest;
- after this contract merges, prior C5 alternatives research is stale because
  the bounded requirements changed;
- production C5 must run/freeze a fresh Agreement §§1/3 alternatives scan and
  obtain owner approval before production code.

Risk classification proposal: HEAVY. The amendment freezes new customer-visible
wording/presentation-safety/provenance behavior and uses the conservative HEAVY
closure path.
