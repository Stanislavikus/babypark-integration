import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHATWOOT_AUTHORITATIVE_BEFORE,
  CHATWOOT_AUTHORITATIVE_LIMIT,
  CHATWOOT_MESSAGE_ID_MAX,
  ChatwootAuthorityError,
  createFirstLineChatwootAuthorityReader,
} from '../../src/copilot/chatwoot-client.mjs';

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}

function reader(fetchImpl, configuredAgentBotId = 7) {
  return createFirstLineChatwootAuthorityReader({
    baseUrl: 'https://chat.example',
    accountId: 11,
    readToken: 'read-token',
    configuredAgentBotId,
    requestTimeoutMs: 50,
    fetchImpl,
  });
}

function expectCode(promiseFactory, code) {
  return assert.rejects(promiseFactory, error =>
    error instanceof ChatwootAuthorityError && error.code === code);
}

test('exact source read is unfiltered and returns only closed transient customer text DTO', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return response({ payload: [{
      id: 101,
      message_type: 0,
      private: false,
      sender: { id: 9001, type: 'Contact', email: 'secret@example.com', phone_number: '+380000000000' },
      content_type: 'text',
      content: 'Скільки коштує?',
      attachments: [],
      source_id: null,
      content_attributes: {},
      meta: { arbitrary: 'must disappear' },
    }] });
  };

  const result = await reader(fetchImpl).readExactSourceMessage(55, 101);
  assert.equal(result.code, 'SUPPORTED_CUSTOMER_TEXT');
  assert.equal(result.transientContent, 'Скільки коштує?');
  assert.deepEqual(result.event, {
    sourceMessageId: 101,
    eventKind: 'CUSTOMER_MESSAGE',
    messageType: 'incoming',
    senderClass: 'contact',
    senderId: 9001,
    contentType: 'text',
    deleted: false,
    unsupported: false,
    hasAttachments: false,
    sourceId: null,
  });
  assert.equal(JSON.stringify(result).includes('secret@example.com'), false);
  assert.equal(JSON.stringify(result).includes('+380000000000'), false);
  assert.equal(JSON.stringify(result).includes('arbitrary'), false);
  assert.match(calls[0].url, /messages\?after=101&before=102$/);
  assert.equal(calls[0].url.includes('filter_internal_messages'), false);
  assert.equal(calls[0].options.headers.api_access_token, 'read-token');
});

test('exact read distinguishes absent, internal, deleted and attachment input', async () => {
  const absent = await reader(async () => response({ payload: [] }))
    .readExactSourceMessage(55, 101);
  assert.deepEqual(absent, { code: 'ABSENT', sourceMessageId: 101 });

  const internal = await reader(async () => response({ payload: [{
    id: 101, message_type: 2, private: false, sender: { id: 7, type: 'AgentBot' },
  }] })).readExactSourceMessage(55, 101);
  assert.deepEqual(internal, { code: 'INTERNAL', sourceMessageId: 101 });

  const deleted = await reader(async () => response({ payload: [{
    id: 101, message_type: 0, private: false, sender: { id: 9001, type: 'Contact' },
    content_type: 'text', content: 'deleted placeholder', attachments: [],
    content_attributes: { deleted: true },
  }] })).readExactSourceMessage(55, 101);
  assert.equal(deleted.code, 'PROVEN_UNSUPPORTED_OR_TOPOLOGY');
  assert.equal(deleted.event.deleted, true);
  assert.equal(deleted.transientContent, null);

  const attachment = await reader(async () => response({ payload: [{
    id: 101, message_type: 0, private: false, sender: { id: 9001, type: 'Contact' },
    content_type: 'text', content: 'caption', attachments: [{ id: 3, data_url: 'secret' }],
  }] })).readExactSourceMessage(55, 101);
  assert.equal(attachment.code, 'PROVEN_UNSUPPORTED_OR_TOPOLOGY');
  assert.equal(attachment.event.hasAttachments, true);
  assert.equal(attachment.transientContent, null);
  assert.equal(JSON.stringify(attachment).includes('data_url'), false);
});

test('exact read remains exact at Chatwoot int4 maximum id', async () => {
  let called;
  const result = await reader(async url => {
    called = url;
    return response({ payload: [{
      id: CHATWOOT_MESSAGE_ID_MAX,
      message_type: 0,
      private: false,
      sender: { id: 9001, type: 'Contact' },
      content_type: 'text',
      content: 'max',
      attachments: [],
    }] });
  }).readExactSourceMessage(55, CHATWOOT_MESSAGE_ID_MAX);

  assert.equal(result.code, 'SUPPORTED_CUSTOMER_TEXT');
  assert.match(called, new RegExp(
    'after=' + CHATWOOT_MESSAGE_ID_MAX + '&before=' + CHATWOOT_AUTHORITATIVE_BEFORE + '$'
  ));
});

test('authorizing snapshot classifies full public topology default-deny without PII', async () => {
  let called;
  const rows = [
    { id: 1, message_type: 0, private: false, sender: { id: 100, type: 'Contact', email: 'hidden' },
      content_type: 'text', content: 'customer body' },
    { id: 2, message_type: 1, private: false, sender: { id: 7, type: 'AgentBot' },
      content_type: 'text', content: 'bot reply', source_id: 'action-1' },
    { id: 3, message_type: 1, private: false, sender: { id: 8, type: 'AgentBot' },
      content_type: 'text', content: 'other bot' },
    { id: 4, message_type: 1, private: false, sender: { id: 44, type: 'User' },
      content_type: 'text', content: 'human' },
    { id: 5, message_type: 3, private: false, sender: null,
      content_type: 'text', content: 'template' },
    { id: 6, message_type: 1, private: false, sender: null,
      content_type: 'text', content: 'automation' },
    { id: 7, message_type: 99, private: false, sender: { id: 99, type: 'Mystery' },
      content_type: 'weird', content: 'unknown' },
  ];
  const result = await reader(async url => {
    called = url;
    return response({ payload: rows });
  }).readAuthorizingConversationSnapshot(55);

  assert.equal(result.code, 'COMPLETE');
  assert.equal(result.complete, true);
  assert.equal(result.rowCount, 7);
  assert.deepEqual(result.events.map(e => e.eventKind), [
    'CUSTOMER_MESSAGE',
    'BABYPARK_PUBLIC_REPLY',
    'OTHER_BOT_PUBLIC_REPLY',
    'HUMAN_PUBLIC_REPLY',
    'SYSTEM_TEMPLATE',
    'AUTOMATION_PUBLIC',
    'UNKNOWN_PUBLIC',
  ]);
  assert.equal(result.events[1].sourceId, 'action-1');
  assert.equal(result.events[6].messageType, 'unknown');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('customer body'), false);
  assert.equal(serialized.includes('hidden'), false);
  assert.match(called, new RegExp(
    'messages\\?after=0&before=' + CHATWOOT_AUTHORITATIVE_BEFORE +
    '&filter_internal_messages=true$'
  ));
});

test('exactly 1000 authorizing rows are HISTORY_UNPROVABLE', async () => {
  const rows = Array.from({ length: CHATWOOT_AUTHORITATIVE_LIMIT }, (_, index) => ({
    id: index + 1,
    message_type: 0,
    private: false,
    sender: { id: 9001, type: 'Contact' },
    content_type: 'text',
  }));
  const result = await reader(async () => response({ payload: rows }))
    .readAuthorizingConversationSnapshot(55);
  assert.equal(result.code, 'HISTORY_UNPROVABLE');
  assert.equal(result.complete, false);
  assert.equal(result.rowCount, CHATWOOT_AUTHORITATIVE_LIMIT);
  assert.equal(result.events.length, CHATWOOT_AUTHORITATIVE_LIMIT);
});

test('authorizing snapshot rejects filtered internal rows and duplicate source ids', async () => {
  await expectCode(() => reader(async () => response({ payload: [{
    id: 1, message_type: 2, private: false, sender: { id: 7, type: 'AgentBot' },
  }] })).readAuthorizingConversationSnapshot(55), 'CHATWOOT_AUTHORITY_FILTER_BROKEN');

  await expectCode(() => reader(async () => response({ payload: [
    { id: 1, message_type: 0, private: false, sender: { id: 1, type: 'Contact' } },
    { id: 1, message_type: 0, private: false, sender: { id: 1, type: 'Contact' } },
  ] })).readAuthorizingConversationSnapshot(55), 'CHATWOOT_AUTHORITY_DUPLICATE_SOURCE');
});

test('authority inputs are strict and privileged transport remains bounded', async () => {
  assert.throws(() => createFirstLineChatwootAuthorityReader({
    baseUrl: 'http://chat.example',
    accountId: 11,
    readToken: 'read-token',
    configuredAgentBotId: 7,
  }), /https_required/);

  assert.throws(() => createFirstLineChatwootAuthorityReader({
    baseUrl: 'https://chat.example',
    accountId: '11',
    readToken: 'read-token',
    configuredAgentBotId: 7,
  }), error => error instanceof ChatwootAuthorityError &&
    error.code === 'CHATWOOT_AUTHORITY_VALUE_INVALID');

  await expectCode(() => reader(async () => response({ payload: [] }))
    .readExactSourceMessage(55, CHATWOOT_MESSAGE_ID_MAX + 1),
  'CHATWOOT_AUTHORITY_VALUE_INVALID');

  const redirectReader = reader(async () =>
    new Response(null, { status: 302, headers: { location: 'https://evil.example' } }));
  await assert.rejects(() => redirectReader.readAuthorizingConversationSnapshot(55),
    /chatwoot_redirect_forbidden/);

  const hanging = reader(async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  await assert.rejects(() => hanging.readAuthorizingConversationSnapshot(55),
    /chatwoot_request_timeout/);
});
