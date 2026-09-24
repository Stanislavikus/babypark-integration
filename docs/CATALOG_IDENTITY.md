# Catalog Identity Registry

Status: CURRENT (code) / NOT DEPLOYED (production data)
Last verified: 2026-09-24
Owner: BabyPark
Source of truth: src/catalog/domain/sku.mjs, src/catalog/identity/

## Purpose

The identity registry preserves BabyPark-owned product and variant identity
across catalog rebuilds and provider cutovers.

It is deliberately separate from rebuildable catalog generations.

Durable database:

    identity.sqlite

Rebuildable database:

    catalog.<generation_id>.sqlite

No production identity.sqlite has been created during Phase D1.

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

Provider IDs stay in:
- source_products(provider, native_product_id, product_id)
- source_variants(provider, native_variant_id, variant_id)

A provider-native ID cannot silently move to a different canonical identity.

A new provider may bind to an existing canonical product only explicitly.
A variant may reuse an existing canonical variant by sku_key only when the
canonical product_id also matches.

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
- initializes schema version 1;
- returns revision 0.

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
- reviewed SKU alias;
- reviewed SKU rename;
- tombstone transition;
- reviewed config hash change.

A repeated observation of the same provider-native mapping updates last_seen_at
but does not increment canonical revision.

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

Phase D1 contains no approved mappings.

The file will only be populated after the future read-only Drupal collision
report is reviewed.

The applied config SHA-256 is stored in identity config_state.

Unknown collision:
- quarantine;
- never first-row-wins;
- never autonomous customer use.

## Backup requirement before production use

identity.sqlite is durable state.

Before any production ingest is allowed to mutate it, operations must provide:
- verified local backup after every identity-mutating accepted run;
- encrypted off-host copy;
- backup age monitoring;
- restore drill;
- reconciliation check against active catalog references.

Phase D1 intentionally does not enable production identity ingestion.

## Phase D1 test coverage

Automated tests cover:
- explicit bootstrap only;
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
