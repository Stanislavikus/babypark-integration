import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { CatalogGenerationBuilder, CatalogPublisher, CatalogReader } from '../../src/catalog/sqlite/generation.mjs';
import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';
import { ReplayStore, canonicalJson } from '../../src/catalog/ingest/replay-store.mjs';
import { writeFullChunk } from '../../src/catalog/ingest/full-apply.mjs';
import { finalizeFullRun } from '../../src/catalog/ingest/full-finalize.mjs';
import { computeRunDigestV2 } from '../../src/catalog/ingest/run-protocol.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const code = expected => error => error?.code === expected;

function fixture(t, { runId = 'run1' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e5-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const dir = path.join(root, 'catalog'); fs.mkdirSync(dir);
  const mutex = new CatalogPublicationLock(dir); t.after(() => mutex.close());
  const reader = new CatalogReader(dir); t.after(() => reader.close());
  const publisher = new CatalogPublisher(dir, { mutex, readers:[reader] });
  const store = ReplayStore.createNew(path.join(root, 'replay.sqlite'), { catalogStorageDir:dir });
  t.after(() => store.close());
  const builder = CatalogGenerationBuilder.create({ storageDir:dir, generationId:'target',
    sourceEpoch:'epoch-1', identityRevision:0 });
  const headerBody = Buffer.from(canonicalJson({ header:{ base_generation_id:null,
    layers:['taxonomy','content','commercial','stock'].map(layer => ({ base_watermark:null,
      layer, mode:'replace', output_watermark:'7', t_high:'7', t_low:null })),
    run_id:runId, run_kind:'full', schema:'bp.catalog.run-header/1', source_epoch:'epoch-1' } }));
  const headerKey = { kid:'kid1', runId, layer:'full', seq:0, final:false,
    contentEncoding:'identity', bodySha256:hash(headerBody) };
  const owner = store.claim(headerKey, 100, { verifiedBody:headerBody });
  writeFullChunk({ mutex, store, builder, key:headerKey, verifiedBody:headerBody,
    claimToken:owner.claimToken });
  const data = Buffer.from(canonicalJson({ rows:[{ id:'b1', name:'Brand' }] }));
  const dataKey = { ...headerKey, seq:1, bodySha256:hash(data) };
  const dataOwner = store.claim(dataKey, 101);
  writeFullChunk({ mutex, store, builder, key:dataKey, verifiedBody:data,
    claimToken:dataOwner.claimToken, writeRows(api, rows) { rows.forEach(row => api.insertBrand(row)); return rows.length; } });
  builder.close();
  const digest = computeRunDigestV2({ headerHash:hash(headerBody), chunkHashes:[hash(data)], finalSeq:2, count:1 });
  const finalBody = Buffer.from(canonicalJson({ trailer:{ count:1, final_seq:2, run_digest:digest,
    run_header_sha256:hash(headerBody), schema:'bp.catalog.trailer/2' } }));
  const finalKey = { ...headerKey, seq:2, final:true, bodySha256:hash(finalBody) };
  const descriptorPath = path.join(root, 'worker.json');
  const ledgerPath = path.join(root, 'replay.sqlite');
  fs.writeFileSync(descriptorPath, JSON.stringify({ catalogDir:dir, ledgerPath,
    finalKey, finalBodyBase64:finalBody.toString('base64') }));
  return { root, dir, mutex, reader, publisher, store, finalBody, finalKey, digest,
    descriptorPath, ledgerPath, runId };
}

const workerPath = new URL('../fixtures/catalog-full-finalize-crash-worker.mjs', import.meta.url);

function startWorker(f, mode) {
  return fork(workerPath, [f.descriptorPath, mode], { stdio:['ignore', 'pipe', 'pipe', 'ipc'] });
}

function message(child, event, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`worker timeout waiting for ${event}`)), timeout);
    const receive = value => {
      if (value?.event !== event) return;
      clearTimeout(timer); child.off('message', receive); resolve(value);
    };
    child.on('message', receive);
  });
}

async function killAt(f, mode) {
  const child = startWorker(f, mode);
  const reached = message(child, mode);
  await message(child, 'started');
  await reached;
  child.kill('SIGKILL');
  const [exitCode, signal] = await once(child, 'exit');
  assert.equal(exitCode, null);
  assert.equal(signal, 'SIGKILL');
}

function resume(f, { forbidProof = false } = {}) {
  return finalizeFullRun({ ...f, verifiedFinalBody:f.finalBody,
    now:() => '2026-01-02T03:04:06.000Z', failpoint(name) {
      if (forbidProof && name === 'proof.before') throw new Error('proof-must-not-repeat');
    } });
}

test('E5 FULL bootstrap certifies, seals, publishes, ACKs, and cleans retained bodies', t => {
  const f = fixture(t);
  const ack = finalizeFullRun({ ...f, verifiedFinalBody:f.finalBody, now:() => '2026-01-02T03:04:05.000Z' });
  assert.equal(ack.status, 'ACKED');
  assert.equal(ack.ack.generation_id, 'target');
  assert.equal(ack.ack.run_digest, f.digest);
  assert.equal(f.publisher.state().current_generation, 'target');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM receipts WHERE status='staged_released'").get().n, 2);
  assert.throws(() => f.store.recoverFullRunContext(f.finalKey), code('INGEST_REPLAY_CONTEXT_UNAVAILABLE'));
});

test('E5 resumes PENDING after atomic certification rollback and after committed certification', t => {
  const f = fixture(t);
  assert.throws(() => finalizeFullRun({ ...f, verifiedFinalBody:f.finalBody,
    now:() => '2026-01-02T03:04:05.000Z', failpoint(name) {
      if (name === 'certification.beforeCommit') throw new Error('crash-before-commit');
    } }), /crash-before-commit/);
  const db = CatalogGenerationBuilder.openExisting({ storageDir:f.dir, generationId:'target' });
  assert.equal(db.db.prepare("SELECT COUNT(*) n FROM ingest_runs WHERE run_id='run1'").get().n, 0);
  assert.equal(db.db.prepare("SELECT COUNT(*) n FROM sync_state WHERE last_run_id='run1'").get().n, 0);
  db.close();
  assert.throws(() => finalizeFullRun({ ...f, verifiedFinalBody:f.finalBody,
    now:() => '2026-01-02T03:04:05.000Z', failpoint(name) {
      if (name === 'certification.afterCommit') throw new Error('crash-after-commit');
    } }), /crash-after-commit/);
  const result = finalizeFullRun({ ...f, verifiedFinalBody:f.finalBody,
    now:() => '2026-01-02T03:04:06.000Z', failpoint(name) {
      if (name === 'proof.before') throw new Error('proof-must-not-repeat');
    } });
  assert.equal(result.status, 'ACKED');
});

test('E5 recovers a ready building artifact interrupted before checkpoint', t => {
  const f = fixture(t);
  assert.throws(() => finalizeFullRun({ ...f, verifiedFinalBody:f.finalBody,
    now:() => '2026-01-02T03:04:05.000Z', failpoint(name) {
      if (name === 'seal.afterReady') throw new Error('crash-ready');
    } }), /crash-ready/);
  const result = finalizeFullRun({ ...f, verifiedFinalBody:f.finalBody,
    now:() => '2026-01-02T03:04:06.000Z' });
  assert.equal(result.status, 'ACKED');
  assert.equal(f.publisher.state().current_generation, 'target');
});

test('E5 fails closed when final and building target artifacts both exist', t => {
  const f = fixture(t);
  const building = path.join(f.dir, 'catalog.target.building.sqlite');
  const final = path.join(f.dir, 'catalog.target.sqlite');
  fs.copyFileSync(building, final);
  assert.throws(() => finalizeFullRun({ ...f, verifiedFinalBody:f.finalBody,
    now:() => '2026-01-02T03:04:05.000Z' }), code('FULL_FINALIZE_ARTIFACT_CONFLICT'));
});

test('A: SIGKILL after proof resumes exact PENDING without final takeover', async t => {
  const f = fixture(t);
  await killAt(f, 'proof');
  const pending = f.store.claim(f.finalKey, 200, { verifiedBody:f.finalBody, reader:f.reader });
  assert.equal(pending.status, 'PENDING');
  assert.throws(() => f.store.takeover(f.finalKey, {
    now:pending.leaseUntil + 1, expectedLeaseUntil:pending.leaseUntil,
  }), code('INGEST_REPLAY_STATE_REQUIRED'));
  const result = resume(f);
  assert.equal(result.status, 'ACKED');
  assert.equal(result.ack.run_digest, f.digest);
});

test('A-prime: SIGKILL inside certification transaction rolls every statement back', async t => {
  const f = fixture(t);
  await killAt(f, 'certification-transaction');
  const db = new DatabaseSync(path.join(f.dir, 'catalog.target.building.sqlite'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ingest_runs WHERE run_id=?').get(f.runId).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sync_state WHERE last_run_id=?').get(f.runId).n, 0);
  db.close();
  assert.equal(resume(f).status, 'ACKED');
});

test('B: SIGKILL after certification commit reuses certification without proof', async t => {
  const f = fixture(t);
  await killAt(f, 'certification-commit');
  assert.equal(resume(f, { forbidProof:true }).status, 'ACKED');
});

for (const runId of ['_run1', '-run1']) {
  test(`C/B1: SIGKILL ready building recovers protocol run id ${runId}`, async t => {
    const f = fixture(t, { runId });
    await killAt(f, 'seal-ready');
    assert.equal(resume(f, { forbidProof:true }).status, 'ACKED');
  });
}

test('C-prime: SIGKILL after checkpoint recovers ready building', async t => {
  const f = fixture(t);
  await killAt(f, 'seal-checkpoint');
  assert.equal(resume(f, { forbidProof:true }).status, 'ACKED');
});

test('C-double-prime: SIGKILL after DELETE journal recovers ready building', async t => {
  const f = fixture(t);
  await killAt(f, 'seal-delete');
  assert.equal(resume(f, { forbidProof:true }).status, 'ACKED');
});

test('D: SIGKILL after final rename publishes without repeating proof', async t => {
  const f = fixture(t);
  await killAt(f, 'seal-rename');
  assert.equal(fs.existsSync(path.join(f.dir, 'catalog.target.sqlite')), true);
  assert.equal(fs.existsSync(path.join(f.dir, 'catalog.target.building.sqlite')), false);
  assert.equal(resume(f, { forbidProof:true }).status, 'ACKED');
});

test('E: SIGKILL after publication intent resumes before CURRENT switch', async t => {
  const f = fixture(t);
  await killAt(f, 'publication-intent');
  assert.deepEqual(f.store.publication('target'), { runId:f.runId, state:'intent' });
  assert.equal(fs.existsSync(path.join(f.dir, 'CURRENT')), false);
  assert.equal(resume(f, { forbidProof:true }).status, 'ACKED');
  assert.equal(f.store.publication('target').state, 'switched');
});

test('F: SIGKILL with CURRENT target and intent journal completes switch', async t => {
  const f = fixture(t);
  await killAt(f, 'publication-current');
  assert.equal(f.publisher.state().current_generation, 'target');
  assert.equal(f.store.publication('target').state, 'intent');
  assert.equal(resume(f, { forbidProof:true }).status, 'ACKED');
  assert.equal(f.store.publication('target').state, 'switched');
});

test('G: SIGKILL after switched publication derives pending ACK from CURRENT', async t => {
  const f = fixture(t);
  await killAt(f, 'publication-return');
  assert.equal(f.store.publication('target').state, 'switched');
  assert.equal(f.store.db.prepare('SELECT status FROM receipts WHERE final=1').get().status, 'pending');
  assert.equal(resume(f, { forbidProof:true }).status, 'ACKED');
});

test('H: SIGKILL after ledger ACK cleans bodies on restart', async t => {
  const f = fixture(t);
  await killAt(f, 'ack-recorded');
  assert.equal(f.store.db.prepare('SELECT status FROM receipts WHERE final=1').get().status, 'acked');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM receipts WHERE status='staged'").get().n, 2);
  assert.equal(resume(f, { forbidProof:true }).status, 'ACKED');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM receipts WHERE status='staged_released'").get().n, 2);
});

test('I: SIGKILL after cleanup returns identical CURRENT ACK idempotently', async t => {
  const f = fixture(t);
  await killAt(f, 'cleanup');
  assert.equal(f.store.claim(f.finalKey, 300, { verifiedBody:f.finalBody, reader:f.reader }).status, 'ACK_RECORDED');
  assert.equal(f.store.releaseAcceptedRunBodies(f.finalKey, f.reader).releasedCount, 0);
  const before = f.store.resolveFinalAckAgainstCurrent(f.finalKey, f.reader);
  const after = resume(f, { forbidProof:true });
  assert.deepEqual(after, before);
});

test('J: physical CURRENT absence has PENDING/ABSENT bootstrap semantics after crash', async t => {
  const f = fixture(t);
  assert.equal(fs.existsSync(path.join(f.dir, 'CURRENT')), false);
  await killAt(f, 'claim');
  assert.deepEqual(f.store.resolveFinalAckAgainstCurrent(f.finalKey, f.reader), { status:'PENDING' });
  assert.deepEqual(f.store.finishPendingAgainstCurrent(f.finalKey, f.reader), { status:'PENDING' });
  assert.equal(resume(f).status, 'ACKED');
});

test('K: reader reload failure restores bootstrap pointer and retry reuses target', t => {
  const f = fixture(t);
  const original = f.reader.reloadExpected.bind(f.reader);
  let failed = false;
  f.reader.reloadExpected = (...args) => {
    if (!failed) { failed = true; throw new Error('reader-reload-failure'); }
    return original(...args);
  };
  assert.throws(() => resume(f), /reader-reload-failure/);
  assert.equal(f.publisher.state().current_generation, null);
  assert.equal(fs.existsSync(path.join(f.dir, 'catalog.target.sqlite')), true);
  f.reader.reloadExpected = original;
  assert.equal(resume(f, { forbidProof:true }).status, 'ACKED');
  f.reader.withDb(db => assert.equal(
    db.prepare('SELECT COUNT(*) n FROM ingest_runs WHERE run_id=?').get(f.runId).n, 1
  ));
});

test('M: busy coordinator exits bounded and a fresh process retry reaches ACKED', async t => {
  const f = fixture(t);
  const first = startWorker(f, 'lock-proof');
  await message(first, 'started');
  await message(first, 'lock-proof');
  const second = startWorker(f, 'observe-proof');
  await message(second, 'started');
  const started = performance.now();
  const rejected = await message(second, 'error');
  const elapsed = performance.now() - started;
  assert.equal(rejected.detail.code, 'PUBLICATION_LOCK_BUSY');
  assert.ok(elapsed < 1500, 'busy response took ' + elapsed + 'ms');
  assert.deepEqual(await once(second, 'exit'), [1, null]);
  assert.equal(fs.existsSync(path.join(f.dir, 'catalog.target.sqlite')), false);
  assert.equal(f.store.publication('target'), null);
  const building = new DatabaseSync(path.join(f.dir, 'catalog.target.building.sqlite'));
  assert.equal(building.prepare(
    'SELECT COUNT(*) n FROM ingest_runs WHERE run_id=?'
  ).get(f.runId).n, 0);
  building.close();
  first.kill('SIGKILL');
  assert.deepEqual(await once(first, 'exit'), [null, 'SIGKILL']);
  const retry = startWorker(f, 'observe-proof');
  const entered = message(retry, 'proof-entered');
  const completed = message(retry, 'done');
  await message(retry, 'started');
  await entered;
  const done = await completed;
  assert.equal(done.detail.status, 'ACKED');
  assert.deepEqual(await once(retry, 'exit'), [0, null]);
  f.reader.reloadExpected('target');
  f.reader.withDb(db => assert.equal(
    db.prepare('SELECT COUNT(*) n FROM ingest_runs WHERE run_id=?').get(f.runId).n, 1
  ));
  assert.equal(f.store.publication('target').state, 'switched');
});

test('recovery context rejects mixed generation, missing sequence, and seq0 mismatch', t => {
  for (const mutation of ['mixed', 'missing', 'header']) {
    const f = fixture(t, { runId:`ctx_${mutation}` });
    f.store.claim(f.finalKey, 200, { verifiedBody:f.finalBody, reader:f.reader });
    if (mutation === 'mixed') f.store.db.prepare(
      'UPDATE receipts SET building_generation_id=? WHERE run_id=? AND seq=1'
    ).run('other', f.runId);
    if (mutation === 'missing') f.store.db.prepare(
      'DELETE FROM receipts WHERE run_id=? AND seq=1'
    ).run(f.runId);
    if (mutation === 'header') f.store.db.prepare(
      'UPDATE receipts SET staged_body=? WHERE run_id=? AND seq=0'
    ).run(Buffer.from('bad'), f.runId);
    assert.throws(() => f.store.recoverFullRunContext(f.finalKey));
  }
});

for (const field of ['run_digest', 'final_seq']) {
  test(`certification conflict rejects mismatched ${field}`, t => {
    const f = fixture(t, { runId:`conflict_${field}` });
    assert.throws(() => finalizeFullRun({ ...f, verifiedFinalBody:f.finalBody,
      now:() => '2026-01-02T03:04:05.000Z', failpoint(name) {
        if (name === 'certification.afterCommit') throw new Error('stop-after-certification');
      } }), /stop-after-certification/);
    const db = new DatabaseSync(path.join(f.dir, 'catalog.target.building.sqlite'));
    if (field === 'run_digest') db.prepare('UPDATE ingest_runs SET run_digest=? WHERE run_id=?')
      .run('0'.repeat(64), f.runId);
    else db.prepare('UPDATE ingest_runs SET final_seq=final_seq+1 WHERE run_id=?').run(f.runId);
    db.close();
    assert.throws(() => resume(f), code('FULL_FINALIZE_CERTIFICATION_CONFLICT'));
  });
}
