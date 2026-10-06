# BabyPark AI First Line — C4 Production Traceability

Status: EVIDENCE — NON-NORMATIVE
Applies to: PR #107 C4 production runtime campaign.
Supersedes: none.
Pinned campaign base: `f60c42ca929c55b4bd4c06da5da7558bead5b486`.
Governance Agreement blob: `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.
Risk tier: **HEAVY**.

Bound production-options scan SHA-256:
`3b2f4445d2412a20546ac31a1ad98f30b4d2d25a0fd50f368b4f8790a95035c2`.

Bound property-tooling fit evidence SHA-256:
`5797e655dadd86d8e72f5435a215171ad7be5713a0110655e97a1dc979e9bf60`.
Property-tooling owner approval: **PENDING**.

This is the pre-code traceability/verification contract for the production
campaign. It is not the final AI_WORKING_AGREEMENT §7.0a manifest because the
final exact implementation HEAD/tree does not exist yet. Before the first
zero-BLOCKER pass, a final required-verification manifest must bind the exact
final HEAD/tree/base and must include every mandatory check below. It may add
checks; it may not remove or weaken them.

## 1. Production implementation boundary

In scope:
- v0.7 durable CATEGORY identity retrofit:
  `(category_id,category_match_mode)`;
- atomic same-provenance persistence/restart re-proof for that pair;
- DecisionBasis authority/composition seam;
- pure deterministic C4 decision kernel;
- exact typed C4 decision projection;
- focused + property/state-space verification.

Out of scope:
- C5 renderer implementation;
- C6 Chatwoot/public-action wiring;
- Voice/Asterisk;
- Telegram/Viber customer-facing AI;
- Chatwoot core changes.

## 2. Mandatory final verification baseline

The final §7.0a manifest must include, at minimum:

1. exact `CAMPAIGN_BASE_OID` binding;
2. `git diff --name-status "${CAMPAIGN_BASE_OID}..HEAD"`;
3. `git diff --check "${CAMPAIGN_BASE_OID}..HEAD"`;
4. fresh dependency materialization from the exact final lockfile in an empty
   dependency layer; no inherited `node_modules` or executable cache;
5. final-root `npm test` PASS because this campaign changes runtime/tests/package
   surfaces;
6. every package-local behavioral-owner suite discovered from the final changed
   paths/import graph; none may be omitted merely because root tests overlap;
7. storage-policy validation;
8. focused state-store migration/restart/CAS/rollback/corruption tests for the
   CATEGORY pair;
9. focused DecisionBasis authenticity/single-use/composition tests;
10. focused deterministic C4 reducer/authority-mapper/projection tests;
11. mandatory complete fixed-vector coverage for every traceability row in
    §§5-8 below;
12. mandatory maintained property/state-space tests using the approved OSS
    property tool; no custom generic property-testing framework;
13. explicit checked-in seeds/configuration for randomized generation plus fixed
    regression vectors for every discovered counterexample; unrecorded random
    defaults are not gate evidence;
14. exhaustive mapper-key equality tests against the exact emitted
    Catalog/Knowledge family/status/reason unions;
15. exact eight-key public decision shape and no-leakage tests;
16. public text/URL safety property/regression tests;
17. exact locale `uk|ru` / no-fallback tests;
18. final fresh-checkout/full-suite execution with exact toolchain/dependency
    provenance and immutable inputs per Agreement §7.0a;
19. final traceability terminal: every in-scope row below must be `DONE`;
20. HEAVY exhaustive self-review ZERO BLOCKERS followed by one run-independent
    isolated exhaustive confirmation ZERO BLOCKERS on the unchanged exact basis.

No row may be closed by a generic happy-path assertion. The mapped focused
verification must fail before the relevant implementation exists or is wrong and
pass only when the frozen behavior is satisfied.

## 3. Post-adoption SQLite writer inventory

Agreement §5 requires the first post-adoption SQLite-writing change in the
component to inventory writable constructors against adoption base
`736705bc4cae70974870fb9f0e9a5c8c69d4549b`.

Observed in `src/copilot/**` on the adoption base and current campaign base:
- `episode-store.mjs`: `DatabaseSync` constructors; active writer sets
  `PRAGMA busy_timeout=5000`;
- `first-line-state-store.mjs`: schema/open constructors; active writer and
  writable migration/open path set `PRAGMA busy_timeout=5000`;
- `knowledge/store.mjs`: writer uses timeout/busy_timeout; unchanged by this campaign;
- `copilot/store.mjs`: writer uses `timeout:5000`; unchanged by this campaign.

PR #107 materially changes `first-line-state-store.mjs` write/schema behavior.
Therefore its final tests must prove:
- every touched writable connection keeps explicit busy timeout;
- migration/schema change is restart-safe and fail-closed;
- stale expected-version/CAS writers cannot overwrite newer semantic state;
- category ID and match mode commit atomically with identical provenance;
- corrupt/partial/mode-invalid durable state cannot authorize C4.

## 4. Property/state-space policy

The frozen contract state-space in
`docs/AI_FIRST_LINE_C4_TRACEABILITY.md §4` remains authoritative.

Coverage strategy:
- every finite boundary/control class named in C60/T/U is an explicit fixed
  vector or deterministic generated finite class;
- property generation exercises permutations/combinations, malformed unknowns,
  ordering independence and public text/URL inputs;
- shrinking may minimize failures but never replaces the fixed normative vector;
- any property counterexample becomes a checked-in fixed regression before
  closure;
- no probabilistic pass may waive a fixed vector.

## 5. RC1-RC19 traceability

| ID | Requirement | Planned implementation surface | Mandatory verification | Fail closed | Durable impact | Status |
|---|---|---|---|---|---|---|
| RC1 | one genuine single-use sealed DecisionBasis | `src/copilot/first-line-decision-authority.mjs`, decision kernel | authenticity/clone/replay property + focused tests | reject | none | IN PROGRESS |
| RC2 | complete identity-row multiset reduction | decision kernel | pair/multiset permutations | HUMAN/reject | none | IN PROGRESS |
| RC3 | current authority outcome inside basis | authority seam | exact-ID/current-generation binding tests | no basis | none | IN PROGRESS |
| RC4 | closed clarification budget 0/1 | decision kernel | budget domain + precedence properties | reject/HUMAN | none | IN PROGRESS |
| RC5 | contentful NOT_FOUND keeps C3 provenance | decision kernel | NOT_FOUND × C3 latch matrix | HUMAN | none | IN PROGRESS |
| RC6 | deterministic closed request-family set | authority/basis seam | 0/1/>1 family permutations | reject/HUMAN | none | IN PROGRESS |
| RC7 | pre-authority clarification reducer | authority/basis seam | clarify-set cardinality + authority-call spies | HUMAN/CLARIFY | none | IN PROGRESS |
| RC8 | exhaustive authority-family outcome tables | authority adapters + decision kernel | exact mapper-key equality | reject unknown | none | IN PROGRESS |
| RC9 | total terminal precedence | decision kernel | cross-gate precedence property model | earlier gate wins | none | IN PROGRESS |
| RC10 | singular-slot cardinality | decision kernel | same-kind row permutation matrix | HUMAN | none | IN PROGRESS |
| RC11 | response-locale containment | authority/basis + projection | uk/ru/other disagreements | HUMAN | none | IN PROGRESS |
| RC12 | exact typed decision projection | decision kernel | exact eight-key schema/no leakage | reject | none | IN PROGRESS |
| RC13 | exact candidate presentation proof | authority seam | generation/locale/label representability | HUMAN | none | IN PROGRESS |
| RC14 | reservation-aware CLARIFY reauthorization contract inputs | state/dependency proof surfaces needed by C4 | owner/non-owner reservation proofs | zero send later | existing durable reservation only | IN PROGRESS |
| RC15 | provenance-bound clarification discharge | state/dependency/clarification proof | restart/discharge matrices | HUMAN | CATEGORY pair retrofit | IN PROGRESS |
| RC16 | finite-choice cardinality bound | decision kernel | 20 vs 21+ all finite kinds | HUMAN | none | IN PROGRESS |
| RC17 | mutable structured selection final-proof compatibility | dependency proof inputs consumed by C4 | structured mutation vectors | HUMAN later | existing provenance | IN PROGRESS |
| RC18 | typed public OperationalFact/CommercePolicy readers | authority seam | exact schema/family validators | HUMAN/reject | none | IN PROGRESS |
| RC19 | exact public presentation safety | decision kernel/authority projection | text/URL property suite | HUMAN/null/reject | none | IN PROGRESS |

## 6. C60..C60ad mandatory acceptance rows

Each row below is independently blocking and must map to a focused fixed
regression plus any applicable property generator. Status remains IN PROGRESS
until the final test/result evidence exists on the exact final tree.

| ID | Required proof | Status |
|---|---|---|
| C60 | identity collision -> HUMAN / CATALOG_IDENTITY_COLLISION | IN PROGRESS |
| C60a | PRODUCT zero candidates -> HUMAN / IDENTITY_NOT_RESOLVABLE | IN PROGRESS |
| C60b | CATEGORY/BRAND/STORE zero candidates -> IDENTITY_NOT_RESOLVABLE | IN PROGRESS |
| C60c | NOT_FOUND + C3 provenance/precedence | IN PROGRESS |
| C60d | missing/cloned/reconstructed/reused basis rejects | IN PROGRESS |
| C60e | two-row identity status-pair reduction | IN PROGRESS |
| C60f | multiple ambiguous identity kinds never choose by order | IN PROGRESS |
| C60g | >1 request family -> MULTIPLE_REQUEST_FAMILIES_MATCHED | IN PROGRESS |
| C60h | authority ID/generation mismatch prevents basis | IN PROGRESS |
| C60i | fact PRODUCT_NOT_FOUND is not identity NOT_FOUND | IN PROGRESS |
| C60j | budget 0 permits exactly one safe CLARIFY | IN PROGRESS |
| C60k | budget 1 + representable clarification -> CLARIFY_EXHAUSTED | IN PROGRESS |
| C60l | invalid/missing budget rejects | IN PROGRESS |
| C60m | post-clarification dynamic changes use fresh reread | IN PROGRESS |
| C60n | every supported pre-authority clarify reason, budget 0/1 | IN PROGRESS |
| C60o | mapper keys exactly equal frozen emitted tuple unions | IN PROGRESS |
| C60p | >1 pre-authority clarification requirement precedence | IN PROGRESS |
| C60q | total cross-gate precedence / zero inappropriate authority calls | IN PROGRESS |
| C60r | same-kind singular semantic-cardinality reduction | IN PROGRESS |
| C60s | exact uk/ru locale; other valid tag -> HUMAN; no fallback | IN PROGRESS |
| C60t | exact eight-key decision / no DTO leakage | IN PROGRESS |
| C60u | public/private candidate separation + exact-locale labels | IN PROGRESS |
| C60v | uncertified delivery policy -> COMMERCE_POLICY_NOT_AUTHORITATIVE | IN PROGRESS |
| C60w | incomplete variant labels -> PRODUCT_VARIANT_NOT_RESOLVABLE | IN PROGRESS |
| C60x | every CLARIFY has render_payload=null; free-text choices=[] | IN PROGRESS |
| C60y | label representability precedes budget | IN PROGRESS |
| C60z | PRODUCT/CATEGORY exact-generation exact-locale presentation proof | IN PROGRESS |
| C60aa | finite cardinality 20 accepted / 21+ fail closed | IN PROGRESS |
| C60ab | restart continuation discharges exactly one ambiguity | IN PROGRESS |
| C60ac | public text/URL safety boundary and internal-ID rejection | IN PROGRESS |
| C60ad | CATEGORY clarification/restart exact tuple matrix | IN PROGRESS |

## 7. T01-T06 mandatory rows

These are C5-facing contract checks even though C5 implementation is out of
scope. PR #107 must prove C4 output remains sufficient/compatible; it must not
implement C5.

| ID | Required proof | Status |
|---|---|---|
| T01 | exact response locale / no presentation fallback | IN PROGRESS |
| T02 | presentation absence does not block templates that do not need it | IN PROGRESS |
| T03 | C4 output satisfies closed pure-renderer contract surface | IN PROGRESS |
| T04 | payment-method code cannot smuggle commercial conditions | IN PROGRESS |
| T05 | critical values remain exact/non-semantic | IN PROGRESS |
| T06 | CLARIFY public/private candidate separation | IN PROGRESS |

## 8. U01-U07 mandatory rows

These are C6/send-time contract compatibility checks. C6 implementation is out
of scope; PR #107 must prove C4/state outputs and reauthorization inputs preserve
the frozen semantics needed by the later C6 campaign.

| ID | Required proof | Status |
|---|---|---|
| U01 | dynamic value may change while descriptor stays same | IN PROGRESS |
| U02 | semantic descriptor change fails stale prepared semantics | IN PROGRESS |
| U03 | stock/policy value changes under same descriptor use current result | IN PROGRESS |
| U04 | CLARIFY reservation remains exact/owner-bound | IN PROGRESS |
| U05 | restart rebuilds semantics, never deserializes DecisionBasis | IN PROGRESS |
| U05a | continuation discharges exactly one old ambiguity after restart | IN PROGRESS |
| U06 | reauthorization failure never permits stale send semantics | IN PROGRESS |
| U07 | mutable structured selection is re-proven at final boundary | IN PROGRESS |

## 9. Merge terminal

Merge is blocked until:
- property-tooling fit approval is bound;
- production implementation is complete;
- final exact-tree §7.0a manifest includes every mandatory check in this file;
- every RC/C60/T/U row above is DONE with concrete test/result evidence;
- all required fresh-environment suites PASS;
- exhaustive HEAVY self-review reports ZERO BLOCKERS;
- isolated HEAVY confirmation on the unchanged exact basis reports ZERO BLOCKERS;
- final-gate bundle and post-closure owner approval are frozen under Agreement §7.

No BUILD/scan approval, green happy-path test, aggregate npm PASS, or reviewer
summary can substitute for those terminal conditions.
