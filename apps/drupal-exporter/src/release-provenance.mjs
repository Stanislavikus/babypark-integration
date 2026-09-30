import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalReleaseProvenanceBytes,
  RELEASE_PROVENANCE_SCHEMA,
  RELEASE_REPOSITORY,
  validateReleaseProvenance,
} from '../../../src/release-provenance.mjs';

export {
  canonicalReleaseProvenanceBytes,
  RELEASE_PROVENANCE_SCHEMA,
  RELEASE_REPOSITORY,
  validateReleaseProvenance,
};
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

function fail(message) {
  const error = new Error(message);
  error.code = 'RELEASE_PROVENANCE_INVALID';
  throw error;
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
