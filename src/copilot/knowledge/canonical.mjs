import crypto from 'node:crypto';

export const KNOWLEDGE_CANONICAL_JSON_VERSION = 1;

function normalize(value, path = '$') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`${path} must use a safe integer; floating JSON numbers are forbidden`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => normalize(item, `${path}[${index}]`));
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const out = {};
    for (const key of keys) {
      if (value[key] === undefined) {
        throw new TypeError(`${path}.${key} cannot be undefined`);
      }
      out[key] = normalize(value[key], `${path}.${key}`);
    }
    return out;
  }
  throw new TypeError(`${path} contains unsupported JSON value`);
}

export function canonicalKnowledgeJson(value) {
  return JSON.stringify(normalize(value));
}

export function knowledgeSha256(value) {
  return crypto.createHash('sha256')
    .update(canonicalKnowledgeJson(value))
    .digest('hex');
}
export function canonicalKnowledgeTimestamp(value, name = 'timestamp') {
  if (typeof value !== 'string' || value === '') {
    throw new TypeError(`${name} must be RFC3339 text`);
  }
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) {
    throw new TypeError(`${name} must be a valid timestamp`);
  }
  return new Date(millis).toISOString();
}

export function parseCanonicalKnowledgeJson(value, name = 'json') {
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be JSON text`);
  }
  let parsed;
  try { parsed = JSON.parse(value); }
  catch { throw new TypeError(`${name} must be valid JSON`); }
  const canonical = canonicalKnowledgeJson(parsed);
  if (canonical !== value) {
    throw new TypeError(`${name} must use BabyPark canonical JSON v1`);
  }
  return parsed;
}
