import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';
import { buildFirstLineTransientCandidate } from '../../src/copilot/first-line-runtime-semantics.mjs';
import { prepareFirstLinePublicActionFromCandidate } from '../../src/copilot/first-line-action-preparation.mjs';
import {
  assessFirstLineS2Preflight, isCertifiedFirstLineS2Preflight,
} from '../../src/copilot/first-line-s2-preflight.mjs';
import {
  FIRST_LINE_EXTRACTION_SCHEMA, FIRST_LINE_INTENT_SCHEMA_VERSION,
} from '../../src/copilot/first-line-extraction.mjs';

const NOW = 2_000_000_000_000;
const customer = {
  sourceMessageId: 101, eventKind: 'CUSTOMER_MESSAGE', messageType: 'incoming',
  senderClass: 'contact', senderId: 9001, contentType: 'text',
  deleted: false, unsupported: false, hasAttachments: false, sourceId: null,
};

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-action-prep-'));
  const store = FirstLineStateStore.create(path.join(dir, 'episode.sqlite'), {
    now: () => NOW,
  });
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot', sourceConversationId: 55,
  });
  store.ingestConversationEvent(stream.stream_id, customer);
  store.beginEpisode({ streamId: stream.stream_id });
  const reader = {
    async readExactSourceMessage() {
      return { code: 'SUPPORTED_CUSTOMER_TEXT',
        sourceConversationId: 55, sourceMessageId: 101,
        event: customer, transientContent: 'Какие способы оплаты есть?' };
    },
  };
  const knowledgeStore = { authoritySnapshot: () => [{
    revision_id: 'policy-1', record_type: 'COMMERCE_POLICY', schema_version: 1,
    namespace: 'commerce.payment_methods', effect_family: 'commerce.payment_methods',
    subject_type: 'business', subject_id: 'babypark', scope: {},
    effect_type: 'PAYMENT_METHODS',
    effect_value: { methods: ['BANK_TRANSFER', 'COD_NOVA_POSHTA'] },
    exception_of_revision_id: null, state: 'PUBLISHED',
    effective_from_utc: '2026-01-01T00:00:00.000Z', expires_at_utc: null,
  }] };
  const catalogService = {};
  const build = () => buildFirstLineTransientCandidate({
    store, streamId: stream.stream_id, reader,
    produceExtraction: async () => ({
      schema: FIRST_LINE_EXTRACTION_SCHEMA,
      intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
      intent_hint: 'UNTRUSTED', language: 'ru', spans: [],
    }),
    catalogService, knowledgeStore,
    nowUtc: '2026-01-10T12:00:00.000Z',
  });
  return { store, streamId: stream.stream_id, build, reader, catalogService, knowledgeStore };
}

test('only genuine C4 decision prepares immutable action/scope under v4 ownership', async t => {
  const f = fixture(t);
  const candidate = await f.build();
  assert.equal(candidate.code, 'CANDIDATE');
  const prepared = prepareFirstLinePublicActionFromCandidate({
    store: f.store, streamId: f.streamId, candidate, deadlineAt: NOW + 60_000,
  });
  assert.equal(prepared.code, 'ACTION_PREPARED');
  assert.equal(prepared.action.state, 'PREPARED');
  assert.deepEqual(prepared.action.descriptor.semantic_scope, {
    product: null, category: null, brand_id: null, store_id: null, money: null,
  });
  assert.equal(prepared.action.descriptor.reason, candidate.decision.reason);
  assert.equal(prepared.action.descriptor.template_id, candidate.decision.template_id);
  assert.deepEqual(prepared.action.basis_event_seqs, [1]);
  assert.deepEqual(prepared.action.scope_provenance, {});
  assert.equal(f.store.getSemanticOrigin(f.streamId, 1).origin_kind, 'PUBLIC_ACTION');
});

test('candidate, store, stream, action shape cannot be supplied as forged caller metadata', async t => {
  const f = fixture(t);
  const candidate = await f.build();
  const args = { store: f.store, streamId: f.streamId,
    candidate, deadlineAt: NOW + 60_000 };
  for (const impostor of [
    { ...candidate },
    { ...candidate, decision: { ...candidate.decision } },
    { ...candidate, projection: { ...candidate.projection } },
  ]) {
    assert.throws(() => prepareFirstLinePublicActionFromCandidate({
      ...args, candidate: impostor,
    }), { name: 'TypeError' });
  }
  assert.throws(() => prepareFirstLinePublicActionFromCandidate({
    ...args, store: {},
  }), { name: 'TypeError' });
  assert.throws(() => prepareFirstLinePublicActionFromCandidate({
    ...args, streamId: 'other-stream',
  }), { name: 'TypeError' });
  assert.equal(f.store.getUnresolvedContinuationOwner(f.streamId), null);
});

test('ordered S2 seals proof to exact prepared action, lease, store and C4 scope', async t => {
  const f = fixture(t);
  const candidate = await f.build();
  const { action } = prepareFirstLinePublicActionFromCandidate({
    store: f.store, streamId: f.streamId, candidate, deadlineAt: NOW + 60_000,
  });
  const claimed = f.store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-1' });
  assert.equal(claimed.action_id, action.action_id);
  const authorityReader = {
    ...f.reader,
    async readAuthorizingConversationSnapshot() {
      return { complete: true, code: 'COMPLETE', rowCount: 1, events: [customer] };
    },
    async readCurrentConversationAuthority(conversationId) {
      return { code: 'SEND_ELIGIBLE', sourceConversationId: conversationId,
        inboxId: 99, status: 'pending', ownerClass: 'SAME_AGENTBOT' };
    },
  };
  const args = {
    store: f.store, streamId: f.streamId, candidate, authorityReader,
    catalogService: f.catalogService, knowledgeStore: f.knowledgeStore,
    nowUtc: '2026-01-10T12:00:00.000Z', configuredInboxId: 99,
    actionId: action.action_id, leaseToken: 'relay-1',
  };
  const proof = await assessFirstLineS2Preflight(args);
  assert.equal(proof.code, 'PREFLIGHT_PROVEN');
  assert.equal(isCertifiedFirstLineS2Preflight(proof, args), true);
  assert.equal(isCertifiedFirstLineS2Preflight({ ...proof }, args), false);
  assert.equal(isCertifiedFirstLineS2Preflight(proof, { ...args, leaseToken: 'worker-2' }), false);
  assert.equal(isCertifiedFirstLineS2Preflight(proof, { ...args, actionId: 'other' }), false);
  const rejected = await assessFirstLineS2Preflight({ ...args, leaseToken: 'worker-2' });
  assert.deepEqual(rejected, { code: 'HUMAN_REQUIRED', reason: 'S2_ACTION_DESCRIPTOR_MISMATCH' });
  assert.equal(f.store.getPublicAction(action.action_id).state, 'GATING');
  assert.equal(f.store.getPublicAction(action.action_id).send_started_at, null);
});
