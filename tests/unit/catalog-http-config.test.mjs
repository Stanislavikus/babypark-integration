import assert from 'node:assert/strict'; import test from 'node:test';
import { parseBp1Keys,parseCatalogHttpConfig } from '../../src/catalog/http/config.mjs';
test('catalog config freezes safe defaults and multiple keys',()=>{const c=parseCatalogHttpConfig({CATALOG_BP1_AUDIENCE:'a',CATALOG_BP1_KEYS_JSON:JSON.stringify({kid1:'x'.repeat(32),kid2:'y'.repeat(32)}),CATALOG_IDENTITY_PATH:'i',CATALOG_REPLAY_PATH:'r',CATALOG_STORAGE_DIR:'s'});assert.equal(c.host,'127.0.0.1');assert.equal(c.ingestEnabled,false);assert.equal(c.maxAgeSec,300);assert.equal(c.secrets.size,2)});
test('catalog key config rejects invalid and weak entries',()=>{for(const value of ['', '{}','[]','{"bad kid":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}','{"kid":7}','{"kid":"short"}']) assert.throws(()=>parseBp1Keys(value));});
