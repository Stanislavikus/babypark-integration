import fs from 'node:fs';
import path from 'node:path';

export class StoragePolicyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'StoragePolicyError';
    this.code = code;
    this.details = details;
  }
}

const REQUIRED_IDS = Object.freeze([
  'gateway_bridge_db',
  'gateway_sqlite_sidecars',
  'gateway_event_rows',
  'gateway_local_backups',
  'identity_db',
  'identity_backups',
  'catalog_generations',
  'catalog_building_generations',
  'catalog_publication_lock_db',
  'catalog_publication_lock_sidecars',
  'ingest_staging',
  'copilot_jobs',
  'ai_trace_metadata',
  'integration_releases',
  'exporter_state',
  'exporter_releases',
  'operations_packages',
]);

const STATUS = new Set([
  'CURRENT',
  'PLANNED',
  'DEPRECATED',
]);

const STATE_CLASS = new Set([
  'durable',
  'rebuildable',
  'transient',
]);

const DRUPAL_WEBROOT = path.resolve(
  '/home/babypark/sites/babypark.ua'
);

function fail(code, message, details = {}) {
  throw new StoragePolicyError(code, message, details);
}

function requireText(object, field, id) {
  const value = object[field];
  if (typeof value !== 'string' || value.trim() === '') {
    fail(
      'STORAGE_POLICY_FIELD_INVALID',
      field + ' must be a non-empty string',
      { id, field }
    );
  }
  return value;
}

function validateThresholds(entry) {
  const thresholds = entry.thresholds;
  if (!thresholds || typeof thresholds !== 'object') {
    fail(
      'STORAGE_POLICY_THRESHOLDS_MISSING',
      'thresholds are required',
      { id: entry.id }
    );
  }

  requireText(thresholds, 'metric', entry.id);
  requireText(thresholds, 'basis', entry.id);

  const values = [
    ['expected', thresholds.expected],
    ['warning', thresholds.warning],
    ['critical', thresholds.critical],
  ];
  for (const [name, value] of values) {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      fail(
        'STORAGE_POLICY_THRESHOLD_INVALID',
        name + ' threshold must be a non-negative number',
        { id: entry.id, threshold: name, value }
      );
    }
  }
  if (
    thresholds.expected > thresholds.warning ||
    thresholds.warning > thresholds.critical
  ) {
    fail(
      'STORAGE_POLICY_THRESHOLD_ORDER_INVALID',
      'expected <= warning <= critical is required',
      {
        id: entry.id,
        expected: thresholds.expected,
        warning: thresholds.warning,
        critical: thresholds.critical,
      }
    );
  }
}

function validateRetention(entry) {
  const retention = entry.retention;
  if (!retention || typeof retention !== 'object') {
    fail(
      'STORAGE_POLICY_RETENTION_MISSING',
      'retention policy is required',
      { id: entry.id }
    );
  }
  requireText(retention, 'mode', entry.id);

  const ttl = retention.ttl_days;
  if (
    ttl !== null &&
    (
      !Number.isInteger(ttl) ||
      ttl < 1
    )
  ) {
    fail(
      'STORAGE_POLICY_TTL_INVALID',
      'ttl_days must be null or a positive integer',
      { id: entry.id, ttl_days: ttl }
    );
  }
}

function validateCleanup(entry) {
  const cleanup = entry.cleanup;
  if (!cleanup || typeof cleanup !== 'object') {
    fail(
      'STORAGE_POLICY_CLEANUP_MISSING',
      'cleanup policy is required',
      { id: entry.id }
    );
  }
  if (typeof cleanup.automatic !== 'boolean') {
    fail(
      'STORAGE_POLICY_CLEANUP_INVALID',
      'cleanup.automatic must be boolean',
      { id: entry.id }
    );
  }
  if (typeof cleanup.dry_run_required !== 'boolean') {
    fail(
      'STORAGE_POLICY_CLEANUP_INVALID',
      'cleanup.dry_run_required must be boolean',
      { id: entry.id }
    );
  }

  requireText(cleanup, 'mechanism', entry.id);
  requireText(cleanup, 'delete_guard', entry.id);

  if (cleanup.automatic && !cleanup.dry_run_required) {
    fail(
      'STORAGE_POLICY_AUTOMATIC_WITHOUT_DRY_RUN',
      'automatic cleanup requires dry-run support',
      { id: entry.id }
    );
  }

  if (
    entry.state_class === 'durable' &&
    cleanup.automatic
  ) {
    fail(
      'STORAGE_POLICY_DURABLE_AUTO_DELETE',
      'durable state cannot use automatic file-level cleanup',
      { id: entry.id }
    );
  }
}

function validateBackup(entry) {
  const backup = entry.backup;
  if (!backup || typeof backup !== 'object') {
    fail(
      'STORAGE_POLICY_BACKUP_MISSING',
      'backup policy is required',
      { id: entry.id }
    );
  }
  for (const field of ['required', 'off_host']) {
    if (typeof backup[field] !== 'boolean') {
      fail(
        'STORAGE_POLICY_BACKUP_INVALID',
        'backup.' + field + ' must be boolean',
        { id: entry.id, field }
      );
    }
  }
  requireText(backup, 'status', entry.id);
}

function validateDrupalIsolation(entry) {
  if (entry.host_role !== 'drupal') return;

  if (!entry.location.startsWith('/')) {
    fail(
      'STORAGE_POLICY_DRUPAL_PATH_INVALID',
      'Drupal-host app-owned writable path must be absolute',
      { id: entry.id, location: entry.location }
    );
  }

  const resolved = path.resolve(entry.location);
  if (
    resolved === DRUPAL_WEBROOT ||
    resolved.startsWith(DRUPAL_WEBROOT + path.sep)
  ) {
    fail(
      'STORAGE_POLICY_DRUPAL_WEBROOT_FORBIDDEN',
      'Integration-owned writable paths are forbidden inside Drupal webroot',
      { id: entry.id, location: entry.location }
    );
  }
}

function validateEntry(entry, seen) {
  if (!entry || typeof entry !== 'object') {
    fail(
      'STORAGE_POLICY_ENTRY_INVALID',
      'storage object must be an object'
    );
  }

  const id = requireText(entry, 'id', '<unknown>');
  if (!/^[a-z][a-z0-9_]*$/.test(id)) {
    fail(
      'STORAGE_POLICY_ID_INVALID',
      'storage id must use lowercase snake_case',
      { id }
    );
  }
  if (seen.has(id)) {
    fail(
      'STORAGE_POLICY_ID_DUPLICATE',
      'storage id is duplicated',
      { id }
    );
  }
  seen.add(id);

  requireText(entry, 'host_role', id);
  requireText(entry, 'scope', id);
  requireText(entry, 'location', id);
  requireText(entry, 'owner', id);
  requireText(entry, 'purpose', id);
  requireText(entry, 'recovery', id);
  requireText(entry, 'pii', id);

  if (!STATUS.has(entry.status)) {
    fail(
      'STORAGE_POLICY_STATUS_INVALID',
      'unsupported storage status',
      { id, status: entry.status }
    );
  }
  if (!STATE_CLASS.has(entry.state_class)) {
    fail(
      'STORAGE_POLICY_CLASS_INVALID',
      'unsupported state_class',
      { id, state_class: entry.state_class }
    );
  }

  validateThresholds(entry);
  validateRetention(entry);
  validateCleanup(entry);
  validateBackup(entry);
  validateDrupalIsolation(entry);
}

export function validateStoragePolicy(
  policy,
  {
    requiredIds = REQUIRED_IDS,
  } = {}
) {
  if (!policy || typeof policy !== 'object') {
    fail(
      'STORAGE_POLICY_INVALID',
      'policy must be an object'
    );
  }
  if (policy.version !== 1) {
    fail(
      'STORAGE_POLICY_VERSION_INVALID',
      'storage policy version 1 is required',
      { version: policy.version }
    );
  }
  if (!STATUS.has(policy.status)) {
    fail(
      'STORAGE_POLICY_STATUS_INVALID',
      'unsupported top-level status',
      { status: policy.status }
    );
  }
  requireText(policy, 'last_verified', '<policy>');
  requireText(policy, 'owner', '<policy>');

  if (!Array.isArray(policy.objects) || !policy.objects.length) {
    fail(
      'STORAGE_POLICY_OBJECTS_MISSING',
      'policy.objects must be a non-empty array'
    );
  }

  const seen = new Set();
  for (const entry of policy.objects) {
    validateEntry(entry, seen);
  }

  const missing = requiredIds.filter(id => !seen.has(id));
  if (missing.length) {
    fail(
      'STORAGE_POLICY_REQUIRED_OBJECT_MISSING',
      'required storage objects are missing',
      { missing }
    );
  }

  return {
    version: policy.version,
    status: policy.status,
    objects: policy.objects.length,
    current: policy.objects.filter(
      entry => entry.status === 'CURRENT'
    ).length,
    planned: policy.objects.filter(
      entry => entry.status === 'PLANNED'
    ).length,
    durable: policy.objects.filter(
      entry => entry.state_class === 'durable'
    ).length,
    drupal_owned_paths: policy.objects
      .filter(entry => entry.host_role === 'drupal')
      .map(entry => entry.location),
  };
}

export function loadStoragePolicy(filePath) {
  const resolved = path.resolve(filePath);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    fail(
      'STORAGE_POLICY_PARSE_FAILED',
      'storage-policy.yaml must be JSON-compatible YAML',
      { path: resolved, cause: error.message }
    );
  }
  return parsed;
}

export function validateStoragePolicyFile(filePath) {
  return validateStoragePolicy(
    loadStoragePolicy(filePath)
  );
}

export { REQUIRED_IDS };
