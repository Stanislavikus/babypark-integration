#!/usr/bin/env node
/**
 * C6 PR #128 pre-fix synthetic characterization + bounded isolated ingress server.
 * TEST-ONLY: no production model, no Chatwoot core patch, no public reply POST.
 * Provenance: only run from an exact checkout of PR #128 HEAD
 * 565d8de08fbd8e85598e554cb91e59dfa4f8c1a4 plus this reviewed script.
 * Native end-to-end evidence must be collected separately from the isolated
 * Chatwoot Sidekiq webhook; local characterized cases are NOT native E2E proof.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import dns from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createSyntheticFirstLineAuthority } from './c6-pref-operator-bootstrap.mjs';
import { createFirstLineChatwootAuthorityReader } from '../src/copilot/chatwoot-client.mjs';
import { createFirstLineAgentBotRelay, createFirstLineAgentBotServer } from '../src/copilot/first-line-runtime-ingress.mjs';

const PINNED_SOURCE_HEAD = '565d8de08fbd8e85598e554cb91e59dfa4f8c1a4';
// A host-root-only PoC directory is bind-mounted into the unprivileged unit.
const SCRATCH_ROOT = process.env.BP_C6_POC_SCRATCH_ROOT || '/var/tmp/bp-c6poc-20261011/c6-synthetic';
if (!['/var/tmp/bp-c6poc-20261011/c6-synthetic','/run/bp-c6-poc/scratch'].includes(SCRATCH_ROOT)) {
  throw new Error('POC_SCRATCH_ROOT_OUTSIDE_FROZEN_SCOPE');
}
const NOW = 2_000_000_000_000;
const SENTINEL = 'SYNTHETIC-NO-CUSTOMER-CONTENT';
const TARGET = Object.freeze({ accountId: 11, inboxId: 99, agentBotId: 7 });
const SECRET = 'synthetic-local-only-hmac-never-prod';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVENT_OUTCOMES = new Set(['recorded', 'unsupported_recorded', 'duplicate_source', 'topology_recorded',
  'event_not_admitted', 'structured_update_unhandled', 'source_not_customer',
  'chatwoot_source_missing', 'chatwoot_authority_unavailable', 'chatwoot_authority_unprovable',
  'semantic_authority_unavailable', 'source_topology_changed', 'body_invalid', 'json_invalid',
  'invalid_signature', 'invalid_timestamp', 'timestamp_outside_replay_window',
  'invalid_delivery_id']);

function output(event, fields = {}) {
  // Only metadata and bounded predetermined reason codes; never raw payloads.
  process.stdout.write(`${JSON.stringify({ event, ...fields })}\n`);
}

function requirePinnedSource() {
  const git = (...args) => execFileSync('git', ['-c', `safe.directory=${REPO_ROOT}`, '-C', REPO_ROOT, ...args],
    { encoding: 'utf8', timeout: 4000 }).trim();
  const head = git('rev-parse', 'HEAD');
  if (head !== PINNED_SOURCE_HEAD) {
    // The test-only branch may have bounded amendments, but no PR #128 files
    // may be changed or silently substituted.
    const base = git('merge-base', PINNED_SOURCE_HEAD, head);
    assert.equal(base, PINNED_SOURCE_HEAD, 'C6_POC_SOURCE_ANCESTRY_MISMATCH');
    const changed = git('diff', '--name-only', PINNED_SOURCE_HEAD, head).split('\n').filter(Boolean);
    assert.deepEqual(changed.sort(), ['scripts/c6-pref-control.sh', 'scripts/c6-pref-deadman.sh', 'scripts/c6-pref-native-fixture.rb', 'scripts/c6-pref-operator-bootstrap.mjs', 'scripts/c6-pref-runner.mjs', 'tests/unit/first-line-no-lazy-db.test.mjs'], 'C6_POC_ONLY_TEST_FILES_ALLOWED');
  }
  const dirty = git('status', '--porcelain', '--untracked-files=no');
  assert.equal(dirty, '', 'C6_POC_TRACKED_WORKTREE_DIRTY');
  return head;
}

function sandboxPath(env) {
  assert.equal(env.BP_C6_SYNTHETIC_ONLY, 'yes', 'EXPLICIT_SYNTHETIC_SCOPE_REQUIRED');
  const raw = env.BP_C6_POC_DB_PATH;
  assert.ok(raw && path.isAbsolute(raw), 'ABSOLUTE_DB_PATH_REQUIRED');
  const resolved = path.resolve(raw);
  if (process.argv[2] === 'bootstrap-synthetic-db' && env.BP_C6_POC_PREPARE_ROOT_ONLY === 'yes') {
    assert.equal(resolved, '/var/tmp/bp-c6poc-20261011/c6-control/episode-staging.sqlite',
      'ROOT_ONLY_DB_BOOTSTRAP_PATH_REQUIRED');
    return resolved;
  }
  assert.ok(resolved.startsWith(SCRATCH_ROOT + '/') && resolved.endsWith('.sqlite'), 'DB_MUST_BE_IN_POC_SCRATCH');
  return resolved;
}

function signed(payload, delivery = 'synthetic-delivery') {
  const raw = Buffer.from(JSON.stringify(payload));
  const timestamp = String(NOW / 1000);
  const hmac = crypto.createHmac('sha256', SECRET).update(Buffer.concat([Buffer.from(`${timestamp}.`), raw])).digest('hex');
  return { raw, headers: { 'x-chatwoot-delivery': delivery, 'x-chatwoot-timestamp': timestamp, 'x-chatwoot-signature': `sha256=${hmac}` } };
}

function eventWire({ id = 101, messageType = 'incoming', kind = 'message_created', privateMessage = false, sender = { id: 9001 }, contentType = 'text' } = {}) {
  return { event: kind, id, message_type: messageType, private: privateMessage,
    sender, account: { id: 11 }, inbox: { id: 99 }, conversation: { id: 55, inbox_id: 99 },
    content_type: contentType, content: SENTINEL };
}
function restRow({ id = 101, messageType = 0, privateMessage = false, sender = { id: 9001, type: 'Contact' }, contentType = 'text' } = {}) {
  return { id, message_type: messageType, private: privateMessage, sender,
    content_type: contentType, content: SENTINEL, attachments: [], source_id: null, content_attributes: {} };
}
function makeReader(rows) {
  return createFirstLineChatwootAuthorityReader({
    baseUrl: 'https://synthetic.invalid', accountId: 11, configuredAgentBotId: 7,
    readToken: 'synthetic-no-production-read', requestTimeoutMs: 250,
    fetchImpl: async url => {
      const u = new URL(url);
      const id = Number(u.searchParams.get('after'));
      return Response.json({ payload: rows.has(id) ? [rows.get(id)] : [] });
    },
  });
}

async function characterize() {
  // No Docker, network or production credentials; all cases use metadata-only
  // synthetic REST fixtures and one disposable SQLite per class.
  requirePinnedSource();
  const results = [];
  async function check(id, label, run) {
    // Explicit sandbox scratch for any authorized host run; local probes may use
    // their private OS temp. No production/customer state is ever read.
    const dir = process.env.BP_C6_POC_SCRATCH_DIR || os.tmpdir();
    if (process.env.BP_C6_POC_SCRATCH_DIR) {
      assert.ok(path.resolve(dir).startsWith(SCRATCH_ROOT + '/'), 'CHARACTERIZE_SCRATCH_SCOPE');
    }
    const root = fs.mkdtempSync(path.join(dir, 'bp-c6-pref-'));
    const dbPath = path.join(root, 'episode.sqlite');
    let relay;
    try {
      createSyntheticFirstLineAuthority({ file: dbPath, mode: 'characterize', now: () => NOW });
      const rows = new Map();
      relay = createFirstLineAgentBotRelay({ dbPath, authorityReader: makeReader(rows), webhookSecret: SECRET,
        ...TARGET, nowMs: () => NOW });
      const observations = await run({ rows, relay, dbPath });
      const found = observations.filter(x => x.actual !== x.expected);
      const result = { id, label, source: 'synthetic-local-not-native', status: found.length ? 'REPRODUCED_DEFECT' : 'PASS_LOCAL_ONLY',
        observations };
      results.push(result); output('case', result);
    } catch (e) {
      const result = { id, label, status: 'ERROR', error: String(e.code || e.message).slice(0,100) };
      results.push(result); output('case', result);
    } finally { relay?.close(); fs.rmSync(root, { recursive: true, force: true }); }
  }
  await check('X1', 'signed incoming durable ACK', async ({ rows, relay }) => {
    rows.set(101, restRow());
    const a = await relay.receive(signed(eventWire(), 'x1-one'));
    const b = await relay.receive(signed(eventWire(), 'x1-replay'));
    return [{ expected: 200, actual: a.status, outcome: a.outcome }, { expected: 200, actual: b.status, outcome: b.outcome }];
  });
  await check('X2', 'native-form agent_bot public echo', async ({ rows, relay }) => {
    rows.set(102, restRow({ id: 102, messageType: 1, sender: { id: 7, type: 'agent_bot' } }));
    const a = await relay.receive(signed(eventWire({ id: 102, messageType: 'outgoing', sender: { id: 7, type: 'agent_bot' } }), 'x2-echo'));
    return [{ expected: 200, actual: a.status, outcome: a.outcome }];
  });
  await check('X3', 'Email Collect template created and updated', async ({ rows, relay }) => {
    rows.set(103, restRow({ id: 103, messageType: 3, sender: null, contentType: 'input_email' }));
    const msg = eventWire({ id: 103, messageType: 'template', sender: null, contentType: 'input_email' });
    const a = await relay.receive(signed(msg, 'x3-created'));
    const b = await relay.receive(signed({ ...msg, event: 'message_updated' }, 'x3-updated'));
    return [{ expected: 200, actual: a.status, outcome: a.outcome }, { expected: 200, actual: b.status, outcome: b.outcome }];
  });
  await check('X4', 'private note and human public blocker', async ({ rows, relay }) => {
    rows.set(104, restRow({ id: 104, messageType: 1, privateMessage: true, sender: { type: 'User', id: 12 } }));
    const a = await relay.receive(signed(eventWire({ id: 104, messageType: 'outgoing', privateMessage: true, sender: { type: 'user', id: 12 } }), 'x4-private'));
    rows.set(105, restRow({ id: 105, messageType: 1, sender: { type: 'User', id: 12 } }));
    const b = await relay.receive(signed(eventWire({ id: 105, messageType: 'outgoing', sender: { type: 'user', id: 12 } }), 'x4-human'));
    return [{ expected: 200, actual: a.status, outcome: a.outcome }, { expected: 200, actual: b.status, outcome: b.outcome }];
  });
  await check('X5', 'incoming message_updated', async ({ rows, relay }) => {
    rows.set(106, restRow({ id: 106 }));
    const a = await relay.receive(signed(eventWire({ id: 106, kind: 'message_updated' }), 'x5-updated'));
    return [{ expected: 200, actual: a.status, outcome: a.outcome }];
  });
  // Injection tests are against BabyPark's READ adapter, not Chatwoot's
  // Sidekiq POST retry policy. Unknown/timeout responses must fail closed.
  await check('X7', 'injected Chatwoot REST 429/500/503 and timeout', async ({ dbPath }) => {
    const observations = [];
    for (const fault of [429, 500, 503, 'timeout']) {
      const reader = createFirstLineChatwootAuthorityReader({
        baseUrl: 'https://synthetic.invalid', accountId: 11,
        configuredAgentBotId: 7, readToken: 'synthetic-only-read', requestTimeoutMs: 250,
        fetchImpl: async () => {
          if (fault === 'timeout') throw new Error('synthetic-transport-timeout');
          return new Response('{}', { status: fault });
        },
      });
      const faultRelay = createFirstLineAgentBotRelay({ dbPath, authorityReader: reader,
        webhookSecret: SECRET, ...TARGET, nowMs: () => NOW });
      try {
        const result = await faultRelay.receive(signed(eventWire({ id: 107 }), `x7-${fault}`));
        observations.push({ fault: String(fault), expected: 503, actual: result.status, outcome: result.outcome });
      } finally { faultRelay.close(); }
    }
    return observations;
  });
  // The full deferred-parent and restart/public-send/human-alert E2E
  // orchestration is NOT EXPORTED by this pre-fix ingress-only executable.
  const gap = { id: 'X6', label: 'deferred SENDING and late echo with exact Chatwoot',
    status: 'NOT_WIRED', source: 'static-inventory', reason: 'NO_COMPLETE_SYNTHETIC_C6_DISPATCHER_PROVEN' };
  results.push(gap); output('case', gap);
  output('summary', { total: results.length,
    defects: results.filter(x => x.status === 'REPRODUCED_DEFECT').length,
    notWired: results.filter(x => x.status === 'NOT_WIRED').length,
    error: results.filter(x => x.status === 'ERROR').length,
    nativeChatwootE2E: 'NOT_RUN' });
  if (results.some(x => x.status !== 'PASS_LOCAL_ONLY')) process.exitCode = 2;
}

async function nativePreflight(env) {
  requirePinnedSource();
  const file = sandboxPath(env);
  assert.equal(env.BP_C6_POC_CHATWOOT_BASE_URL, 'http://rails:3000', 'ONLY_ISOLATED_RAILS_URL_ALLOWED');
  assert.ok(/^[0-9]{1,9}$/.test(env.BP_C6_POC_ACCOUNT_ID || ''), 'ACCOUNT_ID_REQUIRED');
  assert.ok(/^[0-9]{1,9}$/.test(env.BP_C6_POC_INBOX_ID || ''), 'INBOX_ID_REQUIRED');
  assert.ok(/^[0-9]{1,9}$/.test(env.BP_C6_POC_BOT_ID || ''), 'BOT_ID_REQUIRED');
  assert.ok((env.BP_C6_POC_READ_TOKEN || '').length >= 16, 'SYNTHETIC_READ_TOKEN_REQUIRED');
  assert.ok((env.BP_C6_POC_HMAC_SECRET || '').length >= 32, 'NEW_HMAC_SECRET_REQUIRED');
  const ns = fs.readlinkSync('/proc/self/ns/net');
  const expected = env.BP_C6_POC_SIDEKIQ_NETNS;
  assert.match(expected || '', /^net:\[\d+\]$/, 'EXPECTED_SIDEKIQ_NETNS_REQUIRED');
  assert.equal(ns, expected, 'NETWORK_NAMESPACE_MISMATCH');
  // /proc/<root pid>/ns/net is not readable by this unprivileged process.
  // The root-owned systemd control/guard positively checks both namespaces.
  assert.match(env.BP_C6_POC_HOST_NETNS || '', /^net:\[\d+\]$/, 'VERIFIED_HOST_NETNS_REQUIRED');
  assert.notEqual(ns, env.BP_C6_POC_HOST_NETNS, 'HOST_NAMESPACE_FORBIDDEN');
  const pid = Number(env.BP_C6_POC_SIDEKIQ_HOST_PID);
  assert.ok(Number.isSafeInteger(pid) && pid > 1, 'SIDEKIQ_HOST_PID_REQUIRED');
  assert.equal(SCRATCH_ROOT, '/run/bp-c6-poc/scratch', 'UNPRIVILEGED_BIND_SCRATCH_REQUIRED');
  assert.equal(REPO_ROOT, '/run/bp-c6-poc/source', 'UNPRIVILEGED_BIND_SOURCE_REQUIRED');
  // Root-owned, independent periodic guard monitors Sidekiq PID + netns.
  // Reading this proc link here would fail with EACCES for Sidekiq UID root.
  assert.ok(fs.existsSync(file), 'SYNTHETIC_DB_MISSING_BOOTSTRAP_EXPLICITLY');
  // DNS inside Sidekiq's netns requires Docker's /etc/resolv.conf *mount* as
  // well. The service is required to bind it read-only, otherwise FAIL CLOSED.
  const lookup = await dns.lookup('rails', { family: 4 });
  assert.ok(/^\d{1,3}(?:\.\d{1,3}){3}$/.test(env.BP_C6_POC_RAILS_IP || ''),
    'PINNED_RAILS_IP_REQUIRED');
  assert.equal(lookup.address, env.BP_C6_POC_RAILS_IP, 'ISOLATED_DOCKER_DNS_MISMATCH');
  assert.notEqual(lookup.address, '127.0.0.1', 'RAILS_IP_LOOPBACK_FORBIDDEN');
  const port = Number(env.BP_C6_POC_PORT || '3107');
  assert.ok(Number.isSafeInteger(port) && port >= 1024 && port <= 65535, 'POC_PORT_INVALID');
  return { file, ns, pid, port };
}

async function serve() {
  const env = process.env;
  const { file, ns, pid, port } = await nativePreflight(env);
  const reader = createFirstLineChatwootAuthorityReader({
    baseUrl: 'http://rails:3000', accountId: Number(env.BP_C6_POC_ACCOUNT_ID),
    readToken: env.BP_C6_POC_READ_TOKEN,
    configuredAgentBotId: Number(env.BP_C6_POC_BOT_ID), requestTimeoutMs: 1500,
  });
  const relay = createFirstLineAgentBotRelay({ dbPath: file, authorityReader: reader,
    webhookSecret: env.BP_C6_POC_HMAC_SECRET,
    accountId: Number(env.BP_C6_POC_ACCOUNT_ID),
    inboxId: Number(env.BP_C6_POC_INBOX_ID), agentBotId: Number(env.BP_C6_POC_BOT_ID),
  });
  // The original HTTP server has no telemetry hook. Instrument receive(),
  // without logging raw webhook body, headers, client IDs or messages.
  const counters = new Map();
  const wrapped = Object.freeze({ receive: async request => {
    const result = await relay.receive(request);
    const outcome = EVENT_OUTCOMES.has(result.outcome) ? result.outcome : 'other';
    const key = `${result.status}:${outcome}`;
    counters.set(key, (counters.get(key) || 0) + 1);
    output('webhook_ack', { status: result.status, outcome, count: counters.get(key) });
    return result;
  }, close: () => relay.close() });
  const server = createFirstLineAgentBotServer(wrapped);
  let closing = false;
  const watchdog = setInterval(() => {
    try {
      assert.equal(fs.readlinkSync('/proc/self/ns/net'), ns);
      // Sidekiq PID/namespace lifecycle is verified by the independent root guard.
      // A stale root identity causes the guard to stop the receiver.
      assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), env.BP_C6_POC_HOST_NETNS);
    } catch { output('sidekiq_namespace_changed'); close(); process.exitCode = 20; }
  }, 1000);
  const deadline = setTimeout(() => { output('poc_ttl_expired'); close(); process.exitCode = 21; }, 3 * 60 * 60 * 1000);
  const close = () => {
    if (closing) return;
    closing = true; clearInterval(watchdog); clearTimeout(deadline);
    server.close(() => { relay.close(); output('ingress_stopped', { counts: Object.fromEntries(counters) }); });
    server.closeAllConnections();
    // Do not leave the Node event loop alive behind a dead watchdog timer.
    setTimeout(() => { process.exitCode ||= 22; }, 2000).unref();
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
  server.listen(port, '127.0.0.1', () => output('sandbox_ingress_listening', { port, namespace: ns, nativeChatwootE2E: 'PENDING' }));
}

const command = process.argv[2];
if (command === 'characterize') await characterize();
else if (command === 'serve') await serve();
else { output('usage', { commands: ['characterize', 'serve'] }); process.exitCode = 64; }
