const KID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function integer(name, value, fallback, { min, max }) {
  const text = value === undefined ? String(fallback) : String(value);
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error(name + ' must be a canonical integer');
  const result = Number(text);
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error(name + ' is out of range');
  return result;
}

function required(name, value) {
  if (typeof value !== 'string' || value === '') throw new Error(name + ' is required');
  return value;
}

export function parseBp1Keys(value) {
  let object;
  try { object = JSON.parse(required('CATALOG_BP1_KEYS_JSON', value)); }
  catch (error) { throw new Error('CATALOG_BP1_KEYS_JSON is invalid: ' + error.message); }
  if (!object || Array.isArray(object) || typeof object !== 'object') throw new Error('CATALOG_BP1_KEYS_JSON must be an object');
  const entries = Object.entries(object);
  if (entries.length === 0) throw new Error('CATALOG_BP1_KEYS_JSON must not be empty');
  for (const [kid, secret] of entries) {
    if (!KID_RE.test(kid)) throw new Error('CATALOG_BP1_KEYS_JSON contains an invalid KID');
    if (typeof secret !== 'string' || secret.length < 32) throw new Error('CATALOG_BP1_KEYS_JSON contains a weak secret');
  }
  return new Map(entries);
}

export function parseCatalogHttpConfig(env = process.env) {
  return {
    host: env.CATALOG_INGEST_HOST || '127.0.0.1',
    port: integer('CATALOG_INGEST_PORT', env.CATALOG_INGEST_PORT, 8081, { min: 1, max: 65535 }),
    ingestEnabled: env.CATALOG_INGEST_ENABLED === 'true' ? true : env.CATALOG_INGEST_ENABLED === undefined || env.CATALOG_INGEST_ENABLED === 'false' ? false : (() => { throw new Error('CATALOG_INGEST_ENABLED must be true or false'); })(),
    audience: required('CATALOG_BP1_AUDIENCE', env.CATALOG_BP1_AUDIENCE),
    secrets: parseBp1Keys(env.CATALOG_BP1_KEYS_JSON),
    maxAgeSec: integer('CATALOG_BP1_MAX_AGE_SEC', env.CATALOG_BP1_MAX_AGE_SEC, 300, { min: 0, max: 86400 }),
    identityPath: required('CATALOG_IDENTITY_PATH', env.CATALOG_IDENTITY_PATH),
    replayPath: required('CATALOG_REPLAY_PATH', env.CATALOG_REPLAY_PATH),
    storageDir: required('CATALOG_STORAGE_DIR', env.CATALOG_STORAGE_DIR),
  };
}
