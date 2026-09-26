import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createE6aHarness, phase0Records, phase1Records, phase2Records } from '../helpers/catalog-e6a1-fixture.mjs';
import { createRecoverySet, readRecoveryAuthority, reconcileRestore,
  recoverySetCovers } from '../../src/catalog/recovery/core.mjs';

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
    assert.equal(recoverySetCovers(verified, authority), true);
    // Live identity being ahead is intentionally not part of CURRENT coverage equality.
    h.identity.setConfigHash('post-publish', 'f'.repeat(64));
    assert.equal(recoverySetCovers(verified, authority), true);
    assert.equal(recoverySetCovers(verified, { ...authority,
      acceptedRun: { ...authority.acceptedRun, run_digest: '0'.repeat(64) } }), false);
    assert.equal(reconcileRestore({ verified, catalogStorageDir: h.catalogDir,
      generationId: authority.currentGeneration }).ok, true);
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
