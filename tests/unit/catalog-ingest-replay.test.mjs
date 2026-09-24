import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  ReplayStore, computeRunDigest, canonicalJson,
} from '../../src/catalog/ingest/replay-store.mjs';
import {
  CatalogGenerationBuilder, CatalogPublisher, CatalogReader,
} from '../../src/catalog/sqlite/generation.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const digest = 'c'.repeat(64);
const trailer = {
  run_digest: digest, base_generation_id: 'g_1', base_watermark: '10',
  count: 1, final_seq: 1,
};
const body = Buffer.from(canonicalJson({ trailer }));
const key = { kid: 'k1', runId: 'run_1', layer: 'content', seq: 1,
  bodySha256: hash(body), final: true, contentEncoding: 'identity' };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-ingest-replay-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const builder = CatalogGenerationBuilder.create({
    storageDir: dir, generationId: 'g_1', sourceEpoch: 'epoch-1',
    identityRevision: 0,
  });
  builder.seal();
  new CatalogPublisher(dir).publish('g_1');
  const reader = new CatalogReader(dir);
  t.after(() => reader.close());
  return { file: path.join(dir, 'ingest-replay.sqlite'), reader, dir };
}
function code(value) {
  return error => error?.name === 'ReplayStoreError' && error.code === value;
}
function claim(store, reader, target = key, verifiedBody = body, time = 100) {
  return store.claim(target, time, { verifiedBody, reader });
}

test('final trailer is immutable and claim generation comes from CURRENT', t => {
  const { file, reader } = fixture(t);
  assert.throws(() => ReplayStore.openExisting(file), code('INGEST_REPLAY_MISSING'));
  let store = ReplayStore.createNew(file);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(claim(store, reader).status, 'NEW');
  assert.deepEqual(claim(store, reader, key, body, 101),
    { status: 'PENDING', leaseUntil: 160 });
  assert.deepEqual(store.getClaimedFinal(key), {
    runDigest: digest, count: 1, baseGenerationId: 'g_1',
    baseWatermark: '10', claimGenerationId: 'g_1',
  });
  assert.equal(typeof store.complete, 'undefined');
  assert.equal(typeof store.resolveAck, 'undefined');
  assert.equal(typeof store.finishFromCurrentEvidence, 'undefined');
  store.close();
  store = ReplayStore.openExisting(file);
  assert.deepEqual(claim(store, reader), { status: 'PENDING', leaseUntil: 160 });
  store.close();
});

test('noncanonical, duplicate, surplus and nondecimal trailers fail closed', t => {
  const { file, reader } = fixture(t);
  const store = ReplayStore.createNew(file);
  t.after(() => store.close());
  const bad = [
    JSON.stringify({ trailer }),
    '{"trailer":{"base_generation_id":"g_1","base_watermark":"10","count":1,"final_seq":1,"run_digest":"' + digest + '","rows":[]}}',
    '{"trailer":{"base_generation_id":"g_1","base_watermark":"10","count":1,"final_seq":1,"run_digest":"' + digest + '","run_digest":"' + digest + '"}}',
    canonicalJson({ trailer: { ...trailer, base_watermark: '010' } }),
  ];
  for (const [i, raw] of bad.entries()) {
    const bytes = Buffer.from(raw);
    assert.throws(() => claim(store, reader, { ...key, seq: 1,
      runId: 'bad_' + i, bodySha256: hash(bytes) }, bytes),
    code('INGEST_REPLAY_TRAILER_INVALID'));
  }
  assert.throws(() => claim(store, reader, key, Buffer.from('changed')),
    code('INGEST_REPLAY_TRAILER_INVALID'));
  assert.throws(() => store.claim(key, 100, { verifiedBody: body,
    claimGenerationId: 'not-the-current-generation' }),
  code('INGEST_REPLAY_STATE_REQUIRED'));
});

test('a run_id cannot cross kid or layer; final takeover fails closed', t => {
  const { file, reader } = fixture(t);
  const store = ReplayStore.createNew(file);
  t.after(() => store.close());
  claim(store, reader);
  assert.throws(() => claim(store, reader, { ...key, kid: 'k2' }),
    code('INGEST_REPLAY_CONFLICT'));
  assert.throws(() => claim(store, reader, { ...key, layer: 'stock' }),
    code('INGEST_REPLAY_CONFLICT'));
  assert.throws(() => store.takeover(key, { now: 161, expectedLeaseUntil: 160 }),
    code('INGEST_REPLAY_STATE_REQUIRED'));
});

test('nonfinal staging survives restart and owner token is fenced', t => {
  const { file } = fixture(t);
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
  store.close();
});

test('digest uses only exact kid and returns PKs for apply', t => {
  const { file, reader } = fixture(t);
  const store = ReplayStore.createNew(file);
  t.after(() => store.close());
  const chunk = Buffer.from('{"rows":[{"id":"one"}]}');
  const stagedKey = { ...key, seq: 0, final: false, bodySha256: hash(chunk) };
  const first = store.claim(stagedKey);
  store.stage(stagedKey, chunk, first.claimToken);
  const runDigest = computeRunDigest({
    runId: key.runId, layer: key.layer, baseGenerationId: 'g_1',
    baseWatermark: '10', count: 1, chunkHashes: [hash(chunk)],
  });
  const finalBody = Buffer.from(canonicalJson({ trailer: {
    ...trailer, run_digest: runDigest,
  } }));
  const finalKey = { ...key, bodySha256: hash(finalBody) };
  claim(store, reader, finalKey, finalBody);
  assert.deepEqual(store.verifyClaimedRunDigest(finalKey), {
    runDigest, chunkKeys: [{ kid: 'k1', runId: 'run_1', layer: 'content', seq: 0 }],
  });
  // Even a manually inserted row under another kid cannot affect this proof.
  store.db.prepare(
    "INSERT INTO receipts(kid,run_id,layer,seq,body_sha256,final,content_encoding,status,ack_json,staged_body,created_at) " +
    "VALUES('k2','run_1','content',0,?,0,'identity','staged','{}',?,1)"
  ).run('e'.repeat(64), Buffer.from('other'));
  assert.equal(store.verifyClaimedRunDigest(finalKey).runDigest, runDigest);
});

test('incremental byte budget rejects before storing the next chunk', t => {
  const { file } = fixture(t);
  const store = ReplayStore.createNew(file);
  t.after(() => store.close());
  for (let seq = 0; seq < 9; seq += 1) {
    const bytes = Buffer.alloc(1024 * 1024, seq);
    const chunk = { ...key, seq, final: false, bodySha256: hash(bytes) };
    const c = store.claim(chunk);
    if (seq < 8) store.stage(chunk, bytes, c.claimToken);
    else assert.throws(() => store.stage(chunk, bytes, c.claimToken),
      code('INGEST_REPLAY_STAGING_CAPACITY'));
  }
  assert.equal(store.db.prepare(
    "SELECT COALESCE(SUM(length(staged_body)),0) AS bytes FROM receipts"
  ).get().bytes, 8 * 1024 * 1024);
});

test('full staged receipt stores hash only after building-file authority', t => {
  const { file, reader, dir } = fixture(t);
  const builder = CatalogGenerationBuilder.create({
    storageDir: dir, generationId: 'g_2', sourceEpoch: 'epoch-1',
    identityRevision: 0,
  });
  t.after(() => { try { builder.db.close(); } catch {} });
  const bytes = Buffer.from('{"rows":[{"id":"one"}]}');
  const chunk = { ...key, layer: 'full', seq: 0, final: false, bodySha256: hash(bytes) };
  const store = ReplayStore.createNew(file);
  t.after(() => store.close());
  const c = store.claim(chunk);
  assert.throws(() => store.stage(chunk, bytes, c.claimToken, { fullBuildDb: builder.db }),
    code('INGEST_REPLAY_STAGING_INVALID'));
  builder.db.prepare(
    'INSERT INTO run_chunks(run_id,kid,seq,body_sha256) VALUES(?,?,?,?)'
  ).run(chunk.runId, chunk.kid, chunk.seq, chunk.bodySha256);
  store.stage(chunk, bytes, c.claimToken, { fullBuildDb: builder.db });
  assert.equal(store.db.prepare(
    "SELECT staged_body IS NULL AS absent FROM receipts WHERE run_id=?"
  ).get(chunk.runId).absent, 1);
  assert.equal(store.resolveStagedAck(chunk, { fullBuildDb: builder.db }).status,
    'STAGED');
  assert.throws(() => store.resolveStagedAck(chunk),
    code('INGEST_REPLAY_STAGING_INVALID'));
  const runDigest = computeRunDigest({
    runId: key.runId, layer: 'full', baseGenerationId: 'g_1',
    baseWatermark: '10', count: 1, chunkHashes: [hash(bytes)],
  });
  const finalBody = Buffer.from(canonicalJson({ trailer: {
    ...trailer, run_digest: runDigest,
  } }));
  const final = { ...key, layer: 'full', bodySha256: hash(finalBody) };
  claim(store, reader, final, finalBody);
  assert.equal(store.verifyClaimedRunDigest(final, { fullBuildDb: builder.db }).runDigest,
    runDigest);
});

test('publication journal is monotonic and records history', t => {
  const { file } = fixture(t);
  let store = ReplayStore.createNew(file);
  store.recordPublication('g_2', 'run_1', 'intent', 1);
  store.close();
  store = ReplayStore.openExisting(file);
  assert.deepEqual(store.publication('g_2'), { runId: 'run_1', state: 'intent' });
  store.recordPublication('g_2', 'run_1', 'switched', 2);
  store.recordPublication('g_2', 'run_1', 'rolled_back', 3);
  assert.throws(() => store.recordPublication('g_2', 'run_1', 'switched', 4),
    code('INGEST_REPLAY_PUBLICATION_CONFLICT'));
  store.recordPublication('g_3', 'run_2', 'intent', 1);
  store.recordPublication('g_3', 'run_2', 'rolled_back', 2);
  store.close();
});

async function killAtFailpoint(mode, file, key) {
  const child = spawn(process.execPath, [
    new URL('../fixtures/catalog-replay-crash-worker.mjs', import.meta.url).pathname,
    mode, file, JSON.stringify(key),
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', data => { stderr += data; });
  let timer;
  try {
    const marker = await Promise.race([
      new Promise((resolve, reject) => {
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', data => {
          if (data.includes('FAILPOINT:' + mode)) resolve(true);
        });
        child.on('error', reject);
        child.on('exit', code => reject(new Error('Worker exited ' + code + ': ' + stderr)));
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Failpoint timeout')), 5000);
      }),
    ]);
    assert.equal(marker, true);
  } finally {
    clearTimeout(timer);
  }
  child.kill('SIGKILL');
  const [code, signal] = await once(child, 'exit');
  assert.equal(code, null);
  assert.equal(signal, 'SIGKILL');
}

test('SIGKILL releases claim owner; restarted boot ID and lease fence survive', async t => {
  const { file } = fixture(t);
  const bytes = Buffer.from('{"rows":[{"id":"one"}]}');
  const nonfinal = { ...key, final: false, seq: 0, bodySha256: hash(bytes) };
  let store = ReplayStore.createNew(file);
  store.close();
  await killAtFailpoint('after_claim', file, nonfinal);
  store = ReplayStore.openExisting(file);
  const firstBoot = store.db.prepare(
    'SELECT owner_boot_id FROM receipts WHERE run_id=?'
  ).get(nonfinal.runId).owner_boot_id;
  store.close();
  await killAtFailpoint('after_takeover', file, nonfinal);
  store = ReplayStore.openExisting(file);
  const row = store.db.prepare(
    'SELECT owner_boot_id, lease_until FROM receipts WHERE run_id=?'
  ).get(nonfinal.runId);
  assert.notEqual(row.owner_boot_id, firstBoot);
  assert.equal(row.lease_until, 221);
  const finalOwner = store.takeover(nonfinal, {
    now: 222, expectedLeaseUntil: 221,
  });
  assert.equal(finalOwner.status, 'TAKEN_OVER');
  store.stage(nonfinal, bytes, finalOwner.claimToken);
  store.close();
  store = ReplayStore.openExisting(file);
  assert.equal(store.resolveStagedAck(nonfinal).status, 'STAGED');
  store.close();
});
