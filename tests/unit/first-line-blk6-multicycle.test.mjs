import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import '../helpers/legacy-sending-fixture.mjs';
import {FirstLineStateStore} from '../../src/copilot/first-line-state-store.mjs';
import {projectOpenTurn} from '../../src/copilot/first-line-routing-planner.mjs';
import {prepareTestPublicAction,testActionDescriptor} from '../helpers/first-line-action-descriptor.mjs';
const NOW=2000000000000;
const customer=id=>({sourceMessageId:id,eventKind:'CUSTOMER_MESSAGE',messageType:'incoming',senderClass:'contact',senderId:9001,contentType:'text',deleted:false,unsupported:false,hasAttachments:false,sourceId:null});
const echo=(action,id)=>({sourceMessageId:id,eventKind:'BABYPARK_PUBLIC_REPLY',messageType:'outgoing',senderClass:'configured_agent_bot',senderId:7,contentType:'text',sourceId:action.action_id});
for(const order2 of [['echo'],['child','echo'],['echo','child']]){
 test('BLK6 MULTICYCLE B '+order2.join('-'),t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bp-blk6-multi-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'episode.sqlite');
 FirstLineStateStore.create(file,{now:()=>NOW}).close();
 const s=FirstLineStateStore.open(file,{now:()=>NOW});t.after(()=>s.close());
 const stream=s.ensureConversationStream({sourceProvider:'chatwoot',sourceConversationId:55});
 s.ingestConversationEvent(stream.stream_id,customer(101));
 const a=prepareTestPublicAction(s,{descriptor:testActionDescriptor(),streamId:stream.stream_id,preparedStreamRevision:1,actionType:'ANSWER',basisEventSeqs:[1],deadlineAt:NOW+90000});
 s.claimNextPublicAction({leaseMs:30000,token:'lease-a'});s.markActionSending(a.action_id,'lease-a');
 s.ingestConversationEvent(stream.stream_id,customer(102));
 s.ingestConversationEvent(stream.stream_id,echo(a,103));
 s.confirmPublicActionFromLedger(a.action_id);
 const p1=projectOpenTurn(s.readRoutingSnapshot(stream.stream_id));
 assert.deepEqual(p1.open_turn.source_message_ids,[102]);
 const b=prepareTestPublicAction(s,{descriptor:testActionDescriptor(),streamId:stream.stream_id,preparedStreamRevision:3,actionType:'ANSWER',basisEventSeqs:[2],deadlineAt:NOW+90000});
 s.claimNextPublicAction({leaseMs:30000,token:'lease-b'});s.markActionSending(b.action_id,'lease-b');
 let n=104;for(const x of order2) s.ingestConversationEvent(stream.stream_id,x==='child'?customer(n++):echo(b,n++));
 s.confirmPublicActionFromLedger(b.action_id);
 const projection=projectOpenTurn(s.readRoutingSnapshot(stream.stream_id));
 if(order2.length===1){assert.equal(projection.code,'NO_OPEN_TURN');}
 else {assert.equal(projection.code,'OPEN_TURN');
 assert.deepEqual(projection.open_turn.source_message_ids,[order2[0]==='child'?104:105]);}
 });
}
