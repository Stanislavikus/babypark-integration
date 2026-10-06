# BabyPark AI First Line — C4 pre-code contract traceability evidence

Status: **EVIDENCE — NON-NORMATIVE**
Applies to: issue #99 / PR #100 docs-only C4 contract amendment.
Supersedes: none.

Campaign base: canonical main `8e65a57b36eaf649853fa3a7aae58bf5cd5a477c`.
Base tree: `43f6ed26e5e50b9867cefebc2d8b2b17520bd4d3`.
Governance: `docs/AI_WORKING_AGREEMENT.md` blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.
Risk tier: **HEAVY** — this contract amendment changes durable semantic identity
rules and C4/C5/C6 customer-facing decision/render/send safety boundaries.
PRODUCTION IMPLEMENTATION: **NONE**.

Normative authority for this campaign is:
- `docs/AI_FIRST_LINE_DESIGN.md`
- `docs/AI_FIRST_LINE_ACCEPTANCE.md`

`docs/CURRENT_STATE.md` is operational evidence. The unchanged
`docs/KNOWLEDGE_AUTHORITY.md` remains legacy/background evidence under the
Agreement and is not used to authorize this contract.
This file does not create a second contract.

## 1. C4 boundary

C4 maps current certified semantic state to exactly one:
`ANSWER | CLARIFY | HUMAN`.

C4 does not render customer prose, call Chatwoot, send/handoff, add durable
state, persist customer content, choose authority IDs with an LLM, or invent
facts.

Planned seams:
- `first-line-decision-authority.mjs`: builds one sealed transient DecisionBasis
  from current exact reads + certified C2/C3 + deterministic family validators +
  immediate authority rereads;
- `first-line-decision.mjs`: pure deterministic mapping from a genuine
  DecisionBasis capability to one typed decision.

## 2. Implementation-options status for this docs-only stage

`PRODUCTION_CODE_STAGE: NO`.

This campaign freezes/reviews contract semantics only. It does **not** select an
implementation option and does not authorize custom production code.

The pre-Agreement notes that previously compared
`CacheControl/json-rules-engine`, `jwadhams/json-logic-js`, and
`mithunsatheesh/node-rules` are historical context only. They are not a
current Agreement §1 alternatives scan, have no authorizing digest, and cannot
support a future `Decision: build`.

Before any C4 production-code stage begins, refresh the implementation-options
evidence from current sources under AI Working Agreement §§1/3. That future
scan must include the exact bounded requirements, UTC time, discovery
sources/queries, every owner-named and materially plausible candidate, exact
version/SHA and license/commercial/usage terms where available, PASS/PARTIAL/FAIL
per requirement area, integration/operational burden, inclusion/exclusion
rationale, and a normalized SHA-256 bound to the implementation recommendation.
If a higher-order native/existing/OSS/ready-product option is a proven fit, the
Agreement's decision order controls and custom code is forbidden where its
ready-solution rule applies.

## 3. Nineteen consolidated root-cause gates

### RC1 — one sealed DecisionBasis capability

Kernel accepts exactly one opaque token. The composition seam itself invokes C3,
runs family validators and current authority reads. Proofs/rows/DTOs are not
independent kernel arguments.

Token validity states:
- genuine + unconsumed -> eligible;
- missing / clone / reconstructed / unregistered / already consumed -> reject.

This replaces the prior combinatorial proof-object API. Cross-basis/per-object
mixing is impossible by kernel signature rather than merely detected later.

### RC2 — reduce the complete identity-row multiset

Before ANSWER/CLARIFY:
1. collision -> HUMAN / CATALOG_IDENTITY_COLLISION;
2. other INVALID_AUTHORITY -> reject;
3. any NOT_FOUND -> no ANSWER/CLARIFY; HUMAN / IDENTITY_NOT_RESOLVABLE unless a
   higher C3 latch wins;
4. only with no hard failure may RESOLVED/AMBIGUOUS rows reach RC10;
5. RC10 first reduces same-kind singular cardinality;
6. after RC10, exactly one remaining ambiguous required kind with one row may
   produce its corresponding clarify-or-exhaust;
7. >1 ambiguous required kinds -> HUMAN / MULTIPLE_IDENTITY_AMBIGUITIES.

No successful row may hide a failing row, and no ambiguous row may bypass the
same-kind singular-cardinality reducer.

### RC3 — current authority outcome is part of DecisionBasis

Authority read happens inside basis construction for the exact selected family,
canonical IDs and current generation/revision/now. Kernel receives no separable
fact DTO.

Mapping key is `(authority family, status, reason)`.
Fact-layer `NOT_FOUND / PRODUCT_NOT_FOUND` is not identity NOT_FOUND and not
PRODUCT_NOT_IN_STOCK.

### RC4 — clarification budget is a closed state machine

Valid persisted domain is exactly integer 0 or 1.
- finite identity labels are validated before this budget machine;
- unrepresentable identity/variant candidates terminate as the corresponding
  NOT_RESOLVABLE HUMAN at budget 0 or 1;
- 0 + otherwise safe/representable clarify-capable outcome -> CLARIFY;
- 1 + any otherwise safe/representable clarify-capable outcome, old or new slot
  -> HUMAN / CLARIFY_EXHAUSTED;
- invalid/missing budget -> reject.

Successful slot resolution may enable ANSWER after current rereads but never
resets the budget.

### RC5 — contentful NOT_FOUND keeps C3 provenance

NOT_FOUND spans are not made consumed merely to obtain a cleaner reason.
A genuine production case may carry `OTHER_UNCONSUMED_CONSTRAINT`; the latch is
retained while IDENTITY_NOT_RESOLVABLE outranks only generic OTHER. Specific C3
latches remain higher.

### RC6 — request-family match set is deterministic and closed

Run all reviewed validators independent of intent_hint:
- 0 matches -> reject if no prior HUMAN gate;
- 1 -> continue;
- >1 -> HUMAN / MULTIPLE_REQUEST_FAMILIES_MATCHED.

No code-order or intent_hint tie-break.

### RC7 — pre-authority clarification reducer

Before any domain authority call, reduce all clarify-capable requirements that
must be resolved to make that exact call:
- PRODUCT/CATEGORY/BRAND/STORE identity ambiguity;
- AMBIGUOUS_MONEY;
- MISSING_SHORTLIST_ANCHOR.

Exactly one finite pre-authority clarification outcome is captured in
DecisionBasis and **skips the domain-authority call**. For identity ambiguity,
DecisionBasis first proves candidate presentation/labels under RC13. Kernel then
applies the closed 0/1 clarification budget.

More than one pre-authority clarification candidate is never selected by code
order. Clarification precedence is closed:
- invalid/missing budget -> reject;
- any unrepresentable identity candidate set -> HUMAN / IDENTITY_NOT_RESOLVABLE
  before budget;
- budget 1 + any remaining non-empty clarification set -> HUMAN /
  CLARIFY_EXHAUSTED;
- budget 0 + exactly one remaining requirement -> corresponding CLARIFY;
- budget 0 + >1 identity-only requirements -> HUMAN /
  MULTIPLE_IDENTITY_AMBIGUITIES;
- budget 0 + any other >1 requirement set -> HUMAN /
  MULTIPLE_CLARIFICATION_REQUIREMENTS.

AMBIGUOUS_VARIANT is different: it is a post-authority outcome from the exact
store-stock read, but it obeys the same precedence and never chooses a variant
arbitrarily.

### RC8 — exhaustive authority-family outcome tables

Each family mapper is a closed table over the complete status/reason union its
current authority service can emit. Every tuple is either:
- mapped to one exact ANSWER/CLARIFY/HUMAN result; or
- explicitly marked intentional rejection.

No wildcard/default such as "allowlisted UNANSWERABLE" is valid. A service
contract that starts emitting a new tuple must fail the C4 contract test and
reject at runtime until the frozen mapping is reviewed.

### RC9 — total terminal precedence and dynamic-authority short-circuit

All gate evidence is reduced under DESIGN §28.4. The primary result order is:
1. invalid/certification/unknown state -> reject;
2. identity collision -> HUMAN / CATALOG_IDENTITY_COLLISION; otherwise other
   INVALID_AUTHORITY -> reject;
3. §28.2 C3 latch + identity NOT_FOUND precedence;
4. same-kind singular-slot cardinality;
5. request-family cardinality;
6. single-family pre-authority terminal mapping: attribute query -> HUMAN /
   PRODUCT_ATTRIBUTE_NOT_AUTHORITATIVE; uncertified delivery policy -> HUMAN /
   COMMERCE_POLICY_NOT_AUTHORITATIVE;
7. response-locale allowlist (`uk|ru`);
8. finite identity candidate-presentation provenance + label representability;
9. clarification-set/budget precedence;
10. current authority tuple; post-authority AMBIGUOUS_VARIANT label
    representability is checked before its clarification budget.

Any terminal HUMAN or CLARIFY before current authority prevents the family
authority call. The property suite cross-products earlier terminal gates with
lower-priority gates and a spied stale/conflicting authority fixture. Lower
phases never replace the earlier machine reason.

### RC10 — singular-slot cardinality reduction

C2 may certify more than one span of the same resolver kind. C4 therefore
reduces singular kinds PRODUCT/CATEGORY/BRAND/STORE/MONEY before family
selection or dynamic authority.

For each kind:
- multiple all-RESOLVED rows with one exact semantic value collapse;
- different RESOLVED values => HUMAN / UNSUPPORTED_CONSTRAINT;
- any multi-row set containing AMBIGUOUS => HUMAN /
  UNSUPPORTED_CONSTRAINT.

Exact equality keys are frozen in DESIGN §22. Source rows remain available for
provenance even when equivalent values collapse. The reducer never selects by
row order, unions/intersects identities, or invents money-bound roles. Any
terminal cardinality failure causes zero dynamic-authority calls.

### RC11 — response-locale containment

C4 carries presentation locale so C5 never becomes a second semantic decision
point. The locale source is the current genuine certified C2 extraction only.
Exact `uk` and `ru` are allowed public locales; any other normalized tag yields
HUMAN / UNSUPPORTED_RESPONSE_LANGUAGE before clarification or domain authority.

Catalog `matched_languages`, Knowledge source locale, browser/contact metadata,
Chatwoot profile fields and `intent_hint` cannot override the response locale.
ANSWER/CLARIFY carry the exact `response_locale`; HUMAN has no public locale.
The renderer may select only the exact locale-specific template branch and may
not fall back to another language.

### RC12 — exact typed decision projection

The kernel result is the exact eight-key `bp.first-line.decision/1` object frozen
in DESIGN §16.2. C5 receives no raw authority DTO. Every ANSWER template has one
closed render-payload schema; HUMAN has null public fields; CLARIFY exposes only
public choice token+safe label while canonical candidate values remain private
reservation metadata.

Property tests inject authority revision IDs, generation/freshness metadata,
SKU, canonical IDs, quantities, cohort/debug fields and extra payload keys. Any
such public leakage or any missing/wrong-type field rejects before action
preparation. Every CLARIFY requires exactly `render_payload=null`; `{}` or any
other non-null object rejects. Finite identity choice labels must be pairwise
unique under the frozen NFC/whitespace/trim/exact-locale-lowercase key; ordinal
tokens never disambiguate duplicate labels. Duplicate PRODUCT/CATEGORY/BRAND/
STORE labels => IDENTITY_NOT_RESOLVABLE; duplicate VARIANT labels =>
PRODUCT_VARIANT_NOT_RESOLVABLE. Variant price list with incomplete labels is
HUMAN / PRODUCT_VARIANT_NOT_RESOLVABLE. Shortlist items require exact-locale
title or HUMAN / PRODUCT_PRESENTATION_NOT_AVAILABLE.

### RC13 — exact candidate-presentation proof and label-before-budget precedence

C2 identity resolution owns canonical candidate IDs but its PRODUCT `title` and
CATEGORY `name` convenience fields are not public presentation proof because the
underlying resolvers may aggregate/fallback across languages. DecisionBasis may
perform only bounded presentation reads over the already-certified candidate
IDs after `response_locale` is known:
- PRODUCT: `getProduct({productId})`, using only
  `product.localized[response_locale].title`;
- CATEGORY: one bounded `listCategories({language:response_locale,
  categoryIds:[...],limit:n})`, using only `row.names[response_locale]` and never
  fallback `row.name`.

Every returned Catalog snapshot must have `generation_id ===
resolution.catalog_generation_id`; any drift, missing row/exact-locale label,
unsafe label or duplicate-equivalent label is terminal HUMAN /
IDENTITY_NOT_RESOLVABLE before clarification budget. These reads cannot alter
the candidate set or authorize a domain fact. BRAND/STORE use their certified
canonical factual labels under the same safety/distinguishability check.

For post-authority AMBIGUOUS_VARIANT, the variant candidate set comes from the
exact store-stock read, but label safety/distinguishability still runs before the
0/1 clarification budget. Any failure => HUMAN /
PRODUCT_VARIANT_NOT_RESOLVABLE for budget 0 or 1; only a representable set may
reach CLARIFY_EXHAUSTED at budget 1.

### RC14 — reservation-aware CLARIFY send reauthorization

Preparing CLARIFY atomically consumes the episode's persisted 0->1 prompt budget.
Send-time reauthorization therefore cannot blindly reuse the persisted value 1
for the owning unsent prompt. EpisodeStore issues a transient reservation
attestation only when the exact PREPARED/current-GATING CLARIFY still owns the
active episode reservation: action/episode/version/requested-slot/candidates all
match and clarification_action_id==action_id.

Only that action's semantic rebuild gets effective pre-reservation budget 0.
Another/new action sees persisted 1 and exhausts normally. U04/U05 prove restart
survival and no reusable override.

### RC15 — provenance-bound clarification discharge

After a proven selection, continuation rebuild locates the episode's unique
CONFIRMED CLARIFY action and its original basis_event_seqs, then replaces exactly
the one reserved unresolved slot with the durable proven stable value before
identity/cardinality/family reduction.

CATEGORY identity is the exact tuple `(category_id,category_match_mode)`, not the
ID alone. Presented-category private reservation stores `{category_id,match_mode}`;
a proven category selection atomically commits `category_id` plus
`category_match_mode` with the same derived event. On restart the re-proof is
origin-specific: a structured/presented selection reruns the resolver on the
**original ambiguity phrase** and requires the reserved selected tuple to remain
an exact member of the current candidate set (the result may still be AMBIGUOUS,
and extra candidates are allowed); a requested-slot free-text fill reruns the
resolver on that follow-up phrase and requires one current RESOLVED tuple equal
to the durable pair. The ordinal is never used as a vocabulary phrase. Missing
selected membership, INVALID/NOT_FOUND, or same-ID match_mode replacement fails
HUMAN / IDENTITY_NOT_RESOLVABLE before shortlist authority.

MONEY concrete `max_price_minor` discharges AMBIGUOUS_MONEY and contributes the
proven `(currency=UAH,max_price_minor)` upper bound while preserving its original
category/brand anchor. Unrelated original constraints/family semantics remain;
old AMBIGUOUS + new RESOLVED never coexist. Missing/mismatched/multiple discharge
provenance fails closed. C60ab/C60ad, C43a, Q02a and U05a cover restart-capable
candidate/requested-slot/MONEY/CATEGORY cases.

### RC16 — C4 finite-choice cardinality equals durable bound

The existing durable bound MAX_PRESENTED_CANDIDATES=20 is also the C4 public
choice bound. Exactly 20 safe/distinct candidates may continue; 21+ is never
truncated. PRODUCT/CATEGORY/BRAND/STORE => IDENTITY_NOT_RESOLVABLE; VARIANT =>
PRODUCT_VARIANT_NOT_RESOLVABLE. Thus no valid C4 CLARIFY can later fail only
because EpisodeStore cannot reserve it. C60aa crosses 20/21 for every finite
identity kind.

### RC17 — mutable structured selection is re-proven before send

A structured input_select selection can mutate submitted_values without a new
customer ledger event or stream revision. When a stable slot was derived through
the confirmed CLARIFY event, final send-time semantic reauthorization exact-reads
that confirmed message again and re-runs structured-submission proof against the
same action/reservation/committed value. A->B, empty, multiple or unknown =>
zero POST and HUMAN fail closed; unchanged A survives restart and may send once.
Q10c/U07 cover this race.

### RC18 — typed public OperationalFact/CommercePolicy readers

C4 cannot treat arbitrary Knowledge JSON as a public fact. Required typed
families are:
- current store open/closed state via `resolveStoreOperationalState`;
- whole selected current-day schedule via `resolveStoreTodaySchedule`;
- `resolveStorePhone` over dedicated `store.phone`;
- `resolveCallCenterPhone` over dedicated `call_center.phone`;
- CommercePolicy schemas `commerce.payment_methods`, `commerce.prepayment` and
  `commerce.return_period`.

Phone readers project the full subject before same-family validation, reject
malformed/foreign rows, allow compatible duplicates and map different canonical
effects to POLICY_CONFLICT. Commerce adapters validate the exact effect schema
before the generic policy mapper result can be projected. Delivery is a known
pre-authority HUMAN / COMMERCE_POLICY_NOT_AUTHORITATIVE until its typed public
schema is separately frozen; generic effect JSON is never rendered.

### RC19 — exact public presentation safety boundary

C4 revalidates every customer-visible identity label, shortlist title and variant
label with DESIGN §16.3. Unicode General_Category `Cc` or `Cf` is rejected before
whitespace normalization, so zero-width/default-format characters cannot create
visually indistinguishable choices. The debug-token predicate is exactly
`/(?:^|[^\\p{L}\\p{N}_])(?:id|oid|aid|nid|vid|fid)\\s*[:=#-]\\s*\\S+/iu`; the
serialized-prefix predicate is exactly `/^(?:a|o|s|i|b|d):\\d+[:;{]/iu`.
C60ac fixes boundary/separator/case behavior explicitly (`Blue oid:32976` and
`oid-32976` reject; `xoid:32976` does not match that rule; `O:8:{`, `o:8:{` and
`A:1:{` reject), covers U+200B/U+200C/U+200D/U+2060, and verifies that the
mandatory projection-specific internal-ID set cannot be caller-pruned. PRODUCT,
CATEGORY, BRAND, STORE, VARIANT and shortlist title each use the closed derivation
from §16.3; VARIANT obtains omitted option/attribute identifiers from bounded
same-generation `getVariant()` reads. Every constituent VARIANT label part is
checked against that **complete** VARIANT identifier set before composition, and
the joined whole label is checked again; a failing part makes the whole label
unrepresentable rather than being silently dropped. The URI-like predicates and
160-code-point text ceiling are also exactly frozen in §16.3.

Public URLs are independently revalidated at the C4 boundary: 1..4096 code
points, no whitespace/control/backslash/encoded control, parseable HTTPS only,
no credentials/fragment/non-default port, public DNS host only. Product URLs are
limited to babypark.ua/subdomains; image URLs may use another public HTTPS DNS
host for CDN use. Unsafe optional URLs become null; unsafe required titles fail
PRODUCT_PRESENTATION_NOT_AVAILABLE. Upstream ingest acceptance never substitutes
for this customer-facing boundary.

## 4. State-space / property model

Do not enumerate review findings cell-by-cell. Generate tuples:

`(basis-token state × family-match count × C3 latch set × identity-row multiset × singular-slot value class × response-locale tag × candidate-presentation proof/label class × public-text/URL safety class × finite-choice cardinality × clarification continuation/discharge provenance including CATEGORY match_mode × clarify budget/effective reservation budget × authority family/status/reason × public template/payload shape × structured-selection final proof × turn freshness) -> expect`

Dimensions:
- basis token: genuine, missing, clone/reconstructed, consumed/replayed;
- family matches: 0, 1, >1;
- C3: CLEAR, each specific latch, OTHER, multi-latch permutations;
- identity rows: none; one row; pair/multiset over
  RESOLVED|AMBIGUOUS|NOT_FOUND|INVALID_AUTHORITY;
- same-kind singular value classes: one row; equivalent RESOLVED duplicates;
  distinct RESOLVED values; RESOLVED+AMBIGUOUS; multiple AMBIGUOUS, parameterized
  over PRODUCT/CATEGORY/BRAND/STORE/MONEY;
- response locale: `uk`, `ru`, another valid tag;
- candidate-presentation proof/labels: exact-generation+exact-locale distinct;
  generation drift; missing exact locale; unsafe label; duplicate-equivalent
  labels, parameterized across PRODUCT/CATEGORY/BRAND/STORE and post-authority
  VARIANT;
- public-text/URL safety: safe controls plus control/bidi, URL-like/debug/internal-
  ID/overlength text; safe product/image HTTPS URLs plus bad scheme/credentials/
  host/whitespace/control/backslash/encoded-control/overlength cases;
- finite-choice cardinality: 0/1/20/21+ where applicable;
- continuation/discharge provenance: unique matching confirmed CLARIFY; missing;
  slot/value mismatch; multiple possible discharge targets; restart; CATEGORY
  presented-selection current candidate membership (including still-AMBIGUOUS +
  extra candidates) vs selected-tuple absence/mode replacement, and requested-slot
  unique RESOLVED vs AMBIGUOUS/NOT_FOUND/INVALID;
- clarify budget: ordinary 0/1/invalid plus owning-CLARIFY reservation-attested
  effective 0 vs non-owner persisted 1;
- structured selection final proof: unchanged; A->B; empty; multiple; unknown;
- pre-authority clarify set: none; each single supported reason; >1 identity
  ambiguities; >1 other/unclassified clarify requirements;
- clarify budget: 0, 1, invalid/missing;
- authority outcome: every exact emitted family/status/reason tuple plus unknown
  tuple and fact-layer PRODUCT_NOT_FOUND;
- public projection: exact template/payload, missing field, extra field, wrong
  type, raw DTO/internal-ID injection, exact-locale presentation absent;
- freshness: current same-ID, current changed fact, stale prior-turn,
  relevant-stale, unrelated-stale.

Global properties:
1. invalid basis token -> no decision;
2. any unknown enum/status/reason -> no decision;
3. collision/NOT_FOUND identity cannot produce ANSWER/CLARIFY;
4. no successful identity row hides another failing row;
5. non-empty specific C3 latch cannot produce ANSWER/CLARIFY;
6. identity NOT_FOUND outranks only generic OTHER, never a specific latch;
7. >1 family matches never selects by order;
8. >1 ambiguous identity kinds never selects a slot by order;
9. any non-empty pre-authority clarify set causes zero family **domain-authority**
    calls; bounded RC13 candidate-presentation reads are the only allowed pre-budget
    Catalog reads for finite identity choices;
10. after required candidate representability succeeds, budget 1 + any non-empty
    clarification set yields HUMAN / CLARIFY_EXHAUSTED before lower
    clarification-cardinality reasons; unrepresentable labels terminate earlier;
11. budget 0 + >1 clarification requirements never select a slot by code order:
    identity-only => MULTIPLE_IDENTITY_AMBIGUITIES; otherwise =>
    MULTIPLE_CLARIFICATION_REQUIREMENTS;
12. budget != 0 never emits CLARIFY; invalid budget rejects;
13. authority outcomes are namespace-specific; no global reason aliasing;
14. each family mapper key set exhaustively equals its frozen emitted tuple set
    plus explicit intentional rejections; no wildcard/default branch;
15. old-turn dynamic facts never authorize a current response;
16. identical genuine basis state yields deep-equal semantic decision;
17. same-kind singular rows never select by row order; equivalent all-RESOLVED
    values collapse, every other multi-row same-kind case is terminal HUMAN /
    UNSUPPORTED_CONSTRAINT;
18. total terminal precedence is stable across cross-gate combinations; a lower
    phase never changes the earlier primary reason;
19. every pre-authority HUMAN/CLARIFY terminal produces zero dynamic-authority
    calls;
20. public ANSWER/CLARIFY locale is exactly the certified C2 `uk|ru` tag;
    another valid tag yields HUMAN / UNSUPPORTED_RESPONSE_LANGUAGE with zero
    dynamic-authority calls and no locale fallback;
21. C4Decision has exactly the frozen eight-key shape and no raw authority DTO,
    canonical ID/SKU/quantity/revision/cohort/debug field can reach C5;
22. every CLARIFY has exactly `render_payload=null`; any non-null object rejects;
23. every ANSWER template payload equals its closed schema; every customer-visible
    text/URL field passes the frozen §16.3 public presentation predicate; unsafe
    optional URLs become null, while unsafe required titles/identity labels fail
    closed under their frozen HUMAN reasons; variant-enumeration labels remain
    pairwise-distinguishable and shortlist generation drift remains fail-closed;
24. today-hours payload preserves the complete later local-day schedule for
    before-opening/split-interval cases and accounts for already-published future
    CLOSED overlays, while any current §9.2 CLOSED terminal still suppresses hours;
25. phone/commerce adapters validate exact public authority schemas before
    mapping; generic Knowledge JSON cannot become public fact;
26. PRODUCT/CATEGORY public choice labels are proven by bounded same-generation
    exact-locale presentation reads; C2 fallback title/name fields cannot authorize
    public labels;
27. label representability precedes clarification budget for every finite identity
    choice set, including post-authority VARIANT; unusable labels never become
    CLARIFY_EXHAUSTED at budget 1;
28. finite identity choices are pairwise distinguishable after frozen public-label
    normalization; duplicate-equivalent labels never CLARIFY or rely on ordinal tokens;
    public text rejects all `Cc`/`Cf` and uses the complete mandatory internally-
    derived identifier set, never a caller-selected subset;
29. AMBIGUOUS_MONEY and MISSING_SHORTLIST_ANCHOR CLARIFY decisions have exactly
    `choices=[]`; any non-empty choices reject before action preparation;
30. owning unsent CLARIFY reauthorization may use only a transient exact-action
    reservation attestation for effective pre-reservation budget 0; no other action
    can obtain it;
31. proven selection continuation discharges exactly one reserved old ambiguity
    while preserving original family semantics/unrelated constraints across restart;
    CATEGORY persists/re-proves the exact `(category_id,category_match_mode)` tuple
    and mode drift never reaches shortlist authority;
32. every finite public choice set is <=20; 21+ is terminal HUMAN and never
    truncated or handed to storage;
33. structured submissions are exact-read/re-proven again at final send; mutable
    submitted_values cannot hide behind unchanged stream revision;
34. token/proofs/basis are transient and contain no durable customer content.

## 5. Closed public reason allowlists

ANSWER:
OPERATIONAL_FACT, COMMERCE_POLICY, PRODUCT_PRICE_SINGLE, PRODUCT_PRICE_RANGE,
PRODUCT_NOT_IN_STOCK, VARIANT_LIST, VARIANT_LIST_PARTIAL, VARIANT_PRICE_LIST,
OBJECTIVE_SHORTLIST, OBJECTIVE_SHORTLIST_EMPTY, STORE_STOCK.

CLARIFY:
AMBIGUOUS_PRODUCT, AMBIGUOUS_VARIANT, AMBIGUOUS_CATEGORY, AMBIGUOUS_BRAND,
AMBIGUOUS_STORE, AMBIGUOUS_MONEY, MISSING_SHORTLIST_ANCHOR.

HUMAN:
POLICY_CONFLICT, POLICY_NOT_FOUND, CATALOG_COMMERCIAL_STALE,
CATALOG_STOCK_STALE, PRICE_COHORT_INCOMPLETE, ZERO_PRICE_UNVERIFIED,
MIXED_CURRENCY, UNSUPPORTED_CONSTRAINT, UNSUPPORTED_EXCLUSION,
SUBJECTIVE_RECOMMENDATION, PRODUCT_ATTRIBUTE_NOT_AUTHORITATIVE,
COMPATIBILITY_NOT_AUTHORITATIVE, RETURN_CASE_SPECIFIC, ORDER_SPECIFIC,
CATALOG_IDENTITY_COLLISION, IDENTITY_NOT_RESOLVABLE,
MULTIPLE_REQUEST_FAMILIES_MATCHED, MULTIPLE_IDENTITY_AMBIGUITIES,
MULTIPLE_CLARIFICATION_REQUIREMENTS, CLARIFY_EXHAUSTED,
PRODUCT_VARIANT_NOT_RESOLVABLE, PRODUCT_PRESENTATION_NOT_AVAILABLE,
COMMERCE_POLICY_NOT_AUTHORITATIVE, UNSUPPORTED_RESPONSE_LANGUAGE.

No default branch manufactures one of these reasons.

## 6. Domain outcome mappings

Mappings are exact per authority family. The list below is the complete current
service-emitted union for C4. Any tuple not listed is unknown and rejects.

Store current-state resolver (DTO has no `reason`, exact mapper key uses
`reason=null`):
- RESOLVED / null -> ANSWER / OPERATIONAL_FACT / TPL_STORE_OPEN_STATUS_V1 with
  only `{open,closes_at_local}`;
- POLICY_NOT_FOUND / null -> HUMAN / POLICY_NOT_FOUND;
- POLICY_CONFLICT / null -> HUMAN / POLICY_CONFLICT.

For a today-hours request, an active current CLOSED operating-state terminal is
handled first by the current-state reader and preserves DESIGN §9.2: ANSWER /
OPERATIONAL_FACT / TPL_STORE_OPEN_STATUS_V1 with hours suppressed. Only when
current state is not such a CLOSED terminal does the today-schedule reader select
special-hours-or-weekly base intervals for the whole current Europe/Kyiv civil
day and account for already-published **future** same-day operating-state
intervals: CLOSED removes only future overlap, OPEN never invents hours, peer
conflict on a future segment => POLICY_CONFLICT. Mapping:
- RESOLVED / null -> ANSWER / OPERATIONAL_FACT / TPL_STORE_HOURS_TODAY_V1 with
  only `{open_now,intervals}`;
- POLICY_NOT_FOUND / null -> HUMAN / POLICY_NOT_FOUND;
- POLICY_CONFLICT / null -> HUMAN / POLICY_CONFLICT;
- malformed/unrepresentable schedule -> intentional reject.
Before-opening and between-interval reads preserve the complete later interval
list; a future published closure is not ignored, while a current CLOSED terminal
is never bypassed.

Store-phone and call-center-phone readers are separate exact OperationalFact
adapters over full-subject `projectActiveKnowledge()`:
- valid RESOLVED / null -> ANSWER / OPERATIONAL_FACT with respectively
  TPL_STORE_PHONE_V1 or TPL_CALL_CENTER_PHONE_V1 and only `{e164}`;
- POLICY_NOT_FOUND / null -> HUMAN / POLICY_NOT_FOUND;
- POLICY_CONFLICT / null -> HUMAN / POLICY_CONFLICT;
- malformed/foreign same-family row -> intentional reject before mapper.

`store.phone` uses subject `store/<canonical store_id>` and dedicated
`effect_family=store.phone`. `call_center.phone` uses
`business/babypark` + `effect_family=call_center.phone`. Neither reader may
fallback to `store.identity`, address, Magento, Chatwoot or another namespace.

Commerce resolver (DTO has no `reason`; public adapters first validate exact
schema, then the mapper uses `reason=null`):
- `commerce.payment_methods / PAYMENT_METHODS` RESOLVED -> ANSWER /
  COMMERCE_POLICY / TPL_PAYMENT_METHODS_V1 with only `{methods}`;
- `commerce.prepayment / PREPAYMENT` RESOLVED -> ANSWER / COMMERCE_POLICY /
  TPL_PREPAYMENT_V1 with only `{amount_minor,currency}`;
- `commerce.return_period / RETURN_PERIOD` RESOLVED -> ANSWER /
  COMMERCE_POLICY / TPL_RETURN_PERIOD_V1 with only
  `{applies_to,calendar_days,purchase_day_excluded}`;
- any of those families POLICY_NOT_FOUND / null -> HUMAN / POLICY_NOT_FOUND;
- any of those families POLICY_CONFLICT / null -> HUMAN / POLICY_CONFLICT;
- malformed effect schema -> intentional reject before public mapper;
- delivery request family -> pre-authority HUMAN /
  COMMERCE_POLICY_NOT_AUTHORITATIVE; generic delivery effect JSON is not read for
  public rendering.

Product attribute query — pre-authority terminal:
- reviewed v1 attribute-query family (including C30/C31) -> HUMAN /
  PRODUCT_ATTRIBUTE_NOT_AUTHORITATIVE
- no product-attribute value reader is invoked
- populated canonical `product_attributes` / `attribute_defs` data does not
  change this mapping until the frozen C31a re-certification trigger is
  explicitly resolved

Product price / `getProductPriceFact`:
- FACT / PRODUCT_PRICE_SINGLE -> ANSWER / PRODUCT_PRICE_SINGLE
- FACT / PRODUCT_PRICE_RANGE -> ANSWER / PRODUCT_PRICE_RANGE
- FACT / PRODUCT_NOT_IN_STOCK -> ANSWER / PRODUCT_NOT_IN_STOCK
- UNANSWERABLE / CATALOG_COMMERCIAL_STALE -> HUMAN / CATALOG_COMMERCIAL_STALE
- UNANSWERABLE / PRICE_COHORT_INCOMPLETE -> HUMAN / PRICE_COHORT_INCOMPLETE
- UNANSWERABLE / MIXED_CURRENCY -> HUMAN / MIXED_CURRENCY
- UNANSWERABLE / ZERO_PRICE_UNVERIFIED -> HUMAN / ZERO_PRICE_UNVERIFIED
- NOT_FOUND / PRODUCT_NOT_FOUND -> intentional reject; fact-layer NOT_FOUND is
  not identity NOT_FOUND and is not PRODUCT_NOT_IN_STOCK

Available variants / `getAvailableVariantsFact`:
- FACT / PRODUCT_NOT_IN_STOCK -> ANSWER / PRODUCT_NOT_IN_STOCK
- FACT / VARIANT_LIST with pairwise-distinguishable public labels -> ANSWER / VARIANT_LIST
- FACT / VARIANT_LIST_PARTIAL with pairwise-distinguishable emitted labels -> ANSWER / VARIANT_LIST_PARTIAL
- either list outcome with duplicate-equivalent emitted labels -> HUMAN / PRODUCT_VARIANT_NOT_RESOLVABLE
- UNANSWERABLE / CATALOG_COMMERCIAL_STALE -> HUMAN / CATALOG_COMMERCIAL_STALE
- NOT_FOUND / PRODUCT_NOT_FOUND -> intentional reject

Variant price list / `getVariantPriceListFact`:
- FACT / PRODUCT_NOT_IN_STOCK -> ANSWER / PRODUCT_NOT_IN_STOCK
- FACT / VARIANT_PRICE_LIST with `label_complete=true` and pairwise-distinguishable labels -> ANSWER /
  VARIANT_PRICE_LIST / TPL_VARIANT_PRICE_LIST_V1, projecting only label+price;
- FACT / VARIANT_PRICE_LIST with duplicate-equivalent labels -> HUMAN /
  PRODUCT_VARIANT_NOT_RESOLVABLE, regardless of differing prices;
- FACT / VARIANT_PRICE_LIST with `label_complete=false` -> HUMAN /
  PRODUCT_VARIANT_NOT_RESOLVABLE; internal IDs/SKU never become public fallback
- UNANSWERABLE / CATALOG_COMMERCIAL_STALE -> HUMAN / CATALOG_COMMERCIAL_STALE
- UNANSWERABLE / PRICE_COHORT_INCOMPLETE -> HUMAN / PRICE_COHORT_INCOMPLETE
- UNANSWERABLE / MIXED_CURRENCY -> HUMAN / MIXED_CURRENCY
- UNANSWERABLE / ZERO_PRICE_UNVERIFIED -> HUMAN / ZERO_PRICE_UNVERIFIED
- NOT_FOUND / PRODUCT_NOT_FOUND -> intentional reject

Objective shortlist / `searchObjectiveProducts`:
- FACT / OBJECTIVE_SHORTLIST -> project each displayed product through exact
  `getProduct()`, requiring `getProduct().catalog.generation_id` to equal the
  shortlist fact's `catalog.generation_id`, then use only
  `product.localized[response_locale]`; generation drift, missing product or
  missing required title => HUMAN / PRODUCT_PRESENTATION_NOT_AVAILABLE; otherwise
  ANSWER / OBJECTIVE_SHORTLIST with TPL_SHORTLIST_TOP3_V1 or
  TPL_SHORTLIST_ALL_V1 and no canonical IDs/SKU in payload;
- FACT / OBJECTIVE_SHORTLIST_EMPTY -> ANSWER / OBJECTIVE_SHORTLIST_EMPTY /
  TPL_SHORTLIST_EMPTY_V1
- UNANSWERABLE / CATALOG_COMMERCIAL_STALE -> HUMAN / CATALOG_COMMERCIAL_STALE
- UNANSWERABLE / CATALOG_STOCK_STALE -> HUMAN / CATALOG_STOCK_STALE
- UNANSWERABLE / PRICE_COHORT_INCOMPLETE -> HUMAN / PRICE_COHORT_INCOMPLETE
- UNANSWERABLE / MIXED_CURRENCY -> HUMAN / MIXED_CURRENCY
- UNANSWERABLE / ZERO_PRICE_UNVERIFIED -> HUMAN / ZERO_PRICE_UNVERIFIED
- UNANSWERABLE / UNSUPPORTED_CONSTRAINT -> HUMAN / UNSUPPORTED_CONSTRAINT
- UNANSWERABLE / MISSING_SHORTLIST_ANCHOR -> intentional reject inside the
  authority mapper; a certified flow must have produced pre-authority CLARIFY /
  MISSING_SHORTLIST_ANCHOR without calling this authority

Store stock / `getStoreStockFact`:
- FACT / STORE_STOCK -> ANSWER / STORE_STOCK
- CLARIFY / AMBIGUOUS_VARIANT -> clarify-or-exhaust
- UNANSWERABLE / CATALOG_COMMERCIAL_STALE -> HUMAN / CATALOG_COMMERCIAL_STALE
- UNANSWERABLE / CATALOG_STOCK_STALE -> HUMAN / CATALOG_STOCK_STALE
- UNANSWERABLE / PRODUCT_VARIANT_NOT_RESOLVABLE -> HUMAN /
  PRODUCT_VARIANT_NOT_RESOLVABLE
- NOT_FOUND / PRODUCT_NOT_FOUND -> intentional reject

The C4 implementation must keep a test-side frozen outcome set per family and
assert exact key-set equality with its mapper. Adding or removing a service
outcome without updating this reviewed mapping fails the focused contract test.

## 7. Dynamic reread properties

Before the basis used for a response is created:
- operational: reread published authority + current now;
- commerce: reread current policy;
- price/variants: reread current commercial fact;
- objective: rerun current search and relevant stock layer;
- exact-store stock: reread current commercial + stock fact.

Post-clarification properties extend Q05-Q07:
- price changes -> new basis reflects new price decision/data;
- policy changes -> new basis reflects current policy outcome;
- shortlist membership changes -> new basis reflects current membership;
- stock/freshness/closure mutations retain existing Q05-Q07 coverage.

No authority DTO from the previous turn is a kernel input.

## 8. Clarification properties

Clarification precedence is deterministic:
- invalid/missing budget -> reject;
- finite identity presentation/label representability is validated before budget;
  failure => IDENTITY_NOT_RESOLVABLE or PRODUCT_VARIANT_NOT_RESOLVABLE at
  budget 0 or 1;
- budget 1 + any remaining non-empty clarification requirement set -> HUMAN /
  CLARIFY_EXHAUSTED, regardless of set cardinality;
- budget 0 + exactly one remaining finite requirement -> corresponding CLARIFY;
- budget 0 + >1 identity-only requirements -> HUMAN /
  MULTIPLE_IDENTITY_AMBIGUITIES;
- budget 0 + any other >1 requirements -> HUMAN /
  MULTIPLE_CLARIFICATION_REQUIREMENTS.

For AMBIGUOUS_PRODUCT/CATEGORY/BRAND/STORE/MONEY and
MISSING_SHORTLIST_ANCHOR, the complete clarification set is produced before any
family authority call. MISSING_SHORTLIST_ANCHOR emits the already-supported
concrete `category_id` requested slot, never the C2c-unsupported
`shortlist_anchor` union. An authority spy must observe zero calls.

AMBIGUOUS_VARIANT is produced only by the current exact store-stock authority
read; its candidate labels are validated before budget, then the same 0/1 budget
precedence applies without choosing a variant by order.

## 9. No-partial-answer properties

- any specific C3 latch blocks supported ANSWER/CLARIFY;
- C47 price+compatibility -> HUMAN only;
- any identity NOT_FOUND blocks successful sibling rows;
- store-filter incompleteness/staleness rejects whole shortlist;
- price cohort holes reject whole price/shortlist;
- multiple request-family matches do not answer one family partially.

## 10. Docs-only contract traceability terminal

This table traces the **normative artifacts changed by PR #100**, not future
production implementation. Every in-scope row is terminal for this docs-only
campaign.

| Requirement / contract change | Normative artifact | Verification / regression surface | Fail closed | Durable impact | Status |
|---|---|---|---|---|---|
| C4 sealed DecisionBasis, complete identity/singular/family reducers and total precedence | DESIGN §§22, 28.2-28.4; ACCEPTANCE C60d-C60s | C60 state-space vectors + RC1-RC10 model | unknown/collision/cardinality/family ambiguity cannot become ANSWER | NONE in this campaign | DONE |
| Exact response locale + eight-key customer-safe decision projection | DESIGN §§16.1-16.3; ACCEPTANCE C35a, C60t-C60ac, T01-T06 | exact-locale, payload-shape, leakage, unsafe-text/URL and duplicate-label vectors | reject/HUMAN before public action | NONE | DONE |
| Typed operational/phone/CommercePolicy public schemas and today-schedule semantics | DESIGN §§3.2.1-3.2.2, §9.2; ACCEPTANCE C01-C16a, O09-O11 | malformed/foreign family, duplicate/conflict, split-hours/future-closure vectors | malformed rejects; missing/conflict HUMAN | NONE | DONE |
| CATEGORY semantic identity is `(category_id,category_match_mode)` and continuation re-proves mode | DESIGN §§22, 28.4, 29.4; ACCEPTANCE C43a, C60r, C60ab, C60ad, Q15, Q32, U05a | candidate/requested-slot/restart/mode-drift matrix + historical C1 non-regression | mismatch/drift => HUMAN; no guessed descendant scope | New v0.7 prerequisite: current base C2/state-store persists only `category_id`; no production code in this PR | DONE |
| Clarification budget/reservation and mutable structured submission final proof | DESIGN §§29.7-29.9; ACCEPTANCE Q10c, Q14, U04-U07 | owner-vs-non-owner budget, restart, A->B/empty/multiple/unknown | zero POST / HUMAN on mismatch | no new durable customer content | DONE |
| Dynamic authority reread and accepted final cross-system race remain bounded | DESIGN §29.7; ACCEPTANCE U01-U03/U06 | descriptor-changing vs descriptor-stable dynamic mutations | stale descriptor/failure => zero POST; no invented Chatwoot CAS | NONE | DONE |
| C5 exact-locale pure renderer handoff | DESIGN §40.1; ACCEPTANCE T01-T06 | no fallback/network/LLM, exact critical-value formatting | renderer failure => zero public send | NONE | DONE |
| C6 send-time semantic reauthorization handoff | DESIGN §§29.7-29.9; ACCEPTANCE U01-U07 | fresh C2->C4 rebuild, reservation attestation, structured re-proof | mismatch/failure => zero POST and HUMAN | dynamic render payload remains non-durable | DONE |
| Unsupported/mixed request containment + no partial answer | DESIGN §§28, 42-43; ACCEPTANCE C30-C32, C44-C47, Q03-Q04/Q12-Q14 | latch/family/attribute/delivery boundary vectors | HUMAN/no-action as frozen; no partial public fact | NONE | DONE |
| Docs-only campaign/state/evidence boundary | DESIGN/ACCEPTANCE metadata + this file + CURRENT_STATE C4 section | exact changed-surface review and Agreement governance checks | no production implementation authorization from evidence docs | NONE | DONE |

PRODUCTION IMPLEMENTATION: **NONE**.

The future production-code campaign is not represented as `IN PROGRESS` or
`DEFERRED` here. It is a separate bounded stage that must start from then-current
canonical `main`, refresh the Agreement §§1/3 alternatives evidence, create its
own implementation traceability/verification manifest, and satisfy all applicable
frozen requirements before merge.

## 11. Future production implementation gate

This docs-only evidence does not authorize production C4 code.

After this contract amendment is merged, production work must bootstrap from
then-current canonical `main` and the current `docs/AI_WORKING_AGREEMENT.md`.
The first production-code stage that needs CATEGORY continuation must explicitly
include or precede C4 with the C2/state-store CATEGORY-pair retrofit; current base
code does not implement it. That stage must run and freeze the fresh Agreement
§§1/3 implementation-options scan before production code. This docs-only PR does
not decide whether the retrofit is a separate prerequisite campaign or part of a
single future bounded implementation campaign; that boundary must be selected
under the then-current Agreement. Any external product/service choice also
requires the Agreement's bound architecture-fit/owner approval.

Its final merge gate is the Agreement gate, not a single review result:
complete required-verification manifest on one exact final HEAD/tree/base,
exhaustive blocker inventory + batch fixes until the self-verification reports
zero BLOCKERs, the required isolated HEAVY zero-BLOCKER confirmation on the
unchanged basis, content-addressed final evidence, and post-closure owner
approval. Any moved basis or evidence mutation restarts closure.
