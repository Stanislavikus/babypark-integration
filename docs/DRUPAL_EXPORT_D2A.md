# Drupal Export D2a — Read-Only Snapshot, Preflight & Canonical Spool

Status: **implementation / not deployed**

D2a implements the Drupal-side source pipeline up to validated local `.ready` spool
generation. D2b owns HTTP transport and the first controlled FULL send.

## Read-only boundary

- One MariaDB connection per snapshot attempt.
- `REPEATABLE READ` + `START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY`.
- No Drupal writes, no coordination locks, no production BP1 credential, no HTTP calls to
  Catalog ingest endpoints.
- Database credentials come from environment variables, never from Git or `settings.php`.

## Nested package

```text
apps/drupal-exporter/
```

Runtime: Node `>= 20` (production host has `/usr/bin/node` v20.20.2).

CLI:

```text
npm --prefix apps/drupal-exporter ci
node apps/drupal-exporter/bin/drupal-exporter.mjs preflight
node apps/drupal-exporter/bin/drupal-exporter.mjs spool
```

## Configuration (environment)

| Variable | Purpose |
|---|---|
| `DRUPAL_EXPORT_DB_HOST` | MariaDB host |
| `DRUPAL_EXPORT_DB_PORT` | MariaDB port |
| `DRUPAL_EXPORT_DB_DATABASE` | Database name |
| `DRUPAL_EXPORT_DB_USER` | Read-only user |
| `DRUPAL_EXPORT_DB_PASSWORD` | Password |
| `DRUPAL_EXPORT_SPOOL_ROOT` | Absolute spool root |
| `DRUPAL_EXPORT_COLLISION_CONFIG` | Absolute path to `legacy-sku-collisions.yaml` |
| `DRUPAL_EXPORT_PUBLIC_SITE_URL` | Public site base URL |
| `DRUPAL_EXPORT_PUBLIC_FILES_URL` | Public files base URL |
| `DRUPAL_EXPORT_PRICE_PENDING_CSV` | Price pending CSV path |
| `DRUPAL_EXPORT_PRICE_LOCK` | Price lock path |
| `DRUPAL_EXPORT_STOCK_PENDING` | Stock pending XML path |
| `DRUPAL_EXPORT_STOCK_PROCESSED` | Processed stock XML path |

Frozen source identity:

```text
provider = drupal
source_epoch = drupal-prod-v1
```

## Snapshot / stability protocol

### Before snapshot

Filesystem precheck requires absent:

- price pending CSV + lock
- stock pending XML

Fingerprint processed stock XML (`remains_1c_new2.xml` path via config).

### Inside snapshot (same connection)

1. Read `babypark_sync_stock_time_sync` from Drupal `variable` using narrow parser
   `i:<unix-seconds>;`.
2. Read microsecond snapshot watermark:
   `CAST(FLOOR(UNIX_TIMESTAMP(NOW(6)) * 1000000) AS CHAR)`.
3. Re-check filesystem stability.
4. Require pending stock still absent and processed stock `mtime <= stock sync marker`.

Failure → `ROLLBACK` + `SOURCE_UNSTABLE` blocker.

## Source authority

- Product types discovered via `node_type.base = 'uc_product'`.
- `product_kit` excluded from first FULL (`excluded_by_policy.product_kit`).
- Translation group: `tnid != 0 ? tnid : nid`.
- Authority order: `ru` → `uk`; other-only groups are blockers.
- Drupal `und` field rows join by `entity_id`, not field language.

## Variant / default semantics

- **SIMPLE**: no `uc_product_attributes` → one `native_variant_id = <product>|base`.
- **CONFIGURABLE**: every valid adjustment row is a structural variant.
- Default combination from `uc_product_attributes.default_option`.
  - If adjustment exists for default combination → that variant is default; base model is
    not emitted separately.
  - If not → synthesize default variant with `sku = uc_products.model` and default option
    price adjustments.
- Exactly one `is_default = true` variant per product.

Variant identity:

```text
<native_product_id>|base
<native_product_id>|opts:<aid>=<oid>,...
```

## Price semantics

- `base = uc_products.sell_price`
- `adjustment = SUM(uc_product_options.price)` for selected options
- Exact `DECIMAL(16,5)` arithmetic via fixed-scale BigInt (no JS float math)
- Canonical minor units only when exactly representable in 1/100 UAH
- Negative or sub-cent finals are blockers (not rounded)

## Commercial availability

- SIMPLE: `field_status` weight mapping `1..5`
- CONFIGURABLE: derived from selected option `uc_product_options.weight`
- Conflicting multi-option statuses → `VARIANT_STATUS_AMBIGUOUS` blocker
- Unknown weights (e.g. `0`) → blocker

## Collision quarantine

Git source of truth:

```text
config/drupal/legacy-sku-collisions.yaml
```

Supported reviewed actions only:

- `exclude_product` (cross-product duplicate `sku_key`)
- `exclude_variant` (within-product duplicate `sku_key`)

Unknown collisions remain blockers. D2a keeps `mappings: []`.

Identity operator (does not apply collisions, only records config hash):

```text
node scripts/identity-set-config-hash.mjs \
  --path=/absolute/path/identity.sqlite \
  --config-key=drupal-collisions \
  --config-file=/absolute/path/legacy-sku-collisions.yaml
```

## Spool lifecycle

```text
<spool-root>/snapshot-<watermark>.building/
<spool-root>/snapshot-<watermark>.ready/
```

Ready contents:

- `manifest.json`
- `preflight.json`
- `collision-report.json`
- `phase0-*.json`, `phase1-*.json` canonical chunks

Promotion uses same-directory atomic rename only after all validation passes.
Failed runs must not leave `.ready`.

Chunk rules:

- `rows <= 500`
- body bytes `<= 1_048_576`
- serialized via root `canonicalJson()`
- validated via root `validateFullRecords()`

## D2a / D2b boundary

| D2a | D2b |
|---|---|
| snapshot + preflight + local spool | HTTP transport |
| no run header/trailer | signed run header |
| no BP1 production credential on Drupal | controlled first FULL |
| `snapshot_watermark` captured for later `t_high/output_watermark` | ingest send |

## Expected production preflight

Initial production `preflight` is expected to exit nonzero due to real source blockers
(unresolved SKU collisions, sub-cent prices, invalid variant status on product `47526`, etc.).
Validation is intentionally strict.
