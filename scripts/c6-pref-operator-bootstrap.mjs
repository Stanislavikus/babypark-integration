#!/usr/bin/env node
// Explicit operator-only v4 test bootstrap. The CI allowlist names this exact
// path; no listener, webhook or public-action runtime may initialize SQLite.
// PoC only. Never accepts customer data or production access.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirstLineStateStore } from '../src/copilot/first-line-state-store.mjs';

const APPROVED_STAGE = '/var/tmp/bp-c6poc-20261011/c6-control/episode-staging.sqlite';

export function createSyntheticFirstLineAuthority({ file, mode, now } = {}) {
  assert.ok(typeof file === 'string' && path.isAbsolute(file), 'EXPLICIT_ABSOLUTE_PATH');
  const target = path.resolve(file);
  assert.ok(!fs.existsSync(target), 'REFUSE_EXISTING_SEMANTIC_AUTHORITY');
  for (const suffix of ['-wal','-shm','-journal']) {
    assert.ok(!fs.existsSync(target + suffix), 'REFUSE_PREEXISTING_SQLITE_SIDECARS');
  }
  if (mode === 'characterize') {
    assert.equal(process.argv[2], 'characterize', 'CHARACTERIZATION_ONLY_BOOTSTRAP');
    assert.equal(path.basename(target), 'episode.sqlite');
    const dir = path.dirname(target);
    assert.match(path.basename(dir), /^bp-c6-pref-[A-Za-z0-9_-]+$/, 'BOUNDED_TEST_TEMP_DIR');
    const base = process.env.BP_C6_POC_SCRATCH_DIR || os.tmpdir();
    assert.equal(path.dirname(dir), path.resolve(base), 'ONLY_TRANSIENT_CHARACTERIZATION_DIR');
  } else if (mode === 'operator') {
    assert.equal(process.argv[2], 'operator-init', 'OPERATOR_CLI_EXPLICIT_COMMAND');
    assert.equal(process.env.BP_C6_SYNTHETIC_ONLY, 'yes', 'SYNTHETIC_ONLY_REQUIRED');
    assert.equal(process.env.BP_C6_POC_PREPARE_ROOT_ONLY, 'yes', 'ROOT_OPERATOR_REQUIRED');
    assert.equal(process.getuid(), 0, 'PRIVILEGED_STAGE_OPERATOR_REQUIRED');
    assert.equal(target, APPROVED_STAGE, 'ONLY_FROZEN_ROOT_CONTROL_STAGE');
    const parent = fs.lstatSync(path.dirname(target));
    assert.ok(parent.isDirectory() && !parent.isSymbolicLink() && parent.uid === 0 &&
      (parent.mode & 0o777) === 0o700, 'ROOT_ONLY_PARENT_REQUIRED');
  } else {
    throw new Error('UNKNOWN_BOOTSTRAP_MODE');
  }
  const store = FirstLineStateStore.create(target, now ? { now } : {});
  store.close();
  return { created: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] !== 'operator-init') throw new Error('EXPLICIT_OPERATOR_INIT_REQUIRED');
    createSyntheticFirstLineAuthority({
      file: process.env.BP_C6_POC_DB_PATH,
      mode: 'operator',
    });
    process.stdout.write('C6_SYNTHETIC_OPERATOR_BOOTSTRAP_OK\n');
  } catch (e) {
    process.stderr.write('C6_SYNTHETIC_OPERATOR_BOOTSTRAP_DENIED\n');
    process.exitCode = 73;
  }
}
