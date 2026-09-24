import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReplayStore } from '../../src/catalog/ingest/replay-store.mjs';

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const key = { kid: 'k1', runId: 'run_1', layer: 'content',
  seq: 0, bodySha256: hashA, final: true, contentEncoding: 'identity' };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-ingest-replay-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'ingest-replay.sqlite');
}
function code(value) {
  return error => error?.name === 'ReplayStoreError' && error.code === value;
}

test('claim and ACK survive restart; duplicate returns exact saved ACK', t => {
  const file = fixture(t);
  assert.throws(() => ReplayStore.openExisting(file),
    code('INGEST_REPLAY_MISSING'));
  const store = ReplayStore.createNew(file);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(store.claim(key, 1780000000), { status: 'NEW' });
  assert.deepEqual(store.claim(key, 1780000001), { status: 'PENDING' });
  const ack = { accepted: true, generation: 'g_1', watermark: 42 };
  assert.deepEqual(store.complete(key, ack), ack);
  store.close();

  const reopened = ReplayStore.openExisting(file);
  assert.deepEqual(reopened.claim(key), { status: 'ACKED', ack });
  assert.deepEqual(reopened.complete(key, ack), ack);
  assert.throws(() => reopened.complete(key, { accepted: false }),
    code('INGEST_REPLAY_ACK_CONFLICT'));
  reopened.close();
});

test('same key with different signed body fails even after ACK', t => {
  const file = fixture(t);
  const store = ReplayStore.createNew(file);
  assert.deepEqual(store.claim(key), { status: 'NEW' });
  assert.throws(() => store.claim({ ...key, bodySha256: hashB }),
    code('INGEST_REPLAY_CONFLICT'));
  assert.throws(() => store.claim({ ...key, final: false }),
    code('INGEST_REPLAY_CONFLICT'));
  store.complete(key, { accepted: true });
  assert.throws(() => store.claim({ ...key, bodySha256: hashB }),
    code('INGEST_REPLAY_CONFLICT'));
  store.close();
});

test('interrupted pending claim stays pending instead of executing twice', t => {
  const file = fixture(t);
  let store = ReplayStore.createNew(file);
  store.claim(key);
  store.close();
  store = ReplayStore.openExisting(file);
  assert.deepEqual(store.claim(key), { status: 'PENDING' });
  assert.throws(() => store.complete({ ...key, bodySha256: hashB },
    { accepted: true }), code('INGEST_REPLAY_CONFLICT'));
  assert.deepEqual(store.claim({ ...key, seq: 1 }), { status: 'NEW' });
  store.close();
});

test('invalid receipts and permissive file mode fail closed', t => {
  const file = fixture(t);
  const store = ReplayStore.createNew(file);
  assert.throws(() => store.claim({ ...key, runId: '../bad' }),
    code('INGEST_REPLAY_KEY_INVALID'));
  assert.throws(() => store.complete(key, { accepted: true }),
    code('INGEST_REPLAY_UNCLAIMED'));
  store.claim(key);
  assert.throws(() => store.complete(key, { data: 'x'.repeat(4096) }),
    code('INGEST_REPLAY_ACK_INVALID'));
  store.close();
  fs.chmodSync(file, 0o644);
  assert.throws(() => ReplayStore.openExisting(file),
    code('INGEST_REPLAY_PERMISSIONS'));
});

test('bounded ledger fails closed while preserving duplicate ACKs', t => {
  const file = fixture(t);
  const store = ReplayStore.createNew(file, { maxReceipts: 1 });
  store.claim(key);
  store.complete(key, { accepted: true });
  assert.throws(() => store.claim({ ...key, seq: 1 }),
    code('INGEST_REPLAY_CAPACITY'));
  assert.deepEqual(store.claim(key),
    { status: 'ACKED', ack: { accepted: true } });
  store.close();
});
