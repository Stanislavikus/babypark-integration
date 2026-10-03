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
HÓSUH