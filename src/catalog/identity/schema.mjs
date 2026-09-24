export const IDENTITY_SCHEMA_VERSION = 1;

export const IDENTITY_LIFECYCLES = Object.freeze([
  'active',
  'tombstoned',
]);

export function identitySchemaSql(now) {
  const createdAt = String(now);

  return `
    PRAGMA foreign_keys=ON;
    PRAGMA journal_mode=DELETE;
    PRAGMA synchronous=FULL;

    CREATE TABLE identity_meta (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      schema_version INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO identity_meta(
      singleton, schema_version, revision, created_at, updated_at
    ) VALUES (
      1, ${IDENTITY_SCHEMA_VERSION}, 0,
      '${createdAt.replaceAll("'", "''")}',
      '${createdAt.replaceAll("'", "''")}'
    );

    CREATE TABLE products (
      product_id TEXT PRIMARY KEY,
      lifecycle TEXT NOT NULL
        CHECK(lifecycle IN ('active','tombstoned')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE variants (
      variant_id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      sku TEXT NOT NULL,
      sku_key TEXT NOT NULL UNIQUE,
      lifecycle TEXT NOT NULL
        CHECK(lifecycle IN ('active','tombstoned')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(product_id)
        REFERENCES products(product_id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT
    );

    CREATE INDEX idx_variants_product
      ON variants(product_id);

    CREATE TABLE source_products (
      provider TEXT NOT NULL,
      native_product_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY(provider, native_product_id),
      FOREIGN KEY(product_id)
        REFERENCES products(product_id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT
    );

    CREATE INDEX idx_source_products_product
      ON source_products(product_id);

    CREATE TABLE source_variants (
      provider TEXT NOT NULL,
      native_variant_id TEXT NOT NULL,
      variant_id TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY(provider, native_variant_id),
      FOREIGN KEY(variant_id)
        REFERENCES variants(variant_id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT
    );

    CREATE INDEX idx_source_variants_variant
      ON source_variants(variant_id);

    CREATE TABLE sku_aliases (
      alias_sku TEXT NOT NULL,
      alias_sku_key TEXT PRIMARY KEY,
      variant_id TEXT NOT NULL,
      reviewed_source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(variant_id)
        REFERENCES variants(variant_id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT
    );
    CREATE INDEX idx_sku_aliases_variant
      ON sku_aliases(variant_id);

    CREATE TABLE config_state (
      config_key TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );

    PRAGMA user_version=${IDENTITY_SCHEMA_VERSION};
  `;
}

export const IDENTITY_REQUIRED_TABLES = Object.freeze([
  'identity_meta',
  'products',
  'variants',
  'source_products',
  'source_variants',
  'sku_aliases',
  'config_state',
]);
