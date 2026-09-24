import { serviceError } from './errors.mjs';

export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 50;
export const MAX_BATCH_SIZE = 100;
export const MAX_COMPARE_PRODUCTS = 4;
export const MAX_QUERY_CHARS = 256;
export const MAX_QUERY_TOKENS = 8;

export const SELLABLE_AVAILABILITY = Object.freeze([
  'IN_STOCK',
  'EXPECTED',
  'MADE_TO_ORDER',
]);

export const ALL_AVAILABILITY = Object.freeze([
  ...SELLABLE_AVAILABILITY,
  'OUT_OF_STOCK',
  'DISCONTINUED',
]);

export function boundedPositiveInt(
  value,
  {
    name = 'limit',
    defaultValue = DEFAULT_SEARCH_LIMIT,
    max = MAX_SEARCH_LIMIT,
  } = {}
) {
  if (value === undefined || value === null) return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw serviceError(
      'CATALOG_INPUT_OUT_OF_RANGE',
      name + ' must be an integer between 1 and ' + max,
      { field: name, value, max }
    );
  }
  return parsed;
}

export function validateAvailability(values) {
  if (values === undefined || values === null) return null;
  if (!Array.isArray(values) || values.length === 0) {
    throw serviceError(
      'CATALOG_AVAILABILITY_INVALID',
      'availability must be a non-empty array when provided'
    );
  }
  const unique = [...new Set(values.map(String))];
  const invalid = unique.filter(
    value => !ALL_AVAILABILITY.includes(value)
  );
  if (invalid.length) {
    throw serviceError(
      'CATALOG_AVAILABILITY_INVALID',
      'availability contains unsupported values',
      { invalid }
    );
  }
  return unique;
}

export function normalizeSearchText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw serviceError(
      'CATALOG_QUERY_INVALID',
      'query must be a string'
    );
  }
  const normalized = value.normalize('NFC').trim();
  if (normalized.length > MAX_QUERY_CHARS) {
    throw serviceError(
      'CATALOG_QUERY_TOO_LONG',
      'query exceeds the maximum length',
      { max_chars: MAX_QUERY_CHARS }
    );
  }
  return normalized;
}

export function searchTokens(value) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return [];

  const tokens = normalized.match(
    /[\p{L}\p{N}]+(?:[_-][\p{L}\p{N}]+)*/gu
  ) || [];

  return tokens.slice(0, MAX_QUERY_TOKENS);
}

function quoteFtsToken(token) {
  return '"' + token.replaceAll('"', '""') + '"';
}

export function ftsWordQuery(value) {
  const tokens = searchTokens(value);
  if (!tokens.length) return null;
  return tokens.map(quoteFtsToken).join(' AND ');
}

export function ftsTrigramQuery(value) {
  const tokens = searchTokens(value);
  if (!tokens.length) return null;

  const candidate = tokens.join(' ');
  if ([...candidate].length < 3) return null;
  return quoteFtsToken(candidate);
}

export function placeholders(count) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('placeholder count must be positive');
  }
  return Array.from({ length: count }, () => '?').join(',');
}
