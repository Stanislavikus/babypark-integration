import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createD2bFixture } from '../helpers/drupal-d2b-sender-fixture.mjs';
import { verifyFrozenSpoolArtifact } from '../../src/drupal-d2b/spool.mjs';
import { stageFrozenSpool } from '../../src/catalog/link-a/staging.mjs';
import { linkADimensionId, linkAImageId, MAX_MISMATCH_DETAILS, FTS_PROBE_LIMITS, sha256FileBounded, verifyLinkA } from '../../src/catalog/link-a/verifier.mjs';
import { CatalogGenerationBuilder, withExactCatalogGeneration } from '../../src/catalog/sqlite/generation.mjs';
import { buildAnomalyReport } from '../../src/catalog/anomaly/report.mjs';
import { canonicalJson } from '../../src/catalog/ingest/replay-store.mjs';
import { createE6aHarness, phase0Records, phase1Records } from '../helpers/catalog-e6a1-fixture.mjs';

const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function writePrivate(file,value){fs.writeFileSync(file,value,{mode:0o600});}
function createAcceptedLinkAFixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'link-a-accepted-'));const ready=path.join(root,'accepted.ready');fs.mkdirSync(ready,{mode:0o700});
  const phase0=phase0Records(),phase1=phase1Records();delete phase1[2].variants[0].offer;delete phase1[2].variants[0].attributes;delete phase1[2].variants[0].stock;delete phase1[1].attributes;delete phase1[1].images;delete phase1[1].categories;
  const collision='a'.repeat(64),policy='b'.repeat(64),watermark='9',sourceEpoch='epoch-e6a';
  const anomaly=buildAnomalyReport({provider:'drupal',sourceEpoch,snapshotWatermark:watermark,detector:{namespace:'fixture',version:1},collisionConfigSha256:collision,anomalyPublicationPolicySha256:policy,observations:[]});
  const evidence={'preflight.json':{collision_config_sha256:collision,anomaly_publication_policy_sha256:policy},'collision-report.json':{},'anomaly-report.json':anomaly,'source-acceptance.json':{schema:'bp.drupal.source-acceptance/1'}};
  for(const [name,value] of Object.entries(evidence))writePrivate(path.join(ready,name),`${JSON.stringify(value,null,2)}\n`);
  const chunks=[phase0,phase1].map((rows,index)=>{const bytes=Buffer.from(canonicalJson({rows}));const filename=`phase${index}-${String(1).padStart(6,'0')}.json`;writePrivate(path.join(ready,filename),bytes);return{filename,phase:index,rows:rows.length,bytes:bytes.length,sha256:hash(bytes)};});
  const manifest={schema:'bp.drupal-exporter.spool/3',version:3,provider:'drupal',source_epoch:sourceEpoch,snapshot_watermark:watermark,producer_commit:'e'.repeat(40),producer_release_provenance_sha256:'f'.repeat(64),source_acceptance_sha256:hash(fs.readFileSync(path.join(ready,'source-acceptance.json'))),collision_config_sha256:collision,anomaly_publication_policy_sha256:policy,anomaly_report_sha256:hash(fs.readFileSync(path.join(ready,'anomaly-report.json'))),blocker_count:0,phase_row_counts:{phase0:chunks[0].rows,phase1:chunks[1].rows},chunk_count:2,chunks,total_canonical_rows:chunks.reduce((n,c)=>n+c.rows,0)};
  writePrivate(path.join(ready,'manifest.json'),`${JSON.stringify(manifest,null,2)}\n`);const spoolSha=hash(fs.readFileSync(path.join(ready,'manifest.json')));
  const authority={schema:'bp.catalog.publication-authority/1',spool_schema:manifest.schema,spool_manifest_sha256:spoolSha,anomaly_report_sha256:manifest.anomaly_report_sha256,config_digests:{'drupal-anomaly-publication-policy':policy,'drupal-collisions':collision},full_record_contract_version:2,record_validator_version:3,sku_normalizer_version:1,native_identity_scheme:'bp.drupal.native-identity/1',producer_commit:manifest.producer_commit,producer_release_provenance_sha256:manifest.producer_release_provenance_sha256};
  const harness=createE6aHarness({generationId:'link-a-generation',runId:'link-a-run',headerSchema:'bp.catalog.run-header/2',publicationAuthority:authority,sourceEpoch,watermark});harness.apply(structuredClone(phase0),1);harness.apply(structuredClone(phase1),2);const finished=harness.finish(3);harness.reader.close();
  const staging=path.join(root,'staging');const staged=stageFrozenSpool({sourcePath:ready,stagingRoot:staging});const work=path.join(root,'work');fs.mkdirSync(work,{mode:0o700});
  return{root,ready,staged,work,harness,finished,acceptedRun:{run_id:'link-a-run',run_digest:finished.digest,final_seq:3},close(){try{harness.store.close();}catch{}try{harness.mutex.close();}catch{}try{harness.identity.close();}catch{}fs.rmSync(root,{recursive:true,force:true});}};
}

test('host-neutral verifier needs no exporter release or config tree', t => {
  const fixture=createD2bFixture();t.after(()=>fs.rmSync(fixture.root,{recursive:true,force:true}));
  fs.rmSync(fixture.release,{recursive:true});
  const verified=verifyFrozenSpoolArtifact(fixture.spool);
  assert.equal(verified.manifest.schema,'bp.drupal-exporter.spool/3');
  assert.deepEqual(verified.chunks,verified.manifest.chunks);
  assert.equal(verified.sourceAcceptance.schema,'bp.drupal.source-acceptance/1');
});

test('complete spool staging is private, exact, immutable-by-name and non-reusing', t => {
  const fixture=createD2bFixture();t.after(()=>fs.rmSync(fixture.root,{recursive:true,force:true}));
  const root=path.join(fixture.root,'staging');const staged=stageFrozenSpool({sourcePath:fixture.spool,stagingRoot:root});
  assert.match(staged.path,/\.staged$/);assert.equal(fs.statSync(root).mode&0o777,0o700);assert.equal(fs.statSync(staged.path).mode&0o777,0o700);
  assert.deepEqual(fs.readdirSync(staged.path).sort(),fs.readdirSync(fixture.spool).sort());
  for(const name of fs.readdirSync(staged.path))assert.equal(fs.statSync(path.join(staged.path,name)).mode&0o777,0o600);
  assert.throws(()=>stageFrozenSpool({sourcePath:fixture.spool,stagingRoot:root}),error=>error.code==='LINK_A_STAGING_EXISTS');
});

test('independent Link A ID formulas have frozen golden vectors', () => {
  assert.equal(linkADimensionId('brand','drupal','42'),'brand_cff7bfb8163c34618fdd47e8511727f6');
  assert.equal(linkADimensionId('category','drupal','123'),'cat_88975c3a1d402d73c5492804decba552');
  assert.equal(linkAImageId('drupal','product:7','image:9'),'img_a469248ad72411fc5d2a1ba92f503699');
  assert.equal(MAX_MISMATCH_DETAILS,200);assert.deepEqual(FTS_PROBE_LIMITS,{exact_sku:16,text:16,category:16});
});

test('exact generation callback opens only the named ready standalone database read-only', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'link-a-generation-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const builder=CatalogGenerationBuilder.create({storageDir:dir,generationId:'expected',sourceEpoch:'epoch',identityRevision:0});builder.seal();
  const id=withExactCatalogGeneration(dir,'expected',(db,meta)=>{assert.equal(meta.generation_id,'expected');assert.throws(()=>db.exec("INSERT INTO brands VALUES('x','x','{}')"));return meta.generation_id;});
  assert.equal(id,'expected');assert.throws(()=>withExactCatalogGeneration(dir,'other',()=>{}),error=>error.code==='CATALOG_GENERATION_MISSING');
});

test('exact spool plus real accepted v2 FULL generation passes Link A',t=>{const f=createAcceptedLinkAFixture();t.after(()=>f.close());const report=verifyLinkA({stagedSpoolPath:f.staged.path,workRoot:f.work,catalogStorageDir:f.harness.catalogDir,identityPath:f.harness.identity.filePath,expectedGenerationId:'link-a-generation',acceptedRun:f.acceptedRun});assert.equal(report.status,'PASS');assert.equal(report.mismatch_count,0);assert.equal(report.fts.status,'COMPLETE');assert.ok(report.fts.probes.some(probe=>probe.source==='brand'));});

test('Link A FULL authority expects NULL run source_watermark and layer watermarks bind spool',t=>{const f=createAcceptedLinkAFixture();t.after(()=>f.close());withExactCatalogGeneration(f.harness.catalogDir,'link-a-generation',db=>{const run=db.prepare('SELECT layer,run_kind,status,source_watermark FROM ingest_runs WHERE run_id=?').get('link-a-run');assert.equal(run.layer,'full');assert.equal(run.run_kind,'full');assert.equal(run.status,'ACCEPTED');assert.equal(run.source_watermark,null);for(const row of db.prepare('SELECT accepted_watermark FROM sync_state').all())assert.equal(row.accepted_watermark,'9');});});

test('Link A work root rejects CURRENT PREVIOUS generation identity catalog and spool before writing',t=>{const f=createAcceptedLinkAFixture();t.after(()=>f.close());const current=path.join(f.harness.catalogDir,'CURRENT'),previous=path.join(f.harness.catalogDir,'PREVIOUS'),generation=path.join(f.harness.catalogDir,'catalog.link-a-generation.sqlite'),identity=f.harness.identity.filePath;writePrivate(previous,'sentinel\n');const evidence=new Map([current,previous,generation,identity].map(file=>[file,fs.readFileSync(file)]));for(const workRoot of [current,previous,generation,identity,f.harness.catalogDir,path.dirname(identity),f.staged.path])assert.throws(()=>verifyLinkA({stagedSpoolPath:f.staged.path,workRoot,catalogStorageDir:f.harness.catalogDir,identityPath:identity,expectedGenerationId:'link-a-generation',acceptedRun:f.acceptedRun}),error=>['LINK_A_WORK_ROOT_INVALID','LINK_A_WORK_ROOT_AUTHORITY'].includes(error.code));for(const [file,bytes] of evidence)assert.deepEqual(fs.readFileSync(file),bytes);});

test('Link A has no caller-selectable report path escape',t=>{const f=createAcceptedLinkAFixture();t.after(()=>f.close());const current=path.join(f.harness.catalogDir,'CURRENT'),before=fs.readFileSync(current);const report=verifyLinkA({stagedSpoolPath:f.staged.path,workRoot:f.work,catalogStorageDir:f.harness.catalogDir,identityPath:f.harness.identity.filePath,expectedGenerationId:'link-a-generation',acceptedRun:f.acceptedRun,reportPath:current});assert.equal(report.status,'PASS');assert.deepEqual(fs.readFileSync(current),before);assert.ok(fs.existsSync(path.join(f.work,'link-a-report.json')));});

test('bounded SQLite evidence hashing never requests a whole large file buffer',t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'link-a-hash-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'large');const fd=fs.openSync(file,'w');fs.ftruncateSync(fd,12*1024*1024);fs.closeSync(fd);let largest=0,calls=0;const actual=sha256FileBounded(file,{bufferBytes:64*1024,read:(...args)=>{largest=Math.max(largest,args[3]);calls++;return fs.readSync(...args);}});assert.equal(actual,hash(fs.readFileSync(file)));assert.equal(largest,64*1024);assert.ok(calls>100);});

test('wrong accepted run identity fails without mutating authority',t=>{const f=createAcceptedLinkAFixture();t.after(()=>f.close());const current=fs.readFileSync(path.join(f.harness.catalogDir,'CURRENT')),identity=sha256FileBounded(f.harness.identity.filePath);const report=verifyLinkA({stagedSpoolPath:f.staged.path,workRoot:f.work,catalogStorageDir:f.harness.catalogDir,identityPath:f.harness.identity.filePath,expectedGenerationId:'link-a-generation',acceptedRun:{...f.acceptedRun,run_digest:'0'.repeat(64)}});assert.equal(report.status,'FAIL');assert.ok(report.mismatches.some(row=>row.code==='LINK_A_ACCEPTED_RUN'));assert.deepEqual(fs.readFileSync(path.join(f.harness.catalogDir,'CURRENT')),current);assert.equal(sha256FileBounded(f.harness.identity.filePath),identity);});

for(const [name,sql] of [
  ['missing product',"DELETE FROM images WHERE product_id='prod_e6a_1'; DELETE FROM product_attributes WHERE owner_id='prod_e6a_1' OR owner_id IN(SELECT variant_id FROM variants WHERE product_id='prod_e6a_1'); DELETE FROM product_categories WHERE product_id='prod_e6a_1'; DELETE FROM product_text WHERE product_id='prod_e6a_1'; DELETE FROM store_stock WHERE variant_id IN(SELECT variant_id FROM variants WHERE product_id='prod_e6a_1'); DELETE FROM variant_offers WHERE variant_id IN(SELECT variant_id FROM variants WHERE product_id='prod_e6a_1'); UPDATE products SET default_variant_id=NULL WHERE product_id='prod_e6a_1'; DELETE FROM variants WHERE product_id='prod_e6a_1'; DELETE FROM products WHERE product_id='prod_e6a_1'"],
  ['extra product',"INSERT INTO products(product_id,kind,updated_at) VALUES('extra','SIMPLE','2026-01-01T00:00:00.000Z')"],
  ['missing variant',"DELETE FROM variants WHERE variant_id='var_e6a_1'"],
  ['extra variant',"INSERT INTO variants(variant_id,product_id,sku,sku_key,is_default,commercial_availability,updated_at) VALUES('extra-v','prod_e6a_1','EXTRA','extra',0,'IN_STOCK','2026-01-01T00:00:00.000Z')"],
  ['wrong SKU and sku_key',"UPDATE variants SET sku='WRONG',sku_key='wrong' WHERE variant_id='var_e6a_1'"],
  ['wrong default variant',"UPDATE products SET default_variant_id=NULL WHERE product_id='prod_e6a_1'"],
  ['wrong product text',"UPDATE product_text SET title='wrong' WHERE product_id='prod_e6a_1'"],
  ['wrong price',"UPDATE variant_offers SET current_minor=current_minor+1 WHERE variant_id='var_e6a_1'"],
  ['unexpected offer',"INSERT INTO variant_offers(variant_id,current_minor,currency,on_sale) VALUES('var_e6a_4',1,'UAH',0)"],
  ['missing offer',"DELETE FROM variant_offers WHERE variant_id='var_e6a_1'"],
  ['availability mismatch',"UPDATE variants SET commercial_availability='DISCONTINUED' WHERE variant_id='var_e6a_1'"],
  ['stock mismatch',"UPDATE store_stock SET quantity=99 WHERE variant_id='var_e6a_1'"],
  ['category relation mismatch',"UPDATE product_categories SET is_primary=0 WHERE product_id='prod_e6a_1'"],
  ['brand mismatch',"UPDATE brands SET name='wrong'"],
  ['product and variant attribute mismatch',"UPDATE product_attributes SET value_json='\"wrong\"'"],
  ['image mismatch',"UPDATE images SET url='https://wrong.invalid/' WHERE image_id=(SELECT image_id FROM images LIMIT 1)"],
  ['variant image binding mismatch',"UPDATE images SET variant_id=NULL WHERE variant_id IS NOT NULL"],
  ['count-only extra row',"INSERT INTO brands VALUES('extra-brand','Extra','{}')"],
  ['FTS failure',"DELETE FROM fts_words WHERE product_id='prod_e6a_1'"],
])test(`Link A rejects ${name}`,t=>{const f=createAcceptedLinkAFixture();t.after(()=>f.close());const db=new DatabaseSync(path.join(f.harness.catalogDir,'catalog.link-a-generation.sqlite'));db.exec(sql);db.close();const report=verifyLinkA({stagedSpoolPath:f.staged.path,workRoot:f.work,catalogStorageDir:f.harness.catalogDir,identityPath:f.harness.identity.filePath,expectedGenerationId:'link-a-generation',acceptedRun:f.acceptedRun});assert.equal(report.status,'FAIL');assert.ok(report.mismatch_count>0);});

for(const [name,acceptedRun] of [['wrong run_id',{run_id:'wrong'}],['wrong run_digest',{run_digest:'0'.repeat(64)}],['wrong final_seq',{final_seq:99}]])test(`Link A rejects ${name}`,t=>{const f=createAcceptedLinkAFixture();t.after(()=>f.close());const report=verifyLinkA({stagedSpoolPath:f.staged.path,workRoot:f.work,catalogStorageDir:f.harness.catalogDir,identityPath:f.harness.identity.filePath,expectedGenerationId:'link-a-generation',acceptedRun:{...f.acceptedRun,...acceptedRun}});assert.equal(report.status,'FAIL');assert.ok(report.mismatches.some(row=>row.code==='LINK_A_ACCEPTED_RUN'));});

test('Link A rejects wrong expected generation without following CURRENT',t=>{const f=createAcceptedLinkAFixture();t.after(()=>f.close());const report=verifyLinkA({stagedSpoolPath:f.staged.path,workRoot:f.work,catalogStorageDir:f.harness.catalogDir,identityPath:f.harness.identity.filePath,expectedGenerationId:'other',acceptedRun:f.acceptedRun});assert.equal(report.status,'FAIL');assert.equal(report.mismatches[0].code,'LINK_A_CURRENT_MOVED');});

test('Link A rejects wrong spool manifest publication authority',t=>{const f=createAcceptedLinkAFixture();t.after(()=>f.close());const file=path.join(f.harness.catalogDir,'catalog.link-a-generation.sqlite'),db=new DatabaseSync(file);const row=db.prepare('SELECT manifest_json FROM catalog_meta WHERE singleton=1').get(),manifest=JSON.parse(row.manifest_json);manifest.extra.publication_authority.spool_manifest_sha256='0'.repeat(64);const json=JSON.stringify(manifest);db.prepare('UPDATE catalog_meta SET manifest_json=?,manifest_sha256=? WHERE singleton=1').run(json,hash(json));db.close();const report=verifyLinkA({stagedSpoolPath:f.staged.path,workRoot:f.work,catalogStorageDir:f.harness.catalogDir,identityPath:f.harness.identity.filePath,expectedGenerationId:'link-a-generation',acceptedRun:f.acceptedRun});assert.equal(report.status,'FAIL');assert.ok(report.mismatches.some(row=>row.code==='LINK_A_AUTHORITY_MISMATCH'&&row.key==='spool_manifest_sha256'));});

test('Link A reruns from the beginning with verifier-owned work artifacts',t=>{const f=createAcceptedLinkAFixture();t.after(()=>f.close());writePrivate(path.join(f.work,'link-a-work.sqlite'),'interrupted');assert.equal(verifyLinkA({stagedSpoolPath:f.staged.path,workRoot:f.work,catalogStorageDir:f.harness.catalogDir,identityPath:f.harness.identity.filePath,expectedGenerationId:'link-a-generation',acceptedRun:f.acceptedRun}).status,'PASS');assert.equal(verifyLinkA({stagedSpoolPath:f.staged.path,workRoot:f.work,catalogStorageDir:f.harness.catalogDir,identityPath:f.harness.identity.filePath,expectedGenerationId:'link-a-generation',acceptedRun:f.acceptedRun}).status,'PASS');});
