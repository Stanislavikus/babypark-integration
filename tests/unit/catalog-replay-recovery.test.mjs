import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { IdentityStore } from '../../src/catalog/identity/store.mjs';
import { ReplayStore, canonicalJson } from '../../src/catalog/ingest/replay-store.mjs';
import { processProductionFullChunk } from '../../src/catalog/ingest/production-full-coordinator.mjs';
import { computeRunDigestV2 } from '../../src/catalog/ingest/run-protocol.mjs';
import { CatalogPublisher, CatalogReader } from '../../src/catalog/sqlite/generation.mjs';
import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';
import { openCatalogHttpRuntime } from '../../src/catalog/http/runtime.mjs';
import { readRecoveryAuthority, recoverReplay } from '../../src/catalog/recovery/core.mjs';
import { phase0Records, phase1Records, phase2Records } from '../helpers/catalog-e6a1-fixture.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const rowsBody = rows => Buffer.from(canonicalJson({ rows }));

function runFull(env, { runId, kid, sourceEpoch, baseGenerationId, baseWatermark, outputWatermark,
  final = true }) {
  const headerBody = Buffer.from(canonicalJson({ header: {
    base_generation_id: baseGenerationId,
    layers: ['taxonomy', 'content', 'commercial', 'stock'].map(layer => ({
      base_watermark: baseWatermark, layer, mode: 'replace', output_watermark: outputWatermark,
      t_high: outputWatermark, t_low: null,
    })), run_id: runId, run_kind: 'full', schema: 'bp.catalog.run-header/1', source_epoch: sourceEpoch,
  } }));
  const base = { kid, runId, layer: 'full', final: false, contentEncoding: 'identity' };
  const chunks = [headerBody, rowsBody(phase0Records()), rowsBody(phase1Records()), rowsBody(phase2Records())];
  for (let seq = 0; seq < chunks.length; seq += 1) {
    const body = chunks[seq];
    const result = processProductionFullChunk({ ...env, key: { ...base, seq, bodySha256: hash(body) },
      verifiedBody: body, now: 1_800_000_000 + seq });
    assert.ok(['COMMITTED', 'STAGED_RECORDED'].includes(result.status));
    if (!final && seq === 2) return { status: 'PARTIAL' };
  }
  const count = phase0Records().length + phase1Records().length + phase2Records().length;
  const digest = computeRunDigestV2({ headerHash: hash(headerBody),
    chunkHashes: chunks.slice(1).map(hash), finalSeq: 4, count });
  const trailer = Buffer.from(canonicalJson({ trailer: { count, final_seq: 4, run_digest: digest,
    run_header_sha256: hash(headerBody), schema: 'bp.catalog.trailer/2' } }));
  const result = processProductionFullChunk({ ...env,
    key: { ...base, seq: 4, final: true, bodySha256: hash(trailer) }, verifiedBody: trailer,
    now: 1_800_000_010 });
  return { ...result, digest };
}

test('R1-R8 replay loss preserves CURRENT, classifies, abandons partial work, and accepts a new FULL', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-replay-recovery-'));
  const catalog = path.join(root, 'catalog'); fs.mkdirSync(catalog, { mode: 0o700 });
  const identityPath = path.join(root, 'identity.sqlite');
  const identity = IdentityStore.createNew(identityPath);
  const mutex = new CatalogPublicationLock(catalog); const reader = new CatalogReader(catalog);
  const publisher = new CatalogPublisher(catalog, { mutex, readers: [reader] });
  const oldPath = path.join(root, 'replay-old.sqlite');
  let store = ReplayStore.createNew(oldPath, { catalogStorageDir: catalog });
  try {
    const env = { store, publisher, mutex, reader, identityStore: identity };
    const a = runFull(env, { runId: 'run-A', kid: 'kid-A', sourceEpoch: 'epoch-A',
      baseGenerationId: null, baseWatermark: null, outputWatermark: '9' });
    assert.equal(a.status, 'ACKED'); // R1
    const authorityA = readRecoveryAuthority(reader);
    assert.equal(authorityA.acceptedRun.run_digest, a.digest);

    runFull(env, { runId: 'run-B', kid: 'kid-B', sourceEpoch: 'epoch-A',
      baseGenerationId: authorityA.currentGeneration, baseWatermark: '9', outputWatermark: '10', final: false });
    const orphan = fs.readdirSync(catalog).find(name => name.endsWith('.building.sqlite'));
    assert.ok(orphan); // Partial B performed the real mapper/building flow.
    identity.setConfigHash('replay-loss-ahead', 'f'.repeat(64));
    assert.ok(identity.metadata().revision > authorityA.publishedIdentityRevision); // R3/R5/R6
    assert.equal(readRecoveryAuthority(reader).acceptedRun.run_id, 'run-A');

    store.close(); store = null;
    const newPath = path.join(root, 'replay-new.sqlite');
    const recovered = recoverReplay({ newReplayPath: newPath, catalogStorageDir: catalog,
      authority: readRecoveryAuthority(reader), lastRunId: 'run-A', lastRunDigest: a.digest });
    assert.equal(recovered.classification, 'ACCEPTED_LOST_RESPONSE'); // R2
    assert.ok(fs.existsSync(path.join(catalog, orphan))); // R6
    assert.throws(() => recoverReplay({ newReplayPath: newPath, catalogStorageDir: catalog,
      authority: authorityA }), /absent/); // R8

    store = ReplayStore.openExisting(newPath, { catalogStorageDir: catalog });
    const c = runFull({ store, publisher, mutex, reader, identityStore: identity }, {
      runId: 'run-C', kid: 'kid-C', sourceEpoch: 'epoch-A', baseGenerationId: authorityA.currentGeneration,
      baseWatermark: '9', outputWatermark: '11' });
    assert.equal(c.status, 'ACKED'); // R4

    const missing = path.join(root, 'missing-replay.sqlite');
    assert.throws(() => openCatalogHttpRuntime({ identityPath, replayPath: missing, storageDir: catalog,
      ingestEnabled: false }, { logger: { info() {}, error() {} } }), /bootstrapped/); // R7
    assert.equal(fs.existsSync(missing), false);
  } finally {
    try { store?.close(); } catch {} reader.close(); mutex.close(); identity.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
