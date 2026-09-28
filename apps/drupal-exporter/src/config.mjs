import path from 'node:path';

export class ConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ConfigError';
    this.code = code;
  }
}

function env(name, required = true) {
  const value = process.env[name];
  if (required && (value === undefined || value === '')) {
    throw new ConfigError('CONFIG_MISSING', `Missing required environment variable: ${name}`);
  }
  return value ?? null;
}

export function loadConfig(overrides = {}) {
  const db = {
    host: overrides.dbHost ?? env('DRUPAL_EXPORT_DB_HOST'),
    port: Number(overrides.dbPort ?? env('DRUPAL_EXPORT_DB_PORT', false) ?? 3306),
    database: overrides.dbDatabase ?? env('DRUPAL_EXPORT_DB_DATABASE'),
    user: overrides.dbUser ?? env('DRUPAL_EXPORT_DB_USER'),
    password: overrides.dbPassword ?? env('DRUPAL_EXPORT_DB_PASSWORD'),
  };

  const spoolRoot = overrides.spoolRoot ?? env('DRUPAL_EXPORT_SPOOL_ROOT');
  const collisionConfigPath = overrides.collisionConfigPath ??
    env('DRUPAL_EXPORT_COLLISION_CONFIG');
  const anomalyPublicationPolicyPath = overrides.anomalyPublicationPolicyPath ??
    env('DRUPAL_EXPORT_ANOMALY_PUBLICATION_POLICY');
  const releaseProvenancePath = overrides.releaseProvenancePath ??
    env('DRUPAL_EXPORT_RELEASE_PROVENANCE');
  const sourceAcceptanceCasesPath = overrides.sourceAcceptanceCasesPath ??
    env('DRUPAL_EXPORT_SOURCE_ACCEPTANCE_CASES');
  const dbDataPath = overrides.dbDataPath ?? env('DRUPAL_EXPORT_DB_DATA_PATH');
  const minFreeBytes = Number(overrides.minFreeBytes ??
    env('DRUPAL_EXPORT_MIN_FREE_BYTES'));
  const publicSiteUrl = (overrides.publicSiteUrl ??
    env('DRUPAL_EXPORT_PUBLIC_SITE_URL')).replace(/\/$/, '');
  const publicFilesUrl = (overrides.publicFilesUrl ??
    env('DRUPAL_EXPORT_PUBLIC_FILES_URL')).replace(/\/$/, '');

  const filesystem = {
    pricePendingCsv: overrides.pricePendingCsv ??
      env('DRUPAL_EXPORT_PRICE_PENDING_CSV'),
    priceLock: overrides.priceLock ?? env('DRUPAL_EXPORT_PRICE_LOCK'),
    stockPending: overrides.stockPending ?? env('DRUPAL_EXPORT_STOCK_PENDING'),
    stockProcessed: overrides.stockProcessed ??
      env('DRUPAL_EXPORT_STOCK_PROCESSED'),
  };

  if (!path.isAbsolute(spoolRoot)) {
    throw new ConfigError('CONFIG_INVALID', 'spool root must be absolute');
  }
  if (!path.isAbsolute(collisionConfigPath)) {
    throw new ConfigError('CONFIG_INVALID', 'collision config path must be absolute');
  }
  if (!path.isAbsolute(anomalyPublicationPolicyPath)) {
    throw new ConfigError('CONFIG_INVALID', 'anomaly publication policy path must be absolute');
  }
  if (!path.isAbsolute(releaseProvenancePath)) {
    throw new ConfigError('CONFIG_INVALID', 'release provenance path must be absolute');
  }
  if (!path.isAbsolute(sourceAcceptanceCasesPath)) {
    throw new ConfigError('CONFIG_INVALID', 'source acceptance cases path must be absolute');
  }
  if (!path.isAbsolute(dbDataPath)) {
    throw new ConfigError('CONFIG_INVALID', 'DB data path must be absolute');
  }
  if (!Number.isSafeInteger(minFreeBytes) || minFreeBytes <= 0) {
    throw new ConfigError('CONFIG_INVALID', 'minimum free bytes must be a positive safe integer');
  }

  return {
    db,
    spoolRoot,
    collisionConfigPath,
    anomalyPublicationPolicyPath,
    releaseProvenancePath,
    sourceAcceptanceCasesPath,
    dbDataPath,
    minFreeBytes,
    publicSiteUrl,
    publicFilesUrl,
    filesystem,
    provider: 'drupal',
    sourceEpoch: 'drupal-prod-v1',
  };
}
