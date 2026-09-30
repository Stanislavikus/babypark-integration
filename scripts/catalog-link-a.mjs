#!/usr/bin/env node
import { verifyLinkA } from '../src/catalog/link-a/verifier.mjs';
try {
  const entries=process.argv.slice(2).map(arg=>{const m=/^--([^=]+)=(.*)$/.exec(arg);if(!m)throw new Error(`invalid argument: ${arg}`);return[m[1],m[2]];});
  const args=Object.fromEntries(entries),keys=['staged-spool','work-root','catalog-dir','identity','generation','run-id','run-digest','final-seq'];if(entries.length!==keys.length||new Set(entries.map(x=>x[0])).size!==keys.length||keys.some(k=>!args[k])||Object.keys(args).some(k=>!keys.includes(k)))throw new Error('usage: catalog-link-a --staged-spool= --work-root= --catalog-dir= --identity= --generation= --run-id= --run-digest= --final-seq=');
  for(const key of ['staged-spool','work-root','catalog-dir','identity'])if(!args[key].startsWith('/'))throw new Error(`${key} must be absolute`);if(!/^[1-9]\d*$/.test(args['final-seq']))throw new Error('final-seq must be a positive canonical integer');
  const report=verifyLinkA({stagedSpoolPath:args['staged-spool'],workRoot:args['work-root'],catalogStorageDir:args['catalog-dir'],identityPath:args.identity,expectedGenerationId:args.generation,acceptedRun:{run_id:args['run-id'],run_digest:args['run-digest'],final_seq:Number(args['final-seq'])}});process.stdout.write(`${JSON.stringify(report)}\n`);process.exitCode=report.status==='PASS'?0:1;
} catch(error){process.stdout.write(`${JSON.stringify({schema:'bp.catalog.link-a-report/1',version:1,status:'ERROR',error:error.message})}\n`);process.exitCode=2;}
