import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { normalizeSku } from '../domain/sku.mjs';
import { IdentityStore } from '../identity/store.mjs';
import { IDENTITY_SCHEMA_VERSION } from '../identity/schema.mjs';
import { ReplayStore, REPLAY_SCHEMA_VERSION } from '../ingest/replay-store.mjs';
import { canonicalControlJson } from '../ingest/run-protocol.mjs';
import { CatalogReader, generationIdFromFilename, inspectCatalogGeneration,
  readCatalogPointer } from '../sqlite/generation.mjs';

export const RECOVERY_SET_SCHEMA = 'bp.catalog.backup-set/1';
const SET_RE = /^set-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{16}$/;
const TOP_KEYS = ['schema', 'set_id', 'created_at', 'current_generation',
  'previous_generation', 'source_epoch', 'published_identity_revision',
  'accepted_run', 'identity', 'replay'];
const DB_KEYS = ['file', 'bytes', 'sha256', 'schema_version', 'integrity', 'journal_mode'];
const ID_KEYS = [...DB_KEYS, 'revision'];
const RUN_KEYS = ['run_id', 'run_digest', 'final_seq', 'accepted_at'];

export class RecoveryError extends Error {
  constructor(code, message) { super(message); this.name = 'RecoveryError'; this.code = code; }
}
const fail = (code, message) => { throw new RecoveryError(code, message); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
const mode = stat => stat.mode & 0o777;
const shaFile = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fsync(file) { const fd = fs.openSync(file, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }

export function validatePrivateDirectory(directory, { code = 'RECOVERY_DIRECTORY_UNSAFE' } = {}) {
  if (!path.isAbsolute(directory)) fail(code, 'Directory path must be absolute');
  let stat;
  try { stat = fs.lstatSync(directory); } catch { fail(code, 'Directory must already exist'); }
  if (!stat.isDirectory() || stat.isSymbolicLink() || mode(stat) !== 0o700) {
    fail(code, 'Directory must be a non-symlink directory with mode 0700');
  }
  if (typeof process.geteuid !== 'function' || stat.uid !== process.geteuid()) {
    fail(code, 'Directory must be owned by the effective UID');
  }
  return fs.realpathSync(directory);
}

export function validateBackupRoot(backupRoot) {
  return validatePrivateDirectory(backupRoot, { code: 'RECOVERY_ROOT_UNSAFE' });
}

export function readRecoveryAuthority(reader) {
  if (!(reader instanceof CatalogReader)) throw new TypeError('CatalogReader is required');
  let previousGeneration = null;
  const previous = readCatalogPointer(reader.storageDir, 'PREVIOUS');
  if (previous) previousGeneration = generationIdFromFilename(previous);
  try {
    return reader.withDb((db, currentGeneration) => {
      const meta = db.prepare(
        'SELECT source_epoch,identity_revision FROM catalog_meta WHERE singleton=1'
      ).get();
      const runs = db.prepare(
        "SELECT run_id,run_digest,final_seq,terminal_at FROM ingest_runs " +
        "WHERE status='ACCEPTED' AND layer='full' AND run_kind='full'"
      ).all();
      if (!meta || runs.length !== 1) fail('RECOVERY_AUTHORITY_INVALID', 'CURRENT accepted FULL authority is invalid');
      const run = runs[0];
      const chunks = db.prepare('SELECT run_id,kid,seq FROM run_chunks ORDER BY seq').all();
      if (!/^[a-f0-9]{64}$/.test(run.run_digest || '') ||
          !Number.isSafeInteger(run.final_seq) || run.final_seq < 1 || !run.terminal_at ||
          chunks.length !== run.final_seq ||
          chunks.some((row, index) => row.run_id !== run.run_id || row.seq !== index) ||
          new Set(chunks.map(row => row.kid)).size !== 1) {
        fail('RECOVERY_AUTHORITY_INVALID', 'CURRENT run chunks are inconsistent');
      }
      return {
        state: 'CURRENT', currentGeneration, previousGeneration,
        sourceEpoch: meta.source_epoch,
        publishedIdentityRevision: Number(meta.identity_revision),
        acceptedRun: { run_id: run.run_id, run_digest: run.run_digest,
          final_seq: Number(run.final_seq), accepted_at: run.terminal_at },
        acceptedKid: chunks[0].kid,
      };
    });
  } catch (error) {
    if (error?.code !== 'CATALOG_CURRENT_MISSING') throw error;
    return { state: 'BOOTSTRAP', currentGeneration: null, previousGeneration,
      sourceEpoch: null, publishedIdentityRevision: null, acceptedRun: null, acceptedKid: null };
  }
}

function validateManifest(manifest, expectedSetId) {
  if (!exact(manifest, TOP_KEYS) || manifest.schema !== RECOVERY_SET_SCHEMA ||
      manifest.set_id !== expectedSetId || !SET_RE.test(manifest.set_id) ||
      typeof manifest.created_at !== 'string' || !exact(manifest.identity, ID_KEYS) ||
      !exact(manifest.replay, DB_KEYS) ||
      (manifest.accepted_run !== null && !exact(manifest.accepted_run, RUN_KEYS)) ||
      manifest.identity.file !== 'identity.sqlite' || manifest.replay.file !== 'replay.sqlite' ||
      manifest.identity.schema_version !== IDENTITY_SCHEMA_VERSION ||
      manifest.replay.schema_version !== REPLAY_SCHEMA_VERSION ||
      manifest.identity.integrity !== 'ok' || manifest.replay.integrity !== 'ok' ||
      manifest.identity.journal_mode !== 'delete' || manifest.replay.journal_mode !== 'delete' ||
      !Number.isSafeInteger(manifest.identity.bytes) || !Number.isSafeInteger(manifest.replay.bytes) ||
      !Number.isSafeInteger(manifest.identity.revision) ||
      !/^[a-f0-9]{64}$/.test(manifest.identity.sha256) ||
      !/^[a-f0-9]{64}$/.test(manifest.replay.sha256)) {
    fail('RECOVERY_MANIFEST_INVALID', 'Recovery manifest is invalid');
  }
  return manifest;
}

function assertPrivateFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || mode(stat) !== 0o600) {
    fail('RECOVERY_FILE_UNSAFE', 'Recovery file must be regular mode 0600');
  }
  return stat;
}

export function verifyRecoverySet({ backupRoot, setId, catalogStorageDir }) {
  const root = validateBackupRoot(backupRoot);
  if (!SET_RE.test(setId || '')) fail('RECOVERY_SET_ID_INVALID', 'Invalid recovery set ID');
  const directory = path.join(root, setId);
  validatePrivateDirectory(directory, { code: 'RECOVERY_SET_UNSAFE' });
  const entries = fs.readdirSync(directory).sort();
  if (entries.join('\0') !== ['identity.sqlite', 'manifest.json', 'replay.sqlite'].join('\0')) {
    fail('RECOVERY_SET_FILES_INVALID', 'Recovery set must contain exactly three files');
  }
  const manifestPath = path.join(directory, 'manifest.json');
  assertPrivateFile(manifestPath);
  const bytes = fs.readFileSync(manifestPath, 'utf8');
  let manifest;
  try { manifest = JSON.parse(bytes); } catch { fail('RECOVERY_MANIFEST_INVALID', 'Manifest JSON is invalid'); }
  if (bytes !== canonicalControlJson(manifest)) fail('RECOVERY_MANIFEST_NONCANONICAL', 'Manifest is not canonical JSON');
  validateManifest(manifest, setId);
  for (const part of ['identity', 'replay']) {
    const file = path.join(directory, manifest[part].file);
    const stat = assertPrivateFile(file);
    if (stat.size !== manifest[part].bytes) fail('RECOVERY_BYTES_MISMATCH', part + ' byte size differs');
    if (shaFile(file) !== manifest[part].sha256) fail('RECOVERY_HASH_MISMATCH', part + ' hash differs');
  }
  const identityPath = path.join(directory, 'identity.sqlite');
  const replayPath = path.join(directory, 'replay.sqlite');
  const identity = IdentityStore.openExisting(identityPath, { readOnly: true });
  let identityMetadata;
  try { identityMetadata = identity.metadata(); } finally { identity.close(); }
  if (identityMetadata.revision !== manifest.identity.revision) fail('RECOVERY_IDENTITY_REVISION_MISMATCH', 'Identity revision differs');
  const replay = ReplayStore.openExisting(replayPath, { catalogStorageDir, readOnly: true });
  try {
    const full = replay.db.prepare('PRAGMA integrity_check').all().map(row => String(Object.values(row)[0]));
    if (full.length !== 1 || full[0] !== 'ok') fail('RECOVERY_REPLAY_INTEGRITY', 'Replay full integrity_check failed');
  } finally { replay.close(); }
  return { setId, directory, manifest, identityMetadata, verified: true };
}

export function discoverRecoverySets({ backupRoot }) {
  const root = validateBackupRoot(backupRoot);
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && SET_RE.test(entry.name))
    .map(entry => entry.name).sort();
}

export function recoverySetCovers(verified, authority) {
  const m = verified.manifest;
  if (authority.state === 'BOOTSTRAP') {
    return m.current_generation === null && m.accepted_run === null &&
      m.published_identity_revision === null;
  }
  return m.current_generation === authority.currentGeneration && m.accepted_run !== null &&
    m.accepted_run.run_id === authority.acceptedRun.run_id &&
    m.accepted_run.run_digest === authority.acceptedRun.run_digest &&
    m.accepted_run.final_seq === authority.acceptedRun.final_seq &&
    m.published_identity_revision === authority.publishedIdentityRevision &&
    verified.identityMetadata.revision >= authority.publishedIdentityRevision;
}

export function findCoveringRecoverySet({ backupRoot, catalogStorageDir, authority }) {
  const valid = [], invalid = [];
  for (const setId of discoverRecoverySets({ backupRoot }).reverse()) {
    try {
      const verified = verifyRecoverySet({ backupRoot, setId, catalogStorageDir });
      valid.push(verified);
      if (recoverySetCovers(verified, authority)) return { covering: verified, valid, invalid };
    } catch (error) { invalid.push({ setId, code: error.code || 'RECOVERY_VERIFY_FAILED' }); }
  }
  return { covering: null, valid, invalid };
}

function newSetId(now) {
  return 'set-' + now().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z') + '-' + crypto.randomBytes(8).toString('hex');
}

export function createRecoverySet({ backupRoot, catalogStorageDir, identityStore,
  replayStore, reader, publicationLock, now = () => new Date(), failpoint } = {}) {
  const root = validateBackupRoot(backupRoot);
  if (!(identityStore instanceof IdentityStore) || !(replayStore instanceof ReplayStore) ||
      !(reader instanceof CatalogReader) || !publicationLock?.withLock) throw new TypeError('Open stores, reader, and publication lock are required');
  const setId = newSetId(now), temp = path.join(root, '.tmp-' + setId), final = path.join(root, setId);
  if (fs.existsSync(temp) || fs.existsSync(final)) fail('RECOVERY_SET_EXISTS', 'Recovery set path already exists');
  fs.mkdirSync(temp, { mode: 0o700 });
  const hit = name => { const result = failpoint?.(name); if (result instanceof Promise) throw new TypeError('Recovery failpoint must be synchronous'); };
  try {
    return publicationLock.withLock(() => {
      const authority = readRecoveryAuthority(reader);
      const identityPath = path.join(temp, 'identity.sqlite');
      const replayPath = path.join(temp, 'replay.sqlite');
      hit('beforeIdentitySnapshot');
      identityStore.db.prepare('VACUUM INTO ?').run(identityPath);
      fs.chmodSync(identityPath, 0o600); hit('afterIdentitySnapshot');
      replayStore.db.prepare('VACUUM INTO ?').run(replayPath);
      fs.chmodSync(replayPath, 0o600); hit('afterReplaySnapshot');
      const id = IdentityStore.openExisting(identityPath, { readOnly: true });
      let metadata; try { metadata = id.metadata(); } finally { id.close(); }
      const replay = ReplayStore.openExisting(replayPath, { catalogStorageDir, readOnly: true });
      try {
        const rows = replay.db.prepare('PRAGMA integrity_check').all();
        if (rows.length !== 1 || Object.values(rows[0])[0] !== 'ok') fail('RECOVERY_REPLAY_INTEGRITY', 'Replay integrity failed');
      } finally { replay.close(); }
      const identityStat = fs.statSync(identityPath), replayStat = fs.statSync(replayPath);
      const manifest = {
        schema: RECOVERY_SET_SCHEMA, set_id: setId, created_at: now().toISOString(),
        current_generation: authority.currentGeneration,
        previous_generation: authority.previousGeneration, source_epoch: authority.sourceEpoch,
        published_identity_revision: authority.publishedIdentityRevision,
        accepted_run: authority.acceptedRun,
        identity: { file: 'identity.sqlite', bytes: identityStat.size, sha256: shaFile(identityPath),
          schema_version: IDENTITY_SCHEMA_VERSION, revision: metadata.revision,
          integrity: 'ok', journal_mode: 'delete' },
        replay: { file: 'replay.sqlite', bytes: replayStat.size, sha256: shaFile(replayPath),
          schema_version: REPLAY_SCHEMA_VERSION, integrity: 'ok', journal_mode: 'delete' },
      };
      fsync(identityPath); fsync(replayPath);
      const manifestPath = path.join(temp, 'manifest.json');
      fs.writeFileSync(manifestPath, canonicalControlJson(manifest), { flag: 'wx', mode: 0o600 });
      fs.chmodSync(manifestPath, 0o600); fsync(manifestPath); hit('afterManifestWrite');
      fsync(temp); hit('beforeRename');
      fs.renameSync(temp, final); hit('afterRenameBeforeParentFsync'); fsync(root);
      return verifyRecoverySet({ backupRoot: root, setId, catalogStorageDir });
    });
  } catch (error) {
    try { if (fs.existsSync(temp)) fs.rmSync(temp, { recursive: true }); } catch {}
    throw error;
  }
}

export function reconcileRestore({ verified, catalogStorageDir, generationId }) {
  if (verified.manifest.current_generation !== generationId) fail('RECOVERY_GENERATION_MISMATCH', 'Selected generation differs from manifest');
  const catalog = inspectCatalogGeneration(catalogStorageDir, generationId);
  const identity = IdentityStore.openExisting(path.join(verified.directory, 'identity.sqlite'), { readOnly: true });
  const db = new DatabaseSync(catalog.path, { readOnly: true, create: false });
  try {
    if (catalog.identity_revision > identity.metadata().revision) fail('RECOVERY_IDENTITY_TOO_OLD', 'Identity revision is below catalog revision');
    for (const row of db.prepare("SELECT product_id FROM products WHERE lifecycle='active'").iterate()) {
      if (identity.getProduct(row.product_id)?.lifecycle !== 'active') fail('RECOVERY_PRODUCT_MISMATCH', 'Active catalog product is absent from identity');
    }
    for (const row of db.prepare("SELECT variant_id,product_id,sku,sku_key FROM variants WHERE lifecycle='active'").iterate()) {
      const found = identity.getVariant(row.variant_id);
      if (!found || found.lifecycle !== 'active' || found.product_id !== row.product_id ||
          found.sku_key !== row.sku_key || normalizeSku(row.sku).sku_key !== found.sku_key) {
        fail('RECOVERY_VARIANT_MISMATCH', 'Active catalog variant conflicts with identity');
      }
    }
    return { ok: true, generation_id: generationId, identity_revision: identity.metadata().revision,
      catalog_identity_revision: catalog.identity_revision };
  } finally { db.close(); identity.close(); }
}

export function recoverReplay({ newReplayPath, catalogStorageDir, authority,
  lastRunId = null, lastRunDigest = null } = {}) {
  if (!path.isAbsolute(newReplayPath || '') || fs.existsSync(newReplayPath)) {
    fail('RECOVERY_REPLAY_PATH_INVALID', 'New replay path must be absolute and absent');
  }
  if ((lastRunId === null) !== (lastRunDigest === null)) fail('RECOVERY_REPLAY_ARGUMENTS', 'Last run ID and digest must be supplied together');
  const classification = lastRunId !== null && authority.acceptedRun?.run_id === lastRunId &&
    authority.acceptedRun?.run_digest === lastRunDigest
    ? 'ACCEPTED_LOST_RESPONSE' : 'ABANDON_AND_START_NEW_FULL';
  const replay = ReplayStore.createNew(newReplayPath, { catalogStorageDir });
  try { return { ok: true, classification, new_replay_path: path.resolve(newReplayPath), stats: replay.stats() }; }
  finally { replay.close(); }
}
