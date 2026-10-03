export function normalizeTitleKey(value) {
  if (typeof value !== 'string') {
    throw new TypeError('title must be a string');
  }
  const key = value.normalize('NFC').trim();
  if (!key || key.includes('\0')) {
    throw new TypeError('title must produce a non-empty safe key');
  }
  return key;
}
