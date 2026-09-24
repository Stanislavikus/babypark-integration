import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSku,
  sameSkuIdentity,
  skuKey,
  SkuNormalizationError,
} from '../../src/catalog/domain/sku.mjs';

test('sku_key is NFC + outer trim + deterministic lowercase', () => {
  const value = normalizeSku('  AbC-123  ');
  assert.equal(value.sku, '  AbC-123  ');
  assert.equal(value.normalized_display, 'AbC-123');
  assert.equal(value.sku_key, 'abc-123');
  assert.equal(value.diagnostics.had_outer_whitespace, true);
  assert.equal(value.diagnostics.had_nfc_change, false);
  assert.equal(value.diagnostics.has_non_ascii, false);
});

test('canonical equivalence composes to the same sku_key', () => {
  const decomposed = 'Cafe\u0301-7';
  const composed = 'Café-7';
  assert.notEqual(decomposed, composed);
  assert.equal(skuKey(decomposed), skuKey(composed));
  assert.equal(normalizeSku(decomposed).diagnostics.had_nfc_change, true);
});

test('internal whitespace is preserved', () => {
  assert.equal(skuKey('AB  12'), 'ab  12');
  assert.notEqual(skuKey('AB  12'), skuKey('AB 12'));
});

test('Cyrillic and Latin homoglyphs are never auto-merged', () => {
  const cyrillicA = 'АBC-1';
  const latinA = 'ABC-1';
  assert.equal(normalizeSku(cyrillicA).diagnostics.has_non_ascii, true);
  assert.equal(sameSkuIdentity(cyrillicA, latinA), false);
});

test('NFKC compatibility folding is not applied', () => {
  const fullWidth = 'ＡBC-1';
  const ascii = 'ABC-1';
  assert.notEqual(skuKey(fullWidth), skuKey(ascii));
});

test('case-only and outer-whitespace differences share identity', () => {
  assert.equal(sameSkuIdentity(' SKU-01 ', 'sku-01'), true);
});

test('empty, non-string and NUL SKU are rejected', () => {
  for (const value of ['', '   ', null, 123]) {
    assert.throws(
      () => normalizeSku(value),
      error => error instanceof SkuNormalizationError
    );
  }
  assert.throws(
    () => normalizeSku('ABC\u0000DEF'),
    error =>
      error instanceof SkuNormalizationError &&
      error.code === 'SKU_CONTAINS_NUL'
  );
});
