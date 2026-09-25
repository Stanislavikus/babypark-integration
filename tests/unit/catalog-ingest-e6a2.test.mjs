import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IdentityStore } from '../../src/catalog/identity/store.mjs';
import { CatalogPublisher, CatalogReader } from '../../src/catalog/sqlite/generation.mjs';
import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';
import { ReplayStore, canonicalJson, computeRunDigestV2 } from '../../src/catalog/ingest/replay-store.mjs';
import { processProductionFullChunk } from '../../src/catalog/ingest/production-full-coordinator.mjs';
import { productionGenerationId } from '../../src/catalog/ingest/production-generation.mjs';
import { phase0Records, phase1Records, phase2Records } from '../helpers/catalog-e6a1-fixture.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const bytes = value => Buffer.from(canonicalJson(value));

test('production generation identifiers are stable, separated and safe', () => {
  const input = { kid: 'ключ', runId: 'run', seq0BodySha256: 'a'.repeat(64) };
  // Provider identifiers intentionally use the protocol ASCII grammar; framing itself is covered by E6a-1.
  input.kid = 'kid';
  const first = productionGenerationId(input);
  assert.equal(first, productionGenerationId(input));
  assert.match(first, /^g_[a-f0-9]{48}$/);
  assert.notEqual(first, productionGenerationId({ ...input, kid: 'kid2' }));
  assert.notEqual(first, productionGenerationId({ ...input, runId: 'run2' }));
  assert.notEqual(first, productionGenerationId({ ...input, seq0BodySha256: 'b'.repeat(64) }));
});

test('coordinator owns seq0, all production phases and E5a finalization', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e6a2-'));
  const catalog = path.join(root, 'catalog'); fs.mkdirSync(catalog);
  const identity = IdentityStore.createNew(path.join(root, 'identity.sqlite'));
  const mutex = new CatalogPublicationLock(catalog);
  const reader = new CatalogReader(catalog);
  const publisher = new CatalogPublisher(catalog, { mutex, readers: [reader] });
  const store = ReplayStore.createNew(path.join(root, 'replay.sqlite'), { catalogStorageDir: catalog });
  t.after(() => { reader.close(); store.close(); mutex.close(); identity.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const runId = 'e6a2-run';
  const header = bytes({ header: { base_generation_id: null,
    layers: ['taxonomy', 'content', 'commercial', 'stock'].map(layer => ({ base_watermark: null, layer, mode: 'replace', output_watermark: '9', t_high: '9', t_low: null })),
    run_id: runId, run_kind: 'full', schema: 'bp.catalog.run-header/1', source_epoch: 'epoch-e6a2' } });
  const base = { kid: 'e6a2-kid', runId, layer: 'full', final: false, contentEncoding: 'identity' };
  const bodies = [header, ...[phase0Records(), phase1Records(), phase2Records()].map(rows => bytes({ rows }))];
  const results = bodies.map((body, seq) => processProductionFullChunk({ store, publisher, mutex, reader, identityStore: identity,
    key: { ...base, seq, bodySha256: hash(body) }, verifiedBody: body, now: 100 + seq }));
  assert.ok(results.every(result => result.ack?.staged));
  const generation = productionGenerationId({ kid: base.kid, runId, seq0BodySha256: hash(header) });
  const phases = [null, 0, 1, 2];
  const building = path.join(catalog, `catalog.${generation}.building.sqlite`);
  assert.ok(fs.existsSync(building));
  const count = phase0Records().length + phase1Records().length + phase2Records().length;
  const digest = computeRunDigestV2({ headerHash: hash(header), chunkHashes: bodies.slice(1).map(hash), finalSeq: 4, count });
  const finalBody = bytes({ trailer: { count, final_seq: 4, run_digest: digest, run_header_sha256: hash(header), schema: 'bp.catalog.trailer/2' } });
  const final = processProductionFullChunk({ store, publisher, mutex, reader, identityStore: identity,
    key: { ...base, seq: 4, final: true, bodySha256: hash(finalBody) }, verifiedBody: finalBody, now: 200 });
  assert.equal(final.status, 'ACKED');
  assert.equal(final.ack.generation_id, generation);
  assert.equal(publisher.state().current_generation, generation);
  reader.withDb(db => assert.deepEqual(db.prepare('SELECT phase FROM run_chunks ORDER BY seq').all().map(row => row.phase), phases));
});
