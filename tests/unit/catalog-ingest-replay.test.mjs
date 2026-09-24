import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReplayStore, computeRunDigest } from '../../src/catalog/ingest/replay-store.mjs';

const digest = 'c'.repeat(64);
const body = Buffer.from(JSON.stringify({ trailer: {
  run_digest: digest, base_generation_id: 'g_1', base_watermark: 'W1',
  count: 1, final_seq: 1,
} }));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const key = { kid: 'k1', runId: 'run_1', layer: 'content', seq: 1,
  bodySha256: hash(body), final: true, contentEncoding: 'identity' };
const evidence = { generationId: 'g_2', runDigest: digest, accepted: true,
  sourceWatermark: 'W2' };
const ack = { accepted: true, generation_id: 'g_2', layer: 'content',
  run_id: 'run_1', run_digest: digest, source_watermark: 'W2' };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-ingest-replay-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'ingest-replay.sqlite');
}
function code(value) {
  return error => error?.name === 'ReplayStoreError' && error.code === value;
}
function claim(store, target = key, time = 100) {
  return store.claim(target, time, { verifiedBody: body, claimGenerationId: 'g_1' });
}

test('final trailer and canonical ACK survive restart and bind accepted evidence', t => {
  const file = fixture(t);
  assert.throws(() => ReplayStore.openExisting(file), code('INGEST_REPLAY_MISSING'));
  let store = ReplayStore.createNew(file);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const first = claim(store);
  assert.equal(first.status, 'NEW');
  assert.deepEqual(claim(store, key, 101), { status: 'PENDING', leaseUntil: 160 });
  assert.deepEqual(store.getClaimedFinal(key), {
    runDigest: digest, count: 1, baseGenerationId: 'g_1', baseWatermark: 'W1',
    claimGenerationId: 'g_1',
  });
  assert.deepEqual(store.complete(key, ack, evidence, first.claimToken), ack);
  store.close();

  store = ReplayStore.openExisting(file);
  assert.deepEqual(claim(store), { status: 'ACK_RECORDED' });
  assert.deepEqual(store.resolveAck(key, evidence), { status: 'ACKED', ack });
  assert.deepEqual(store.resolveAck(key, null), { status: 'RUN_SUPERSEDED' });
  assert.throws(() => store.resolveAck(key, { ...evidence, runDigest: 'd'.repeat(64) }),
    code('INGEST_REPLAY_CONFLICT'));
  assert.deepEqual(store.complete(key, { ...ack }, evidence), ack);
  assert.throws(() => store.complete(key, { ...ack, generation_id: 'gX' }, evidence),
    code('INGEST_REPLAY_ACK_INVALID'));
  assert.throws(() => store.complete(key, ack, { ...evidence, runDigest: 'e'.repeat(64) }),
    code('INGEST_REPLAY_ACK_INVALID'));
  store.close();
});

test('final claim rejects unbound body; final takeover fails closed', t => {
  const store = ReplayStore.createNew(fixture(t));
  t.after(() => store.close());
  assert.throws(() => store.claim(key), code('INGEST_REPLAY_TRAILER_INVALID'));
  assert.throws(() => store.claim(key, 100, {
    verifiedBody: Buffer.from('changed'), claimGenerationId: 'g_1',
  }), code('INGEST_REPLAY_TRAILER_INVALID'));
  assert.equal(claim(store).status, 'NEW');
  assert.throws(() => store.takeover(key, { now: 161, expectedLeaseUntil: 160 }),
    code('INGEST_REPLAY_STATE_REQUIRED'));
  assert.deepEqual(claim(store), { status: 'PENDING', leaseUntil: 160 });
});

test('nonfinal staging is durable, CURRENT independent and token fenced', t => {
  const file = fixture(t);
  const chunk = Buffer.from('{"rows":[{"id":"one"}]}');
  const nonfinal = { ...key, seq: 0, final: false, bodySha256: hash(chunk) };
  let store = ReplayStore.createNew(file);
  const first = store.claim(nonfinal, 100);
  store.close();
  store = ReplayStore.openExisting(file);
  assert.deepEqual(store.takeover(nonfinal, { now: 160, expectedLeaseUntil: 160 }),
    { status: 'PENDING', leaseUntil: 160 });
  const second = store.takeover(nonfinal, { now: 161, expectedLeaseUntil: 160 });
  assert.equal(second.status, 'TAKEN_OVER');
  assert.throws(() => store.stage(nonfinal, chunk, first.claimToken),
    code('INGEST_REPLAY_OWNER_LOST'));
  const stagedAck = { staged: true, run_id: 'run_1', layer: 'content',
    seq: 0, body_sha256: hash(chunk) };
  assert.deepEqual(store.stage(nonfinal, chunk, second.claimToken), stagedAck);
  store.close();
  store = ReplayStore.openExisting(file);
  assert.deepEqual(store.claim(nonfinal), { status: 'STAGED_RECORDED' });
  assert.deepEqual(store.resolveStagedAck(nonfinal),
    { status: 'STAGED', ack: stagedAck });
  assert.deepEqual(store.stage(nonfinal, chunk, first.claimToken), stagedAck);
  store.close();
});

test('capacity and file permissions fail closed', t => {
  const file = fixture(t);
  const store = ReplayStore.createNew(file, { maxReceipts: 1 });
  claim(store);
  assert.throws(() => store.claim({ ...key, runId: 'other', final: false }),
    code('INGEST_REPLAY_CAPACITY'));
  store.close();
  fs.chmodSync(file, 0o644);
  assert.throws(() => ReplayStore.openExisting(file),
    code('INGEST_REPLAY_PERMISSIONS'));
});

test('digest chain binds staged body, base and final count', t => {
  const store = ReplayStore.createNew(fixture(t));
  t.after(() => store.close());
  const chunk = Buffer.from('{"rows":[{"id":"one"}]}');
  const stagedKey = { ...key, seq: 0, final: false, bodySha256: hash(chunk) };
  const stageClaim = store.claim(stagedKey);
  store.stage(stagedKey, chunk, stageClaim.claimToken);
  const runDigest = computeRunDigest({
    runId: key.runId, layer: key.layer, baseGenerationId: 'g_1',
    baseWatermark: 'W1', count: 1, chunkHashes: [hash(chunk)],
  });
  const finalBody = Buffer.from(JSON.stringify({ trailer: {
    run_digest: runDigest, base_generation_id: 'g_1',
    base_watermark: 'W1', count: 1, final_seq: 1,
  } }));
  const finalKey = { ...key, bodySha256: hash(finalBody) };
  store.claim(finalKey, 100, { verifiedBody: finalBody, claimGenerationId: 'g_1' });
  assert.equal(store.verifyClaimedRunDigest(finalKey), runDigest);
  const wrongBody = Buffer.from(JSON.stringify({ trailer: {
    run_digest: 'e'.repeat(64), base_generation_id: 'g_1',
    base_watermark: 'W1', count: 1, final_seq: 1,
  } }));
  const wrongKey = { ...finalKey, kid: 'k2', bodySha256: hash(wrongBody) };
  store.claim(wrongKey, 100, { verifiedBody: wrongBody, claimGenerationId: 'g_1' });
  assert.throws(() => store.verifyClaimedRunDigest(wrongKey),
    code('INGEST_REPLAY_DIGEST_MISMATCH'));
});

test('publication journal is monotonic across restart and pointer windows', t => {
  const file = fixture(t);
  let store = ReplayStore.createNew(file);
  assert.equal(store.recordPublication('g_2', 'run_1', 'intent', 1), 'intent');
  store.close();
  store = ReplayStore.openExisting(file);
  assert.deepEqual(store.publication('g_2'), { runId: 'run_1', state: 'intent' });
  assert.equal(store.recordPublication('g_2', 'run_1', 'switched', 2), 'switched');
  assert.equal(store.recordPublication('g_2', 'run_1', 'rolled_back', 3), 'rolled_back');
  assert.throws(() => store.recordPublication('g_2', 'run_1', 'intent', 4),
    code('INGEST_REPLAY_PUBLICATION_CONFLICT'));
  assert.throws(() => store.recordPublication('g_2', 'different', 'rolled_back', 4),
    code('INGEST_REPLAY_PUBLICATION_CONFLICT'));
  // Crash after CURRENT switch but before the switched marker leaves intent;
  // rollback must still be able to record its marker first.
  store.recordPublication('g_3', 'run_2', 'intent', 1);
  assert.equal(store.recordPublication('g_3', 'run_2', 'rolled_back', 2), 'rolled_back');
  store.close();
});
