import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { canonicalJson } from '../../src/catalog/ingest/replay-store.mjs';
import { phase0Records, phase1Records } from '../helpers/catalog-e6a1-fixture.mjs';
import { createD2bFixture as fixture } from '../helpers/drupal-d2b-sender-fixture.mjs';
import { verifySpool } from '../../src/drupal-d2b/spool.mjs';
import { acquireSenderLock, breakStaleSenderLock, inspectSenderLock } from '../../src/drupal-d2b/spool-lock.mjs';
import { createRunState, readRunState, stateFilePath, validateRunState, writeRunState } from '../../src/drupal-d2b/run-state.mjs';
import { sendSpool } from '../../src/drupal-d2b/sender.mjs';
import { D2bClient } from '../../src/drupal-d2b/client.mjs';
import { verifySignedRequest } from '../../src/catalog/ingest/auth.mjs';
import { D2bError } from '../../src/drupal-d2b/errors.mjs';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const layers = watermark => Object.fromEntries(['taxonomy','content','commercial','stock'].map(layer => [layer, { accepted_watermark: watermark, need_full: false, need_reconcile: false }]));
const bootstrap = { schema:'bp.catalog.state/1', state:'BOOTSTRAP', accepting_ingest:true, blockers:[], current_generation:null, source_epoch:null, published_identity_revision:null, accepted_run:null, layers:layers(null) };
async function waitFor(predicate, timeout=5000) { const end=Date.now()+timeout; while(Date.now()<end){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('timed out waiting for child process'); }

function rewriteChunk(f, body, { rows, phase = 0 } = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  fs.writeFileSync(path.join(f.spool, 'phase0-000001.json'), bytes, { mode: 0o600 });
  const chunk = f.manifest.chunks[0];
  chunk.bytes = bytes.length; chunk.sha256 = sha(bytes);
  if (rows !== undefined) chunk.rows = rows;
  chunk.phase = phase;
  f.manifest.phase_row_counts = { phase0: phase === 0 ? chunk.rows : 0, phase1: phase === 1 ? chunk.rows : 0 };
  f.manifest.total_canonical_rows = chunk.rows;
  fs.writeFileSync(path.join(f.spool, 'manifest.json'), `${JSON.stringify(f.manifest, null, 2)}\n`, { mode: 0o600 });
}

for (const [name, mutate] of [
  ['spool rejects rehashed non-JSON chunk before network', f => rewriteChunk(f, Buffer.from('not-json'), { rows: 1 })],
  ['spool rejects rehashed wrong actual row count before network', f => rewriteChunk(f, canonicalJson({ rows: phase0Records().slice(0, 1) }), { rows: 2 })],
  ['spool rejects rehashed record phase differing from manifest before network', f => rewriteChunk(f, canonicalJson({ rows: phase1Records().slice(0, 1) }), { rows: 1, phase: 0 })],
  ['spool rejects rehashed non-canonical JSON chunk before network', f => rewriteChunk(f, JSON.stringify({ rows: phase0Records().slice(0, 1) }, null, 2), { rows: 1 })],
  ['spool rejects rehashed empty production chunk before network', f => rewriteChunk(f, canonicalJson({ rows: [] }), { rows: 0 })],
]) test(name, t => { const f=fixture(); t.after(()=>fs.rmSync(f.root,{recursive:true,force:true})); mutate(f); assert.throws(()=>verifySpool(f.spool,f.options), error => /^D2B_CHUNK_/.test(error.code)); });

test('malformed lock evidence always refuses explicit stale break', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'d2b-lock-evidence-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true})); const hash='a'.repeat(64);
  for (const mutate of [o=>{o.boot_id=null},o=>{o.acquired_at='yesterday'},o=>{o.process_start_ticks='01x'},o=>{delete o.pid}]) {
    const lock=acquireSenderLock(root,hash); const ownerPath=path.join(lock.path,'owner.json'); const owner=JSON.parse(fs.readFileSync(ownerPath)); mutate(owner); fs.writeFileSync(ownerPath,JSON.stringify(owner),{mode:0o600});
    assert.throws(()=>breakStaleSenderLock(root,hash),e=>e.code==='D2B_LOCK_EVIDENCE_INVALID'); fs.rmSync(lock.path,{recursive:true,force:true});
  }
});

test('validated live, dead, and PID-reused lock identities classify safely', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'d2b-lock-classify-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true})); const hash='b'.repeat(64);
  let lock=acquireSenderLock(root,hash); assert.equal(inspectSenderLock(root,hash).reason,'owner_alive'); assert.throws(()=>breakStaleSenderLock(root,hash),e=>e.code==='D2B_LOCK_OWNER_ALIVE'); lock.release();
  lock=acquireSenderLock(root,hash); let owner=lock.owner; owner={...owner,pid:2147483647}; fs.writeFileSync(path.join(lock.path,'owner.json'),JSON.stringify(owner)); assert.equal(breakStaleSenderLock(root,hash).reason,'pid_absent');
  lock=acquireSenderLock(root,hash); owner={...lock.owner,process_start_ticks:String(BigInt(lock.owner.process_start_ticks)+1n)}; fs.writeFileSync(path.join(lock.path,'owner.json'),JSON.stringify(owner)); assert.equal(breakStaleSenderLock(root,hash).reason,'pid_reused');
});

test('two real processes compete and exactly one owns the per-spool lock', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'d2b-lock-process-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true})); const hash='c'.repeat(64); const barrier=path.join(root,'go');
  const results=[path.join(root,'one'),path.join(root,'two')]; const worker=path.resolve('tests/fixtures/drupal-d2b-lock-worker.mjs');
  const children=results.map(result=>fork(worker,[root,hash,barrier,result],{stdio:'ignore'})); fs.writeFileSync(barrier,'go');
  await Promise.all(children.map(child=>new Promise((resolve,reject)=>{child.once('exit',code=>code===0?resolve():reject(new Error(`worker ${code}`)));child.once('error',reject)})));
  assert.deepEqual(results.map(x=>fs.readFileSync(x,'utf8')).sort(),['lost:D2B_SENDER_LOCKED','owned']);
  assert.deepEqual(fs.readdirSync(root).sort(),['go','locks','one','two']);
});

test('SIGKILL leaves a provably dead lock that only explicit break removes', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'d2b-lock-kill-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const hash='d'.repeat(64);const worker=path.resolve('tests/fixtures/drupal-d2b-lock-sigkill-worker.mjs');
  for(let iteration=0;iteration<10;iteration++){const stateDir=path.join(root,String(iteration));const acquired=path.join(root,`acquired-${iteration}`);const child=fork(worker,[stateDir,hash,acquired],{stdio:'ignore'});await waitFor(()=>fs.existsSync(acquired));assert.equal(child.exitCode,null);const live=inspectSenderLock(stateDir,hash);assert.equal(live.alive,true);assert.equal(fs.existsSync(live.path),true);assert.equal(child.kill('SIGKILL'),true);const exit=await new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));assert.equal(exit.code,null);assert.equal(exit.signal,'SIGKILL');assert.equal(fs.existsSync(live.path),true);const stale=inspectSenderLock(stateDir,hash);assert.equal(stale.alive,false);assert.equal(stale.reason,'pid_absent');assert.throws(()=>acquireSenderLock(stateDir,hash),e=>e.code==='D2B_SENDER_LOCKED');assert.equal(breakStaleSenderLock(stateDir,hash).reason,'pid_absent');assert.doesNotThrow(()=>acquireSenderLock(stateDir,hash).release());}
});

test('two real sender entries give the loser zero state, FULL, run-state, and run ID side effects', async t => {
  const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));const stateDir=path.join(f.root,'sender');const barrier=path.join(f.root,'barrier');const release=path.join(f.root,'release-winner');const events=path.join(f.root,'events');const results=[path.join(f.root,'result-one'),path.join(f.root,'result-two')];const worker=path.resolve('tests/fixtures/drupal-d2b-sender-boundary-worker.mjs');const children=results.map(result=>fork(worker,[f.spool,stateDir,f.release,barrier,release,result,events],{stdio:'ignore'}));fs.writeFileSync(barrier,'go');await waitFor(()=>results.some(x=>fs.existsSync(x)));const early=results.find(x=>fs.existsSync(x));assert.match(fs.readFileSync(early,'utf8'),/:D2B_SENDER_LOCKED$/);assert.equal(fs.readFileSync(events,'utf8').trim().split('\n').length,1);assert.match(fs.readFileSync(events,'utf8'),/:state\n$/);assert.equal(fs.existsSync(stateFilePath(stateDir,sha(fs.readFileSync(path.join(f.spool,'manifest.json'))))),false);fs.writeFileSync(release,'go');await Promise.all(children.map(child=>new Promise((resolve,reject)=>{if(child.exitCode!==null)return resolve();child.once('exit',code=>code===0?resolve():reject(new Error(`worker ${code}`)));child.once('error',reject)})));const outcomes=results.map(x=>fs.readFileSync(x,'utf8'));assert.equal(outcomes.filter(x=>x.endsWith(':D2B_SENDER_LOCKED')).length,1);assert.equal(outcomes.filter(x=>x.endsWith(':TEST_STOP')).length,1);const lines=fs.readFileSync(events,'utf8').trim().split('\n');assert.equal(lines.filter(x=>x.endsWith(':state')).length,1);assert.equal(lines.filter(x=>x.endsWith(':full')).length,0);
});

test('send never auto-breaks a stale-looking lock and performs zero HTTP/state creation', async t => {
  const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));const stateDir=path.join(f.root,'state');const spool=verifySpool(f.spool,f.options);const lock=acquireSenderLock(stateDir,spool.spoolManifestSha256);const owner={...lock.owner,pid:2147483647};fs.writeFileSync(path.join(lock.path,'owner.json'),JSON.stringify(owner));let requests=0;
  await assert.rejects(()=>sendSpool({spoolPath:f.spool,config:{stateDir,kid:'kid',maxAttempts:1},verification:f.options,client:{state(){requests++},full(){requests++}},now:()=>new Date('2026-09-28T00:01:00.000Z')}),e=>e.code==='D2B_SENDER_LOCKED');assert.equal(requests,0);assert.equal(fs.existsSync(stateFilePath(stateDir,spool.spoolManifestSha256)),false);assert.equal(fs.existsSync(lock.path),true);
});

function terminalEvidence(run, spool) {
  const final_ack={accepted:true,generation_id:'generation',layer:'full',run_id:run.run_id,run_digest:run.run_digest,source_watermark:null};
  const post_ack_state={...bootstrap,state:'CURRENT',current_generation:'generation',source_epoch:spool.manifest.source_epoch,published_identity_revision:1,accepted_run:{run_id:run.run_id,run_digest:run.run_digest,final_seq:run.ordered_chunks.length+1,accepted_at:'2026-09-28T00:02:00.000Z'},layers:layers(spool.manifest.snapshot_watermark)};
  return { final_ack, post_ack_state };
}

test('terminal run state rejects corrupt final ACK and post-ACK state evidence', t => {
  const f=fixture(); t.after(()=>fs.rmSync(f.root,{recursive:true,force:true})); const spool=verifySpool(f.spool,f.options); const run=createRunState(spool,'kid',{randomUUID:()=> 'run',now:()=>new Date('2026-09-28T00:00:00.000Z')}); const evidence=terminalEvidence(run,spool); const finalSeq=run.ordered_chunks.length+1;
  const acked={...run,first_seq0_attempt_started_at:'2026-09-28T00:01:00.000Z',last_durably_acked_sequence:finalSeq,transport_state:'ACKED',final_ack:evidence.final_ack}; assert.doesNotThrow(()=>validateRunState(acked,spool));
  for(const final_ack of [{totally:'bogus'},{...evidence.final_ack,run_id:'other'},{...evidence.final_ack,source_watermark:spool.manifest.snapshot_watermark},{...evidence.final_ack,extra:true}]) assert.throws(()=>validateRunState({...acked,final_ack},spool),e=>e.code==='D2B_RUN_STATE_INVALID');
  const confirmed={...acked,transport_state:'STATE_CONFIRMED',post_ack_state:evidence.post_ack_state}; assert.doesNotThrow(()=>validateRunState(confirmed,spool));
  for(const post_ack_state of [{also:'bogus'},{...evidence.post_ack_state,current_generation:'other'},{...evidence.post_ack_state,extra:true}]) assert.throws(()=>validateRunState({...confirmed,post_ack_state},spool),e=>e.code==='D2B_RUN_STATE_INVALID');
});

test('run-state storage rejects symlink, public mode, and corrupt state file', t => {
  const f=fixture(); t.after(()=>fs.rmSync(f.root,{recursive:true,force:true})); const spool=verifySpool(f.spool,f.options); const run=createRunState(spool,'kid'); const dir=path.join(f.root,'state'); writeRunState(dir,run); const file=stateFilePath(dir,spool.spoolManifestSha256);
  fs.chmodSync(file,0o644); assert.throws(()=>readRunState(dir,spool),e=>e.code==='D2B_RUN_STATE_STORAGE_INVALID'); fs.chmodSync(file,0o600); fs.writeFileSync(file,'{'); assert.throws(()=>readRunState(dir,spool),e=>e.code==='D2B_RUN_STATE_INVALID');
  fs.rmSync(dir,{recursive:true}); const actual=path.join(f.root,'actual'); fs.mkdirSync(actual,{mode:0o700}); fs.symlinkSync(actual,dir); assert.throws(()=>readRunState(dir,spool),e=>e.code==='D2B_RUN_STATE_STORAGE_INVALID');
});

function stateOnlyClient(counter={full:0,state:0}) { return { counter, async state(){counter.state++;return{status:200,body:bootstrap}},async full(){counter.full++;throw new Error('unexpected full')}}; }
for(const [name,ageMs,code] of [['29m59s',1_799_000,null],['exactly 30m',1_800_000,null],['over 30m',1_800_001,'D2B_UNSENT_SPOOL_TOO_OLD'],['future',-1,'D2B_SPOOL_FROM_FUTURE']]) test(`new spool age gate: ${name}`, async t => {
  const f=fixture(); t.after(()=>fs.rmSync(f.root,{recursive:true,force:true})); const watermark=BigInt(f.manifest.snapshot_watermark); const nowMs=Number(watermark/1000n)+ageMs; const stateDir=path.join(f.root,'state'); const client=stateOnlyClient(); const promise=sendSpool({spoolPath:f.spool,config:{stateDir,kid:'kid',maxAttempts:1},verification:f.options,client,now:()=>new Date(nowMs),sleep:async()=>{}});
  if(code){await assert.rejects(promise,e=>e.code===code);assert.equal(fs.existsSync(stateFilePath(stateDir,sha(fs.readFileSync(path.join(f.spool,'manifest.json'))))),false);assert.equal(client.counter.full,0)}else await assert.rejects(promise,/unexpected full/);
});

test('sender-generated GET, seq0, data, and final requests verify with receiver BP1', async () => {
  const secret='sender-test-secret-at-least-32-chars'; const captured=[]; const fetchImpl=async(url,options)=>{captured.push({url,options});return new Response('{}',{status:200,headers:{'content-type':'application/json'}})}; const client=new D2bClient({origin:'http://127.0.0.1:1',audience:'aud',kid:'kid',secret,timeoutMs:1000},{fetchImpl,nowSeconds:()=>123});
  const bodies=[Buffer.alloc(0),Buffer.from('header'),Buffer.from('data'),Buffer.from('final')]; await client.state(); await client.full('run',0,false,bodies[1]); await client.full('run',1,false,bodies[2]); await client.full('run',2,true,bodies[3]);
  captured.forEach(({url,options},i)=>assert.doesNotThrow(()=>verifySignedRequest({method:options.method,path:new URL(url).pathname,headers:options.headers,bodyBytes:bodies[i],secrets:new Map([['kid',secret]]),audience:'aud',now:()=>123})));
});

test('HTTP redirect is manual, dedicated non-retryable, and never followed', async () => {
  const config={origin:'http://127.0.0.1:1',audience:'aud',kid:'kid',secret:'sender-test-secret-at-least-32-chars',timeoutMs:1000};
  let calls=0;const redirect=new D2bClient(config,{fetchImpl:async(_u,o)=>{calls++;assert.equal(o.redirect,'manual');return new Response('',{status:307,headers:{location:'https://forbidden.example/'}})},nowSeconds:()=>1}); await assert.rejects(()=>redirect.state(),e=>e.code==='D2B_REDIRECT_REJECTED'&&e.retryable===false&&e.details.http_status===307);assert.equal(calls,1);
});

test('redirect rejection never enters sender retry loop', async t => {
  const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));let calls=0;const config={stateDir:path.join(f.root,'state'),kid:'kid',maxAttempts:4,origin:'http://127.0.0.1:1',audience:'aud',secret:'sender-test-secret-at-least-32-chars',timeoutMs:1000};const client=new D2bClient(config,{fetchImpl:async()=>{calls++;return new Response('',{status:302,headers:{location:'https://forbidden.example/'}})},nowSeconds:()=>1});await assert.rejects(()=>sendSpool({spoolPath:f.spool,config,verification:f.options,client,now:()=>new Date('2026-09-28T00:01:00.000Z'),sleep:async()=>{}}),e=>e.code==='D2B_REDIRECT_REJECTED'&&e.retryable===false);assert.equal(calls,1);
});

test('HTTP client bounds responses and ordinary network failures remain retryable', async () => {
  const config={origin:'http://127.0.0.1:1',audience:'aud',kid:'kid',secret:'sender-test-secret-at-least-32-chars',timeoutMs:1000};
  const oversized=new D2bClient(config,{fetchImpl:async()=>new Response('x'.repeat(1_048_577),{status:500}),nowSeconds:()=>1}); await assert.rejects(()=>oversized.state(),e=>e.code==='D2B_RESPONSE_TOO_LARGE');
  const network=new D2bClient(config,{fetchImpl:async()=>{throw new TypeError('reset')},nowSeconds:()=>1});await assert.rejects(()=>network.state(),e=>e.code==='D2B_NETWORK_RETRYABLE'&&e.retryable===true);
});

function staged(runId, seq, body) { return {status:200,body:{schema:'bp.catalog.ingest-response/1',status:'STAGED',ack:{staged:true,run_id:runId,layer:'full',seq,body_sha256:sha(body)}}}; }
function currentFor(run, spool) { const e=terminalEvidence(run,spool); return e.post_ack_state; }
function acked(run, spool) { return {status:200,body:{schema:'bp.catalog.ingest-response/1',status:'ACKED',ack:terminalEvidence(run,spool).final_ack}}; }

test('lost STAGED response resumes the identical run, sequence, header, and trailer bytes', async t => {
  const f=fixture(); t.after(()=>fs.rmSync(f.root,{recursive:true,force:true})); const stateDir=path.join(f.root,'state'); const config={stateDir,kid:'kid',maxAttempts:1}; let lostBody; const first={async state(){return{status:200,body:bootstrap}},async full(runId,seq,_final,body){if(seq===0)return staged(runId,seq,body);lostBody=Buffer.from(body);throw new D2bError('D2B_NETWORK_RETRYABLE','lost',{retryable:true})}};
  await assert.rejects(()=>sendSpool({spoolPath:f.spool,config,verification:f.options,client:first,now:()=>new Date('2026-09-28T00:01:00.000Z'),sleep:async()=>{}}),e=>e.code==='D2B_RETRY_BUDGET_EXHAUSTED');
  const spool=verifySpool(f.spool,f.options); const before=readRunState(stateDir,spool); assert.equal(before.last_durably_acked_sequence,0); const seen=[]; let current=bootstrap;
  const second={async state(){return{status:200,body:current}},async full(runId,seq,final,body){seen.push({runId,seq,final,body:Buffer.from(body)});if(!final)return staged(runId,seq,body);current=currentFor(before,spool);return acked(before,spool)}};
  await sendSpool({spoolPath:f.spool,config,verification:f.options,client:second,now:()=>new Date('2026-09-28T01:01:00.000Z'),sleep:async()=>{}}); const after=readRunState(stateDir,spool);
  assert.equal(seen[0].seq,1);assert.deepEqual(seen[0].body,lostBody);assert.equal(after.run_id,before.run_id);assert.equal(after.run_header_base64,before.run_header_base64);assert.equal(after.trailer_base64,before.trailer_base64);
});

test('restart after multiple durable sequence ACKs starts at the next frozen sequence', async t => {
  const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));const firstBody=fs.readFileSync(path.join(f.spool,'phase0-000001.json'));const secondName='phase0-000002.json';fs.writeFileSync(path.join(f.spool,secondName),firstBody,{mode:0o600});f.manifest.chunks.push({...f.manifest.chunks[0],filename:secondName});f.manifest.chunk_count=2;f.manifest.phase_row_counts.phase0=2;f.manifest.total_canonical_rows=2;fs.writeFileSync(path.join(f.spool,'manifest.json'),`${JSON.stringify(f.manifest,null,2)}\n`,{mode:0o600});const stateDir=path.join(f.root,'state');const config={stateDir,kid:'kid',maxAttempts:1};
  const first={async state(){return{status:200,body:bootstrap}},async full(runId,seq,final,body){if(!final)return staged(runId,seq,body);throw new D2bError('D2B_NETWORK_RETRYABLE','stop',{retryable:true})}};await assert.rejects(()=>sendSpool({spoolPath:f.spool,config,verification:f.options,client:first,now:()=>new Date('2026-09-28T00:01:00.000Z'),sleep:async()=>{}}));const spool=verifySpool(f.spool,f.options);const run=readRunState(stateDir,spool);assert.equal(run.last_durably_acked_sequence,2);const seqs=[];let current=bootstrap;const second={async state(){return{status:200,body:current}},async full(_id,seq,_final,_body){seqs.push(seq);current=currentFor(run,spool);return acked(run,spool)}};await sendSpool({spoolPath:f.spool,config,verification:f.options,client:second,now:()=>new Date('2026-09-28T01:01:00.000Z'),sleep:async()=>{}});assert.deepEqual(seqs,[3]);
});

for (const [name,response] of [
  ['PENDING retry_same',{status:202,body:{schema:'bp.catalog.ingest-response/1',status:'PENDING',action:'retry_same'},retryAfter:0}],
  ['TEMPORARILY_BUSY retry_same',{status:503,body:{schema:'bp.catalog.error/1',status:503,code:'TEMPORARILY_BUSY',action:'retry_same',request_id:'busy-request'},retryAfter:0}],
]) test(`${name} retries the exact same bytes`, async t => {
  const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));const stateDir=path.join(f.root,'state');const bodies=[];let first=true;let run;
  const client={async state(){return{status:200,body:bootstrap}},async full(runId,seq,_final,body){bodies.push(Buffer.from(body));if(first){first=false;return response}return staged(runId,seq,body)}};
  await assert.rejects(()=>sendSpool({spoolPath:f.spool,config:{stateDir,kid:'kid',maxAttempts:2},verification:f.options,client,now:()=>new Date('2026-09-28T00:01:00.000Z'),sleep:async()=>{}})); assert.deepEqual(bodies[0],bodies[1]); run=readRunState(stateDir,verifySpool(f.spool,f.options));assert.equal(run.last_durably_acked_sequence,1);
});

test('bounded retry exhaustion preserves a valid resumable state', async t => {
  const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));const stateDir=path.join(f.root,'state');let attempts=0;const client={async state(){return{status:200,body:bootstrap}},async full(){attempts++;throw new D2bError('D2B_NETWORK_RETRYABLE','reset',{retryable:true})}};
  await assert.rejects(()=>sendSpool({spoolPath:f.spool,config:{stateDir,kid:'kid',maxAttempts:2},verification:f.options,client,now:()=>new Date('2026-09-28T00:01:00.000Z'),sleep:async()=>{}}),e=>e.code==='D2B_RETRY_BUDGET_EXHAUSTED');assert.equal(attempts,2);const state=readRunState(stateDir,verifySpool(f.spool,f.options));assert.equal(state.transport_state,'SENDING');assert.notEqual(state.first_seq0_attempt_started_at,null);
});

test('lost final ACK response causes exact-final retry, never a new run', async t => {
  const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));const stateDir=path.join(f.root,'state');const config={stateDir,kid:'kid',maxAttempts:1};let finalBody;const first={async state(){return{status:200,body:bootstrap}},async full(runId,seq,final,body){if(!final)return staged(runId,seq,body);finalBody=Buffer.from(body);throw new D2bError('D2B_NETWORK_RETRYABLE','lost final',{retryable:true})}};
  await assert.rejects(()=>sendSpool({spoolPath:f.spool,config,verification:f.options,client:first,now:()=>new Date('2026-09-28T00:01:00.000Z'),sleep:async()=>{}}));const spool=verifySpool(f.spool,f.options);const before=readRunState(stateDir,spool);let current=currentFor(before,spool);let retried;
  const second={async state(){return{status:200,body:current}},async full(_id,_seq,final,body){assert.equal(final,true);retried=Buffer.from(body);return acked(before,spool)}};await sendSpool({spoolPath:f.spool,config,verification:f.options,client:second,now:()=>new Date('2026-09-28T01:01:00.000Z'),sleep:async()=>{}});assert.deepEqual(retried,finalBody);assert.equal(readRunState(stateDir,spool).run_id,before.run_id);
});

test('durable final ACK with lost post-ACK state resumes confirmation without FULL', async t => {
  const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));const stateDir=path.join(f.root,'state');const config={stateDir,kid:'kid',maxAttempts:1};let stateCalls=0;let run;const first={async state(){stateCalls++;if(stateCalls===1)return{status:200,body:bootstrap};throw new D2bError('D2B_NETWORK_RETRYABLE','state lost',{retryable:true})},async full(runId,seq,final,body){if(!final)return staged(runId,seq,body);run=readRunState(stateDir,verifySpool(f.spool,f.options));return acked(run,verifySpool(f.spool,f.options))}};
  await assert.rejects(()=>sendSpool({spoolPath:f.spool,config,verification:f.options,client:first,now:()=>new Date('2026-09-28T00:01:00.000Z'),sleep:async()=>{}}));const spool=verifySpool(f.spool,f.options);run=readRunState(stateDir,spool);assert.equal(run.transport_state,'ACKED');let full=0;const second={async state(){return{status:200,body:currentFor(run,spool)}},async full(){full++}};await sendSpool({spoolPath:f.spool,config,verification:f.options,client:second,now:()=>new Date('2026-09-28T01:01:00.000Z'),sleep:async()=>{}});assert.equal(full,0);assert.equal(readRunState(stateDir,spool).transport_state,'STATE_CONFIRMED');
});

for (const [code,action] of [['STATE_MOVED','fetch_state_new_run'],['RUN_LOST','fetch_state_new_run'],['RUN_SUPERSEDED','fetch_state_new_run'],['SOURCE_EPOCH_CHANGED','operator'],['DEPENDENCY_CHANGED','fetch_state_new_run'],['CONFIG_AUTHORITY_MISMATCH','operator'],['RUN_HEADER_V2_REQUIRED','operator'],['PUBLICATION_AUTHORITY_UNSUPPORTED','operator'],['BACKUP_REQUIRED','operator'],['PAYLOAD_INVALID','fix_request'],['RUN_PROTOCOL_CONFLICT','fix_request_new_run']]) test(`${code} preserves remote code/action and frozen run`, async t => {
  const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));const stateDir=path.join(f.root,'state');const config={stateDir,kid:'kid',maxAttempts:1};const client={async state(){return{status:200,body:bootstrap}},async full(){return{status:409,body:{schema:'bp.catalog.error/1',status:409,code,action,request_id:`request-${code}`}}}};
  const assertion=e=>e.code==='D2B_CATALOG_ERROR'&&e.retryable===false&&e.details.http_status===409&&e.details.code===code&&e.details.action===action&&e.details.request_id===`request-${code}`;await assert.rejects(()=>sendSpool({spoolPath:f.spool,config,verification:f.options,client,now:()=>new Date('2026-09-28T00:01:00.000Z'),sleep:async()=>{}}),assertion);const spool=verifySpool(f.spool,f.options);const before=readRunState(stateDir,spool);await assert.rejects(()=>sendSpool({spoolPath:f.spool,config,verification:f.options,client,now:()=>new Date('2026-09-28T01:01:00.000Z'),sleep:async()=>{}}),assertion);const after=readRunState(stateDir,spool);assert.equal(after.run_id,before.run_id);assert.equal(after.run_header_base64,before.run_header_base64);assert.equal(after.trailer_base64,before.trailer_base64);
});
