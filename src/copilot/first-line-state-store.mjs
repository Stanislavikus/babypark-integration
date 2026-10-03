import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_VERSION = 2;
const BUSY_TIMEOUT_MS = 5000;
const MAX_PRESENTED_CANDIDATES = 20;

const LIVE_ACTION_STATES = new Set(['PREPARED', 'GATING', 'SENDING', 'UNCERTAIN']);
const TERMINAL_ACTION_STATES = new Set(['CONFIRMED', 'STALE', 'CANCELLED', 'HANDOFF_DONE', 'NOT_SENT']);
const ACTION_STATES = new Set([...LIVE_ACTION_STATES, ...TERMINAL_ACTION_STATES]);
const ACTION_TYPES = new Set(['ANSWER', 'CLARIFY']);

const EVENT_KINDS = new Set([
  'CUSTOMER_MESSAGE',
  'CONFIGURED_BOT_PUBLIC',
  'HUMAN_PUBLIC_REPLY',
  'OTHER_BOT_PUBLIC_REPLY',
  'SYSTEM_TEMPLATE',
  'AUTOMATION_PUBLIC',
  'UNKNOWN_PUBLIC',
]);

const MESSAGE_TYPES = new Set(['incoming', 'outgoing', 'template']);
const SENDER_CLASSES = new Set([
  'contact',
  'configured_agent_bot',
  'human',
  'other_agent_bot',
  'none',
  'unknown',
]);

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

CREATE TABLE conversation_events (
  stream_id TEXT NOT NULL REFERENCES conversation_streams(stream_id) ON DELEHÐTÐÐQK][ÜÙ\HSQÑTÕSÒPÒÊ][ÜÙ\HHJKÛÝ\ÙWÛY\ÜØYÙWÚYSQÑTÕSÒPÒÊÛÝ\ÙWÛY\ÜØYÙWÚYHJK][ÚÚ[VÕSY\ÜØYÙWÝ\HVÕSÙ[\ØÛ\ÜÈVÕSÙ[\ÚYSQÑTÒPÒÊÙ[\ÚYTÈSÔÙ[\ÚYHJKÛÛ[Ý\HV[]YÙYÈSQÑTÕSQUSÒPÒÊ[]YÙYÈS
JJK[Ý\ÜYÙYÈSQÑTÕSQUSÒPÒÊ[Ý\ÜYÙYÈS
JJK\×Ø]XÚY[ÈSQÑTÕSQUSÒPÒÊ\×Ø]XÚY[ÈS
JJKXX×ØXÝ[ÛÚYVQTSÑTÈXX×ØXÝ[ÛÊXÝ[ÛÚY
HÓSUHSON_INVALID', 'unsupported episode close reason', { close_reason: value });
  }
  return value;
}

function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    fail('FIRST_LINE_CANDIDATE_INVALID', 'candidate must be an object');
  }
  const keys = Object.keys(candidate).sort();
  if (keys.length !== 2 || keys[0] !== 'slot' || keys[1] !== 'value') {
    fail('FIRST_LINE_CANDIDATE_INVALID', 'candidate must contain only slot and value');
  }
  if (!Object.hasOwn(SLOT_SPECS, candidate.slot)) {
    fail('FIRST_LINE_CANDIDATE_INVALID', 'candidate slot must be supported');
  }
  return { slot: candidate.slot, value: normalizeSlotValue(candidate.slot, candidate.value) };
}

function normalizeEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    fail('FIRST_LINE_EVENT_INVALID', 'event must be an object');
  }
  return {
    sourceMessageId: positiveInteger(event.sourceMessageId, 'source_message_id'),
    eventKind: enumValue(event.eventKind, EVENT_KINDS, 'event_kind'),
    messageType: enumValue(event.messageType, MESSAGE_TYPES, 'message_type'),
    senderClass: enumValue(event.senderClass, SENDER_CLASSES, 'sender_class'),
    senderId: event.senderId === null || event.senderId === undefined
      ? null : positiveInteger(event.senderId, 'sender_id'),
    contentType: normalizeOptionalContentType(event.contentType),
    deleted: boolInt(event.deleted ?? false, 'deleted'),
    unsupported: boolInt(event.unsupported ?? false, 'unsupported'),
    hasAttachments: boolInt(event.hasAttachments ?? false, 'has_attachments'),
    publicActionId: optionalSafeToken(event.publicActionId, 'public_action_id'),
  };
}

function normalizeBasisEventSeqs(value) {
  if (!Array.isArray(value) || value.length < 1) {
    fail('FIRST_LINE_ACTION_BASIS_INVALID', 'basisEventSeqs must be a non-empty array');
  }
  const out = value.map((item, index) => positiveInteger(item, `basis_event_seq_${index}`));
  for (let i = 1; i < out.length; i += 1) {
    if (out[i] <= out[i - 1]) {
      fail('FIRST_LINE_ACTION_BASIS_INVALID', 'basis event seqs must be strictly increasing');
    }
  }
  return out;
}

function parseJson(text, code, details = {}) {
  try {
    return JSON.parse(text);
  } catch {
    fail(code, 'persisted JSON is corrupt', details);
  }
}

function canonicalJson(value) {
  return JSON.stringify(value);
}

function validatePersistedSlot(slotName, value) {
  try {
    return normalizeSlotValue(slotName, value);
  } catch (error) {
    if (error instanceof FirstLineStateError) {
      fail('FIRST_LINE_DB_CORRUPT', 'persisted stable slot is invalid', { slot_name: slotName });
    }
    throw error;
  }
}

function validatePersistedRequestedSlot(value) {
  try {
    return normalizeRequestedSlot(value);
  } catch (error) {
    if (error instanceof FirstLineStateError) {
      fail('FIRST_LINE_DB_CORRUPT', 'persisted requested slot is invalid', { requested_slot: value });
    }
    throw error;
  }
}

function actionIsLive(state) {
  return LIVE_ACTION_STATES.has(state);
}

function actionIsTerminal(state) {
  return TERMINAL_ACTION_STATES.has(state);
}

export class FirstLineStateStore {
  static create(file, {
    now = () => Date.now(),
    streamIdFactory = () => `stream_${crypto.randomUUID()}`,
    episodeIdFactory = () => `episode_${crypto.randomUUID()}`,
    actionIdFactory = () => `action_${crypto.randomUUID()}`,
  } = {}) {
    const resolved = path.resolve(file);
    const parent = path.dirname(resolved);
    if (!fs.existsSync(parent)) fail('FIRST_LINE_PARENT_MISSING', 'state database parent does not exist');
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
    return FirstLineStateStore.open(file, { now, streamIdFactory, episodeIdFactory, actionIdFactory });
  }

  static open(file, {
    now = () => Date.now(),
    streamIdFactory = () => `stream_${crypto.randomUUID()}`,
    episodeIdFactory = () => `episode_${crypto.randomUUID()}`,
    actionIdFactory = () => `action_${crypto.randomUUID()}`,
  } = {}) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) fail('FIRST_LINE_DB_MISSING', 'state database is missing');
    if ((fs.statSync(resolved).mode & 0o077) !== 0) {
      fail('FIRST_LINE_DB_PERMISSIONS_UNSAFE', 'state database must be mode 0600');
    }
    const store = new FirstLineStateStore(
      resolved, now, streamIdFactory, episodeIdFactory, actionIdFactory
    );
    try {
      store.#attestSchema();
      return store;
    } catch (error) {
      try { store.close(); } catch {}
      throw error;
    }
  }

  constructor(file, now, streamIdFactory, episodeIdFactory, actionIdFactory) {
    this.file = file;
    this.now = now;
    this.streamIdFactory = streamIdFactory;
    this.episodeIdFactory = episodeIdFactory;
    this.actionIdFactory = actionIdFactory;
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}`);
  }

  close() {
    this.db.close();
  }

  ensureConversationStream({ sourceProvider, sourceConversationId }) {
    const provider = normalizeSourceProvider(sourceProvider);
    const conversation = positiveInteger(sourceConversationId, 'source_conversation_id');
    const at = this.now();

    return tx(this.db, () => {
      const existing = this.db.prepare(`SELECT * FROM conversation_streams
        WHERE source_provider=? AND source_conversation_id=?`).get(provider, conversation);
      if (existing) return this.#readStream(existing.stream_id);

      const streamId = safeToken(this.streamIdFactory(), 'stream_id');
      this.db.prepare(`INSERT INTO conversation_streams
        (stream_id,source_provider,source_conversation_id,stream_revision,last_event_seq,created_at,updated_at)
        VALUES (?,?,?,0,0,?,?)`).run(streamId, provider, conversation, at, at);
      return this.#readStream(streamId);
    });
  }

  getConversationStream(streamId) {
    const id = safeToken(streamId, 'stream_id');
    return readTx(this.db, () => this.#readStream(id));
  }

  findConversationStream({ sourceProvider, sourceConversationId }) {
    const provider = normalizeSourceProvider(sourceProvider);
    const conversation = positiveInteger(sourceConversationId, 'source_conversation_id');
    return readTx(this.db, () => {
      const row = this.db.prepare(`SELECT stream_id FROM conversation_streams
        WHERE source_provider=? AND source_conversation_id=?`).get(provider, conversation);
      return row ? this.#readStream(row.stream_id) : null;
    });
  }

  recordScanHighwater(streamId, sourceMessageId) {
    const id = safeToken(streamId, 'stream_id');
    const message = positiveInteger(sourceMessageId, 'source_message_id');
    return tx(this.db, () => {
      this.#requireStream(id);
      this.db.prepare(`UPDATE conversation_streams
        SET scan_highwater=CASE
          WHEN scan_highwater IS NULL OR scan_highwater<? THEN ?
          ELSE scan_highwater
        END, updated_at=? WHERE stream_id=?`).run(message, message, this.now(), id);
      return this.#readStream(id);
    });
  }

  ingestConversationEvent(streamId, event) {
    const id = safeToken(streamId, 'stream_id');
    const normalized = normalizeEvent(event);
    const at = this.now();

    return tx(this.db, () => {
      const stream = this.#requireStream(id);
      const existing = this.db.prepare(`SELECT * FROM conversation_events
        WHERE stream_id=? AND source_message_id=?`).get(id, normalized.sourceMessageId);
      if (existing) {
        return {
          inserted: false,
          event: this.#eventDto(existing),
          stream: this.#readStream(id),
        };
      }

      if (normalized.publicActionId !== null) {
        const action = this.db.prepare('SELECT stream_id FROM public_actions WHERE action_id=?')
          .get(normalized.publicActionId);
        if (!action || action.stream_id !== id) {
          fail('FIRST_LINE_ACTION_LINK_INVALID', 'public action does not belong to stream',
            { action_id: normalized.publicActionId, stream_id: id });
        }
      }

      const eventSeq = stream.last_event_seq + 1;
      this.db.prepare(`INSERT INTO conversation_events
        (stream_id,event_seq,source_message_id,event_kind,message_type,sender_class,sender_id,content_type,
         deleted_flag,unsupported_flag,has_attachments,public_action_id,accepted_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, eventSeq, normalized.sourceMessageId, normalized.eventKind, normalized.messageType,
          normalized.senderClass, normalized.senderId, normalized.contentType, normalized.deleted,
          normalized.unsupported, normalized.hasAttachments, normalized.publicActionId, at);

      const changed = this.db.prepare(`UPDATE conversation_streams
        SET last_event_seq=?,stream_revision=stream_revision+1,updated_at=?
        WHERE stream_id=? AND last_event_seq=? AND stream_revision=?`)
        .run(eventSeq, at, id, stream.last_event_seq, stream.stream_revision).changes;
      if (changed !== 1) {
        fail('FIRST_LINE_STALE_WRITE', 'stream changed before event append', { stream_id: id });
      }
      return {
        inserted: true,
        event: this.#eventDto(this.db.prepare(`SELECT * FROM conversation_events
          WHERE stream_id=? AND event_seq=?`).get(id, eventSeq)),
        stream: this.#readStream(id),
      };
    });
  }

  listConversationEvents(streamId) {
    const id = safeToken(streamId, 'stream_id');
    return readTx(this.db, () => {
      this.#requireStream(id);
      return this.db.prepare(`SELECT * FROM conversation_events
        WHERE stream_id=? ORDER BY event_seq`).all(id).map(row => this.#eventDto(row));
    });
  }

  getConversationEventBySource(streamId, sourceMessageId) {
    const id = safeToken(streamId, 'stream_id');
    const source = positiveInteger(sourceMessageId, 'source_message_id');
    return readTx(this.db, () => {
      const row = this.db.prepare(`SELECT * FROM conversation_events
        WHERE stream_id=? AND source_message_id=?`).get(id, source);
      return row ? this.#eventDto(row) : null;
    });
  }

  beginEpisode({ streamId }) {
    const stream = safeToken(streamId, 'stream_id');
    const at = this.now();
    return tx(this.db, () => {
      this.#requireStream(stream);
      const active = this.db.prepare(
        "SELECT episode_id FROM episodes WHERE stream_id=? AND state='active'"
      ).get(stream);
      if (active) {
        fail('FIRST_LINE_EPISODE_ACTIVE_EXISTS', 'stream already has an active episode',
          { stream_id: stream, episode_id: active.episode_id });
      }
      const episodeId = safeToken(this.episodeIdFactory(), 'episode_id');
      this.db.prepare(`INSERT INTO episodes
        (episode_id,stream_id,state,version,clarification_prompts_sent,created_at,updated_at)
        VALUES (?,?,'active',1,0,?,?)`).run(episodeId, stream, at, at);
      return this.#readEpisode(episodeId);
    });
  }

  getEpisode(episodeId) {
    const id = safeToken(episodeId, 'episode_id');
    return readTx(this.db, () => this.#readEpisode(id));
  }

  loadActiveEpisode(streamId) {
    const stream = safeToken(streamId, 'stream_id');
    return readTx(this.db, () => {
      const row = this.db.prepare(
        "SELECT episode_id FROM episodes WHERE stream_id=? AND state='active'"
      ).get(stream);
      return row ? this.#readEpisode(row.episode_id) : null;
    });
  }

  closeEpisode(episodeId, { reason, expectedVersion } = {}) {
    const id = safeToken(episodeId, 'episode_id');
    const closeReason = normalizeCloseReason(reason);
    const version = positiveInteger(expectedVersion, 'expected_version');
    return tx(this.d