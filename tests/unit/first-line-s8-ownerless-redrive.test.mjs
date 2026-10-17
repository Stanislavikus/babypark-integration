import '../helpers/legacy-sending-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import fc from 'fast-check';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';
import {
  redriveFirstLineOwnerlessPage, handoffExpiredFirstLineEarlyActionToHuman,
} from '../../src/copilot/first-line-turn-redrive.mjs';
import { planFirstLineTurnToOutcome } from '../../src/copilot/first-line-turn-planner.mjs';
import { buildFirstLineTransientCandidate } from '../../src/copilot/first-line-runtime-semantics.mjs';
import { prepareFirstLinePublicActionFromCandidate } from '../../src/copilot/first-line-action-preparation.mjs';
import { executeFirstLinePublicSendOnce } from '../../src/copilot/first-line-public-send-coordinator.mjs';
import { FIRST_LINE_EXTRACTION_SCHEMA, FIRST_LINE_INTENT_SCHEMA_VERSION } from '../../src/copilot/first-line-extraction.mjs';

const CLOCK = Date.parse('2026-01-10T12:00:00.000Z');
const event = id => ({
  sourceMessageId: id, eventKind: 'CUSTOMER_MESSAGE',
  messageType: 'incoming', senderClass: 'contact', senderId: 9001,
  contentType: 'text', deleted: false, unsupported: false,
  hasAttachments: false, sourceId: null,
});
const policy = () => ({
  revision_id: 'policy-s8', record_type: 'COMMERCE_POLICY', schema_version: 1,
  namespace: 'commerce.payment_methods', effect_family: 'commerce.payment_methods',
  subject_type: 'business', subject_id: 'babypark', scope: {},
  effect_type: 'PAYMENT_METHODS',
  effect_value: { methods: ['BANK_TRANSFER', 'COD_NOVA_POSHTA'] },
  exception_of_revision_id: null, state: 'PUBLISHED',
  effective_from_utc: '2026-01-01T00:00:00.000Z', expires_at_utc: null,
});
function setup(t, text = 'Здравствуйте, подскажите пожалуйста') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-s8-'));
  const file = path.join(dir, 'episode.sqlite');
  let clock = CLOCK;
  let store = FirstLineStateStore.create(file, { now: () => clock });
  t.after(() => { try { store.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); });
  const stream = store.ensureConversationStream({ sourceProvider: 'chatwoot', sourceConversationId: 55 });
  store.ingestConversationEvent(stream.stream_id, event(101));
  let posts = 0;
  const options = () => ({
    store, limit: 10,
    reader: {
      async readExactSourceMessage(_conversation, id) {
        return {
          code: 'SUPPORTED_CUSTOMER_TEXT',
          sourceConversationId: 55, sourceMessageId: id,
          event: event(id), transientContent: text,
        };
      },
    },
    produceExtraction: async () => ({
      schema: FIRST_LINE_EXTRACTION_SCHEMA,
      intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
      intent_hint: 'UNTRUSTED', language: 'ru', spans: [],
    }),
    catalogService: {},
    knowledgeStore: { authoritySnapshot: () => [policy()] },
    deadlineForCandidate: () => CLOCK + 600_000, // synthetic fixture only
  });
  return {
    get store() { return store; }, file, sid: stream.stream_id, options,
    restart() { store.close(); store = FirstLineStateStore.open(file, { now: () => clock }); },
    setNow(ms) { clock = ms; },
    posts: () => posts,
  };
}
function absentDb(f, text) {
  const bytes = fs.readFileSync(f.file);
  assert.equal(bytes.includes(Buffer.from(text)), false);
}
test('S8 discovers owner-less admitted revision and after restart commits one durable HUMAN', async t => {
  const f = setup(t, 'SECRET_CUSTOMER_SENTINEL_2026');
  assert.equal(f.store.listOwnerlessCurrentStreams({ limit: 10 }).length, 1);
  f.restart();
  const a = await redriveFirstLineOwnerlessPage(f.options());
  assert.deepEqual(a.results.map(x => x.code), ['HUMAN_DURABLE']);
  assert.equal(f.store.getUnresolvedContinuationOwner(f.sid).owner_kind, 'HUMAN');
  assert.equal(f.store.getSemanticOrigin(f.sid, 1).origin_kind, 'DIRECT_HUMAN');
  assert.equal(a.operationallyComplete, false);
  assert.deepEqual((await redriveFirstLineOwnerlessPage(f.options())).results, []);
  absentDb(f, 'SECRET_CUSTOMER_SENTINEL_2026');
});
test('S8 grounded ANSWER commits one existing public action but never POSTs', async t => {
  const f = setup(t, 'Какие способы оплаты есть?');
  const r = await redriveFirstLineOwnerlessPage(f.options());
  assert.deepEqual(r.results.map(x => x.code), ['PUBLIC_ACTION_DURABLE']);
  assert.equal(f.store.getUnresolvedContinuationOwner(f.sid).owner_kind, 'PUBLIC_ACTION');
  assert.equal(f.store.listRecoverablePublicActions().length, 1);
  assert.equal(f.store.listRecoverablePublicActions()[0].state, 'PREPARED');
  f.restart();
  const next = await redriveFirstLineOwnerlessPage(f.options());
  assert.equal(next.results.length, 0);
  assert.deepEqual(next.earlyActions.map(a => a.code), ['EARLY_ACTION_REBUILD_REQUIRED']);
  assert.equal(next.operationallyComplete, false);
  assert.equal(f.store.listRecoverablePublicActions().length, 1);
  absentDb(f, 'Какие способы оплаты есть?');
});
test('S8 no made-up deadline; unowned result is BLOCKED, not success', async t => {
  const f = setup(t, 'Какие способы оплаты есть?');
  const r = await redriveFirstLineOwnerlessPage({
    ...f.options(), deadlineForCandidate: () => CLOCK - 1,
  });
  assert.deepEqual(r.results.map(x => x.code), ['BLOCKED_DEADLINE_UNPROVABLE']);
  assert.equal(f.store.getUnresolvedContinuationOwner(f.sid), null);
  assert.equal(f.store.listRecoverablePublicActions().length, 0);
  assert.equal(r.operationallyComplete, false);
});
test('S8 concurrent redrivers cannot create more than one semantic origin', async t => {
  const f = setup(t);
  const results = await Promise.all([
    redriveFirstLineOwnerlessPage(f.options()),
    redriveFirstLineOwnerlessPage(f.options()),
    redriveFirstLineOwnerlessPage(f.options()),
  ]);
  assert.equal(f.store.getSemanticOrigin(f.sid, 1).origin_kind, 'DIRECT_HUMAN');
  assert.equal(f.store.getUnresolvedContinuationOwner(f.sid).owner_kind, 'HUMAN');
  assert(results.every(v => v.operationallyComplete === false));
  const a = f.store.db.prepare('SELECT count(*) AS n FROM semantic_origins').get();
  assert.equal(a.n, 1);
});
test('S8 planner failure produces durable HUMAN without exposing text or exception', async t => {
  const f = setup(t, 'NEVER_STORE_CUSTOMER_SENTINEL');
  const o = f.options();
  o.produceExtraction = async () => { throw new Error('NEVER_STORE_EXCEPTION_SENTINEL'); };
  const r = await redriveFirstLineOwnerlessPage(o);
  assert.deepEqual(r.results.map(x => x.code), ['HUMAN_DURABLE']);
  absentDb(f, 'NEVER_STORE_EXCEPTION_SENTINEL');
  absentDb(f, 'NEVER_STORE_CUSTOMER_SENTINEL');
});
test('S8 changed stream revision during planning does not claim false success', async t => {
  const f = setup(t, 'Какие способы оплаты есть?');
  const o = f.options();
  o.produceExtraction = async () => {
    f.store.ingestConversationEvent(f.sid, event(102));
    return {
      schema: FIRST_LINE_EXTRACTION_SCHEMA,
      intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
      intent_hint: 'UNTRUSTED', language: 'ru', spans: [],
    };
  };
  const r = await redriveFirstLineOwnerlessPage(o);
  assert.deepEqual(r.results.map(x => x.code), ['STALE_REPLAN']);
  assert.equal(r.operationallyComplete, false);
  assert.equal(f.store.getUnresolvedContinuationOwner(f.sid), null);
});
test('S8 rejects invalid cursor/page and never enumerates revision zero', t => {
  const f = setup(t);
  f.store.ensureConversationStream({ sourceProvider: 'chatwoot', sourceConversationId: 56 });
  assert.equal(f.store.listOwnerlessCurrentStreams({ limit: 10 }).length, 1);
  assert.deepEqual(f.store.listOwnerlessCurrentStreams({ limit: 10, afterStreamId: f.sid }), []);
  assert.throws(() => f.store.listOwnerlessCurrentStreams({ limit: 0 }));
});
test('S8 unsupported reader with no trustworthy source commits HUMAN not answer', async t => {
  const f = setup(t);
  const o = f.options();
  o.reader.readExactSourceMessage = async () => { throw new Error('SECRET_READER'); };
  const r = await redriveFirstLineOwnerlessPage(o);
  assert.equal(r.results[0].code, 'HUMAN_DURABLE');
  assert.equal(f.store.listRecoverablePublicActions().length, 0);
});

test('S8 expired PREPARED fail-closes to HUMAN via existing atomic state machine, no POST', async t => {
  const f = setup(t, 'Какие способы оплаты есть?');
  assert.equal((await redriveFirstLineOwnerlessPage(f.options())).results[0].code,
    'PUBLIC_ACTION_DURABLE');
  const action = f.store.listRecoverablePublicActions()[0];
  assert.equal(handoffExpiredFirstLineEarlyActionToHuman({
    store: f.store, actionId: action.action_id,
  }).code, 'BLOCKED_DEADLINE_NOT_REACHED');
  f.restart();
  f.setNow(CLOCK + 600_001);
  const denied = handoffExpiredFirstLineEarlyActionToHuman({
    store: f.store, actionId: action.action_id,
  });
  assert.equal(denied.code, 'EXPIRED_EARLY_ACTION_HUMAN_DURABLE');
  assert.equal(f.store.getUnresolvedContinuationOwner(f.sid).owner_kind, 'HUMAN');
  assert.equal(f.store.listRecoverablePublicActions().length, 0);
  assert.equal(handoffExpiredFirstLineEarlyActionToHuman({
    store: f.store, actionId: action.action_id,
  }).code, 'BLOCKED_NOT_ELIGIBLE');
  absentDb(f, 'Какие способы оплаты есть?');
});
test('S8 expired GATING claim is protected until exact lease expiry', async t => {
  const f = setup(t, 'Какие способы оплаты есть?');
  await redriveFirstLineOwnerlessPage(f.options());
  const action = f.store.claimNextPublicAction({
    leaseMs: 1_000_000, token: 'S8-owned-claim',
  });
  assert.equal(action.state, 'GATING');
  f.setNow(CLOCK + 600_001);
  assert.equal(handoffExpiredFirstLineEarlyActionToHuman({
    store: f.store, actionId: action.action_id,
  }).code, 'BLOCKED_ACTIVE_OR_UNKNOWN_LEASE');
  assert.equal(f.store.getUnresolvedContinuationOwner(f.sid).owner_kind, 'PUBLIC_ACTION');
  f.setNow(CLOCK + 1_000_001);
  const result = handoffExpiredFirstLineEarlyActionToHuman({
    store: f.store, actionId: action.action_id,
  });
  assert.equal(result.code, 'EXPIRED_EARLY_ACTION_HUMAN_DURABLE');
  assert.equal(f.store.getUnresolvedContinuationOwner(f.sid).owner_kind, 'HUMAN');
  assert.equal(f.store.listRecoverablePublicActions().length, 0);
});
test('S8 planner ignores caller-forged expired policy clock', async t => {
  const f = setup(t, 'Какие способы оплаты есть?');
  const o = f.options();
  o.knowledgeStore = { authoritySnapshot: () => [{
    ...policy(), expires_at_utc: '2026-01-10T11:59:00.000Z',
  }] };
  const result = await planFirstLineTurnToOutcome({
    ...o, streamId: f.sid, nowUtc: '2026-01-10T11:00:00.000Z',
  });
  assert.notEqual(result.code, 'CANDIDATE');
  assert.equal(f.store.listRecoverablePublicActions().length, 0);
});

test('S8 property: restart/interleaving never creates duplicate durable origin or public actions', async t => {
  await fc.assert(fc.asyncProperty(
    fc.boolean(), fc.boolean(), fc.integer({ min: 1, max: 3 }),
    async (grounded, restart, parallel) => {
      const f = setup(t, grounded ? 'Какие способы оплаты есть?' : 'Здравствуйте, подскажите пожалуйста');
      if (restart) f.restart();
      const runs = await Promise.all(Array.from({ length: parallel },
        () => redriveFirstLineOwnerlessPage(f.options())));
      assert(runs.every(x => x.operationallyComplete === false));
      const origins = f.store.db.prepare('SELECT count(*) n FROM semantic_origins').get().n;
      const actions = f.store.db.prepare('SELECT count(*) n FROM public_actions').get().n;
      const owner = f.store.getUnresolvedContinuationOwner(f.sid);
      assert.equal(origins, 1);
      assert.equal(actions, grounded ? 1 : 0);
      assert.equal(owner?.owner_kind, grounded ? 'PUBLIC_ACTION' : 'HUMAN');
      const repeated = await redriveFirstLineOwnerlessPage(f.options());
      assert.equal(repeated.results.length, 0);
      assert.equal(repeated.operationallyComplete, false);
    }
  ), { numRuns: 12, endOnFailure: true });
});
test('S8 real SQLite write lock cannot produce false durable success', async t => {
  const f = setup(t, 'Спасибо!');
  const blocker = new DatabaseSync(f.file);
  t.after(() => { try { blocker.close(); } catch {} });
  blocker.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');
  const denied = await redriveFirstLineOwnerlessPage(f.options());
  assert.equal(denied.operationallyComplete, false);
  assert(!denied.results.some(x => x.code === 'HUMAN_DURABLE' || x.code === 'PUBLIC_ACTION_DURABLE'));
  blocker.exec('ROLLBACK');
  const recovered = await redriveFirstLineOwnerlessPage(f.options());
  assert.equal(recovered.results[0].code, 'HUMAN_DURABLE');
  assert.equal(f.store.getUnresolvedContinuationOwner(f.sid)?.owner_kind, 'HUMAN');
});
test('S8-1 corrupt stream does not starve two healthy ownerless streams (real SQLite)', async t => {
  const f = setup(t);
  const victim = f.sid;
  const healthy = [56, 57].map((conversation, i) => {
    const s = f.store.ensureConversationStream({
      sourceProvider: 'chatwoot', sourceConversationId: conversation,
    });
    f.store.ingestConversationEvent(s.stream_id, event(150 + i));
    return s.stream_id;
  });
  f.store.commitDirectHumanOrigin({
    streamId: victim, streamRevision: 1, reason: 'PLANNING_HUMAN_DECISION',
  });
  f.store.terminalizeHumanContinuation(victim, 1, { outcome: 'HUMAN_TAKEOVER' });
  f.store.ingestConversationEvent(victim, event(900));
  // Test-only simulated corruption of the immutable terminal cut.
  f.store.db.exec('DROP TRIGGER human_terminal_cuts_no_delete_v4');
  f.store.db.prepare('DELETE FROM human_terminal_cuts WHERE stream_id=?').run(victim);
  assert.equal(f.store.listOwnerlessCurrentStreams({ limit: 10 }).length, 3);
  const opts = f.options();
  opts.reader = {
    async readExactSourceMessage(conversation, sourceMessageId) {
      return {
        code: 'SUPPORTED_CUSTOMER_TEXT',
        sourceConversationId: conversation, sourceMessageId,
        event: event(sourceMessageId), transientContent: 'Здравствуйте, подскажите пожалуйста',
      };
    },
  };
  const result = await redriveFirstLineOwnerlessPage(opts);
  const mapped = new Map(result.results.map(row => [row.streamId, row.code]));
  assert.equal(mapped.get(victim), 'BLOCKED_STREAM_CORRUPT');
  for (const sid of healthy) {
    assert.equal(mapped.get(sid), 'HUMAN_DURABLE');
    assert.equal(f.store.getUnresolvedContinuationOwner(sid)?.owner_kind, 'HUMAN');
  }
  assert.equal(result.operationallyComplete, false);
  assert.equal(result.discoveryStatus, 'READ_OK');
  assert.equal(result.nextCursor, result.results.at(-1).streamId);
});
test('S8-1 action-scan corruption reported without suppressing ownerless work', async t => {
  const f = setup(t);
  f.store.listRecoverablePublicActions = () => { throw new Error('SENSITIVE_BAD_ACTION'); };
  const result = await redriveFirstLineOwnerlessPage(f.options());
  assert.equal(result.earlyActionsStatus, 'EARLY_ACTIONS_UNREADABLE');
  assert.deepEqual(result.earlyActions, []);
  assert.equal(result.results[0].code, 'HUMAN_DURABLE');
  assert.equal(result.operationallyComplete, false);
});
test('S8-1 global page lookup error reports explicit failure rather than empty success', async t => {
  const f = setup(t);
  f.store.listOwnerlessCurrentStreams = () => { throw new Error('CORRUPTED_INDEX'); };
  const result = await redriveFirstLineOwnerlessPage(f.options());
  assert.equal(result.discoveryStatus, 'OWNERLESS_PAGE_UNREADABLE');
  assert.equal(result.nextCursor, null);
  assert.equal(result.operationallyComplete, false);
  assert.equal(result.results.length, 0);
  assert.equal(f.store.getUnresolvedContinuationOwner(f.sid), null);
});
test('S8-1 cursor progress through multiple permanently blocked pages', async t => {
  const f = setup(t, 'Какие способы оплаты есть?');
  for (const [i, conversation] of [56, 57].entries()) {
    const st = f.store.ensureConversationStream({
      sourceProvider: 'chatwoot', sourceConversationId: conversation,
    });
    f.store.ingestConversationEvent(st.stream_id, event(200 + i));
  }
  const seen = new Set();
  let cursor = null;
  for (let iteration = 0; iteration < 3; iteration++) {
    const opts = f.options();
    opts.limit = 1;
    opts.afterStreamId = cursor;
    opts.deadlineForCandidate = () => CLOCK;
    opts.reader = {
      async readExactSourceMessage(conversation, sourceMessageId) {
        return {
          code: 'SUPPORTED_CUSTOMER_TEXT',
          sourceConversationId: conversation, sourceMessageId,
          event: event(sourceMessageId),
          transientContent: 'Какие способы оплаты есть?',
        };
      },
    };
    const page = await redriveFirstLineOwnerlessPage(opts);
    assert.equal(page.results.length, 1);
    assert.equal(page.results[0].code, 'BLOCKED_DEADLINE_UNPROVABLE');
    assert(!seen.has(page.results[0].streamId));
    seen.add(page.results[0].streamId);
    assert.notEqual(cursor, page.nextCursor);
    cursor = page.nextCursor;
  }
  assert.equal(seen.size, 3);
  assert.equal((await redriveFirstLineOwnerlessPage({
    ...f.options(), limit: 1, afterStreamId: cursor,
  })).results.length, 0);
});
test('S8-2 OBS-1 OPEN: structured sender denial is not durable HUMAN and must never count as handled', async t => {
  const f = setup(t, 'Сколько стоит Дубль?');
  f.store.beginEpisode({ streamId: f.sid });
  const products = [
    'prod_11111111-1111-4111-8111-111111111111',
    'prod_22222222-2222-4222-8222-222222222222',
  ];
  const opts = f.options();
  opts.knowledgeStore = { authoritySnapshot: () => [] };
  opts.produceExtraction = async () => ({
    schema: FIRST_LINE_EXTRACTION_SCHEMA,
    intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
    intent_hint: 'UNTRUSTED', language: 'ru',
    spans: [{ kind: 'PRODUCT', turn_index: 1, quote: 'Дубль', occurrence: 1 }],
  });
  opts.catalogService = {
    resolveProductIdentityExact() {
      return {
        catalog: { generation_id: 'g1' }, status: 'AMBIGUOUS', product: null,
        candidates: products.map((product_id, i) => ({
          product_id, variant_id: null, sku: null, sku_key: null,
          title: 'Дубль ' + i, matched_languages: ['ru'], matched_by: ['EXACT_TITLE'],
        })),
      };
    },
    getProduct({ productId }) {
      return {
        catalog: { generation_id: 'g1' },
        product: {
          product_id: productId, default_variant_id: null, brand: null, variants: [],
          categories: [], attributes: [], images: [],
          localized: {
            ru: { title: productId === products[0] ? 'Дубль модель A' : 'Дубль модель B', url: 'https://babypark.ua/variant-test' },
            uk: { title: productId === products[0] ? 'Дубль модель A' : 'Дубль модель B', url: 'https://babypark.ua/variant-test' },
          },
        },
      };
    },
  };
  const candidate = await buildFirstLineTransientCandidate({
    ...opts, streamId: f.sid, nowUtc: new Date(CLOCK).toISOString(),
  });
  assert.equal(candidate.code, 'CANDIDATE', candidate.reason);
  assert.equal(candidate.decision.decision, 'CLARIFY');
  const { action } = prepareFirstLinePublicActionFromCandidate({
    store: f.store, streamId: f.sid, candidate, deadlineAt: CLOCK + 600_000,
  });
  let postCount = 0;
  const denial = await executeFirstLinePublicSendOnce({
    store: f.store, candidate, actionId: action.action_id,
    authorityReader: { readCorrelatedPublicReplyEvidence() {} },
    transport: { postOutgoingMessage() { postCount++; } },
    maxConfirmationReads: 1, confirmationWaitMs: 0,
  });
  assert.equal(denial.code, 'HUMAN_REQUIRED');
  assert.equal(denial.reason, 'STRUCTURED_POST_PROOF_PENDING');
  // This observable is NOT a completed HUMAN handoff. When relay is wired,
  // this open defect must be fixed before any denial is acknowledged as done.
  assert.equal(f.store.getUnresolvedContinuationOwner(f.sid)?.owner_kind, 'PUBLIC_ACTION');
  assert.equal(f.store.getPublicAction(action.action_id).state, 'PREPARED');
  assert.equal(postCount, 0);
});

test('S8-1 property: every subset of corrupt terminal cuts isolates all healthy streams', async t => {
  await fc.assert(fc.asyncProperty(
    fc.integer({ min: 1, max: 7 }), async mask => {
      const f = setup(t);
      const entries = [{ sid: f.sid, conversation: 55 }];
      for (const [i, conversation] of [56, 57].entries()) {
        const st = f.store.ensureConversationStream({
          sourceProvider: 'chatwoot', sourceConversationId: conversation,
        });
        f.store.ingestConversationEvent(st.stream_id, event(200 + i));
        entries.push({ sid: st.stream_id, conversation });
      }
      f.store.db.exec('DROP TRIGGER human_terminal_cuts_no_delete_v4');
      for (const [index, { sid }] of entries.entries()) {
        if (!(mask & (1 << index))) continue;
        f.store.commitDirectHumanOrigin({
          streamId: sid, streamRevision: 1, reason: 'PLANNING_HUMAN_DECISION',
        });
        f.store.terminalizeHumanContinuation(sid, 1, {
          outcome: 'HUMAN_TAKEOVER',
        });
        f.store.ingestConversationEvent(sid, event(600 + index));
        f.store.db.prepare('DELETE FROM human_terminal_cuts WHERE stream_id=?')
          .run(sid);
      }
      const opts = f.options();
      opts.reader = {
        async readExactSourceMessage(conversation, sourceMessageId) {
          return {
            code: 'SUPPORTED_CUSTOMER_TEXT',
            sourceConversationId: conversation, sourceMessageId,
            event: event(sourceMessageId),
            transientContent: 'Здравствуйте, подскажите пожалуйста',
          };
        },
      };
      const r = await redriveFirstLineOwnerlessPage(opts);
      assert.equal(r.results.length, 3);
      const outcomes = new Map(r.results.map(item => [item.streamId, item.code]));
      for (const [i, { sid }] of entries.entries()) {
        if (mask & (1 << i)) {
          assert.equal(outcomes.get(sid), 'BLOCKED_STREAM_CORRUPT');
          assert.equal(f.store.getUnresolvedContinuationOwner(sid), null);
        } else {
          assert.equal(outcomes.get(sid), 'HUMAN_DURABLE');
          assert.equal(f.store.getUnresolvedContinuationOwner(sid)?.owner_kind, 'HUMAN');
        }
      }
      assert.equal(r.operationallyComplete, false);
    }
  ), { numRuns: 7, endOnFailure: true });
});
