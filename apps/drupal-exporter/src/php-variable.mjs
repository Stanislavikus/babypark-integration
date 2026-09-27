/**
 * Narrow parser for Drupal serialized PHP integer variables: i:<unix-seconds>;
 */
export function parsePhpSerializedInteger(value) {
  if (typeof value !== 'string') {
    throw new Error('PHP serialized integer must be a string');
  }
  const match = /^i:(-?\d+);$/.exec(value);
  if (!match) {
    throw new Error('Invalid PHP serialized integer form');
  }
  const parsed = Number(match[1]);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error('PHP serialized integer out of safe range');
  }
  return parsed;
}
