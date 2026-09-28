import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RELEASE_PROVENANCE_SCHEMA = 'bp.release-provenance/1';
export const RELEASE_REPOSITORY = 'Stanislavikus/babypark-integration';
export const RUNTIME_RELEASE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
);
export const RUNTIME_RELEASE_PROVENANCE_PATH = path.join(
  RUNTIME_RELEASE_ROOT,
  'RELEASE.json'
);
export const RUNTIME_PACKAGE_LOCK_PATH = path.join(
  RUNTIME_RELEASE_ROOT,
  'apps/drupal-exporter/package-lock.json'
);

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
  if (!isHex(document.commit, 40)) fail('release provenance commit must be 40 lowercase hex chars');
  if (!isHex(document.tree, 40)) fail('release provenance tree must be 40 lowercase hex chars');
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

export function loadReleaseProvenance(
  filePath,
  {
    expectedPath = null,
    expectedPackageLockPath = null,
  } = {}
) {
  const resolvedPath = path.resolve(filePath);
  if (expectedPath) {
    let actualReal;
    let expectedReal;
    try {
      actualReal = fs.realpathSync(resolvedPath);
      expectedReal = fs.realpathSync(path.resolve(expectedPath));
    } catch (error) {
      fail(`release provenance path cannot be resolved: ${error.message}`);
    }
    if (actualReal !== expectedReal) {
      fail('release provenance path must belong to the executing immutable release root');
    }
  }
  const raw = fs.readFileSync(resolvedPath);
  let document;
  try {
    document = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    fail(`release provenance is not valid JSON: ${error.message}`);
  }
  validateReleaseProvenance(document);
  const canonical = canonicalReleaseProvenanceBytes(document);
  if (!raw.equals(canonical)) {
    fail('release provenance must use canonical generated JSON bytes');
  }
  if (expectedPackageLockPath) {
    let runtimeLock;
    try {
      runtimeLock = fs.readFileSync(expectedPackageLockPath);
    } catch (error) {
      fail(`runtime package lock cannot be read: ${error.message}`);
    }
    const runtimeLockSha256 = crypto.createHash('sha256').update(runtimeLock).digest('hex');
    if (runtimeLockSha256 !== document.package_lock_sha256) {
      fail('runtime package lock does not match release provenance');
    }
  }
  return {
    file_path: resolvedPath,
    sha256: crypto.createHash('sha256').update(raw).digest('hex'),
    document,
  };
}
