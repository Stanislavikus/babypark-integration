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
| G8 Chatwoot Markdown/display neutrality | DESIGN §40.3 | T09a | Website free-form text encoded; non-inert finite choice rejected | NONE | DONE |
| G9 Chatwoot message-content ceiling | DESIGN §40.2/§40.3 | T08 + T13 | final Website content >150000 Unicode code points => `FIRST_LINE_RENDERER_INVALID`, zero send | NONE | DONE |
| G10 template semantic edge invariants | DESIGN §40.4 closing invariants | T07 + T10 | equal RANGE / impossible full-partial counts reject; partial named=0 uses explicit branch | NONE | DONE |
| genuine C4 decision provenance | DESIGN §40.2 | T11 | clone/forgery rejected | NONE | DONE |
| exact public `reason -> template_id` relation | DESIGN §40.2 + existing §16.2 | T11 + T03 | impossible public tuple rejected; private family not reconstructed | NONE | DONE |
| no cards/network/image fetch in C5 v1 | DESIGN §40.2/§40.4 | T12 | only frozen text/input_select outputs are representable | NONE | DONE |
| HUMAN public silence | DESIGN §40.2 + existing §16.2 | T08 + existing T03 | HUMAN => `null`, not fallback text | NONE | DONE |
| exact-locale/no fallback | DESIGN §40.2–§40.4 + existing §16.2 | T07/T10 + existing T01/T03 | unsupported/missing locale => renderer failure | NONE | DONE |
| C6 send/activation stays downstream | DESIGN §40.2 and unchanged §29.7–§29.9 | T13 + U01–U07 remain C6 | C5 performs no Chatwoot/network call | NONE | DONE |
| normative lifecycle prose no longer claims C4 absent | DESIGN/ACCEPTANCE closing lifecycle prose | static review against merged PR #107 / base main `565f8eb3…` | stale lifecycle claim removed; proposal still non-authorizing | NONE | DONE |

Research finding motivating the Liquid safety amendment:
Chatwoot v4.18.0 `Message` includes `Liquidable`; outgoing message content is
processed during create and Liquid errors are not a BabyPark fail-closed
renderer boundary. The proposal rejects Liquid opening delimiters in
dynamic/final public strings rather than attempting raw-tag escaping.

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
