import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';

const child = fileURLToPath(new URL('../fixtures/first-line-coordinator-kill-child.mjs', import.meta.url));
const NOW = 2_000_000_000_000;

for (const [mode, expectedPosts] of [
  ['KILL_AFTER_SENDING', 0],
  ['KILL_AFTER_POST', 1],
]) {
  test('real SIGKILL ' + mode + ' preserves no-repeat durable cut and actual POST count',
    { timeout: 30_000 }, async t => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-c6-kill-'));
      t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      const file = path.join(dir, 'episode.sqlite');
      let posts = 0;
      const server = http.createServer((req, res) => {
        if (req.method !== 'POST' || req.url !== '/fake-chatwoot') {
          res.writeHead(404).end(); return;
        }
        posts += 1;
        req.resume();
        req.on('end', () => res.writeHead(201).end('accepted'));
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      t.after(() => server.close());
      const port = server.address().port;
      const result = await new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, [child, file, mode, String(port)], {
          stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000,
        });
        let stderr = '';
        proc.stderr.on('data', bytes => { stderr += bytes; });
        proc.on('error', reject);
        proc.on('close', (code, signal) => resolve({ code, signal, stderr }));
      });
      assert.equal(result.signal, 'SIGKILL', JSON.stringify(result));
      assert.equal(posts, expectedPosts, 'actual loopback mock Chatwoot POST count');
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
      const uncertain = restarted.markActionUncertain(actionId);
      assert.equal(uncertain.state, 'UNCERTAIN');
      const human = restarted.escalatePublicActionToHuman(actionId, {
        reason: 'send_outcome_unproven',
      });
      assert.equal(human.owner_kind, 'HUMAN');
      assert.equal(restarted.claimNextPublicAction({
        leaseMs: 1_000, token: 'third-worker',
      }), null);
      assert.equal(posts, expectedPosts, 'neither reopen nor recovery sends again');
    });
}
