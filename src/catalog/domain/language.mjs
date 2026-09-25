export const SHORT_LANGUAGE_TAG_RE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})?$/;

export function normalizeLanguageTag(value) {
  if (typeof value !== 'string' || !SHORT_LANGUAGE_TAG_RE.test(value)) {
    return null;
  }
  return value.toLowerCase();
}
