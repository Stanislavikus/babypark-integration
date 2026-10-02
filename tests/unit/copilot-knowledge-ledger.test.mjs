import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  canonicalKnowledgeJson,
  knowledgeSha256,
} from '../../src/copilot/knowledge/canonical.mjs';
import {
  KnowledgeStore,
} from '../../src/copilot/knowledge/store.mjs';

function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-knowledge-a4a-'));
  const file = path.join(root, 'knowledge.sqlite');
  let revisionSeq = 0;
  let eventSeq = 0;
  let clock = 0;
  const config = {
    now: () => new Date(Date.UTC(2026, 9, 2, 6, 0, clock++)).toISOString(),
    idFactory: {
      revision: () => `kr_test_${++revisionSeq}`,
      event: () => `ke_test_${++eventSeq}`,
    },
    ...options,
  };
  return { root, file, config, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
function draft(overrides = {}) {
  return {
    recordType: 'OPERATIONAL_FACT',
    schemaVersion: 1,
    namespace: 'store.weekly_hours',
    effectFamily: 'store.hours',
    subjectType: 'store',
    subjectId: 'store_test_1',
    scope: { locale: 'uk-UA' },
    effectType: 'WEEKLY_HOURS',
    effectValue: { monday: [{ open: '10:00', close: '20:00' }] },
    effectiveFromUtc: '2026-10-01T00:00:00Z',
    expiresAtUtc: null,
    authorActorId: 'actor_olga',
    reason: 'initial reviewed draft',
    metadata: { source: 'operator' },
    ...overrides,
  };
}

test('BabyPark canonical JSON v1 is stable and forbids floating numbers', () => {
  const value = { z: 1, a: [3, { b: null, a: true }] };
  const json = canonicalKnowledgeJson(value);
  assert.equal(json, '{"a":[3,{"a":true,"b":null}],"z":1}');
  assert.equal(
    knowledgeSha256(value),
    '630c3d279127032b01130068437e2884b9082d413bbe111fe67d86e2b5b21dbc'
  );
  assert.throws(() => canonicalKnowledgeJson({ x: 1.5 }), /safe integer/);
  assert.throws(() => canonicalKnowledgeJson({ x: undefined }), /undefined/);
});
test('create/open establishes private durable schema and empty verified ledger', t => {
  const f = fixture();
  t.after(f.cleanup);
  const store = KnowledgeStore.createNew(f.file, f.config);
  assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
  assert.equal(store.metadata().schema_version, 1);
  assert.deepEqual(store.verifyLedger(), {
    ok: true,
    revisions: 0,
    events: 0,
    event_head_hash: null,
  });
  store.close();

  const reopened = KnowledgeStore.openExisting(f.file, f.config);
  assert.equal(reopened.stats().revisions, 0);
  reopened.close();
});

test('draft creation atomically stores immutable revision and first chained event', t => {
  const f = fixture();
  t.after(f.cleanup);
  const store = KnowledgeStore.createNew(f.file, f.config);
  const created = store.createDraft(draft({
    scope: { z: 2, a: 1 },
    effectValue: { z: 9, a: [1, 2] },
  }));
  assert.equal(created.revision_id, 'kr_test_1');
  assert.equal(created.event_id, 'ke_test_1');
  assert.equal(created.event_seq, 1);
  const row = store.getRevision(created.revision_id);
  assert.equal(row.scope_json, '{"a":1,"z":2}');
  assert.equal(row.effect_value_json, '{"a":[1,2],"z":9}');
  assert.match(row.revision_hash, /^[a-f0-9]{64}$/);

  const events = store.eventsForRevision(created.revision_id);
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, 'DRAFT_CREATED');
  assert.equal(events[0].actor_id, row.author_actor_id);
  assert.equal(events[0].previous_event_hash, null);
  assert.equal(events[0].event_hash, created.event_hash);
  assert.deepEqual(store.verifyLedger(), {
    ok: true,
    revisions: 1,
    events: 1,
    event_head_hash: created.event_hash,
  });
  store.close();
});

test('global event chain spans revisions and parent lineage changes no prior row', t => {
  const f = fixture();
  t.after(f.cleanup);
  const store = KnowledgeStore.createNew(f.file, f.config);
  const first = store.createDraft(draft());
  const before = { ...store.getRevision(first.revision_id) };
  const second = store.createDraft(draft({
    namespace: 'store.address',
    effectFamily: 'store.identity',
    effectType: 'ADDRESS',
    effectValue: { city: 'Kyiv' },
    parentRevisionId: first.revision_id,
  }));
  const secondEvent = store.eventsForRevision(second.revision_id)[0];
  assert.equal(second.event_seq, 2);
  assert.equal(secondEvent.previous_event_hash, first.event_hash);
  assert.equal(store.getRevision(second.revision_id).parent_revision_id, first.revision_id);
  assert.deepEqual({ ...store.getRevision(first.revision_id) }, before);
  assert.equal(store.verifyLedger().events, 2);
  store.close();
});

test('SQLite triggers reject revision/event update and delete', t => {
  const f = fixture();
  t.after(f.cleanup);
  const store = KnowledgeStore.createNew(f.file, f.config);
  store.createDraft(draft());
  assert.throws(
    () => store.db.prepare("UPDATE knowledge_revisions SET namespace='x'").run(),
    /knowledge_revisions_immutable/
  );
  assert.throws(
    () => store.db.prepare('DELETE FROM knowledge_revisions').run(),
    /knowledge_revisions_immutable/
  );
  assert.throws(
    () => store.db.prepare("UPDATE knowledge_events SET actor_id='x'").run(),
    /knowledge_events_append_only/
  );
  assert.throws(
    () => store.db.prepare('DELETE FROM knowledge_events').run(),
    /knowledge_events_append_only/
  );
  assert.equal(store.verifyLedger().revisions, 1);
  store.close();
});

test('invalid lineage/time rejects atomically without orphan revision or event', t => {
  const f = fixture();
  t.after(f.cleanup);
  const store = KnowledgeStore.createNew(f.file, f.config);

  assert.throws(
    () => store.createDraft(draft({ parentRevisionId: 'kr_missing' })),
    error => error.code === 'KNOWLEDGE_PARENT_MISSING'
  );
  assert.deepEqual(store.stats(), {
    revisions: 0,
    events: 0,
    event_head_hash: null,
  });
  assert.throws(
    () => store.createDraft(draft({
      expiresAtUtc: '2026-09-30T00:00:00Z',
    })),
    /must be after/
  );
  assert.equal(store.stats().revisions, 0);
  store.close();
});
test('event-id collision rolls back the paired revision insert', t => {
  let revisionSeq = 0;
  const f = fixture({
    idFactory: {
      revision: () => `kr_collision_${++revisionSeq}`,
      event: () => 'ke_collision',
    },
  });
  t.after(f.cleanup);
  const store = KnowledgeStore.createNew(f.file, f.config);
  store.createDraft(draft());
  assert.throws(() => store.createDraft(draft({
    namespace: 'store.phone',
    effectFamily: 'store.identity',
    effectType: 'PHONE',
    effectValue: { e164: '+380000000000' },
  })));
  assert.equal(store.stats().revisions, 1);
  assert.equal(store.getRevision('kr_collision_2'), undefined);
  assert.equal(store.stats().events, 1);
  store.close();
});

test('read-only open rejects writes', t => {
  const f = fixture();
  t.after(f.cleanup);
  KnowledgeStore.createNew(f.file, f.config).close();
  const store = KnowledgeStore.openExisting(f.file, { ...f.config, readOnly: true });
  assert.throws(
    () => store.createDraft(draft()),
    error => error.code === 'KNOWLEDGE_READ_ONLY'
  );
  store.close();
});
test('reopen fails closed after out-of-band revision tamper', t => {
  const f = fixture();
  t.after(f.cleanup);
  const store = KnowledgeStore.createNew(f.file, f.config);
  store.createDraft(draft());
  store.close();

  const raw = new DatabaseSync(f.file);
  raw.exec('DROP TRIGGER knowledge_revisions_no_update');
  raw.prepare(
    "UPDATE knowledge_revisions SET effect_value_json=? WHERE revision_id=?"
  ).run('{"tampered":true}', 'kr_test_1');
  raw.close();

  assert.throws(
    () => KnowledgeStore.openExisting(f.file, f.config),
    error => error.code === 'KNOWLEDGE_REVISION_HASH_MISMATCH'
  );
});
