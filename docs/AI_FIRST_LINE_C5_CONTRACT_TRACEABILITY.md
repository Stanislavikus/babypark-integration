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

| Gap / invariant | Proposed normative artifact | Verification / future executable regression |
|---|---|---|
| G1 exact uk/ru wording | DESIGN §40.4 | ACCEPTANCE T07 golden bytes |
| G2 critical formatting | DESIGN §40.3 | T10 + T07 |
| G3 fixed payment names/no hidden terms | DESIGN §40.3/§40.4 | existing T04 + T07 |
| G4 WebsiteRenderer envelope | DESIGN §40.2 | T08 + T12 |
| G5 TextRenderer output | DESIGN §40.2 | T08 |
| G6 result/error contract | DESIGN §40.2 | T13 |
| G7 Chatwoot Liquid safety | DESIGN §40.3 | T09 |
| genuine C4 decision provenance | DESIGN §40.2 | T11 |
| no cards/network/image fetch in C5 v1 | DESIGN §40.2/§40.4 | T12 |
| HUMAN public silence | DESIGN §40.2 + existing §16.2 | T08 + existing T03 |
| exact-locale/no fallback | DESIGN §40.2–§40.4 + existing §16.2 | T07/T10 + existing T01/T03 |
| C6 send/activation remains downstream | DESIGN §40.2 and unchanged §29.7–§29.9 | T13 + U01–U07 remain C6 |

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
