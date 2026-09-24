import crypto from 'node:crypto';

export class IngestAuthError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'IngestAuthError';
    this.code = code;
    this.details = details;
  }
}

const KID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const RUN_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HEX_64_RE = /^[a-f0-9]{64}$/;

function fail(code, message, details = {}) {
  throw new IngestAuthError(code, message, details);
}

function exactIntegerString(value, name) {
  const text = String(value ?? '');
  if (!/^(0|[1-9][0-9]*)$/.test(text)) {
    fail(
      'INGEST_AUTH_HEADER_INVALID',
      name + ' must be a canonical non-negative integer',
      { header: name }
    );
  }
  const number = Number(text);
  if (!Number.isSafeInteger(number)) {
    fail(
      'INGEST_AUTH_HEADER_INVALID',
      name + ' exceeds safe integer range',
      { header: name }
    );
  }
  return { text, number };
}

export function sha256Hex(bodyBytes) {
  const body = Buffer.isBuffer(bodyBytes)
    ? bodyBytes
    : Buffer.from(bodyBytes || '');
  return crypto.createHash('sha256').update(body).digest('hex');
}

export function buildCanonicalString({
  method,
  path,
  audience,
  kid,
  timestamp,
  runId,
  seq,
  final,
  contentEncoding = 'identity',
  bodySha256,
}) {
  const upperMethod = String(method || '').toUpperCase();
  const requestPath = String(path || '');
  const aud = String(audience || '');
  const keyId = String(kid || '');
  const ts = String(timestamp ?? '');
  const run = String(runId || '');
  const sequence = String(seq ?? '');
  const finalFlag = String(final ?? '');
  const encoding = String(contentEncoding || 'identity').toLowerCase();
  const digest = String(bodySha256 || '').toLowerCase();

  if (!/^[A-Z]+$/.test(upperMethod) || !requestPath.startsWith('/') ||
      requestPath.includes('\n') || requestPath.includes('\r')) {
    fail(
      'INGEST_AUTH_CANONICAL_INVALID',
      'method and absolute request path are required'
    );
  }
  if (
    [aud, keyId, ts, run, sequence, finalFlag, encoding, digest]
      .some(value => value.includes('\n') || value.includes('\r'))
  ) {
    fail(
      'INGEST_AUTH_CANONICAL_INVALID',
      'canonical fields cannot contain newlines'
    );
  }
  if (!HEX_64_RE.test(digest)) {
    fail(
      'INGEST_AUTH_BODY_HASH_INVALID',
      'bodySha256 must be lowercase SHA-256 hex'
    );
  }

  return [
    'BP1',
    upperMethod,
    requestPath,
    aud,
    keyId,
    ts,
    run,
    sequence,
    finalFlag,
    encoding,
    digest,
  ].join('\n');
}

export function signCanonicalRequest({
  secret,
  bodyBytes = Buffer.alloc(0),
  ...fields
}) {
  if (typeof secret !== 'string' || secret.length < 16) {
    fail(
      'INGEST_AUTH_SECRET_INVALID',
      'signing secret must be at least 16 characters'
    );
  }
  const bodySha256 = sha256Hex(bodyBytes);
  const canonical = buildCanonicalString({
    ...fields,
    bodySha256,
  });
  const hex = crypto.createHmac('sha256', secret)
    .update(canonical)
    .digest('hex');

  return {
    canonical,
    body_sha256: bodySha256,
    signature: 'sha256=' + hex,
  };
}

function header(headers, name) {
  if (!headers) return undefined;
  let value;
  if (typeof headers.get === 'function') {
    value = headers.get(name) ?? undefined;
  } else {
    const matches = Object.entries(headers)
      .filter(([key]) => key.toLowerCase() === name.toLowerCase());
    if (matches.length > 1) {
      fail('INGEST_AUTH_HEADER_INVALID', name + ' is duplicated', { header: name });
    }
    value = matches[0]?.[1];
  }
  if (value !== undefined &&
      (typeof value !== 'string' || value.includes(',') ||
       value.includes('\n') || value.includes('\r'))) {
    fail('INGEST_AUTH_HEADER_INVALID', name + ' is invalid', { header: name });
  }
  return value;
}

function safeSignatureEqual(expected, actual) {
  const a = Buffer.from(String(expected || ''));
  const b = Buffer.from(String(actual || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifySignedRequest({
  method,
  path,
  headers,
  bodyBytes = Buffer.alloc(0),
  secrets,
  audience,
  maxAgeSec = 300,
  maxBodyBytes = 1024 * 1024,
  allowGzip = false,
  now = () => Math.floor(Date.now() / 1000),
}) {
  if (!(secrets instanceof Map) || secrets.size === 0) {
    fail(
      'INGEST_AUTH_CONFIG_INVALID',
      'at least one signing key is required'
    );
  }
  if (typeof audience !== 'string' || !audience) {
    fail(
      'INGEST_AUTH_CONFIG_INVALID',
      'audience is required'
    );
  }

  const version = String(header(headers, 'X-BP-Version') || '');
  const aud = String(header(headers, 'X-BP-Aud') || '');
  const kid = String(header(headers, 'X-BP-Kid') || '');
  const timestamp = String(header(headers, 'X-BP-Timestamp') || '');
  const runId = String(header(headers, 'X-BP-Run') || '');
  const seq = String(header(headers, 'X-BP-Seq') || '');
  const final = String(header(headers, 'X-BP-Final') || '');
  const contentEncoding = String(
    header(headers, 'X-BP-Content-Encoding') || ''
  );
  const signature = String(header(headers, 'X-BP-Signature') || '');

  if (version !== '1') {
    fail(
      'INGEST_AUTH_VERSION_INVALID',
      'X-BP-Version must be 1'
    );
  }
  if (aud !== audience) {
    fail(
      'INGEST_AUTH_AUDIENCE_INVALID',
      'X-BP-Aud does not match configured audience'
    );
  }
  if (!KID_RE.test(kid)) {
    fail(
      'INGEST_AUTH_KID_INVALID',
      'X-BP-Kid is invalid'
    );
  }
  const secret = secrets.get(kid);
  if (!secret) {
    fail(
      'INGEST_AUTH_KID_UNKNOWN',
      'X-BP-Kid is not active'
    );
  }
  if (!RUN_RE.test(runId)) {
    fail(
      'INGEST_AUTH_RUN_INVALID',
      'X-BP-Run is invalid'
    );
  }

  const ts = exactIntegerString(timestamp, 'X-BP-Timestamp');
  const sequence = exactIntegerString(seq, 'X-BP-Seq');
  if (!['0', '1'].includes(final)) {
    fail(
      'INGEST_AUTH_FINAL_INVALID',
      'X-BP-Final must be 0 or 1'
    );
  }
  if (contentEncoding !== 'identity' &&
      !(allowGzip && contentEncoding === 'gzip')) {
    fail(
      'INGEST_AUTH_ENCODING_INVALID',
      'unsupported content encoding'
    );
  }

  if (!Buffer.isBuffer(bodyBytes) ||
      !Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 0 ||
      bodyBytes.length > maxBodyBytes) {
    fail('INGEST_AUTH_BODY_INVALID', 'transmitted body is invalid or too large');
  }
  if (!Number.isSafeInteger(maxAgeSec) || maxAgeSec < 0) {
    fail('INGEST_AUTH_CONFIG_INVALID', 'maxAgeSec must be a non-negative integer');
  }
  const current = Number(now());
  if (!Number.isSafeInteger(current)) {
    fail(
      'INGEST_AUTH_CONFIG_INVALID',
      'now() must return integer Unix seconds'
    );
  }
  const delta = current - ts.number;
  if (Math.abs(delta) > maxAgeSec) {
    fail(
      'INGEST_AUTH_TIMESTAMP_EXPIRED',
      'signed request timestamp is outside allowed window',
      { delta_seconds: delta, max_age_seconds: maxAgeSec }
    );
  }

  const signed = signCanonicalRequest({
    secret,
    method,
    path,
    audience: aud,
    kid,
    timestamp: ts.text,
    runId,
    seq: sequence.text,
    final,
    contentEncoding,
    bodyBytes,
  });

  if (!/^sha256=[a-f0-9]{64}$/.test(signature) ||
      !safeSignatureEqual(signed.signature, signature)) {
    fail(
      'INGEST_AUTH_SIGNATURE_INVALID',
      'request signature is invalid'
    );
  }

  return {
    version: 1,
    audience: aud,
    kid,
    timestamp: ts.number,
    run_id: runId,
    seq: sequence.number,
    final: final === '1',
    content_encoding: contentEncoding,
    body_sha256: signed.body_sha256,
    delta_seconds: delta,
  };
}
