import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CatalogGenerationBuilder, CatalogPublisher, CatalogReader,
} from '../../src/catalog/sqlite/generation.mjs';
import { ReplayStore } from '../../src/catalog/ingest/replay-store.mjs';
import {
  resolveFinalAckAgainstCurrent, finishPendingAgainstCurrent, renderAcceptedRunAck,
} from '../../src/catalog/ingest/current-evidence.mjs';

const digest = 'd'.repeat(64);
const body = Buffer.from(JSON.stringify({ trailer: {
  run_digest: digest, base_generation_id: 'g1', base_watermark: null,
  count: 0, final_seq: 0,
} }));
const key = {
  kid: 'k1', runId: 'run_1', layer: 'content', seq: 0,
  bodySha256: crypto.createHash('sha256').update(body).digest('hex'),
  final: true, contentEncoding: 'identity',
};
function claim(store, target = key) {
  return store.claim(target, 100, { verifiedBody: body, claimGenerationId: 'g1' });
}
function setup(t, layer = 'content', status = 'ACCEPTED', savedDigest = digest) {
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
        'status,started_at,terminal_at) VALUES(?,?,?,?,?,?,?,?)'
      ).run(key.runId, layer, layer === 'full' ? 'full' : 'incremental',
        savedDigest, key.seq, status, '2026-09-24T00:00:00Z',
        '2026-09-24T00:00:01Z');
    }
    builder.seal();
  }
  const publisher = new CatalogPublisher(dir);
  publisher.publish('g1');
  publisher.publish('g2');
  const reader = new CatalogReader(dir);
  const file = path.join(dir, 'replay.sqlite');
  let store = ReplayStore.createNew(file);
  t.after(() => { reader.close(); store.close(); });
  return { publisher, reader, file, get store() { return store; },
    reopen() { store.close(); store = ReplayStore.openExisting(file); } };
}

test('accepted ACK follows evidence in CURRENT through rollback and roll-forward', t => {
  const f = setup(t);
  assert.equal(claim(f.store).status, 'NEW');
  f.reopen();
  const ack = renderAcceptedRunAck({
    key, generationId: 'g2', runDigest: digest, sourceWatermark: null,
  });
  assert.deepEqual(finishPendingAgainstCurrent({ store: f.store, reader: f.reader, key }),
    { status: 'ACKED', ack });
  f.publisher.rollbackToPrevious();
  assert.deepEqual(resolveFinalAckAgainstCurrent({ store: f.store, reader: f.reader, key }),
    { status: 'RUN_SUPERSEDED' });
  const pending = { ...key, kid: 'k2' };
  claim(f.store, pending);
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
  claim(f.store);
  assert.deepEqual(finishPendingAgainstCurrent({ store: f.store, reader: f.reader, key }),
    { status: 'RUN_ID_CONFLICT' });
});

test('full evidence matches full key; wrong incremental layer is rejected', t => {
  const f = setup(t, 'full');
  const fullKey = { ...key, layer: 'full' };
  claim(f.store, fullKey);
  assert.equal(finishPendingAgainstCurrent({
    store: f.store, reader: f.reader, key: fullKey,
  }).status, 'ACKED');
  const wrong = { ...key, kid: 'k2' };
  claim(f.store, wrong);
  assert.deepEqual(finishPendingAgainstCurrent({
    store: f.store, reader: f.reader, key: wrong,
  }), { status: 'RUN_ID_CONFLICT' });
});

for (const status of ['REJECTED', 'FAILED', 'ABANDONED']) {
  test(status + ' is terminal for an accepted final receipt', t => {
    const f = setup(t, 'content', status);
    claim(f.store);
    assert.deepEqual(finishPendingAgainstCurrent({ store: f.store, reader: f.reader, key }),
      { status: 'RUN_REJECTED' });
  });
}
