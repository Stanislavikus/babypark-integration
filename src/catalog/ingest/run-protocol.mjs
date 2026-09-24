import crypto from 'node:crypto';

export const HEADER_SCHEMA = 'bp.catalog.run-header/1';
export const TRAILER_SCHEMA = 'bp.catalog.trailer/2';
export const MAX_HEADER_BYTES = 4096;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DEC20 = /^(0|[1-9][0-9]{0,19})$/;
const HASH = /^[a-f0-9]{64}$/;
const HEADER_KEYS = ['base_generation_id', 'layers', 'run_id', 'run_kind', 'schema', 'source_epoch'];
const LAYER_KEYS = ['base_watermark', 'layer', 'mode', 'output_watermark', 't_high', 't_low'];
const FULL_LAYERS = ['taxonomy', 'content', 'commercial', 'stock'];
const SINGLE_MODES = new Map([
  ['taxonomy', 'replace'], ['content', 'delta'],
  ['commercial', 'delta'], ['stock', 'replace'],
]);

export class RunProtocolError extends Error {
  constructor(code, message) { super(message); this.name = 'RunProtocolError'; this.code = code; }
}
const fail = (code, message) => { throw new RunProtocolError(code, message); };

export function canonicalControlJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalControlJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalControlJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function isDec20(value) { return typeof value === 'string' && DEC20.test(value); }
export function compareDec20(left, right) {
  if (!isDec20(left) || !isDec20(right)) fail('INGEST_RUN_DEC20_INVALID', 'Expected canonical DEC20 strings');
  return left.length === right.length ? (left < right ? -1 : left > right ? 1 : 0) : Math.sign(left.length - right.length);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}
function decodeCanonical(body, maxBytes, code) {
  if (!Buffer.isBuffer(body) || body.length > maxBytes) fail(code, 'Invalid control body size');
  if (body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) fail(code, 'UTF-8 BOM is forbidden');
  let text, value;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(body); value = JSON.parse(text); }
  catch { fail(code, 'Control body must be UTF-8 JSON'); }
  if (text !== canonicalControlJson(value)) fail(code, 'Control body is not exact canonical JSON');
  return value;
}
function nullableDec20(value) { return value === null || isDec20(value); }

function validateLayer(entry, baseGenerationId) {
  if (!exactKeys(entry, LAYER_KEYS) || !nullableDec20(entry.base_watermark) ||
      !nullableDec20(entry.t_low) || !nullableDec20(entry.t_high) ||
      !nullableDec20(entry.output_watermark)) fail('INGEST_RUN_HEADER_INVALID', 'Invalid layer entry');
  if (entry.mode === 'delta') {
    if (!['content', 'commercial'].includes(entry.layer) || baseGenerationId === null ||
        [entry.base_watermark, entry.t_low, entry.t_high, entry.output_watermark].some(v => !isDec20(v)) ||
        compareDec20(entry.t_low, entry.base_watermark) > 0 ||
        compareDec20(entry.base_watermark, entry.t_high) > 0 || entry.output_watermark !== entry.t_high) {
      fail('INGEST_RUN_HEADER_INVALID', 'Invalid delta range');
    }
  } else if (entry.mode === 'replace') {
    if (entry.t_low !== null || !((entry.t_high === null && entry.output_watermark === null) ||
        (isDec20(entry.t_high) && entry.output_watermark === entry.t_high))) {
      fail('INGEST_RUN_HEADER_INVALID', 'Invalid replacement range');
    }
  } else fail('INGEST_RUN_HEADER_INVALID', 'Invalid layer mode');
}

export function parseRunHeader(body, { runId, seq = 0, final = false } = {}) {
  if (seq !== 0 || final || !ID.test(runId || '')) fail('INGEST_RUN_HEADER_INVALID', 'Header must be signed non-final sequence zero');
  const value = decodeCanonical(body, MAX_HEADER_BYTES, 'INGEST_RUN_HEADER_INVALID');
  if (!exactKeys(value, ['header']) || !exactKeys(value.header, HEADER_KEYS)) fail('INGEST_RUN_HEADER_INVALID', 'Invalid header keys');
  const h = value.header;
  if (h.schema !== HEADER_SCHEMA || h.run_id !== runId || !ID.test(h.run_id) || !ID.test(h.source_epoch || '') ||
      !(h.base_generation_id === null || ID.test(h.base_generation_id)) || !Array.isArray(h.layers)) fail('INGEST_RUN_HEADER_INVALID', 'Invalid header identity');
  if (h.run_kind === 'incremental') {
    if (h.base_generation_id === null || h.layers.length !== 1 || SINGLE_MODES.get(h.layers[0]?.layer) !== h.layers[0]?.mode) fail('INGEST_RUN_HEADER_INVALID', 'Invalid single-layer refresh');
  } else if (h.run_kind === 'full') {
    if (h.layers.length !== 4 || h.layers.some((x, i) => x?.layer !== FULL_LAYERS[i] || x?.mode !== 'replace')) fail('INGEST_RUN_HEADER_INVALID', 'Invalid full layer set');
  } else fail('INGEST_RUN_HEADER_INVALID', 'Invalid run kind');
  h.layers.forEach(x => validateLayer(x, h.base_generation_id));
  return h;
}

export function parseTrailerV2(body, { seq, final = true } = {}) {
  if (!final) fail('INGEST_RUN_TRAILER_INVALID', 'Trailer must be final');
  const value = decodeCanonical(body, 1024 * 1024, 'INGEST_RUN_TRAILER_INVALID');
  const keys = ['count', 'final_seq', 'run_digest', 'run_header_sha256', 'schema'];
  if (!exactKeys(value, ['trailer']) || !exactKeys(value.trailer, keys)) fail('INGEST_RUN_TRAILER_INVALID', 'Invalid trailer keys');
  const t = value.trailer;
  if (t.schema !== TRAILER_SCHEMA || !Number.isSafeInteger(t.count) || t.count < 0 ||
      !Number.isSafeInteger(t.final_seq) || t.final_seq < 1 || t.final_seq !== seq ||
      !HASH.test(t.run_digest || '') || !HASH.test(t.run_header_sha256 || '')) fail('INGEST_RUN_TRAILER_INVALID', 'Invalid trailer');
  return t;
}

export function uint64be(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('INGEST_RUN_DIGEST_INVALID', 'uint64 input must be a non-negative safe integer');
  const out = Buffer.alloc(8); out.writeBigUInt64BE(BigInt(value)); return out;
}
export function computeRunDigestV2({ headerHash, chunkHashes, finalSeq, count }) {
  if (!HASH.test(headerHash || '') || !Array.isArray(chunkHashes) || chunkHashes.some(h => !HASH.test(h)) ||
      finalSeq !== chunkHashes.length + 1 || finalSeq < 1 || !Number.isSafeInteger(count) || count < 0) fail('INGEST_RUN_DIGEST_INVALID', 'Invalid digest inputs');
  const sha = value => crypto.createHash('sha256').update(value).digest();
  let chain = sha(Buffer.concat([Buffer.from('BP-RUN-v2\0'), Buffer.from(headerHash, 'hex')]));
  chunkHashes.forEach((hash, index) => { chain = sha(Buffer.concat([Buffer.from('BP-CHUNK-v2\0'), chain, uint64be(index + 1), Buffer.from(hash, 'hex')])); });
  return sha(Buffer.concat([Buffer.from('BP-FINAL-v2\0'), chain, uint64be(finalSeq), uint64be(count)])).toString('hex');
}

export function validateAuthoritativeState(header, current) {
  if (current !== null && (!ID.test(current?.generationId || '') || !ID.test(current?.sourceEpoch || '') ||
      !exactKeys(current?.layers, FULL_LAYERS) ||
      FULL_LAYERS.some(layer => !nullableDec20(current.layers[layer])))) {
    fail('INGEST_RUN_STATE_INVALID', 'Invalid authoritative CURRENT');
  }
  if (header.base_generation_id !== (current?.generationId ?? null)) fail('INGEST_RUN_STATE_MOVED', 'CURRENT differs from signed base');
  if (current === null) {
    if (header.layers.some(entry => entry.base_watermark !== null))
      fail('INGEST_RUN_STATE_MOVED', 'Bootstrap layer base watermark must be null');
    return { claimGenerationId: null };
  }
  if (current && header.source_epoch !== current.sourceEpoch) fail('INGEST_RUN_SOURCE_EPOCH_CHANGED', 'Source epoch differs from CURRENT');
  header.layers.forEach(entry => {
    const authoritative = current.layers[entry.layer];
    if (entry.mode === 'delta' && (authoritative === null || entry.base_watermark !== authoritative))
      fail('INGEST_RUN_STATE_MOVED', 'Delta base watermark differs from CURRENT');
    if (entry.mode === 'replace' && entry.base_watermark !== null && entry.base_watermark !== authoritative)
      fail('INGEST_RUN_STATE_MOVED', 'Replacement base watermark differs from CURRENT');
    if (entry.mode === 'replace' && authoritative !== null &&
        (entry.output_watermark === null || compareDec20(entry.output_watermark, authoritative) < 0))
      fail('INGEST_RUN_WATERMARK_REGRESSION', 'Replacement output regresses authoritative CURRENT');
  });
  return { claimGenerationId: current?.generationId ?? null };
}
