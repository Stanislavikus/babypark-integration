# BabyPark AI First Line — Acceptance Corpus v0.5

Status: FROZEN — blocker review complete
Companion: `docs/AI_FIRST_LINE_DESIGN.md`
Repository baseline used for research: `e4b3989f852d5de4a868a6f72867b87cb64f8b2d`

This file is the single normative acceptance corpus for AI First Line v0.5. It
incorporates the complete v0.5 acceptance delta; no separate delta document is
required to interpret expected behavior.

This file is intended to become executable golden test data.
Do not silently change classifications while implementing.
A semantic change requires review and, where applicable,
`KNOWLEDGE_RESOLVER_CONTRACT_VERSION` bump.

## A. Verified implementation facts that motivated this corpus

### Chatwoot 4.18
- AgentBot ownership/fail-open foundation is already merged.
- Reconciler rejects any later public outgoing/template through `later_public_outgoing`.
- HUMAN v1 therefore sends no public AI preface.
- Chatwoot `messages.source_id` has a normal non-unique index, not a unique constraint.
- AgentBot public/private messages share the same create-message endpoint; private-note safety must be enforced in BabyPark code.

### Existing CatalogService
- `searchProducts()` can match through a non-default variant.
- `productSummary()` still exposes top-level price/availability from the default variant.
- Therefore current search DTO is not factual shortlist authority.
- Store stock and commercial availability are separate.
- Canonical offer schema permits `current_minor >= 0`.

### Production catalog snapshot observed during research
Evidence only; not permanent invariants:
- active products: 16,245;
- variants: 49,257;
- multi-variant products: 8,223;
- products with multiple priced variants: 1,776;
- variants with option labels: about 87.5%;
- IN_STOCK variants: 8,673;
- trusted-price IN_STOCK variants: 8,673;
- observed current price currency for that cohort: UAH;
- EXPECTED variants: 468, no trusted offer;
- MADE_TO_ORDER variants: 160, no trusted offer.

Runtime code must validate completeness/freshness rather than rely on these counts.

## B. Vector record shape

Every executable vector should carry:

```
id
customer_messages[]
fixture_authority
expected_decision
expected_reason
expected_template_id
expected_slots
expected_tool_args
expected_authority_dependencies
expected_decision_context_components
```

For multi-turn cases, `customer_messages[]` preserves episode history.

## C. Natural-language / authority vectors

| ID | Customer input / fixture | Expected |
|---|---|---|
| C01 | "Сегодня магазин на Глубочицкой открыт?" Active temporary closure overlay. | ANSWER / OPERATIONAL_FACT using closure overlay |
| C02 | "До скольки сегодня работает магазин на Глубочицкой?" Active CLOSED overlay plus active special_hours. | ANSWER / OPERATIONAL_FACT: closed; hours suppressed |
| C03 | Same store, no closure overlay, one active special_hours. | ANSWER / OPERATIONAL_FACT using special_hours |
| C04 | Same store, special_hours expired, weekly baseline exists. | ANSWER / OPERATIONAL_FACT using weekly baseline |
| C05 | `now == expires_at` for temporary overlay, baseline exists. | ANSWER / OPERATIONAL_FACT using baseline |
| C06 | `now == expires_at`, no baseline. | HUMAN / POLICY_NOT_FOUND |
| C07 | Two active special_hours overlays for same store/effect family with different hours. | HUMAN / POLICY_CONFLICT |
| C08 | "До скольки работает магазин?" Multiple stores in context not resolved. | CLARIFY / AMBIGUOUS_STORE |
| C09 | "Какой телефон магазина?" Multiple stores with different approved phones. | CLARIFY / AMBIGUOUS_STORE |
| C10 | "Какой телефон колл-центра?" One approved call-center phone. | ANSWER / OPERATIONAL_FACT |
| C11 | "Какие способы оплаты есть?" One reviewed payment policy. | ANSWER / COMMERCE_POLICY |
| C12 | "Какая предоплата на мебель?" General furniture policy = 2000. | ANSWER / COMMERCE_POLICY = 2000 |
| C13 | "Какая предоплата на шкаф Veres?" Valid narrower exception = furniture + Veres = 300. | ANSWER / COMMERCE_POLICY = 300 |
| C14 | Same Veres effect exists without valid exception relation and conflicts with general policy. | HUMAN / POLICY_CONFLICT |
| C15 | Required commerce policy absent. | HUMAN / POLICY_NOT_FOUND |
| C16 | "Какой общий срок возврата?" One reviewed general return policy. | ANSWER / COMMERCE_POLICY |
| C17 | "Можно вернуть именно мой товар, который я купил вчера?" | HUMAN / RETURN_CASE_SPECIFIC |
| C18 | "Сколько стоит UPPAbaby Cruz V2?" Unique product, complete IN_STOCK cohort, different prices. | ANSWER / PRODUCT_PRICE_RANGE |
| C19 | Same product, all relevant IN_STOCK variants same price. | ANSWER / PRODUCT_PRICE_SINGLE |
| C20 | Product has no IN_STOCK variants; commercial authority fresh. | ANSWER / PRODUCT_NOT_IN_STOCK |
| C21 | One relevant IN_STOCK variant lacks trusted offer. | HUMAN / PRICE_COHORT_INCOMPLETE |
| C22 | Relevant IN_STOCK offers contain UAH + EUR. | HUMAN / MIXED_CURRENCY |
| C23 | Trusted IN_STOCK offer has `current_minor == 0`. | HUMAN / ZERO_PRICE_UNVERIFIED |
| C24 | IN_STOCK priced variants plus EXPECTED variants without offers. | Price answer uses IN_STOCK cohort only |
| C25 | "Да, покажите точные цены вариантов" after a range answer. | ANSWER / VARIANT_PRICE_LIST |
| C26 | "Какие варианты Joolz Aer2 сейчас есть?" All IN_STOCK variant labels safe. | ANSWER / VARIANT_LIST |
| C27 | IN_STOCK: Black; EXPECTED: Blue; question "Какие варианты сейчас есть?" | ANSWER listing Black only |
| C28 | 7 IN_STOCK variants, 5 safe labels, 2 suppressed by display sanitizer. | ANSWER / VARIANT_LIST_PARTIAL; explicitly total=7, named=5 |
| C29 | Raw option label resembles debug/internal ID. | Suppress label; never show raw identifier |
| C30 | "Какие цвета есть?" Raw Drupal option dimension not authoritative as COLOR. | HUMAN / PRODUCT_ATTRIBUTE_NOT_AUTHORITATIVE in v1 |
| C31 | "Какой вес этой коляски?" Weight exists only in free description. | HUMAN / PRODUCT_ATTRIBUTE_NOT_AUTHORITATIVE |
| C32 | "Совместима ли эта люлька с коляской X?" No structured compatibility authority. | HUMAN / COMPATIBILITY_NOT_AUTHORITATIVE |
| C33 | "Прогулочные коляски до 20 000 грн" unique curated category. | ANSWER / OBJECTIVE_SHORTLIST |
| C34 | Same exact query yields 47 products. | TPL_SHORTLIST_TOP3_V1, total=47, show deterministic first 3 |
| C35 | Same exact query yields 2 products. | TPL_SHORTLIST_ALL_V1 |
| C36 | Same exact query yields 0 products. | ANSWER / OBJECTIVE_SHORTLIST_EMPTY; no widening |
| C37 | Default variant 27,300; other IN_STOCK variant 19,300; query <=20,000. | Match; card price=19,300; partial-model flag true |
| C38 | "Покажи коляски до 20 000" where raw "коляски" maps to >1 category. | CLARIFY / AMBIGUOUS_CATEGORY |
| C39 | "Прогулочные коляски до 20к" unique curated category. | money parser => 2,000,000 minor; ANSWER |
| C40 | Ambiguous/malformed money phrase. | CLARIFY / AMBIGUOUS_MONEY |
| C41 | "Покажи Cybex до 30 000" exact reviewed brand. | ANSWER / OBJECTIVE_SHORTLIST |
| C42 | Raw brand maps to >1 reviewed canonical brand. | CLARIFY / AMBIGUOUS_BRAND |
| C43 | "Покажи что-нибудь до 500 грн" no category/brand anchor. | CLARIFY / MISSING_SHORTLIST_ANCHOR |
| C44 | "Прогулочные коляски до 20 000, но не Cybex". | HUMAN / UNSUPPORTED_EXCLUSION |
| C45 | "Прогулочная коляска до 20 000 для ребёнка 6 месяцев". | HUMAN / UNSUPPORTED_CONSTRAINT |
| C46 | "Какая лучшая прогулочная коляска до 20 000?" | HUMAN / SUBJECTIVE_RECOMMENDATION |
| C47 | "Сколько стоит эта коляска и совместима ли она с адаптером X?" | HUMAN / COMPATIBILITY_NOT_AUTHORITATIVE; no partial public price |
| C48 | Category fixture: target node has products only in descendants; vocabulary mode NODE_ONLY. | Descendant products excluded |
| C49 | Same fixture; mode INCLUDE_DESCENDANTS. | Descendant products included using same catalog generation |
| C50 | Price-filter shortlist anchored to category contains relevant IN_STOCK offer hole. | HUMAN / PRICE_COHORT_INCOMPLETE; do not silently reduce total |
| C51 | Brand=Cybex + price<=30k + exact Store A; stock/commercial fresh. | ANSWER shortlist; only qty>0 variants in Store A |
| C52 | Same as C51 but stock layer stale/blocked. | HUMAN / CATALOG_STOCK_STALE |
| C52a | Same as C51; stock layer is fresh but one anchored active IN_STOCK variant has no exact-store store_stock row. | HUMAN / CATALOG_STOCK_STALE; missing row is never a silent zero/exclusion |
| C53 | Same as C51 but store phrase unresolved. | CLARIFY / AMBIGUOUS_STORE; never rerun without store |
| C54 | "Есть модель X в магазине A?" Product has exactly one active IN_STOCK variant, stock fresh qty>0. | ANSWER / STORE_STOCK = yes |
| C55 | Same as C54, qty=0. | ANSWER / STORE_STOCK = no |
| C56 | "Есть модель X в магазине A?" Product has multiple active IN_STOCK variants and none selected; all candidate labels safe. | CLARIFY / AMBIGUOUS_VARIANT |
| C57 | C56 follow-up selects one presented variant. | Preserve store/product slots; ANSWER / STORE_STOCK for selected variant |
| C58 | C56 second clarification attempt still unresolved. | HUMAN / CLARIFY_EXHAUSTED |
| C59 | Product has multiple IN_STOCK variants but candidate labels cannot safely identify all. | HUMAN / PRODUCT_VARIANT_NOT_RESOLVABLE |
| C60 | Catalog identity corruption gives multiple internal identities for a supposedly canonical selector. | HUMAN / CATALOG_IDENTITY_COLLISION; do not expose internal candidates |
| C61 | Approved `store.weekly_hours` baseline has `expires_at_utc = NULL`, effective_from is in the past, and no overlay applies. | ANSWER / OPERATIONAL_FACT using baseline |
| C62 | Weekly baseline 10:00–20:00; civil-day `store.special_hours` says 11:00–18:00 for date D; customer asks at 18:30 Europe/Kyiv on D. | ANSWER / OPERATIONAL_FACT = closed; baseline must not reopen the store |
| C63 | Same store/time has `store.temporary_closure=CLOSED` and overlapping `store.status_override=OPEN` in the same operating-state effect family. | HUMAN / POLICY_CONFLICT even though namespaces differ |

## D. Operational-composition vectors

### O01 — closing overlay suppresses hours
Fixture:
- weekly_hours = 10:00–20:00;
- special_hours = 11:00–18:00;
- temporary_closure active for same interval.

Expected:
- store resolves CLOSED;
- no customer-facing "open until 18:00".

### O02 — overlay expiry reveals baseline
Fixture:
- weekly_hours baseline;
- temporary closure expires at T.

At T-1ms:
- closure authoritative.

At T:
- closure inactive;
- baseline applies.

### O03 — overlay does not supersede baseline
Publishing a temporary closure must not write SUPERSEDED against weekly_hours/baseline_status.

After overlay expiry:
- baseline remains published/authoritative.

### O04 — supersession boundary
Attempt SUPERSEDED between different:
- namespace;
- subject;
- or effect_family.

Expected:
- event write rejected atomically.


### O05 — open-ended baseline activity
Fixture:
- reviewed weekly baseline;
- `effective_from_utc <= now`;
- `expires_at_utc = NULL`;
- no overlay.

Expected:
- baseline is active;
- no `POLICY_NOT_FOUND`.

### O06 — early closing owns the whole local civil day
Fixture:
- weekly baseline 10:00–20:00;
- `store.special_hours` for local date D has opening interval 11:00–18:00;
- revision envelope is local midnight D through local midnight D+1 in `Europe/Kyiv`.

At 17:30 local:
- open under special hours.

At 18:30 local:
- closed under special hours;
- weekly baseline must not fill 18:00–20:00.

At next local civil day:
- overlay expired;
- baseline may apply again.

### O07 — cross-namespace operating-state conflict
Fixture:
- same store/overlapping interval;
- `store.temporary_closure=CLOSED`;
- `store.status_override=OPEN`;
- both belong to the same operating-state effect family.

Expected:
- HUMAN / POLICY_CONFLICT;
- conflict detection is by subject + effect_family regardless of namespace.

### O08 — special-hours publication owns the whole local civil day
Fixture:
- weekly baseline 10:00–20:00;
- valid `store.special_hours` revision for date D has effect 11:00–18:00;
- revision envelope is local midnight D through local midnight D+1.

Expected:
- 17:30 local => OPEN;
- 18:30 local => CLOSED;
- 19:30 local => CLOSED;
- only at start of D+1 may weekly baseline participate again.

## E. Commerce scope/exception vectors

### E01 — valid narrower scope
Parent:
```
category_id=furniture
```
Child:
```
category_id=furniture
brand_id=Veres
```
Expected: valid strict narrowing.

### E02 — equal scope
Parent and child have identical bindings with different effect.
Expected: exception rejected; use SUPERSEDED or conflict.

### E03 — missing parent binding
Parent:
`category_id=furniture`
Child:
`brand_id=Veres`
Expected: not narrower; reject.

### E04 — category descendant is not scope narrowing
Parent category A; child category B where B happens to be a catalog descendant.
Without repeating the parent's exact binding + extra binding:
Expected: not a valid exception relationship.

### E05 — broader child
Parent:
`category=furniture, brand=Veres`
Child:
`category=furniture`
Expected: reject.

### E06 — temporal subset
Child interval is a non-empty subset of parent.
Expected: valid if scope/effect-family checks also pass.

### E07 — child extends beyond parent
Expected: reject.

### E08 — exception cycle
Expected: reject atomically.

## F. Event ledger state-machine vectors

All must be transactional and deterministic.

### L01
APPROVED without DRAFT_CREATED => reject.

### L02
Approval-required PUBLISHED without APPROVED => reject.

### L03
Commerce author_actor_id == approval actor_id => reject.

### L04
KNOWLEDGE_ADMIN approving own CommercePolicy => reject.

### L05
Second PUBLISHED => reject.

### L06
REVOKED before PUBLISHED => reject.

### L07
PUBLISHED after REVOKED => reject.

### L08
Second REVOKED => reject.

### L09
Any authority-changing event after SUPERSEDED => reject.

### L10
Corrupt/manual self-approved event chain reaches resolver => resolver refuses authority.

### L11
parent_revision_id alone does not deactivate predecessor.

### L12
Replacement publication + predecessor SUPERSEDED occurs in one transaction or neither commits.

## G. Direct-publish vectors

### D01
`store.temporary_closure` with expires_at=null => reject.

### D02
`store.special_hours` with expires_at=null => reject.

### D03
effective_from >= expires_at => reject.

### D04
baseline weekly_hours attempts direct publish => reject; approval required.

### D05
`store.special_hours` spanning more than one Europe/Kyiv civil day => reject.

### D06
`store.special_hours` for date D with effect 11:00–18:00 but revision
`expires_at_utc` = 18:00 D => reject. Valid envelope is local midnight D
through local midnight D+1.

### D07
Exactly one Europe/Kyiv civil-day envelope for `store.special_hours` => accept
if ordinary RBAC/conflict checks pass.

### D08
`store.temporary_closure` spanning Friday 00:00 to Monday 00:00 => allowed
finite overlay.

### D09
`store.temporary_closure` for 15:00–17:00 => allowed partial-day overlay.

## H. Clarification / episode vectors

### Q01
First turn resolves category+price, store ambiguous.
System asks only for store.
Second turn chooses one offered store.
Previously resolved category+price remain fixed.

### Q02
BabyPark has emitted one CLARIFY prompt, so
`clarification_prompts_sent=1`. The next customer reply does not select an
offered candidate and does not validly fill the requested slot.

Expected:
- no second CLARIFY;
- HUMAN / CLARIFY_EXHAUSTED.

### Q03
First message contains "не Cybex"; model extractor omits the negation.
ObjectiveConstraintLatch still detects meaningful unconsumed exclusion.
Expected HUMAN / UNSUPPORTED_EXCLUSION.

### Q04
First message says "для 6 месяцев"; second message only supplies a brand.
Episode latch preserves unsupported age constraint.
Expected HUMAN; it does not disappear between turns.


### Q05 — dynamic stock is reread after clarification
Turn 1:
- product/store identifiers resolve;
- multiple variants cause `CLARIFY / AMBIGUOUS_VARIANT`;
- stock layer is fresh;
- candidate variant A currently has quantity > 0.

Between turns:
- current accepted Catalog state changes;
- selected variant A now has quantity = 0;
- stock layer remains answerable/fresh.

Turn 2:
- customer selects variant A.

Expected:
- preserved product/store/variant identifiers are used;
- stock is reread from current authority;
- answer reflects current quantity=0;
- stale turn-1 stock is never reused.

### Q06 — freshness is reread after clarification
Turn 1:
- clarification candidates are shown while stock layer is answerable.

Between turns:
- stock layer becomes STALE/BLOCKED or relevant `need_reconcile/need_full` becomes unsafe.

Turn 2:
- customer selects a candidate.

Expected:
- final answer reruns freshness;
- HUMAN / CATALOG_STOCK_STALE;
- no cached turn-1 freshness is reused.

### Q07 — operational now/state is rerun after clarification
Turn 1:
- a stable store identifier is resolved.

Before the final answer:
- a newly published temporary closure becomes active.

Expected:
- final operational resolver rereads current published authority and current `now`;
- closure suppresses any previously observed hours;
- no earlier-turn "open" fact is reused.

### Q08 — successful response to the single clarification prompt
BabyPark has emitted one CLARIFY prompt and presented a bounded candidate list.
The next customer reply selects exactly one offered candidate.

Expected:
- preserve stable identifier slots;
- reread current dynamic authority/freshness;
- continue only if current gates pass;
- do not treat the successful selection as permission for another CLARIFY later
  in the same episode.

## I. Handoff vectors

### H01 — HUMAN successful
- no AI public preface;
- native pending->open succeeds;
- after open, AI sends zero public messages.

### H02 — handoff API failure
- no false public "transferred" message exists;
- work remains non-terminal/retryable;
- reconciler remains safety path.

### H03 — later public outgoing from human/template
Existing gate continues to block stale AI handoff/action.

### H04 — duplicate webhook
Must not cause duplicate handoff.

## J. Private-note Slice D vectors

### N01
`createHandoffNote()` public API has no `private` parameter.

### N02
Inspect actual outbound JSON; `private === true`.

### N03
Caller tries to provide a conflicting field/value; narrow function cannot emit public message.

### N04
Durable note-attempt marker is written before network request.

### N05
Network failure/ambiguous result => no retry of note; proceed to handoff.

### N06
Private note failure never blocks handoff.

### N07
Duplicate webhook does not create second note.

### N08 — stock-stale handoff retains independently confirmed facts
Final decision is HUMAN / CATALOG_STOCK_STALE.

If an exact product/variant is already resolved and current independent
authorities confirm general commercial availability, B1 price, and/or an
applicable reviewed delivery CommercePolicy:
- private note includes those confirmed facts deterministically;
- each fact is scoped as general commercial/delivery authority, not exact-store
  stock;
- exact-store availability remains unresolved;
- failed B3 store-filtered shortlist membership is never serialized as a
  confirmed partial shortlist;
- there is still no public AI handoff preface.

If no such independent fact is safely available, the note contains only the
confirmed identifiers/provenance plus unresolved reason. No fact is invented to
make the note look richer.

## K. Catalog objective-search vectors

### S01
Require categoryId OR brandId.

### S02
NODE_ONLY category query uses only direct membership.

### S03
INCLUDE_DESCENDANTS expands tree from same pinned generation.

### S04
Price membership and displayed price derive from the same matched variant cohort.

### S05
Default-variant price outside filter never leaks into matched card.

### S06
Store filter requires an explicit exact-store row for every anchored active
IN_STOCK variant. quantity=0 is a confirmed exclusion; quantity>0 participates
in the exact-store denominator used by all_available_variants_match_filters.

### S06b
Fresh stock layer but a missing exact-store row for any anchored active IN_STOCK
variant => HUMAN / CATALOG_STOCK_STALE for the whole store-filtered result.
The same missing row must not poison a query that has no store constraint.

### S07
Store filter with stale/blocked stock layer fails closed.

### S08
Relevant offer hole fails entire price-filter result rather than shrinking total.

### S09
Mixed currency fails closed.

### S10
Zero price fails closed as ZERO_PRICE_UNVERIFIED.

### S11
Stable order:
`matching_price_min_minor ASC, product_id ASC`.

### S12
Display limit=3 does not alter total_product_count.

## L. Resolver-version vectors

### V01
Golden input observable result unchanged after internal refactor:
no version bump required.

### V02
Golden input ANSWER -> HUMAN changes:
CI fails without `KNOWLEDGE_RESOLVER_CONTRACT_VERSION` bump.

### V03
Reason/effect changes with same decision class:
CI requires version bump.

## M. Hash/integrity vectors

### X01
Same semantic revision encoded with different object insertion order produces the same revision_hash.

### X02
Timestamp normalization to UTC produces canonical hash input.

### X03
Change one authoritative revision value => revision_hash changes.

### X04
Change an event field => event_hash changes and following chain verification fails.

### X05
Restore into scratch reproduces:
- revision hashes;
- event chain;
- derived publication state;
- frozen resolver verification results.

## N. Backup/restore acceptance

Knowledge authority cannot be declared CURRENT until a real drill proves:

1. consistent SQLite backup;
2. integrity check;
3. encrypted artifact;
4. off-host copy;
5. independent checksum verification;
6. scratch restore;
7. hash-chain verification;
8. semantic resolver verification.

## O. UI/auth acceptance for Slice A

Direct `ai.babypark.ua` must work independently of Chatwoot iframe.

Origin:
- reachable only through intended Cloudflare path/tunnel;
- validates Access JWT signature/iss/aud/expiry;
- maps verified identity to stable actor_id;
- applies BabyPark RBAC.

Dashboard embedding acceptance:
- Chrome;
- Edge;
- Access login;
- session renewal;
- CSP/frame-ancestors;
- direct-app fallback remains usable if iframe auth fails.

Chatwoot `currentAgent` must never authorize a write.

## P. Corpus governance

The first corpus is curated because the new Chatwoot deployment has little real customer-chat history.

After live traffic accumulates:
- add anonymized real customer phrasings;
- preserve expected semantic classification;
- never retain raw customer text in routine runtime trace merely because it exists in test fixtures.

Future corpus additions should especially target:
- spelling errors;
- RU/UK mixing;
- follow-up fragments;
- negation;
- ambiguous product naming;
- real seller corrections.

## Q. Canonical store identity / Magento cutover

### M01
Reviewed xrefs:

```
(drupal, native_store_A) -> store_X
(magento, source_code_A) -> store_X
```

Expected: accepted Catalog before/after cutover exposes `store_X`; Knowledge
keyed by `store_X` needs no rewrite.

### M02
Active Magento physical source has no reviewed canonical store mapping.

Expected: cutover/acceptance fails closed; no fuzzy mapping by name/address.

### M03
Same provider-native source mapped to two canonical stores.

Expected: reject identity conflict.

### M04
Two active Magento physical sources claim one canonical physical store in v1.

Expected: cutover preflight fails unless a future explicit
multi-source-per-store contract exists. Durable reviewed historical xrefs are
not erased merely because only one source may be active in v1.

### M05
Tombstoned physical store ID is never reused.

## R. Field-level authority

### A01
Chatwoot inbox hours = 10:00–20:00.
Physical Store X Knowledge hours = 10:00–18:00.
Question: "До скольки открыт магазин X?"

Expected: physical-store Knowledge authority, never Chatwoot.

### A02
Same fixture.
Question: "До скольки отвечает чат?"

Expected: Chatwoot inbox working-hours authority, never physical-store schedule.

### A03
Knowledge says Store X = 10:00–18:00.
Magento pickup `frontend_description` says "Open until 20:00".

Expected: AI store-hours answer uses Knowledge; Magento prose does not override.

### A04
Magento general Store Hours text conflicts with per-store Knowledge.

Expected: per-store Knowledge remains authority.

### A05
Knowledge says Store X is OPEN, CatalogService selected-variant stock at Store X
= 0. Question: "Есть этот вариант в магазине X?"

Expected: stock answer comes from CatalogService; open hours cannot invent stock.

### A06
After Drupal -> Magento provider cutover, Magento source maps to the same
canonical `store_X`.

Expected:
- store-hours answer unchanged because Knowledge remains authority;
- stock uses current accepted Catalog;
- AI tool/resolver contract does not branch on provider.

## S. Store-identity deployment gate

### I01
Attempt to make store-scoped Knowledge CURRENT while subject uses
provider-native Drupal/Magento ID rather than canonical `store_id`.

Expected: reject/block deployment.

The v0.5 acceptance corpus is frozen for Slice A implementation issue #53.

