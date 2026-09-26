import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePhpCombination,
  combinationToCanonicalId,
  PhpCombinationError,
} from '../src/php-combination.mjs';

test('parses integer attribute keys with decimal-string option values', () => {
  const pairs = parsePhpCombination('a:1:{i:25;s:3:"377";}');
  assert.deepEqual([...pairs.entries()], [[25, '377']]);
  assert.equal(combinationToCanonicalId('21136', pairs), '21136|opts:25=377');
});

test('accepts integer option values for forward compatibility', () => {
  const pairs = parsePhpCombination('a:1:{i:26;i:24401;}');
  assert.deepEqual([...pairs.entries()], [[26, '24401']]);
});

test('parses multi-attribute combinations deterministically', () => {
  const pairs = parsePhpCombination('a:2:{i:1;s:1:"2";i:3;s:1:"4";}');
  assert.equal(combinationToCanonicalId('100', pairs), '100|opts:1=2,3=4');
});

test('rejects malformed serialization and trailing bytes', () => {
  assert.throws(() => parsePhpCombination('a:1:{i:1;s:1:"1";}x'), PhpCombinationError);
  assert.throws(() => parsePhpCombination('a:1:{s:1:"1";}'), PhpCombinationError);
  assert.throws(() => parsePhpCombination('a:1:{i:1;s:2:"1";}'), PhpCombinationError);
});

test('rejects duplicate attribute IDs', () => {
  assert.throws(
    () => parsePhpCombination('a:2:{i:1;s:1:"1";i:1;s:1:"2";}'),
    PhpCombinationError
  );
});

test('rejects nonnumeric option strings', () => {
  assert.throws(
    () => parsePhpCombination('a:1:{i:1;s:3:"abc";}'),
    PhpCombinationError
  );
});
