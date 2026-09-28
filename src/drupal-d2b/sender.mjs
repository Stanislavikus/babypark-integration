import crypto from 'node:crypto';
import { acquireSenderLock } from './spool-lock.mjs';
import { createRunState, readRunState, updateRunState, validateRunState, writeRunState } from './run-state.mjs';
import { readVerifiedChunk, verifySpool } from './spool.mjs';
import { D2bClient } from './client.mjs';
import { fail } from './errors.mjs';

const LAYERS = ['taxonomy','content','commercial','stock'];
const hash = body => crypto.createHash('sha256').update(body).digest('hex');
const exactKeys = (obj, keys) => obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).sort().join() === [...keys].sort().join();
function validateStateEnvelope(value) {
  const keys = ['schema','state','accepting_ingest','blockers','current_generation','source_epoch','published_identity_revision','accepted_run','layers'];
  if (!exactKeys(value, keys) || value.schema !== 'bp.catalog.state/1' || !['BOOTSTRAP','CURRENT'].includes(value.state) || typeof value.accepting_ingest !== 'boolean' || !Array.isArray(value.blockers) || !exactKeys(value.layers, LAYERS) || LAYERS.some(x => !exactKeys(value.layers[x], ['accepted_watermark','need_full','need_reconcile']))) fail('D2B_CATALOG_STATE_INVALID', 'Catalog /state response is invalid');
  return value;
}
function isBootstrap(state) { return state.state === 'BOOTSTRAP' && state.accepting_ingest === true && state.blockers.length === 0 && state.current_generation === null && state.accepted_run === null && state.source_epoch === null && state.published_identity_revision === null && LAYERS.every(x => state.layers[x].accepted_watermark === null); }
function assertAccepted(state, run, spool) {
  const finalSeq = run.ordered_chunks.length + 1;
  if (state.state !== 'CURRENT' || state.current_generation !== run.final_ack?.generation_id || state.source_epoch !== spool.manifest.source_epoch || state.accepted_run?.run_id !== run.run_id || state.accepted_run?.run_digest !== run.run_digest || state.accepted_run?.final_seq !== finalSeq || LAYERS.some(x => state.layers[x].accepted_watermark !== spool.manifest.snapshot_watermark)) fail('D2B_POST_ACK_STATE_MISMATCH', 'Authoritative state does not bind the accepted run');
}
function assertResumeState(state, run) { if (isBootstrap(state)) return 'SEND'; if (state.state === 'CURRENT' && state.accepted_run?.run_id === run.run_id && state.accepted_run?.run_digest === run.run_digest) return 'ACCEPTED'; fail('D2B_RESUME_STATE_CONFLICT', 'Catalog state contradicts durable run state'); }
function ageGate(watermark, nowMs) { const nowUs = BigInt(nowMs) * 1000n; const age = nowUs - BigInt(watermark); if (age < 0n) fail('D2B_SPOOL_FROM_FUTURE', 'Spool watermark is in the future'); if (age > 1_800_000_000n) fail('D2B_UNSENT_SPOOL_TOO_OLD', 'Unsent spool exceeds the 30-minute first-attempt limit'); }
function ackStaged(response, runId, seq, digest) { const body=response.body; if (response.status!==200 || !exactKeys(body,['schema','status','ack']) || body.schema!=='bp.catalog.ingest-response/1' || body.status!=='STAGED' || !exactKeys(body.ack,['staged','run_id','layer','seq','body_sha256']) || body.ack.staged!==true || body.ack.run_id!==runId || body.ack.layer!=='full' || body.ack.seq!==seq || body.ack.body_sha256!==digest) fail('D2B_STAGED_ACK_INVALID','Invalid STAGED acknowledgement'); }
function ackFinal(response, run, spool) { const b=response.body; const keys=['accepted','generation_id','layer','run_id','run_digest','source_watermark']; if (response.status!==200 || !exactKeys(b,['schema','status','ack']) || b.schema!=='bp.catalog.ingest-response/1' || b.status!=='ACKED' || !exactKeys(b.ack,keys) || b.ack.accepted!==true || b.ack.layer!=='full' || b.ack.run_id!==run.run_id || b.ack.run_digest!==run.run_digest || b.ack.source_watermark!==spool.manifest.snapshot_watermark || !/^[A-Za-z0-9_-]{1,64}$/.test(b.ack.generation_id)) fail('D2B_FINAL_ACK_INVALID','Invalid final acknowledgement'); return b.ack; }
function retryable(response, final) { if (response.status===202 && response.body?.status==='PENDING' && response.body?.action==='retry_same') return true; if (response.body?.code==='TEMPORARILY_BUSY' && response.body?.action==='retry_same') return true; if (final && ['BACKUP_REQUIRED','RUN_FINALIZING'].includes(response.body?.code) && response.body?.action==='retry_final') return true; return false; }
async function attempt(config, operation, sleep) { let last; for(let i=0;i<config.maxAttempts;i++){ try { const r=await operation(); if(!retryable(r, operation.final)) return r; last=r; if(i+1<config.maxAttempts) await sleep((r.retryAfter ?? Math.min(2**i,30))*1000); } catch(e){ if(!e.retryable) throw e; last=e; if(i+1<config.maxAttempts) await sleep(Math.min(2**i,30)*1000); } } fail('D2B_RETRY_BUDGET_EXHAUSTED','Retry budget exhausted; invoke again to resume exact run',{retryable:true,details:{last:last?.code??last?.status}}); }

export async function sendSpool({ spoolPath, config, verification = {}, client = null, now = () => new Date(), sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  const spool = verifySpool(spoolPath, verification); const lock = acquireSenderLock(config.stateDir, spool.spoolManifestSha256, now);
  try {
    let run = readRunState(config.stateDir, spool); const http = client ?? new D2bClient(config);
    const stateResponse = await attempt(config, () => http.state(), sleep); if (stateResponse.status !== 200) fail('D2B_STATE_HTTP_FAILED', 'Authenticated /state request failed');
    const catalogState = validateStateEnvelope(stateResponse.body);
    if (!run) { if (!isBootstrap(catalogState)) fail('D2B_FIRST_FULL_AUTHORITY_INVALID','New first FULL requires exact accepting BOOTSTRAP authority'); run=createRunState(spool,config.kid,{now}); writeRunState(config.stateDir,run); }
    else { validateRunState(run,spool); if(run.kid!==config.kid) fail('D2B_KID_CHANGED','In-progress run requires its original KID'); const disposition=assertResumeState(catalogState,run); }
    if(run.transport_state==='STATE_CONFIRMED') return { status:'STATE_CONFIRMED',run_id:run.run_id };
    if(run.transport_state==='ACKED'){ assertAccepted(catalogState,run,spool); run=updateRunState(config.stateDir,run,{transport_state:'STATE_CONFIRMED',post_ack_state:catalogState},now); return {status:'STATE_CONFIRMED',run_id:run.run_id}; }
    const bodies = [Buffer.from(run.run_header_base64,'base64'), ...run.ordered_chunks, Buffer.from(run.trailer_base64,'base64')];
    for(let seq=run.last_durably_acked_sequence+1;seq<=run.ordered_chunks.length+1;seq++){
      const final=seq===run.ordered_chunks.length+1; let body;
      if(seq===0){ if(run.first_seq0_attempt_started_at===null){ ageGate(spool.manifest.snapshot_watermark,now().getTime()); run=updateRunState(config.stateDir,run,{first_seq0_attempt_started_at:now().toISOString()},now); } body=bodies[0]; }
      else if(final) body=bodies.at(-1); else body=readVerifiedChunk(spool,run.ordered_chunks[seq-1]);
      const operation=()=>http.full(run.run_id,seq,final,body); operation.final=final; const response=await attempt(config,operation,sleep);
      if(final){ const ack=ackFinal(response,run,spool); run=updateRunState(config.stateDir,run,{transport_state:'ACKED',final_ack:ack,last_durably_acked_sequence:seq},now); }
      else { ackStaged(response,run.run_id,seq,hash(body)); run=updateRunState(config.stateDir,run,{last_durably_acked_sequence:seq},now); }
    }
    const post=await attempt(config,()=>http.state(),sleep); if(post.status!==200) fail('D2B_STATE_HTTP_FAILED','Post-ACK /state request failed'); const confirmed=validateStateEnvelope(post.body); assertAccepted(confirmed,run,spool); run=updateRunState(config.stateDir,run,{transport_state:'STATE_CONFIRMED',post_ack_state:confirmed},now); return {status:'STATE_CONFIRMED',run_id:run.run_id,generation_id:run.final_ack.generation_id};
  } finally { lock.release(); }
}
