import { isIP } from 'node:net';

const DEBUG_TOKEN =
  /(?:^|[^\p{L}\p{N}_])(?:id|oid|aid|nid|vid|fid)\s*[:=#-]\s*\S+/iu;
const SERIALIZED_PREFIX = /^(?:a|o|s|i|b|d):\d+[:;{]/iu;
const URI_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const SPECIAL_HOST_SUFFIXES = Object.freeze([
  'localhost', 'local', 'internal', 'invalid', 'test', 'example',
]);

function codePoints(value) {
  return [...value].length;
}

function normalizeIds(internalIds) {
  if (!Array.isArray(internalIds)) return null;
  const out = new Set();
  for (const raw of internalIds) {
    if (raw === null || raw === undefined) continue;
    const value = String(raw).normalize('NFC').replace(/\s+/gu, ' ').trim();
    if (value.length === 0) return null;
    out.add(value.toLowerCase());
  }
  return out;
}

export function publicDisplayText(raw, { internalIds = [] } = {}) {
  if (typeof raw !== 'string') return null;
  let value = raw.normalize('NFC');
  if (/[\p{Cc}\p{Cf}]/u.test(value)) return null;
  value = value.replace(/\s+/gu, ' ').trim();
  const length = codePoints(value);
  if (length < 1 || length > 160) return null;
  if (URI_PREFIX.test(value) || /^\/\//u.test(value) || /^www\./iu.test(value)) {
    return null;
  }
  if (DEBUG_TOKEN.test(value) || SERIALIZED_PREFIX.test(value)) return null;
  const ids = normalizeIds(internalIds);
  if (ids === null || ids.has(value.toLowerCase())) return null;
  return value;
}

export function choiceLabelKey(raw, responseLocale) {
  const safe = publicDisplayText(raw);
  if (safe === null || !['uk', 'ru'].includes(responseLocale)) return null;
  return safe.toLocaleLowerCase(responseLocale);
}

function publicDnsHostname(hostname) {
  if (typeof hostname !== 'string' || hostname.length === 0) return false;
  const host = hostname.toLowerCase().replace(/\.$/u, '');
  if (host.length < 1 || host.length > 253 ||
      isIP(host) !== 0 || !host.includes('.')) {
    return false;
  }
  if (host === 'localhost' ||
      SPECIAL_HOST_SUFFIXES.some(suffix =>
        host === suffix || host.endsWith('.' + suffix))) {
    return false;
  }
  const labels = host.split('.');
  return labels.every(label =>
    label.length >= 1 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)
  );
}

export function publicUrl(raw, kind) {
  if (raw === null) return null;
  if (typeof raw !== 'string' || codePoints(raw) < 1 || codePoints(raw) > 4096) {
    return null;
  }
  if (/[\s\p{Cc}\\]/u.test(raw) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/iu.test(raw)) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.hash !== '' ||
      parsed.port !== '' ||
      !publicDnsHostname(parsed.hostname)) {
    return null;
  }
  if (kind === 'product') {
    const host = parsed.hostname.toLowerCase().replace(/\.$/u, '');
    if (host !== 'babypark.ua' && !host.endsWith('.babypark.ua')) return null;
  } else if (kind !== 'image') {
    return null;
  }
  return parsed.href;
}

export function safeDistinctLabels(rows, {
  responseLocale,
  valueKey = 'value',
  labelKey = 'label',
  internalIdsByValue = new Map(),
} = {}) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 20) return null;
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const value = row?.[valueKey];
    const label = publicDisplayText(row?.[labelKey], {
      internalIds: internalIdsByValue.get(value) ?? [],
    });
    if (label === null) return null;
    const key = label.normalize('NFC')
      .replace(/\s+/gu, ' ')
      .trim()
      .toLocaleLowerCase(responseLocale);
    if (seen.has(key)) return null;
    seen.add(key);
    out.push(Object.freeze({ value, label }));
  }
  return Object.freeze(out);
}
