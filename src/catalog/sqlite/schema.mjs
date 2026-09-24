export const CATALOG_SCHEMA_VERSION = 1;

export const CATALOG_LAYERS = Object.freeze([
  'taxonomy',
  'content',
  'commercial',
  'stock',
]);

export const CATALOG_REQUIRED_TABLES = Object.freeze([
  'catalog_meta',
  'sync_state',
  'products',
  'product_text',
  'variants',
  'variant_offers',
  'stores',
  'store_stock',
  'brands',
  'categories',
  'product_categories',
  'attribute_defs',
  'product_attributes',
  'images',
  'kit_components',
  'ingest_runs',
]);

const SCHEMA_SQL = `
  PRAGMA foreign_keys=ON;
  PRAGMA journal_mode=WAL;
  PRAGMA synchronous=NORMAL;

  CREATE TABLE catalog_meta (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    schema_version INTEGER NOT NULL,
    generation_id TEXT NOT NULL UNIQUE,
    source_epoch TEXT NOT NULL,
    identity_revision INTEGER NOT NULL CHECK(identity_revision >= 0),
    state TEXT NOT NULL CHECK(state IN ('building','ready')),
    created_at TEXT NOT NULL,
    sealed_at TEXT,
    manifest_sha256 TEXT,
    manifest_json TEXT,
    dependency_fingerprint TEXT
  );

  CREATE TABLE sync_state (
    layer TEXT PRIMARY KEY
      CHECK(layer IN ('taxonomy','content','commercial','stock')),
    accepted_watermark TEXT,
    accepted_source_fingerprint TEXT,
    source_updated_at TEXT,
    provider_completed_at TEXT,
    integration_synced_at TEXT,
    last_run_id TEXT,
    last_ok_at TEXT,
    freshness_state TEXT NOT NULL DEFAULT 'UNKNOWN'
      CHECK(freshness_state IN ('UNKNOWN','FRESH','STALE','BLOCKED')),
    need_reconcile INTEGER NOT NULL DEFAULT 0
      CHECK(need_reconcile IN (0,1)),
    need_full INTEGER NOT NULL DEFAULT 0
      CHECK(need_full IN (0,1))
  );

  CREATE TABLE brands (
    brand_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provenance_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE products (
    product_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL
      CHECK(kind IN ('SIMPLE','CONFIGURABLE','KIT')),
    product_type TEXT,
    brand_id TEXT,
    default_variant_id TEXT,
    lifecycle TEXT NOT NULL DEFAULT 'active'
      CHECK(lifecycle IN ('active','tombstoned')),
    provenance_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    FOREIGN KEY(brand_id)
      REFERENCES brands(brand_id)
      ON UPDATE RESTRICT
      ON DELETE SET NULL
  );

  CREATE TABLE product_text (
    product_id TEXT NOT NULL,
    language TEXT NOT NULL,
    title TEXT NOT NULL,
    short_description TEXT,
    description TEXT,
    url TEXT,
    PRIMARY KEY(product_id, language),
    FOREIGN KEY(product_id)
      REFERENCES products(product_id)
      ON UPDATE RESTRICT
      ON DELETE CASCADE
  );

  CREATE TABLE variants (
    variant_id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    sku TEXT NOT NULL,
    sku_key TEXT NOT NULL UNIQUE,
    gtin TEXT,
    is_default INTEGER NOT NULL DEFAULT 0
      CHECK(is_default IN (0,1)),
    options_json TEXT NOT NULL DEFAULT '{}',
    lifecycle TEXT NOT NULL DEFAULT 'active'
      CHECK(lifecycle IN ('active','tombstoned')),
    updated_at TEXT NOT NULL,
    FOREIGN KEY(product_id)
      REFERENCES products(product_id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT
  );

  CREATE INDEX idx_variants_product
    ON variants(product_id);

  CREATE UNIQUE INDEX idx_one_default_variant_per_product
    ON variants(product_id)
    WHERE is_default = 1;

  CREATE TABLE variant_offers (
    variant_id TEXT PRIMARY KEY,
    current_minor INTEGER NOT NULL CHECK(current_minor >= 0),
    regular_minor INTEGER CHECK(regular_minor IS NULL OR regular_minor >= 0),
    currency TEXT NOT NULL DEFAULT 'UAH',
    on_sale INTEGER NOT NULL DEFAULT 0
      CHECK(on_sale IN (0,1)),
    commercial_availability TEXT NOT NULL
      CHECK(commercial_availability IN (
        'IN_STOCK',
        'EXPECTED',
        'OUT_OF_STOCK',
        'DISCONTINUED',
        'MADE_TO_ORDER'
      )),
    tax_included INTEGER
      CHECK(tax_included IS NULL OR tax_included IN (0,1)),
    valid_from TEXT,
    valid_to TEXT,
    source_updated_at TEXT,
    FOREIGN KEY(variant_id)
      REFERENCES variants(variant_id)
      ON UPDATE RESTRICT
      ON DELETE CASCADE
  );

  CREATE INDEX idx_variant_offers_availability
    ON variant_offers(commercial_availability);

  CREATE TABLE stores (
    store_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
      CHECK(active IN (0,1)),
    metadata_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE store_stock (
    variant_id TEXT NOT NULL,
    store_id TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity >= 0),
    source_updated_at TEXT,
    PRIMARY KEY(variant_id, store_id),
    FOREIGN KEY(variant_id)
      REFERENCES variants(variant_id)
      ON UPDATE RESTRICT
      ON DELETE CASCADE,
    FOREIGN KEY(store_id)
      REFERENCES stores(store_id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT
  );

  CREATE INDEX idx_store_stock_store_qty
    ON store_stock(store_id, quantity);

  CREATE TABLE categories (
    category_id TEXT PRIMARY KEY,
    parent_id TEXT,
    name_json TEXT NOT NULL DEFAULT '{}',
    provenance_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY(parent_id)
      REFERENCES categories(category_id)
      ON UPDATE RESTRICT
      ON DELETE SET NULL
  );

  CREATE TABLE product_categories (
    product_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0
      CHECK(is_primary IN (0,1)),
    PRIMARY KEY(product_id, category_id),
    FOREIGN KEY(product_id)
      REFERENCES products(product_id)
      ON UPDATE RESTRICT
      ON DELETE CASCADE,
    FOREIGN KEY(category_id)
      REFERENCES categories(category_id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT
  );

  CREATE TABLE attribute_defs (
    attribute_id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    label_json TEXT NOT NULL DEFAULT '{}',
    provenance_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE product_attributes (
    owner_type TEXT NOT NULL
      CHECK(owner_type IN ('PRODUCT','VARIANT')),
    owner_id TEXT NOT NULL,
    attribute_id TEXT NOT NULL,
    value_json TEXT NOT NULL,
    PRIMARY KEY(owner_type, owner_id, attribute_id),
    FOREIGN KEY(attribute_id)
      REFERENCES attribute_defs(attribute_id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT
  );

  CREATE TABLE images (
    image_id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    variant_id TEXT,
    url TEXT NOT NULL,
    role TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY(product_id)
      REFERENCES products(product_id)
      ON UPDATE RESTRICT
      ON DELETE CASCADE,
    FOREIGN KEY(variant_id)
      REFERENCES variants(variant_id)
      ON UPDATE RESTRICT
      ON DELETE CASCADE
  );

  CREATE INDEX idx_images_product_position
    ON images(product_id, position);

  CREATE INDEX idx_images_variant_position
    ON images(variant_id, position);

  CREATE TABLE kit_components (
    kit_product_id TEXT NOT NULL,
    component_variant_id TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    discount_minor INTEGER,
    mutable INTEGER NOT NULL DEFAULT 0
      CHECK(mutable IN (0,1)),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY(kit_product_id, component_variant_id),
    FOREIGN KEY(kit_product_id)
      REFERENCES products(product_id)
      ON UPDATE RESTRICT
      ON DELETE CASCADE,
    FOREIGN KEY(component_variant_id)
      REFERENCES variants(variant_id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT
  );

  CREATE TABLE ingest_runs (
    run_id TEXT PRIMARY KEY,
    layer TEXT NOT NULL
      CHECK(layer IN ('taxonomy','content','commercial','stock','full')),
    run_kind TEXT NOT NULL
      CHECK((run_kind='full' AND layer='full') OR
            (run_kind='incremental' AND layer IN ('taxonomy','content','commercial','stock'))),
    run_digest TEXT CHECK(run_digest IS NULL OR (length(run_digest)=64 AND run_digest NOT GLOB '*[^0-9a-f]*')),
    final_seq INTEGER CHECK(final_seq IS NULL OR final_seq >= 0),
    status TEXT NOT NULL
      CHECK(status IN (
        'STAGING',
        'ACCEPTED',
        'REJECTED',
        'FAILED',
        'ABANDONED'
      )),
    source_watermark TEXT,
    started_at TEXT NOT NULL,
    terminal_at TEXT,
    manifest_sha256 TEXT,
    error_code TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE VIRTUAL TABLE fts_words USING fts5(
    product_id UNINDEXED,
    language UNINDEXED,
    title,
    brand,
    category,
    attributes,
    sku,
    tokenize='unicode61 remove_diacritics 2'
  );

  CREATE VIRTUAL TABLE fts_trigram USING fts5(
    product_id UNINDEXED,
    language UNINDEXED,
    text,
    tokenize='trigram'
  );

  PRAGMA user_version=1;
`;

export function initializeCatalogSchema(db, {
  generationId,
  sourceEpoch,
  identityRevision,
  createdAt,
  dependencyFingerprint = null,
}) {
  db.exec(SCHEMA_SQL);

  db.prepare(`
    INSERT INTO catalog_meta(
      singleton,
      schema_version,
      generation_id,
      source_epoch,
      identity_revision,
      state,
      created_at,
      dependency_fingerprint
    ) VALUES(1,?,?,?,?, 'building', ?, ?)
  `).run(
    CATALOG_SCHEMA_VERSION,
    generationId,
    sourceEpoch,
    identityRevision,
    createdAt,
    dependencyFingerprint
  );

  const insertLayer = db.prepare(`
    INSERT INTO sync_state(layer)
    VALUES(?)
  `);
  for (const layer of CATALOG_LAYERS) {
    insertLayer.run(layer);
  }
}
