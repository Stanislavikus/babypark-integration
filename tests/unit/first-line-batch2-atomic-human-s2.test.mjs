import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../helpers/legacy-sending-fixture.mjs';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';
import { prepareTestPublicAction, testActionDescriptor } from '../helpers/first-line-action-descriptor.mjs';
import { buildFirstLineTransientCandidate } from '../../src/copilot/first-line-runtime-semantics.mjs';
import { prepareFirstLinePublicActionFromCandidate } from '../../src/copilot/first-line-action-preparation.mjs';
import { gatePublicActionToSending } from '../../src/copilot/first-line-public-action-gate.mjs';
import { FIRST_LINE_EXTRACTION_SCHEMA, FIRST_LINE_INTENT_SCHEMA_VERSION } from '../../src/copilot/first-line-extraction.mjs';

const NOW = 2_000_000_000_000;
const SENSITIVE = 'synthetic-customer-secret-never-persist';
const customer = id => ({
  sourceMessageId: id, eventKind: 'CUSTOMER_MESSAGE', messageType: 'incoming',
  senderClass: 'contact', senderId: 9001, contentType: 'text',
  deleted: false, unsupported: false, hasAttachments: false, sourceId: null,
});
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-s2-batch2-'));
  const file = path.join(dir, 'episode.sqlite');
  let now = NOW;
  const store = FirstLineStateStore.create(file, { now: () => now });
  const f = { store, file, get now() { return now; }, set now(value) { now = value; } };
  t.after(() => { try { f.store.close(); } catch {}; fs.rmSync(dir, { recursive: true, force: true }); });
  const stream = store.ensureConversationStream({ sourceProvider: 'chatwoot', sourceConversationId: 55 });
  store.ingestConversationEvent(stream.stream_id, customer(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  f.episodeId = episode.episode_id;
  f.streamId = stream.stream_id;
  return f;
}
function localAction(f, actionType) {
  const episode = f.store.getEpisode(f.episodeId);
  const result = prepareTestPublicAction(f.store, {
    descriptor: testActionDescriptor(), streamId: f.streamId,
    episodeId: episode.episode_id, expectedEpisodeVersion: episode.version,
    preparedStreamRevision: 1, actionType, basisEventSeqs: [1],
    deadlineAt: NOW + 60_000,
    ...(actionType === 'CLARIFY' ? {
      requestedSlot: 'store_id',
      presentedCandidates: [{ slot: 'store_id', value: 'store_11111111-1111-4111-8111-111111111111' }],
    } : {}),
  });
  return result;
}
function claim(f, token='lease-batch2') {
  return f.store.claimNextPublicAction({ leaseMs: 10_000, token });
}
function readBudget(f) {
  const episode = f.store.getEpisode(f.episodeId);
  return episode ? {
    count: episode.clarification_prompts_sent,
    slot: episode.requested_slot,
    action: episode.clarification_action_id,
  } : null;
}
for(const type of ['ANSWER', 'CLARIFY']) {
  for(const phase of ['PREPARED', 'GATING']) {
    for(const edge of ['LIVE', 'EQUAL', 'EXPIRED']) {
      test('H-LIVE-02a durable HUMAN '+type+' '+phase+' '+edge, t=>{
        const f=fixture(t), action=localAction(f,type);
        const token=phase==='GATING'?'lease-batch2':null;
        if(token)claim(f,token);
        const reserved=readBudget(f);
        f.now=NOW+(edge==='LIVE'?0:edge==='EQUAL'?10000:20000);
        const owner=f.store.handoffDeniedFirstLineS2ToHuman(action.action_id,{
          reason:'s2_final_authorization_denied',leaseToken:token,
        });
        assert.equal(owner.owner_kind,'HUMAN');
        assert.equal(owner.terminal_outcome,null);
        assert.equal(f.store.getPublicAction(action.action_id).state,'STALE');
        assert.equal(f.store.getUnresolvedContinuationOwner(f.streamId).owner_kind,'HUMAN');
        assert.deepEqual(readBudget(f),reserved);
        assert.equal(f.store.claimNextPublicAction({leaseMs:10000,token:'stale-worker'}),null);
        if(token){
          assert.throws(()=>f.store.commitFirstLineS2Sending({
            store:f.store,streamId:f.streamId,actionId:action.action_id,
            leaseToken:token,proof:null,candidate:null,authorityReader:null,
          }),e=>e.code==='FIRST_LINE_ACTION_CLAIM_INVALID'||e.code==='FIRST_LINE_S2_PROOF_INVALID');
        }
        f.store.close();
        f.store=FirstLineStateStore.open(f.file,{now:()=>f.now});
        assert.equal(f.store.getUnresolvedContinuationOwner(f.streamId).owner_kind,'HUMAN');
        assert.equal(f.store.getPublicAction(action.action_id).state,'STALE');
        assert.deepEqual(readBudget(f),reserved);
      });
    }
  }
}

test('H-LIVE-02a unavailable durable writer never returns success-shaped HUMAN',async t=>{
 const f=fixture(t);
 const {candidate,action}=await actionCandidate(f);
 const original=f.store.handoffDeniedFirstLineS2ToHuman.bind(f.store);
 f.store.handoffDeniedFirstLineS2ToHuman=()=>{throw new Error('synthetic-writer-unavailable');};
 const reader={
  async readAuthorizingConversationSnapshot(){return {
    code:'HISTORY_UNPROVABLE',complete:false,events:[],
  };},
  async readCurrentConversationAuthority(){throw new Error('not reached');},
 };
 await assert.rejects(gate(f,candidate,action,reader),/synthetic-writer-unavailable/);
 assert.equal(f.store.getUnresolvedContinuationOwner(f.streamId).owner_kind,'PUBLIC_ACTION');
 assert.equal(f.store.getPublicAction(action.action_id).state,'GATING');
 f.store.handoffDeniedFirstLineS2ToHuman=original;
 const result=await gate(f,candidate,action,reader);
 assert.equal(result.code,'HUMAN_REQUIRED');
 assert.equal(result.continuationOwner?.owner_kind,'HUMAN');
 assert.equal(f.store.getPublicAction(action.action_id).state,'STALE');
});

const knowledgeStore={authoritySnapshot:()=>[{
  revision_id:'policy-1',record_type:'COMMERCE_POLICY',schema_version:1,
  namespace:'commerce.payment_methods',effect_family:'commerce.payment_methods',
  subject_type:'business',subject_id:'babypark',scope:{},
  effect_type:'PAYMENT_METHODS',
  effect_value:{methods:['BANK_TRANSFER','COD_NOVA_POSHTA']},
  exception_of_revision_id:null,state:'PUBLISHED',
  effective_from_utc:'2026-01-01T00:00:00.000Z',expires_at_utc:null,
}]};
async function actionCandidate(f) {
  const reader={
    async readExactSourceMessage(_conversationId,id){
      return {code:'SUPPORTED_CUSTOMER_TEXT',sourceConversationId:55,sourceMessageId:id,
        event:customer(id),transientContent:'Какие способы оплаты есть?'};
    },
  };
  const candidate=await buildFirstLineTransientCandidate({
    store:f.store,streamId:f.streamId,reader,
    produceExtraction:async()=>({
      schema:FIRST_LINE_EXTRACTION_SCHEMA,intent_schema_version:FIRST_LINE_INTENT_SCHEMA_VERSION,
      intent_hint:'UNTRUSTED',language:'ru',spans:[],
    }),
    catalogService:{},knowledgeStore,nowUtc:'2026-01-10T12:00:00.000Z',
  });
  assert.equal(candidate.code,'CANDIDATE');
  const {action}=prepareFirstLinePublicActionFromCandidate({
    store:f.store,streamId:f.streamId,candidate,deadlineAt:NOW+60000,
  });
  claim(f);
  return {candidate,action};
}
async function gate(f,candidate,action,reader){
  return gatePublicActionToSending({
    store:f.store,candidate,actionId:action.action_id,leaseToken:'lease-batch2',
    authorityReader:reader,catalogService:{},knowledgeStore,
    nowUtc:'2026-01-10T12:00:00.000Z',configuredInboxId:99,
  });
}
for(const mode of ['NEW_ONE','NEW_TWO','INGRESS_RACE','CHANGED','MISSING','DUPLICATE_PAGE','PARTIAL_PAGE','REPLACED_SOURCE']){
  test('H-S2-03 fresh authority '+mode+' never reuses stale candidate',async t=>{
    const f=fixture(t),{candidate,action}=await actionCandidate(f);
    let exactCalls=[],snapshots=0;
    const event102=customer(102),event103=customer(103);
    const events=[customer(101),event102,...(mode==='NEW_TWO'?[event103]:[])];
    if(mode==='DUPLICATE_PAGE')events.push(event102);
    if(mode==='REPLACED_SOURCE')events.shift();
    const reader={
      async readAuthorizingConversationSnapshot(){
        snapshots++;
        return {code:'COMPLETE',complete:mode!=='PARTIAL_PAGE',
          rowCount:events.length,events};
      },
      async readExactSourceMessage(conv,id){
        exactCalls.push(id);
        if(mode==='MISSING')return {code:'ABSENT',sourceConversationId:conv,sourceMessageId:id};
        if(mode==='CHANGED')return {code:'SUPPORTED_CUSTOMER_TEXT',sourceConversationId:conv,
          sourceMessageId:id,event:{...customer(id),senderId:8888},transientContent:SENSITIVE};
        if(mode==='INGRESS_RACE')f.store.ingestVerifiedChatwootEvent({
          sourceConversationId:conv,event:customer(id),humanReason:'S2_NEW_AUTHORITATIVE_SOURCE',
        });
        return {code:'SUPPORTED_CUSTOMER_TEXT',sourceConversationId:conv,
          sourceMessageId:id,event:customer(id),transientContent:SENSITIVE};
      },
      async readCurrentConversationAuthority(){
        return {code:'SEND_ELIGIBLE',sourceConversationId:55,inboxId:99,
          status:'pending',ownerClass:'SAME_AGENTBOT'};
      },
    };
    const result=await gate(f,candidate,action,reader);
    assert.equal(result.code,'HUMAN_REQUIRED');
    assert.equal(result.continuationOwner?.owner_kind,'HUMAN');
    assert.equal(f.store.getUnresolvedContinuationOwner(f.streamId).owner_kind,'HUMAN');
    assert.equal(f.store.getPublicAction(action.action_id).state,'STALE');
    assert.equal(snapshots,1);
    if(['NEW_ONE','NEW_TWO','INGRESS_RACE'].includes(mode)){
      assert.deepEqual(exactCalls,mode==='NEW_TWO'?[102,103]:[102]);
      assert.deepEqual(f.store.listConversationEvents(f.streamId).map(x=>x.source_message_id),
        mode==='NEW_TWO'?[101,102,103]:[101,102]);
      const duplicate=f.store.ingestVerifiedChatwootEvent({
        sourceConversationId:55,event:customer(102),humanReason:'S2_NEW_AUTHORITATIVE_SOURCE',
      });
      assert.equal(duplicate.inserted,false);
    }else{
      assert.equal(f.store.listConversationEvents(f.streamId).length,1);
    }
    assert.equal(fs.readFileSync(f.file).includes(Buffer.from(SENSITIVE)),false);
    f.store.close();
    f.store=FirstLineStateStore.open(f.file,{now:()=>f.now});
    assert.equal(f.store.getUnresolvedContinuationOwner(f.streamId).owner_kind,'HUMAN');
    assert.equal(f.store.claimNextPublicAction({leaseMs:10000,token:'restart-worker'}),null);
  });
}

for(const type of ['ANSWER','CLARIFY']){
 for(const phase of ['PREPARED','GATING']){
  test('Batch2 S2-discovered source cuts unsent '+type+' '+phase+' while preserving CLARIFY',t=>{
    const f=fixture(t),action=localAction(f,type);
    if(phase==='GATING')claim(f);
    const budget=readBudget(f);
    const arrived=f.store.ingestVerifiedChatwootEvent({
      sourceConversationId:55,event:customer(102),
      humanReason:'S2_NEW_AUTHORITATIVE_SOURCE',
    });
    assert.equal(arrived.inserted,true);
    assert.equal(f.store.getPublicAction(action.action_id).state,'STALE');
    assert.equal(f.store.getUnresolvedContinuationOwner(f.streamId).owner_kind,'HUMAN');
    assert.deepEqual(readBudget(f),budget);
    const duplicate=f.store.ingestVerifiedChatwootEvent({
      sourceConversationId:55,event:customer(102),
      humanReason:'S2_NEW_AUTHORITATIVE_SOURCE',
    });
    assert.equal(duplicate.inserted,false);
    f.store.close();
    f.store=FirstLineStateStore.open(f.file,{now:()=>f.now});
    assert.equal(f.store.getUnresolvedContinuationOwner(f.streamId).owner_kind,'HUMAN');
    assert.equal(f.store.getPublicAction(action.action_id).state,'STALE');
    assert.deepEqual(readBudget(f),budget);
    assert.equal(f.store.claimNextPublicAction({leaseMs:10000,token:'old-worker'}),null);
  });
 }
}
test('H-LIVE-02a action deadline exactly now cannot authorize send or lose HUMAN',async t=>{
 const f=fixture(t),{candidate,action}=await actionCandidate(f);
 f.now=NOW+60000;
 const reader={
  async readAuthorizingConversationSnapshot(){
    return {code:'COMPLETE',complete:true,rowCount:1,events:[customer(101)]};
  },
  async readCurrentConversationAuthority(){
    return {code:'SEND_ELIGIBLE',sourceConversationId:55,inboxId:99,
      status:'pending',ownerClass:'SAME_AGENTBOT'};
  },
 };
 const result=await gate(f,candidate,action,reader);
 assert.equal(result.code,'HUMAN_REQUIRED');
 assert.equal(result.continuationOwner?.owner_kind,'HUMAN');
 assert.equal(f.store.getPublicAction(action.action_id).state,'STALE');
 assert.equal(f.store.claimNextPublicAction({leaseMs:10000,token:'too-late'}),null);
});
test('H-S2-03 simulated ingest writer unavailability still denies POST and durably hands off',async t=>{
 const f=fixture(t),{candidate,action}=await actionCandidate(f);
 const original=f.store.ingestVerifiedChatwootEvent.bind(f.store);
 f.store.ingestVerifiedChatwootEvent=()=>{throw new Error('synthetic-ingest-unavailable');};
 const reader={
  async readAuthorizingConversationSnapshot(){
    return {code:'COMPLETE',complete:true,rowCount:2,events:[customer(101),customer(102)]};
  },
  async readExactSourceMessage(_conversationId,id){
    return {code:'SUPPORTED_CUSTOMER_TEXT',sourceConversationId:55,sourceMessageId:id,
      event:customer(id),transientContent:SENSITIVE};
  },
  async readCurrentConversationAuthority(){throw new Error('not reached');},
 };
 const result=await gate(f,candidate,action,reader);
 assert.equal(result.code,'HUMAN_REQUIRED');
 assert.equal(result.continuationOwner?.owner_kind,'HUMAN');
 assert.equal(f.store.getPublicAction(action.action_id).state,'STALE');
 assert.deepEqual(f.store.listConversationEvents(f.streamId).map(x=>x.source_message_id),[101]);
 f.store.ingestVerifiedChatwootEvent=original;
 f.store.close();
 f.store=FirstLineStateStore.open(f.file,{now:()=>f.now});
 assert.equal(f.store.getUnresolvedContinuationOwner(f.streamId).owner_kind,'HUMAN');
});
