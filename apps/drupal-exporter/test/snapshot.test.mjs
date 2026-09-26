import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkFilesystemPrecheck, checkFilesystemStability } from '../src/filesystem-stability.mjs';
import { parsePhpSerializedInteger } from '../src/php-variable.mjs';
import { BLOCKER_CODES } from '../src/blockers.mjs';
import { testConfig } from './helpers/fixture-builder.mjs';

test('parsePhpSerializedInteger handles production form', () => {
  assert.equal(parsePhpSerializedInteger('i:1700000000;'), 1700000000);
});

test('source instability when pending stock file appears', () => {
  const config = testConfig();
  const precheck = checkFilesystemPrecheck(config);
  fs.writeFileSync(config.filesystem.stockPending, '<pending/>');

  const stability = checkFilesystemStability({
    config,
    beforeFingerprint: precheck.processedFingerprint,
    stockSyncUnix: 2000000000,
  });

  assert.ok(stability.blockers.some(b => b.code === BLOCKER_CODES.SOURCE_UNSTABLE));
  fs.unlinkSync(config.filesystem.stockPending);
});

test('stock processed mtime newer than sync marker is unstable', () => {
  const config = testConfig();
  const precheck = checkFilesystemPrecheck(config);
  const future = new Date(2000000000 * 1000);
  fs.utimesSync(config.filesystem.stockProcessed, future, future);

  const stability = checkFilesystemStability({
    config,
    beforeFingerprint: precheck.processedFingerprint,
    stockSyncUnix: 1000000000,
  });

  assert.ok(stability.blockers.some(b => b.code === BLOCKER_CODES.SOURCE_UNSTABLE));
});
