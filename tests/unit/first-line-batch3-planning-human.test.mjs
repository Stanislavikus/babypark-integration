import '../helpers/legacy-sending-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';
import { planFirstLineTurnToOutcome } from '../../src/copilot/first-line-turn-planner.mjs';
import {
  FIRST_LINE_EXTRACTION_SCHEMA, FIRST_LINE_INTENT_SCHEMA_VERSION,
} from '../../src/copilot/first-line-extraction.mjs';

const NOW_MS = Date.parse('2026-01-10T12:00:00.000Z');
const NOW = new Date(NOW_MS).toISOString();
const E = (id) => ({
  sourceMessageId: id, eventKind: 'CUSTOMER_MESSAGE',
  messageType: 'incoming', senderClass: 'contact', senderId: 9001,
  contentType: 'text', deleted: false, unsupported: false,
  hasAttachments: false, sourceId: null,
});
function policy() {
  return {
    revision_id: 'policy-1', record_type: 'COMMERCE_POLICY', schema_version: 1,
    namespace: 'commerce.payment_methods', effect_family: 'commerce.payment_methods',
    subject_type: 'business', subject_id: 'babypark', scope: {},
    effect_type: 'PAYMENT_METHODS',
    effect_value: { methods: ['BANK_TRANSFER', 'COD_NOVA_POSHTA'] },
    exception_of_revision_id: null, state: 'PUBLISHED',
    effective_from_utc: '2026-01-01T00:00:00.000Z',
    expires_at_utc: null,
  };
}
function fixture(t, { text = 'Какие способы оплаты есть?', withPolicy = true, withEvent = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-b3-owner-'));
  const file = path.join(dir, 'episode.sqlite');
  const store = FirstLineStateStore.create(file, { now: () => NOW_MS });
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot', sourceConversationId: 55,
  });
  if (withEvent) store.ingestConversationEvent(stream.stream_id, E(101));
  const opts = {
    store, streamId: stream.stream_id,
    reader: {
      async readExactSourceMessage(_c, id) {
        return {
          code: 'SUPPORTED_CUSTOMER_TEXT', sourceConversationId: 55,
          sourceMessageId: id, event: E(id), transientContent: text,
        };
      },
    },
    produceExtraction: async () => ({
      schema: FIRST_LINE_EXTRACTION_SCHEMA,
      intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
      intent_hint: 'NOT_AUTHORITY', language: 'ru', spans: [],
    }),
    catalogService: {},
    knowledgeStore: { authoritySnapshot: () => withPolicy ? [policy()] : [] },
    nowUtc: NOW,
  };
  return { dir, file, store, sid: stream.stream_id, opts };
}
function owner(f) {
  return f.store.getUnresolvedContinuationOwner(f.sid);
}
function noLeak(f, ...sentinels) {
  const bytes = fs.readFileSync(f.file);
  for (const s of sentinels) assert.equal(bytes.includes(Buffer.from(s)), false);
}
test('B2 greeting creates exactly one durable HUMAN origin bound to first-turn episode', async t => {
  const f = fixture(t, { text: 'Здравствуйте, подскажите пожалуйста' });
  const result = await planFirstLineTurnToOutcome(f.opts);
  assert.equal(result.code, 'HUMAN_OWNED');
  assert.equal(result.continuationOwner.owner_kind, 'HUMAN');
  assert.equal(result.continuationOwner.human_reason, 'PLANNING_HUMAN_DECISION');
  const ep = f.store.loadActiveEpisode(f.sid);
  assert.equal(result.continuationOwner.episode_id, ep.episode_id);
  assert.equal(f.store.getSemanticOrigin(f.sid, 1).origin_kind, 'DIRECT_HUMAN');
  const replay = await planFirstLineTurnToOutcome(f.opts);
  assert.equal(replay.code, 'HUMAN_ALREADY_OWNED');
  assert.equal(replay.continuationOwner.stream_revision, 1);
  noLeak(f, 'Здравствуйте, подскажите пожалуйста');
});
test('B2 unclassified Спасибо never escapes as throw or customer text', async t => {
  const f = fixture(t, { text: 'Спасибо!' });
  const result = await planFirstLineTurnToOutcome(f.opts);
  assert.equal(result.code, 'HUMAN_OWNED');
  assert.equal(owner(f)?.human_reason, 'PLANNING_ERROR');
  noLeak(f, 'Спасибо!', 'FIRST_LINE_DECISION_FAMILY_UNCLASSIFIED');
});
test('B2 known grounded payment remains transient CANDIDATE without HUMAN', async t => {
  const f = fixture(t);
  const result = await planFirstLineTurnToOutcome(f.opts);
  assert.equal(result.code, 'CANDIDATE');
  assert.equal(result.candidate.decision.decision, 'ANSWER');
  assert.equal(owner(f), null);
  noLeak(f, 'Какие способы оплаты есть?');
});
test('B2 policy missing commits HUMAN instead of leaving revision ownerless', async t => {
  const f = fixture(t, { withPolicy: false });
  const result = await planFirstLineTurnToOutcome(f.opts);
  assert.equal(result.code, 'HUMAN_OWNED');
  assert.equal(owner(f)?.owner_kind, 'HUMAN');
});
test('B2 extractor failure commits HUMAN and never stores error message', async t => {
  const f = fixture(t);
  f.opts.produceExtraction = async () => { throw new Error('PRIVATE_EXCEPTION_TEST_STRING'); };
  const result = await planFirstLineTurnToOutcome(f.opts);
  assert.equal(result.code, 'HUMAN_OWNED');
  assert.equal(owner(f)?.owner_kind, 'HUMAN');
  noLeak(f, 'PRIVATE_EXCEPTION_TEST_STRING');
});
test('B2 changed revision rejects old planner result without creating HUMAN', async t => {
  const f = fixture(t);
  f.opts.produceExtraction = async () => {
    f.store.ingestConversationEvent(f.sid, E(102));
    return {
      schema: FIRST_LINE_EXTRACTION_SCHEMA,
      intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
      intent_hint: 'IGNORED', language: 'ru', spans: [],
    };
  };
  const result = await planFirstLineTurnToOutcome(f.opts);
  assert.equal(result.code, 'STALE_REPLAN');
  assert.equal(owner(f), null);
});
test('B2 recovery barrier still commits HUMAN, no autonomous candidate', async t => {
  const f = fixture(t);
  f.store.enterRecoveryBarrier({ reason: 'synthetic_test_recovery' });
  const result = await planFirstLineTurnToOutcome(f.opts);
  assert.equal(result.code, 'HUMAN_OWNED');
  assert.equal(owner(f)?.human_reason, 'RECOVERY_BARRIER');
});
test('B2 durable commit failure is never reported as ownership', async t => {
  const f = fixture(t, { text: 'Спасибо!' });
  const orig = f.store.commitDirectHumanOrigin.bind(f.store);
  f.store.commitDirectHumanOrigin = () => { throw new Error('SENSITIVE_SQLITE_SENTINEL'); };
  const result = await planFirstLineTurnToOutcome(f.opts);
  assert.equal(result.code, 'HUMAN_WRITE_REFUSED');
  assert.equal(owner(f), null);
  f.store.commitDirectHumanOrigin = orig;
  const replay = await planFirstLineTurnToOutcome(f.opts);
  assert.equal(replay.code, 'HUMAN_OWNED');
  noLeak(f, 'SENSITIVE_SQLITE_SENTINEL');
});
test('B2 no incoming revision returns NO_ACTION rather than fabricated HUMAN', async t => {
  const f = fixture(t, { withEvent: false });
  const result = await planFirstLineTurnToOutcome(f.opts);
  assert.equal(result.code, 'NO_ACTION');
  assert.equal(owner(f), null);
});

test('B2 genuine ambiguous-product CLARIFY commits HUMAN without reserving public action', async t => {
  const f = fixture(t, { text: 'Сколько стоит Дубль?', withPolicy: false });
  f.store.beginEpisode({ streamId: f.sid });
  const products = [
    'prod_11111111-1111-4111-8111-111111111111',
    'prod_22222222-2222-4222-8222-222222222222',
  ];
  f.opts.produceExtraction = async () => ({
    schema: FIRST_LINE_EXTRACTION_SCHEMA,
    intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
    intent_hint: 'UNTRUSTED', language: 'ru',
    spans: [{ kind: 'PRODUCT', turn_index: 1, quote: 'Дубль', occurrence: 1 }],
  });
  f.opts.catalogService = {
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
          product_id: productId, default_variant_id: null,
          brand: null, variants: [], categories: [], attributes: [], images: [],
          localized: {
            ru: { title: productId === products[0] ? 'Дубль модель A' : 'Дубль модель B', url: 'https://babypark.ua/variant-test' },
            uk: { title: productId === products[0] ? 'Дубль модель A' : 'Дубль модель B', url: 'https://babypark.ua/variant-test' },
          },
        },
      };
    },
  };
  const result = await planFirstLineTurnToOutcome(f.opts);
  assert.equal(result.code, 'HUMAN_OWNED');
  assert.equal(owner(f)?.human_reason, 'CLARIFY_SEND_DISABLED');
  const active = f.store.loadActiveEpisode(f.sid);
  assert.equal(active.clarification_prompts_sent, 0);
  assert.equal(f.store.listRecoverablePublicActions().length, 0);
  assert.equal(f.store.getSemanticOrigin(f.sid, 1).origin_kind, 'DIRECT_HUMAN');
});

test('B2 re-drive after prior route transaction seals the same episode as HUMAN', async t => {
  const f = fixture(t, { text: 'Здравствуйте, подскажите пожалуйста' });
  const { buildFirstLineTransientCandidate } =
    await import('../../src/copilot/first-line-runtime-semantics.mjs');
  const prior = await buildFirstLineTransientCandidate(f.opts);
  assert.equal(prior.code, 'HUMAN_REQUIRED');
  const before = f.store.loadActiveEpisode(f.sid);
  assert.equal(owner(f), null);
  const result = await planFirstLineTurnToOutcome(f.opts);
  assert.equal(result.code, 'HUMAN_OWNED');
  assert.equal(owner(f).episode_id, before.episode_id);
  assert.equal(f.store.loadActiveEpisode(f.sid).episode_id, before.episode_id);
});

test('B2 stale episode version CAS is a replan, not ownership', async t => {
  const f = fixture(t, { text: 'Спасибо!' });
  f.store.beginEpisode({ streamId: f.sid });
  f.store.commitDirectHumanOrigin = () => {
    const error = new Error('SYNTHETIC_STALE_EPISODE_SENTINEL');
    error.code = 'FIRST_LINE_STALE_WRITE';
    throw error;
  };
  const result = await planFirstLineTurnToOutcome(f.opts);
  assert.equal(result.code, 'STALE_REPLAN');
  assert.equal(owner(f), null);
  noLeak(f, 'SYNTHETIC_STALE_EPISODE_SENTINEL');
});

test('B2 unreadable exact message is durable HUMAN, not silent/no owner', async t => {
  const f = fixture(t);
  f.opts.reader.readExactSourceMessage = async () => {
    throw new Error('SYNTHETIC_READER_EXCEPTION');
  };
  const result = await planFirstLineTurnToOutcome(f.opts);
  assert.equal(result.code, 'HUMAN_OWNED');
  assert.equal(owner(f)?.owner_kind, 'HUMAN');
  noLeak(f, 'SYNTHETIC_READER_EXCEPTION');
});

test('B2 unknown catalog return shape fails to durable HUMAN without any public action', async t => {
  const f = fixture(t, { text: 'Сколько стоит Дубль?' });
  f.opts.produceExtraction = async () => ({
    schema: FIRST_LINE_EXTRACTION_SCHEMA,
    intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
    intent_hint: 'IGNORE', language: 'ru',
    spans: [{ kind: 'PRODUCT', turn_index: 1, quote: 'Дубль', occurrence: 1 }],
  });
  f.opts.catalogService = {
    resolveProductIdentityExact: () => ({ status: 'FUTURE_STATUS_UNKNOWN' }),
  };
  const result = await planFirstLineTurnToOutcome(f.opts);
  assert.equal(result.code, 'HUMAN_OWNED');
  assert.equal(owner(f)?.owner_kind, 'HUMAN');
  assert.equal(f.store.listRecoverablePublicActions().length, 0);
});

test('B2 every durable HUMAN reason in these cases is from the closed set', async t => {
  const f = fixture(t, { text: 'Спасибо!' });
  const r = await planFirstLineTurnToOutcome(f.opts);
  assert.equal(r.code, 'HUMAN_OWNED');
  const allowed = new Set([
    'PLANNING_HUMAN_DECISION', 'PLANNING_ERROR', 'CLARIFY_SEND_DISABLED',
    'RECOVERY_BARRIER', 'PLANNING_OUTCOME_UNKNOWN', 'PLANNING_ROUTE_UNPROVABLE',
  ]);
  assert(allowed.has(owner(f)?.human_reason));
});
