export class SkuNormalizationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SkuNormalizationError';
    this.code = code;
  }
}

export function normalizeSku(rawSku) {
  if (typeof rawSku !== 'string') {
    throw new SkuNormalizationError(
      'SKU_NOT_STRING',
      'SKU must be a string'
    );
  }

  const sku = rawSku.normalize('NFC');
  const trimmed = sku.trim();
  if (!trimmed) {
    throw new SkuNormalizationError(
      'SKU_EMPTY',
      'SKU must not be empty after trim'
    );
  }

  if (trimmed.includes('\u0000')) {
    throw new SkuNormalizationError(
      'SKU_CONTAINS_NUL',
      'SKU must not contain NUL'
    );
  }

  return {
    sku: rawSku,
    normalized_display: trimmed,
    sku_key: trimmed.toLowerCase().normalize('NFC'),
    diagnostics: {
      had_outer_whitespace: rawSku !== rawSku.trim(),
      had_nfc_change: rawSku !== rawSku.normalize('NFC'),
      has_non_ascii: /[^\x00-\x7F]/u.test(rawSku),
    },
  };
}

export function skuKey(rawSku) {
  return normalizeSku(rawSku).sku_key;
}

export function sameSkuIdentity(a, b) {
  return skuKey(a) === skuKey(b);
}
