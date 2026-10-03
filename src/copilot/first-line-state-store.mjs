import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_VERSION = 2;
const BUSY_TIMEOUT_MS = 5000;
const MAX_PRESENTED_CANDIDATES = 20;

const LIVE_ACTION_STATES = new Set(['PREPARED', 'GATING', 'SENDING', 'UNCERTAIN']);
const TERMINAL_ACTION_STATES = new Set(['CONFIRMED', 'STALE', 'CANCELLED', 'HANDOFF_DONE', 'NOT_SENT']);
const ACTION_TYPES = new Set(['ANSWER', 'CLARIFY']);
const EVENT_KINDS = new Set([
  'CUSTOMER_MESSAGE',
  'BABYPARK_PUBLIC_REPLY',
  'HUMAN_PUBLIC_REPLY',
  'OTHER_BOT_PUBLIC_REPLY',
  'SYSTEM_TEMPLATE',
  'AUTOMATION_PUBLIC',
  'UNKNOWN_PUBLIC',
]);
const MESSAGE_TYPES = new Set(['incoming', 'outgoing', 'template', 'unknown']);
const SENDER_CLASSES = new Set(['contact', 'configured_agent_bot', 'human', 'other_agent_bot', 'none', 'unknown']);

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
const UUID_SHAPE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CANONICAL_ID_PATTERNS = Object.freeze({
  product_id: new RegExp(`^prod_${UUID_SHAPE}$`),
  variant_id: new RegExp(`^var_${UUID_SHAPE}$`),
  store_id: new RegExp(`^store_${UUID_SHAPE}$`),
  brand_id: /^brand_[0-9a-f]{32}$/,
  category_id: /^cat_[0-9a-f]{32}$/,
});
const REQUESTED_SLOTS = new Set([
  'product_id', 'variant_id', 'category_id', 'brand_id', 'store_id', 'money', 'shortlist_anchor',
]);

const SCHEMA = `
PRAGMA foreign_keys=ON;
PRAGMA user_version=2;
CREATE TABLE metadata (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  schema_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE conversation_streams (
  stream_id TEXT PRIMARY KEY,
  source_provider TEXT NOT NULL,
  source_conversation_id INTEGER NOT NULL CHECK(source_conversation_id >= 1),
  stream_revision INTEGER NOT NULL DEFAULT 0 CHECK(stream_revision >= 0),
  last_event_seq INTEGER NOT NULL DEFAULT 0 CHECK(last_event_seq >= 0),
  scan_highwater INTEGER CHECK(scan_highwater IS NULL OR scan_highwater >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(source_provider, source_conversation_id)
);
CREATE TABLE conversation_events (
  stream_id TEXT NOT NULL REFERENCES conversation_streams(stream_id) ON DELETE CASCADE,
  event_seq INTEGER NOT NULL CHECK(event_seq >= 1),
  source_message_id INTEGER NOT NULL CHECK(source_message_id >= 1),
  event_kind TEXT NOT NULL,
  message_type TEXT NOT NULL,
  sender_class TEXT NOT NULL,
  sender_id INTEGER CHECK(sender_id IS NULL OR sender_id >= 1),
  content_type TEXT,
  deleted_flag INTEGER NOT NULL DEFAULT 0 CHECK(deleted_flag IN (0,1)),
  unsupported_flag INTEGER NOT NULL DEFAULT 0 CHECK(unsupported_flag IN (0,1)),
  has_attachments INTEGER NOT NULL DEFAULT 0 CHECK(has_attachments IN (0,1)),
  source_id TEXT,
  accepted_at INTEGER NOT NULL,
  PRIMARY KEY(stream_id, event_seq),
  UNIQUE(stream_id, source_message_id)
);
CREATE INDEX conversation_events_source
  ON conversation_events(stream_id, source_message_id);
CREATE TABLE episodes (
  episode_id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL REFERENCES conversation_streams(stream_id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK(state IN ('active','closed')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  clarification_prompts_sent INTEGER NOT NULL DEFAULT 0 CHECK(clarification_prompts_sent IN (0,1)),
  requested_slot TEXT,
  clarification_action_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  close_reason TEXT
);
CREATE UNIQUE INDEX one_active_episode_per_stream
  ON episodes(stream_id) WHERE state='active';
CREATE TABLE episode_slots (
  episode_id TEXT NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
  slot_name TEXT NOT NULL,
  value_json TEXT NOT NULL,
  derived_through_event_seq INTEGER CHECK(derived_through_event_seq IS NULL OR derived_through_event_seq >= 1),
  PRIMARY KEY(episode_id, slot_name)
);
CREATE TABLE public_actions (
  action_id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL REFERENCES conversation_streams(stream_id) ON DELETE CASCADE,
  episode_id TEXT REFERENCES episodes(episode_id) ON DELETE SET NULL,
  episode_version INTEGER,
  prepared_stream_revision INTEGER NOT NULL CHECK(prepared_stream_revision >= 1),
  action_type TEXT NOT NULL CHECK(action_type IN ('ANSWER','CLARIFY')),
  state TEXT NOT NULL CHECK(state IN ('PREPARED','GATING','SENDING','CONFIRMED','STALE','CANCELLED','UNCERTAIN','HANDOFF_DONE','NOT_SENT')),
  basis_event_seqs_json TEXT NOT NULL,
  requested_slot TEXT,
  lease_token TEXT,
  lease_expires_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  deadline_at INTEGER NOT NULL,
  confirmed_source_message_id INTEGER CHECK(confirmed_source_message_id IS NULL OR confirmed_source_message_id >= 1),
  terminal_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  send_started_at INTEGER,
  confirmed_at INTEGER,
  UNIQUE(stream_id, prepared_stream_revision)
);
CREATE UNIQUE INDEX one_live_public_action_per_stream
  ON public_actions(stream_id)
  WHERE state IN ('PREPARED','GATING','SENDING','UNCERTAIN');
CREATE INDEX public_actions_relay
  ON public_actions(state, lease_expires_at, deadline_at, created_at);
CREATE TABLE public_action_candidates (
  action_id TEXT NOT NULL REFERENCES public_actions(action_id) ON DELETE CASCADE,
  slot_name TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 1),
  value_json TEXT NOT NULL,
  PRIMARY KEY(action_id, ordinal)
);
`;

const EXPECTED_COLUMNS = Object.freeze({
  metadata: ['singleton','schema_version','created_at'],
  conversation_streams: ['stream_id','source_provider','source_conversation_id','stream_revision','last_event_seq','scan_highwater','created_at','updated_at'],
  conversation_events: ['stream_id','event_seq','source_message_id','event_kind','message_type','sender_class','sender_id','content_type','deleted_flag','unsupported_flag','has_attachments','source_id','accepted_at'],
  episodes: ['episode_id','stream_id','state','version','clarification_prompts_sent','requested_slot','clarification_action_id','created_at','updated_at','closed_at','close_reason'],
  episode_slots: ['episode_id','slot_name','value_json','derived_through_event_seq'],
  public_actions: ['action_id','stream_id','episode_id','episode_version','prepared_stream_revision','action_type','state','basis_event_seqs_json','requested_slot','lease_token','lease_expires_at','attempts','deadline_at','confirmed_source_message_id','terminal_reason','created_at','updated_at','send_started_at','confirmed_at'],
  public_action_candidates: ['action_id','slot_name','ordinal','value_json'],
});
const REQUIRED_INDEXES = new Set([
  'sqlite_autoindex_conversation_streams_2',
  'sqlite_autoindex_conversation_events_2',
  'one_active_episode_per_stream',
  'one_live_public_action_per_stream',
  'sqlite_autoindex_public_actions_2',
]);

export class FirstLineStateError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FirstLineStateError';
    this.code = code;
    this.details = details;
  }
}
function fail(code, message, details = {}) { throw new FirstLineStateError(code, message, details); }
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const out = fn(); db.exec('COMMIT'); return out; }
  catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
}
function readTx(db, fn) {
  db.exec('BEGIN');
  try { const out = fn(); db.exec('COMMIT'); return out; }
  catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
}
function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) fail('FIRST_LINE_VALUE_INVALID', field + ' must be a positive safe integer', { field });
  return value;
}
function nonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) fail('FIRST_LINE_VALUE_INVALID', field + ' must be a non-negative safe integer', { field });
  return value;
}
function safeToken(value, field, { max = 160 } = {}) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) {
    fail('FIRST_LINE_VALUE_INVALID', field + ' must be a bounded canonical token', { field });
  }
  return value;
}
function optionalToken(value, field) { return value == null ? null : safeToken(value, field); }
function sourceProvider(value) {
  if (value !== 'chatwoot') fail('FIRST_LINE_SOURCE_PROVIDER_INVALID', 'unsupported source provider', { source_provider: value });
  return value;
}
function enumValue(value, values, field) {
  if (!values.has(value)) fail('FIRST_LINE_VALUE_INVALID', field + ' is unsupported', { field, value });
  return value;
}
function booleanInt(value, field) {
  if (value !== true && value !== false) fail('FIRST_LINE_VALUE_INVALID', field + ' must be boolean', { field });
  return value ? 1 : 0;
}
function contentType(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length < 1 || value.length > 64 || !/^[a-z0-9_:-]+$/i.test(value)) {
    fail('FIRST_LINE_VALUE_INVALID', 'content_type is invalid');
  }
  return value;
}
function canonicalJson(value) { return JSON.stringify(value); }
function parseJson(value, code = 'FIRST_LINE_DB_CORRUPT') {
  try { return JSON.parse(value); } catch { fail(code, 'persisted JSON is corrupt'); }
}
function normalizeRequestedSlot(value) {
  if (value == null) return null;
  if (!REQUESTED_SLOTS.has(value)) fail('FIRST_LINE_REQUESTED_SLOT_INVALID', 'unsupported requested slot', { requested_slot: value });
  return value;
}
function normalizeSlotValue(slotName, value) {
  if (!Object.hasOwn(SLOT_SPECS, slotName)) fail('FIRST_LINE_SLOT_UNSUPPORTED', 'unsupported stable slot', { slot_name: slotName });
  const kind = SLOT_SPECS[slotName];
  if (kind === 'id') {
    const pattern = CANONICAL_ID_PATTERNS[slotName];
    if (typeof value !== 'string' || !pattern.test(value)) fail('FIRST_LINE_VALUE_INVALID', slotName + ' must be canonical', { slot_name: slotName });
    return value;
  }
  if (kind === 'money_minor') {
    if (!Number.isSafeInteger(value) || value < 0) fail('FIRST_LINE_VALUE_INVALID', slotName + ' must be non-negative safe integer');
    return value;
  }
  if (kind === 'currency') {
    if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) fail('FIRST_LINE_VALUE_INVALID', 'currency must be uppercase 3-letter code');
    return value;
  }
  fail('FIRST_LINE_SLOT_UNSUPPORTED', 'unsupported stable slot kind');
}
function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) ||
      Object.keys(candidate).sort().join(',') !== 'slot,value') {
    fail('FIRST_LINE_CANDIDATE_INVALID', 'candidate must contain only slot and value');
  }
  return { slot: candidate.slot, value: normalizeSlotValue(candidate.slot, candidate.value) };
}
function normalizeBasisEventSeqs(value) {
  if (!Array.isArray(value) || value.length < 1) fail('FIRST_LINE_ACTION_BASIS_INVALID', 'basis event seqs must be non-empty');
  const out = value.map((v, i) => positiveInteger(v, 'basis_event_seq_' + i));
  for (let i = 1; i < out.length; i += 1) {
    if (out[i] <= out[i - 1]) fail('FIRST_LINE_ACTION_BASIS_INVALID', 'basis event seqs must be strictly increasing');
  }
  return out;
}
function normalizeEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) fail('FIRST_LINE_EVENT_INVALID', 'event must be an object');
  return {
    sourceMessageId: positiveInteger(event.sourceMessageId, 'source_message_id'),
    eventKind: enumValue(event.eventKind, EVENT_KINDS, 'event_kind'),
    messageType: enumValue(event.messageType, MESSAGE_TYPES, 'message_type'),
    senderClass: enumValue(event.senderClass, SENDER_CLASSES, 'sender_class'),
    senderId: event.senderId == null ? null : positiveInteger(event.senderId, 'sender_id'),
    contentType: contentType(event.contentType),
    deleted: booleanInt(event.deleted ?? false, 'deleted'),
    unsupported: booleanInt(event.unsupported ?? false, 'unsupported'),
    hasAttachments: booleanInt(event.hasAttachments ?? false, 'has_attachments'),
    sourceId: optionalToken(event.sourceId, 'source_id'),
  };
}

export class FirstLineStateStore {
  static create(file, {
    now = () => Date.now(),
    streamIdFactory = () => 'stream_' + crypto.randomUUID(),
    episodeIdFactory = () => 'episode_' + crypto.randomUUID(),
    actionIdFactory = () => 'action_' + crypto.randomUUID(),
  } = {}) {
    const resolved = path.resolve(file);
    const parent = path.dirname(resolved);
    if (!fs.existsSync(parent)) fail('FIRST_LINE_PARENT_MISSING', 'database parent does not exist');
    const fd = fs.openSync(resolved, 'wx', 0o600); fs.closeSync(fd);
    const db = new DatabaseSync(resolved);
    try {
      db.exec(SCHEMA);
      db.prepare('INSERT INTO metadata VALUES (1,?,?)').run(SCHEMA_VERSION, now());
    } finally { db.close(); }
    fs.chmodSync(resolved, 0o600);
    return FirstLineStateStore.open(file, { now, streamIdFactory, episodeIdFactory, actionIdFactory });
  }

  static open(file, options = {}) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) fail('FIRST_LINE_DB_MISSING', 'database is missing');
    if ((fs.statSync(resolved).mode & 0o077) !== 0) fail('FIRST_LINE_DB_PERMISSIONS_UNSAFE', 'database must be mode 0600');
    const store = new FirstLineStateStore(resolved, options);
    try { store.#attestSchema(); return store; }
    catch (error) { try { store.close(); } catch {} throw error; }
  }

  constructor(file, {
    now = () => Date.now(),
    streamIdFactory = () => 'stream_' + crypto.randomUUID(),
    episodeIdFactory = () => 'episode_' + crypto.randomUUID(),
    actionIdFactory = () => 'action_' + crypto.randomUUID(),
  } = {}) {
    this.file = file; this.now = now; this.streamIdFactory = streamIdFactory;
    this.episodeIdFactory = episodeIdFactory; this.actionIdFactory = actionIdFactory;
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}`);
  }
  close() { this.db.close(); }

  ensureConversationStream({ sourceProvider, sourceConversationId }) {
    const provider = sourceProvider === 'chatwoot' ? sourceProvider : fail('FIRST_LINE_SOURCE_PROVIDER_INVALID', 'unsupported source provider');
    const conversation = positiveInteger(sourceConversationId, 'source_conversation_id');
    const at = this.now();
    return tx(this.db, () => {
      const existing = this.db.prepare('SELECT stream_id FROM conversation_streams WHERE source_provider=? AND source_conversation_id=?').get(provider, conversation);
      if (existing) return this.#readStream(existing.stream_id);
      const streamId = safeToken(this.streamIdFactory(), 'stream_id');
      this.db.prepare(`INSERT INTO conversation_streams
        (stream_id,source_provider,source_conversation_id,stream_revision,last_event_seq,created_at,updated_at)
        VALUES (?,?,?,0,0,?,?)`).run(streamId, provider, conversation, at, at);
      return this.#readStream(streamId);
    });
  }

  findConversationStream({ sourceProvider: provider, sourceConversationId }) {
    provider = sourceProvider(provider);
    const conversation = positiveInteger(sourceConversationId, 'source_conversation_id');
    return readTx(this.db, () => {
      const row = this.db.prepare('SELECT stream_id FROM conversation_streams WHERE source_provider=? AND source_conversation_id=?').get(provider, conversation);
      return row ? this.#readStream(row.stream_id) : null;
    });
  }

  getConversationStream(streamId) {
    const id = safeToken(streamId, 'stream_id');
    return readTx(this.db, () => this.#readStream(id));
  }

  recordScanHighwater(streamId, sourceMessageId) {
    const id = safeToken(streamId, 'stream_id');
    const source = positiveInteger(sourceMessageId, 'source_message_id');
    return tx(this.db, () => {
      this.#requireStream(id);
      this.db.prepare(`UPDATE conversation_streams SET scan_highwater=CASE
        WHEN scan_highwater IS NULL OR scan_highwater<? THEN ? ELSE scan_highwater END,
        updated_at=? WHERE stream_id=?`).run(source, source, this.now(), id);
      return this.#readStream(id);
    });
  }

  ingestConversationEvent(streamId, event) {
    const id = safeToken(streamId, 'stream_id');
    const normalized = normalizeEvent(event);
    const at = this.now();
    return tx(this.db, () => {
      const stream = this.#requireStream(id);
      const existing = this.db.prepare('SELECT * FROM conversation_events WHERE stream_id=? AND source_message_id=?')
        .get(id, normalized.sourceMessageId);
      if (existing) return { inserted: false, event: this.#eventDto(existing), stream: this.#readStream(id) };

      const seq = stream.last_event_seq + 1;
      this.db.prepare(`INSERT INTO conversation_events
        (stream_id,event_seq,source_message_id,event_kind,message_type,sender_class,sender_id,content_type,
         deleted_flag,unsupported_flag,has_attachments,source_id,accepted_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          id, seq, normalized.sourceMessageId, normalized.eventKind, normalized.messageType,
          normalized.senderClass, normalized.senderId, normalized.contentType, normalized.deleted,
          normalized.unsupported, normalized.hasAttachments, normalized.sourceId, at
        );
      const changed = this.db.prepare(`UPDATE conversation_streams
        SET last_event_seq=?,stream_revision=stream_revision+1,updated_at=?
        WHERE stream_id=? AND last_event_seq=? AND stream_revision=?`)
        .run(seq, at, id, stream.last_event_seq, stream.stream_revision).changes;
      if (changed !== 1) fail('FIRST_LINE_STALE_WRITE', 'stream changed before event append', { stream_id: id });
      return {
        inserted: true,
        event: this.#eventDto(this.db.prepare('SELECT * FROM conversation_events WHERE stream_id=? AND event_seq=?').get(id, seq)),
        stream: this.#readStream(id),
      };
    });
  }

  listConversationEvents(streamId) {
    const id = safeToken(streamId, 'stream_id');
    return readTx(this.db, () => {
      this.#requireStream(id);
      return this.db.prepare('SELECT * FROM conversation_events WHERE stream_id=? ORDER BY event_seq').all(id)
        .map(row => this.#eventDto(row));
    });
  }

  getConversationEventBySource(streamId, sourceMessageId) {
    const id = safeToken(streamId, 'stream_id');
    const source = positiveInteger(sourceMessageId, 'source_message_id');
    return readTx(this.db, () => {
      const row = this.db.prepare('SELECT * FROM conversation_events WHERE stream_id=? AND source_message_id=?').get(id, source);
      return row ? this.#eventDto(row) : null;
    });
  }

  beginEpisode({ streamId }) {
    const stream = safeToken(streamId, 'stream_id');
    const at = this.now();
    return tx(this.db, () => {
      this.#requireStream(stream);
      const active = this.db.prepare("SELECT episode_id FROM episodes WHERE stream_id=? AND state='active'").get(stream);
      if (active) fail('FIRST_LINE_EPISODE_ACTIVE_EXISTS', 'stream already has active episode', { stream_id: stream });
      const episodeId = safeToken(this.episodeIdFactory(), 'episode_id');
      this.db.prepare(`INSERT INTO episodes
        (episode_id,stream_id,state,version,clarification_prompts_sent,created_at,updated_at)
        VALUES (?,?,'active',1,0,?,?)`).run(episodeId, stream, at, at);
      return this.#readEpisode(episodeId);
    });
  }

  loadActiveEpisode(streamId) {
    const stream = safeToken(streamId, 'stream_id');
    return readTx(this.db, () => {
      const row = this.db.prepare("SELECT episode_id FROM episodes WHERE stream_id=? AND state='active'").get(stream);
      return row ? this.#readEpisode(row.episode_id) : null;
    });
  }

  getEpisode(episodeId) {
    const id = safeToken(episodeId, 'episode_id');
    return readTx(this.db, () => this.#readEpisode(id));
  }

  setStableSlots(episodeId, patch, { expectedVersion, derivedThroughEventSeq = null } = {}) {
    const id = safeToken(episodeId, 'episode_id');
    const version = positiveInteger(expectedVersion, 'expected_version');
    const derived = derivedThroughEventSeq == null ? null : positiveInteger(derivedThroughEventSeq, 'derived_through_event_seq');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) fail('FIRST_LINE_SLOT_PATCH_INVALID', 'slot patch must be object');
    const normalized = Object.entries(patch).map(([name, value]) => [name, value == null ? null : normalizeSlotValue(name, value)]);
    return tx(this.db, () => {
      const episode = this.#requireActiveEpisode(id, version);
      for (const [name, value] of normalized) {
        if (value == null) this.db.prepare('DELETE FROM episode_slots WHERE episode_id=? AND slot_name=?').run(id, name);
        else this.db.prepare(`INSERT INTO episode_slots(episode_id,slot_name,value_json,derived_through_event_seq)
          VALUES (?,?,?,?) ON CONFLICT(episode_id,slot_name) DO UPDATE SET
          value_json=excluded.value_json,derived_through_event_seq=excluded.derived_through_event_seq`)
          .run(id, name, canonicalJson(value), derived);
      }
      this.#bumpEpisode(id, episode.version);
      return this.#readEpisode(id);
    });
  }

  closeEpisode(episodeId, { reason, expectedVersion } = {}) {
    const id = safeToken(episodeId, 'episode_id');
    const version = positiveInteger(expectedVersion, 'expected_version');
    const allowed = new Set(['completed','replaced','human_takeover','non_actionable_ack','superseded','expired']);
    const closeReason = enumValue(reason, allowed, 'close_reason');
    const at = this.now();
    return tx(this.db, () => {
      this.#requireActiveEpisode(id, version);
      const changed = this.db.prepare(`UPDATE episodes SET state='closed',version=version+1,updated_at=?,closed_at=?,close_reason=?
        WHERE episode_id=? AND state='active' AND version=?`).run(at, at, closeReason, id, version).changes;
      if (changed !== 1) fail('FIRST_LINE_STALE_WRITE', 'episode changed before close');
      return this.#readEpisode(id);
    });
  }

  preparePublicAction({
    streamId, episodeId = null, expectedEpisodeVersion = null, preparedStreamRevision,
    actionType, basisEventSeqs, requestedSlot = null, presentedCandidates = [], deadlineAt,
  }) {
    const stream = safeToken(streamId, 'stream_id');
    const revision = positiveInteger(preparedStreamRevision, 'prepared_stream_revision');
    const type = enumValue(actionType, ACTION_TYPES, 'action_type');
    const basis = normalizeBasisEventSeqs(basisEventSeqs);
    const requested = normalizeRequestedSlot(requestedSlot);
    const deadline = positiveInteger(deadlineAt, 'deadline_at');
    if (!Array.isArray(presentedCandidates) || presentedCandidates.length > MAX_PRESENTED_CANDIDATES) {
      fail('FIRST_LINE_CANDIDATE_LIMIT_EXCEEDED', 'candidate list exceeds bound', { limit: MAX_PRESENTED_CANDIDATES });
    }
    const candidates = presentedCandidates.map(normalizeCandidate);
    if (type === 'CLARIFY' && requested == null && candidates.length === 0) {
      fail('FIRST_LINE_CLARIFICATION_INVALID', 'CLARIFY requires requested slot or candidates');
    }
    const epId = episodeId == null ? null : safeToken(episodeId, 'episode_id');
    const epVersion = epId == null ? null : positiveInteger(expectedEpisodeVersion, 'expected_episode_version');
    const at = this.now();

    return tx(this.db, () => {
      const currentStream = this.#requireStream(stream);
      if (currentStream.stream_revision !== revision) {
        fail('FIRST_LINE_ACTION_STALE_REVISION', 'prepared revision is not current', {
          prepared_stream_revision: revision, current_stream_revision: currentStream.stream_revision,
        });
      }

      for (const seq of basis) {
        const event = this.db.prepare(
          'SELECT 1 AS ok FROM conversation_events WHERE stream_id=? AND event_seq=?'
        ).get(stream, seq);
        if (!event) {
          fail('FIRST_LINE_ACTION_BASIS_INVALID', 'action basis references an unknown stream event',
            { stream_id: stream, event_seq: seq });
        }
      }

      const sameRevision = this.db.prepare('SELECT action_id FROM public_actions WHERE stream_id=? AND prepared_stream_revision=?')
        .get(stream, revision);
      if (sameRevision) return this.#readAction(sameRevision.action_id);

      const live = this.db.prepare(`SELECT * FROM public_actions WHERE stream_id=? AND state IN
        ('PREPARED','GATING','SENDING','UNCERTAIN')`).get(stream);
      if (live) {
        if (live.state === 'SENDING' || live.state === 'UNCERTAIN') {
          fail('FIRST_LINE_ACTION_SEND_UNRESOLVED', 'existing send must be reconciled before another action', {
            action_id: live.action_id, state: live.state,
          });
        }
        this.#cancelUnsentAction(live, 'newer_stream_revision');
      }

      let episode = null;
      if (epId !== null) {
        episode = this.#requireActiveEpisode(epId, epVersion);
        if (episode.stream_id !== stream) {
          fail('FIRST_LINE_ACTION_EPISODE_STREAM_MISMATCH', 'episode does not belong to action stream',
            { episode_id: epId, stream_id: stream, episode_stream_id: episode.stream_id });
        }
      }
      if (type === 'CLARIFY') {
        if (!episode) fail('FIRST_LINE_CLARIFICATION_INVALID', 'CLARIFY requires active episode');
        if (episode.clarification_prompts_sent !== 0 || episode.clarification_action_id !== null) {
          fail('FIRST_LINE_CLARIFICATION_LIMIT_REACHED', 'clarification already reserved/sent');
        }
      }

      const actionId = safeToken(this.actionIdFactory(), 'action_id');
      this.db.prepare(`INSERT INTO public_actions
        (action_id,stream_id,episode_id,episode_version,prepared_stream_revision,action_type,state,
         basis_event_seqs_json,requested_slot,deadline_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'PREPARED',?,?,?,?,?)`).run(
          actionId, stream, epId, epVersion, revision, type, canonicalJson(basis), requested, deadline, at, at
        );

      for (const [index, candidate] of candidates.entries()) {
        this.db.prepare(`INSERT INTO public_action_candidates(action_id,slot_name,ordinal,value_json)
          VALUES (?,?,?,?)`).run(actionId, candidate.slot, index + 1, canonicalJson(candidate.value));
      }

      if (type === 'CLARIFY') {
        const changed = this.db.prepare(`UPDATE episodes SET clarification_prompts_sent=1,requested_slot=?,
          clarification_action_id=?,version=version+1,updated_at=?
          WHERE episode_id=? AND state='active' AND version=? AND clarification_prompts_sent=0 AND clarification_action_id IS NULL`)
          .run(requested, actionId, at, epId, epVersion).changes;
        if (changed !== 1) fail('FIRST_LINE_STALE_WRITE', 'episode changed before clarification reservation');
      }
      return this.#readAction(actionId);
    });
  }

  claimNextPublicAction({ leaseMs, token = crypto.randomUUID() } = {}) {
    const lease = positiveInteger(leaseMs, 'lease_ms');
    const claim = safeToken(token, 'lease_token');
    const at = this.now();
    return tx(this.db, () => {
      const row = this.db.prepare(`SELECT * FROM public_actions
        WHERE state IN ('PREPARED','GATING')
          AND (lease_expires_at IS NULL OR lease_expires_at<=?)
        ORDER BY created_at,action_id LIMIT 1`).get(at);
      if (!row) return null;
      const changed = this.db.prepare(`UPDATE public_actions SET state='GATING',lease_token=?,lease_expires_at=?,
        attempts=attempts+1,updated_at=? WHERE action_id=? AND state=? AND
        (lease_expires_at IS NULL OR lease_expires_at<=?)`)
        .run(claim, at + lease, at, row.action_id, row.state, at).changes;
      return changed === 1 ? this.#readAction(row.action_id) : null;
    });
  }

  markActionSending(actionId, leaseToken) {
    const id = safeToken(actionId, 'action_id');
    const token = safeToken(leaseToken, 'lease_token');
    const at = this.now();
    return tx(this.db, () => {
      const action = this.#requireAction(id);
      if (action.state !== 'GATING' || action.lease_token !== token) {
        fail('FIRST_LINE_ACTION_CLAIM_INVALID', 'action is not held by this gating claim', { action_id: id });
      }
      const stream = this.#requireStream(action.stream_id);
      if (stream.stream_revision !== action.prepared_stream_revision) {
        fail('FIRST_LINE_ACTION_STALE_REVISION', 'stream changed before SENDING', { action_id: id });
      }
      const changed = this.db.prepare(`UPDATE public_actions SET state='SENDING',send_started_at=?,updated_at=?
        WHERE action_id=? AND state='GATING' AND lease_token=?`).run(at, at, id, token).changes;
      if (changed !== 1) fail('FIRST_LINE_STALE_WRITE', 'action changed before SENDING');
      return this.#readAction(id);
    });
  }

  markActionUncertain(actionId, { reason = 'send_outcome_unknown' } = {}) {
    const id = safeToken(actionId, 'action_id');
    const terminalReason = safeToken(reason, 'terminal_reason');
    return tx(this.db, () => {
      const action = this.#requireAction(id);
      if (action.state !== 'SENDING' && action.state !== 'UNCERTAIN') {
        fail('FIRST_LINE_ACTION_STATE_INVALID', 'only SENDING may become UNCERTAIN', { state: action.state });
      }
      if (action.state === 'SENDING') {
        this.db.prepare(`UPDATE public_actions SET state='UNCERTAIN',terminal_reason=?,lease_token=NULL,
          lease_expires_at=NULL,updated_at=? WHERE action_id=? AND state='SENDING'`)
          .run(terminalReason, this.now(), id);
      }
      return this.#readAction(id);
    });
  }

  confirmAction(actionId, { confirmedSourceMessageId } = {}) {
    const id = safeToken(actionId, 'action_id');
    const source = positiveInteger(confirmedSourceMessageId, 'confirmed_source_message_id');
    const at = this.now();
    return tx(this.db, () => {
      const action = this.#requireAction(id);
      if (action.state !== 'SENDING' && action.state !== 'UNCERTAIN') {
        fail('FIRST_LINE_ACTION_STATE_INVALID', 'only SENDING/UNCERTAIN may confirm', { state: action.state });
      }
      this.db.prepare(`UPDATE public_actions SET state='CONFIRMED',confirmed_source_message_id=?,confirmed_at=?,
        lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE action_id=?`).run(source, at, at, id);
      return this.#readAction(id);
    });
  }

  cancelActionBeforeSend(actionId, { reason = 'stale' } = {}) {
    const id = safeToken(actionId, 'action_id');
    const terminalReason = safeToken(reason, 'terminal_reason');
    return tx(this.db, () => {
      const action = this.#requireAction(id);
      if (action.state !== 'PREPARED' && action.state !== 'GATING') {
        fail('FIRST_LINE_ACTION_STATE_INVALID', 'only unsent action may be cancelled', { state: action.state });
      }
      this.#cancelUnsentAction(action, terminalReason);
      return this.#readAction(id);
    });
  }

  listRecoverablePublicActions({ now = this.now() } = {}) {
    nonNegativeInteger(now, 'now');
    return readTx(this.db, () => this.db.prepare(`SELECT action_id FROM public_actions
      WHERE state IN ('PREPARED','GATING','SENDING','UNCERTAIN')
      ORDER BY created_at,action_id`).all().map(row => this.#readAction(row.action_id)));
  }

  getPublicAction(actionId) {
    const id = safeToken(actionId, 'action_id');
    return readTx(this.db, () => this.#readAction(id));
  }

  #cancelUnsentAction(action, reason) {
    if (action.state !== 'PREPARED' && action.state !== 'GATING') {
      fail('FIRST_LINE_ACTION_STATE_INVALID', 'only unsent action may be cancelled', { action_id: action.action_id });
    }
    if (action.action_type === 'CLARIFY' && action.episode_id) {
      const episode = this.db.prepare('SELECT * FROM episodes WHERE episode_id=?').get(action.episode_id);
      if (episode?.clarification_action_id === action.action_id) {
        this.db.prepare(`UPDATE episodes SET clarification_prompts_sent=0,requested_slot=NULL,
          clarification_action_id=NULL,version=version+1,updated_at=? WHERE episode_id=?`)
          .run(this.now(), action.episode_id);
      }
    }
    this.db.prepare(`UPDATE public_actions SET state='CANCELLED',terminal_reason=?,lease_token=NULL,
      lease_expires_at=NULL,updated_at=? WHERE action_id=?`).run(reason, this.now(), action.action_id);
  }

  #requireStream(streamId) {
    const row = this.db.prepare('SELECT * FROM conversation_streams WHERE stream_id=?').get(streamId);
    if (!row) fail('FIRST_LINE_STREAM_NOT_FOUND', 'conversation stream not found', { stream_id: streamId });
    return row;
  }
  #requireAction(actionId) {
    const row = this.db.prepare('SELECT * FROM public_actions WHERE action_id=?').get(actionId);
    if (!row) fail('FIRST_LINE_ACTION_NOT_FOUND', 'public action not found', { action_id: actionId });
    return row;
  }
  #requireActiveEpisode(episodeId, expectedVersion) {
    const row = this.db.prepare('SELECT * FROM episodes WHERE episode_id=?').get(episodeId);
    if (!row) fail('FIRST_LINE_EPISODE_NOT_FOUND', 'episode not found', { episode_id: episodeId });
    if (row.state !== 'active') fail('FIRST_LINE_EPISODE_CLOSED', 'episode is closed', { episode_id: episodeId });
    if (row.version !== expectedVersion) fail('FIRST_LINE_STALE_WRITE', 'episode version mismatch', { expected_version: expectedVersion, actual_version: row.version });
    return row;
  }
  #bumpEpisode(episodeId, version) {
    const changed = this.db.prepare(`UPDATE episodes SET version=version+1,updated_at=?
      WHERE episode_id=? AND state='active' AND version=?`).run(this.now(), episodeId, version).changes;
    if (changed !== 1) fail('FIRST_LINE_STALE_WRITE', 'episode changed before write');
  }

  #readStream(streamId) {
    const row = this.db.prepare('SELECT * FROM conversation_streams WHERE stream_id=?').get(streamId);
    if (!row) return null;
    return {
      stream_id: row.stream_id,
      source_provider: row.source_provider,
      source_conversation_id: row.source_conversation_id,
      stream_revision: row.stream_revision,
      last_event_seq: row.last_event_seq,
      scan_highwater: row.scan_highwater,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  #eventDto(row) {
    return {
      stream_id: row.stream_id, event_seq: row.event_seq, source_message_id: row.source_message_id,
      event_kind: row.event_kind, message_type: row.message_type, sender_class: row.sender_class,
      sender_id: row.sender_id, content_type: row.content_type, deleted: row.deleted_flag === 1,
      unsupported: row.unsupported_flag === 1, has_attachments: row.has_attachments === 1,
      source_id: row.source_id, accepted_at: row.accepted_at,
    };
  }

  #readEpisode(episodeId) {
    const row = this.db.prepare('SELECT * FROM episodes WHERE episode_id=?').get(episodeId);
    if (!row) return null;
    let requested;
    try { requested = normalizeRequestedSlot(row.requested_slot); }
    catch { fail('FIRST_LINE_DB_CORRUPT', 'persisted requested slot is invalid', { episode_id: episodeId }); }
    const slots = {};
    for (const item of this.db.prepare('SELECT * FROM episode_slots WHERE episode_id=? ORDER BY slot_name').all(episodeId)) {
      const value = parseJson(item.value_json);
      validatePersistedSlot(item.slot_name, value);
      slots[item.slot_name] = { value, derived_through_event_seq: item.derived_through_event_seq };
    }
    return {
      episode_id: row.episode_id, stream_id: row.stream_id, state: row.state, version: row.version,
      clarification_prompts_sent: row.clarification_prompts_sent, requested_slot: requested,
      clarification_action_id: row.clarification_action_id, stable_slots: slots,
      created_at: row.created_at, updated_at: row.updated_at, closed_at: row.closed_at, close_reason: row.close_reason,
    };
  }

  #readAction(actionId) {
    const row = this.db.prepare('SELECT * FROM public_actions WHERE action_id=?').get(actionId);
    if (!row) return null;
    if (!ACTION_TYPES.has(row.action_type) || (!LIVE_ACTION_STATES.has(row.state) && !TERMINAL_ACTION_STATES.has(row.state))) {
      fail('FIRST_LINE_DB_CORRUPT', 'persisted public action enum is invalid', { action_id: actionId });
    }
    const basis = parseJson(row.basis_event_seqs_json);
    normalizeBasisEventSeqs(basis);
    const candidates = this.db.prepare('SELECT * FROM public_action_candidates WHERE action_id=? ORDER BY ordinal').all(actionId)
      .map(item => {
        const value = parseJson(item.value_json);
        validatePersistedSlot(item.slot_name, value);
        return { slot: item.slot_name, value };
      });
    return {
      action_id: row.action_id, stream_id: row.stream_id, episode_id: row.episode_id,
      episode_version: row.episode_version, prepared_stream_revision: row.prepared_stream_revision,
      action_type: row.action_type, state: row.state, basis_event_seqs: basis,
      requested_slot: row.requested_slot, presented_candidates: candidates,
      lease_token: row.lease_token, lease_expires_at: row.lease_expires_at, attempts: row.attempts,
      deadline_at: row.deadline_at, confirmed_source_message_id: row.confirmed_source_message_id,
      terminal_reason: row.terminal_reason, created_at: row.created_at, updated_at: row.updated_at,
      send_started_at: row.send_started_at, confirmed_at: row.confirmed_at,
    };
  }

  #attestSchema() {
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    const metadata = this.db.prepare('SELECT schema_version FROM metadata WHERE singleton=1').get();
    const integrity = this.db.prepare('PRAGMA integrity_check').get().integrity_check;
    if (version !== SCHEMA_VERSION || metadata?.schema_version !== SCHEMA_VERSION || integrity !== 'ok') {
      fail('FIRST_LINE_DB_INVALID', 'schema/integrity version check failed', { user_version: version, metadata_version: metadata?.schema_version, integrity });
    }
    for (const [table, columns] of Object.entries(EXPECTED_COLUMNS)) {
      const actual = this.db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
      if (actual.length !== columns.length || actual.some((name, i) => name !== columns[i])) {
        fail('FIRST_LINE_DB_INVALID', 'schema column attestation failed', { table, actual, expected: columns });
      }
    }
    const indexes = new Set(this.db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(row => row.name));
    for (const name of REQUIRED_INDEXES) {
      if (!indexes.has(name)) fail('FIRST_LINE_DB_INVALID', 'required index missing', { index: name });
    }
  }
}

function validatePersistedSlot(slotName, value) {
  try { return normalizeSlotValue(slotName, value); }
  catch (error) {
    if (error instanceof FirstLineStateError) fail('FIRST_LINE_DB_CORRUPT', 'persisted stable/candidate slot is invalid', { slot_name: slotName });
    throw error;
  }
}

export {
  ACTION_TYPES,
  BUSY_TIMEOUT_MS,
  EVENT_KINDS,
  LIVE_ACTION_STATES,
  MAX_PRESENTED_CANDIDATES,
  SCHEMA_VERSION,
  SLOT_SPECS,
  TERMINAL_ACTION_STATES,
};
