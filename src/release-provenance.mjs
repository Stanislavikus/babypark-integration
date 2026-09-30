export const RELEASE_PROVENANCE_SCHEMA = 'bp.release-provenance/1';
export const RELEASE_REPOSITORY = 'Stanislavikus/babypark-integration';

const EXACT_KEYS = Object.freeze([
  'schema',
  'repository',
  'commit',
  'tree',
  'package_lock_sha256',
  'created_at',
]);

function fail(message) {
  const error = new Error(message);
  error.code = 'RELEASE_PROVENANCE_INVALID';
  throw error;
}

function isHex(value, length) {
  return typeof value === 'string' &&
    new RegExp(`^[0-9a-f]{${length}}$`).test(value);
}

function isCanonicalUtcIsoTimestamp(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

export function validateReleaseProvenance(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    fail('release provenance must be an object');
  }
  const keys = Object.keys(document).sort();
  const expected = [...EXACT_KEYS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    fail('release provenance has unexpected or missing keys');
  }
  if (document.schema !== RELEASE_PROVENANCE_SCHEMA) {
    fail(`unsupported release provenance schema: ${document.schema}`);
  }
  if (document.repository !== RELEASE_REPOSITORY) {
    fail(`release provenance repository must be ${RELEASE_REPOSITORY}`);
  }
  if (!isHex(document.commit, 40)) {
    fail('release provenance commit must be 40 lowercase hex chars');
  }
  if (!isHex(document.tree, 40)) {
    fail('release provenance tree must be 40 lowercase hex chars');
  }
  if (!isHex(document.package_lock_sha256, 64)) {
    fail('release provenance package_lock_sha256 must be 64 lowercase hex chars');
  }
  if (!isCanonicalUtcIsoTimestamp(document.created_at)) {
    fail('release provenance created_at must be canonical UTC ISO-8601');
  }
  return document;
}

export function canonicalReleaseProvenanceBytes(document) {
  validateReleaseProvenance(document);
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
}
