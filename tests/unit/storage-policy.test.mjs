import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadStoragePolicy,
  validateStoragePolicy,
  validateStoragePolicyFile,
} from '../../src/ops/storage-policy.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const POLICY = path.join(ROOT, 'config', 'storage-policy.yaml');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function policyError(code) {
  return error =>
    error?.name === 'StoragePolicyError' &&
    error.code === code;
}

test('canonical storage policy is valid and covers required classes', () => {
  const result = validateStoragePolicyFile(POLICY);
  assert.equal(result.version, 1);
  assert.ok(result.objects >= 15);
  assert.ok(result.current >= 1);
  assert.ok(result.planned >= 1);
  assert.ok(result.durable >= 1);

  for (const location of result.drupal_owned_paths) {
    assert.equal(
      location.startsWith('/home/babypark/sites/babypark.ua'),
      false
    );
  }
});

test('warning/critical thresholds cannot be below expected', () => {
  const policy = clone(loadStoragePolicy(POLICY));
  policy.objects[0].thresholds.warning =
    policy.objects[0].thresholds.expected - 1;

  assert.throws(
    () => validateStoragePolicy(policy),
    policyError('STORAGE_POLICY_THRESHOLD_ORDER_INVALID')
  );
});

test('duplicate IDs fail closed', () => {
  const policy = clone(loadStoragePolicy(POLICY));
  policy.objects.push(clone(policy.objects[0]));

  assert.throws(
    () => validateStoragePolicy(policy),
    policyError('STORAGE_POLICY_ID_DUPLICATE')
  );
});

test('required storage class cannot disappear silently', () => {
  const policy = clone(loadStoragePolicy(POLICY));
  policy.objects = policy.objects.filter(
    entry => entry.id !== 'identity_db'
  );

  assert.throws(
    () => validateStoragePolicy(policy),
    policyError('STORAGE_POLICY_REQUIRED_OBJECT_MISSING')
  );
});

for (const id of [
  'catalog_publication_lock_db',
  'catalog_publication_lock_sidecars',
]) {
  test(`${id} cannot disappear silently`, () => {
    const policy = clone(loadStoragePolicy(POLICY));
    policy.objects = policy.objects.filter(entry => entry.id !== id);
    assert.throws(
      () => validateStoragePolicy(policy),
      policyError('STORAGE_POLICY_REQUIRED_OBJECT_MISSING')
    );
  });
}

test('publication lock policy forbids live cleanup and excludes lock artifacts from janitor', () => {
  const policy = loadStoragePolicy(POLICY);
  const lock = policy.objects.find(entry => entry.id === 'catalog_publication_lock_db');
  const sidecars = policy.objects.find(entry => entry.id === 'catalog_publication_lock_sidecars');
  assert.equal(lock.cleanup.automatic, false);
  assert.equal(lock.backup.required, false);
  assert.equal(lock.backup.off_host, false);
  assert.match(lock.cleanup.delete_guard, /Never unlink, replace or recreate/);
  assert.match(lock.recovery, /controlled downtime/);
  assert.equal(sidecars.cleanup.automatic, false);
  assert.equal(sidecars.backup.required, false);
  assert.match(sidecars.cleanup.delete_guard, /Never manually unlink/);
  assert.match(sidecars.cleanup.mechanism, /SQLite lifecycle/);
  for (const id of ['catalog_generations', 'catalog_building_generations']) {
    const entry = policy.objects.find(item => item.id === id);
    assert.match(entry.cleanup.mechanism, /only (for )?valid catalog\./);
    for (const artifact of [
      'catalog-publication-lock.sqlite',
      'catalog-publication-lock.sqlite-journal',
      'catalog-publication-lock.sqlite-wal',
      'catalog-publication-lock.sqlite-shm',
    ]) assert.match(entry.cleanup.delete_guard, new RegExp(artifact.replaceAll('.', '\\.')));
  }
});

test('automatic cleanup requires dry-run and a delete guard', () => {
  const policy = clone(loadStoragePolicy(POLICY));
  const entry = policy.objects.find(
    item => item.id === 'catalog_building_generations'
  );
  entry.cleanup.dry_run_required = false;

  assert.throws(
    () => validateStoragePolicy(policy),
    policyError('STORAGE_POLICY_AUTOMATIC_WITHOUT_DRY_RUN')
  );

  const second = clone(loadStoragePolicy(POLICY));
  const secondEntry = second.objects.find(
    item => item.id === 'catalog_building_generations'
  );
  secondEntry.cleanup.delete_guard = '';

  assert.throws(
    () => validateStoragePolicy(second),
    policyError('STORAGE_POLICY_FIELD_INVALID')
  );
});

test('durable state cannot be configured for automatic file cleanup', () => {
  const policy = clone(loadStoragePolicy(POLICY));
  const entry = policy.objects.find(
    item => item.id === 'identity_db'
  );
  entry.cleanup.automatic = true;

  assert.throws(
    () => validateStoragePolicy(policy),
    policyError('STORAGE_POLICY_DURABLE_AUTO_DELETE')
  );
});

test('Drupal integration-owned writable path inside webroot is forbidden', () => {
  const policy = clone(loadStoragePolicy(POLICY));
  const entry = policy.objects.find(
    item => item.id === 'exporter_state'
  );
  entry.location =
    '/home/babypark/sites/babypark.ua/sites/default/files/exporter';

  assert.throws(
    () => validateStoragePolicy(policy),
    policyError('STORAGE_POLICY_DRUPAL_WEBROOT_FORBIDDEN')
  );
});

test('Drupal integration-owned paths must be absolute', () => {
  const policy = clone(loadStoragePolicy(POLICY));
  const entry = policy.objects.find(
    item => item.id === 'exporter_state'
  );
  entry.location = 'relative/exporter';

  assert.throws(
    () => validateStoragePolicy(policy),
    policyError('STORAGE_POLICY_DRUPAL_PATH_INVALID')
  );
});

test('policy file is deliberately JSON-compatible YAML', () => {
  const policy = loadStoragePolicy(POLICY);
  assert.equal(policy.version, 1);
  assert.ok(Array.isArray(policy.objects));
});
