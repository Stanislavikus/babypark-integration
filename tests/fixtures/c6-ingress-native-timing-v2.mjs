// C6 A-prime V2: synthetic-only; see immutable incremental pre-run plan.
// Never import customer material, deployed Chatwoot endpoints, or production secrets.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';

const NOW=2_000_000_000_000, WARM=10, SAMPLES=59, N=4;
const SECRET='synthetic-only-c6-a-prime-v2-secret';
function noRoutes(){
  const raw=fs.readFileSync('/proc/net/route','utf8').trim().split('\n').slice(1);
  assert.equal(raw.filter(Boolean).length,0,'network route must be entirely absent');
}
function distribution(samples){
  assert.ok(samples.length>0);
  const sorted=[...samples].sort((a,b)=>a-b);
  const mean=samples.reduce((a,b)=>a+b,0)/samples.length;
  return {n:samples.length,p50_ms:sorted[Math.ceil(.5*sorted.length)-1],
    p95_ms:sorted[Math.ceil(.95*sorted.length)-1],max_ms:sorted.at(-1),
    min_ms:sorted[0],mean_ms:mean,raw_ms:samples};
}
function metrics(name,samples,extra={}){
  return {name,...distribution(samples),...extra,outcome:'PASS_SYNTHETIC_ONLY'};
}
const ms=()=>performance.now();
const sleep=n=>new Promise(resolve=>setTimeout(resolve,n));
function customerEvent(id){
  return {sourceMessageId:id,eventKind:'CUSTOMER_MESSAGE',messageType:'incoming',
    senderClass:'contact',senderId:9001,contentType:'text',deleted:false,
    unsupported:false,hasAttachments:false,sourceId:null};
}
async function a2(root){
  const dbfile=path.join(root,'a2-episode.sqlite');
  const store=FirstLineStateStore.create(dbfile,{now:()=>NOW});
  const values=[];
  try{
    for(let i=0;i<WARM+SAMPLES;i++){
      const start=ms();
      const stream=store.ensureConversationStream({sourceProvider:'chatwoot',sourceConversationId:1000+i});
      const ingest=store.ingestConversationEvent(stream.stream_id,customerEvent(1));
      assert.equal(ingest.inserted,true);
      const h=store.commitDirectHumanOrigin({streamId:stream.stream_id,streamRevision:1,reason:'planning_human'});
      assert.equal(h.origin.origin_kind,'DIRECT_HUMAN');
      assert.equal(h.continuation_owner.owner_kind,'HUMAN');
      assert.throws(()=>store.beginEpisode({streamId:stream.stream_id}),e=>e.code==='FIRST_LINE_HUMAN_CONTINUATION_ACTIVE');
      if(i>=WARM)values.push(Number((ms()-start).toFixed(4)));
    }
    assert.equal(store.db.prepare('PRAGMA busy_timeout').get().timeout,5000);
  } finally {store.close();}
  return metrics('A2_original_v4_ingest_plus_direct_HUMAN',values,
    {note:'existing v4 multiple owning transactions; NOT future ingress atomic single transaction'});
}
function hmac(body){return 'sha256='+crypto.createHmac('sha256',SECRET).update(body).digest('hex')}
function startUnixServer(socket,db){
  let inflight=0,highest=0,accepted=0,rejected=0,restReads=0,sqlSelects=0,restarts=0;
  const server=http.createServer((req,res)=>{
    let released=false,closed=false;
    const release=()=>{if(!released){released=true;inflight--;}};
    const reply=(status,payload)=>{if(closed)return;closed=true;clearTimeout(deadline);
      res.writeHead(status,{'content-type':'application/json','connection':'close'});
      res.end(JSON.stringify(payload));release()};
    if(inflight>=N){rejected++;res.writeHead(503,{'content-type':'application/json','connection':'close'});
      res.end(JSON.stringify({synthetic:true,rejected:'over-N'}));return;}
    inflight++;accepted++;highest=Math.max(inflight,highest);
    const deadline=setTimeout(()=>reply(408,{synthetic:true,rejected:'slow-body'}),30);
    let bytes=0,parts=[];
    req.on('data',chunk=>{
      if(closed)return;
      bytes+=chunk.length;
      if(bytes>4096){parts=[];reply(413,{synthetic:true,rejected:'too-large'});return;}
      parts.push(chunk);
    });
    req.on('aborted',()=>{clearTimeout(deadline);release();closed=true;});
    req.on('error',()=>{clearTimeout(deadline);release();closed=true;});
    req.on('end',async()=>{
      if(closed)return;
      clearTimeout(deadline); // body deadline applies to receipt, not synthetic REST.
      const body=Buffer.concat(parts);
      const sent=req.headers['x-synthetic-signature'];
      const expected=hmac(body);
      if(typeof sent!=='string'||sent.length!==expected.length||
        !crypto.timingSafeEqual(Buffer.from(sent),Buffer.from(expected))){
        reply(401,{synthetic:true,rejected:'signature'});return;
      }
      try{
        const parsed=JSON.parse(body.toString('utf8'));
        if(parsed.intent!=='synthetic-event'||!Number.isSafeInteger(parsed.id)){
          reply(422,{synthetic:true,rejected:'unknown-event'});return;
        }
        for(let phase=0;phase<3;phase++){await sleep(6);restReads++;restarts++;}
        if(req.headers['x-synthetic-scan']==='1'){
          for(let j=0;j<64;j++){assert.equal(db.prepare('SELECT value FROM probe WHERE id=1').get().value,0);sqlSelects++;}
        }
        reply(200,{synthetic:true});
      }catch(e){reply(422,{synthetic:true,rejected:'malformed-or-internal'});}
    });
  });
  return {server,stats:()=>({highest,accepted,rejected,restReads,sqlSelects,restarts,inflight})};
}
async function request(socket,{id=1,slow=false,oversize=false,badSig=false,scan=false}={}){
  const body=oversize?Buffer.alloc(4097,'x'):Buffer.from(JSON.stringify({
    intent:'synthetic-event',id,nonce:'synthetic-only'}));
  const signature=badSig?'sha256='+('0'.repeat(64)):hmac(body);
  const start=ms();
  return new Promise((resolve,reject)=>{
    const req=http.request({socketPath:socket,path:'/',method:'POST',
      agent:false,headers:{'content-type':'application/json',
        'x-synthetic-signature':signature,'x-synthetic-scan':scan?'1':'0'}},res=>{
      let data='';
      res.setEncoding('utf8');res.on('data',c=>data+=c);
      res.on('end',()=>{
        if(timer)clearTimeout(timer);
        let parsed;
        try{parsed=JSON.parse(data)}catch(e){reject(new Error('nonjson synthetic status '+res.statusCode));return;}
        resolve({status:res.statusCode,body:parsed,elapsed_ms:Number((ms()-start).toFixed(4))});
      });
    });
    req.on('error',reject);
    let timer=null;
    if(slow){req.write(body.subarray(0,1));timer=setTimeout(()=>req.end(body.subarray(1)),80);}
    else req.end(body);
  });
}
async function httpTests(root){
  const file=path.join(root,'http.sqlite');
  const db=new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=DELETE; CREATE TABLE probe(id INTEGER PRIMARY KEY,value INTEGER); INSERT INTO probe VALUES(1,0)');
  const sock=path.join(root,'synthetic.sock');
  const {server,stats}=startUnixServer(sock,db);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(sock,()=>{server.off('error',reject);resolve();})});
  const output=[];
  try{
    let t=[],normalFirst=stats();
    for(let i=0;i<WARM+SAMPLES;i++){
      const r=await request(sock,{id:i});
      assert.equal(r.status,200);assert.equal(r.body.synthetic,true);
      if(i>=WARM)t.push(r.elapsed_ms);
    }
    output.push(metrics('C1_mock_local_unix_HTTP_3_delayed_reads',t,
      {mock_rest_reads:stats().restReads-normalFirst.restReads,not_chatwoot_latency:true}));
    const waves=[],counts=[];
    for(let i=0;i<WARM+SAMPLES;i++){
      const a=ms();
      const res=await Promise.all(Array.from({length:8},(_,j)=>request(sock,{id:i*8+j+1000})));
      const ok=res.filter(x=>x.status===200).length;
      const rejected=res.filter(x=>x.status===503).length;
      assert.equal(ok+rejected,8);
      assert.ok(ok<=N&&rejected>=4);
      if(i>=WARM){waves.push(Number((ms()-a).toFixed(4)));counts.push({ok,rejected})}
    }
    output.push(metrics('C2_8_arrivals_N4_overload_waves',waves,
      {counts,expected_synthetic_503_only:true}));
    let admitted=0,resp=0;
    for(let repeat=0;repeat<10;repeat++){
      const b=stats().accepted;
      for(let wave=0;wave<4;wave++){
        const rs=await Promise.all(Array.from({length:8},(_,j)=>request(sock,{id:10000+repeat*32+wave*8+j})));
        admitted+=rs.filter(x=>x.status===200).length;resp+=rs.length;
      }
      const delta=stats().accepted-b;
      assert.ok(delta<=32);
    }
    assert.equal(resp,320);
    output.push({name:'C2_replenishment_4x8_10_repeats',
      outcome:'PASS_SYNTHETIC_ONLY',total_arrivals:resp,accepted:admitted,
      at_most:320,synthetic_service_not_ratelimited_in_production:true});
    const withSql=[],rBefore=stats();
    for(let i=0;i<WARM+SAMPLES;i++){
      const r=await request(sock,{id:20000+i,scan:true});
      assert.equal(r.status,200);
      if(i>=WARM)withSql.push(r.elapsed_ms);
    }
    assert.equal(stats().sqlSelects-rBefore.sqlSelects,64*(WARM+SAMPLES));
    output.push(metrics('C2_co_resident_64_selects_and_3_resumes',withSql,
      {sql_calls:64*(WARM+SAMPLES),uses_test_db:true}));
    for(const [kind,opts,status] of [
      ['slow-body',{slow:true},408],['oversize',{oversize:true},413],
      ['bad-hmac',{badSig:true},401]]){
      const startReads=stats().restReads;
      let passed=0;
      for(let i=0;i<10;i++){
        const r=await request(sock,{id:30000+i,...opts});
        assert.equal(r.status,status);
        assert.equal(r.body.synthetic,true);passed++;
      }
      assert.equal(stats().restReads,startReads,'invalid requests must have zero mock REST reads');
      output.push({name:'C2_'+kind,outcome:'PASS_SYNTHETIC_ONLY',n:passed,
        synthetic_status:status,not_proven_Chatwoot_native_effect:true});
    }
    const st=stats();assert.equal(st.inflight,0);assert.ok(st.highest<=N);
    return {results:output,service:st};
  }finally{
    await new Promise(resolve=>server.close(resolve));
    db.close();
    try{fs.unlinkSync(sock)}catch{}
  }
}
function cacheSpill(root){
  const file=path.join(root,'cache-spill.sqlite');
  const init=new DatabaseSync(file);
  init.exec('PRAGMA journal_mode=DELETE; CREATE TABLE data(k INTEGER PRIMARY KEY,v BLOB)');
  init.close();
  const observations=[];
  for(const mode of ['ON','OFF']){
    let busy=0,successful=0,t=[];
    for(let i=0;i<10;i++){
      const reader=new DatabaseSync(file),writer=new DatabaseSync(file);
      try{
        reader.exec('PRAGMA busy_timeout=5000; BEGIN; SELECT count(*) FROM data');
        writer.exec('PRAGMA busy_timeout=25; PRAGMA cache_size=-64; PRAGMA cache_spill='+mode);
        const actual=writer.prepare('PRAGMA cache_spill').get().cache_spill;
        if(mode==='ON') assert.ok(actual>0); else assert.equal(actual,0);
        assert.equal(writer.prepare('PRAGMA busy_timeout').get().timeout,25);
        assert.equal(writer.prepare('PRAGMA journal_mode').get().journal_mode,'delete');
        const before=ms();
        try {
          writer.exec('BEGIN IMMEDIATE');
          const insert=writer.prepare('INSERT OR REPLACE INTO data VALUES(?,?)');
          const b=Buffer.alloc(4096,45);
          for(let j=1;j<=128;j++)insert.run(j,b);
          successful++;
        }catch(e){
          assert.match(String(e.message),/locked|busy/i);
          busy++;
        }finally{
          try{writer.exec('ROLLBACK')}catch{}
          t.push(Number((ms()-before).toFixed(4)));
        }
        reader.exec('COMMIT');
      }finally{try{reader.close()}catch{}try{writer.close()}catch{}}
    }
    observations.push(metrics('B4_cache_spill_'+mode+'_128x4096_byte_rows',t,
      {busy,successful,readback_mode:mode,journal:'delete',
        note:'observes operations but cannot prove per-statement K / EXCLUSIVE site upper bound'}));
  }
  return observations;
}
async function main(){
  noRoutes();
  assert.equal(process.versions.node,'24.20.0');
  assert.equal(process.versions.sqlite,'3.53.4');
  assert.notEqual(process.getuid?.(),0);
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bp-c6-synthetic-v2-'));
  const delay=monitorEventLoopDelay({resolution:10}),cpu=process.cpuUsage(),start=ms();
  delay.enable();
  try{
    const A2=await a2(tmp);
    const B4=cacheSpill(tmp);
    const C=await httpTests(tmp);
    delay.disable();
    const cpuEnd=process.cpuUsage(cpu);
    console.log(JSON.stringify({schema:'bp.c6.a-prime.synthetic-timing-v2/1',
      test_host:'babypark-catalog-rehearsal-fra1',node:process.version,
      sqlite:process.versions.sqlite,uid:process.getuid(),network:'unshare --net; no routes',
      run_wall_ms:Number((ms()-start).toFixed(4)),
      cpu_us:cpuEnd,loop_delay_mean_ms:Number((delay.mean/1e6).toFixed(4)),
      loop_delay_max_ms:Number((delay.max/1e6).toFixed(4)),
      groups:[A2,...B4,...C.results],mock_http_service:C.service,
      still_untested:['B3_chained_lock_reacquisition','B4_per_statement_K_enforcement',
        'real_Chatwoot_REST_R_seq','production_peak_telemetry','target_cross_host_calibration',
        'native_failure_HUMAN_effects','real_B2_rollback_restore',
        'single_owning_ingress_transaction','customer_execution']}))
  }finally{delay.disable();fs.rmSync(tmp,{recursive:true,force:true})}
}
await main().catch(e=>{console.error('V2_SYNTHETIC_HALT: '+e.stack);process.exitCode=1});
