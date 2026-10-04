import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  FIRST_LINE_CLARIFICATION_SELECTION_SCHEMA,
  FirstLineClarificationSelectionError,
  clarificationChoiceToken,
  proveExactMessageClarificationSelection,
  proveStructuredClarificationSubmission,
} from '../../src/copilot/first-line-clarification-selection.mjs';
import { FIRST_LINE_RESOLUTION_SCHEMA } from '../../src/copilot/first-line-resolution.mjs';
import { OPEN_TURN_PROJECTION_SCHEMA } from '../../src/copilot/first-line-routing-planner.mjs';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';

const NOW = 2_000_000_000_000;
const PRODUCT_1 = 'prod_11111111-1111-4111-8111-111111111111';
const VARIANT_1 = 'var_11111111-1111-4111-8111-111111111111';
const VARIANT_2 = 'var_22222222-2222-4222-8222-222222222222';
const STORE_1 = 'store_11111111-1111-4111-8111-111111111111';
const STORE_2 = 'store_22222222-2222-4222-8222-222222222222';
const FINGERPRINT = 'sha256:' + 'a'.repeat(64);

function tempStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clarification-selection-'));
  const file = path.join(dir, 'episode.sqlite');
  let actionCounter = 0;
  const store = FirstLineStateStore.create(file, {
    now: () => NOW,
    streamIdFactory: () => 'stream-1',
    episodeIdFactory: () => 'episode-1',
    actionIdFactory: () => 'action-' + (++actionCounter),
  });
  t.after(() => {
    try { store.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

function customerEvent(sourceMessageId) {
  return {
    sourceMessageId,
    eventKind: 'CUSTOMER_MESSAGE',
    messageType: 'incoming',
    senderClass: 'contact',
    senderId: 9001,
    contentType: 'text',
    deleted: false,
    unsupported: false,
    hasAttachments: false,
  };
}

function clarifyReply(sourceMessageId, sourceId) {
  return {
    sourceMessageId,
    eventKind: 'BABYPARK_PUBLIC_REPLY',
    messageType: 'outgoing',
    senderClass: 'configured_agent_bot',
    senderId: 7001,
    contentType: 'input_select',
    deleted: false,
    unsupported: false,
    hasAttachments: false,
    sourceId,
  };
}

function structuredSetup(t) {
  const store = tempStore(t);
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot',
    sourceConversationId: 55,
  });
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = store.preparePublicAction({
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
    preparedStreamRevision: 1,
    actionType: 'CLARIFY',
    basisEventSeqs: [1],
    requestedSlot: 'store_id',
    presentedCandidates: [
      { slot: 'store_id', value: STORE_1 },
      { slot: 'store_id', value: STORE_2 },
    ],
    deadlineAt: NOW + 60_000,
  });
  store.claimNextPublicAction({ leaseMs: 30_000, token: 'lease-1' });
  store.markActionSending(action.action_id, 'lease-1');
  store.ingestConversationEvent(stream.stream_id, clarifyReply(102, action.action_id));
  store.confirmPublicActionFromLedger(action.action_id);
  return {
    store,
    stream,
    action: store.getPublicAction(action.action_id),
    snapshot: store.readRoutingSnapshot(stream.stream_id),
  };
}

function structuredExactRead(action, value = 'bp-choice:2', overrides = {}) {
  return {
    code: 'SUPPORTED_CLARIFICATION_SUBMISSION',
    sourceConversationId: 55,
    sourceMessageId: action.confirmed_source_message_id,
    event: {
      sourceMessageId: action.confirmed_source_message_id,
      eventKind: 'BABYPARK_PUBLIC_REPLY',
      messageType: 'outgoing',
      senderClass: 'configured_agent_bot',
      senderId: 7001,
      contentType: 'input_select',
      deleted: false,
      unsupported: false,
      hasAttachments: false,
      sourceId: action.action_id,
    },
    transientSubmittedValue: value,
    ...overrides,
  };
}

function projection({ requestedSlot = 'variant_id', candidates = [
  { slot: 'variant_id', value: VARIANT_1 },
  { slot: 'variant_id', value: VARIANT_2 },
] } = {}) {
  return {
    schema: OPEN_TURN_PROJECTION_SCHEMA,
    stream_id: 'stream-1',
    source_conversation_id: 55,
    stream_revision: 3,
    through_event_seq: 3,
    plan_token: {
      stream_id: 'stream-1',
      stream_revision: 3,
      through_event_seq: 3,
      routing_ledger_fingerprint: FINGERPRINT,
      episode_id: 'episode-1',
      episode_version: 2,
      live_action_id: null,
      live_action_state: null,
    },
    active_episode: {
      episode_id: 'episode-1',
      stream_id: 'stream-1',
      state: 'active',
      version: 2,
      clarification_prompts_sent: 1,
      requested_slot: requestedSlot,
      clarification_action_id: 'action-1',
      stable_slots: {},
    },
    live_public_action: null,
    clarification_action: {
      action_id: 'action-1',
      stream_id: 'stream-1',
      episode_id: 'episode-1',
      episode_version: 2,
      prepared_stream_revision: 1,
      action_type: 'CLARIFY',
      state: 'CONFIRMED',
      basis_event_seqs: [1],
      requested_slot: requestedSlot,
      presented_candidates: candidates,
      confirmed_source_message_id: 500,
    },
    open_turn: {
      event_seqs: [3],
      source_message_ids: [501],
      first_event_seq: 3,
      last_event_seq: 3,
      message_count: 1,
    },
    boundary: {
      event_seq: 2,
      source_message_id: 500,
      event_kind: 'BABYPARK_PUBLIC_REPLY',
      confirmed_action_id: 'action-1',
      confirmed_action_type: 'CLARIFY',
    },
    code: 'OPEN_TURN',
    reason: 'AFTER_CONFIRMED_BABYPARK_REPLY',
  };
}

function resolution(kind, authority, text, quote = text, sourceMessageId = 501) {
  const start = text.indexOf(quote);
  const row = {
    kind,
    turn_index: 1,
    source_message_id: sourceMessageId,
    occurrence: 1,
    start_utf16: start,
    end_utf16: start + quote.length,
    authority,
  };
  return {
    schema: FIRST_LINE_RESOLUTION_SCHEMA,
    extraction_schema: 'bp.first-line.extraction/1',
    intent_schema_version: 'bp.first-line.intent/1',
    intent_hint: 'UNTRUSTED_HINT',
    language: 'uk',
    source_conversation_id: 55,
    source_message_ids: [sourceMessageId],
    catalog_generation_id: 'g1',
    knowledge_resolver_contract_version: 1,
    used_revision_ids: [],
    certified_spans: [{
      kind: row.kind,
      turn_index: row.turn_index,
      source_message_id: row.source_message_id,
      occurrence: row.occurrence,
      start_utf16: row.start_utf16,
      end_utf16: row.end_utf16,
    }],
    resolutions: [row],
  };
}

function exactRead(text) {
  return {
    code: 'SUPPORTED_CUSTOMER_TEXT',
    sourceConversationId: 55,
    sourceMessageId: 501,
    event: {
      sourceMessageId: 501,
      eventKind: 'CUSTOMER_MESSAGE',
      messageType: 'incoming',
      senderClass: 'contact',
      senderId: 9001,
      contentType: 'text',
      deleted: false,
      unsupported: false,
      hasAttachments: false,
      sourceId: null,
    },
    transientContent: text,
  };
}

function productAuthority() {
  return {
    status: 'RESOLVED',
    reason: 'PRODUCT_RESOLVED',
    resolved: {
      canonical_product_id: PRODUCT_1,
      canonical_variant_id: VARIANT_2,
    },
    candidates: [{
      canonical_product_id: PRODUCT_1,
      canonical_variant_id: VARIANT_2,
    }],
  };
}

test('choice token is bounded and contains no canonical authority id', () => {
  assert.equal(clarificationChoiceToken(1), 'bp-choice:1');
  assert.equal(clarificationChoiceToken(20), 'bp-choice:20');
  assert.throws(() => clarificationChoiceToken(21), error =>
    error instanceof FirstLineClarificationSelectionError);
});

test('structured Web Widget submission proves one reserved candidate without a new ledger event', t => {
  const { store, stream, action, snapshot } = structuredSetup(t);
  const before = store.listConversationEvents(stream.stream_id);
  const result = proveStructuredClarificationSubmission({
    snapshot,
    exactRead: structuredExactRead(action),
  });

  assert.equal(result.schema, FIRST_LINE_CLARIFICATION_SELECTION_SCHEMA);
  assert.equal(result.code, 'CLARIFICATION_SELECTION_PROVEN');
  assert.equal(result.evidence_class, 'STRUCTURED_SUBMISSION');
  assert.deepEqual(result.selection, {
    origin: 'presented_candidate',
    slot: 'store_id',
    value: STORE_2,
    candidate_ordinal: 2,
    source_message_id: 102,
  });
  assert.deepEqual(store.listConversationEvents(stream.stream_id), before);
  assert.deepEqual(
    proveStructuredClarificationSubmission({
      snapshot,
      exactRead: structuredExactRead(action),
    }),
    result
  );
});

test('structured submission fails closed on wrong action, unknown value, or later ledger event', t => {
  const { store, stream, action, snapshot } = structuredSetup(t);

  const wrong = structuredExactRead(action);
  wrong.event = { ...wrong.event, sourceId: 'other-action' };
  assert.equal(
    proveStructuredClarificationSubmission({ snapshot, exactRead: wrong }).code,
    'NO_CLARIFICATION_SELECTION'
  );

  const unknown = proveStructuredClarificationSubmission({
    snapshot,
    exactRead: structuredExactRead(action, 'bp-choice:20'),
  });
  assert.equal(unknown.reason, 'STRUCTURED_SUBMISSION_VALUE_UNKNOWN');

  store.ingestConversationEvent(stream.stream_id, customerEvent(103));
  const stale = proveStructuredClarificationSubmission({
    snapshot: store.readRoutingSnapshot(stream.stream_id),
    exactRead: structuredExactRead(action),
  });
  assert.equal(stale.reason, 'CLARIFICATION_LEDGER_BOUNDARY_MISMATCH');
});

test('exact whole-message offered candidate proves selection', () => {
  const text = 'VARIANT_2';
  const result = proveExactMessageClarificationSelection({
    projection: projection(),
    resolution: resolution('PRODUCT', productAuthority(), text),
    exactRead: exactRead(text),
  });
  assert.equal(result.code, 'CLARIFICATION_SELECTION_PROVEN');
  assert.equal(result.evidence_class, 'EXACT_MESSAGE_SELECTION');
  assert.equal(result.reason, 'PRESENTED_CANDIDATE_SELECTED');
  assert.equal(result.selection.value, VARIANT_2);
  assert.equal(result.selection.candidate_ordinal, 2);
});

test('Unicode edge whitespace is allowed but negation/punctuation/prefix/suffix are not', () => {
  const allowed = '\u00a0\u2003VARIANT_2\u202f';
  assert.equal(
    proveExactMessageClarificationSelection({
      projection: projection(),
      resolution: resolution('PRODUCT', productAuthority(), allowed, 'VARIANT_2'),
      exactRead: exactRead(allowed),
    }).code,
    'CLARIFICATION_SELECTION_PROVEN'
  );

  for (const text of ['не VARIANT_2', 'VARIANT_2?', 'да, VARIANT_2', 'VARIANT_2 будь ласка']) {
    const result = proveExactMessageClarificationSelection({
      projection: projection(),
      resolution: resolution('PRODUCT', productAuthority(), text, 'VARIANT_2'),
      exactRead: exactRead(text),
    });
    assert.equal(result.code, 'NO_CLARIFICATION_SELECTION', text);
    assert.equal(result.reason, 'EXACT_SELECTION_SURROUNDING_TEXT', text);
  }
});

test('exact requested store and money values fill only the requested slot', () => {
  const storeText = 'STORE ONE';
  const storeResult = proveExactMessageClarificationSelection({
    projection: projection({ requestedSlot: 'store_id', candidates: [] }),
    resolution: resolution('STORE', {
      status: 'RESOLVED',
      reason: 'STORE_RESOLVED',
      resolved: { canonical_store_id: STORE_1 },
    }, storeText),
    exactRead: exactRead(storeText),
  });
  assert.equal(storeResult.reason, 'REQUESTED_SLOT_FILLED');
  assert.equal(storeResult.selection.value, STORE_1);

  const moneyText = '1000 грн';
  const moneyResult = proveExactMessageClarificationSelection({
    projection: projection({ requestedSlot: 'money', candidates: [] }),
    resolution: resolution('MONEY', {
      status: 'RESOLVED',
      reason: 'MONEY_RESOLVED',
      currency: 'UAH',
      minor_units: 100000,
    }, moneyText),
    exactRead: exactRead(moneyText),
  });
  assert.deepEqual(moneyResult.selection.value, { currency: 'UAH', minor_units: 100000 });
});

test('multi-message turn, wrong exact-read identity and malicious intent hint cannot create proof', () => {
  const multi = projection();
  multi.open_turn = {
    event_seqs: [3, 4],
    source_message_ids: [501, 502],
    first_event_seq: 3,
    last_event_seq: 4,
    message_count: 2,
  };
  assert.equal(
    proveExactMessageClarificationSelection({
      projection: multi,
      resolution: resolution('PRODUCT', productAuthority(), 'VARIANT_2'),
      exactRead: exactRead('VARIANT_2'),
    }).reason,
    'EXACT_SELECTION_REQUIRES_SINGLE_MESSAGE_OPEN_TURN'
  );

  const wrongRead = { ...exactRead('VARIANT_2'), sourceConversationId: 99 };
  assert.equal(
    proveExactMessageClarificationSelection({
      projection: projection(),
      resolution: resolution('PRODUCT', productAuthority(), 'VARIANT_2'),
      exactRead: wrongRead,
    }).reason,
    'EXACT_SELECTION_SOURCE_READ_MISMATCH'
  );

  const negated = resolution('PRODUCT', productAuthority(), 'не VARIANT_2', 'VARIANT_2');
  negated.intent_hint = 'AFFIRMATIVE_SELECT';
  assert.equal(
    proveExactMessageClarificationSelection({
      projection: projection(),
      resolution: negated,
      exactRead: exactRead('не VARIANT_2'),
    }).code,
    'NO_CLARIFICATION_SELECTION'
  );
});

test('selection proof serializes no raw body, quote, presentation label, stock or price authority', () => {
  const result = proveExactMessageClarificationSelection({
    projection: projection(),
    resolution: resolution('PRODUCT', productAuthority(), 'VARIANT_2'),
    exactRead: exactRead('VARIANT_2'),
  });
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    'intent_hint', 'catalog_generation_id', 'stock', 'quantity', 'price', 'quote',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(serialized.includes(VARIANT_2), true);
});
