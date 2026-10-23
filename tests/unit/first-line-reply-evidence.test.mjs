import assert from 'node:assert/strict';
import test from 'node:test';
import { createFirstLineChatwootAuthorityReader } from '../../src/copilot/chatwoot-client.mjs';

const BODY = 'Способы оплаты: банковский перевод.';
const ACTION = 'act_opaque-7';
const INBOX = 99;
const CONVERSATION = 55;

function reply(overrides = {}) {
  return {
    id: 202, conversation_id: CONVERSATION, inbox_id: INBOX,
    message_type: 1, private: false, content_type: 'text',
    sender: { id: 7, type: 'agent_bot', email: 'secret@invalid.test' },
    source_id: ACTION, content: BODY, content_attributes: {},
    attachments: [],
    ...overrides,
  };
}

function makeReader({ rows = [reply()], exact = reply(), onRead = null } = {}) {
  const calls = [];
  const reader = createFirstLineChatwootAuthorityReader({
    baseUrl: 'https://chatwoot.synthetic.invalid',
    accountId: 11, configuredAgentBotId: 7, readToken: 'synthetic',
    fetchImpl: async (url, req) => {
      calls.push({ url, method: req.method });
      if (onRead) return onRead(url, req);
      if (url.includes('after=0&before=2147483648&filter_internal_messages=true')) {
        return Response.json({ payload: rows });
      }
      if (url.includes('after=202&before=203')) {
        return Response.json({ payload: exact === null ? [] : [exact] });
      }
      throw new Error('unexpected synthetic URL ' + url);
    },
  });
  const check = (changes = {}) => reader.readCorrelatedPublicReplyEvidence({
    conversationId: CONVERSATION, inboxId: INBOX,
    actionId: ACTION, expectedContent: BODY,
    ...changes,
  });
  return { reader, calls, check };
}

test('Chatwoot v4.18 source_id proof requires one unique source, exact id/inbox/bot and bytes', async () => {
  const { calls, check } = makeReader();
  const result = await check();
  assert.deepEqual(result, {
    code: 'CORRELATED_REPLY_PROVEN', nonAuthorizing: true,
    sourceMessageId: 202, sourceConversationId: 55,
    inboxId: 99, actionId: ACTION,
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(x => x.method === 'GET'));
  assert.equal(JSON.stringify(result).includes(BODY), false);
  assert.equal(JSON.stringify(result).includes('secret@invalid.test'), false);
});

test('no source_id match gives no proof and never means unsent or retryable', async () => {
  const { calls, check } = makeReader({ rows: [reply({ source_id: 'different-action' })] });
  assert.deepEqual(await check(), { code: 'NO_CORRELATED_REPLY' });
  assert.equal(calls.length, 1);
});

test('two distinct Chatwoot message IDs with same source_id are always ambiguous', async () => {
  const { calls, check } = makeReader({
    rows: [reply(), reply({ id: 203, content: 'a different public reply' })],
  });
  assert.deepEqual(await check(), { code: 'CORRELATED_REPLY_AMBIGUOUS' });
  assert.equal(calls.length, 1);
});

test('source_id collision with human, different bot, activity or deleted rows cannot prove AI send', async () => {
  const changes = [
    { sender: { id: 7, type: 'User' } },
    { sender: { id: 8, type: 'agent_bot' } },
    { content_attributes: { deleted: true } },
    { attachments: [{ id: 8 }] },
    { content_type: 'input_select' },
    { source_id: ACTION, message_type: 0, sender: { id: 9001, type: 'Contact' } },
  ];
  for (const entry of changes) {
    const { check } = makeReader({ rows: [reply(entry)] });
    assert.deepEqual(await check(), { code: 'CORRELATED_REPLY_TOPOLOGY_MISMATCH' },
      'entry ' + JSON.stringify(entry));
  }
  // The full-history endpoint is asked to filter internal rows; if it
  // violates this provider contract, the strict reader throws fail-closed.
  const activity = makeReader({ rows: [reply({ message_type: 2 })] });
  await assert.rejects(activity.check(),
    error => error.code === 'CHATWOOT_AUTHORITY_FILTER_BROKEN');
});

test('post-snapshot message mutation, edited/deleted/private or foreign inbox cannot confirm', async () => {
  const changed = [
    { content: 'same source, different customer-facing content' },
    { inbox_id: 98 },
    { conversation_id: 56 },
    { source_id: 'different-action' },
    { private: true },
    { sender: { id: 9, type: 'agent_bot' } },
    { content_attributes: { deleted: true } },
    { id: 203 },
  ];
  for (const patch of changed) {
    const { check } = makeReader({ exact: reply(patch) });
    const result = await check();
    assert.equal(result.code, 'CORRELATED_REPLY_CHANGED',
      'changed patch ' + JSON.stringify(patch));
  }
  const missing = makeReader({ exact: null });
  assert.deepEqual(await missing.check(), { code: 'CORRELATED_REPLY_CHANGED' });
});

test('exact reply must include inbox_id, conversation_id and source_id, not infer absent values', async () => {
  for (const key of ['inbox_id', 'conversation_id', 'source_id', 'content']) {
    const mutated = reply();
    delete mutated[key];
    const { check } = makeReader({ exact: mutated });
    assert.equal((await check()).code, 'CORRELATED_REPLY_CHANGED', key);
  }
});

test('saturated history cannot provide proof even if a matching source_id is visible', async () => {
  const rows = [reply()];
  for (let id = 1; id < 1000; id++) rows.push(reply({
    id: id + 300, sender: { id: 9001, type: 'Contact' },
    message_type: 0, source_id: null,
  }));
  const { check, calls } = makeReader({ rows });
  assert.deepEqual(await check(), { code: 'HISTORY_UNPROVABLE' });
  assert.equal(calls.length, 1);
});

test('unreadable, redirected, failed or malformed Chatwoot reads never generate positive evidence', async () => {
  for (const response of [
    new Response('failure', { status: 500 }),
    new Response(null, { status: 302, headers: { location: '/other' } }),
    Response.json({ payload: { wrong: true } }),
  ]) {
    const { check } = makeReader({ onRead: async () => response.clone() });
    await assert.rejects(check());
  }
});

test('invalid action id, input type and unexpected raw content fail closed before network', async () => {
  const { check, calls } = makeReader();
  for (const changes of [
    { actionId: 'secret@email.example' },
    { actionId: '' }, { actionId: 'x'.repeat(161) },
    { expectedContent: '' },
    { expectedContent: null },
    { conversationId: '55' }, { inboxId: '99' },
  ]) await assert.rejects(check(changes));
  assert.equal(calls.length, 0);
});
