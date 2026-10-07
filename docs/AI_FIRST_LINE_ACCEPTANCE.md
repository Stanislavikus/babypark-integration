# BabyPark AI First Line — Acceptance Corpus v0.7

Status: FROZEN — Event Ledger v0.7 architecture + C5 renderer acceptance freeze
Applies to: BabyPark AI First Line Website v1 / Slice C acceptance contract.
Supersedes: `docs/AI_FIRST_LINE_ACCEPTANCE.md` at canonical main `565f8eb30bf39afa80bb4d59258cc2fd13aa67d5`.
Companion: `docs/AI_FIRST_LINE_DESIGN.md`
Historical research baseline: `e4b3989f852d5de4a868a6f72867b87cb64f8b2d`.
Contract amendment base: canonical main `565f8eb30bf39afa80bb4d59258cc2fd13aa67d5`.

This file is the single normative acceptance corpus for AI First Line v0.7. It
incorporates the complete v0.6 acceptance delta and subsequent v0.7 freezes; no
separate delta document is required to interpret expected behavior.

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
| C25 | "Да, покажите точные цены вариантов" after a range answer; all IN_STOCK priced variants have safe labels. | ANSWER / VARIANT_PRICE_LIST with `TPL_VARIANT_PRICE_LIST_V1`; payload contains label+current_minor only, no IDs/SKU. |
| C25a | Same factual price list but at least one priced variant has no safe display label. | HUMAN / PRODUCT_VARIANT_NOT_RESOLVABLE; do not expose variant_id/SKU and do not publish a partial unlabeled price list. |
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
- payment codes map only to the exact frozen method names.

### T08 — Website/Text renderer envelope is closed
Parameterize ANSWER, finite-choice CLARIFY, free-text MONEY/ANCHOR CLARIFY and
HUMAN.

Expected:
- ANSWER -> exact `bp.first-line.website-render/1` text shape;
- Website `content` is 1..150000 Unicode code points after all Markdown
  transport encoding; 150001 fails closed before any POST;
- finite CLARIFY -> exact `input_select` shape; `content` is
  `<prompt>\n1. <encoded-label>\n2. <encoded-label>...` with no trailing LF,
  while ordered items are exactly
  `{title:String(ordinal),value:token}` and contain no dynamic label;
- MONEY/ANCHOR -> exact text shape with `content_attributes={}`;
- HUMAN -> `null`;
- TextRenderer -> exact text-render shape or `null`; finite CLARIFY bytes are
  exactly `<prompt>\n1. <label>\n2. <label>...` with LF separators and no
  trailing newline/token;
- cards/template params/provider metadata/private candidate values are impossible.

### T09 — Chatwoot Liquid re-interpretation is fail-closed
Use otherwise-safe public title/variant/choice/product-URL strings containing
`{{contact.email}}`, `{{agent.name}}` and `{% assign x = 1 %}`. Include normal
brace/non-Liquid controls.

Expected:
- any dynamic Website content string containing `{{` or `{%` is rejected
  before a render result;
- final content is checked again; every input-select title must equal its
  generated unsigned ASCII ordinal exactly;
- normal non-Liquid brace controls remain representable through Markdown-neutral
  encoding;
- renderer never wraps content in Liquid raw/endraw tags;
- rejected input can produce zero public POST.

### T09a — Chatwoot Markdown cannot reinterpret dynamic factual text
For ordinary ANSWER and finite CLARIFY content, use otherwise-valid dynamic labels
containing `[Коляска](https://evil.example)`,
`Коляска https://evil.example Blue`, `Blue *bold* _x_ #tag`,
`First.Go`, `200*90 см`, `Black_1`, punctuation controls and an allowed
BabyPark product URL.

Expected:
- every dynamic factual label placed in Website `content` is encoded by exact
  DESIGN §40.3 ASCII punctuation escaping, so Chatwoot Markdown displays the
  original normalized factual text but creates no attacker-controlled
  link/image/emphasis/list/other markup;
- finite CLARIFY keeps all such C4-safe labels representable: the numbered
  `content` list carries the encoded labels, while native input-select button
  titles are only `"1"`, `"2"`, ... and values remain the exact
  `bp-choice:<ordinal>` tokens;
- after selection Chatwoot may echo only that generated ordinal, never a dynamic
  Catalog/Knowledge label through Markdown;
- the separately validated `product_url` stays unescaped and is the only
  dynamic URL intentionally linkifiable;
- TextRenderer does not apply Website Markdown or Liquid transport encoding
  because it is not a Chatwoot/Web Widget transport adapter.

### T09b — Chatwoot runtime drift blocks WebsiteRenderer activation
Repeat the verified v4.18.0 transport checks against the exact target deployment
before first activation and after a Chatwoot package/source change affecting
message creation, Liquid, Markdown, `input_select` or message content limits.

Expected:
- the target runtime/version and relevant source behavior are explicitly proven;
- unchanged verified behavior permits the ordinary C5/C6 deployment gate to
  continue;
- version/source mismatch, changed behavior or unavailable proof blocks
  WebsiteRenderer activation/send;
- no old v4.18.0 assumption is silently reused and no Chatwoot core patch is
  introduced to force compatibility.

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
- product URL, when present, is copied literally;
- image URL is neither rendered nor fetched;
- zero products use only `TPL_SHORTLIST_EMPTY_V1`.

### T13 — renderer failure is terminal for this send attempt
Parameterize forged decision, unknown template/reason tuple, missing locale
branch, invalid payload, unsupported currency, Liquid-unsafe dynamic string,
final Website content at 150000/150001 Unicode code points and invalid output
shape.

Expected:
- one `FIRST_LINE_RENDERER_INVALID` failure family;
- no fallback content and no old/prepared render reuse;
- C5 performs no Chatwoot/network call, so C6 can perform zero POST and follow
  its existing renderer-failure HUMAN/fail-closed path.

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
- action fails closed/stales and native HUMAN path owns continuation;
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

Expected: zero public POST. Retry only where the existing bounded authority
failure policy permits; otherwise fail open to native HUMAN. A previously
prepared render payload is never a fallback because no such payload is durable.

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

The v0.7 acceptance corpus remains frozen for Slice C umbrella issue #75.
C1/C2a/C2b/C2c/C3 are merged under their previously reviewed contracts and C4
is merged via PR #107 on canonical main
`565f8eb30bf39afa80bb4d59258cc2fd13aa67d5`, including the CATEGORY
`(category_id,category_match_mode)` prerequisite and its HEAVY closure.

This docs-only C5 amendment adds T07–T13 and contains no production renderer or
C6 implementation. These proposed acceptance rows become authoritative only after
merge. Production C5 must then run a fresh implementation-options scan and the
applicable verification/review closure under the then-current AI Working Agreement.
C6 send-time U01–U07 remains a separate downstream implementation stage.

