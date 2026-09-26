import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDecimal,
  addDecimal,
  toMinorUnits,
  MoneyError,
} from '../src/decimal-money.mjs';

test('exact decimal addition without floating point', () => {
  const base = parseDecimal('99.99999');
  const adj = parseDecimal('0.00001');
  const final = addDecimal(base, adj);
  assert.equal(toMinorUnits(final), 10000n);
});

test('blocks sub-cent final prices', () => {
  assert.throws(
    () => toMinorUnits(parseDecimal('10.00001')),
    err => err.code === 'PRICE_NOT_MINOR_ALIGNED'
  );
});

test('blocks negative final prices', () => {
  assert.throws(
    () => toMinorUnits(parseDecimal('-0.00200')),
    err => err.code === 'PRICE_NEGATIVE'
  );
});

test('does not round sub-cent values', () => {
  assert.throws(
    () => toMinorUnits(parseDecimal('100.00500')),
    MoneyError
  );
});
