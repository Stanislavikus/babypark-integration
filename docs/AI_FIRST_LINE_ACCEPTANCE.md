# BabyPark AI First Line — Acceptance Corpus v0.8

Status: FROZEN — C6/C25 pre-implementation safety acceptance + prior v0.7/C5 acceptance
Applies to: BabyPark AI First Line Website v1 / Slice C acceptance contract.
Supersedes: `docs/AI_FIRST_LINE_ACCEPTANCE.md` at canonical main `09cbf704aba2a6bab4aa1ccacf904926286c3977`.
Companion: `docs/AI_FIRST_LINE_DESIGN.md`
Historical research baseline: `e4b3989f852d5de4a868a6f72867b87cb64f8b2d`.
Contract amendment base: canonical main `09cbf704aba2a6bab4aa1ccacf904926286c3977`.

This file is the single normative acceptance corpus for AI First Line v0.8. It
incorporates the complete prior acceptance corpus plus the C6/C25
pre-implementation safety freeze; no separate normative delta document is
required to interpret expected behavior.

This file is intended to become executable golden test data.
Do not silently change classifications while implementing.
A semantic change requires review and, where applicable,
`KNOWLEDGE_RESOLVER_CONTRACT_VERSION` bump.

## A. Verified implementation facts that motivated this corpus

### Chatwoot 4.18
- Historical AgentBot ownership/reconciler plumbing is already merged, but v0.8 §43/Q57 supersedes its handoff authority: deployed v4.18 AgentBot `toggle_status(open)` is not an authorized Website First Line handoff write.
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
expected_response_locale
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
| C01 | "Сегодня магазин на Глубочицкой открыт?" Active temporary closure overlay. | ANSWER / OPERATIONAL_FACT using `TPL_STORE_OPEN_STATUS_V1`; exact current-state payload only. |
| C02 | "До скольки сегодня работает магазин на Глубочицкой?" Active CLOSED operating-state overlay plus active special_hours. | ANSWER / OPERATIONAL_FACT using `TPL_STORE_OPEN_STATUS_V1`: currently closed; hours suppressed exactly as §9.2 requires. The today-schedule reader does not override an active CLOSED terminal. |
| C03 | Same store, no closure overlay, one active special_hours. Customer asks today-hours / "до скольки". | ANSWER / OPERATIONAL_FACT with `TPL_STORE_HOURS_TODAY_V1`, projecting the complete selected special-hours interval list. |
| C03a | Today schedule is 10:00–13:00 and 14:00–20:00; customer asks "До скольки сегодня работает?" at 09:00 local, before opening. | ANSWER with `open_now=false` and both intervals; renderer can state the schedule/final close 20:00. It must not reduce authority to `open=false, closes_at=null`. |
| C03b | Same split schedule; question at 13:30 local between intervals. | Same complete schedule payload; do not imply the store is closed for the remainder of the day. |
| C04 | Same store, special_hours expired, weekly baseline exists; today-hours request. | ANSWER / OPERATIONAL_FACT using `TPL_STORE_HOURS_TODAY_V1` with the complete current-weekday baseline intervals. |
| C05 | `now == expires_at` for temporary overlay, baseline exists. | ANSWER / OPERATIONAL_FACT using baseline |
| C06 | `now == expires_at`, no baseline. | HUMAN / POLICY_NOT_FOUND |
| C07 | Two active special_hours overlays for same store/effect family with different hours. | HUMAN / POLICY_CONFLICT |
| C08 | "До скольки работает магазин?" Multiple stores in context not resolved. | CLARIFY / AMBIGUOUS_STORE |
| C09 | "Какой телефон магазина?" Multiple stores with different approved phones. | CLARIFY / AMBIGUOUS_STORE |
| C09a | Exact canonical store is resolved; one active valid `store.phone` row exists under dedicated effect_family `store.phone`. | ANSWER / OPERATIONAL_FACT with `TPL_STORE_PHONE_V1` and exact `{e164}`. |
| C09b | Exact store, zero active valid `store.phone` rows. | HUMAN / POLICY_NOT_FOUND. |
| C09c | Exact store, two active valid rows have the same canonical E.164 effect. | ANSWER / OPERATIONAL_FACT; compatible duplicates are not conflict. |
| C09d | Exact store, two active valid rows have different E.164 effects. | HUMAN / POLICY_CONFLICT. |
| C09e | Parameterize wrong record/schema/namespace/non-empty scope/effect_type/value shape, or another namespace using `effect_family=store.phone`. | Reject before decision creation; full-subject projection must expose foreign same-family rows. No fallback to `store.identity`, store.address, Magento or Chatwoot. |
| C10 | "Какой телефон колл-центра?" One approved valid `call_center.phone` effect on `business/babypark`. | ANSWER / OPERATIONAL_FACT; render the exact validated E.164 value, not store.phone or Chatwoot inbox data. |
| C10a | Same request, zero active valid `call_center.phone` rows. | HUMAN / POLICY_NOT_FOUND. |
| C10b | Same request, two active rows carry the exact same canonical `PHONE` effect. | ANSWER / OPERATIONAL_FACT; compatible duplicate authority is not a conflict. |
| C10c | Same request, two active valid rows carry different canonical phone effects. | HUMAN / POLICY_CONFLICT; no CLARIFY/new call-center identity. |
| C10d | Parameterize one active same-family row with wrong `record_type`, `schema_version`, namespace, non-empty scope, wrong `effect_type`, extra/missing `effect_value` key or non-E.164 value. | Reject before decision creation; no ANSWER/CLARIFY and do not alias malformed authority to POLICY_NOT_FOUND. |
| C10e | A row under another namespace uses `effect_family=call_center.phone`, including an identical phone effect that would evade A5a conflict detection if namespace-prefiltered. | Reject before decision creation. The adapter projects full `business/babypark` authority without namespace prefilter and enforces exclusive family ownership. |
| C11 | "Какие способы оплаты есть?" One reviewed valid `commerce.payment_methods` policy with sorted closed method codes. | ANSWER / COMMERCE_POLICY with `TPL_PAYMENT_METHODS_V1`; render only locale-specific method names from codes. |
| C11a | Payment methods include `COD_NOVA_POSHTA`; public-site evidence mentions a percentage but no separate reviewed numeric authority exists. | ANSWER may name the method but MUST NOT state any percentage, fee, amount or condition. Template/code label contains no hidden numeric term. |
| C11b | PAYMENT_METHODS has unknown/duplicate/unsorted code, extra effect key, non-empty scope, wrong effect_type or wrong namespace/family. | Reject before decision creation; malformed policy is not POLICY_NOT_FOUND. |
| C12 | "Какая предоплата на мебель?" General valid `commerce.prepayment` policy = 2000. | ANSWER / COMMERCE_POLICY = 2000 using `TPL_PREPAYMENT_V1` exact amount/currency. |
| C13 | "Какая предоплата на шкаф Veres?" Valid narrower exception = furniture + Veres = 300. | ANSWER / COMMERCE_POLICY = 300 using the same typed prepayment payload. |
| C14 | Same Veres effect exists without valid exception relation and conflicts with general policy. | HUMAN / POLICY_CONFLICT |
| C15 | Required certified commerce policy absent. | HUMAN / POLICY_NOT_FOUND |
| C16 | "Какой общий срок возврата?" One reviewed valid `commerce.return_period` policy. | ANSWER / COMMERCE_POLICY with `TPL_RETURN_PERIOD_V1` and exact `{applies_to,calendar_days,purchase_day_excluded}`; the number is read from authority, not code. |
| C16a | RETURN_PERIOD has wrong/extra keys, non-positive/non-integer days, `applies_to != GOOD_QUALITY`, non-boolean exclusion flag, non-empty scope or wrong namespace/family/type. | Reject before decision creation; do not convert malformed authority to prose. |
| C17 | "Можно вернуть именно мой товар, который я купил вчера?" | HUMAN / RETURN_CASE_SPECIFIC |
| C18 | "Сколько стоит UPPAbaby Cruz V2?" Unique product, complete IN_STOCK cohort, different prices. | ANSWER / PRODUCT_PRICE_RANGE |
| C19 | Same product, all relevant IN_STOCK variants same price. | ANSWER / PRODUCT_PRICE_SINGLE |
| C20 | Product has no IN_STOCK variants; commercial authority fresh. | ANSWER / PRODUCT_NOT_IN_STOCK |
| C21 | One relevant IN_STOCK variant lacks trusted offer. | HUMAN / PRICE_COHORT_INCOMPLETE |
| C22 | Relevant IN_STOCK offers contain UAH + EUR. | HUMAN / MIXED_CURRENCY |
| C23 | Trusted IN_STOCK offer has `current_minor == 0`. | HUMAN / ZERO_PRICE_UNVERIFIED |
| C24 | IN_STOCK priced variants plus EXPECTED variants without offers. | Price answer uses IN_STOCK cohort only |
| C25 | One supported Website incoming message contains "Да, покажите точные цены вариантов", its exact current Chatwoot row has `content_attributes.in_reply_to == predecessor.confirmed_source_message_id` and `in_reply_to_external_id == predecessor.action_id`, and that predecessor is the unique **normal-CONFIRMED before HUMAN escalation** `ANSWER / PRODUCT_PRICE_RANGE` in the same active episode with canonical semantic-scope `product.product_id`. The exact dependent-message text matches one frozen §21.1 predicate independently of `intent_hint`; the new turn adds no identity/constraint row; all current IN_STOCK priced variants have safe labels. | Continue the same episode; use only predecessor semantic-scope `product_id` as historical continuation context; ANSWER / VARIANT_PRICE_LIST with `TPL_VARIANT_PRICE_LIST_V1`; reread current Catalog authority; payload contains label+current_minor only, no IDs/SKU. |
| C25a | Same proven dependent C25 route but at least one current priced variant has no safe display label. | HUMAN / PRODUCT_VARIANT_NOT_RESOLVABLE; do not expose variant_id/SKU and do not publish a partial unlabeled price list. |
| C25b | Variant-price wording matches, but the native reply relation is absent/partial/malformed, points to another message/conversation/action, or the referenced action is not one unique normal-CONFIRMED PRODUCT_PRICE_RANGE predecessor. | Do not infer causality from event_seq, message-id magnitude, created_at, webhook order or deferred-parent metadata. Do not inherit PRODUCT; ordinary standalone routing/HUMAN applies. |
| C25c | A causally proven reply to a confirmed range answer independently supplies any PRODUCT/CATEGORY/BRAND/STORE/MONEY identity or constraint row together with variant-price wording. | Treat the turn as standalone under Q09; predecessor PRODUCT is not inherited. Current standalone C2/C3/C4 decides or fails closed. |
| C25d | Russian and Ukrainian exact-turn controls cover both price-before-variant and variant-before-price word orders, including "Да, покажите точные цены вариантов" and "Так, покажіть точні ціни варіантів". Model `intent_hint` is missing, wrong or changed. | The frozen §21.1 predicates classify all four language/order controls identically; `intent_hint` cannot create or suppress C25 eligibility. Before C25 activation, production C4 must use one shared matcher with exact parity to those predicates. |
| C25e | A near-miss dependent message lacks the frozen price+variant language, the predecessor has only late remote-send evidence after HUMAN escalation, or predecessor semantic scope lacks one provable product_id. | Do not infer dependent C25 from conversational plausibility. No old PRODUCT/variant context is inherited; ordinary standalone routing/HUMAN applies. |
| C25f | The normal-confirmed range predecessor used a stable product selected through native STRUCTURED_SUBMISSION. Its stable `derived_through_event_seq` still points to the confirmed CLARIFY event; before C25 send, current `submitted_values` is changed/missing/multiple/unknown. | Stable provenance is never rewritten by range confirmation. C25 re-proves the structured source under §29.7; mutation => zero POST + HUMAN. |
| C25g | The normal-confirmed range predecessor came from an exact-message product and no product stable slot exists. Restart before the causally proven dependent reply. | The predecessor action's immutable semantic-scope `product_id` + authoritative action/source + exact native reply relation are sufficient historical context; no synthetic stable-slot promotion is required. |
| C25h | Customer text looks exactly like C25 and is accepted while predecessor is SENDING/UNCERTAIN or later via backfill, but it has no exact native reply pair to that predecessor. | Deferred/event acceptance order is scheduling only, not causality. Never inherit PRODUCT. Even if the predecessor later normally CONFIRMS, process this turn only as standalone/HUMAN. |
| C26 | "Какие варианты Joolz Aer2 сейчас есть?" All IN_STOCK variant labels safe. | ANSWER / VARIANT_LIST |
| C27 | IN_STOCK: Black; EXPECTED: Blue; question "Какие варианты сейчас есть?" | ANSWER listing Black only |
| C28 | 7 IN_STOCK variants, 5 safe labels, 2 suppressed by display sanitizer. | ANSWER / VARIANT_LIST_PARTIAL; explicitly total=7, named=5 |
| C29 | Raw option label resembles debug/internal ID. | Suppress label; never show raw identifier |
| C30 | "Какие цвета есть?" Raw Drupal option dimension not authoritative as COLOR. | HUMAN / PRODUCT_ATTRIBUTE_NOT_AUTHORITATIVE in v1 |
| C31 | "Какой вес этой коляски?" Weight exists only in free description. | HUMAN / PRODUCT_ATTRIBUTE_NOT_AUTHORITATIVE |
| C31a | Current production-authoritative Catalog generation now contains at least one canonical `product_attributes` row referencing `attribute_defs` (from any provider), but no explicit attribute-policy re-certification has been merged. Re-run C30/C31. | Review trigger is active, but C4 uses the same pre-authority terminal HUMAN / PRODUCT_ATTRIBUTE_NOT_AUTHORITATIVE mapping. Populated canonical data alone must not silently widen answer authority, and the attribute-value authority reader is not invoked. |
| C32 | "Совместима ли эта люлька с коляской X?" No structured compatibility authority. | HUMAN / COMPATIBILITY_NOT_AUTHORITATIVE |
| C33 | "Прогулочные коляски до 20 000 грн" unique curated category. | ANSWER / OBJECTIVE_SHORTLIST |
| C34 | Same exact query yields 47 products and every displayed product has exact-locale safe title. | TPL_SHORTLIST_TOP3_V1, total=47, show deterministic first 3; C4 payload exposes no product/variant IDs. |
| C35 | Same exact query yields 2 products with exact-locale safe titles. | TPL_SHORTLIST_ALL_V1 |
| C35a | `response_locale=uk`; selected product has only RU localized title/URL while generic Catalog presentation fallback could return RU. | HUMAN / PRODUCT_PRESENTATION_NOT_AVAILABLE; do not cross-locale fallback, do not expose ID. A price/stock template not requiring title remains independently answerable. |
| C35b | `searchObjectiveProducts()` returns OBJECTIVE_SHORTLIST from generation A; before C4 projects a displayed item, catalog cuts over and `getProduct()` for that same canonical product now returns generation B with changed/tombstoned/different localized presentation. | HUMAN / PRODUCT_PRESENTATION_NOT_AVAILABLE; zero mixed-generation shortlist payload. Every projected product must have `getProduct().catalog.generation_id == shortlist.catalog.generation_id`. |
| C36 | Same exact query yields 0 products. | ANSWER / OBJECTIVE_SHORTLIST_EMPTY with `TPL_SHORTLIST_EMPTY_V1`; no widening |
| C37 | Default variant 27,300; other IN_STOCK variant 19,300; query <=20,000. | Match; card price=19,300; partial-model flag true |
| C38 | "Покажи коляски до 20 000" where raw "коляски" maps to >1 category. | CLARIFY / AMBIGUOUS_CATEGORY |
| C39 | "Прогулочные коляски до 20к" unique curated category. | money parser => 2,000,000 minor; ANSWER |
| C40 | Ambiguous/malformed money phrase. | CLARIFY / AMBIGUOUS_MONEY |
| C41 | "Покажи Cybex до 30 000" exact reviewed brand. | ANSWER / OBJECTIVE_SHORTLIST |
| C42 | Raw brand maps to >1 reviewed canonical brand. | CLARIFY / AMBIGUOUS_BRAND |
| C43 | "Покажи что-нибудь до 500 грн" no category/brand anchor. | CLARIFY / MISSING_SHORTLIST_ANCHOR with `TPL_CLARIFY_SHORTLIST_ANCHOR_V1`, `requested_slot=category_id`, no finite choices. C4 never emits requested_slot=`shortlist_anchor`. |
| C43a | Two-turn C43: after the confirmed C43 prompt, customer supplies one exact category; C2 resolves exact `(category_id,match_mode)` while the original 500 UAH ceiling remains preserved. | C2c dependency proof remains `DEPENDENCY_ANCHOR_PROVEN / REQUESTED_SLOT_VALUE_REFERENCED` for requested slot `category_id`, but selection commit atomically persists both `category_id` and `category_match_mode` with the same provenance. Restart rebuild re-proves the same tuple before shortlist authority. ANSWER or ordinary current-authority HUMAN; no second CLARIFY and no loss of money constraint. |
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
| C59b | `getVariantListFact()` returns VARIANT_LIST or VARIANT_LIST_PARTIAL for two different canonical variants whose emitted labels are duplicate-equivalent after the frozen label-key normalization. Distinct-label control included. | Duplicate-equivalent case => HUMAN / PRODUCT_VARIANT_NOT_RESOLVABLE before public payload; distinct control remains ANSWER. No ordinal/SKU/variant_id fallback. |
| C59c | `getVariantPriceListFact()` returns FACT / VARIANT_PRICE_LIST with `label_complete=true`, but two different canonical variants have duplicate-equivalent labels and different current prices. Distinct-label control included. | Duplicate-equivalent case => HUMAN / PRODUCT_VARIANT_NOT_RESOLVABLE; differing prices do not disambiguate labels. Distinct control remains ANSWER / VARIANT_PRICE_LIST. |
| C60 | Catalog identity corruption gives multiple internal identities for a supposedly canonical selector. | HUMAN / CATALOG_IDENTITY_COLLISION; do not expose internal candidates. |
| C60a | Supported PRODUCT request resolves to zero canonical candidates. | HUMAN / IDENTITY_NOT_RESOLVABLE; no open-ended CLARIFY. The exact certified C2 resolution inside DecisionBasis is the zero-candidate evidence. |
| C60b | Required CATEGORY/BRAND/STORE resolves to zero canonical candidates. | HUMAN / IDENTITY_NOT_RESOLVABLE; same rule as C60a. |
| C60c | Contentful NOT_FOUND phrase leaves C3 `OTHER_UNCONSUMED_CONSTRAINT`. | Keep the complete C3 latch set; primary HUMAN reason is IDENTITY_NOT_RESOLVABLE. A specific latch such as UNSUPPORTED_EXCLUSION still outranks it. |
| C60d | Kernel input token is missing, serialized/structuredClone/reconstructed, or reused after one decision attempt. Parameterize across ordinary ANSWER, CLARIFY and HUMAN routes. | Reject before decision creation. Only a genuine unconsumed DecisionBasis token is admissible. |
| C60e | Certified resolution has two identity rows. Parameterize status pairs across RESOLVED / AMBIGUOUS / NOT_FOUND / INVALID_AUTHORITY. | Any collision wins as CATALOG_IDENTITY_COLLISION; other INVALID_AUTHORITY rejects; any NOT_FOUND forbids ANSWER/CLARIFY and yields IDENTITY_NOT_RESOLVABLE unless a higher C3 latch wins; AMBIGUOUS is considered only when no hard identity failure exists. When hard failures are absent, same-kind singular-slot cardinality is further reduced by C60r before clarification or authority. |
| C60f | `clarification_prompts_sent=0` and two or more required identity kinds are simultaneously AMBIGUOUS with finite candidate sets, with no harder HUMAN gate. | HUMAN / MULTIPLE_IDENTITY_AMBIGUITIES; do not choose a slot by code order and do not spend the single CLARIFY budget on an arbitrary one. |
| C60g | Same customer request independently matches two reviewed request families, e.g. commerce-policy and objective-shortlist. | HUMAN / MULTIPLE_REQUEST_FAMILIES_MATCHED, independent of validator order or intent_hint. |
| C60h | DecisionBasis contains product_id=A but current price authority read returns an outcome for B, or a previous-turn/current-generation-mismatched outcome is offered to composition. | Basis creation fails; kernel never receives a token. Current authority outcome must be obtained inside basis construction for the exact canonical IDs/current authority context. |
| C60i | Fact-layer outcome is `NOT_FOUND / PRODUCT_NOT_FOUND` after identity resolution had succeeded. | Reject before decision creation; do not alias to IDENTITY_NOT_RESOLVABLE or PRODUCT_NOT_IN_STOCK. |
| C60j | Clarify-capable outcome with `clarification_prompts_sent=0`. | Exactly one CLARIFY is allowed when all other gates pass. |
| C60k | Any non-empty clarification requirement set with `clarification_prompts_sent=1` **after every required finite candidate set has passed presentation/label representability**, including one requirement, several simultaneous requirements, or a newly ambiguous slot after the previous slot was successfully filled. | HUMAN / CLARIFY_EXHAUSTED before any lower clarification-cardinality reason; successful selection does not reset the prompt budget. Unrepresentable identity labels are handled earlier by C60y/C60z and never become CLARIFY_EXHAUSTED. |
| C60l | `clarification_prompts_sent` is missing, null, negative, >1 or non-integer. | Reject before decision creation; never CLARIFY. |
| C60m | Price, CommercePolicy effect or objective-shortlist membership changes after a clarification turn. | Build a new DecisionBasis and use the current reread outcome; old dynamic fact/membership cannot authorize the response. |
| C60n | Parameterize every pre-authority clarify-capable requirement: AMBIGUOUS_PRODUCT, AMBIGUOUS_CATEGORY, AMBIGUOUS_BRAND, AMBIGUOUS_STORE, AMBIGUOUS_MONEY and MISSING_SHORTLIST_ANCHOR. Exactly one family matches, C3 is CLEAR and no harder identity failure exists; finite identity candidates have valid representable labels. | Before any family authority call, DecisionBasis records the clarification outcome. At budget 0 => corresponding CLARIFY; at budget 1 => HUMAN / CLARIFY_EXHAUSTED. No arbitrary candidate ID, omitted filter/value or widened domain-authority call is permitted. AMBIGUOUS_VARIANT remains post-authority and applies the same 0/1 budget only after variant label representability succeeds. |
| C60o | For each current authority family, compare the mapper key set with the complete frozen service outcome union, including reread mutations. | Every emitted `(family,status,reason)` tuple has exactly one explicit decision mapping or explicit intentional rejection; there is no wildcard/default mapping. A newly emitted or omitted tuple fails the contract test and rejects before decision creation. In particular variant-price reread may yield FACT / PRODUCT_NOT_IN_STOCK or the frozen commercial UNANSWERABLE reasons, and those must not fall through. |
| C60p | `clarification_prompts_sent=0` and the pre-authority clarification set has more than one requirement. Parameterize at least CATEGORY+MONEY and MISSING_SHORTLIST_ANCHOR+MONEY, plus the identity-only control from C60f. | No authority call. Identity-only multi-requirement sets use HUMAN / MULTIPLE_IDENTITY_AMBIGUITIES; every other multi-requirement set uses HUMAN / MULTIPLE_CLARIFICATION_REQUIREMENTS. No requirement is selected by code order. With the same fixtures at budget=1, C60k wins as HUMAN / CLARIFY_EXHAUSTED. |
| C60q | Cross-product the total pre-authority gates with a hypothetical lower-priority gate/authority outcome. Include at least: identity collision + C3 UNSUPPORTED_EXCLUSION; C3 UNSUPPORTED_EXCLUSION + multiple family matches; identity NOT_FOUND + multiple family matches; singular-slot-cardinality failure + multiple family matches; multiple family matches + unsupported response locale; unsupported response locale + unrepresentable identity candidates; unrepresentable candidates + budget=1; attribute-query family + ambiguity; uncertified-delivery family + ambiguity/current-policy fixture; and every pre-authority terminal paired with stale/conflicting domain authority. | Apply DESIGN §28.4 exactly: invalid/certification; identity integrity; C3/NOT_FOUND; singular-slot cardinality; family cardinality; frozen single-family terminals; response locale; finite identity presentation/representability; clarification budget; only then domain authority. Lower phases never change the primary reason. Presentation reads allowed by phase 7 are not domain-authority calls; the domain-authority spy observes zero calls for every pre-authority terminal. |
| C60r | Parameterize same-kind singular resolver rows for PRODUCT, CATEGORY, BRAND, STORE and MONEY after INVALID_AUTHORITY/NOT_FOUND have been excluded. Controls: two all-RESOLVED rows with the exact same semantic value; adversarial cases: two different RESOLVED values, RESOLVED+AMBIGUOUS, and AMBIGUOUS+AMBIGUOUS. PRODUCT equality includes product+variant; CATEGORY includes category+match_mode; MONEY includes currency+minor_units. | Exact same all-RESOLVED values collapse to one semantic slot while provenance is retained. Every other multi-row same-kind case => HUMAN / UNSUPPORTED_CONSTRAINT before family selection/authority. Do not choose a row/candidate by source order, do not invent union/intersection or min/max roles, and authority spy observes zero calls. |
| C60s | Parameterize current certified C2 `language` as `uk`, `ru`, and another valid normalized tag. Also vary Catalog `matched_languages`, Knowledge source locale and `intent_hint` so they disagree with C2. | `uk`/`ru` public ANSWER or CLARIFY carries that exact `response_locale`; disagreement from Catalog/Knowledge/hints never changes it. Any other valid tag => HUMAN / UNSUPPORTED_RESPONSE_LANGUAGE before clarification/domain authority; authority spy observes zero calls and there is no fallback locale. HUMAN emits no public locale/message. |
| C60t | For representative ANSWER (price, phone, payment, shortlist), CLARIFY and HUMAN outcomes, compare the returned C4 decision object against the exact §16.2 key set and per-template payload schema; inject raw authority DTO fields such as revision IDs, generation/freshness metadata, SKU, product/variant IDs, quantity and cohort IDs. | Decision has exactly eight enumerable keys. ANSWER/CLARIFY expose only allowlisted render payload; HUMAN has null public fields. Any missing/extra/wrong-type field or raw DTO leakage rejects before action preparation. |
| C60u | Candidate-based CLARIFY contains private canonical candidate values plus customer labels; for localized product/category candidate fixtures, opposite-locale labels also exist. | Public decision `choices` contains only `bp-choice:<ordinal>` + safe label; canonical values remain private reservation data. Localized labels must come from exact `response_locale`, never opposite-locale fallback. Reordered/missing/unsafe labels or direct canonical IDs in public choices reject. |
| C60v | Reviewed delivery request family (for example Q13) matches exactly one family but no typed public delivery-policy schema is frozen. | HUMAN / COMMERCE_POLICY_NOT_AUTHORITATIVE before CommercePolicy read; no generic effect JSON reaches C5. |
| C60w | `VARIANT_PRICE_LIST` authority is FACT but `label_complete=false`. | HUMAN / PRODUCT_VARIANT_NOT_RESOLVABLE before public payload; no variant_id/SKU or partial unlabeled price list. |
| C60x | Parameterize every CLARIFY reason/template with its valid slot/choices. Try `render_payload=null`, `{}`, an arbitrary safe object, and extra payload keys. For AMBIGUOUS_MONEY and MISSING_SHORTLIST_ANCHOR also try `choices=[]` vs any non-empty otherwise-safe choice set. | Only `render_payload=null` is valid for every CLARIFY. AMBIGUOUS_MONEY and MISSING_SHORTLIST_ANCHOR require **exactly `choices=[]`**; any non-empty set rejects before action preparation because no canonical candidate reservation exists. Candidate-based CLARIFY reasons retain their exact finite choices. |
| C60y | Parameterize AMBIGUOUS_PRODUCT/CATEGORY/BRAND/STORE and post-authority AMBIGUOUS_VARIANT across `clarification_prompts_sent=0|1` and candidate-label classes: safe+distinct control, missing, unsafe, duplicate-equivalent after frozen normalization. | For PRODUCT/CATEGORY/BRAND/STORE any non-representable label class => HUMAN / IDENTITY_NOT_RESOLVABLE at budget 0 **and** 1; for VARIANT => HUMAN / PRODUCT_VARIANT_NOT_RESOLVABLE at budget 0 and 1. These reasons outrank CLARIFY_EXHAUSTED. Safe+distinct control: budget 0 CLARIFY, budget 1 CLARIFY_EXHAUSTED. Pre-authority identity failures make zero domain-authority calls; VARIANT performs only the required store-stock read that produced the candidates and no further inappropriate authority read. Ordinal tokens never disambiguate labels. |
| C60z | PRODUCT and CATEGORY ambiguity presentation proof: vary certified C2 `catalog_generation_id`, presentation-read generation, exact `response_locale` entry, opposite-locale/fallback entry, and candidate row presence. PRODUCT uses only `getProduct().product.localized[response_locale].title`; CATEGORY uses only `listCategories(...).categories[*].names[response_locale]`, never fallback `name`. | Only exact-generation + exact-locale + complete safe labels may continue to C60y/budget. Generation mismatch, missing candidate, missing exact-locale label or fallback-only label => HUMAN / IDENTITY_NOT_RESOLVABLE before clarification budget and before any family domain-authority read. Presentation reads must not add/remove/change canonical candidates. |
| C60aa | Parameterize finite ambiguity cardinality 20 vs 21 for PRODUCT, CATEGORY, BRAND, STORE and post-authority VARIANT, with otherwise safe distinct labels. | Exactly 20 may proceed to ordinary budget/CLARIFY. 21 or more is never truncated: PRODUCT/CATEGORY/BRAND/STORE => HUMAN / IDENTITY_NOT_RESOLVABLE; VARIANT => HUMAN / PRODUCT_VARIANT_NOT_RESOLVABLE. No public action preparation sees >20 candidates. |
| C60ab | Restart-capable two-turn continuation after a confirmed CLARIFY. Parameterize presented-candidate and requested-slot selections across PRODUCT/CATEGORY/BRAND/STORE/VARIANT, concrete MONEY `max_price_minor`, plus C43 category anchor. Rebuild the original covered basis and preserve unrelated constraints. | Provenance-bound discharge replaces exactly the reserved unresolved slot with the committed stable selection before singular/ambiguity/family reduction. CATEGORY persists/reuses exact `(category_id,category_match_mode)`; MONEY removes old AMBIGUOUS_MONEY and applies `(currency=UAH,max_price_minor)` while preserving the original anchor. Original family still matches; no old ambiguity coexists with replacement; current authority is reread. Missing/mismatched/ambiguous discharge provenance fails closed. Persisted prompt budget remains 1. |
| C60ac | Public-display safety boundary. Parameterize PRODUCT/CATEGORY/BRAND/STORE labels, shortlist title and variant labels with: normal text; `Cc`; `Cf` including U+200B/U+200C/U+200D/U+2060; bidi override/isolate; URI-prefix variants; exact debug regex boundaries/separators/case (`Blue oid:32976`, `oid-32976`, non-match control `xoid:32976`); serialized-prefix case variants (`O:8:{`, `o:8:{`, `A:1:{`); mandatory internal-ID equality and caller-omission/substitution attempts; 160 vs 161 Unicode code points. Internal-ID coverage includes PRODUCT canonical/product/variant/SKU/sku_key + same-generation getProduct nested IDs, CATEGORY category/parent IDs, BRAND/STORE IDs, VARIANT variant/SKU/sku_key + option_id/attribute_id from same-generation getVariant, and shortlist product/matching-variant/getProduct IDs. For composite VARIANT labels, test both whole-label and **each constituent part** against the same complete VARIANT ID set: `SKU123 / Blue` with SKU=`SKU123` must fail, not pass because only the whole string differs. Parameterize `product_url`/`image_url` with valid HTTPS controls plus bad scheme, credentials, fragment, non-default port, whitespace/control/backslash, percent-encoded control, IP/localhost/special-use host, >4096, foreign product host and public CDN image host. | Only text passing the exact §16.3 algorithm with the complete mandatory internally-derived ID set is public; `Blue` vs `Bl\u200Bue` cannot become distinguishable choices, and caller omission of SKU/option/attribute/internal IDs is impossible. Unsafe identity/variant labels use existing NOT_RESOLVABLE HUMAN mappings; unsafe required shortlist title => PRODUCT_PRESENTATION_NOT_AVAILABLE. Product URL is non-null only for HTTPS `babypark.ua`/subdomain; image URL only for public HTTPS DNS host. Unsafe optional URLs project to null, never pass through/fallback. 160 and 4096 bounds are accepted; 161/4097 reject. |
| C60ad | CATEGORY clarification/restart matrix. Presented path: original phrase resolves AMBIGUOUS to candidate tuples, CLARIFY is confirmed, native structured ordinal selects one private tuple, process restarts, and the current resolver over the **original phrase** still returns AMBIGUOUS. Vary selected-tuple membership as present unchanged, absent, or same ID with flipped mode; also allow extra current candidates. Requested-slot path: exact follow-up phrase is re-resolved after restart as RESOLVED vs AMBIGUOUS/NOT_FOUND/INVALID. Cover both `NODE_ONLY` and `INCLUDE_DESCENDANTS`. | Selection commit writes `category_id` + `category_match_mode` atomically with same derived event. Presented path succeeds when the reserved selected tuple remains an exact member of the current ambiguous candidate set; extra candidates do not invalidate the explicit selection and ordinal is never resolved as text. Absent/mode-replaced/invalid selected tuple => HUMAN / IDENTITY_NOT_RESOLVABLE. Requested-slot path succeeds only on one current RESOLVED tuple exactly equal to durable pair; ambiguity/not-found/invalid/mode drift => HUMAN / IDENTITY_NOT_RESOLVABLE. No shortlist read with guessed mode. |
| C61 | Approved `store.weekly_hours` baseline has `expires_at_utc = NULL`, effective_from is in the past, and no overlay applies. | ANSWER / OPERATIONAL_FACT using baseline |
| C62 | Weekly baseline 10:00–20:00; civil-day `store.special_hours` says 11:00–18:00 for date D; customer asks at 18:30 Europe/Kyiv on D. | ANSWER / OPERATIONAL_FACT = closed; baseline must not reopen the store |
| C63 | Same store/time has `store.temporary_closure=CLOSED` and overlapping `store.status_override=OPEN` in the same operating-state effect family. | HUMAN / POLICY_CONFLICT even though namespaces differ |

Attribute-authority review trigger: the first production-authoritative Catalog
generation with any canonical `product_attributes` row referencing
`attribute_defs` requires explicit C30/C31 re-certification as a checklist item
of the next source-provider cutover review. The trigger itself does not authorize
an answer; until the frozen docs are explicitly amended, C30/C31 remain HUMAN.

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

### O09 — today-schedule reader preserves split intervals
Fixture:
- no active CLOSED operating-state overlay;
- selected special-hours or weekly authority for today =
  `[{open:10:00,close:13:00},{open:14:00,close:20:00}]`.

At 09:00 and again at 13:30 local, call `resolveStoreTodaySchedule`.

Expected both times:
- RESOLVED; `open_now=false` at 09:00 and 13:30;
- both intervals preserved in stable order;
- no reduction to current `open=false` state;
- `TPL_STORE_HOURS_TODAY_V1` can deterministically answer the today-hours
  request without a second authority read.

### O10 — active current CLOSED state remains the conservative terminal
Fixture:
- weekly/special hours exist;
- a finite `store.temporary_closure=CLOSED` is active at current `now`.

Expected:
- current-state reader => CLOSED while the closure is active;
- a today-hours customer request uses the current-state terminal and suppresses
  opening-hour intervals exactly as DESIGN §9.2 already freezes;
- the new today-schedule reader must not weaken that older safety rule merely
  because the closure expires later in the civil day.

### O11 — future same-day closure is reflected before it starts
Fixture:
- weekly schedule 10:00–20:00;
- at 09:00 local, an already-published temporary closure is effective today
  15:00–17:00.

Expected `resolveStoreTodaySchedule` at 09:00:
- RESOLVED, `open_now=false`;
- intervals = 10:00–15:00 and 17:00–20:00;
- no continuous 10:00–20:00 claim merely because the closure is not active at
  the instant of the read.

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
- after restart-capable continuation rebuild, the historical AMBIGUOUS_MONEY row
  is provenance-discharged before C4 ambiguity/budget reduction and is replaced
  by the proven upper bound;
- the original category/brand shortlist anchor and other unrelated stable
  constraints remain intact;
- C4 performs the anchored current shortlist read and yields ANSWER or its
  ordinary current-authority HUMAN outcome, never CLARIFY_EXHAUSTED merely because
  the old money ambiguity survived;
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

### Q10c — structured selection is revalidated again at final send
Start from successful Q10a: structured submission selected reserved candidate A,
selection was committed, and an ANSWER action is PREPARED/GATING. Before its final
send gate, mutate the same confirmed Chatwoot CLARIFY message's
`submitted_values` from A to B (or to missing/multiple/unknown) without creating a
new customer ledger event or stream revision.

Expected:
- final semantic reauthorization detects that the stable selection was derived
  through the confirmed CLARIFY event and exact-reads that message again;
- the submission must still map to the same confirmed action, ordinal/reservation
  and committed stable value;
- A->A unchanged survives restart and may send once after all other gates pass;
- A->B/missing/multiple/unknown => zero POST, no stable-slot rewrite and native
  HUMAN fail-closed path;
- unchanged stream_revision alone is never sufficient authority for a mutable
  structured submission.

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
- the social prefix does not remove the delivery request;
- because public delivery-policy effect schema is not certified in v1, C4 ends
  HUMAN / COMMERCE_POLICY_NOT_AUTHORITATIVE before any generic CommercePolicy
  effect is used publicly.

### Q14 — acknowledgement cannot bypass clarification exhaustion
BabyPark already emitted its one CLARIFY prompt and waits for a requested slot
or offered-candidate selection. Customer replies only "ок" / "спасибо" and does
not supply the requested value.

Expected:
- not `NON_ACTIONABLE_ACK`;
- no second CLARIFY;
- HUMAN / CLARIFY_EXHAUSTED.

### Q15 — v0.7 durable semantic state contains no customer body or dynamic authority
Create/update the v0.7 runtime episode/semantic state across restart.

Expected v0.7 durable state contains only:
- conversation/episode identifiers;
- ordered source message IDs;
- allowlisted canonical stable selections, including the CATEGORY identity pair
  `category_id` + `category_match_mode` when category was selected;
- canonical presented candidates, at most 20 per clarification; CATEGORY private
  candidate reservation binds `{category_id,match_mode}` while public choice does not;
- requested slot;
- 0/1 clarification counter;
- lifecycle/version metadata.

Attempts to persist raw customer body, presentation label, current price, stock
quantity, catalog freshness, vocabulary revision IDs/snapshots, resolved
policy/operational effect or Chatwoot reopen-causality marker are rejected/not
representable. `category_match_mode` alone without `category_id`, or any value
outside `NODE_ONLY|INCLUDE_DESCENDANTS`, is rejected.

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

### Q21 — final S2 authorizing snapshot catches late lower source IDs
Plan an action from a stream containing source 101. Allow optional S1/preflight,
transient extraction, deterministic C2/C3, fresh C4 and deterministic C5 to
complete non-authorizing semantic reauthorization. Before S2, a previously
uncommitted source message 100 becomes visible and contains a constraint that
would change the decision.

Expected:
- only S2's final Chatwoot whole-conversation query is authorizing and uses
  `after=0,before=2147483648,filter_internal_messages=true`;
- the snapshot contains both visible 100 and 101 when total public/non-activity
  rows are below 1000;
- unseen 100 is ingested and increments `stream_revision`;
- current Chatwoot ownership/status is exact-read after that snapshot;
- the already-rendered S1 result is discarded and never reused;
- the old action performs zero public POSTs and does not enter SENDING;
- continuation ownership is not orphaned: durable liveness replans/owns the newer
  revision and includes the late constraint.

### Q22 — 1000-row authorizing snapshot fails closed
The final authorizing query returns exactly 1000 public/non-activity rows.

Expected:
- result is `HISTORY_UNPROVABLE`;
- no recursive/multi-query scan may authorize the public side effect;
- no AI POST occurs;
- the current revision is not left as an orphan STALE terminal;
- durable HUMAN ownership remains/replaces relay ownership until native handoff
  succeeds.

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
- deleted replacement text is never fed to extraction;
- if no strictly newer revision/replacement owns continuation, durable HUMAN
  ownership is established rather than terminalizing an orphan STALE row.

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
- at most one PREPARED/GATING/SENDING/UNCERTAIN/handoff-owned action exists for
  the stream;
- an unsent PREPARED/GATING action may be marked STALE/CANCELLED without handoff
  only when a strictly newer accepted revision or atomic standalone replacement
  takes continuation ownership in the same transaction;
- same-revision reject/deadline/authority failure routes to durable HUMAN instead
  of orphan STALE;
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
- PublicActionRelay/liveness recovery discovers the durable nonterminal action
  from `episode.sqlite`;
- it either confirms, is atomically superseded by a strictly newer owned
  revision, or obtains durable HUMAN ownership by deadline;
- no accepted action/open turn is orphaned merely because its originating input
  job vanished.

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

### Q33 — semantic scope drift is not a same-descriptor refresh
Prepare an action from semantic scope v1. Before send-time reauthorization,
parameterize a current C2/effective-slot change to exactly one canonical slot:
PRODUCT, PRODUCT.variant, CATEGORY/match_mode, BRAND, STORE or customer MONEY,
while keeping action type/reason/template/locale otherwise identical. For MONEY,
cover independently:
- no bounds -> `money=null`;
- same max with changed `min_price_minor`;
- same min with changed `max_price_minor`;
- one nullable bound becoming present/absent.

Expected:
- fresh semantic scope differs from the immutable prepared scope for every
  canonical-slot/bound change;
- zero public POSTs;
- no old scope is rewritten to the new value;
- current-revision continuation obtains durable HUMAN ownership;
- an effective allowed `min_price_minor` consumed by C4 is never omitted merely
  because v1 has no lower-bound clarification prompt;
- by contrast, changes only to current price/stock/policy/hours/presentation or
  shortlist contents with an identical canonical scope follow ordinary U01/U03
  descriptor-preserving freshness.

### Q34 — S1 semantics are non-authorizing; S2 is the final topology gate
Let optional S1/preflight plus transient extraction, deterministic C2/C3, fresh
C4 and deterministic C5 complete under GATING. Interleave a human assignment/
status takeover, human public reply, other-bot/unknown public row or a new
customer event before S2 and at each S1 boundary.

Expected:
- S1 observations and rendered output never authorize POST;
- one S2 whole-conversation snapshot is the only authorizing topology snapshot;
- S2 ingests/classifies all visible rows and any relevant event/revision drift
  discards the S1 result with zero POST;
- every covered customer message is exact-reread after S2 and must byte-match the
  exact S1 semantic input before the same extraction can be re-certified;
- any STRUCTURED_SUBMISSION used by the decision is exact-read/re-proven after S2;
- only **after** those topology/text/structured proofs, current ownership/status is
  exact-read and must still prove the Website AgentBot prerequisites immediately
  before local send admission;
- C4 dynamic authority was freshly read immediately before S2; no previous
  prepared/rendered value is a fallback;
- only unchanged S2 topology + text/structured proof + final current ownership +
  local CAS may reach SENDING.

### Q35 — SENDING is a permanent no-POST-retry boundary
Reach durable SENDING and parameterize: timeout, reset, malformed response, 4xx,
429, 5xx, process crash before request, process crash after remote commit,
webhook-before-response and authoritative-read-before-webhook.

Expected:
- at most one Chatwoot POST attempt for the action id;
- no HTTP retry/backoff repeats a public POST;
- zero matching source tags never proves non-send;
- one unique authoritative BabyPark row with `source_id=action_id` observed
  before HUMAN escalation confirms normally and idempotently;
- no positive proof by the bounded reconciliation deadline => durable HUMAN
  continuation attached to the immutable PUBLIC_ACTION origin;
- a unique row discovered only after HUMAN escalation is historical late
  remote-send evidence under Q48, never normal CONFIRMED/AI re-entry;
- multiple matching tags => fail closed to durable HUMAN/anomaly handling, never
  choose the first row.

### Q36 — durable semantic-state corruption fails closed before send
Parameterize persisted corruption:
- candidate ordinals with a hole/duplicate/tail loss against stored count or
  mixed candidate slots;
- null/detached episode or unpaired episode/version;
- basis event from another stream or missing basis event;
- CLARIFY reservation not pointing back to its action;
- confirmation/source evidence not matching one BabyPark public action;
- two different semantic-origin fences for one `(stream_id,stream_revision)`;
- DIRECT_HUMAN/public-action origin bound to a wrong stream/episode/version;
- deferred-parent relation that is cross-stream, missing, duplicated/conflicting,
  attached to a non-customer event or otherwise inconsistent with accepted
  event/action history.

Expected:
- read/attestation/admission fails closed deterministically;
- no corrupted candidate list is reindexed into new ordinal meaning;
- no corrupted semantic-origin/deferred relation acquires a new interpretation;
- no public POST occurs;
- continuation goes to durable HUMAN/anomaly/manual recovery where one safe owner
  cannot be proven.

### Q37 — semantic liveness does not depend on the originating input job
Let the relay/S2 itself ingest a late relevant event that increments
`stream_revision`; delete/recreate `copilot.sqlite` so no input job remains.
Parameterize Chatwoot ownership authority as available and unavailable beyond the
configured turn/action deadline.

Expected:
- the old action sends nothing;
- independent liveness/recovery derives the open turn and continuation ownership
  from `episode.sqlite`;
- by the configured deadline the still-relevant newer revision has one durable
  semantic owner: a safely progressing public-action path or HUMAN continuation;
- loss of webhook/input-job execution cannot orphan the accepted actionable turn;
- when Chatwoot authority remains unavailable, the contract does **not** claim
  physical handoff completion by that deadline: HUMAN remains durable/silent and
  §29.8.2 operational escalation applies;
- authority recovery resumes only from a fresh exact ownership read; unavailable
  authority never becomes HANDOFF_DONE by timeout.

### Q38 — range confirmation preserves product-selection provenance
Prepare `ANSWER / PRODUCT_PRICE_RANGE` for product A with semantic-scope PRODUCT
A. Cover both: (a) product A came from exact-message identity with no stable
product slot, and (b) product A came from a native STRUCTURED_SUBMISSION stable
slot whose `derived_through_event_seq` points to the confirmed CLARIFY event.
Crash after SENDING and recover normal confirmation from a unique Chatwoot
`source_id=action_id`.

Expected:
- PREPARED/GATING/SENDING/UNCERTAIN/normal CONFIRMED never create or rewrite a
  C25 product stable slot merely because the range answer exists;
- case (b) keeps the original CLARIFY-derived stable provenance byte-for-byte;
- the normal-CONFIRMED predecessor action's immutable semantic-scope product_id +
  authoritative action/source relation survive restart and are sufficient C25
  historical context in case (a);
- case (b) additionally remains subject to mutable STRUCTURED_SUBMISSION re-proof
  before C25 send;
- scope mismatch before send gives HUMAN and creates no continuation context.

### Q39 — timing values are evidence-bound configuration, never proof of handoff non-commit
For lease, authority/extraction timeouts, action/turn deadline, pre-SENDING retry
budget, UNCERTAIN reconciliation window and HUMAN handoff/escalation window,
test one configuration satisfying measured/inherited timing relationships and
one violating them.

Expected:
- no acceptance vector freezes a guessed numeric value;
- startup validation accepts only the evidence-bound valid relationship;
- an invalid relationship fails closed before the relay can claim/send;
- elapsed timeout/window alone is never positive evidence that a prior
  outcome-unknown native handoff request cannot still commit;
- if no stronger deterministic provider/transport evidence can prove non-commit,
  another automated handoff write is forbidden and HUMAN plus operational
  escalation remains live;
- changing measured/frozen timing authority is a reviewed configuration/contract
  event, not an ad-hoc code constant.

### Q40 — structured submission arriving before local CLARIFY confirmation is not lost
A CLARIFY public message is visible to the customer and receives a native
`message_updated` submission while BabyPark still holds the action as SENDING
because its outgoing confirmation event/response has not yet reconciled.

Expected:
- the unconfirmed submission cannot mutate stable selection state;
- it is not converted into a synthetic customer ledger row;
- reconciliation first proves the unique CLARIFY action/message;
- independent liveness then exact-rereads the same message and processes the
  still-current submission under Q10a/Q10b;
- loss/reordering of the webhook cannot make the valid submission permanently
  disappear or permit a second CLARIFY.

### Q41 — restore older than a public send cannot create a duplicate
Restore `episode.sqlite` from a verified backup that predates a public send,
while Chatwoot still contains the configured AgentBot public reply carrying an
action/source id unknown to the restored local ledger/action state.

Expected:
- authoritative reconciliation/classification discovers the public BabyPark row;
- an unprovable local action/source relation is an ownership/continuity blocker;
- AI performs zero replacement/retry POSTs and fails open to HUMAN/recovery;
- the restored node never guesses that absence of the local action proves the
  remote send did not occur.

### Q42 — episode.sqlite has one local writable authority in v1
Attempt Website First Line activation with two writable hosts, a writable
replica/active-active copy, or network-filesystem locking for `episode.sqlite`.
Repeat with one local-filesystem writable database on one host/process domain and
off-host backup that is never concurrently writable authority.

Expected:
- multi-host/replicated/network-filesystem writable topology is outside the v1
  concurrency contract and activation is blocked;
- one local writable authority may proceed when all other activation gates pass;
- backup/restore artifacts are not writable peers and cannot serve traffic until
  an explicit restore/cutover makes exactly one copy authoritative;
- changing this boundary requires a separately reviewed durable-store/
  concurrency contract rather than silently relying on SQLite locking semantics
  the current design has not proven.

### Q43 — immutable semantic origin + monotonic HUMAN escalation
For one accepted `(stream_id,stream_revision)`, separately commit:
PUBLIC_ACTION(ANSWER), PUBLIC_ACTION(CLARIFY), DIRECT_HUMAN and
NON_ACTIONABLE_ACK origins. Then delete/recreate `copilot.sqlite`, restart,
replay duplicate triggers and make a nondeterministic extractor attempt to
return a different origin. Also exercise PUBLIC_ACTION -> HUMAN continuation.

Expected:
- once semantic work commits an origin, `episode.sqlite` exposes exactly one
  immutable origin fence for that revision;
- replay/restart cannot replace PUBLIC_ACTION with another action, DIRECT_HUMAN
  or ACK, and cannot replace HUMAN/ACK with AI;
- PUBLIC_ACTION -> durable HUMAN continuation is allowed/idempotent while the
  original action_id/origin evidence remains intact;
- PUBLIC_ACTION retry reuses the same action and cannot reserve/send twice;
- a revision superseded before semantic work commits any origin is permitted to
  have no synthetic/fake outcome fence;
- no disposable execution store is semantic replay authority.

### Q44 — HUMAN continuation owns the stream revision and has no NOT_SENT escape
Parameterize HUMAN arising (a) directly during planning with an active episode,
(b) before a safe episode can be established because topology/ownership is
unprovable, and (c) from an existing relay-owned ANSWER/CLARIFY public action.
Also transition an owning unsent CLARIFY to HUMAN and accept newer customer
events while handoff is pending.

Expected:
- planning-time HUMAN commits immutable DIRECT_HUMAN origin; relay-originated
  HUMAN preserves immutable PUBLIC_ACTION(action_id) origin and attaches durable
  HUMAN continuation instead of replacing/replanning it;
- episode/version binds when safely provable and may be absent only for the
  pre-episode unprovable DIRECT_HUMAN case;
- before disposable work disappears, exactly one durable HUMAN continuation
  owner exists;
- once HUMAN owns continuation, newer customer events may be ingested but cannot
  create/supersede with a newer autonomous AI outcome before §43 terminal proof;
- v1 exposes no actionable-current-revision `NOT_SENT` terminal semantic path;
- CLARIFY -> HUMAN keeps its consumed one-prompt reservation until episode
  closure; no second CLARIFY becomes possible;
- a strictly newer AI-owned replacement may release an unsent CLARIFY
  reservation only before HUMAN continuation is committed.

### Q45 — deferred customer acceptance is atomic and survives later confirmation
Let action A reach SENDING or UNCERTAIN. Accept one or more supported customer
events C1,C2 while A is unresolved. Crash at each candidate boundary around
event insert, stream_revision increment and deferred-parent persistence. Then
ingest A's authoritative outgoing row after C1/C2 so the outgoing row receives a
larger local `event_seq`. Repeat across restart and delivery permutations.

Expected:
- each newly accepted C event commits event row + stream revision + exact
  same-stream deferred parent A in one owning transaction; no crash can expose
  the accepted event without its required relation;
- duplicate delivery verifies/reuses the immutable relation and cannot reparent;
- normal confirmation of A before HUMAN makes C1,C2 the next open turn in their
  accepted `event_seq` order; the later-accepted outgoing row cannot hide them;
- the deferred relation keeps C1/C2 schedulable after A resolves but is never
  C25 causal proof. C25 may inherit PRODUCT only when the exact incoming Website
  message independently proves the native reply pair to one normal-CONFIRMED
  PRODUCT_PRICE_RANGE predecessor under §21.1/Q55;
- if A acquires HUMAN continuation, ownership is lost, or only gains late
  remote-send evidence after HUMAN, C1/C2 remain HUMAN/non-AI and cannot launch
  autonomous AI;
- no ordering rule consults numeric Chatwoot ID, `created_at` or webhook
  delivery order.

### Q46 — C25 matcher is exact, symmetric and intent-hint independent
Exercise both frozen §21.1 predicates with Russian/Ukrainian controls in
price-before-variant and variant-before-price order, including C25/C25d.
Parameterize missing/wrong model `intent_hint`, near-miss language, a new
identity/constraint row and absent/corrupt predecessor action/scope provenance.

Expected:
- exact text matching the frozen predicates classifies symmetrically in ru/uk
  regardless of `intent_hint`;
- predecessor continuation contributes only immutable semantic-scope
  `product_id`, never predecessor `variant_id`, price, label or rendered bytes;
- no ANSWER confirmation writes/replaces an episode product stable slot;
- near-miss language does not inherit old context;
- any new identity/constraint makes the turn standalone;
- missing/corrupt predecessor provenance cannot be guessed from conversation
  plausibility.

### Q47 — native HUMAN handoff is state-reconciled and never reopens blindly
For durable HUMAN continuation on deployed Chatwoot v4.18.0, parameterize the
exact §43.0 wire owner classes USER_OWNER, UNASSIGNED,
CONFIGURED_BABYPARK_AGENTBOT, OTHER_AGENTBOT, OTHER_PROVEN_AI and UNKNOWN_OWNER
across exact status `open|pending|resolved|snoozed` plus unknown status.
Separately, only for a future §43-approved safe automated primitive, parameterize
success, timeout/reset/unknown response, concurrent state change and restart.

Expected:
- current v4.18.0 performs **zero automated `toggle_status(open)` writes**;
- only `open + USER_OWNER/UNASSIGNED` proves
  `HANDOFF_DONE/human_takeover`, with zero BabyPark status/ownership write;
- any supported status + OTHER_AGENTBOT/OTHER_PROVEN_AI is exclusively
  `OWNERSHIP_LOST/ownership_lost`;
- resolved/snoozed + USER_OWNER/UNASSIGNED/CONFIGURED_BABYPARK_AGENTBOT is
  `OWNERSHIP_LOST/ownership_lost`, never reopened;
- open/pending + CONFIGURED_BABYPARK_AGENTBOT is unresolved durable HUMAN;
- pending + USER_OWNER/UNASSIGNED is unresolved HUMAN rather than inferred
  takeover;
- UNKNOWN_OWNER/unknown status is default-deny unresolved HUMAN;
- a future safe primitive may write only after the separately frozen
  write-time-safety/fit proof and durable attempt boundary; unknown outcome then
  follows Q54 no-blind-retry semantics;
- duplicate trigger creates no public message, cannot reopen resolved/snoozed,
  cannot displace another AI owner and cannot manufacture human takeover.

### Q48 — late remote-send proof cannot reverse HUMAN escalation
Let public action A reach SENDING, have its Chatwoot POST commit remotely, and
lose/delay all positive source evidence until after the bounded reconciliation
deadline. Commit durable HUMAN continuation for A, then parameterize:
(a) HUMAN still pending, (b) handoff already completed, and (c) deferred customer
events exist behind A. Only then ingest one unique authoritative BabyPark reply
with `source_id=A.action_id`.

Expected:
- A's immutable PUBLIC_ACTION origin/action_id is preserved, allowing the late
  reply to be provenance-linked as historical remote-send evidence;
- HUMAN continuation remains absorbing and is never removed/replaced by normal
  CONFIRMED;
- no episode reopen, no C25 predecessor/context, no stable-slot promotion, no
  clarification-budget release and no autonomous AI continuation/send occurs;
- any deferred customer events remain HUMAN/non-AI owned;
- a completed handoff/ownership_lost terminal is not reversed;
- duplicate/malformed late source evidence remains anomaly/HUMAN rather than
  selecting one row;
- the same unique proof arriving **before** HUMAN escalation follows ordinary
  normal CONFIRMED semantics instead.

### Q49 — stale restore cannot replay silent ACK/HUMAN as new AI work
Restore `episode.sqlite` from a verified backup that may predate semantic
mutations not reflected remotely: parameterize a lost `NON_ACTIONABLE_ACK`, a
lost `DIRECT_HUMAN` before native handoff changes Chatwoot ownership, and a lost
PUBLIC_ACTION/HUMAN-continuation fence. Also cover a restore with a proven
lossless semantic cut.

Expected:
- without a proven lossless semantic cut, Website First Line autonomous planning
  and public send remain disabled during recovery;
- a customer/public Chatwoot row visible in the recovery baseline but absent from
  restored semantic state is `RECOVERY_UNPROVABLE`, never assumed to be a new
  customer turn;
- potentially lost silent ACK/HUMAN/action ownership performs zero autonomous AI
  public actions and is quarantined/transferred to durable HUMAN/manual recovery;
- HISTORY_UNPROVABLE, malformed/unknown rows or an incomplete recovery baseline
  cannot establish a safe cut;
- recovery persists no raw/normalized customer body or content-derived digest;
- a proven lossless semantic cut may resume from its exact restored semantic
  state, and events first proven after the completed recovery boundary may enter
  ordinary routing;
- webhook replay, numeric Chatwoot IDs/`created_at` and rerunning extraction are
  never substitutes for restore provenance.

### Q50 — unavailable Chatwoot authority escalates operationally without false handoff
Start from durable HUMAN continuation. Make exact Chatwoot ownership/read
authority unavailable or malformed beyond the measured handoff/reconciliation
escalation window, then restore authority in each §43 current terminal/unresolved
state and, separately, in a future-safe-primitive write-eligible state.

Expected:
- HUMAN remains the absorbing autonomous-AI owner throughout the outage and no
  public AI message/handoff preface is sent;
- expiry of the measured escalation window records durable operator-attention /
  operational-fault metadata and exposes it through the future deployment
  health/operations surface; it does not fabricate `HANDOFF_DONE`;
- no automated handoff write occurs while ownership is unknown/unavailable;
- after authority recovers, the next action starts from one fresh exact ownership
  read and follows the ordinary §43 matrix;
- operational attention is not a fourth public decision class and contains no
  customer transcript/content digest.

### Q51 — NON_ACTIONABLE_ACK has one deterministic exact-text proof
Parameterize one complete open turn containing exactly one supported customer
text message with each of:
- `спасибо`;
- `Спасибо!!!`;
- `дякую`;
- `Дякую !`;
- `ок`;
- `добре`;
- `спасибо ❤️`;
- `Спасибо, а сколько стоит доставка?`;
and separately parameterize a two-customer-message open turn, a pending CLARIFY
reservation and wrong/missing/changing model `intent_hint`. For every exact-ACK
control, interleave before the durable commit: one newer accepted customer event,
changed `routing_ledger_fingerprint`, changed stream head/revision, changed active
episode/version, a newly live public/HUMAN owner, and a duplicate/restart after an
already committed ACK.

Expected:
- only standalone Russian/Ukrainian thank-you text matching
  `/^(?:спасибо|дякую)(?:\s*\p{P})*$/iu` after the frozen transient
  NFC/whitespace normalization may enter ACK admission;
- attachment/unknown shape, emoji, extra words, multiple customer messages,
  pending CLARIFY/HUMAN/latch or any non-match cannot become ACK;
- C3 CLEAR and `intent_hint` never authorize or suppress ACK;
- the exact-text proof alone is non-authorizing: one `BEGIN IMMEDIATE` admission
  rechecks the exact expected `stream_revision`, `through_event_seq`,
  `routing_ledger_fingerprint`, active episode/version when present, absence of
  live public/HUMAN/pending-CLARIFY/latch ownership and absence of a conflicting
  same-revision semantic origin;
- any changed/newer predicate => zero ACK mutation/zero episode close and stale
  rebuild/ordinary fail-closed processing;
- the ACK origin plus current episode close (when an active episode exists) commit
  atomically only on the unchanged certified basis;
- mixed social+actionable text continues ordinary C2/C3/C4 and cannot be made
  permanently silent by a model/heuristic classifier;
- after exact ACK commits, duplicate trigger/restart reuses the immutable origin
  idempotently and cannot replace it with another outcome.

### Q52 — MONEY semantic scope preserves merged zero support and validates relations
Parameterize effective durable MONEY state as:
1. `max=0,currency=UAH`;
2. valid max-only;
3. valid min-only;
4. valid min<=max;
5. min>max;
6. bound with missing currency;
7. bound with non-UAH currency;
8. currency-only;
9. malformed/non-safe-integer bound;
10. requested max-price clarification where max/currency provenance differs.

Expected:
- cases 1–4 are representable semantic-scope MONEY with non-negative safe
  integer bounds and exact UAH;
- case 1 is a customer constraint value, not authority to call a catalog zero
  price "free";
- cases 5–9 fail closed before C4/public send and are never silently normalized
  into a UAH objective constraint;
- lower/upper bounds may retain different valid source-event provenance;
- requested max-price clarification still requires atomic same-provenance
  `max_price_minor + currency=UAH`;
- S1/S2 reauthorization preserves/revalidates every effective bound and exact
  descriptor equality.

### Q53 — C25/C4 matcher implementation must equal the frozen §21.1 contract before activation
On this docs-only Stage-0 tree, compare the frozen §21.1 target predicates with
the merged C4 `VARIANT_PRICE_LIST` matcher. Then, in the future C25 production
stage, run exact code/contract parity tests after the required C4 change.

Expected:
- Stage 0 records the known current drift rather than claiming present code
  parity: the merged forward-order C4 branch lacks Ukrainian `цін`;
- Stage 0 changes no production matcher code;
- C25 production/activation is blocked until one shared C4 matcher implements
  exactly both frozen §21.1 predicates;
- C25 routing imports/reuses that shared matcher and cannot maintain a separate
  NLP/regex implementation;
- matcher input uses the same ordered exact-read text combination as C4
  (transient customer contents joined with LF);
- ru/uk × both word orders and near-miss controls pass independently of
  `intent_hint`.

### Q54 — any future safe native-handoff primitive crosses a durable attempt boundary
On deployed Chatwoot v4.18.0 first prove under Q57 that current AgentBot
`toggle_status(open)` is **not** an authorized automated handoff primitive.
Then, only in a future downstream stage that separately proves and owner-approves
a safe primitive under Agreement §§1–3, start from one durable HUMAN owner in
that primitive's exact write-eligible state and crash/restart at each boundary:
(a) before durable handoff-attempt reservation,
(b) after reservation but before durable dispatch/outcome-unknown boundary,
(c) after that boundary but before invoking the safe primitive,
(d) after request dispatch before response,
(e) after timeout/reset/unknown response.
Delete/recreate `copilot.sqlite`, expire execution leases and start duplicate
runners. Then separately supply reviewed positive deterministic non-commit
evidence for the prior attempt.

Expected:
- current deployed v4.18.0 creates no handoff attempt merely to call its unsafe
  `toggle_status(open)` path because that automated write is forbidden;
- once a future safe primitive is authorized, `episode.sqlite` owns the attempt
  identity/state and disposable execution state cannot make a prior attempt
  disappear;
- only one runner can reserve/cross the first write boundary for one attempt;
- once dispatch/outcome-unknown is durable, restart/lease expiry/pending state/
  elapsed time never cause another automatic handoff write;
- crash at (c) may conservatively remain HUMAN/operator-attention even if no
  request bytes were actually sent;
- a later attempt is possible only after positive deterministic non-commit proof
  is durably attached to the previous attempt plus one fresh exact ownership
  read that again satisfies the safe primitive's server-enforced/monotonic gate;
- no handoff-attempt metadata contains customer transcript/content digest.

### Q55 — C25 dependency requires native causal reply provenance
Parameterize a C25-looking customer message with:
1. exact Widget `in_reply_to` equal to the unique normal-confirmed range
   message and `in_reply_to_external_id` equal to its `action_id`;
2. no reply relation;
3. only one of the two fields matching;
4. reply to another conversation/message/action;
5. reply to late-send-after-HUMAN evidence;
6. message accepted while predecessor is SENDING/UNCERTAIN, then predecessor
   normally confirms;
7. an older backfilled message accepted after local predecessor confirmation;
8. valid pair at planning that is changed/missing at final S2 reread.

Expected:
- only case 1 may establish C25 dependency, subject to all other C25 gates;
- cases 2–7 never inherit PRODUCT merely from event_seq, Chatwoot message-id
  magnitude, created_at, webhook order or deferred-parent metadata;
- case 6 may become eligible only when its exact native reply pair itself proves
  the predecessor relation; SENDING/deferred state alone proves nothing;
- case 8 performs zero POST and fails closed;
- same-conversation predecessor, unique normal confirmation, action/source
  relation and immutable semantic-scope product are re-proven at S2;
- the bounded reply identifiers may be durable topology metadata, but no quoted
  customer/public text or content-derived digest becomes durable.

### Q56 — handoff status × owner matrix is mutually exclusive
Parameterize the exact §43.0 owner classes across status:
1. `open + USER_OWNER`;
2. `open + UNASSIGNED`;
3. every supported status + `OTHER_AGENTBOT`;
4. every supported status + `OTHER_PROVEN_AI`;
5. `resolved|snoozed + USER_OWNER|UNASSIGNED|CONFIGURED_BABYPARK_AGENTBOT`;
6. `open|pending + CONFIGURED_BABYPARK_AGENTBOT`;
7. `pending + USER_OWNER|UNASSIGNED`;
8. `UNKNOWN_OWNER` or unknown/missing status.

Expected:
- cases 1–2 only => `HANDOFF_DONE / human_takeover`, zero BabyPark write;
- cases 3–5 => `OWNERSHIP_LOST / ownership_lost`, zero BabyPark write;
- cases 6–8 => unresolved durable HUMAN, zero current automated write;
- no tuple matches more than one row;
- a valid non-AgentBot AI owner such as `Captain::Assistant` never becomes
  human/unassigned takeover;
- unknown/malformed ownership never becomes a terminal success merely because
  it is not the configured AgentBot.

### Q57 — deployed Chatwoot v4.18 toggle_status is not a safe automated handoff primitive
Bind this vector to the deployed/source tuple required by the Stage-0
verification manifest. Prove from source that:
- account conversation access authorizes AgentBot callers through
  `ConversationPolicy` without requiring current assignment to that caller;
- `bot_handoff?` checks AgentBot caller + current `pending` + requested
  `open`, but not current configured-BabyPark ownership and exposes no
  expected-owner/status CAS/idempotency predicate;
- `bot_handoff!` clears `ai_assignee`, opens and dispatches the handoff event;
- generic status handling can set `open` when request-time state is no longer
  `pending`;
- assignment service may independently assign another AgentBot and set
  `pending`.

Race the BabyPark pre-read against another AgentBot/AI owner, `resolved`,
`snoozed`, human/open takeover and unchanged pending+configured ownership.

Expected:
- current Website First Line performs **zero automated `toggle_status(open)`
  writes** on deployed v4.18.0;
- another-owner race cannot be displaced by BabyPark;
- resolved/snoozed races cannot be reopened;
- human/open race is discovered only by later read-only reconciliation and is
  never overwritten;
- unchanged pending+configured remains durable HUMAN with operator-attention/
  manual-native transfer rather than unsafe automation;
- a future automated primitive is allowed only after a fresh Agreement §§1–3
  native-first fit gate proves its write atomically enforces current expected
  ownership/status or is monotonic-safe under all intervening states;
- Chatwoot core patch/fork is never an allowed workaround.

### Q58 — ownership wire decoder is strict, Enterprise-aware and fail-closed
Bind the decoder to the exact deployed account-conversation serializers. Exercise:
1. `assignee_type='User'` + positive numeric `assignee.id`;
2. `AgentBot` + configured positive ID;
3. `AgentBot` + different positive ID;
4. deployed Enterprise `Captain::Assistant` + positive ID;
5. both assignee type/object absent;
6. unknown non-null assignee type;
7. known type with absent/invalid/string/coerced ID;
8. object present with absent type;
9. type present with absent object;
10. malformed object/unsupported status.

Expected:
- cases 1–5 decode exactly USER_OWNER, CONFIGURED_BABYPARK_AGENTBOT,
  OTHER_AGENTBOT, OTHER_PROVEN_AI and UNASSIGNED respectively;
- cases 6–10 decode UNKNOWN_OWNER/UNKNOWN_STATUS and fail closed;
- string IDs are not numerically coerced;
- only exact `User` can become USER_OWNER;
- `Captain::Assistant` is never treated as human merely because it is not
  `AgentBot`;
- current legacy repository `normalizeConversation()` behavior
  `type && type !== 'AgentBot' => humanAssigneeId` is explicitly **not**
  compliant C6 authority logic and MUST NOT be reused by future Website First
  Line handoff/authorization;
- any deployed serializer/runtime drift invalidates source-fit and blocks
  activation until re-reviewed.

## I. Handoff vectors

### H01 — HUMAN successful / already achieved by current ownership
- no AI public preface;
- before disposable execution may finish, planning-time HUMAN has a durable
  DIRECT_HUMAN origin or relay-originated HUMAN has immutable PUBLIC_ACTION
  origin plus durable HUMAN continuation in `episode.sqlite`;
- exact §43.0 decoding plus current status proves
  `open + USER_OWNER/UNASSIGNED`;
- no BabyPark status/ownership write is performed to establish this proof;
- only after that proof does a bound logical episode close as `human_takeover`;
- after human/non-AI queue ownership, AI sends zero public messages.

### H02 — unresolved/current-v4.18 handoff remains durable
- no false public "transferred" message exists;
- on deployed Chatwoot v4.18.0, open/pending +
  CONFIGURED_BABYPARK_AGENTBOT has no authorized automated handoff write.
  Website First Line does not call AgentBot `toggle_status(open)`; HUMAN
  remains durable and operator/manual handoff is required;
- pending + USER_OWNER/UNASSIGNED is unresolved rather than inferred takeover;
- UNKNOWN_OWNER/unknown status performs no write and keeps HUMAN durable;
  measured escalation raises §29.8.2 operator-attention without fabricating
  terminal success;
- loss/supersession/recreation of `copilot.sqlite` cannot lose either direct or
  action-attached HUMAN continuation;
- only if a future downstream stage separately proves/approves a safe automated
  primitive may an `episode.sqlite` handoff-attempt state be created. For that
  primitive, timeout/reset/unknown response does not prove non-commit, execution
  loss cannot erase the attempt, and another write requires durable positive
  deterministic non-commit evidence plus a fresh exact write-eligible read;
- reconcile/attention drivers are execution only, never sole semantic truth.

### H03 — ownership already left BabyPark AI
Parameterize supported status + OTHER_AGENTBOT/OTHER_PROVEN_AI, or
resolved/snoozed + USER_OWNER/UNASSIGNED/CONFIGURED_BABYPARK_AGENTBOT.

Expected:
- no native reopen/toggle write and no public AI message;
- proven other AI ownership maps only to `OWNERSHIP_LOST`, never
  `HANDOFF_DONE`;
- HUMAN terminalizes as `OWNERSHIP_LOST`;
- a bound episode closes as `ownership_lost`;
- later customer events do not revive that closed episode automatically.

### H04 — duplicate trigger / later public outgoing
Duplicate webhook/reconcile trigger, or a later public outgoing from a human,
template/other AI owner, must not create a duplicate handoff or stale AI action.

Expected:
- the strict decoder + disjoint status×owner matrix wins over the old trigger;
- no public handoff preface;
- current deployed v4.18.0 performs no autonomous status/ownership write for
  open/pending + configured BabyPark AgentBot;
- resolved/snoozed is never reopened and another AI owner is never displaced;
- if later exact read proves `open + USER_OWNER/UNASSIGNED`, H01 may close
  `human_takeover` without a BabyPark status write.

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

## T. C5 deterministic renderer / exact-locale acceptance

### T01 — exact response locale, no presentation fallback
`response_locale=uk`. Catalog product has `localized.ru.title/url` but no
`localized.uk` entry. The selected template is a shortlist presentation template that
requires title.

Expected:
- C4 => HUMAN / PRODUCT_PRESENTATION_NOT_AVAILABLE;
- no RU title/URL enters public payload;
- no product ID is substituted as presentation;
- WebsiteRenderer is not called for a public ANSWER.

### T02 — presentation absence does not block templates that do not need it
Same product has no exact-locale title, but current decision is
PRODUCT_PRICE_SINGLE or STORE_STOCK and its template payload contains no title.

Expected: ANSWER remains permitted using only the exact typed payload; C5 does
not perform a Catalog lookup merely to decorate it.

### T03 — renderer is a closed pure adapter
For every ANSWER/CLARIFY template in DESIGN §16.2, run both `uk` and `ru`.

Expected:
- exact allowlisted template branch only;
- no language detection/fallback;
- no Catalog/Knowledge/Chatwoot/network/LLM call;
- unknown template, missing locale branch, missing/extra payload key or wrong
  primitive type => renderer failure and zero public POST;
- every CLARIFY template requires `render_payload=null`; `{}` or any non-null
  CLARIFY payload is rejected.

### T04 — payment-method code does not smuggle commercial conditions
Render `TPL_PAYMENT_METHODS_V1` containing `COD_NOVA_POSHTA` in both locales.

Expected: deterministic method name only. No percentage, fee, amount, timing or
other condition is present unless a future separately reviewed typed authority
and template contract is frozen.

### T05 — critical values are copied/formatted, never semantically rewritten
Parameterize price single/range, prepayment, return-period days/exclusion flag,
phone E.164, store current open/close time, full today-schedule interval lists,
stock boolean and variant prices.

Expected: output derives exactly from typed payload according to locale-specific
formatting rules; no LLM/paraphrase may change a number, boolean, phone or time.

### T06 — CLARIFY public/private candidate separation
A candidate CLARIFY carries private canonical IDs and public
`bp-choice:<ordinal>` + label rows.

Expected: renderer receives only public token+label; rendered text/content
attributes expose no canonical ID. Structured selection maps the ordinal back to
the separately persisted private reservation.

### T07 — exact uk/ru golden wording
For every 17 ANSWER and 7 CLARIFY template IDs in DESIGN §40.4, run exact valid
payload/choice controls in both `uk` and `ru`. Exercise every conditional
wording branch, not merely one example per template: STORE_OPEN_STATUS
open+close/open+null/closed; STORE_HOURS_TODAY empty and non-empty with both
`open_now` values; RETURN_PERIOD purchase-day excluded/included;
VARIANT_LIST_PARTIAL named>0/named=0; STORE_STOCK in/out × label/no-label; and
shortlist single/range price, URL null/non-null and partial-model false/true.

Expected:
- emitted content is byte-for-byte the frozen branch after only §40.3
  substitutions/joins;
- no plural library, translation lookup, locale fallback or paraphrase;
- every fixed and conditional branch exists in both locales;
- payment codes map only to the exact frozen method names; UK `CASH_COURIER`
  uses U+2019 in `готівкою кур’єру` and remains visibly unchanged under the
  verified typographer.

### T08 — Website/Text renderer envelope is closed
Parameterize ANSWER, finite-choice CLARIFY, free-text MONEY/ANCHOR CLARIFY and
HUMAN.

Expected:
- ANSWER -> exact `bp.first-line.website-render/1` text shape;
- Website `content` is 1..150000 Unicode code points after all Website
  transport encoding; 150001 fails closed before any POST;
- the length primitive is explicitly regression-tested as **code-point**, not
  JavaScript UTF-16-unit, counting: 150000 U+1F600 characters are at the bound
  even though JavaScript `.length` is 300000, while 150001 U+1F600 characters
  fail; mixed BMP/astral controls obey the same rule;
- finite CLARIFY -> exact `input_select` shape; `content` is
  `<prompt>\n1. <encoded-label>\n2. <encoded-label>...` with no trailing LF,
  while ordered items are exactly
  `{title:String(ordinal),value:token}` and contain no dynamic label;
- MONEY/ANCHOR -> exact text shape with `content_attributes={}`;
- HUMAN -> `null`;
- TextRenderer -> exact text-render shape or `null`; finite CLARIFY bytes are
  exactly `<prompt>\n1. <label>\n2. <label>...` with LF separators and no
  trailing newline/token;
- cards/template params/provider metadata/private candidate values are impossible;
- C5 performs no DB/file/cache/outbox write and does not persist/log rendered
  content, dynamic labels/URLs, choice labels/tokens or a content-derived digest.

### T09 — Chatwoot Liquid re-interpretation is fail-closed
Use otherwise-safe public title/variant/choice strings containing
`{{contact.email}}`, `{{agent.name}}` and `{% assign x = 1 %}`. For
`product_url`, include a genuine C4-canonical URL whose query still contains a
literal `{{agent.name}}`, plus a control where raw braces in the path have
already become canonical `%7B%7B...%7D%7D`. Include normal brace/non-Liquid
controls.

Expected:
- any dynamic Website content string **as received from genuine C4** containing
  literal `{{` or `{%` is rejected before a render result;
- a canonical percent-encoded brace sequence contains no Liquid opening
  delimiter and remains inert transport-neutral plain text;
- final content is checked again; every input-select title must equal its
  generated unsigned ASCII ordinal exactly;
- normal non-Liquid brace controls remain representable through transport-neutral
  entity encoding;
- renderer never wraps content in Liquid raw/endraw tags;
- rejected input can produce zero public POST.

### T09a — Chatwoot native views cannot reinterpret dynamic factual text
For ordinary ANSWER and finite CLARIFY content, use otherwise-valid dynamic labels
containing `[Коляска](https://evil.example)`,
`Коляска https://evil.example Blue`, `Blue *bold* _x_ #tag`,
`First.Go`, `200*90 см`, `Black_1`, HTML-shaped controls such as
`<b>Blue</b>`, `<a href="https://evil.example">Click</a>` and
`<img src="https://evil.example/pixel.png">`, entity/backslash controls such as
`&copy;` and a trailing `\`, plus exhaustive single-code-point coverage for
all 32 ASCII punctuation characters and compound typographer/link controls such
as `...`, `--`, `---`, `(c)`, apostrophes/quotes, domains and emails.
For `product_url`, include ordinary production-shaped URLs plus C4-safe
trailing `)` / `.`, percent escapes, `^`, `|` and incomplete `%`
controls.

Expected:
- every dynamic factual label **and canonical product URL** placed in Website
  `content` is encoded by the exact DESIGN §40.3 uppercase-hex numeric-entity
  algorithm for ASCII punctuation;
- the deployed Web Widget Markdown + DOMPurify path displays the exact original
  normalized/canonical text and creates zero dynamic link/image/emphasis/code/HTML
  element;
- for finite `input_select`, the deployed agent Dashboard `Form.vue` +
  DOMPurify path displays that same exact original label/URL text from the stored
  transport content, with no visible transport escapes and zero dynamic
  link/image/HTML element;
- every punctuation/property/HTML-shaped control round-trips visibly on both
  applicable native views;
- finite CLARIFY keeps all such C4-safe labels representable: the numbered
  `content` list carries the encoded labels, while C5-created native
  input-select button titles are only `"1"`, `"2"`, ... and values remain
  the exact `bp-choice:<ordinal>` tokens;
- Website v1 intentionally produces **no dynamic hyperlink**; a non-null
  `product_url` is exact visible non-clickable plain text. TextRenderer keeps
  the raw canonical URL and does not apply Website transport entity encoding.

### T09b — Chatwoot runtime drift blocks WebsiteRenderer activation
Repeat the verified v4.18.0 transport checks against the exact target deployment
before first activation and after a Chatwoot package/source/build change
affecting message creation, Liquid, Web Widget Markdown, Dashboard
`input_select` presentation, `input_select` submission/echo or message content
limits.

Expected:
- the target package/tag/Git source tuple and relevant locked parser/sanitizer
  versions are explicitly proven;
- because production `public/vite/**` is gitignored, the current production
  Vite manifest and every manifest-selected relevant browser chunk/source map are
  content-bound; source-map content byte-matches the inspected tracked source or
  an equivalently content-bound reproducible-build proof is supplied;
- unchanged verified behavior permits the ordinary C5/C6 deployment gate to
  continue;
- version/source/bundle mismatch, missing bundle/source-map/build provenance,
  changed behavior or unavailable proof blocks WebsiteRenderer activation/send;
- no old v4.18.0 assumption is silently reused and no Chatwoot core patch is
  introduced to force compatibility.

### T09c — submitted input-select title is untrusted presentation data
Start from a genuine finite CLARIFY render whose C5-created items are exactly
`{title:"1",value:"bp-choice:1"}`, `{title:"2",value:"bp-choice:2"}`, ...
Exercise the normal native click and direct Widget PATCH mutations that keep an
otherwise-valid exact `value` while changing, omitting or replacing
`submitted_values[0].title` with arbitrary text/markup. Also exercise wrong,
missing, multiple and unknown submitted values.

Expected:
- normal unmodified Widget interaction submits/displays the generated ordinal;
- Chatwoot's client-supplied submitted title is never treated as BabyPark
  authority and is never mapped back to a Catalog/Knowledge fact;
- BabyPark structured-selection proof consumes only the exact single
  `submitted_values[0].value` and the existing action/source/episode
  provenance; title bytes cannot change the selected ordinal/canonical value;
- wrong/missing/multiple/unknown `value` still fails closed under the existing
  C2/C4/C6 reauthorization contract;
- a tampered title that Chatwoot chooses to display remains customer-originated
  presentation data, not an AI factual claim; no Chatwoot core patch is required
  merely to suppress or rewrite it.

### T10 — critical formatting is exact and UAH-only
Golden vectors include `2730000 -> 27 300 грн`,
`2730050 -> 27 300,50 грн`, `50 -> 0,50 грн`, a non-UAH currency, E.164,
HH:MM, two schedule intervals, integer counters, equal-vs-strict price range,
full variant list and partial variant lists with named>0/named=0.

Expected:
- exact §40.3 bytes for UAH;
- non-UAH => `FIRST_LINE_RENDERER_INVALID`;
- range requires min<max; equal values under RANGE reject;
- full variant-list requires named=total>0; partial requires total>named>=0 and
  named=0 uses the frozen no-label wording rather than an empty list placeholder;
- phone/time bytes unchanged;
- schedule uses U+2013 and `, `;
- no locale/runtime fallback or LLM.

### T11 — renderer requires genuine C4 decision provenance
Render genuine C4 ANSWER/CLARIFY/HUMAN controls, then try
`structuredClone(decision)` and a hand-built exact-shape object with identical
public bytes.

Expected:
- only the genuine C4 decision may render;
- clone/forgery => `FIRST_LINE_RENDERER_INVALID`;
- mutate/construct a genuine-shape public tuple with an impossible
  `reason -> template_id` pair and it is rejected even if each individual field
  is otherwise allowlisted;
- provenance check exposes no private DecisionBasis/context and never tries to
  reconstruct a private request family.

### T12 — shortlist stays text-only in C5 v1
Render TOP3/ALL with exact-locale safe title, min=max/range, optional URL,
optional image URL and `partial_model_match` true/false.

Expected:
- WebsiteRenderer uses `content_type=text`, never `cards`;
- exact numbered rows and frozen partial-match phrase;
- product URL, when present, is copied literally by TextRenderer; WebsiteRenderer
  uses the exact reversible §40.3 transport-entity encoding so the visible
  canonical URL is unchanged, non-clickable and creates zero dynamic `<a>`;
- image URL is neither rendered nor fetched;
- zero products use only `TPL_SHORTLIST_EMPTY_V1`.

### T13 — renderer failure is terminal for this send attempt
Parameterize forged decision, unknown template/reason tuple, missing locale
branch, invalid payload, unsupported currency, Liquid-unsafe dynamic string,
final Website content at 150000/150001 Unicode code points (including the astral
U+1F600 boundary that differs from JavaScript UTF-16 `.length`) and invalid
output shape.

Expected:
- one `FIRST_LINE_RENDERER_INVALID` failure family;
- no fallback content and no old/prepared render reuse;
- no renderer output/log/cache/digest is durable;
- C5 performs no Chatwoot/network call. C6 **must** treat renderer failure as
  zero public POST and transfer the current-revision continuation to the durable
  native-HUMAN path frozen in DESIGN §§29.7–29.8; C5 itself still claims no
  renderer/send integration.

## U. C6 send-time semantic reauthorization

### U01 — dynamic value changes, descriptor stays the same
Prepare PRODUCT_PRICE_RANGE. Before relay send, min/max change but current C4
still returns PRODUCT_PRICE_RANGE with the same template/locale.

Expected:
- final topology snapshot passes;
- relay exact-rereads/rebuilds C2->C4 and rereads current Catalog authority;
- durable action contains no old price;
- renderer sends only the new current min/max;
- one POST maximum.

### U02 — semantic descriptor changes before send
Prepare PRODUCT_PRICE_RANGE; current authority changes so fresh C4 returns
PRODUCT_PRICE_SINGLE. Repeat with a policy/operational decision changing to HUMAN.

Expected:
- old action performs zero POSTs;
- no old payload is used;
- if no strictly newer revision/replacement owns continuation, durable native
  HUMAN ownership replaces the relay claim rather than orphaning the same
  revision as STALE;
- same-revision idempotency is not bypassed by silently mutating the old action.

### U03 — stock/policy value may change under the same descriptor
Prepare STORE_STOCK=yes, then current exact stock becomes no while reason/template
remain STORE_STOCK. Repeat with PREPAYMENT amount changed but still valid.

Expected: fresh no/current amount is rendered and sent; prepared dynamic value is
not available because it was never durable.

### U04 — CLARIFY reservation must remain exact
Prepare candidate CLARIFY. Preparing it atomically consumes persisted budget
0->1 and binds `clarification_action_id`. Before send, either leave semantics
unchanged or change candidate membership/order, requested slot, reason, template
or locale.

Expected:
- EpisodeStore may issue a transient reservation attestation only to the exact
  owning PREPARED/current-GATING CLARIFY whose episode version, action id,
  requested slot and candidates still match the active reservation;
- that attestation gives only this reauthorization an effective pre-reservation
  budget 0, so an unchanged prompt survives restart and may send exactly once;
- any competing/new action sees persisted budget 1 and cannot reuse the override;
- changed reservation/descriptor => zero POST; do not mutate the reserved prompt;
- after SENDING/UNCERTAIN, budget remains consumed under ordinary rules.

### U05 — restart recovery rebuilds semantics rather than deserializing DecisionBasis
Crash after PREPARED/GATING and reopen `episode.sqlite` with no in-process
DecisionBasis/renderer payload.

Expected:
- action is recoverable from identifiers/descriptor/provenance only;
- exact Chatwoot bodies are reread transiently;
- a new genuine DecisionBasis is built;
- current dynamic authority is reread;
- no raw/normalized customer body, content digest or dynamic factual payload is
  recovered from durable storage because none exists there.

### U05a — continuation selection discharges exactly one old ambiguity after restart
Prepare+confirm a CLARIFY, prove and commit one candidate/requested-slot
selection, then restart before the continuation ANSWER is planned. Parameterize
identity/variant selections, C43 category anchor and C40 concrete
`max_price_minor` MONEY selection.

Expected:
- the unique CONFIRMED CLARIFY action plus its original `basis_event_seqs` rebuild
  the original request-family context;
- exactly the reserved unresolved slot is replaced by the proven durable stable
  value before identity/cardinality/family reduction;
- unrelated original constraints remain (for example the prior max price, or the
  category/brand anchor while money is filled);
- for MONEY, old AMBIGUOUS_MONEY is removed and the proven UAH upper bound is fed
  to the original objective-shortlist family;
- the old AMBIGUOUS row cannot coexist with the replacement and cannot trigger
  renewed CLARIFY/CLARIFY_EXHAUSTED/UNSUPPORTED_CONSTRAINT;
- ambiguous/missing/mismatched provenance fails closed; prompt budget stays 1.

### U06 — reauthorization failure is never permission to send prepared content
Parameterize exact-read failure, C2/C3 certification failure, current authority
failure, unknown C4 tuple, renderer validation failure and descriptor mismatch.

Expected: zero public POST. Pre-SENDING authority-read retry is allowed only
under the separately reviewed evidence-bound timing/retry policy and while the
current claim/deadline remain valid; otherwise fail open to durable native HUMAN.
A previously prepared render payload is never a fallback because no such payload
is durable.

### U07 — mutable structured selection is re-proven immediately before send
A stable slot was committed from `STRUCTURED_SUBMISSION` on confirmed CLARIFY
message M, and an ANSWER action is PREPARED/GATING. Without any new customer
ledger event or stream revision, mutate M's `submitted_values` from reserved A to
reserved B, unknown, empty or multiple.

Expected:
- final reauthorization recognizes the slot's structured provenance and exact-
  reads M again;
- only unchanged A that still proves against the same confirmed action/
  reservation/stable value may continue;
- any mutation => zero POST and native HUMAN fail closed; no stable-slot rewrite;
- restart between selection commit and final gate does not weaken the check.

### U08 — canonical semantic scope is immutable action provenance
Prepare each reviewed family with certified effective combinations of
PRODUCT/variant, CATEGORY/match_mode, BRAND, STORE and MONEY slots, including
null/absent controls. For MONEY cover no bounds, min only, max only and both
bounds. Reauthorize with either identical slots or exactly one changed canonical
slot/bound while keeping public descriptor fields equal.

Expected:
- the prepared action stores only descriptor version + exact typed semantic
  scope, never text/extraction/dynamic business facts;
- C4 derives scope from every effective certified slot/constraint it actually
  consumes after clarification/continuation; caller-supplied/pruned scope is
  rejected;
- no money constraint is exactly `money=null`; otherwise scope contains UAH plus
  nullable `min_price_minor` and `max_price_minor`, with at least one bound;
- same max/different min and same min/different max are semantic-scope mismatches;
- exact scope equality is required before send;
- one changed canonical slot/bound => zero POST + durable HUMAN continuation;
- current dynamic facts/presentation may change under an identical scope as
  allowed by U01/U03.

### U09 — S1 semantic rebuild is non-authorizing; S2 is final topology authority
Allow optional preflight, exact transient customer reads, one variable extraction
draft, deterministic C2/C3, fresh C4 Catalog/Knowledge/`now` and deterministic
C5 to complete in S1. Interleave ownership/status, topology, customer-text,
structured-submission and dynamic-authority changes at each boundary before S2.

Expected:
- every S1 result remains non-authorizing even when it is fully rendered;
- S2 is one whole-conversation statement snapshot and is the last complete
  Chatwoot topology authority before local send admission;
- newly ingested relevant event at S2 invalidates/discards the S1 result;
- covered customer text is exact-reread after S2 and must byte-match the S1
  semantic input before the same extraction/capabilities are re-certified;
- mutable structured selection used by the decision is exact-reread/re-proven
  after S2;
- current conversation ownership/status is exact-read **after** those S2 text/
  structured proofs and is the final external ownership gate before local CAS;
- C4 dynamic authority was freshly read immediately before S2; dynamic changes
  after the final C4 read are the explicitly accepted irreducible cross-system
  race, not permission to reuse older prepared facts;
- the final CAS rechecks origin/action/HUMAN absence plus
  lease/revision/episode/reservation/deadline;
- only unchanged S2 topology/text/structured proof + final current ownership +
  CAS permits the one POST attempt.

### U10 — SENDING has exactly one POST attempt and monotonic reconciliation
From SENDING, parameterize successful 2xx, timeout/reset, all HTTP failure
classes, response/webhook/read reordering, process crashes and source-tag
cardinality 0/1/>1. Race unique source proof against the durable HUMAN-escalation
commit at the reconciliation deadline.

Expected:
- no path performs a second POST for the same action id;
- one unique authoritative tagged BabyPark reply observed/committed before HUMAN
  escalation produces normal CONFIRMED idempotently;
- caller/reconciler racing after normal confirmation cannot regress it to
  UNCERTAIN/HUMAN;
- zero tag remains unproven and, after the bounded window, attaches durable HUMAN
  continuation to the immutable PUBLIC_ACTION origin;
- if HUMAN continuation commits first, later unique proof is historical
  late-remote evidence only and cannot restore AI/C25/episode continuation;
- >1 tags fail closed to HUMAN/anomaly handling instead of choosing a row.

### U11 — same-revision rejection has durable HUMAN continuation
Parameterize HISTORY_UNPROVABLE, source deletion/reclassification, descriptor or
scope mismatch, renderer failure, expired deadline and permanent reauthorization
failure where no newer revision/standalone replacement owns continuation.

Expected:
- zero public POSTs;
- action/turn is not left as terminal STALE/CANCELLED/NOT_SENT silence;
- a planning-time HUMAN has DIRECT_HUMAN origin; a rejected PUBLIC_ACTION keeps
  its immutable origin/action_id and atomically attaches durable HUMAN
  continuation rather than being replanned into another origin;
- before any disposable job/claim may disappear, HUMAN continuation is durable
  in the `episode.sqlite` semantic concern;
- execution/reconcile jobs may drive handoff but are not sole semantic truth;
- a bound episode closes only after the strict §43.0 decoder + §43.2 matrix
  proves either `open + USER_OWNER/UNASSIGNED` (`human_takeover`) or an exact
  `OWNERSHIP_LOST` row; configured-bot, pending human/unassigned, unknown owner
  or unknown status keeps HUMAN live.

### U12 — corrupted durable semantic metadata never acquires new meaning
Parameterize candidate count/ordinal holes and duplicates, mixed slot names,
detached episode/version, cross-stream/missing basis event, broken clarification
back-reference/confirmation provenance, conflicting semantic-origin fences and
every invalid deferred-parent relation from Q36/Q45.

Expected:
- persisted reads/admission fail closed before public side effects;
- an ordinal is never renumbered after corruption;
- no action with unprovable episode/basis/origin ownership reaches SENDING;
- missing/cross-stream/non-customer/conflicting deferred metadata cannot be
  silently repaired into a different chronology or parent;
- corruption recovery cannot create a second CLARIFY, replace an immutable
  semantic origin, release post-SENDING budget or authorize an AI action from
  unprovable topology.

### U13 — C25 survives restart through normal-confirmed predecessor scope, not promotion
Prepare a PRODUCT_PRICE_RANGE action and crash at PREPARED/GATING/SENDING/
UNCERTAIN. Exercise both normal confirmation before HUMAN and late unique source
proof after HUMAN. Cover exact-message product identity and a product stable slot
derived from native STRUCTURED_SUBMISSION.

Expected:
- no lifecycle state, including normal CONFIRMED, creates/rewrites a C25 product
  stable slot merely because the range answer exists;
- normal confirmation preserves immutable predecessor semantic-scope
  `product_id` plus authoritative action/source relation across restart;
- any existing stable product selection keeps its original
  `derived_through_event_seq`; if structured, C25 re-proves current
  `submitted_values` before send;
- the dependent turn must be exactly one supported Website customer message
  whose current exact read proves both native reply fields to the unique
  normal-confirmed predecessor, and must satisfy one exact frozen §21.1
  VARIANT_PRICE_LIST predicate independently of model `intent_hint`; only then
  may it use predecessor scope product_id and reread current variant prices;
- event_seq, Chatwoot message-id magnitude, created_at, webhook order and
  deferred-parent metadata never substitute for the native reply proof;
- late source proof after HUMAN is never a C25 predecessor;
- any missing/mutated/mismatched native reply pair or predecessor/stable
  provenance, near-miss language or new identity/constraint makes old product
  context unavailable;
- predecessor variant_id, old price/label/render bytes are never inherited.

### U14 — timing authority is measured/configured, not guessed
Provide one evidence-bound configuration and parameterize invalid relationships
between lease, pre-SENDING external-call budgets, POST timeout, action/turn
deadline, read retry budget, UNCERTAIN reconciliation window and HUMAN
handoff/escalation window.

Expected:
- production code contains no acceptance-derived guessed duration;
- startup/config verification rejects unsafe relationships before work is
  claimed;
- lease expiry before final CAS yields zero POST and fresh reconstruction under a
  new claim;
- after SENDING, timing governs reconciliation/HUMAN escalation but never permits
  a second public POST;
- elapsed timing alone never proves an outcome-unknown native handoff request did
  not commit and never authorizes blind handoff retry;
- unavailable Chatwoot past the escalation window raises durable operational
  attention while HUMAN stays live, rather than fabricating HANDOFF_DONE.

The prior v0.7 acceptance corpus remains frozen for Slice C umbrella issue #75.
C1/C2a/C2b/C2c/C3 are merged under their previously reviewed contracts and C4
is merged via PR #107 on canonical main
`565f8eb30bf39afa80bb4d59258cc2fd13aa67d5`, including the CATEGORY
`(category_id,category_match_mode)` prerequisite and its HEAVY closure.

T07–T13 remain the merged C5 acceptance contract. v0.8 adds the C6/C25
pre-implementation safety vectors Q33–Q58 and U08–U14, extends the C25 corpus
through C25h, and tightens Q21/Q22/Q24/Q26/Q29/H01–H04. The exhaustive vectors
cover:
- immutable same-revision semantic origins plus monotonic PUBLIC_ACTION -> HUMAN
  continuation rather than destructive outcome replacement;
- stream/revision HUMAN ownership, NOT_SENT prohibition and CLARIFY-budget
  retention;
- permanent NON_ACTIONABLE_ACK silence only after the closed deterministic
  exact-text proof plus one unchanged-basis owning-store admission CAS that
  atomically commits ACK/current-episode close, never model/extraction/C3
  confidence or stale routing state;
- late remote-send proof that can never reverse HUMAN or become C25 context;
- atomic/corruption-checked deferred-behind-action customer events that remain
  scheduling/topology only and never causal inheritance evidence;
- exact symmetric ru/uk §21.1 target matcher behavior plus an explicit known
  merged-C4 Ukrainian-forward drift that blocks C25 production/activation until
  one shared production matcher proves exact parity;
- C25 causal dependency only through the exact Website native
  `in_reply_to + in_reply_to_external_id` pair to the unique normal-confirmed
  range predecessor, re-proven at S2;
- complete canonical semantic scope including non-negative nullable lower/upper
  UAH customer-money bounds and fail-closed currency/range/provenance integrity;
- S1 non-authorizing semantic rebuild followed by final S2 Chatwoot topology,
  exact text/structured/C25-causality proof, final current ownership/status and
  local CAS;
- stale-backup recovery barriers for silent ACK/HUMAN/action ownership;
- semantic liveness plus operational escalation when Chatwoot authority cannot
  prove physical handoff;
- self-contained state-reconciled native handoff/ownership_lost with an exact
  Enterprise-aware wire-owner decoder and mutually exclusive status×owner
  matrix; deployed v4.18.0 `toggle_status(open)` is forbidden for Website First
  Line because its write-time ownership/status predicate is unsafe. Current
  unresolved ownership stays durable HUMAN/operator-manual, while any future
  separately proven safe primitive must use the durable `episode.sqlite`
  attempt/dispatch no-retry boundary.

It selects no implementation product or scheduler and adds no production code.
C5 remains unconnected/not deployed and performs no Chatwoot POST. C6/C25
implementation remains downstream of this contract freeze and the
Agreement-required fresh implementation-options gates.

