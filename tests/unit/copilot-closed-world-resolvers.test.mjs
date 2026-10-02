import {
  after,
  before,
  test,
} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CatalogGenerationBuilder,
  CatalogPublisher,
  CatalogReader,
} from '../../src/catalog/sqlite/generation.mjs';
import { CatalogService } from '../../src/catalog/service/catalog-service.mjs';
import { KnowledgeStore } from '../../src/copilot/knowledge/store.mjs';
import {
  resolveBrandVocabulary,
  resolveCategoryVocabulary,
  resolveMoneyPhrase,
  resolveStoreVocabulary,
} from '../../src/copilot/knowledge/closed-world-resolvers.mjs';

let root;
let catalogDir;
let knowledgeDir;
let reader;
let catalog;
let knowledge;
let revisionIds;

function addCatalogFixture(storageDir) {
  const builder = CatalogGenerationBuilder.create({
    storageDir,
    generationId: 'resolver-fixture',
    sourceEpoch: 'resolver-source',
    identityRevision: 77,
    dependencyFingerprint: 'resolver-deps',
    now: () => '2026-10-02T09:00:00.000Z',
  });

  for (const [id, name] of [
    ['brand-cybex', 'Cybex'],
    ['brand-cybex-alt', 'Cybex Alt'],
  ]) {
    builder.db.prepare(
      'INSERT INTO brands(brand_id,name,provenance_json) VALUES(?,?,?)'
    ).run(id, name, '{}');
  }

  for (const [id, name] of [
    ['cat-strollers', 'Прогулянкові коляски'],
    ['cat-prams', 'Коляски'],
  ]) {
    builder.db.prepare(
      'INSERT INTO categories(' +
      'category_id,parent_id,name_json,provenance_json' +
      ') VALUES(?,?,?,?)'
    ).run(id, null, JSON.stringify({ uk: name }), '{}');
  }

  for (const [id, name, active] of [
    ['store-a', 'Глибочицька', 1],
    ['store-b', 'Другий магазин', 1],
    ['store-old', 'Архівний магазин', 0],
  ]) {
    builder.db.prepare(
      'INSERT INTO stores(store_id,name,active,metadata_json) VALUES(?,?,?,?)'
    ).run(id, name, active, '{}');
  }

  for (const layer of ['taxonomy', 'content', 'commercial', 'stock']) {
    builder.setLayerState(layer, {
      accepted_watermark: '1',
      accepted_source_fingerprint: 'fp-' + layer,
      source_updated_at: '2026-10-02T08:00:00.000Z',
      provider_completed_at: '2026-10-02T08:00:01.000Z',
      integration_synced_at: '2026-10-02T08:00:02.000Z',
      last_run_id: 'run-' + layer,
      last_ok_at: '2026-10-02T08:00:02.000Z',
      freshness_state: 'FRESH',
      need_reconcile: false,
      need_full: false,
    });
  }

  builder.seal();
  new CatalogPublisher(storageDir).publish('resolver-fixture');
}

function vocabularyDraft(namespace, phrase, effectValue, {
  effectiveFromUtc = '2026-10-01T00:00:00Z',
  expiresAtUtc = null,
} = {}) {
  const byNamespace = {
    'vocabulary.category': {
      effectFamily: 'vocabulary.category_resolution',
      effectType: 'CATEGORY_BINDING',
    },
    'vocabulary.brand': {
      effectFamily: 'vocabulary.brand_resolution',
      effectType: 'BRAND_BINDING',
    },
    'vocabulary.store': {
      effectFamily: 'vocabulary.store_resolution',
      effectType: 'STORE_BINDING',
    },
  };
  const spec = byNamespace[namespace];
  return {
    recordType: 'VOCABULARY_ENTRY',
    schemaVersion: 1,
    namespace,
    effectFamily: spec.effectFamily,
    subjectType: 'phrase',
    subjectId: phrase,
    scope: {},
    effectType: spec.effectType,
    effectValue,
    effectiveFromUtc,
    expiresAtUtc,
    authorActorId: 'actor_vocab_editor',
  };
}

function publishVocabulary(namespace, phrase, effectValue, time = {}) {
  const created = knowledge.createDraft(
    vocabularyDraft(namespace, phrase, effectValue, time)
  );
  knowledge.approveRevision({
    revisionId: created.revision_id,
    actorId: 'actor_vocab_reviewer',
  });
  knowledge.publishRevision({
    revisionId: created.revision_id,
    actorId: 'actor_vocab_reviewer',
  });
  return created.revision_id;
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-closed-world-'));
  catalogDir = path.join(root, 'catalog');
  knowledgeDir = path.join(root, 'knowledge');
  fs.mkdirSync(catalogDir);
  fs.mkdirSync(knowledgeDir);

  addCatalogFixture(catalogDir);
  reader = new CatalogReader(catalogDir);
  reader.reloadExpected('resolver-fixture');
  catalog = new CatalogService(reader);

  let revision = 0;
  let event = 0;
  let tick = 0;
  knowledge = KnowledgeStore.createNew(
    path.join(knowledgeDir, 'knowledge.sqlite'),
    {
      now: () =>
        new Date(Date.UTC(2026, 9, 2, 9, 0, tick++)).toISOString(),
      idFactory: {
        revision: () => `kr_resolver_${++revision}`,
        event: () => `ke_resolver_${++event}`,
      },
    }
  );

  revisionIds = {};

  revisionIds.categoryUnique = publishVocabulary(
    'vocabulary.category',
    'прогулочные коляски',
    {
      canonical_category_id: 'cat-strollers',
      match_mode: 'INCLUDE_DESCENDANTS',
    }
  );

  revisionIds.categoryAmbiguousA = publishVocabulary(
    'vocabulary.category',
    'коляски',
    {
      canonical_category_id: 'cat-strollers',
      match_mode: 'NODE_ONLY',
    }
  );
  revisionIds.categoryAmbiguousB = publishVocabulary(
    'vocabulary.category',
    'коляски',
    {
      canonical_category_id: 'cat-prams',
      match_mode: 'NODE_ONLY',
    }
  );

  revisionIds.categoryDuplicateA = publishVocabulary(
    'vocabulary.category',
    'прогулка',
    {
      canonical_category_id: 'cat-strollers',
      match_mode: 'NODE_ONLY',
    }
  );
  revisionIds.categoryDuplicateB = publishVocabulary(
    'vocabulary.category',
    'прогулка',
    {
      canonical_category_id: 'cat-strollers',
      match_mode: 'NODE_ONLY',
    }
  );

  revisionIds.categoryMissing = publishVocabulary(
    'vocabulary.category',
    'битая категория',
    {
      canonical_category_id: 'cat-missing',
      match_mode: 'NODE_ONLY',
    }
  );

  revisionIds.categoryExpired = publishVocabulary(
    'vocabulary.category',
    'старая категория',
    {
      canonical_category_id: 'cat-strollers',
      match_mode: 'NODE_ONLY',
    },
    {
      effectiveFromUtc: '2026-09-01T00:00:00Z',
      expiresAtUtc: '2026-10-02T08:00:00Z',
    }
  );

  revisionIds.brandUnique = publishVocabulary(
    'vocabulary.brand',
    'cybex',
    { canonical_brand_id: 'brand-cybex' }
  );
  revisionIds.brandAmbiguousA = publishVocabulary(
    'vocabulary.brand',
    'двойной бренд',
    { canonical_brand_id: 'brand-cybex' }
  );
  revisionIds.brandAmbiguousB = publishVocabulary(
    'vocabulary.brand',
    'двойной бренд',
    { canonical_brand_id: 'brand-cybex-alt' }
  );

  revisionIds.storeUnique = publishVocabulary(
    'vocabulary.store',
    'магазин на глубочицкой',
    { canonical_store_id: 'store-a' }
  );
  revisionIds.storeAmbiguousA = publishVocabulary(
    'vocabulary.store',
    'магазин',
    { canonical_store_id: 'store-a' }
  );
  revisionIds.storeAmbiguousB = publishVocabulary(
    'vocabulary.store',
    'магазин',
    { canonical_store_id: 'store-b' }
  );
  revisionIds.storeMixedValid = publishVocabulary(
    'vocabulary.store',
    'магазин с архивом',
    { canonical_store_id: 'store-a' }
  );
  revisionIds.storeMixedInactive = publishVocabulary(
    'vocabulary.store',
    'магазин с архивом',
    { canonical_store_id: 'store-old' }
  );
});

after(() => {
  knowledge?.close();
  reader?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const NOW = '2026-10-02T12:00:00Z';

test('category vocabulary resolves reviewed ID and explicit match mode', () => {
  const result = resolveCategoryVocabulary(knowledge, catalog, {
    nowUtc: NOW,
    phrase: '  ПРОГУЛОЧНЫЕ   КОЛЯСКИ ',
    language: 'uk',
  });

  assert.equal(result.resolver_contract_version, 1);
  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.reason, 'CATEGORY_RESOLVED');
  assert.equal(result.catalog.generation_id, 'resolver-fixture');
  assert.deepEqual(result.used_revision_ids, [revisionIds.categoryUnique]);
  assert.deepEqual(result.resolved, {
    canonical_category_id: 'cat-strollers',
    match_mode: 'INCLUDE_DESCENDANTS',
    revision_ids: [revisionIds.categoryUnique],
    name: 'Прогулянкові коляски',
  });
});

test('category vocabulary returns many reviewed candidates without latest-wins', () => {
  const result = resolveCategoryVocabulary(knowledge, catalog, {
    nowUtc: NOW,
    phrase: 'коляски',
  });

  assert.equal(result.status, 'AMBIGUOUS');
  assert.equal(result.reason, 'AMBIGUOUS_CATEGORY');
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(
    result.candidates.map(row => [
      row.canonical_category_id,
      row.match_mode,
    ]),
    [
      ['cat-prams', 'NODE_ONLY'],
      ['cat-strollers', 'NODE_ONLY'],
    ]
  );
});

test('identical reviewed bindings dedupe candidate but retain all revision IDs', () => {
  const result = resolveCategoryVocabulary(knowledge, catalog, {
    nowUtc: NOW,
    phrase: 'прогулка',
  });

  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(
    result.resolved.revision_ids,
    [revisionIds.categoryDuplicateA, revisionIds.categoryDuplicateB].sort()
  );
  assert.deepEqual(
    result.used_revision_ids,
    [revisionIds.categoryDuplicateA, revisionIds.categoryDuplicateB].sort()
  );
});

test('missing catalog target fails authority instead of becoming not-found', () => {
  const result = resolveCategoryVocabulary(knowledge, catalog, {
    nowUtc: NOW,
    phrase: 'битая категория',
  });

  assert.equal(result.status, 'INVALID_AUTHORITY');
  assert.equal(result.reason, 'VOCABULARY_TARGET_INVALID');
  assert.deepEqual(result.invalid_target_ids, ['cat-missing']);
  assert.deepEqual(
    result.invalid_revision_ids,
    [revisionIds.categoryMissing]
  );
});

test('expired vocabulary is inactive and zero-result is explicit', () => {
  const expired = resolveCategoryVocabulary(knowledge, catalog, {
    nowUtc: NOW,
    phrase: 'старая категория',
  });
  assert.equal(expired.status, 'NOT_FOUND');
  assert.equal(expired.reason, 'CATEGORY_NOT_FOUND');
  assert.deepEqual(expired.used_revision_ids, []);

  const absent = resolveCategoryVocabulary(knowledge, catalog, {
    nowUtc: NOW,
    phrase: 'несуществующая фраза',
  });
  assert.equal(absent.status, 'NOT_FOUND');
  assert.deepEqual(absent.candidates, []);
});

test('brand vocabulary supports unique and ambiguous reviewed mappings', () => {
  const unique = resolveBrandVocabulary(knowledge, catalog, {
    nowUtc: NOW,
    phrase: ' CYBEX ',
  });
  assert.equal(unique.status, 'RESOLVED');
  assert.equal(unique.resolved.canonical_brand_id, 'brand-cybex');
  assert.equal(unique.resolved.name, 'Cybex');
  assert.deepEqual(unique.used_revision_ids, [revisionIds.brandUnique]);

  const many = resolveBrandVocabulary(knowledge, catalog, {
    nowUtc: NOW,
    phrase: 'двойной бренд',
  });
  assert.equal(many.status, 'AMBIGUOUS');
  assert.equal(many.reason, 'AMBIGUOUS_BRAND');
  assert.deepEqual(
    many.candidates.map(row => row.canonical_brand_id),
    ['brand-cybex', 'brand-cybex-alt']
  );
});

test('store vocabulary requires exactly one active canonical store', () => {
  const unique = resolveStoreVocabulary(knowledge, catalog, {
    nowUtc: NOW,
    phrase: 'магазин на глубочицкой',
  });
  assert.equal(unique.status, 'RESOLVED');
  assert.equal(unique.resolved.canonical_store_id, 'store-a');
  assert.equal(unique.resolved.name, 'Глибочицька');
  assert.deepEqual(unique.used_revision_ids, [revisionIds.storeUnique]);

  const many = resolveStoreVocabulary(knowledge, catalog, {
    nowUtc: NOW,
    phrase: 'магазин',
  });
  assert.equal(many.status, 'AMBIGUOUS');
  assert.equal(many.reason, 'AMBIGUOUS_STORE');
  assert.deepEqual(
    many.candidates.map(row => row.canonical_store_id),
    ['store-a', 'store-b']
  );
});

test('inactive store mapping cannot be silently dropped beside a valid mapping', () => {
  const result = resolveStoreVocabulary(knowledge, catalog, {
    nowUtc: NOW,
    phrase: 'магазин с архивом',
  });

  assert.equal(result.status, 'INVALID_AUTHORITY');
  assert.equal(result.reason, 'VOCABULARY_TARGET_INVALID');
  assert.deepEqual(result.invalid_target_ids, ['store-old']);
  assert.deepEqual(
    result.invalid_revision_ids,
    [revisionIds.storeMixedInactive]
  );
  assert.deepEqual(
    result.used_revision_ids,
    [revisionIds.storeMixedValid, revisionIds.storeMixedInactive].sort()
  );
});

test('money parser resolves only approved deterministic UAH forms', () => {
  for (const [input, minor, form] of [
    ['20 000 грн', 2000000, 'UAH_MAJOR'],
    ['20\u00a0000 грн', 2000000, 'UAH_MAJOR'],
    ['20000 UAH', 2000000, 'UAH_MAJOR'],
    ['20 тысяч', 2000000, 'UAH_THOUSANDS'],
    ['20 тисяч', 2000000, 'UAH_THOUSANDS'],
    ['20к', 2000000, 'UAH_THOUSANDS'],
  ]) {
    const result = resolveMoneyPhrase(input);
    assert.equal(result.status, 'RESOLVED', input);
    assert.equal(result.reason, 'MONEY_RESOLVED', input);
    assert.equal(result.currency, 'UAH', input);
    assert.equal(result.minor_units, minor, input);
    assert.equal(result.form, form, input);
    assert.equal(result.resolver_contract_version, 1);
  }
});

test('ambiguous/malformed/overflow money never guesses', () => {
  for (const input of [
    '20 000',
    '20.000 грн',
    '20,000 грн',
    '20к грн',
    '-20 000 грн',
    '20 000.50 грн',
    '90071992547410 тысяч',
    '9'.repeat(10000) + ' грн',
    '20\u0000грн',
    '',
  ]) {
    const result = resolveMoneyPhrase(input);
    assert.equal(result.status, 'AMBIGUOUS', input);
    assert.equal(result.reason, 'AMBIGUOUS_MONEY', input);
    assert.equal(result.minor_units, null, input);
  }
});
