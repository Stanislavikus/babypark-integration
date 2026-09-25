import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CatalogPublicationLock } from './publication-lock.mjs';
import {
  CATALOG_LAYERS,
  CATALOG_REQUIRED_TABLES,
  CATALOG_SCHEMA_VERSION,
  initializeCatalogSchema,
} from './schema.mjs';
import { catalogError } from './errors.mjs';

const GENERATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const RUN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const POINTER_NAMES = new Set(['CURRENT', 'PREVIOUS']);
let pointerNonce = 0;

function requireText(name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw catalogError(
      'CATALOG_INVALID_ARGUMENT',
      name + ' must be a non-empty string',
      { argument: name }
    );
  }
  return value;
}

export function validateGenerationId(generationId) {
  requireText('generationId', generationId);
  if (!GENERATION_ID_RE.test(generationId)) {
    throw catalogError(
      'CATALOG_GENERATION_ID_INVALID',
      'Generation ID contains unsafe characters',
      { generation_id: generationId }
    );
  }
  return generationId;
}

export function generationFilename(generationId) {
  return 'catalog.' + validateGenerationId(generationId) + '.sqlite';
}

export function buildingFilename(generationId) {
  return 'catalog.' + validateGenerationId(generationId) + '.building.sqlite';
}

export function generationIdFromFilename(filename) {
  const match = /^catalog\.([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.sqlite$/.exec(
    String(filename || '')
  );
  if (!match) {
    throw catalogError(
      'CATALOG_POINTER_INVALID',
      'Catalog pointer contains an invalid generation filename',
      { filename }
    );
  }
  return match[1];
}

function requireStorageDir(storageDir) {
  const resolved = path.resolve(storageDir);
  if (!fs.existsSync(resolved)) {
    throw catalogError(
      'CATALOG_STORAGE_MISSING',
      'Catalog storage directory does not exist',
      { storage_dir: resolved }
    );
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw catalogError(
      'CATALOG_STORAGE_NOT_DIRECTORY',
      'Catalog storage path is not a directory',
      { storage_dir: resolved }
    );
  }
  return resolved;
}

function fsyncFile(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function fsyncDirectory(directory) {
  const fd = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function fileSidecars(filePath) {
  return [
    filePath + '-wal',
    filePath + '-shm',
    filePath + '-journal',
  ];
}

function removeOwnArtifacts(filePath) {
  for (const candidate of [filePath, ...fileSidecars(filePath)]) {
    try {
      if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
    } catch {
      // Preserve the original failure.
    }
  }
}

function assertUnused(paths) {
  for (const filePath of paths) {
    if (fs.existsSync(filePath)) {
      throw catalogError(
        'CATALOG_ARTIFACT_EXISTS',
        'Catalog generation artifact already exists',
        { path: filePath }
      );
    }
  }
}

function tableExists(db, table) {
  return Boolean(
    db.prepare(
      'SELECT 1 FROM sqlite_master WHERE type IN (?,?) AND name=?'
    ).get('table', 'view', table)
  );
}

function virtualTableExists(db, table) {
  return Boolean(
    db.prepare(
      'SELECT 1 FROM sqlite_master WHERE type=? AND name=?'
    ).get('table', table)
  );
}

function integrityRows(db) {
  return db.prepare('PRAGMA integrity_check').all()
    .map(row => String(Object.values(row)[0]));
}

function foreignKeyRows(db) {
  return db.prepare('PRAGMA foreign_key_check').all();
}

function catalogMeta(db) {
  return db.prepare('SELECT * FROM catalog_meta WHERE singleton=1').get();
}

function layerRows(db) {
  return db.prepare(
    'SELECT * FROM sync_state ORDER BY layer'
  ).all();
}

function tableCounts(db) {
  const tables = [
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
    'fts_words',
    'fts_trigram',
  ];
  const result = {};
  for (const table of tables) {
    result[table] = Number(
      db.prepare('SELECT COUNT(*) c FROM ' + table).get().c
    );
  }
  return result;
}

function logicalIntegrityErrors(db) {
  const errors = [];

  const badDefault = Number(db.prepare(
    'SELECT COUNT(*) c ' +
    'FROM products p ' +
    'LEFT JOIN variants v ON v.variant_id=p.default_variant_id ' +
    'WHERE p.default_variant_id IS NOT NULL ' +
    'AND (v.variant_id IS NULL OR v.product_id<>p.product_id)'
  ).get().c);
  if (badDefault) {
    errors.push({
      code: 'DEFAULT_VARIANT_MISMATCH',
      count: badDefault,
    });
  }

  const badAttributes = Number(db.prepare(
    'SELECT COUNT(*) c FROM product_attributes a ' +
    'WHERE (a.owner_type=\'PRODUCT\' AND NOT EXISTS (' +
    'SELECT 1 FROM products p WHERE p.product_id=a.owner_id)) ' +
    'OR (a.owner_type=\'VARIANT\' AND NOT EXISTS (' +
    'SELECT 1 FROM variants v WHERE v.variant_id=a.owner_id))'
  ).get().c);
  if (badAttributes) {
    errors.push({
      code: 'ATTRIBUTE_OWNER_MISSING',
      count: badAttributes,
    });
  }

  const badImages = Number(db.prepare(
    'SELECT COUNT(*) c FROM images i ' +
    'JOIN variants v ON v.variant_id=i.variant_id ' +
    'WHERE i.variant_id IS NOT NULL AND v.product_id<>i.product_id'
  ).get().c);
  if (badImages) {
    errors.push({
      code: 'IMAGE_VARIANT_PRODUCT_MISMATCH',
      count: badImages,
    });
  }

  const badKits = Number(db.prepare(
    'SELECT COUNT(*) c FROM kit_components kc ' +
    'JOIN products p ON p.product_id=kc.kit_product_id ' +
    'WHERE p.kind<>\'KIT\''
  ).get().c);
  if (badKits) {
    errors.push({
      code: 'KIT_COMPONENT_OWNER_NOT_KIT',
      count: badKits,
    });
  }

  return errors;
}

function validateDbHandle(db, {
  expectedGenerationId = null,
  requireReady = false,
  requireStandalone = false,
} = {}) {
  const integrity = integrityRows(db);
  if (integrity.length !== 1 || integrity[0] !== 'ok') {
    throw catalogError(
      'CATALOG_INTEGRITY_FAILED',
      'Catalog integrity_check failed',
      { integrity }
    );
  }

  const version = Number(
    db.prepare('PRAGMA user_version').get()?.user_version || 0
  );
  if (version !== CATALOG_SCHEMA_VERSION) {
    throw catalogError(
      'CATALOG_SCHEMA_MISMATCH',
      'Catalog schema version is not supported',
      {
        expected: CATALOG_SCHEMA_VERSION,
        actual: version,
      }
    );
  }

  const required = [...CATALOG_REQUIRED_TABLES, 'fts_words', 'fts_trigram'];
  const missing = required.filter(table => {
    if (table === 'fts_words' || table === 'fts_trigram') {
      return !virtualTableExists(db, table);
    }
    return !tableExists(db, table);
  });
  if (missing.length) {
    throw catalogError(
      'CATALOG_SCHEMA_INCOMPLETE',
      'Catalog is missing required tables',
      { missing_tables: missing }
    );
  }

  const meta = catalogMeta(db);
  if (!meta) {
    throw catalogError(
      'CATALOG_META_MISSING',
      'Catalog metadata row is missing'
    );
  }
  if (Number(meta.schema_version) !== CATALOG_SCHEMA_VERSION) {
    throw catalogError(
      'CATALOG_META_SCHEMA_MISMATCH',
      'Catalog metadata schema version is invalid'
    );
  }
  if (
    expectedGenerationId !== null &&
    meta.generation_id !== expectedGenerationId
  ) {
    throw catalogError(
      'CATALOG_GENERATION_MISMATCH',
      'Catalog generation ID does not match the expected file',
      {
        expected: expectedGenerationId,
        actual: meta.generation_id,
      }
    );
  }
  if (requireReady && meta.state !== 'ready') {
    throw catalogError(
      'CATALOG_NOT_READY',
      'Catalog generation is not sealed and ready',
      {
        generation_id: meta.generation_id,
        state: meta.state,
      }
    );
  }

  if (meta.state === 'ready') {
    if (!meta.manifest_json || !meta.manifest_sha256) {
      throw catalogError(
        'CATALOG_MANIFEST_MISSING',
        'Ready catalog generation is missing its manifest'
      );
    }
    const calculatedManifestSha = sha256(meta.manifest_json);
    if (calculatedManifestSha !== meta.manifest_sha256) {
      throw catalogError(
        'CATALOG_MANIFEST_HASH_MISMATCH',
        'Catalog manifest hash does not match manifest JSON',
        {
          expected: meta.manifest_sha256,
          actual: calculatedManifestSha,
        }
      );
    }
  }

  const layers = layerRows(db).map(row => row.layer).sort();
  const expectedLayers = [...CATALOG_LAYERS].sort();
  if (
    layers.length !== expectedLayers.length ||
    layers.some((layer, index) => layer !== expectedLayers[index])
  ) {
    throw catalogError(
      'CATALOG_SYNC_STATE_INVALID',
      'Catalog sync_state does not contain the canonical layer set',
      { layers }
    );
  }

  const foreignKeys = foreignKeyRows(db);
  if (foreignKeys.length) {
    throw catalogError(
      'CATALOG_FOREIGN_KEY_FAILED',
      'Catalog foreign_key_check failed',
      { violations: foreignKeys }
    );
  }

  const logical = logicalIntegrityErrors(db);
  if (logical.length) {
    throw catalogError(
      'CATALOG_LOGICAL_INTEGRITY_FAILED',
      'Catalog logical integrity checks failed',
      { errors: logical }
    );
  }

  if (requireStandalone) {
    const journalMode = String(
      db.prepare('PRAGMA journal_mode').get()?.journal_mode || ''
    ).toLowerCase();
    if (journalMode !== 'delete') {
      throw catalogError(
        'CATALOG_JOURNAL_MODE_UNSAFE',
        'Published catalog must use DELETE journal mode',
        { journal_mode: journalMode }
      );
    }
  }

  return {
    schema_version: version,
    generation_id: meta.generation_id,
    source_epoch: meta.source_epoch,
    identity_revision: Number(meta.identity_revision),
    state: meta.state,
    manifest_sha256: meta.manifest_sha256,
    dependency_fingerprint: meta.dependency_fingerprint,
    layers: layerRows(db),
    counts: tableCounts(db),
    integrity: 'ok',
  };
}

function ftsIntegrityCheck(db) {
  db.exec(
    "INSERT INTO fts_words(fts_words) VALUES('integrity-check');"
  );
  db.exec(
    "INSERT INTO fts_trigram(fts_trigram) VALUES('integrity-check');"
  );
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function atomicWritePointer(storageDir, pointerName, filename) {
  if (!POINTER_NAMES.has(pointerName)) {
    throw catalogError(
      'CATALOG_POINTER_NAME_INVALID',
      'Unknown catalog pointer name',
      { pointer: pointerName }
    );
  }
  generationIdFromFilename(filename);

  pointerNonce += 1;
  const target = path.join(storageDir, pointerName);
  const temp = path.join(
    storageDir,
    pointerName + '.tmp.' + process.pid + '.' + pointerNonce
  );

  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, filename + '\n', 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temp, target);
    fsyncDirectory(storageDir);
  } catch (error) {
    if (fd !== null && fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch {}
    throw error;
  }
}

function removePointer(storageDir, pointerName) {
  const target = path.join(storageDir, pointerName);
  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
    fsyncDirectory(storageDir);
  }
}

export function readCatalogPointer(storageDir, pointerName) {
  const dir = requireStorageDir(storageDir);
  if (!POINTER_NAMES.has(pointerName)) {
    throw catalogError(
      'CATALOG_POINTER_NAME_INVALID',
      'Unknown catalog pointer name',
      { pointer: pointerName }
    );
  }
  const pointer = path.join(dir, pointerName);
  if (!fs.existsSync(pointer)) return null;

  const stat = fs.lstatSync(pointer);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw catalogError(
      'CATALOG_POINTER_UNSAFE',
      'Catalog pointer must be a regular file',
      { pointer }
    );
  }
  if (stat.size > 256) {
    throw catalogError(
      'CATALOG_POINTER_INVALID',
      'Catalog pointer is unexpectedly large',
      { pointer, bytes: stat.size }
    );
  }

  const filename = fs.readFileSync(pointer, 'utf8').trim();
  generationIdFromFilename(filename);
  return filename;
}

function finalPathFor(storageDir, generationId) {
  return path.join(storageDir, generationFilename(generationId));
}

function regularArtifact(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw catalogError('CATALOG_GENERATION_UNSAFE', 'Catalog artifact must be a regular file', { path: filePath });
    }
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export function classifyGenerationArtifacts(storageDir, generationId) {
  const dir = requireStorageDir(storageDir);
  const id = validateGenerationId(generationId);
  const buildingPath = path.join(dir, buildingFilename(id));
  const finalPath = finalPathFor(dir, id);
  const building = regularArtifact(buildingPath);
  const final = regularArtifact(finalPath);
  if (building && final) return { state: 'both', buildingPath, finalPath };
  if (final) return { state: 'final', buildingPath, finalPath };
  if (!building) return { state: 'neither', buildingPath, finalPath };
  const db = new DatabaseSync(buildingPath, { readOnly: true, create: false });
  try {
    const meta = catalogMeta(db);
    if (!meta || meta.generation_id !== id || !['building', 'ready'].includes(meta.state)) {
      throw catalogError('CATALOG_META_MISSING', 'Building artifact metadata is invalid');
    }
    return { state: meta.state, buildingPath, finalPath };
  } finally { db.close(); }
}

export function openGenerationAuthority(storageDir, generationId) {
  const artifacts = classifyGenerationArtifacts(storageDir, generationId);
  const filePath = artifacts.state === 'final' ? artifacts.finalPath
    : ['building', 'ready'].includes(artifacts.state) ? artifacts.buildingPath : null;
  if (!filePath || artifacts.state === 'both') {
    throw catalogError('CATALOG_GENERATION_MISSING', 'Exact generation authority is unavailable');
  }
  return new DatabaseSync(filePath, { readOnly: true, create: false });
}

export function inspectCatalogGeneration(
  storageDir,
  generationId,
  { requireReady = true } = {}
) {
  const dir = requireStorageDir(storageDir);
  const id = validateGenerationId(generationId);
  const filePath = finalPathFor(dir, id);

  if (!fs.existsSync(filePath)) {
    throw catalogError(
      'CATALOG_GENERATION_MISSING',
      'Catalog generation file does not exist',
      { generation_id: id, path: filePath }
    );
  }
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw catalogError(
      'CATALOG_GENERATION_UNSAFE',
      'Catalog generation must be a regular file',
      { path: filePath }
    );
  }
  if (fileSidecars(filePath).some(candidate => fs.existsSync(candidate))) {
    throw catalogError(
      'CATALOG_PUBLISHED_SIDECAR_PRESENT',
      'Published generation has WAL/SHM sidecars',
      { path: filePath }
    );
  }

  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    db.exec('PRAGMA foreign_keys=ON;');
    return {
      path: filePath,
      bytes: stat.size,
      ...validateDbHandle(db, {
        expectedGenerationId: id,
        requireReady,
        requireStandalone: true,
      }),
    };
  } finally {
    db.close();
  }
}

export class CatalogGenerationBuilder {
  static recoverSeal({ storageDir, generationId, expectedRunId,
    expectedRunDigest, expectedFinalSeq, failpoint } = {}) {
    const artifacts = classifyGenerationArtifacts(storageDir, generationId);
    if (artifacts.state === 'both') throw catalogError('CATALOG_ARTIFACT_CONFLICT', 'Both building and final artifacts exist');
    if (artifacts.state !== 'ready') throw catalogError('CATALOG_BUILD_SEALED', 'Ready building generation is required');
    if (!RUN_ID_RE.test(expectedRunId || '') || !/^[a-f0-9]{64}$/.test(expectedRunDigest || '') ||
        !Number.isSafeInteger(expectedFinalSeq) || expectedFinalSeq < 1 ||
        (failpoint !== undefined && typeof failpoint !== 'function')) {
      throw catalogError('CATALOG_INVALID_ARGUMENT', 'Exact certification tuple is required');
    }
    const hit = name => {
      const value = failpoint?.(name);
      if (value instanceof Promise) throw new TypeError('Seal failpoint must be synchronous');
    };
    const db = new DatabaseSync(artifacts.buildingPath, { create: false });
    try {
      db.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
      validateDbHandle(db, { expectedGenerationId: generationId, requireReady: true });
      ftsIntegrityCheck(db);
      const run = db.prepare('SELECT layer,run_kind,run_digest,final_seq,status FROM ingest_runs WHERE run_id=?').get(expectedRunId);
      if (!run || run.layer !== 'full' || run.run_kind !== 'full' || run.status !== 'ACCEPTED' ||
          run.run_digest !== expectedRunDigest || run.final_seq !== expectedFinalSeq) {
        throw catalogError('CATALOG_CERTIFICATION_CONFLICT', 'Ready generation certification differs');
      }
      hit('recoverSeal.beforeCheckpoint');
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      hit('recoverSeal.afterCheckpoint');
      const mode = String(db.prepare('PRAGMA journal_mode=DELETE').get()?.journal_mode || '').toLowerCase();
      if (mode !== 'delete') throw catalogError('CATALOG_SEAL_JOURNAL_MODE_FAILED', 'Could not normalize sealed catalog');
      db.exec('PRAGMA synchronous=FULL;');
      hit('recoverSeal.afterDeleteJournal');
    } finally { db.close(); }
    if (fileSidecars(artifacts.buildingPath).some(regularArtifact)) {
      throw catalogError('CATALOG_BUILD_SIDECAR_PRESENT', 'Recovered build still has sidecars');
    }
    fs.chmodSync(artifacts.buildingPath, 0o600);
    fsyncFile(artifacts.buildingPath);
    if (regularArtifact(artifacts.finalPath)) throw catalogError('CATALOG_FINAL_EXISTS', 'Final generation already exists');
    fs.renameSync(artifacts.buildingPath, artifacts.finalPath);
    fsyncDirectory(path.resolve(storageDir));
    hit('recoverSeal.afterRename');
    return inspectCatalogGeneration(storageDir, generationId);
  }
  static openExisting({ storageDir, generationId, now = () => new Date().toISOString() }) {
    const dir = requireStorageDir(storageDir);
    const id = validateGenerationId(generationId);
    const buildingPath = path.join(dir, buildingFilename(id));
    const finalPath = finalPathFor(dir, id);
    if (!fs.existsSync(buildingPath) || fs.existsSync(finalPath)) {
      throw catalogError('CATALOG_BUILD_MISSING', 'Building generation cannot be resumed');
    }
    const db = new DatabaseSync(buildingPath, { create: false });
    try {
      db.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
      if (String(db.prepare('PRAGMA journal_mode').get().journal_mode).toLowerCase() !== 'wal') {
        throw catalogError('CATALOG_BUILD_JOURNAL_INVALID', 'Building file must use WAL');
      }
      validateDbHandle(db, { expectedGenerationId: id });
      if (catalogMeta(db).state !== 'building') {
        throw catalogError('CATALOG_BUILD_SEALED', 'Only a building generation may resume');
      }
      return new CatalogGenerationBuilder({
        storageDir: dir, generationId: id, buildingPath, finalPath, db, now,
      });
    } catch (error) {
      db.close();
      throw error;
    }
  }

  static create({
    storageDir,
    generationId,
    sourceEpoch,
    identityRevision,
    dependencyFingerprint = null,
    now = () => new Date().toISOString(),
  }) {
    const dir = requireStorageDir(storageDir);
    const id = validateGenerationId(generationId);
    requireText('sourceEpoch', sourceEpoch);
    if (!Number.isInteger(identityRevision) || identityRevision < 0) {
      throw catalogError(
        'CATALOG_IDENTITY_REVISION_INVALID',
        'identityRevision must be a non-negative integer'
      );
    }

    const buildingPath = path.join(dir, buildingFilename(id));
    const finalPath = finalPathFor(dir, id);

    assertUnused([
      buildingPath,
      finalPath,
      ...fileSidecars(buildingPath),
      ...fileSidecars(finalPath),
    ]);

    let fd;
    try {
      fd = fs.openSync(buildingPath, 'wx', 0o600);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }

    let db;
    try {
      db = new DatabaseSync(buildingPath);
      initializeCatalogSchema(db, {
        generationId: id,
        sourceEpoch,
        identityRevision,
        createdAt: now(),
        dependencyFingerprint,
      });
      fs.chmodSync(buildingPath, 0o600);
      return new CatalogGenerationBuilder({
        storageDir: dir,
        generationId: id,
        buildingPath,
        finalPath,
        db,
        now,
      });
    } catch (error) {
      if (db) {
        try { db.close(); } catch {}
      }
      removeOwnArtifacts(buildingPath);
      throw error;
    }
  }

  constructor({
    storageDir,
    generationId,
    buildingPath,
    finalPath,
    db,
    now,
  }) {
    this.storageDir = storageDir;
    this.generationId = generationId;
    this.buildingPath = buildingPath;
    this.finalPath = finalPath;
    this.db = db;
    this.now = now;
    this.closed = false;
    this.sealed = false;
  }

  assertOpen() {
    if (this.closed) {
      throw catalogError(
        'CATALOG_BUILDER_CLOSED',
        'Catalog generation builder is closed'
      );
    }
  }

  metadata() {
    this.assertOpen();
    return catalogMeta(this.db);
  }

  setLayerState(layer, state = {}) {
    this.assertOpen();
    if (!CATALOG_LAYERS.includes(layer)) {
      throw catalogError(
        'CATALOG_LAYER_INVALID',
        'Unknown catalog layer',
        { layer }
      );
    }

    const current = this.db.prepare(
      'SELECT * FROM sync_state WHERE layer=?'
    ).get(layer);

    const has = key =>
      Object.prototype.hasOwnProperty.call(state, key);
    const merged = {
      accepted_watermark: has('accepted_watermark')
        ? state.accepted_watermark
        : current.accepted_watermark,
      accepted_source_fingerprint: has(
        'accepted_source_fingerprint'
      )
        ? state.accepted_source_fingerprint
        : current.accepted_source_fingerprint,
      source_updated_at: has('source_updated_at')
        ? state.source_updated_at
        : current.source_updated_at,
      provider_completed_at: has('provider_completed_at')
        ? state.provider_completed_at
        : current.provider_completed_at,
      integration_synced_at: has('integration_synced_at')
        ? state.integration_synced_at
        : current.integration_synced_at,
      last_run_id: has('last_run_id')
        ? state.last_run_id
        : current.last_run_id,
      last_ok_at: has('last_ok_at')
        ? state.last_ok_at
        : current.last_ok_at,
      freshness_state: has('freshness_state')
        ? state.freshness_state
        : current.freshness_state,
      need_reconcile: has('need_reconcile')
        ? state.need_reconcile
        : current.need_reconcile,
      need_full: has('need_full')
        ? state.need_full
        : current.need_full,
    };

    if (
      !['UNKNOWN', 'FRESH', 'STALE', 'BLOCKED'].includes(
        merged.freshness_state
      )
    ) {
      throw catalogError(
        'CATALOG_FRESHNESS_STATE_INVALID',
        'Unknown freshness state',
        { freshness_state: merged.freshness_state }
      );
    }

    for (const [name, value] of [
      ['need_reconcile', merged.need_reconcile],
      ['need_full', merged.need_full],
    ]) {
      if (![0, 1, false, true].includes(value)) {
        throw catalogError(
          'CATALOG_SYNC_FLAG_INVALID',
          'Catalog sync flag must be boolean/0/1',
          { flag: name, value }
        );
      }
    }

    this.db.prepare(
      'UPDATE sync_state SET ' +
      'accepted_watermark=?, accepted_source_fingerprint=?, ' +
      'source_updated_at=?, provider_completed_at=?, ' +
      'integration_synced_at=?, last_run_id=?, last_ok_at=?, ' +
      'freshness_state=?, need_reconcile=?, need_full=? ' +
      'WHERE layer=?'
    ).run(
      merged.accepted_watermark,
      merged.accepted_source_fingerprint,
      merged.source_updated_at,
      merged.provider_completed_at,
      merged.integration_synced_at,
      merged.last_run_id,
      merged.last_ok_at,
      merged.freshness_state,
      merged.need_reconcile ? 1 : 0,
      merged.need_full ? 1 : 0,
      layer
    );

    return this.db.prepare(
      'SELECT * FROM sync_state WHERE layer=?'
    ).get(layer);
  }

  validate() {
    this.assertOpen();
    ftsIntegrityCheck(this.db);
    return validateDbHandle(this.db, {
      expectedGenerationId: this.generationId,
      requireReady: false,
      requireStandalone: false,
    });
  }

  seal({ extraManifest = {}, failpoint } = {}) {
    this.assertOpen();
    if (this.sealed) {
      throw catalogError(
        'CATALOG_ALREADY_SEALED',
        'Catalog generation was already sealed'
      );
    }

    const before = this.validate();
    const manifest = {
      generation_id: this.generationId,
      schema_version: CATALOG_SCHEMA_VERSION,
      source_epoch: before.source_epoch,
      identity_revision: before.identity_revision,
      dependency_fingerprint: before.dependency_fingerprint,
      counts: before.counts,
      layers: before.layers,
      extra: extraManifest,
    };
    const manifestJson = JSON.stringify(manifest);
    const manifestSha = sha256(manifestJson);
    const sealedAt = this.now();

    this.db.prepare(
      'UPDATE catalog_meta SET ' +
      'state=\'ready\', sealed_at=?, manifest_sha256=?, manifest_json=? ' +
      'WHERE singleton=1'
    ).run(sealedAt, manifestSha, manifestJson);
    const hit = name => {
      const value = failpoint?.(name);
      if (value instanceof Promise) throw new TypeError('Seal failpoint must be synchronous');
    };
    hit('seal.afterReady');

    validateDbHandle(this.db, {
      expectedGenerationId: this.generationId,
      requireReady: true,
      requireStandalone: false,
    });
    ftsIntegrityCheck(this.db);

    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    hit('seal.afterCheckpoint');
    const journalMode = String(
      this.db.prepare('PRAGMA journal_mode=DELETE').get()?.journal_mode || ''
    ).toLowerCase();
    if (journalMode !== 'delete') {
      throw catalogError(
        'CATALOG_SEAL_JOURNAL_MODE_FAILED',
        'Could not normalize sealed catalog to DELETE journal mode',
        { journal_mode: journalMode }
      );
    }
    this.db.exec('PRAGMA synchronous=FULL;');
    hit('seal.afterDeleteJournal');

    this.db.close();
    this.closed = true;

    if (fileSidecars(this.buildingPath).some(candidate =>
      fs.existsSync(candidate)
    )) {
      throw catalogError(
        'CATALOG_BUILD_SIDECAR_PRESENT',
        'Sealed build still has WAL/SHM sidecars',
        { path: this.buildingPath }
      );
    }

    fs.chmodSync(this.buildingPath, 0o600);
    fsyncFile(this.buildingPath);

    if (fs.existsSync(this.finalPath)) {
      throw catalogError(
        'CATALOG_FINAL_EXISTS',
        'Final catalog generation already exists',
        { path: this.finalPath }
      );
    }

    fs.renameSync(this.buildingPath, this.finalPath);
    fsyncDirectory(this.storageDir);
    hit('seal.afterRename');
    this.sealed = true;

    const inspected = inspectCatalogGeneration(
      this.storageDir,
      this.generationId
    );

    return {
      ...inspected,
      manifest,
      manifest_sha256: manifestSha,
    };
  }

  close() {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
    }
  }
}

function openReaderCandidate(storageDir, filename) {
  const generationId = generationIdFromFilename(filename);
  const filePath = path.join(storageDir, filename);

  if (!fs.existsSync(filePath)) {
    throw catalogError(
      'CATALOG_GENERATION_MISSING',
      'Pointer target generation is missing',
      { filename }
    );
  }
  if (fileSidecars(filePath).some(candidate => fs.existsSync(candidate))) {
    throw catalogError(
      'CATALOG_PUBLISHED_SIDECAR_PRESENT',
      'Pointer target has WAL/SHM sidecars',
      { filename }
    );
  }

  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    db.exec('PRAGMA foreign_keys=ON;');
    const info = validateDbHandle(db, {
      expectedGenerationId: generationId,
      requireReady: true,
      requireStandalone: true,
    });
    return {
      db,
      filename,
      generationId,
      info,
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

export class CatalogReader {
  constructor(storageDir) {
    this.storageDir = requireStorageDir(storageDir);
    this.db = null;
    this.filename = null;
    this.generationId = null;
    this.info = null;
  }

  reloadExpected(expectedGenerationId = null) {
    const firstPointer = readCatalogPointer(
      this.storageDir,
      'CURRENT'
    );
    if (!firstPointer) {
      throw catalogError(
        'CATALOG_CURRENT_MISSING',
        'No CURRENT catalog pointer exists'
      );
    }

    const firstGeneration = generationIdFromFilename(firstPointer);
    if (
      expectedGenerationId !== null &&
      firstGeneration !== expectedGenerationId
    ) {
      throw catalogError(
        'CATALOG_CURRENT_UNEXPECTED',
        'CURRENT does not point to the expected generation',
        {
          expected: expectedGenerationId,
          actual: firstGeneration,
        }
      );
    }

    const candidate = openReaderCandidate(
      this.storageDir,
      firstPointer
    );

    const secondPointer = readCatalogPointer(
      this.storageDir,
      'CURRENT'
    );
    if (secondPointer !== firstPointer) {
      candidate.db.close();
      throw catalogError(
        'CATALOG_POINTER_CHANGED_DURING_RELOAD',
        'CURRENT changed while reader was reopening'
      );
    }

    const oldDb = this.db;
    this.db = candidate.db;
    this.filename = candidate.filename;
    this.generationId = candidate.generationId;
    this.info = candidate.info;
    if (oldDb) oldDb.close();

    return this.info;
  }

  ensureCurrent() {
    const pointer = readCatalogPointer(
      this.storageDir,
      'CURRENT'
    );
    if (!pointer) {
      throw catalogError(
        'CATALOG_CURRENT_MISSING',
        'No CURRENT catalog pointer exists'
      );
    }
    if (!this.db || this.filename !== pointer) {
      return this.reloadExpected();
    }
    return this.info;
  }

  withDb(fn) {
    if (typeof fn !== 'function') {
      throw catalogError(
        'CATALOG_READER_CALLBACK_INVALID',
        'Catalog reader callback must be a function'
      );
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      this.ensureCurrent();
      const filenameBefore = this.filename;
      const result = fn(this.db, this.generationId);
      if (result && typeof result.then === 'function') {
        throw catalogError(
          'CATALOG_READER_ASYNC_CALLBACK_FORBIDDEN',
          'Catalog reader callback must complete synchronously'
        );
      }
      const filenameAfter = readCatalogPointer(
        this.storageDir,
        'CURRENT'
      );
      if (filenameAfter === filenameBefore) {
        return result;
      }
      this.reloadExpected();
    }

    throw catalogError(
      'CATALOG_POINTER_UNSTABLE',
      'CURRENT changed repeatedly during a catalog read'
    );
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.filename = null;
      this.generationId = null;
      this.info = null;
    }
  }
}

function reloadReaders(readers, generationId) {
  for (const reader of readers) {
    reader.reloadExpected(generationId);
  }
}

function restorePointerState(storageDir, current, previous) {
  if (previous) {
    atomicWritePointer(storageDir, 'PREVIOUS', previous);
  } else {
    removePointer(storageDir, 'PREVIOUS');
  }

  if (current) {
    atomicWritePointer(storageDir, 'CURRENT', current);
  } else {
    removePointer(storageDir, 'CURRENT');
  }
}

function markGenerationNeedsRecovery(storageDir, filename) {
  const generationId = generationIdFromFilename(filename);
  const filePath = path.join(storageDir, filename);
  const db = new DatabaseSync(filePath);
  try {
    db.exec('PRAGMA foreign_keys=ON;');
    validateDbHandle(db, {
      expectedGenerationId: generationId,
      requireReady: true,
      requireStandalone: true,
    });
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec(
        'UPDATE sync_state ' +
        'SET need_reconcile=1, need_full=1'
      );
      db.exec('COMMIT;');
    } catch (error) {
      try { db.exec('ROLLBACK;'); } catch {}
      throw error;
    }
    const journalMode = String(
      db.prepare('PRAGMA journal_mode').get()?.journal_mode || ''
    ).toLowerCase();
    if (journalMode !== 'delete') {
      throw catalogError(
        'CATALOG_ROLLBACK_JOURNAL_MODE_FAILED',
        'Rollback target changed journal mode unexpectedly',
        { journal_mode: journalMode }
      );
    }
  } finally {
    db.close();
  }

  fsyncFile(filePath);
  return generationId;
}

export class CatalogPublisher {
  constructor(storageDir, { readers = [], mutex = null } = {}) {
    this.storageDir = requireStorageDir(storageDir);
    this.readers = [...readers];
    if (mutex !== null && !(mutex instanceof CatalogPublicationLock)) {
      throw new TypeError('CatalogPublicationLock is required');
    }
    this.mutex = mutex;
  }

  state() {
    const current = readCatalogPointer(
      this.storageDir,
      'CURRENT'
    );
    const previous = readCatalogPointer(
      this.storageDir,
      'PREVIOUS'
    );
    return {
      current_filename: current,
      current_generation: current
        ? generationIdFromFilename(current)
        : null,
      previous_filename: previous,
      previous_generation: previous
        ? generationIdFromFilename(previous)
        : null,
    };
  }

  publish(generationId, options = {}) {
    if ((options.runId !== undefined || options.expectedCurrent !== undefined) && !this.mutex) {
      throw new TypeError('Ingest publication requires CatalogPublicationLock');
    }
    const work = () => this.#publishUnlocked(generationId, options);
    return this.mutex ? this.mutex.withLock(work) : work();
  }

  #publishUnlocked(generationId, {
    expectedCurrent = undefined, runId = null, replayStore = null,
  } = {}) {
    const id = validateGenerationId(generationId);
    inspectCatalogGeneration(this.storageDir, id);
    const next = generationFilename(id);
    const before = this.state();
    if (runId !== null && (
      !replayStore ||
      typeof replayStore.recordPublication !== 'function' ||
      typeof replayStore.publication !== 'function'
    )) {
      throw new TypeError('Full publication needs a replay store');
    }

    if (before.current_filename === next) {
      let entry = null;
      if (runId !== null) {
        entry = replayStore.publication(id);
        if (
          !entry ||
          entry.runId !== runId ||
          entry.state === 'rolled_back'
        ) {
          throw catalogError(
            'CATALOG_PUBLICATION_CONFLICT',
            'CURRENT belongs to another publication'
          );
        }
      }

      if (
        expectedCurrent !== undefined &&
        before.current_generation !== expectedCurrent
      ) {
        const ownRecoveredSwitch = (
          runId !== null &&
          before.previous_generation === expectedCurrent &&
          entry &&
          ['intent', 'switched'].includes(entry.state)
        );
        if (!ownRecoveredSwitch) {
          throw catalogError(
            'CATALOG_CURRENT_MOVED',
            'CURRENT changed before publication'
          );
        }
      }

      reloadReaders(this.readers, id);
      if (entry?.state === 'intent') {
        replayStore.recordPublication(
          id,
          runId,
          'switched'
        );
      }
      return {
        changed: false,
        ...this.state(),
      };
    }

    if (
      expectedCurrent !== undefined &&
      before.current_generation !== expectedCurrent
    ) {
      throw catalogError(
        'CATALOG_CURRENT_MOVED',
        'CURRENT changed before publication'
      );
    }

    if (runId !== null) replayStore.recordPublication(id, runId, 'intent');

    if (before.current_filename) {
      atomicWritePointer(
        this.storageDir,
        'PREVIOUS',
        before.current_filename
      );
    } else {
      removePointer(this.storageDir, 'PREVIOUS');
    }

    atomicWritePointer(this.storageDir, 'CURRENT', next);

    try {
      reloadReaders(this.readers, id);
    } catch (error) {
      restorePointerState(
        this.storageDir,
        before.current_filename,
        before.previous_filename
      );
      if (before.current_generation) {
        try {
          reloadReaders(
            this.readers,
            before.current_generation
          );
        } catch {}
      }
      throw error;
    }

    if (runId !== null) replayStore.recordPublication(id, runId, 'switched');
    return {
      changed: true,
      ...this.state(),
    };
  }

  rollbackToPrevious(options = {}) {
    if ((options.replayStore !== undefined || options.expectedCurrent !== undefined) &&
        !this.mutex) {
      throw new TypeError('Ingest rollback requires CatalogPublicationLock');
    }
    const work = () => this.#rollbackUnlocked(options);
    return this.mutex ? this.mutex.withLock(work) : work();
  }

  #rollbackUnlocked({ expectedCurrent = undefined, replayStore = null } = {}) {
    const before = this.state();
    if (expectedCurrent !== undefined && before.current_generation !== expectedCurrent) {
      throw catalogError('CATALOG_CURRENT_MOVED', 'CURRENT changed before rollback');
    }
    if (
      !before.current_filename ||
      !before.previous_filename
    ) {
      throw catalogError(
        'CATALOG_ROLLBACK_UNAVAILABLE',
        'CURRENT and PREVIOUS are both required for rollback'
      );
    }
    if (
      before.current_filename === before.previous_filename
    ) {
      throw catalogError(
        'CATALOG_ROLLBACK_INVALID',
        'PREVIOUS cannot equal CURRENT'
      );
    }

    inspectCatalogGeneration(
      this.storageDir,
      before.previous_generation
    );
    const targetGeneration = markGenerationNeedsRecovery(
      this.storageDir,
      before.previous_filename
    );

    if (replayStore) {
      const entry = replayStore.publication(before.current_generation);
      if (entry) replayStore.recordPublication(
        before.current_generation, entry.runId, 'rolled_back'
      );
    }

    // Make the recovery target CURRENT first. A crash between pointer writes
    // then leaves the good generation reachable, even if PREVIOUS == CURRENT.
    atomicWritePointer(
      this.storageDir,
      'CURRENT',
      before.previous_filename
    );
    atomicWritePointer(
      this.storageDir,
      'PREVIOUS',
      before.current_filename
    );

    try {
      reloadReaders(this.readers, targetGeneration);
    } catch (error) {
      restorePointerState(
        this.storageDir,
        before.current_filename,
        before.previous_filename
      );
      try {
        reloadReaders(
          this.readers,
          before.current_generation
        );
      } catch {}
      throw error;
    }

    return {
      changed: true,
      rollback: true,
      ...this.state(),
    };
  }
}
