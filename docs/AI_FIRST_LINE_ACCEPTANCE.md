# BabyPark AI First Line — Acceptance Corpus v0.7

Status: FROZEN — Event Ledger v0.7 architecture acceptance freeze
Companion: `docs/AI_FIRST_LINE_DESIGN.md`
Repository baseline used for research: `e4b3989f852d5de4a868a6f72867b87cb64f8b2d`

This file is the single normative acceptance corpus for AI First Line v0.6. It
incorporates the complete v0.6 acceptance delta; no separate delta document is
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
| C55a | Same as C54 but exact variant/store store_stock row is missing while stock layer is otherwise fresh. | HUMAN / CATALOG_STOCK_STALE; missing row is not a silent zero |
| C56 | "Есть модель X в магазине A?" Product has multiple active IN_STOCK variants and none selected; all candidate labels safe. | CLARIFY / AMBIGUOUS_VARIANT |
| C57 | C56 follow-up selects one presented variant. | Preserve store/product slots; ANSWER / STORE_STOCK for selected variant |
| C58 | C56 second clarification attempt still unresolved. | HUMAN / CLARIFY_EXHAUSTED |
| C59 | Product has multiple IN_STOCK variants but candidate labels cannot safely identify all. | HUMAN / PRODUCT_VARIANT_NOT_RESOLVABLE |
| C59a | Product has multiple IN_STOCK variants with individually safe but duplicate-equivalent candidate labels. | HUMAN / PRODUCT_VARIANT_NOT_RESOLVABLE; do not offer indistinguishable choices |
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

### Q02a — price-ceiling clarification preserves direction
BabyPark needs one exact upper price bound for an otherwise supported objective
shortlist and emits its single CLARIFY with
`requested_slot=max_price_minor`.

Customer replies with one exact supported UAH amount.

Expected:
- MONEY resolver proves one exact amount;
- the same active episode continues;
- `max_price_minor` and `currency=UAH` are committed atomically from that
  customer selection;
- no `min_price_minor` is invented;
- generic `requested_slot=money` is never created by v3.

A migrated legacy active clarification with `requested_slot=money`:
- remains readable;
- cannot be mapped to min/max by inference;
- fails closed to HUMAN / CLARIFY_EXHAUSTED.

### Q03
First message contains "не Cybex"; model extractor omits the negation.
ObjectiveConstraintLatch still detects meaningful unconsumed exclusion.
Expected HUMAN / UNSUPPORTED_EXCLUSION.

### Q04 — unsupported latch survives crash/concurrent later turn
Turn 1 says "для 6 месяцев".
C3 proves and durably commits only a typed unsupported-age latch plus accepted
source-event provenance. HUMAN/native handoff has not yet completed (for example,
because processing crashed after semantic commit).

Before terminalization/handoff completes, a later accepted customer turn supplies
only a brand.

Expected:
- prior typed unsupported-age latch remains active;
- no raw/normalized age phrase or digest is required in durable state;
- before ordinary standalone replacement, C2c route application observes the
  non-empty pending-HUMAN latch set and refuses to close/replace the episode;
- the brand turn cannot erase the prior constraint or start a fresh AI episode;
- no ANSWER or CLARIFY is authorized;
- C4 yields HUMAN.

In the ordinary non-crash path, the turn-1 unsupported-age latch already blocks
ANSWER/CLARIFY and C4 yields HUMAN immediately; an AI clarification is not emitted.

### Q04a — unknown residue never becomes CLEAR by omission
C2 certifies all supported resolver spans, but contentful customer text remains
outside those spans and outside the reviewed supported-v1 request-language /
glue/social allowlists. The residue does not match any more specific known latch
marker.

Expected:
- C3 returns OTHER_UNCONSUMED_CONSTRAINT;
- no supported slot is silently widened or constraint dropped;
- C4 yields HUMAN;
- residue text/tokens/digest are not persisted.

### Q04c — multiple unsupported classes are retained, one HUMAN reason is deterministic
Customer says:
"Не Cybex, для ребёнка 6 месяцев, и какая модель лучше?"

Expected:
- C3 retains all three proven classes:
  `UNSUPPORTED_EXCLUSION`,
  `UNSUPPORTED_AGE_SUITABILITY`,
  `SUBJECTIVE_RECOMMENDATION`;
- no class is overwritten by another;
- no raw phrase/body/digest is persisted;
- C3 does not choose the final decision reason;
- C4 uses the frozen latch precedence and emits
  `HUMAN / SUBJECTIVE_RECOMMENDATION`;
- trace/handoff metadata may retain the complete typed class set.

Repeat delivery/reprocessing of the same evidence:
- does not duplicate latch classes;
- does not change primary reason by insertion/order timing.

### Q04d — pending unsupported latch forbids standalone episode replacement
An active episode has a committed `RETURN_CASE` latch. HUMAN/native handoff has
not yet completed. A later customer message arrives that, without the latch,
would be classified by C2c as a standalone new product query.

Expected:
- C2c may classify the new text for topology, but route application MUST NOT
  close/replace the latched active episode;
- no new active AI episode is created;
- no ANSWER/CLARIFY action is prepared;
- C4/HUMAN recovery continues from the latched episode;
- after native handoff closes the episode, ordinary future new-episode rules
  apply; the closed latch is never revived automatically.

### Q04b — supported request language is not mistaken for an unsupported constraint
Customer asks a supported v1 question such as:
"Спасибо, а какие способы оплаты есть?"
There is no unsupported constraint.

Expected:
- the social prefix and reviewed payment-policy request language MUST be consumed
  by deterministic bounded validators;
- model intent_hint alone cannot consume any text and a wrong/missing hint cannot
  prevent the reviewed payment validator from running;
- because no unsupported residue remains, C3 MUST return CLEAR;
- C4/authority resolution remains responsible for COMMERCE_POLICY and the final
  decision.

Add an unsupported clause:
"Спасибо, а какие способы оплаты есть и можно ли вернуть именно мой вчерашний заказ?"

Expected:
- supported payment request language does not hide the individual return case;
- C3 latches RETURN_CASE;
- no partial payment answer is public;
- C4 yields HUMAN.


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
The next customer response selects exactly one offered candidate.

The response may arrive either as:
- a newer incoming customer message; or
- a provider-native structured submission tied to the already-confirmed
  CLARIFY message.

Expected:
- preserve stable identifier slots;
- prove the response against the confirmed CLARIFY action/candidate reservation;
- reread current dynamic authority/freshness;
- continue only if current gates pass;
- do not treat the successful selection as permission for another CLARIFY later
  in the same episode;
- do not synthesize a customer message when the native transport produced none.

### Q09 — standalone new query starts fresh logical episode
An active prior episode exists and may already have
`clarification_prompts_sent=1`.
The next customer message is a standalone new request that does not depend on a
presented candidate, requested slot or explicitly supported follow-up.

Expected:
- prior logical episode is closed/replaced;
- a new episode is created;
- clarification budget starts at 0;
- old stable slots/candidates/requested slot are not inherited implicitly.

### Q10 — dependent follow-up continues current logical episode
The next customer response selects a presented candidate, fills the explicitly
requested slot, or invokes an explicitly supported deterministic follow-up such
as C25.

Expected:
- same logical episode continues;
- when Chatwoot creates a newer incoming customer message, ordered
  `source_message_ids` append that real Chatwoot message id;
- when a native structured submission updates the already-confirmed CLARIFY
  message and creates no new customer message, no duplicate/synthetic
  `source_message_id` is appended;
- preserved stable slots remain fixed unless the customer explicitly changes them;
- dynamic authority is still reread before any factual public response.

### Q10a — Web Widget native input_select submission is not a second message event
Turn 1:
- BabyPark emits and confirms a CLARIFY `input_select` message with Chatwoot
  source message id 102;
- the confirmed action reserves a bounded canonical candidate list.

Turn 2:
- the customer selects exactly one offered option in the Chatwoot Web Widget;
- Chatwoot emits authenticated `message_updated` for message 102;
- exact read of message 102 shows the expected `input_select` plus exactly one
  `content_attributes.submitted_values` selection.

Expected:
- webhook delivery is authenticated and deduplicated;
- message 102 is proven to be the exact confirmed CLARIFY action for the current
  conversation/episode;
- the submitted selection maps to exactly one candidate under the confirmed
  response contract;
- no second Conversation Event Ledger row is appended for source message 102;
- no fake/new customer message id is synthesized;
- only the canonical stable selection/slot is committed;
- raw title/body/provider callback payload is not persisted;
- episode version advances under ordinary stale-write protection;
- current dynamic authority is reread before any factual public response.

### Q10b — invalid structured submission fails closed
Use the Q10a setup, but one of these holds:
- `message_updated` targets a different message/action;
- CLARIFY is not confirmed;
- submitted values are empty, multiple, unknown or conflict with the confirmed
  candidate reservation;
- the current episode/action provenance no longer matches.

Expected:
- no stable slot/customer selection mutation;
- no duplicate ledger message row;
- no synthetic message id;
- no value is inferred from presentation text;
- because the episode has already consumed its one CLARIFY prompt, an unresolved
  customer response proceeds to HUMAN / CLARIFY_EXHAUSTED under the ordinary
  clarification rule.

### Q11 — Chatwoot status does not revive a closed episode
A logical episode has closed. Later the same Chatwoot conversation becomes
`pending` again and the customer sends a new message.

Expected:
- closed episode state is never reopened/reused solely because of Chatwoot status;
- apply ordinary standalone/dependent rules to the new message;
- no old clarification budget or candidates reappear.

### Q12 — pure acknowledgement is no-action, not a fourth decision
No clarification is pending. Customer sends a confidently pure social
acknowledgement such as "дякую" with no actionable request or constraint.

Expected:
- internal `NON_ACTIONABLE_ACK`;
- no ANSWER / CLARIFY / HUMAN decision is emitted;
- no public message;
- no handoff;
- no Chatwoot resolve;
- work terminalizes as no-public-action;
- logical episode closes.

### Q13 — social prefix does not swallow actionable request
Customer sends:
"Спасибо, а сколько стоит доставка?"

Expected:
- not `NON_ACTIONABLE_ACK`;
- actionable content continues through normal extraction/authority/decision processing;
- the social prefix does not remove the delivery request.

### Q14 — acknowledgement cannot bypass clarification exhaustion
BabyPark already emitted its one CLARIFY prompt and waits for a requested slot
or offered-candidate selection. Customer replies only "ок" / "спасибо" and does
not supply the requested value.

Expected:
- not `NON_ACTIONABLE_ACK`;
- no second CLARIFY;
- HUMAN / CLARIFY_EXHAUSTED.

### Q15 — C1 persistence contains no customer body or dynamic authority
Create/update an episode across restart.

Expected durable state contains only:
- conversation/episode identifiers;
- ordered source message IDs;
- allowlisted canonical stable selections;
- canonical presented candidates, at most 20 per clarification;
- requested slot;
- 0/1 clarification counter;
- lifecycle/version metadata.

Attempts to persist raw customer body, presentation label, current price, stock
quantity, catalog freshness, resolver/vocabulary state such as
`category_match_mode`, resolved policy/operational effect or Chatwoot
reopen-causality marker are rejected/not representable.

Every C1 mutation after episode creation requires an explicit positive
`expectedVersion`; omitting it is rejected and must not mutate state. More than
20 presented candidates is rejected before durable mutation.

### Q16 — public episode reads are one committed snapshot
Run a reader against `loadActive` or `getEpisode` while a separate process commits
a replacement episode or clarification update between the reader's first head-row
SELECT and later child-table SELECTs.

Expected:
- the public read returns one internally consistent committed state;
- `loadActive` never returns a closed episode merely because a later replacement
  committed during the read;
- `getEpisode` never combines version/budget/requested-slot metadata from one
  commit with candidates or slots from another;
- the writer may complete only after the reader releases its snapshot;
- every EpisodeStore connection reports `PRAGMA busy_timeout = 5000`, independent
  of Node runtime support for any `DatabaseSync` constructor timeout option;
- write transactions continue to use private transaction-neutral
  `#readEpisode` without nested transactions.

### Q17 — C1 accepts only canonical identity shapes and strict Chatwoot integer IDs
Attempt to persist:
- provider-native numeric product ID;
- free-form token in a category ID slot;
- a cross-domain ID prefix (for example `cat_...` in `variant_id`);
- boolean/array/hex/exponent/whitespace-padded values as conversation/message IDs.

Expected:
- canonical identity slots accept only their exact BabyPark domain-tagged shapes;
- invalid stable slots and candidates fail before durable mutation;
- rejected free-form text is absent from SQLite bytes;
- `conversation_id` / `source_message_id` accept only positive JavaScript safe integers;
- no coercive `Number(...)` conversion occurs.

### Q18 — C1 historical: consumed-message watermark survives episode closure and cleanup
Conversation 700 consumes source message 3, uses its one CLARIFY prompt, then closes.
Later attempts to begin a new episode with message 3 or any lower message ID arrive
with a fresh webhook delivery identity.

Expected:
- `EPISODE_MESSAGE_ALREADY_CONSUMED`;
- no fresh clarification budget is created;
- a strictly newer source message may begin a fresh episode;
- appending a newer source message advances the same conversation watermark;
- deleting closed episode rows in a cleanup simulation does not delete/reset the watermark;
- a later begin at or below that retained watermark remains rejected.

### Q19 — late lower Chatwoot ID appends as a later BabyPark event
A source transaction for Chatwoot message 100 remains uncommitted while message
101 commits and is accepted first.

Expected:
- 101 is accepted with the next local `event_seq`;
- later committed 100 is still exact-read even if any scan hint is already above 100;
- if its unique source key is absent, 100 is appended with a later local `event_seq`;
- no renumbering/back-insertion occurs;
- topology reasoning uses accepted `event_seq`, not numeric source-ID comparison.

### Q20 — high-water hints never suppress an unseen webhook target
Set a scan hint/highwater above source message 100 without inserting 100 into the
Conversation Event Ledger. Deliver/retry a webhook target for 100.

Expected:
- no `target <= highwater => ALREADY_KNOWN` shortcut exists;
- exact source lookup executes;
- ledger existence by unique source key is the only duplicate test;
- absent source key is inserted and increments `stream_revision`.

### Q21 — final authorizing snapshot catches late lower source IDs
Plan an action from a stream containing source 101. Before final action gating,
a previously uncommitted source message 100 becomes visible and contains a
constraint that changes the decision.

Expected:
- one Chatwoot whole-conversation authorizing query uses
  `after=0,before=2147483648,filter_internal_messages=true`;
- the snapshot contains both visible 100 and 101 when total public/non-activity
  rows are below 1000;
- unseen 100 is ingested and increments `stream_revision`;
- prepared action becomes STALE and performs zero public POSTs;
- replanning includes the late constraint.

### Q22 — 1000-row authorizing snapshot fails closed
The authorizing query returns exactly 1000 public/non-activity rows.

Expected:
- result is `HISTORY_UNPROVABLE`;
- no recursive/multi-query scan may authorize the public side effect;
- no AI POST occurs;
- routing fails open to HUMAN under the reviewed policy.

### Q23 — unknown public automation row is default-deny
Conversation topology contains a public outgoing Chatwoot automation message with
`sender=null`, between customer events.

Expected:
- row is not silently treated as neutral;
- continuity/ownership becomes unproven;
- no append/replace/ACK decision assumes the row is a BabyPark answer;
- no AI public action is authorized from an ambiguous topology.

### Q24 — covered source rows must still exist and not be deleted
An action was prepared using source messages that were valid during planning.
Before POST, an operator deletes one covered message in Chatwoot.

Expected:
- final authorizing snapshot/reread sees the covered row as deleted or otherwise
  invalid for the action basis;
- action is not sent;
- deleted replacement text is never fed to extraction.

### Q25 — exactly one action for one stream revision
Run duplicate webhook/job/planner attempts against the same
`(stream_id, prepared_stream_revision)`.

Expected:
- storage permits at most one action row for that pair across all states;
- same-revision retry reuses the existing action;
- clarification budget/candidates are reserved at most once;
- at most one public POST can result.

### Q26 — one live public action per stream
An action is PREPARED or GATING and a newer stream revision requires replanning.

Expected:
- at most one PREPARED/GATING/SENDING/UNCERTAIN-like action exists for the stream;
- an unsent PREPARED/GATING action may be atomically marked stale/cancelled and
  replaced in one `episode.sqlite` transaction;
- relay claim and replacement race through CAS/`BEGIN IMMEDIATE`, never two sends.

### Q27 — SENDING/UNCERTAIN blocks a newer AI action
An older action has reached SENDING or UNCERTAIN when a newer customer event is
accepted.

Expected:
- no second public AI action can be prepared/sent concurrently;
- old send is reconciled first;
- unresolved outcome remains UNCERTAIN and hands off to human;
- absence of a Chatwoot `source_id` tag does not prove the old POST did not commit.

### Q28 — clarification reservation is crash-safe
Prepare a CLARIFY action.

Expected:
- one-prompt budget, requested slot, canonical candidates and PREPARED action are
  committed atomically before any external send;
- crash before SENDING leaves a recoverable durable action;
- safe cancellation before SENDING may release only that unsent reservation;
- after SENDING the budget remains consumed even if outcome is uncertain;
- no execution path emits a second CLARIFY for the episode.

### Q29 — durable action survives loss of copilot.sqlite
Commit PREPARED/GATING action state in `episode.sqlite`, then simulate loss or
recreation of `copilot.sqlite`.

Expected:
- PublicActionRelay discovers/reclaims the durable nonterminal action from
  `episode.sqlite`;
- the action either confirms, stales/cancels safely, or hands off by deadline;
- no accepted action is orphaned merely because its originating input job vanished.

### Q30 — semantic commit precedes copilot terminalization
Crash at each boundary of:
claim input job -> idempotent episode/event/action commit -> finish input job.

Expected:
- crash before semantic commit leaves no false domain state and job can retry;
- crash after semantic commit but before finish causes retry to observe the same
  unique source/action state idempotently;
- copilot job is never terminalized before the corresponding durable domain
  mutation commits.

### Q31 — local event order is independent of Chatwoot created_at/id ordering
Return Chatwoot rows in a created_at order different from source-ID numeric order.

Expected:
- API array order never defines BabyPark event order;
- existing events keep immutable `event_seq`;
- unseen authoritative rows append in acceptance order;
- source IDs remain unique identity only.

### Q32 — C1 watermark is historical evidence, not v0.7 runtime authority
Run the merged C1 Q18 tests unchanged.

Expected:
- C1 implementation still satisfies its reviewed pre-production invariants;
- v0.7 runtime C2a does not use `conversation_message_watermarks.max_message_id`
  as dedupe, completeness or chronology truth;
- schema-v2 Event Ledger unique source keys + accepted `event_seq` supersede that
  runtime role before production activation.

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

The v0.7 acceptance corpus is frozen for Slice C umbrella issue #75. C1 remains merged pre-production evidence; C2a now owns the Event Ledger + durable public-action runtime foundation.

