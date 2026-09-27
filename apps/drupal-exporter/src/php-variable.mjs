/**
 * Narrow parser for Drupal serialized PHP integer variables: i:<unix-seconds>;
 *
 * Drupal 7 stores variable.value as LONG BLOB in production, so MariaDB
 * Connector/Node.js returns a Buffer. Tests/fixtures may still pass a string.
 */
function serializedUtf8(value) {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  throw new Error('PHP serialized value must be a string or Buffer');
}

export function parsePhpSerializedInteger(value) {
  const serialized = serializedUtf8(value);
  const match = /^i:(-?\d+);$/.exec(serialized);
  if (!match) {
    throw new Error('Invalid PHP serialized integer form');
  }
  const parsed = Number(match[1]);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error('PHP serialized integer out of safe range');
  }
  return parsed;
}

/**
 * Narrow parser for Drupal serialized PHP string variables: s:<byte-len>:"...";
 */
export function parsePhpSerializedString(value) {
  const serialized = serializedUtf8(value);
  const match = /^s:(\d+):"(.*)";$/s.exec(serialized);
  if (!match) {
    throw new Error('Invalid PHP serialized string form');
  }
  const declaredLength = Number(match[1]);
  if (!Number.isInteger(declaredLength) || declaredLength < 0) {
    throw new Error('Invalid PHP serialized string length');
  }
  const content = match[2];
  if (Buffer.byteLength(content, 'utf8') !== declaredLength) {
    throw new Error('PHP serialized string byte length mismatch');
  }
  return content;
}
