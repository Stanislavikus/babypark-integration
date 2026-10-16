import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../helpers/legacy-sending-fixture.mjs';
import {FirstLineStateStore} from '../../src/copilot/first-line-state-store.mjs';
import {projectOpenTurn} from '../../src/copilot/first-line-routing-planner.mjs';
import {prepareTestPublicAction,testActionDescriptor} from '../helpers/first-line-action-descriptor.mjs';
const NOW=2000000000000;
const customer=id=>({sourceMessageId:id,eventKind:'CUSTOMER_MESSAGE',messageType:'incoming',senderClass:'contact',senderId:9001,contentType:'text',deleted:false,unsupported:false,hasAttachments:false,sourceId:null});
function echo(action,id){return {sourceMessageId:id,eventKind:'BABYPARK_PUBLIC_REPLY',messageType:'outgoing',senderClass:'configured_agent_bot',senderId:7,contentType:'text',sourceId:action.action_id};}
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bp-blk6-matrix-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'episode.sqlite');
 FirstLineStateStore.create(file,{now:()=>NOW}).close();
 let store=FirstLineStateStore.open(file,{now:()=>NOW});
 const stream=store.ensureConversationStream({sourceProvider:'chatwoot',sourceConversationId:55});
 store.ingestConversationEvent(stream.stream_id,customer(101));
 const action=prepareTestPublicAction(store,{descriptor:testActionDescriptor(),streamId:stream.stream_id,preparedStreamRevision:1,actionType:'ANSWER',basisEventSeqs:[1],deadlineAt:NOW+60000});
 store.claimNextPublicAction({leaseMs:30000,token:'probe-lease'});
 store.markActionSending(action.action_id,'probe-lease');
 return {store,stream,action,file};
}
for(const order of [
 ['child','echo'],['echo','child'],['child','echo','child'],['echo','child','child'],['child','child','echo'],['child','echo','child','child'],
]){
 test('ORDER '+order.join('->')+' normal confirm',t=>{
 const f=fixture(t);let id=102,deferred=[];
 for(const step of order){
   const value=step==='child'?customer(id++):echo(f.action,id++);
   const res=f.store.ingestConversationEvent(f.stream.stream_id,value);
   if(step==='child'){
     assert.equal(res.deferred_parent?.action_id,f.action.action_id);
     deferred.push(value.sourceMessageId);
   }
 }
 assert.equal(f.store.confirmPublicActionFromLedger(f.action.action_id).state,'CONFIRMED');
 const snap=f.store.readRoutingSnapshot(f.stream.stream_id);
 const result=projectOpenTurn(snap);
 f.store.close();
 f.store=FirstLineStateStore.open(f.file,{now:()=>NOW});
 const repeat=f.store.ingestVerifiedChatwootEvent({sourceConversationId:55,event:customer(deferred[0]??101)});
 assert.equal(repeat.inserted,false);
 const projected=projectOpenTurn(f.store.readRoutingSnapshot(f.stream.stream_id));
 assert.equal(projected.code,result.code);
 f.store.close();
 assert.equal(result.code,'OPEN_TURN');
 assert.deepEqual(result.open_turn.source_message_ids,deferred);
 });
}
for(const state of ['SENDING','UNCERTAIN']){
 for(const outcome of ['HUMAN','NORMAL']){
 test('BLK5/BLK6 '+state+' '+outcome+' replay restart',t=>{
  const f=fixture(t);
  if(state==='UNCERTAIN')f.store.markActionUncertain(f.action.action_id);
  const child=f.store.ingestVerifiedChatwootEvent({sourceConversationId:55,event:customer(102)});
  assert.equal(child.deferred_parent.action_id,f.action.action_id);
  if(outcome==='HUMAN'){
    f.store.escalatePublicActionToHuman(f.action.action_id,{reason:'synthetic_handoff'});
    assert.equal(f.store.getUnresolvedContinuationOwner(f.stream.stream_id).owner_kind,'HUMAN');
    f.store.ingestConversationEvent(f.stream.stream_id,echo(f.action,103));
    const late=f.store.confirmPublicActionFromLedger(f.action.action_id);
    assert.equal(late.continuation_owner.owner_kind,'HUMAN');
    assert.throws(()=>f.store.readRoutingSnapshot(f.stream.stream_id));
  } else {
    f.store.ingestConversationEvent(f.stream.stream_id,echo(f.action,103));
    assert.equal(f.store.confirmPublicActionFromLedger(f.action.action_id).state,'CONFIRMED');
    assert.deepEqual(projectOpenTurn(f.store.readRoutingSnapshot(f.stream.stream_id)).open_turn.source_message_ids,[102]);
  }
  f.store.close();
  f.store=FirstLineStateStore.open(f.file,{now:()=>NOW});
  const repeated=f.store.ingestVerifiedChatwootEvent({sourceConversationId:55,event:customer(102)});
  assert.equal(repeated.inserted,false);
  assert.equal(repeated.deferred_parent.action_id,f.action.action_id);
  if(outcome==='HUMAN')assert.throws(()=>f.store.readRoutingSnapshot(f.stream.stream_id));
  else assert.deepEqual(projectOpenTurn(f.store.readRoutingSnapshot(f.stream.stream_id)).open_turn.source_message_ids,[102]);
  f.store.close();
 });
 }
}

test('BLK6 confirmation-cut abort never opens deferred source until exact normal confirmation',t=>{
 const f=fixture(t);
 f.store.ingestConversationEvent(f.stream.stream_id,echo(f.action,9003));
 const child=f.store.ingestConversationEvent(f.stream.stream_id,customer(102));
 assert.equal(child.deferred_parent.action_id,f.action.action_id);
 f.store.db.exec("CREATE TEMP TRIGGER confirm_abort BEFORE INSERT ON " +
   "public_action_confirmation_cuts BEGIN SELECT RAISE(ABORT,'confirm-injected-crash'); END");
 assert.throws(()=>f.store.confirmPublicActionFromLedger(f.action.action_id),/confirm-injected-crash/);
 assert.equal(f.store.getPublicAction(f.action.action_id).state,'SENDING');
 const before=projectOpenTurn(f.store.readRoutingSnapshot(f.stream.stream_id));
 assert.equal(before.code,'TOPOLOGY_UNPROVABLE');
 f.store.close();
 f.store=FirstLineStateStore.open(f.file,{now:()=>NOW});
 assert.equal(f.store.getDeferredEventParent(f.stream.stream_id,3).action_id,f.action.action_id);
 assert.equal(f.store.confirmPublicActionFromLedger(f.action.action_id).state,'CONFIRMED');
 const after=projectOpenTurn(f.store.readRoutingSnapshot(f.stream.stream_id));
 assert.equal(after.code,'OPEN_TURN');
 assert.deepEqual(after.open_turn.source_message_ids,[102]);
 f.store.close();
});

for(const state of ['SENDING','UNCERTAIN']){
 test('BLK6 HUMAN takeover after echo-before-child stays HUMAN even with late evidence '+state,t=>{
  const f=fixture(t);
  if(state==='UNCERTAIN')f.store.markActionUncertain(f.action.action_id);
  f.store.ingestConversationEvent(f.stream.stream_id,echo(f.action,991));
  const child=f.store.ingestConversationEvent(f.stream.stream_id,customer(102));
  assert.equal(child.deferred_parent.action_id,f.action.action_id);
  const owner=f.store.escalatePublicActionToHuman(f.action.action_id,{reason:'handoff_synthetic'});
  assert.equal(owner.owner_kind,'HUMAN');
  const late=f.store.confirmPublicActionFromLedger(f.action.action_id);
  assert.equal(late.continuation_owner.owner_kind,'HUMAN');
  assert.throws(()=>f.store.readRoutingSnapshot(f.stream.stream_id));
  f.store.close();
  f.store=FirstLineStateStore.open(f.file,{now:()=>NOW});
  assert.throws(()=>f.store.readRoutingSnapshot(f.stream.stream_id));
  assert.equal(f.store.getDeferredEventParent(f.stream.stream_id,3).action_id,f.action.action_id);
  f.store.close();
 });
}
