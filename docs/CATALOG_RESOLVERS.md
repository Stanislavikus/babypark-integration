# Catalog closed-world resolvers — AI First Line Slice B2

Status: IMPLEMENTED IN REPOSITORY CANDIDATE / NOT DEPLOYED
Last verified: 2026-10-02
Owner: BabyPark
Normative design: docs/AI_FIRST_LINE_DESIGN.md
Implementation issue: #69

## Purpose

Slice B2 creates the deterministic reviewed resolver boundary required before the
future AI First Line may turn customer phrases into BabyPark authority IDs.

The LLM may later identify a raw phrase/span. It never chooses a category, brand
or store ID.

The resolver layer is closed-world:

customer phrase
  -> reviewed immutable Vocabulary authority
  -> current canonical Catalog target validation
  -> 0 / 1 / many deterministic candidates

Money is parsed by a separate deterministic UAH parser and does not use the LLM.

B2 creates no customer-facing Chatwoot messages and performs no recommendation.

## Resolver contract version

Current:

`KNOWLEDGE_RESOLVER_CONTRACT_VERSION = 1`

Every B2 resolver result includes the version.

Version 1 has an immutable golden artifact:

`tests/fixtures/knowledge-resolver-contract-v1.json`

Its raw SHA-256 is pinned in
`src/copilot/knowledge/resolver-contract.mjs`.

The CI/unit contract executes the golden phrase/money vectors and verifies the
pinned digest.

Rule:

- pure internal refactor with identical observable result keeps version 1;
- a semantic change to observable resolver result requires reviewed version bump
  and a new versioned golden artifact;
- do not rewrite the frozen v1 artifact/pin to hide a semantic change.

This materializes the v0.5 V01-V03 version-discipline requirement.

## Vocabulary authority

Vocabulary does **not** introduce a new database or mutable alias table.

It uses the existing immutable `knowledge.sqlite` revision/event ledger:

`record_type = VOCABULARY_ENTRY`

Vocabulary remains approval-required under the existing Knowledge publication
policy.

A malformed vocabulary entry is rejected before draft insertion. Ledger/open/
restore verification revalidates the vocabulary schema, so a cryptographically
valid but semantically malformed vocabulary revision still fails closed.

### Canonical phrase

All Vocabulary entries use:

- `subject_type = phrase`;
- `subject_id = normalizeVocabularyPhrase(raw)`.

Normalization:
- Unicode NFC;
- collapse Unicode whitespace;
- trim;
- deterministic lowercase;
- bounded length;
- no control/NUL characters.

The stored `subject_id` must already be canonical. Knowledge never performs
fuzzy matching by store/category/brand name.

Multiple human phrasings are represented by multiple reviewed Vocabulary
revisions.

## Category Vocabulary v1

Namespace:

`vocabulary.category`

Required authority fields:

- `record_type = VOCABULARY_ENTRY`;
- `schema_version = 1`;
- `effect_family = vocabulary.category_resolution`;
- `subject_type = phrase`;
- canonical normalized `subject_id`;
- `scope = {}`;
- `effect_type = CATEGORY_BINDING`;
- exact `effect_value`:

```json
{
  "canonical_category_id": "…",
  "match_mode": "NODE_ONLY"
}
```

or:

```json
{
  "canonical_category_id": "…",
  "match_mode": "INCLUDE_DESCENDANTS"
}
```

There is no default match mode.

The category ID must exist in the currently accepted Catalog generation when the
resolver is used. B3 will apply the explicit match mode against the same
generation.

## Brand Vocabulary v1

Namespace:

`vocabulary.brand`

Required:
- `effect_family = vocabulary.brand_resolution`;
- `effect_type = BRAND_BINDING`;
- `scope = {}`;
- exact effect:

```json
{
  "canonical_brand_id": "…"
}
```

The canonical brand must exist in the current Catalog generation.

## Store Vocabulary v1

Namespace:

`vocabulary.store`

Required:
- `effect_family = vocabulary.store_resolution`;
- `effect_type = STORE_BINDING`;
- `scope = {}`;
- exact effect:

```json
{
  "canonical_store_id": "store_…"
}
```

The target must be an **active canonical BabyPark store** in the current Catalog
generation.

Provider-native Drupal location IDs, future Magento MSI `source_code`, names,
addresses and fuzzy guesses are never accepted as authority IDs.

## Vocabulary result states

### Zero active reviewed mappings

`NOT_FOUND`

Examples:
- `CATEGORY_NOT_FOUND`;
- `BRAND_NOT_FOUND`;
- `STORE_NOT_FOUND`.

No candidate is guessed from Catalog display names.

### Exactly one unique valid reviewed mapping

`RESOLVED`

The result contains:
- resolver contract version;
- normalized phrase;
- current Catalog generation metadata;
- canonical target;
- all Vocabulary revision IDs that support that exact mapping.

### More than one unique valid reviewed mapping

`AMBIGUOUS`

Reason is type-specific:
- `AMBIGUOUS_CATEGORY`;
- `AMBIGUOUS_BRAND`;
- `AMBIGUOUS_STORE`.

There is no:
- latest-wins;
- first-wins;
- alphabetical winner;
- priority-number winner;
- LLM-selected winner.

Two published revisions that encode the same exact mapping are one candidate, but
all supporting revision IDs remain in provenance.

For category, the pair
`canonical_category_id + match_mode` is the candidate identity. Therefore the
same category with different reviewed match modes is ambiguous.

### Reviewed mapping to invalid current target

`INVALID_AUTHORITY / VOCABULARY_TARGET_INVALID`

This is an internal fail-closed state for the future decision layer.

Examples:
- category was removed from current Catalog;
- brand target no longer exists;
- store is missing or inactive.

A valid mapping beside one invalid mapping does **not** allow the valid one to
win. The constraint remains unsafe until Vocabulary is repaired.

## Catalog dictionary seam

B2 extends the existing provider-neutral CatalogService only with exact dictionary
reads needed to validate reviewed Vocabulary targets:

- `listCategories({ categoryIds })`;
- `listBrands({ brandIds })`;
- `getStores({ storeIds, activeOnly })`.

All execute against one CatalogReader generation.

They do not perform phrase matching and do not become an alternate Vocabulary
authority.

## Money resolver v1

Money parsing is deliberately small and deterministic.

Resolved examples:
- `20 000 грн`;
- `20 000 грн` (NBSP);
- `20000 UAH`;
- `20 тысяч`;
- `20 тисяч`;
- `20к`.

These map to UAH integer minor units. For example:

`20 000 грн -> 2 000 000 minor units`

The parser:
- normalizes NFC/whitespace/case;
- has a bounded input length;
- uses integer/BigInt arithmetic before safe-number conversion;
- never accepts floating money;
- never infers an omitted currency;
- rejects overflow.

Malformed or non-approved forms return:

`AMBIGUOUS / AMBIGUOUS_MONEY`

Examples:
- `20 000`;
- `20.000 грн`;
- `20,000 грн`;
- `20к грн`;
- negative/decimal/overflow input.

Ambiguity is resolved by clarification later in Slice C, not by guessing here.

## Freshness boundary

B2 resolves **identity**, not price or stock facts.

It validates Vocabulary targets against the currently accepted Catalog generation,
but it does not turn commercial/stock freshness into phrase-resolution behavior.

Later factual operations apply the frozen relevant-layer gates:

- price/general objective shortlist -> commercial/offer authority;
- specific-store stock/store-filter shortlist -> commercial + stock authority.

Thus stale stock does not make the phrase “магазин на …” cease to identify a
store; it prevents a stock fact from being answered later.

## Provenance

Vocabulary results retain all active reviewed `revision_id` values actually used.

Catalog-backed resolver results carry current generation metadata.

Money uses no Knowledge revision and therefore has an empty revision list.

These values are intended for future Slice C `decision_context_id` construction;
B2 does not persist customer messages or decision traces.

## Explicit non-goals

B2 does not implement:

- fuzzy entity search;
- LLM-selected canonical IDs;
- product phrase resolver;
- objective shortlist execution;
- category descendant expansion itself;
- specific-store stock answer;
- ObjectiveConstraintLatch;
- clarification episode;
- customer rendering;
- Chatwoot messages/handoff;
- Seller Assist;
- AI HUB.

Those remain later slices.
