import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  buildCanonicalString, sha256Hex, signCanonicalRequest, verifySignedRequest,
} from '../../src/catalog/ingest/auth.mjs';

const secret = 'fixture-secret-with-at-least-32-bytes';
const path = '/api/catalog/ingest/v1/content';
const fields = {
  method: 'POST', path, audience: 'prod', kid: 'k1',
  timestamp: '1780000000', runId: 'run_1', seq: '0',
  final: '1', contentEncoding: 'identity',
};
const bodyBytes = Buffer.from('{"sku":"Ї-1"}', 'utf8');

function request(overrides = {}) {
  const { signature } = signCanonicalRequest({ secret, bodyBytes, ...fields });
  return {
    method: fields.method, path, bodyBytes, audience: 'prod',
    secrets: new Map([['k1', secret]]), now: () => 1780000000,
    headers: {
      'X-BP-Version': '1', 'X-BP-Aud': 'prod', 'X-BP-Kid': 'k1',
      'X-BP-Timestamp': fields.timestamp, 'X-BP-Run': fields.runId,
      'X-BP-Seq': fields.seq, 'X-BP-Final': fields.final,
      'X-BP-Content-Encoding': 'identity', 'X-BP-Signature': signature,
    },
    ...overrides,
  };
}
function rejected(code) {
  return error => error?.name === 'IngestAuthError' && error.code === code;
}

test('BP1 signs exact transmitted UTF-8 bytes and fixed fields', () => {
  const hash = crypto.createHash('sha256').update(bodyBytes).digest('hex');
  const canonical = ['BP1', 'POST', path, 'prod', 'k1',
    '1780000000', 'run_1', '0', '1', 'identity', hash].join('\n');
  assert.equal(sha256Hex(bodyBytes), hash);
  assert.equal(buildCanonicalString({ ...fields, bodySha256: hash }), canonical);
  const signed = signCanonicalRequest({ secret, bodyBytes, ...fields });
  assert.equal(signed.canonical, canonical);
  assert.equal(signed.signature, 'sha256=' +
    crypto.createHmac('sha256', secret).update(canonical).digest('hex'));
  assert.deepEqual(verifySignedRequest(request()), {
    version: 1, audience: 'prod', kid: 'k1', timestamp: 1780000000,
    run_id: 'run_1', seq: 0, final: true, content_encoding: 'identity',
    body_sha256: hash, delta_seconds: 0,
  });
});

test('payload, path, method, flags and audience are authenticated', () => {
  for (const changes of [
    { bodyBytes: Buffer.from('{"sku":"І-1"}') },
    { path: '/api/catalog/ingest/v1/stock' },
    { method: 'GET' },
    { headers: { ...request().headers, 'X-BP-Final': '0' } },
  ]) {
    assert.throws(() => verifySignedRequest(request(changes)),
      rejected('INGEST_AUTH_SIGNATURE_INVALID'));
  }
  assert.throws(() => verifySignedRequest(request({ audience: 'staging' })),
    rejected('INGEST_AUTH_AUDIENCE_INVALID'));
});

test('timestamp, canonical syntax, duplicate headers and limits fail closed', () => {
  assert.throws(() => verifySignedRequest(request({ now: () => 1780000301 })),
    rejected('INGEST_AUTH_TIMESTAMP_EXPIRED'));
  assert.throws(() => verifySignedRequest(request({
    headers: { ...request().headers, 'x-bp-kid': 'k1' },
  })), rejected('INGEST_AUTH_HEADER_INVALID'));
  assert.throws(() => verifySignedRequest(request({
    headers: { ...request().headers, 'X-BP-Content-Encoding': undefined },
  })), rejected('INGEST_AUTH_ENCODING_INVALID'));
  assert.throws(() => verifySignedRequest(request({
    headers: { ...request().headers, 'X-BP-Run': '../bad' },
  })), rejected('INGEST_AUTH_RUN_INVALID'));
  assert.throws(() => verifySignedRequest(request({ maxBodyBytes: 1 })),
    rejected('INGEST_AUTH_BODY_INVALID'));
  assert.throws(() => buildCanonicalString({
    ...fields, path: '/bad\nINJECT', bodySha256: sha256Hex(bodyBytes),
  }), rejected('INGEST_AUTH_CANONICAL_INVALID'));
});

test('gzip requires explicit enablement and signs compressed bytes', () => {
  const compressed = Buffer.from([31, 139, 8, 0, 0, 0]);
  const signature = signCanonicalRequest({
    ...fields, contentEncoding: 'gzip', secret, bodyBytes: compressed,
  }).signature;
  const headers = { ...request().headers,
    'X-BP-Content-Encoding': 'gzip', 'X-BP-Signature': signature };
  const req = request({ bodyBytes: compressed, headers });
  assert.throws(() => verifySignedRequest(req),
    rejected('INGEST_AUTH_ENCODING_INVALID'));
  assert.equal(verifySignedRequest({ ...req, allowGzip: true }).body_sha256,
    sha256Hex(compressed));
});
