import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';

const service = fileURLToPath(
  new URL('../../scripts/first-line-postsend-service.mjs', import.meta.url)
);
const unit = fileURLToPath(
  new URL('../../deploy/chatwoot-host/systemd/candidate/babypark-first-line-recovery.service',
    import.meta.url)
);

test('systemd candidate cannot auto-enable and supervisor will restart nonzero failures', () => {
  const spec = fs.readFileSync(unit, 'utf8');
  assert.match(spec, /(?:^|\n)Restart=on-failure(?:\n|$)/u);
  assert.match(spec, /(?:^|\n)EnvironmentFile=\/etc\/babypark-first-line-recovery\.env/u);
  assert.match(spec, /(?:^|\n)ExecStart=\/usr\/bin\/node .*first-line-postsend-service\.mjs/u);
  assert.doesNotMatch(spec, /(?:^|\n)\[Install\]/u);
  assert.doesNotMatch(spec, /(?:^|\n)WantedBy=/u);
  assert.doesNotMatch(spec, /(?:^|\n)ExecStartPre=.*curl/u);
  assert.doesNotMatch(spec, /(?<!#).*Chatwoot.*POST/u);
});

test('recovery service rejects absent or malformed measured config without creating sqlite', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-cp4-config-'));
  t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
  const absent = path.join(dir, 'missing.sqlite');
  for (const env of [
    { BP_FIRST_LINE_DB: absent, BP_FIRST_LINE_SWEEP_INTERVAL_MS: '' },
    { BP_FIRST_LINE_DB: absent, BP_FIRST_LINE_SWEEP_INTERVAL_MS: '0' },
    { BP_FIRST_LINE_DB: absent, BP_FIRST_LINE_SWEEP_INTERVAL_MS: '10ms' },
    { BP_FIRST_LINE_DB: absent, BP_FIRST_LINE_SWEEP_INTERVAL_MS: '40' },
  ]) {
    const result = await new Promise((resolve, reject) => {
      const proc = spawn(process.execPath, [service], {
        env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 8_000,
      });
      let stderr = '';
      proc.stderr.on('data', chunk => { stderr += chunk; });
      proc.on('error', reject);
      proc.on('close', (code, signal) => resolve({ code, signal, stderr }));
    });
    assert.equal(result.code, 1, JSON.stringify(result));
    assert.equal(result.signal, null);
    assert.match(result.stderr, /"event":"FIRST_LINE_RECOVERY_STARTUP_FATAL"/u);
    assert.equal(fs.existsSync(absent), false, 'no missing SQLite authority is created');
  }
});

test('after successful startup, synthetic lost SQLite table forces nonzero service exit', {
  timeout: 20_000,
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-cp4-supervisor-'));
  t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
  const dbPath = path.join(dir, 'episode.sqlite');
  const store = FirstLineStateStore.create(dbPath);
  store.close();
  const proc = spawn(process.execPath, [service], {
    env: {
      ...process.env,
      BP_FIRST_LINE_DB: dbPath,
      BP_FIRST_LINE_SWEEP_INTERVAL_MS: '400',
    },
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000,
  });
  t.after(() => { if (proc.exitCode === null) proc.kill('SIGKILL'); });
  let stderr = '', stdout = '';
  proc.stderr.on('data', bytes => { stderr += bytes; });
  let startedResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  proc.stdout.on('data', bytes => {
    stdout += bytes.toString('utf8');
    if (stdout.includes('"event":"FIRST_LINE_RECOVERY_SWEEP_COMPLETED"')) {
      startedResolve();
    }
  });
  const closed = new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code, signal) => resolve({ code, signal }));
  });
  await Promise.race([
    started,
    closed.then(result => { throw new Error('startup never succeeded ' + JSON.stringify(result)); }),
  ]);
  assert.equal(stdout.split('"event":"FIRST_LINE_RECOVERY_SWEEP_COMPLETED"').length - 1,
    1, 'startup heartbeat after real SQLite sweep');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec('DROP TABLE public_actions'); // disposable synthetic DB only
  } finally {
    db.close();
  }
  const result = await closed;
  assert.deepEqual(result, { code: 1, signal: null });
  assert.match(stderr, /"event":"FIRST_LINE_RECOVERY_FATAL"/u);
  assert.doesNotMatch(stderr, /[^\n]*message_content/u);
});
