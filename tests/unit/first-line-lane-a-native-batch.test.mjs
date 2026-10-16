import "../helpers/legacy-sending-fixture.mjs";
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';
import { createFirstLineChatwootAuthorityReader } from '../../src/copilot/chatwoot-client.mjs';
import { createFirstLineAgentBotRelay } from '../../src/copilot/first-line-runtime-ingress.mjs';
import { projectOpenTurn } from '../../src/copilot/first-line-routing-planner.mjs';
import { prepareTestPublicAction, testActionDescriptor } from '../helpers/first-line-action-descriptor.mjs';

const NOW = 2_000_000_000_000, SECRET = 'synthetic-lane-a';
const TARGET = { accountId: 11, inboxId: 99, agentBotId: 7 };
const SENTINEL = 'SYNTHETIC-SECRET-DO-NOT-PERSIST';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-lane-a-batch-'));
  const file = path.join(root, 'episode.sqlite');
  FirstLineStateStore.create(file, { now: () => NOW }).close();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return file;
}
function row(id, overrides = {}) {
  return {
    id, message_type: 'incoming', private: false,
    sender: { id: 9001, type: 'Contact' }, content_type: 'text',
    content: SENTINEL, content_attributes: {}, attachments: [], source_id: null,
    ...overrides,
  };
}
function envelope(id, overrides = {}) {
  return {
    event: 'message_created', id, message_type: 'incoming', private: false,
    sender: { id: 9001 }, account: { id: 11 }, inbox: { id: 99 },
    conversation: { id: 55, inbox_id: 99 }, content: SENTINEL,
    ...overrides,
  };
}
function signed(body, delivery = 'synthetic') {
  const raw = Buffer.from(JSON.stringify(body));
  const timestamp = String(NOW / 1000);
  return {
    raw, headers: {
      'x-chatwoot-timestamp': timestamp,
      'x-chatwoot-delivery': delivery,
      'x-chatwoot-signature': 'sha256=' + crypto.createHmac('sha256', SECRET)
        .update(timestamp + '.').update(raw).digest('hex'),
    },
  };
}
function makeRelay(file, rows, reads) {
  const authorityReader = createFirstLineChatwootAuthorityReader({
    baseUrl: 'https://synthetic-chatwoot.invalid',
    accountId: 11, configuredAgentBotId: 7, readToken: 'fake-only',
    fetchImpl: async url => {
      const u = new URL(url), id = Number(u.searchParams.get('after'));
      reads.push(id);
      const value = rows.get(id);
      return Response.json({ payload: value === undefined ? [] : [value] });
    },
  });
  return createFirstLineAgentBotRelay({
    dbPath: file, authorityReader, webhookSecret: SECRET,
    ...TARGET, nowMs: () => NOW,
  });
}
function audit(file, check) {
  const store = FirstLineStateStore.open(file);
  try {
    const stream = store.findConversationStream({
      sourceProvider: 'chatwoot', sourceConversationId: 55,
    });
    return check(store, stream);
  } finally { store.close(); }
}

test('BLK-1 native agent_bot sender records one echo without new customer turn', async t => {
  const file = fixture(t), rows = new Map(), reads = [];
  rows.set(101, row(101));
  rows.set(102, row(102, {
    message_type: 'outgoing', sender: { type: 'agent_bot', id: 7 },
    content: 'SYNTHETIC-OUTGOING', source_id: 'synthetic-action',
  }));
  const relay = makeRelay(file, rows, reads);
  t.after(() => relay.close());
  assert.equal((await relay.receive(signed(envelope(101)))).status, 200);
  const bot = envelope(102, {
    message_type: 'outgoing', sender: { type: 'agent_bot', id: 7 },
  });
  assert.deepEqual(await relay.receive(signed(bot, 'first')),
    { status: 200, outcome: 'topology_recorded' });
  assert.deepEqual(await relay.receive(signed(bot, 'redelivery')),
    { status: 200, outcome: 'duplicate_source' });
  assert.equal(reads.length, 3);
  audit(file, (store, stream) => {
    assert.deepEqual(store.listConversationEvents(stream.stream_id).map(x => x.event_kind),
      ['CUSTOMER_MESSAGE','BABYPARK_PUBLIC_REPLY']);
  });
});

test('BLK-2 updated structured template is persisted with same-tx absorbing HUMAN', async t => {
  const file = fixture(t), rows = new Map(), reads = [];
  rows.set(401, row(401, {
    message_type: 'template', sender: null, content_type: 'input_email',
    content_attributes: { submitted_values: ['secret@example.invalid'] },
  }));
  const relay = makeRelay(file, rows, reads);
  t.after(() => relay.close());
  const update = envelope(401, {
    event: 'message_updated', message_type: 'template', sender: null,
  });
  assert.deepEqual(await relay.receive(signed(update)),
    { status: 200, outcome: 'topology_recorded' });
  assert.deepEqual(await relay.receive(signed(update, 'repeat')),
    { status: 200, outcome: 'duplicate_source' });
  audit(file, (store, stream) => {
    assert.equal(stream.stream_revision, 1);
    assert.deepEqual(store.listConversationEvents(stream.stream_id).map(x => x.event_kind),
      ['SYSTEM_TEMPLATE']);
    const owner = store.getUnresolvedContinuationOwner(stream.stream_id);
    assert.equal(owner.owner_kind, 'HUMAN');
    assert.equal(owner.human_reason, 'NATIVE_STRUCTURED_UPDATE');
  });
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.includes(Buffer.from('secret@example.invalid')), false);
});

test('BLK-3 incoming message_updated never silently ACKs as content-safe duplicate', async t => {
  const file = fixture(t), rows = new Map(), reads = [];
  rows.set(101, row(101));
  const relay = makeRelay(file, rows, reads);
  t.after(() => relay.close());
  assert.equal((await relay.receive(signed(envelope(101)))).status, 200);
  assert.deepEqual(await relay.receive(signed(envelope(101, { event: 'message_updated' }))),
    { status: 200, outcome: 'duplicate_source' });
  audit(file, (store, stream) => {
    assert.equal(stream.stream_revision, 1);
    const owner = store.getUnresolvedContinuationOwner(stream.stream_id);
    assert.equal(owner.owner_kind, 'HUMAN');
    assert.equal(owner.human_reason, 'NATIVE_CUSTOMER_UPDATE');
  });
});

test('BLK-4 private note is exact-read INTERNAL, public human reply absorbs continuation', async t => {
  const file = fixture(t), rows = new Map(), reads = [];
  rows.set(111, row(111, {
    private: true, message_type: 'outgoing', sender: { type: 'User', id: 23 },
    content: 'SYNTHETIC PRIVATE NOTE',
  }));
  rows.set(112, row(112, {
    message_type: 'outgoing', sender: { type: 'User', id: 23 },
  }));
  const relay = makeRelay(file, rows, reads);
  t.after(() => relay.close());
  assert.deepEqual(await relay.receive(signed(envelope(111, {
    private: true, message_type: 'outgoing', sender: { type: 'User', id: 23 },
  }))), { status: 200, outcome: 'internal_ignored' });
  audit(file, (_store, stream) => assert.equal(stream, null));
  assert.deepEqual(await relay.receive(signed(envelope(112, {
    message_type: 'outgoing', sender: { type: 'User', id: 23 },
  }))), { status: 200, outcome: 'topology_recorded' });
  audit(file, (store, stream) => {
    assert.deepEqual(store.listConversationEvents(stream.stream_id).map(x => x.event_kind),
      ['HUMAN_PUBLIC_REPLY']);
    assert.equal(store.getUnresolvedContinuationOwner(stream.stream_id).owner_kind, 'HUMAN');
  });
  assert.equal(fs.readFileSync(file).includes(Buffer.from('SYNTHETIC PRIVATE NOTE')), false);
});

test('BLK-5 aborted HUMAN write rolls back source, stream, revision and event atomically', t => {
  const file = fixture(t), store = FirstLineStateStore.open(file);
  t.after(() => store.close());
  store.db.exec("CREATE TEMP TRIGGER lane_a_abort_human BEFORE INSERT ON continuation_owners " +
    "BEGIN SELECT RAISE(ABORT,'synthetic-human-abort'); END");
  assert.throws(() => store.ingestVerifiedChatwootEvent({
    sourceConversationId: 55, event: {
      sourceMessageId: 1001, eventKind: 'CUSTOMER_MESSAGE',
      messageType: 'incoming', senderClass: 'contact', senderId: 9001,
      contentType: 'text', deleted: false, unsupported: false, hasAttachments: false,
      sourceId: null,
    }, humanReason: 'UNSUPPORTED_CUSTOMER_EVENT',
  }), /synthetic-human-abort/);
  assert.equal(store.findConversationStream({ sourceProvider: 'chatwoot', sourceConversationId: 55 }), null);
  const rows = store.db.prepare('SELECT COUNT(*) AS n FROM conversation_events').get();
  assert.equal(rows.n, 0);
});

test('BLK-6 confirmed late bot echo preserves deferred children in event_seq order', t => {
  const file = fixture(t), store = FirstLineStateStore.open(file);
  t.after(() => store.close());
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot', sourceConversationId: 55,
  });
  const customer = id => ({
    sourceMessageId: id, eventKind: 'CUSTOMER_MESSAGE', messageType: 'incoming',
    senderClass: 'contact', senderId: 9001, contentType: 'text',
    deleted: false, unsupported: false, hasAttachments: false,
  });
  store.ingestConversationEvent(stream.stream_id, customer(101));
  const action = prepareTestPublicAction(store, {
    descriptor: testActionDescriptor(), streamId: stream.stream_id,
    preparedStreamRevision: 1, actionType: 'ANSWER',
    basisEventSeqs: [1], deadlineAt: NOW + 60_000,
  });
  store.claimNextPublicAction({ leaseMs: 30_000, token: 'synthetic-lease' });
  store.markActionSending(action.action_id, 'synthetic-lease');
  const first = store.ingestVerifiedChatwootEvent({
    sourceConversationId: 55, event: customer(102),
  });
  const second = store.ingestVerifiedChatwootEvent({
    sourceConversationId: 55, event: customer(103),
  });
  assert.equal(first.deferred_parent.action_id, action.action_id);
  assert.equal(second.deferred_parent.action_id, action.action_id);
  store.ingestConversationEvent(stream.stream_id, {
    sourceMessageId: 104, eventKind: 'BABYPARK_PUBLIC_REPLY',
    messageType: 'outgoing', senderClass: 'configured_agent_bot',
    senderId: 7, contentType: 'text', sourceId: action.action_id,
  });
  assert.equal(store.confirmPublicActionFromLedger(action.action_id).state, 'CONFIRMED');
  const snap = store.readRoutingSnapshot(stream.stream_id);
  assert.deepEqual(snap.event_suffix.filter(x => x.deferred_parent)
    .map(x => x.deferred_parent.action_id), [action.action_id,action.action_id]);
  const projected = projectOpenTurn(snap);
  assert.equal(projected.code, 'OPEN_TURN');
  assert.deepEqual(projected.open_turn.source_message_ids, [102,103]);
  store.ingestConversationEvent(stream.stream_id, customer(105));
  const after = projectOpenTurn(store.readRoutingSnapshot(stream.stream_id));
  assert.equal(after.code, 'OPEN_TURN');
  assert.deepEqual(after.open_turn.source_message_ids, [102,103,105]);
});


test('BLK-5/SENDING atomic HUMAN escalation keeps deferred child and immutable cut', t => {
  const file = fixture(t), store = FirstLineStateStore.open(file);
  t.after(() => store.close());
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot', sourceConversationId: 55,
  });
  const customer = id => ({
    sourceMessageId: id, eventKind: 'CUSTOMER_MESSAGE', messageType: 'incoming',
    senderClass: 'contact', senderId: 9001, contentType: 'text',
    deleted: false, unsupported: false, hasAttachments: false,
  });
  store.ingestConversationEvent(stream.stream_id, customer(101));
  const action = prepareTestPublicAction(store, {
    descriptor: testActionDescriptor(), streamId: stream.stream_id,
    preparedStreamRevision: 1, actionType: 'ANSWER',
    basisEventSeqs: [1], deadlineAt: NOW + 60_000,
  });
  store.claimNextPublicAction({ leaseMs: 30_000, token: 'lane-a-lease' });
  store.markActionSending(action.action_id, 'lane-a-lease');
  const accepted = store.ingestVerifiedChatwootEvent({
    sourceConversationId: 55, event: customer(102),
    humanReason: 'NATIVE_CUSTOMER_UPDATE',
  });
  assert.equal(accepted.inserted, true);
  assert.equal(accepted.deferred_parent.action_id, action.action_id);
  const owner = store.getUnresolvedContinuationOwner(stream.stream_id);
  assert.equal(owner.owner_kind, 'HUMAN');
  assert.equal(owner.action_id, action.action_id);
  assert.equal(owner.human_reason, 'NATIVE_CUSTOMER_UPDATE');
  const humanCut = store.db.prepare(
    'SELECT human_through_event_seq FROM public_action_human_cuts WHERE action_id=?'
  ).get(action.action_id);
  assert.equal(humanCut.human_through_event_seq, 2);
  assert.equal(store.listConversationEvents(stream.stream_id).length, 2);
  assert.throws(() => store.readRoutingSnapshot(stream.stream_id));
});

test('BLK-5 crash on PUBLIC_ACTION HUMAN cut rolls back new deferred source and revision', t => {
  const file = fixture(t), store = FirstLineStateStore.open(file);
  t.after(() => store.close());
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot', sourceConversationId: 55,
  });
  const customer = id => ({
    sourceMessageId: id, eventKind: 'CUSTOMER_MESSAGE', messageType: 'incoming',
    senderClass: 'contact', senderId: 9001, contentType: 'text',
    deleted: false, unsupported: false, hasAttachments: false,
  });
  store.ingestConversationEvent(stream.stream_id, customer(101));
  const action = prepareTestPublicAction(store, {
    descriptor: testActionDescriptor(), streamId: stream.stream_id,
    preparedStreamRevision: 1, actionType: 'ANSWER',
    basisEventSeqs: [1], deadlineAt: NOW + 60_000,
  });
  store.claimNextPublicAction({ leaseMs: 30_000, token: 'lane-a-lease' });
  store.markActionSending(action.action_id, 'lane-a-lease');
  store.db.exec("CREATE TEMP TRIGGER lane_a_abort_human_cut BEFORE INSERT " +
    "ON public_action_human_cuts BEGIN SELECT RAISE(ABORT,'synthetic-cut-abort'); END");
  assert.throws(() => store.ingestVerifiedChatwootEvent({
    sourceConversationId: 55, event: customer(102),
    humanReason: 'NATIVE_CUSTOMER_UPDATE',
  }), /synthetic-cut-abort/);
  assert.equal(store.getConversationStream(stream.stream_id).stream_revision, 1);
  assert.equal(store.listConversationEvents(stream.stream_id).length, 1);
  assert.equal(store.getUnresolvedContinuationOwner(stream.stream_id).owner_kind, 'PUBLIC_ACTION');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM deferred_event_parents').get().n, 0);
});


test('BLK-4 another native agent_bot is durably HUMAN-owned, never autonomous', async t => {
  const file = fixture(t), rows = new Map(), reads = [];
  rows.set(701, row(701, {
    message_type: 'outgoing', sender: { type: 'agent_bot', id: 81 },
  }));
  const relay = makeRelay(file, rows, reads);
  t.after(() => relay.close());
  assert.deepEqual(await relay.receive(signed(envelope(701, {
    message_type: 'outgoing', sender: { type: 'agent_bot', id: 81 },
  }))), { status: 200, outcome: 'topology_recorded' });
  audit(file, (store, stream) => {
    assert.deepEqual(store.listConversationEvents(stream.stream_id).map(x => x.event_kind),
      ['OTHER_BOT_PUBLIC_REPLY']);
    const owner = store.getUnresolvedContinuationOwner(stream.stream_id);
    assert.equal(owner.owner_kind, 'HUMAN');
    assert.equal(owner.human_reason, 'OTHER_PUBLIC_OWNER');
  });
  assert.equal(reads.length, 1);
});

test('BLK-1 signed native sender identity cannot override authoritative sender', async t => {
  const file = fixture(t), rows = new Map(), reads = [];
  rows.set(701, row(701, {
    message_type: 'outgoing', sender: { type: 'agent_bot', id: 88 },
  }));
  const relay = makeRelay(file, rows, reads);
  t.after(() => relay.close());
  assert.deepEqual(await relay.receive(signed(envelope(701, {
    message_type: 'outgoing', sender: { type: 'agent_bot', id: 7 },
  }))), { status: 422, outcome: 'source_not_customer' });
  audit(file, (_store, stream) => assert.equal(stream, null));
});

test('F1 PREPARED/GATING incoming HUMAN uses same-tx supersede, preserves CLARIFY and restarts', t => {
  for (const state of ['PREPARED','GATING']) {
    for (const actionType of ['ANSWER','CLARIFY']) {
      const file = fixture(t);
      let store = FirstLineStateStore.open(file);
      const stream = store.ensureConversationStream({ sourceProvider: 'chatwoot', sourceConversationId: 55 });
      const customer = id => ({
        sourceMessageId: id, eventKind: 'CUSTOMER_MESSAGE', messageType: 'incoming',
        senderClass: 'contact', senderId: 9001, contentType: 'text',
        deleted: false, unsupported: false, hasAttachments: false,
      });
      store.ingestConversationEvent(stream.stream_id, customer(101));
      const episode = store.beginEpisode({ streamId: stream.stream_id });
      const action = prepareTestPublicAction(store, {
        descriptor: testActionDescriptor(), streamId: stream.stream_id,
        episodeId: episode.episode_id, expectedEpisodeVersion: episode.version,
        preparedStreamRevision: 1, actionType,
        basisEventSeqs: [1], deadlineAt: NOW + 60_000,
        ...(actionType === 'CLARIFY' ? {
          requestedSlot: 'store_id',
          presentedCandidates: [{slot:'store_id',value:'store_11111111-1111-4111-8111-111111111111'}],
        } : {}),
      });
      if (state === 'GATING') {
        assert.equal(store.claimNextPublicAction({leaseMs:30000,token:'f1-lease'}).action_id,action.action_id);
      }
      const budget = store.getEpisode(episode.episode_id);
      assert.equal(budget.clarification_prompts_sent,actionType === 'CLARIFY' ? 1 : 0);
      assert.equal(store.getPublicAction(action.action_id).state,state);
      const done = store.ingestVerifiedChatwootEvent({
        sourceConversationId:55,event:customer(102),humanReason:'NATIVE_CUSTOMER_UPDATE',
      });
      assert.equal(done.inserted,true);
      assert.equal(store.getPublicAction(action.action_id).state,'STALE');
      assert.equal(store.getUnresolvedContinuationOwner(stream.stream_id).owner_kind,'HUMAN');
      assert.equal(store.listConversationEvents(stream.stream_id).length,2);
      const after = store.getEpisode(episode.episode_id);
      assert.equal(after.clarification_prompts_sent,budget.clarification_prompts_sent);
      assert.equal(after.requested_slot,budget.requested_slot);
      store.close();
      store=FirstLineStateStore.open(file);
      assert.equal(store.getPublicAction(action.action_id).state,'STALE');
      assert.equal(store.getUnresolvedContinuationOwner(stream.stream_id).owner_kind,'HUMAN');
      assert.equal(store.getConversationStream(stream.stream_id).stream_revision,2);
      assert.equal(store.getEpisode(episode.episode_id).clarification_prompts_sent,budget.clarification_prompts_sent);
      store.close();
    }
  }
});

test('F1 crash during DIRECT_HUMAN insertion rolls back unsent supersession and source', t => {
  const file = fixture(t);
  let store = FirstLineStateStore.open(file);
  const stream = store.ensureConversationStream({sourceProvider:'chatwoot',sourceConversationId:55});
  const customer = id => ({
    sourceMessageId:id,eventKind:'CUSTOMER_MESSAGE',messageType:'incoming',
    senderClass:'contact',senderId:9001,contentType:'text',deleted:false,
    unsupported:false,hasAttachments:false,
  });
  store.ingestConversationEvent(stream.stream_id,customer(101));
  const action = prepareTestPublicAction(store, {
    descriptor:testActionDescriptor(),streamId:stream.stream_id,
    preparedStreamRevision:1,actionType:'ANSWER',basisEventSeqs:[1],
    deadlineAt:NOW+60000,
  });
  store.db.exec("CREATE TEMP TRIGGER f1_abort BEFORE INSERT ON semantic_origins " +
    "BEGIN SELECT RAISE(ABORT,'f1-injected-crash'); END");
  assert.throws(()=>store.ingestVerifiedChatwootEvent({
    sourceConversationId:55,event:customer(102),humanReason:'NATIVE_CUSTOMER_UPDATE',
  }),/f1-injected-crash/);
  store.close();
  store=FirstLineStateStore.open(file);
  assert.equal(store.getPublicAction(action.action_id).state,'PREPARED');
  assert.equal(store.getConversationStream(stream.stream_id).stream_revision,1);
  assert.equal(store.listConversationEvents(stream.stream_id).length,1);
  assert.equal(store.getUnresolvedContinuationOwner(stream.stream_id).owner_kind,'PUBLIC_ACTION');
  store.close();
});

test('F2 native input_email read-status update is neutral, with restart idempotency', async t => {
  const file = fixture(t), rows = new Map(), reads = [];
  rows.set(901, row(901, {
    message_type:'template', sender:null, content_type:'input_email',
    content_attributes:{},
  }));
  let relay = makeRelay(file,rows,reads);
  const created=envelope(901,{message_type:'template',sender:null});
  const updated=envelope(901,{event:'message_updated',message_type:'template',sender:null});
  assert.deepEqual(await relay.receive(signed(created)),{status:200,outcome:'topology_recorded'});
  assert.deepEqual(await relay.receive(signed(updated)),{status:200,outcome:'duplicate_source'});
  audit(file,(store,stream)=>{
    assert.equal(store.getUnresolvedContinuationOwner(stream.stream_id),null);
    assert.deepEqual(store.listConversationEvents(stream.stream_id).map(e=>e.event_kind),
      ['SYSTEM_TEMPLATE']);
  });
  relay.close();
  relay=makeRelay(file,rows,reads);
  assert.deepEqual(await relay.receive(signed(updated,'restart-delivery')),
    {status:200,outcome:'duplicate_source'});
  audit(file,(store,stream)=>assert.equal(store.getUnresolvedContinuationOwner(stream.stream_id),null));
  relay.close();
});

test('F2 submitted_email, submitted_values and CSAT all become HUMAN with no durable PII', async t => {
  const cases=[
    ['input_email',{submitted_email:'secret@example.invalid'}],
    ['input_email',{submitted_values:[{value:'secret@example.invalid'}]}],
    ['input_csat',{submitted_values:[{
      csat_survey_response:{feedback_message:'PRIVATE_SURVEY_WORDS',rating:5},
    }]}],
  ];
  for(const [type,attrs] of cases){
    const file=fixture(t),rows=new Map(),reads=[];
    rows.set(901,row(901,{
      message_type:'template',sender:null,content_type:type,
      content_attributes:attrs,
    }));
    const relay=makeRelay(file,rows,reads);
    assert.deepEqual(await relay.receive(signed(envelope(901,{
      event:'message_updated',message_type:'template',sender:null,
    }))),{status:200,outcome:'topology_recorded'});
    audit(file,(store,stream)=>{
      assert.equal(store.getUnresolvedContinuationOwner(stream.stream_id).owner_kind,'HUMAN');
      assert.equal(store.getUnresolvedContinuationOwner(stream.stream_id).human_reason,'NATIVE_STRUCTURED_UPDATE');
      assert.equal(store.listConversationEvents(stream.stream_id).length,1);
    });
    const db=fs.readFileSync(file);
    for(const str of ['secret@example.invalid','PRIVATE_SURVEY_WORDS']){
      assert.equal(db.includes(Buffer.from(str)),false);
    }
    relay.close();
  }
});

test('F2 unexpected content_attributes key or type fail closed to durable HUMAN',async t=>{
  for(const [type,attrs] of [
    ['input_email',{unknown_key:'PRIVATE_VALUE'}],
    ['form',{}],
    ['input_csat',{items:[{title:'unexpected choice'}]}],
  ]){
    const file=fixture(t),rows=new Map(),reads=[];
    rows.set(901,row(901,{
      message_type:'template',sender:null,content_type:type,
      content_attributes:attrs,
    }));
    const relay=makeRelay(file,rows,reads);
    assert.equal((await relay.receive(signed(envelope(901,{
      event:'message_updated',message_type:'template',sender:null,
    })))).status,200);
    audit(file,(store,stream)=>{
      assert.equal(store.getUnresolvedContinuationOwner(stream.stream_id).owner_kind,'HUMAN');
      assert.equal(store.listConversationEvents(stream.stream_id).length,1);
    });
    assert.equal(fs.readFileSync(file).includes(Buffer.from('PRIVATE_VALUE')),false);
    relay.close();
  }
});

test('F2 input_select bot read-status event does not absorb HUMAN while customer selection does',async t=>{
  for(const selection of [false,true]){
    const file=fixture(t),rows=new Map(),reads=[];
    rows.set(901,row(901,{
      message_type:'outgoing',sender:{type:'agent_bot',id:7},
      content_type:'input_select',source_id:'synthetic-action',
      content_attributes:selection
        ? {items:[{value:'safe'}],submitted_values:[{value:'PRIVATE_OPTION'}]}
        : {items:[{value:'safe'}]},
    }));
    const relay=makeRelay(file,rows,reads);
    assert.equal((await relay.receive(signed(envelope(901,{
      event:'message_updated',message_type:'outgoing',
      sender:{type:'agent_bot',id:7},
    })))).status,200);
    audit(file,(store,stream)=>{
      const owner=store.getUnresolvedContinuationOwner(stream.stream_id);
      assert.equal(owner?.owner_kind??null,selection?'HUMAN':null);
      assert.equal(store.listConversationEvents(stream.stream_id).length,1);
    });
    assert.equal(fs.readFileSync(file).includes(Buffer.from('PRIVATE_OPTION')),false);
    relay.close();
  }
});

test('F3 incoming content update is HUMAN even if authoritative current shape is text',async t=>{
  const file=fixture(t),rows=new Map(),reads=[];
  rows.set(901,row(901));
  const relay=makeRelay(file,rows,reads);
  assert.equal((await relay.receive(signed(envelope(901)))).status,200);
  assert.equal((await relay.receive(signed(envelope(901,{event:'message_updated'})))).status,200);
  audit(file,(store,stream)=>{
    assert.equal(store.getUnresolvedContinuationOwner(stream.stream_id).owner_kind,'HUMAN');
    assert.equal(store.listConversationEvents(stream.stream_id).length,1);
  });
  relay.close();
});

test('F1 PREPARED/GATING CLARIFY/ANSWER crash before HUMAN is all-or-nothing across restart', t => {
  for (const state of ['PREPARED', 'GATING']) {
    for (const kind of ['ANSWER', 'CLARIFY']) {
      const file = fixture(t);
      let store = FirstLineStateStore.open(file);
      const stream = store.ensureConversationStream({
        sourceProvider:'chatwoot',sourceConversationId:55,
      });
      const customer = id => ({
        sourceMessageId:id,eventKind:'CUSTOMER_MESSAGE',messageType:'incoming',
        senderClass:'contact',senderId:9001,contentType:'text',
        deleted:false,unsupported:false,hasAttachments:false,
      });
      store.ingestConversationEvent(stream.stream_id,customer(101));
      const episode=store.beginEpisode({streamId:stream.stream_id});
      const action=prepareTestPublicAction(store,{
        descriptor:testActionDescriptor(),streamId:stream.stream_id,
        episodeId:episode.episode_id,expectedEpisodeVersion:episode.version,
        preparedStreamRevision:1,actionType:kind,basisEventSeqs:[1],
        deadlineAt:NOW+60000,
        ...(kind==='CLARIFY'?{
          requestedSlot:'store_id',
          presentedCandidates:[{slot:'store_id',
            value:'store_11111111-1111-4111-8111-111111111111'}],
        }:{}),
      });
      if(state==='GATING'){
        store.claimNextPublicAction({leaseMs:30000,token:'crash-gating'});
      }
      const pre=store.getEpisode(episode.episode_id);
      store.db.exec("CREATE TEMP TRIGGER abort_direct_human BEFORE INSERT ON semantic_origins "+
        "BEGIN SELECT RAISE(ABORT,'synthetic-human-crash'); END");
      assert.throws(()=>store.ingestVerifiedChatwootEvent({
        sourceConversationId:55,event:customer(102),humanReason:'NATIVE_CUSTOMER_UPDATE',
      }),/synthetic-human-crash/);
      store.close();
      store=FirstLineStateStore.open(file);
      assert.equal(store.getPublicAction(action.action_id).state,state);
      assert.equal(store.getUnresolvedContinuationOwner(stream.stream_id).owner_kind,
        'PUBLIC_ACTION');
      assert.equal(store.getConversationStream(stream.stream_id).stream_revision,1);
      assert.equal(store.listConversationEvents(stream.stream_id).length,1);
      const after=store.getEpisode(episode.episode_id);
      assert.equal(after.clarification_prompts_sent,pre.clarification_prompts_sent);
      assert.equal(after.requested_slot,pre.requested_slot);
      store.close();
    }
  }
});

test('F2 sent-delivered-read repeats on same native email template never create HUMAN', async t => {
  const file=fixture(t),rows=new Map(),reads=[];
  const make=status=>row(951,{
    message_type:'template',sender:null,content_type:'input_email',
    content_attributes:{},status,
  });
  const receiveStatus=status=>signed(envelope(951,{
    event:'message_updated',message_type:'template',sender:null,
  }),status);
  rows.set(951,make('sent'));
  let relay=makeRelay(file,rows,reads);
  assert.equal((await relay.receive(signed(envelope(951,{
    message_type:'template',sender:null,
  })))).status,200);
  for(const status of ['delivered','read']){
    rows.set(951,make(status));
    assert.deepEqual(await relay.receive(receiveStatus(status)),
      {status:200,outcome:'duplicate_source'});
    audit(file,(store,stream)=>{
      assert.equal(store.getUnresolvedContinuationOwner(stream.stream_id),null);
    });
  }
  relay.close();
  relay=makeRelay(file,rows,reads);
  assert.deepEqual(await relay.receive(receiveStatus('restart-read')),
    {status:200,outcome:'duplicate_source'});
  relay.close();
});
