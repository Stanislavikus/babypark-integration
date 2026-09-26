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
  reconcileRestore, recoverySetCovers, verifyRecoverySet } from '../../src/catalog/recovery/core.mjs';
import { canonicalControlJson } from '../../src/catalog/ingest/run-protocol.mjs';

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
    assert.deepEqual(reconcileRestore({ verified, catalogStorageDir: f.catalog,
      generationId: null }), { ok: true, state: 'BOOTSTRAP', generation_id: null,
      identity_revision: 0, catalog_identity_revision: null });
    fs.mkdirSync(path.join(f.backup, '.tmp-crash'), { mode: 0o700 });
    assert.deepEqual(discoverRecoverySets({ backupRoot: f.backup }), [verified.setId]);
  } finally { f.close(); }
});

test('canonical manifests with malformed authority semantics are invalid', () => {
  const mutations = [
    m => { m.created_at = '2026-01-01'; },
    m => { m.current_generation = 123; },
    m => { m.previous_generation = { bad: true }; },
    m => { m.source_epoch = []; },
    m => { m.published_identity_revision = 'not-a-revision'; },
    m => { m.accepted_run = { run_id: 'bad id', run_digest: '0'.repeat(64), final_seq: 1, accepted_at: m.created_at }; },
    m => { m.identity.revision = -1; },
    m => { m.replay.bytes = 0; },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    try {
      const made = createRecoverySet({ backupRoot: f.backup, catalogStorageDir: f.catalog,
        identityStore: f.identity, replayStore: f.replay, reader: f.reader, publicationLock: f.lock });
      const file = path.join(made.directory, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(file)); mutate(manifest);
      fs.writeFileSync(file, canonicalControlJson(manifest)); fs.chmodSync(file, 0o600);
      assert.throws(() => verifyRecoverySet({ backupRoot: f.backup, setId: made.setId,
        catalogStorageDir: f.catalog }), /manifest/i);
    } finally { f.close(); }
  }
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
