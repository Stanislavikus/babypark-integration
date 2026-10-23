import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFirstLineCurrentConversation } from '../../src/copilot/first-line-current-conversation.mjs';
import { createFirstLineChatwootAuthorityReader } from '../../src/copilot/chatwoot-client.mjs';

const target = Object.freeze({ accountId: 11, conversationId: 55, inboxId: 99, agentBotId: 7 });
const wire = () => ({
  id: 55, account_id: 11, inbox_id: 99, status: 'pending',
  meta: { assignee_type: 'AgentBot', assignee: { id: 7 } },
});

test('§43 only exact Website pending/SAME_AGENTBOT tuple permits S2 send', () => {
  const r = decodeFirstLineCurrentConversation(wire(), target);
  assert.deepEqual(r, {
    code: 'SEND_ELIGIBLE', sourceConversationId: 55, inboxId: 99,
    status: 'pending', ownerClass: 'SAME_AGENTBOT',
  });
  assert.equal(Object.isFrozen(r), true);
});

test('§43 fail-closed corruption, owner ambiguity, mismatched inbox and status matrix', () => {
  const cases = [
    ['wrong account', { account_id: 12 }, 'UNKNOWN'],
    ['missing account', { account_id: undefined }, 'UNKNOWN'],
    ['wrong conversation', { id: 56 }, 'UNKNOWN'],
    ['wrong inbox', { inbox_id: 98 }, 'SAME_AGENTBOT'],
    ['missing inbox', { inbox_id: null }, 'UNKNOWN'],
    ['string inbox', { inbox_id: '99' }, 'UNKNOWN'],
    ['different bot', { meta: { assignee_type: 'AgentBot', assignee: { id: 8 } } }, 'OTHER_AGENTBOT'],
    ['user owner', { meta: { assignee_type: 'User', assignee: { id: 23 } } }, 'HUMAN_USER'],
    ['enterprise Captain', { meta: { assignee_type: 'Captain::Assistant', assignee: { id: 54 } } }, 'OTHER_AUTOMATION'],
    ['unassigned', { meta: {} }, 'UNASSIGNED'],
    ['owner id missing', { meta: { assignee_type: 'AgentBot', assignee: {} } }, 'UNKNOWN'],
    ['contradictory owner class', { meta: { assignee_type: 'AgentBot', assignee: { id: 7, type: 'User' } } }, 'UNKNOWN'],
    ['malformed optional owner class', { meta: { assignee_type: 'AgentBot', assignee: { id: 7, type: null } } }, 'UNKNOWN'],
    ['owner id zero', { meta: { assignee_type: 'AgentBot', assignee: { id: 0 } } }, 'UNKNOWN'],
    ['owner id string', { meta: { assignee_type: 'AgentBot', assignee: { id: '7' } } }, 'UNKNOWN'],
    ['owner without class', { meta: { assignee: { id: 7 } } }, 'UNKNOWN'],
    ['class without owner', { meta: { assignee_type: 'AgentBot' } }, 'UNKNOWN'],
    ['explicit null pair', { meta: { assignee: null, assignee_type: null } }, 'UNKNOWN'],
    ['arbitrary owner class', { meta: { assignee_type: 'OtherAgent', assignee: { id: 7 } } }, 'UNKNOWN'],
    ['array meta', { meta: [] }, 'UNKNOWN'],
    ['missing meta', { meta: null }, 'UNKNOWN'],
    ['open same bot', { status: 'open' }, 'SAME_AGENTBOT'],
    ['resolved same bot', { status: 'resolved' }, 'SAME_AGENTBOT'],
    ['snoozed same bot', { status: 'snoozed' }, 'SAME_AGENTBOT'],
    ['unknown status', { status: 'typing' }, 'SAME_AGENTBOT'],
    ['null status', { status: null }, 'SAME_AGENTBOT'],
  ];
  for (const [name, edits, owner] of cases) {
    const result = decodeFirstLineCurrentConversation({ ...wire(), ...edits }, target);
    assert.equal(result.code, 'SEND_DENIED', name);
    assert.equal(result.ownerClass, owner, name);
  }
  for (const malformed of [null, [], 'pending', 42, { status: 'pending' }]) {
    assert.equal(decodeFirstLineCurrentConversation(malformed, target).code, 'SEND_DENIED');
  }
});

test('§43 caller target configuration must be exact safe positive IDs', () => {
  for (const value of [0, -1, '7', 1.1, NaN, Infinity, null, Number.MAX_SAFE_INTEGER + 1]) {
    for (const field of Object.keys(target)) {
      assert.throws(() => decodeFirstLineCurrentConversation(wire(), {
        ...target, [field]: value,
      }), { name: 'TypeError' });
    }
  }
});

test('v4 strict API reader fetches live account-conversation route, not webhook owner', async () => {
  const requests = [];
  const reader = createFirstLineChatwootAuthorityReader({
    baseUrl: 'https://chatwoot.synthetic.invalid', accountId: 11,
    configuredAgentBotId: 7, readToken: 'test-readonly',
    fetchImpl: async (url, config) => {
      requests.push([url, config.method]);
      assert.equal(config.headers.api_access_token, 'test-readonly');
      return Response.json(wire());
    },
  });
  assert.deepEqual(await reader.readCurrentConversationAuthority(55, 99),
    decodeFirstLineCurrentConversation(wire(), target));
  assert.deepEqual(requests, [
    ['https://chatwoot.synthetic.invalid/api/v1/accounts/11/conversations/55', 'GET'],
  ]);
});

test('strict current account-conversation reader denies synthetic redirect or timeout', async () => {
  const cases = [
    async () => new Response(null, { status: 302, headers: { location: '/other' } }),
    async () => new Response('not found', { status: 404 }),
  ];
  for (const fetchImpl of cases) {
    const reader = createFirstLineChatwootAuthorityReader({
      baseUrl: 'https://chatwoot.synthetic.invalid', accountId: 11,
      configuredAgentBotId: 7, readToken: 'test-readonly', fetchImpl,
    });
    await assert.rejects(reader.readCurrentConversationAuthority(55, 99));
  }
});

test('§43 optional consistent owner.type supports v4-style agentbot and user', () => {
  assert.equal(decodeFirstLineCurrentConversation({
    ...wire(), meta: { assignee_type: 'AgentBot', assignee: { id: 7, type: 'agent_bot' } },
  }, target).code, 'SEND_ELIGIBLE');
  assert.equal(decodeFirstLineCurrentConversation({
    ...wire(), meta: { assignee_type: 'User', assignee: { id: 22, type: 'user' } },
  }, target).ownerClass, 'HUMAN_USER');
});
