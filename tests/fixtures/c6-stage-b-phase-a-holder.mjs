// C6 Stage B Phase A: test-only lock holder. Never production, never network.
// This file is NOT authorized for execution; review exact SHA, sandbox and commands first.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const rootArg = process.argv[2];
if (process.argv.length !== 3 || !path.isAbsolute(rootArg ?? '') ||
    !path.basename(rootArg).startsWith('bp-c6-sb-a-') || process.getuid?.() === 0 ||
    typeof process.send !== 'function') {
  throw new Error('SB_HOLDER_BOOTSTRAP_DENIED');
}
const ROOT = fs.realpathSync(rootArg);
let db = null, holding = false, timer = null, mode = null;
function reply(id, stage, extra = {}) {
  process.send({ id, stage, ...extra });
}
function codeOf(err) {
  return /busy|locked/i.test(String(err?.message)) ? 'SQLITE_BUSY' : 'SQLITE_OPERATION_FAILED';
}
function release() {
  if (!holding) return;
  db.exec('COMMIT');
  holding = false;
}
function safeFile(file) {
  assert.equal(typeof file, 'string');
  const absolute = path.resolve(file);
  assert.equal(path.dirname(absolute), ROOT);
  assert.match(path.basename(absolute), /^probe-[A-Za-z0-9_-]+\.sqlite$/);
  assert.equal(fs.realpathSync(absolute), absolute);
  return absolute;
}
function clear() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  try { if (holding) db.exec('ROLLBACK'); } catch {}
  holding = false;
  try { db?.close(); } catch {}
  db = null; mode = null;
}
function begin(kind) {
  if (kind === 'read') {
    db.exec('BEGIN');
    db.prepare('SELECT id,v FROM probe WHERE id=1').get();
  } else if (kind === 'write') {
    db.exec('BEGIN IMMEDIATE');
  } else {
    throw new Error('SB_UNKNOWN_HOLDER_KIND');
  }
  holding = true;
}
function handle(msg) {
  if (!msg || !Number.isSafeInteger(msg.id) || msg.id <= 0) throw new Error('SB_BAD_IPC');
  const id = msg.id;
  if (msg.op === 'prepare') {
    if (holding) throw new Error('SB_PREPARE_WHILE_HELD');
    clear();
    db = new DatabaseSync(safeFile(msg.file));
    db.exec('PRAGMA busy_timeout=50');
    assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 50);
    mode = db.prepare('PRAGMA journal_mode').get().journal_mode;
    if (mode !== 'delete') throw new Error('SB_NOT_DELETE');
    reply(id, 'ready', { journal: mode });
    return;
  }
  if (msg.op === 'hold') {
    if (!db || holding || timer !== null || !['read','write'].includes(msg.kind) ||
        ![0,10,50].includes(msg.holdMs) || ![0,1,5,20].includes(msg.gapMs) ||
        ![1,2].includes(msg.rounds)) throw new Error('SB_HOLD_SHAPE_DENIED');
    let remaining = msg.rounds;
    begin(msg.kind);
    reply(id, 'held');
    const next = () => {
      try {
        release();
        remaining -= 1;
        if (remaining === 0) {
          timer = null;
          reply(id, 'done');
          return;
        }
        timer = setTimeout(() => {
          try { begin(msg.kind); timer = setTimeout(next, msg.holdMs); }
          catch (error) {
            timer = null;
            reply(id, 'done', { acquisition: codeOf(error) });
          }
        }, msg.gapMs);
      } catch (error) {
        clear();
        reply(id, 'failed', { code: codeOf(error) });
      }
    };
    timer = setTimeout(next, msg.holdMs);
    return;
  }
  if (msg.op === 'close') {
    clear();
    reply(id, 'closed');
    process.disconnect();
    return;
  }
  throw new Error('SB_UNKNOWN_HOLDER_OP');
}
process.on('message', msg => {
  try { handle(msg); }
  catch (error) {
    const id = Number.isSafeInteger(msg?.id) ? msg.id : 0;
    clear();
    reply(id, 'failed', { code: codeOf(error) });
  }
});
process.on('disconnect', () => { clear(); process.exit(0); });
process.send({ id: 0, stage: 'booted' });
