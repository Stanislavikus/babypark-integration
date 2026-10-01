# BabyPark AI First Line — v0.5 Normative Delta

Status: BLOCKER-ONLY REVIEW
Base design: `docs/AI_FIRST_LINE_DESIGN.md` at v0.4 HEAD `c8c4a98c2032a8438d24502c7ed9bb6ad83dad2b`
This delta is normative and supersedes conflicting v0.4 wording.

## 1. Why v0.5 exists

v0.4 review found:
1. `store.special_hours` civil-day semantics were not enforced at publication;
2. clarification-count semantics were inconsistent in the corpus;
3. BabyPark requires an explicit Drupal → Magento store-identity/source-of-truth contract so physical-store hours and stock do not become provider-specific or contradictory.

No general market/RAG/recommendation research is reopened.

## 2. Canonical physical-store identity

Before store-scoped OperationalFacts become production authority, BabyPark must have provider-neutral stable store identities.

Extend the existing IdentityStore conceptually with:

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
  first_seen_at
  last_seen_at
}
```

Exact schema migration/version is implementation work; invariants are frozen:

- `store_id` is BabyPark canonical identity.
- Provider-native IDs are xrefs, never customer-facing authority IDs.
- Current Drupal store/location identifier maps to canonical `store_id`.
- Future Magento MSI `source_code` maps to the same canonical `store_id`.
- Future 1C/SaaS warehouse/store identifiers may map to the same canonical `store_id`.
- Mapping is reviewed/deterministic; no fuzzy automatic matching by name/address.
- One provider-native source maps to exactly one canonical store.
- v1 requires one active physical Magento source per canonical physical store; ambiguous many-to-one/one-to-many mapping fails preflight.
- Retired stores are tombstoned; stable IDs are never reused.

## 3. Field-level source-of-truth matrix

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

No resolver may answer a physical-store-hours question from Chatwoot or Magento text fields.

## 4. Magento cutover contract

Magento does not redefine BabyPark stores.

Before an accepted Magento-derived catalog/stock generation can replace the current provider:

1. enumerate every Magento MSI Source used as a physical BabyPark inventory/pickup location;
2. explicitly bind every applicable `source_code` to an existing canonical `store_id`;
3. reject unmapped, duplicate or conflicting bindings;
4. emit canonical Catalog `stores.store_id` / `store_stock.store_id` using those stable IDs;
5. keep all existing store-scoped Knowledge revisions valid unchanged;
6. keep AI tools provider-neutral: no prompt/template/resolver branches on Drupal vs Magento.

Magento provider cutover therefore changes the adapter/xref layer, not the AI fact model.

## 5. Magento evidence behind the boundary

Current Adobe Commerce / Magento Inventory APIs model physical inventory locations as MSI Sources.

Source data includes:
- immutable provider `source_code`;
- name;
- address/geolocation;
- contact phone/email;
- enabled state;
- pickup-location metadata.

Source Items carry SKU/source quantity and status.

Native Source/Pickup structures do not provide a typed structured weekly opening-hours model.
Adobe documentation permits store hours to be placed inside pickup `frontend_description`, which is presentation prose.
Magento general Store Information also exposes “Store Hours of Operation” as free-form text rather than a typed per-MSI-source schedule.

Therefore those Magento text fields are deliberately not machine schedule authority.

## 6. Time activity predicate

All revisions require `effective_from_utc`.

General active predicate:

```
effective_from_utc <= now
AND
(expires_at_utc IS NULL OR now < expires_at_utc)
```

Open-ended `expires_at_utc = NULL` is allowed for approved baseline/long-lived authority where the namespace permits it.

Direct-publish overlays require finite expiry.

`now == expires_at_utc` is inactive.

## 7. Business-calendar timezone

`Europe/Kyiv` is the canonical store business-calendar timezone.

Use it for:
- weekly weekday/hour interpretation;
- “today”;
- local opening/closing clock comparisons;
- conversion of local date boundaries to UTC;
- human input such as “до кінця дня”.

Stored authority boundaries remain absolute UTC instants.

## 8. store.special_hours publication invariant

`store.special_hours` is a daily schedule replacement and must be exactly one local civil day.

For declared local date D:

```
effective_from_utc =
  instant(start of D in Europe/Kyiv)

expires_at_utc =
  instant(start of D+1 in Europe/Kyiv)
```

Publication rejects any other envelope.

Opening intervals (for example 11:00–18:00) live inside the effect only.
They are not revision expiry boundaries.

A multi-day special schedule is represented as one immutable revision per local civil day.

This deliberately handles 23/25-hour DST civil days by timezone conversion rather than fixed 24-hour arithmetic.

## 9. Other temporary overlays

`store.temporary_closure` and `store.status_override` are state-like overlays, not daily opening schedules.

They may span any finite interval:

```
effective_from_utc < expires_at_utc
```

Examples legitimately supported:
- closure for three whole days;
- closure from 15:00 today until 10:00 tomorrow;
- status override until 16:00.

They remain subject to the v0.4 subject + effect_family conflict rules.

## 10. Special-hours resolver semantics

While one valid `store.special_hours` revision is active for local civil date D:

- weekly baseline does not participate anywhere inside that civil-day envelope;
- local times inside the effect's open interval(s) resolve OPEN;
- local times outside those interval(s) resolve CLOSED;
- baseline cannot “reopen” the store later that same day.

Example:

```
weekly: 10:00–20:00
special-hours date D: 11:00–18:00
revision envelope: local midnight D → local midnight D+1
```

At 18:30 on D:
- special-hours revision remains active;
- time is outside its opening interval;
- store is CLOSED;
- weekly baseline does not supply 18:00–20:00.

At local midnight beginning D+1:
- special-hours revision expires;
- weekly baseline may apply again.

## 11. Clarification counter is prompt-based

Replace any ambiguous “clarification attempt/round” wording.

Store:

```
clarification_prompts_sent
```

Rule:

- initial episode: 0;
- BabyPark may emit at most one `CLARIFY` prompt;
- after it is emitted: 1;
- the next customer reply must resolve the requested slot by choosing an offered candidate or supplying a valid requested value;
- if still unresolved, do not send a second CLARIFY.

Outcome:

```
HUMAN / CLARIFY_EXHAUSTED
```

Thus there is exactly one assistant clarification prompt per episode.

## 12. Dynamic authority after clarification remains v0.4

Stable identifiers/selections may persist across turns.

Dynamic facts never persist as truth.

Before every public ANSWER or dynamic-fact CLARIFY:
- reread current accepted Catalog generation;
- revalidate identifiers;
- reread price/availability/stock;
- rerun freshness;
- reread current OperationalFact/CommercePolicy authority;
- reevaluate current `now`.

The final `decision_context_id` reflects the authority reread for that response.

## 13. Slice A boundary change

Slice A now includes an additive store-identity prerequisite before store-scoped facts can become CURRENT:

- migrate/extend canonical identity to stable stores + provider xrefs;
- bootstrap/review current BabyPark physical stores;
- prove mappings used by current Catalog store IDs;
- then create/publish store-scoped Knowledge authority.

This is intentional technical debt prevention for Magento migration, not a Magento integration implementation.

Slice A still does not implement Magento itself.

## 14. Review status

Sonnet v0.4 blocker:
- civil-day special-hours invariant existed in resolver design but was not a publication invariant.

Grok v0.4 blockers:
- same short-envelope hole for special hours;
- clarification corpus had inconsistent counting semantics.

User requirement:
- Drupal → Magento cutover must preserve a clear single authority for store hours and store stock identity without ad hoc remapping.

v0.5 resolves all three.

Pending: blocker-only review of v0.5 delta + v0.5 acceptance delta.

If no concrete blocker remains:

`READY TO OPEN SLICE A IMPLEMENTATION ISSUE`
