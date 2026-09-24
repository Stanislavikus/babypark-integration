import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReplayStore } from '../../src/catalog/ingest/replay-store.mjs';
import { canonicalControlJson } from '../../src/catalog/ingest/run-protocol.mjs';

const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const code = c => e => e?.code === c;
const header = runId => Buffer.from(canonicalControlJson({header:{base_generation_id:'g1',layers:[{base_watermark:null,layer:'taxonomy',mode:'replace',output_watermark:null,t_high:null,t_low:null}],run_id:runId,run_kind:'incremental',schema:'bp.catalog.run-header/1',source_epoch:'epoch-1'}}));
const key = (runId, seq, body) => ({kid:'k1',runId,layer:'taxonomy',seq,bodySha256:hash(body),final:false,contentEncoding:'identity'});
function fixture(t, options={}) { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bp-replay-v7-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); const file=path.join(dir,'ledger.sqlite'); const store=ReplayStore.createNew(file,{catalogStorageDir:dir,...options}); t.after(()=>{try{store.close()}catch{}}); return {dir,file,store}; }

test('v7 header receipt is immutable and survives restart', t => { const {file,store}=fixture(t); const body=header('r1'); const k=key('r1',0,body); const c=store.claim(k,100,{verifiedBody:body}); store.stage(k,body,c.claimToken); assert.deepEqual(store.claim(k,101,{verifiedBody:body}),{status:'STAGED_RECORDED'}); store.close(); const reopened=ReplayStore.openExisting(file,{catalogStorageDir:path.dirname(file)}); assert.equal(reopened.resolveStagedAck(k).status,'STAGED'); reopened.close(); });
test('owner lease takeover fences the former owner', t => { const {store}=fixture(t); const body=header('r1'); const k=key('r1',0,body); const first=store.claim(k,100,{verifiedBody:body}); const second=store.takeover(k,{now:161,expectedLeaseUntil:160}); assert.equal(second.status,'TAKEN_OVER'); assert.throws(()=>store.stage(k,body,first.claimToken),code('INGEST_REPLAY_OWNER_LOST')); assert.equal(store.stage(k,body,second.claimToken).status,'STAGED'); });
test('run identity cannot cross kid or layer', t => { const {store}=fixture(t); const body=header('r1'); const k=key('r1',0,body); store.claim(k,100,{verifiedBody:body}); assert.throws(()=>store.claim({...k,kid:'k2'},100,{verifiedBody:body}),code('INGEST_REPLAY_CONFLICT')); assert.throws(()=>store.claim({...k,layer:'stock'},100,{verifiedBody:body}),code('INGEST_REPLAY_HEADER_INVALID')); });
test('catalog directory and v7 schema are required', t => { const {file,store}=fixture(t); assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,7); store.close(); assert.throws(()=>ReplayStore.openExisting(file),code('INGEST_REPLAY_CONFIG_INVALID')); });
test('publication journal remains monotonic', t => { const {store}=fixture(t); assert.equal(store.recordPublication('g1','r1','intent',1),'intent'); assert.equal(store.recordPublication('g1','r1','switched',2),'switched'); assert.deepEqual(store.publication('g1'),{runId:'r1',state:'switched'}); assert.throws(()=>store.recordPublication('g1','r1','intent',3),code('INGEST_REPLAY_PUBLICATION_CONFLICT')); });
test('ledger receipt capacity fails closed', t => { const {store}=fixture(t,{maxReceipts:1}); const body=header('r1'); store.claim(key('r1',0,body),100,{verifiedBody:body}); const other=header('r2'); assert.throws(()=>store.claim(key('r2',0,other),100,{verifiedBody:other}),code('INGEST_REPLAY_CAPACITY')); });
