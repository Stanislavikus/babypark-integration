import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BUSY_TIMEOUT_MS, EpisodeStore, EpisodeStoreError } from '../../src/copilot/episode-store.mjs';

const NOW = 2_000_000_000_000;
const PRODUCT_1 = 'prod_11111111-1111-4111-8111-111111111111';
const PRODUCT_2 = 'prod_22222222-2222-4222-8222-222222222222';
const STORE_1 = 'store_11111111-1111-4111-8111-111111111111';
const STORE_2 = 'store_22222222-2222-4222-8222-222222222222';
const BRAND_1 = 'brand_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BRAND_2 = 'brand_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const CATEGORY_1 = 'cat_cccccccccccccccccccccccccccccccc';
const variantId = index => `var_${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
const VARIANT_1 = variantId(1);
const VARIANT_2 = variantId(2);

function tempEpisodeStore(t, { now = () => NOW, idFactory = () => 'episode-1' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'episode-store-'));
  const file = path.join(dir, 'episode.sqlite');
  const store = EpisodeStore.create(file, { now, idFactory });
  t.after(() => {
    try { store.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { store, file, dir };
}

function expectCode(fn, code) {
  assert.throws(fn, error => error instanceof EpisodeStoreError && error.code === code);
}

const CHILD_WRITER = String.raw`import fs from 'node:fs';
const { EpisodeStore } = await import(process.env.EPISODE_STORE_MODULE);
const wait = new Int32Array(new SharedArrayBuffer(4));
while (!fs.existsSync(process.env.EPISODE_SIGNAL)) Atomics.wait(wait, 0, 0, 5);
const store = EpisodeStore.open(process.env.EPISODE_DB, {
  now: () => Number(process.env.EPISODE_NOW),
  idFactory: () => 'episode-child',
});
try {
  if (process.env.EPISODE_ACTION === 'replace') {
    store.closeEpisode(process.env.EPISODE_ID, { reason: 'replaced', expectedVersion: 1 });
    store.beginEpisode({
      conversationId: 55,
      sourceMessageId: 200,
      stableSlots: { product_id: 'prod_22222222-2222-4222-8222-222222222222' },
    });
  } else if (process.env.EPISODE_ACTION === 'clarify') {
    store.recordClarificationPrompt(
      process.env.EPISODE_ID,
      {
        requestedSlot: 'store_id',
        presentedCandidates: [{ slot: 'store_id', value: 'store_11111111-1111-4111-8111-111111111111' }],
      },
      { expectedVersion: 1 }
    );
  } else {
    throw new Error('unknown child action');
  }
  fs.writeFileSync(process.env.EPISODE_DONE, 'done');
} finally {
  store.close();
}`;

function spawnEpisodeWriter({ file, signal, done, episodeId, action }) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', CHILD_WRITER], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      EPISODE_STORE_MODULE: new URL('../../src/copilot/episode-store.mjs', import.meta.url).href,
      EPISODE_DB: file,
      EPISODE_SIGNAL: signal,
      EPISODE_DONE: done,
      EPISODE_ID: episodeId,
      EPISODE_ACTION: action,
      EPISODE_NOW: String(NOW + 1),
    },
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', chunk => stdout.push(chunk));
  child.stderr.on('data', chunk => stderr.push(chunk));
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signalName) => {
      if (code === 0) resolve();
      else reject(new Error(
        `episode child failed code=${code} signal=${signalName} stdout=${Buffer.concat(stdout)} stderr=${Buffer.concat(stderr)}`
      ));
    });
  });
  return { child, exited };
}

function pauseAfterFirstGet(store, sqlNeedle, signal, done) {
  const originalPrepare = store.db.prepare.bind(store.db);
  let armed = true;
  store.db.prepare = sql => {
    const statement = originalPrepare(sql);
    if (armed && String(sql).includes(sqlNeedle)) {
      const originalGet = statement.get.bind(statement);
      statement.get = (...args) => {
        const row = originalGet(...args);
        armed = false;
        fs.writeFileSync(signal, 'go');
        const wait = new Int32Array(new SharedArrayBuffer(4));
        Atomics.wait(wait, 0, 0, 300);
        assert.equal(fs.existsSync(done), false,
          'writer committed while public read snapshot was still in progress');
        return row;
      };
    }
    return statement;
  };
  return () => { store.db.prepare = originalPrepare; };
}

test('episode store is durable, private-mode SQLite with one active episode per conversation', t => {
  let nextId = 1;
  const { store, file } = tempEpisodeStore(t, { idFactory: () => `episode-${nextId++}` });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(store.db.prepare('PRAGMA busy_timeout').get().timeout, BUSY_TIMEOUT_MS);

  const first = store.beginEpisode({
    conversationId: 55,
    sourceMessageId: 101,
    stableSlots: { product_id: PRODUCT_1, store_id: STORE_1 },
  });
  assert.equal(first.state, 'active');
  assert.equal(first.version, 1);
  assert.deepEqual(first.source_message_ids, [101]);
  assert.deepEqual(first.stable_slots, { product_id: PRODUCT_1, store_id: STORE_1 });
  assert.equal(first.clarification_prompts_sent, 0);

  expectCode(() => store.beginEpisode({ conversationId: 55, sourceMessageId: 102 }), 'EPISODE_ACTIVE_EXISTS');
  const closed = store.closeEpisode(first.episode_id, { reason: 'replaced', expectedVersion: 1 });
  assert.equal(closed.state, 'closed');
  assert.equal(closed.version, 2);
  assert.equal(store.loadActive(55), null);

  const second = store.beginEpisode({ conversationId: 55, sourceMessageId: 102 });
  assert.equal(second.episode_id, 'episode-2');
  assert.deepEqual(second.source_message_ids, [102]);
});

test('source message ids are idempotent and strictly monotonic inside an episode', t => {
  const { store } = tempEpisodeStore(t);
  let episode = store.beginEpisode({ conversationId: 55, sourceMessageId: 101 });

  const duplicate = store.appendSourceMessage(episode.episode_id, 101, { expectedVersion: 1 });
  assert.equal(duplicate.version, 1);
  assert.deepEqual(duplicate.source_message_ids, [101]);

  episode = store.appendSourceMessage(episode.episode_id, 105, { expectedVersion: 1 });
  assert.equal(episode.version, 2);
  assert.deepEqual(episode.source_message_ids, [101, 105]);

  expectCode(
    () => store.appendSourceMessage(episode.episode_id, 104, { expectedVersion: 2 }),
    'EPISODE_MESSAGE_OUT_OF_ORDER'
  );
  assert.deepEqual(store.getEpisode(episode.episode_id).source_message_ids, [101, 105]);
});

test('stable slots are allowlisted canonical customer selections only', t => {
  const { store } = tempEpisodeStore(t);
  let episode = store.beginEpisode({
    conversationId: 55,
    sourceMessageId: 101,
    stableSlots: {
      category_id: CATEGORY_1,
      brand_id: BRAND_1,
      min_price_minor: 2_000_000,
      currency: 'UAH',
    },
  });

  assert.deepEqual(episode.stable_slots, {
    brand_id: BRAND_1,
    category_id: CATEGORY_1,
    currency: 'UAH',
    min_price_minor: 2_000_000,
  });

  episode = store.setStableSlots(
    episode.episode_id,
    { brand_id: BRAND_2, category_id: null, max_price_minor: 3_000_000 },
    { expectedVersion: 1 }
  );
  assert.equal(episode.version, 2);
  assert.deepEqual(episode.stable_slots, {
    brand_id: BRAND_2,
    currency: 'UAH',
    max_price_minor: 3_000_000,
    min_price_minor: 2_000_000,
  });

  for (const forbidden of [
    { category_match_mode: 'INCLUDE_DESCENDANTS' },
    { current_price_minor: 123 },
    { stock_qty: 2 },
    { catalog_freshness: 'fresh' },
    { policy_effect: 'approved' },
    { operational_now: 'open' },
    { customer_body: 'DO NOT STORE customer body' },
  ]) {
    expectCode(
      () => store.setStableSlots(episode.episode_id, forbidden, { expectedVersion: 2 }),
      'EPISODE_SLOT_UNSUPPORTED'
    );
  }
});

test('canonical identity slots reject provider IDs, free-form tokens and cross-domain IDs', t => {
  const { store, file } = tempEpisodeStore(t);
  const episode = store.beginEpisode({ conversationId: 55, sourceMessageId: 101 });
  const freeText = 'kolyaska-dlya-6-mesyacev-NE-cybex';

  for (const patch of [
    { product_id: 79252 },
    { category_id: freeText },
    { variant_id: 'cat_0123abcd' },
  ]) {
    expectCode(
      () => store.setStableSlots(episode.episode_id, patch, { expectedVersion: 1 }),
      'EPISODE_VALUE_INVALID'
    );
  }

  for (const candidate of [
    { slot: 'product_id', value: 79252 },
    { slot: 'category_id', value: freeText },
    { slot: 'variant_id', value: 'cat_0123abcd' },
  ]) {
    expectCode(
      () => store.recordClarificationPrompt(
        episode.episode_id,
        { requestedSlot: candidate.slot, presentedCandidates: [candidate] },
        { expectedVersion: 1 }
      ),
      'EPISODE_VALUE_INVALID'
    );
  }

  const accepted = store.setStableSlots(
    episode.episode_id,
    { product_id: PRODUCT_1, category_id: CATEGORY_1, brand_id: BRAND_1, store_id: STORE_1 },
    { expectedVersion: 1 }
  );
  assert.equal(accepted.version, 2);
  assert.deepEqual(accepted.stable_slots, {
    brand_id: BRAND_1,
    category_id: CATEGORY_1,
    product_id: PRODUCT_1,
    store_id: STORE_1,
  });
  assert.equal(fs.readFileSync(file).includes(Buffer.from(freeText)), false);
});

test('Chatwoot conversation and source message IDs reject coercive integer inputs', t => {
  const { store } = tempEpisodeStore(t);
  const invalid = [true, '0x10', [21], ' 7 ', '1e3', '7'];

  for (const value of invalid) {
    expectCode(
      () => store.beginEpisode({ conversationId: value, sourceMessageId: 1 }),
      'EPISODE_VALUE_INVALID'
    );
    expectCode(
      () => store.beginEpisode({ conversationId: 1, sourceMessageId: value }),
      'EPISODE_VALUE_INVALID'
    );
    expectCode(() => store.loadActive(value), 'EPISODE_VALUE_INVALID');
  }

  assert.equal(store.loadActive(1), null);
  const episode = store.beginEpisode({ conversationId: 1, sourceMessageId: 1 });
  for (const value of invalid) {
    expectCode(
      () => store.appendSourceMessage(episode.episode_id, value, { expectedVersion: 1 }),
      'EPISODE_VALUE_INVALID'
    );
  }
  const unchanged = store.getEpisode(episode.episode_id);
  assert.equal(unchanged.version, 1);
  assert.deepEqual(unchanged.source_message_ids, [1]);
});

test('conversation message watermark prevents replay across episodes and survives episode cleanup', t => {
  let next = 1;
  const { store } = tempEpisodeStore(t, { idFactory: () => `watermark-episode-${next++}` });
  let first = store.beginEpisode({ conversationId: 700, sourceMessageId: 3 });
  first = store.recordClarificationPrompt(
    first.episode_id,
    { requestedSlot: 'store_id', presentedCandidates: [{ slot: 'store_id', value: STORE_1 }] },
    { expectedVersion: 1 }
  );
  store.closeEpisode(first.episode_id, { reason: 'human', expectedVersion: 2 });

  expectCode(
    () => store.beginEpisode({ conversationId: 700, sourceMessageId: 3 }),
    'EPISODE_MESSAGE_ALREADY_CONSUMED'
  );
  expectCode(
    () => store.beginEpisode({ conversationId: 700, sourceMessageId: 1 }),
    'EPISODE_MESSAGE_ALREADY_CONSUMED'
  );

  let second = store.beginEpisode({ conversationId: 700, sourceMessageId: 4 });
  assert.equal(second.clarification_prompts_sent, 0);
  second = store.appendSourceMessage(second.episode_id, 6, { expectedVersion: 1 });
  assert.deepEqual(second.source_message_ids, [4, 6]);
  store.closeEpisode(second.episode_id, { reason: 'completed', expectedVersion: 2 });

  const watermark = store.db.prepare(
    'SELECT max_message_id FROM conversation_message_watermarks WHERE conversation_id=?'
  ).get(700);
  assert.equal(watermark.max_message_id, 6);

  store.db.prepare("DELETE FROM episodes WHERE conversation_id=? AND state='closed'").run(700);
  assert.equal(store.db.prepare('SELECT COUNT(*) count FROM episodes WHERE conversation_id=?').get(700).count, 0);
  assert.equal(
    store.db.prepare('SELECT max_message_id FROM conversation_message_watermarks WHERE conversation_id=?').get(700).max_message_id,
    6
  );

  for (const messageId of [3, 5, 6]) {
    expectCode(
      () => store.beginEpisode({ conversationId: 700, sourceMessageId: messageId }),
      'EPISODE_MESSAGE_ALREADY_CONSUMED'
    );
  }
  const third = store.beginEpisode({ conversationId: 700, sourceMessageId: 7 });
  assert.deepEqual(third.source_message_ids, [7]);
  assert.equal(third.clarification_prompts_sent, 0);
});

test('clarification prompt is recorded once; clearing context never resets the budget', t => {
  const { store } = tempEpisodeStore(t);
  let episode = store.beginEpisode({ conversationId: 55, sourceMessageId: 101 });
  episode = store.recordClarificationPrompt(
    episode.episode_id,
    {
      requestedSlot: 'store_id',
      presentedCandidates: [
        { slot: 'store_id', value: STORE_1 },
        { slot: 'store_id', value: STORE_2 },
      ],
    },
    { expectedVersion: 1 }
  );

  assert.equal(episode.version, 2);
  assert.equal(episode.clarification_prompts_sent, 1);
  assert.equal(episode.requested_slot, 'store_id');
  assert.deepEqual(episode.presented_candidates, [
    { slot: 'store_id', value: STORE_1 },
    { slot: 'store_id', value: STORE_2 },
  ]);

  episode = store.clearClarificationContext(episode.episode_id, { expectedVersion: 2 });
  assert.equal(episode.version, 3);
  assert.equal(episode.requested_slot, null);
  assert.deepEqual(episode.presented_candidates, []);
  assert.equal(episode.clarification_prompts_sent, 1);

  expectCode(
    () => store.recordClarificationPrompt(
      episode.episode_id,
      { requestedSlot: 'brand_id', presentedCandidates: [] },
      { expectedVersion: 3 }
    ),
    'EPISODE_CLARIFICATION_LIMIT_REACHED'
  );
});

test('candidate storage accepts canonical values only and never presentation labels or raw bodies', t => {
  const { store, file } = tempEpisodeStore(t);
  const episode = store.beginEpisode({ conversationId: 55, sourceMessageId: 101 });
  const sentinel = 'DO NOT STORE customer body with spaces';

  expectCode(
    () => store.recordClarificationPrompt(
      episode.episode_id,
      { requestedSlot: 'store_id', presentedCandidates: [{ slot: 'store_id', value: sentinel }] },
      { expectedVersion: 1 }
    ),
    'EPISODE_VALUE_INVALID'
  );
  expectCode(
    () => store.recordClarificationPrompt(
      episode.episode_id,
      { requestedSlot: 'store_id', presentedCandidates: [{ slot: 'store_id', value: STORE_1, label: sentinel }] },
      { expectedVersion: 1 }
    ),
    'EPISODE_CANDIDATE_INVALID'
  );

  store.close();
  assert.equal(fs.readFileSync(file).includes(Buffer.from(sentinel)), false);
});

test('every episode mutation requires an explicit optimistic expectedVersion', t => {
  const { store } = tempEpisodeStore(t);
  const episode = store.beginEpisode({ conversationId: 55, sourceMessageId: 101 });

  expectCode(() => store.appendSourceMessage(episode.episode_id, 102), 'EPISODE_EXPECTED_VERSION_REQUIRED');
  expectCode(() => store.setStableSlots(episode.episode_id, { product_id: PRODUCT_1 }),
    'EPISODE_EXPECTED_VERSION_REQUIRED');
  expectCode(
    () => store.recordClarificationPrompt(
      episode.episode_id,
      { requestedSlot: 'store_id', presentedCandidates: [] }
    ),
    'EPISODE_EXPECTED_VERSION_REQUIRED'
  );
  expectCode(() => store.clearClarificationContext(episode.episode_id),
    'EPISODE_EXPECTED_VERSION_REQUIRED');
  expectCode(() => store.closeEpisode(episode.episode_id, { reason: 'completed' }),
    'EPISODE_EXPECTED_VERSION_REQUIRED');

  const unchanged = store.getEpisode(episode.episode_id);
  assert.equal(unchanged.version, 1);
  assert.deepEqual(unchanged.source_message_ids, [101]);
  assert.deepEqual(unchanged.stable_slots, {});
  assert.equal(unchanged.state, 'active');
});

test('presented candidate persistence has a hard durable bound', t => {
  const { store } = tempEpisodeStore(t);
  const episode = store.beginEpisode({ conversationId: 55, sourceMessageId: 101 });
  const candidates = Array.from({ length: 21 }, (_, index) => ({
    slot: 'variant_id',
    value: variantId(index + 1),
  }));

  expectCode(
    () => store.recordClarificationPrompt(
      episode.episode_id,
      { requestedSlot: 'variant_id', presentedCandidates: candidates },
      { expectedVersion: 1 }
    ),
    'EPISODE_CANDIDATE_LIMIT_EXCEEDED'
  );
  assert.equal(store.getEpisode(episode.episode_id).clarification_prompts_sent, 0);
});

test('loadActive returns one committed snapshot while another process replaces the active episode', async t => {
  let next = 1;
  const { store, file, dir } = tempEpisodeStore(t, { idFactory: () => `episode-${next++}` });
  const first = store.beginEpisode({
    conversationId: 55,
    sourceMessageId: 101,
    stableSlots: { product_id: PRODUCT_1 },
  });
  const signal = path.join(dir, 'load-active.signal');
  const done = path.join(dir, 'load-active.done');
  const writer = spawnEpisodeWriter({
    file,
    signal,
    done,
    episodeId: first.episode_id,
    action: 'replace',
  });
  t.after(() => { try { writer.child.kill('SIGKILL'); } catch {} });

  const restore = pauseAfterFirstGet(
    store,
    "SELECT episode_id FROM episodes WHERE conversation_id=? AND state='active'",
    signal,
    done
  );
  let observed;
  try {
    observed = store.loadActive(55);
  } finally {
    restore();
  }

  assert.equal(observed.state, 'active');
  assert.ok([PRODUCT_1, PRODUCT_2].includes(observed.stable_slots.product_id));
  await writer.exited;
  assert.equal(fs.existsSync(done), true);

  const current = store.loadActive(55);
  assert.equal(current.episode_id, 'episode-child');
  assert.equal(current.state, 'active');
  assert.equal(current.stable_slots.product_id, PRODUCT_2);
});

test('getEpisode never mixes row metadata with child rows from a later commit', async t => {
  const { store, file, dir } = tempEpisodeStore(t);
  const episode = store.beginEpisode({ conversationId: 55, sourceMessageId: 101 });
  const signal = path.join(dir, 'get-episode.signal');
  const done = path.join(dir, 'get-episode.done');
  const writer = spawnEpisodeWriter({
    file,
    signal,
    done,
    episodeId: episode.episode_id,
    action: 'clarify',
  });
  t.after(() => { try { writer.child.kill('SIGKILL'); } catch {} });

  const restore = pauseAfterFirstGet(
    store,
    'SELECT * FROM episodes WHERE episode_id=?',
    signal,
    done
  );
  let observed;
  try {
    observed = store.getEpisode(episode.episode_id);
  } finally {
    restore();
  }

  if (observed.version === 1) {
    assert.equal(observed.clarification_prompts_sent, 0);
    assert.equal(observed.requested_slot, null);
    assert.deepEqual(observed.presented_candidates, []);
  } else {
    assert.equal(observed.version, 2);
    assert.equal(observed.clarification_prompts_sent, 1);
    assert.equal(observed.requested_slot, 'store_id');
    assert.deepEqual(observed.presented_candidates, [{ slot: 'store_id', value: STORE_1 }]);
  }

  await writer.exited;
  assert.equal(fs.existsSync(done), true);
  const current = store.getEpisode(episode.episode_id);
  assert.equal(current.version, 2);
  assert.equal(current.clarification_prompts_sent, 1);
  assert.equal(current.requested_slot, 'store_id');
  assert.deepEqual(current.presented_candidates, [{ slot: 'store_id', value: STORE_1 }]);
});

test('stale version cannot overwrite newer episode state across separate connections', t => {
  const { store, file } = tempEpisodeStore(t);
  const episode = store.beginEpisode({ conversationId: 55, sourceMessageId: 101 });
  const other = EpisodeStore.open(file, { now: () => NOW + 1, idFactory: () => 'episode-other' });
  t.after(() => { try { other.close(); } catch {} });

  const updated = store.setStableSlots(episode.episode_id, { product_id: PRODUCT_1 }, { expectedVersion: 1 });
  assert.equal(updated.version, 2);

  expectCode(
    () => other.setStableSlots(episode.episode_id, { product_id: PRODUCT_2 }, { expectedVersion: 1 }),
    'EPISODE_STALE_WRITE'
  );
  assert.equal(other.getEpisode(episode.episode_id).stable_slots.product_id, PRODUCT_1);
});

test('restart preserves active episode identifiers, candidates and clarification budget', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'episode-restart-'));
  const file = path.join(dir, 'episode.sqlite');
  const store = EpisodeStore.create(file, { now: () => NOW, idFactory: () => 'episode-restart' });
  let episode = store.beginEpisode({
    conversationId: 77,
    sourceMessageId: 501,
    stableSlots: { product_id: PRODUCT_1, min_price_minor: 1_000_000, currency: 'UAH' },
  });
  episode = store.recordClarificationPrompt(
    episode.episode_id,
    {
      requestedSlot: 'variant_id',
      presentedCandidates: [
        { slot: 'variant_id', value: VARIANT_1 },
        { slot: 'variant_id', value: VARIANT_2 },
      ],
    },
    { expectedVersion: 1 }
  );
  store.close();

  const reopened = EpisodeStore.open(file, { now: () => NOW + 100 });
  t.after(() => {
    try { reopened.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const active = reopened.loadActive(77);
  assert.equal(active.episode_id, 'episode-restart');
  assert.equal(active.version, 2);
  assert.deepEqual(active.source_message_ids, [501]);
  assert.deepEqual(active.stable_slots, { currency: 'UAH', min_price_minor: 1_000_000, product_id: PRODUCT_1 });
  assert.equal(active.clarification_prompts_sent, 1);
  assert.equal(active.requested_slot, 'variant_id');
  assert.deepEqual(active.presented_candidates, [
    { slot: 'variant_id', value: VARIANT_1 },
    { slot: 'variant_id', value: VARIANT_2 },
  ]);
});

test('closed episodes are immutable and a later active episode never revives old state', t => {
  let next = 1;
  const { store } = tempEpisodeStore(t, { idFactory: () => `episode-${next++}` });
  let first = store.beginEpisode({
    conversationId: 55,
    sourceMessageId: 101,
    stableSlots: { brand_id: BRAND_1 },
  });
  first = store.recordClarificationPrompt(
    first.episode_id,
    { requestedSlot: 'store_id', presentedCandidates: [{ slot: 'store_id', value: STORE_1 }] },
    { expectedVersion: 1 }
  );
  const closed = store.closeEpisode(first.episode_id, { reason: 'non_actionable_ack', expectedVersion: 2 });
  assert.equal(closed.clarification_prompts_sent, 1);

  expectCode(
    () => store.appendSourceMessage(first.episode_id, 102, { expectedVersion: 3 }),
    'EPISODE_CLOSED'
  );

  const second = store.beginEpisode({ conversationId: 55, sourceMessageId: 200 });
  assert.equal(second.clarification_prompts_sent, 0);
  assert.deepEqual(second.stable_slots, {});
  assert.deepEqual(second.presented_candidates, []);
  assert.deepEqual(second.source_message_ids, [200]);
});

test('unsafe file permissions and invalid API values fail closed', t => {
  const { store, file } = tempEpisodeStore(t);
  store.close();
  fs.chmodSync(file, 0o644);
  expectCode(() => EpisodeStore.open(file), 'EPISODE_DB_PERMISSIONS_UNSAFE');

  fs.chmodSync(file, 0o600);
  const reopened = EpisodeStore.open(file, { idFactory: () => 'episode-safe' });
  t.after(() => { try { reopened.close(); } catch {} });
  expectCode(() => reopened.beginEpisode({ conversationId: 0, sourceMessageId: 1 }), 'EPISODE_VALUE_INVALID');
  expectCode(() => reopened.beginEpisode({ conversationId: 1, sourceMessageId: -1 }), 'EPISODE_VALUE_INVALID');
  expectCode(
    () => reopened.beginEpisode({
      conversationId: 1,
      sourceMessageId: 1,
      stableSlots: { category_match_mode: 'NODE_ONLY' },
    }),
    'EPISODE_SLOT_UNSUPPORTED'
  );
  const episode = reopened.beginEpisode({ conversationId: 1, sourceMessageId: 1 });
  expectCode(
    () => reopened.closeEpisode(episode.episode_id, { reason: 'customer_said_thanks', expectedVersion: 1 }),
    'EPISODE_CLOSE_REASON_INVALID'
  );
});
