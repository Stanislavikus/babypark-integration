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

Runtime production contract:

- exact runtime authority: `config/drupal/exporter-runtime.json`;
- pinned Node: `24.21.0` LTS (`linux-x64`);
- isolated install root: `/opt/babypark-exporter/runtime/node-v24.21.0`;
- system `/usr/bin/node` remains unchanged;
- installer verifies the pinned archive SHA-256 plus `node:sqlite`/FTS5;
- production execution uses `scripts/run-drupal-exporter.mjs`, which verifies the exact
  pinned Node version before handoff.

CLI from an immutable release:

```text
npm --prefix apps/drupal-exporter ci
node scripts/run-drupal-exporter.mjs preflight
node scripts/run-drupal-exporter.mjs spool
```

Direct `node apps/drupal-exporter/bin/drupal-exporter.mjs ...` remains acceptable for
local tests, but is not the production run contract.

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
| `DRUPAL_EXPORT_ANOMALY_PUBLICATION_POLICY` | Absolute path to `publication-policy.yaml` |
| `DRUPAL_EXPORT_RELEASE_PROVENANCE` | Absolute path to `RELEASE.json` in the same immutable release root as the executing exporter code |
| `DRUPAL_EXPORT_SOURCE_ACCEPTANCE_CASES` | Absolute path to reviewed `source-acceptance-cases.yaml` |
| `DRUPAL_EXPORT_DB_DATA_PATH` | Absolute MariaDB data path used by the free-space gate |
| `DRUPAL_EXPORT_MIN_FREE_BYTES` | Positive integer minimum free bytes required on temp/spool/DB-data filesystems |
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

## Preflight stage timings

`preflight.stage_timings_ms` records operational stage durations for diagnosis and
baseline comparison. Production snapshot runs include separate `snapshot_setup_ms`,
`snapshot_extract_ms` and `source_acceptance_ms`; pipeline stages also include
canonical build, collision/anomaly processing, quarantine/filtering, chunk preparation,
cleanup and total time.

Timings are diagnostic metadata only. They do not change collision/anomaly authority,
canonical records, spool hashes or publication eligibility.

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

## FULL record contract (D2a.1)

```text
bp.catalog.full-record/2
FULL_RECORD_CONTRACT_VERSION = 2
RECORD_VALIDATOR_VERSION = 3
CATALOG_SCHEMA_VERSION = 6
PRODUCTION_MAPPER_VERSION = 2
```

Each variant carries required `commercial_availability`. `offer` is optional and
price-only (`current_minor`, `currency`, `on_sale`, …). Availability is no longer
nested inside `offer`.

HTTP ingest transport remains `/api/catalog/ingest/v1/full` — that `v1` is the BP1
transport protocol version, independent of FULL record schema v2.

## Price semantics (trusted-price policy)

Currency is read from the same snapshot connection:

```text
uc_currency_code  → offer.currency
uc_currency_prec  → PHP number_format display precision
```

Narrow PHP serialized-string parser only (`s:<byte-len>:"...";`).

Trusted price is emitted only when proven current by legacy 1C sync policy:

- **SIMPLE**: `field_status == 1`
- **CONFIGURABLE**: all selected option `uc_product_options.weight == 1`

Otherwise availability is still exported but `offer` is omitted (aggregate
`source_policy_diagnostics` counts; no per-variant warnings).

When trusted:

- `base = uc_products.sell_price`
- `adjustment = SUM(uc_product_options.price)` for selected options
- exact `DECIMAL(16,5)` BigInt math
- PHP `number_format` HALF_UP at `uc_currency_prec`
- convert displayed amount to canonical minor units
- unexpected invalid trusted prices fail closed (`PRICE_*` blockers)

## Commercial availability

- required on every variant as `commercial_availability`
- SIMPLE: `field_status` mapping `1..5`
- CONFIGURABLE: selected option `uc_product_options.weight`
- conflicting multi-option statuses → `VARIANT_STATUS_AMBIGUOUS` blocker
- synthesized default variant may fall back to product-level `field_status` when all
  selected option weights are missing/0 (warning, narrow case only)
- ordinary adjustment variants with weight `0` remain blockers

## Degraded-source warnings (non-blocking)

Deterministic warnings (do not block spool when no hard blockers):

- missing referenced brand omitted
- duplicate non-authority locale resolved/omitted
- missing global option label (single-attribute products)
- synthesized-default status fallback

`manifest.json.warning_count` mirrors `preflight.json.warning_count`.

## Collision quarantine

Git source of truth:

```text
config/drupal/legacy-sku-collisions.yaml
```

Supported reviewed actions only:

- `exclude_product` (cross-product duplicate `sku_key`)
- `exclude_variant` (within-product duplicate `sku_key`)

Reviewed mappings are applied before residual collision detection. The production
config contains exactly 21 reviewed legacy migration mappings. Residual supported
SKU collisions are handled by Catalog Anomaly Runtime v1 whole-product quarantine;
all non-v1 blocker classes remain hard blockers. `511000` and `80401mc02` are
intentionally not mapped.

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

Ready contents for the first D2b-transportable artifact:

- `manifest.json` — exact `bp.drupal-exporter.spool/3`;
- `preflight.json`;
- `collision-report.json`;
- `anomaly-report.json`;
- `source-acceptance.json`;
- `phase0-*.json`, `phase1-*.json` canonical chunks.

Spool/3 does not silently redefine historical spool/2. Its manifest additionally binds:

- `producer_commit`;
- raw-byte SHA-256 of immutable release `RELEASE.json`;
- raw-byte SHA-256 of `source-acceptance.json`;
- exact anomaly/policy/collision hashes already used by the exporter.

The immutable release provenance file is validated before snapshot work. Generate it
for a release with:

```text
node scripts/create-exporter-release-provenance.mjs \
  --output=/absolute/release/RELEASE.json
```

The generator fails closed when:

- the Git worktree/index is dirty;
- any tracked entry carries non-normal index flags such as
  `assume-unchanged` or `skip-worktree`;
- the output path is inside the source checkout.

`RELEASE.json` uses one canonical generated JSON representation, an exact repository
identifier, canonical UTC ISO timestamp, exact HEAD/tree and raw package-lock hash.

The immutable release directory itself must be materialized from the exact reviewed
Git object (for example `git archive <commit>` or an equivalent clean detached
checkout) and then have dependencies installed from the locked package. Do not build
the immutable release by recursively copying an arbitrary developer worktree.

`source-acceptance.json` is independent acceptance evidence. In production it is
collected by separate targeted SELECTs while the same repeatable-read snapshot
transaction is still open; it is not reconstructed from canonical output after the
fact. Catalog membership is filtered to the exact `catalog` vocabulary, the sidecar
carries the complete catalog taxonomy terms/hierarchy needed to reproduce category
canonicalization, provider terms for selected brands, and stock rows selected with
the same NFC/trim/lower identity semantics using a streaming stock scan.

The reviewed evidence-selection file
`config/drupal/source-acceptance-cases.yaml` is acceptance-only and does not alter
publication decisions. It covers all product-group identities referenced by the 21
reviewed legacy mappings plus the four historical source groups from the two
identity cases that were unresolved at D2b design freeze. If a reviewed historical
group no longer resolves in the current snapshot, the sidecar records that absence
explicitly instead of inventing a replacement source row.

Promotion uses same-directory atomic rename only after all validation passes.
Failed runs must not leave `.ready`.

Before `preflight` or `spool`, the exporter performs a byte-based free-space gate
against `os.tmpdir()`, `DRUPAL_EXPORT_SPOOL_ROOT`, and
`DRUPAL_EXPORT_DB_DATA_PATH`. Every configured path must already exist as a directory;
a missing/incorrect path is a blocker rather than silently checking an ancestor
filesystem. Every checked filesystem must have at least
`DRUPAL_EXPORT_MIN_FREE_BYTES` available.

Ready/building spool directories are created with mode `0700`; spool files are
created with mode `0600`. The storage policy freezes the same private modes for the
future CatalogService Link A staging area.

A ready spool is transient but authoritative once transport begins. It is not eligible
for age-only deletion and must survive through ACK/state, exhaustive Link A and owner
accept/reset decision as frozen in `docs/DRUPAL_EXPORT_D2B.md`.

Chunk rules:

- `rows <= 500`
- body bytes `<= 1_048_576`
- serialized via root `canonicalJson()`
- validated via root `validateFullRecords()`

## Bounded-memory runtime model

Large-run resident state is intentionally limited to compact dimensions plus one
in-flight product/chunk buffer. The exporter does **not** retain whole-catalog
payloads in the JS heap.

### Acceptable in memory (approximate production scale)

```text
~32k lightweight node metadata rows
~32k current uc_products revision rows
~33k status/provider/category reference tuples
~56k compact stock tuples (sku_key + store + quantity)
taxonomy / brand / attribute metadata
~49k compact collision entries (SKU identity + report fields only)
one product/group payload while building
one <=1MiB current chunk buffer
chunk metadata only (filename, phase, rows, bytes, sha256)
```

### Disk/stream-backed (not held wholesale in RAM)

```text
NDJSON source staging (bodies, options, adjustments, images via per-nid shards)
candidates.ndjson / filtered.ndjson
canonical chunk files on disk
```

### Explicitly not retained

```text
full-catalog product object graphs
all localized HTML bodies
all authority image payloads
collision collector full product references
chunk body strings after writeFileAtomic()
internal writer/scratch objects in CLI output
```

### Red preflight diagnostics

Preflight always runs diagnostic canonical validation/chunk packing even when other
source blockers exist. Post-filter SKU collision blockers are reported regardless of
unrelated blockers. Products quarantined at source (duplicate translation language,
missing current `uc_products`, invalid SKU) are not emitted to candidates. Per-record
canonical validation failures quarantine individual products but allow later products
to continue diagnostic packing. No `.ready` spool is produced while any blocker exists.

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
