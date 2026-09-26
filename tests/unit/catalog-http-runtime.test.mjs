import assert from 'node:assert/strict'; import test from 'node:test';
import {openCatalogHttpRuntime} from '../../src/catalog/http/runtime.mjs';

test('partial startup failure closes every earlier durable handle',()=>{
  const closed=[];
  class Identity { static openExisting(){ return { close(){ closed.push('identity') } } } }
  class Replay { static openExisting(){ throw Object.assign(new Error('missing'),{code:'INGEST_REPLAY_MISSING'}) } }
  assert.throws(()=>openCatalogHttpRuntime({identityPath:'i',replayPath:'r',storageDir:'s'}, { implementations:{IdentityStore:Identity,ReplayStore:Replay} }), error=>error.code==='INGEST_REPLAY_MISSING');
  assert.deepEqual(closed,['identity']);
});
