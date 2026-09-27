import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { streamQueryToNdjson } from '../src/source/mariadb-snapshot.mjs';

test('streamQueryToNdjson closes query stream when row write fails', async () => {
  const outPath = path.join(os.tmpdir(), `stream-error-${Date.now()}.ndjson`);
  let closeCalls = 0;
  const stream = {
    async *[Symbol.asyncIterator]() {
      yield { ok: 1 };
      throw new Error('row processing failed');
    },
    close() {
      closeCalls += 1;
      return Promise.resolve();
    },
  };
  const conn = {
    queryStream() {
      return stream;
    },
  };

  await assert.rejects(
    () => streamQueryToNdjson(conn, 'SELECT 1', outPath),
    /row processing failed|ENOENT|EBADF/
  );
  assert.equal(closeCalls, 1);
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
});
