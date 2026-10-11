import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CODE_EXTENSIONS = new Set(['.mjs', '.js', '.cjs', '.ts']);
const SKIP_DIRS = new Set(['node_modules', 'tests', 'test', 'fixtures', 'vendor']);

function collect(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(item.name)) continue;
    const abs = path.join(dir, item.name);
    if (item.isDirectory()) collect(abs, files);
    else if (item.isFile() && CODE_EXTENSIONS.has(path.extname(item.name))) files.push(abs);
  }
  return files;
}

function possibleOutboundPostCount(source) {
  // Deliberately a source-level tripwire, NOT a JS data-flow proof.
  // Every future public send must also have a real S1→S2→CAS→POST
  // injection/restart test and independently reviewed caller graph.
  return [...source.matchAll(/\bmethod\s*:\s*(['"`])POST\1/giu)].length;
}

function directMarkSendingCount(source) {
  return [...source.matchAll(/(?:\.\s*markActionSending|\[\s*(['"`])markActionSending\1\s*\])\s*\(/gu)].length;
}

test('send-boundary tripwire recognizes simple hidden HTTP POST/caller variants', () => {
  assert.equal(possibleOutboundPostCount("fetch(url,{method:'POST'})"), 1);
  assert.equal(possibleOutboundPostCount('fetch(url,{method : "post"})'), 1);
  assert.equal(possibleOutboundPostCount('jsonRequest(path,{ method: `POST` })'), 1);
  assert.equal(possibleOutboundPostCount("fetch(url,{method:'GET'})"), 0);
  assert.equal(directMarkSendingCount('store.markActionSending(id, token)'), 1);
  assert.equal(directMarkSendingCount('store [ "markActionSending" ](id)'), 1);
});

test('no unreviewed public POST/direct SENDING caller appears in tracked copilot source', () => {
  const copilot = collect(path.join(ROOT, 'src/copilot')).sort();
  assert.ok(copilot.length >= 40, 'unexpectedly missing source inventory');

  const postCallSites = [];
  const sendTransitions = [];
  for (const full of copilot) {
    const source = fs.readFileSync(full, 'utf8');
    const relative = path.relative(ROOT, full).split(path.sep).join('/');
    for (let i = 0; i < possibleOutboundPostCount(source); i++) postCallSites.push(relative);
    for (let i = 0; i < directMarkSendingCount(source); i++) sendTransitions.push(relative);

    // First Line cannot import the permissive pre-v4 status-toggle adapter.
    if (relative.startsWith('src/copilot/first-line-')) {
      assert.equal(/\bcreateAgentBotActionClient\b/u.test(source), false,
        'C6 must not import pre-v4 unsafe Chatwoot handoff from ' + relative);
    }
  }

  // There is currently NO native Chatwoot public-message POST; the two
  // existing POSTs are the legacy status-toggle method (not used by C6)
  // and the independent operator Knowledge UI. Any new POST *anywhere*
  // in the copilot sources makes this test fail for explicit review.
  assert.deepEqual(postCallSites.sort(), [
    'src/copilot/chatwoot-client.mjs',
    'src/copilot/knowledge-control/http.mjs',
  ]);
  assert.deepEqual(sendTransitions, [],
    'production cannot call removed unguarded markActionSending');
  for (const full of copilot) {
    const source = fs.readFileSync(full, 'utf8');
    assert.equal(/tests\/helpers\/(legacy-sending-fixture|legacy-public-action-gate-fixture)/u.test(source),
      false, 'production must never import test-only legacy SENDING fixtures');
  }
  const coordinatorSource = fs.readFileSync(
    path.join(ROOT, 'src/copilot/first-line-public-send-coordinator.mjs'), 'utf8'
  );
  assert.equal(
    [...coordinatorSource.matchAll(/\.postOutgoingMessage\s*\(/gu)].length, 1,
    'one reviewed public transport call site; no hidden retry branch'
  );
});
