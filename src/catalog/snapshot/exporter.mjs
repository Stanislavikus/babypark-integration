import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  MANIFEST_FILE,
  SNAPSHOT_SCHEMA,
  SNAPSHOT_STREAMS,
} from './contract.mjs';
import { verifyCatalogSnapshot } from './verifier.mjs';
import { canonicalBoolean, parseCanonicalJson } from '../domain/canonical-values.mjs';
import { CatalogPublicationLock } from '../sqlite/publication-lock.mjs';
import { assertNoSymlinkPathComponents } from './filesystem.mjs';
import { validateReleaseProvenance } from '../../release-provenance.mjs';

const QUERIES = Object.freeze({
  products: 'SELECT product_id,kind,product_type,brand_id,default_variant_id,lifecycle,provenance_json,updated_at FROM products ORDER BY product_id',
  product_text: 'SELECT product_id,language,title,short_description,description,url FROM product_text ORDER BY product_id,language',
  variants: 'SELECT variant_id,product_id,sku,sku_key,gtin,is_default,commercial_availability,options_json,lifecycle,updated_at FROM variants ORDER BY variant_id',
  offers: 'SELECT variant_id,current_minor,regular_minor,currency,on_sale,tax_included,valid_from,valid_to,source_updated_at FROM variant_offers ORDER BY variant_id',
  brands: 'SELECT brand_id,name,provenance_json FROM brands ORDER BY brand_id',
  categories: 'SELECT category_id,parent_id,name_json,provenance_json FROM categories ORDER BY category_id',
  product_categories: 'SELECT product_id,category_id,is_primary FROM product_categories ORDER BY product_id,category_id',
  stores: 'SELECT store_id,name,active,metadata_json FROM stores ORDER BY store_id',
  store_stock: 'SELECT variant_id,store_id,quantity,source_updated_at FROM store_stock ORDER BY variant_id,store_id',
  attribute_definitions: 'SELECT attribute_id,code,type,label_json,provenance_json FROM attribute_defs ORDER BY attribute_id',
  attributes: 'SELECT owner_type,owner_id,attribute_id,value_json FROM product_attributes ORDER BY owner_type,owner_id,attribute_id',
  images: 'SELECT image_id,product_id,variant_id,url,role,position,metadata_json FROM images ORDER BY image_id',
  kit_components: 'SELECT kit_product_id,component_variant_id,quantity,discount_minor,mutable,metadata_json FROM kit_components ORDER BY kit_product_id,component_variant_id',
});

const JSON_FIELDS = new Set([
  'provenance_json', 'options_json', 'name_json', 'metadata_json',
  'label_json', 'value_json',
]);
const JSON_OUTPUT_FIELDS = Object.freeze({
  name_json: 'names',
  label_json: 'labels',
  value_json: 'value',
});
const BOOLEAN_FIELDS = new Set(['is_default', 'on_sale', 'tax_included', 'is_primary', 'active', 'mutable']);

function canonicalRow(row) {
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.endsWith('_json') && JSON_FIELDS.has(key)) {
      result[JSON_OUTPUT_FIELDS[key] || key.slice(0, -5)] =
        parseCanonicalJson(value, key);
    } else if (BOOLEAN_FIELDS.has(key)) {
      result[key] = value === null ? null : canonicalBoolean(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function assertSafeRoot(outputDir) {
  const resolved = assertNoSymlinkPathComponents(outputDir, 'snapshot output path');
  if (fs.existsSync(resolved)) {
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('snapshot output root must be a real directory');
    }
    if ((stat.mode & 0o077) !== 0) {
      throw new Error(
        'existing snapshot output root must already have private permissions'
      );
    }
  } else {
    fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  }
  return resolved;
}

function fsyncDirectory(directory) {
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function writeStream(db, directory, filename, entity) {
  const target = path.join(directory, filename);
  const fd = fs.openSync(target, 'wx', 0o600);
  const hash = createHash('sha256');
  let records = 0;
  let bytes = 0;
  try {
    // DatabaseSync statement.iterate() advances one SQLite row at a time. It
    // avoids both full-table .all() residency and per-aggregate N+1 queries.
    for (const raw of db.prepare(QUERIES[entity]).iterate()) {
      const line = JSON.stringify(canonicalRow(raw)) + '\n';
      const buffer = Buffer.from(line);
      fs.writeSync(fd, buffer);
      hash.update(buffer);
      bytes += buffer.length;
      records += 1;
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return { file: filename, entity, records, bytes, sha256: hash.digest('hex') };
}

function readMetadata(db) {
  const meta = db.prepare('SELECT generation_id,source_epoch,identity_revision,sealed_at,dependency_fingerprint,manifest_sha256,manifest_json FROM catalog_meta WHERE singleton=1').get();
  const layers = {};
  for (const row of db.prepare('SELECT layer,accepted_watermark,accepted_source_fingerprint,source_updated_at,provider_completed_at,integration_synced_at,last_run_id,last_ok_at,freshness_state,need_reconcile,need_full FROM sync_state ORDER BY layer').iterate()) {
    layers[row.layer] = {
      accepted_watermark: row.accepted_watermark,
      accepted_source_fingerprint: row.accepted_source_fingerprint,
      source_updated_at: row.source_updated_at,
      provider_completed_at: row.provider_completed_at,
      integration_synced_at: row.integration_synced_at,
      last_run_id: row.last_run_id,
      last_ok_at: row.last_ok_at,
      freshness_state: row.freshness_state,
      need_reconcile: Number(row.need_reconcile) === 1,
      need_full: Number(row.need_full) === 1,
    };
  }
  return { meta, layers };
}

export function exportCatalogSnapshot(reader, {
  outputDir,
  snapshotId,
  createdAt = new Date().toISOString(),
  release,
  publicationLock,
  beforePublish = null,
  failpoint = null,
} = {}) {
  if (!reader || typeof reader.withPinnedDb !== 'function') throw new TypeError('CatalogReader with pinned reads is required');
  if (!(publicationLock instanceof CatalogPublicationLock)) throw new TypeError('CatalogPublicationLock is required');
  if (!release || typeof release.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(release.sha256)) throw new TypeError('validated release provenance is required');
  validateReleaseProvenance(release.document);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(snapshotId || '')) throw new Error('invalid snapshot id');
  const root = assertSafeRoot(outputDir);
  const building = path.join(root, snapshotId + '.building');
  const ready = path.join(root, snapshotId + '.ready');
  if (fs.existsSync(building) || fs.existsSync(ready)) throw new Error('snapshot artifact already exists');
  return publicationLock.withLock(() => {
    fs.mkdirSync(building, { mode: 0o700 });
    let generationId;
    let renamed = false;
    try {
      const manifest = reader.withPinnedDb((db, pinnedGenerationId) => {
        generationId = pinnedGenerationId;
        const { meta, layers } = readMetadata(db);
        if (meta.generation_id !== pinnedGenerationId) {
          throw new Error('generation metadata mismatch');
        }
        const files = SNAPSHOT_STREAMS.map(
          ([filename, entity]) =>
            writeStream(db, building, filename, entity)
        );
        const document = {
          schema: SNAPSHOT_SCHEMA,
          generation_id: meta.generation_id,
          source_epoch: meta.source_epoch,
          identity_revision: Number(meta.identity_revision),
          dependency_fingerprint: meta.dependency_fingerprint,
          sealed_at: meta.sealed_at,
          source_manifest_sha256: meta.manifest_sha256,
          source_manifest: meta.manifest_json
            ? JSON.parse(meta.manifest_json)
            : null,
          layers,
          created_at: createdAt,
          exporter: { name: 'babypark-integration', release },
          files,
          total_records: files.reduce(
            (sum, file) => sum + file.records,
            0
          ),
        };
        const manifestPath = path.join(building, MANIFEST_FILE);
        const fd = fs.openSync(manifestPath, 'wx', 0o600);
        try {
          fs.writeSync(fd, JSON.stringify(document, null, 2) + '\n');
          fs.fsyncSync(fd);
        } finally { fs.closeSync(fd); }
        fsyncDirectory(building);
        return document;
      });
      verifyCatalogSnapshot(building, {
        expectedGenerationId: generationId,
        allowBuilding: true,
      });
      if (beforePublish) beforePublish({ generationId, building, ready });
      reader.assertCurrent(generationId);
      if (fs.existsSync(ready)) {
        throw new Error('snapshot ready artifact already exists');
      }
      fs.renameSync(building, ready);
      renamed = true;
      if (failpoint) failpoint('snapshot.parentFsync');
      fsyncDirectory(root);
      return { path: ready, manifest };
    } catch (error) {
      if (renamed) {
        try {
          fs.rmSync(ready, { recursive: true, force: true });
        } catch (cleanupError) {
          error.snapshotCleanupError = cleanupError;
        }
        try { fsyncDirectory(root); } catch {}
      } else {
        fs.rmSync(building, { recursive: true, force: true });
      }
      throw error;
    }
  });
}
