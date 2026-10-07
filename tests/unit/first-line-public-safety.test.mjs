import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';

import {
  publicDisplayText,
  publicUrl,
} from '../../src/copilot/first-line-public-safety.mjs';

const PROPERTY_SEEDS = Object.freeze({
  internalIdEquality: 440101,
  controlInsertion: 440102,
  whitespaceCollapse: 440103,
  foreignProductHost: 440104,
  underscoreDnsHost: 440105,
});

test('C60ac fixed public-display boundary vectors', () => {
  assert.equal(publicDisplayText('Blue'), 'Blue');
  for (const unsafe of [
    'Blue oid:32976',
    'oid-32976',
    'O:8:{',
    'o:8:{',
    'A:1:{',
    'Bl\u200Bue',
    'Bl\u200Cue',
    'Bl\u200Due',
    'Bl\u2060ue',
    'https:Blue',
    '//example.com',
    'www.example.com',
  ]) {
    assert.equal(publicDisplayText(unsafe), null, unsafe);
  }
  assert.equal(
    publicDisplayText('Blue xoid:32976'),
    'Blue xoid:32976'
  );

  assert.equal(
    publicDisplayText('sku123', { internalIds: ['SKU123'] }),
    null
  );
  assert.equal(publicDisplayText('x'.repeat(160)), 'x'.repeat(160));
  assert.equal(publicDisplayText('x'.repeat(161)), null);
});

test('C60ac fixed public URL boundary vectors', () => {
  assert.equal(
    publicUrl('https://babypark.ua/product/a', 'product'),
    'https://babypark.ua/product/a'
  );
  assert.equal(
    publicUrl('https://cdn.example.org/a.jpg', 'image'),
    'https://cdn.example.org/a.jpg'
  );

  for (const unsafe of [
    'http://babypark.ua/a',
    'https://user:pass@babypark.ua/a',
    'https://babypark.ua/a#fragment',
    'https://babypark.ua:444/a',
    'https://babypark.ua/a b',
    'https://babypark.ua/a\\b',
    'https://babypark.ua/%0A',
    'https://127.0.0.1/a',
    'https://localhost/a',
    'https://shop.local/a',
    'https://evil.example/a',
    'https://bad_host.example.org/a',
    'https://-bad.example.org/a',
    'https://bad-.example.org/a',
  ]) {
    assert.equal(publicUrl(unsafe, 'product'), null, unsafe);
  }
  assert.equal(publicUrl('https://evil.example.org/a', 'product'), null);
  assert.equal(publicUrl('https://evil.example.org/a', 'image'),
    'https://evil.example.org/a');
});

test('property: normalized case-insensitive internal IDs can never become public text', () => {
  fc.assert(fc.property(
    fc.string({
      minLength: 1,
      maxLength: 40,
      unit: fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'
      ),
    }).filter(value => value.trim().length > 0),
    value => {
      const rendered = publicDisplayText(value.toLowerCase(), {
        internalIds: [value.toUpperCase()],
      });
      assert.equal(rendered, null);
    }
  ), { seed: PROPERTY_SEEDS.internalIdEquality, numRuns: 500 });
});

test('property: any inserted Cc/Cf code point is rejected before whitespace normalization', () => {
  const controls = [
    '\u0000', '\u0009', '\u001f', '\u007f',
    '\u200b', '\u200c', '\u200d', '\u2060',
    '\u202a', '\u202e', '\u2066', '\u2069',
  ];
  fc.assert(fc.property(
    fc.string({ minLength: 0, maxLength: 30 }),
    fc.constantFrom(...controls),
    fc.string({ minLength: 0, maxLength: 30 }),
    (left, control, right) => {
      assert.equal(publicDisplayText(left + control + right), null);
    }
  ), { seed: PROPERTY_SEEDS.controlInsertion, numRuns: 500 });
});

test('property: safe ASCII word labels are deterministic under whitespace collapse', () => {
  fc.assert(fc.property(
    fc.array(
      fc.string({
        minLength: 1,
        maxLength: 12,
        unit: fc.constantFrom(
          ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
        ),
      }),
      { minLength: 1, maxLength: 6 }
    ),
    words => {
      const canonical = words.join(' ');
      if (canonical.length > 160) return;
      const raw = '  ' + words.join('   ') + '  ';
      assert.equal(publicDisplayText(raw), canonical);
      assert.equal(publicDisplayText(raw), publicDisplayText(raw));
    }
  ), { seed: PROPERTY_SEEDS.whitespaceCollapse, numRuns: 500 });
});

test('property: product URL host policy never accepts a foreign generated host', () => {
  fc.assert(fc.property(
    fc.string({
      minLength: 1,
      maxLength: 20,
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'),
    }).filter(label => !['babypark', 'www'].includes(label)),
    label => {
      const url = `https://${label}.example.org/item`;
      assert.equal(publicUrl(url, 'product'), null);
      assert.equal(publicUrl(url, 'image'), url);
    }
  ), { seed: PROPERTY_SEEDS.foreignProductHost, numRuns: 300 });
});


test('property: DNS host labels with underscore are never public image hosts', () => {
  fc.assert(fc.property(
    fc.string({
      minLength: 1,
      maxLength: 20,
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'),
    }),
    fc.string({
      minLength: 1,
      maxLength: 20,
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'),
    }),
    (left, right) => {
      const raw = `https://${left}_${right}.example.org/image.jpg`;
      assert.equal(publicUrl(raw, 'image'), null);
    }
  ), { seed: PROPERTY_SEEDS.underscoreDnsHost, numRuns: 300 });
});

test('public display internal identifiers stringify non-string comparison values', () => {
  assert.equal(publicDisplayText('42', { internalIds: [42] }), null);
  assert.equal(publicDisplayText('TRUE', { internalIds: [true] }), null);
});


test('C60ac public URL length boundary accepts 4096 and rejects 4097 code points', () => {
  for (const [kind, prefix] of [
    ['product', 'https://babypark.ua/'],
    ['image', 'https://cdn.babypark-cdn.org/'],
  ]) {
    const atLimit = prefix + 'a'.repeat(4096 - [...prefix].length);
    const overLimit = prefix + 'a'.repeat(4097 - [...prefix].length);
    assert.equal([...atLimit].length, 4096);
    assert.equal([...overLimit].length, 4097);
    assert.equal(publicUrl(atLimit, kind), atLimit);
    assert.equal(publicUrl(overLimit, kind), null);
  }
});

test('C60ac debug and URI-prefix boundary variants are closed', () => {
  for (const unsafe of [
    'Blue ID=32976',
    'Blue Aid#32976',
    'Blue VID-32976',
    'Blue fid:32976',
    'mailto:blue@example.org',
    'tel:+380441234567',
    'javascript:alert(1)',
  ]) {
    assert.equal(publicDisplayText(unsafe), null, unsafe);
  }
  for (const safe of [
    'Blue xoid:32976',
    'Blue xid=32976',
    'ordinary text',
  ]) {
    assert.notEqual(publicDisplayText(safe), null, safe);
  }
});
