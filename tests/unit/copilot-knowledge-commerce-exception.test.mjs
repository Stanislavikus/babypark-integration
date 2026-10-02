import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { knowledgeSha256 } from '../../src/copilot/knowledge/canonical.mjs';
import { KnowledgeStore } from '../../src/copilot/knowledge/store.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-knowledge-commerce-ex-'));
  const file = path.join(root, 'knowledge.sqlite');
  let revisionSeq = 0;
  let eventSeq = 0;
  let clock = 0;
  const config = {
    now: () => new Date(Date.UTC(2026, 9, 2, 9, 0, clock++)).toISOString(),
    idFactory: {
      revision: () => `kr_ce_${++revisionSeq}`,
      event: () => `ke_ce_${++eventSeq}`,
    },
  };
  return {
    root,
    file,
    config,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function commerce(scope, overrides = {}) {
  return {
    recordType: 'COMMERCE_POLICY',
    namespace: 'commerce.prepayment',
    effectFamily: 'commerce.prepayment',
    subjectType: 'business',
    subjectId: 'babypark',
    scope,
    effectType: 'PREPAYMENT',
    effectValue: { amount_minor: 200000, currency: 'UAH' },
    effectiveFromUtc: '2026-01-01T00:00:00Z',
    expiresAtUtc: null,
    authorActorId: 'actor_author',
    ...overrides,
  };
}

function revisionHash(row) {
  return knowledgeSha256({
    revision_id: row.revision_id,
    record_type: row.record_type,
    schema_version: row.schema_version,
    namespace: row.namespace,
    effect_family: row.effect_family,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    scope_json: JSON.parse(row.scope_json),
    effect_type: row.effect_type,
    effect_value_json: JSON.parse(row.effect_value_json),
    effective_from_utc: row.effective_from_utc,
    expires_at_utc: row.expires_at_utc,
    parent_revision_id: row.parent_revision_id,
    exception_of_revision_id: row.exception_of_revision_id,
    author_actor_id: row.author_actor_id,
    created_at_utc: row.created_at_utc,
  });
}

test('invalid equal-scope exception is rejected atomically before revision/event insert', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = KnowledgeStore.createNew(f.file, f.config);
  const parent = store.createDraft(commerce({ category_id: 'furniture' }));
  assert.throws(() => store.createDraft(commerce(
    { category_id: 'furniture' },
    { exceptionOfRevisionId: parent.revision_id }
  )), error => error.code === 'COMMERCE_EXCEPTION_SCOPE_NOT_STRICTLY_NARROWER');
  assert.deepEqual(store.stats(), {
    revisions: 1,
    events: 1,
    event_head_hash: parent.event_hash,
  });
  store.close();
});

test('valid strict Commerce exception is persisted and survives ledger verification', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = KnowledgeStore.createNew(f.file, f.config);
  const parent = store.createDraft(commerce({ category_id: 'furniture' }));
  const child = store.createDraft(commerce(
    { category_id: 'furniture', brand_id: 'Veres' },
    {
      exceptionOfRevisionId: parent.revision_id,
      effectiveFromUtc: '2026-02-01T00:00:00Z',
    }
  ));
  assert.equal(
    store.getRevision(child.revision_id).exception_of_revision_id,
    parent.revision_id
  );
  assert.equal(store.verifyLedger().revisions, 2);
  store.close();
  KnowledgeStore.openExisting(f.file, f.config).close();
});

test('restore verification rejects cryptographically valid missing exception parent', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = KnowledgeStore.createNew(f.file, f.config);
  const rev = store.createDraft(commerce({ category_id: 'furniture' }));
  store.close();

  const raw = new DatabaseSync(f.file);
  raw.exec('DROP TRIGGER knowledge_revisions_no_update');
  raw.prepare(
    'UPDATE knowledge_revisions SET exception_of_revision_id=? WHERE revision_id=?'
  ).run('kr_missing', rev.revision_id);
  const row = raw.prepare(
    'SELECT * FROM knowledge_revisions WHERE revision_id=?'
  ).get(rev.revision_id);
  raw.prepare(
    'UPDATE knowledge_revisions SET revision_hash=? WHERE revision_id=?'
  ).run(revisionHash(row), rev.revision_id);
  raw.close();

  assert.throws(
    () => KnowledgeStore.openExisting(f.file, f.config),
    error => error.code === 'COMMERCE_EXCEPTION_PARENT_MISSING'
  );
});

test('restore verification rejects cryptographically valid exception cycle', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = KnowledgeStore.createNew(f.file, f.config);
  const a = store.createDraft(commerce({}));
  const b = store.createDraft(commerce(
    { category_id: 'furniture' },
    { exceptionOfRevisionId: a.revision_id }
  ));
  store.close();

  const raw = new DatabaseSync(f.file);
  raw.exec('DROP TRIGGER knowledge_revisions_no_update');
  raw.prepare(
    'UPDATE knowledge_revisions SET exception_of_revision_id=? WHERE revision_id=?'
  ).run(b.revision_id, a.revision_id);
  for (const id of [a.revision_id, b.revision_id]) {
    const row = raw.prepare(
      'SELECT * FROM knowledge_revisions WHERE revision_id=?'
    ).get(id);
    raw.prepare(
      'UPDATE knowledge_revisions SET revision_hash=? WHERE revision_id=?'
    ).run(revisionHash(row), id);
  }
  raw.close();

  assert.throws(
    () => KnowledgeStore.openExisting(f.file, f.config),
    error => error.code === 'COMMERCE_EXCEPTION_CYCLE'
  );
});
