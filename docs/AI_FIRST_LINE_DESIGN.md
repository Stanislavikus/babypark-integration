# BabyPark AI First Line — Frozen Design v0.5

Status: FROZEN — blocker review complete
Implementation: Slice A authorized via #53
Repository baseline: main `e4b3989f852d5de4a868a6f72867b87cb64f8b2d`
Chatwoot runtime verified: v4.18.0, `9f920b549c14491a4e587687a3eed5d21c6ccc7d`

This document is the single normative repository source of truth for the first
customer-facing BabyPark AI design. It incorporates the complete v0.5 design
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
- CLARIFY_EXHAUSTED
- PRODUCT_VARIANT_NOT_RESOLVABLE

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

Range template may offer a deterministic supported follow-up:
"Могу показать доступные варианты с точной ценой каждого."

That follow-up exists as `VARIANT_PRICE_LIST`.

## 22. Product resolution

1 credible canonical product => continue.

0 or multiple unresolved customer-level candidates => CLARIFY.

Unresolved catalog identity corruption/collision => HUMAN / CATALOG_IDENTITY_COLLISION.
Never expose internal identity-collision candidates.

## 23. Variant labels

Raw Drupal option labels may be shown only as sanitized factual labels.
Do not infer universal COLOR/SIZE/MATERIAL semantics.

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

Latch runs on the full current bot episode and tracks original normalized customer text plus consumed spans.

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

Clarification does not restart intent extraction from zero.

When the system presents candidates, the next customer message may only:
- choose one of the presented candidates;
- or fill the explicitly requested missing slot.

Previously resolved stable identifier slots remain fixed unless the user explicitly changes them.

Clarification counting is prompt-based, not attempt/round-based.

Rules:
- initial episode: `clarification_prompts_sent=0`;
- BabyPark may emit at most one `CLARIFY` prompt;
- after that prompt is emitted: `clarification_prompts_sent=1`;
- the next customer reply must resolve the requested slot by selecting an
  offered candidate or supplying a valid requested value;
- if it remains unresolved, do not emit a second CLARIFY.

Outcome:

```
HUMAN / CLARIFY_EXHAUSTED
```

Thus there is exactly one assistant clarification prompt per episode.

An unresolved catalog identity collision is:

```
HUMAN / CATALOG_IDENTITY_COLLISION
```

and internal collision candidates are not exposed to the customer.

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
- participating variant must have quantity > 0 at that exact store.

Commercial IN_STOCK does not substitute for store stock.

Stale/blocking stock layer:
HUMAN / CATALOG_STOCK_STALE.

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

  all_product_variants_match_filters

  matched_store_id?
}
```

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
`all_product_variants_match_filters=false`.

## 39. Specific-store stock semantics

"Есть эта модель в магазине X?" is not automatically answerable for a multi-variant model.

ANSWER / STORE_STOCK is allowed when:
- an exact variant was already selected; OR
- the resolved product has exactly one active IN_STOCK variant.

Then:
- store resolves exactly;
- stock layer answerable;
- return factual yes/no based on quantity > 0.

If product has multiple active IN_STOCK variants and no variant selected:
- CLARIFY / AMBIGUOUS_VARIANT if all customer-selectable candidate variants can be safely presented;
- otherwise HUMAN / PRODUCT_VARIANT_NOT_RESOLVABLE.

If clarification remains unresolved:
HUMAN / CLARIFY_EXHAUSTED.

Do not aggregate "one color exists" into "the model is in the store".

Do not expose quantity.
Do not claim "можно забрать сегодня".

## 40. Neutral presentation model

Business logic returns neutral `ProductPresentation`, not Chatwoot-specific cards.

Initial adapters:
- WebsiteRenderer;
- TextRenderer.

TextRenderer is implemented/tested in Slice C but not connected to Viber/Telegram production.

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
- catalog generation.

No LLM conversation summary.

## 45. Decision context

Every AI decision receives `decision_context_id`.

Canonical input includes only authority that affected the decision:
- knowledge_resolver_contract_version;
- intent_schema_version;
- tool_contract_version;
- template_id;
- template_version;
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
- episode state;
- structured extraction;
- ObjectiveConstraintLatch;
- clarification state;
- ANSWER/CLARIFY/HUMAN;
- deterministic templates;
- WebsiteRenderer;
- unconnected TextRenderer;
- public messages only for ANSWER/CLARIFY;
- HUMAN sends no AI preface;
- native handoff;
- decision trace.

### Slice D — Private Handoff Note
- createHandoffNote();
- hardcoded private:true;
- at-most-once attempt;
- deterministic body;
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

Blocker review is complete. Slice A implementation issue #53 is authorized.
This v0.5 file is the single normative design source; no delta document applies.
