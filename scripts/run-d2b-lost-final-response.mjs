#!/usr/bin/env node
import { loadSenderConfig } from '../src/drupal-d2b/config.mjs';
import { D2bClient } from '../src/drupal-d2b/client.mjs';
import { sendSpool } from '../src/drupal-d2b/sender.mjs';
import {
  lostFinalResponseFetch,
  validateRehearsalSender,
} from '../src/catalog/rehearsal/operations.mjs';

try {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !args[0].startsWith('/')) {
    throw new Error('usage: BABYPARK_REHEARSAL=1 run-d2b-lost-final-response /absolute/spool.ready');
  }
  const spoolPath = args[0];
  const config = loadSenderConfig();
  validateRehearsalSender({ spoolPath, config });
  const client = new D2bClient(config, { fetchImpl: lostFinalResponseFetch() });
  process.stdout.write(`${JSON.stringify(await sendSpool({ spoolPath, config, client }))}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    code: error.code ?? 'REHEARSAL_SENDER_FAILED',
    message: error.message,
  })}\n`);
  process.exitCode = 1;
}