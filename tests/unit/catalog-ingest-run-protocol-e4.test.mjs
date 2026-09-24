import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import fs from 'node:fs';
import { canonicalControlJson, compareDec20, computeRunDigestV2, isDec20, parseRunHeader, parseTrailerV2, uint64be, validateAuthoritativeState } from '../../src/catalog/ingest/run-protocol.mjs';

const layer = (name, mode, base = null) => ({ base_watermark: base, layer: name, mode, output_watermark: null, t_high: null, t_low: null });
const header = (overrides = {}) => ({ header: { base_generation_id: 'g1', layers: [layer('taxonomy', 'replace')], run_id: 'r1', run_kind: 'incremental', schema: 'bp.catalog.run-header/1', source_epoch: 'e1', ...overrides } });
const bytes = value => Buffer.from(canonicalControlJson(value));
const current = (overrides = {}) => ({ generationId:'g1', sourceEpoch:'e1',
  layers:{ taxonomy:null, content:'10', commercial:'7', stock:'1000' }, ...overrides });

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
  assert.throws(() => validateAuthoritativeState(parsed, current()), { code:'INGEST_RUN_STATE_MOVED' });
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
  assert.deepEqual(validateAuthoritativeState(parsed, current()), { claimGenerationId:'g1' });
  assert.throws(() => validateAuthoritativeState(parsed, current({generationId:'g2'})), { code:'INGEST_RUN_STATE_MOVED' });
  assert.throws(() => validateAuthoritativeState(parsed, current({sourceEpoch:'e2'})), { code:'INGEST_RUN_SOURCE_EPOCH_CHANGED' });
});

test('authoritative layer cursors bind delta and replacement semantics', () => {
  const make = entry => parseRunHeader(bytes(header({layers:[entry]})), {runId:'r1'});
  const delta = base => ({base_watermark:base,layer:'content',mode:'delta',output_watermark:base === '999' ? '1000' : '12',t_high:base === '999' ? '1000' : '12',t_low:base === '999' ? '900' : '9'});
  assert.deepEqual(validateAuthoritativeState(make(delta('10')), current()), {claimGenerationId:'g1'});
  assert.throws(() => validateAuthoritativeState(make(delta('999')), current()), {code:'INGEST_RUN_STATE_MOVED'});
  const stock = (base, output) => ({base_watermark:base,layer:'stock',mode:'replace',output_watermark:output,t_high:output,t_low:null});
  for (const [base, output] of [[null,'1000'],[null,'1001'],['1000','1000'],['1000','1001']])
    validateAuthoritativeState(make(stock(base, output)), current());
  assert.throws(() => validateAuthoritativeState(make(stock('7','1001')), current()), {code:'INGEST_RUN_STATE_MOVED'});
  assert.throws(() => validateAuthoritativeState(make(stock(null,'999')), current()), {code:'INGEST_RUN_WATERMARK_REGRESSION'});
  assert.throws(() => validateAuthoritativeState(make(stock(null,null)), current()), {code:'INGEST_RUN_WATERMARK_REGRESSION'});
  for (const bad of [{}, {taxonomy:null,content:'10',commercial:'7'},
    {taxonomy:null,content:'10',commercial:'7',stock:'1000',extra:null}])
    assert.throws(() => validateAuthoritativeState(make(delta('10')), current({layers:bad})), {code:'INGEST_RUN_STATE_INVALID'});
});

test('checked-in neutral vectors execute in Node', () => {
  const vectors = JSON.parse(fs.readFileSync(new URL('../fixtures/catalog-run-protocol-v2-vectors.json', import.meta.url)));
  assert.deepEqual(vectors.domain_labels, ['BP-RUN-v2\\0','BP-CHUNK-v2\\0','BP-FINAL-v2\\0']);
  for (const vector of vectors.records) {
    if (vector.kind === 'canonical') {
      assert.equal(canonicalControlJson(vector.structured), vector.expected_utf8, vector.name);
      assert.equal(crypto.createHash('sha256').update(vector.expected_utf8).digest('hex'), vector.sha256, vector.name);
    } else if (vector.kind === 'dec20-valid') assert.equal(isDec20(vector.value), vector.valid, vector.name);
    else if (vector.kind === 'dec20-compare') assert.equal(Math.sign(compareDec20(vector.left, vector.right)), vector.expected, vector.name);
    else if (vector.kind === 'uint64be') {
      if (vector.valid) assert.equal(uint64be(vector.value).toString('hex'), vector.expected_hex, vector.value);
      else assert.throws(() => uint64be(vector.value));
    } else if (vector.kind === 'digest-v2') assert.equal(computeRunDigestV2({headerHash:vector.header_sha256,
      chunkHashes:vector.chunk_hashes,finalSeq:vector.final_seq,count:vector.count}),vector.run_digest,vector.name);
    else if (vector.kind === 'canonical-empty-array-reject') assert.equal(vector.name, 'ambiguous-empty-array');
    else assert.fail(`unknown vector kind: ${vector.kind}`);
  }
});
