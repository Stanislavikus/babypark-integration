/**
 * Narrow PHP array parser for Ubercart adjustment combinations.
 * Supports: a:N:{i:<aid>;s:<len>:"<oid>";...}
 * Integer attribute keys, decimal-string (or integer) option IDs.
 */
export class PhpCombinationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PhpCombinationError';
  }
}

function fail(message) {
  throw new PhpCombinationError(message);
}

export function parsePhpCombination(serialized) {
  if (typeof serialized !== 'string' || serialized === '') {
    fail('empty combination');
  }

  let pos = 0;
  function peek() {
    return serialized[pos];
  }
  function consume(expected) {
    if (!serialized.startsWith(expected, pos)) {
      fail(`expected ${JSON.stringify(expected)} at ${pos}`);
    }
    pos += expected.length;
  }
  function readInt() {
    const start = pos;
    while (pos < serialized.length && serialized[pos] >= '0' && serialized[pos] <= '9') {
      pos += 1;
    }
    if (start === pos) fail('expected integer');
    const value = Number(serialized.slice(start, pos));
    if (!Number.isSafeInteger(value)) fail('integer out of range');
    return value;
  }
  function readQuotedString() {
    consume('"');
    const start = pos;
    while (pos < serialized.length && serialized[pos] !== '"') {
      pos += 1;
    }
    if (pos >= serialized.length) fail('unterminated string');
    const value = serialized.slice(start, pos);
    consume('"');
    return value;
  }

  consume('a:');
  const count = readInt();
  consume(':');
  consume('{');

  const pairs = new Map();
  for (let i = 0; i < count; i += 1) {
    consume('i:');
    const attributeId = readInt();
    consume(';');
    if (peek() === 'i') {
      consume('i:');
      const optionId = readInt();
      consume(';');
      setPair(pairs, attributeId, String(optionId));
    } else if (peek() === 's') {
      consume('s:');
      const len = readInt();
      consume(':');
      const optionStr = readQuotedString();
      consume(';');
      if (optionStr.length !== len) fail('string length mismatch');
      setPair(pairs, attributeId, optionStr);
    } else {
      fail('unsupported value type');
    }
  }

  consume('}');
  if (pos !== serialized.length) {
    fail('trailing bytes');
  }

  return pairs;
}

function setPair(pairs, attributeId, optionValue) {
  if (!Number.isSafeInteger(attributeId) || attributeId < 0) {
    fail('invalid attribute id');
  }
  if (pairs.has(attributeId)) {
    fail('duplicate attribute id');
  }
  if (!/^\d+$/.test(optionValue)) {
    fail('option id must be numeric decimal string');
  }
  pairs.set(attributeId, optionValue);
}

export function combinationToCanonicalId(productId, pairs) {
  if (!pairs || pairs.size === 0) {
    return `${productId}|base`;
  }
  const sorted = [...pairs.entries()].sort((a, b) => a[0] - b[0]);
  const encoded = sorted.map(([aid, oid]) => `${aid}=${oid}`).join(',');
  return `${productId}|opts:${encoded}`;
}

export function pairsFromCanonicalVariantId(variantId) {
  const [productPart, suffix] = variantId.split('|', 2);
  if (!suffix || suffix === 'base') {
    return { productId: productPart, pairs: new Map() };
  }
  if (!suffix.startsWith('opts:')) {
    throw new PhpCombinationError('invalid variant id suffix');
  }
  const pairs = new Map();
  for (const part of suffix.slice(5).split(',')) {
    const [aid, oid] = part.split('=');
    pairs.set(Number(aid), oid);
  }
  return { productId: productPart, pairs };
}
