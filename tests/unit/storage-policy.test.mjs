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
  'exporter_ready_spools',
  'catalog_downstream_snapshots',
  'catalog_link_a_staging',
  'exporter_sender_run_state',
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

for (const id of [
  'n8n_compose_project',
  'n8n_systemd_units',
  'n8n_state_root',
  'n8n_user_state',
  'n8n_postgres_data',
  'n8n_runtime_tmpfs',
  'n8n_runtime_key',
  'n8n_local_backups',
  'n8n_restore_scratch',
  'n8n_user_restore_scratch',
  'n8n_postgres_restore_data',
  'n8n_docker_layers',
  'n8n_containerd_layers',
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

test('n8n release storage remains planned and independently owned', () => {
  const policy = loadStoragePolicy(POLICY);
  const planned = new Map(policy.objects
    .filter(entry => entry.id.startsWith('n8n_'))
    .map(entry => [entry.id, entry]));

  const expected = [
    {
      id: 'n8n_compose_project',
      location: '/opt/babypark-n8n',
      owner: 'root:root',
      state_class: 'rebuildable',
      backup: { required: false, off_host: false, status: 'REBUILDABLE_FROM_GIT' },
      permissions: null,
    },
    {
      id: 'n8n_systemd_units',
      location: '/etc/systemd/system/babypark-n8n.service and /etc/systemd/system/run-babypark\\x2dn8n\\x2druntime.mount',
      owner: 'root:root',
      state_class: 'rebuildable',
      backup: { required: false, off_host: false, status: 'REBUILDABLE_FROM_GIT' },
      permissions: null,
    },
    {
      id: 'n8n_state_root',
      location: '/var/lib/babypark-n8n',
      owner: 'root:root',
      state_class: 'rebuildable',
      backup: { required: false, off_host: false, status: 'REBUILDABLE_EMPTY_NAMESPACE' },
      permissions: { directory_mode: '0755' },
    },
    {
      id: 'n8n_user_state',
      location: '/var/lib/babypark-n8n/user',
      owner: '1000:1000',
      state_class: 'durable',
      backup: { required: true, off_host: false, status: 'LOCAL_ONLY_RESTORE_TEST_REQUIRED' },
      permissions: { directory_mode: '0700' },
    },
    {
      id: 'n8n_postgres_data',
      location: '/var/lib/babypark-n8n/postgres',
      owner: '999:999 (verify UID/GID from the pinned official image)',
      state_class: 'durable',
      backup: { required: true, off_host: false, status: 'LOCAL_ONLY_RESTORE_TEST_REQUIRED' },
      permissions: { directory_mode: '0700' },
    },
    {
      id: 'n8n_runtime_tmpfs',
      location: '/run/babypark-n8n-runtime',
      owner: '1000:1000',
      state_class: 'transient',
      backup: { required: false, off_host: false, status: 'EPHEMERAL_NOT_BACKED_UP' },
      permissions: null,
    },
    {
      id: 'n8n_runtime_key',
      location: '/etc/babypark-n8n/n8n.env',
      owner: 'root:root',
      state_class: 'durable',
      backup: { required: true, off_host: false, status: 'LOCAL_ONLY_ENCRYPTED_CHANNEL_NOT_CONFIGURED' },
      permissions: { directory_mode: '0700', file_mode: '0600' },
    },
    {
      id: 'n8n_local_backups',
      location: '/var/backups/babypark-n8n',
      owner: 'root:root',
      state_class: 'durable',
      backup: { required: true, off_host: false, status: 'SAME_HOST_ONLY_OFF_HOST_TARGET_NOT_APPROVED' },
      permissions: { directory_mode: '0700', file_mode: '0600' },
    },
    {
      id: 'n8n_restore_scratch',
      location: '/var/lib/babypark-n8n/restore-test',
      owner: 'root:root',
      state_class: 'transient',
      backup: { required: false, off_host: false, status: 'TRANSIENT_NOT_BACKED_UP' },
      permissions: { directory_mode: '0700' },
    },
    {
      id: 'n8n_user_restore_scratch',
      location: '/var/lib/babypark-n8n/restore-test/user',
      owner: '1000:1000',
      state_class: 'transient',
      backup: { required: false, off_host: false, status: 'TRANSIENT_NOT_BACKED_UP' },
      permissions: { directory_mode: '0700' },
    },
    {
      id: 'n8n_postgres_restore_data',
      location: '/var/lib/babypark-n8n/restore-test/postgres',
      owner: '999:999 (verify UID/GID from the pinned official image)',
      state_class: 'transient',
      backup: { required: false, off_host: false, status: 'TRANSIENT_NOT_BACKED_UP' },
      permissions: { directory_mode: '0700' },
    },
    {
      id: 'n8n_docker_layers',
      location: '/var/lib/docker',
      owner: 'root:root',
      state_class: 'rebuildable',
      backup: { required: false, off_host: false, status: 'REBUILDABLE_PINNED_IMAGE' },
      permissions: null,
    },
    {
      id: 'n8n_containerd_layers',
      location: '/var/lib/containerd',
      owner: 'root:root',
      state_class: 'rebuildable',
      backup: { required: false, off_host: false, status: 'REBUILDABLE_PINNED_IMAGE' },
      permissions: null,
    },
  ];

  assert.equal(planned.size, expected.length);
  assert.deepEqual([...planned.keys()].sort(), expected.map(entry => entry.id).sort());
  for (const item of expected) {
    const actual = planned.get(item.id);
    assert.equal(actual.status, 'PLANNED', item.id);
    assert.equal(actual.host_role, 'integration', item.id);
    assert.equal(actual.location, item.location, item.id);
    assert.equal(actual.owner, item.owner, item.id);
    assert.equal(actual.state_class, item.state_class, item.id);
    assert.deepEqual(actual.backup, item.backup, item.id);
    assert.deepEqual(actual.permissions ?? null, item.permissions, item.id);
  }

  assert.deepEqual(planned.get('n8n_docker_layers').access_control, {
    filesystem: 'Docker-managed root-owned metadata; verify actual per-file owner/mode before release; do not chmod or chown the shared Docker root.',
    daemon: 'Access to a rootful Docker socket is root-equivalent; compare every socket-group member with the owner-approved host-admin roster before release.',
  });
});

test('n8n Docker metadata requires an explicit root-equivalent access boundary', () => {
  const missing = clone(loadStoragePolicy(POLICY));
  delete missing.objects.find(entry => entry.id === 'n8n_docker_layers').access_control;
  assert.throws(
    () => validateStoragePolicy(missing),
    policyError('STORAGE_POLICY_ACCESS_CONTROL_MISSING')
  );

  const weakened = clone(loadStoragePolicy(POLICY));
  weakened.objects.find(entry => entry.id === 'n8n_docker_layers')
    .access_control.daemon = 'Only local users have access';
  assert.throws(
    () => validateStoragePolicy(weakened),
    policyError('STORAGE_POLICY_ACCESS_CONTROL_INVALID')
  );
});

test('private payload storage requires 0700 directories and 0600 files', () => {
  const policy = loadStoragePolicy(POLICY);
  for (const id of ['exporter_ready_spools', 'catalog_downstream_snapshots', 'catalog_link_a_staging', 'exporter_sender_run_state']) {
    const entry = policy.objects.find(item => item.id === id);
    assert.equal(entry.permissions.directory_mode, '0700');
    assert.equal(entry.permissions.file_mode, '0600');
  }
  assert.equal(
    policy.objects.find(item => item.id === 'exporter_ready_spools').owner,
    'babypark-exporter:babypark-exporter'
  );
  const snapshots = policy.objects.find(
    item => item.id === 'catalog_downstream_snapshots'
  );
  assert.equal(snapshots.location, '/var/lib/babypark-catalog/snapshots');
  assert.equal(snapshots.owner, 'babypark-catalog:babypark-catalog');
  assert.equal(snapshots.state_class, 'rebuildable');
  assert.equal(snapshots.cleanup.automatic, false);
  assert.match(snapshots.cleanup.delete_guard, /Never delete by age alone/);
  assert.equal(snapshots.backup.required, false);

  const weakened = clone(policy);
  weakened.objects.find(item => item.id === 'exporter_ready_spools')
    .permissions.directory_mode = '0755';
  assert.throws(
    () => validateStoragePolicy(weakened),
    policyError('STORAGE_POLICY_PERMISSIONS_INVALID')
  );
});

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
