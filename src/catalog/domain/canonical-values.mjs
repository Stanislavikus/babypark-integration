import { serviceError } from '../service/errors.mjs';

export function parseCanonicalJson(value, field, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  try { return JSON.parse(value); } catch {
    throw serviceError('CATALOG_DATA_INVALID', field + ' contains invalid JSON', { field });
  }
}

export function canonicalBoolean(value) {
  return Number(value) === 1;
}
