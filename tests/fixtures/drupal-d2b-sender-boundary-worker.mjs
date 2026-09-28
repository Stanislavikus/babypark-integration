import fs from 'node:fs';
import { sendSpool } from '../../src/drupal-d2b/sender.mjs';
import { D2bError } from '../../src/drupal-d2b/errors.mjs';
const [spoolPath,stateDir,releaseRoot,barrier,release,result,events] = process.argv.slice(2);
while (!fs.existsSync(barrier)) await new Promise(resolve=>setTimeout(resolve,5));
const append=kind=>fs.appendFileSync(events,`${process.pid}:${kind}\n`);
try {
  await sendSpool({spoolPath,config:{stateDir,kid:'kid',maxAttempts:1},verification:{releaseRoot},client:{async state(){append('state');while(!fs.existsSync(release))await new Promise(resolve=>setTimeout(resolve,5));throw new D2bError('TEST_STOP','stop')},async full(){append('full');throw new Error('unexpected')}},now:()=>new Date('2026-09-28T00:01:00.000Z')});
  fs.writeFileSync(result,`${process.pid}:completed`);
} catch(error) { fs.writeFileSync(result,`${process.pid}:${error.code}`); }
