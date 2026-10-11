import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';
import { recoverFirstLinePublicSendWithoutTransientText } from
  '../../src/copilot/first-line-public-send-coordinator.mjs';

const child = fileURLToPath(new URL('../fixtures/first-line-coordinator-kill-child.mjs', import.meta.url));
const schedulerChild = fileURLToPath(
  new URL('../fixtures/first-line-postsend-scheduler-child.mjs', import.meta.url)
);
const NOW = 2_000_000_000_000;

for (const [mode, expectedPosts] of [
  ['KILL_AFTER_SENDING', 0],
  ['KILL_DURING_HTTP_RESPONSE', 1],
  ['KILL_AFTER_HTTP_RESPONSE', 1],
]) {
  test('real SIGKILL ' + mode + ' preserves no-repeat durable cut and actual POST count',
    { timeout: 30_000 }, async t => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-c6-kill-'));
      t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      const file = path.join(dir, 'episode.sqlite');
      let posts = 0;
      let childProcess = null;
      let serverAccepted = false;
      const server = http.createServer((req, res) => {
        if (req.method !== 'POST' || req.url !== '/fake-chatwoot') {
          res.writeHead(404).end(); return;
        }
        req.resume();
        req.on('end', () => {
          posts += 1;
          serverAccepted = true;
          if (mode === 'KILL_DURING_HTTP_RESPONSE') {
            // The child is blocked awaiting a response. Terminate it only
            // after server-side receipt, while the response is still withheld.
            childProcess?.kill('SIGKILL');
          } else {
            res.writeHead(201).end('accepted');
          }
        });
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      t.after(() => server.close());
      const port = server.address().port;
      const result = await new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, [child, file, mode, String(port)], {
          stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000,
        });
        childProcess = proc;
        let stderr = '';
        proc.stderr.on('data', bytes => { stderr += bytes; });
        proc.on('error', reject);
        proc.on('close', (code, signal) => resolve({ code, signal, stderr }));
      });
      assert.equal(result.signal, 'SIGKILL', JSON.stringify(result));
      assert.equal(posts, expectedPosts, 'actual loopback mock Chatwoot POST count');
      assert.equal(serverAccepted, expectedPosts > 0,
        'only the HTTP server may confirm acceptance, not client intent');
      const restarted = FirstLineStateStore.open(file, { now: () => NOW });
      t.after(() => restarted.close());
      const stream = restarted.findConversationStream({
        sourceProvider: 'chatwoot', sourceConversationId: 55,
      });
      const actionId = restarted.getUnresolvedContinuationOwner(stream.stream_id).action_id;
      const action = restarted.getPublicAction(actionId);
      assert.equal(action.state, 'SENDING');
      assert.equal(action.attempts, 1);
      assert.ok(action.send_started_at != null);
      assert.equal(restarted.claimNextPublicAction({
        leaseMs: 1_000, token: 'another-worker',
      }), null, 'restart may never claim a second POST for SENDING');
      // Invoke the actual runtime recovery function, not manual SQL/store
      // operations inside the test, on the independently reopened DB.
      // Cold-start the actual CP4 scheduler in a separate process.
      // Its startup sweep, rather than the test harness, performs the
      // SENDING -> UNCERTAIN -> absorbing HUMAN transition.
      const restartedScheduler = await new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, [schedulerChild, file], {
          stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000,
        });
        let stderr = '';
        proc.stderr.on('data', bytes => { stderr += bytes; });
        proc.on('error', reject);
        proc.on('close', (code, signal) => resolve({ code, signal, stderr }));
      });
      assert.equal(restartedScheduler.code, 0, restartedScheduler.stderr);
      assert.equal(restartedScheduler.signal, null);
      assert.match(restartedScheduler.stderr,
        /^(?:\(node:\d+\) ExperimentalWarning:[^\n]*\n(?:\(Use [^\n]*\)\n)?)?$/u);
      assert.equal(restarted.getPublicAction(actionId).state, 'UNCERTAIN');
      const recovered = recoverFirstLinePublicSendWithoutTransientText({
        store: restarted, actionId,
      });
      assert.equal(recovered.code, 'HUMAN_REQUIRED');
      assert.equal(recovered.reason, 'RESTART_EXACT_CONTENT_UNAVAILABLE');
      assert.equal(recovered.continuationOwner.owner_kind, 'HUMAN');
      assert.equal(restarted.claimNextPublicAction({
        leaseMs: 1_000, token: 'third-worker',
      }), null);
      assert.equal(posts, expectedPosts, 'neither reopen nor recovery sends again');
    });
}
