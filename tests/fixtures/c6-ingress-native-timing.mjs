// Synthetic-only C6 A-prime component timing fixture, governed by
// docs/AI_FIRST_LINE_C6_INGRESS_TIMING_PRE_RUN_20261013.md.
// NEVER connect to deployed Chatwoot, external HTTP, or customer data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';

const NODE = '/opt/babypark-rehearsal/runtime/node-v24.20.0/bin/node';
const WARM = 10, SAMPLE = 59, SYNTHETIC_NOW = 2_000_000_000_000;
const source = fileURLToPath(import.meta.url);
const assertNoRoute = () => {
  const lines = fs.readFileSync('/proc/net/route','utf8').trim().split('\n').slice(1);
  if (lines.some(x => x.trim())) {
    throw new Error('NOT_ISOLATED: host route present');
  }
};
function values(xs) {
  const s = [...xs].sort((a,b)=>a-b);
  const sum = s.reduce((a,b)=>a+b,0);
  return { count:s.length, min_ms:s[0], p50_ms:s[Math.ceil(.5*s.length)-1],
    p95_ms:s[Math.ceil(.95*s.length)-1], max_ms:s[s.length-1],mean_ms:sum/s.length,
    raw_ms:xs };
}
function bench(name, fn, n=SAMPLE, warm=WARM) {
  for (let i=0;i<warm;i++) fn(i,true);
  const raw=[];
  for (let i=0;i<n;i++) {
    const t=performance.now();
    fn(i,false);
    raw.push(Number((performance.now()-t).toFixed(4)));
  }
  return { name, ...values(raw), outcome:'PASS_SYNTHETIC_COMPONENT_ONLY' };
}
function syntheticEvent(id) {
  return { sourceMessageId:id, eventKind:'CUSTOMER_MESSAGE', messageType:'incoming',
    senderClass:'contact', senderId:9001, contentType:'text',
    deleted:false, unsupported:false, hasAttachments:false, sourceId:null };
}
function send(child, data) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(new Error('fixture holder response timeout'))},3000);
    function onMsg(x){if(x.op!==data.op) return;cleanup();if(x.error) reject(new Error(x.error));else resolve(x)}
    function onExit(){cleanup();reject(new Error('fixture holder exited'))}
    function cleanup(){clearTimeout(timer);child.off('message',onMsg);child.off('exit',onExit)}
    child.on('message',onMsg);child.on('exit',onExit);child.send(data);
  });
}
function initPlain(file) {
  const db=new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, value INTEGER); INSERT OR IGNORE INTO probe VALUES (1,0)');
  const mode=db.prepare('PRAGMA journal_mode').get().journal_mode;
  assert.equal(mode,'delete'); db.close();
}
async function childFixture(file) {
  const db=new DatabaseSync(file);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode,'delete');
  db.exec('PRAGMA busy_timeout=5000');
  process.on('message', x=>{
    try {
      if(x.op==='BEGIN'){
        db.exec('BEGIN IMMEDIATE');
        process.send({op:x.op,held:true,busy:db.prepare('PRAGMA busy_timeout').get().timeout});
        setTimeout(()=>db.exec('COMMIT'),x.hold_ms);
      } else if(x.op==='SHARED'){
        db.exec('BEGIN');
        db.prepare('SELECT * FROM probe').all();
        process.send({op:x.op,held:true,busy:db.prepare('PRAGMA busy_timeout').get().timeout});
        setTimeout(()=>db.exec('COMMIT'),x.hold_ms);
      } else if(x.op==='close'){
        db.close();process.send({op:x.op});process.exit(0);
      }
    } catch(e){process.send({op:x.op,error:e.message});}
  });
  process.send({op:'ready'});
}
async function main() {
  assertNoRoute();
  assert.equal(process.versions.node,'24.20.0');
  assert.equal(process.versions.sqlite,'3.53.4');
  if (process.getuid?.()===0) throw new Error('must run as non-root');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bp-c6-a-prime-'));
  const metrics=[], lag=monitorEventLoopDelay({resolution:10});lag.enable();
  try{
    const v4file=path.join(tmp,'episode.sqlite');
    const store=FirstLineStateStore.create(v4file,{now:()=>SYNTHETIC_NOW});
    try {
      const stream=store.ensureConversationStream({sourceProvider:'chatwoot',sourceConversationId:55});
      let next=101;
      // Each warmup and measured event is distinct, append-only metadata.
      metrics.push(bench('A1_v4_ingest',()=>{const result=store.ingestConversationEvent(stream.stream_id,syntheticEvent(next++));assert.equal(result.inserted,true)}));
      const fixed=syntheticEvent(101);
      metrics.push(bench('A1_v4_duplicate',()=>{const r=store.ingestConversationEvent(stream.stream_id,fixed);assert.equal(r.inserted,false)}));
      assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,4);
      assert.equal(store.db.prepare('PRAGMA busy_timeout').get().timeout,5000);
    } finally {store.close();}
    const file=path.join(tmp,'locks.sqlite');initPlain(file);
    const writer=new DatabaseSync(file);
    writer.exec('PRAGMA busy_timeout=250');
    assert.equal(writer.prepare('PRAGMA journal_mode').get().journal_mode,'delete');
    const child=fork(source,['--holder',file],{execPath:NODE,stdio:['ignore','ignore','ignore','ipc'],env:{PATH:'/usr/bin:/bin',HOME:'/tmp'}});
    try {
      await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('child startup')),3000);
        child.once('message',m=>{clearTimeout(timeout);m.op==='ready'?resolve():reject(new Error('not ready'))});
        child.once('exit',()=>reject(new Error('early exit')));});
      const caseRun=async (label,op,hold,expectedBusy,n,warm) => {
        const times=[],errors=[];
        for(let i=0;i<n+warm;i++){
          const h=await send(child,{op,hold_ms:hold});
          assert.equal(h.held,true);assert.equal(h.busy,5000);
          assert.equal(writer.prepare('PRAGMA busy_timeout').get().timeout,expectedBusy);
          const start=performance.now();
          try {
            if(op==='BEGIN'){writer.exec('BEGIN IMMEDIATE');writer.exec('COMMIT')}
            if(op==='SHARED'){writer.exec('BEGIN IMMEDIATE');writer.prepare('UPDATE probe SET value=value+1 WHERE id=1').run();writer.exec('COMMIT');}
            if (label.includes('busy')) throw new Error('expected SQLITE_BUSY not thrown');
            errors.push('none');
          } catch(e) {
            try{writer.exec('ROLLBACK')}catch{}
            if(label.includes('busy')) {assert.match(String(e.message),/locked|busy/i);errors.push('SQLITE_BUSY')}
            else throw e;
          }
          if(i>=warm)times.push(Number((performance.now()-start).toFixed(4)));
          // Ensure holder scheduled release; slow async pause is outside timed SQLite work.
          await new Promise(r=>setTimeout(r,Math.max(hold+10,35)));
        }
        metrics.push({name:label,...values(times),
          child_timeout_ms:5000, parent_timeout_ms:expectedBusy,synthetic_hold_ms:hold,
          outcome:'PASS_SYNTHETIC_COMPONENT_ONLY',error_types:[...new Set(errors)]});
      };
      await caseRun('B1_BEGIN_20ms','BEGIN',20,250,SAMPLE,WARM);
      await caseRun('B2_DELETE_COMMIT_20ms','SHARED',20,250,SAMPLE,WARM);
      writer.exec('PRAGMA busy_timeout=15');
      await caseRun('B3_expected_busy_60ms','BEGIN',60,15,10,0);
      writer.exec('PRAGMA busy_timeout=250');
      await caseRun('B3_diagnostic_high_conn_60ms','BEGIN',60,250,3,0);
      await send(child,{op:'close'});
    }finally{if(child.exitCode===null) child.kill('SIGTERM');writer.close();}
  } finally {lag.disable(); fs.rmSync(tmp,{recursive:true,force:true});}
  const result={schema:'bp.c6.a-prime.synthetic-timing/1',node:process.version,sqlite:process.versions.sqlite,
    host:'babypark-catalog-rehearsal-fra1',mode:'net-namespace/no-route;non-root;synthetic-only',
    measurement_note:'sample maxima and p95 are descriptive, NEVER hard B_wait/K/C_sync bounds',
    loop_delay_mean_ms:Number((lag.mean/1e6).toFixed(4)),
    loop_delay_max_ms:Number((lag.max/1e6).toFixed(4)),
    metrics,
    untested:['A2','B3_chained_reacquisition','B4','C1','C2','D2','E1','E2']};
  console.log(JSON.stringify(result));
}
if(process.argv[2]==='--holder') {
  await childFixture(process.argv[3]);
} else {await main().catch(e=>{console.error('SYNTHETIC_HALT:'+e.stack);process.exitCode=1})}
