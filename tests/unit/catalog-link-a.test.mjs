import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createD2bFixture } from '../helpers/drupal-d2b-sender-fixture.mjs';
import { verifyFrozenSpoolArtifact } from '../../src/drupal-d2b/spool.mjs';
import { stageFrozenSpool } from '../../src/catalog/link-a/staging.mjs';
import { linkADimensionId, linkAImageId, MAX_MISMATCH_DETAILS, FTS_PROBE_LIMITS } from '../../src/catalog/link-a/verifier.mjs';
import { CatalogGenerationBuilder, withExactCatalogGeneration } from '../../src/catalog/sqlite/generation.mjs';

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
