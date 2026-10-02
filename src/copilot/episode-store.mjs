import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_VERSION = 1;
const MAX_PRESENTED_CANDIDATES = 20;
const BUSY_TIMEOUT_MS = 5000;

const SCHEMA = `
PRAGMA foreign_keys=ON;
PRAGMA user_version=1;
CREATE TABLE metadata (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  schema_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE episodes (
  episode_id TEXT PRIMARY KEY,
  conversation_id INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('active','closed')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  clarification_prompts_sent INTEGER NOT NULL DEFAULT 0 CHECK(clarification_prompts_sent IN (0,1)),
  requested_slot TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  close_reason TEXT
);
CREATE UNIQUE INDEX one_active_episode_per_conversation
  ON episodes(conversation_id) WHERE state='active';
CREATE TABLE episode_messages (
  episode_id TEXT NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 1),
  PRIMARY KEY(episode_id, message_id),
  UNIQUE(episode_id, ordinal)
);
CREATE TABLE episode_slots (
  episode_id TEXT NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
  slot_name TEXT NOT NULL,
  value_json TEXT NOT NULL,
  PRIMARY KEY(episode_id, slot_name)
);
CREATE TABLE episode_candidates (
  episode_id TEXT NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
  slot_name TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 1),
  value_json TEXT NOT NULL,
  PRIMARY KEY(episode_id, slot_name, ordinal)
);
`;

const SLOT_SPECS = Object.freeze({
  product_id: 'id',
  variant_id: 'id',
  category_id: 'id',
  brand_id: 'id',
  store_id: 'id',
  min_price_minor: 'money_minor',
  max_price_minor: 'money_minor',
  currency: 'currency',
});

const REQUESTED_SLOTS = new Set([
  'product_id',
  'variant_id',
  'category_id',
  'brand_id',
  'store_id',
  'money',
  'shortlist_anchor',
]);

const CLOSE_REASONS = new Set([
  'completed',
  'replaced',
  'human',
  'human_takeover',
  'non_actionable_ack',
  'superseded',
  'expired',
]);

export class EpisodeStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'EpisodeStoreError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new EpisodeStoreError(code, message, details);
}

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function readTx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    fail('EPISODE_VALUE_INVALID', field + ' must be a positive safe integer', { field, value });
  }
  return number;
}

function safeToken(value, field, { max = 128 } = {}) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) {
    fail('EPISODE_VALUE_INVALID', field + ' must be a bounded canonical token', { field });
  }
  return value;
}

function normalizeId(value, field) {
  if (Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^(?:[1-9][0-9]*)$/.test(value)) {
    const number = Number(value);
    if (Number.isSafeInteger(number)) return number;
  }
  return safeToken(value, field);
}

function normalizeSlotValue(slotName, value) {
  const kind = SLOT_SPECS[slotName];
  if (!kind) fail('EPISODE_SLOT_UNSUPPORTED', 'unsupported stable slot', { slot_name: slotName });

  if (kind === 'id') return normalizeId(value, slotName);
  if (kind === 'money_minor') {
    if (!Number.isSafeInteger(value) || value < 0) {
      fail('EPISODE_VALUE_INVALID', slotName + ' must be a non-negative safe integer', { slot_name: slotName });
    }
    return value;
  }
  if (kind === 'currency') {
    if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) {
      fail('EPISODE_VALUE_INVALID', 'currency must be an ISO-like uppercase code', { value });
    }
    return value;
  }
  fail('EPISODE_SLOT_UNSUPPORTED', 'unsupported stable slot kind', { slot_name: slotName, kind });
}

function canonicalJson(value) {
  return JSON.stringify(value);
}

function parseJson(value) {
  return JSON.parse(value);
}

function normalizeRequestedSlot(value) {
  if (value === null) return null;
  if (!REQUESTED_SLOTS.has(value)) {
    fail('EPISODE_REQUESTED_SLOT_UNSUPPORTED', 'unsupported requested slot', { requested_slot: value });
  }
  return value;
}

function normalizeCloseReason(value) {
  if (!CLOSE_REASONS.has(value)) {
    fail('EPISODE_CLOSE_REASON_INVALID', 'unsupported episode close reason', { close_reason: value });
  }
  return value;
}

function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    fail('EPISODE_CANDIDATE_INVALID', 'candidate must be an object');
  }
  const keys = Object.keys(candidate).sort();
  if (keys.length !== 2 || keys[0] !== 'slot' || keys[1] !== 'value') {
    fail('EPISODE_CANDIDATE_INVALID', 'candidate must contain only slot and value');
  }
  if (typeof candidate.slot !== 'string' || !(candidate.slot in SLOT_SPECS)) {
    fail('EPISODE_CANDIDATE_INVALID', 'candidate slot must be a supported stable slot');
  }
  return { slot: candidate.slot, value: normalizeSlotValue(candidate.slot, candidate.value) };
}

function normalizeSlotPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    fail('EPISODE_SLOT_PATCH_INVALID', 'slot patch must be an object');
  }
  const normalized = [];
  for (const [slotName, value] of Object.entries(patch)) {
    if (!(slotName in SLOT_SPECS)) {
      fail('EPISODE_SLOT_UNSUPPORTED', 'unsupported stable slot', { slot_name: slotName });
    }
    normalized.push([slotName, value === null ? null : normalizeSlotValue(slotName, value)]);
  }
  return normalized.sort(([a], [b]) => a.localeCompare(b));
}

export class EpisodeStore {
  static create(file, { now = () => Date.now(), idFactory = () => crypto.randomUUID() } = {}) {
    const resolved = path.resolve(file);
    const parent = path.dirname(resolved);
    if (!fs.existsSync(parent)) fail('EPISODE_PARENT_MISSING', 'episode database parent does not exist');
    const fd = fs.openSync(resolved, 'wx', 0o600);
    fs.closeSync(fd);
    const db = new DatabaseSync(resolved);
    try {
      db.exec(SCHEMA);
      db.prepare('INSERT INTO metadata VALUES (1,?,?)').run(SCHEMA_VERSION, now());
    } finally {
      db.close();
    }
    fs.chmodSync(resolved, 0o600);
    return EpisodeStore.open(file, { now, idFactory });
  }

  static open(file, { now = () => Date.now(), idFactory = () => crypto.randomUUID() } = {}) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) fail('EPISODE_DB_MISSING', 'episode database is missing');
    if ((fs.statSync(resolved).mode & 0o077) !== 0) {
      fail('EPISODE_DB_PERMISSIONS_UNSAFE', 'episode database must be mode 0600');
    }
    const store = new EpisodeStore(resolved, now, idFactory);
    try {
      const version = store.db.prepare('PRAGMA user_version').get().user_version;
      const metadata = store.db.prepare('SELECT schema_version FROM metadata WHERE singleton=1').get();
      const integrity = store.db.prepare('PRAGMA integrity_check').get().integrity_check;
      if (version !== SCHEMA_VERSION || metadata?.schema_version !== SCHEMA_VERSION || integrity !== 'ok') {
        fail('EPISODE_DB_INVALID', 'episode database schema/integrity check failed',
          { user_version: version, metadata_version: metadata?.schema_version, integrity });
      }
      return store;
    } catch (error) {
      try { store.close(); } catch {}
      throw error;
    }
  }

  constructor(file, now, idFactory) {
    this.file = file;
    this.now = now;
    this.idFactory = idFactory;
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}`);
  }

  close() {
    this.db.close();
  }

  beginEpisode({ conversationId, sourceMessageId, stableSlots = {} }) {
    const conversation = positiveInteger(conversationId, 'conversation_id');
    const message = positiveInteger(sourceMessageId, 'source_message_id');
    const slotPatch = normalizeSlotPatch(stableSlots);
    const at = this.now();

    return tx(this.db, () => {
      const active = this.db.prepare(
        "SELECT episode_id FROM episodes WHERE conversation_id=? AND state='active'"
      ).get(conversation);
      if (active) {
        fail('EPISODE_ACTIVE_EXISTS', 'conversation already has an active episode',
          { conversation_id: conversation, episode_id: active.episode_id });
      }
      const episodeId = safeToken(this.idFactory(), 'episode_id');

      this.db.prepare(`INSERT INTO episodes
        (episode_id,conversation_id,state,version,clarification_prompts_sent,created_at,updated_at)
        VALUES (?,?,'active',1,0,?,?)`).run(episodeId, conversation, at, at);
      this.db.prepare(
        'INSERT INTO episode_messages (episode_id,message_id,ordinal) VALUES (?,?,1)'
      ).run(episodeId, message);
      for (const [slotName, value] of slotPatch) {
        if (value === null) continue;
        this.db.prepare(
          'INSERT INTO episode_slots (episode_id,slot_name,value_json) VALUES (?,?,?)'
        ).run(episodeId, slotName, canonicalJson(value));
      }
      return this.#readEpisode(episodeId);
    });
  }

  loadActive(conversationId) {
    const conversation = positiveInteger(conversationId, 'conversation_id');
    return readTx(this.db, () => {
      const row = this.db.prepare(
        "SELECT episode_id FROM episodes WHERE conversation_id=? AND state='active'"
      ).get(conversation);
      return row ? this.#readEpisode(row.episode_id) : null;
    });
  }

  getEpisode(episodeId) {
    const id = safeToken(episodeId, 'episode_id');
    return readTx(this.db, () => this.#readEpisode(id));
  }

  appendSourceMessage(episodeId, sourceMessageId, { expectedVersion } = {}) {
    const id = safeToken(episodeId, 'episode_id');
    const message = positiveInteger(sourceMessageId, 'source_message_id');
    return tx(this.db, () => {
      const episode = this.#requireActive(id, expectedVersion);
      const existing = this.db.prepare(
        'SELECT ordinal FROM episode_messages WHERE episode_id=? AND message_id=?'
      ).get(id, message);
      if (existing) return this.#readEpisode(id);

      const last = this.db.prepare(
        'SELECT message_id,ordinal FROM episode_messages WHERE episode_id=? ORDER BY ordinal DESC LIMIT 1'
      ).get(id);
      if (last && message <= last.message_id) {
        fail('EPISODE_MESSAGE_OUT_OF_ORDER', 'source message ids must advance monotonically',
          { episode_id: id, last_message_id: last.message_id, source_message_id: message });
      }

      this.db.prepare(
        'INSERT INTO episode_messages (episode_id,message_id,ordinal) VALUES (?,?,?)'
      ).run(id, message, (last?.ordinal ?? 0) + 1);
      this.#bump(id, episode.version);
      return this.#readEpisode(id);
    });
  }

  setStableSlots(episodeId, patch, { expectedVersion } = {}) {
    const id = safeToken(episodeId, 'episode_id');
    const slotPatch = normalizeSlotPatch(patch);
    return tx(this.db, () => {
      const episode = this.#requireActive(id, expectedVersion);
      let changed = false;
      for (const [slotName, value] of slotPatch) {
        const current = this.db.prepare(
          'SELECT value_json FROM episode_slots WHERE episode_id=? AND slot_name=?'
        ).get(id, slotName);
        if (value === null) {
          if (current) {
            this.db.prepare(
              'DELETE FROM episode_slots WHERE episode_id=? AND slot_name=?'
            ).run(id, slotName);
            changed = true;
          }
          continue;
        }
        const valueJson = canonicalJson(value);
        if (current?.value_json === valueJson) continue;
        this.db.prepare(`INSERT INTO episode_slots (episode_id,slot_name,value_json)
          VALUES (?,?,?) ON CONFLICT(episode_id,slot_name)
          DO UPDATE SET value_json=excluded.value_json`).run(id, slotName, valueJson);
        changed = true;
      }
      if (changed) this.#bump(id, episode.version);
      return this.#readEpisode(id);
    });
  }

  recordClarificationPrompt(episodeId, { requestedSlot, presentedCandidates = [] }, { expectedVersion } = {}) {
    const id = safeToken(episodeId, 'episode_id');
    const requested = normalizeRequestedSlot(requestedSlot);
    if (!Array.isArray(presentedCandidates)) {
      fail('EPISODE_CANDIDATE_INVALID', 'presentedCandidates must be an array');
    }
    if (presentedCandidates.length > MAX_PRESENTED_CANDIDATES) {
      fail('EPISODE_CANDIDATE_LIMIT_EXCEEDED', 'presented candidate list exceeds durable C1 bound',
        { limit: MAX_PRESENTED_CANDIDATES, count: presentedCandidates.length });
    }
    const candidates = presentedCandidates.map(normalizeCandidate);
    if (requested === null && candidates.length === 0) {
      fail('EPISODE_CLARIFICATION_INVALID', 'clarification requires a requested slot or presented candidates');
    }

    return tx(this.db, () => {
      const episode = this.#requireActive(id, expectedVersion);
      if (episode.clarification_prompts_sent !== 0) {
        fail('EPISODE_CLARIFICATION_LIMIT_REACHED', 'only one clarification prompt is allowed per episode',
          { episode_id: id });
      }
      this.db.prepare(`UPDATE episodes SET clarification_prompts_sent=1,requested_slot=?,
        version=version+1,updated_at=? WHERE episode_id=? AND state='active' AND version=?`)
        .run(requested, this.now(), id, episode.version);
      this.db.prepare('DELETE FROM episode_candidates WHERE episode_id=?').run(id);
      for (const [index, candidate] of candidates.entries()) {
        this.db.prepare(`INSERT INTO episode_candidates
          (episode_id,slot_name,ordinal,value_json) VALUES (?,?,?,?)`)
          .run(id, candidate.slot, index + 1, canonicalJson(candidate.value));
      }
      return this.#readEpisode(id);
    });
  }

  clearClarificationContext(episodeId, { expectedVersion } = {}) {
    const id = safeToken(episodeId, 'episode_id');
    return tx(this.db, () => {
      const episode = this.#requireActive(id, expectedVersion);
      const candidateCount = this.db.prepare(
        'SELECT COUNT(*) AS count FROM episode_candidates WHERE episode_id=?'
      ).get(id).count;
      if (episode.requested_slot === null && candidateCount === 0) return this.#readEpisode(id);
      this.db.prepare('DELETE FROM episode_candidates WHERE episode_id=?').run(id);
      this.db.prepare(`UPDATE episodes SET requested_slot=NULL,version=version+1,updated_at=?
        WHERE episode_id=? AND state='active' AND version=?`)
        .run(this.now(), id, episode.version);
      return this.#readEpisode(id);
    });
  }

  closeEpisode(episodeId, { reason, expectedVersion } = {}) {
    const id = safeToken(episodeId, 'episode_id');
    const closeReason = normalizeCloseReason(reason);
    const at = this.now();
    return tx(this.db, () => {
      const episode = this.#requireActive(id, expectedVersion);
      const result = this.db.prepare(`UPDATE episodes
        SET state='closed',version=version+1,updated_at=?,closed_at=?,close_reason=?
        WHERE episode_id=? AND state='active' AND version=?`)
        .run(at, at, closeReason, id, episode.version);
      if (result.changes !== 1) fail('EPISODE_STALE_WRITE', 'episode changed before close', { episode_id: id });
      return this.#readEpisode(id);
    });
  }

  #requireActive(episodeId, expectedVersion) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      fail('EPISODE_EXPECTED_VERSION_REQUIRED', 'every episode mutation requires a positive expectedVersion',
        { episode_id: episodeId });
    }
    const row = this.db.prepare('SELECT * FROM episodes WHERE episode_id=?').get(episodeId);
    if (!row) fail('EPISODE_NOT_FOUND', 'episode not found', { episode_id: episodeId });
    if (row.state !== 'active') fail('EPISODE_CLOSED', 'episode is already closed', { episode_id: episodeId });
    if (row.version !== expectedVersion) {
      fail('EPISODE_STALE_WRITE', 'episode version mismatch',
        { episode_id: episodeId, expected_version: expectedVersion, actual_version: row.version });
    }
    return row;
  }

  #bump(episodeId, version) {
    const result = this.db.prepare(`UPDATE episodes SET version=version+1,updated_at=?
      WHERE episode_id=? AND state='active' AND version=?`)
      .run(this.now(), episodeId, version);
    if (result.changes !== 1) fail('EPISODE_STALE_WRITE', 'episode changed before write', { episode_id: episodeId });
  }

  #readEpisode(episodeId) {
    const row = this.db.prepare('SELECT * FROM episodes WHERE episode_id=?').get(episodeId);
    if (!row) return null;
    const messages = this.db.prepare(
      'SELECT message_id FROM episode_messages WHERE episode_id=? ORDER BY ordinal'
    ).all(episodeId).map(item => item.message_id);
    const slots = Object.fromEntries(this.db.prepare(
      'SELECT slot_name,value_json FROM episode_slots WHERE episode_id=? ORDER BY slot_name'
    ).all(episodeId).map(item => [item.slot_name, parseJson(item.value_json)]));
    const candidates = this.db.prepare(`SELECT slot_name,value_json FROM episode_candidates
      WHERE episode_id=? ORDER BY ordinal`).all(episodeId)
      .map(item => ({ slot: item.slot_name, value: parseJson(item.value_json) }));
    return {
      episode_id: row.episode_id,
      conversation_id: row.conversation_id,
      state: row.state,
      version: row.version,
      source_message_ids: messages,
      stable_slots: slots,
      presented_candidates: candidates,
      requested_slot: row.requested_slot,
      clarification_prompts_sent: row.clarification_prompts_sent,
      created_at: row.created_at,
      updated_at: row.updated_at,
      closed_at: row.closed_at,
      close_reason: row.close_reason,
    };
  }
}

export { SCHEMA_VERSION, SLOT_SPECS, MAX_PRESENTED_CANDIDATES, BUSY_TIMEOUT_MS };
