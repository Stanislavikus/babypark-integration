import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { backupCatalog, backupStatus, bootstrapCatalogRecovery,
  recoverReplayOperation, recoveryStatus, validateRestore } from '../../src/catalog/recovery/operations.mjs';
import { IdentityStore } from '../../src/catalog/identity/store.mjs';
import { ReplayStore } from '../../src/catalog/ingest/replay-store.mjs';
import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';

const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('bootstrap is idempotent, status is read-only, backup de-duplicates, and replay recovery never overwrites', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-ops-'));
  const paths = { identityPath: path.join(root, 'identity.sqlite'), replayPath: path.join(root, 'replay.sqlite'),
    catalogStorageDir: path.join(root, 'catalog'), backupRoot: path.join(root, 'backup') };
  try {
    assert.deepEqual(bootstrapCatalogRecovery(paths), { ok: true, catalog_dir: 'created', identity: 'created', replay: 'created', backup_root: 'created' });
    const again = bootstrapCatalogRecovery(paths);
    assert.equal(again.identity, 'existing_valid'); assert.equal(again.replay, 'existing_valid');
    const before = fs.statSync(paths.replayPath).mtimeMs;
    assert.equal(recoveryStatus(paths).authority.state, 'BOOTSTRAP');
    assert.equal(fs.statSync(paths.replayPath).mtimeMs, before);
    const first = backupCatalog(paths), second = backupCatalog(paths);
    assert.equal(first.created, true); assert.equal(second.created, false); assert.equal(second.set_id, first.set_id);
    const durableBefore = Object.fromEntries([paths.identityPath, paths.replayPath].map(file =>
      [file, { hash: digest(file), mtime: fs.statSync(file).mtimeMs }]));
    assert.equal(recoveryStatus(paths).authority.state, 'BOOTSTRAP');
    assert.equal(backupStatus(paths).coverage, 'COVERED');
    const restore = validateRestore(paths, { setId: first.set_id, generationId: null });
    assert.equal(restore.state, 'BOOTSTRAP'); assert.equal(restore.generation_id, null);
    for (const [file, beforeState] of Object.entries(durableBefore)) {
      assert.deepEqual({ hash: digest(file), mtime: fs.statSync(file).mtimeMs }, beforeState);
    }
    assert.equal(fs.existsSync(path.join(paths.catalogStorageDir, 'CURRENT')), false);
    const fresh = path.join(root, 'fresh.sqlite');
    const recovered = recoverReplayOperation(paths, { newReplayPath: fresh, lastRunId: null, lastRunDigest: null });
    assert.equal(recovered.classification, 'ABANDON_AND_START_NEW_FULL');
    assert.equal(fs.statSync(fresh).mode & 0o777, 0o600);
    assert.throws(() => recoverReplayOperation(paths, { newReplayPath: fresh, lastRunId: null, lastRunDigest: null }), /absent/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('backup no-op decision is attempted only under the publication lock', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-ops-lock-'));
  const paths = { identityPath: path.join(root, 'identity.sqlite'), replayPath: path.join(root, 'replay.sqlite'),
    catalogStorageDir: path.join(root, 'catalog'), backupRoot: path.join(root, 'backup') };
  try {
    bootstrapCatalogRecovery(paths); backupCatalog(paths);
    const held = new CatalogPublicationLock(paths.catalogStorageDir);
    try {
      held.withLock(() => assert.throws(() => backupCatalog(paths), error => error.code === 'PUBLICATION_LOCK_BUSY'));
    } finally { held.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('backup-status verifies every set, reports corrupt older set, ages, and safe bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-ops-inventory-'));
  const paths = { identityPath: path.join(root, 'identity.sqlite'), replayPath: path.join(root, 'replay.sqlite'),
    catalogStorageDir: path.join(root, 'catalog'), backupRoot: path.join(root, 'backup') };
  try {
    bootstrapCatalogRecovery(paths);
    const old = backupCatalog(paths);
    fs.appendFileSync(path.join(paths.backupRoot, old.set_id, 'identity.sqlite'), 'damage');
    const fresh = backupCatalog(paths);
    fs.symlinkSync('/missing-target', path.join(paths.backupRoot, old.set_id, 'broken-link'));
    const status = backupStatus(paths, { now: () => new Date('2030-01-01T00:00:00.000Z') });
    assert.equal(status.coverage, 'COVERED'); assert.equal(status.covering_set, fresh.set_id);
    assert.ok(status.invalid_sets.some(item => item.setId === old.set_id));
    assert.equal(status.latest_valid_set, fresh.set_id);
    assert.ok(Number.isSafeInteger(status.latest_valid_age_seconds));
    assert.ok(Number.isSafeInteger(status.covering_set_age_seconds));
    assert.ok(status.backup_bytes > 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('bootstrap Option-B preserves existing components and rejects unsafe or invalid ones', () => {
  // Existing identity, other components missing.
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-bootstrap-a-'));
  try {
    fs.mkdirSync(path.join(a, 'catalog'), { mode: 0o700 });
    const identityPath = path.join(a, 'identity.sqlite'); const identity = IdentityStore.createNew(identityPath); identity.close();
    const before = { hash: digest(identityPath), ino: fs.statSync(identityPath).ino };
    fs.rmdirSync(path.join(a, 'catalog'));
    const result = bootstrapCatalogRecovery({ identityPath, replayPath: path.join(a, 'replay.sqlite'),
      catalogStorageDir: path.join(a, 'catalog'), backupRoot: path.join(a, 'backup') });
    assert.equal(result.identity, 'existing_valid'); assert.equal(result.replay, 'created');
    assert.deepEqual({ hash: digest(identityPath), ino: fs.statSync(identityPath).ino }, before);
  } finally { fs.rmSync(a, { recursive: true, force: true }); }

  // Existing replay is never reset.
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-bootstrap-b-'));
  try {
    const paths = { identityPath: path.join(b, 'identity.sqlite'), replayPath: path.join(b, 'replay.sqlite'),
      catalogStorageDir: path.join(b, 'catalog'), backupRoot: path.join(b, 'backup') };
    bootstrapCatalogRecovery(paths); const before = { hash: digest(paths.replayPath), ino: fs.statSync(paths.replayPath).ino };
    bootstrapCatalogRecovery(paths); assert.deepEqual({ hash: digest(paths.replayPath), ino: fs.statSync(paths.replayPath).ino }, before);
    fs.chmodSync(paths.backupRoot, 0o755);
    assert.throws(() => bootstrapCatalogRecovery(paths), /0700/);
  } finally { fs.rmSync(b, { recursive: true, force: true }); }

  for (const kind of ['identity', 'replay']) {
    const c = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-bootstrap-invalid-'));
    try {
      const paths = { identityPath: path.join(c, 'identity.sqlite'), replayPath: path.join(c, 'replay.sqlite'),
        catalogStorageDir: path.join(c, 'catalog'), backupRoot: path.join(c, 'backup') };
      fs.mkdirSync(paths.catalogStorageDir, { mode: 0o700 });
      const target = kind === 'identity' ? paths.identityPath : paths.replayPath;
      fs.writeFileSync(target, 'invalid', { mode: 0o600 }); const before = digest(target);
      assert.throws(() => bootstrapCatalogRecovery(paths)); assert.equal(digest(target), before);
    } finally { fs.rmSync(c, { recursive: true, force: true }); }
  }
});

test('real catalog-ops process freezes exit codes 0, 1, and 2 with JSON', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-cli-'));
  const common = [`--identity=${path.join(root, 'identity.sqlite')}`, `--replay=${path.join(root, 'replay.sqlite')}`,
    `--catalog-dir=${path.join(root, 'catalog')}`, `--backup-root=${path.join(root, 'backup')}`];
  const run = args => spawnSync(process.execPath, ['--no-warnings', 'scripts/catalog-ops.mjs', ...args],
    { cwd: path.resolve('.'), encoding: 'utf8' });
  try {
    const success = run(['bootstrap', ...common]); assert.equal(success.status, 0); assert.equal(JSON.parse(success.stdout).ok, true);
    const usage = run(['unknown']); assert.equal(usage.status, 2); assert.equal(JSON.parse(usage.stderr).ok, false);
    fs.chmodSync(path.join(root, 'backup'), 0o755);
    const failure = run(['status', ...common]); assert.equal(failure.status, 1); assert.equal(JSON.parse(failure.stderr).ok, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
