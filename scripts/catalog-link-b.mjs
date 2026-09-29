#!/usr/bin/env node
import { verifyLinkB } from '../src/catalog/link-b/verifier.mjs';

try {
  const entries=process.argv.slice(2).map(arg => { const match = /^--([^=]+)=(.*)$/.exec(arg); if (!match) throw new Error(`invalid argument: ${arg}`); return [match[1], match[2]]; });
  const args=Object.fromEntries(entries); if(new Set(entries.map(([key])=>key)).size!==entries.length)throw new Error('duplicate arguments are forbidden');
  if (!args.spool || !args['collision-config'] || !args['work-root'] || Object.keys(args).some(key => !['spool','collision-config','work-root'].includes(key))) throw new Error('usage: catalog-link-b --spool=<absolute .ready> --collision-config=<absolute yaml> --work-root=<absolute private dir>');
  const report = verifyLinkB({ spoolPath: args.spool, collisionConfigPath: args['collision-config'], workRoot: args['work-root'] });
  process.stdout.write(`${JSON.stringify(report)}\n`); process.exitCode = report.status === 'PASS' ? 0 : 1;
} catch (error) {
  process.stdout.write(`${JSON.stringify({ schema: 'bp.catalog.link-b-report/1', version: 1, status: 'ERROR', error: error.message })}\n`); process.exitCode = 2;
}
