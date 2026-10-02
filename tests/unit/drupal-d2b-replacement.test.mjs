import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifySpool } from '../../src/drupal-d2b/spool.mjs';
import { readRunState } from '../../src/drupal-d2b/run-state.mjs';
import { sendSpool } from '../../src/drupal-d2b/sender.mjs';
import { parseRunHeader } from '../../src/catalog/ingest/run-protocol.mjs';
import { createD2bFixture as fixture } from '../helpers/drupal-d2b-sender-fixture.mjs';

const hash=b=>crypto.createHash('sha256').update(b).digest('hex');

function currentFor(spool, overrides={}) {
  return {
    schema:'bp.catalog.state/1',
    state:'CURRENT',
    accepting_ingest:true,
    blockers:[],
    current_generation:'g_old',
    source_epoch:spool.manifest.source_epoch,
    published_identity_revision:7,
    accepted_run:{run_id:'old_run',run_digest:'a'.repeat(64),final_seq:2,accepted_at:'2026-09-28T00:00:00.000Z'},
    layers:Object.fromEntries(['taxonomy','content','commercial','stock'].map(layer=>[
      layer,{accepted_watermark:spool.manifest.snapshot_watermark,need_full:false,need_reconcile:false}
    ])),
    ...overrides,
  };
}

test('replacement sender rebuilds exact CURRENT snapshot with signed base', async t => {
  const f=fixture(); t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
  const spool=verifySpool(f.spool,f.options);
  const stateDir=path.join(f.root,'replacement-state');
  const config={stateDir,kid:'kid',maxAttempts:2};
  let current=currentFor(spool);
  const sent=[];
  const client={
    async state(){ return {status:200,body:current,retryAfter:null}; },
    async full(runId,seq,final,body){
      sent.push({runId,seq,final,body:Buffer.from(body)});
      if(seq===0){
        const header=parseRunHeader(Buffer.from(body),{runId});
        assert.equal(header.base_generation_id,'g_old');
        assert.ok(header.layers.every(layer =>
          layer.base_watermark===spool.manifest.snapshot_watermark
        ));
      }
      if(!final){
        return {status:200,body:{schema:'bp.catalog.ingest-response/1',status:'STAGED',
          ack:{staged:true,run_id:runId,layer:'full',seq,body_sha256:hash(body)}}};
      }
      const run=readRunState(stateDir,spool);
      const ack={accepted:true,generation_id:'g_new',layer:'full',run_id:runId,
        run_digest:run.run_digest,source_watermark:null};
      current={...current,current_generation:'g_new',published_identity_revision:9,
        accepted_run:{run_id:runId,run_digest:run.run_digest,
          final_seq:run.ordered_chunks.length+1,accepted_at:'2026-10-02T10:45:00.000Z'}};
      return {status:200,body:{schema:'bp.catalog.ingest-response/1',status:'ACKED',ack}};
    }
  };
  const result=await sendSpool({
    spoolPath:f.spool,config,verification:f.options,client,replacement:true,
    now:()=>new Date('2026-10-02T10:44:00.000Z'),sleep:async()=>{}
  });
  assert.equal(result.status,'STATE_CONFIRMED');
  assert.deepEqual(sent.map(x=>[x.seq,x.final]),[[0,false],[1,false],[2,true]]);
  const run=readRunState(stateDir,spool);
  assert.equal(run.transport_state,'STATE_CONFIRMED');
  const header=parseRunHeader(Buffer.from(run.run_header_base64,'base64'),{runId:run.run_id});
  assert.equal(header.base_generation_id,'g_old');
});

test('replacement sender rejects watermark mismatch before network send', async t => {
  const f=fixture(); t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
  const spool=verifySpool(f.spool,f.options);
  const current=currentFor(spool);
  current.layers.stock={...current.layers.stock,
    accepted_watermark:String(BigInt(spool.manifest.snapshot_watermark)-1n)};
  let sends=0;
  await assert.rejects(
    sendSpool({
      spoolPath:f.spool,
      config:{stateDir:path.join(f.root,'state'),kid:'kid',maxAttempts:1},
      verification:f.options,
      replacement:true,
      client:{
        async state(){return{status:200,body:current,retryAfter:null}},
        async full(){sends++}
      },
      now:()=>new Date('2026-10-02T10:44:00.000Z'),
      sleep:async()=>{}
    }),
    error=>error.code==='D2B_REPLACEMENT_WATERMARK_MISMATCH'
  );
  assert.equal(sends,0);
});

test('ordinary send stays bootstrap-only on CURRENT', async t => {
  const f=fixture(); t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
  const spool=verifySpool(f.spool,f.options);
  let sends=0;
  await assert.rejects(
    sendSpool({
      spoolPath:f.spool,
      config:{stateDir:path.join(f.root,'plain'),kid:'kid',maxAttempts:1},
      verification:f.options,
      client:{
        async state(){return{status:200,body:currentFor(spool),retryAfter:null}},
        async full(){sends++}
      },
      now:()=>new Date('2026-10-02T10:44:00.000Z'),
      sleep:async()=>{}
    }),
    error=>error.code==='D2B_FIRST_FULL_AUTHORITY_INVALID'
  );
  assert.equal(sends,0);
});
