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
const mockNotify = fileURLToPath(
  new URL('../fixtures/first-line-systemd-notify-stub.mjs', import.meta.url)
);
const unit = fileURLToPath(
  new URL('../../deploy/chatwoot-host/systemd/candidate/babypark-first-line-recovery.service',
    import.meta.url)
);

test('systemd candidate cannot auto-enable and supervisor will restart nonzero failures', () => {
  const spec = fs.readFileSync(unit, 'utf8');
  assert.match(spec, /(?:^|\n)Restart=on-failure(?:\n|$)/u);
  assert.match(spec, /(?:^|\n)Type=notify(?:\n|$)/u);
  assert.match(spec, /(?:^|\n)NotifyAccess=all(?:\n|$)/u);
  assert.match(spec, /(?:^|\n)WatchdogSec=120s(?:\n|$)/u);
  assert.match(spec, /(?:^|\n)StartLimitBurst=3(?:\n|$)/u);
  assert.match(spec, /(?:^|\n)StartLimitIntervalSec=10min(?:\n|$)/u);
  assert.match(spec, /(?:^|\n)User=babypark-firstline(?:\n|$)/u);
  assert.match(spec, /(?:^|\n)Group=babypark-firstline(?:\n|$)/u);
  assert.match(spec, /(?:^|\n)ReadWritePaths=\/var\/lib\/babypark-first-line(?:\n|$)/u);
  assert.match(spec, /(?:^|\n)InaccessiblePaths=\/var\/lib\/babypark-integration(?:\n|$)/u);
  assert.doesNotMatch(spec, /(?:^|\n)ConditionPathExists=/u,
    'missing v4 authority must fail service, never be silently skipped');
  assert.match(spec, /(?:^|\n)EnvironmentFile=\/etc\/babypark-first-line-recovery\.env/u);
  assert.match(spec, /(?:^|\n)ExecStart=\/usr\/bin\/node .*first-line-postsend-service\.mjs/u);
  assert.doesNotMatch(spec, /(?:^|\n)\[Install\]/u);
  assert.doesNotMatch(spec, /(?:^|\n)WantedBy=/u);
  assert.doesNotMatch(spec, /(?:^|\n)ExecStartPre=.*curl/u);
  assert.doesNotMatch(spec, /(?<!#).*Chatwoot.*POST/u);
  const entry = fs.readFileSync(service, 'utf8');
  for (const sensitive of [
    'BP_FIRST_LINE_BACKUP_KEY', 'CHATWOOT_API_TOKEN',
    'BRIDGE_DB', 'KNOWLEDGE_DB',
  ]) {
    assert.equal(entry.includes(sensitive), false,
      'recovery service must not load backup/Chatwoot/other-store secrets');
  }
});

test('recovery service rejects absent or malformed measured config without creating sqlite', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-cp4-config-'));
  t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
  const absent = path.join(dir, 'episode.sqlite');
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
  const ledger = path.join(dir, 'notify-ledger.txt');
  const proc = spawn(process.execPath, ['--import', mockNotify, service], {
    env: {
      ...process.env,
      BP_FIRST_LINE_DB: dbPath,
      BP_FIRST_LINE_SWEEP_INTERVAL_MS: '400',
      NOTIFY_SOCKET: '/run/test-systemd-notify-only',
      WATCHDOG_USEC: '5000000',
      BP_TEST_NOTIFY_LEDGER: ledger,
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
  assert.deepEqual(fs.readFileSync(ledger, 'utf8').trim().split('\n')
    .map(value => JSON.parse(value)), [['--ready', 'WATCHDOG=1']],
    'systemd ready cannot precede successful startup SQLite sweep');
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
  assert.deepEqual(fs.readFileSync(ledger, 'utf8').trim().split('\n')
    .map(value => JSON.parse(value)), [['--ready', 'WATCHDOG=1']],
    'a failed sweep must never send WATCHDOG=1');
  assert.doesNotMatch(stderr, /[^\n]*message_content/u);
});

test('native WATCHDOG=1 is emitted only after successful periodic SQLite sweeps', {
  timeout: 15_000,
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-cp4-watchdog-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'episode.sqlite');
  const ledger = path.join(dir, 'systemd-notifications.jsonl');
  const store = FirstLineStateStore.create(dbPath);
  store.close();
  const proc = spawn(process.execPath, ['--import', mockNotify, service], {
    env: {
      ...process.env,
      BP_FIRST_LINE_DB: dbPath,
      BP_FIRST_LINE_SWEEP_INTERVAL_MS: '70',
      WATCHDOG_USEC: '2000000',
      NOTIFY_SOCKET: '/run/mock-watchdog-only',
      BP_TEST_NOTIFY_LEDGER: ledger,
    },
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000,
  });
  t.after(() => { if (proc.exitCode === null) proc.kill('SIGKILL'); });
  let stdout = '';
  let reached;
  const completed = new Promise(resolve => { reached = resolve; });
  proc.stdout.on('data', bytes => {
    stdout += bytes.toString('utf8');
    const count = stdout.split('"event":"FIRST_LINE_RECOVERY_SWEEP_COMPLETED"').length - 1;
    if (count >= 3) reached();
  });
  const closed = new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code, signal) => resolve({ code, signal }));
  });
  await Promise.race([completed, closed.then(result => {
    throw new Error('periodic sweeps did not finish ' + JSON.stringify(result));
  })]);
  proc.kill('SIGTERM');
  await closed;
  const all = fs.readFileSync(ledger, 'utf8').trim().split('\n')
    .map(line => JSON.parse(line));
  assert.ok(all.length >= 3, 'one start and two completed periodics');
  assert.deepEqual(all[0], ['--ready', 'WATCHDOG=1']);
  for (const remaining of all.slice(1)) {
    assert.deepEqual(remaining, ['WATCHDOG=1']);
  }
});

test('watchdog missing, spoofed pid or insufficient watchdog budget cannot start', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-cp4-watchdog-bad-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'episode.sqlite');
  const store = FirstLineStateStore.create(dbPath);
  store.close();
  const cases = [
    { NOTIFY_SOCKET: '', WATCHDOG_USEC: '10000000' },
    { NOTIFY_SOCKET: '/run/test', WATCHDOG_USEC: '' },
    { NOTIFY_SOCKET: '/run/test', WATCHDOG_USEC: '1000000',
      WATCHDOG_PID: '1' },
    { NOTIFY_SOCKET: '/run/test', WATCHDOG_USEC: '100000',
      BP_FIRST_LINE_SWEEP_INTERVAL_MS: '500' },
  ];
  for (const overrides of cases) {
    const result = await new Promise((resolve, reject) => {
      const proc = spawn(process.execPath, [service], {
        env: {
          ...process.env, BP_FIRST_LINE_DB: dbPath,
          BP_FIRST_LINE_SWEEP_INTERVAL_MS: '100',
          ...overrides,
        },
        stdio: ['ignore', 'pipe', 'pipe'], timeout: 5_000,
      });
      let stderr = '';
      proc.stderr.on('data', bytes => { stderr += bytes; });
      proc.on('error', reject);
      proc.on('close', (code, signal) => resolve({ code, signal, stderr }));
    });
    assert.equal(result.code, 1, JSON.stringify(result));
    assert.equal(result.signal, null);
    assert.match(result.stderr, /"event":"FIRST_LINE_RECOVERY_STARTUP_FATAL"/u);
    assert.doesNotMatch(result.stderr, /"event":"FIRST_LINE_RECOVERY_SWEEP_COMPLETED"/u);
  }
});
