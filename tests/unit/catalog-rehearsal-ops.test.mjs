import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { stageFrozenSpoolFromTransfer } from '../../src/catalog/link-a/staging.mjs';
import { D2bClient } from '../../src/drupal-d2b/client.mjs';
import { readRunState } from '../../src/drupal-d2b/run-state.mjs';
import { sendSpool } from '../../src/drupal-d2b/sender.mjs';
import { verifySpool } from '../../src/drupal-d2b/spool.mjs';
import { createD2bFixture } from '../helpers/drupal-d2b-sender-fixture.mjs';
import {
  LINK_A_SYSTEMD_PROPERTIES,
  REHEARSAL_AUDIENCE,
  buildLinkASystemdRun,
  createRsyncTransfer,
  executeLinkASystemdUnit,
  lostFinalResponseFetch,
  parseSystemdShow,
  prepareLinkAWorkRoot,
  probeCatalogReadability,
  rehearsalCoordinator,
  resolveLinkAReleasePaths,
  resourceEvidence,
  validateEffectiveProperties,
  validateRehearsalConfig,
  validateRehearsalSender,
} from '../../src/catalog/rehearsal/operations.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const LAYERS = ['taxonomy', 'content', 'commercial', 'stock'];

function copy(source, target) {
  for (const name of fs.readdirSync(source)) {
    fs.copyFileSync(path.join(source, name), path.join(target, name));
    fs.chmodSync(path.join(target, name), 0o600);
  }
}

function bootstrapState() {
  return {
    schema: 'bp.catalog.state/1',
    state: 'BOOTSTRAP',
    accepting_ingest: true,
    blockers: [],
    current_generation: null,
    source_epoch: null,
    published_identity_revision: null,
    accepted_run: null,
    layers: Object.fromEntries(LAYERS.map(layer => [
      layer,
      { accepted_watermark: null, need_full: false, need_reconcile: false },
    ])),
  };
}

function currentState({ runId, runDigest, finalSeq, spool }) {
  return {
    schema: 'bp.catalog.state/1',
    state: 'CURRENT',
    accepting_ingest: true,
    blockers: [],
    current_generation: 'rehearsal-generation',
    source_epoch: spool.manifest.source_epoch,
    published_identity_revision: 1,
    accepted_run: {
      run_id: runId,
      run_digest: runDigest,
      final_seq: finalSeq,
      accepted_at: '2026-09-28T00:02:00.000Z',
    },
    layers: Object.fromEntries(LAYERS.map(layer => [
      layer,
      {
        accepted_watermark: spool.manifest.snapshot_watermark,
        need_full: false,
        need_reconcile: false,
      },
    ])),
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeWrapperStat({ uid = 0, mode = 0o100755 } = {}) {
  return {
    uid,
    gid: 0,
    mode,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
}

function systemdRunner(states, { failures = {} } = {}) {
  const calls = [];
  let index = 0;
  const run = (command, argv) => {
    calls.push([command, [...argv]]);
    const key = `${command} ${argv[0] ?? ''}`;
    if (Object.hasOwn(failures, key)) {
      const failure = failures[key];
      if (typeof failure === 'number') {
        return { status: failure, stdout: '', stderr: 'injected failure' };
      }
      return {
        status: failure.status ?? 1,
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? 'injected failure',
      };
    }
    if (command === 'systemd-run') return { status: 0, stdout: '', stderr: '' };
    if (command === 'systemctl' && argv[0] === 'show') {
      const state = states[Math.min(index, states.length - 1)];
      index += 1;
      if (state === null) return { status: 5, stdout: '', stderr: 'not found' };
      return {
        status: 0,
        stderr: '',
        stdout: Object.entries(state).map(([key2, value]) => `${key2}=${value}`).join('\n') + '\n',
      };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

test('Link A CLI malformed input is one bounded JSON and exit 2', () => {
  const result = spawnSync(process.execPath, ['scripts/catalog-link-a.mjs', 'badarg'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.trim().split('\n').length, 1);
  assert.equal(JSON.parse(result.stdout).status, 'ERROR');
});

test('transfer staging promotes exact artifact once and retains failures', async t => {
  const fixture = createD2bFixture();
  const root = path.join(fixture.root, 'staging');
  fs.mkdirSync(root, { mode: 0o700 });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const expected = hash(fs.readFileSync(path.join(fixture.spool, 'manifest.json')));
  const result = await stageFrozenSpoolFromTransfer({
    stagingRoot: root,
    expectedManifestSha256: expected,
    transfer: building => copy(fixture.spool, building),
  });
  assert.match(result.path, /\.staged$/);
  await assert.rejects(stageFrozenSpoolFromTransfer({
    stagingRoot: root,
    expectedManifestSha256: expected,
    transfer() {},
  }), /already exists/);
});

test('remote transfer can hand verified staging ownership to Link A service', async t => {
  const fixture = createD2bFixture();
  const root = path.join(fixture.root, 'staging-owned');
  fs.mkdirSync(root, { mode: 0o700 });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const expected = hash(fs.readFileSync(path.join(fixture.spool, 'manifest.json')));
  const owner = { uid: process.getuid(), gid: process.getgid() };
  const result = await stageFrozenSpoolFromTransfer({
    stagingRoot: root,
    expectedManifestSha256: expected,
    transfer: building => copy(fixture.spool, building),
    owner,
  });
  const stat = fs.lstatSync(result.path);
  assert.equal(stat.uid, owner.uid);
  assert.equal(stat.gid, owner.gid);
  for (const name of fs.readdirSync(result.path)) {
    const file = fs.lstatSync(path.join(result.path, name));
    assert.equal(file.uid, owner.uid);
    assert.equal(file.gid, owner.gid);
  }
});

test('transfer staging rejects wrong trusted hash and keeps building', async t => {
  const fixture = createD2bFixture();
  const root = path.join(fixture.root, 'staging');
  fs.mkdirSync(root, { mode: 0o700 });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const wrong = '0'.repeat(64);
  await assert.rejects(stageFrozenSpoolFromTransfer({
    stagingRoot: root,
    expectedManifestSha256: wrong,
    transfer: building => copy(fixture.spool, building),
  }));
  assert.ok(fs.existsSync(path.join(root, `${wrong}.building`)));
  assert.equal(fs.existsSync(path.join(root, `${wrong}.staged`)), false);
});

test('transfer staging rejects symlink and unexpected entries', async t => {
  for (const kind of ['symlink', 'unexpected']) {
    const fixture = createD2bFixture();
    const root = path.join(fixture.root, 'staging');
    fs.mkdirSync(root, { mode: 0o700 });
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const expected = hash(fs.readFileSync(path.join(fixture.spool, 'manifest.json')));
    await assert.rejects(stageFrozenSpoolFromTransfer({
      stagingRoot: root,
      expectedManifestSha256: expected,
      transfer: building => {
        copy(fixture.spool, building);
        if (kind === 'symlink') {
          fs.unlinkSync(path.join(building, 'preflight.json'));
          fs.symlinkSync('/dev/null', path.join(building, 'preflight.json'));
        } else {
          fs.writeFileSync(path.join(building, 'extra'), 'x', { mode: 0o600 });
        }
      },
    }));
  }
});

test('rehearsal Catalog guard rejects missing flag, aliases, authority and failpoints', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['identity', 'replay', 'catalog', 'backup']) {
    fs.mkdirSync(path.join(root, name));
  }
  const config = {
    identityPath: path.join(root, 'identity'),
    replayPath: path.join(root, 'replay'),
    storageDir: path.join(root, 'catalog'),
    backupRoot: path.join(root, 'backup'),
    host: '127.0.0.1',
    port: 18081,
    audience: REHEARSAL_AUDIENCE,
    secrets: new Map([['rehearsal-key', 'x']]),
    ingestEnabled: true,
  };
  assert.throws(() => validateRehearsalConfig(config, {}));
  assert.throws(() => validateRehearsalConfig(
    { ...config, audience: 'production' },
    { BABYPARK_REHEARSAL: '1', BABYPARK_REHEARSAL_ROOT: root },
  ));
  assert.throws(() => validateRehearsalConfig(
    { ...config, port: 18082 },
    { BABYPARK_REHEARSAL: '1', BABYPARK_REHEARSAL_ROOT: root },
  ));
  assert.throws(() => validateRehearsalConfig(
    config,
    {
      BABYPARK_REHEARSAL: '1',
      BABYPARK_REHEARSAL_ROOT: root,
      BABYPARK_REHEARSAL_FAILPOINT: 'other',
    },
  ));
  const alias = `${root}-alias`;
  fs.symlinkSync(root, alias);
  t.after(() => fs.rmSync(alias, { force: true }));
  assert.throws(() => validateRehearsalConfig(
    config,
    { BABYPARK_REHEARSAL: '1', BABYPARK_REHEARSAL_ROOT: alias },
  ), /symlink alias/);
  assert.equal(validateRehearsalConfig(
    config,
    { BABYPARK_REHEARSAL: '1', BABYPARK_REHEARSAL_ROOT: root },
  ).root, root);
});

test('lost-final sender guard rejects every production-like sender boundary', t => {
  const fixture = createD2bFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const stateDir = path.join(fixture.root, 'sender-state');
  fs.mkdirSync(stateDir, { mode: 0o700 });
  const config = {
    origin: 'http://127.0.0.1:18081',
    audience: REHEARSAL_AUDIENCE,
    kid: 'rehearsal-key',
    secret: 'x'.repeat(32),
    stateDir,
    maxAttempts: 2,
    timeoutMs: 1000,
  };
  const env = {
    BABYPARK_REHEARSAL: '1',
    BABYPARK_REHEARSAL_ROOT: fixture.root,
  };
  assert.doesNotThrow(() => validateRehearsalSender({
    spoolPath: fixture.spool,
    config,
    env,
  }));
  assert.throws(() => validateRehearsalSender({ spoolPath: fixture.spool, config, env: {} }));
  assert.throws(() => validateRehearsalSender({
    spoolPath: fixture.spool,
    config: { ...config, origin: 'https://catalog.example' },
    env,
  }), /origin/);
  assert.throws(() => validateRehearsalSender({
    spoolPath: fixture.spool,
    config: { ...config, audience: 'production' },
    env,
  }), /audience/);
  assert.throws(() => validateRehearsalSender({
    spoolPath: fixture.spool,
    config: { ...config, kid: 'production-key' },
    env,
  }), /KID/);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-state-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  assert.throws(() => validateRehearsalSender({
    spoolPath: fixture.spool,
    config: { ...config, stateDir: outside },
    env,
  }), /inside rehearsal root/);
  const other = createD2bFixture();
  t.after(() => fs.rmSync(other.root, { recursive: true, force: true }));
  assert.throws(() => validateRehearsalSender({
    spoolPath: other.spool,
    config,
    env,
  }), /inside rehearsal root/);
  assert.doesNotThrow(() => validateRehearsalSender({
    spoolPath: fixture.spool,
    config: { ...config, producerReleaseRoot: '/opt/babypark-rehearsal/releases/release-a' },
    env,
  }));
  for (const producerReleaseRoot of [
    '/opt/babypark-exporter/current',
    '/opt/babypark-rehearsal/releases/../production',
    'relative/release',
  ]) {
    assert.throws(() => validateRehearsalSender({
      spoolPath: fixture.spool,
      config: { ...config, producerReleaseRoot },
      env,
    }), /producer release root/);
  }
});

test('exact rehearsal failpoints fire only at the named hook', () => {
  for (const selected of ['certification.afterCommit', 'publication.after']) {
    const seen = [];
    const wrapped = rehearsalCoordinator(selected, {
      kill: () => seen.push('kill'),
      coordinator: args => {
        for (const name of ['other', selected, 'later']) args.failpoint(name);
        return 'ok';
      },
    });
    assert.equal(wrapped({}), 'ok');
    assert.deepEqual(seen, ['kill']);
  }
});

test('lost-final wrapper drops first successful exact final response only', async () => {
  const calls = [];
  const body = Buffer.from('{"trailer":"exact"}');
  const fetch = lostFinalResponseFetch(async (_url, options) => {
    calls.push({
      body: Buffer.from(options.body),
      hash: hash(options.body),
      run: options.headers['X-BP-Run'],
      seq: options.headers['X-BP-Seq'],
    });
    return { ok: true, status: 200 };
  });
  const headers = {
    'X-BP-Final': '1',
    'X-BP-Run': 'same-run',
    'X-BP-Seq': '9',
  };
  await assert.rejects(fetch('x', { method: 'POST', headers, body }));
  assert.equal((await fetch('x', { method: 'POST', headers, body })).status, 200);
  assert.equal((await fetch('x', {
    method: 'POST',
    headers: { ...headers, 'X-BP-Final': '0' },
    body,
  })).status, 200);
  assert.deepEqual(calls[0], calls[1]);
});

test('real sendSpool + D2bClient lost-final retry preserves exact final request and confirms state', async t => {
  const fixture = createD2bFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const stateDir = path.join(fixture.root, 'sender-state');
  const spool = verifySpool(fixture.spool, fixture.options);
  let catalogState = bootstrapState();
  const finalCalls = [];
  const backend = async (_url, options) => {
    if (options.method === 'GET') return jsonResponse(catalogState);
    const runId = options.headers['X-BP-Run'];
    const seq = Number(options.headers['X-BP-Seq']);
    const final = options.headers['X-BP-Final'] === '1';
    const body = Buffer.from(options.body);
    if (!final) {
      return jsonResponse({
        schema: 'bp.catalog.ingest-response/1',
        status: 'STAGED',
        ack: {
          staged: true,
          run_id: runId,
          layer: 'full',
          seq,
          body_sha256: hash(body),
        },
      });
    }
    const trailer = JSON.parse(body.toString('utf8')).trailer;
    finalCalls.push({
      run_id: runId,
      seq,
      body: Buffer.from(body),
      body_sha256: hash(body),
    });
    catalogState = currentState({
      runId,
      runDigest: trailer.run_digest,
      finalSeq: seq,
      spool,
    });
    return jsonResponse({
      schema: 'bp.catalog.ingest-response/1',
      status: 'ACKED',
      ack: {
        accepted: true,
        generation_id: 'rehearsal-generation',
        layer: 'full',
        run_id: runId,
        run_digest: trailer.run_digest,
        source_watermark: null,
      },
    });
  };
  const config = {
    origin: 'http://127.0.0.1:18081',
    audience: REHEARSAL_AUDIENCE,
    kid: 'rehearsal-key',
    secret: 'sender-test-secret-at-least-32-chars',
    stateDir,
    maxAttempts: 2,
    timeoutMs: 1000,
  };
  const client = new D2bClient(config, {
    fetchImpl: lostFinalResponseFetch(backend),
    nowSeconds: () => 1,
  });
  const nowMs = Number(BigInt(spool.manifest.snapshot_watermark) / 1000n) + 60_000;
  const result = await sendSpool({
    spoolPath: fixture.spool,
    config,
    verification: fixture.options,
    client,
    now: () => new Date(nowMs),
    sleep: async () => {},
  });
  assert.equal(result.status, 'STATE_CONFIRMED');
  assert.equal(finalCalls.length, 2);
  assert.equal(finalCalls[0].run_id, finalCalls[1].run_id);
  assert.equal(finalCalls[0].seq, finalCalls[1].seq);
  assert.equal(finalCalls[0].body_sha256, finalCalls[1].body_sha256);
  assert.deepEqual(finalCalls[0].body, finalCalls[1].body);
  const durable = readRunState(stateDir, spool);
  assert.equal(durable.run_id, finalCalls[0].run_id);
  assert.equal(durable.transport_state, 'STATE_CONFIRMED');
  assert.equal(durable.final_ack.run_digest, catalogState.accepted_run.run_digest);
  assert.equal(durable.post_ack_state.accepted_run.final_seq, finalCalls[0].seq);
});

test('rsync adapter fixes remote user/root and invokes argv without shell', () => {
  let call;
  const transfer = createRsyncTransfer({
    host: 'drupal.example',
    sshWrapperPath: '/root/rrsync-ssh',
    lstat: () => fakeWrapperStat(),
    spawn: (command, argv, options) => (
      call = { command, argv, options },
      { status: 0 }
    ),
  });
  transfer('/stage/building');
  assert.equal(call.command, 'rsync');
  assert.equal(call.options.shell, false);
  assert.ok(call.argv.includes('--rsh=/root/rrsync-ssh'));
  assert.equal(call.argv.includes('--protect-args'), false);
  assert.ok(call.argv.includes('babypark-exporter@drupal.example:./'));
  assert.equal(call.argv.at(-1), '/stage/building/');
  assert.throws(() => createRsyncTransfer({
    host: 'root@drupal.example',
    sshWrapperPath: '/root/rrsync-ssh',
    lstat: () => fakeWrapperStat(),
  }));
  assert.throws(() => createRsyncTransfer({
    host: 'drupal.example',
    sshWrapperPath: '/tmp/wrapper',
    lstat: () => fakeWrapperStat({ uid: 1000 }),
  }), /root-owned/);
});

test('repository SSH wrapper template freezes strict one-use SSH options', () => {
  const template = fs.readFileSync('scripts/link-a-ssh-wrapper.sh.template', 'utf8');
  for (const required of [
    '/usr/bin/ssh -F /dev/null -T',
    '-oBatchMode=yes',
    '-oPasswordAuthentication=no',
    '-oKbdInteractiveAuthentication=no',
    '-oStrictHostKeyChecking=yes',
    '-oUserKnownHostsFile=',
    '-oGlobalKnownHostsFile=/dev/null',
    '-oIdentitiesOnly=yes',
    '-oClearAllForwardings=yes',
    '-oForwardAgent=no',
    '-oForwardX11=no',
    '-oRequestTTY=no',
    '-oPermitLocalCommand=no',
    '-oProxyCommand=none',
    '-oProxyJump=none',
  ]) assert.ok(template.includes(required), required);
  assert.equal(/BEGIN .*PRIVATE KEY/.test(template), false);
});

test('systemd command binds release read-only and properties are exact', () => {
  const cliArgs = [
    '--staged-spool=/staged',
    '--catalog-dir=/catalog',
    '--identity=/identity',
  ];
  const built = buildLinkASystemdRun({
    unit: 'babypark-link-a-deadbeef',
    workRoot: '/work',
    gatePath: '/work/gate',
    gateScript: '/release/scripts/gate.mjs',
    linkACli: '/release/scripts/link-a.mjs',
    releaseRoot: '/release',
    cliArgs,
    node: '/node',
  });
  assert.equal(built.argv[1], '--no-block');
  assert.equal(built.argv.includes('--collect'), false);
  assert.ok(built.argv.includes('--service-type=oneshot'));
  assert.ok(built.argv.includes('--remain-after-exit'));
  assert.equal(built.properties.ReadOnlyPaths, '/staged /catalog /identity /release');
  const gateAt = built.argv.indexOf('/release/scripts/gate.mjs');
  assert.deepEqual(built.argv.slice(gateAt - 1, gateAt + 4), ['/node', '/release/scripts/gate.mjs', '/work/gate', '/node', '/release/scripts/link-a.mjs']);
  validateEffectiveProperties({ ...built.properties }, built.properties);
  assert.deepEqual(
    parseSystemdShow('Result=success\nExecMainStatus=0\n'),
    { Result: 'success', ExecMainStatus: '0' },
  );
});

test('release-root resolution is independent from caller CWD', t => {
  const script = path.resolve('scripts/run-link-a-systemd.mjs');
  const expected = path.resolve('.');
  const previous = process.cwd();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'cwd-'));
  t.after(() => {
    process.chdir(previous);
    fs.rmSync(elsewhere, { recursive: true, force: true });
  });
  process.chdir(elsewhere);
  const resolved = resolveLinkAReleasePaths(pathToFileURL(script).href);
  assert.equal(resolved.releaseRoot, expected);
  assert.equal(resolved.linkACli, path.join(expected, 'scripts/catalog-link-a.mjs'));
});

test('work root rejects symlink aliases and accepts exact service-owned private directory', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-root-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'exact');
  fs.mkdirSync(target, { mode: 0o700 });
  const identity = { uid: process.getuid(), gid: process.getgid() };
  assert.equal(prepareLinkAWorkRoot(target, { identity }), target);
  const alias = path.join(root, 'alias');
  fs.symlinkSync(target, alias);
  assert.throws(() => prepareLinkAWorkRoot(alias, { identity }), /symlink/);
  fs.chmodSync(target, 0o755);
  assert.throws(() => prepareLinkAWorkRoot(target, { identity }), /private directory/);
});

test('work root admission rejects overlap with staged/catalog/identity/release authority', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-boundary-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const protectedDir = path.join(root, 'catalog');
  fs.mkdirSync(protectedDir, { mode: 0o700 });
  const identityFile = path.join(root, 'identity.sqlite');
  fs.writeFileSync(identityFile, 'x', { mode: 0o600 });
  const identity = { uid: process.getuid(), gid: process.getgid() };
  assert.throws(() => prepareLinkAWorkRoot(path.join(protectedDir, 'work'), {
    identity,
    protectedPaths: [protectedDir, identityFile],
  }), /disjoint/);
});

test('systemd controller releases gate only after property validation and cleans success', async () => {
  const built = {
    argv: ['systemd-run'],
    properties: { User: 'babypark-catalog' },
  };
  const fake = systemdRunner([
    { LoadState: 'loaded', ActiveState: 'activating', User: 'babypark-catalog' },
    {
      LoadState: 'loaded',
      ActiveState: 'active',
      SubState: 'exited',
      User: 'babypark-catalog',
    },
    { LoadState: 'loaded', ActiveState: 'inactive' },
    { LoadState: 'loaded', ActiveState: 'inactive' },
  ]);
  let gates = 0;
  const value = await executeLinkASystemdUnit({
    built,
    unit: 'babypark-link-a-deadbeef',
    gatePath: '/work/gate',
    run: fake.run,
    sleep() {},
    writeGate() { gates += 1; },
    onCompleted: async show => show.SubState,
  });
  assert.equal(value, 'exited');
  assert.equal(gates, 1);
  assert.ok(fake.calls.some(([command, argv]) =>
    command === 'systemctl' && argv[0] === 'stop'));
  assert.ok(fake.calls.some(([command, argv]) =>
    command === 'systemctl' && argv[0] === 'reset-failed'));
});

test('systemd controller property mismatch never releases gate and still cleans', async () => {
  const built = { argv: ['systemd-run'], properties: { User: 'babypark-catalog' } };
  const fake = systemdRunner([
    { LoadState: 'loaded', ActiveState: 'activating', User: 'root' },
    { LoadState: 'loaded', ActiveState: 'inactive' },
    { LoadState: 'loaded', ActiveState: 'inactive' },
  ]);
  let gates = 0;
  await assert.rejects(executeLinkASystemdUnit({
    built,
    unit: 'babypark-link-a-deadbeef',
    gatePath: '/work/gate',
    run: fake.run,
    sleep() {},
    writeGate() { gates += 1; },
  }), /systemd property mismatch/);
  assert.equal(gates, 0);
  assert.ok(fake.calls.some(([command, argv]) =>
    command === 'systemctl' && argv[0] === 'stop'));
});

test('systemd controller bounds gate and execution waits', async () => {
  const built = { argv: ['systemd-run'], properties: { User: 'babypark-catalog' } };
  const gateTimeout = systemdRunner([
    { LoadState: 'loaded', ActiveState: 'inactive', User: 'babypark-catalog' },
    { LoadState: 'loaded', ActiveState: 'inactive', User: 'babypark-catalog' },
    { LoadState: 'loaded', ActiveState: 'inactive' },
    { LoadState: 'loaded', ActiveState: 'inactive' },
  ]);
  await assert.rejects(executeLinkASystemdUnit({
    built,
    unit: 'babypark-link-a-deadbeef',
    gatePath: '/work/gate',
    run: gateTimeout.run,
    sleep() {},
    writeGate() {},
    gatePolls: 2,
  }), /gated running state/);

  const executionTimeout = systemdRunner([
    { LoadState: 'loaded', ActiveState: 'activating', User: 'babypark-catalog' },
    { LoadState: 'loaded', ActiveState: 'active', SubState: 'running' },
    { LoadState: 'loaded', ActiveState: 'active', SubState: 'running' },
    { LoadState: 'loaded', ActiveState: 'inactive' },
    { LoadState: 'loaded', ActiveState: 'inactive' },
  ]);
  await assert.rejects(executeLinkASystemdUnit({
    built,
    unit: 'babypark-link-a-deadbeef',
    gatePath: '/work/gate',
    run: executionTimeout.run,
    sleep() {},
    writeGate() {},
    executionPolls: 2,
  }), /within 15 minutes/);
});

test('systemd controller exposes failed unit metrics but cleanup failure is fatal', async () => {
  const built = { argv: ['systemd-run'], properties: { User: 'babypark-catalog' } };
  const failed = systemdRunner([
    { LoadState: 'loaded', ActiveState: 'activating', User: 'babypark-catalog' },
    { LoadState: 'loaded', ActiveState: 'failed', Result: 'exit-code', ExecMainStatus: '1' },
    { LoadState: 'loaded', ActiveState: 'inactive' },
    { LoadState: 'loaded', ActiveState: 'inactive' },
  ]);
  const result = await executeLinkASystemdUnit({
    built,
    unit: 'babypark-link-a-deadbeef',
    gatePath: '/work/gate',
    run: failed.run,
    sleep() {},
    writeGate() {},
    onCompleted: async show => show.Result,
  });
  assert.equal(result, 'exit-code');

  const cleanupFailure = systemdRunner([
    { LoadState: 'loaded', ActiveState: 'activating', User: 'babypark-catalog' },
    { LoadState: 'loaded', ActiveState: 'active', SubState: 'exited' },
    { LoadState: 'loaded', ActiveState: 'inactive' },
    { LoadState: 'loaded', ActiveState: 'inactive' },
  ], { failures: { 'systemctl reset-failed': 1 } });
  await assert.rejects(executeLinkASystemdUnit({
    built,
    unit: 'babypark-link-a-deadbeef',
    gatePath: '/work/gate',
    run: cleanupFailure.run,
    sleep() {},
    writeGate() {},
  }), /cleanup failed/);

  const alreadyUnloaded = systemdRunner([
    { LoadState: 'loaded', ActiveState: 'activating', User: 'babypark-catalog' },
    { LoadState: 'loaded', ActiveState: 'active', SubState: 'exited' },
    { LoadState: 'loaded', ActiveState: 'inactive' },
    null,
  ], { failures: {
    'systemctl reset-failed': {
      status: 1,
      stderr: 'Failed to reset failed state of unit babypark-link-a-deadbeef.service: Unit babypark-link-a-deadbeef.service not loaded.\n',
    },
  } });
  const cleaned = await executeLinkASystemdUnit({
    built,
    unit: 'babypark-link-a-deadbeef',
    gatePath: '/work/gate',
    run: alreadyUnloaded.run,
    sleep() {},
    writeGate() {},
    onCompleted: async show => show.SubState,
  });
  assert.equal(cleaned, 'exited');
});

test('resource evidence cannot turn Link A PASS into unchanged authority evidence', () => {
  const acceptedRun = {
    run_id: 'run',
    run_digest: 'a'.repeat(64),
    final_seq: 9,
  };
  const before = {
    staged_spool_manifest_sha256: 'b'.repeat(64),
    staged_spool: { 'manifest.json': { size: 1, mode: 0o600, sha256: 'c'.repeat(64) } },
    catalog_generation: { size: 2, mode: 0o600, sha256: 'd'.repeat(64) },
    identity: { size: 3, mode: 0o600, sha256: 'e'.repeat(64) },
    current: { size: 4, mode: 0o600, sha256: 'f'.repeat(64), value: 'catalog.gen.sqlite\n' },
  };
  const report = {
    status: 'PASS',
    mismatch_count: 0,
    spool_manifest_sha256: before.staged_spool_manifest_sha256,
    generation: { generation_id: 'gen' },
    accepted_run: acceptedRun,
  };
  const probe = {
    health_readable: true,
    state_readable: true,
    generation_id: 'gen',
    accepted_run: acceptedRun,
  };
  const show = {
    User: 'babypark-catalog',
    Result: 'success',
    ExecMainStatus: '0',
    MemoryPeak: '1',
    CPUUsageNSec: '2',
    IOReadBytes: '3',
    IOWriteBytes: '4',
    ExecMainStartTimestampMonotonic: '1000',
    ExecMainExitTimestampMonotonic: '2000',
  };
  const common = {
    unit: 'babypark-link-a-deadbeef',
    show,
    effectiveProperties: { User: 'babypark-catalog' },
    linkAReport: report,
    linkAReportBytes: Buffer.from(JSON.stringify(report)),
    authorityBefore: before,
    probeBefore: probe,
    probeAfter: probe,
    expectedGenerationId: 'gen',
    acceptedRun,
  };
  assert.equal(resourceEvidence({ ...common, authorityAfter: structuredClone(before) }).status, 'PASS');
  const changed = structuredClone(before);
  changed.identity.sha256 = '0'.repeat(64);
  const evidence = resourceEvidence({ ...common, authorityAfter: changed });
  assert.equal(evidence.status, 'FAIL');
  assert.equal(evidence.guards.identity_unchanged, false);
});

test('resource runner probes health and authenticated state binding', async () => {
  const calls = [];
  const acceptedRun = { run_id: 'run', run_digest: 'a'.repeat(64), final_seq: 9 };
  const result = await probeCatalogReadability({
    origin: 'http://127.0.0.1:18081',
    expectedGenerationId: 'gen',
    acceptedRun,
    fetchImpl: async (url, options) => (
      calls.push([url, options]),
      { ok: true, status: 200 }
    ),
    client: {
      state: async () => ({
        status: 200,
        body: {
          schema: 'bp.catalog.state/1',
          state: 'CURRENT',
          current_generation: 'gen',
          accepted_run: acceptedRun,
        },
      }),
    },
  });
  assert.equal(result.generation_id, 'gen');
  assert.deepEqual(result.accepted_run, acceptedRun);
  assert.equal(calls[0][0], 'http://127.0.0.1:18081/health');
  await assert.rejects(probeCatalogReadability({
    origin: 'http://127.0.0.1:18081',
    expectedGenerationId: 'other',
    acceptedRun,
    fetchImpl: async () => ({ ok: true, status: 200 }),
    client: {
      state: async () => ({
        status: 200,
        body: {
          schema: 'bp.catalog.state/1',
          state: 'CURRENT',
          current_generation: 'gen',
          accepted_run: acceptedRun,
        },
      }),
    },
  }), /generation binding/);
});

test('remote-pull CLI rejects malformed or incomplete authority before transfer', () => {
  const result = spawnSync(process.execPath, [
    'scripts/catalog-link-a-pull.mjs',
    '--manifest-sha=bad',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).status, 'ERROR');
});

test('production index remains unaware of rehearsal environment', () => {
  assert.equal(
    fs.readFileSync('src/catalog/http/index.mjs', 'utf8').includes('BABYPARK_REHEARSAL'),
    false,
  );
});