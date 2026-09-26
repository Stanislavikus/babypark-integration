import fs from 'node:fs';
import path from 'node:path';
import { IdentityStore } from '../identity/store.mjs';
import { ReplayStore } from '../ingest/replay-store.mjs';
import { CatalogReader } from '../sqlite/generation.mjs';
import { CatalogPublicationLock } from '../sqlite/publication-lock.mjs';
import {
  createRecoverySetLocked, discoverRecoverySets, findCoveringRecoverySet, inspectRecoverySets,
  readRecoveryAuthority, reconcileRestore, recoverReplay, validateBackupRoot,
  validatePrivateDirectory, verifyRecoverySet,
} from './core.mjs';

function absolute(name, value) {
  if (!value || !path.isAbsolute(value)) throw Object.assign(new Error(name + ' must be an absolute path'), { code: 'USAGE' });
  return path.resolve(value);
}

export function bootstrapCatalogRecovery({ identityPath, replayPath, catalogStorageDir, backupRoot }) {
  identityPath = absolute('identity', identityPath); replayPath = absolute('replay', replayPath);
  catalogStorageDir = absolute('catalog-dir', catalogStorageDir); backupRoot = absolute('backup-root', backupRoot);
  const result = { ok: false };
  if (!fs.existsSync(catalogStorageDir)) { fs.mkdirSync(catalogStorageDir, { mode: 0o700 }); result.catalog_dir = 'created'; }
  else { validatePrivateDirectory(catalogStorageDir, { code: 'CATALOG_DIRECTORY_UNSAFE' }); result.catalog_dir = 'existing_valid'; }
  let identity;
  if (!fs.existsSync(identityPath)) { identity = IdentityStore.createNew(identityPath); result.identity = 'created'; }
  else { identity = IdentityStore.openExisting(identityPath); result.identity = 'existing_valid'; }
  identity.close();
  let replay;
  if (!fs.existsSync(replayPath)) { replay = ReplayStore.createNew(replayPath, { catalogStorageDir }); result.replay = 'created'; }
  else { replay = ReplayStore.openExisting(replayPath, { catalogStorageDir }); result.replay = 'existing_valid'; }
  replay.close();
  if (!fs.existsSync(backupRoot)) { fs.mkdirSync(backupRoot, { mode: 0o700 }); result.backup_root = 'created'; }
  else { validateBackupRoot(backupRoot); result.backup_root = 'existing_valid'; }
  // Explicit bootstrap is the only operation allowed to initialize this coordination DB.
  const lock = new CatalogPublicationLock(catalogStorageDir); lock.close();
  result.ok = true;
  return result;
}

function open(paths) {
  const catalogStorageDir = absolute('catalog-dir', paths.catalogStorageDir);
  const identity = IdentityStore.openExisting(absolute('identity', paths.identityPath), { readOnly: true });
  const replay = ReplayStore.openExisting(absolute('replay', paths.replayPath), { catalogStorageDir, readOnly: true });
  const reader = new CatalogReader(catalogStorageDir);
  return { catalogStorageDir, identity, replay, reader };
}

export function recoveryStatus(paths, { fullVerification = false } = {}) {
  const stores = open(paths);
  try {
    const authority = readRecoveryAuthority(stores.reader);
    const identityRevision = stores.identity.metadata().revision;
    const root = validateBackupRoot(absolute('backup-root', paths.backupRoot));
    const sets = discoverRecoverySets({ backupRoot: root });
    const coverage = fullVerification
      ? findCoveringRecoverySet({ backupRoot: root, catalogStorageDir: stores.catalogStorageDir, authority })
      : null;
    return { ok: true, authority, live_identity_revision: identityRevision,
      identity_ahead: authority.publishedIdentityRevision === null ? identityRevision : identityRevision - authority.publishedIdentityRevision,
      replay: stores.replay.stats(), backup_root: { safe: true, path: root },
      completed_set_count: sets.length,
      covering_set: coverage?.covering?.setId ?? null,
      invalid_sets: coverage?.invalid ?? [] };
  } finally { stores.reader.close(); stores.replay.close(); stores.identity.close(); }
}

export function backupCatalog(paths) {
  const catalogStorageDir = absolute('catalog-dir', paths.catalogStorageDir);
  const identity = IdentityStore.openExisting(absolute('identity', paths.identityPath));
  const replay = ReplayStore.openExisting(absolute('replay', paths.replayPath), { catalogStorageDir });
  const reader = new CatalogReader(catalogStorageDir);
  const lock = new CatalogPublicationLock(catalogStorageDir);
  try {
    return lock.withLock(() => {
      const authority = readRecoveryAuthority(reader);
      const found = findCoveringRecoverySet({ backupRoot: absolute('backup-root', paths.backupRoot),
        catalogStorageDir, authority });
      if (found.covering) return { ok: true, created: false,
        set_id: found.covering.setId, coverage: 'COVERED' };
      const verified = createRecoverySetLocked({ backupRoot: absolute('backup-root', paths.backupRoot),
        catalogStorageDir, identityStore: identity, replayStore: replay, reader,
        publicationLock: lock, authority });
      return { ok: true, created: true, set_id: verified.setId,
        coverage: 'COVERED', manifest: verified.manifest };
    });
  } finally { lock.close(); reader.close(); replay.close(); identity.close(); }
}

function safeBackupBytes(root, ids) {
  let bytes = 0;
  for (const id of ids) {
    const directory = path.join(root, id);
    let entries;
    try { entries = fs.readdirSync(directory); } catch { continue; }
    for (const name of entries.slice(0, 32)) {
      try { const stat = fs.lstatSync(path.join(directory, name)); if (stat.isFile() && !stat.isSymbolicLink()) bytes += stat.size; } catch {}
    }
  }
  return bytes;
}

export function backupStatus(paths, { now = () => new Date() } = {}) {
  const stores = open(paths);
  const root = validateBackupRoot(absolute('backup-root', paths.backupRoot));
  let authority, identityRevision, replayStats, inventory;
  try {
    authority = readRecoveryAuthority(stores.reader);
    identityRevision = stores.identity.metadata().revision;
    replayStats = stores.replay.stats();
    inventory = inspectRecoverySets({ backupRoot: root,
      catalogStorageDir: stores.catalogStorageDir, authority });
  } finally { stores.reader.close(); stores.replay.close(); stores.identity.close(); }
  const ids = discoverRecoverySets({ backupRoot: paths.backupRoot });
  const latest = inventory.valid[0] ?? null;
  const covering = inventory.covering;
  const age = value => Math.max(0, Math.floor((now().getTime() - Date.parse(value)) / 1000));
  return { ok: true, authority, live_identity_revision: identityRevision,
    identity_ahead: authority.publishedIdentityRevision === null ? identityRevision : identityRevision - authority.publishedIdentityRevision,
    replay: replayStats, backup_root: { safe: true, path: root }, completed_set_count: ids.length,
    valid_sets: inventory.valid.map(item => item.setId), invalid_sets: inventory.invalid,
    covering_set: covering?.setId ?? null,
    coverage: covering ? 'COVERED' : inventory.invalid.length === ids.length && ids.length ? 'INVALID' : 'REQUIRED',
    latest_valid_set: latest?.setId ?? null,
    latest_valid_created_at: latest?.manifest.created_at ?? null,
    latest_valid_age_seconds: latest ? age(latest.manifest.created_at) : null,
    covering_set_created_at: covering?.manifest.created_at ?? null,
    covering_set_age_seconds: covering ? age(covering.manifest.created_at) : null,
    backup_bytes: safeBackupBytes(root, ids) };
}

export function validateRestore(paths, { setId, generationId }) {
  if (!setId) throw Object.assign(new Error('set-id is required'), { code: 'USAGE' });
  const verified = verifyRecoverySet({ backupRoot: absolute('backup-root', paths.backupRoot), setId,
    catalogStorageDir: absolute('catalog-dir', paths.catalogStorageDir) });
  if (verified.manifest.current_generation !== null && !generationId) {
    throw Object.assign(new Error('generation is required for CURRENT restore'), { code: 'USAGE' });
  }
  return { set_id: setId, ...reconcileRestore({ verified, catalogStorageDir: paths.catalogStorageDir, generationId }) };
}

export function recoverReplayOperation(paths, options) {
  const reader = new CatalogReader(absolute('catalog-dir', paths.catalogStorageDir));
  try {
    return recoverReplay({ newReplayPath: absolute('new-replay', options.newReplayPath),
      catalogStorageDir: paths.catalogStorageDir, authority: readRecoveryAuthority(reader),
      lastRunId: options.lastRunId, lastRunDigest: options.lastRunDigest });
  } finally { reader.close(); }
}
