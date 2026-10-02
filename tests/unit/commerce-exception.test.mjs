import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isStrictlyNarrowerCommerceScope,
  validateCommerceExceptionGraph,
  validateCommerceExceptionRelation,
} from '../../src/copilot/knowledge/commerce-exception.mjs';

function rev(id, overrides = {}) {
  return {
    revision_id: id,
    record_type: 'COMMERCE_POLICY',
    effect_family: 'commerce.prepayment',
    scope: { category_id: 'furniture' },
    effective_from_utc: '2026-01-01T00:00:00Z',
    expires_at_utc: null,
    exception_of_revision_id: null,
    ...overrides,
  };
}

test('E01 valid strict narrowing repeats parent binding and adds exact binding', () => {
  const parent = rev('p');
  const child = rev('c', { scope: { category_id: 'furniture', brand_id: 'Veres' }, exception_of_revision_id: 'p' });
  assert.equal(isStrictlyNarrowerCommerceScope(parent.scope, child.scope), true);
  assert.equal(validateCommerceExceptionRelation(parent, child).ok, true);
});

test('E02 equal scope is not an exception', () => {
  assert.throws(() => validateCommerceExceptionRelation(rev('p'), rev('c')), e => e.code === 'COMMERCE_EXCEPTION_SCOPE_NOT_STRICTLY_NARROWER');
});

test('E03 missing parent binding rejects', () => {
  assert.throws(() => validateCommerceExceptionRelation(rev('p'), rev('c', { scope: { brand_id: 'Veres' } })), e => e.code === 'COMMERCE_EXCEPTION_SCOPE_NOT_STRICTLY_NARROWER');
});

test('E04 category descendant alone does not narrow exact category binding', () => {
  assert.throws(() => validateCommerceExceptionRelation(rev('p', { scope: { category_id: 'A' } }), rev('c', { scope: { category_id: 'B', brand_id: 'Veres' } })), e => e.code === 'COMMERCE_EXCEPTION_SCOPE_NOT_STRICTLY_NARROWER');
});

test('E05 broader child rejects', () => {
  assert.throws(() => validateCommerceExceptionRelation(rev('p', { scope: { category_id: 'furniture', brand_id: 'Veres' } }), rev('c', { scope: { category_id: 'furniture' } })), e => e.code === 'COMMERCE_EXCEPTION_SCOPE_NOT_STRICTLY_NARROWER');
});

test('E06 non-empty temporal subset is accepted, including open parent', () => {
  const parent = rev('p');
  const child = rev('c', { scope: { category_id: 'furniture', brand_id: 'Veres' }, effective_from_utc: '2026-02-01T00:00:00Z', expires_at_utc: '2026-03-01T00:00:00Z' });
  assert.equal(validateCommerceExceptionRelation(parent, child).ok, true);
});

test('E07 child extending beyond finite parent rejects', () => {
  const parent = rev('p', { expires_at_utc: '2026-04-01T00:00:00Z' });
  const child = rev('c', { scope: { category_id: 'furniture', brand_id: 'Veres' }, expires_at_utc: '2026-05-01T00:00:00Z' });
  assert.throws(() => validateCommerceExceptionRelation(parent, child), e => e.code === 'COMMERCE_EXCEPTION_INTERVAL_NOT_SUBSET');
});

test('effect_family mismatch rejects independently of scope', () => {
  const child = rev('c', { effect_family: 'commerce.returns', scope: { category_id: 'furniture', brand_id: 'Veres' } });
  assert.throws(() => validateCommerceExceptionRelation(rev('p'), child), e => e.code === 'COMMERCE_EXCEPTION_EFFECT_FAMILY_MISMATCH');
});

test('unsupported scope binding is rejected rather than interpreted', () => {
  const child = rev('c', { scope: { category_id: 'furniture', taxonomy_descendant: 'chairs' } });
  assert.throws(() => validateCommerceExceptionRelation(rev('p'), child), e => e.code === 'COMMERCE_EXCEPTION_SCOPE_BINDING_UNSUPPORTED');
});

test('E08 graph rejects cycle and missing parent', () => {
  const a = rev('a', { scope: {}, exception_of_revision_id: 'c' });
  const b = rev('b', { scope: { category_id: 'furniture' }, exception_of_revision_id: 'a' });
  const c = rev('c', { scope: { category_id: 'furniture', brand_id: 'Veres' }, exception_of_revision_id: 'b' });
  assert.throws(() => validateCommerceExceptionGraph([a, b, c]), e => e.code === 'COMMERCE_EXCEPTION_CYCLE');
  assert.throws(() => validateCommerceExceptionGraph([rev('x', { exception_of_revision_id: 'missing', scope: { category_id: 'furniture', brand_id: 'Veres' } })]), e => e.code === 'COMMERCE_EXCEPTION_PARENT_MISSING');
});

test('valid multi-level exception graph passes', () => {
  const a = rev('a', { scope: {} });
  const b = rev('b', { scope: { category_id: 'furniture' }, exception_of_revision_id: 'a' });
  const c = rev('c', { scope: { category_id: 'furniture', brand_id: 'Veres' }, exception_of_revision_id: 'b' });
  assert.deepEqual(validateCommerceExceptionGraph([a, b, c]), { ok: true, revisions: 3 });
});
