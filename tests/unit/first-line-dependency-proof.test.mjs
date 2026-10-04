import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  FIRST_LINE_DEPENDENCY_PROOF_SCHEMA,
  FirstLineDependencyProofError,
  proveClarificationDependency,
} from '../../src/copilot/first-line-dependency-proof.mjs';
import { FIRST_LINE_RESOLUTION_SCHEMA } from '../../src/copilot/first-line-resolution.mjs';
import {
  OPEN_TURN_PROJECTION_SCHEMA,
  projectOpenTurn,
} from '../../src/copilot/first-line-routing-planner.mjs';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';

const NOW = 2_000_000_000_000;
const PRODUCT_1 = 'prod_11111111-1111-4111-8111-111111111111';
const VARIANT_1 = 'var_11111111-1111-4111-8111-111111111111';
const VARIANT_2 = 'var_22222222-2222-4222-8222-222222222222';
const STORE_1 = 'store_11111111-1111-4111-8111-111111111111';
const STORE_2 = 'store_22222222-2222-4222-8222-222222222222';
const BRAND_1 = 'brand_11111111111111111111111111111111';
const CATEGORY_1 = 'cat_11111111111111111111111111111111';
const FINGERPRINT = 'sha256:' + 'a'.repeat(64);

function projection({
  requestedSlot = 'variant_id',
  candidates = [
    { slot: 'variant_id', value: VARIANT_1 },
    { slot: 'variant_id', value: VARIANT_2 },
  ],
  actionState = 'CONFIRMED',
  episodeVersion = 2,
  actionEpisodeVersion = episodeVersion,
  boundaryActionId = 'action-1',
  boundaryActionType = 'CLARIFY',
  boundarySourceMessageId = 500,
  confirmedSourceMessageId = boundarySourceMessageId,
  openSourceMessageIds = [501],
  sourceConversationId = 55,
} = {}) {
  const throughEventSeq = 2 + openSourceMessageIds.length;
  return {
    schema: OPEN_TURN_PROJECTION_SCHEMA,
    stream_id: 'stream-1',
    source_conversation_id: sourceConversationId,
    stream_revision: throughEventSeq,
    through_event_seq: throughEventSeq,
    plan_token: {
      stream_id: 'stream-1',
      stream_revision: throughEventSeq,
      through_event_seq: throughEventSeq,
      routing_ledger_fingerprint: FINGERPRINT,
      episode_id: 'episode-1',
      episode_version: episodeVersion,
      live_action_id: null,
      live_action_state: null,
    },
    active_episode: {
      episode_id: 'episode-1',
      stream_id: 'stream-1',
      state: 'active',
      version: episodeVersion,
      clarification_prompts_sent: 1,
      requested_slot: requestedSlot,
      clarification_action_id: 'action-1',
      stable_slots: {},
      created_at: NOW - 100,
      updated_at: NOW - 50,
      closed_at: null,
      close_reason: null,
    },
    live_public_action: null,
    clarification_action: {
      action_id: 'action-1',
      stream_id: 'stream-1',
      episode_id: 'episode-1',
      episode_version: actionEpisodeVersion,
      prepared_stream_revision: 1,
      action_type: 'CLARIFY',
      state: actionState,
      basis_event_seqs: [1],
      requested_slot: requestedSlot,
      presented_candidates: candidates,
      lease_token: null,
      lease_expires_at: null,
      attempts: 1,
      deadline_at: NOW + 60_000,
      confirmed_source_message_id: confirmedSourceMessageId,
      terminal_reason: null,
      created_at: NOW - 90,
      updated_at: NOW - 40,
      send_started_at: NOW - 80,
      confirmed_at: actionState === 'CONFIRMED' ? NOW - 70 : null,
    },
    open_turn: {
      event_seqs: openSourceMessageIds.map((_, index) => index + 3),
      source_message_ids: openSourceMessageIds,
      first_event_seq: 3,
      last_event_seq: 2 + openSourceMessageIds.length,
      message_count: openSourceMessageIds.length,
    },
    boundary: {
      event_seq: 2,
      source_message_id: boundarySourceMessageId,
      event_kind: 'BABYPARK_PUBLIC_REPLY',
      confirmed_action_id: boundaryActionId,
      confirmed_action_type: boundaryActionType,
    },
    code: 'OPEN_TURN',
    reason: 'AFTER_CONFIRMED_BABYPARK_REPLY',
  };
}

function row(kind, sourceMessageId, authority, turnIndex = 1) {
  return {
    kind,
    turn_index: turnIndex,
    source_message_id: sourceMessageId,
    occurrence: 1,
    start_utf16: 0,
    end_utf16: 5,
    authority,
  };
}

function resolvedAuthority(kind, value) {
  switch (kind) {
    case 'PRODUCT':
      return {
        status: 'RESOLVED',
        reason: 'PRODUCT_RESOLVED',
        resolved: value,
        candidates: [value],
      };
    case 'CATEGORY':
      return {
        status: 'RESOLVED',
        reason: 'CATEGORY_RESOLVED',
        resolved: { canonical_category_id: value },
      };
    case 'BRAND':
      return {
        status: 'RESOLVED',
        reason: 'BRAND_RESOLVED',
        resolved: { canonical_brand_id: value },
      };
    case 'STORE':
      return {
        status: 'RESOLVED',
        reason: 'STORE_RESOLVED',
        resolved: { canonical_store_id: value },
      };
    case 'MONEY':
      return {
        status: 'RESOLVED',
        reason: 'MONEY_RESOLVED',
        currency: 'UAH',
        minor_units: value,
      };
    default:
      throw new Error('unsupported test kind');
  }
}

function resolution(rows, {
  sourceConversationId = 55,
  intentHint = 'MALICIOUS_DEPENDENT_TRUE',
  sourceMessageIds = null,
} = {}) {
  const coverage = sourceMessageIds ?? [
    ...new Set(rows.map(item => item.source_message_id)),
  ];
  if (coverage.length === 0) coverage.push(501);
  return {
    schema: FIRST_LINE_RESOLUTION_SCHEMA,
    extraction_schema: 'bp.first-line.extraction/1',
    intent_schema_version: 'bp.first-line.intent/1',
    intent_hint: intentHint,
    language: 'uk',
    source_conversation_id: sourceConversationId,
    source_message_ids: coverage,
    catalog_generation_id: 'g1',
    knowledge_resolver_contract_version: 1,
    used_revision_ids: [],
    certified_spans: rows.map(item => ({
      kind: item.kind,
      turn_index: item.turn_index,
      source_message_id: item.source_message_id,
      occurrence: item.occurrence,
      start_utf16: item.start_utf16,
      end_utf16: item.end_utf16,
    })),
    resolutions: rows,
  };
}

function noAuthority(status, reason) {
  return { status, reason, resolved: null, candidates: [] };
}

function expectInputError(fn) {
  assert.throws(
    fn,
    error =>
      error instanceof FirstLineDependencyProofError &&
      error.code === 'FIRST_LINE_DEPENDENCY_INPUT_INVALID'
  );
}

test('exact canonical presented candidate is a positive dependency anchor', () => {
  const result = proveClarificationDependency({
    projection: projection(),
    resolution: resolution([
      row('PRODUCT', 501, resolvedAuthority('PRODUCT', {
        canonical_product_id: PRODUCT_1,
        canonical_variant_id: VARIANT_2,
      })),
    ]),
  });

  assert.equal(result.schema, FIRST_LINE_DEPENDENCY_PROOF_SCHEMA);
  assert.equal(result.code, 'DEPENDENCY_PROVEN');
  assert.equal(result.reason, 'PRESENTED_CANDIDATE_SELECTED');
  assert.deepEqual(result.anchor, {
    type: 'PRESENTED_CANDIDATE',
    slot: 'variant_id',
    value: VARIANT_2,
    candidate_ordinal: 2,
    resolution_kind: 'PRODUCT',
    evidence_source_message_ids: [501],
  });
  assert.equal(result.plan_token.routing_ledger_fingerprint, FINGERPRINT);
  assert.equal(result.episode_id, 'episode-1');
  assert.equal(result.clarification_action_id, 'action-1');
});

test('repeated evidence for one candidate still selects one durable candidate', () => {
  const result = proveClarificationDependency({
    projection: projection({ openSourceMessageIds: [501, 502] }),
    resolution: resolution([
      row('PRODUCT', 501, resolvedAuthority('PRODUCT', {
        canonical_product_id: PRODUCT_1,
        canonical_variant_id: VARIANT_2,
      })),
      row('PRODUCT', 502, resolvedAuthority('PRODUCT', {
        canonical_product_id: PRODUCT_1,
        canonical_variant_id: VARIANT_2,
      }), 2),
    ]),
  });

  assert.equal(result.code, 'DEPENDENCY_PROVEN');
  assert.equal(result.anchor.candidate_ordinal, 2);
  assert.deepEqual(result.anchor.evidence_source_message_ids, [501, 502]);
});

test('two distinct current values of one candidate slot are fail-closed', () => {
  const result = proveClarificationDependency({
    projection: projection({
      candidates: [
        { slot: 'variant_id', value: VARIANT_2 },
      ],
      openSourceMessageIds: [501, 502],
    }),
    resolution: resolution([
      row('PRODUCT', 501, resolvedAuthority('PRODUCT', {
        canonical_product_id: PRODUCT_1,
        canonical_variant_id: VARIANT_2,
      })),
      row('PRODUCT', 502, resolvedAuthority('PRODUCT', {
        canonical_product_id: PRODUCT_1,
        canonical_variant_id: VARIANT_1,
      }), 2),
    ]),
  });

  assert.equal(result.code, 'NO_DEPENDENCY_PROOF');
  assert.equal(result.reason, 'PRESENTED_CANDIDATE_AMBIGUOUS');
});

test('malformed durable candidate canonical ID cannot become dependency proof', () => {
  const result = proveClarificationDependency({
    projection: projection({
      candidates: [
        { slot: 'variant_id', value: 'not-a-canonical-variant' },
      ],
    }),
    resolution: resolution([
      row('PRODUCT', 501, resolvedAuthority('PRODUCT', {
        canonical_product_id: PRODUCT_1,
        canonical_variant_id: VARIANT_2,
      })),
    ]),
  });

  assert.equal(result.code, 'NO_DEPENDENCY_PROOF');
  assert.equal(result.reason, 'CLARIFICATION_RESERVATION_MISMATCH');
});

test('duplicate durable candidates matching the same value are fail-closed', () => {
  const result = proveClarificationDependency({
    projection: projection({
      candidates: [
        { slot: 'variant_id', value: VARIANT_2 },
        { slot: 'variant_id', value: VARIANT_2 },
      ],
    }),
    resolution: resolution([
      row('PRODUCT', 501, resolvedAuthority('PRODUCT', {
        canonical_product_id: PRODUCT_1,
        canonical_variant_id: VARIANT_2,
      })),
    ]),
  });

  assert.equal(result.code, 'NO_DEPENDENCY_PROOF');
  assert.equal(result.reason, 'PRESENTED_CANDIDATE_AMBIGUOUS');
});

test('ambiguous authority for the candidate slot blocks candidate proof', () => {
  const result = proveClarificationDependency({
    projection: projection(),
    resolution: resolution([
      row('PRODUCT', 501, resolvedAuthority('PRODUCT', {
        canonical_product_id: PRODUCT_1,
        canonical_variant_id: VARIANT_2,
      })),
      row('PRODUCT', 501, noAuthority('AMBIGUOUS', 'AMBIGUOUS_PRODUCT')),
    ]),
  });

  assert.equal(result.code, 'NO_DEPENDENCY_PROOF');
  assert.equal(result.reason, 'REQUESTED_SLOT_AMBIGUOUS');
});

test('malformed RESOLVED canonical ID invalidates the whole proof input evidence', () => {
  const result = proveClarificationDependency({
    projection: projection({
      requestedSlot: 'store_id',
      candidates: [],
      openSourceMessageIds: [501, 502],
    }),
    resolution: resolution([
      row('STORE', 501, resolvedAuthority('STORE', STORE_1)),
      row('STORE', 502, resolvedAuthority('STORE', 'store-not-canonical'), 2),
    ]),
  });

  assert.equal(result.code, 'NO_DEPENDENCY_PROOF');
  assert.equal(result.reason, 'RESOLUTION_CANONICAL_VALUE_INVALID');
});

test('requested stable slot is filled only by one exact current canonical value', () => {
  const result = proveClarificationDependency({
    projection: projection({
      requestedSlot: 'store_id',
      candidates: [],
    }),
    resolution: resolution([
      row('STORE', 501, resolvedAuthority('STORE', STORE_2)),
    ]),
  });

  assert.equal(result.code, 'DEPENDENCY_PROVEN');
  assert.equal(result.reason, 'REQUESTED_SLOT_FILLED');
  assert.deepEqual(result.anchor, {
    type: 'REQUESTED_SLOT_VALUE',
    slot: 'store_id',
    value: STORE_2,
    candidate_ordinal: null,
    resolution_kind: 'STORE',
    evidence_source_message_ids: [501],
  });
});

test('multiple distinct values for requested slot are not dependency proof', () => {
  const result = proveClarificationDependency({
    projection: projection({
      requestedSlot: 'store_id',
      candidates: [],
      openSourceMessageIds: [501, 502],
    }),
    resolution: resolution([
      row('STORE', 501, resolvedAuthority('STORE', STORE_1)),
      row('STORE', 502, resolvedAuthority('STORE', STORE_2), 2),
    ]),
  });

  assert.equal(result.code, 'NO_DEPENDENCY_PROOF');
  assert.equal(result.reason, 'REQUESTED_SLOT_AMBIGUOUS');
});

test('ambiguous requested-slot authority cannot be hidden by one resolved value', () => {
  const result = proveClarificationDependency({
    projection: projection({
      requestedSlot: 'brand_id',
      candidates: [],
    }),
    resolution: resolution([
      row('BRAND', 501, resolvedAuthority('BRAND', BRAND_1)),
      row('BRAND', 501, noAuthority('AMBIGUOUS', 'AMBIGUOUS_BRAND')),
    ]),
  });

  assert.equal(result.code, 'NO_DEPENDENCY_PROOF');
  assert.equal(result.reason, 'REQUESTED_SLOT_AMBIGUOUS');
});

test('requested money is customer constraint evidence, not dynamic authority', () => {
  const result = proveClarificationDependency({
    projection: projection({
      requestedSlot: 'money',
      candidates: [],
    }),
    resolution: resolution([
      row('MONEY', 501, resolvedAuthority('MONEY', 2_000_000)),
    ]),
  });

  assert.equal(result.code, 'DEPENDENCY_PROVEN');
  assert.equal(result.reason, 'REQUESTED_SLOT_FILLED');
  assert.deepEqual(result.anchor.value, {
    currency: 'UAH',
    minor_units: 2_000_000,
  });
});

test('shortlist_anchor remains unsupported until a deterministic contract exists', () => {
  const result = proveClarificationDependency({
    projection: projection({
      requestedSlot: 'shortlist_anchor',
      candidates: [],
    }),
    resolution: resolution([
      row('PRODUCT', 501, resolvedAuthority('PRODUCT', {
        canonical_product_id: PRODUCT_1,
        canonical_variant_id: VARIANT_1,
      })),
    ]),
  });

  assert.equal(result.code, 'NO_DEPENDENCY_PROOF');
  assert.equal(result.reason, 'REQUESTED_SLOT_UNSUPPORTED');
});

test('unconfirmed clarification is never evidence that candidates were shown', () => {
  for (const actionState of ['PREPARED', 'GATING', 'SENDING', 'UNCERTAIN']) {
    const result = proveClarificationDependency({
      projection: projection({ actionState }),
      resolution: resolution([
        row('PRODUCT', 501, resolvedAuthority('PRODUCT', {
          canonical_product_id: PRODUCT_1,
          canonical_variant_id: VARIANT_2,
        })),
      ]),
    });
    assert.equal(result.code, 'NO_DEPENDENCY_PROOF');
    assert.equal(result.reason, 'CLARIFICATION_NOT_CONFIRMED');
  }
});

test('episode mutation after clarification invalidates clarification dependency proof', () => {
  const result = proveClarificationDependency({
    projection: projection({
      episodeVersion: 3,
      actionEpisodeVersion: 2,
    }),
    resolution: resolution([
      row('STORE', 501, resolvedAuthority('STORE', STORE_1)),
    ]),
  });

  assert.equal(result.code, 'NO_DEPENDENCY_PROOF');
  assert.equal(result.reason, 'CLARIFICATION_EPISODE_MISMATCH');
});

test('episode and confirmed action must preserve the same requested-slot reservation', () => {
  const projected = projection({
    requestedSlot: 'store_id',
    candidates: [],
  });
  const mismatched = {
    ...projected,
    clarification_action: {
      ...projected.clarification_action,
      requested_slot: 'brand_id',
    },
  };

  const result = proveClarificationDependency({
    projection: mismatched,
    resolution: resolution([
      row('STORE', 501, resolvedAuthority('STORE', STORE_1)),
    ]),
  });

  assert.equal(result.code, 'NO_DEPENDENCY_PROOF');
  assert.equal(result.reason, 'CLARIFICATION_RESERVATION_MISMATCH');
});

test('open turn must start after the exact confirmed clarification boundary', () => {
  for (const patch of [
    { boundaryActionId: 'action-other' },
    { boundaryActionType: 'ANSWER' },
    { boundarySourceMessageId: 999, confirmedSourceMessageId: 500 },
  ]) {
    const result = proveClarificationDependency({
      projection: projection(patch),
      resolution: resolution([
        row('STORE', 501, resolvedAuthority('STORE', STORE_1)),
      ]),
    });
    assert.equal(result.code, 'NO_DEPENDENCY_PROOF');
    assert.equal(result.reason, 'CLARIFICATION_BOUNDARY_MISMATCH');
  }
});

test('subset C2b coverage cannot prove dependency for a larger open turn', () => {
  const result = proveClarificationDependency({
    projection: projection({ openSourceMessageIds: [501, 502] }),
    resolution: resolution([
      row('PRODUCT', 501, resolvedAuthority('PRODUCT', {
        canonical_product_id: PRODUCT_1,
        canonical_variant_id: VARIANT_2,
      })),
    ], { sourceMessageIds: [501] }),
  });

  assert.equal(result.code, 'NO_DEPENDENCY_PROOF');
  assert.equal(result.reason, 'RESOLUTION_OPEN_TURN_COVERAGE_MISMATCH');
});

test('complete coverage may include a spanless message without inventing evidence', () => {
  const result = proveClarificationDependency({
    projection: projection({ openSourceMessageIds: [501, 502] }),
    resolution: resolution([
      row('PRODUCT', 501, resolvedAuthority('PRODUCT', {
        canonical_product_id: PRODUCT_1,
        canonical_variant_id: VARIANT_2,
      })),
    ], { sourceMessageIds: [501, 502] }),
  });

  assert.equal(result.code, 'DEPENDENCY_PROVEN');
  assert.equal(result.reason, 'PRESENTED_CANDIDATE_SELECTED');
  assert.deepEqual(result.anchor.evidence_source_message_ids, [501]);
});

test('resolution must belong to the current conversation and open turn', () => {
  const wrongConversation = proveClarificationDependency({
    projection: projection(),
    resolution: resolution([
      row('PRODUCT', 501, resolvedAuthority('PRODUCT', {
        canonical_product_id: PRODUCT_1,
        canonical_variant_id: VARIANT_2,
      })),
    ], { sourceConversationId: 99 }),
  });
  assert.equal(wrongConversation.code, 'NO_DEPENDENCY_PROOF');
  assert.equal(wrongConversation.reason, 'RESOLUTION_CONVERSATION_MISMATCH');

  const oldTurn = proveClarificationDependency({
    projection: projection(),
    resolution: resolution([
      row('PRODUCT', 400, resolvedAuthority('PRODUCT', {
        canonical_product_id: PRODUCT_1,
        canonical_variant_id: VARIANT_2,
      })),
    ], { sourceMessageIds: [400] }),
  });
  assert.equal(oldTurn.code, 'NO_DEPENDENCY_PROOF');
  assert.equal(oldTurn.reason, 'RESOLUTION_OPEN_TURN_COVERAGE_MISMATCH');
});

test('resolution rows must stay inside their own declared exact-read coverage', () => {
  expectInputError(() => proveClarificationDependency({
    projection: projection({ openSourceMessageIds: [501, 502] }),
    resolution: resolution([
      row('STORE', 400, resolvedAuthority('STORE', STORE_1)),
    ], { sourceMessageIds: [501, 502] }),
  }));
});

test('resolution turn index must map to the same covered source message', () => {
  const mismatched = row('STORE', 502, resolvedAuthority('STORE', STORE_1));
  mismatched.turn_index = 1;
  expectInputError(() => proveClarificationDependency({
    projection: projection({ openSourceMessageIds: [501, 502] }),
    resolution: resolution([
      mismatched,
    ], { sourceMessageIds: [501, 502] }),
  }));
});

test('unrelated ambiguous kind does not erase a positive candidate anchor', () => {
  const result = proveClarificationDependency({
    projection: projection(),
    resolution: resolution([
      row('PRODUCT', 501, resolvedAuthority('PRODUCT', {
        canonical_product_id: PRODUCT_1,
        canonical_variant_id: VARIANT_2,
      })),
      row('STORE', 501, noAuthority('AMBIGUOUS', 'AMBIGUOUS_STORE')),
    ]),
  });

  assert.equal(result.code, 'DEPENDENCY_PROVEN');
  assert.equal(result.anchor.slot, 'variant_id');
});

test('raw intent hint cannot create a dependency anchor', () => {
  const result = proveClarificationDependency({
    projection: projection({
      requestedSlot: 'store_id',
      candidates: [],
    }),
    resolution: resolution([], {
      intentHint: 'DEPENDENT_FOLLOWUP_SELECT_ORDINAL_2',
    }),
  });

  assert.equal(result.code, 'NO_DEPENDENCY_PROOF');
  assert.equal(result.reason, 'NO_CLARIFICATION_MATCH');
});

test('malformed projection or resolution contracts fail closed', () => {
  expectInputError(() => proveClarificationDependency({
    projection: { ...projection(), code: 'NO_OPEN_TURN' },
    resolution: resolution([]),
  }));
  expectInputError(() => proveClarificationDependency({
    projection: projection(),
    resolution: { ...resolution([]), schema: 'wrong' },
  }));

  const tokenMismatch = projection();
  expectInputError(() => proveClarificationDependency({
    projection: {
      ...tokenMismatch,
      plan_token: {
        ...tokenMismatch.plan_token,
        episode_version: tokenMismatch.plan_token.episode_version + 1,
      },
    },
    resolution: resolution([]),
  }));

  const certifiedMismatch = resolution([
    row('STORE', 501, resolvedAuthority('STORE', STORE_1)),
  ]);
  expectInputError(() => proveClarificationDependency({
    projection: projection({
      requestedSlot: 'store_id',
      candidates: [],
    }),
    resolution: {
      ...certifiedMismatch,
      certified_spans: [{
        ...certifiedMismatch.certified_spans[0],
        source_message_id: 999,
      }],
    },
  }));
});

function tempStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dependency-proof-'));
  const file = path.join(dir, 'episode.sqlite');
  let episodeCounter = 0;
  let actionCounter = 0;
  const store = FirstLineStateStore.create(file, {
    now: () => NOW,
    streamIdFactory: () => 'stream-1',
    episodeIdFactory: () => 'episode-' + (++episodeCounter),
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

function babyparkReply(sourceMessageId, sourceId) {
  return {
    sourceMessageId,
    eventKind: 'BABYPARK_PUBLIC_REPLY',
    messageType: 'outgoing',
    senderClass: 'configured_agent_bot',
    senderId: 7001,
    contentType: 'text',
    deleted: false,
    unsupported: false,
    hasAttachments: false,
    sourceId,
  };
}

test('real store confirmed CLARIFY -> ledger -> open turn proves one candidate', t => {
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
  store.ingestConversationEvent(
    stream.stream_id,
    babyparkReply(102, action.action_id)
  );
  store.confirmPublicActionFromLedger(action.action_id);
  store.ingestConversationEvent(stream.stream_id, customerEvent(103));

  const projected = projectOpenTurn(store.readRoutingSnapshot(stream.stream_id));
  assert.equal(projected.code, 'OPEN_TURN');
  assert.equal(projected.boundary.confirmed_action_id, action.action_id);
  assert.equal(projected.clarification_action.state, 'CONFIRMED');

  const proof = proveClarificationDependency({
    projection: projected,
    resolution: resolution([
      row('STORE', 103, resolvedAuthority('STORE', STORE_2)),
    ]),
  });

  assert.equal(proof.code, 'DEPENDENCY_PROVEN');
  assert.equal(proof.reason, 'PRESENTED_CANDIDATE_SELECTED');
  assert.equal(proof.anchor.slot, 'store_id');
  assert.equal(proof.anchor.value, STORE_2);
  assert.equal(proof.anchor.candidate_ordinal, 2);
  assert.deepEqual(proof.anchor.evidence_source_message_ids, [103]);

  const serialized = JSON.stringify(proof);
  assert.equal(serialized.includes('quote'), false);
  assert.equal(serialized.includes('intent_hint'), false);
  assert.equal(serialized.includes('stock'), false);
  assert.equal(serialized.includes('price'), false);
});
