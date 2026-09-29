import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { runExportPipeline } from '../src/export/pipeline.mjs';
import { verifyLinkB } from '../../../src/catalog/link-b/verifier.mjs';
import { createFixtureDir,writeFixture,simpleProduct,testConfig } from './helpers/fixture-builder.mjs';

const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const writePrivate=(file,bytes)=>fs.writeFileSync(file,bytes,{mode:0o600});

test('real exporter fixture spool passes independent Link B',async t=>{const sourceDir=createFixtureDir('link-b-exporter-');const config=testConfig();t.after(()=>{fs.rmSync(sourceDir,{recursive:true,force:true});fs.rmSync(path.dirname(config.spoolRoot),{recursive:true,force:true});});writeFixture(sourceDir,simpleProduct({nid:31,model:'INTEGRATION-31'}));fs.writeFileSync(path.join(sourceDir,'source-currency.json'),JSON.stringify(config.sourceCurrency));fs.mkdirSync(config.spoolRoot,{recursive:true});const result=await runExportPipeline({config,mode:'spool',fixtureSourceDir:sourceDir,skipFilesystemChecks:true});assert.equal(result.ok,true);const ready=result.spool.ready_path,watermark='123',manifest=JSON.parse(fs.readFileSync(path.join(ready,'manifest.json'))),source=JSON.parse(fs.readFileSync(path.join(ready,'source-acceptance.json'))),anomaly=JSON.parse(fs.readFileSync(path.join(ready,'anomaly-report.json')));manifest.snapshot_watermark=source.snapshot_watermark=anomaly.snapshot_watermark=watermark;const sourceBytes=Buffer.from(`${JSON.stringify(source,null,2)}\n`),anomalyBytes=Buffer.from(`${JSON.stringify(anomaly,null,2)}\n`);writePrivate(path.join(ready,'source-acceptance.json'),sourceBytes);writePrivate(path.join(ready,'anomaly-report.json'),anomalyBytes);manifest.source_acceptance_sha256=sha(sourceBytes);manifest.anomaly_report_sha256=sha(anomalyBytes);writePrivate(path.join(ready,'manifest.json'),`${JSON.stringify(manifest,null,2)}\n`);const work=path.join(path.dirname(config.spoolRoot),'link-b-work');fs.mkdirSync(work,{mode:0o700});const report=verifyLinkB({spoolPath:ready,collisionConfigPath:config.collisionConfigPath,workRoot:work});assert.equal(report.status,'PASS',JSON.stringify(report.mismatches));});
