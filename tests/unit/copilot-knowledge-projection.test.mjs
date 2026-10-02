import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { knowledgeSha256 } from '../../src/copilot/knowledge/canonical.mjs';
import { KnowledgeStore } from '../../src/copilot/knowledge/store.mjs';
import { projectActiveKnowledge } from '../../src/copilot/knowledge/projection.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-knowledge-a5a-'));
  const file = path.join(root, 'knowledge.sqlite');
  let revisionSeq = 0;
  let eventSeq = 0;
  let clock = 0;
  const config = {
    now: () => new Date(Date.UTC(2026, 9, 2, 8, 0, clock++)).toISOString(),
    idFactory: {
      revision: () => `kr_proj_${++revisionSeq}`,
      event: () => `ke_proj_${++eventSeq}`,
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
    expiresAtUtc: null,
    authorActorId: 'author',
    ...overrides,
  };
}

function publishReviewed(store, input) {
  const rev = store.createDraft(input);
  store.approveRevision({ revisionId: rev.revision_id, actorId: 'reviewer' });
  store.publishRevision({ revisionId: rev.revision_id, actorId: 'publisher' });
  return rev;
}

function direct(store, overrides = {}) {
  const rev = store.createDraft(baseline({
    namespace: 'store.temporary_closure',
    effectFamily: 'store.operating_state',
    effectType: 'STATUS',
    effectValue: { status: 'CLOSED' },
    effectiveFromUtc: '2026-10-02T10:00:00Z',
    expiresAtUtc: '2026-10-02T12:00:00Z',
    ...overrides,
  }));
  store.publishRevision({ revisionId: rev.revision_id, actorId: 'operator' });
  return rev;
}
test('open-ended PUBLISHED baseline is active after effective_from', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  const rev = publishReviewed(store, baseline());

  const projection = projectActiveKnowledge(store, {
    nowUtc: '2026-10-02T09:00:00Z',
    subjectType: 'store',
    subjectId: 'store_1',
  });

  assert.deepEqual(projection.active.map(x => x.revision_id), [rev.revision_id]);
  assert.equal(projection.conflicts.length, 0);
  store.close();
});

test('finite overlay uses half-open expiry and baseline remains independently active', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  const base = publishReviewed(store, baseline());
  const overlay = direct(store);

  const before = projectActiveKnowledge(store, {
    nowUtc: '2026-10-02T11:59:59.999Z',
    subjectType: 'store',
    subjectId: 'store_1',
  });
  assert.deepEqual(
    before.active.map(x => x.revision_id).sort(),
    [base.revision_id, overlay.revision_id].sort()
  );

  const boundary = projectActiveKnowledge(store, {
    nowUtc: '2026-10-02T12:00:00Z',
    subjectType: 'store',
    subjectId: 'store_1',
  });
  assert.deepEqual(boundary.active.map(x => x.revision_id), [base.revision_id]);
  store.close();
});
test('REVOKED and SUPERSEDED revisions are excluded from active authority', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();

  const old = publishReviewed(store, baseline());
  const next = store.createDraft(baseline({
    effectValue: { monday: [{ open: '09:00', close: '19:00' }] },
  }));
  store.approveRevision({ revisionId: next.revision_id, actorId: 'reviewer' });
  store.publishRevision({
    revisionId: next.revision_id,
    actorId: 'publisher',
    supersedeRevisionId: old.revision_id,
  });

  const overlay = direct(store);
  store.revokeRevision({ revisionId: overlay.revision_id, actorId: 'operator' });

  const projection = projectActiveKnowledge(store, {
    nowUtc: '2026-10-02T11:00:00Z',
    subjectType: 'store',
    subjectId: 'store_1',
  });

  assert.deepEqual(projection.active.map(x => x.revision_id), [next.revision_id]);
  store.close();
});

test('peer conflict is detected across namespaces by subject + effect_family', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  direct(store, {
    namespace: 'store.temporary_closure',
    effectValue: { status: 'CLOSED' },
  });
  direct(store, {
    namespace: 'store.status_override',
    effectValue: { status: 'OPEN' },
  });

  const projection = projectActiveKnowledge(store, {
    nowUtc: '2026-10-02T11:00:00Z',
    subjectType: 'store',
    subjectId: 'store_1',
  });

  assert.equal(projection.active.length, 2);
  assert.equal(projection.conflicts.length, 1);
  assert.equal(projection.conflicts[0].code, 'POLICY_CONFLICT');
  assert.equal(projection.conflicts[0].effect_family, 'store.operating_state');
  assert.deepEqual(
    projection.conflicts[0].revisions.map(x => x.namespace).sort(),
    ['store.status_override', 'store.temporary_closure']
  );
  store.close();
});
test('same canonical effect in same family is not a conflict and other subjects are isolated', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  direct(store, {
    namespace: 'store.temporary_closure',
    effectValue: { status: 'CLOSED' },
  });
  direct(store, {
    namespace: 'store.status_override',
    effectValue: { status: 'CLOSED' },
  });
  direct(store, {
    namespace: 'store.status_override',
    subjectId: 'store_2',
    effectValue: { status: 'OPEN' },
  });

  const projection = projectActiveKnowledge(store, {
    nowUtc: '2026-10-02T11:00:00Z',
    subjectType: 'store',
    subjectId: 'store_1',
  });

  assert.equal(projection.active.length, 2);
  assert.equal(projection.conflicts.length, 0);
  assert.ok(projection.active.every(x => x.subject_id === 'store_1'));
  store.close();
});

test('projection fails closed when current ledger was manually made semantically invalid', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  const rev = store.createDraft(baseline());
  const first = store.eventsForRevision(rev.revision_id)[0];

  const event = {
    event_id: 'ke_manual_projection_invalid',
    event_seq: 2,
    revision_id: rev.revision_id,
    event_type: 'PUBLISHED',
    actor_id: 'external',
    occurred_at_utc: '2026-10-02T08:00:10.000Z',
    reason: 'invalid manual publish',
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
    () => projectActiveKnowledge(store, {
      nowUtc: '2026-10-02T09:00:00Z',
      subjectType: 'store',
      subjectId: 'store_1',
    }),
    error => error.code === 'KNOWLEDGE_APPROVAL_REQUIRED'
  );
  store.close();
});


test('parent_revision_id lineage alone does not deactivate published predecessor', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  const first = publishReviewed(store, baseline());
  const child = store.createDraft(baseline({
    effectValue: { monday: [{ open: '09:00', close: '19:00' }] },
    parentRevisionId: first.revision_id,
  }));

  const projection = projectActiveKnowledge(store, {
    nowUtc: '2026-10-02T09:00:00Z',
    subjectType: 'store',
    subjectId: 'store_1',
  });

  assert.deepEqual(projection.active.map(x => x.revision_id), [first.revision_id]);
  assert.equal(store.getRevision(child.revision_id).parent_revision_id, first.revision_id);
  store.close();
});

test('namespace filter is explicit and does not alter conflict semantics', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  direct(store, {
    namespace: 'store.temporary_closure',
    effectValue: { status: 'CLOSED' },
  });
  direct(store, {
    namespace: 'store.status_override',
    effectValue: { status: 'OPEN' },
  });

  const onlyClosure = projectActiveKnowledge(store, {
    nowUtc: '2026-10-02T11:00:00Z',
    subjectType: 'store',
    subjectId: 'store_1',
    namespaces: ['store.temporary_closure'],
  });

  assert.equal(onlyClosure.active.length, 1);
  assert.equal(onlyClosure.active[0].namespace, 'store.temporary_closure');
  assert.equal(onlyClosure.conflicts.length, 0);
  store.close();
});
