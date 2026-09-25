const MAX_UINT32 = 0xffffffff;

export function frameBytes(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new TypeError('frameBytes requires bytes');
  }
  const bytes = Buffer.from(value);
  if (bytes.length > MAX_UINT32) throw new RangeError('framed value exceeds uint32');
  const prefix = Buffer.allocUnsafe(4);
  prefix.writeUInt32BE(bytes.length);
  return Buffer.concat([prefix, bytes]);
}

export function frameUtf8(value) {
  if (typeof value !== 'string') throw new TypeError('frameUtf8 requires a string');
  return frameBytes(Buffer.from(value, 'utf8'));
}
