import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import fs from 'node:fs';
import { canonicalControlJson, compareDec20, computeRunDigestV2, parseRunHeader, parseTrailerV2, validateAuthoritativeState } from '../../src/catalog/ingest/run-protocol.mjs';

const layer = (name, mode, base = null) => ({ base_watermark: base, layer: name, mode, output_watermark: null, t_high: null, t_low: null });
const header = (overrides = {}) => ({ header: { base_generation_id: 'g1', layers: [layer('taxonomy', 'replace')], run_id: 'r1', run_kind: 'incremental', schema: 'bp.catalog.run-header/1', source_epoch: 'e1', ...overrides } });
const bytes = value => Buffer.from(canonicalControlJson(value));

test('DEC20 compares all twenty digits without Number coercion', () => {
  assert.equal(compareDec20('9999999999999999999', '10000000000000000000'), -1);
  assert.throws(() => compareDec20('01', '1'), { code: 'INGEST_RUN_DEC20_INVALID' });
  assert.throws(() => compareDec20('100000000000000000000', '1'), { code: 'INGEST_RUN_DEC20_INVALID' });
});

test('single-layer matrix accepts only frozen combinations', () => {
  for (const [name, mode] of [['taxonomy','replace'], ['stock','replace']]) parseRunHeader(bytes(header({ layers: [layer(name, mode)] })), { runId: 'r1' });
  for (const name of ['content', 'commercial']) {
    const delta = { base_watermark:'100', layer:name, mode:'delta', output_watermark:'150', t_high:'150', t_low:'95' };
    parseRunHeader(bytes(header({ layers:[delta] })), { runId:'r1' });
  }
  for (const [name, mode] of [['taxonomy','delta'], ['stock','delta'], ['content','replace'], ['commercial','replace']])
    assert.throws(() => parseRunHeader(bytes(header({ layers:[layer(name, mode)] })), { runId:'r1' }));
});

test('full bootstrap and exact ordered layers are accepted', () => {
  const layers = ['taxonomy','content','commercial','stock'].map(name => layer(name, 'replace'));
  const parsed = parseRunHeader(bytes(header({ base_generation_id:null, run_kind:'full', layers })), { runId:'r1' });
  assert.deepEqual(validateAuthoritativeState(parsed, null), { claimGenerationId:null });
  assert.throws(() => validateAuthoritativeState(parsed, { generationId:'g1', sourceEpoch:'e1' }), { code:'INGEST_RUN_STATE_MOVED' });
  assert.throws(() => parseRunHeader(bytes(header({ base_generation_id:null })), { runId:'r1' }));
});

test('canonical header rejects whitespace, reordered text, BOM, duplicate keys, and wrong run id', () => {
  const canonical = bytes(header());
  parseRunHeader(canonical, { runId:'r1' });
  for (const bad of [Buffer.concat([Buffer.from(' '), canonical]), Buffer.concat([Buffer.from([0xef,0xbb,0xbf]), canonical]), Buffer.concat([canonical, Buffer.from('\n')]), Buffer.from('{"header":{},"header":{}}')])
    assert.throws(() => parseRunHeader(bad, { runId:'r1' }));
  assert.throws(() => parseRunHeader(canonical, { runId:'other' }));
});

test('trailer v2 and digest v2 cover zero, one, and multiple data chunks', () => {
  const hh = crypto.createHash('sha256').update(bytes(header())).digest('hex');
  for (const hashes of [[], ['00'.repeat(32)], ['00'.repeat(32), 'ff'.repeat(32)]]) {
    const digest = computeRunDigestV2({ headerHash:hh, chunkHashes:hashes, finalSeq:hashes.length + 1, count:hashes.length });
    const trailer = { trailer:{ count:hashes.length, final_seq:hashes.length + 1, run_digest:digest, run_header_sha256:hh, schema:'bp.catalog.trailer/2' } };
    assert.equal(parseTrailerV2(bytes(trailer), { seq:hashes.length + 1 }).run_digest, digest);
  }
  assert.throws(() => parseTrailerV2(bytes({ trailer:{ count:0, final_seq:0, run_digest:'00'.repeat(32), run_header_sha256:hh, schema:'bp.catalog.trailer/2' } }), { seq:0 }));
});

test('authoritative source epoch and generation are enforced', () => {
  const parsed = parseRunHeader(bytes(header()), { runId:'r1' });
  assert.deepEqual(validateAuthoritativeState(parsed, { generationId:'g1', sourceEpoch:'e1' }), { claimGenerationId:'g1' });
  assert.throws(() => validateAuthoritativeState(parsed, { generationId:'g2', sourceEpoch:'e1' }), { code:'INGEST_RUN_STATE_MOVED' });
  assert.throws(() => validateAuthoritativeState(parsed, { generationId:'g1', sourceEpoch:'e2' }), { code:'INGEST_RUN_SOURCE_EPOCH_CHANGED' });
});

test('checked-in neutral digest vectors match Node', () => {
  const vectors = JSON.parse(fs.readFileSync(new URL('../fixtures/catalog-run-protocol-v2-vectors.json', import.meta.url)));
  assert.deepEqual(vectors.domain_labels, ['BP-RUN-v2\\0','BP-CHUNK-v2\\0','BP-FINAL-v2\\0']);
  for (const vector of vectors.accepted_digests) {
    assert.equal(computeRunDigestV2({ headerHash:vector.header_sha256,
      chunkHashes:vector.chunk_hashes, finalSeq:vector.final_seq, count:vector.count }),
    vector.run_digest, vector.name);
  }
});
