import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { backupCatalog, backupStatus, bootstrapCatalogRecovery,
  recoverReplayOperation, recoveryStatus } from '../../src/catalog/recovery/operations.mjs';

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
    assert.equal(backupStatus(paths).coverage, 'COVERED');
    const fresh = path.join(root, 'fresh.sqlite');
    const recovered = recoverReplayOperation(paths, { newReplayPath: fresh, lastRunId: null, lastRunDigest: null });
    assert.equal(recovered.classification, 'ABANDON_AND_START_NEW_FULL');
    assert.equal(fs.statSync(fresh).mode & 0o777, 0o600);
    assert.throws(() => recoverReplayOperation(paths, { newReplayPath: fresh, lastRunId: null, lastRunDigest: null }), /absent/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
