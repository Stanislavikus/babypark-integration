// C6 Stage B Phase A — synthetic-only pre-run fixture. NOT APPROVED TO EXECUTE.
// Exact Stage B Scan 5f43c0cda1b23c3003e92cfbae8d33ea88ef213929eeed0aa0323c8cad047c6d
// Exact Stage B Fit 9d8ba74c3c998c66fbabc6adc89599cf152ee20f0683cbbf17d2ead6cae25427
// No customer data, no Chatwoot API, no production DB, no public network listener.
// Separate review and owner authorization REQUIRED before ANY execution.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fork, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';

const SELF = fileURLToPath(import.meta.url);
const HELPER = fileURLToPath(new URL('./c6-stage-b-phase-a-holder.mjs', import.meta.url));
const SEED = 20261014, LONG_SAMPLE = 10, LIGHT_SAMPLE = 90;
const ORDER = ['SB-00','SB-01','SB-11','SB-10','SB-02','SB-03','SB-04','SB-08','SB-09'];
let ACTIVE_GROUP_PID = null;
const CAPS = Object.freeze({'SB-00':30,'SB-01':120,'SB-11':60,'SB-10':120,
  'SB-02':180,'SB-03':120,'SB-04':180,'SB-08':90,'SB-09':90});
const SECRET = 'synthetic-only-phase-a-no-production-key';
const MI_B = 1024 * 1024;
const ms = () => performance.now();
const sleep = t => new Promise(resolve => setTimeout(resolve,t));
function fail(reason) { throw new Error('SB_A_HALT_' + reason); }
function assertEnvironment(scratch) {
  if (process.version !== 'v24.20.0' || process.versions.sqlite !== '3.53.4' ||
      process.getuid?.() !== 65534 || process.getgid?.() !== 65534) fail('RUNTIME_OR_UID');
  if (!path.isAbsolute(scratch) || !path.basename(scratch).startsWith('bp-c6-sb-a-') ||
      fs.realpathSync(scratch) !== scratch) fail('SCRATCH_PATH');
  const st=fs.statSync(scratch);
  if (st.uid !== 65534 || st.gid !== 65534 || !st.isDirectory() ||
      (st.mode & 0o077) !== 0) fail('SCRATCH_OWNERSHIP_OR_MODE');
  const ipv4=fs.readFileSync('/proc/net/route','utf8').trim().split('\n').slice(1);
  if (ipv4.some(x=>x.trim())) fail('IPV4_ROUTE_PRESENT');
  const ipv6=fs.readFileSync('/proc/net/ipv6_route','utf8').trim().split('\n');
  if (ipv6.some(x=>x.trim() && x.trim().split(/\s+/).at(-1)!=='lo')) fail('IPV6_ROUTE_PRESENT');
  if (Object.keys(os.networkInterfaces()).some(x=>x!=='lo')) fail('NON_LOOPBACK_INTERFACE');
}
function rng(seed=SEED) {
  let x=seed>>>0;
  return () => { x=(Math.imul(x,1664525)+1013904223)>>>0; return x/4294967296; };
}
function shuffle(items,random=rng()) {
  const x=[...items];
  for(let i=x.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[x[i],x[j]]=[x[j],x[i]];}
  return x;
}
function stats(arr) {
  if (!arr.length) fail('NO_SAMPLES');
  const s=[...arr].sort((a,b)=>a-b);
  const at=p=>s[Math.max(0,Math.ceil(p*s.length)-1)];
  return {n:s.length,min_ms:s[0],p50_ms:at(.5),p95_ms:at(.95),
    p99_ms:at(.99),max_ms:s.at(-1),mean_ms:arr.reduce((a,b)=>a+b,0)/arr.length,
    raw_ms:arr};
}
function elapsed(t){return Number((ms()-t).toFixed(4));}
function check(sql,pragma,expected) {
  const v=sql.prepare('PRAGMA '+pragma).get();
  const value=Object.values(v??{})[0];
  assert.equal(value,expected,'readback '+pragma);
  return value;
}
function createProbe(root,id) {
  assert.match(id,/^[A-Za-z0-9_-]+$/);
  const file=path.join(root,'probe-'+id+'.sqlite');
  const db=new DatabaseSync(file);
  try {
    db.exec('PRAGMA journal_mode=DELETE');
    db.exec('PRAGMA synchronous=FULL');
    db.exec('PRAGMA busy_timeout=25');
    check(db,'journal_mode','delete');
    check(db,'synchronous',2);
    check(db,'busy_timeout',25);
    db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY,v BLOB); INSERT INTO probe VALUES(1,zeroblob(32))');
  }finally{db.close();}
  return file;
}
// cache_size, cache_spill, synchronous and busy_timeout must be applied on EACH
// measured connection. The createProbe setup connection was closed.
function configureProbe(db,{cache=-2000,spill='OFF',busy=25}={}) {
  if(!Number.isSafeInteger(cache)||cache>=0||
      !['ON','OFF'].includes(spill)||![10,25,50,5000].includes(busy))
    fail('MEASURED_PRAGMA_SHAPE');
  db.exec('PRAGMA synchronous=FULL');
  db.exec('PRAGMA busy_timeout='+busy);
  db.exec('PRAGMA cache_size='+cache);
  db.exec('PRAGMA cache_spill='+spill);
  const config={journal:check(db,'journal_mode','delete'),
    synchronous:check(db,'synchronous',2),
    busy_timeout:check(db,'busy_timeout',busy),
    cache_size:check(db,'cache_size',cache),
    cache_spill:db.prepare('PRAGMA cache_spill').get().cache_spill};
  if(spill==='OFF')assert.equal(config.cache_spill,0);
  else assert.ok(config.cache_spill>0,'cache_spill ON effective readback');
  return config;
}
function event(id) {
  return {sourceMessageId:id,eventKind:'CUSTOMER_MESSAGE',messageType:'incoming',
    senderClass:'contact',senderId:9001,contentType:'text',deleted:false,
    unsupported:false,hasAttachments:false,sourceId:null};
}
function guardedTx(db,fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result=fn();
    if(result!==null && (typeof result==='object'||typeof result==='function') &&
       typeof result.then==='function') fail('ASYNC_TX_REJECTED');
    db.exec('COMMIT');
    return result;
  }catch(e){try{db.exec('ROLLBACK')}catch{}throw e;}
}
async function sb00(root) {
  const out=[];
  for(let i=0;i<2;i++){
    const file=createProbe(root,'sb00-'+i);
    const db=new DatabaseSync(file);
    try {
      const fresh_busy_timeout=check(db,'busy_timeout',0);
      const configured=configureProbe(db,{cache:i===0?-64:-2000,
        spill:i===0?'OFF':'ON',busy:25});
      out.push({database:'synthetic_'+i,fresh_busy_timeout,...configured});
    }finally{db.close();}
  }
  return {journal_family:'DELETE_ONLY_PHASE_A',databases:out,node:process.version,
    sqlite:process.versions.sqlite,rootless:true,network:'no_routes'};
}
async function sb01(root) {
  const file=path.join(root,'sb01-episode.sqlite');
  const store=FirstLineStateStore.create(file,{now:()=>2_000_000_000_000});
  const samples=[];let duplicates=0,human=0;
  try{
    for(let i=0;i<LIGHT_SAMPLE;i++){
      const t=ms();
      const stream=store.ensureConversationStream({sourceProvider:'chatwoot',sourceConversationId:10000+i});
      const first=store.ingestConversationEvent(stream.stream_id,event(1));
      assert.equal(first.inserted,true);
      const second=store.ingestConversationEvent(stream.stream_id,event(1));
      assert.equal(second.inserted,false);duplicates++;
      const absorb=store.commitDirectHumanOrigin({streamId:stream.stream_id,streamRevision:1,reason:'planning_human'});
      assert.equal(absorb.continuation_owner.owner_kind,'HUMAN');human++;
      assert.throws(()=>store.beginEpisode({streamId:stream.stream_id}),
        e=>e?.code==='FIRST_LINE_HUMAN_CONTINUATION_ACTIVE');
      samples.push(elapsed(t));
    }
    assert.equal(check(store.db,'busy_timeout',5000),5000);
  }finally{store.close();}
  const probe=createProbe(root,'sb01-atomic');
  const db=new DatabaseSync(probe);
  let thenableRejected=false,rolledBack=false;
  try {
    try{guardedTx(db,()=>{db.exec("UPDATE probe SET v=x'01' WHERE id=1");
      return Promise.resolve('MUST_NOT_COMMIT');});}
    catch(e){thenableRejected=String(e.message).includes('SB_A_HALT_ASYNC_TX_REJECTED');}
    rolledBack=Buffer.compare(db.prepare('SELECT v FROM probe WHERE id=1').get().v,Buffer.alloc(32))===0;
    assert.equal(thenableRejected,true);
    assert.equal(rolledBack,true);
  }finally{db.close();}
  return {existing_v4_surrogate:stats(samples),duplicates,human,
    candidate_guard:{thenableRejected,rolledBack},
    final_single_ingress_transaction:'NOT_IMPLEMENTED_OR_PROVEN',
    current_v4_two_transaction_ingress:'EXPECTED_GAP_NOT_PASS'};
}
function guardedEntry(db,remaining,evidence=100) {
  // TEST-ONLY threshold, not a production budget.
  if(!Number.isFinite(remaining)||remaining<=evidence)return false;
  db.exec('BEGIN IMMEDIATE');
  db.exec('ROLLBACK');
  return true;
}
async function sb11(root) {
  const file=createProbe(root,'sb11');
  const db=new DatabaseSync(file);
  const cases=[];
  try{
    for(const n of [-1,0,1,99,100,101,150]){
      const before=Buffer.from(db.prepare('SELECT v FROM probe WHERE id=1').get().v);
      const entered=guardedEntry(db,n);
      assert.equal(entered,n>100);
      assert.equal(Buffer.compare(Buffer.from(db.prepare('SELECT v FROM probe WHERE id=1').get().v),before),0);
      cases.push({remaining_test_ms:n,entered});
    }
  }finally{db.close();}
  const holder=await makeHolder(root);
  let nativeBusy='UNKNOWN',blockingElapsedMs=null;
  try {
    const lockFile=createProbe(root,'sb11-block');
    await holder.prepare(lockFile);
    const op=await holder.hold('write',50,0,1);
    const writer=new DatabaseSync(lockFile);
    try{
      writer.exec('PRAGMA busy_timeout=25');check(writer,'busy_timeout',25);
      const t=ms();
      // Remaining synthetic budget passes, but a subsequent synchronous BEGIN can block.
      assert.equal(101>100,true);
      try {writer.exec('BEGIN IMMEDIATE');nativeBusy='ACQUIRED';writer.exec('ROLLBACK');}
      catch(e){nativeBusy=/locked|busy/i.test(String(e.message))?'SQLITE_BUSY':'UNEXPECTED';try{writer.exec('ROLLBACK')}catch{}}
      blockingElapsedMs=elapsed(t);
      assert.notEqual(nativeBusy,'UNEXPECTED');
    }finally{writer.close();}
    await holder.done(op);
  }finally{await holder.close();}
  return {branch_cases:cases,E_test_ms:100,negative_native_wait:{outcome:nativeBusy,
    blocking_elapsed_ms:blockingElapsedMs},
    timer_cannot_preempt_sync_sqlite:true,not_production_deadline:true};
}
function makeHolder(root) {
  const child=fork(HELPER,[root],{execPath:process.execPath,stdio:['ignore','ignore','pipe','ipc'],
    env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',TMPDIR:root,NODE_OPTIONS:''}});
  let counter=0,finished=false;
  const queued=new Map(),waiters=new Map();
  child.stderr?.on('data',()=>{}); // Never reflect raw subprocess stderr in evidence.
  function key(id,stage){return id+':'+stage;}
  child.on('message',m=>{
    const k=key(m.id,m.stage),w=waiters.get(k);
    if(w){waiters.delete(k);clearTimeout(w.timer);w.resolve(m);}
    else queued.set(k,m);
    if(m.stage==='failed'){
      for(const [name,v] of waiters){
        if(name.startsWith(m.id+':')){waiters.delete(name);clearTimeout(v.timer);v.reject(new Error(m.code||'SB_HOLDER_FAILED'));}}
    }
  });
  child.once('exit',()=>{finished=true;for(const [k,w] of waiters){clearTimeout(w.timer);w.reject(new Error('SB_HOLDER_EXIT'));}waiters.clear();});
  function wait(id,stage,cap=3000){
    const k=key(id,stage);
    if(queued.has(k)){const data=queued.get(k);queued.delete(k);return Promise.resolve(data);}
    if(finished)return Promise.reject(new Error('SB_HOLDER_EXIT'));
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{waiters.delete(k);reject(new Error('SB_HOLDER_IPC_TIMEOUT'));},cap);
      waiters.set(k,{resolve,reject,timer});
    });
  }
  async function send(op,fields,stage){
    const id=++counter;
    child.send({op,id,...fields});
    const m=await wait(id,stage);
    if(m.stage!==stage)fail('HOLDER_BAD_REPLY');
    return id;
  }
  return (async()=>{
    try{
      await wait(0,'booted');
      return {
        prepare:file=>send('prepare',{file},'ready'),
        hold:(kind,holdMs,gapMs,rounds)=>send('hold',{kind,holdMs,gapMs,rounds},'held'),
        done:async id=>{const msg=await wait(id,'done',3000);return msg.acquisition??null;},
        close:async()=>{
          if(finished)return;
          try{await send('close',{},'closed');}
          catch{child.kill('SIGTERM');throw new Error('SB_HOLDER_CLOSE_FAILED');}
        }
      };
    }catch(e){child.kill('SIGTERM');throw e;}
  })();
}
function queryOne(db) {
  return db.prepare('SELECT length(v) AS n FROM probe WHERE id=1').get()?.n;
}
async function sb02(root) {
  const samples=[];const random=rng();
  const grid=[];
  for(const gap of [0,1,5,20])for(const busy of [10,25,50])for(const hold of [0,10,50])
    for(let trial=0;trial<LONG_SAMPLE;trial++)grid.push({gap,busy,hold,trial});
  const holder=await makeHolder(root);
  try{
    let id=0;
    for(const x of shuffle(grid,random)){
      const file=createProbe(root,'sb02-'+id++);
      await holder.prepare(file);
      const holdId=await holder.hold('write',x.hold,x.gap,2);
      const db=new DatabaseSync(file);
      let outcome='ACQUIRED',duration;
      try{
        db.exec('PRAGMA busy_timeout='+x.busy);check(db,'busy_timeout',x.busy);
        const t=ms();
        try { db.exec('BEGIN IMMEDIATE');db.exec('UPDATE probe SET v=zeroblob(40) WHERE id=1');db.exec('COMMIT'); }
        catch(e){
          try{db.exec('ROLLBACK')}catch{}
          if(!/busy|locked/i.test(String(e.message)))throw e;
          outcome='SQLITE_BUSY';
        }
        duration=elapsed(t);
      }finally{db.close();}
      const reacquire=await holder.done(holdId);
      samples.push({...x,outcome,wall_ms:duration,holder_reacquire:reacquire});
    }
  }finally{await holder.close();}
  assert.equal(samples.length,360);
  return {grid_cases:36,repeats_per_cell:10,total:360,all_call_wall:stats(samples.map(x=>x.wall_ms)),
    actual_per_trial:samples,external_holder_does_not_define_ingress_busy_timeout:true};
}
async function sb03(root) {
  const cases=[],holder=await makeHolder(root);
  try {
    for(const spill of ['ON','OFF'])for(const hold of [0,10,50])for(let trial=0;trial<LONG_SAMPLE;trial++){
      const file=createProbe(root,'sb03-'+spill+'-'+hold+'-'+trial);
      await holder.prepare(file);
      const h=await holder.hold('read',hold,0,1);
      const db=new DatabaseSync(file);
      let begin_ms=null,commit_ms=null,write_ms=null,outcome='COMMITTED';
      let failed_at=null,write_max_ms=null,measured_connection;
      try {
        measured_connection=configureProbe(db,{cache:-64,spill,busy:25});
        const insert=db.prepare('INSERT OR REPLACE INTO probe VALUES (?,?)');
        const content=Buffer.alloc(4096,42);
        const insertTimes=[];
        let phase='BEGIN';
        try{
          const t=ms();db.exec('BEGIN IMMEDIATE');begin_ms=elapsed(t);
          phase='WRITE';const w=ms();
          for(let i=1;i<=128;i++){
            const tInsert=ms();insert.run(i,content);insertTimes.push(elapsed(tInsert));
          }
          write_ms=elapsed(w);
          write_max_ms=Math.max(...insertTimes);
          phase='COMMIT';const c=ms();
          try{db.exec('COMMIT');}finally{commit_ms=elapsed(c);}
        }catch(e){
          try{db.exec('ROLLBACK')}catch{}
          if(!/busy|locked/i.test(String(e.message)))throw e;
          outcome='SQLITE_BUSY';failed_at=phase;
        }
      }finally{db.close();}
      await holder.done(h);
      cases.push({spill,hold,trial,begin_ms,write_ms,write_max_ms,
        commit_ms,outcome,failed_at,synthetic_write_count:128,
        measured_connection});
    }
  }finally{await holder.close();}
  assert.equal(cases.length,60);
  const commitSamples=cases.filter(x=>x.commit_ms!==null).map(x=>x.commit_ms);
  assert.ok(commitSamples.length>0,'at least one actual COMMIT attempt');
  return {per_trial:cases,commit_wall:stats(commitSamples),
    no_assumed_single_transaction_timeout:true,
    cache_spill_trigger_or_internal_lock_site:'UNKNOWN_FROM_TIMING_ALONE',
    reader_present_at_commit:'NOT_INDEPENDENTLY_ATTESTED'};
}
async function sb04(root) {
  const cells=[],samples=[],holder=await makeHolder(root),rnd=rng(20261015);
  let lastFile=null;
  try{
    for(const cache of [-64,-2000])for(const spill of ['ON','OFF'])for(const rows of [1,8,128]){
      const nPerControl=rows===128?LONG_SAMPLE:LIGHT_SAMPLE;
      // Randomize all three controls, preserving the full Fit sample count PER control.
      const grid=shuffle([null,10,50].flatMap(reader_hold_ms=>
        Array.from({length:nPerControl},(_,trial)=>({reader_hold_ms,trial}))),rnd);
      for(const {trial,reader_hold_ms} of grid){
        const control=reader_hold_ms===null?'NO_READER':
          reader_hold_ms===10?'SHORT_READER':'LONG_READER';
        const file=createProbe(root,'sb04-'+(cache<0?-cache:cache)+'-'+spill+'-'+rows+'-'+control+'-'+trial);
        // The previous holder DB is closed by the next prepare ACK. Keep at
        // most one retired file; never unlink an actively held DB.
        await holder.prepare(file);
        if(lastFile!==null){assert.equal(path.dirname(lastFile),root);fs.unlinkSync(lastFile);}
        lastFile=file;
        let h=null;
        if(reader_hold_ms!==null)h=await holder.hold('read',reader_hold_ms,0,1);
        const db=new DatabaseSync(file);
        let outcome='COMMITTED',wall,insertTimes=[],failed_at=null;
        let measured_connection,memBefore,memAfter;
        try{
          measured_connection=configureProbe(db,{cache,spill,busy:25});
          memBefore=process.memoryUsage().rss;
          const start=ms();
          let phase='BEGIN';
          try{
            db.exec('BEGIN IMMEDIATE');
            phase='WRITE';
            const insert=db.prepare('INSERT OR REPLACE INTO probe VALUES (?,?)');
            const content=Buffer.alloc(4096,42);
            for(let i=1;i<=rows;i++){
              const t=ms();insert.run(i,content);insertTimes.push(elapsed(t));
            }
            phase='COMMIT';
            db.exec('COMMIT');
          }catch(e){
            try{db.exec('ROLLBACK')}catch{}
            if(!/busy|locked/i.test(String(e.message)))throw e;
            outcome='SQLITE_BUSY';failed_at=phase;
          }
          wall=elapsed(start);
          memAfter=process.memoryUsage().rss;
        }finally{db.close();}
        if(h!==null)await holder.done(h);
        samples.push({cache,spill,rows,trial,reader_hold_ms,control,
          measured_connection,outcome,failed_at,wall_ms:wall,
          process_rss_before_bytes:memBefore,process_rss_after_bytes:memAfter,
          insert_max_ms:insertTimes.length?Math.max(...insertTimes):null,
          insert_timings_ms:insertTimes});
      }
      cells.push({cache,spill,rows,n_per_control:nPerControl,total_n:3*nPerControl,
        controls:['NO_READER','SHORT_READER','LONG_READER']});
    }
  }finally{
    await holder.close();
    if(lastFile!==null){assert.equal(path.dirname(lastFile),root);fs.unlinkSync(lastFile);}
  }
  assert.equal(samples.length,2*2*3*(LIGHT_SAMPLE+LIGHT_SAMPLE+LONG_SAMPLE));
  for(const cell of cells){
    const subset=samples.filter(x=>x.cache===cell.cache&&x.spill===cell.spill&&x.rows===cell.rows);
    assert.equal(subset.length,cell.total_n);
    for(const type of cell.controls)
      assert.equal(subset.filter(x=>x.control===type).length,cell.n_per_control,
        'incorrect per-control cardinality: '+type);
  }
  return {cells,all_trials:samples,wall:stats(samples.map(x=>x.wall_ms)),
    tiny_cache_stress_not_ingress_latent_budget:true,
    cache_spill_site_count_not_established_by_timing_alone:true,
    reader_present_at_commit:'NOT_INDEPENDENTLY_ATTESTED'};
}
async function sb08(root) {
  const holder=await makeHolder(root),samples=[];
  try{
    for(let i=0;i<LONG_SAMPLE;i++){
      const file=createProbe(root,'sb08-'+i);
      await holder.prepare(file);
      const h=await holder.hold('write',50,0,1);
      const ingress=new DatabaseSync(file);
      const second=new DatabaseSync(file); // INTENTIONALLY negative same-loop ONLY.
      let timerFiredAt=null,outcome='ACQUIRED',wall;
      const scheduled=ms();
      const timerDone=new Promise(resolve=>setTimeout(()=>{timerFiredAt=ms();resolve();},1));
      let firedDuringSyncSqlite;
      try{
        ingress.exec('PRAGMA busy_timeout=25');second.exec('PRAGMA busy_timeout=5000');
        check(ingress,'busy_timeout',25);check(second,'busy_timeout',5000);
        const start=ms();
        try{second.exec('BEGIN IMMEDIATE');second.exec('ROLLBACK');}
        catch(e){if(!/busy|locked/i.test(String(e.message)))throw e;outcome='SQLITE_BUSY';try{second.exec('ROLLBACK')}catch{}}
        wall=elapsed(start);
        firedDuringSyncSqlite=timerFiredAt!==null;
        assert.equal(firedDuringSyncSqlite,false,'timer cannot fire during synchronous call');
      }finally{second.close();ingress.close();}
      await holder.done(h);
      await timerDone;
      const timer_elapsed_ms=Number((timerFiredAt-scheduled).toFixed(4));
      samples.push({trial:i,wall_ms:wall,second_connection_outcome:outcome,
        timer_elapsed_ms,timer_overshoot_ms:Math.max(0,timer_elapsed_ms-1),
        timer_fired_during_sync_sqlite:firedDuringSyncSqlite,
        synthetic_connections_opened:2});
    }
  }finally{await holder.close();}
  return {trials:samples,wait:stats(samples.map(x=>x.wall_ms)),
    timer_lag:stats(samples.map(x=>x.timer_overshoot_ms)),
    intended_ingress_connection_count:'NOT_MEASURED_BY_NEGATIVE_CONTROL',
    negative_simulated_same_loop_connections:2,
    separate_external_holder_not_same_event_loop:true};
}
function hmac(body) { return crypto.createHmac('sha256',SECRET).update(body).digest('hex'); }
function sendUnix(socket,body,{sig=true,slow=false,hang=false}={}) {
  return new Promise((resolve,reject)=>{
    let complete=false;
    const req=http.request({socketPath:socket,path:'/synthetic',method:'POST',
      agent:false,headers:{'content-type':'application/json','x-sb-signature':sig?hmac(body):'bad'}},res=>{
      let size=0;
      res.on('data',b=>{size+=b.length;});
      res.on('end',()=>{if(complete)return;complete=true;resolve({status:res.statusCode,bytes:size});});
      res.on('error',reject);
    });
    req.on('error',reject);
    if(hang){req.write(body.subarray(0,1));return;}
    if(slow){req.write(body.subarray(0,1));setTimeout(()=>req.end(body.subarray(1)),100);}
    else req.end(body);
  });
}
function unixListen(server,sock){
  return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(sock,()=>{
    server.off('error',reject);resolve();});});
}
async function unixClose(server,connections,sock){
  for(const c of connections)c.destroy();
  await new Promise(resolve=>server.close(resolve));
  try{fs.unlinkSync(sock);}catch{}
}
async function sb09(root) {
  let authoritativeReads=0;
  const connections=new Set;
  const server=http.createServer((req,res)=>{
    let finished=false,total=0,parts=[];
    const deadline=setTimeout(()=>reply(408),25);
    function reply(status){if(finished)return;finished=true;clearTimeout(deadline);
      res.writeHead(status,{'content-type':'application/json','connection':'close'});
      res.end(JSON.stringify({synthetic:true,status}));}
    req.on('data',x=>{if(finished)return;total+=x.length;
      if(total>MI_B){parts=[];reply(413);}else parts.push(x);});
    req.on('end',()=>{
      if(finished)return;
      const body=Buffer.concat(parts);
      const received=req.headers['x-sb-signature'];
      if(typeof received!=='string'||received.length!==64||
        !crypto.timingSafeEqual(Buffer.from(received),Buffer.from(hmac(body))))return reply(401);
      try{const obj=JSON.parse(body.toString('utf8'));if(obj.kind!=='only-synthetic')return reply(422);}
      catch{return reply(422);}
      authoritativeReads++;reply(200);
    });
    req.on('aborted',()=>{clearTimeout(deadline);finished=true;});
    req.on('error',()=>{clearTimeout(deadline);finished=true;});
  });
  server.on('connection',x=>{connections.add(x);x.on('close',()=>connections.delete(x));});
  const sock=path.join(root,'sb09.sock');
  await unixListen(server,sock);
  const trials=[],small=JSON.stringify({kind:'only-synthetic'});
  const emptyPadding=Buffer.byteLength(JSON.stringify({kind:'only-synthetic',padding:''}));
  const exactlyOneMib=Buffer.from(JSON.stringify({kind:'only-synthetic',padding:'x'.repeat(MI_B-emptyPadding)}));
  assert.equal(exactlyOneMib.length,MI_B,'exact cap boundary test');
  try{
    const bodies=[Buffer.alloc(0),Buffer.from('x'),Buffer.from(small),
      exactlyOneMib,Buffer.alloc(MI_B+1,120)];
    for(const [index,body]of bodies.entries()){
      const n=index===2?LIGHT_SAMPLE:LONG_SAMPLE;
      const startReads=authoritativeReads;
      const samples=[];
      for(let trial=0;trial<n;trial++){
        const start=ms();
        const response=await sendUnix(sock,body);
        samples.push(elapsed(start));
        const accepted=index===2||index===3;
        assert.equal(response.status,index===4?413:accepted?200:422);
      }
      assert.equal(authoritativeReads-startReads,(index===2||index===3)?n:0);
      trials.push({name:'size_'+index,actual_bytes:body.length,outcome:stats(samples)});
    }
    for(const kind of ['bad-sig','slow','incomplete']){
      const before=authoritativeReads,arr=[];
      for(let i=0;i<LONG_SAMPLE;i++){
        const start=ms(),payload=Buffer.from(small);
        const response=await sendUnix(sock,payload,{sig:kind!=='bad-sig',
          slow:kind==='slow',hang:kind==='incomplete'});
        assert.equal(response.status,kind==='bad-sig'?401:408);
        arr.push(elapsed(start));
      }
      assert.equal(authoritativeReads,before);
      trials.push({name:kind,samples:stats(arr)});
    }
  }finally{await unixClose(server,connections,sock);}
  return {tests:trials,synthetic_authority_reads:authoritativeReads,
    no_customer_data:true,not_chatwoot_native_status:true};
}
function httpGet(socket,endpoint,limit){
  return new Promise(resolve=>{
    let done=false,received=0;
    const start=ms();
    const req=http.request({socketPath:socket,path:endpoint,method:'GET',agent:false},res=>{
      const declared=Number(res.headers['content-length']??0);
      res.on('data',chunk=>{received+=chunk.length;});
      res.on('end',()=>finish('COMPLETE',declared));
      res.on('aborted',()=>finish('TRUNCATED',declared));
      res.on('error',()=>finish('BODY_ERROR',declared));
      res.on('close',()=>{if(!res.complete)finish('TRUNCATED',declared);});
    });
    const timer=setTimeout(()=>{finish('TIMEOUT');req.destroy();},limit);
    function finish(status,declared=0) {
      if(done)return;
      done=true;clearTimeout(timer);
      if(status==='COMPLETE'&&declared!==received)status='TRUNCATED';
      resolve({status,elapsed_ms:elapsed(start),bytes:received});
    }
    req.on('error',e=>finish(e.message==='SB_REST_DEADLINE'?'TIMEOUT':'CONNECT_OR_READ_ERROR'));
    req.end();
  });
}
function pendingConnect(limit){
  return new Promise(resolve=>{
    const start=ms();
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort('SB_REST_DEADLINE'),limit);
    controller.signal.addEventListener('abort',()=>{
      clearTimeout(timer);resolve({status:'TIMEOUT',elapsed_ms:elapsed(start),
        model:'pending_connect_stub_only'});
    },{once:true});
    // Intentionally never establishes a real OS connection.
  });
}
async function sb10(root) {
  const connections=new Set();
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://synthetic.invalid');
    if(url.pathname==='/no-headers'){return;}
    if(url.pathname==='/body-stall'){
      res.writeHead(200,{'content-length':'1000'});
      res.write('part');return;
    }
    if(url.pathname==='/body-truncate'){
      res.writeHead(200,{'content-length':'1000'});
      res.write('part');setTimeout(()=>res.destroy(),10);return;
    }
    if(url.pathname==='/ok'){
      const delay=Number(url.searchParams.get('ms'));
      if(![0,6,25,100].includes(delay)){res.writeHead(422);res.end();return;}
      setTimeout(()=>{if(res.destroyed)return;res.writeHead(200,
        {'content-length':'2'});res.end('{}');},delay);
      return;
    }
    res.writeHead(404);res.end();
  });
  server.on('connection',x=>{connections.add(x);x.on('close',()=>connections.delete(x));});
  const sock=path.join(root,'sb10.sock');await unixListen(server,sock);
  const groups=[],random=rng(20261016);
  try{
    for(const [name,endpoint,expected] of [
      ['pending-connect-stub',null,'TIMEOUT'],
      ['uds-connect-error','/nonexistent','CONNECT_OR_READ_ERROR'],
      ['no-headers','/no-headers','TIMEOUT'],
      ['mid-body-stall','/body-stall','TIMEOUT'],
      ['mid-body-truncate','/body-truncate','INCOMPLETE_BODY']]){
      const raw=[];
      for(let i=0;i<LONG_SAMPLE;i++){
        const result=name==='pending-connect-stub'?await pendingConnect(25):
          name==='uds-connect-error'?await httpGet(path.join(root,'absent.sock'),endpoint,25):
          await httpGet(sock,endpoint,25);
        if(expected==='INCOMPLETE_BODY')assert.ok(['TRUNCATED','BODY_ERROR'].includes(result.status));
        else assert.equal(result.status,expected);
        raw.push(result.elapsed_ms);
      }
      groups.push({name,results:stats(raw),safety_bound:'ENFORCED_TIMEOUT_PLUS_UNPROVEN_TIMER_OVERSHOOT'});
    }
    for(const delay of shuffle([0,6,25,100],random)){
      const sample=[];
      for(let i=0;i<LIGHT_SAMPLE;i++){
        const r=await httpGet(sock,'/ok?ms='+delay,150);
        assert.equal(r.status,'COMPLETE');sample.push(r.elapsed_ms);
      }
      groups.push({name:'mock-'+delay+'ms',samples:stats(sample),
        provider_Rseq:'UNKNOWN_NOT_MEASURED'});
    }
    for(const N of [1,4]){
      let inflight=0,admitted=0,rejected=0;
      const arrivals=[];
      async function attempt(){
        if(inflight>=N){rejected++;return 'DENIED';}
        inflight++;admitted++;
        try{return (await httpGet(sock,'/ok?ms=6',150)).status;}
        finally{inflight--;}
      }
      for(let wave=0;wave<10;wave++){
        for(let batch=0;batch<4;batch++){
          const start=ms();
          const results=await Promise.all(Array.from({length:8},()=>attempt()));
          assert.equal(results.length,8);
          assert.ok(results.filter(x=>x==='COMPLETE').length<=N);
          arrivals.push({wave,batch,elapsed_ms:elapsed(start),
            admitted:results.filter(x=>x==='COMPLETE').length,
            denied:results.filter(x=>x==='DENIED').length});
        }
      }
      assert.equal(inflight,0);
      assert.equal(admitted+rejected,320);
      groups.push({N,admitted,rejected,arrivals,
        bounded_generator_only:true,no_unbounded_replenishment_proof:true});
    }
  }finally{await unixClose(server,connections,sock);}
  return {groups,real_Chatwoot_Rseq:'UNKNOWN',timer_overshoot:'UNBOUNDED_UNTIL_MEASURED',
    real_native_http_failure_effects:'NOT_TESTED',mock_only:true};
}
async function runOne(group,scratch) {
  assertEnvironment(scratch);
  const root=fs.mkdtempSync(path.join(scratch,'bp-c6-sb-a-'));
  fs.chmodSync(root,0o700);
  const loop=monitorEventLoopDelay({resolution:10});
  const before=process.cpuUsage(),started=ms();
  loop.enable();
  try{
    const result=await ({
      'SB-00':sb00,'SB-01':sb01,'SB-02':sb02,'SB-03':sb03,
      'SB-04':sb04,'SB-08':sb08,'SB-09':sb09,'SB-10':sb10,
      'SB-11':sb11
    }[group])(root);
    loop.disable();
    const cpu=process.cpuUsage(before);
    return {id:group,status:'PASS_SYNTHETIC_COMPONENT_OR_SURROGATE_ONLY',
      seed:SEED,elapsed_ms:elapsed(started),cpu_us:cpu,
      event_loop_delay_mean_ms:Number((loop.mean/1e6).toFixed(4)),
      event_loop_delay_max_ms:Number((loop.max/1e6).toFixed(4)),result};
  }finally{
    loop.disable();
    // Only remove this newly generated private synthetic directory.
    assert.equal(path.dirname(root),scratch);
    assert.match(path.basename(root),/^bp-c6-sb-a-/);
    fs.rmSync(root,{recursive:true,force:false});
  }
}
function groupProcess(group,scratch) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--no-warnings',SELF,'--group='+group,'--scratch='+scratch],
      {detached:true,stdio:['ignore','pipe','pipe'],
       env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',TMPDIR:scratch,NODE_OPTIONS:''}});
    ACTIVE_GROUP_PID=child.pid;
    let stdout='',stderr='',timedOut=false;
    let done=false;
    const cap=CAPS[group]*1000;
    const killer=setTimeout(()=>{timedOut=true;try{process.kill(-child.pid,'SIGTERM')}catch{}
      setTimeout(()=>{if(!done)try{process.kill(-child.pid,'SIGKILL')}catch{}},1000).unref();},cap);
    function collect(which,b){
      const x=String(b);
      if(which==='out'){stdout+=x;if(stdout.length>2_000_000)try{process.kill(-child.pid,'SIGTERM')}catch{}}
      else{stderr+=x;if(stderr.length>100_000)try{process.kill(-child.pid,'SIGTERM')}catch{}}
    }
    child.stdout.on('data',b=>collect('out',b));
    child.stderr.on('data',b=>collect('err',b));
    child.once('error',e=>{if(done)return;done=true;clearTimeout(killer);ACTIVE_GROUP_PID=null;reject(e);});
    child.once('close',(code,signal)=>{
      if(done)return;done=true;clearTimeout(killer);ACTIVE_GROUP_PID=null;
      if(timedOut||code!==0||signal!==null) {
        reject(new Error('SB_GROUP_FAILED_'+group+'_EXIT_'+code+'_SIGNAL_'+signal+
          '_ERRCODE_'+(/SB_A_HALT_[A-Z0-9_]+/.exec(stderr)?.[0]??'UNKNOWN')));
        return;
      }
      try{
        const data=JSON.parse(stdout.trim());
        assert.equal(data.id,group);assert.equal(data.status,'PASS_SYNTHETIC_COMPONENT_OR_SURROGATE_ONLY');
        resolve(data);
      }catch(e){reject(new Error('SB_GROUP_RESULT_INVALID_'+group));}
    });
  });
}
async function runAll(scratch) {
  assertEnvironment(scratch);
  const started=ms(),all=[];
  let interrupted=false;
  function signal(){
    interrupted=true;
    if(ACTIVE_GROUP_PID!==null)try{process.kill(-ACTIVE_GROUP_PID,'SIGTERM')}catch{}
    process.stderr.write('SB_A_HALT_OWNER_SCOPE_EXTERNAL_TERMINATION\n');
    process.exitCode=143;
  }
  process.once('SIGTERM',signal);
  for(const group of ORDER){
    if(interrupted)fail('EXTERNAL_TERMINATION');
    if(elapsed(started)+CAPS[group]*1000>=1_200_000)
      fail('PHASE_A_REMAINING_WALL_RESERVE');
    // groupProcess has its own hard timeout and separate child process group.
    const result=await groupProcess(group,scratch);
    all.push(result);
  }
  process.removeListener('SIGTERM',signal);
  return {schema:'babypark.c6.stage-b.phase-a.synthetic/1',
    source_basis:'PR128:565d8de08fbd8e85598e554cb91e59dfa4f8c1a4',
    phase:'A',status:'PASS_SYNTHETIC_EXECUTION_ONLY',seed:SEED,
    groups:all,total_elapsed_ms:elapsed(started),
    remaining_gates:['production_Rseq_native','K_total','target_peak_envelope',
      'B2_full_restore','S2_claim_public_send_HUMAN','single_ingress_atomic_production_code']};
}
function parseArgs() {
  const args=process.argv.slice(2);
  if(args.length!==2)fail('ARGUMENT_COUNT');
  const parts=Object.fromEntries(args.map(x=>{
    const i=x.indexOf('=');if(!x.startsWith('--')||i<3)fail('ARGUMENT_SHAPE');
    return [x.slice(2,i),x.slice(i+1)];
  }));
  if(Object.keys(parts).length!==2 || !parts.scratch ||
      !(parts.phase==='A' || ORDER.includes(parts.group)) ||
      ((parts.phase==='A')===(typeof parts.group==='string')))fail('ARGUMENT_DENIED');
  return parts;
}
let ACTIVE_GROUP_ID='UNPARSED';
async function main(){
  const args=parseArgs();
  ACTIVE_GROUP_ID=args.group??'PHASE_A';
  const output=args.phase==='A'?await runAll(args.scratch):await runOne(args.group,args.scratch);
  process.stdout.write(JSON.stringify(output)+'\n');
}
await main().catch(e=>{
  // Synthetic diagnostics only: no customer content, no DB/HTTP response dumps.
  const cause=/SB_A_HALT_[A-Z0-9_]+/.exec(String(e?.message))?.[0] ??
    /SB_[A-Z0-9_]+/.exec(String(e?.message))?.[0] ?? 'UNCLASSIFIED';
  process.stderr.write('SB_A_FIXTURE_HALT:GROUP_'+ACTIVE_GROUP_ID.replace(/[^A-Z0-9]/g,'_')+
    ':CAUSE_'+cause+'\n');
  process.exitCode=1;
});
