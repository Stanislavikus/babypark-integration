import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { KnowledgeStore } from '../../src/copilot/knowledge/store.mjs';
import { knowledgeSha256 } from '../../src/copilot/knowledge/canonical.mjs';
import {
  normalizeVocabularyPhrase,
  validateVocabularyRevision,
} from '../../src/copilot/knowledge/vocabulary-schema.mjs';
import {
  KNOWLEDGE_RESOLVER_CONTRACT_VERSION,
} from '../../src/copilot/knowledge/resolver-contract.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-vocabulary-'));
  const file = path.join(root, 'knowledge.sqlite');
  let revision = 0;
  let event = 0;
  let tick = 0;
  return {
    root,
    file,
    config: {
      now: () =>
        new Date(Date.UTC(2026, 9, 2, 9, 0, tick++)).toISOString(),
      idFactory: {
        revision: () => `kr_vocab_${++revision}`,
        event: () => `ke_vocab_${++event}`,
      },
    },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function categoryDraft(overrides = {}) {
  return {
    recordType: 'VOCABULARY_ENTRY',
    schemaVersion: 1,
    namespace: 'vocabulary.category',
    effectFamily: 'vocabulary.category_resolution',
    subjectType: 'phrase',
    subjectId: 'прогулочные коляски',
    scope: {},
    effectType: 'CATEGORY_BINDING',
    effectValue: {
      canonical_category_id: 'cat-strollers',
      match_mode: 'INCLUDE_DESCENDANTS',
    },
    effectiveFromUtc: '2026-10-01T00:00:00Z',
    expiresAtUtc: null,
    authorActorId: 'actor_editor',
    ...overrides,
  };
}

test('resolver contract version is explicit and stable', () => {
  assert.equal(KNOWLEDGE_RESOLVER_CONTRACT_VERSION, 1);
});

test('vocabulary phrase normalization is closed-world and deterministic', () => {
  assert.equal(
    normalizeVocabularyPhrase('  ПРОГУЛОЧНЫЕ\u00a0  КОЛЯСКИ  '),
    'прогулочные коляски'
  );
  assert.equal(normalizeVocabularyPhrase('Cybex'), 'cybex');
  assert.throws(() => normalizeVocabularyPhrase('   '), /non-empty|empty/);
  assert.throws(
    () => normalizeVocabularyPhrase('магазин\u0000а'),
    /non-empty|controls/
  );
});

test('valid category vocabulary is immutable reviewed Knowledge authority', t => {
  const f = fixture();
  t.after(f.cleanup);
  const store = KnowledgeStore.createNew(f.file, f.config);

  const created = store.createDraft(categoryDraft());
  assert.equal(store.stats().revisions, 1);
  assert.throws(
    () => store.publishRevision({
      revisionId: created.revision_id,
      actorId: 'actor_editor',
    }),
    error => error?.code === 'KNOWLEDGE_APPROVAL_REQUIRED'
  );

  store.approveRevision({
    revisionId: created.revision_id,
    actorId: 'actor_reviewer',
  });
  store.publishRevision({
    revisionId: created.revision_id,
    actorId: 'actor_reviewer',
  });

  const row = store.authoritySnapshot()[0];
  assert.equal(row.record_type, 'VOCABULARY_ENTRY');
  assert.equal(row.state, 'PUBLISHED');
  assert.equal(row.subject_id, 'прогулочные коляски');
  assert.deepEqual(row.effect_value, {
    canonical_category_id: 'cat-strollers',
    match_mode: 'INCLUDE_DESCENDANTS',
  });
  store.close();
});

test('malformed vocabulary draft is rejected atomically', t => {
  const f = fixture();
  t.after(f.cleanup);
  const store = KnowledgeStore.createNew(f.file, f.config);

  assert.throws(
    () => store.createDraft(categoryDraft({
      effectValue: { canonical_category_id: 'cat-strollers' },
    })),
    error => error?.code === 'VOCABULARY_SCHEMA_INVALID'
  );
  assert.deepEqual(store.stats(), {
    revisions: 0,
    events: 0,
    event_head_hash: null,
  });

  assert.throws(
    () => store.createDraft(categoryDraft({
      subjectId: 'Прогулочные коляски',
    })),
    error => error?.code === 'VOCABULARY_PHRASE_NOT_CANONICAL'
  );
  assert.equal(store.stats().revisions, 0);

  assert.throws(
    () => store.createDraft(categoryDraft({
      effectValue: {
        canonical_category_id: 'cat-strollers',
        match_mode: 'AUTO',
      },
    })),
    error => error?.code === 'VOCABULARY_CATEGORY_MATCH_MODE_INVALID'
  );
  assert.equal(store.stats().revisions, 0);
  store.close();
});

test('restore gate rejects cryptographically valid malformed vocabulary', t => {
  const f = fixture();
  t.after(f.cleanup);

  const store = KnowledgeStore.createNew(f.file, f.config);
  const created = store.createDraft(categoryDraft());
  store.approveRevision({
    revisionId: created.revision_id,
    actorId: 'actor_reviewer',
  });
  store.publishRevision({
    revisionId: created.revision_id,
    actorId: 'actor_reviewer',
  });
  store.close();

  const db = new DatabaseSync(f.file);
  try {
    db.exec('DROP TRIGGER knowledge_revisions_no_update');
    const row = db.prepare(
      'SELECT * FROM knowledge_revisions WHERE revision_id=?'
    ).get(created.revision_id);

    const malformedEffect = {
      canonical_category_id: 'cat-strollers',
    };
    const body = {
      revision_id: row.revision_id,
      record_type: row.record_type,
      schema_version: row.schema_version,
      namespace: row.namespace,
      effect_family: row.effect_family,
      subject_type: row.subject_type,
      subject_id: row.subject_id,
      scope_json: JSON.parse(row.scope_json),
      effect_type: row.effect_type,
      effect_value_json: malformedEffect,
      effective_from_utc: row.effective_from_utc,
      expires_at_utc: row.expires_at_utc,
      parent_revision_id: row.parent_revision_id,
      exception_of_revision_id: row.exception_of_revision_id,
      author_actor_id: row.author_actor_id,
      created_at_utc: row.created_at_utc,
    };

    db.prepare(
      'UPDATE knowledge_revisions ' +
      'SET effect_value_json=?,revision_hash=? ' +
      'WHERE revision_id=?'
    ).run(
      JSON.stringify(malformedEffect),
      knowledgeSha256(body),
      created.revision_id
    );
  } finally {
    db.close();
  }

  assert.throws(
    () => KnowledgeStore.openExisting(f.file),
    error =>
      error?.code === 'KNOWLEDGE_REVISION_INVALID' &&
      error?.details?.cause_code === 'VOCABULARY_SCHEMA_INVALID'
  );
});

test('brand and store vocabulary schemas require exact canonical target keys', () => {
  assert.deepEqual(
    validateVocabularyRevision({
      record_type: 'VOCABULARY_ENTRY',
      schema_version: 1,
      namespace: 'vocabulary.brand',
      effect_family: 'vocabulary.brand_resolution',
      subject_type: 'phrase',
      subject_id: 'cybex',
      scope_json: {},
      effect_type: 'BRAND_BINDING',
      effect_value_json: {
        canonical_brand_id: 'brand-cybex',
      },
    }),
    {
      namespace: 'vocabulary.brand',
      phrase: 'cybex',
      effect_family: 'vocabulary.brand_resolution',
      effect_type: 'BRAND_BINDING',
      target_key: 'canonical_brand_id',
      target_id: 'brand-cybex',
      match_mode: null,
    }
  );

  assert.deepEqual(
    validateVocabularyRevision({
      record_type: 'VOCABULARY_ENTRY',
      schema_version: 1,
      namespace: 'vocabulary.store',
      effect_family: 'vocabulary.store_resolution',
      subject_type: 'phrase',
      subject_id: 'магазин на глубочицкой',
      scope_json: {},
      effect_type: 'STORE_BINDING',
      effect_value_json: {
        canonical_store_id: 'store-a',
      },
    }).target_id,
    'store-a'
  );

  assert.throws(
    () => validateVocabularyRevision({
      record_type: 'VOCABULARY_ENTRY',
      schema_version: 1,
      namespace: 'vocabulary.store',
      effect_family: 'vocabulary.store_resolution',
      subject_type: 'phrase',
      subject_id: 'магазин а',
      scope_json: {},
      effect_type: 'STORE_BINDING',
      effect_value_json: {
        canonical_store_id: 'store-a',
        provider_store_id: '747',
      },
    }),
    error => error?.code === 'VOCABULARY_SCHEMA_INVALID'
  );

  assert.throws(
    () => validateVocabularyRevision({
      record_type: 'VOCABULARY_ENTRY',
      schema_version: 1,
      namespace: 'vocabulary.brand',
      effect_family: 'vocabulary.brand_resolution',
      subject_type: 'phrase',
      subject_id: 'cybex',
      scope_json: {},
      effect_type: 'BRAND_BINDING',
      effect_value_json: {
        canonical_brand_id: ' brand-cybex ',
      },
    }),
    error => error?.code === 'VOCABULARY_CANONICAL_ID_INVALID'
  );
});
