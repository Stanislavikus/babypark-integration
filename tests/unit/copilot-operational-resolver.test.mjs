import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KnowledgeStore } from '../../src/copilot/knowledge/store.mjs';
import { resolveStoreOperationalState } from '../../src/copilot/knowledge/operational-resolver.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-operational-a6-'));
  const file = path.join(root, 'knowledge.sqlite');
  let revisionSeq = 0;
  let eventSeq = 0;
  let clock = 0;
  const config = {
    now: () => new Date(Date.UTC(2026, 9, 2, 10, 0, clock++)).toISOString(),
    idFactory: {
      revision: () => `kr_op_${++revisionSeq}`,
      event: () => `ke_op_${++eventSeq}`,
    },
  };
  return {
    store: () => KnowledgeStore.createNew(file, config),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function weekly(overrides = {}) {
  return {
    recordType: 'OPERATIONAL_FACT',
    namespace: 'store.weekly_hours',
    effectFamily: 'store.hours',
    subjectType: 'store',
    subjectId: 'store_1',
    scope: {},
    effectType: 'WEEKLY_HOURS',
    effectValue: {
      friday: [{ open: '10:00', close: '20:00' }],
      saturday: [{ open: '10:00', close: '20:00' }],
    },
    effectiveFromUtc: '2026-09-01T00:00:00Z',
    expiresAtUtc: null,
    authorActorId: 'author',
    ...overrides,
  };
}

function reviewed(store, input) {
  const rev = store.createDraft(input);
  store.approveRevision({ revisionId: rev.revision_id, actorId: 'reviewer' });
  store.publishRevision({ revisionId: rev.revision_id, actorId: 'publisher' });
  return rev;
}

function direct(store, input) {
  const rev = store.createDraft(input);
  store.publishRevision({ revisionId: rev.revision_id, actorId: 'operator' });
  return rev;
}

function special(store, overrides = {}) {
  return direct(store, {
    ...weekly(),
    namespace: 'store.special_hours',
    effectType: 'SPECIAL_HOURS',
    effectValue: { intervals: [{ open: '11:00', close: '18:00' }] },
    effectiveFromUtc: '2026-10-01T21:00:00Z',
    expiresAtUtc: '2026-10-02T21:00:00Z',
    ...overrides,
  });
}

function closure(store, overrides = {}) {
  return direct(store, {
    ...weekly(),
    namespace: 'store.temporary_closure',
    effectFamily: 'store.operating_state',
    effectType: 'CLOSED',
    effectValue: { closed: true },
    effectiveFromUtc: '2026-10-02T13:00:00Z',
    expiresAtUtc: '2026-10-02T16:00:00Z',
    ...overrides,
  });
}

function statusOverride(store, status, overrides = {}) {
  return direct(store, {
    ...weekly(),
    namespace: 'store.status_override',
    effectFamily: 'store.operating_state',
    effectType: 'STATUS',
    effectValue: { status },
    effectiveFromUtc: '2026-10-02T13:00:00Z',
    expiresAtUtc: '2026-10-02T16:00:00Z',
    ...overrides,
  });
}

test('O01 closing overlay suppresses special and weekly hours', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  reviewed(store, weekly());
  special(store);
  const closed = closure(store);

  const result = resolveStoreOperationalState(store, {
    nowUtc: '2026-10-02T14:30:00Z',
    storeId: 'store_1',
  });
  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.open, false);
  assert.equal(result.source, 'OPERATING_STATE_OVERLAY');
  assert.deepEqual(result.revision_ids, [closed.revision_id]);
  store.close();
});

test('O02 exact overlay expiry reveals baseline', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  const base = reviewed(store, weekly());
  closure(store, {
    effectiveFromUtc: '2026-10-02T10:00:00Z',
    expiresAtUtc: '2026-10-02T12:00:00Z',
  });

  const before = resolveStoreOperationalState(store, {
    nowUtc: '2026-10-02T11:59:59.999Z',
    storeId: 'store_1',
  });
  assert.equal(before.open, false);
  assert.equal(before.source, 'OPERATING_STATE_OVERLAY');

  const atBoundary = resolveStoreOperationalState(store, {
    nowUtc: '2026-10-02T12:00:00Z',
    storeId: 'store_1',
  });
  assert.equal(atBoundary.open, true);
  assert.equal(atBoundary.source, 'WEEKLY_HOURS');
  assert.deepEqual(atBoundary.revision_ids, [base.revision_id]);
  store.close();
});

test('O05 open-ended weekly baseline remains active', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  reviewed(store, weekly({ expiresAtUtc: null }));

  const result = resolveStoreOperationalState(store, {
    nowUtc: '2026-10-02T15:00:00Z',
    storeId: 'store_1',
  });
  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.open, true);
  assert.equal(result.source, 'WEEKLY_HOURS');
  assert.equal(result.closes_at_local, '20:00');
  store.close();
});

test('O06/O08 special hours own the whole civil day and baseline does not fill gap', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  reviewed(store, weekly());
  special(store);

  const open = resolveStoreOperationalState(store, {
    nowUtc: '2026-10-02T14:30:00Z',
    storeId: 'store_1',
  });
  assert.equal(open.open, true);
  assert.equal(open.source, 'SPECIAL_HOURS');
  assert.equal(open.closes_at_local, '18:00');

  for (const nowUtc of [
    '2026-10-02T15:30:00Z',
    '2026-10-02T16:30:00Z',
  ]) {
    const closed = resolveStoreOperationalState(store, {
      nowUtc,
      storeId: 'store_1',
    });
    assert.equal(closed.open, false);
    assert.equal(closed.source, 'SPECIAL_HOURS');
  }

  const nextDay = resolveStoreOperationalState(store, {
    nowUtc: '2026-10-03T08:00:00Z',
    storeId: 'store_1',
  });
  assert.equal(nextDay.open, true);
  assert.equal(nextDay.source, 'WEEKLY_HOURS');
  store.close();
});

test('O07 cross-namespace state peers conflict regardless of namespace', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  closure(store);
  statusOverride(store, 'OPEN');

  const result = resolveStoreOperationalState(store, {
    nowUtc: '2026-10-02T14:30:00Z',
    storeId: 'store_1',
  });
  assert.equal(result.status, 'POLICY_CONFLICT');
  assert.equal(result.effect_family, 'store.operating_state');
  assert.equal(result.revisions.length, 2);
  store.close();
});

test('OPEN status does not invent hours when no hours authority exists', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  statusOverride(store, 'OPEN');

  const result = resolveStoreOperationalState(store, {
    nowUtc: '2026-10-02T14:30:00Z',
    storeId: 'store_1',
  });
  assert.equal(result.status, 'POLICY_NOT_FOUND');
  store.close();
});

test('baseline CLOSED is lower priority than an active OPEN status override', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  reviewed(store, {
    ...weekly(),
    namespace: 'store.baseline_status',
    effectFamily: 'store.operating_state',
    effectType: 'STATUS',
    effectValue: { status: 'CLOSED' },
  });
  reviewed(store, weekly());
  statusOverride(store, 'OPEN');

  const result = resolveStoreOperationalState(store, {
    nowUtc: '2026-10-02T14:30:00Z',
    storeId: 'store_1',
  });
  assert.equal(result.open, true);
  assert.equal(result.source, 'WEEKLY_HOURS');
  store.close();
});

test('malformed or incomplete hours fail closed', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  reviewed(store, weekly({
    effectValue: { friday: [{ open: '20:00', close: '10:00' }] },
  }));
  assert.throws(
    () => resolveStoreOperationalState(store, {
      nowUtc: '2026-10-02T14:30:00Z',
      storeId: 'store_1',
    }),
    error => error.code === 'OPERATIONAL_HOURS_INVALID'
  );
  store.close();
});
