# BabyPark AI First Line — Frozen Design v0.7

Status: FROZEN — Event Ledger v0.7 architecture + C5 renderer contract
Applies to: BabyPark AI First Line Website v1 / Slice C normative design.
Supersedes: `docs/AI_FIRST_LINE_DESIGN.md` at canonical main `565f8eb30bf39afa80bb4d59258cc2fd13aa67d5`.
Implementation: C1/C2a/C2b/C2c/C3/C4 are merged; this amendment is a docs-only
C5 pre-code contract freeze and contains no production C5 implementation.
Contract amendment base: canonical main `565f8eb30bf39afa80bb4d59258cc2fd13aa67d5`.
Chatwoot runtime verified: package v4.18.0; C5-relevant deployed source files byte-match upstream v4.18.0 commit `9f920b549c14491a4e587687a3eed5d21c6ccc7d`.

This document is the single normative repository source of truth for the first
customer-facing BabyPark AI design. It incorporates the complete v0.6 design
delta; no separate delta document is required to interpret it.

It consolidates the research and review rounds that followed AgentBot safety
foundation #49 and race fix #51/#52. Do not reconstruct this design from chat
history.

## 1. Product objective

The first customer-facing AI answers a narrow set of factual ecommerce questions from typed, reviewed authority.
It must not behave as a universal sales consultant.

Priorities:
1. factual correctness;
2. deterministic financial/operational values;
3. explicit authority/freshness;
4. human handoff on uncertainty;
5. traceability;
6. low operational burden;
7. Drupal → Magento portability;
8. no BabyPark patches inside Chatwoot core.

## 2. Authority domains

There is no global priority ladder across all knowledge.

### 2.1 OperationalFact
Typed operational truth:
- store temporary closure/status overlay;
- special opening hours;
- reviewed baseline hours/status;
- call-center hours;
- approved phones/addresses;
- temporary operational outages.

### 2.2 CommercePolicy
Typed reviewed business commitments:
- payment;
- prepayment;
- delivery;
- return policy;
- warranty;
- reviewed scoped exceptions.

### 2.3 CatalogFact
Never copied into knowledge authority.
Always read through CatalogService from one accepted canonical generation:
- products/variants;
- trusted offers;
- commercial availability;
- physical store stock;
- images/URLs;
- categories/brands;
- variant option labels;
- catalog freshness metadata.

### 2.4 KnowledgeContent
Future lower-authority RAG layer for articles/manuals/site/manufacturer prose.
Out of scope.

### 2.5 Guidance
Behavior/policy: clarify, handoff, templates, tool policy.
Guidance cannot create or override facts.

## 3. Storage

Create `knowledge.sqlite` as durable business authority.
It is separate from `copilot.sqlite`.

`copilot.sqlite` remains execution/idempotency state.
Knowledge publication history is not disposable/rebuildable execution state.

### 3.1 Canonical physical-store identity

Before store-scoped OperationalFacts become production authority, BabyPark must
have provider-neutral stable store identities.

Extend the existing IdentityStore with canonical physical stores and provider
xrefs:

```
stores {
  store_id
  lifecycle
  created_at
  updated_at
}

source_stores {
  provider
  native_store_id
  store_id
  reviewed_source
  first_seen_at
  last_seen_at
}
```

Frozen invariants:
- `store_id` is BabyPark canonical identity.
- Provider-native IDs are xrefs, never customer-facing authority IDs.
- Current Drupal store/location identifiers map to canonical `store_id`.
- Future Magento MSI `source_code` maps to the same canonical `store_id`.
- Future 1C/SaaS warehouse/store identifiers may map to the same canonical `store_id`.
- Mapping is reviewed/deterministic; no fuzzy automatic matching by name/address.
- One provider-native source maps to exactly one canonical store.
- v1 requires one active physical Magento source per canonical physical store;
  ambiguous active many-to-one/one-to-many topology fails cutover preflight.
- Durable xref history may retain reviewed historical provider IDs; preflight
  determines which provider locations are active.
- Retired stores are tombstoned; stable IDs are never reused.

### 3.2 Field-level source-of-truth matrix

Similar-looking data in different systems must not compete.

| Fact family | AI authority | Rule |
|---|---|---|
| Canonical physical-store identity | BabyPark IdentityStore | Stable across Drupal/Magento/provider cutover |
| Physical-store weekly hours | BabyPark Knowledge | Reviewed baseline |
| Physical-store special hours / closure / temporary status | BabyPark Knowledge | Typed temporal overlays |
| Physical-store customer address / phone | BabyPark Knowledge | Reviewed store facts; commerce systems may receive projections |
| Call-center phone | BabyPark Knowledge | Business-wide `business/babypark` OperationalFact; exact `call_center.phone` schema below |
| Product price / commercial availability | CatalogService | Accepted provider-neutral catalog |
| Physical per-store stock | CatalogService | Always keyed by canonical `store_id` |
| Website-chat support hours | Chatwoot inbox working-hours config | Applies to chat/support channel only |
| Magento MSI `source_code` | Provider xref | Never canonical BabyPark identity |
| Magento source address/phone | Projection/cross-check by default | Not AI authority unless a future explicit authority migration changes the contract |
| Magento pickup `frontend_description` | Presentation only | Never parsed into schedule/policy authority |
| Magento general Store Hours of Operation text | Presentation/config text only | Never physical-store schedule authority |

Examples:
- “Когда открыт магазин X?” → BabyPark Knowledge by canonical `store_id`.
- “Когда отвечает чат?” → Chatwoot inbox working hours.
- “Есть товар в магазине X?” → CatalogService stock by the same canonical `store_id`.

No resolver may answer a physical-store-hours question from Chatwoot or Magento
text fields.

### 3.2.1 Call-center business subject and phone authority

Website First Line v1 freezes the call-center namespace family to one
business-wide Knowledge subject: `subject_type=business`,
`subject_id=babypark`. This is a **new explicit convention introduced here**;
it must not be described as a previously frozen generic convention.
`call_center.hours` shares that subject binding, but this freeze does not define
its effect schema and C4 does not answer call-center-hours questions in v1.

`call_center.phone` is an approval-required OperationalFact with exact schema:
- `record_type=OPERATIONAL_FACT`;
- `schema_version=1`;
- `namespace=call_center.phone`;
- `effect_family=call_center.phone`;
- `scope={}`;
- `effect_type=PHONE`;
- `effect_value={"e164":"+..."}` with exactly one key and value matching
  `^\\+[1-9]\\d{1,14}$`;
- no other namespace may use `effect_family=call_center.phone` in v1.

The C4 call-center-phone adapter invokes `projectActiveKnowledge()` for the full
`business/babypark` subject without a namespace prefilter, then inspects only the
`call_center.phone` effect family. This preserves same-family cross-namespace
visibility. Before mapping any fact it validates every active same-family row's
record type, schema version, namespace, empty scope, effect type and exact E.164
value shape. A malformed or foreign same-family row is invalid authority and
rejects before ANSWER/CLARIFY; it is not POLICY_NOT_FOUND.

For valid active rows:
- zero => HUMAN / POLICY_NOT_FOUND;
- one canonical effect, or several rows with the exact same canonical effect =>
  ANSWER / OPERATIONAL_FACT;
- two different canonical effects => HUMAN / POLICY_CONFLICT.

A changed number uses ordinary atomic supersession. v1 has one call center; a
second live number is not a new identity and is never resolved with CLARIFY.
Chatwoot inbox working hours remain a separate chat-support authority and are
never used as call-center phone/hours authority.

### 3.2.2 Store phone and public CommercePolicy schemas

Website First Line v1 uses a dedicated store-phone family rather than the older
non-normative test-fixture grouping with `store.identity`:
- `subject_type=store`, `subject_id=<canonical store_id>`;
- `record_type=OPERATIONAL_FACT`, `schema_version=1`;
- `namespace=effect_family=store.phone`, `scope={}`;
- `effect_type=PHONE`;
- exact one-key `effect_value={"e164":"+..."}` matching
  `^\\+[1-9]\\d{1,14}$`.

`resolveStorePhone(store,{nowUtc,storeId})` and
`resolveCallCenterPhone(store,{nowUtc})` are the two required typed v1 phone
readers. They share one private strict PHONE reducer: project the complete active
subject without namespace prefilter; reject malformed or foreign same-family
rows; accept compatible duplicate canonical effects; map zero to
POLICY_NOT_FOUND and different canonical effects to POLICY_CONFLICT. The
customer-facing DTO union is only:
- `{status:'RESOLVED', effect_family, e164, revision_ids}`;
- `{status:'POLICY_NOT_FOUND', effect_family, revisions:[]}`;
- `{status:'POLICY_CONFLICT', effect_family, revisions:[...]}`.

`store.address` remains Knowledge authority but is **not** a Website First Line
v1 public request family; C4 must not ad-hoc read it merely because address data
exists.

Store operational questions use **two** typed readers over the same frozen
OperationalFact precedence:
- `resolveStoreOperationalState(store,{nowUtc,storeId})` answers current
  open/closed state;
- `resolveStoreTodaySchedule(store,{nowUtc,storeId})` answers the current
  Europe/Kyiv local-day schedule **only when current operating state is not a
  §9.2 CLOSED terminal**.

For a today-hours request C4 first evaluates current operating state. If an
active `store.temporary_closure` / `store.status_override` or applicable
baseline-status authority resolves the store CLOSED at current `now`, the older
§9.2 rule remains authoritative: return the current CLOSED answer and suppress
hours. The schedule reader never weakens that frozen safety boundary merely
because a finite closure could end later in the day.

Otherwise `resolveStoreTodaySchedule` evaluates the **entire current
Europe/Kyiv local civil day**, not only whether the store is open at the instant
`now`. It first selects base hours for that local date: `store.special_hours`
owns the whole civil day when present, otherwise the current weekday from
`store.weekly_hours`. It also accounts for already-published future same-day
operating-state revisions whose effective intervals overlap those base hours:
CLOSED removes only its future overlapping portion; OPEN never invents hours;
conflicting peer states on any future segment => POLICY_CONFLICT.

The exact customer-safe resolved DTO is
`{status:'RESOLVED',open_now:boolean,intervals:[{open,close},...],source,
revision_ids}`. `intervals` is the complete non-overlapping local `HH:MM`
schedule in ascending order after applicable known future CLOSED segments are
removed. It is not reduced to `open_now`. Therefore before-opening and
between-split-interval reads preserve the later intervals and final close.

If base hours are missing, return POLICY_NOT_FOUND. Conflicting authority =>
POLICY_CONFLICT; malformed/unrepresentable hours or DST-local boundaries reject
rather than guess. This reader exists to preserve schedule information that the
current-state reader deliberately does not carry; it is not a second way around
a current CLOSED terminal.

Public CommercePolicy ANSWER families in this freeze are exactly the following
closed schemas. These constraints are normative **here**; operational/evidence
documents may mirror them but cannot widen them.

All three use `record_type=COMMERCE_POLICY`, `schema_version=1`,
`subject_type=business`, `subject_id=babypark`, and are approval-required.

- `commerce.payment_methods`: `namespace=effect_family=commerce.payment_methods`,
  `scope={}`, `effect_type=PAYMENT_METHODS`, and exact
  `effect_value={methods:[...]}`. `methods` is non-empty, duplicate-free,
  lexicographically sorted, and every code is exactly one of
  `BANK_TRANSFER | CASH_COURIER | COD_NOVA_POSHTA`.
- `commerce.prepayment`: `namespace=effect_family=commerce.prepayment`,
  `effect_type=PREPAYMENT`; reviewed scope follows the already-frozen
  CommercePolicy exact-binding/exception rules; exact `effect_value` contains
  only `amount_minor` (non-negative safe integer) and `currency` (uppercase
  three-letter code).
- `commerce.return_period`: `namespace=effect_family=commerce.return_period`,
  `scope={}`, `effect_type=RETURN_PERIOD`, and exact `effect_value` contains
  only `applies_to='GOOD_QUALITY'`, positive safe-integer `calendar_days`,
  and boolean `purchase_day_excluded`.

C4 validates the complete applicable row/schema before a resolved policy can
become public payload. For payment methods, codes authorize method **names only**.
No fee, percentage, amount or condition is implied by `COD_NOVA_POSHTA`;
numeric COD terms require a future separately reviewed typed authority contract.

A delivery request such as Q13 remains actionable (never NON_ACTIONABLE_ACK),
but public delivery-policy schema is not certified in this freeze. Until one is
explicitly frozen it terminates before authority as HUMAN /
COMMERCE_POLICY_NOT_AUTHORITATIVE. Warranty is likewise not a reviewed public
ANSWER family in v1. Merely having generic CommercePolicy JSON does not widen the
public contract.

### 3.3 Magento cutover contract

Magento does not redefine BabyPark stores.

Before an accepted Magento-derived catalog/stock generation can replace the
current provider:

1. enumerate every Magento MSI Source used as a physical BabyPark inventory/pickup location;
2. explicitly bind every applicable `source_code` to an existing canonical `store_id`;
3. reject unmapped, duplicate or conflicting active bindings;
4. emit canonical Catalog `stores.store_id` / `store_stock.store_id` using those stable IDs;
5. keep all existing store-scoped Knowledge revisions valid unchanged;
6. keep AI tools provider-neutral: no prompt/template/resolver branches on Drupal vs Magento.

Magento provider cutover changes the adapter/xref layer, not the AI fact model.

### 3.4 Magento evidence behind the boundary

Adobe Commerce / Magento Inventory models physical inventory locations as MSI
Sources. Source data includes provider `source_code`, name, address/geolocation,
contact information, enabled state and pickup metadata. Source Items carry
SKU/source quantity and status.

The native Source/Pickup structures do not provide a typed structured weekly
opening-hours model. Pickup `frontend_description` and general Store Hours of
Operation are presentation/free-form text. They are deliberately not machine
schedule authority.

## 4. Immutable revision model

### knowledge_revisions

Revision body is immutable after insert.

Conceptual fields:

```
revision_id
record_type
schema_version
namespace
effect_family
subject_type
subject_id
scope_json
effect_type
effect_value_json
effective_from_utc
expires_at_utc
parent_revision_id
exception_of_revision_id
author_actor_id
created_at_utc
revision_hash
```

Initial record types:
- OPERATIONAL_FACT
- COMMERCE_POLICY
- VOCABULARY_ENTRY

Editing a draft creates a new revision.
No UPDATE rewrites a revision body.

### knowledge_events

Append-only publication ledger:

```
event_id
event_seq
revision_id
event_type
actor_id
occurred_at_utc
reason
metadata_json
previous_event_hash
event_hash
```

Event types:
- DRAFT_CREATED
- APPROVED
- PUBLISHED
- REVOKED
- SUPERSEDED
- optionally WITHDRAWN

Revision authority state is derived from the ledger.

## 5. Canonical hashing

Do not leave revision/event hash encoding implementation-defined.

Use BabyPark canonical JSON v1:
- UTF-8;
- recursive lexicographic object-key ordering;
- array order preserved;
- no insignificant whitespace;
- integer values as canonical decimal integers;
- timestamps normalized to RFC3339 UTC with `Z`;
- no floating money;
- explicit null where schema requires null;
- hash algorithm SHA-256.

`revision_hash` = SHA-256 of canonical authoritative revision body excluding `revision_hash`.

`event_hash` = SHA-256 of canonical event body excluding `event_hash`, including `previous_event_hash`.

Restore verification validates:
- chain linkage;
- hashes;
- event state-machine validity;
- resolver semantics on known verification vectors.

## 6. Event state machine

Append-only alone is not sufficient. Event writes are atomically validated.

Approval-required revision:

```
DRAFT_CREATED
  -> APPROVED
  -> PUBLISHED
  -> REVOKED | SUPERSEDED
```

Direct-publish temporary revision:

```
DRAFT_CREATED
  -> PUBLISHED
  -> REVOKED | SUPERSEDED
```

Optional:
```
DRAFT_CREATED -> WITHDRAWN
APPROVED -> WITHDRAWN
```

Rules:
- DRAFT_CREATED is first and unique.
- APPROVED requires existing draft.
- Commerce author cannot approve own revision.
- KNOWLEDGE_ADMIN does not bypass self-approval.
- Approval-required namespace cannot publish without valid APPROVED.
- PUBLISHED is unique.
- REVOKED only from PUBLISHED.
- SUPERSEDED only from PUBLISHED.
- terminal revisions cannot be resurrected.
- parent_revision_id is lineage only and changes no authority.
- resolver independently validates event history; corrupt/manual ledgers fail closed.

Publishing a replacement and superseding its predecessor occurs in one SQLite transaction.

SUPERSEDED must reference an already-published successor.

SUPERSEDED is allowed only when predecessor and successor share:
- namespace;
- subject identity;
- effect_family.

Temporary overlays never supersede baseline namespaces.

## 7. Time semantics

All revisions require `effective_from_utc`.

Persist authority boundaries as absolute UTC instants.

General active-revision predicate:

```
effective_from_utc <= now
AND
(expires_at_utc IS NULL OR now < expires_at_utc)
```

`expires_at_utc = NULL` means an open-ended interval and is allowed only where
the publication policy permits an open-ended authority, such as reviewed
baselines or long-lived CommercePolicy.

Direct-publish temporary overlays always require finite `expires_at_utc`.

All expiry boundaries are exclusive:

```
now == expires_at_utc
```

means inactive.

No cron job is authority for expiry.

### Business-calendar timezone

`Europe/Kyiv` is the canonical business-calendar timezone for store schedules.

It is used for:
- interpreting weekly weekday/hour schedules;
- converting selected local civil dates into UTC revision bounds;
- evaluating "today", weekday and local clock time for store-hours answers;
- parsing human input such as "до кінця дня".

Stored revision bounds remain absolute UTC instants.

### store.special_hours civil-day invariant

`store.special_hours` is a daily schedule replacement and must cover exactly one
local civil day.

For declared local date D:

```
effective_from_utc =
  instant(start of D in Europe/Kyiv)

expires_at_utc =
  instant(start of D+1 in Europe/Kyiv)
```

Publication rejects any other revision envelope.

Opening intervals, for example 11:00–18:00, live inside the effect. They are not
revision expiry boundaries. A multi-day special schedule is represented as one
immutable revision per local civil day.

This deliberately handles 23/25-hour DST civil days through timezone conversion
rather than fixed 24-hour arithmetic.

### Other temporary overlays

`store.temporary_closure` and `store.status_override` are state-like overlays,
not daily opening schedules.

They may span any finite interval satisfying:

```
effective_from_utc < expires_at_utc
```

Legitimate examples include:
- closure for three whole days;
- closure from 15:00 today until 10:00 tomorrow;
- status override until 16:00.

They remain subject to the subject + effect_family conflict rules below.

## 8. Publication workflow

Publication policy is namespace-risk based.

### Direct publish allowlist — temporary overlays only

Initial allowlist:
- store.status_override
- store.special_hours
- store.temporary_closure

Requirements:
- authorized OPERATIONAL_EDITOR grant;
- `expires_at_utc` mandatory;
- `effective_from_utc < expires_at_utc`;
- no null expiry;
- `store.special_hours` must use exactly one Europe/Kyiv local civil-day
  envelope from local midnight D to local midnight D+1;
- `store.temporary_closure` and `store.status_override` may use any finite
  interval and are not forced into civil-day envelopes.

### Approval-required baseline/identity facts

Examples:
- store.weekly_hours
- store.baseline_status
- store.address
- store.phone
- call_center.hours
- call_center.phone

### CommercePolicy

Always approval-required.

Author and approver must differ by stable BabyPark actor_id.

## 9. Operational resolver composition

Operational state is not a scalar "overlay else baseline".
A store answer composes operating-state and hours effect families.

Only identifiers may survive from an earlier clarification turn; the operational resolver itself is rerun for the current answer using the current `now` and current published authority.

### 9.1 Peer conflict rule across namespaces

For active revisions sharing:
- the same subject; and
- the same `effect_family`;

conflicting canonical effects are checked **regardless of namespace**.

Different namespaces do not hide a conflict in the same effect family.

Example:
- `store.temporary_closure = CLOSED`;
- overlapping `store.status_override = OPEN`;

for the same store and operating-state effect family:

```
HUMAN / POLICY_CONFLICT
```

Two active peer overlays in the same overlay namespace/effect family with different canonical effects also conflict.

This conflict rule does not convert temporary overlays into successors of baseline authority.

### 9.2 Resolve operating state first

Resolve active closing/status overlays for the store.

If the resolved operating state is `CLOSED`, it suppresses:
- `store.special_hours`;
- `store.weekly_hours`;

for the overlapping interval.

A customer must never receive opening hours for a store resolved CLOSED.

An OPEN/non-closing status does not itself invent opening hours; if non-conflicting, hours are still resolved by the hours resolver.

### 9.3 Resolve special hours as a full civil-day replacement

Only when the store is not resolved CLOSED:

1. find active `store.special_hours` overlays for the current local civil day;
2. conflicting peer special-hours effects fail closed;
3. if one canonical special-hours effect applies, it replaces `store.weekly_hours` for the **entire overlay revision envelope**;
4. within that civil day, local times outside the explicit opening interval(s) in the special-hours effect are CLOSED;
5. baseline weekly hours do not fill those gaps;
6. only after the special-hours revision expires at the next local civil-day boundary may weekly baseline apply again.

Example:

```
weekly baseline: 10:00–20:00
special hours for local date D: 11:00–18:00
special-hours revision envelope: whole local date D
```

At 18:30 on D:
- the special-hours revision is still active;
- 18:30 is outside its opening interval;
- the store resolves CLOSED;
- baseline 10:00–20:00 does not reopen it.

### 9.4 Weekly baseline

If:
- no closing overlay applies; and
- no active special-hours overlay applies;

resolve approved `store.weekly_hours` baseline using the current weekday and local time in `Europe/Kyiv`.

An open-ended baseline with `expires_at_utc = NULL` is active whenever:

```
effective_from_utc <= now
```

and its ledger/publication state is authoritative.

### 9.5 Overlay/baseline lifecycle

Temporary overlay and baseline coexist.

Overlay expiry reveals baseline again.

Temporary overlays never `SUPERSEDED`:
- weekly-hours baseline;
- baseline-status authority.

`SUPERSEDED` remains allowed only within the same:
- namespace;
- subject identity;
- effect_family.

## 10. Commerce conflict rule

No hidden:
- latest wins;
- most specific wins;
- priority number wins.

Multiple applicable equal canonical effects are compatible.

Different applicable effects produce:
`HUMAN / POLICY_CONFLICT`
unless a valid explicit exception resolves the overlap.

Canonical effect equality:
```
effect_type + canonical normalized effect_value
```

Customer wording comes from templates, not policy prose.

## 11. Exception scope model

v1 CommercePolicy scope is a conjunction of optional exact bindings:

```
category_id
brand_id
product_id
variant_id
store_id
```

Empty conjunction = global.

A child scope is strictly narrower than parent iff:
1. every binding present in parent is present in child with the same value;
2. child adds at least one additional binding.

Equal binding sets are not an exception.

Category descendants do NOT implicitly make CommercePolicy scope narrower.
Catalog taxonomy changes across generations; exception validity must not depend on a changing tree.

Example:
parent: category_id=furniture
child: category_id=furniture + brand_id=Veres
=> valid narrower scope.

Equal scope with changed effect requires SUPERSEDED or yields POLICY_CONFLICT.

## 12. Exception temporal rules

Authority intervals are half-open:
`[effective_from, expires_at)`.

Exception interval must be a non-empty subset of parent interval.

Rules:
- child.from >= parent.from;
- if parent.to finite, child.to finite and child.to <= parent.to;
- if child.to finite, child.from < child.to;
- exception graph acyclic;
- compatible effect_family;
- strict scope narrowing.

## 13. Employee control plane

BabyPark AI/Knowledge Control is an independent BabyPark Web App.

Preferred host:
`ai.babypark.ua`

Chatwoot Dashboard App is an embedding/container, not authority storage.

Zoho is not part of this authority path.

The first working UI must remain usable directly at ai.babypark.ua even if iframe login/session behavior is unreliable.

## 14. Authentication and authorization

### Authentication
Preferred first implementation:
Cloudflare Tunnel + Cloudflare Access.

Origin should not expose a public bypass around Access.

Backend validates:
- JWT signature;
- issuer;
- audience;
- expiry.

Verified Access identity maps to stable BabyPark actor_id.

### Authorization
BabyPark backend owns RBAC.

Initial logical roles:
- VIEWER
- OPERATIONAL_EDITOR
- COMMERCE_DRAFTER
- COMMERCE_APPROVER
- KNOWLEDGE_ADMIN

Grants may be scoped by namespace and subject/store.

Chatwoot Dashboard App `currentAgent` is display/diagnostic context only.
It never authorizes a write.

Before declaring iframe the primary UI, test:
- Chrome;
- Edge;
- normal mode;
- relevant private/incognito behavior;
- Access login and renewal inside iframe;
- CSP.

Embedded response:
`frame-ancestors https://chat.babypark.ua`.

## 15. Durable backup requirement

`knowledge.sqlite` is not production-ready until recovery is proven.

Implement/reuse a generic Durable SQLite Backup Profile:
1. consistent SQLite backup;
2. integrity check;
3. manifest/checksum;
4. encryption;
5. off-host copy;
6. independent verification;
7. restore into scratch;
8. semantic integrity verification.

Knowledge restore proof validates revision hashes, event hash chain and resolver outputs.

No age-only deletion may remove the only verified recovery copy.

## 16. Decision classes

Only:
- ANSWER
- CLARIFY
- HUMAN

Reason codes are machine-level.

Required examples:

ANSWER:
- OPERATIONAL_FACT
- COMMERCE_POLICY
- PRODUCT_PRICE_SINGLE
- PRODUCT_PRICE_RANGE
- PRODUCT_NOT_IN_STOCK
- VARIANT_LIST
- VARIANT_LIST_PARTIAL
- VARIANT_PRICE_LIST
- OBJECTIVE_SHORTLIST
- OBJECTIVE_SHORTLIST_EMPTY
- STORE_STOCK

CLARIFY:
- AMBIGUOUS_PRODUCT
- AMBIGUOUS_VARIANT
- AMBIGUOUS_CATEGORY
- AMBIGUOUS_BRAND
- AMBIGUOUS_STORE
- AMBIGUOUS_MONEY
- MISSING_SHORTLIST_ANCHOR

HUMAN:
- POLICY_CONFLICT
- POLICY_NOT_FOUND
- CATALOG_COMMERCIAL_STALE
- CATALOG_STOCK_STALE
- PRICE_COHORT_INCOMPLETE
- ZERO_PRICE_UNVERIFIED
- MIXED_CURRENCY
- UNSUPPORTED_CONSTRAINT
- UNSUPPORTED_EXCLUSION
- SUBJECTIVE_RECOMMENDATION
- PRODUCT_ATTRIBUTE_NOT_AUTHORITATIVE
- COMPATIBILITY_NOT_AUTHORITATIVE
- RETURN_CASE_SPECIFIC
- ORDER_SPECIFIC
- CATALOG_IDENTITY_COLLISION
- IDENTITY_NOT_RESOLVABLE
- MULTIPLE_REQUEST_FAMILIES_MATCHED
- MULTIPLE_IDENTITY_AMBIGUITIES
- MULTIPLE_CLARIFICATION_REQUIREMENTS
- CLARIFY_EXHAUSTED
- PRODUCT_VARIANT_NOT_RESOLVABLE
- PRODUCT_PRESENTATION_NOT_AVAILABLE
- COMMERCE_POLICY_NOT_AUTHORITATIVE
- UNSUPPORTED_RESPONSE_LANGUAGE

### 16.1 Customer response locale

Website First Line v1 has exactly two public response locales: `uk` and `ru`.
C4 obtains the response locale only from the **current certified C2 extraction**
for the complete open customer turn. It does not infer response language from
Catalog `matched_languages`, Knowledge source-language priority, browser/contact
metadata, Chatwoot profile fields or `intent_hint`.

If the current certified C2 `language` is exactly `uk` or `ru`, that exact tag is
`response_locale`. Any other syntactically valid language tag is a closed-world
HUMAN / UNSUPPORTED_RESPONSE_LANGUAGE outcome before any public CLARIFY or
factual authority read. There is no hidden default/fallback locale.

Mixed RU/UK customer wording does not create a third locale. If C2 certifies the
turn as `uk` or `ru`, C4 uses that one certified tag; if C2 emits another/unknown
tag, C4 hands off. Response locale is presentation metadata only: it never
selects authority IDs, changes facts or changes Catalog/Knowledge authority.

Every C4 ANSWER or CLARIFY decision carries `response_locale`=`uk|ru`. HUMAN
carries no public response locale because v1 HUMAN sends no AI preface. C5 must
consume this field and must not perform its own language detection or fallback.

### 16.2 Exact C4 decision/render contract

C5 is not allowed to interpret authority DTOs. C4 returns one frozen exact-shape
customer-safe decision object:

```text
C4Decision {
  schema = bp.first-line.decision/1
  decision = ANSWER | CLARIFY | HUMAN
  reason
  response_locale = uk | ru | null
  template_id = string | null
  render_payload = object | null
  requested_slot = string | null
  choices = [{token,label}, ...]
}
```

All eight keys are always present and no additional enumerable key is allowed.
The object contains no raw customer text, authority revision IDs, catalog
generation/freshness metadata, product/variant/category/brand/store IDs, SKU,
quantity, cohort IDs, debug fields or whole source DTO. Those remain private
DecisionBasis/decision-context metadata and are never input to C5.

Class invariants:
- HUMAN: `response_locale/template_id/render_payload/requested_slot=null`,
  `choices=[]`;
- ANSWER: `response_locale=uk|ru`, non-null allowlisted `template_id`, exact
  template payload, `requested_slot=null`, `choices=[]`;
- CLARIFY: `response_locale=uk|ru`, allowlisted clarify template,
  **`render_payload=null` for every CLARIFY template**, `requested_slot` is
  frozen, and `choices` contains only customer-safe
  `{token:'bp-choice:<ordinal>',label}` rows when finite choices are presented.
  `TPL_CLARIFY_MONEY_V1` and `TPL_CLARIFY_SHORTLIST_ANCHOR_V1` are free-text
  prompts and require **exactly `choices=[]`**; any non-empty choice array is
  invalid because there is no canonical candidate reservation behind it.
  Canonical candidate values for candidate-based prompts remain private durable
  clarification reservation data; C5 never sees or renders them. `{}`, an
  arbitrary object, or any non-null CLARIFY render payload is invalid and rejects
  before action preparation.

Unknown template IDs, missing/extra payload keys, wrong primitive types, unsafe
labels or extra DTO fields reject before public action preparation.

ANSWER templates and **only** their render payloads:

| template_id | decision reason/family | exact render_payload |
|---|---|---|
| `TPL_STORE_OPEN_STATUS_V1` | OPERATIONAL_FACT / current store open-status | `{open:boolean,closes_at_local:string|null}`; time is exact `HH:MM` when currently open |
| `TPL_STORE_HOURS_TODAY_V1` | OPERATIONAL_FACT / composed today-schedule | `{open_now:boolean,intervals:[{open:string,close:string},...]}`; interval times are exact `HH:MM`, complete for the local day and already adjusted for known CLOSED state intervals |
| `TPL_STORE_PHONE_V1` | OPERATIONAL_FACT / store.phone | `{e164:string}` |
| `TPL_CALL_CENTER_PHONE_V1` | OPERATIONAL_FACT / call_center.phone | `{e164:string}` |
| `TPL_PAYMENT_METHODS_V1` | COMMERCE_POLICY / payment methods | `{methods:[closed-code,...]}`; codes only, no conditions |
| `TPL_PREPAYMENT_V1` | COMMERCE_POLICY / prepayment | `{amount_minor:integer,currency:string}` |
| `TPL_RETURN_PERIOD_V1` | COMMERCE_POLICY / return period | `{applies_to:'GOOD_QUALITY',calendar_days:integer,purchase_day_excluded:boolean}` |
| `TPL_PRODUCT_PRICE_SINGLE_V1` | PRODUCT_PRICE_SINGLE | `{currency:string,current_minor:integer}` |
| `TPL_PRODUCT_PRICE_RANGE_V1` | PRODUCT_PRICE_RANGE | `{currency:string,min_current_minor:integer,max_current_minor:integer}` |
| `TPL_PRODUCT_NOT_IN_STOCK_V1` | PRODUCT_NOT_IN_STOCK | `{}` |
| `TPL_VARIANT_LIST_V1` | VARIANT_LIST | `{total_variant_count:integer,named_variant_count:integer,labels:[string,...]}`; all labels must be pairwise-distinguishable under the frozen public-label key |
| `TPL_VARIANT_LIST_PARTIAL_V1` | VARIANT_LIST_PARTIAL | same shape; `named_variant_count < total_variant_count` is explicit and all emitted labels must be pairwise-distinguishable |
| `TPL_VARIANT_PRICE_LIST_V1` | VARIANT_PRICE_LIST | `{currency:string,variants:[{label:string,current_minor:integer},...]}`; requires complete safe pairwise-distinguishable labels |
| `TPL_SHORTLIST_TOP3_V1` | OBJECTIVE_SHORTLIST where total > displayed | `{total_product_count:integer,products:[ShortlistItem,...]}` |
| `TPL_SHORTLIST_ALL_V1` | OBJECTIVE_SHORTLIST where total == displayed | same shape |
| `TPL_SHORTLIST_EMPTY_V1` | OBJECTIVE_SHORTLIST_EMPTY | `{}` |
| `TPL_STORE_STOCK_V1` | STORE_STOCK | `{in_stock:boolean,variant_label:string|null}` |

`ShortlistItem` is exact customer-safe projection:
`{title,product_url,image_url,price_min_minor,price_max_minor,currency,partial_model_match}`.
`title` must pass the exact public-display-text predicate below; URLs/images are
null or pass the exact public-URL predicate below; price fields are integer minor
units; `partial_model_match` is boolean. No canonical ID/SKU enters the item.

Variant enumeration ANSWER payloads (`VARIANT_LIST`, `VARIANT_LIST_PARTIAL`,
`VARIANT_PRICE_LIST`) must satisfy the same frozen public-label normalization and
pairwise-distinguishability rule as CLARIFY choices. If two different canonical
variants yield duplicate-equivalent emitted labels, C4 returns HUMAN /
PRODUCT_VARIANT_NOT_RESOLVABLE before constructing public payload; differing
prices do not make duplicate labels distinguishable. Ordinal position, SKU and
variant ID are never public disambiguators.

Variant-price-list rows with `label_complete=false` cannot be represented safely
without an internal identifier and therefore map to HUMAN /
PRODUCT_VARIANT_NOT_RESOLVABLE rather than partial public prices.

All CLARIFY templates use `render_payload=null`; prompt wording is determined
only by `(template_id,response_locale,requested_slot,choices)`. No CLARIFY
reason has an object payload in v1.

CLARIFY template mapping:
- AMBIGUOUS_PRODUCT -> `TPL_CLARIFY_PRODUCT_V1`, slot `product_id`;
- AMBIGUOUS_VARIANT -> `TPL_CLARIFY_VARIANT_V1`, slot `variant_id`;
- AMBIGUOUS_CATEGORY -> `TPL_CLARIFY_CATEGORY_V1`, slot `category_id`; the
  private durable candidate value is the exact tuple
  `{category_id,match_mode}` where `match_mode` is `NODE_ONLY` or
  `INCLUDE_DESCENDANTS`, while the public choice exposes only token+label;
- AMBIGUOUS_BRAND -> `TPL_CLARIFY_BRAND_V1`, slot `brand_id`;
- AMBIGUOUS_STORE -> `TPL_CLARIFY_STORE_V1`, slot `store_id`;
- AMBIGUOUS_MONEY -> `TPL_CLARIFY_MONEY_V1`, slot `max_price_minor`, and
  **exactly `choices=[]`**;
- MISSING_SHORTLIST_ANCHOR -> `TPL_CLARIFY_SHORTLIST_ANCHOR_V1`, concrete slot
  `category_id`, and **exactly `choices=[]`**. v1 deliberately asks for category
  rather than emitting the unsupported union slot `shortlist_anchor`; a brand
  remains a valid shortlist anchor when it was already resolved in the customer
  turn, but it is not treated as an answer to this category-specific prompt.

Every finite candidate must have one bounded safe customer label. For PRODUCT
and CATEGORY ambiguity, the C2 identity candidate's convenience `title`/`name`
field is **not** customer-presentation evidence because those resolvers may have
cross-locale fallback semantics. C4 instead performs the exact bounded
candidate-presentation reads frozen in §28.4 phase 7 and accepts only
`localized[response_locale].title` for PRODUCT or `names[response_locale]` for
CATEGORY when every read reports the same certified C2 catalog generation.
Cross-locale fallback is forbidden. Brand/store/variant labels may use their
canonical sanitized factual label where no locale-specific field exists.

A finite choice set must also be **pairwise distinguishable to the customer**.
For comparison only, derive `choice_label_key` by NFC-normalizing the rendered
label, collapsing Unicode whitespace to one ASCII space, trimming, and applying
locale lowercase with the exact `response_locale`. Two different private
candidate values may not share one `choice_label_key`. Ordinal tokens are not a
customer-visible disambiguator and must never be used to hide duplicate labels.

If PRODUCT/CATEGORY/BRAND/STORE identity candidates cannot all be represented
with safe exact-locale/factual and pairwise-distinguishable labels, the turn
fails closed to HUMAN / IDENTITY_NOT_RESOLVABLE. AMBIGUOUS_VARIANT uses HUMAN /
PRODUCT_VARIANT_NOT_RESOLVABLE under the same distinguishability rule. Candidate
ordering is the deterministic resolver order only after this validation, and a
public token ordinal maps only to the private reservation at the same ordinal.

### 16.3 Exact public presentation safety predicate

All customer-visible PRODUCT/CATEGORY/BRAND/STORE labels, shortlist titles and
variant labels are validated again at the C4 public boundary. Upstream ingest or
resolver acceptance is not presentation authorization.

`public_display_text(raw,{internal_ids})` is exact. `internal_ids` is **not caller-selected**; DecisionBasis derives the mandatory closed set below for the projection kind and rejects if required provenance cannot be read:
1. `raw` must be a string. NFC-normalize it.
2. **Before whitespace normalization**, reject any Unicode General_Category
   `Cc` **or `Cf`** code point (`/\p{Cc}|\p{Cf}/u`). This deliberately rejects
   zero-width/default-format controls such as U+200B/U+200C/U+200D/U+2060 and
   therefore also covers bidi override/isolate controls.
3. Collapse Unicode whitespace runs to one ASCII space and trim.
4. Result must contain 1..160 Unicode code points. The 160 ceiling is inherited
   from the already-shipped customer-facing variant-label bound, not newly guessed.
5. Reject URL-like values if the normalized value matches any exact predicate:
   `/^[A-Za-z][A-Za-z0-9+.-]*:/u`, `/^\/\//u`, or `/^www\./iu`.
6. Reject debug/internal-looking values if the normalized value matches either
   exact regex:
   - `/(?:^|[^\p{L}\p{N}_])(?:id|oid|aid|nid|vid|fid)\s*[:=#-]\s*\S+/iu`;
   - `/^(?:a|o|s|i|b|d):\d+[:;{]/iu`.
   The first rule is boundary-sensitive and separator-sensitive; for example
   `Blue oid:32976` and `oid-32976` reject, while `xoid:32976` does not match that
   debug-token rule. The serialized-prefix rule is intentionally case-insensitive,
   so `O:8:{...}`, `o:8:{...}` and `A:1:{...}` all reject.
7. Case-insensitive normalized equality with any member of the mandatory
   projection-specific internal-ID set is rejected.
8. Otherwise return the normalized string. No renderer may apply a weaker second
   sanitizer or recover rejected text from another source.

Mandatory `internal_ids` derivation is exact:
- PRODUCT identity choice: candidate `canonical_product_id`, non-null
  `canonical_variant_id`, `sku`, `sku_key`; plus same-generation `getProduct()`
  `product_id`, `default_variant_id`, `brand.brand_id`, every
  `variants[*].variant_id|sku|sku_key`, every category `category_id|parent_id`,
  every attribute `attribute_id|owner_id`, every image `image_id|variant_id`, and
  kit component `component_variant_id|component_product_id|sku` when present;
- CATEGORY choice: reserved/current `canonical_category_id`, presentation
  `category_id`, and non-null `parent_id`;
- BRAND choice: `canonical_brand_id` and presentation `brand_id`;
- STORE choice: `canonical_store_id` and presentation `store_id`;
- VARIANT choice/list/price/stock label: fact/reservation `variant_id` and `sku`
  plus a bounded same-generation `getVariant({variantId})` read supplying
  `variant_id`, `product_id`, `sku`, `sku_key` and every option object's non-null
  `option_id` / `attribute_id` used by label construction;
- shortlist PRODUCT title: current shortlist `product_id`, every
  `matching_variant_ids[*]`, and the full same-generation `getProduct()` internal
  identifier set listed for PRODUCT above.

Null/absent fields are ignored; non-string identifier values are stringified only
for equality comparison. Required same-generation identifier reads that fail,
drift, or cannot prove the mandatory set fail closed with the projection's
existing HUMAN reason (identity PRODUCT/CATEGORY/BRAND/STORE ->
IDENTITY_NOT_RESOLVABLE; VARIANT -> PRODUCT_VARIANT_NOT_RESOLVABLE; shortlist
required title -> PRODUCT_PRESENTATION_NOT_AVAILABLE). An empty or caller-pruned
set is never permitted.

Variant labels have an additional composition rule: **every constituent label
part is validated independently before composition** with the complete mandatory
VARIANT `internal_ids` set above, not merely with that part's local
`option_id`/`attribute_id`. A rejected part makes the whole variant label
unrepresentable; C4 never drops the bad part and keeps the remainder. Only after
all parts pass may they be joined deterministically with ` / `; the resulting
whole label is then validated again with the same complete VARIANT `internal_ids`
set. Therefore a SKU/internal ID cannot hide inside a composite label such as
`SKU123 / Blue` even though the final string is not equal to `SKU123`.

`public_url(raw,kind)` where `kind=product|image` is exact:
- `null` is allowed; otherwise `raw` is a string of 1..4096 Unicode code points
  (4096 is inherited from the frozen Catalog ingest URL bound);
- reject Unicode whitespace, Unicode `Cc`, backslash, and percent-encoded control
  octets `%00..%1F` / `%7F` before parsing;
- WHATWG URL parse must succeed;
- scheme must be exactly `https:`; username/password, fragment and non-default
  port are forbidden;
- hostname must be a public DNS hostname with at least one dot; IP literals,
  `localhost`, and `.localhost/.local/.internal/.invalid/.test/.example` names
  are forbidden;
- `product` host must be exactly `babypark.ua` or a subdomain of `babypark.ua`;
- `image` may use any public HTTPS DNS host satisfying the common host rule,
  because Catalog images may be CDN-hosted.

Return the canonical parsed HTTPS URL. For shortlist output, an unsafe/missing
required title => HUMAN / PRODUCT_PRESENTATION_NOT_AVAILABLE. `product_url` and
`image_url` are optional: an unsafe optional URL is projected as `null`, never
passed through and never replaced from another locale/generation/source.
Identity-choice label failure keeps the existing IDENTITY_NOT_RESOLVABLE /
PRODUCT_VARIANT_NOT_RESOLVABLE mappings.

Private provenance and authority dependencies are registered out-of-band with
the genuine decision object for `decision_context_id` construction. They are not
enumerable C4Decision properties and cannot be supplied/replaced by the caller.

## 17. Catalog freshness

Only relevant layers gate an answer.

Price / general objective shortlist:
- commercial/offer authority must be answerable.

Specific-store stock or store-filter shortlist:
- commercial/offer authority;
- stock authority.

An unrelated stale layer does not fail the answer.

Relevant `need_reconcile` / `need_full` fails closed.

## 18. Current verified production catalog evidence

At research time:
- 16,245 active products;
- 49,257 variants;
- 8,223 multi-variant products;
- 1,776 products with multiple priced variants;
- about 87.5% of variants have option labels;
- IN_STOCK variants: 8,673;
- trusted-price IN_STOCK variants: 8,673;
- current price currency in that cohort: UAH;
- EXPECTED variants: 468 with no trusted offers;
- MADE_TO_ORDER variants: 160 with no trusted offers.

These are evidence, not permanent invariants.
Runtime always rechecks completeness.

## 19. Price-now cohort

Current customer price uses:
- active variant;
- commercial_availability == IN_STOCK;
- trusted offer exists;
- one currency;
- relevant commercial authority answerable.

EXPECTED and MADE_TO_ORDER do not enter "price now".

Missing trusted offer in relevant IN_STOCK cohort:
`HUMAN / PRICE_COHORT_INCOMPLETE`.

Mixed currencies:
`HUMAN / MIXED_CURRENCY`.

Zero IN_STOCK variants with fresh commercial authority:
`ANSWER / PRODUCT_NOT_IN_STOCK`.

## 20. Zero price

Canonical schema permits `current_minor >= 0`.

But v1 has no semantic authority proving that zero means "free".

Therefore:
trusted offer with `current_minor == 0`
=> `HUMAN / ZERO_PRICE_UNVERIFIED`.

Do not silently remove it from the cohort.
Do not render "free" without an explicit future authority contract.

## 21. Product-level price summary

Natural customer product/model queries are product-level, not SKU-only.

For unique product:
1. identify relevant active IN_STOCK variant cohort;
2. verify offer completeness/currency;
3. compute min/max trusted current price.

If min == max:
`ANSWER / PRODUCT_PRICE_SINGLE`.

If min != max:
`ANSWER / PRODUCT_PRICE_RANGE`.

`VARIANT_PRICE_LIST` remains a supported deterministic C4 family and the
downstream target for the separately scoped C25 dependent-follow-up routing.
The C5 v1 range wording frozen in §40.4 does **not** invite/promise that follow-up
before C25 routing exists. Adding a customer-facing invitation later requires
the C25 routing prerequisite plus a separately reviewed wording-contract update.

## 22. Product resolution

1 credible canonical product => continue.

0 customer-level canonical candidates => HUMAN / IDENTITY_NOT_RESOLVABLE.

Multiple known, bounded customer-level candidates => CLARIFY / AMBIGUOUS_PRODUCT.
CLARIFY is reserved for a real finite candidate set that can be presented and
selected; zero candidates must not degrade into an open-ended "tell me more"
prompt.

The same zero-versus-known-many rule applies to required canonical
category/brand/store identity resolution: zero canonical candidates => HUMAN /
IDENTITY_NOT_RESOLVABLE; multiple known bounded candidates => the corresponding
AMBIGUOUS_* CLARIFY reason. Absence of an optional shortlist anchor remains the
separate `MISSING_SHORTLIST_ANCHOR` case.

Unresolved catalog identity corruption/collision => HUMAN / CATALOG_IDENTITY_COLLISION.
Never expose internal identity-collision candidates.

C4 evaluates the **complete certified identity-row multiset**, never one selected
row in isolation. Before any ANSWER or CLARIFY:
- any `INVALID_AUTHORITY / CATALOG_IDENTITY_COLLISION` row => HUMAN /
  CATALOG_IDENTITY_COLLISION;
- any other `INVALID_AUTHORITY` row => fail before decision creation;
- any PRODUCT/CATEGORY/BRAND/STORE `NOT_FOUND` row forbids ANSWER and CLARIFY
  for the whole turn and yields HUMAN / IDENTITY_NOT_RESOLVABLE unless a more
  specific C3 latch reason wins;
- `AMBIGUOUS_*` may be considered only when no identity row is NOT_FOUND or
  INVALID_AUTHORITY;
- exactly one ambiguous identity kind may use the corresponding CLARIFY path;
- more than one simultaneously ambiguous required identity kind => HUMAN /
  MULTIPLE_IDENTITY_AMBIGUITIES.

Thus `NOT_FOUND + RESOLVED` never becomes ANSWER, `NOT_FOUND + AMBIGUOUS` never
becomes CLARIFY, and multiple NOT_FOUND rows never degrade to
`MISSING_SHORTLIST_ANCHOR`.

After INVALID_AUTHORITY and NOT_FOUND have been handled, C4 also reduces
**same-kind singular-slot cardinality** before request-family selection or any
dynamic authority read. v1 singular resolver kinds are PRODUCT, CATEGORY,
BRAND, STORE and MONEY. Multiple rows of one kind are admissible only when every
row is `RESOLVED` and all rows prove the same exact semantic slot value; those
rows collapse to one value while their source-span provenance remains retained.

Semantic equality is exact and kind-specific:
- PRODUCT: `(canonical_product_id, canonical_variant_id)`; `null` variant and an
  exact variant are different values;
- CATEGORY: `(canonical_category_id, match_mode)`;
- BRAND: `canonical_brand_id`;
- STORE: `canonical_store_id`;
- MONEY: `(currency, minor_units)`.

If one singular kind has two different RESOLVED values, any mix of RESOLVED and
AMBIGUOUS rows, or more than one AMBIGUOUS row, C4 returns HUMAN /
UNSUPPORTED_CONSTRAINT before authority. It never chooses the first row,
intersects/unions values, invents min/max roles, or presents candidates from an
arbitrarily selected row. This is a v1 fail-closed boundary, not a claim that
multi-product/multi-category/multi-money requests are inherently unsupported in
future versions.

## 23. Variant labels

Raw Drupal option labels may be shown only as sanitized factual labels.
Do not infer universal COLOR/SIZE/MATERIAL semantics.

**Review trigger (data-based, not phase-based).**
`PRODUCT_ATTRIBUTE_NOT_AUTHORITATIVE` routing, including C30/C31, must be
explicitly re-certified — never silently reinterpreted — the first time the
current production-authoritative Catalog generation contains at least one
canonical `product_attributes` row referencing `attribute_defs`, regardless of
source provider. This trigger is a required checklist item of the next
source-provider cutover review, not an independently schedulable task. Until an
explicit re-certification change is reviewed and merged into the frozen base
docs, HUMAN routing stays in force even when richer canonical attribute data is
technically available. Populated data alone never changes frozen policy.

C4 treats reviewed product-attribute request language as a **pre-authority
terminal family outcome** in v1. After the request-family match set has been
reduced to exactly one attribute-query family, C4 returns HUMAN /
PRODUCT_ATTRIBUTE_NOT_AUTHORITATIVE without reading product attribute values or
using free description text. C30/C31 and the populated-data C31a fixture use the
same terminal mapping until an explicit re-certification changes this frozen
contract.

`displayable_variant_label()` minimum:
- non-empty;
- valid text;
- bounded length;
- whitespace normalization;
- no control characters;
- no URL/blob/debug-like value;
- no raw internal ID.

Completeness is explicit.

If 7 relevant variants but only 5 safe labels:
do not imply that only 5 variants exist.

## 24. "Available now" variant cohort

Question like:
"Какие варианты сейчас есть?"

uses:
- active;
- IN_STOCK.

EXPECTED and MADE_TO_ORDER are not "available now".

## 25. Variant price list

Explicit contract:
`ANSWER / VARIANT_PRICE_LIST`.

Cohort:
- active;
- IN_STOCK;
- trusted offer;
- safe currency;
- commercial layer answerable.

Stable order:
`current_minor ASC, variant_id ASC`.

Display count and label completeness are explicit.

## 26. Objective shortlist

Allowed as factual filtering, not recommendation.

Examples:
- "Прогулочные коляски до 20 000 грн"
- "Покажи Cybex до 30 000"

No:
- popularity;
- margin;
- conversion;
- "best";
- recommendation ranker.

## 27. Closed-world resolvers

LLM never chooses authority IDs.

It may identify raw spans/phrases.
Deterministic reviewed resolvers produce canonical IDs.

### Category
Reviewed vocabulary returns 0/1/many category candidates.

Every vocabulary entry includes explicit:
- canonical_category_id;
- match_mode: NODE_ONLY | INCLUDE_DESCENDANTS.

No default match mode.

### Brand
Same 0/1/many rule.
LLM never emits brand_id as authority.

### Money
Deterministic parser maps approved forms such as:
- 20 000 грн
- 20 тысяч
- 20 тисяч
- 20к
to integer minor units.

Ambiguous => CLARIFY / AMBIGUOUS_MONEY.

### Store
Natural store phrase must resolve to exactly one canonical active store.
Failure never silently removes store constraint.

Vocabulary is durable reviewed authority and has revision IDs.

## 28. ObjectiveConstraintLatch

Protect not only extracted slots but constraints the model failed to extract.

Latch runs after C2c routing and before C4 decision.

For the current accepted semantic basis, customer text is exact-read from Chatwoot
and held only transiently together with C2-certified consumed spans.

"Full current bot episode" does not require BabyPark to persist or later reconstruct
the raw/normalized episode body. Episode-wide constraint safety is the union of:
- previously committed typed constraint latches for the active episode; and
- the current transient exact-read latch evaluation.

A non-CLEAR latch blocks ANSWER and CLARIFY for that processing attempt. C4 maps
the latch to HUMAN. Therefore an unsupported constraint discovered on turn 1
normally prevents an AI clarification on turn 1.

Cross-turn crash/concurrency safety is durable but body-free. C3 maintains a
**set of typed unsupported latch classes** for the active episode. For each
distinct class BabyPark may persist only:
- the latch class;
- the accepted source event sequence that first proved that class;
- ordinary episode version/lifecycle metadata.

`CLEAR` is never persisted beside unsupported classes. It means only that the
effective latch set is empty.

It MUST NOT persist the raw/normalized phrase, leftover text, tokens or a content
digest merely to remember the constraint.

Unsupported latch classes are monotonic for the active episode:
- later turns may add a newly proven class;
- repeated proof of the same class is idempotent;
- later customer text cannot remove a class;
- all proven classes remain available to trace/handoff even though C4 emits one
  primary HUMAN reason.

### 28.1 Pending-HUMAN routing fence

C2c normally runs before C3. Therefore crash/concurrency recovery needs one
cross-stage fence: if an active episode already has a non-empty unsupported latch
set and HUMAN/native handoff has not terminalized that episode, a later customer
event MUST NOT cause C2c route application to close/replace it as a standalone
new AI episode.

The later event may trigger reprocessing/recovery, but the latched episode remains
the semantic owner until HUMAN/handoff closes it. No ANSWER or CLARIFY may be
prepared from that later event.

This is not a new decision class and does not make C3 an ownership machine.
Chatwoot still owns bot/human assignment; BabyPark only prevents its own semantic
episode replacement while a previously proven HUMAN blocker is pending.

This is safe for v1 because HUMAN ends the AI episode and automatic bot re-entry
after handoff is out of scope.

### 28.2 C4 primary HUMAN reason

C3 retains the complete latch set and never chooses the final public reason.
C4 preserves that set and selects one primary HUMAN reason using this fixed
order:

1. `RETURN_CASE` -> `RETURN_CASE_SPECIFIC`
2. `ORDER_SPECIFIC` -> `ORDER_SPECIFIC`
3. `UNSUPPORTED_COMPATIBILITY` -> `COMPATIBILITY_NOT_AUTHORITATIVE`
4. `SUBJECTIVE_RECOMMENDATION` -> `SUBJECTIVE_RECOMMENDATION`
5. `UNSUPPORTED_EXCLUSION` -> `UNSUPPORTED_EXCLUSION`
6. `UNSUPPORTED_AGE_SUITABILITY` -> `UNSUPPORTED_CONSTRAINT`
7. any certified PRODUCT/CATEGORY/BRAND/STORE `NOT_FOUND` identity row ->
   `IDENTITY_NOT_RESOLVABLE`
8. `OTHER_UNCONSUMED_CONSTRAINT` -> `UNSUPPORTED_CONSTRAINT`

A contentful zero-candidate phrase is **not** required to make C3 CLEAR.
For example, an unknown model name may legitimately leave
`OTHER_UNCONSUMED_CONSTRAINT`; the latch remains intact while the certified
NOT_FOUND identity row selects `IDENTITY_NOT_RESOLVABLE` above the generic
OTHER fallback. A specific latch such as `UNSUPPORTED_EXCLUSION` still outranks
the identity reason. No latch is deleted or rewritten to obtain a preferred
reason.

### 28.3 Sealed transient DecisionBasis

C4 kernel has one admissible input capability: a transient opaque
`DecisionBasis` token. It MUST NOT accept caller-supplied C3 proofs, resolution
rows, exact-read arrays, request-family results or authority fact DTOs as
independent kernel arguments.

The decision-authority composition seam creates the token in one invocation. In
that invocation it must:
1. receive the current certified routing projection and exact Chatwoot reads;
2. consume the exact certified C2 resolution proven against those reads;
3. call `evaluateObjectiveConstraintLatch` itself and retain the exact genuine
   C3 result;
4. run **all** reviewed deterministic request-family validators, recording the
   complete match set;
5. reduce the complete certified identity-row multiset under §22;
6. derive the complete **pre-authority clarification set** for the one matched
   family before any domain-authority read. This set includes required unresolved
   PRODUCT/CATEGORY/BRAND/STORE identity ambiguity, AMBIGUOUS_MONEY and
   MISSING_SHORTLIST_ANCHOR. The exact set is retained and is never reduced by
   choosing a slot in source-code order;
7. for any finite identity clarification set, perform only the exact bounded
   **candidate-presentation reads** allowed by §16.2/§28.4: they may decorate the
   already-certified candidate IDs for public labels but may not add/remove/
   replace candidates or determine business facts. Every Catalog read must return
   the same `generation_id` as the certified C2 `catalog_generation_id`; drift,
   missing exact-locale presentation or unsafe/indistinguishable labels becomes a
   terminal identity-representability HUMAN before clarification budget;
8. validate the current clarification budget as exactly integer 0 or 1 and
   reduce all local gates under the total precedence in §28.4, including C3,
   identity integrity/NOT_FOUND, same-kind singular-slot cardinality,
   request-family cardinality, all frozen single-family pre-authority terminals
   (attribute query and uncertified delivery policy), response-locale allowlist,
   candidate-label representability and the clarification set. A local terminal HUMAN or
   CLARIFY outcome is retained in the private snapshot and **no family authority
   read occurs**;
9. only when §28.4 produces no pre-authority terminal outcome and every required
   canonical ID/value is resolved, perform the current authority read required
   for that family. Never choose an arbitrary candidate, omit an unresolved
   filter/value, widen the request, or read dynamic authority after a prior
   terminal outcome merely to choose a different reason;
10. validate the returned authority outcome against the exact closed
   `(authority family, status, reason)` union emitted by that authority
   contract. Every emitted tuple has one explicit mapping or an explicit
   intentional rejection. Wildcard/default mappings such as "any allowlisted
   UNANSWERABLE" are forbidden; an unknown/new tuple fails before decision
   creation until the frozen contract is amended;
11. derive an allowlisted immutable typed private snapshot and return only an
    opaque frozen token.

Private basis metadata is held only in process in WeakMap/WeakSet-equivalent
state. It may retain source object references for provenance, but the kernel
uses only the private immutable typed snapshot. The token and metadata are never
durable and contain no raw/normalized customer body, residue, email, phone,
attachment URL or content-derived digest.

A missing, serialized, `structuredClone`d, reconstructed or otherwise
unregistered token fails before decision creation. The token is single-use:
after one decision attempt, reuse fails. Recovery/retry or a later customer turn
must rebuild a new basis from exact reads and current authority.

Because the kernel receives no independent proof/fact arguments, callers cannot
mix a C3 result from basis A, a resolution from basis B or a fact DTO for another
product. Certification is the capability boundary, not structural equality.

For any certified identity row with status `NOT_FOUND`, the exact certified C2
resolution captured in DecisionBasis is the zero-candidate evidence. No second
parallel zero-candidate proof object exists.

### 28.4 Total terminal precedence and authority short-circuit

C4 has one total precedence across independent gates. This order chooses the one
machine reason and determines whether dynamic authority may be read. All local
pure validators/reducers may collect their evidence, but a lower phase never
replaces a terminal outcome from a higher phase.

0. **Invalid/certification state:** missing/forged basis inputs, invalid
   `clarification_prompts_sent`, unknown/non-allowlisted enum/status/reason or
   other unclassified typed state => reject before decision creation. No dynamic
   authority read.
1. **Identity integrity:** if any identity row is `INVALID_AUTHORITY /
   CATALOG_IDENTITY_COLLISION`, HUMAN / CATALOG_IDENTITY_COLLISION wins. If no
   collision exists but any other `INVALID_AUTHORITY` row exists, reject. A
   collision outranks semantic C3 latch reasons; the complete latch set remains
   retained for trace/handoff.
2. **C3 + identity NOT_FOUND:** if phase 1 did not terminate, apply §28.2 exactly
   across the complete C3 latch set plus any certified identity `NOT_FOUND` row.
   Any resulting HUMAN reason terminates the decision before authority.
3. **Singular-slot cardinality:** reduce same-kind PRODUCT/CATEGORY/BRAND/STORE/
   MONEY rows under §22. Equivalent all-RESOLVED rows collapse; any different
   RESOLVED values or any multi-row set containing AMBIGUOUS => HUMAN /
   UNSUPPORTED_CONSTRAINT. No authority read.
4. **Request-family cardinality:** only if no earlier terminal outcome exists,
   zero matches rejects, more than one match => HUMAN /
   MULTIPLE_REQUEST_FAMILIES_MATCHED, exactly one match continues.
5. **Single-family pre-authority terminal:** attribute-query family => HUMAN /
   PRODUCT_ATTRIBUTE_NOT_AUTHORITATIVE; delivery-policy family => HUMAN /
   COMMERCE_POLICY_NOT_AUTHORITATIVE until an exact public delivery schema is
   separately frozen. Future pre-authority terminal families require an explicit
   frozen mapping; there is no default.
6. **Response locale:** current certified C2 language must be exactly `uk` or
   `ru`; otherwise HUMAN / UNSUPPORTED_RESPONSE_LANGUAGE. No domain-authority
   read.
7. **Finite identity candidate presentation/representability:** only for a
   clarification requirement that presents PRODUCT/CATEGORY/BRAND/STORE
   candidates. PRODUCT labels come from exact `getProduct({productId})`
   `localized[response_locale].title`; CATEGORY labels come from exact
   `listCategories({language:response_locale,categoryIds:[...]}).categories[*].names[response_locale]`.
   C4 ignores fallback `candidate.title`, fallback category `name`, and
   cross-locale presentation as public label evidence. Every such Catalog read
   must report the exact certified C2 `catalog_generation_id`; generation drift,
   missing exact-locale label, unsafe label or duplicate-equivalent labels =>
   HUMAN / IDENTITY_NOT_RESOLVABLE. BRAND/STORE use their already-certified
   canonical factual labels and obey the same safety/distinguishability rule.
   These reads decorate the fixed candidate set only; they never change identity
   or business authority.
8. **Clarification set/budget:** only after phase 7 succeeds, apply §29 to the
   complete pre-authority clarification set. Budget 1 + any non-empty set =>
   HUMAN / CLARIFY_EXHAUSTED; budget 0 + one requirement => corresponding
   CLARIFY; budget 0 + >1 identity-only => HUMAN /
   MULTIPLE_IDENTITY_AMBIGUITIES; budget 0 + any other >1 => HUMAN /
   MULTIPLE_CLARIFICATION_REQUIREMENTS.
9. **Current authority:** only after phases 0-8 produce no terminal outcome may
   C4 perform the family authority read. Exact ANSWER/HUMAN tuples map under the
   closed family table. If the exact store-stock read returns `CLARIFY /
   AMBIGUOUS_VARIANT`, C4 validates all candidate variant labels for safety and
   pairwise distinguishability **before** applying the 0/1 budget. Label failure
   => HUMAN / PRODUCT_VARIANT_NOT_RESOLVABLE at budget 0 or 1; only a
   representable candidate set uses budget 0 => CLARIFY / AMBIGUOUS_VARIANT or
   budget 1 => HUMAN / CLARIFY_EXHAUSTED.

Therefore a C3 HUMAN, identity-integrity HUMAN, singular-slot-cardinality
HUMAN, multi-family HUMAN, attribute-query HUMAN, unsupported-response-language
HUMAN or pre-authority CLARIFY/HUMAN can never be replaced by a later
stale/conflicting authority result, because that authority call is not made. Cross-product property tests use an authority
spy to prove zero calls for every pre-authority terminal phase.

Supported resolvers consume:
- product;
- category;
- brand;
- money;
- store.

Latch detects at minimum:
- negation/exclusion;
- subjective/recommendation language;
- age/suitability markers;
- compatibility markers;
- order-specific markers;
- return-case markers;
- other unconsumed contentful constraints.

Examples:
"до 20 000, но не Cybex"
=> HUMAN / UNSUPPORTED_EXCLUSION.

"для ребёнка 6 месяцев"
=> HUMAN / UNSUPPORTED_CONSTRAINT.

"какая лучше"
=> HUMAN / SUBJECTIVE_RECOMMENDATION.

False-positive HUMAN is acceptable.
Silent constraint removal is not.

Unknown contentful residue after subtracting:
- C2-certified resolver spans; and
- explicitly reviewed **supported-v1 request language** plus glue/social language
is itself a latch: `OTHER_UNCONSUMED_CONSTRAINT`.

Supported request language is a bounded deterministic validator, not free-form
LLM permission. The model `intent_hint` may prioritize validator order, but it
MUST NOT be the sole gate for whether a reviewed validator runs and MUST NOT
itself mark arbitrary text as consumed.

Every frozen supported-only v1 vector must be recognized by the corresponding
deterministic request-language validator independently of model hint quality.

All reviewed request-family validators run for the turn; source-code order and
`intent_hint` never select the winner. If C3/identity gates have not already
forced HUMAN:
- zero matching families => fail before decision creation;
- exactly one matching family => continue;
- more than one matching family => HUMAN /
  MULTIPLE_REQUEST_FAMILIES_MATCHED.

A multi-family match is one known fail-closed state, not an implicit priority
between otherwise valid domains.
A validator may accept only reviewed language for that v1 intent family. If all
contentful text is accounted for by certified spans plus reviewed request/glue/
social validators and no unsupported marker is present, the effective latch set
MUST be empty (`CLEAR`).

Therefore ordinary supported questions such as payment policy, general return
policy or store hours do not become HUMAN merely because their request words are
not product/category/brand/money/store spans. Conversely, extra unsupported
clauses remain visible residue.

Uncertainty never becomes CLEAR merely because a known marker classifier or
supported-intent validator did not recognize the residue.

## 29. Clarification episode

Episode state may persist **stable identifiers and customer selections only**.

It stores:
- normalized stable slots such as product_id/category_id/brand_id/store_id;
- source_message_ids[];
- presented candidates;
- requested missing slot;
- `clarification_prompts_sent`.

It must **not** persist dynamic factual authority from an earlier turn as truth for a later answer.

Specifically, never reuse an earlier-turn cached:
- price;
- offer completeness;
- commercial availability;
- stock quantity;
- catalog freshness state;
- `need_reconcile` / `need_full`;
- resolved OperationalFact effect;
- resolved CommercePolicy effect;
- operational `now` evaluation.

Before every public `ANSWER`, and before any `CLARIFY` that displays dynamic customer-facing catalog/operational facts, rerun the relevant authority reads against state current for that specific response.

For CatalogFact this means:
- reopen/read the currently accepted catalog generation;
- revalidate the preserved identifiers against that generation;
- reread relevant commercial/offer/stock layers;
- re-evaluate freshness and completeness.

For OperationalFact / CommercePolicy this means:
- reread current published authority;
- evaluate the current `now`;
- run the resolver again.

A preserved identifier that no longer resolves safely in current authority fails closed rather than reviving stale facts.

The final `decision_context_id` is built from the authority actually reread for the final response, not from the earlier clarification turn.

That current authority outcome is captured inside the same sealed DecisionBasis
that C4 consumes. The kernel never accepts an authority DTO separately. Outcome
mapping is keyed by the exact tuple `(authority family, status, reason)`, not by
a global reason-string switch. A fact-layer `NOT_FOUND / PRODUCT_NOT_FOUND`
therefore does not mean identity zero-candidates and does not mean
`PRODUCT_NOT_IN_STOCK`; unless explicitly frozen for that authority family it
fails before decision creation. A previous-turn DTO, an outcome for another
canonical ID, or an outcome from another generation/revision cannot be attached
to the current basis.

Clarification does not restart intent extraction from zero.

When the system presents candidates, the next customer message may only:
- choose one of the presented candidates;
- or fill the explicitly requested missing slot.

For v1 price-ceiling clarification, the requested slot is concrete:
`max_price_minor`. A successful MONEY reply supplies one exact UAH amount and
commits `max_price_minor` plus `currency=UAH`.

The historical generic requested slot `money` is not semantically sufficient
because it loses min/max direction across the clarification boundary. v3 may read
legacy persisted `money` for migration compatibility, but new CLARIFY actions
MUST NOT create it and a pending legacy `money` reservation fails closed rather
than guessing direction.

`min_price_minor` remains an allowed stable customer constraint, but Slice C v1
does not invent a lower-bound money clarification without a frozen requirement.

Previously resolved stable identifier slots remain fixed unless the user explicitly changes them.

Clarification counting is prompt-based, not attempt/round-based.

Rules:
- the only valid persisted values are integer `0` and integer `1`; any
  missing/null/other value fails before decision creation;
- initial episode: `clarification_prompts_sent=0`;
- `0` is the **only** state in which any clarify-capable outcome may emit
  `CLARIFY`;
- after that prompt is emitted: `clarification_prompts_sent=1`;
- a successful selection may allow a later ANSWER after current-authority
  rereads, but it never resets the budget;
- finite identity candidate sets must first pass the §28.4 presentation/label
  representability gate; an unrepresentable PRODUCT/CATEGORY/BRAND/STORE set
  yields HUMAN / IDENTITY_NOT_RESOLVABLE, and an unrepresentable VARIANT set
  yields HUMAN / PRODUCT_VARIANT_NOT_RESOLVABLE, at budget `0` or `1`;
- only **after** every required finite candidate set is representable, budget `1`
  plus any non-empty clarification requirement set — one requirement or many,
  pre-authority or post-authority AMBIGUOUS_VARIANT — yields HUMAN /
  CLARIFY_EXHAUSTED before any lower clarification-cardinality HUMAN reason;
- when the budget is `0`, exactly one representable finite requirement may CLARIFY; more than
  one identity-only requirement yields HUMAN / MULTIPLE_IDENTITY_AMBIGUITIES,
  while any other set of more than one requirement yields HUMAN /
  MULTIPLE_CLARIFICATION_REQUIREMENTS;
- no path emits a second CLARIFY and no path chooses one requirement from a
  multi-requirement set by code order.

Outcome:

```
HUMAN / CLARIFY_EXHAUSTED
```

Thus there is exactly one assistant clarification prompt per episode.

### 29.0.1 Native clarification submission

A successful response to the single CLARIFY prompt is not required to create a
new Chatwoot customer message.

Chatwoot/provider transport may represent the customer choice in either form:

1. **new incoming message** — the provider/Chatwoot channel creates a newer
   customer message carrying the reply; or
2. **structured submission** — the provider-native control updates the already
   confirmed CLARIFY message with a structured submitted value.

Chatwoot v4.18 Web Widget `input_select` is the normative v1 example of the
second form: the widget PATCHes the existing outgoing CLARIFY message,
`content_attributes.submitted_values` changes, and Chatwoot emits
`message_updated`. No new customer message ID exists.

A structured submission is a work/selection signal, **not** a second
Conversation Event Ledger message event. BabyPark MUST NOT:
- append a second ordinary ledger row with the same Chatwoot message ID;
- synthesize a fake customer message ID;
- treat a `message_updated` delivery as proof merely because it exists.

Before accepting a structured clarification selection, BabyPark must:
- authenticate and deduplicate the Chatwoot delivery;
- exact-read the referenced Chatwoot message;
- prove that it is the exact confirmed BabyPark CLARIFY action for the current
  conversation/episode;
- prove the expected structured content type;
- accept exactly one submitted choice under the confirmed response contract;
- map that choice to exactly one canonical candidate/allowed requested value
  reserved by the confirmed CLARIFY action;
- fail closed on unknown, multiple, stale, mismatched or unconfirmed values.

On success, only the canonical stable customer selection/slot and ordinary
episode version/lifecycle metadata may become durable. Raw presentation labels,
raw customer bodies and provider callback payloads are not durable authority.

Because the transport created no new customer message, a structured submission
does not append a new `source_message_id` to the episode solely to simulate a
turn. The confirmed CLARIFY action plus authenticated exact-read submission is
the provenance for that selection.

Repeated delivery of the same structured submission is idempotent. A conflicting
or changed submission after semantic commit fails closed; it never silently
rewrites an already accepted stable choice.

Where Chatwoot/provider transport collapses a native selection to ordinary
incoming text (including current Telegram callback content and WhatsApp
button/list title behavior), v1 may accept an **exact-message selection** only
when deterministic resolution proves one reserved candidate/requested value and
its single certified span consumes the whole customer message except leading
and trailing Unicode whitespace. This is a narrow deterministic fallback, not a
general NLP/negation classifier.

An unresolved catalog identity collision is:

```
HUMAN / CATALOG_IDENTITY_COLLISION
```

and internal collision candidates are not exposed to the customer.

## 29.1 Logical episode boundary

BabyPark logical episode state is independent of the Chatwoot conversation
status machine. `pending`, `open` and `resolved` are transport/ownership state;
they do not define semantic episode identity.

A new actionable customer message starts a new episode when there is no active
episode.

An existing episode is continued only when the new customer response is proven
to be semantically dependent on that episode. A response may be a real newer
customer message or a verified native structured submission under §29.0.1, for
example:
- selecting one of the candidates BabyPark presented;
- filling the explicitly requested missing slot;
- invoking an explicitly supported deterministic follow-up that relies on
  preserved stable slots, such as C25 `VARIANT_PRICE_LIST`.

A successful clarification selection does not append a second independent
identity row to the old ambiguity. The continuation seam performs one
**provenance-bound clarification discharge reducer** before ordinary C4 identity/
family reduction:
1. locate the episode's unique CONFIRMED CLARIFY action that owns the historical
   one-prompt reservation; its `basis_event_seqs`/descriptor define the original
   request-family semantics;
2. reread/rebuild that original covered customer basis under current C2/C3 rules;
3. require durable stable selection state committed by the already proven
   selection path and matching the confirmed action's reserved slot/candidate.
   This includes the concrete money slot `max_price_minor` with proven
   `{currency:'UAH',minor_units}` and, for CATEGORY, the atomic pair
   `(category_id,category_match_mode)`;
4. for CATEGORY, re-prove according to the selection origin before discharge:
   - **presented-candidate / structured submission:** rerun the current category
     resolver on the original ambiguity phrase/basis that produced the confirmed
     CLARIFY, not on the ordinal token. The result may correctly remain
     `AMBIGUOUS`; success requires the privately reserved selected
     `{category_id,match_mode}` tuple to be an exact member of the current
     candidate set. Extra current candidates do not erase the customer's proven
     selection. Absence of the tuple, INVALID/NOT_FOUND authority, or a same-ID
     mode replacement such as `NODE_ONLY -> INCLUDE_DESCENDANTS` fails HUMAN /
     IDENTITY_NOT_RESOLVABLE;
   - **requested-slot free-text fill:** rerun the category resolver on that exact
     follow-up phrase and require one current `RESOLVED` tuple exactly equal to
     the atomically committed `(category_id,category_match_mode)`. Current
     ambiguity/NOT_FOUND/INVALID or mode drift fails HUMAN /
     IDENTITY_NOT_RESOLVABLE.
   The structured ordinal itself is never treated as a vocabulary phrase and no
   path guesses descendant scope;
5. replace **exactly that one unresolved/ambiguous slot** in the original
   continuation view with the proven stable canonical selection before
   singular-cardinality, ambiguity and family-match reduction. CATEGORY supplies
   both `category_id` and `category_match_mode` to the original family. For MONEY
   the historical AMBIGUOUS_MONEY row is discharged and the selected upper-bound
   `(currency,max_price_minor)` is supplied to the original objective shortlist
   family; neither old ambiguity remains alongside its replacement;
6. preserve every unrelated original stable constraint/family input (for example
   the original category/brand anchor while resolving C40 money, or the original
   price ceiling while resolving C43 category) and then reread all current dynamic
   authority.

The reducer never globally deletes AMBIGUOUS rows, never guesses which old row
was answered and never lets a later standalone query inherit this context. If
there is no unique confirmed CLARIFY provenance, slot mismatch, value mismatch,
multiple possible discharge targets, or the rebuilt original family no longer
matches the reservation semantics, fail closed to HUMAN/reject rather than
renewing ambiguity. After successful discharge the persisted prompt budget
remains `1`; it is not reset.

A standalone new query closes/replaces the prior logical episode and starts a
new one. Its `clarification_prompts_sent` starts at zero and no old stable slot
is inherited implicitly.

HUMAN handoff and confirmed human takeover close the logical episode.

A closed episode is never revived merely because Chatwoot later changes from
`resolved` to `pending` or otherwise returns ownership to the AgentBot. A later
customer message must satisfy the same new-episode/dependent-follow-up rules.

Dynamic authority is never episode state. Preserved identifiers only constrain
a later reread of current authority.

## 29.2 Non-actionable acknowledgement

`NON_ACTIONABLE_ACK` is an internal lifecycle disposition, not a fourth AI
decision class. The public decision taxonomy remains exactly:
`ANSWER / CLARIFY / HUMAN`.

It is allowed only for a confidently pure social acknowledgement such as a
brief thank-you/acknowledgement with:
- no factual or operational request;
- no unresolved contentful constraint;
- no pending clarification that requires a customer value.

For `NON_ACTIONABLE_ACK`:
- emit no public AI message;
- do not hand off;
- do not call Chatwoot resolve;
- terminalize the current work as no-public-action;
- close the logical BabyPark episode.

A social prefix does not suppress actionable content. For example,
"Спасибо, а сколько стоит доставка?" remains an ordinary actionable request.

If BabyPark already emitted its one CLARIFY prompt, a reply such as "ок" or
"спасибо" that does not select an offered candidate or validly fill the
requested slot does not resolve the clarification. The frozen outcome remains:
`HUMAN / CLARIFY_EXHAUSTED`.

If a message is not confidently a pure acknowledgement, do not classify it as
`NON_ACTIONABLE_ACK`; continue ordinary extraction/latch/decision processing.

Automatic Chatwoot pending-conversation cleanup/resolve is not part of Slice C
v1. No causal "which message reopened the conversation" detector is required by
the v1 critical path.

## 29.3 C1 persisted episode state (historical pre-production evidence)

C1 uses a separate `episode.sqlite`. It is not a table in `copilot.sqlite`.

`copilot.sqlite` remains webhook delivery/job execution and idempotency state.
`episode.sqlite` is restart-durable logical conversation state needed across
dependent customer turns.

C1 persists only:
- one active episode per `conversation_id`;
- ordered `source_message_ids`;
- a non-cascading per-conversation `max_message_id` watermark that prevents an
  already-consumed or older Chatwoot message from starting a fresh episode after
  the prior episode closed or was cleaned up;
- allowlisted canonical stable slots/customer selections;
- presented canonical candidate values, hard-bounded to at most 20 per clarification;
- one requested missing slot;
- `clarification_prompts_sent` constrained to 0 or 1;
- lifecycle timestamps/reason;
- an optimistic episode version for stale-writer rejection; every mutation requires an explicit positive `expectedVersion`.

Canonical identity-shaped slots are domain-tagged and exact-form only:
- `product_id`: `prod_<lowercase UUID shape>`;
- `variant_id`: `var_<lowercase UUID shape>`;
- `store_id`: `store_<lowercase UUID shape>`;
- `brand_id`: `brand_<32 lowercase hex>`;
- `category_id`: `cat_<32 lowercase hex>`.

C1 shape validation prevents provider-native IDs, cross-domain IDs and free-form
text from entering durable identity slots. It is not a substitute for current
authority validation: C2 and later decision paths must still resolve/revalidate
that an ID exists and is authoritative before using it.

`conversation_id` and every `source_message_id` are canonical internal integers:
C1 accepts only positive JavaScript safe integers and performs no `Number(...)`
coercion from booleans, arrays, hexadecimal/exponent strings or whitespace-padded
text.

Public episode reads (`loadActive` and `getEpisode`) MUST return one committed
SQLite snapshot. The episode head row, ordered source messages, stable slots and
presented candidates MUST NOT be assembled from different commits. C1 therefore
wraps each public multi-query read in one deferred read transaction; private
`#readEpisode` remains transaction-neutral so write transactions can reuse it
without nested `BEGIN`.

Every EpisodeStore connection MUST explicitly set SQLite `busy_timeout=5000`.
C1 MUST NOT rely on the Node `DatabaseSync` constructor's version-dependent
`timeout` option: a concurrent writer that has already acquired a RESERVED lock
must wait for the reader snapshot to release before COMMIT rather than fail
immediately with `SQLITE_BUSY` on runtimes where that constructor option is not
implemented.

C1 never persists:
- raw/normalized customer message bodies;
- current/dynamic price facts or offer completeness; user-supplied normalized
  money constraints (`min_price_minor`, `max_price_minor`, `currency`) are stable
  episode constraints and are allowed;
- commercial availability;
- stock quantity;
- catalog freshness / need flags;
- resolved OperationalFact/CommercePolicy effects;
- operational `now` evaluation;
- Chatwoot reopen/status-causality markers;
- resolver/vocabulary revision state such as `category_match_mode`;
- candidate presentation labels or free-form summaries.

Source message bodies required by later Slice C processing are reread from
Chatwoot by `source_message_ids` and handled transiently. They are not copied
into `episode.sqlite`.

Closed episodes are immutable. Starting a later episode for the same Chatwoot
conversation creates fresh state and never revives clarification budget,
candidate state or stable slots from the closed episode. It also requires a
strictly newer source message than the retained conversation watermark. Closed
episode TTL cleanup MUST NOT cascade-delete or reset that watermark.

The storage-policy class is rebuildable/fail-closed rather than business
authority: loss of episode state may reduce continuity but must never permit the
system to guess prior customer selections. If safe reconstruction from current
Chatwoot history is unavailable, later routing fails closed.

## 29.4 v0.7 pre-production storage supersession

C1 schema v1 remains accepted evidence for its isolated slice, but it was never
activated as the production First Line runtime. v0.7 therefore makes a clean
pre-production schema-v2 cut rather than preserving accidental compatibility.

The v0.7 runtime target promotes `episode.sqlite` from rebuildable episode-only
state to BabyPark's durable semantic conversation database. It contains:

- provider-neutral conversation streams;
- an append-only metadata-only Conversation Event Ledger;
- a monotonic `stream_revision`;
- logical episode/open-turn projections;
- canonical semantic state with provenance;
- clarification reservations;
- durable public-action/outbox state.

For the **v0.7 runtime target**, CATEGORY stable identity is the exact pair
`(category_id,category_match_mode)`, where `category_match_mode` is exactly
`NODE_ONLY | INCLUDE_DESCENDANTS`. A proven category selection must commit both
components atomically with the same accepted-event provenance, and restart
rebuild must re-prove the same pair before category-scoped authority is used.

This pair requirement was originally frozen by the docs-only PR #100 contract
amendment before the prerequisite implementation existed. The prerequisite
C2/state-store retrofit was subsequently implemented and verified as part of the
merged C4 production campaign, PR #107 on canonical main
`565f8eb30bf39afa80bb4d59258cc2fd13aa67d5`. Current C4 may therefore rely on
the exact pair under the merged v0.7 contract. The historical C1 contract in
§29.3 remains unchanged evidence and is not retroactively rewritten.

`copilot.sqlite` remains disposable delivery/job/lease/reconciler execution
state. Domain truth MUST be committed in `episode.sqlite` before the originating
copilot job may be terminalized. Cross-file atomicity is not required: retry
after a crash is idempotent by stable source/action keys.

Routine raw or normalized customer message bodies, content-derived hashes,
customer email/phone/avatar and attachment URLs remain forbidden durable state.

## 29.5 Conversation Event Ledger

Each provider conversation maps to one BabyPark conversation stream. The parent
identity is the conversation/stream, not the customer/contact: one customer may
have multiple simultaneous conversations or channels.

Every accepted source event receives an immutable local integer `event_seq`.
This sequence means only:

> the order in which BabyPark authoritatively accepted events into its stream.

It is NOT Chatwoot message-ID order and does not claim source commit order.
A legal stream may therefore contain:

- event_seq 1 -> source_message_id 98;
- event_seq 2 -> source_message_id 101;
- event_seq 3 -> source_message_id 100.

The stable source identity is unique by
`(source_provider, source_conversation_id, source_message_id)`.
That unique ledger lookup is the ONLY `ALREADY_KNOWN` test. A source
message ID at or below any scan cursor/high-water hint MUST still be exact-read
and ingested if its unique source key is absent.

Any source scan cursor is an optimization hint only. It is never completeness,
chronology or replay authority. Every newly accepted relevant event increments
`stream_revision`.

Conversation topology, open-turn membership and response coverage are derived
from local accepted `event_seq` plus confirmed BabyPark actions, never by
numeric comparison of Chatwoot source-message IDs.

Event rows persist only bounded metadata required for topology and recovery.
Customer text remains in Chatwoot and is exact-reread transiently when semantic
processing needs it.

## 29.6 Chatwoot row authority and default-deny classification

Exact source-message lookup used to distinguish absent/private/activity rows MUST
be unfiltered where needed. A deleted row is an existing source row; its explicit
ID may enter the ledger, but its replacement/deleted text MUST NOT enter the
extractor.

For Website First Line v1, public/non-activity topology is classified
default-deny. Known categories include:

- public incoming Contact -> customer event;
- public outgoing from the configured BabyPark AgentBot -> candidate BabyPark
  response event, subject to BabyPark action provenance;
- known neutral website template/system rows -> non-customer topology metadata;
- public human, other-bot, sender-null automation or unknown public row ->
  continuity/ownership blocker, never silently ignored.

Chatwoot webhook delivery is a trigger/repair channel, not ordering authority and
not an absolute completeness guarantee. Every webhook target is exact-checked
regardless of scan cursor. Bounded reconciliation/backfill may discover and append
a lower source message ID after a higher one has already been accepted.

## 29.7 Authorizing snapshot before public side effects

A multi-query partition walk may ingest/backfill, but it MUST NOT authorize a
customer-visible AI side effect because its queries do not share one PostgreSQL
snapshot.

Immediately before every public AI side effect, the PublicActionRelay performs
one Chatwoot messages query for the whole conversation with:

- `after=0`;
- `before=2147483648`;
- `filter_internal_messages=true`.

On verified Chatwoot v4.18.0 this is one messages-between SQL statement scoped to
the conversation, with `id >= 0`, no upper predicate and `LIMIT 1000`.

If the result count is less than 1000, it is the complete public/non-activity
conversation topology visible to that statement snapshot. The gate MUST:

1. default-deny classify every row;
2. idempotently ingest all unseen source keys;
3. increment `stream_revision` for newly accepted relevant events;
4. prove every source message covered by the action is still present and not
   deleted;
5. revalidate current ownership/action prerequisites;
6. compare the action's prepared revision with current `stream_revision`.

Any mismatch makes the action stale and forbids POST.

A result count of exactly 1000 is `HISTORY_UNPROVABLE`: it may be exact or
truncated, so no AI public POST is authorized. Recursive scans may assist
non-authorizing ingestion only.

Transport/HTTP authority failure is `AUTHORITY_UNAVAILABLE` and is retryable
within the existing bounded fail-open policy.

A source transaction that commits after this authorizing SELECT but before the
external POST is the accepted residual cross-system race. Strict elimination
would require a conditional/CAS send primitive inside Chatwoot; CDC/WAL does not
remove that final send race and is not required for Website First Line v1.

The whole-conversation snapshot authorizes **conversation topology only**. It is
not authority for price, stock, policy, hours or the text of a prepared reply.
After that snapshot passes and before `SENDING`, the relay performs **semantic
reauthorization** for the still-current action:
1. exact-reread the action's covered customer source messages transiently from
   Chatwoot; raw bodies remain non-durable;
2. rebuild the current C2 resolution/C3 proof/request-family state from those
   reads and the current episode's stable identifiers/selections;
3. build a new genuine DecisionBasis and rerun C4, which rereads current
   Catalog/Knowledge authority and current operational `now`;
4. if any stable slot used by this decision came from a native structured
   clarification submission, exact-read the confirmed CLARIFY message again and
   re-run the structured-submission proof against the same confirmed action,
   ordinal/reservation and committed stable value; a changed/missing/multiple/
   unknown `submitted_values` is a semantic mismatch and permits zero POSTs;
5. compare the fresh decision's semantic descriptor with the durable prepared
   descriptor;
6. render only from the **fresh** C4 render payload;
7. only then enter the atomic `GATING -> SENDING` transition and POST.

This reauthorization occurs inside the already accepted final-snapshot-to-POST
cross-system race; it does not claim a cross-system transaction. A failure or
semantic mismatch never falls back to the previously prepared facts.

No new durable selection-provenance column is required in v1. A structured
selection's durable slot has `derived_through_event_seq` equal to the confirmed
CLARIFY ledger event that supplied the submission, while an exact-message
selection is derived through its later incoming customer event. Together with
the episode's unique CONFIRMED CLARIFY action, this deterministically identifies
when the final gate must re-read `submitted_values`. The final gate never trusts
the already committed stable value alone when the provider-native source can be
mutated without creating a new ledger event/stream revision.

## 29.8 Durable public-action outbox

Public customer actions are durable domain state in `episode.sqlite`, owned by
an independent PublicActionRelay rather than by the originating copilot input
job.

At most one live public action may exist per conversation stream. Storage MUST
enforce this for PREPARED/GATING/SENDING/UNCERTAIN-like states with a partial
unique index or an equivalent stronger constraint.

Planning is also permanently idempotent for one stream revision:
`(stream_id, prepared_stream_revision)` is unique across terminal and
non-terminal actions. Retrying the same revision reuses the existing action and
cannot reserve clarification budget or send twice.

A prepared action carries at least:

- stable action ID;
- stream ID;
- episode/basis identity;
- prepared `stream_revision`;
- action class;
- prepared semantic descriptor: machine `reason`, `template_id` and
  `response_locale` (`uk|ru`);
- source-event coverage needed by the stale-action gate;
- requested slot/canonical candidate reservation when CLARIFY requires it;
- lifecycle/lease/deadline metadata.

The prepared semantic descriptor is durable **decision/provenance**, not cached
business truth. `render_payload`, price, stock, policy effects, operational
hours/status and customer-facing labels are never persisted in the action.
No raw customer body or content digest is required.

After semantic reauthorization, the fresh decision must match the durable action
on `decision`, `reason`, `template_id` and `response_locale`. For CLARIFY it must
also match the reserved `requested_slot` and exact ordered private canonical
candidate values. Reauthorization of the owning unsent CLARIFY uses only the
reservation attestation from §29.9; without that attestation, persisted budget
`1` applies normally. If the fresh result is HUMAN/reject, changes any descriptor
field, or changes a CLARIFY reservation, the unsent action performs **zero public
POSTs** and fails closed to native human handoff. It never mutates an existing
reservation into a different prompt.

If the descriptor remains identical, dynamic payload values are allowed to have
changed: the relay sends the fresh current value. Examples: a price range whose
numbers changed but remains PRODUCT_PRICE_RANGE, a STORE_STOCK yes/no change,
or an updated prepayment amount all render from the new authority read. A change
from PRODUCT_PRICE_RANGE to PRODUCT_PRICE_SINGLE changes reason/template and
therefore does not send under the old action.

The relay claims an action with CAS/lease semantics. The final
`GATING -> SENDING` transition MUST atomically verify, inside one
`BEGIN IMMEDIATE`, the expected action state/claim and that the prepared
revision still equals current stream revision. A parallel stale/cancel/replan
transition therefore prevents POST.

If a newer revision appears while an older action is only PREPARED/GATING, the
older unsent action may be cancelled/staled and replaced atomically. Once an
action reaches SENDING or UNCERTAIN, no new public AI action may be prepared
until the old send is reconciled or handed off.

After durable SENDING, an unknown POST result MUST NOT be blindly retried.
A matching Chatwoot `source_id=action_id` may positively confirm the send;
absence of that tag does not prove non-send. Unresolved outcome becomes
UNCERTAIN and fails open to human.

## 29.9 Clarification and semantic provenance under v0.7

A CLARIFY reservation is committed atomically with its PREPARED public action
before any public send attempt. The storage transition is itself the proof that
this action was planned at pre-reservation budget `0`: it inserts the CLARIFY
action and atomically changes the active episode to
`clarification_prompts_sent=1`, `clarification_action_id=action_id`, the exact
requested slot and the action's post-reservation episode version.

Send-time semantic reauthorization of **that same owning unsent CLARIFY** must
not feed the persisted post-reservation `1` back into ordinary C4 and thereby
exhaust its own prompt. EpisodeStore instead issues a transient, single-action
**clarification reservation attestation** only when all of these still hold:
- action type is CLARIFY and state is PREPARED or the relay's current GATING
  claim;
- action episode/version is the current active episode/version;
- episode has `clarification_prompts_sent=1`;
- `clarification_action_id == action_id`;
- episode/action requested slot and reserved canonical candidates are unchanged.

Only while rebuilding semantics for that exact action does the attestation expose
an **effective pre-reservation budget 0**. It is not a general budget override,
is not durable, cannot be supplied by callers, and is invalid for another/new
action. The fresh decision must still be semantically identical to the durable
reservation. A competing/new clarification sees ordinary persisted budget `1`
and therefore exhausts.

Before SENDING, that exact reservation may be released only as part of a safe
atomic cancellation/replacement of the unsent action. After SENDING, the budget
remains consumed even when the outcome is uncertain. False HUMAN is acceptable;
duplicate CLARIFY is not.

Semantic interpretations of a still-open unanswered customer turn are proposed
state until the corresponding customer-facing action is durably handled.
Durable semantic state carries provenance through accepted event sequence /
stream revision rather than pretending an unfinished turn was already answered.

HUMAN closes with `human_takeover` only after native Chatwoot handoff succeeds.
A pure `NON_ACTIONABLE_ACK` may close without an external public-message side
effect only after the complete open turn and no-newer gate are proven.

## 29.10 C2 implementation decomposition after v0.7 freeze

C2a — Conversation Event Ledger + Durable Action Foundation:
- EpisodeStore schema/read attestation and clean schema-v2 cut;
- conversation streams/events and `stream_revision`;
- unique source-event ingestion and late-lower-ID acceptance;
- exact Chatwoot row reader/default-deny classification;
- bounded non-authorizing backfill;
- one-statement authorizing snapshot contract;
- durable public-actions/outbox constraints and relay recovery skeleton;
- no LLM/extraction.

C2b — Structured Extraction + deterministic resolution:
- versioned extractor schema;
- turn-index exact-quote certification;
- language handling;
- exact SKU/title product identity only;
- existing category/brand/store/money resolvers;
- unsupported-marker veto;
- no public action.

C2c — Episode/open-turn routing planner:
- accepted-event projection into logical episode/open turn;
- supported dependent follow-up vs standalone replacement;
- pending clarification response handling;
- candidate selection;
- batch-aware acknowledgement;
- semantic provenance/limits;
- stale-plan token feeding the PublicActionRelay.

C3 then runs ObjectiveConstraintLatch over the reconstructed, transient text and
certified spans.

## 30. Shortlist minimum anchor

Price-only browse is forbidden.

Require at least:
- exact category;
OR
- exact brand.

Optional:
- min/max price;
- store.

Missing anchor:
CLARIFY / MISSING_SHORTLIST_ANCHOR.

The v1 clarification requests **category only** (`requested_slot=category_id`).
This is intentional: C2c already proves exact `category_id` requested-slot
follow-ups, while the generic `shortlist_anchor` union is not a supported
dependency slot and must never be emitted by C4. The original request's stable
money/store constraints remain preserved across the clarification. A future
category-or-brand union requires an explicit C2c contract change; it is not
inferred here.

## 31. Dedicated objective CatalogService contract

Do not reuse current `searchProducts()` as factual shortlist authority.

Current code can match through a non-default variant while top-level product price remains default-variant price.

Create a dedicated provider-neutral contract, conceptually:

```
searchObjectiveProducts({
  categoryId?,
  categoryMatchMode?,
  brandId?,
  minPriceMinor?,
  maxPriceMinor?,
  storeId?,
  limit
})
```

Require categoryId OR brandId.

## 32. Objective cohort

Relevant variants:
- active;
- IN_STOCK;
- satisfy exact canonical filters.

With price filter:
- matching membership and presentation derive from the same trusted-price cohort.

If relevant anchored IN_STOCK universe contains an offer hole that prevents proving complete result membership:
HUMAN / PRICE_COHORT_INCOMPLETE.

Zero price:
HUMAN / ZERO_PRICE_UNVERIFIED.

Mixed relevant currency:
HUMAN / MIXED_CURRENCY.

Do not silently remove incomplete products from total count.

## 33. Category tree semantics for objective search

NODE_ONLY:
match direct category membership only.

INCLUDE_DESCENDANTS:
expand descendants from the same pinned catalog generation.

Vocabulary revision and match mode are part of decision provenance.

This category-tree rule applies to objective search.
It does NOT define CommercePolicy exception-scope narrowing.

## 34. Store-filter objective search

With storeId:
- stock layer must be answerable;
- every anchored active IN_STOCK variant must have an explicit store_stock row
  for that exact store before the exact-store cohort is considered complete;
- quantity = 0 is a confirmed non-participating store state;
- participating variant must have quantity > 0 at that exact store.

A missing exact-store row is not interpreted as quantity = 0. It means the
store-filtered cohort cannot be proven complete and fails closed as:
HUMAN / CATALOG_STOCK_STALE.

Commercial IN_STOCK does not substitute for store stock.

Stale/blocking stock layer:
HUMAN / CATALOG_STOCK_STALE.

Store-stock freshness in v1 is layer authority. source_updated_at is retained
evidence but there is no independent row-level stale state/TTL contract.

Unknown store never falls back to general availability.

## 35. Objective result DTO

Conceptually:

```
ObjectiveProductMatch {
  product_id
  title
  image_url
  product_url

  matched_variant_count

  matching_price_min_minor
  matching_price_max_minor
  currency

  matching_variant_ids[]
  displayable_variant_labels[]
  total_matching_variant_labels
  displayable_variant_label_count

  all_available_variants_match_filters

  matched_store_id?
}
```

The `all_available_variants_match_filters` flag is evaluated only against the same
customer-purchasable availability universe used by objective search: active +
IN_STOCK variants, plus quantity > 0 at the exact canonical store when storeId
participates. EXPECTED, MADE_TO_ORDER, OUT_OF_STOCK, DISCONTINUED and confirmed
quantity = 0 exact-store variants are outside this denominator and do not turn
the flag false merely because such variants exist. A missing exact-store row
makes the denominator unprovable and fails the whole store-filtered answer closed.

Response also includes total_product_count before display limit.

## 36. Shortlist ranking

Stable deterministic ordering:
`matching_price_min_minor ASC, product_id ASC`.

Display limit: 3.

No hidden recommendation score.

## 37. Shortlist count wording

0:
ANSWER / OBJECTIVE_SHORTLIST_EMPTY.
No automatic widening.

1–3:
show all and state exact count.

>3:
state total and that only top 3 by deterministic price ordering are shown.

Never say "нашёл 3" if total is 47.

## 38. Matched-cohort presentation

Example:
- default variant 27,300;
- another IN_STOCK variant 19,300;
- filter <=20,000.

Product may match.

Card must show the matched cohort (19,300), not default 27,300 and not full 19,300–27,300 range.

Set:
`all_available_variants_match_filters=false`.

This means that only part of the active + IN_STOCK purchasable cohort matched
the objective filters. It does not describe non-purchasable lifecycle variants.

## 39. Specific-store stock semantics

"Есть эта модель в магазине X?" is not automatically answerable for a multi-variant model.

ANSWER / STORE_STOCK is allowed when:
- an exact variant was already selected; OR
- the resolved product has exactly one active IN_STOCK variant.

Then:
- store resolves exactly to an active canonical store_id;
- commercial and stock layers are answerable;
- the selected exact variant/store pair must have an explicit store_stock row;
- quantity > 0 => factual yes;
- quantity = 0 => factual no.

A missing exact variant/store row is not a confirmed zero. It fails closed as:
HUMAN / CATALOG_STOCK_STALE.

If product has multiple active IN_STOCK variants and no variant selected:
- CLARIFY / AMBIGUOUS_VARIANT only when every customer-selectable candidate has
  a safe, non-empty and unique display label;
- otherwise HUMAN / PRODUCT_VARIANT_NOT_RESOLVABLE.

If product has zero active IN_STOCK variants and no exact variant is already
selected, B4 does not invent a model-level store-stock fact:
HUMAN / PRODUCT_VARIANT_NOT_RESOLVABLE.

If clarification remains unresolved:
HUMAN / CLARIFY_EXHAUSTED.

Do not aggregate "one color exists" into "the model is in the store".

Do not expose quantity.
Do not claim "можно забрать сегодня".

## 40. Neutral presentation model

Business logic returns neutral `ProductPresentation`, not Chatwoot-specific cards.

ProductPresentation v1:

```text
ProductPresentation {
  contract = bp.catalog.product-presentation/1
  product_id
  variant_id?
  variant_label?
  title?
  product_url?
  image_url?
}
```

Rules:
- canonical product/variant IDs only inside business/Catalog logic; C5 does not
  receive those IDs in its public render payload;
- variant_label is sanitized factual text and may be null;
- product-level image is preferred;
- variant image fallback may use only the exact selected variant or the already
  proven matched cohort; never an unrelated/default variant;
- price, stock quantity and customer wording do not live inside ProductPresentation;
- exact price/stock facts remain deterministic values in the enclosing factual DTO.

### 40.1 Exact-locale public presentation

The existing Catalog presentation helper may fall back to another available
language for generic/non-public consumers. Website First Line **must not** use
that cross-locale fallback for public title/URL text.

For public shortlist presentation projection, C4 reads the already-public CatalogService
`getProduct({productId})` result and selects only
`product.localized[response_locale]`. Every such presentation read must report
`catalog.generation_id` exactly equal to the generation carried by the current
`searchObjectiveProducts()` shortlist fact. A generation mismatch, missing
product row or missing exact-locale presentation means the shortlist cannot be
safely presented and yields HUMAN / PRODUCT_PRESENTATION_NOT_AVAILABLE. C4 never
combines membership/price from one catalog generation with title/URL/image from
another. It may use language-neutral image evidence only from that same-generation
product read / already proven cohort. It must not select another localized entry
when the exact response locale is absent.

If a template requires a product title (currently shortlist presentation templates) and any
selected item lacks a non-empty safe title in the exact `response_locale`, C4
returns HUMAN / PRODUCT_PRESENTATION_NOT_AVAILABLE. It never exposes a product
ID, substitutes a RU title into a UK response (or vice versa), or asks C5 to
choose a fallback. `product_url` may be null; if present it must come from the
same exact-locale entry. Price/stock templates that do not require title/URL are
not blocked merely because localized presentation is absent.

C5 receives only the exact `C4Decision` from §16.2. WebsiteRenderer/TextRenderer:
- perform no language detection;
- perform no Catalog/Knowledge/Chatwoot read;
- perform no LLM call;
- accept only the allowlisted template for `response_locale`;
- reject unknown/extra payload fields;
- format exact critical values without semantic rewriting;
- map PAYMENT_METHODS codes only to fixed locale-specific method names. The code
  `COD_NOVA_POSHTA` never causes a percentage/fee/condition to be printed.

Every public template has an explicit `uk` and `ru` branch. Missing branch is a
renderer failure and produces zero public send; there is no default language.

Initial adapters:
- WebsiteRenderer;
- TextRenderer.

TextRenderer is a planned deterministic C5 adapter. It is not implemented or
connected to Viber/Telegram production by this pre-code C5 contract amendment.

### 40.2 C5 genuine-decision and exact output boundary

C5 is a pure presentation adapter over one **genuine** C4 public decision. A
structurally matching object, clone, deserialized copy or caller-built eight-key
object is not sufficient authority to render. C4 must own an in-process
capability/provenance check for decisions returned by its public decision
constructor, and C5 must require that check before rendering. This check exposes
no DecisionBasis/private context and does not make C5 an authority reader.

A valid HUMAN decision returns no render result (`null`). It is not a renderer
error and never produces customer content.

WebsiteRenderer returns exactly one of these frozen shapes for ANSWER/CLARIFY:

```text
WebsiteRenderText {
  schema = bp.first-line.website-render/1
  content_type = text
  content = string with 1..150000 Unicode code points
  content_attributes = {}
}

WebsiteRenderSelect {
  schema = bp.first-line.website-render/1
  content_type = input_select
  content = string with 1..150000 Unicode code points
  content_attributes = {
    items: [{title:'<ordinal>',value:'bp-choice:<ordinal>'}, ...]
  }
}
```

No additional enumerable key is allowed at either level. C5 never emits sender,
conversation/account IDs, source/action IDs, template/provider parameters or
private reservation values. C6 owns the Chatwoot POST envelope and action
identity.

The Website `content` ceiling is counted in Unicode **code points**, matching
Chatwoot/Ruby UTF-8 string-length semantics, not JavaScript UTF-16 code units.
For example U+1F600 counts as one code point even though JavaScript
`"😀".length === 2`. The implementation must use an equivalent code-point
count (for example `Array.from(content).length`) on the final transport content
after all Website escaping; unescaped/source length is not the admission test.

Renderer output is transient in-memory presentation only. C5 owns no durable
store/cache/outbox and MUST NOT persist or routinely log rendered content,
dynamic labels, product URLs, choice labels/tokens, or a content-derived digest.
The only durable pre-send state remains the C6/§29.8 machine descriptor and
provenance; Chatwoot remains transcript authority for the eventual public
message.

WebsiteRenderer mapping is exact:
- every ANSWER uses `content_type=text`, including shortlist answers;
- candidate-based CLARIFY uses `input_select`. Its `content` is the fixed
  locale prompt followed by one U+000A LF and the exact ordered rows
  `1. <label>`, `2. <label>`, ... with Website-only Markdown encoding applied
  only to each dynamic label and no trailing LF. `content_attributes.items`
  has the same cardinality/order; each item is exactly
  `{title:String(ordinal),value:choice.token}` where ordinal starts at 1.
  Dynamic factual labels never enter `items[*].title`;
- `TPL_CLARIFY_MONEY_V1` and `TPL_CLARIFY_SHORTLIST_ANCHOR_V1` use `text` with
  `content_attributes={}`;
- C5 v1 does **not** emit Chatwoot `cards`. Shortlist `image_url` is not
  rendered or fetched; this avoids making C5 a network/media adapter. A non-null
  safe `product_url` remains part of the semantic row. TextRenderer copies that
  canonical URL literally. WebsiteRenderer emits it as **non-clickable plain
  text** using the same reversible Markdown-neutral encoding as other dynamic
  factual text; C5 v1 never lets Chatwoot/linkify choose a dynamic URL boundary
  or hyperlink target.

TextRenderer returns exactly
`{schema:'bp.first-line.text-render/1',content:string}` for ANSWER/CLARIFY and
`null` for HUMAN. It has no transport metadata and remains unconnected to
Viber/Telegram in C5. Its `content` is the exact semantic §40.4 branch before
Website-only Markdown transport encoding and has no trailing newline. For finite
CLARIFY the exact bytes are `<prompt>\n1. <label>\n2. <label>...`, with one
U+000A LF before each ordinal row and no `bp-choice` token/private candidate
value. ANSWER multiline/list content uses the same §40.4 line breaks and no
trailing LF.

Genuine C4 provenance never waives public-contract validation. Before rendering,
C5 revalidates the complete exact §16.2 public relation among `decision`,
`reason`, `response_locale`, `template_id`, `render_payload`,
`requested_slot` and `choices`, including the frozen
`reason -> allowed template_id` relation. Private request-family identity is
not a C5 input and is not reconstructed by the renderer. A genuine object with
an impossible public reason/template pair is still invalid.

Unknown/forged decision, unsupported locale/template/reason tuple, invalid
payload/choice shape, missing locale branch, unsupported currency, unsafe
dynamic text, final Website content outside 1..150000 Unicode code points or
other invalid output is one fail-closed renderer failure family:
`FIRST_LINE_RENDERER_INVALID`. It produces no fallback text and is never
permission for C6 to use a previously prepared render.

### 40.3 Exact C5 formatting and Chatwoot transport neutrality

C5 performs no language detection and never calls `Intl` with an unchecked
locale. The only public locales are the already-certified exact tags `uk` and
`ru`.

Website First Line v1 public monetary rendering is deliberately UAH-only.
Although the C4 schema carries a safe three-letter currency code, C5 renders a
money-bearing template only when the current payload currency is exactly `UAH`.
Any other currency is `FIRST_LINE_RENDERER_INVALID` / zero public send until a
separately reviewed public formatting contract is frozen.

UAH formatting is exact and contains no locale/runtime dependency:
- divide the non-negative integer minor value by 100;
- group the integer major part from the right in threes with one ASCII space;
- omit `,00`; otherwise render comma plus exactly two minor digits;
- append exactly one ASCII space plus `грн`.
Examples: `2730000 -> "27 300 грн"`, `2730050 -> "27 300,50 грн"`,
`50 -> "0,50 грн"`.

Other critical formatting is exact:
- E.164 phone and `HH:MM` are copied byte-for-byte;
- one schedule interval is `HH:MM–HH:MM` using U+2013 EN DASH;
- intervals and ordinary label/method lists join with `, `;
- integer counters are unsigned ASCII decimal with no grouping;
- TextRenderer copies a non-null canonical product URL byte-for-byte. For
  WebsiteRenderer, the canonical URL is first subject to the same literal Liquid
  opening-delimiter gate as every other dynamic Website string and is then
  reversibly Markdown-neutral encoded as plain text. C5 performs no
  redirect/fetch and emits no dynamic Website hyperlink.

Chatwoot v4.18.0 renders ordinary Web Widget message `content` through
`markdown-it` with `linkify=true`. C5 therefore owns an exact Website-only
Markdown-neutral encoding for **dynamic free-form factual text inserted into
`content`** (shortlist titles, variant/stock labels and canonical product
URLs): after the Liquid check below, prefix one ASCII backslash before every
ASCII punctuation code point in `U+0021..U+002F`, `U+003A..U+0040`,
`U+005B..U+0060` or `U+007B..U+007E`. Unicode
letters/digits/whitespace are unchanged. The encoded bytes are transport
content; Chatwoot Markdown rendering must display the original normalized
factual text and must not create a link/image/emphasis from it. Fixed template
text and generated money/time/counters/payment names do not use this encoding.
Website First Line v1 intentionally emits **zero dynamic hyperlinks**; an
already-C4-validated `product_url` is shown as exact visible plain text instead
of relying on Chatwoot bare-link/autolink boundary rules.

For finite Website CLARIFY, dynamic choice labels are rendered only inside
the numbered `content` list and therefore use the same reversible
Markdown-neutral encoding as other Website free-form factual text. Native
`input_select.items[*].title` contains only the generated unsigned ASCII
ordinal (`"1"`, `"2"`, ...). Chatwoot later echoes that ordinal through
Markdown after selection, so no Catalog/Knowledge label is reinterpreted there.
The public labels remain pairwise-distinguishable in the visible numbered list;
the ordinal button references an already-distinguishable row and is never used
to hide duplicate labels.

Payment method names are a closed table and carry no fee/condition:
- `BANK_TRANSFER`: uk `банківський переказ`; ru `банковский перевод`;
- `CASH_COURIER`: uk `готівкою кур'єру`; ru `наличными курьеру`;
- `COD_NOVA_POSHTA`: uk `післяплата у Новій пошті`; ru
  `наложенный платеж в Новой почте`.

Chatwoot v4.18.0 evaluates Liquid for outgoing message `content` during message
creation. WebsiteRenderer must not escape this with
`{% raw %}...{% endraw %}`. Before any Website Markdown encoding/interpolation,
every dynamic public string that WebsiteRenderer may place into `content` fails
closed if it contains ASCII `{{` or `{%`. For `product_url`, this check is
against the **canonical §16.3 C4 projection received by C5**: a canonical URL
that still contains a literal opening delimiter rejects, while a percent-encoded
sequence such as `%7B%7B` contains no Liquid delimiter and remains inert
Markdown-neutral plain text. After rendering, final `content` is checked again
for literal opening delimiters; every select item title is independently required
to equal its unsigned ASCII ordinal exactly. WebsiteRenderer then checks final
`content` length after all transport encoding: 1..150000 Unicode code points,
matching the verified Chatwoot v4.18.0 Message content ceiling. Length failure is
`FIRST_LINE_RENDERER_INVALID`, never a send/retry hint. Fixed branches are
regression-tested to contain neither Liquid opening delimiter. A dynamic value
that still contains a literal Liquid opening delimiter at the C5 boundary
therefore yields `FIRST_LINE_RENDERER_INVALID`; C5/C6 do not let Chatwoot
reinterpret it against contact/agent/conversation/inbox/account drops. This is an
additional presentation safety gate and never weakens §16.3.

The WebsiteRenderer transport contract above is bound to the verified deployed
Chatwoot v4.18.0 behavior recorded by this amendment. Before first production
activation, and after any Chatwoot package/version/source change that can affect
message creation, Liquid processing, Markdown formatting, `input_select`
render/submission or message content limits, the bounded deployment stage must
revalidate those exact native surfaces against the target deployed runtime.
A version/source mismatch, unavailable proof or changed behavior blocks
WebsiteRenderer activation/send; it never falls back to assumptions from v4.18.0
and never requires a Chatwoot core patch.

### 40.4 Exact uk/ru C5 wording

Braced names below denote deterministic §40.3 substitutions; they are not a
runtime template language and literal braces do not appear in emitted content.

ANSWER branches:

| template_id | uk | ru |
|---|---|---|
| `TPL_STORE_OPEN_STATUS_V1` | open+close `Магазин зараз відкритий до {time}.`; open+null `Магазин зараз відкритий.`; closed `Магазин зараз зачинений.` | open+close `Магазин сейчас открыт до {time}.`; open+null `Магазин сейчас открыт.`; closed `Магазин сейчас закрыт.` |
| `TPL_STORE_HOURS_TODAY_V1` | empty `Сьогодні магазин зачинений.`; otherwise `Графік на сьогодні: {intervals}. Зараз магазин {відкритий|зачинений}.` | empty `Сегодня магазин закрыт.`; otherwise `График на сегодня: {intervals}. Сейчас магазин {открыт|закрыт}.` |
| `TPL_STORE_PHONE_V1` | `Телефон магазину: {e164}.` | `Телефон магазина: {e164}.` |
| `TPL_CALL_CENTER_PHONE_V1` | `Телефон контакт-центру: {e164}.` | `Телефон контакт-центра: {e164}.` |
| `TPL_PAYMENT_METHODS_V1` | `Способи оплати: {methods}.` | `Способы оплаты: {methods}.` |
| `TPL_PREPAYMENT_V1` | `Передоплата: {money}.` | `Предоплата: {money}.` |
| `TPL_RETURN_PERIOD_V1` | `Період повернення товару належної якості (календарні дні): {days}. День покупки {не враховується|враховується}.` | `Срок возврата товара надлежащего качества (календарные дни): {days}. День покупки {не учитывается|учитывается}.` |
| `TPL_PRODUCT_PRICE_SINGLE_V1` | `Ціна: {money}.` | `Цена: {money}.` |
| `TPL_PRODUCT_PRICE_RANGE_V1` | `Ціна залежить від варіанта: від {min_money} до {max_money}.` | `Цена зависит от варианта: от {min_money} до {max_money}.` |
| `TPL_PRODUCT_NOT_IN_STOCK_V1` | `Зараз товару немає в наявності.` | `Сейчас товара нет в наличии.` |
| `TPL_VARIANT_LIST_V1` | `Доступні варіанти ({named}/{total}): {labels}.` | `Доступные варианты ({named}/{total}): {labels}.` |
| `TPL_VARIANT_LIST_PARTIAL_V1` | named>0: `Варіанти з доступними назвами ({named}/{total}): {labels}.`; named=0: `Кількість доступних варіантів: {total}. Назви недоступні.` | named>0: `Варианты с доступными названиями ({named}/{total}): {labels}.`; named=0: `Количество доступных вариантов: {total}. Названия недоступны.` |
| `TPL_VARIANT_PRICE_LIST_V1` | first line `Ціни варіантів:`, then `• {label} — {money}` per row | first line `Цены вариантов:`, then `• {label} — {money}` per row |
| `TPL_SHORTLIST_TOP3_V1` | `Кількість знайдених товарів: {total}. Перші результати:` then shortlist rows | `Количество найденных товаров: {total}. Первые результаты:` then shortlist rows |
| `TPL_SHORTLIST_ALL_V1` | `Знайдені товари:` then shortlist rows | `Найденные товары:` then shortlist rows |
| `TPL_SHORTLIST_EMPTY_V1` | `За заданими умовами товарів не знайдено.` | `По заданным условиям товары не найдены.` |
| `TPL_STORE_STOCK_V1` | no label: `Є в наявності в цьому магазині.` / `Немає в наявності в цьому магазині.`; with label: `Варіант «{label}» є в наявності в цьому магазині.` / `Варіанта «{label}» немає в наявності в цьому магазині.` | no label: `Есть в наличии в этом магазине.` / `Нет в наличии в этом магазине.`; with label: `Вариант «{label}» есть в наличии в этом магазине.` / `Варианта «{label}» нет в наличии в этом магазине.` |

Shortlist row `i` is exact:
- price is one UAH amount when min=max, otherwise `{min_money}–{max_money}`;
- base row is `{i}. {title} — {price}` in both locales;
- append ` (часткова відповідність моделі)` /
  ` (частичное соответствие модели)` when `partial_model_match=true`;
- if `product_url` is non-null, the semantic/TextRenderer row appends newline
  then that canonical URL; WebsiteRenderer appends newline then the exact
  Markdown-neutral encoding of that URL, so Chatwoot displays the canonical URL
  as non-clickable plain text;
- rows are separated by one newline;
- `image_url` is ignored by C5 v1 and never fetched.

CLARIFY prompt branches:

| template_id | uk | ru |
|---|---|---|
| `TPL_CLARIFY_PRODUCT_V1` | `Уточніть, будь ласка, який товар ви маєте на увазі.` | `Уточните, пожалуйста, какой товар вы имеете в виду.` |
| `TPL_CLARIFY_VARIANT_V1` | `Уточніть, будь ласка, який варіант ви маєте на увазі.` | `Уточните, пожалуйста, какой вариант вы имеете в виду.` |
| `TPL_CLARIFY_CATEGORY_V1` | `Уточніть, будь ласка, яку категорію ви маєте на увазі.` | `Уточните, пожалуйста, какую категорию вы имеете в виду.` |
| `TPL_CLARIFY_BRAND_V1` | `Уточніть, будь ласка, який бренд ви маєте на увазі.` | `Уточните, пожалуйста, какой бренд вы имеете в виду.` |
| `TPL_CLARIFY_STORE_V1` | `Уточніть, будь ласка, який магазин ви маєте на увазі.` | `Уточните, пожалуйста, какой магазин вы имеете в виду.` |
| `TPL_CLARIFY_MONEY_V1` | `Уточніть, будь ласка, максимальну суму в гривнях.` | `Уточните, пожалуйста, максимальную сумму в гривнах.` |
| `TPL_CLARIFY_SHORTLIST_ANCHOR_V1` | `Уточніть, будь ласка, категорію товару.` | `Уточните, пожалуйста, категорию товара.` |

For `TPL_STORE_HOURS_TODAY_V1`, `open_now=true` with empty intervals is invalid.
For `TPL_STORE_OPEN_STATUS_V1`, closed requires `closes_at_local=null`.
`TPL_PRODUCT_PRICE_RANGE_V1` requires `min_current_minor < max_current_minor`;
an equal pair belongs only to `TPL_PRODUCT_PRICE_SINGLE_V1`.
`TPL_VARIANT_LIST_V1` requires `total_variant_count=named_variant_count>0`.
`TPL_VARIANT_LIST_PARTIAL_V1` requires
`total_variant_count>named_variant_count>=0`; the named=0 branch above emits no
empty punctuation/list placeholder.
TOP3/ALL require at least one product; zero uses only `TPL_SHORTLIST_EMPTY_V1`.

## 41. Critical-value rendering

LLM does not rewrite:
- prices;
- stock;
- opening hours;
- phones;
- policy money/dates;
- factual product lists.

LLM may participate in intent/raw-span extraction.
Authority comes from deterministic tools/resolvers.

## 42. Mixed supported + unsupported customer turn

v1 does not partially answer a mixed turn.

Example:
"Сколько стоит и совместима ли с адаптером X?"

=> HUMAN / COMPATIBILITY_NOT_AUTHORITATIVE.

No partial public price before handoff.

## 43. Handoff v1

Existing AgentBot safety foundation remains authoritative.

Current reconciler rejects any later public outgoing/template after target message.

Therefore v1 HUMAN path creates NO public AI handoff preface.

Flow:
1. no public AI handoff message;
2. native pending -> open;
3. after successful open: absolute public AI silence.

If handoff fails:
- work stays non-terminal/retryable;
- reconciler remains fail-open path;
- no false claim to customer.

Public handoff preface is deferred until a separately designed durable exactly-once message-action protocol exists.

Chatwoot message `source_id` is indexed but not unique and is not enough for that protocol.

## 44. Private handoff note — Slice D only

Private note is a separate capability.

Expose only:
`createHandoffNote(note)`.

There is no `private` argument.

Wire payload hardcodes:
`private: true`.

Note is best-effort at-most-once:
- durable job records note attempt before network call;
- ambiguous/failing result is not retried;
- note failure does not block handoff.

Deterministic content only:
- intent;
- already answered fact codes;
- unresolved reason;
- product_id;
- decision_context_id;
- used revision IDs;
- catalog generation;
- confirmed_context facts that were independently reread and remain safe despite
  the unresolved HUMAN reason.

For HUMAN / CATALOG_STOCK_STALE, the private note must preserve all useful facts
that are independently authoritative without claiming exact-store availability.
For an already resolved exact product/variant this may include:
- current general commercial availability;
- current B1 price fact;
- current reviewed delivery CommercePolicy, when one independently applies.

These facts must be reread from their own current authority. A failed
store-filtered B3 shortlist is not itself a confirmed partial shortlist: unknown
exact-store membership must never be converted into a seller-visible claim that
a particular product/variant is in that store.

confirmed_context is seller-only context, never a public handoff preface.

No LLM conversation summary.

## 45. Decision context

Every AI decision receives `decision_context_id`.

Canonical input includes only authority that affected the decision:
- knowledge_resolver_contract_version;
- intent_schema_version;
- tool_contract_version;
- template_id;
- template_version;
- response_locale for public ANSWER/CLARIFY;
- used operational revision IDs;
- used commerce revision IDs;
- used vocabulary revision IDs;
- catalog_generation_id;
- used catalog layers + freshness;
- need_reconcile / need_full;
- normalized tool arguments;
- resolver outcome/reason;
- model_id only if model participated.

Canonicalization:
- IDs sorted and unique;
- object keys stable;
- money integer minor units;
- enum values canonical strings.

Excluded:
- raw customer body;
- final message text;
- current timestamp;
- unrelated knowledge state.

source_message_ids[] live in trace metadata, not fingerprint.

## 46. Trace metadata

Redacted metadata only:
- conversation_id;
- message_id/source_message_ids;
- decision_context_id;
- intent;
- decision/reason;
- template;
- tool/resolver versions;
- catalog generation;
- used revision IDs;
- model ID if used;
- tool calls;
- latency;
- handoff result.

No routine raw customer message storage.

## 47. Resolver versioning

Introduce:
`KNOWLEDGE_RESOLVER_CONTRACT_VERSION`.

Golden decision vectors enforce semantic version discipline.

If canonical observable result changes:
- ANSWER/CLARIFY/HUMAN;
- reason;
- resolved canonical effect;

CI requires version bump.

Pure refactor with identical behavior does not.

## 48. Metrics

Initial:
- containment_rate;
- human_correction_rate;
- post_answer_human_request_rate.

human_correction_rate uses explicit employee action:
"AI відповів неправильно"
linked to decision_context_id.

Do not infer correction from next seller message.

Chatwoot First Response Time is used for human-response latency.
No arbitrary 10-second threshold.

## 49. Explicit v1 non-goals

No:
- broad site RAG;
- description-to-fact extraction;
- compatibility reasoning;
- age suitability;
- subjective recommendation;
- margin/popularity ranker;
- order/1C customer lookups;
- individual return eligibility;
- Telegram/Viber customer AI;
- voice/Asterisk AI;
- automatic bot re-entry after handoff;
- raw option -> COLOR/SIZE inference;
- public handoff preface;
- sale/promotion interpretation;
- general multi-variant "stock anywhere" aggregation.

## 50. Slice decomposition

### Slice A — Knowledge Authority
- additive canonical physical-store identity in IdentityStore;
- reviewed bootstrap of current BabyPark physical stores;
- proof that Catalog store IDs resolve through canonical `store_id`;
- deployment gate forbidding provider-native store IDs as Knowledge subjects;
- knowledge.sqlite;
- canonical hashing;
- immutable revisions;
- validated event state machine;
- OperationalFact/CommercePolicy/Vocabulary;
- overlay composition/expiry;
- strict exception scope;
- approval/self-approval;
- explicit supersession;
- resolver/versioning;
- RBAC;
- direct ai.babypark.ua UI;
- Cloudflare Tunnel/Access boundary;
- durable backup/off-host/restore proof.

No Chatwoot message creation.

Dashboard embedding is tested but direct UI works independently.

### Slice B — Catalog factual/query contracts
- product price summary;
- zero-price handling;
- variant-now list;
- variant-price list;
- deterministic category/brand/money/store resolvers;
- category match mode;
- ObjectiveConstraintLatch prerequisites/data contract;
- dedicated matched-cohort objective search;
- store-aware query semantics;
- neutral ProductPresentation.

No customer messages.

### Slice C — Website First Line
- C1 merged evidence: restart-durable ID/canonical-selection episode state;
- v0.7 pre-production schema-v2 cut promotes `episode.sqlite` to durable semantic state;
- C2a Conversation Event Ledger + `stream_revision` + durable public-action outbox;
- local accepted `event_seq` is BabyPark ordering; Chatwoot message ID is source identity only;
- one-statement whole-conversation authorizing snapshot before any public AI side effect;
- one live public action per stream and permanent same-revision action idempotency;
- logical episode/open customer turn independent of Chatwoot status;
- internal `NON_ACTIONABLE_ACK` no-action disposition; no Chatwoot resolve;
- C2b structured extraction and deterministic resolution;
- C2c episode/open-turn routing and semantic provenance;
- ObjectiveConstraintLatch;
- ANSWER/CLARIFY/HUMAN;
- deterministic templates;
- planned WebsiteRenderer;
- planned TextRenderer;
- public messages only for ANSWER/CLARIFY;
- HUMAN sends no AI preface;
- native handoff;
- decision trace.

### Slice D — Private Handoff Note
- createHandoffNote();
- hardcoded private:true;
- at-most-once attempt;
- deterministic body;
- confirmed_context enrichment for independently authoritative facts on HUMAN,
  including CATALOG_STOCK_STALE without inventing exact-store availability;
- separate message-create certification.

### Slice E — Seller Assist (deferred)
- starts only after native HUMAN handoff / operator ownership;
- autonomous AI remains forbidden from sending public customer messages;
- reuses the same BabyPark Knowledge/Catalog/Policy engine rather than creating
  a second AI brain;
- may answer operator questions, propose one or more grounded reply drafts, and
  rewrite/fix/translate operator text;
- operator explicitly chooses, edits or ignores a suggestion before sending;
- Chatwoot Dashboard App or equivalent operator UI is presentation only; factual
  authority remains BabyPark services;
- not part of current Slice A implementation.

Future BabyPark AI HUB direction is tracked separately in
`docs/AI_HUB_DIRECTION.md`. It is an observability/control plane over existing
BabyPark authorities, not a new source of truth, and is not part of Slice B.

## 51. Review status

v0.3 blocker review found:
- dynamic Catalog/Operational authority could be ambiguously cached across clarification turns;
- open-ended baselines were not fully covered by the activity predicate;
- early-closing `store.special_hours` could fall back to weekly baseline later
  the same civil day.

v0.4 incorporated those fixes, but blocker review then found:
- the civil-day invariant for `store.special_hours` existed in resolver
  semantics but was not enforced at publication;
- clarification-count wording was inconsistent;
- Drupal → Magento required an explicit provider-neutral physical-store identity
  and field-level source-of-truth contract.

v0.5 resolves those blockers by:
1. enforcing exactly one Europe/Kyiv civil-day revision envelope for
   `store.special_hours`;
2. keeping `store.temporary_closure` / `store.status_override` as arbitrary
   finite state overlays;
3. defining prompt-based `clarification_prompts_sent` with at most one CLARIFY
   prompt per episode;
4. introducing canonical BabyPark `store_id` + reviewed provider xrefs and a
   fail-closed Magento cutover preflight;
5. freezing the field-level authority split between Knowledge, CatalogService
   and Chatwoot support-hours configuration.

v0.6 closes the pre-Slice-C lifecycle seams found during implementation review:
1. separates Chatwoot conversation status from BabyPark logical episode identity;
2. defines dependent follow-up versus standalone-new-query boundaries;
3. introduces internal `NON_ACTIONABLE_ACK` without adding a fourth decision class;
4. explicitly forbids v1 automatic Chatwoot resolve for acknowledgement/hygiene;
5. freezes C1 `episode.sqlite` as ID/canonical-selection-only state with no raw
   message body or dynamic authority persistence;
6. requires optimistic stale-writer rejection and one active episode per
   conversation.

v0.7 freezes the Conversation Event Ledger / durable action-outbox foundation
after adversarial review of webhook ordering, PostgreSQL sequence/MVCC visibility,
rapid customer bursts, automation rows, long-history bootstrap, clarification
crashes and cross-SQLite recovery.

Key closure invariants are:
1. BabyPark accepted `event_seq`, not Chatwoot source ID, is durable event order;
2. unique source-event existence, never a high-water comparison, is replay/dedupe truth;
3. a single whole-conversation Chatwoot statement snapshot authorizes public sends;
4. `stream_revision` invalidates stale plans when reconciliation accepts new events;
5. one live action per stream plus permanent same-revision action uniqueness prevents duplicate public sends;
6. durable public actions survive input-job/coprocessor loss through the independent relay;
7. no CDC/WAL, third DB or Chatwoot core patch is required for Website First Line v1.

Slice C umbrella issue #75 remains the frozen program boundary. C1/C2a/C2b/C2c/C3
are merged historical evidence and C4 deterministic decision runtime is merged via
PR #107 on canonical main `565f8eb30bf39afa80bb4d59258cc2fd13aa67d5`.
The prior CATEGORY-pair prerequisite is therefore implemented and reviewed.
This docs-only C5 amendment freezes the complete C5 renderer / Website-transport
contract in §40.2–§40.4: exact wording/output/formatting, genuine-decision
provenance, transient-output/privacy boundary, Chatwoot Liquid and Markdown
neutrality, native `input_select` ordinal transport, the 150000-Unicode-code-
point content bound, product-URL plain-text transport, and runtime-drift
revalidation. It contains no production C5/C6 code and does not authorize
renderer/send implementation. C5 production work must start as a later bounded stage under the
then-current AI Working Agreement with a fresh alternatives scan; C6 remains a
separate downstream stage. This v0.7 file is the single normative design source;
no delta document applies.
