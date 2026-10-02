import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
  canonicalKnowledgeJson,
} from '../../src/copilot/knowledge/canonical.mjs';
import {
  KNOWLEDGE_RESOLVER_CONTRACT_VERSION,
  KNOWLEDGE_RESOLVER_GOLDEN_SHA256,
} from '../../src/copilot/knowledge/resolver-contract.mjs';
import {
  normalizeVocabularyPhrase,
} from '../../src/copilot/knowledge/vocabulary-schema.mjs';
import {
  resolveBrandVocabulary,
  resolveCategoryVocabulary,
  resolveMoneyPhrase,
  resolveStoreVocabulary,
} from '../../src/copilot/knowledge/closed-world-resolvers.mjs';

const fixtureUrl = new URL(
  '../fixtures/knowledge-resolver-contract-v1.json',
  import.meta.url
);
const raw = fs.readFileSync(fixtureUrl);
const fixture = JSON.parse(raw.toString('utf8'));

function moneyObservable(result) {
  return {
    normalized_phrase: result.normalized_phrase,
    status: result.status,
    reason: result.reason,
    currency: result.currency,
    minor_units: result.minor_units,
    form: result.form,
  };
}

function closedWorldObservable(result) {
  return {
    resolver: result.resolver,
    normalized_phrase: result.normalized_phrase,
    status: result.status,
    reason: result.reason,
    used_revision_ids: [...result.used_revision_ids],
    catalog_generation_id: result.catalog?.generation_id ?? null,
    resolved: result.resolved ?? null,
    candidates: [...result.candidates],
    invalid_revision_ids: result.invalid_revision_ids
      ? [...result.invalid_revision_ids]
      : null,
    invalid_target_ids: result.invalid_target_ids
      ? [...result.invalid_target_ids]
      : null,
  };
}

function vocabularyDraft(namespace, phrase, effectValue) {
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
    effectiveFromUtc: '2026-10-01T00:00:00Z',
    expiresAtUtc: null,
    authorActorId: 'actor_golden_editor',
  };
}

function makeClosedWorldFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-resolver-golden-'));
  const catalogDir = path.join(root, 'catalog');
  fs.mkdirSync(catalogDir);

  const builder = CatalogGenerationBuilder.create({
    storageDir: catalogDir,
    generationId: 'resolver-golden',
    sourceEpoch: 'resolver-golden-source',
    identityRevision: 91,
    dependencyFingerprint: 'resolver-golden-deps',
    now: () => '2026-10-02T09:00:00.000Z',
  });

  builder.db.prepare(
    'INSERT INTO brands(brand_id,name,provenance_json) VALUES(?,?,?)'
  ).run('brand-cybex', 'Cybex', '{}');

  for (const [id, name] of [
    ['cat-prams', 'Коляски'],
    ['cat-strollers', 'Прогулянкові коляски'],
  ]) {
    builder.db.prepare(
      'INSERT INTO categories(' +
      'category_id,parent_id,name_json,provenance_json' +
      ') VALUES(?,?,?,?)'
    ).run(id, null, JSON.stringify({ uk: name }), '{}');
  }

  for (const [id, name, active] of [
    ['store-a', 'Глибочицька', 1],
    ['store-old', 'Архівний магазин', 0],
  ]) {
    builder.db.prepare(
      'INSERT INTO stores(store_id,name,active,metadata_json) VALUES(?,?,?,?)'
    ).run(id, name, active, '{}');
  }

  for (const layer of ['taxonomy', 'content', 'commercial', 'stock']) {
    builder.setLayerState(layer, {
      accepted_watermark: '1',
      accepted_source_fingerprint: 'golden-' + layer,
      source_updated_at: '2026-10-02T08:00:00.000Z',
      provider_completed_at: '2026-10-02T08:00:01.000Z',
      integration_synced_at: '2026-10-02T08:00:02.000Z',
      last_run_id: 'golden-' + layer,
      last_ok_at: '2026-10-02T08:00:02.000Z',
      freshness_state: 'FRESH',
      need_reconcile: false,
      need_full: false,
    });
  }

  builder.seal();
  new CatalogPublisher(catalogDir).publish('resolver-golden');

  const reader = new CatalogReader(catalogDir);
  reader.reloadExpected('resolver-golden');
  const catalog = new CatalogService(reader);

  const revisionIds = [
    'kr_golden_category_unique',
    'kr_golden_category_ambiguous_a',
    'kr_golden_category_ambiguous_b',
    'kr_golden_brand_unique',
    'kr_golden_store_unique',
    'kr_golden_store_inactive',
  ];
  let revisionIndex = 0;
  let eventIndex = 0;
  let tick = 0;
  const knowledge = KnowledgeStore.createNew(
    path.join(root, 'knowledge.sqlite'),
    {
      now: () =>
        new Date(Date.UTC(2026, 9, 2, 9, 0, tick++)).toISOString(),
      idFactory: {
        revision: () => revisionIds[revisionIndex++],
        event: () => 'ke_golden_' + (++eventIndex),
      },
    }
  );

  function publish(namespace, phrase, effectValue) {
    const created = knowledge.createDraft(
      vocabularyDraft(namespace, phrase, effectValue)
    );
    knowledge.approveRevision({
      revisionId: created.revision_id,
      actorId: 'actor_golden_reviewer',
    });
    knowledge.publishRevision({
      revisionId: created.revision_id,
      actorId: 'actor_golden_reviewer',
    });
  }

  publish(
    'vocabulary.category',
    'прогулочные коляски',
    {
      canonical_category_id: 'cat-strollers',
      match_mode: 'INCLUDE_DESCENDANTS',
    }
  );
  publish(
    'vocabulary.category',
    'коляски',
    {
      canonical_category_id: 'cat-prams',
      match_mode: 'NODE_ONLY',
    }
  );
  publish(
    'vocabulary.category',
    'коляски',
    {
      canonical_category_id: 'cat-strollers',
      match_mode: 'NODE_ONLY',
    }
  );
  publish(
    'vocabulary.brand',
    'cybex',
    { canonical_brand_id: 'brand-cybex' }
  );
  publish(
    'vocabulary.store',
    'магазин на глубочицкой',
    { canonical_store_id: 'store-a' }
  );
  publish(
    'vocabulary.store',
    'архивный магазин',
    { canonical_store_id: 'store-old' }
  );

  return {
    catalog,
    knowledge,
    cleanup() {
      knowledge.close();
      reader.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function executeClosedWorldVector(context, vector) {
  const args = {
    nowUtc: '2026-10-02T12:00:00Z',
    phrase: vector.input,
  };
  if (vector.resolver === 'CATEGORY_VOCABULARY') {
    return resolveCategoryVocabulary(
      context.knowledge,
      context.catalog,
      { ...args, language: 'uk' }
    );
  }
  if (vector.resolver === 'BRAND_VOCABULARY') {
    return resolveBrandVocabulary(
      context.knowledge,
      context.catalog,
      args
    );
  }
  if (vector.resolver === 'STORE_VOCABULARY') {
    return resolveStoreVocabulary(
      context.knowledge,
      context.catalog,
      args
    );
  }
  throw new TypeError(
    'Unsupported golden resolver ' + vector.resolver
  );
}

test('resolver v1 golden fixture is pinned by contract version', () => {
  assert.equal(fixture.schema, 'bp.knowledge-resolver-golden/1');
  assert.equal(
    fixture.contract_version,
    KNOWLEDGE_RESOLVER_CONTRACT_VERSION
  );
  const digest = crypto
    .createHash('sha256')
    .update(canonicalKnowledgeJson(fixture))
    .digest('hex');
  assert.equal(
    digest,
    KNOWLEDGE_RESOLVER_GOLDEN_SHA256[
      KNOWLEDGE_RESOLVER_CONTRACT_VERSION
    ]
  );
});

test('resolver v1 golden phrase vectors remain observable-equivalent', () => {
  for (const vector of fixture.phrase_vectors) {
    assert.equal(
      normalizeVocabularyPhrase(vector.input),
      vector.expected,
      vector.input
    );
  }
});

test('resolver v1 golden money vectors remain observable-equivalent', () => {
  for (const vector of fixture.money_vectors) {
    const result = resolveMoneyPhrase(vector.input);
    assert.equal(
      result.resolver_contract_version,
      KNOWLEDGE_RESOLVER_CONTRACT_VERSION,
      vector.input
    );
    assert.deepEqual(
      moneyObservable(result),
      vector.expected,
      vector.input
    );
  }
});

test('resolver v1 golden closed-world vectors remain observable-equivalent', t => {
  const context = makeClosedWorldFixture();
  t.after(context.cleanup);

  for (const vector of fixture.closed_world_vectors) {
    const result = executeClosedWorldVector(context, vector);
    assert.equal(
      result.resolver_contract_version,
      KNOWLEDGE_RESOLVER_CONTRACT_VERSION,
      vector.input
    );
    assert.deepEqual(
      closedWorldObservable(result),
      vector.expected,
      vector.resolver + ': ' + vector.input
    );
  }
});
