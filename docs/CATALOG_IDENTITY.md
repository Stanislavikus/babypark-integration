# Catalog Identity Registry

Status: CURRENT (code and production durable identity state)
Last verified: 2026-10-01
Owner: BabyPark
Source of truth: src/catalog/domain/sku.mjs, src/catalog/identity/

## Purpose

The identity registry preserves BabyPark-owned product, variant and physical-store
identity across catalog rebuilds and provider cutovers.

It is deliberately separate from rebuildable catalog generations.

Durable architecture for duplicate identifiers, ambiguous identity, supplier-offer
separation, anomaly incidents, AI-safe behavior and human resolution lives in:

    docs/CATALOG_IDENTITY_ANOMALY_MANAGEMENT.md

The first concrete resolution workflow and its Joolz/Bugaboo acceptance cases are
drafted in:

    docs/PRODUCT_IDENTITY_RESOLUTION_V1.md

Any agent changing identity matching, collision handling, supplier imports,
category/product merging or customer-facing AI catalog selection must read all
three documents.

Durable database:

    identity.sqlite

Rebuildable database:

    catalog.<generation_id>.sqlite

Production `identity.sqlite` exists on the CatalogService host. The accepted first
production FULL advanced the published/live identity revision to `65504`. The current
covering local recovery set is
`set-20260930T181032Z-d5f1cd5906a4a838`, with the accepted off-host encrypted
recovery/restore evidence recorded in `docs/CURRENT_STATE.md`.

## SKU contract

Store both:
- sku: original accepted business value;
- sku_key: canonical lookup/uniqueness key.

sku_key algorithm:

    Unicode NFC
    -> trim outer whitespace
    -> Unicode lowercase
    -> NFC normalization of the lowercase result

Do not:
- transliterate;
- collapse internal whitespace;
- use NFKC compatibility folding;
- auto-map Cyrillic/Latin homoglyphs.

Canonical uniqueness is enforced with UNIQUE(sku_key).

All cross-source matching is performed in the Integration Service.
Drupal/MariaDB collation is never the canonical SKU-equivalence rule.

## Stable IDs

Product and variant IDs are BabyPark-owned opaque IDs.

Default generated shapes:

    prod_<uuid>
    var_<uuid>
    store_<uuid>

Provider IDs stay in:
- source_products(provider, native_product_id, product_id)
- source_variants(provider, native_variant_id, variant_id)
- source_stores(provider, native_store_id, store_id)

Physical-store identity follows the same rule as product identity: provider-native
location IDs are xrefs only. A reviewed Drupal store/location ID and a future
Magento MSI source_code may point to the same BabyPark store_id. Names, addresses
and approximate similarity are never automatic mapping authority.

New source-store mappings require reviewed_source provenance. An existing
provider/native store xref cannot be rebound. Tombstoned store IDs cannot be
reactivated or reused.

The durable xref registry may retain multiple reviewed historical provider IDs
for one canonical store. It does not infer which provider locations are active.
Current-provider topology is a separate cutover/preflight concern. In particular,
Magento v1 must fail preflight if more than one active physical MSI Source claims
the same canonical physical store; that rule must not erase durable xref history.

A provider-native ID cannot silently move to a different canonical identity.

A new provider may bind to an existing canonical product only explicitly.
A variant may reuse an existing canonical variant by sku_key only when the
canonical product_id also matches.

Current v1 limitations are deliberate:
- there is no product/variant merge, unbind, rebind or split operation;
- an existing source product/variant xref cannot be moved to another canonical ID;
- `variants.sku_key` is globally UNIQUE;
- many-to-one source binding is safe only during initial binding, or when one
  reviewed canonical side already exists and the other source side is unbound;
- Product Identity Resolution must fail closed rather than inventing a merge that
  this store cannot represent.

See `docs/PRODUCT_IDENTITY_RESOLUTION_V1.md` for the reviewed-resolution boundary.

## Source-provider cutover and identity continuity

The existing source xref schema is already provider-keyed and can represent more than one
provider identity pointing at one BabyPark canonical product when the new source side is
still unbound. That representational capability is not permission to infer continuity.

A new source/provider may bind to an existing canonical product or variant only through
explicit reviewed authority. SKU/article equality, labels, approximate similarity or an
LLM decision are evidence at most; none is durable identity authority.

The current `ensureProduct({ provider, nativeProductId, productId })` API is therefore a
low-level primitive, not a source-cutover policy. The reviewed-resolution application
layer described in `docs/PRODUCT_IDENTITY_RESOLUTION_V1.md` must supply the missing
evidence binding, provenance, transport/mapper contract and recovery coverage before that
primitive can be used for controlled cross-provider continuity in production.

Changing `source_epoch` does not itself create, merge, rebind or authorize identity
mappings. Every source cutover remains a separately reviewed migration with an explicit
identity-continuity plan.

The residual production incident `80401mc02` remains quarantined and is a separate
present-day driver for the future resolution-application layer; it is not dependent on a
future provider cutover.

## Fail-closed behavior

Normal runtime uses:

    IdentityStore.openExisting(...)

It never creates a missing file.

Missing identity state:
- IDENTITY_MISSING
- no new IDs
- no remapping
- no automatic empty database

The registry also refuses:
- corrupt/integrity-failed DB;
- unsupported schema version;
- incomplete required schema;
- WAL journal mode;
- group/world-accessible identity file.

Bootstrap is explicit:

    npm run identity:bootstrap -- \
      --path=/absolute/path/identity.sqlite \
      --create

The parent directory must already exist.

Bootstrap:
- fails if the file already exists;
- creates mode 0600;
- initializes the current schema version (v2 in the Slice A implementation);
- returns revision 0.

Existing schema-v1 production state is never upgraded by openExisting().
Migration is a separate owner/operator action:

```bash
npm run identity:migrate -- \
  --path=/absolute/path/identity.sqlite \
  --apply
```

The v1 -> v2 migration is additive: it preserves product/variant/config rows,
adds stores/source_stores, and leaves identity_meta.revision unchanged because
an empty schema capability is not an identity mapping. It is idempotent once v2
is reached.

Before any production migration:
- take and verify recovery coverage for the current identity.sqlite;
- stop/fence writers that could mutate IdentityStore during the migration;
- run the explicit migration;
- validate status/integrity and the expected empty/bootstrapped store mappings;
- create fresh verified recovery coverage before enabling a release that requires v2.

No runtime process is allowed to silently migrate durable authority state.

Read status:

    npm run identity:status -- \
      --path=/absolute/path/identity.sqlite

Status on a missing file fails and does not create it.

## Revision

identity_meta.revision tracks canonical identity topology/config changes.

Revision increments for:
- new canonical product;
- new provider product xref;
- new canonical variant;
- new provider variant xref;
- new canonical physical store;
- new reviewed provider store xref;
- physical-store tombstone transition;
- reviewed SKU alias;
- reviewed SKU rename;
- product/variant tombstone transition;
- reviewed config hash change.

A repeated observation of the same provider-native product/variant/store mapping
updates last_seen_at but does not increment canonical revision.

Reviewed physical-store binding is explicit:

```bash
npm run identity:store-bind -- \
  --path=/absolute/path/identity.sqlite \
  --provider=drupal \
  --native-store-id=<provider-id> \
  --reviewed-source=<review-or-ticket> \
  --apply
```

To bind a second provider to an already reviewed physical store, pass its
canonical --store-id. There is no fuzzy name/address fallback.

## SKU rename and aliases

A normal ensureVariant call cannot change the SKU identity of an existing
provider-native variant.

A real SKU rename requires an explicit reviewed operation:

    renameVariantSku(..., reviewedSource)

The stable variant_id is preserved.

When sku_key changes:
- old canonical SKU becomes a reviewed alias;
- new SKU becomes canonical;
- old SKU lookup still resolves to the same variant_id.

Manual aliases also require reviewedSource.

Aliases cannot steal:
- another canonical SKU;
- another variant's alias.

No alias is auto-created from similarity or homoglyph heuristics.

## Tombstones

Stable IDs are never reused after tombstone.

A tombstoned variant cannot be silently recreated from the same SKU.

A product cannot be tombstoned while it still has active variants.

Reactivation, if ever needed, must be a separate explicit reviewed operation;
it is not part of Phase D1.

## Drupal legacy collisions

Git source of truth:

    config/drupal/legacy-sku-collisions.yaml

This file is a **legacy migration exception ledger**, not the long-term
BabyPark anomaly-policy engine.

Mappings may only be populated after evidence-backed review of the production
collision report.

The applied config SHA-256 is stored in identity config_state.

Unknown collision:
- quarantine;
- never first-row-wins;
- never autonomous customer use.

Future provider-independent anomaly behavior is specified in
`docs/CATALOG_IDENTITY_ANOMALY_MANAGEMENT.md`.

## Backup and recovery requirement

`identity.sqlite` is durable state.

Every production identity-mutating accepted run requires:
- verified local recovery coverage after the mutation;
- encrypted off-host copy according to the accepted recovery procedure;
- backup-age/coverage monitoring;
- restore proof;
- reconciliation against the accepted catalog authority.

The first production FULL satisfied the local/off-host/restore acceptance tail recorded
in `docs/CURRENT_STATE.md`. Future identity mutations must preserve the same fail-closed
recovery discipline.

## Phase D1 test coverage

Automated tests cover:
- explicit bootstrap only;
- explicit additive v1 -> v2 migration with legacy-row preservation;
- reviewed canonical store creation and cross-provider continuity;
- provider/native store reassociation rejection;
- separation of durable store xref history from active-provider preflight;
- store tombstone non-reactivation;
- idempotent store observation without identity revision churn;
- missing/corrupt/unsafe/future-schema fail-closed;
- persistent stable IDs across reopen;
- cross-provider xrefs;
- generated-ID collision rollback;
- native-ID reassociation rejection;
- sku_key product collision rejection;
- tombstone non-reuse;
- explicit reviewed SKU rename;
- old-SKU alias resolution;
- alias collision protection;
- config hash revision behavior;
- Unicode/whitespace/homoglyph SKU normalization;
- CLI no-create behavior.
