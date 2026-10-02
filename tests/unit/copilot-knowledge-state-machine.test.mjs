import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { knowledgeSha256 } from '../../src/copilot/knowledge/canonical.mjs';
import { KnowledgeStore } from '../../src/copilot/knowledge/store.mjs';

function fixture({ eventFactory } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-knowledge-a4b-'));
  const file = path.join(root, 'knowledge.sqlite');
  let revisionSeq = 0;
  let eventSeq = 0;
  let clock = 0;
  const config = {
    now: () => new Date(Date.UTC(2026, 9, 2, 7, 0, clock++)).toISOString(),
    idFactory: {
      revision: () => `kr_sm_${++revisionSeq}`,
      event: eventFactory ?? (() => `ke_sm_${++eventSeq}`),
    },
  };
  return {
    root,
    file,
    config,
    store: () => KnowledgeStore.createNew(file, config),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function baseline(overrides = {}) {
  return {
    recordType: 'OPERATIONAL_FACT',
    namespace: 'store.weekly_hours',
    effectFamily: 'store.hours',
    subjectType: 'store',
    subjectId: 'store_1',
    scope: {},
    effectType: 'WEEKLY_HOURS',
    effectValue: { monday: [{ open: '10:00', close: '20:00' }] },
    effectiveFromUtc: '2026-10-01T00:00:00Z',
    authorActorId: 'actor_author',
    ...overrides,
  };
}

function commerce(overrides = {}) {
  return baseline({
    recordType: 'COMMERCE_POLICY',
    namespace: 'commerce.prepayment',
    effectFamily: 'commerce.prepayment',
    subjectType: 'business',
    subjectId: 'babypark',
    effectType: 'PREPAYMENT',
    effectValue: { amount_minor: 200000, currency: 'UAH' },
    ...overrides,
  });
}

function temporary(namespace = 'store.temporary_closure', overrides = {}) {
  return baseline({
    namespace,
    effectFamily: namespace === 'store.status_override'
      ? 'store.operating_state'
      : 'store.hours',
    effectType: namespace === 'store.status_override'
      ? 'STATUS'
      : 'CLOSED',
    effectValue: namespace === 'store.status_override'
      ? { status: 'CLOSED' }
      : { closed: true },
    effectiveFromUtc: '2026-10-02T12:00:00Z',
    expiresAtUtc: '2026-10-02T14:00:00Z',
    ...overrides,
  });
}
test('approval-required baseline cannot publish before APPROVED', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  const rev = store.createDraft(baseline());
  assert.throws(
    () => store.publishRevision({
      revisionId: rev.revision_id,
      actorId: 'actor_publisher',
    }),
    error => error.code === 'KNOWLEDGE_APPROVAL_REQUIRED'
  );
  assert.deepEqual(
    store.eventsForRevision(rev.revision_id).map(x => x.event_type),
    ['DRAFT_CREATED']
  );
  store.close();
});

test('approval-required baseline follows DRAFT -> APPROVED -> PUBLISHED -> REVOKED', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  const rev = store.createDraft(baseline());
  store.approveRevision({
    revisionId: rev.revision_id,
    actorId: 'actor_reviewer',
  });
  store.publishRevision({
    revisionId: rev.revision_id,
    actorId: 'actor_publisher',
  });
  store.revokeRevision({
    revisionId: rev.revision_id,
    actorId: 'actor_reviewer',
  });
  assert.deepEqual(
    store.eventsForRevision(rev.revision_id).map(x => x.event_type),
    ['DRAFT_CREATED', 'APPROVED', 'PUBLISHED', 'REVOKED']
  );
  assert.equal(store.verifyLedger().events, 4);
  assert.throws(
    () => store.publishRevision({
      revisionId: rev.revision_id,
      actorId: 'actor_publisher',
    }),
    error => error.code === 'KNOWLEDGE_APPROVAL_REQUIRED'
  );
  assert.throws(
    () => store.revokeRevision({
      revisionId: rev.revision_id,
      actorId: 'actor_reviewer',
    }),
    error => error.code === 'KNOWLEDGE_STATE_TRANSITION_INVALID'
  );
  store.close();
});
test('CommercePolicy self-approval is forbidden regardless of actor role naming', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  const rev = store.createDraft(commerce({ authorActorId: 'actor_admin' }));
  assert.throws(
    () => store.approveRevision({
      revisionId: rev.revision_id,
      actorId: 'actor_admin',
      metadata: { role: 'KNOWLEDGE_ADMIN' },
    }),
    error => error.code === 'KNOWLEDGE_SELF_APPROVAL_FORBIDDEN'
  );
  assert.deepEqual(
    store.eventsForRevision(rev.revision_id).map(x => x.event_type),
    ['DRAFT_CREATED']
  );
  store.close();
});

test('WITHDRAWN is terminal from DRAFT or APPROVED', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  const draftOnly = store.createDraft(baseline({ namespace: 'store.phone' }));
  store.withdrawRevision({
    revisionId: draftOnly.revision_id,
    actorId: 'actor_author',
  });
  assert.throws(
    () => store.approveRevision({
      revisionId: draftOnly.revision_id,
      actorId: 'actor_reviewer',
    }),
    error => error.code === 'KNOWLEDGE_STATE_TRANSITION_INVALID'
  );

  const approved = store.createDraft(baseline({ namespace: 'store.address' }));
  store.approveRevision({
    revisionId: approved.revision_id,
    actorId: 'actor_reviewer',
  });
  store.withdrawRevision({
    revisionId: approved.revision_id,
    actorId: 'actor_reviewer',
  });
  assert.equal(store.verifyLedger().revisions, 2);
  store.close();
});
test('direct temporary overlay publishes without APPROVED but requires finite expiry', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  const good = store.createDraft(temporary());
  assert.throws(
    () => store.approveRevision({
      revisionId: good.revision_id,
      actorId: 'actor_reviewer',
    }),
    error => error.code === 'KNOWLEDGE_APPROVAL_NOT_REQUIRED'
  );
  store.publishRevision({
    revisionId: good.revision_id,
    actorId: 'actor_author',
  });

  const bad = store.createDraft(temporary('store.temporary_closure', {
    expiresAtUtc: null,
  }));
  assert.throws(
    () => store.publishRevision({
      revisionId: bad.revision_id,
      actorId: 'actor_author',
    }),
    error => error.code === 'KNOWLEDGE_TEMPORARY_EXPIRY_REQUIRED'
  );
  store.close();
});

test('store.special_hours requires exactly one Europe/Kyiv civil day', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  const valid = store.createDraft(temporary('store.special_hours', {
    effectType: 'SPECIAL_HOURS',
    effectValue: { intervals: [{ open: '11:00', close: '18:00' }] },
    effectiveFromUtc: '2026-10-01T21:00:00Z',
    expiresAtUtc: '2026-10-02T21:00:00Z',
  }));
  store.publishRevision({
    revisionId: valid.revision_id,
    actorId: 'actor_author',
  });

  const invalid = store.createDraft(temporary('store.special_hours', {
    effectType: 'SPECIAL_HOURS',
    effectValue: { intervals: [{ open: '11:00', close: '18:00' }] },
    effectiveFromUtc: '2026-10-01T21:00:00Z',
    expiresAtUtc: '2026-10-02T15:00:00Z',
  }));
  assert.throws(
    () => store.publishRevision({
      revisionId: invalid.revision_id,
      actorId: 'actor_author',
    }),
    error => error.code === 'KNOWLEDGE_SPECIAL_HOURS_CIVIL_DAY_REQUIRED'
  );
  store.close();
});
test('replacement publish and predecessor SUPERSEDED are atomic and compatible', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();

  const first = store.createDraft(baseline());
  store.approveRevision({
    revisionId: first.revision_id,
    actorId: 'actor_reviewer',
  });
  store.publishRevision({
    revisionId: first.revision_id,
    actorId: 'actor_publisher',
  });

  const next = store.createDraft(baseline({
    effectValue: { monday: [{ open: '09:00', close: '19:00' }] },
    parentRevisionId: first.revision_id,
  }));
  store.approveRevision({
    revisionId: next.revision_id,
    actorId: 'actor_reviewer',
  });
  const result = store.publishRevision({
    revisionId: next.revision_id,
    actorId: 'actor_publisher',
    supersedeRevisionId: first.revision_id,
  });

  assert.equal(result.published.event_type, 'PUBLISHED');
  assert.equal(result.superseded.event_type, 'SUPERSEDED');
  assert.deepEqual(
    store.eventsForRevision(first.revision_id).map(x => x.event_type),
    ['DRAFT_CREATED', 'APPROVED', 'PUBLISHED', 'SUPERSEDED']
  );
  assert.deepEqual(
    JSON.parse(store.eventsForRevision(first.revision_id).at(-1).metadata_json),
    { successor_revision_id: next.revision_id }
  );
  assert.equal(store.verifyLedger().revisions, 2);
  store.close();
});
test('supersession boundary mismatch is rejected before successor publication', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  const first = store.createDraft(baseline());
  store.approveRevision({ revisionId: first.revision_id, actorId: 'actor_reviewer' });
  store.publishRevision({ revisionId: first.revision_id, actorId: 'actor_publisher' });

  const other = store.createDraft(baseline({
    namespace: 'store.address',
    effectFamily: 'store.identity',
    effectType: 'ADDRESS',
    effectValue: { city: 'Kyiv' },
  }));
  store.approveRevision({ revisionId: other.revision_id, actorId: 'actor_reviewer' });
  assert.throws(
    () => store.publishRevision({
      revisionId: other.revision_id,
      actorId: 'actor_publisher',
      supersedeRevisionId: first.revision_id,
    }),
    error => error.code === 'KNOWLEDGE_SUPERSESSION_BOUNDARY_MISMATCH'
  );
  assert.deepEqual(
    store.eventsForRevision(other.revision_id).map(x => x.event_type),
    ['DRAFT_CREATED', 'APPROVED']
  );
  store.close();
});
test('second event failure rolls back both replacement publication events', t => {
  let eventSeq = 0;
  const ids = [
    'ke_draft_1', 'ke_approve_1', 'ke_publish_1',
    'ke_draft_2', 'ke_approve_2',
    'ke_publish_2', 'ke_publish_2',
  ];
  const f = fixture({ eventFactory: () => ids[eventSeq++] });
  t.after(f.cleanup);
  const store = f.store();

  const first = store.createDraft(baseline());
  store.approveRevision({ revisionId: first.revision_id, actorId: 'reviewer' });
  store.publishRevision({ revisionId: first.revision_id, actorId: 'publisher' });
  const next = store.createDraft(baseline({
    effectValue: { monday: [{ open: '09:00', close: '19:00' }] },
  }));
  store.approveRevision({ revisionId: next.revision_id, actorId: 'reviewer' });

  assert.throws(() => store.publishRevision({
    revisionId: next.revision_id,
    actorId: 'publisher',
    supersedeRevisionId: first.revision_id,
  }));
  assert.deepEqual(
    store.eventsForRevision(next.revision_id).map(x => x.event_type),
    ['DRAFT_CREATED', 'APPROVED']
  );
  assert.deepEqual(
    store.eventsForRevision(first.revision_id).map(x => x.event_type),
    ['DRAFT_CREATED', 'APPROVED', 'PUBLISHED']
  );
  assert.equal(store.verifyLedger().events, 5);
  store.close();
});
test('reopen rejects cryptographically valid CommercePolicy self-approval', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  const rev = store.createDraft(commerce({ authorActorId: 'actor_admin' }));
  const first = store.eventsForRevision(rev.revision_id)[0];
  store.close();

  const event = {
    event_id: 'ke_manual_self_approval',
    event_seq: 2,
    revision_id: rev.revision_id,
    event_type: 'APPROVED',
    actor_id: 'actor_admin',
    occurred_at_utc: '2026-10-02T07:00:10.000Z',
    reason: 'manual invalid approval',
    metadata_json: { role: 'KNOWLEDGE_ADMIN' },
    previous_event_hash: first.event_hash,
  };
  const raw = new DatabaseSync(f.file);
  raw.prepare(`
    INSERT INTO knowledge_events(
      event_seq,event_id,revision_id,event_type,actor_id,occurred_at_utc,
      reason,metadata_json,previous_event_hash,event_hash
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
  `).run(
    event.event_seq,
    event.event_id,
    event.revision_id,
    event.event_type,
    event.actor_id,
    event.occurred_at_utc,
    event.reason,
    '{"role":"KNOWLEDGE_ADMIN"}',
    event.previous_event_hash,
    knowledgeSha256(event)
  );
  raw.close();

  assert.throws(
    () => KnowledgeStore.openExisting(f.file, f.config),
    error => error.code === 'KNOWLEDGE_SELF_APPROVAL_FORBIDDEN'
  );
});


test('store.special_hours accepts 23-hour and 25-hour Europe/Kyiv civil days', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();

  const spring = store.createDraft(temporary('store.special_hours', {
    effectType: 'SPECIAL_HOURS',
    effectValue: { intervals: [{ open: '11:00', close: '18:00' }] },
    effectiveFromUtc: '2026-03-28T22:00:00Z',
    expiresAtUtc: '2026-03-29T21:00:00Z',
  }));
  store.publishRevision({
    revisionId: spring.revision_id,
    actorId: 'actor_author',
  });

  const autumn = store.createDraft(temporary('store.special_hours', {
    effectType: 'SPECIAL_HOURS',
    effectValue: { intervals: [{ open: '11:00', close: '18:00' }] },
    effectiveFromUtc: '2026-10-24T21:00:00Z',
    expiresAtUtc: '2026-10-25T22:00:00Z',
  }));
  store.publishRevision({
    revisionId: autumn.revision_id,
    actorId: 'actor_author',
  });

  assert.deepEqual(
    store.eventsForRevision(spring.revision_id).map(x => x.event_type),
    ['DRAFT_CREATED', 'PUBLISHED']
  );
  assert.deepEqual(
    store.eventsForRevision(autumn.revision_id).map(x => x.event_type),
    ['DRAFT_CREATED', 'PUBLISHED']
  );
  store.close();
});

test('restore verifier rejects cryptographically valid PUBLISHED without required approval', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  const rev = store.createDraft(baseline());
  const first = store.eventsForRevision(rev.revision_id)[0];
  store.close();

  const event = {
    event_id: 'ke_manual_unapproved_publish',
    event_seq: 2,
    revision_id: rev.revision_id,
    event_type: 'PUBLISHED',
    actor_id: 'actor_publisher',
    occurred_at_utc: '2026-10-02T07:00:10.000Z',
    reason: 'manual invalid publish',
    metadata_json: {},
    previous_event_hash: first.event_hash,
  };
  const raw = new DatabaseSync(f.file);
  raw.prepare(`
    INSERT INTO knowledge_events(
      event_seq,event_id,revision_id,event_type,actor_id,occurred_at_utc,
      reason,metadata_json,previous_event_hash,event_hash
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
  `).run(
    event.event_seq,
    event.event_id,
    event.revision_id,
    event.event_type,
    event.actor_id,
    event.occurred_at_utc,
    event.reason,
    '{}',
    event.previous_event_hash,
    knowledgeSha256(event)
  );
  raw.close();

  assert.throws(
    () => KnowledgeStore.openExisting(f.file, f.config),
    error => error.code === 'KNOWLEDGE_APPROVAL_REQUIRED'
  );
});

test('write path revalidates existing ledger before appending new authority', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  const rev = store.createDraft(baseline());
  const first = store.eventsForRevision(rev.revision_id)[0];

  const event = {
    event_id: 'ke_external_unapproved_publish',
    event_seq: 2,
    revision_id: rev.revision_id,
    event_type: 'PUBLISHED',
    actor_id: 'external_writer',
    occurred_at_utc: '2026-10-02T07:00:10.000Z',
    reason: 'external invalid publish',
    metadata_json: {},
    previous_event_hash: first.event_hash,
  };
  const raw = new DatabaseSync(f.file);
  raw.prepare(`
    INSERT INTO knowledge_events(
      event_seq,event_id,revision_id,event_type,actor_id,occurred_at_utc,
      reason,metadata_json,previous_event_hash,event_hash
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
  `).run(
    event.event_seq,
    event.event_id,
    event.revision_id,
    event.event_type,
    event.actor_id,
    event.occurred_at_utc,
    event.reason,
    '{}',
    event.previous_event_hash,
    knowledgeSha256(event)
  );
  raw.close();

  assert.throws(
    () => store.createDraft(baseline({
      namespace: 'store.phone',
      effectFamily: 'store.identity',
      effectType: 'PHONE',
      effectValue: { e164: '+380000000000' },
    })),
    error => error.code === 'KNOWLEDGE_APPROVAL_REQUIRED'
  );
  assert.equal(store.stats().revisions, 1);
  assert.equal(store.stats().events, 2);
  store.close();
});
