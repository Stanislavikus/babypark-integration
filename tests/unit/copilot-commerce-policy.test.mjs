import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  knowledgeSha256,
  parseCanonicalKnowledgeJson,
} from '../../src/copilot/knowledge/canonical.mjs';
import { KnowledgeStore } from '../../src/copilot/knowledge/store.mjs';
import {
  isStrictCommerceScopeNarrowing,
  resolveCommercePolicy,
} from '../../src/copilot/knowledge/commerce-policy.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-commerce-a5b-'));
  const file = path.join(root, 'knowledge.sqlite');
  let revisionSeq = 0;
  let eventSeq = 0;
  let clock = 0;
  const config = {
    now: () => new Date(Date.UTC(2026, 9, 2, 9, 0, clock++)).toISOString(),
    idFactory: {
      revision: () => `kr_com_${++revisionSeq}`,
      event: () => `ke_com_${++eventSeq}`,
    },
  };
  return {
    store: () => KnowledgeStore.createNew(file, config),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function policy(overrides = {}) {
  return {
    recordType: 'COMMERCE_POLICY',
    namespace: 'commerce.prepayment',
    effectFamily: 'commerce.prepayment',
    subjectType: 'business',
    subjectId: 'babypark',
    scope: {},
    effectType: 'PREPAYMENT',
    effectValue: { amount_minor: 200000, currency: 'UAH' },
    effectiveFromUtc: '2026-10-01T00:00:00Z',
    expiresAtUtc: null,
    authorActorId: 'author',
    ...overrides,
  };
}

function publish(store, draft) {
  const rev = store.createDraft(draft);
  store.approveRevision({ revisionId: rev.revision_id, actorId: 'reviewer' });
  store.publishRevision({ revisionId: rev.revision_id, actorId: 'publisher' });
  return rev;
}

test('E01 strict narrower exact-binding scope is accepted', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  const parent = publish(store, policy({ scope: { category_id: 'furniture' } }));
  const child = store.createDraft(policy({
    scope: { category_id: 'furniture', brand_id: 'Veres' },
    exceptionOfRevisionId: parent.revision_id,
    effectValue: { amount_minor: 30000, currency: 'UAH' },
  }));
  assert.equal(store.getRevision(child.revision_id).exception_of_revision_id, parent.revision_id);
  store.close();
});

test('E02/E03/E05 invalid scope relations are rejected atomically', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  const parent = publish(store, policy({
    scope: { category_id: 'furniture', brand_id: 'Veres' },
  }));

  for (const scope of [
    { category_id: 'furniture', brand_id: 'Veres' },
    { brand_id: 'Veres', product_id: 'p1' },
    { category_id: 'furniture' },
  ]) {
    assert.throws(
      () => store.createDraft(policy({
        scope,
        exceptionOfRevisionId: parent.revision_id,
        effectValue: { amount_minor: 30000, currency: 'UAH' },
      })),
      error => error.code === 'COMMERCE_EXCEPTION_SCOPE_NOT_NARROWER'
    );
  }
  assert.equal(store.stats().revisions, 1);
  store.close();
});

test('E04 category descendants are not implicit narrowing', () => {
  assert.equal(
    isStrictCommerceScopeNarrowing(
      { category_id: 'parent-category' },
      { category_id: 'child-category', brand_id: 'Veres' }
    ),
    false
  );
});

test('E06/E07 exception temporal interval must be subset of parent', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  const parent = publish(store, policy({
    scope: { category_id: 'furniture' },
    effectiveFromUtc: '2026-10-01T00:00:00Z',
    expiresAtUtc: '2026-10-31T00:00:00Z',
  }));

  const valid = store.createDraft(policy({
    scope: { category_id: 'furniture', brand_id: 'Veres' },
    effectiveFromUtc: '2026-10-05T00:00:00Z',
    expiresAtUtc: '2026-10-20T00:00:00Z',
    exceptionOfRevisionId: parent.revision_id,
  }));
  assert.ok(valid.revision_id);

  assert.throws(
    () => store.createDraft(policy({
      scope: { category_id: 'furniture', product_id: 'p1' },
      effectiveFromUtc: '2026-09-30T00:00:00Z',
      expiresAtUtc: '2026-10-20T00:00:00Z',
      exceptionOfRevisionId: parent.revision_id,
    })),
    error => error.code === 'COMMERCE_EXCEPTION_INTERVAL_NOT_SUBSET'
  );
  assert.throws(
    () => store.createDraft(policy({
      scope: { category_id: 'furniture', product_id: 'p2' },
      effectiveFromUtc: '2026-10-05T00:00:00Z',
      expiresAtUtc: null,
      exceptionOfRevisionId: parent.revision_id,
    })),
    error => error.code === 'COMMERCE_EXCEPTION_INTERVAL_NOT_SUBSET'
  );
  store.close();
});

test('resolver uses explicit applicable exception and suppresses its parent only', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  const parent = publish(store, policy({
    scope: { category_id: 'furniture' },
    effectValue: { amount_minor: 200000, currency: 'UAH' },
  }));
  const child = publish(store, policy({
    scope: { category_id: 'furniture', brand_id: 'Veres' },
    effectValue: { amount_minor: 30000, currency: 'UAH' },
    exceptionOfRevisionId: parent.revision_id,
  }));

  const result = resolveCommercePolicy(store, {
    nowUtc: '2026-10-02T10:00:00Z',
    subjectType: 'business',
    subjectId: 'babypark',
    effectFamily: 'commerce.prepayment',
    bindings: { category_id: 'furniture', brand_id: 'Veres' },
  });
  assert.equal(result.status, 'RESOLVED');
  assert.deepEqual(result.effect_value, { amount_minor: 30000, currency: 'UAH' });
  assert.deepEqual(result.revisions, [child.revision_id]);
  store.close();
});

test('different applicable effects without explicit exception fail closed', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  publish(store, policy({
    scope: { category_id: 'furniture' },
    effectValue: { amount_minor: 200000, currency: 'UAH' },
  }));
  publish(store, policy({
    scope: { category_id: 'furniture', brand_id: 'Veres' },
    effectValue: { amount_minor: 30000, currency: 'UAH' },
  }));

  const result = resolveCommercePolicy(store, {
    nowUtc: '2026-10-02T10:00:00Z',
    subjectType: 'business',
    subjectId: 'babypark',
    effectFamily: 'commerce.prepayment',
    bindings: { category_id: 'furniture', brand_id: 'Veres' },
  });
  assert.equal(result.status, 'POLICY_CONFLICT');
  assert.equal(result.revisions.length, 2);
  store.close();
});

test('equal applicable canonical effects are compatible', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  publish(store, policy({ scope: {} }));
  publish(store, policy({ scope: { category_id: 'furniture' } }));

  const result = resolveCommercePolicy(store, {
    nowUtc: '2026-10-02T10:00:00Z',
    subjectType: 'business',
    subjectId: 'babypark',
    effectFamily: 'commerce.prepayment',
    bindings: { category_id: 'furniture' },
  });
  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.revisions.length, 2);
  store.close();
});

test('resolver returns POLICY_NOT_FOUND when no scope applies', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  publish(store, policy({ scope: { category_id: 'furniture' } }));

  const result = resolveCommercePolicy(store, {
    nowUtc: '2026-10-02T10:00:00Z',
    subjectType: 'business',
    subjectId: 'babypark',
    effectFamily: 'commerce.prepayment',
    bindings: { category_id: 'strollers' },
  });
  assert.equal(result.status, 'POLICY_NOT_FOUND');
  store.close();
});

test('unknown scope binding is rejected before immutable insert', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  assert.throws(
    () => store.createDraft(policy({ scope: { category_id: 'x', priority: '1' } })),
    error => error.code === 'COMMERCE_SCOPE_KEY_UNSUPPORTED'
  );
  assert.equal(store.stats().revisions, 0);
  store.close();
});


function revisionHashFromRow(row) {
  return knowledgeSha256({
    revision_id: row.revision_id,
    record_type: row.record_type,
    schema_version: row.schema_version,
    namespace: row.namespace,
    effect_family: row.effect_family,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    scope_json: parseCanonicalKnowledgeJson(row.scope_json, 'scope_json'),
    effect_type: row.effect_type,
    effect_value_json: parseCanonicalKnowledgeJson(
      row.effect_value_json,
      'effect_value_json'
    ),
    effective_from_utc: row.effective_from_utc,
    expires_at_utc: row.expires_at_utc,
    parent_revision_id: row.parent_revision_id,
    exception_of_revision_id: row.exception_of_revision_id,
    author_actor_id: row.author_actor_id,
    created_at_utc: row.created_at_utc,
  });
}

test('E08 restore rejects a cryptographically valid exception cycle', t => {
  const f = fixture(); t.after(f.cleanup);
  const store = f.store();
  const a = store.createDraft(policy({
    scope: { category_id: 'furniture' },
  }));
  const b = store.createDraft(policy({
    scope: { category_id: 'furniture', brand_id: 'Veres' },
  }));
  const file = store.filePath;
  store.close();

  const raw = new DatabaseSync(file);
  raw.exec('DROP TRIGGER knowledge_revisions_no_update');

  for (const [id, parentId] of [
    [a.revision_id, b.revision_id],
    [b.revision_id, a.revision_id],
  ]) {
    raw.prepare(
      'UPDATE knowledge_revisions SET exception_of_revision_id=? WHERE revision_id=?'
    ).run(parentId, id);
    const row = raw.prepare(
      'SELECT * FROM knowledge_revisions WHERE revision_id=?'
    ).get(id);
    raw.prepare(
      'UPDATE knowledge_revisions SET revision_hash=? WHERE revision_id=?'
    ).run(revisionHashFromRow(row), id);
  }
  raw.close();

  assert.throws(
    () => KnowledgeStore.openExisting(file, {
      now: () => '2026-10-02T09:10:00.000Z',
      idFactory: {
        revision: () => 'unused',
        event: () => 'unused',
      },
    }),
    error => error.code === 'COMMERCE_EXCEPTION_CYCLE'
  );
});
