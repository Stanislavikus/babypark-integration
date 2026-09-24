import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReplayStore } from '../../src/catalog/ingest/replay-store.mjs';

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const evidence = { generationId: 'g_1', runDigest: 'c'.repeat(64), accepted: true };
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
  const claim = store.claim(key, 1780000000);
  assert.equal(claim.status, 'NEW');
  assert.deepEqual(store.claim(key, 1780000001),
    { status: 'PENDING', leaseUntil: 1780000060 });
  const ack = { accepted: true, generation: 'g_1', watermark: 42 };
  assert.deepEqual(store.complete(key, ack, evidence, claim.claimToken), ack);
  store.close();

  const reopened = ReplayStore.openExisting(file);
  assert.deepEqual(reopened.claim(key), { status: 'ACK_RECORDED' });
  assert.deepEqual(reopened.resolveAck(key, evidence), { status: 'ACKED', ack });
  assert.deepEqual(reopened.resolveAck(key, null), { status: 'RUN_SUPERSEDED' });
  assert.deepEqual(reopened.resolveAck(key, { ...evidence, generationId: 'g_0' }),
    { status: 'RUN_SUPERSEDED' });
  assert.throws(() => reopened.resolveAck(key, { ...evidence, runDigest: hashB }),
    code('INGEST_REPLAY_CONFLICT'));
  assert.deepEqual(reopened.complete(key, { watermark: 42, generation: 'g_1', accepted: true }, evidence), ack);
  assert.throws(() => reopened.complete(key, { accepted: false }, evidence),
    code('INGEST_REPLAY_ACK_CONFLICT'));
  reopened.close();
});

test('same key with different signed body fails even after ACK', t => {
  const file = fixture(t);
  const store = ReplayStore.createNew(file);
  const claim = store.claim(key);
  assert.equal(claim.status, 'NEW');
  assert.throws(() => store.claim({ ...key, bodySha256: hashB }),
    code('INGEST_REPLAY_CONFLICT'));
  assert.throws(() => store.claim({ ...key, final: false }),
    code('INGEST_REPLAY_CONFLICT'));
  store.complete(key, { accepted: true }, evidence, claim.claimToken);
  assert.throws(() => store.claim({ ...key, bodySha256: hashB }),
    code('INGEST_REPLAY_CONFLICT'));
  store.close();
});

test('interrupted pending claim stays pending instead of executing twice', t => {
  const file = fixture(t);
  let store = ReplayStore.createNew(file);
  store.claim(key, 100);
  store.close();
  store = ReplayStore.openExisting(file);
  assert.deepEqual(store.claim(key), { status: 'PENDING', leaseUntil: 160 });
  assert.throws(() => store.complete({ ...key, bodySha256: hashB },
    { accepted: true }, evidence), code('INGEST_REPLAY_CONFLICT'));
  assert.equal(store.claim({ ...key, seq: 1 }).status, 'NEW');
  store.close();
});

test('invalid receipts and permissive file mode fail closed', t => {
  const file = fixture(t);
  const store = ReplayStore.createNew(file);
  assert.throws(() => store.claim({ ...key, runId: '../bad' }),
    code('INGEST_REPLAY_KEY_INVALID'));
  assert.throws(() => store.complete(key, { accepted: true }, evidence),
    code('INGEST_REPLAY_UNCLAIMED'));
  store.claim(key);
  assert.throws(() => store.complete(key, { data: 'x'.repeat(4096) }, evidence),
    code('INGEST_REPLAY_ACK_INVALID'));
  store.close();
  fs.chmodSync(file, 0o644);
  assert.throws(() => ReplayStore.openExisting(file),
    code('INGEST_REPLAY_PERMISSIONS'));
});

test('bounded ledger fails closed while preserving duplicate ACKs', t => {
  const file = fixture(t);
  const store = ReplayStore.createNew(file, { maxReceipts: 1 });
  const claim = store.claim(key);
  store.complete(key, { accepted: true }, evidence, claim.claimToken);
  assert.throws(() => store.claim({ ...key, seq: 1 }),
    code('INGEST_REPLAY_CAPACITY'));
  assert.deepEqual(store.claim(key), { status: 'ACK_RECORDED' });
  assert.deepEqual(store.resolveAck(key, evidence),
    { status: 'ACKED', ack: { accepted: true } });
  store.close();
});

test('expired pending claim is fenced on takeover after restart', t => {
  const file = fixture(t);
  let store = ReplayStore.createNew(file);
  const first = store.claim(key, 100);
  store.close();
  store = ReplayStore.openExisting(file);
  assert.deepEqual(store.takeover(key, { now: 160, expectedLeaseUntil: 160 }),
    { status: 'PENDING', leaseUntil: 160 });
  const second = store.takeover(key, { now: 161, expectedLeaseUntil: 160 });
  assert.equal(second.status, 'TAKEN_OVER');
  assert.notEqual(second.claimToken, first.claimToken);
  assert.throws(() => store.complete(key, { accepted: true }, evidence,
    first.claimToken), code('INGEST_REPLAY_OWNER_LOST'));
  assert.deepEqual(store.claim(key), { status: 'PENDING',
    leaseUntil: second.leaseUntil });
  assert.deepEqual(store.complete(key, { accepted: true }, evidence,
    second.claimToken), { accepted: true });
  assert.deepEqual(store.takeover(key, {
    now: 300, expectedLeaseUntil: second.leaseUntil,
  }), { status: 'ACK_RECORDED' });
  store.close();
});
