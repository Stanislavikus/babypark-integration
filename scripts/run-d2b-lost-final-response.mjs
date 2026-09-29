#!/usr/bin/env node
import { loadSenderConfig } from '../src/drupal-d2b/config.mjs';
import { D2bClient } from '../src/drupal-d2b/client.mjs';
import { sendSpool } from '../src/drupal-d2b/sender.mjs';
import { lostFinalResponseFetch } from '../src/catalog/rehearsal/operations.mjs';
try{if(process.env.BABYPARK_REHEARSAL!=='1'||process.argv.length!==3)throw new Error('usage: BABYPARK_REHEARSAL=1 run-d2b-lost-final-response /absolute/spool.ready');const config=loadSenderConfig(),client=new D2bClient(config,{fetchImpl:lostFinalResponseFetch()});process.stdout.write(`${JSON.stringify(await sendSpool({spoolPath:process.argv[2],config,client}))}\n`);}catch(error){process.stderr.write(`${JSON.stringify({code:error.code??'REHEARSAL_SENDER_FAILED',message:error.message})}\n`);process.exitCode=1;}
