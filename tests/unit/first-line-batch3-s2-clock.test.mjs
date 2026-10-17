import test from 'node:test';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const R=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
await import(R+'/tests/helpers/legacy-sending-fixture.mjs');
const {FirstLineStateStore}=await import(R+'/src/copilot/first-line-state-store.mjs');
const {prepareFirstLinePublicActionFromCandidate}=await import(R+'/src/copilot/first-line-action-preparation.mjs');
const {buildFirstLineTransientCandidate}=await import(R+'/src/copilot/first-line-runtime-semantics.mjs');
const {gatePublicActionToSending}=await import(R+'/src/copilot/first-line-public-action-gate.mjs');
const {FIRST_LINE_EXTRACTION_SCHEMA,FIRST_LINE_INTENT_SCHEMA_VERSION}=await import(R+'/src/copilot/first-line-extraction.mjs');
const NOW=Date.parse('2026-01-10T13:00:00.000Z'); // store/wall clock: 13:00
const b={deleted:false,unsupported:false,hasAttachments:false};
const cust=id=>({sourceMessageId:id,eventKind:'CUSTOMER_MESSAGE',messageType:'incoming',senderClass:'contact',senderId:9001,contentType:'text',sourceId:null,...b});
// policy valid until 12:30Z -> EXPIRED at wall-clock 13:00
const ks={authoritySnapshot:()=>[{revision_id:'policy-1',record_type:'COMMERCE_POLICY',schema_version:1,namespace:'commerce.payment_methods',effect_family:'commerce.payment_methods',subject_type:'business',subject_id:'babypark',scope:{},effect_type:'PAYMENT_METHODS',effect_value:{methods:['BANK_TRANSFER','COD_NOVA_POSHTA']},exception_of_revision_id:null,state:'PUBLISHED',effective_from_utc:'2026-01-01T00:00:00.000Z',expires_at_utc:'2026-01-10T12:30:00.000Z'}]};
for (const s2Now of ['2026-01-10T12:00:00.000Z','2026-01-10T13:00:00.000Z']) test('S2 nowUtc='+s2Now, async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p9-')); const file=path.join(dir,'e.sqlite');
  const store=FirstLineStateStore.create(file,{now:()=>NOW});
  const st=store.ensureConversationStream({sourceProvider:'chatwoot',sourceConversationId:55});
  store.ingestConversationEvent(st.stream_id,cust(101)); store.beginEpisode({streamId:st.stream_id});
  const exact={async readExactSourceMessage(_c,id){return {code:'SUPPORTED_CUSTOMER_TEXT',sourceConversationId:55,sourceMessageId:id,event:cust(id),transientContent:'Какие способы оплаты есть?'};}};
  const candidate=await buildFirstLineTransientCandidate({store,streamId:st.stream_id,reader:exact,produceExtraction:async()=>({schema:FIRST_LINE_EXTRACTION_SCHEMA,intent_schema_version:FIRST_LINE_INTENT_SCHEMA_VERSION,intent_hint:'UNTRUSTED',language:'ru',spans:[]}),catalogService:{},knowledgeStore:ks,nowUtc:'2026-01-10T12:00:00.000Z'});
  const {action}=prepareFirstLinePublicActionFromCandidate({store,streamId:st.stream_id,candidate,deadlineAt:NOW+600000});
  store.claimNextPublicAction({leaseMs:100000,token:'L'});
  const reader={async readAuthorizingConversationSnapshot(){return {code:'COMPLETE',complete:true,rowCount:1,events:[cust(101)]};},
   async readCurrentConversationAuthority(c){return {code:'SEND_ELIGIBLE',sourceConversationId:c,inboxId:99,status:'pending',ownerClass:'SAME_AGENTBOT'};},
   async readExactSourceMessage(_c,id){return {code:'SUPPORTED_CUSTOMER_TEXT',sourceConversationId:55,sourceMessageId:id,event:cust(id),transientContent:'Какие способы оплаты есть?'};}};
  const r=await gatePublicActionToSending({store,candidate,actionId:action.action_id,leaseToken:'L',authorityReader:reader,catalogService:{},knowledgeStore:ks,nowUtc:s2Now,configuredInboxId:99});
  assert.equal(r.code,'HUMAN_REQUIRED');
  assert.equal(r.reason,'S2_SEMANTIC_FACTS_CHANGED');
  assert.equal(r.continuationOwner?.owner_kind,'HUMAN');
  assert.notEqual(store.getPublicAction(action.action_id).state,'SENDING');
  store.close(); fs.rmSync(dir,{recursive:true,force:true});
});
