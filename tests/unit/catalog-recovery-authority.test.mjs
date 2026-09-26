import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createE6aHarness, phase0Records, phase1Records, phase2Records } from '../helpers/catalog-e6a1-fixture.mjs';
import { createRecoverySet, createRecoverySetLocked, discoverRecoverySets, readRecoveryAuthority,
  reconcileRestore, recoverySetCovers, verifyRecoverySet } from '../../src/catalog/recovery/core.mjs';
import { canonicalControlJson } from '../../src/catalog/ingest/run-protocol.mjs';
import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';

const FAKE_BOOTSTRAP_AUTHORITY = {
  state: 'BOOTSTRAP', currentGeneration: null, previousGeneration: null,
  sourceEpoch: null, publishedIdentityRevision: null, acceptedRun: null, acceptedKid: null,
};

const FAKE_PUBLICATION_LOCK = {
  active: true,
  withLock(work) { return work(); },
};

test('recovery-set creation rejects a spoofed publication lock and accepts the real one', () => {
  const h = createE6aHarness();
  const backup = path.join(h.root, 'backup'); fs.mkdirSync(backup, { mode: 0o700 });
  const base = { backupRoot: backup, catalogStorageDir: h.catalogDir, identityStore: h.identity,
    replayStore: h.store, reader: h.reader, publicationLock: FAKE_PUBLICATION_LOCK };
  try {
    h.apply(phase0Records(), 1); h.apply(phase1Records(), 2); h.apply(phase2Records(), 3); h.finish(4);
    assert.throws(() => createRecoverySetLocked(base), /held publication lock/);
    assert.throws(() => createRecoverySet(base), /Publication lock is required/);
    assert.deepEqual(discoverRecoverySets({ backupRoot: backup }), []);
    const verified = createRecoverySet({ ...base, publicationLock: h.mutex });
    assert.equal(verified.verified, true);
    assert.equal(verified.manifest.current_generation, readRecoveryAuthority(h.reader).currentGeneration);
    assert.deepEqual(discoverRecoverySets({ backupRoot: backup }), [verified.setId]);
  } finally { h.close(); }
});

test('recovery-set authority is always read under the publication lock, never caller-supplied', () => {
  const h = createE6aHarness();
  const backup = path.join(h.root, 'backup'); fs.mkdirSync(backup, { mode: 0o700 });
  try {
    h.apply(phase0Records(), 1); h.apply(phase1Records(), 2); h.apply(phase2Records(), 3); h.finish(4);
    const authority = readRecoveryAuthority(h.reader);
    assert.equal(authority.state, 'CURRENT');
    const locked = h.mutex.withLock(() => createRecoverySetLocked({ backupRoot: backup,
      catalogStorageDir: h.catalogDir, identityStore: h.identity, replayStore: h.store,
      reader: h.reader, publicationLock: h.mutex, authority: FAKE_BOOTSTRAP_AUTHORITY }));
    assert.notEqual(locked.manifest.current_generation, null);
    assert.notEqual(locked.manifest.accepted_run, null);
    assert.equal(locked.manifest.current_generation, authority.currentGeneration);
    assert.deepEqual(locked.manifest.accepted_run, authority.acceptedRun);
    const viaPublic = createRecoverySet({ backupRoot: backup, catalogStorageDir: h.catalogDir,
      identityStore: h.identity, replayStore: h.store, reader: h.reader, publicationLock: h.mutex,
      authority: FAKE_BOOTSTRAP_AUTHORITY });
    assert.notEqual(viaPublic.manifest.current_generation, null);
    assert.equal(viaPublic.manifest.accepted_run.run_id, authority.acceptedRun.run_id);
  } finally { h.close(); }
});

test('CURRENT authority derives one KID and recovery set reconciles catalog identity', () => {
  const h = createE6aHarness();
  const backup = path.join(h.root, 'backup'); fs.mkdirSync(backup, { mode: 0o700 });
  try {
    h.apply(phase0Records(), 1); h.apply(phase1Records(), 2); h.apply(phase2Records(), 3);
    const finished = h.finish(4);
    assert.equal(finished.result.status, 'ACKED');
    const authority = readRecoveryAuthority(h.reader);
    assert.equal(authority.state, 'CURRENT'); assert.equal(authority.acceptedKid, 'e6a-kid');
    assert.equal(authority.acceptedRun.run_digest, finished.digest);
    const verified = createRecoverySet({ backupRoot: backup, catalogStorageDir: h.catalogDir,
      identityStore: h.identity, replayStore: h.store, reader: h.reader, publicationLock: h.mutex });
    assert.throws(() => reconcileRestore({ verified, catalogStorageDir: h.catalogDir }), /explicit generation/);
    assert.equal(recoverySetCovers(verified, authority), true);
    // Live identity being ahead is intentionally not part of CURRENT coverage equality.
    h.identity.setConfigHash('post-publish', 'f'.repeat(64));
    assert.equal(recoverySetCovers(verified, authority), true);
    assert.equal(recoverySetCovers(verified, { ...authority,
      acceptedRun: { ...authority.acceptedRun, run_digest: '0'.repeat(64) } }), false);
    const liveFiles = [path.join(h.root, 'identity.sqlite'), path.join(h.root, 'replay.sqlite'),
      path.join(h.catalogDir, 'CURRENT'), path.join(h.catalogDir, 'catalog.e6a1.sqlite')];
    const before = Object.fromEntries(liveFiles.map(file => [file,
      { hash: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), mtime: fs.statSync(file).mtimeMs }]));
    assert.equal(reconcileRestore({ verified, catalogStorageDir: h.catalogDir,
      generationId: authority.currentGeneration }).ok, true);
    for (const file of liveFiles) assert.deepEqual({
      hash: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
      mtime: fs.statSync(file).mtimeMs,
    }, before[file]);
  } finally { h.close(); }
});

test('CURRENT authority fails closed when run_chunks contain multiple KIDs', () => {
  const h = createE6aHarness();
  try {
    h.apply(phase0Records(), 1); h.apply(phase1Records(), 2); h.apply(phase2Records(), 3); h.finish(4);
    const file = path.join(h.catalogDir, 'catalog.e6a1.sqlite');
    // Controlled fixture corruption is made through a writable copy of CURRENT.
    h.reader.close();
    const db = new DatabaseSync(file);
    try { db.prepare("UPDATE run_chunks SET kid='other-kid' WHERE seq=3").run(); } finally { db.close(); }
    assert.throws(() => readRecoveryAuthority(h.reader), /inconsistent/);
  } finally { h.close(); }
});

test('restore rejects canonical manifest accepted-run digest tampering', () => {
  const h = createE6aHarness(); const backup = path.join(h.root, 'backup'); fs.mkdirSync(backup, { mode: 0o700 });
  try {
    h.apply(phase0Records(), 1); h.apply(phase1Records(), 2); h.apply(phase2Records(), 3); h.finish(4);
    const made = createRecoverySet({ backupRoot: backup, catalogStorageDir: h.catalogDir,
      identityStore: h.identity, replayStore: h.store, reader: h.reader, publicationLock: h.mutex });
    const manifestPath = path.join(made.directory, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    manifest.accepted_run.run_digest = '0'.repeat(64);
    fs.writeFileSync(manifestPath, canonicalControlJson(manifest)); fs.chmodSync(manifestPath, 0o600);
    const verified = verifyRecoverySet({ backupRoot: backup, setId: made.setId, catalogStorageDir: h.catalogDir });
    assert.throws(() => reconcileRestore({ verified, catalogStorageDir: h.catalogDir,
      generationId: manifest.current_generation }), /authority differs/);
  } finally { h.close(); }
});

test('restore checks all catalog rows and rejects tombstoned identity compatibility', () => {
  const h = createE6aHarness(); const backup = path.join(h.root, 'backup'); fs.mkdirSync(backup, { mode: 0o700 });
  try {
    h.apply(phase0Records(), 1); h.apply(phase1Records(), 2); h.apply(phase2Records(), 3); h.finish(4);
    const made = createRecoverySet({ backupRoot: backup, catalogStorageDir: h.catalogDir,
      identityStore: h.identity, replayStore: h.store, reader: h.reader, publicationLock: h.mutex });
    h.reader.close();
    const catalogPath = path.join(h.catalogDir, 'catalog.e6a1.sqlite');
    const cdb = new DatabaseSync(catalogPath); try { cdb.exec("UPDATE variants SET lifecycle='tombstoned'; UPDATE products SET lifecycle='tombstoned'"); } finally { cdb.close(); }
    const identityPath = path.join(made.directory, 'identity.sqlite');
    const idb = new DatabaseSync(identityPath); try { idb.exec("UPDATE variants SET lifecycle='tombstoned'; UPDATE products SET lifecycle='tombstoned'"); } finally { idb.close(); }
    const manifestPath = path.join(made.directory, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    manifest.identity.bytes = fs.statSync(identityPath).size;
    manifest.identity.sha256 = crypto.createHash('sha256').update(fs.readFileSync(identityPath)).digest('hex');
    fs.writeFileSync(manifestPath, canonicalControlJson(manifest));
    const verified = verifyRecoverySet({ backupRoot: backup, setId: made.setId, catalogStorageDir: h.catalogDir });
    assert.throws(() => reconcileRestore({ verified, catalogStorageDir: h.catalogDir,
      generationId: manifest.current_generation }), /Active catalog product/);
  } finally { h.close(); }
});
