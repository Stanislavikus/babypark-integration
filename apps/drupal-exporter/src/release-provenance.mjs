import crypto from 'node:crypto';
import fs from 'node:fs';

export const RELEASE_PROVENANCE_SCHEMA = 'bp.release-provenance/1';

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
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`).test(value);
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
  if (typeof document.repository !== 'string' || !document.repository) {
    fail('release provenance repository is required');
  }
  if (!isHex(document.commit, 40)) fail('release provenance commit must be 40 lowercase hex chars');
  if (!isHex(document.tree, 40)) fail('release provenance tree must be 40 lowercase hex chars');
  if (!isHex(document.package_lock_sha256, 64)) {
    fail('release provenance package_lock_sha256 must be 64 lowercase hex chars');
  }
  if (typeof document.created_at !== 'string' || !Number.isFinite(Date.parse(document.created_at))) {
    fail('release provenance created_at must be an ISO date string');
  }
  return document;
}

export function loadReleaseProvenance(filePath) {
  const raw = fs.readFileSync(filePath);
  let document;
  try {
    document = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    fail(`release provenance is not valid JSON: ${error.message}`);
  }
  validateReleaseProvenance(document);
  return {
    file_path: filePath,
    sha256: crypto.createHash('sha256').update(raw).digest('hex'),
    document,
  };
}
