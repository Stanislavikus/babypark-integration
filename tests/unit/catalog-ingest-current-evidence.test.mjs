import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CatalogGenerationBuilder, CatalogPublisher, CatalogReader,
} from '../../src/catalog/sqlite/generation.mjs';
import { ReplayStore, canonicalJson, computeRunDigest } from '../../src/catalog/ingest/replay-store.mjs';
import {
  resolveFinalAckAgainstCurrent, finishPendingAgainstCurrent, renderAcceptedRunAck,
} from '../../src/catalog/ingest/current-evidence.mjs';

const digest = 'd'.repeat(64);
const body = Buffer.from(canonicalJson({ trailer: {
  run_digest: digest, base_generation_id: 'g1', base_watermark: null,
  count: 0, final_seq: 0,
} }));
const key = {
  kid: 'k1', runId: 'run_1', layer: 'content', seq: 0,
  bodySha256: crypto.createHash('sha256').update(body).digest('hex'),
  final: true, contentEncoding: 'identity',
};
function claim(store, reader, target = key) {
  return store.claim(target, 100, { verifiedBody: body, reader });
}
function setup(t, layer = 'content', status = 'ACCEPTED', savedDigest = digest, finalSeq = key.seq) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e2-evidence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const id of ['g1', 'g2']) {
    const builder = CatalogGenerationBuilder.create({
      storageDir: dir, generationId: id, sourceEpoch: 'epoch-1',
      identityRevision: 0,
    });
    if (id === 'g2') {
      builder.db.prepare(
        'INSERT INTO ingest_runs(run_id,layer,run_kind,run_digest,final_seq,' +
        'status,source_watermark,started_at,terminal_at) VALUES(?,?,?,?,?,?,?,?,?)'
      ).run(key.runId, layer, layer === 'full' ? 'full' : 'incremental',
        savedDigest, finalSeq, status, layer === 'full' ? null : '10',
        '2026-09-24T00:00:00Z', '2026-09-24T00:00:01Z');
    }
    builder.seal();
  }
  const publisher = new CatalogPublisher(dir);
  publisher.publish('g1');
  publisher.publish('g2');
  const reader = new CatalogReader(dir);
  const file = path.join(dir, 'replay.sqlite');
  let store = ReplayStore.createNew(file, { catalogStorageDir: dir });
  t.after(() => { reader.close(); store.close(); });
  return { publisher, reader, file, get store() { return store; },
    reopen() { store.close(); store = ReplayStore.openExisting(file, { catalogStorageDir: dir }); } };
}

test('accepted ACK follows evidence in CURRENT through rollback and roll-forward', t => {
  const f = setup(t);
  assert.equal(claim(f.store, f.reader).status, 'NEW');
  f.reopen();
  const ack = renderAcceptedRunAck({
    key, generationId: 'g2', runDigest: digest, sourceWatermark: '10',
  });
  assert.deepEqual(finishPendingAgainstCurrent({ store: f.store, reader: f.reader, key }),
    { status: 'ACKED', ack });
  f.publisher.rollbackToPrevious();
  assert.deepEqual(resolveFinalAckAgainstCurrent({ store: f.store, reader: f.reader, key }),
    { status: 'RUN_SUPERSEDED' });
  const pending = { ...key, runId: 'run_2' };
  claim(f.store, f.reader, pending);
  assert.deepEqual(finishPendingAgainstCurrent({
    store: f.store, reader: f.reader, key: pending,
  }), { status: 'PENDING' });
  assert.throws(() => f.store.takeover(pending, {
    now: 161, expectedLeaseUntil: 160,
  }), error => error.code === 'INGEST_REPLAY_STATE_REQUIRED');
  f.publisher.rollbackToPrevious();
  assert.deepEqual(resolveFinalAckAgainstCurrent({ store: f.store, reader: f.reader, key }),
    { status: 'ACKED', ack });
});

test('a conflicting digest from CURRENT cannot become a signed ACK', t => {
  const f = setup(t, 'content', 'ACCEPTED', 'e'.repeat(64));
  claim(f.store, f.reader);
  assert.deepEqual(finishPendingAgainstCurrent({ store: f.store, reader: f.reader, key }),
    { status: 'RUN_ID_CONFLICT' });
});

test('full evidence matches full key; wrong incremental layer is rejected', t => {
  const f = setup(t, 'full');
  const fullKey = { ...key, layer: 'full' };
  claim(f.store, f.reader, fullKey);
  assert.equal(finishPendingAgainstCurrent({
    store: f.store, reader: f.reader, key: fullKey,
  }).status, 'ACKED');
  const wrong = { ...key, kid: 'k2' };
  assert.throws(() => claim(f.store, f.reader, wrong),
    error => error.code === 'INGEST_REPLAY_CONFLICT');
});

for (const status of ['REJECTED', 'FAILED', 'ABANDONED']) {
  test(status + ' is terminal for an accepted final receipt', t => {
    const f = setup(t, 'content', status);
    claim(f.store, f.reader);
    assert.deepEqual(finishPendingAgainstCurrent({ store: f.store, reader: f.reader, key }),
      { status: 'RUN_REJECTED' });
  });
}

test('stored ACK cannot substitute a watermark absent from CURRENT', t => {
  const f = setup(t);
  claim(f.store, f.reader);
  const accepted = finishPendingAgainstCurrent({ store: f.store, reader: f.reader, key });
  assert.equal(accepted.status, 'ACKED');
  assert.equal(accepted.ack.source_watermark, '10');
  const forged = { ...accepted.ack, source_watermark: '999' };
  f.store.db.prepare(
    'UPDATE receipts SET ack_json=? WHERE kid=? AND run_id=? AND layer=? AND seq=?'
  ).run(canonicalJson(forged), key.kid, key.runId, key.layer, key.seq);
  assert.throws(() => resolveFinalAckAgainstCurrent({
    store: f.store, reader: f.reader, key,
  }), error => error.code === 'INGEST_REPLAY_ACK_CONFLICT');
});

test('ACCEPTED row requires a digest and final sequence', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e2-schema-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const builder = CatalogGenerationBuilder.create({
    storageDir: dir, generationId: 'g1', sourceEpoch: 'epoch-1',
    identityRevision: 0,
  });
  t.after(() => { try { builder.db.close(); } catch {} });
  assert.throws(() => builder.db.prepare(
    "INSERT INTO ingest_runs(run_id,layer,run_kind,status,started_at,terminal_at) " +
    "VALUES('bad','content','incremental','ACCEPTED','now','now')"
  ).run(), /CHECK constraint failed/);
  assert.throws(() => builder.db.prepare(
    "INSERT INTO ingest_runs(run_id,layer,run_kind,run_digest,final_seq,status,started_at,terminal_at) " +
    "VALUES('no-watermark','content','incremental',?,0,'ACCEPTED','now','now')"
  ).run(digest), /CHECK constraint failed/);
  assert.throws(() => builder.db.prepare(
    "INSERT INTO ingest_runs(run_id,layer,run_kind,run_digest,final_seq,status,source_watermark,started_at,terminal_at) " +
    "VALUES('long-watermark','content','incremental',?,0,'ACCEPTED',?,'now','now')"
  ).run(digest, '1'.repeat(21)), /CHECK constraint failed/);
});

test('accepted evidence permits staged-body cleanup without losing final ACK', t => {
  const chunk = Buffer.from('{"rows":[{"id":"one"}]}');
  const chunkHash = crypto.createHash('sha256').update(chunk).digest('hex');
  const runDigest = computeRunDigest({
    runId: key.runId, layer: key.layer, baseGenerationId: 'g1',
    baseWatermark: null, count: 1, chunkHashes: [chunkHash],
  });
  const f = setup(t, 'content', 'ACCEPTED', runDigest, 1);
  const staged = { ...key, seq: 0, final: false, bodySha256: chunkHash };
  const c = f.store.claim(staged);
  f.store.stage(staged, chunk, c.claimToken);
  const finalBody = Buffer.from(canonicalJson({ trailer: {
    run_digest: runDigest, base_generation_id: 'g1',
    base_watermark: null, count: 1, final_seq: 1,
  } }));
  const final = {
    ...key, seq: 1,
    bodySha256: crypto.createHash('sha256').update(finalBody).digest('hex'),
  };
  f.store.claim(final, 100, { verifiedBody: finalBody, reader: f.reader });
  assert.equal(f.store.verifyClaimedRunDigest(final).runDigest, runDigest);
  assert.equal(f.store.finishPendingAgainstCurrent(final, f.reader).status, 'ACKED');
  assert.deepEqual(f.store.releaseAcceptedRunBodies(final, f.reader),
    { status: 'RELEASED', releasedCount: 1 });
  assert.equal(f.store.db.prepare(
    'SELECT staged_body IS NULL AS absent FROM receipts WHERE seq=0'
  ).get().absent, 1);
  assert.deepEqual(f.store.stage(staged, chunk, c.claimToken),
    { status: 'STAGED_RELEASED' });
  assert.deepEqual(f.store.resolveStagedAck(staged), { status: 'RUN_SUPERSEDED' });
  assert.equal(f.store.resolveFinalAckAgainstCurrent(final, f.reader).status, 'ACKED');
});
