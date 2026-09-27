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

  return {
    db,
    spoolRoot,
    collisionConfigPath,
    publicSiteUrl,
    publicFilesUrl,
    filesystem,
    provider: 'drupal',
    sourceEpoch: 'drupal-prod-v1',
  };
}
