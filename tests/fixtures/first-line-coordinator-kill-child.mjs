import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';
import { buildFirstLineTransientCandidate } from '../../src/copilot/first-line-runtime-semantics.mjs';
import { prepareFirstLinePublicActionFromCandidate } from '../../src/copilot/first-line-action-preparation.mjs';
import { executeFirstLinePublicSendOnce } from '../../src/copilot/first-line-public-send-coordinator.mjs';
import {
  FIRST_LINE_EXTRACTION_SCHEMA, FIRST_LINE_INTENT_SCHEMA_VERSION,
} from '../../src/copilot/first-line-extraction.mjs';

const [dbFile, mode, portString] = process.argv.slice(2);
if (!['KILL_AFTER_SENDING', 'KILL_AFTER_POST'].includes(mode)) process.exit(99);
const NOW = 2_000_000_000_000;
const store = FirstLineStateStore.create(dbFile, { now: () => NOW });
const customer = {
  sourceMessageId: 101, eventKind: 'CUSTOMER_MESSAGE', messageType: 'incoming',
  senderClass: 'contact', senderId: 9001, contentType: 'text', deleted: false,
  unsupported: false, hasAttachments: false, sourceId: null,
};
const stream = store.ensureConversationStream({
  sourceProvider: 'chatwoot', sourceConversationId: 55,
});
store.ingestConversationEvent(stream.stream_id, customer);
store.beginEpisode({ streamId: stream.stream_id });
const authorityReader = {
  async readExactSourceMessage() {
    return { code: 'SUPPORTED_CUSTOMER_TEXT',
      sourceConversationId: 55, sourceMessageId: 101, event: customer,
      transientContent: 'Какие способы оплаты есть?' };
  },
  async readAuthorizingConversationSnapshot() {
    return { code: 'COMPLETE', complete: true, events: [customer] };
  },
  async readCurrentConversationAuthority(conversationId) {
    return { code: 'SEND_ELIGIBLE', sourceConversationId: conversationId,
      inboxId: 99, status: 'pending', ownerClass: 'SAME_AGENTBOT' };
  },
  async readCorrelatedPublicReplyEvidence() { return { code: 'NO_CORRELATED_REPLY' }; },
};
const catalogService = {};
const knowledgeStore = { authoritySnapshot: () => [{
  revision_id: 'policy-1', record_type: 'COMMERCE_POLICY', schema_version: 1,
  namespace: 'commerce.payment_methods', effect_family: 'commerce.payment_methods',
  subject_type: 'business', subject_id: 'babypark', scope: {},
  effect_type: 'PAYMENT_METHODS',
  effect_value: { methods: ['BANK_TRANSFER', 'COD_NOVA_POSHTA'] },
  exception_of_revision_id: null, state: 'PUBLISHED',
  effective_from_utc: '2026-01-01T00:00:00.000Z', expires_at_utc: null,
}] };
const candidate = await buildFirstLineTransientCandidate({
  store, streamId: stream.stream_id, reader: authorityReader,
  produceExtraction: async () => ({
    schema: FIRST_LINE_EXTRACTION_SCHEMA,
    intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
    intent_hint: 'UNTRUSTED', language: 'ru', spans: [],
  }),
  catalogService, knowledgeStore, nowUtc: '2026-01-10T12:00:00.000Z',
});
if (candidate.code !== 'CANDIDATE') process.exit(98);
const { action } = prepareFirstLinePublicActionFromCandidate({
  store, streamId: stream.stream_id, candidate, deadlineAt: NOW + 60_000,
});
store.claimNextPublicAction({ leaseMs: 10_000, token: 'lease-1' });
await executeFirstLinePublicSendOnce({
  store, candidate, actionId: action.action_id, leaseToken: 'lease-1',
  authorityReader, catalogService, knowledgeStore,
  nowUtc: '2026-01-10T12:00:00.000Z', configuredInboxId: 99,
  confirmationWaitMs: 0,
  transport: { async postOutgoingMessage(request) {
    if (store.getPublicAction(action.action_id).state !== 'SENDING') process.exit(97);
    if (mode === 'KILL_AFTER_SENDING') {
      // Real OS process termination AFTER SQLite commit, BEFORE any POST.
      process.kill(process.pid, 'SIGKILL');
    }
    const response = await fetch('http://127.0.0.1:' + portString + '/fake-chatwoot', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceId: request.sourceId }),
    });
    if (!response.ok) process.exit(96);
    // Real OS termination AFTER mock Chatwoot accepted POST, before
    // coordinator can inspect response or commit confirmation/UNCERTAIN.
    process.kill(process.pid, 'SIGKILL');
  } },
});
process.exit(95);
