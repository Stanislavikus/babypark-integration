import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { GatewayDb } from '../../src/gateway/db.mjs';
import {
  buildSessionRecoveryPlan,
  applySessionRecoveryPlan,
} from '../../src/gateway/session-rebuild.mjs';
import { createGatewayApp } from '../../src/gateway/app.mjs';

function tempDb() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bp-session-rebuild-'));
  const db = new GatewayDb(path.join(dir, 'bridge.sqlite'));
  return {
    db,
    close() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('rebuild plan paginates contacts and never guesses ambiguous conversation', async () => {
  const searchPages = [];
  const conversations = new Map([
    [1, {
      payload: [
        { id: 101, inbox_id: 5, status: 'open' },
        { id: 99, inbox_id: 5, status: 'resolved' },
      ],
    }],
    [2, { payload: [{ id: 201, inbox_id: 5, status: 'resolved' }] }],
    [3, {
      payload: [
        { id: 302, inbox_id: 5, status: 'pending' },
        { id: 301, inbox_id: 5, status: 'open' },
      ],
    }],
  ]);

  const chatwoot = {
    async searchContacts(query, page) {
      searchPages.push([query, page]);
      if (page === 1) {
        return {
          meta: { has_more: true },
          payload: [
            {
              id: 1,
              identifier: 'viber:u1',
              contact_inboxes: [{ source_id: 's1', inbox: { id: 5 } }],
            },
            {
              id: 2,
              identifier: 'viber:u2',
              contact_inboxes: [{ source_id: 's2', inbox: { id: 5 } }],
            },
            {
              id: 3,
              identifier: 'viber:u3',
              contact_inboxes: [{ source_id: 's3', inbox: { id: 5 } }],
            },
            {
              id: 99,
              identifier: 'email:not-viber',
              contact_inboxes: [],
            },
          ],
        };
      }
      return {
        meta: { has_more: false },
        payload: [
          {
            id: 4,
            identifier: 'viber:u4',
            contact_inboxes: [],
          },
          {
            id: 5,
            identifier: 'viber:u5',
            contact_inboxes: [
              { source_id: 'a', inbox: { id: 5 } },
              { source_id: 'b', inbox: { id: 5 } },
            ],
          },
        ],
      };
    },
    async listContactConversations(contactId) {
      return conversations.get(contactId) || { payload: [] };
    },
  };

  const plan = await buildSessionRecoveryPlan({
    cfg: { chatwootInboxId: 5 },
    chatwoot,
  });

  assert.deepEqual(searchPages, [['viber:', 1], ['viber:', 2]]);
  assert.equal(plan.counts.actions, 3);
  assert.equal(plan.counts.warnings, 2);
  assert.equal(plan.counts.reuse_active_conversation, 1);
  assert.equal(plan.counts.create_on_next_message, 1);
  assert.equal(plan.counts.create_new_due_to_ambiguity, 1);

  const byUser = Object.fromEntries(
    plan.actions.map(item => [item.viber_user_id, item])
  );
  assert.equal(byUser.u1.conversation_id, 101);
  assert.equal(byUser.u1.issue_type, null);
  assert.equal(byUser.u2.conversation_id, 0);
  assert.equal(byUser.u2.issue_type, 'no_active_conversation');
  assert.equal(byUser.u3.conversation_id, 0);
  assert.equal(byUser.u3.issue_type, 'ambiguous_active_conversations');
  assert.deepEqual(byUser.u3.details.conversation_ids, [301, 302]);

  assert.deepEqual(
    plan.warnings.map(item => item.code).sort(),
    ['viber_contact_inbox_ambiguous', 'viber_contact_inbox_missing']
  );
});

test('apply rebuild writes recoverable sessions and issue metadata', async t => {
  const store = tempDb();
  t.after(() => store.close());

  const plan = {
    actions: [
      {
        viber_user_id: 'u1',
        contact_id: 1,
        source_id: 's1',
        conversation_id: 101,
        issue_type: null,
        details: {},
      },
      {
        viber_user_id: 'u2',
        contact_id: 2,
        source_id: 's2',
        conversation_id: 0,
        issue_type: 'no_active_conversation',
        details: {},
      },
      {
        viber_user_id: 'u3',
        contact_id: 3,
        source_id: 's3',
        conversation_id: 0,
        issue_type: 'ambiguous_active_conversations',
        details: { conversation_ids: [301, 302] },
      },
    ],
    warnings: [],
  };

  const result = applySessionRecoveryPlan({
    db: store.db,
    plan,
    now: '2026-09-23T20:00:00.000Z',
  });
  assert.deepEqual(result, { applied: 3, warnings: 0 });

  assert.equal(store.db.getSessionByUser('u1').conversation_id, 101);
  assert.equal(store.db.getSessionByUser('u2').conversation_id, 0);
  assert.equal(store.db.getSessionByUser('u3').conversation_id, 0);
  assert.equal(
    store.db.getRecoveryIssue('u2').issue_type,
    'no_active_conversation'
  );
  assert.deepEqual(
    JSON.parse(store.db.getRecoveryIssue('u3').details_json),
    { conversation_ids: [301, 302] }
  );
});

function signViber(raw, secret) {
  return crypto.createHmac('sha256', secret).update(raw).digest('hex');
}

async function startRecoveryGateway({
  noteFails = false,
} = {}) {
  const store = tempDb();
  const calls = {
    conversations: [],
    notes: [],
    incoming: [],
  };

  store.db.upsertSession(
    'recover-user',
    77,
    'source-77',
    0,
    new Date().toISOString()
  );
  store.db.upsertRecoveryIssue(
    'recover-user',
    'ambiguous_active_conversations',
    { conversation_ids: [10, 11] },
    new Date().toISOString()
  );

  const cfg = {
    host: '127.0.0.1',
    port: 0,
    viberToken: 'recover-secret',
    chatwootAccountId: 1,
    chatwootInboxId: 5,
    chatwootApiToken: 'x',
    chatwootWebhookSecret: 'x',
  };

  const chatwoot = {
    async getConversation() {
      throw new Error('conversation_id_zero_must_not_be_looked_up');
    },
    async createConversation(contactId, sourceId) {
      calls.conversations.push({ contactId, sourceId });
      return 777;
    },
    async createPrivateNote(conversationId, content) {
      calls.notes.push({ conversationId, content });
      if (noteFails) throw new Error('note_failed');
      return { id: 1 };
    },
    async createIncomingMessage(conversationId, content) {
      calls.incoming.push({ conversationId, content });
      return { id: 2 };
    },
  };

  const viber = {
    async sendText() {
      throw new Error('not_used');
    },
  };

  const logs = [];
  const { server } = createGatewayApp({
    cfg,
    db: store.db,
    chatwoot,
    viber,
    log(level, message, meta) {
      logs.push({ level, message, meta });
    },
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;

  return {
    store,
    calls,
    logs,
    base: `http://127.0.0.1:${port}`,
    async stop() {
      await new Promise(resolve => server.close(resolve));
      store.close();
    },
  };
}

async function sendRecoveryViber(base) {
  const event = {
    event: 'message',
    message_token: 'recover-token',
    sender: { id: 'recover-user', name: 'Recovered' },
    message: { type: 'text', text: 'hello after recovery' },
  };
  const raw = Buffer.from(JSON.stringify(event));
  return fetch(base + '/api/viber/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-viber-content-signature': signViber(raw, 'recover-secret'),
    },
    body: raw,
  });
}

test('conversation_id=0 creates new conversation and resolves ambiguity with private note', async t => {
  const h = await startRecoveryGateway();
  t.after(() => h.stop());

  const response = await sendRecoveryViber(h.base);
  assert.equal(response.status, 200);
  assert.deepEqual(h.calls.conversations, [
    { contactId: 77, sourceId: 'source-77' },
  ]);
  assert.equal(h.calls.notes.length, 1);
  assert.equal(h.calls.notes[0].conversationId, 777);
  assert.match(h.calls.notes[0].content, /неоднозначною/);
  assert.deepEqual(h.calls.incoming, [
    { conversationId: 777, content: 'hello after recovery' },
  ]);
  assert.equal(
    h.store.db.getSessionByUser('recover-user').conversation_id,
    777
  );
  assert.ok(h.store.db.getRecoveryIssue('recover-user').resolved_at);
});

test('private recovery note failure never drops the customer message', async t => {
  const h = await startRecoveryGateway({ noteFails: true });
  t.after(() => h.stop());

  const response = await sendRecoveryViber(h.base);
  assert.equal(response.status, 200);
  assert.equal(h.calls.incoming.length, 1);
  assert.equal(h.calls.incoming[0].conversationId, 777);
  assert.equal(
    h.store.db.getRecoveryIssue('recover-user').resolved_at,
    null
  );
  assert.ok(
    h.logs.some(item => item.message === 'viber_session_recovery_note_failed')
  );
});

