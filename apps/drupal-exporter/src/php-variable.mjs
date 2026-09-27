/**
 * Narrow parser for Drupal serialized PHP integer variables: i:<unix-seconds>;
 *
 * Drupal 7 stores variable.value as LONG BLOB in production, so MariaDB
 * Connector/Node.js returns a Buffer. Tests/fixtures may still pass a string.
 */
export function parsePhpSerializedInteger(value) {
  let serialized;
  if (typeof value === 'string') {
    serialized = value;
  } else if (Buffer.isBuffer(value)) {
    serialized = value.toString('utf8');
  } else {
    throw new Error('PHP serialized integer must be a string or Buffer');
  }

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
