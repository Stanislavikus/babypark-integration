# Catalog Link B — retained source snapshot to canonical spool

Status: **implemented acceptance verifier; no production action authorized**

Link B independently checks the bounded retained Drupal snapshot evidence against the
exact canonical records in a frozen `bp.drupal-exporter.spool/3` directory. Link A is
not an input: Link B does not open CatalogService or IdentityStore and does not reuse
exporter business-projection modules.

## Authority chain

The acceptance authority remains unchanged:

```text
exact source-acceptance.json bytes
  -> manifest.source_acceptance_sha256
  -> exact manifest hash
  -> signed publication_authority
  -> BP1 run/header
```

There is deliberately no `preflight_sha256`. `preflight.json` and
`collision-report.json` are diagnostics, not semantic acceptance authorities. The
hash-bound anomaly report supplies quarantine evidence. Exact collision YAML bytes
must hash to `manifest.collision_config_sha256` before semantic checking starts.
The YAML is decoded by a verifier-owned parser restricted to the frozen mapping
vocabulary, so Link B has no runtime dependency on an exporter `node_modules` tree.

## Additive source-acceptance/1 evidence profile

The schema and version remain `bp.drupal.source-acceptance/1`, version 1. The producer
adds:

* `producer_inputs.public_site_url` and `producer_inputs.public_files_url`, copied
  from the normalized exporter configuration used by canonical URL construction;
* `producer_inputs.source_currency.{code,precision}`, copied from the parsed snapshot
  currency used by canonical price construction;
* sorted `raw.drupal_variables` entries containing exact base64 bytes for
  `babypark_sync_stock_time_sync`, `uc_currency_code`, and `uc_currency_prec`;
* sorted `raw.active_stores`, obtained from the global positive-stock aggregate, plus
  store terms for those global IDs;
* explicit seed/group expansion metadata:
  `deterministic_product_ids`, `high_cardinality_product_ids`,
  `selected_product_group_ids`, and `expanded_selected_node_ids`.

Reviewed resolved/missing groups and the compatibility `selected_product_ids` field
remain. Seed nodes are resolved to `tnid != 0 ? tnid : nid`, then expanded to every
published `uc_product` translation sibling before product-level raw queries run. All
queries and raw-variable capture occur in the same open repeatable-read transaction.

## Independent verifier boundary

`src/catalog/link-b/verifier.mjs` may use frozen spool integrity/structural FULL
validation and generic parsing primitives. It independently implements the small
frozen rules for authority translations, aliases, brand/category references, SKU
normalization, PHP variable/combination decoding, structural variant IDs, synthesized
defaults, status, exact decimal price rounding, global-active-store stock, and public
image URLs. A static test prevents imports from exporter canonical, collision,
currency, PHP-variable, and money business modules.

Chunks are processed sequentially. Only bounded selected products, expected
dimensions, and bounded mismatch details are retained. Mismatch detail is capped at
100 entries and 48 KiB; `mismatch_count` continues counting beyond either cap.

Before projection, Link B validates the complete evidence envelope and anomaly
report cross-links. It reconstructs selected raw SKU collisions, proves every
represented retain/exclude mapping and its cardinality, rejects stale mappings and
residual reviewed collisions, and promotes a retained variant only when the excluded
variant was the old default. Missing, excluded, and product-kit products plus
unexpected or duplicate selected rows are failures. Selected raw states that should
have blocked spool creation also fail closed.

Every post-mapping selected-scope residual SKU collision must have exactly one
hash-bound anomaly with the independently derived collision type, SKU key, affected
products, collider product/variant identities, raw SKU, default flag, and source
combination. The reverse is also required: a selected-scope anomaly without a raw
residual collision fails. Only products affected by this exact match are removed from
the expected publishable set. Reviewed mappings are never skipped when their products
are missing; every mapped product must be represented by the reviewed acceptance set
and its current raw collision must be proven.

The work root must already be a real, non-symlink mode-0700 directory outside the
frozen spool. Equal, nested, and symlink-parent aliases into the spool are rejected;
the mode-0600 report is written through an exclusive temporary file, fsync, and
atomic rename.

Global active-store rows and the full retained category vocabulary are exhaustive:
their canonical ID sets must match exactly, including names, active flags, localized
names, and parents, with no duplicates or extras. Brand evidence remains deliberately
bounded to selected products, so unrelated extra brands are ignored. The current
Drupal phase-0/1 contract also globally forbids `attribute_definition` and any phase-1
`product_type=product_kit` row. Collision mapping identity keys are unique; duplicate
or conflicting mapping identities are rejected before application.

## Operator CLI

```bash
node scripts/catalog-link-b.mjs \
  --spool=/absolute/path/snapshot.ready \
  --collision-config=/absolute/path/legacy-sku-collisions.yaml \
  --work-root=/absolute/private/link-b-work
```

The CLI emits exactly one JSON value. Exit status is 0 only for `PASS`, 1 for a
semantic `FAIL`, and 2 for invalid input/runtime failure. It writes the same bounded
report to `<work-root>/link-b-report.json` with mode 0600.

The `bp.catalog.link-b-report/1` report binds the spool, source acceptance, anomaly
report, and collision config hashes; source epoch/watermark/stock sync; producer
inputs; selection counts and selected IDs; checked projection counts; bounded
mismatches; timing; and verifier version.

## Fixture and negative coverage

The positive fixture contains retained raw Drupal evidence, exact collision bytes,
global active-store evidence, localized body/alias data, trusted HALF_UP price,
stock, and an encoded public image, with independently authored canonical phase-0/1
chunks. Corruption tests rehash the changed canonical chunk and manifest so frozen
spool validation succeeds before Link B detects the semantic title mismatch. Further
tests cover collision-byte rejection, SKU/PHP/combination/variant-ID/decimal golden
vectors, mismatch bounds, and the forbidden import boundary.

This tooling does not deploy, contact production, run preflight/rehearsal, create a
VM, send FULL, or alter sender/publication protocols.
