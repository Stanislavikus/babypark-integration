import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OperationalKnowledgeError,
  resolveStoreTodaySchedule,
} from '../../src/copilot/knowledge/operational-resolver.mjs';
import {
  PublicOperationalReaderError,
  resolveCallCenterPhone,
  resolveStorePhone,
} from '../../src/copilot/knowledge/public-operational-readers.mjs';

const NOW = '2026-10-06T07:30:00.000Z';
const STORE = 'store_11111111-1111-4111-8111-111111111111';

function row(overrides = {}) {
  return {
    revision_id: overrides.revision_id ?? 'rev-1',
    record_type: overrides.record_type ?? 'OPERATIONAL_FACT',
    schema_version: overrides.schema_version ?? 1,
    namespace: overrides.namespace ?? 'store.phone',
    effect_family: overrides.effect_family ?? overrides.namespace ?? 'store.phone',
    subject_type: overrides.subject_type ?? 'store',
    subject_id: overrides.subject_id ?? STORE,
    scope: overrides.scope ?? {},
    effect_type: overrides.effect_type ?? 'PHONE',
    effect_value: overrides.effect_value ?? { e164: '+380441234567' },
    effective_from_utc: overrides.effective_from_utc ?? '2026-01-01T00:00:00.000Z',
    expires_at_utc: overrides.expires_at_utc ?? null,
    state: overrides.state ?? 'PUBLISHED',
  };
}

function store(rows) {
  return {
    authoritySnapshot() {
      return rows;
    },
  };
}

test('store phone resolves compatible duplicates and rejects foreign same-family row', () => {
  const compatible = resolveStorePhone(store([
    row({ revision_id: 'rev-a' }),
    row({ revision_id: 'rev-b' }),
  ]), { nowUtc: NOW, storeId: STORE });
  assert.deepEqual(compatible, {
    status: 'RESOLVED',
    effect_family: 'store.phone',
    e164: '+380441234567',
    revision_ids: ['rev-a', 'rev-b'],
  });

  assert.throws(
    () => resolveStorePhone(store([
      row({
        revision_id: 'rev-foreign',
        namespace: 'store.identity',
        effect_family: 'store.phone',
      }),
    ]), { nowUtc: NOW, storeId: STORE }),
    error => error instanceof PublicOperationalReaderError &&
      error.code === 'PUBLIC_OPERATIONAL_PHONE_INVALID'
  );
});

test('call-center phone is business/babypark only and conflicts on different valid effects', () => {
  const result = resolveCallCenterPhone(store([
    row({
      revision_id: 'rev-a',
      namespace: 'call_center.phone',
      effect_family: 'call_center.phone',
      subject_type: 'business',
      subject_id: 'babypark',
      effect_value: { e164: '+380441111111' },
    }),
    row({
      revision_id: 'rev-b',
      namespace: 'call_center.phone',
      effect_family: 'call_center.phone',
      subject_type: 'business',
      subject_id: 'babypark',
      effect_value: { e164: '+380442222222' },
    }),
  ]), { nowUtc: NOW });
  assert.equal(result.status, 'POLICY_CONFLICT');
  assert.deepEqual(result.revisions, ['rev-a', 'rev-b']);
});

test('phone reader maps zero active rows to POLICY_NOT_FOUND and rejects malformed E.164', () => {
  assert.equal(
    resolveStorePhone(store([]), { nowUtc: NOW, storeId: STORE }).status,
    'POLICY_NOT_FOUND'
  );
  assert.throws(
    () => resolveStorePhone(store([
      row({ effect_value: { e164: '0441234567' } }),
    ]), { nowUtc: NOW, storeId: STORE }),
    error => error instanceof PublicOperationalReaderError &&
      error.code === 'PUBLIC_OPERATIONAL_PHONE_INVALID'
  );
});

test('today schedule keeps complete weekly day and removes only future closed segment', () => {
  const result = resolveStoreTodaySchedule(store([
    row({
      revision_id: 'weekly',
      namespace: 'store.weekly_hours',
      effect_family: 'store.hours',
      effect_type: 'WEEKLY_HOURS',
      effect_value: {
        tuesday: [{ open: '09:00', close: '18:00' }],
      },
    }),
    row({
      revision_id: 'future-close',
      namespace: 'store.temporary_closure',
      effect_family: 'store.operating_state',
      effect_type: 'CLOSED',
      effect_value: { closed: true },
      effective_from_utc: '2026-10-06T12:00:00.000Z',
      expires_at_utc: '2026-10-06T13:00:00.000Z',
    }),
  ]), { nowUtc: NOW, storeId: STORE });

  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.open_now, true);
  assert.deepEqual(result.intervals, [
    { open: '09:00', close: '15:00' },
    { open: '16:00', close: '18:00' },
  ]);
  assert.deepEqual(result.revision_ids, ['future-close', 'weekly']);
});

test('special hours own the day and future OPEN never invents hours', () => {
  const result = resolveStoreTodaySchedule(store([
    row({
      revision_id: 'weekly',
      namespace: 'store.weekly_hours',
      effect_family: 'store.hours',
      effect_type: 'WEEKLY_HOURS',
      effect_value: {
        tuesday: [{ open: '09:00', close: '18:00' }],
      },
    }),
    row({
      revision_id: 'special',
      namespace: 'store.special_hours',
      effect_family: 'store.hours',
      effect_type: 'SPECIAL_HOURS',
      effect_value: {
        intervals: [{ open: '11:00', close: '14:00' }],
      },
    }),
    row({
      revision_id: 'future-open',
      namespace: 'store.status_override',
      effect_family: 'store.operating_state',
      effect_type: 'OPEN',
      effect_value: { status: 'OPEN' },
      effective_from_utc: '2026-10-06T12:00:00.000Z',
      expires_at_utc: '2026-10-06T15:00:00.000Z',
    }),
  ]), { nowUtc: NOW, storeId: STORE });

  assert.equal(result.source, 'SPECIAL_HOURS');
  assert.deepEqual(result.intervals, [{ open: '11:00', close: '14:00' }]);
});

test('future conflicting peer operating states return POLICY_CONFLICT', () => {
  const result = resolveStoreTodaySchedule(store([
    row({
      revision_id: 'weekly',
      namespace: 'store.weekly_hours',
      effect_family: 'store.hours',
      effect_type: 'WEEKLY_HOURS',
      effect_value: {
        tuesday: [{ open: '09:00', close: '18:00' }],
      },
    }),
    row({
      revision_id: 'close',
      namespace: 'store.temporary_closure',
      effect_family: 'store.operating_state',
      effect_type: 'CLOSED',
      effect_value: { status: 'CLOSED' },
      effective_from_utc: '2026-10-06T12:00:00.000Z',
      expires_at_utc: '2026-10-06T13:00:00.000Z',
    }),
    row({
      revision_id: 'open',
      namespace: 'store.status_override',
      effect_family: 'store.operating_state',
      effect_type: 'OPEN',
      effect_value: { status: 'OPEN' },
      effective_from_utc: '2026-10-06T12:30:00.000Z',
      expires_at_utc: '2026-10-06T13:00:00.000Z',
    }),
  ]), { nowUtc: NOW, storeId: STORE });
  assert.equal(result.status, 'POLICY_CONFLICT');
});

test('unrepresentable second-level future boundary rejects rather than guessing', () => {
  assert.throws(
    () => resolveStoreTodaySchedule(store([
      row({
        revision_id: 'weekly',
        namespace: 'store.weekly_hours',
        effect_family: 'store.hours',
        effect_type: 'WEEKLY_HOURS',
        effect_value: {
          tuesday: [{ open: '09:00', close: '18:00' }],
        },
      }),
      row({
        revision_id: 'close',
        namespace: 'store.temporary_closure',
        effect_family: 'store.operating_state',
        effect_type: 'CLOSED',
        effect_value: { status: 'CLOSED' },
        effective_from_utc: '2026-10-06T12:00:30.000Z',
        expires_at_utc: '2026-10-06T13:00:00.000Z',
      }),
    ]), { nowUtc: NOW, storeId: STORE }),
    error => error instanceof OperationalKnowledgeError &&
      error.code === 'OPERATIONAL_HOURS_BOUNDARY_UNREPRESENTABLE'
  );
});
