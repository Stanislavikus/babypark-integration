import path from 'node:path';
import { fail } from './errors.mjs';

export const DEFAULT_STATE_DIR = '/var/lib/babypark-exporter/sender-runs';
export const STATE_PATH = '/api/catalog/ingest/v1/state';
export const FULL_PATH = '/api/catalog/ingest/v1/full';

export function validateOrigin(value) {
  let url;
  try { url = new URL(value); } catch { fail('D2B_ORIGIN_INVALID', 'Catalog origin is not a valid URL'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    fail('D2B_ORIGIN_INVALID', 'Catalog origin must contain only scheme and authority');
  }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    fail('D2B_INSECURE_ORIGIN', 'Only HTTPS or loopback HTTP origins are allowed');
  }
  return url.origin;
}

export function loadSenderConfig(env = process.env) {
  const required = name => {
    const value = env[name];
    if (!value) fail('D2B_CONFIG_MISSING', `${name} is required`);
    return value;
  };
  const maxAttempts = Number(env.BP_D2B_MAX_ATTEMPTS ?? 4);
  const timeoutMs = Number(env.BP_D2B_TIMEOUT_MS ?? 60_000);
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) {
    fail('D2B_CONFIG_INVALID', 'Retry and timeout configuration is invalid');
  }
  return {
    origin: validateOrigin(required('BP_CATALOG_ORIGIN')),
    audience: required('BP_CATALOG_AUDIENCE'),
    kid: required('BP_CATALOG_KID'),
    secret: required('BP_CATALOG_SECRET'),
    stateDir: path.resolve(env.BP_D2B_STATE_DIR ?? DEFAULT_STATE_DIR),
    maxAttempts,
    timeoutMs,
  };
}
