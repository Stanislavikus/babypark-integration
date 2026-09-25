import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { normalizeSku } from '../domain/sku.mjs';
import { identityError } from './errors.mjs';
import {
  IDENTITY_REQUIRED_TABLES,
  IDENTITY_SCHEMA_VERSION,
  identitySchemaSql,
} from './schema.mjs';

function requireText(name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw identityError(
      'IDENTITY_INVALID_ARGUMENT',
      `${name} must be a non-empty string`,
      { argument: name }
    );
  }
  return value;
}

function defaultIdFactory() {
  return {
    product() {
      return `prod_${crypto.randomUUID()}`;
    },
    variant() {
      return `var_${crypto.randomUUID()}`;
    },
  };
}

function tableExists(db, table) {
  return Boolean(
    db.prepare(
      'SELECT 1 FROM sqlite_master WHERE type=? AND name=?'
    ).get('table', table)
  );
}

function integrityCheck(db) {
  return db.prepare('PRAGMA integrity_check').all()
    .map(row => String(Object.values(row)[0]));
}

function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export class IdentityStore {
  static createNew(filePath, {
    now = () => new Date().toISOString(),
    idFactory = defaultIdFactory(),
  } = {}) {
    const resolved = path.resolve(filePath);
    const parent = path.dirname(resolved);

    if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
      throw identityError(
        'IDENTITY_PARENT_MISSING',
        'Identity database parent directory must already exist',
        { parent }
      );
    }

    let fd;
    try {
      fd = fs.openSync(resolved, 'wx', 0o600);
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw identityError(
          'IDENTITY_ALREADY_EXISTS',
          'Identity database already exists',
          { path: resolved }
        );
      }
      throw error;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }

    let db;
    try {
      db = new DatabaseSync(resolved);
      db.exec(identitySchemaSql(now()));
      db.close();
      db = null;
      fs.chmodSync(resolved, 0o600);
      return IdentityStore.openExisting(resolved, {
        now,
        idFactory,
      });
    } catch (error) {
      if (db) {
        try { db.close(); } catch {}
      }
      try { fs.unlinkSync(resolved); } catch {}
      throw error;
    }
  }

  static openExisting(filePath, {
    now = () => new Date().toISOString(),
    idFactory = defaultIdFactory(),
    readOnly = false,
  } = {}) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      throw identityError(
        'IDENTITY_MISSING',
        'Identity database is missing; automatic recreation is forbidden',
        { path: resolved }
      );
    }
    if (!fs.statSync(resolved).isFile()) {
      throw identityError(
        'IDENTITY_NOT_FILE',
        'Identity database path is not a regular file',
        { path: resolved }
      );
    }

    const mode = fs.statSync(resolved).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw identityError(
        'IDENTITY_PERMISSIONS_UNSAFE',
        'Identity database must not be group/world accessible',
        { path: resolved, mode: mode.toString(8) }
      );
    }

    let store;
    try {
      store = new IdentityStore(resolved, {
        now,
        idFactory,
        readOnly,
      });
    } catch (error) {
      throw identityError(
        'IDENTITY_OPEN_FAILED',
        'Identity database could not be opened',
        {
          path: resolved,
          cause_code: error.code || null,
        }
      );
    }

    try {
      store.validate();
      return store;
    } catch (error) {
      store.close();
      if (error?.name === 'IdentityError') throw error;
      throw identityError(
        'IDENTITY_INTEGRITY_FAILED',
        'Identity database validation failed',
        {
          path: resolved,
          cause_code: error.code || null,
        }
      );
    }
  }

  constructor(filePath, { now, idFactory, readOnly = false }) {
    this.filePath = filePath;
    this.now = now;
    this.idFactory = idFactory;
    this.readOnly = readOnly;
    this.db = new DatabaseSync(filePath, { readOnly });
    this.db.exec(`
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
    `);
  }

  assertWritable() {
    if (this.readOnly) {
      throw identityError(
        'IDENTITY_READ_ONLY',
        'Identity store was opened read-only'
      );
    }
  }

  validate() {
    const integrity = integrityCheck(this.db);
    if (integrity.length !== 1 || integrity[0] !== 'ok') {
      throw identityError(
        'IDENTITY_INTEGRITY_FAILED',
        'Identity database integrity check failed',
        { integrity }
      );
    }

    const journalMode = String(
      this.db.prepare('PRAGMA journal_mode').get()?.journal_mode || ''
    ).toLowerCase();
    if (journalMode !== 'delete') {
      throw identityError(
        'IDENTITY_JOURNAL_MODE_UNSAFE',
        'Identity database must use DELETE journal mode',
        { journal_mode: journalMode }
      );
    }

    const version = Number(
      this.db.prepare('PRAGMA user_version').get()?.user_version || 0
    );
    if (version !== IDENTITY_SCHEMA_VERSION) {
      throw identityError(
        'IDENTITY_SCHEMA_MISMATCH',
        'Identity database schema version is not supported',
        {
          expected: IDENTITY_SCHEMA_VERSION,
          actual: version,
        }
      );
    }

    const missingTables = IDENTITY_REQUIRED_TABLES.filter(
      table => !tableExists(this.db, table)
    );
    if (missingTables.length) {
      throw identityError(
        'IDENTITY_SCHEMA_INCOMPLETE',
        'Identity database is missing required tables',
        { missing_tables: missingTables }
      );
    }

    const meta = this.db.prepare(
      'SELECT schema_version, revision FROM identity_meta WHERE singleton=1'
    ).get();
    if (!meta || Number(meta.schema_version) !== IDENTITY_SCHEMA_VERSION) {
      throw identityError(
        'IDENTITY_META_INVALID',
        'Identity metadata is missing or incompatible'
      );
    }

    return {
      schema_version: version,
      revision: Number(meta.revision),
      integrity: 'ok',
    };
  }

  metadata() {
    const row = this.db.prepare(
      'SELECT schema_version, revision, created_at, updated_at ' +
      'FROM identity_meta WHERE singleton=1'
    ).get();
    return {
      schema_version: Number(row.schema_version),
      revision: Number(row.revision),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  bumpRevision(at) {
    this.db.prepare(`
      UPDATE identity_meta
      SET revision = revision + 1, updated_at = ?
      WHERE singleton=1
    `).run(at);
  }

  getProduct(productId) {
    return this.db.prepare(
      'SELECT * FROM products WHERE product_id=?'
    ).get(productId);
  }

  getVariant(variantId) {
    return this.db.prepare(
      'SELECT * FROM variants WHERE variant_id=?'
    ).get(variantId);
  }

  lookupVariantBySku(rawSku) {
    const { sku_key } = normalizeSku(rawSku);

    const canonical = this.db.prepare(
      'SELECT * FROM variants WHERE sku_key=?'
    ).get(sku_key);
    if (canonical) {
      return {
        ...canonical,
        matched_by: 'canonical',
        matched_sku: canonical.sku,
      };
    }

    const alias = this.db.prepare(`
      SELECT v.*, a.alias_sku
      FROM sku_aliases a
      JOIN variants v ON v.variant_id = a.variant_id
      WHERE a.alias_sku_key=?
    `).get(sku_key);

    if (!alias) return undefined;
    const { alias_sku, ...variant } = alias;
    return {
      ...variant,
      matched_by: 'alias',
      matched_sku: alias_sku,
    };
  }

  lookupProductBySource({ provider, nativeProductId }) {
    requireText('provider', provider);
    requireText('nativeProductId', nativeProductId);
    return this.db.prepare(`
      SELECT sp.product_id, p.lifecycle
      FROM source_products sp JOIN products p ON p.product_id=sp.product_id
      WHERE sp.provider=? AND sp.native_product_id=?
    `).get(provider, nativeProductId);
  }

  lookupVariantBySource({ provider, nativeVariantId }) {
    requireText('provider', provider);
    requireText('nativeVariantId', nativeVariantId);
    return this.db.prepare(`
      SELECT v.variant_id,v.product_id,v.sku,v.sku_key,v.lifecycle
      FROM source_variants sv JOIN variants v ON v.variant_id=sv.variant_id
      WHERE sv.provider=? AND sv.native_variant_id=?
    `).get(provider, nativeVariantId);
  }

  ensureProduct({
    provider,
    nativeProductId,
    productId = null,
  }) {
    this.assertWritable();
    requireText('provider', provider);
    requireText('nativeProductId', nativeProductId);
    if (productId !== null) requireText('productId', productId);

    return transaction(this.db, () => {
      const existingXref = this.db.prepare(`
        SELECT sp.provider, sp.native_product_id, sp.product_id,
               p.lifecycle
        FROM source_products sp
        JOIN products p ON p.product_id = sp.product_id
        WHERE sp.provider=? AND sp.native_product_id=?
      `).get(provider, nativeProductId);

      if (existingXref) {
        if (productId && existingXref.product_id !== productId) {
          throw identityError(
            'IDENTITY_PRODUCT_XREF_CONFLICT',
            'Provider-native product is already bound to another product',
            {
              provider,
              native_product_id: nativeProductId,
              existing_product_id: existingXref.product_id,
              requested_product_id: productId,
            }
          );
        }
        if (existingXref.lifecycle !== 'active') {
          throw identityError(
            'IDENTITY_PRODUCT_TOMBSTONED',
            'Provider-native product resolves to a tombstoned product',
            {
              provider,
              native_product_id: nativeProductId,
              product_id: existingXref.product_id,
            }
          );
        }

        this.db.prepare(`
          UPDATE source_products
          SET last_seen_at=?
          WHERE provider=? AND native_product_id=?
        `).run(this.now(), provider, nativeProductId);

        return {
          product_id: existingXref.product_id,
          created: false,
          xref_created: false,
          revision: this.metadata().revision,
        };
      }

      const at = this.now();
      let canonicalId = productId;
      let created = false;

      if (canonicalId) {
        const canonical = this.getProduct(canonicalId);
        if (!canonical) {
          throw identityError(
            'IDENTITY_PRODUCT_NOT_FOUND',
            'Requested canonical product does not exist',
            { product_id: canonicalId }
          );
        }
        if (canonical.lifecycle !== 'active') {
          throw identityError(
            'IDENTITY_PRODUCT_TOMBSTONED',
            'Requested canonical product is tombstoned',
            { product_id: canonicalId }
          );
        }
      } else {
        canonicalId = requireText(
          'generatedProductId',
          this.idFactory.product()
        );
        if (this.getProduct(canonicalId)) {
          throw identityError(
            'IDENTITY_GENERATED_ID_COLLISION',
            'Generated product ID already exists',
            { product_id: canonicalId }
          );
        }
        this.db.prepare(`
          INSERT INTO products(
            product_id, lifecycle, created_at, updated_at
          ) VALUES(?, 'active', ?, ?)
        `).run(canonicalId, at, at);
        created = true;
      }

      this.db.prepare(`
        INSERT INTO source_products(
          provider, native_product_id, product_id,
          first_seen_at, last_seen_at
        ) VALUES(?,?,?,?,?)
      `).run(
        provider,
        nativeProductId,
        canonicalId,
        at,
        at
      );
      this.bumpRevision(at);

      return {
        product_id: canonicalId,
        created,
        xref_created: true,
        revision: this.metadata().revision,
      };
    });
  }

  ensureVariant({
    provider,
    nativeVariantId,
    productId,
    sku,
  }) {
    this.assertWritable();
    requireText('provider', provider);
    requireText('nativeVariantId', nativeVariantId);
    requireText('productId', productId);
    const normalized = normalizeSku(sku);

    return transaction(this.db, () => {
      const product = this.getProduct(productId);
      if (!product) {
        throw identityError(
          'IDENTITY_PRODUCT_NOT_FOUND',
          'Canonical product does not exist',
          { product_id: productId }
        );
      }
      if (product.lifecycle !== 'active') {
        throw identityError(
          'IDENTITY_PRODUCT_TOMBSTONED',
          'Canonical product is tombstoned',
          { product_id: productId }
        );
      }

      const existingXref = this.db.prepare(`
        SELECT sv.provider, sv.native_variant_id, sv.variant_id,
               v.product_id, v.sku, v.sku_key, v.lifecycle
        FROM source_variants sv
        JOIN variants v ON v.variant_id = sv.variant_id
        WHERE sv.provider=? AND sv.native_variant_id=?
      `).get(provider, nativeVariantId);

      if (existingXref) {
        if (existingXref.product_id !== productId) {
          throw identityError(
            'IDENTITY_VARIANT_PRODUCT_CONFLICT',
            'Provider-native variant is already bound to another product',
            {
              provider,
              native_variant_id: nativeVariantId,
              existing_product_id: existingXref.product_id,
              requested_product_id: productId,
            }
          );
        }
        if (existingXref.sku_key !== normalized.sku_key) {
          throw identityError(
            'IDENTITY_VARIANT_SKU_CONFLICT',
            'Provider-native variant changed canonical SKU identity',
            {
              provider,
              native_variant_id: nativeVariantId,
              existing_sku: existingXref.sku,
              requested_sku: sku,
            }
          );
        }
        if (existingXref.lifecycle !== 'active') {
          throw identityError(
            'IDENTITY_VARIANT_TOMBSTONED',
            'Provider-native variant resolves to a tombstoned variant',
            {
              provider,
              native_variant_id: nativeVariantId,
              variant_id: existingXref.variant_id,
            }
          );
        }

        this.db.prepare(`
          UPDATE source_variants
          SET last_seen_at=?
          WHERE provider=? AND native_variant_id=?
        `).run(this.now(), provider, nativeVariantId);

        return {
          variant_id: existingXref.variant_id,
          created: false,
          xref_created: false,
          revision: this.metadata().revision,
        };
      }

      const bySku = this.db.prepare(
        'SELECT * FROM variants WHERE sku_key=?'
      ).get(normalized.sku_key);

      const at = this.now();
      let variantId;
      let created = false;

      if (bySku) {
        if (bySku.lifecycle !== 'active') {
          throw identityError(
            'IDENTITY_VARIANT_TOMBSTONED',
            'Canonical SKU belongs to a tombstoned variant',
            {
              sku,
              sku_key: normalized.sku_key,
              variant_id: bySku.variant_id,
            }
          );
        }
        if (bySku.product_id !== productId) {
          throw identityError(
            'IDENTITY_SKU_PRODUCT_COLLISION',
            'Canonical SKU already belongs to another product',
            {
              sku,
              sku_key: normalized.sku_key,
              existing_product_id: bySku.product_id,
              requested_product_id: productId,
            }
          );
        }
        variantId = bySku.variant_id;
      } else {
        variantId = requireText(
          'generatedVariantId',
          this.idFactory.variant()
        );
        if (this.getVariant(variantId)) {
          throw identityError(
            'IDENTITY_GENERATED_ID_COLLISION',
            'Generated variant ID already exists',
            { variant_id: variantId }
          );
        }

        this.db.prepare(`
          INSERT INTO variants(
            variant_id, product_id, sku, sku_key,
            lifecycle, created_at, updated_at
          ) VALUES(?,?,?,?, 'active', ?, ?)
        `).run(
          variantId,
          productId,
          sku,
          normalized.sku_key,
          at,
          at
        );
        created = true;
      }

      this.db.prepare(`
        INSERT INTO source_variants(
          provider, native_variant_id, variant_id,
          first_seen_at, last_seen_at
        ) VALUES(?,?,?,?,?)
      `).run(
        provider,
        nativeVariantId,
        variantId,
        at,
        at
      );
      this.bumpRevision(at);

      return {
        variant_id: variantId,
        created,
        xref_created: true,
        revision: this.metadata().revision,
      };
    });
  }

  addSkuAlias({
    aliasSku,
    variantId,
    reviewedSource,
  }) {
    this.assertWritable();
    requireText('variantId', variantId);
    requireText('reviewedSource', reviewedSource);
    const normalized = normalizeSku(aliasSku);

    return transaction(this.db, () => {
      const variant = this.getVariant(variantId);
      if (!variant) {
        throw identityError(
          'IDENTITY_VARIANT_NOT_FOUND',
          'Variant does not exist',
          { variant_id: variantId }
        );
      }
      if (variant.lifecycle !== 'active') {
        throw identityError(
          'IDENTITY_VARIANT_TOMBSTONED',
          'Cannot add an alias to a tombstoned variant',
          { variant_id: variantId }
        );
      }

      const canonical = this.db.prepare(
        'SELECT variant_id FROM variants WHERE sku_key=?'
      ).get(normalized.sku_key);
      if (canonical) {
        throw identityError(
          canonical.variant_id === variantId
            ? 'IDENTITY_ALIAS_REDUNDANT_CANONICAL'
            : 'IDENTITY_ALIAS_CANONICAL_COLLISION',
          'Alias SKU collides with a canonical SKU',
          {
            alias_sku: aliasSku,
            canonical_variant_id: canonical.variant_id,
          }
        );
      }

      const existing = this.db.prepare(
        'SELECT * FROM sku_aliases WHERE alias_sku_key=?'
      ).get(normalized.sku_key);
      if (existing) {
        if (existing.variant_id !== variantId) {
          throw identityError(
            'IDENTITY_ALIAS_CONFLICT',
            'Alias SKU is already bound to another variant',
            {
              alias_sku: aliasSku,
              existing_variant_id: existing.variant_id,
              requested_variant_id: variantId,
            }
          );
        }
        return {
          changed: false,
          variant_id: variantId,
          revision: this.metadata().revision,
        };
      }

      const at = this.now();
      this.db.prepare(`
        INSERT INTO sku_aliases(
          alias_sku, alias_sku_key, variant_id,
          reviewed_source, created_at
        ) VALUES(?,?,?,?,?)
      `).run(
        aliasSku,
        normalized.sku_key,
        variantId,
        reviewedSource,
        at
      );
      this.bumpRevision(at);

      return {
        changed: true,
        variant_id: variantId,
        revision: this.metadata().revision,
      };
    });
  }

  renameVariantSku({
    variantId,
    newSku,
    reviewedSource,
  }) {
    this.assertWritable();
    requireText('variantId', variantId);
    requireText('reviewedSource', reviewedSource);
    const normalized = normalizeSku(newSku);

    return transaction(this.db, () => {
      const variant = this.getVariant(variantId);
      if (!variant) {
        throw identityError(
          'IDENTITY_VARIANT_NOT_FOUND',
          'Variant does not exist',
          { variant_id: variantId }
        );
      }
      if (variant.lifecycle !== 'active') {
        throw identityError(
          'IDENTITY_VARIANT_TOMBSTONED',
          'Cannot rename a tombstoned variant',
          { variant_id: variantId }
        );
      }

      if (
        variant.sku_key === normalized.sku_key &&
        variant.sku === newSku
      ) {
        return {
          changed: false,
          variant_id: variantId,
          revision: this.metadata().revision,
        };
      }

      const otherCanonical = this.db.prepare(`
        SELECT variant_id
        FROM variants
        WHERE sku_key=? AND variant_id<>?
      `).get(normalized.sku_key, variantId);
      if (otherCanonical) {
        throw identityError(
          'IDENTITY_SKU_RENAME_COLLISION',
          'New SKU already belongs to another canonical variant',
          {
            new_sku: newSku,
            existing_variant_id: otherCanonical.variant_id,
          }
        );
      }

      const targetAlias = this.db.prepare(
        'SELECT variant_id FROM sku_aliases WHERE alias_sku_key=?'
      ).get(normalized.sku_key);
      if (targetAlias && targetAlias.variant_id !== variantId) {
        throw identityError(
          'IDENTITY_SKU_RENAME_ALIAS_COLLISION',
          'New SKU is an alias of another variant',
          {
            new_sku: newSku,
            existing_variant_id: targetAlias.variant_id,
          }
        );
      }

      const at = this.now();

      if (variant.sku_key !== normalized.sku_key) {
        const oldAlias = this.db.prepare(
          'SELECT variant_id FROM sku_aliases WHERE alias_sku_key=?'
        ).get(variant.sku_key);

        if (oldAlias && oldAlias.variant_id !== variantId) {
          throw identityError(
            'IDENTITY_OLD_SKU_ALIAS_COLLISION',
            'Old canonical SKU is already an alias of another variant',
            {
              old_sku: variant.sku,
              existing_variant_id: oldAlias.variant_id,
            }
          );
        }

        if (!oldAlias) {
          this.db.prepare(`
            INSERT INTO sku_aliases(
              alias_sku, alias_sku_key, variant_id,
              reviewed_source, created_at
            ) VALUES(?,?,?,?,?)
          `).run(
            variant.sku,
            variant.sku_key,
            variantId,
            reviewedSource,
            at
          );
        }

        if (targetAlias?.variant_id === variantId) {
          this.db.prepare(
            'DELETE FROM sku_aliases WHERE alias_sku_key=?'
          ).run(normalized.sku_key);
        }
      }

      this.db.prepare(`
        UPDATE variants
        SET sku=?, sku_key=?, updated_at=?
        WHERE variant_id=?
      `).run(
        newSku,
        normalized.sku_key,
        at,
        variantId
      );
      this.bumpRevision(at);

      return {
        changed: true,
        variant_id: variantId,
        old_sku: variant.sku,
        new_sku: newSku,
        revision: this.metadata().revision,
      };
    });
  }

  tombstoneVariant(variantId) {
    this.assertWritable();
    requireText('variantId', variantId);
    return transaction(this.db, () => {
      const existing = this.getVariant(variantId);
      if (!existing) {
        throw identityError(
          'IDENTITY_VARIANT_NOT_FOUND',
          'Variant does not exist',
          { variant_id: variantId }
        );
      }
      if (existing.lifecycle === 'tombstoned') {
        return {
          variant_id: variantId,
          changed: false,
          revision: this.metadata().revision,
        };
      }
      const at = this.now();
      this.db.prepare(`
        UPDATE variants
        SET lifecycle='tombstoned', updated_at=?
        WHERE variant_id=?
      `).run(at, variantId);
      this.bumpRevision(at);
      return {
        variant_id: variantId,
        changed: true,
        revision: this.metadata().revision,
      };
    });
  }

  tombstoneProduct(productId) {
    this.assertWritable();
    requireText('productId', productId);
    return transaction(this.db, () => {
      const product = this.getProduct(productId);
      if (!product) {
        throw identityError(
          'IDENTITY_PRODUCT_NOT_FOUND',
          'Product does not exist',
          { product_id: productId }
        );
      }
      const activeVariants = Number(
        this.db.prepare(`
          SELECT COUNT(*) c
          FROM variants
          WHERE product_id=? AND lifecycle='active'
        `).get(productId).c
      );
      if (activeVariants > 0) {
        throw identityError(
          'IDENTITY_PRODUCT_HAS_ACTIVE_VARIANTS',
          'Product cannot be tombstoned while active variants remain',
          {
            product_id: productId,
            active_variants: activeVariants,
          }
        );
      }
      if (product.lifecycle === 'tombstoned') {
        return {
          product_id: productId,
          changed: false,
          revision: this.metadata().revision,
        };
      }
      const at = this.now();
      this.db.prepare(`
        UPDATE products
        SET lifecycle='tombstoned', updated_at=?
        WHERE product_id=?
      `).run(at, productId);
      this.bumpRevision(at);
      return {
        product_id: productId,
        changed: true,
        revision: this.metadata().revision,
      };
    });
  }

  stats() {
    const scalar = (sql, ...params) => Number(
      this.db.prepare(sql).get(...params).c
    );

    return {
      products: scalar('SELECT COUNT(*) c FROM products'),
      products_active: scalar(
        "SELECT COUNT(*) c FROM products WHERE lifecycle='active'"
      ),
      products_tombstoned: scalar(
        "SELECT COUNT(*) c FROM products WHERE lifecycle='tombstoned'"
      ),
      variants: scalar('SELECT COUNT(*) c FROM variants'),
      variants_active: scalar(
        "SELECT COUNT(*) c FROM variants WHERE lifecycle='active'"
      ),
      variants_tombstoned: scalar(
        "SELECT COUNT(*) c FROM variants WHERE lifecycle='tombstoned'"
      ),
      source_products: scalar(
        'SELECT COUNT(*) c FROM source_products'
      ),
      source_variants: scalar(
        'SELECT COUNT(*) c FROM source_variants'
      ),
      sku_aliases: scalar('SELECT COUNT(*) c FROM sku_aliases'),
      config_entries: scalar(
        'SELECT COUNT(*) c FROM config_state'
      ),
    };
  }

  setConfigHash(configKey, sha256) {
    this.assertWritable();
    requireText('configKey', configKey);
    if (
      typeof sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(sha256)
    ) {
      throw identityError(
        'IDENTITY_CONFIG_HASH_INVALID',
        'Config hash must be a SHA-256 hex digest',
        { config_key: configKey }
      );
    }

    return transaction(this.db, () => {
      const at = this.now();
      const existing = this.db.prepare(
        'SELECT sha256 FROM config_state WHERE config_key=?'
      ).get(configKey);
      const normalizedHash = sha256.toLowerCase();

      if (existing?.sha256 === normalizedHash) {
        return {
          changed: false,
          revision: this.metadata().revision,
        };
      }

      this.db.prepare(`
        INSERT INTO config_state(config_key, sha256, applied_at)
        VALUES(?,?,?)
        ON CONFLICT(config_key) DO UPDATE SET
          sha256=excluded.sha256,
          applied_at=excluded.applied_at
      `).run(configKey, normalizedHash, at);
      this.bumpRevision(at);

      return {
        changed: true,
        revision: this.metadata().revision,
      };
    });
  }

  close() {
    this.db.close();
  }
}
