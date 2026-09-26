import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { IdentityStore } from '../../src/catalog/identity/store.mjs';
import { ReplayStore } from '../../src/catalog/ingest/replay-store.mjs';
import { CatalogReader } from '../../src/catalog/sqlite/generation.mjs';
import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';
import { createRecoverySet, discoverRecoverySets, readRecoveryAuthority,
  recoverySetCovers, verifyRecoverySet } from '../../src/catalog/recovery/core.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-recovery-'));
  const catalog = path.join(root, 'catalog'), backup = path.join(root, 'backup');
  fs.mkdirSync(catalog, { mode: 0o700 }); fs.mkdirSync(backup, { mode: 0o700 });
  const identity = IdentityStore.createNew(path.join(root, 'identity.sqlite'));
  const replay = ReplayStore.createNew(path.join(root, 'replay.sqlite'), { catalogStorageDir: catalog });
  const reader = new CatalogReader(catalog), lock = new CatalogPublicationLock(catalog);
  return { root, catalog, backup, identity, replay, reader, lock,
    close() { lock.close(); reader.close(); replay.close(); identity.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

test('BOOTSTRAP recovery set is immutable, canonical, verified, and covering', () => {
  const f = fixture();
  try {
    const authority = readRecoveryAuthority(f.reader);
    assert.deepEqual(authority, { state: 'BOOTSTRAP', currentGeneration: null,
      previousGeneration: null, sourceEpoch: null, publishedIdentityRevision: null,
      acceptedRun: null, acceptedKid: null });
    const verified = createRecoverySet({ backupRoot: f.backup, catalogStorageDir: f.catalog,
      identityStore: f.identity, replayStore: f.replay, reader: f.reader, publicationLock: f.lock });
    assert.equal(recoverySetCovers(verified, authority), true);
    assert.deepEqual(discoverRecoverySets({ backupRoot: f.backup }), [verified.setId]);
    assert.equal(fs.statSync(verified.directory).mode & 0o777, 0o700);
    for (const name of ['identity.sqlite', 'replay.sqlite', 'manifest.json']) {
      assert.equal(fs.statSync(path.join(verified.directory, name)).mode & 0o777, 0o600);
    }
    assert.equal(verifyRecoverySet({ backupRoot: f.backup, setId: verified.setId,
      catalogStorageDir: f.catalog }).verified, true);
    fs.mkdirSync(path.join(f.backup, '.tmp-crash'), { mode: 0o700 });
    assert.deepEqual(discoverRecoverySets({ backupRoot: f.backup }), [verified.setId]);
  } finally { f.close(); }
});

test('verification rejects hash damage, symlinks, and unexpected files', () => {
  for (const damage of ['hash', 'symlink', 'extra']) {
    const f = fixture();
    try {
      const v = createRecoverySet({ backupRoot: f.backup, catalogStorageDir: f.catalog,
        identityStore: f.identity, replayStore: f.replay, reader: f.reader, publicationLock: f.lock });
      if (damage === 'hash') fs.appendFileSync(path.join(v.directory, 'identity.sqlite'), 'x');
      if (damage === 'symlink') { fs.unlinkSync(path.join(v.directory, 'replay.sqlite')); fs.symlinkSync('/dev/null', path.join(v.directory, 'replay.sqlite')); }
      if (damage === 'extra') fs.writeFileSync(path.join(v.directory, 'extra'), 'x');
      assert.throws(() => verifyRecoverySet({ backupRoot: f.backup, setId: v.setId,
        catalogStorageDir: f.catalog }), /Recovery/);
    } finally { f.close(); }
  }
});

test('synchronous failpoints never publish a partial completed set', () => {
  for (const point of ['beforeIdentitySnapshot', 'afterIdentitySnapshot', 'afterReplaySnapshot',
    'afterManifestWrite', 'beforeRename']) {
    const f = fixture();
    try {
      assert.throws(() => createRecoverySet({ backupRoot: f.backup, catalogStorageDir: f.catalog,
        identityStore: f.identity, replayStore: f.replay, reader: f.reader, publicationLock: f.lock,
        failpoint(name) { if (name === point) throw new Error('crash:' + point); } }), /crash:/);
      assert.deepEqual(discoverRecoverySets({ backupRoot: f.backup }), []);
      assert.equal(f.identity.metadata().revision, 0);
      assert.equal(f.replay.stats().receipts_total, 0);
    } finally { f.close(); }
  }
});

test('failure after atomic rename leaves a fully verified completed set', () => {
  const f = fixture();
  try {
    assert.throws(() => createRecoverySet({ backupRoot: f.backup, catalogStorageDir: f.catalog,
      identityStore: f.identity, replayStore: f.replay, reader: f.reader, publicationLock: f.lock,
      failpoint(name) { if (name === 'afterRenameBeforeParentFsync') throw new Error('crash:afterRename'); } }), /crash:/);
    const [setId] = discoverRecoverySets({ backupRoot: f.backup });
    assert.ok(setId);
    assert.equal(verifyRecoverySet({ backupRoot: f.backup, setId,
      catalogStorageDir: f.catalog }).verified, true);
  } finally { f.close(); }
});
