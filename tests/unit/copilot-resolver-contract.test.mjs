import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  KNOWLEDGE_RESOLVER_CONTRACT_VERSION,
  KNOWLEDGE_RESOLVER_GOLDEN_SHA256,
} from '../../src/copilot/knowledge/resolver-contract.mjs';
import {
  normalizeVocabularyPhrase,
} from '../../src/copilot/knowledge/vocabulary-schema.mjs';
import {
  resolveMoneyPhrase,
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

test('resolver v1 golden fixture is pinned by contract version', () => {
  assert.equal(fixture.schema, 'bp.knowledge-resolver-golden/1');
  assert.equal(
    fixture.contract_version,
    KNOWLEDGE_RESOLVER_CONTRACT_VERSION
  );
  const digest = crypto.createHash('sha256').update(raw).digest('hex');
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
