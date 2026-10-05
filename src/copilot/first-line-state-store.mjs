import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_VERSION = 3;
const PREVIOUS_SCHEMA_VERSION = 2;
const V2_SCHEMA_MASTER_SHA256 =
  'd84094598ffb3371293f8b361f88b19b2997a7e37a79ce5226abcd62326da19e';
const V3_SCHEMA_MASTER_SHA256 =
  'e7a9f211d23e2439bcd63a29fb3b9ed1569e3958ca536c240af00876dd410e07';
const BUSY_TIMEOUT_MS = 5000;
const MAX_PRESENTED_CANDIDATES = 20;
// A whole-conversation authorizing snapshot is unprovable at 1000 public rows;
// an open semantic turn therefore never needs a planning bound above 999 events.
const MAX_OPEN_TURN_EVENTS = 999;
const ROUTING_SUFFIX_FETCH_LIMIT = MAX_OPEN_TURN_EVENTS + 1;
const ROUTING_SNAPSHOT_SCHEMA = 'bp.first-line.routing-snapshot/1';
const EPISODE_TRANSITION_SCHEMA = 'bp.first-line.episode-transition/1';
const EPISODE_CONTINUATION_SCHEMA = 'bp.first-line.episode-continuation/1';
const certifiedRoutingSnapshots = new WeakSet();

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
  'product_id', 'variant_id', 'category_id', 'brand_id', 'store_id',
  'max_price_minor', 'money', 'shortlist_anchor',
]);

const CONSTRAINT_LATCH_CLASSES = new Set([
  'UNSUPPORTED_EXCLUSION',
  'SUBJECTIVE_RECOMMENDATION',
  'UNSUPPORTED_AGE_SUITABILITY',
  'UNSUPPORTED_COMPATIBILITY',
  'ORDER_SPECIFIC',
  'RETURN_CASE',
  'OTHER_UNCONSUMED_CONSTRAINT',
]);
const CONSTRAINT_LATCH_ORDER = Object.freeze([
  'RETURN_CASE',
  'ORDER_SPECIFIC',
  'UNSUPPORTED_COMPATIBILITY',
  'SUBJECTIVE_RECOMMENDATION',
  'UNSUPPORTED_EXCLUSION',
  'UNSUPPORTED_AGE_SUITABILITY',
  'OTHER_UNCONSUMED_CONSTRAINT',
]);

const SCHEMA = `
PRAGMA foreign_keys=ON;
PRAGMA user_version=3;
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
CREATE INDEX conversation_events_source_id
  ON conversation_events(stream_id, source_id);
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
CREATE TABLE episode_constraint_latches (
  episode_id TEXT NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
  latch_class TEXT NOT NULL CHECK(latch_class IN (
    'UNSUPPORTED_EXCLUSION',
    'SUBJECTIVE_RECOMMENDATION',
    'UNSUPPORTED_AGE_SUITABILITY',
    'UNSUPPORTED_COMPATIBILITY',
    'ORDER_SPECIFIC',
    'RETURN_CASE',
    'OTHER_UNCONSUMED_CONSTRAINT'
  )),
  first_event_seq INTEGER NOT NULL CHECK(first_event_seq >= 1),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(episode_id, latch_class)
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
  episode_constraint_latches: ['episode_id','latch_class','first_event_seq','created_at'],
  public_actions: ['action_id','stream_id','episode_id','episode_version','prepared_stream_revision','action_type','state','basis_event_seqs_json','requested_slot','lease_token','lease_expires_at','attempts','deadline_at','confirmed_source_message_id','terminal_reason','created_at','updated_at','send_started_at','confirmed_at'],
  public_action_candidates: ['action_id','slot_name','ordinal','value_json'],
});
const EXPECTED_COLUMNS_V2 = Object.freeze(
  Object.fromEntries(
    Object.entries(EXPECTED_COLUMNS)
      .filter(([table]) => table !== 'episode_constraint_latches')
  )
);

const LATCH_SCHEMA_SQL = `
CREATE TABLE episode_constraint_latches (
  episode_id TEXT NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
  latch_class TEXT NOT NULL CHECK(latch_class IN (
    'UNSUPPORTED_EXCLUSION',
    'SUBJECTIVE_RECOMMENDATION',
    'UNSUPPORTED_AGE_SUITABILITY',
    'UNSUPPORTED_COMPATIBILITY',
    'ORDER_SPECIFIC',
    'RETURN_CASE',
    'OTHER_UNCONSUMED_CONSTRAINT'
  )),
  first_event_seq INTEGER NOT NULL CHECK(first_event_seq >= 1),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(episode_id, latch_class)
);
`;

const REQUIRED_INDEXES_V2 = new Set([
  'sqlite_autoindex_conversation_streams_2',
  'sqlite_autoindex_conversation_events_2',
  'one_active_episode_per_stream',
  'conversation_events_source_id',
  'one_live_public_action_per_stream',
  'sqlite_autoindex_public_actions_2',
]);
const REQUIRED_INDEXES = new Set([
  ...REQUIRED_INDEXES_V2,
  'sqlite_autoindex_episode_constraint_latches_1',
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
function schemaMasterFingerprint(db) {
  const rows = db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master
    WHERE type IN ('table','index','trigger','view')
    ORDER BY type,name`).all();
  return crypto.createHash('sha256')
    .update(JSON.stringify(rows))
    .digest('hex');
}

function deepFreezeRoutingValue(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreezeRoutingValue(item);
    return Object.freeze(value);
  }
  for (const item of Object.values(value)) deepFreezeRoutingValue(item);
  return Object.freeze(value);
}

export function isCertifiedRoutingSnapshot(value) {
  return Boolean(value && typeof value === 'object' && certifiedRoutingSnapshots.has(value));
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

function routingLedgerFingerprint(entries) {
  const canonical = entries.map(entry => ({
    event: {
      stream_id: entry.event.stream_id,
      event_seq: entry.event.event_seq,
      source_message_id: entry.event.source_message_id,
      event_kind: entry.event.event_kind,
      message_type: entry.event.message_type,
      sender_class: entry.event.sender_class,
      sender_id: entry.event.sender_id,
      content_type: entry.event.content_type,
      deleted: entry.event.deleted,
      unsupported: entry.event.unsupported,
      has_attachments: entry.event.has_attachments,
      source_id: entry.event.source_id,
      accepted_at: entry.event.accepted_at,
    },
    confirmed_babypark_action: entry.confirmed_babypark_action == null
      ? null
      : {
          action_id: entry.confirmed_babypark_action.action_id,
          action_type: entry.confirmed_babypark_action.action_type,
          prepared_stream_revision:
            entry.confirmed_babypark_action.prepared_stream_revision,
          episode_id: entry.confirmed_babypark_action.episode_id,
          episode_version: entry.confirmed_babypark_action.episode_version,
        },
  }));
  return 'sha256:' + crypto.createHash('sha256')
    .update(canonicalJson(canonical), 'utf8')
    .digest('hex');
}

function routingLedgerFingerprintValue(value, field = 'routing_ledger_fingerprint') {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    fail('FIRST_LINE_ROUTING_PLAN_INVALID',
      field + ' must be a canonical metadata fingerprint', { field });
  }
  return value;
}
function parseJson(value, code = 'FIRST_LINE_DB_CORRUPT') {
  try { return JSON.parse(value); } catch { fail(code, 'persisted JSON is corrupt'); }
}
function normalizeRequestedSlot(value) {
  if (value == null) return null;
  if (!REQUESTED_SLOTS.has(value)) fail('FIRST_LINE_REQUESTED_SLOT_INVALID', 'unsupported requested slot', { requested_slot: value });
  return value;
}
function normalizeRequestedMoneySelection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'currency,minor_units' ||
      value.currency !== 'UAH' ||
      !Number.isSafeInteger(value.minor_units) || value.minor_units < 0) {
    fail('FIRST_LINE_SELECTION_INVALID',
      'price-ceiling selection must be one exact UAH money value');
  }
  return Object.freeze({
    currency: 'UAH',
    minor_units: value.minor_units,
  });
}

function normalizeConstraintLatchEvidence(value) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > CONSTRAINT_LATCH_CLASSES.size) {
    fail('FIRST_LINE_CONSTRAINT_LATCH_INVALID',
      'constraint latches must be a bounded array');
  }
  const byClass = new Map();
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).sort().join(',') !== 'latch_class,source_event_seq') {
      fail('FIRST_LINE_CONSTRAINT_LATCH_INVALID',
        'constraint latch evidence must contain only latch_class and source_event_seq',
        { index });
    }
    const latchClass = enumValue(
      item.latch_class,
      CONSTRAINT_LATCH_CLASSES,
      'constraint_latch_class'
    );
    const sourceEventSeq = positiveInteger(item.source_event_seq, 'source_event_seq');
    const prior = byClass.get(latchClass);
    if (prior === undefined || sourceEventSeq < prior) {
      byClass.set(latchClass, sourceEventSeq);
    }
  }
  return Object.freeze(
    CONSTRAINT_LATCH_ORDER
      .filter(latchClass => byClass.has(latchClass))
      .map(latchClass => Object.freeze({
        latch_class: latchClass,
        source_event_seq: byClass.get(latchClass),
      }))
  );
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

function normalizeConstraintBasisEventSeqs(value, latches) {
  if (latches.length === 0) {
    if (value == null || (Array.isArray(value) && value.length === 0)) {
      return Object.freeze([]);
    }
  }
  if (!Array.isArray(value) || value.length < 1) {
    fail('FIRST_LINE_CONSTRAINT_LATCH_PROVENANCE_INVALID',
      'constraint latch basis event seqs must be non-empty');
  }
  const out = value.map((item, index) =>
    positiveInteger(item, 'constraint_basis_event_seq_' + index)
  );
  for (let index = 1; index < out.length; index += 1) {
    if (out[index] <= out[index - 1]) {
      fail('FIRST_LINE_CONSTRAINT_LATCH_PROVENANCE_INVALID',
        'constraint latch basis event seqs must be strictly increasing');
    }
  }
  return Object.freeze(out);
}

function expectedEpisode(id, version) {
  if (id == null && version == null) return { id: null, version: null };
  if (id == null || version == null) {
    fail('FIRST_LINE_ROUTING_PLAN_INVALID',
      'expected episode id/version must both be present or both be null');
  }
  return {
    id: safeToken(id, 'expected_episode_id'),
    version: positiveInteger(version, 'expected_episode_version'),
  };
}

function expectedLiveAction(id, state) {
  if (id == null && state == null) return { id: null, state: null };
  if (id == null || state == null) {
    fail('FIRST_LINE_ROUTING_PLAN_INVALID',
      'expected live action id/state must both be present or both be null');
  }
  return {
    id: safeToken(id, 'expected_live_action_id'),
    state: enumValue(state, LIVE_ACTION_STATES, 'expected_live_action_state'),
  };
}
function validateEventTopology(event) {
  const senderNeedsId = new Set(['contact', 'configured_agent_bot', 'human', 'other_agent_bot']);
  if (senderNeedsId.has(event.senderClass) && event.senderId == null) {
    fail('FIRST_LINE_EVENT_TOPOLOGY_INVALID', 'known sender class requires sender id',
      { event_kind: event.eventKind, sender_class: event.senderClass });
  }
  if (event.senderClass === 'none' && event.senderId != null) {
    fail('FIRST_LINE_EVENT_TOPOLOGY_INVALID', 'sender-none event cannot carry sender id',
      { event_kind: event.eventKind });
  }
  const exact = {
    CUSTOMER_MESSAGE: ['incoming', 'contact'],
    BABYPARK_PUBLIC_REPLY: ['outgoing', 'configured_agent_bot'],
    HUMAN_PUBLIC_REPLY: ['outgoing', 'human'],
    OTHER_BOT_PUBLIC_REPLY: ['outgoing', 'other_agent_bot'],
    SYSTEM_TEMPLATE: ['template', 'none'],
    AUTOMATION_PUBLIC: ['outgoing', 'none'],
  }[event.eventKind];
  if (exact && (event.messageType !== exact[0] || event.senderClass !== exact[1])) {
    fail('FIRST_LINE_EVENT_TOPOLOGY_INVALID', 'event kind conflicts with message/sender topology',
      { event_kind: event.eventKind, message_type: event.messageType, sender_class: event.senderClass });
  }
  return event;
}

function normalizeEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) fail('FIRST_LINE_EVENT_INVALID', 'event must be an object');
  const normalized = {
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
  return validateEventTopology(normalized);
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

  static migrateV2ToV3(file, options = {}) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) fail('FIRST_LINE_DB_MISSING', 'database is missing');
    if ((fs.statSync(resolved).mode & 0o077) !== 0) {
      fail('FIRST_LINE_DB_PERMISSIONS_UNSAFE', 'database must be mode 0600');
    }
    const db = new DatabaseSync(resolved);
    try {
      db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}`);
      const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
      if (integrity !== 'ok') {
        fail('FIRST_LINE_DB_INVALID', 'pre-migration integrity check failed', { integrity });
      }
      const version = Number(db.prepare('PRAGMA user_version').get().user_version);
      if (version === SCHEMA_VERSION) {
        return FirstLineStateStore.open(file, options);
      }
      if (version !== PREVIOUS_SCHEMA_VERSION) {
        fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
          'database schema cannot be migrated by this release', {
            expected_from: PREVIOUS_SCHEMA_VERSION,
            expected_to: SCHEMA_VERSION,
            actual: version,
          });
      }
      const metadata = db.prepare(
        'SELECT schema_version FROM metadata WHERE singleton=1'
      ).get();
      if (Number(metadata?.schema_version) !== PREVIOUS_SCHEMA_VERSION) {
        fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
          'database metadata does not match migration source');
      }
      const sourceSchemaFingerprint = schemaMasterFingerprint(db);
      if (sourceSchemaFingerprint !== V2_SCHEMA_MASTER_SHA256) {
        fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
          'database sqlite_master does not match the frozen v2 schema', {
            expected_schema_fingerprint: V2_SCHEMA_MASTER_SHA256,
            actual_schema_fingerprint: sourceSchemaFingerprint,
          });
      }
      for (const [table, columns] of Object.entries(EXPECTED_COLUMNS_V2)) {
        const actual = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
        if (actual.length !== columns.length ||
            actual.some((name, index) => name !== columns[index])) {
          fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
            'migration source schema attestation failed', {
              table, actual, expected: columns,
            });
        }
      }
      const sourceIndexes = new Set(
        db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all()
          .map(row => row.name)
      );
      for (const name of REQUIRED_INDEXES_V2) {
        if (!sourceIndexes.has(name)) {
          fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
            'migration source required index is missing', { index: name });
        }
      }
      tx(db, () => {
        db.exec(LATCH_SCHEMA_SQL);
        db.prepare('UPDATE metadata SET schema_version=? WHERE singleton=1')
          .run(SCHEMA_VERSION);
        db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
      });
      const after = Number(db.prepare('PRAGMA user_version').get().user_version);
      const afterMeta = Number(
        db.prepare('SELECT schema_version FROM metadata WHERE singleton=1')
          .get()?.schema_version
      );
      if (after !== SCHEMA_VERSION || afterMeta !== SCHEMA_VERSION) {
        fail('FIRST_LINE_DB_MIGRATION_FAILED',
          'schema version did not advance atomically', {
            user_version: after,
            metadata_version: afterMeta,
          });
      }
    } finally {
      try { db.close(); } catch {}
    }
    fs.chmodSync(resolved, 0o600);
    return FirstLineStateStore.open(file, options);
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

  readRoutingSnapshot(streamId) {
    const id = safeToken(streamId, 'stream_id');
    return readTx(this.db, () => {
      this.#requireStream(id);
      const stream = this.#readStream(id);

      const routingLedger = this.#readRoutingLedger(stream);

      const activeRow = this.db.prepare(
        "SELECT episode_id FROM episodes WHERE stream_id=? AND state='active'"
      ).get(id);
      const activeEpisode = activeRow ? this.#readEpisode(activeRow.episode_id) : null;
      if (activeEpisode && activeEpisode.stream_id !== id) {
        fail('FIRST_LINE_DB_CORRUPT', 'active episode is bound to another stream', {
          stream_id: id,
          episode_id: activeEpisode.episode_id,
        });
      }

      const liveRow = this.db.prepare(
        "SELECT action_id FROM public_actions WHERE stream_id=? " +
        "AND state IN ('PREPARED','GATING','SENDING','UNCERTAIN') " +
        'ORDER BY created_at,action_id LIMIT 1'
      ).get(id);
      const livePublicAction = liveRow ? this.#readAction(liveRow.action_id) : null;

      let clarificationAction = null;
      if (activeEpisode?.clarification_action_id) {
        clarificationAction =
          livePublicAction?.action_id === activeEpisode.clarification_action_id
            ? livePublicAction
            : this.#readAction(activeEpisode.clarification_action_id);
        if (!clarificationAction ||
            clarificationAction.stream_id !== id ||
            clarificationAction.episode_id !== activeEpisode.episode_id ||
            clarificationAction.action_type !== 'CLARIFY') {
          fail('FIRST_LINE_DB_CORRUPT', 'active clarification provenance is inconsistent', {
            stream_id: id,
            episode_id: activeEpisode.episode_id,
            clarification_action_id: activeEpisode.clarification_action_id,
          });
        }
      }

      const snapshot = deepFreezeRoutingValue({
        schema: ROUTING_SNAPSHOT_SCHEMA,
        stream,
        active_episode: activeEpisode,
        live_public_action: livePublicAction,
        clarification_action: clarificationAction,
        event_suffix: routingLedger.event_suffix,
        routing_ledger_fingerprint: routingLedger.fingerprint,
        suffix_truncated: routingLedger.suffix_truncated,
        max_open_turn_events: MAX_OPEN_TURN_EVENTS,
      });
      certifiedRoutingSnapshots.add(snapshot);
      return snapshot;
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

  findConversationEventBySourceId(streamId, sourceId) {
    const id = safeToken(streamId, 'stream_id');
    const source = safeToken(sourceId, 'source_id');
    return readTx(this.db, () => {
      const rows = this.db.prepare(
        'SELECT * FROM conversation_events WHERE stream_id=? AND source_id=? ORDER BY event_seq'
      ).all(id, source);
      if (rows.length > 1) {
        fail('FIRST_LINE_SOURCE_ID_AMBIGUOUS', 'multiple ledger events share one action/source id',
          { stream_id: id, source_id: source, count: rows.length });
      }
      return rows.length === 1 ? this.#eventDto(rows[0]) : null;
    });
  }

  confirmPublicActionFromLedger(actionId) {
    const id = safeToken(actionId, 'action_id');
    return tx(this.db, () => {
      const action = this.#requireAction(id);
      if (action.state !== 'SENDING' && action.state !== 'UNCERTAIN') {
        fail('FIRST_LINE_ACTION_STATE_INVALID', 'only SENDING/UNCERTAIN may confirm from ledger',
          { action_id: id, state: action.state });
      }
      const rows = this.db.prepare(
        'SELECT * FROM conversation_events WHERE stream_id=? AND source_id=? ORDER BY event_seq'
      ).all(action.stream_id, id);
      if (rows.length === 0) return null;
      if (rows.length !== 1) {
        fail('FIRST_LINE_SOURCE_ID_AMBIGUOUS', 'multiple ledger events share action source id',
          { action_id: id, count: rows.length });
      }
      const event = this.#eventDto(rows[0]);
      if (event.event_kind !== 'BABYPARK_PUBLIC_REPLY') {
        fail('FIRST_LINE_ACTION_CONFIRMATION_INVALID', 'action source id is attached to non-BabyPark event',
          { action_id: id, event_kind: event.event_kind });
      }
      const at = this.now();
      this.db.prepare(`UPDATE public_actions SET state='CONFIRMED',confirmed_source_message_id=?,confirmed_at=?,
        lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE action_id=?`)
        .run(event.source_message_id, at, at, id);
      return this.#readAction(id);
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
      if (derived !== null) {
        const provenance = this.db.prepare(
          'SELECT 1 AS ok FROM conversation_events WHERE stream_id=? AND event_seq=?'
        ).get(episode.stream_id, derived);
        if (!provenance) {
          fail('FIRST_LINE_SLOT_PROVENANCE_INVALID', 'stable slot provenance references an unknown stream event',
            { episode_id: id, stream_id: episode.stream_id, event_seq: derived });
        }
      }
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
      const pendingLatch = this.db.prepare(
        'SELECT latch_class FROM episode_constraint_latches WHERE episode_id=? LIMIT 1'
      ).get(id) ?? null;
      if (pendingLatch && closeReason !== 'human_takeover') {
        fail('FIRST_LINE_PENDING_HUMAN_LATCH',
          'latched active episode can close only after HUMAN/native handoff terminalization', {
            episode_id: id,
            latch_class: pendingLatch.latch_class,
            close_reason: closeReason,
          });
      }
      const changed = this.db.prepare(`UPDATE episodes SET state='closed',version=version+1,updated_at=?,closed_at=?,close_reason=?
        WHERE episode_id=? AND state='active' AND version=?`).run(at, at, closeReason, id, version).changes;
      if (changed !== 1) fail('FIRST_LINE_STALE_WRITE', 'episode changed before close');
      return this.#readEpisode(id);
    });
  }

  commitConstraintLatchesFromRoutingPlan({
    streamId,
    expectedStreamRevision,
    expectedThroughEventSeq,
    expectedRoutingLedgerFingerprint,
    expectedEpisodeId,
    expectedEpisodeVersion,
    expectedLiveActionId = null,
    expectedLiveActionState = null,
    constraintLatches,
    constraintBasisEventSeqs,
  } = {}) {
    const stream = safeToken(streamId, 'stream_id');
    const revision = positiveInteger(expectedStreamRevision, 'expected_stream_revision');
    const through = positiveInteger(expectedThroughEventSeq, 'expected_through_event_seq');
    const expectedLedgerFingerprint = routingLedgerFingerprintValue(
      expectedRoutingLedgerFingerprint,
      'expected_routing_ledger_fingerprint'
    );
    const episodeId = safeToken(expectedEpisodeId, 'expected_episode_id');
    const episodeVersion = positiveInteger(expectedEpisodeVersion, 'expected_episode_version');
    const actionExpectation = expectedLiveAction(expectedLiveActionId, expectedLiveActionState);
    const latches = normalizeConstraintLatchEvidence(constraintLatches);
    const latchBasis = normalizeConstraintBasisEventSeqs(
      constraintBasisEventSeqs,
      latches
    );
    if (latches.length === 0) {
      fail('FIRST_LINE_CONSTRAINT_LATCH_INVALID',
        'constraint latch commit requires at least one proven class');
    }

    return tx(this.db, () => {
      const currentStream = this.#readStream(stream);
      if (!currentStream ||
          currentStream.stream_revision !== revision ||
          currentStream.last_event_seq !== through) {
        fail('FIRST_LINE_ROUTING_PLAN_STALE',
          'stream changed after constraint plan', { stream_id: stream });
      }
      const currentLedger = this.#readRoutingLedger(currentStream);
      if (currentLedger.fingerprint !== expectedLedgerFingerprint) {
        fail('FIRST_LINE_ROUTING_PLAN_STALE',
          'routing ledger changed after constraint plan', { stream_id: stream });
      }
      const episode = this.#requireActiveEpisode(episodeId, episodeVersion);
      if (episode.stream_id !== stream) {
        fail('FIRST_LINE_ROUTING_PLAN_STALE',
          'constraint episode no longer belongs to stream', {
            stream_id: stream,
            episode_id: episodeId,
          });
      }

      const liveHead = this.db.prepare(`SELECT action_id FROM public_actions WHERE stream_id=? AND state IN
        ('PREPARED','GATING','SENDING','UNCERTAIN')`).get(stream) ?? null;
      const liveAction = liveHead ? this.#readAction(liveHead.action_id) : null;
      if (actionExpectation.id === null) {
        if (liveAction !== null) {
          fail('FIRST_LINE_ROUTING_PLAN_STALE',
            'live public action appeared after constraint plan', {
              stream_id: stream,
              current_action_id: liveAction.action_id,
              current_action_state: liveAction.state,
            });
        }
      } else if (!liveAction ||
                 liveAction.action_id !== actionExpectation.id ||
                 liveAction.state !== actionExpectation.state) {
        fail('FIRST_LINE_ROUTING_PLAN_STALE',
          'live public action changed after constraint plan', {
            stream_id: stream,
            expected_action_id: actionExpectation.id,
            expected_action_state: actionExpectation.state,
            current_action_id: liveAction?.action_id ?? null,
            current_action_state: liveAction?.state ?? null,
          });
      }
      if (liveAction &&
          (liveAction.state === 'SENDING' || liveAction.state === 'UNCERTAIN')) {
        fail('FIRST_LINE_ACTION_SEND_UNRESOLVED',
          'unresolved public send blocks constraint latch commit', {
            action_id: liveAction.action_id,
            state: liveAction.state,
          });
      }

      const at = this.now();
      const before = this.db.prepare(
        'SELECT COUNT(*) AS n FROM episode_constraint_latches WHERE episode_id=?'
      ).get(episodeId).n;
      this.#insertConstraintLatches(
        episodeId, stream, through, latches, latchBasis, at
      );
      const after = this.db.prepare(
        'SELECT COUNT(*) AS n FROM episode_constraint_latches WHERE episode_id=?'
      ).get(episodeId).n;

      if (after > before) {
        const changed = this.db.prepare(`UPDATE episodes
          SET version=version+1,updated_at=?
          WHERE episode_id=? AND stream_id=? AND state='active' AND version=?`)
          .run(at, episodeId, stream, episodeVersion).changes;
        if (changed !== 1) {
          fail('FIRST_LINE_STALE_WRITE',
            'episode changed before constraint latch commit', {
              episode_id: episodeId,
            });
        }
      }

      return Object.freeze({
        stream_id: stream,
        stream_revision: revision,
        through_event_seq: through,
        episode: this.#readEpisode(episodeId),
        latches: this.listEpisodeConstraintLatches(episodeId),
        changed: after > before,
      });
    });
  }

  listEpisodeConstraintLatches(episodeId) {
    const id = safeToken(episodeId, 'episode_id');
    const episode = this.#readEpisode(id);
    if (!episode) fail('FIRST_LINE_EPISODE_NOT_FOUND', 'episode not found', { episode_id: id });
    return Object.freeze(
      this.db.prepare(`SELECT latch_class,first_event_seq,created_at
        FROM episode_constraint_latches
        WHERE episode_id=?
        ORDER BY CASE latch_class
          WHEN 'RETURN_CASE' THEN 1
          WHEN 'ORDER_SPECIFIC' THEN 2
          WHEN 'UNSUPPORTED_COMPATIBILITY' THEN 3
          WHEN 'SUBJECTIVE_RECOMMENDATION' THEN 4
          WHEN 'UNSUPPORTED_EXCLUSION' THEN 5
          WHEN 'UNSUPPORTED_AGE_SUITABILITY' THEN 6
          WHEN 'OTHER_UNCONSUMED_CONSTRAINT' THEN 7
          ELSE 99 END`).all(id).map(row => {
        persistedGuard(() => {
          enumValue(row.latch_class, CONSTRAINT_LATCH_CLASSES, 'constraint_latch_class');
          positiveInteger(row.first_event_seq, 'first_event_seq');
          nonNegativeInteger(row.created_at, 'created_at');
          const sourceEvent = this.db.prepare(
            'SELECT 1 AS ok FROM conversation_events WHERE stream_id=? AND event_seq=?'
          ).get(episode.stream_id, row.first_event_seq);
          if (!sourceEvent) {
            fail('FIRST_LINE_CONSTRAINT_LATCH_PROVENANCE_INVALID',
              'persisted constraint latch references no event in its episode stream');
          }
        }, 'persisted constraint latch is invalid', {
          episode_id: id,
          latch_class: row.latch_class,
        });
        return Object.freeze({
          latch_class: row.latch_class,
          first_event_seq: row.first_event_seq,
          created_at: row.created_at,
        });
      })
    );
  }

  startStandaloneEpisodeFromRoutingPlan({
    streamId,
    expectedStreamRevision,
    expectedThroughEventSeq,
    expectedRoutingLedgerFingerprint,
    expectedEpisodeId = null,
    expectedEpisodeVersion = null,
    expectedLiveActionId = null,
    expectedLiveActionState = null,
    constraintLatches = [],
    constraintBasisEventSeqs = [],
  } = {}) {
    const stream = safeToken(streamId, 'stream_id');
    const revision = positiveInteger(expectedStreamRevision, 'expected_stream_revision');
    const through = positiveInteger(expectedThroughEventSeq, 'expected_through_event_seq');
    const expectedLedgerFingerprint = routingLedgerFingerprintValue(
      expectedRoutingLedgerFingerprint,
      'expected_routing_ledger_fingerprint'
    );
    const episodeExpectation = expectedEpisode(expectedEpisodeId, expectedEpisodeVersion);
    const actionExpectation = expectedLiveAction(expectedLiveActionId, expectedLiveActionState);
    const latches = normalizeConstraintLatchEvidence(constraintLatches);
    const latchBasis = normalizeConstraintBasisEventSeqs(
      constraintBasisEventSeqs,
      latches
    );

    return tx(this.db, () => {
      const currentStream = this.#readStream(stream);
      if (!currentStream) {
        fail('FIRST_LINE_STREAM_NOT_FOUND', 'conversation stream not found', {
          stream_id: stream,
        });
      }
      if (currentStream.stream_revision !== revision ||
          currentStream.last_event_seq !== through) {
        fail('FIRST_LINE_ROUTING_PLAN_STALE', 'stream changed after routing plan', {
          stream_id: stream,
          expected_stream_revision: revision,
          current_stream_revision: currentStream.stream_revision,
          expected_through_event_seq: through,
          current_last_event_seq: currentStream.last_event_seq,
        });
      }

      const currentLedger = this.#readRoutingLedger(currentStream);
      if (currentLedger.fingerprint !== expectedLedgerFingerprint) {
        fail('FIRST_LINE_ROUTING_PLAN_STALE',
          'routing ledger changed after routing plan', {
            stream_id: stream,
            expected_routing_ledger_fingerprint: expectedLedgerFingerprint,
            current_routing_ledger_fingerprint: currentLedger.fingerprint,
          });
      }

      const activeHead = this.db.prepare(
        "SELECT episode_id FROM episodes WHERE stream_id=? AND state='active'"
      ).get(stream) ?? null;
      const activeEpisode = activeHead
        ? this.#readEpisode(activeHead.episode_id)
        : null;

      if (episodeExpectation.id === null) {
        if (activeEpisode !== null) {
          fail('FIRST_LINE_ROUTING_PLAN_STALE', 'routing plan expected no active episode', {
            stream_id: stream,
            current_episode_id: activeEpisode.episode_id,
          });
        }
      } else {
        if (!activeEpisode ||
            activeEpisode.stream_id !== stream ||
            activeEpisode.episode_id !== episodeExpectation.id ||
            activeEpisode.version !== episodeExpectation.version) {
          fail('FIRST_LINE_ROUTING_PLAN_STALE', 'active episode changed after routing plan', {
            stream_id: stream,
            expected_episode_id: episodeExpectation.id,
            expected_episode_version: episodeExpectation.version,
            current_episode_id: activeEpisode?.episode_id ?? null,
            current_episode_version: activeEpisode?.version ?? null,
          });
        }
      }

      if (activeEpisode !== null) {
        const pendingLatch = this.db.prepare(
          'SELECT latch_class FROM episode_constraint_latches WHERE episode_id=? LIMIT 1'
        ).get(activeEpisode.episode_id) ?? null;
        if (pendingLatch) {
          fail('FIRST_LINE_PENDING_HUMAN_LATCH',
            'latched active episode cannot be replaced before HUMAN terminalization', {
              episode_id: activeEpisode.episode_id,
              latch_class: pendingLatch.latch_class,
            });
        }
      }

      const currentRevisionHead = this.db.prepare(
        'SELECT action_id FROM public_actions WHERE stream_id=? AND prepared_stream_revision=?'
      ).get(stream, revision) ?? null;
      if (currentRevisionHead) {
        const currentRevisionAction = this.#readAction(currentRevisionHead.action_id);
        fail('FIRST_LINE_ROUTING_PLAN_STALE',
          'current stream revision already has a durable public action', {
            stream_id: stream,
            action_id: currentRevisionAction.action_id,
            action_state: currentRevisionAction.state,
            action_episode_id: currentRevisionAction.episode_id,
          });
      }

      const liveHead = this.db.prepare(`SELECT action_id FROM public_actions WHERE stream_id=? AND state IN
        ('PREPARED','GATING','SENDING','UNCERTAIN')`).get(stream) ?? null;
      const liveAction = liveHead
        ? this.#readAction(liveHead.action_id)
        : null;

      if (actionExpectation.id === null) {
        if (liveAction !== null) {
          fail('FIRST_LINE_ROUTING_PLAN_STALE', 'routing plan expected no live public action', {
            stream_id: stream,
            current_action_id: liveAction.action_id,
            current_action_state: liveAction.state,
          });
        }
      } else if (!liveAction ||
                 liveAction.action_id !== actionExpectation.id ||
                 liveAction.state !== actionExpectation.state) {
        fail('FIRST_LINE_ROUTING_PLAN_STALE', 'live public action changed after routing plan', {
          stream_id: stream,
          expected_action_id: actionExpectation.id,
          expected_action_state: actionExpectation.state,
          current_action_id: liveAction?.action_id ?? null,
          current_action_state: liveAction?.state ?? null,
        });
      }

      if (liveAction &&
          (liveAction.state === 'SENDING' || liveAction.state === 'UNCERTAIN')) {
        fail('FIRST_LINE_ACTION_SEND_UNRESOLVED',
          'unresolved public send blocks standalone episode transition', {
            action_id: liveAction.action_id,
            state: liveAction.state,
          });
      }
      if (liveAction && liveAction.prepared_stream_revision >= revision) {
        fail('FIRST_LINE_ROUTING_PLAN_STALE',
          'current routing revision already owns a public action', {
            action_id: liveAction.action_id,
            action_prepared_stream_revision: liveAction.prepared_stream_revision,
            current_stream_revision: revision,
          });
      }

      const transitionAt = this.now();

      let staledAction = null;
      if (liveAction) {
        this.#finishUnsentAction(
          liveAction,
          'STALE',
          'standalone_episode_replaced',
          transitionAt
        );
        staledAction = this.#readAction(liveAction.action_id);
      }

      let replacedEpisode = null;
      if (episodeExpectation.id !== null) {
        const refreshed = this.#readEpisode(episodeExpectation.id);
        if (!refreshed || refreshed.state !== 'active' || refreshed.stream_id !== stream) {
          fail('FIRST_LINE_STALE_WRITE', 'active episode changed during standalone transition', {
            stream_id: stream,
            episode_id: episodeExpectation.id,
          });
        }
        const changed = this.db.prepare(`UPDATE episodes
          SET state='closed',version=version+1,updated_at=?,closed_at=?,close_reason='replaced'
          WHERE episode_id=? AND stream_id=? AND state='active' AND version=?`)
          .run(transitionAt, transitionAt, refreshed.episode_id, stream, refreshed.version).changes;
        if (changed !== 1) {
          fail('FIRST_LINE_STALE_WRITE', 'episode changed before standalone replacement', {
            stream_id: stream,
            episode_id: refreshed.episode_id,
          });
        }
        replacedEpisode = this.#readEpisode(refreshed.episode_id);
      }

      const newEpisodeId = safeToken(this.episodeIdFactory(), 'episode_id');
      this.db.prepare(`INSERT INTO episodes
        (episode_id,stream_id,state,version,clarification_prompts_sent,created_at,updated_at)
        VALUES (?,?,'active',1,0,?,?)`).run(newEpisodeId, stream, transitionAt, transitionAt);
      this.#insertConstraintLatches(
        newEpisodeId,
        stream,
        through,
        latches,
        latchBasis,
        transitionAt
      );
      const episode = this.#readEpisode(newEpisodeId);

      return {
        schema: EPISODE_TRANSITION_SCHEMA,
        stream_id: stream,
        stream_revision: revision,
        through_event_seq: through,
        replaced_episode: replacedEpisode,
        staled_public_action: staledAction,
        episode,
      };
    });
  }

  applyClarificationSelectionFromRoutingPlan({
    streamId,
    expectedStreamRevision,
    expectedThroughEventSeq,
    expectedRoutingLedgerFingerprint,
    expectedEpisodeId,
    expectedEpisodeVersion,
    clarificationActionId,
    evidenceClass,
    selectionOrigin,
    selectionSlot,
    selectionValue,
    candidateOrdinal = null,
    selectionSourceMessageId,
    constraintLatches = [],
    constraintBasisEventSeqs = [],
  } = {}) {
    const stream = safeToken(streamId, 'stream_id');
    const revision = positiveInteger(expectedStreamRevision, 'expected_stream_revision');
    const through = positiveInteger(expectedThroughEventSeq, 'expected_through_event_seq');
    const expectedLedgerFingerprint = routingLedgerFingerprintValue(
      expectedRoutingLedgerFingerprint,
      'expected_routing_ledger_fingerprint'
    );
    const episodeId = safeToken(expectedEpisodeId, 'expected_episode_id');
    const episodeVersion = positiveInteger(expectedEpisodeVersion, 'expected_episode_version');
    const actionId = safeToken(clarificationActionId, 'clarification_action_id');
    const evidence = enumValue(
      evidenceClass,
      new Set(['STRUCTURED_SUBMISSION', 'EXACT_MESSAGE_SELECTION']),
      'selection_evidence_class'
    );
    const origin = enumValue(
      selectionOrigin,
      new Set(['presented_candidate', 'requested_slot']),
      'selection_origin'
    );
    const slot = safeToken(selectionSlot, 'selection_slot');
    const moneySelection = slot === 'max_price_minor'
      ? normalizeRequestedMoneySelection(selectionValue)
      : null;
    const value = moneySelection === null
      ? normalizeSlotValue(slot, selectionValue)
      : moneySelection;
    const sourceMessageId = positiveInteger(selectionSourceMessageId, 'selection_source_message_id');
    const ordinal = candidateOrdinal == null
      ? null
      : positiveInteger(candidateOrdinal, 'candidate_ordinal');

    const latches = normalizeConstraintLatchEvidence(constraintLatches);
    const latchBasis = normalizeConstraintBasisEventSeqs(
      constraintBasisEventSeqs,
      latches
    );

    if (origin === 'presented_candidate' && ordinal === null) {
      fail('FIRST_LINE_SELECTION_INVALID', 'presented candidate selection requires ordinal');
    }
    if (origin === 'requested_slot' && ordinal !== null) {
      fail('FIRST_LINE_SELECTION_INVALID', 'requested-slot selection cannot carry candidate ordinal');
    }

    return tx(this.db, () => {
      const currentStream = this.#readStream(stream);
      if (!currentStream) {
        fail('FIRST_LINE_STREAM_NOT_FOUND', 'conversation stream not found', { stream_id: stream });
      }
      if (currentStream.stream_revision !== revision ||
          currentStream.last_event_seq !== through) {
        fail('FIRST_LINE_ROUTING_PLAN_STALE', 'stream changed after routing plan', {
          stream_id: stream,
          expected_stream_revision: revision,
          current_stream_revision: currentStream.stream_revision,
          expected_through_event_seq: through,
          current_last_event_seq: currentStream.last_event_seq,
        });
      }

      const currentLedger = this.#readRoutingLedger(currentStream);
      if (currentLedger.fingerprint !== expectedLedgerFingerprint) {
        fail('FIRST_LINE_ROUTING_PLAN_STALE', 'routing ledger changed after routing plan', {
          stream_id: stream,
          expected_routing_ledger_fingerprint: expectedLedgerFingerprint,
          current_routing_ledger_fingerprint: currentLedger.fingerprint,
        });
      }

      const currentRevisionAction = this.db.prepare(
        'SELECT action_id FROM public_actions WHERE stream_id=? AND prepared_stream_revision=?'
      ).get(stream, revision) ?? null;
      if (currentRevisionAction) {
        fail('FIRST_LINE_ROUTING_PLAN_STALE', 'current stream revision already owns a public action', {
          stream_id: stream,
          action_id: currentRevisionAction.action_id,
        });
      }

      const liveActionHead = this.db.prepare(`SELECT action_id FROM public_actions WHERE stream_id=? AND state IN
        ('PREPARED','GATING','SENDING','UNCERTAIN')`).get(stream) ?? null;
      if (liveActionHead) {
        fail('FIRST_LINE_ROUTING_PLAN_STALE', 'live public action appeared after selection plan', {
          stream_id: stream,
          action_id: liveActionHead.action_id,
        });
      }

      const action = this.#readAction(actionId);
      if (!action || action.stream_id !== stream ||
          action.episode_id !== episodeId ||
          action.episode_version !== episodeVersion ||
          action.action_type !== 'CLARIFY' ||
          action.state !== 'CONFIRMED') {
        fail('FIRST_LINE_SELECTION_PROVENANCE_INVALID', 'clarification action provenance changed', {
          stream_id: stream,
          episode_id: episodeId,
          action_id: actionId,
        });
      }

      const sourceRow = this.db.prepare(
        'SELECT * FROM conversation_events WHERE stream_id=? AND source_message_id=?'
      ).get(stream, sourceMessageId) ?? null;
      if (!sourceRow) {
        fail('FIRST_LINE_SELECTION_PROVENANCE_INVALID', 'selection source event is not accepted', {
          stream_id: stream,
          source_message_id: sourceMessageId,
        });
      }
      const sourceEvent = this.#eventDto(sourceRow);

      const clarificationRow = this.db.prepare(
        'SELECT * FROM conversation_events WHERE stream_id=? AND source_message_id=?'
      ).get(stream, action.confirmed_source_message_id) ?? null;
      if (!clarificationRow) {
        fail('FIRST_LINE_SELECTION_PROVENANCE_INVALID', 'confirmed clarification event is missing', {
          stream_id: stream,
          action_id: actionId,
        });
      }
      const clarificationEvent = this.#eventDto(clarificationRow);
      if (clarificationEvent.event_kind !== 'BABYPARK_PUBLIC_REPLY' ||
          clarificationEvent.message_type !== 'outgoing' ||
          clarificationEvent.sender_class !== 'configured_agent_bot' ||
          clarificationEvent.source_id !== actionId) {
        fail('FIRST_LINE_SELECTION_PROVENANCE_INVALID', 'confirmed clarification ledger event is invalid', {
          stream_id: stream,
          action_id: actionId,
        });
      }

      if (evidence === 'STRUCTURED_SUBMISSION') {
        if (sourceEvent.source_message_id !== action.confirmed_source_message_id ||
            sourceEvent.event_seq !== clarificationEvent.event_seq ||
            sourceEvent.event_kind !== 'BABYPARK_PUBLIC_REPLY') {
          fail('FIRST_LINE_SELECTION_PROVENANCE_INVALID',
            'structured selection must reference the confirmed clarification event');
        }
      } else if (sourceEvent.event_kind !== 'CUSTOMER_MESSAGE' ||
                 sourceEvent.message_type !== 'incoming' ||
                 sourceEvent.sender_class !== 'contact' ||
                 sourceEvent.event_seq <= clarificationEvent.event_seq) {
        fail('FIRST_LINE_SELECTION_PROVENANCE_INVALID',
          'exact-message selection must reference a later accepted customer event');
      }

      if (origin === 'presented_candidate') {
        if (ordinal > action.presented_candidates.length) {
          fail('FIRST_LINE_SELECTION_PROVENANCE_INVALID', 'candidate ordinal is outside reservation');
        }
        const candidate = action.presented_candidates[ordinal - 1];
        if (!candidate || candidate.slot !== slot ||
            canonicalJson(candidate.value) !== canonicalJson(value)) {
          fail('FIRST_LINE_SELECTION_PROVENANCE_INVALID',
            'selection does not match reserved candidate');
        }
        if (action.requested_slot !== null && action.requested_slot !== slot) {
          fail('FIRST_LINE_SELECTION_PROVENANCE_INVALID',
            'candidate selection does not resolve the reserved requested slot');
        }
      } else {
        if (action.requested_slot !== slot) {
          fail('FIRST_LINE_SELECTION_PROVENANCE_INVALID',
            'selection does not fill the reserved requested slot');
        }
      }

      const activeHead = this.db.prepare(
        "SELECT episode_id FROM episodes WHERE stream_id=? AND state='active'"
      ).get(stream) ?? null;
      const activeEpisode = activeHead ? this.#readEpisode(activeHead.episode_id) : null;
      if (!activeEpisode || activeEpisode.episode_id !== episodeId ||
          activeEpisode.stream_id !== stream ||
          activeEpisode.clarification_prompts_sent !== 1 ||
          activeEpisode.clarification_action_id !== actionId ||
          (activeEpisode.requested_slot ?? null) !== (action.requested_slot ?? null)) {
        fail('FIRST_LINE_ROUTING_PLAN_STALE', 'active clarification episode changed');
      }

      if (activeEpisode.version !== episodeVersion) {
        fail('FIRST_LINE_ROUTING_PLAN_STALE', 'episode changed after selection plan', {
          episode_id: episodeId,
          expected_episode_version: episodeVersion,
          current_episode_version: activeEpisode.version,
        });
      }

      const transitionAt = this.now();
      if (moneySelection !== null) {
        for (const [moneySlot, moneyValue] of [
          ['max_price_minor', moneySelection.minor_units],
          ['currency', moneySelection.currency],
        ]) {
          this.db.prepare(`INSERT INTO episode_slots(episode_id,slot_name,value_json,derived_through_event_seq)
            VALUES (?,?,?,?) ON CONFLICT(episode_id,slot_name) DO UPDATE SET
            value_json=excluded.value_json,derived_through_event_seq=excluded.derived_through_event_seq`)
            .run(episodeId, moneySlot, canonicalJson(moneyValue), sourceEvent.event_seq);
        }
      } else {
        this.db.prepare(`INSERT INTO episode_slots(episode_id,slot_name,value_json,derived_through_event_seq)
          VALUES (?,?,?,?) ON CONFLICT(episode_id,slot_name) DO UPDATE SET
          value_json=excluded.value_json,derived_through_event_seq=excluded.derived_through_event_seq`)
          .run(episodeId, slot, canonicalJson(value), sourceEvent.event_seq);
      }
      this.#insertConstraintLatches(
        episodeId,
        stream,
        through,
        latches,
        latchBasis,
        transitionAt
      );
      const changed = this.db.prepare(`UPDATE episodes SET version=version+1,requested_slot=NULL,
        clarification_action_id=NULL,updated_at=?
        WHERE episode_id=? AND stream_id=? AND state='active' AND version=?`)
        .run(transitionAt, episodeId, stream, episodeVersion).changes;
      if (changed !== 1) {
        fail('FIRST_LINE_STALE_WRITE', 'episode changed before clarification selection commit');
      }

      return {
        schema: EPISODE_CONTINUATION_SCHEMA,
        stream_id: stream,
        stream_revision: revision,
        through_event_seq: through,
        evidence_class: evidence,
        source_event_seq: sourceEvent.event_seq,
        episode: this.#readEpisode(episodeId),
      };
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
    if (type === 'CLARIFY' && requested === 'money') {
      fail('FIRST_LINE_CLARIFICATION_INVALID',
        'generic money clarification is legacy-only; v3 requires max_price_minor');
    }
    if (type === 'CLARIFY' && requested !== null && candidates.length > 0 &&
        candidates.some(candidate => candidate.slot !== requested)) {
      fail('FIRST_LINE_CLARIFICATION_INVALID',
        'CLARIFY candidates must resolve the reserved requested slot', {
          requested_slot: requested,
        });
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

      const activeHead = this.db.prepare(
        "SELECT episode_id FROM episodes WHERE stream_id=? AND state='active'"
      ).get(stream) ?? null;
      const activeEpisode = activeHead ? this.#readEpisode(activeHead.episode_id) : null;

      if (activeEpisode && epId === null) {
        fail('FIRST_LINE_ACTION_EPISODE_REQUIRED',
          'customer-visible AI action must bind to the active episode', {
            stream_id: stream,
            active_episode_id: activeEpisode.episode_id,
          });
      }

      let episode = null;
      if (epId !== null) {
        episode = this.#requireActiveEpisode(epId, epVersion);
        if (episode.stream_id !== stream) {
          fail('FIRST_LINE_ACTION_EPISODE_STREAM_MISMATCH', 'episode does not belong to action stream',
            { episode_id: epId, stream_id: stream, episode_stream_id: episode.stream_id });
        }
        if (!activeEpisode || activeEpisode.episode_id !== episode.episode_id) {
          fail('FIRST_LINE_ACTION_STALE_EPISODE',
            'action episode is no longer the active stream episode', {
              episode_id: episode.episode_id,
              active_episode_id: activeEpisode?.episode_id ?? null,
            });
        }
      }

      if (activeEpisode) {
        const pendingLatch = this.db.prepare(
          'SELECT latch_class FROM episode_constraint_latches WHERE episode_id=? LIMIT 1'
        ).get(activeEpisode.episode_id) ?? null;
        if (pendingLatch) {
          fail('FIRST_LINE_PENDING_HUMAN_LATCH',
            'latched episode cannot prepare customer-visible AI action', {
              episode_id: activeEpisode.episode_id,
              latch_class: pendingLatch.latch_class,
            });
        }
      }

      const live = this.db.prepare(`SELECT * FROM public_actions WHERE stream_id=? AND state IN
        ('PREPARED','GATING','SENDING','UNCERTAIN')`).get(stream);
      if (live && (live.state === 'SENDING' || live.state === 'UNCERTAIN')) {
        fail('FIRST_LINE_ACTION_SEND_UNRESOLVED', 'existing send must be reconciled before another action', {
          action_id: live.action_id, state: live.state,
        });
      }

      const replacingClarification =
        Boolean(live && episode && live.action_type === 'CLARIFY' && live.episode_id === epId);
      if (replacingClarification &&
          (episode.clarification_prompts_sent !== 1 ||
           episode.clarification_action_id !== live.action_id)) {
        fail('FIRST_LINE_ACTION_STALE_EPISODE', 'live clarification no longer owns its episode reservation',
          { action_id: live.action_id, episode_id: epId });
      }

      if (type === 'CLARIFY') {
        if (!episode) fail('FIRST_LINE_CLARIFICATION_INVALID', 'CLARIFY requires active episode');
        const reservationFree =
          episode.clarification_prompts_sent === 0 && episode.clarification_action_id === null;
        if (!reservationFree && !replacingClarification) {
          fail('FIRST_LINE_CLARIFICATION_LIMIT_REACHED', 'clarification already reserved/sent');
        }
      }

      if (live) {
        this.#cancelUnsentAction(live, 'newer_stream_revision');
        if (episode && replacingClarification) {
          episode = this.#requireActiveEpisode(epId, epVersion + 1);
        }
      }

      if (type === 'CLARIFY' &&
          (episode.clarification_prompts_sent !== 0 || episode.clarification_action_id !== null)) {
        fail('FIRST_LINE_CLARIFICATION_LIMIT_REACHED', 'clarification reservation was not safely released');
      }

      const actionId = safeToken(this.actionIdFactory(), 'action_id');
      const actionEpisodeVersion = episode === null
        ? null
        : (type === 'CLARIFY' ? episode.version + 1 : episode.version);
      this.db.prepare(`INSERT INTO public_actions
        (action_id,stream_id,episode_id,episode_version,prepared_stream_revision,action_type,state,
         basis_event_seqs_json,requested_slot,deadline_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'PREPARED',?,?,?,?,?)`).run(
          actionId, stream, epId, actionEpisodeVersion, revision, type, canonicalJson(basis), requested, deadline, at, at
        );

      for (const [index, candidate] of candidates.entries()) {
        this.db.prepare(`INSERT INTO public_action_candidates(action_id,slot_name,ordinal,value_json)
          VALUES (?,?,?,?)`).run(actionId, candidate.slot, index + 1, canonicalJson(candidate.value));
      }

      if (type === 'CLARIFY') {
        const changed = this.db.prepare(`UPDATE episodes SET clarification_prompts_sent=1,requested_slot=?,
          clarification_action_id=?,version=version+1,updated_at=?
          WHERE episode_id=? AND state='active' AND version=? AND clarification_prompts_sent=0 AND clarification_action_id IS NULL`)
          .run(requested, actionId, at, epId, episode.version).changes;
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
      if (!Number.isSafeInteger(action.lease_expires_at) || action.lease_expires_at <= at) {
        fail('FIRST_LINE_ACTION_CLAIM_EXPIRED', 'gating claim expired before SENDING', { action_id: id });
      }
      if (action.deadline_at <= at) {
        fail('FIRST_LINE_ACTION_DEADLINE_EXPIRED', 'public action deadline expired before SENDING',
          { action_id: id, deadline_at: action.deadline_at, now: at });
      }
      const stream = this.#requireStream(action.stream_id);
      if (stream.stream_revision !== action.prepared_stream_revision) {
        fail('FIRST_LINE_ACTION_STALE_REVISION', 'stream changed before SENDING', { action_id: id });
      }
      const activeHead = this.db.prepare(
        "SELECT episode_id FROM episodes WHERE stream_id=? AND state='active'"
      ).get(action.stream_id) ?? null;
      const activeEpisode = activeHead ? this.#readEpisode(activeHead.episode_id) : null;

      if (activeEpisode) {
        if (action.episode_id === null ||
            action.episode_id !== activeEpisode.episode_id ||
            action.episode_version !== activeEpisode.version) {
          fail('FIRST_LINE_ACTION_STALE_EPISODE',
            'active episode changed or action is detached before SENDING', {
              action_id: id,
              action_episode_id: action.episode_id,
              active_episode_id: activeEpisode.episode_id,
            });
        }
        const pendingLatch = this.db.prepare(
          'SELECT latch_class FROM episode_constraint_latches WHERE episode_id=? LIMIT 1'
        ).get(activeEpisode.episode_id) ?? null;
        if (pendingLatch) {
          fail('FIRST_LINE_ACTION_STALE_EPISODE',
            'constraint latch blocks customer-visible AI send', {
              action_id: id,
              episode_id: activeEpisode.episode_id,
              latch_class: pendingLatch.latch_class,
            });
        }
        if (action.action_type === 'CLARIFY' &&
            (activeEpisode.clarification_prompts_sent !== 1 ||
             activeEpisode.clarification_action_id !== id)) {
          fail('FIRST_LINE_ACTION_STALE_EPISODE', 'clarification reservation changed before SENDING',
            { action_id: id });
        }
      } else if (action.episode_id !== null) {
        fail('FIRST_LINE_ACTION_STALE_EPISODE',
          'bound episode is no longer active before SENDING', { action_id: id });
      }
      const changed = this.db.prepare(`UPDATE public_actions SET state='SENDING',send_started_at=?,updated_at=?
        WHERE action_id=? AND state='GATING' AND lease_token=? AND lease_expires_at>? AND deadline_at>?`)
        .run(at, at, id, token, at, at).changes;
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


  cancelActionBeforeSend(actionId, { reason = 'cancelled_before_send' } = {}) {
    return this.#finishActionBeforeSend(actionId, 'CANCELLED', reason);
  }

  markActionStaleBeforeSend(actionId, { reason = 'stale_before_send' } = {}) {
    return this.#finishActionBeforeSend(actionId, 'STALE', reason);
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

  #finishActionBeforeSend(actionId, terminalState, reason) {
    const id = safeToken(actionId, 'action_id');
    const terminalReason = safeToken(reason, 'terminal_reason');
    if (terminalState !== 'CANCELLED' && terminalState !== 'STALE') {
      fail('FIRST_LINE_ACTION_STATE_INVALID', 'invalid unsent terminal state', { terminal_state: terminalState });
    }
    return tx(this.db, () => {
      const action = this.#requireAction(id);
      this.#finishUnsentAction(action, terminalState, terminalReason);
      return this.#readAction(id);
    });
  }

  #cancelUnsentAction(action, reason) {
    this.#finishUnsentAction(action, 'CANCELLED', reason);
  }

  #finishUnsentAction(action, terminalState, reason, at = this.now()) {
    if (action.state !== 'PREPARED' && action.state !== 'GATING') {
      fail('FIRST_LINE_ACTION_STATE_INVALID', 'only unsent action may become terminal', { action_id: action.action_id });
    }
    if (action.action_type === 'CLARIFY' && action.episode_id) {
      const episode = this.db.prepare('SELECT * FROM episodes WHERE episode_id=?').get(action.episode_id);
      if (episode?.state === 'active' && episode.clarification_action_id === action.action_id) {
        const changed = this.db.prepare(`UPDATE episodes SET clarification_prompts_sent=0,requested_slot=NULL,
          clarification_action_id=NULL,version=version+1,updated_at=?
          WHERE episode_id=? AND state='active' AND clarification_action_id=?`)
          .run(at, action.episode_id, action.action_id).changes;
        if (changed !== 1) {
          fail('FIRST_LINE_STALE_WRITE', 'clarification reservation changed before unsent action terminalization',
            { action_id: action.action_id, episode_id: action.episode_id });
        }
      }
    }
    this.db.prepare(`UPDATE public_actions SET state=?,terminal_reason=?,lease_token=NULL,
      lease_expires_at=NULL,updated_at=? WHERE action_id=?`)
      .run(terminalState, reason, at, action.action_id);
  }

  #readRoutingLedger(stream) {
    const id = stream.stream_id;
    const rows = this.db.prepare(
      'SELECT ce.*,' +
      ' pa.action_id AS confirmed_action_id,' +
      ' pa.action_type AS confirmed_action_type,' +
      ' pa.prepared_stream_revision AS confirmed_action_revision,' +
      ' pa.episode_id AS confirmed_action_episode_id,' +
      ' pa.episode_version AS confirmed_action_episode_version' +
      ' FROM conversation_events ce' +
      ' LEFT JOIN public_actions pa' +
      ' ON pa.action_id=ce.source_id' +
      ' AND pa.stream_id=ce.stream_id' +
      " AND pa.state='CONFIRMED'" +
      ' AND pa.confirmed_source_message_id=ce.source_message_id' +
      ' WHERE ce.stream_id=?' +
      ' ORDER BY ce.event_seq DESC LIMIT ?'
    ).all(id, ROUTING_SUFFIX_FETCH_LIMIT);

    let expectedSeq = stream.last_event_seq;
    const descending = rows.map(row => {
      if (row.event_seq !== expectedSeq) {
        fail('FIRST_LINE_DB_CORRUPT',
          'routing event suffix is not contiguous with stream head', {
            stream_id: id,
            expected_event_seq: expectedSeq,
            actual_event_seq: row.event_seq,
          });
      }
      expectedSeq -= 1;

      const event = this.#eventDto(row);
      let confirmedAction = null;
      if (row.confirmed_action_id !== null) {
        persistedGuard(() => {
          if (event.event_kind !== 'BABYPARK_PUBLIC_REPLY' ||
              event.source_id !== row.confirmed_action_id) {
            fail('FIRST_LINE_VALUE_INVALID',
              'confirmed action provenance conflicts with event');
          }
          safeToken(row.confirmed_action_id, 'action_id');
          enumValue(row.confirmed_action_type, ACTION_TYPES, 'action_type');
          positiveInteger(row.confirmed_action_revision, 'prepared_stream_revision');
          if ((row.confirmed_action_episode_id === null) !==
              (row.confirmed_action_episode_version === null)) {
            fail('FIRST_LINE_VALUE_INVALID',
              'confirmed action episode provenance is incomplete');
          }
          if (row.confirmed_action_episode_id !== null) {
            safeToken(row.confirmed_action_episode_id, 'episode_id');
            positiveInteger(row.confirmed_action_episode_version, 'episode_version');
          }
          if (row.confirmed_action_type === 'CLARIFY' &&
              row.confirmed_action_episode_id === null) {
            fail('FIRST_LINE_VALUE_INVALID',
              'confirmed clarification lacks episode provenance');
          }
        }, 'confirmed BabyPark action provenance is invalid', {
          stream_id: id,
          event_seq: event.event_seq,
        });
        confirmedAction = {
          action_id: row.confirmed_action_id,
          action_type: row.confirmed_action_type,
          prepared_stream_revision: row.confirmed_action_revision,
          episode_id: row.confirmed_action_episode_id,
          episode_version: row.confirmed_action_episode_version,
        };
      }

      return {
        event,
        confirmed_babypark_action: confirmedAction,
      };
    });

    if (stream.last_event_seq === 0 && rows.length !== 0) {
      fail('FIRST_LINE_DB_CORRUPT', 'empty stream head has persisted routing events', {
        stream_id: id,
      });
    }
    if (stream.last_event_seq > 0 && rows.length === 0) {
      fail('FIRST_LINE_DB_CORRUPT', 'non-empty stream head has no routing events', {
        stream_id: id,
      });
    }

    const eventSuffix = descending.reverse();
    return {
      event_suffix: eventSuffix,
      suffix_truncated: stream.last_event_seq > rows.length,
      fingerprint: routingLedgerFingerprint(eventSuffix),
    };
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
    persistedGuard(() => {
      safeToken(row.stream_id, 'stream_id');
      sourceProvider(row.source_provider);
      positiveInteger(row.source_conversation_id, 'source_conversation_id');
      nonNegativeInteger(row.stream_revision, 'stream_revision');
      nonNegativeInteger(row.last_event_seq, 'last_event_seq');
      if (row.scan_highwater !== null) positiveInteger(row.scan_highwater, 'scan_highwater');
      nonNegativeInteger(row.created_at, 'created_at');
      nonNegativeInteger(row.updated_at, 'updated_at');
    }, 'persisted conversation stream is invalid', { stream_id: streamId });
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

  #insertConstraintLatches(
    episodeId,
    streamId,
    throughEventSeq,
    latches,
    basisEventSeqs,
    at
  ) {
    const basis = new Set(basisEventSeqs);
    for (const latch of latches) {
      if (!basis.has(latch.source_event_seq)) {
        fail('FIRST_LINE_CONSTRAINT_LATCH_PROVENANCE_INVALID',
          'constraint latch evidence is outside the routed open-turn basis', {
            episode_id: episodeId,
            latch_class: latch.latch_class,
            source_event_seq: latch.source_event_seq,
          });
      }
      if (latch.source_event_seq > throughEventSeq) {
        fail('FIRST_LINE_CONSTRAINT_LATCH_PROVENANCE_INVALID',
          'constraint latch evidence is newer than the routing plan', {
            episode_id: episodeId,
            latch_class: latch.latch_class,
            source_event_seq: latch.source_event_seq,
            through_event_seq: throughEventSeq,
          });
      }
      const event = this.db.prepare(
        'SELECT 1 AS ok FROM conversation_events WHERE stream_id=? AND event_seq=?'
      ).get(streamId, latch.source_event_seq);
      if (!event) {
        fail('FIRST_LINE_CONSTRAINT_LATCH_PROVENANCE_INVALID',
          'constraint latch references an unknown accepted event', {
            episode_id: episodeId,
            latch_class: latch.latch_class,
            source_event_seq: latch.source_event_seq,
          });
      }
      this.db.prepare(`INSERT OR IGNORE INTO episode_constraint_latches
        (episode_id,latch_class,first_event_seq,created_at)
        VALUES (?,?,?,?)`).run(
          episodeId,
          latch.latch_class,
          latch.source_event_seq,
          at
        );
    }
  }

  #eventDto(row) {
    persistedGuard(() => {
      safeToken(row.stream_id, 'stream_id');
      positiveInteger(row.event_seq, 'event_seq');
      positiveInteger(row.source_message_id, 'source_message_id');
      enumValue(row.event_kind, EVENT_KINDS, 'event_kind');
      enumValue(row.message_type, MESSAGE_TYPES, 'message_type');
      enumValue(row.sender_class, SENDER_CLASSES, 'sender_class');
      if (row.sender_id !== null) positiveInteger(row.sender_id, 'sender_id');
      contentType(row.content_type);
      if (row.deleted_flag !== 0 && row.deleted_flag !== 1) fail('FIRST_LINE_VALUE_INVALID', 'deleted flag invalid');
      if (row.unsupported_flag !== 0 && row.unsupported_flag !== 1) fail('FIRST_LINE_VALUE_INVALID', 'unsupported flag invalid');
      if (row.has_attachments !== 0 && row.has_attachments !== 1) fail('FIRST_LINE_VALUE_INVALID', 'attachments flag invalid');
      if (row.source_id !== null) safeToken(row.source_id, 'source_id');
      nonNegativeInteger(row.accepted_at, 'accepted_at');
      validateEventTopology({
        eventKind: row.event_kind,
        messageType: row.message_type,
        senderClass: row.sender_class,
        senderId: row.sender_id,
      });
    }, 'persisted conversation event is invalid',
    { stream_id: row.stream_id, event_seq: row.event_seq, source_message_id: row.source_message_id });
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
    persistedGuard(() => {
      safeToken(row.episode_id, 'episode_id');
      safeToken(row.stream_id, 'stream_id');
      positiveInteger(row.version, 'version');
      if (row.clarification_action_id !== null) safeToken(row.clarification_action_id, 'clarification_action_id');
      nonNegativeInteger(row.created_at, 'created_at');
      nonNegativeInteger(row.updated_at, 'updated_at');
      if (row.closed_at !== null) nonNegativeInteger(row.closed_at, 'closed_at');
      if (row.close_reason !== null) safeToken(row.close_reason, 'close_reason');
    }, 'persisted episode metadata is invalid', { episode_id: episodeId });
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
    persistedGuard(() => {
      safeToken(row.action_id, 'action_id');
      safeToken(row.stream_id, 'stream_id');
      if (row.episode_id !== null) safeToken(row.episode_id, 'episode_id');
      if (row.episode_version !== null) positiveInteger(row.episode_version, 'episode_version');
      positiveInteger(row.prepared_stream_revision, 'prepared_stream_revision');
      normalizeRequestedSlot(row.requested_slot);
      if (row.lease_token !== null) safeToken(row.lease_token, 'lease_token');
      if (row.lease_expires_at !== null) nonNegativeInteger(row.lease_expires_at, 'lease_expires_at');
      nonNegativeInteger(row.attempts, 'attempts');
      positiveInteger(row.deadline_at, 'deadline_at');
      if (row.confirmed_source_message_id !== null) positiveInteger(row.confirmed_source_message_id, 'confirmed_source_message_id');
      if (row.terminal_reason !== null) safeToken(row.terminal_reason, 'terminal_reason');
      nonNegativeInteger(row.created_at, 'created_at');
      nonNegativeInteger(row.updated_at, 'updated_at');
      if (row.send_started_at !== null) nonNegativeInteger(row.send_started_at, 'send_started_at');
      if (row.confirmed_at !== null) nonNegativeInteger(row.confirmed_at, 'confirmed_at');
    }, 'persisted public action metadata is invalid', { action_id: actionId });
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
    const schemaFingerprint = schemaMasterFingerprint(this.db);
    if (schemaFingerprint !== V3_SCHEMA_MASTER_SHA256) {
      fail('FIRST_LINE_DB_INVALID', 'database sqlite_master does not match the frozen v3 schema', {
        expected_schema_fingerprint: V3_SCHEMA_MASTER_SHA256,
        actual_schema_fingerprint: schemaFingerprint,
      });
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

function persistedGuard(fn, message, details = {}) {
  try { return fn(); }
  catch (error) {
    if (error instanceof FirstLineStateError) {
      fail('FIRST_LINE_DB_CORRUPT', message, details);
    }
    throw error;
  }
}

function validatePersistedSlot(slotName, value) {
  return persistedGuard(
    () => normalizeSlotValue(slotName, value),
    'persisted stable/candidate slot is invalid',
    { slot_name: slotName }
  );
}

export {
  ACTION_TYPES,
  BUSY_TIMEOUT_MS,
  CANONICAL_ID_PATTERNS,
  CONSTRAINT_LATCH_CLASSES,
  CONSTRAINT_LATCH_ORDER,
  EPISODE_CONTINUATION_SCHEMA,
  EPISODE_TRANSITION_SCHEMA,
  EVENT_KINDS,
  LIVE_ACTION_STATES,
  MAX_OPEN_TURN_EVENTS,
  MAX_PRESENTED_CANDIDATES,
  ROUTING_SNAPSHOT_SCHEMA,
  PREVIOUS_SCHEMA_VERSION,
  SCHEMA_VERSION,
  SLOT_SPECS,
  TERMINAL_ACTION_STATES,
};
