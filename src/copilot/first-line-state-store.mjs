import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_VERSION = 4;
const PREVIOUS_SCHEMA_VERSION = 3;
const V2_SCHEMA_VERSION = 2;
const V3_SCHEMA_VERSION = 3;
const V2_SCHEMA_MASTER_SHA256 =
  'd84094598ffb3371293f8b361f88b19b2997a7e37a79ce5226abcd62326da19e';
const V3_SCHEMA_MASTER_SHA256 =
  'e7a9f211d23e2439bcd63a29fb3b9ed1569e3958ca536c240af00876dd410e07';
const V4_SCHEMA_MASTER_SHA256 =
  '5750a215f3e4b72dd689be3a88c953bdb0f40beef13605269113a2423c76f3cd';
const BUSY_TIMEOUT_MS = 5000;
const MAX_PRESENTED_CANDIDATES = 20;
// A whole-conversation authorizing snapshot is unprovable at 1000 public rows;
// an open semantic turn therefore never needs a planning bound above 999 events.
const MAX_OPEN_TURN_EVENTS = 999;
const ROUTING_SUFFIX_FETCH_LIMIT = MAX_OPEN_TURN_EVENTS + 1;
const ROUTING_SNAPSHOT_SCHEMA = 'bp.first-line.routing-snapshot/1';
const EPISODE_TRANSITION_SCHEMA = 'bp.first-line.episode-transition/1';
const EPISODE_CONTINUATION_SCHEMA = 'bp.first-line.episode-continuation/1';
const CLARIFICATION_RESERVATION_ATTESTATION_SCHEMA =
  'bp.first-line.clarification-reservation-attestation/1';
const certifiedRoutingSnapshots = new WeakSet();
const clarificationReservationBindings = new WeakMap();
const consumedClarificationReservationAttestations = new WeakSet();

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

const CATEGORY_MATCH_MODES = new Set(['NODE_ONLY', 'INCLUDE_DESCENDANTS']);
const SLOT_SPECS = Object.freeze({
  product_id: 'id',
  variant_id: 'id',
  category_id: 'id',
  category_match_mode: 'category_match_mode',
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

const V4_ADDITIONS_SCHEMA_SQL = `
CREATE UNIQUE INDEX public_actions_action_stream_revision
  ON public_actions(action_id, stream_id, prepared_stream_revision);
CREATE UNIQUE INDEX public_actions_action_stream
  ON public_actions(action_id, stream_id);
CREATE UNIQUE INDEX episodes_episode_stream
  ON episodes(episode_id, stream_id);
CREATE TABLE public_action_source_events (
  action_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 1),
  stream_id TEXT NOT NULL,
  event_seq INTEGER NOT NULL CHECK(event_seq >= 1),
  PRIMARY KEY(action_id, ordinal),
  UNIQUE(action_id, event_seq),
  FOREIGN KEY(action_id, stream_id)
    REFERENCES public_actions(action_id, stream_id) ON DELETE RESTRICT,
  FOREIGN KEY(stream_id, event_seq)
    REFERENCES conversation_events(stream_id, event_seq) ON DELETE RESTRICT
) STRICT;
CREATE TABLE public_action_confirmation_cuts (
  action_id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL,
  confirmed_through_event_seq INTEGER NOT NULL CHECK(confirmed_through_event_seq >= 1),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  FOREIGN KEY(action_id, stream_id)
    REFERENCES public_actions(action_id, stream_id) ON DELETE RESTRICT,
  FOREIGN KEY(stream_id, confirmed_through_event_seq)
    REFERENCES conversation_events(stream_id, event_seq) ON DELETE RESTRICT
) STRICT;
CREATE TRIGGER public_action_confirmation_cuts_validate_insert_v4
BEFORE INSERT ON public_action_confirmation_cuts
WHEN NOT EXISTS (
  SELECT 1 FROM public_actions pa
  JOIN conversation_streams cs ON cs.stream_id=pa.stream_id
  JOIN continuation_owners co
    ON co.stream_id=pa.stream_id
    AND co.stream_revision=pa.prepared_stream_revision
    AND co.action_id=pa.action_id
  WHERE pa.action_id=NEW.action_id AND pa.stream_id=NEW.stream_id
    AND pa.state IN ('SENDING','UNCERTAIN')
    AND pa.send_started_at IS NOT NULL
    AND cs.last_event_seq=NEW.confirmed_through_event_seq
    AND cs.stream_revision=cs.last_event_seq
    AND co.owner_kind='PUBLIC_ACTION' AND co.terminal_outcome IS NULL
    AND (SELECT COUNT(*) FROM conversation_events ce
         WHERE ce.stream_id=NEW.stream_id AND ce.source_id=NEW.action_id)=1
    AND EXISTS (
      SELECT 1 FROM conversation_events ce
      WHERE ce.stream_id=NEW.stream_id AND ce.source_id=NEW.action_id
        AND ce.event_kind='BABYPARK_PUBLIC_REPLY'
        AND ce.event_seq>pa.prepared_stream_revision
        AND ce.event_seq<=NEW.confirmed_through_event_seq
    )
)
BEGIN
  SELECT RAISE(ABORT,'public_action_confirmation_cut_unproven');
END;
CREATE TRIGGER public_action_confirmation_cuts_no_update_v4
BEFORE UPDATE ON public_action_confirmation_cuts
BEGIN
  SELECT RAISE(ABORT,'public_action_confirmation_cut_immutable');
END;
CREATE TRIGGER public_action_confirmation_cuts_no_delete_v4
BEFORE DELETE ON public_action_confirmation_cuts
BEGIN
  SELECT RAISE(ABORT,'public_action_confirmation_cut_immutable');
END;
CREATE TABLE public_action_human_cuts (
  action_id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL,
  human_through_event_seq INTEGER NOT NULL CHECK(human_through_event_seq >= 1),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  FOREIGN KEY(action_id, stream_id)
    REFERENCES public_actions(action_id, stream_id) ON DELETE RESTRICT,
  FOREIGN KEY(stream_id, human_through_event_seq)
    REFERENCES conversation_events(stream_id, event_seq) ON DELETE RESTRICT
) STRICT;
CREATE TRIGGER public_action_human_cuts_validate_insert_v4
BEFORE INSERT ON public_action_human_cuts
WHEN NOT EXISTS (
  SELECT 1 FROM public_actions pa
  JOIN public_action_descriptors pad ON pad.action_id=pa.action_id
  JOIN conversation_streams cs ON cs.stream_id=pa.stream_id
  JOIN continuation_owners co
    ON co.stream_id=pa.stream_id
    AND co.stream_revision=pa.prepared_stream_revision
    AND co.action_id=pa.action_id
  WHERE pa.action_id=NEW.action_id AND pa.stream_id=NEW.stream_id
    AND pa.state IN ('SENDING','UNCERTAIN')
    AND pa.send_started_at IS NOT NULL
    AND cs.last_event_seq=NEW.human_through_event_seq
    AND cs.stream_revision=cs.last_event_seq
    AND co.owner_kind='PUBLIC_ACTION' AND co.terminal_outcome IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM conversation_events ce
      LEFT JOIN deferred_event_parents dp
        ON dp.stream_id=ce.stream_id AND dp.event_seq=ce.event_seq
      WHERE ce.stream_id=pa.stream_id
        AND ce.event_kind='CUSTOMER_MESSAGE'
        AND ce.event_seq>pa.prepared_stream_revision
        AND ce.event_seq<=NEW.human_through_event_seq
        AND (dp.action_id IS NULL OR dp.action_id<>pa.action_id)
    )
)
BEGIN
  SELECT RAISE(ABORT,'public_action_human_cut_unproven');
END;
CREATE TRIGGER public_action_human_cuts_no_update_v4
BEFORE UPDATE ON public_action_human_cuts
BEGIN
  SELECT RAISE(ABORT,'public_action_human_cut_immutable');
END;
CREATE TRIGGER public_action_human_cuts_no_delete_v4
BEFORE DELETE ON public_action_human_cuts
BEGIN
  SELECT RAISE(ABORT,'public_action_human_cut_immutable');
END;
CREATE TABLE public_action_candidate_sets (
  action_id TEXT PRIMARY KEY REFERENCES public_actions(action_id) ON DELETE RESTRICT,
  candidate_count INTEGER NOT NULL CHECK(candidate_count BETWEEN 0 AND 20),
  candidate_slot TEXT,
  CHECK(
    (candidate_count=0 AND candidate_slot IS NULL) OR
    (candidate_count>0 AND candidate_slot IS NOT NULL AND length(candidate_slot) BETWEEN 1 AND 64)
  )
) STRICT;
CREATE TRIGGER public_action_candidate_sets_validate_insert_v4
BEFORE INSERT ON public_action_candidate_sets
WHEN EXISTS (
  SELECT 1 FROM semantic_origins so WHERE so.action_id=NEW.action_id
)
BEGIN
  SELECT RAISE(ABORT,'public_action_candidate_set_after_origin');
END;
CREATE TRIGGER public_action_candidate_sets_no_update
BEFORE UPDATE ON public_action_candidate_sets
BEGIN
  SELECT RAISE(ABORT,'public_action_candidate_set_immutable');
END;
CREATE TRIGGER public_action_candidate_sets_no_delete
BEFORE DELETE ON public_action_candidate_sets
BEGIN
  SELECT RAISE(ABORT,'public_action_candidate_set_immutable');
END;
CREATE TRIGGER public_action_candidates_validate_insert_v4
BEFORE INSERT ON public_action_candidates
WHEN
  EXISTS (SELECT 1 FROM semantic_origins so WHERE so.action_id=NEW.action_id) OR
  NOT EXISTS (
    SELECT 1 FROM public_action_candidate_sets pcs
    WHERE pcs.action_id=NEW.action_id
      AND pcs.candidate_count>0
      AND NEW.ordinal BETWEEN 1 AND pcs.candidate_count
      AND pcs.candidate_slot=NEW.slot_name
  )
BEGIN
  SELECT RAISE(ABORT,'public_action_candidate_outside_frozen_set');
END;
CREATE TRIGGER public_action_candidates_no_update_v4
BEFORE UPDATE ON public_action_candidates
BEGIN
  SELECT RAISE(ABORT,'public_action_candidate_immutable');
END;
CREATE TRIGGER public_action_candidates_no_delete_v4
BEFORE DELETE ON public_action_candidates
BEGIN
  SELECT RAISE(ABORT,'public_action_candidate_immutable');
END;
CREATE TABLE public_action_descriptors (
  action_id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL,
  descriptor_version INTEGER NOT NULL CHECK(descriptor_version=1),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 160),
  template_id TEXT NOT NULL CHECK(length(template_id) BETWEEN 1 AND 160),
  response_locale TEXT NOT NULL CHECK(response_locale IN ('uk','ru')),
  product_id TEXT,
  product_event_seq INTEGER CHECK(product_event_seq IS NULL OR product_event_seq >= 1),
  variant_id TEXT,
  variant_event_seq INTEGER CHECK(variant_event_seq IS NULL OR variant_event_seq >= 1),
  category_id TEXT,
  category_match_mode TEXT CHECK(category_match_mode IS NULL OR category_match_mode IN ('NODE_ONLY','INCLUDE_DESCENDANTS')),
  category_event_seq INTEGER CHECK(category_event_seq IS NULL OR category_event_seq >= 1),
  brand_id TEXT,
  brand_event_seq INTEGER CHECK(brand_event_seq IS NULL OR brand_event_seq >= 1),
  store_id TEXT,
  store_event_seq INTEGER CHECK(store_event_seq IS NULL OR store_event_seq >= 1),
  money_currency TEXT,
  money_currency_event_seq INTEGER CHECK(money_currency_event_seq IS NULL OR money_currency_event_seq >= 1),
  min_price_minor INTEGER,
  min_price_event_seq INTEGER CHECK(min_price_event_seq IS NULL OR min_price_event_seq >= 1),
  max_price_minor INTEGER,
  max_price_event_seq INTEGER CHECK(max_price_event_seq IS NULL OR max_price_event_seq >= 1),
  FOREIGN KEY(action_id, stream_id)
    REFERENCES public_actions(action_id, stream_id) ON DELETE RESTRICT,
  FOREIGN KEY(stream_id, product_event_seq)
    REFERENCES conversation_events(stream_id, event_seq) ON DELETE RESTRICT,
  FOREIGN KEY(stream_id, variant_event_seq)
    REFERENCES conversation_events(stream_id, event_seq) ON DELETE RESTRICT,
  FOREIGN KEY(stream_id, category_event_seq)
    REFERENCES conversation_events(stream_id, event_seq) ON DELETE RESTRICT,
  FOREIGN KEY(stream_id, brand_event_seq)
    REFERENCES conversation_events(stream_id, event_seq) ON DELETE RESTRICT,
  FOREIGN KEY(stream_id, store_event_seq)
    REFERENCES conversation_events(stream_id, event_seq) ON DELETE RESTRICT,
  FOREIGN KEY(stream_id, money_currency_event_seq)
    REFERENCES conversation_events(stream_id, event_seq) ON DELETE RESTRICT,
  FOREIGN KEY(stream_id, min_price_event_seq)
    REFERENCES conversation_events(stream_id, event_seq) ON DELETE RESTRICT,
  FOREIGN KEY(stream_id, max_price_event_seq)
    REFERENCES conversation_events(stream_id, event_seq) ON DELETE RESTRICT,
  CHECK(
    (product_id IS NULL AND product_event_seq IS NULL AND
     variant_id IS NULL AND variant_event_seq IS NULL) OR
    (product_id IS NOT NULL AND product_event_seq IS NOT NULL AND
      ((variant_id IS NULL AND variant_event_seq IS NULL) OR
       (variant_id IS NOT NULL AND variant_event_seq IS NOT NULL)))
  ),
  CHECK(
    (category_id IS NULL AND category_match_mode IS NULL AND category_event_seq IS NULL) OR
    (category_id IS NOT NULL AND category_match_mode IS NOT NULL AND category_event_seq IS NOT NULL)
  ),
  CHECK((brand_id IS NULL) = (brand_event_seq IS NULL)),
  CHECK((store_id IS NULL) = (store_event_seq IS NULL)),
  CHECK(
    (money_currency IS NULL AND money_currency_event_seq IS NULL AND
     min_price_minor IS NULL AND min_price_event_seq IS NULL AND
     max_price_minor IS NULL AND max_price_event_seq IS NULL) OR
    (money_currency='UAH' AND money_currency_event_seq IS NOT NULL AND
      (min_price_minor IS NOT NULL OR max_price_minor IS NOT NULL) AND
      ((min_price_minor IS NULL AND min_price_event_seq IS NULL) OR
       (min_price_minor IS NOT NULL AND min_price_event_seq IS NOT NULL AND
        min_price_minor >= 0 AND min_price_minor <= 9007199254740991)) AND
      ((max_price_minor IS NULL AND max_price_event_seq IS NULL) OR
       (max_price_minor IS NOT NULL AND max_price_event_seq IS NOT NULL AND
        max_price_minor >= 0 AND max_price_minor <= 9007199254740991)) AND
      (min_price_minor IS NULL OR max_price_minor IS NULL OR min_price_minor <= max_price_minor) AND
      ((min_price_event_seq IS NOT NULL AND money_currency_event_seq=min_price_event_seq) OR
       (max_price_event_seq IS NOT NULL AND money_currency_event_seq=max_price_event_seq)))
  )
) STRICT;
CREATE TABLE legacy_v3_actions (
  action_id TEXT PRIMARY KEY REFERENCES public_actions(action_id) ON DELETE RESTRICT,
  marker TEXT NOT NULL CHECK(marker='DESCRIPTOR_UNAVAILABLE')
) STRICT;
CREATE TRIGGER legacy_v3_actions_validate_insert
BEFORE INSERT ON legacy_v3_actions
WHEN EXISTS (
  SELECT 1 FROM semantic_origins so WHERE so.action_id=NEW.action_id
) OR EXISTS (
  SELECT 1 FROM public_action_descriptors d WHERE d.action_id=NEW.action_id
)
BEGIN
  SELECT RAISE(ABORT,'legacy_v3_action_conflicts_with_descriptor');
END;
CREATE TRIGGER legacy_v3_actions_no_update
BEFORE UPDATE ON legacy_v3_actions
BEGIN
  SELECT RAISE(ABORT,'legacy_v3_action_marker_immutable');
END;
CREATE TRIGGER legacy_v3_actions_no_delete
BEFORE DELETE ON legacy_v3_actions
BEGIN
  SELECT RAISE(ABORT,'legacy_v3_action_marker_immutable');
END;
CREATE TABLE semantic_origins (
  stream_id TEXT NOT NULL,
  stream_revision INTEGER NOT NULL CHECK(stream_revision >= 1),
  origin_kind TEXT NOT NULL CHECK(origin_kind IN ('PUBLIC_ACTION','DIRECT_HUMAN','NON_ACTIONABLE_ACK')),
  action_id TEXT,
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  PRIMARY KEY(stream_id, stream_revision),
  FOREIGN KEY(stream_id) REFERENCES conversation_streams(stream_id) ON DELETE RESTRICT,
  FOREIGN KEY(action_id, stream_id, stream_revision)
    REFERENCES public_actions(action_id, stream_id, prepared_stream_revision) ON DELETE RESTRICT,
  CHECK(
    (origin_kind='PUBLIC_ACTION' AND action_id IS NOT NULL) OR
    (origin_kind IN ('DIRECT_HUMAN','NON_ACTIONABLE_ACK') AND action_id IS NULL)
  )
) STRICT;
CREATE TABLE continuation_owners (
  stream_id TEXT NOT NULL,
  stream_revision INTEGER NOT NULL CHECK(stream_revision >= 1),
  owner_kind TEXT NOT NULL CHECK(owner_kind IN ('PUBLIC_ACTION','HUMAN')),
  action_id TEXT,
  episode_id TEXT,
  episode_version INTEGER CHECK(episode_version IS NULL OR episode_version >= 1),
  human_reason TEXT CHECK(human_reason IS NULL OR length(human_reason) BETWEEN 1 AND 160),
  terminal_outcome TEXT CHECK(terminal_outcome IS NULL OR terminal_outcome IN (
    'CONFIRMED','SUPERSEDED','HUMAN_TAKEOVER','OWNERSHIP_LOST','LEGACY_V3_TERMINAL'
  )),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
  terminal_at INTEGER CHECK(terminal_at IS NULL OR terminal_at >= 0),
  PRIMARY KEY(stream_id, stream_revision),
  FOREIGN KEY(stream_id, stream_revision)
    REFERENCES semantic_origins(stream_id, stream_revision) ON DELETE RESTRICT,
  FOREIGN KEY(action_id, stream_id, stream_revision)
    REFERENCES public_actions(action_id, stream_id, prepared_stream_revision) ON DELETE RESTRICT,
  FOREIGN KEY(episode_id, stream_id)
    REFERENCES episodes(episode_id, stream_id) ON DELETE RESTRICT,
  CHECK((episode_id IS NULL) = (episode_version IS NULL)),
  CHECK(
    (owner_kind='PUBLIC_ACTION' AND action_id IS NOT NULL AND human_reason IS NULL) OR
    (owner_kind='HUMAN' AND human_reason IS NOT NULL)
  ),
  CHECK(
    (terminal_outcome IS NULL AND terminal_at IS NULL) OR
    (terminal_outcome IS NOT NULL AND terminal_at IS NOT NULL)
  ),
  CHECK(
    terminal_outcome IS NULL OR
    (owner_kind='PUBLIC_ACTION' AND terminal_outcome IN ('CONFIRMED','SUPERSEDED','LEGACY_V3_TERMINAL')) OR
    (owner_kind='HUMAN' AND terminal_outcome IN ('HUMAN_TAKEOVER','OWNERSHIP_LOST','LEGACY_V3_TERMINAL'))
  )
) STRICT;
CREATE UNIQUE INDEX one_unresolved_continuation_owner_per_stream
  ON continuation_owners(stream_id) WHERE terminal_outcome IS NULL;
CREATE TABLE deferred_event_parents (
  stream_id TEXT NOT NULL,
  event_seq INTEGER NOT NULL CHECK(event_seq >= 1),
  action_id TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  PRIMARY KEY(stream_id, event_seq),
  FOREIGN KEY(stream_id, event_seq)
    REFERENCES conversation_events(stream_id, event_seq) ON DELETE RESTRICT,
  FOREIGN KEY(action_id, stream_id)
    REFERENCES public_actions(action_id, stream_id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE recovery_barriers (
  recovery_epoch INTEGER PRIMARY KEY CHECK(recovery_epoch >= 1),
  authority_key INTEGER NOT NULL DEFAULT 1 CHECK(authority_key=1),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 160),
  entered_at INTEGER NOT NULL CHECK(entered_at >= 0),
  completion_kind TEXT CHECK(completion_kind IS NULL OR completion_kind='LOSSLESS_SEMANTIC_CUT'),
  completed_at INTEGER CHECK(completed_at IS NULL OR completed_at >= 0),
  CHECK((completion_kind IS NULL) = (completed_at IS NULL))
) STRICT;
CREATE UNIQUE INDEX one_active_recovery_barrier
  ON recovery_barriers(authority_key) WHERE completed_at IS NULL;
CREATE TABLE non_actionable_ack_cuts (
  stream_id TEXT NOT NULL,
  stream_revision INTEGER NOT NULL CHECK(stream_revision >= 1),
  ack_through_event_seq INTEGER NOT NULL CHECK(ack_through_event_seq >= 1),
  episode_id TEXT,
  episode_version INTEGER CHECK(episode_version IS NULL OR episode_version >= 1),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  PRIMARY KEY(stream_id, stream_revision),
  FOREIGN KEY(stream_id, stream_revision)
    REFERENCES semantic_origins(stream_id, stream_revision) ON DELETE RESTRICT,
  FOREIGN KEY(stream_id, ack_through_event_seq)
    REFERENCES conversation_events(stream_id, event_seq) ON DELETE RESTRICT,
  FOREIGN KEY(episode_id, stream_id)
    REFERENCES episodes(episode_id, stream_id) ON DELETE RESTRICT,
  CHECK((episode_id IS NULL) = (episode_version IS NULL))
) STRICT;
CREATE TRIGGER non_actionable_ack_cuts_validate_insert_v4
BEFORE INSERT ON non_actionable_ack_cuts
WHEN NOT EXISTS (
  SELECT 1 FROM semantic_origins so
  JOIN conversation_streams cs ON cs.stream_id=so.stream_id
  WHERE so.stream_id=NEW.stream_id
    AND so.stream_revision=NEW.stream_revision
    AND so.origin_kind='NON_ACTIONABLE_ACK'
    AND so.action_id IS NULL
    AND cs.stream_revision=cs.last_event_seq
    AND cs.stream_revision=NEW.ack_through_event_seq
    AND NEW.ack_through_event_seq=NEW.stream_revision
    AND (
      (NEW.episode_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM episodes e
        WHERE e.stream_id=NEW.stream_id AND e.state='active'
      )) OR
      EXISTS (
        SELECT 1 FROM episodes e
        WHERE e.episode_id=NEW.episode_id AND e.stream_id=NEW.stream_id
          AND e.state='active' AND e.version=NEW.episode_version
      )
    )
)
BEGIN
  SELECT RAISE(ABORT,'non_actionable_ack_cut_unproven');
END;
CREATE TRIGGER non_actionable_ack_cuts_no_update_v4
BEFORE UPDATE ON non_actionable_ack_cuts
BEGIN
  SELECT RAISE(ABORT,'non_actionable_ack_cut_immutable');
END;
CREATE TRIGGER non_actionable_ack_cuts_no_delete_v4
BEFORE DELETE ON non_actionable_ack_cuts
BEGIN
  SELECT RAISE(ABORT,'non_actionable_ack_cut_immutable');
END;
CREATE TABLE human_terminal_cuts (
  stream_id TEXT NOT NULL,
  stream_revision INTEGER NOT NULL CHECK(stream_revision >= 1),
  terminal_through_event_seq INTEGER NOT NULL CHECK(terminal_through_event_seq >= 1),
  terminal_outcome TEXT NOT NULL CHECK(terminal_outcome IN ('HUMAN_TAKEOVER','OWNERSHIP_LOST')),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  PRIMARY KEY(stream_id, stream_revision),
  FOREIGN KEY(stream_id, stream_revision)
    REFERENCES continuation_owners(stream_id, stream_revision) ON DELETE RESTRICT,
  FOREIGN KEY(stream_id, terminal_through_event_seq)
    REFERENCES conversation_events(stream_id, event_seq) ON DELETE RESTRICT
) STRICT;
CREATE TRIGGER human_terminal_cuts_validate_insert_v4
BEFORE INSERT ON human_terminal_cuts
WHEN NOT EXISTS (
  SELECT 1 FROM continuation_owners co
  JOIN conversation_streams cs ON cs.stream_id=co.stream_id
  WHERE co.stream_id=NEW.stream_id
    AND co.stream_revision=NEW.stream_revision
    AND co.owner_kind='HUMAN'
    AND co.terminal_outcome IS NULL
    AND cs.stream_revision=cs.last_event_seq
    AND cs.last_event_seq=NEW.terminal_through_event_seq
    AND NEW.terminal_through_event_seq>=NEW.stream_revision
)
BEGIN
  SELECT RAISE(ABORT,'human_terminal_cut_unproven');
END;
CREATE TRIGGER human_terminal_cuts_no_update_v4
BEFORE UPDATE ON human_terminal_cuts
BEGIN
  SELECT RAISE(ABORT,'human_terminal_cut_immutable');
END;
CREATE TRIGGER human_terminal_cuts_no_delete_v4
BEFORE DELETE ON human_terminal_cuts
BEGIN
  SELECT RAISE(ABORT,'human_terminal_cut_immutable');
END;
CREATE TRIGGER conversation_events_validate_insert_v4
BEFORE INSERT ON conversation_events
WHEN
  EXISTS (SELECT 1 FROM recovery_barriers WHERE completed_at IS NULL) OR
  NOT EXISTS (
    SELECT 1 FROM conversation_streams cs
    WHERE cs.stream_id=NEW.stream_id
      AND cs.stream_revision=cs.last_event_seq
      AND NEW.event_seq=cs.last_event_seq+1
  )
BEGIN
  SELECT RAISE(ABORT,'conversation_event_append_invalid');
END;
CREATE TRIGGER conversation_events_defer_customer_v4
AFTER INSERT ON conversation_events
WHEN NEW.event_kind='CUSTOMER_MESSAGE'
BEGIN
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM public_actions pa
    WHERE pa.stream_id=NEW.stream_id AND pa.state IN ('SENDING','UNCERTAIN')
  )>1 THEN RAISE(ABORT,'multiple_unresolved_send_actions') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_actions pa
    WHERE pa.stream_id=NEW.stream_id AND pa.state IN ('SENDING','UNCERTAIN')
  ) AND NOT EXISTS (
    SELECT 1 FROM public_actions pa
    JOIN continuation_owners co
      ON co.stream_id=pa.stream_id
      AND co.stream_revision=pa.prepared_stream_revision
      AND co.action_id=pa.action_id
    WHERE pa.stream_id=NEW.stream_id
      AND pa.state IN ('SENDING','UNCERTAIN')
      AND co.terminal_outcome IS NULL
      AND co.owner_kind IN ('PUBLIC_ACTION','HUMAN')
  ) THEN RAISE(ABORT,'unresolved_send_owner_missing') END;
  INSERT INTO deferred_event_parents(stream_id,event_seq,action_id,created_at)
  SELECT NEW.stream_id,NEW.event_seq,pa.action_id,NEW.accepted_at
  FROM public_actions pa
  JOIN continuation_owners co
    ON co.stream_id=pa.stream_id
    AND co.stream_revision=pa.prepared_stream_revision
    AND co.action_id=pa.action_id
  WHERE pa.stream_id=NEW.stream_id
    AND pa.state IN ('SENDING','UNCERTAIN')
    AND pa.send_started_at IS NOT NULL
    AND co.owner_kind='PUBLIC_ACTION'
    AND co.terminal_outcome IS NULL;
END;
CREATE TRIGGER conversation_events_advance_stream_v4
AFTER INSERT ON conversation_events
BEGIN
  UPDATE conversation_streams
  SET last_event_seq=NEW.event_seq,
      stream_revision=stream_revision+1,
      updated_at=NEW.accepted_at
  WHERE stream_id=NEW.stream_id
    AND last_event_seq=NEW.event_seq-1
    AND stream_revision=NEW.event_seq-1;
  SELECT CASE WHEN changes()<>1
    THEN RAISE(ABORT,'conversation_stream_advance_failed') END;
END;
CREATE TRIGGER conversation_events_no_update_v4
BEFORE UPDATE ON conversation_events
BEGIN
  SELECT RAISE(ABORT,'conversation_event_immutable');
END;
CREATE TRIGGER conversation_events_no_delete_v4
BEFORE DELETE ON conversation_events
BEGIN
  SELECT RAISE(ABORT,'conversation_event_immutable');
END;
CREATE TRIGGER conversation_streams_no_delete_v4
BEFORE DELETE ON conversation_streams
BEGIN
  SELECT RAISE(ABORT,'conversation_stream_history_immutable');
END;
CREATE TRIGGER conversation_streams_update_guard_v4
BEFORE UPDATE ON conversation_streams
WHEN
  NEW.stream_id<>OLD.stream_id OR
  NEW.source_provider<>OLD.source_provider OR
  NEW.source_conversation_id<>OLD.source_conversation_id OR
  NEW.created_at<>OLD.created_at OR
  OLD.stream_revision<>OLD.last_event_seq OR
  NOT (
    (
      NEW.stream_revision=OLD.stream_revision+1 AND
      NEW.last_event_seq=OLD.last_event_seq+1 AND
      NEW.scan_highwater IS OLD.scan_highwater AND
      EXISTS (
        SELECT 1 FROM conversation_events ce
        WHERE ce.stream_id=OLD.stream_id AND ce.event_seq=NEW.last_event_seq
      )
    ) OR
    (
      NEW.stream_revision=OLD.stream_revision AND
      NEW.last_event_seq=OLD.last_event_seq AND
      NEW.scan_highwater IS NOT NULL AND
      (OLD.scan_highwater IS NULL OR NEW.scan_highwater>=OLD.scan_highwater)
    )
  )
BEGIN
  SELECT RAISE(ABORT,'conversation_stream_update_invalid');
END;
CREATE TRIGGER public_actions_validate_insert_v4
BEFORE INSERT ON public_actions
WHEN
  NEW.state<>'PREPARED' OR
  NEW.attempts<>0 OR
  NEW.lease_token IS NOT NULL OR NEW.lease_expires_at IS NOT NULL OR
  NEW.confirmed_source_message_id IS NOT NULL OR NEW.terminal_reason IS NOT NULL OR
  NEW.send_started_at IS NOT NULL OR NEW.confirmed_at IS NOT NULL OR
  NEW.episode_id IS NULL OR NEW.episode_version IS NULL OR
  EXISTS (
    SELECT 1 FROM continuation_owners co
    WHERE co.stream_id=NEW.stream_id AND co.terminal_outcome IS NULL
  ) OR
  NOT EXISTS (
    SELECT 1 FROM conversation_streams cs
    WHERE cs.stream_id=NEW.stream_id
      AND cs.stream_revision=NEW.prepared_stream_revision
  ) OR
  NOT EXISTS (
    SELECT 1 FROM episodes e
    WHERE e.episode_id=NEW.episode_id AND e.stream_id=NEW.stream_id AND e.state='active'
      AND (
        (NEW.action_type='ANSWER' AND NEW.episode_version=e.version) OR
        (NEW.action_type='CLARIFY' AND NEW.episode_version=e.version+1)
      )
  )
BEGIN
  SELECT RAISE(ABORT,'public_action_episode_required');
END;
CREATE TRIGGER public_actions_immutable_semantics_v4
BEFORE UPDATE ON public_actions
WHEN
  NEW.action_id<>OLD.action_id OR NEW.stream_id<>OLD.stream_id OR
  COALESCE(NEW.episode_id,'')<>COALESCE(OLD.episode_id,'') OR
  COALESCE(NEW.episode_version,-1)<>COALESCE(OLD.episode_version,-1) OR
  NEW.prepared_stream_revision<>OLD.prepared_stream_revision OR
  NEW.action_type<>OLD.action_type OR
  NEW.basis_event_seqs_json<>OLD.basis_event_seqs_json OR
  COALESCE(NEW.requested_slot,'')<>COALESCE(OLD.requested_slot,'') OR
  NEW.deadline_at<>OLD.deadline_at OR NEW.created_at<>OLD.created_at
BEGIN
  SELECT RAISE(ABORT,'public_action_semantics_immutable');
END;
CREATE TRIGGER public_actions_monotonic_lifecycle_v4
BEFORE UPDATE ON public_actions
WHEN
  (OLD.state='PREPARED' AND NEW.state NOT IN ('PREPARED','GATING','STALE','CANCELLED','HANDOFF_DONE')) OR
  (OLD.state='GATING' AND NEW.state NOT IN ('GATING','SENDING','STALE','CANCELLED','HANDOFF_DONE')) OR
  (OLD.state='SENDING' AND NEW.state NOT IN ('SENDING','UNCERTAIN','CONFIRMED','HANDOFF_DONE')) OR
  (OLD.state='UNCERTAIN' AND NEW.state NOT IN ('UNCERTAIN','CONFIRMED','HANDOFF_DONE')) OR
  (OLD.state IN ('CONFIRMED','STALE','CANCELLED','HANDOFF_DONE','NOT_SENT') AND NEW.state<>OLD.state) OR
  (OLD.state<>'NOT_SENT' AND NEW.state='NOT_SENT') OR
  (NEW.state='PREPARED' AND
    (NEW.lease_token IS NOT NULL OR NEW.lease_expires_at IS NOT NULL OR
     NEW.attempts<>0 OR NEW.send_started_at IS NOT NULL)) OR
  (NEW.state='GATING' AND
    (NEW.lease_token IS NULL OR NEW.lease_expires_at IS NULL OR
     NEW.attempts<1 OR NEW.send_started_at IS NOT NULL OR
     NEW.lease_expires_at<=NEW.updated_at)) OR
  (NEW.state='SENDING' AND
    (NEW.lease_token IS NULL OR NEW.lease_expires_at IS NULL OR
     NEW.attempts<1 OR NEW.send_started_at IS NULL OR
     NEW.lease_expires_at<=NEW.updated_at)) OR
  (NEW.state='UNCERTAIN' AND
    (NEW.lease_token IS NOT NULL OR NEW.lease_expires_at IS NOT NULL OR
     NEW.attempts<1 OR NEW.send_started_at IS NULL)) OR
  (OLD.send_started_at IS NOT NULL AND COALESCE(NEW.send_started_at,-1)<>OLD.send_started_at) OR
  (OLD.send_started_at IS NULL AND NEW.send_started_at IS NOT NULL AND
    NOT (OLD.state='GATING' AND NEW.state='SENDING')) OR
  (NEW.state IN ('PREPARED','GATING','STALE','CANCELLED','NOT_SENT') AND
    NEW.send_started_at IS NOT NULL) OR
  ((NEW.confirmed_source_message_id IS NULL) <> (NEW.confirmed_at IS NULL)) OR
  (OLD.confirmed_source_message_id IS NULL AND NEW.confirmed_source_message_id IS NOT NULL AND
    (NEW.send_started_at IS NULL OR
     NEW.state NOT IN ('SENDING','UNCERTAIN','CONFIRMED','HANDOFF_DONE'))) OR
  (NEW.state='CONFIRMED' AND
    (NEW.send_started_at IS NULL OR NEW.confirmed_source_message_id IS NULL OR NEW.confirmed_at IS NULL OR
     NOT EXISTS (
       SELECT 1 FROM public_action_confirmation_cuts pc
       WHERE pc.action_id=NEW.action_id AND pc.stream_id=NEW.stream_id
     ))) OR
  (OLD.confirmed_source_message_id IS NOT NULL AND COALESCE(NEW.confirmed_source_message_id,-1)<>OLD.confirmed_source_message_id) OR
  (OLD.confirmed_at IS NOT NULL AND COALESCE(NEW.confirmed_at,-1)<>OLD.confirmed_at)
BEGIN
  SELECT RAISE(ABORT,'public_action_lifecycle_non_monotonic');
END;
CREATE TRIGGER public_actions_claim_cas_guard_v4
BEFORE UPDATE ON public_actions
WHEN NEW.state='GATING' AND (
  EXISTS (SELECT 1 FROM recovery_barriers WHERE completed_at IS NULL) OR
  NEW.updated_at<OLD.updated_at OR
  NEW.updated_at>bp_now_ms() OR
  bp_mutation_lease_token() IS NOT NEW.lease_token OR
  NEW.terminal_reason IS NOT NULL OR
  NEW.lease_expires_at IS NULL OR NEW.lease_expires_at<=bp_now_ms() OR
  NOT EXISTS (
    SELECT 1 FROM continuation_owners co
    WHERE co.stream_id=NEW.stream_id
      AND co.stream_revision=NEW.prepared_stream_revision
      AND co.action_id=NEW.action_id
      AND co.owner_kind='PUBLIC_ACTION'
      AND co.terminal_outcome IS NULL
  ) OR
  NOT EXISTS (
    SELECT 1 FROM public_action_descriptors pad
    WHERE pad.action_id=NEW.action_id AND pad.stream_id=NEW.stream_id
  ) OR
  NOT (
    (OLD.state='PREPARED' AND
     OLD.lease_token IS NULL AND OLD.lease_expires_at IS NULL AND
     NEW.attempts=OLD.attempts+1) OR
    (OLD.state='GATING' AND
     OLD.lease_token IS NOT NULL AND OLD.lease_expires_at IS NOT NULL AND
     OLD.lease_expires_at<=bp_now_ms() AND
     NEW.attempts=OLD.attempts+1)
  )
)
BEGIN
  SELECT RAISE(ABORT,'public_action_claim_cas_unproven');
END;
CREATE TRIGGER public_actions_sending_admission_guard_v4
BEFORE UPDATE OF state ON public_actions
WHEN OLD.state='GATING' AND NEW.state='SENDING' AND NOT (
  NEW.lease_token IS OLD.lease_token AND
  NEW.lease_expires_at IS OLD.lease_expires_at AND
  NEW.attempts=OLD.attempts AND
  bp_mutation_lease_token() IS OLD.lease_token AND
  NEW.updated_at>=OLD.updated_at AND
  NEW.updated_at<=bp_now_ms() AND
  NEW.send_started_at=NEW.updated_at AND
  NEW.terminal_reason IS OLD.terminal_reason AND
  OLD.lease_expires_at>bp_now_ms() AND
  NEW.deadline_at>bp_now_ms() AND
  NOT EXISTS (SELECT 1 FROM recovery_barriers WHERE completed_at IS NULL) AND
  EXISTS (
    SELECT 1 FROM conversation_streams cs
    WHERE cs.stream_id=NEW.stream_id
      AND cs.stream_revision=NEW.prepared_stream_revision
      AND cs.stream_revision=cs.last_event_seq
  ) AND
  EXISTS (
    SELECT 1 FROM semantic_origins so
    WHERE so.stream_id=NEW.stream_id
      AND so.stream_revision=NEW.prepared_stream_revision
      AND so.origin_kind='PUBLIC_ACTION'
      AND so.action_id=NEW.action_id
  ) AND
  EXISTS (
    SELECT 1 FROM continuation_owners co
    WHERE co.stream_id=NEW.stream_id
      AND co.stream_revision=NEW.prepared_stream_revision
      AND co.action_id=NEW.action_id
      AND co.owner_kind='PUBLIC_ACTION'
      AND co.terminal_outcome IS NULL
  ) AND
  EXISTS (
    SELECT 1 FROM public_action_descriptors pad
    WHERE pad.action_id=NEW.action_id AND pad.stream_id=NEW.stream_id
  ) AND
  EXISTS (
    SELECT 1 FROM episodes e
    WHERE e.episode_id=NEW.episode_id
      AND e.stream_id=NEW.stream_id
      AND e.state='active'
      AND e.version=NEW.episode_version
      AND NOT EXISTS (
        SELECT 1 FROM episode_constraint_latches ecl
        WHERE ecl.episode_id=e.episode_id
      )
      AND (
        NEW.action_type='ANSWER' OR
        (NEW.action_type='CLARIFY' AND
         e.clarification_prompts_sent=1 AND
         e.clarification_action_id=NEW.action_id AND
         e.requested_slot IS NEW.requested_slot)
      )
  )
)
BEGIN
  SELECT RAISE(ABORT,'public_action_sending_admission_unproven');
END;
CREATE TRIGGER public_actions_gating_terminal_claim_guard_v4
BEFORE UPDATE OF state ON public_actions
WHEN OLD.state='GATING' AND NEW.state IN ('STALE','CANCELLED') AND
  EXISTS (
    SELECT 1 FROM conversation_streams cs
    WHERE cs.stream_id=OLD.stream_id
      AND cs.stream_revision=OLD.prepared_stream_revision
  ) AND (
    OLD.lease_token IS NULL OR OLD.lease_expires_at IS NULL OR
    OLD.lease_expires_at<=bp_now_ms() OR
    bp_mutation_lease_token() IS NOT OLD.lease_token
  )
BEGIN
  SELECT RAISE(ABORT,'public_action_gating_terminal_claim_unproven');
END;
CREATE TRIGGER public_actions_handoff_guard_v4
BEFORE UPDATE OF state ON public_actions
WHEN OLD.state<>NEW.state AND NEW.state='HANDOFF_DONE' AND NOT EXISTS (
  SELECT 1 FROM continuation_owners co
  JOIN episodes e ON e.episode_id=co.episode_id AND e.stream_id=co.stream_id
  JOIN human_terminal_cuts htc
    ON htc.stream_id=co.stream_id AND htc.stream_revision=co.stream_revision
  WHERE co.stream_id=NEW.stream_id
    AND co.stream_revision=NEW.prepared_stream_revision
    AND co.action_id=NEW.action_id
    AND co.owner_kind='HUMAN' AND co.terminal_outcome IS NULL
    AND e.state='closed' AND e.version=co.episode_version+1
    AND NEW.terminal_reason IN ('human_takeover','ownership_lost')
    AND e.close_reason=NEW.terminal_reason
    AND htc.terminal_outcome=CASE NEW.terminal_reason
      WHEN 'human_takeover' THEN 'HUMAN_TAKEOVER'
      ELSE 'OWNERSHIP_LOST'
    END
)
BEGIN
  SELECT RAISE(ABORT,'public_action_handoff_unproven');
END;
CREATE TRIGGER public_actions_terminal_owner_transition_v4
AFTER UPDATE OF state ON public_actions
WHEN OLD.state IN ('PREPARED','GATING') AND NEW.state IN ('STALE','CANCELLED')
BEGIN
  SELECT CASE WHEN NEW.terminal_reason IS NULL
    THEN RAISE(ABORT,'public_action_terminal_reason_required') END;
  UPDATE continuation_owners
  SET terminal_outcome='SUPERSEDED',terminal_at=NEW.updated_at,updated_at=NEW.updated_at
  WHERE stream_id=NEW.stream_id
    AND stream_revision=NEW.prepared_stream_revision
    AND action_id=NEW.action_id
    AND owner_kind='PUBLIC_ACTION'
    AND terminal_outcome IS NULL
    AND EXISTS (
      SELECT 1 FROM conversation_streams cs
      WHERE cs.stream_id=NEW.stream_id
        AND cs.stream_revision>NEW.prepared_stream_revision
    );
  UPDATE continuation_owners
  SET owner_kind='HUMAN',human_reason=NEW.terminal_reason,
      episode_version=CASE
        WHEN episode_id IS NULL THEN NULL
        ELSE (
          SELECT e.version FROM episodes e
          WHERE e.episode_id=continuation_owners.episode_id
            AND e.stream_id=continuation_owners.stream_id
            AND e.state='active'
        )
      END,
      updated_at=NEW.updated_at
  WHERE stream_id=NEW.stream_id
    AND stream_revision=NEW.prepared_stream_revision
    AND action_id=NEW.action_id
    AND owner_kind='PUBLIC_ACTION'
    AND terminal_outcome IS NULL
    AND EXISTS (
      SELECT 1 FROM conversation_streams cs
      WHERE cs.stream_id=NEW.stream_id
        AND cs.stream_revision=NEW.prepared_stream_revision
    );
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM continuation_owners co
    WHERE co.stream_id=NEW.stream_id
      AND co.stream_revision=NEW.prepared_stream_revision
      AND co.action_id=NEW.action_id
      AND (
        (co.owner_kind='PUBLIC_ACTION' AND co.terminal_outcome='SUPERSEDED') OR
        (co.owner_kind='HUMAN' AND co.terminal_outcome IS NULL)
      )
  ) THEN RAISE(ABORT,'public_action_terminal_owner_transition_failed') END;
END;
CREATE TRIGGER episodes_no_delete_v4
BEFORE DELETE ON episodes
BEGIN
  SELECT RAISE(ABORT,'episode_history_immutable');
END;
CREATE TRIGGER episodes_identity_state_guard_v4
BEFORE UPDATE ON episodes
WHEN
  NEW.episode_id<>OLD.episode_id OR
  NEW.stream_id<>OLD.stream_id OR
  NEW.created_at<>OLD.created_at OR
  OLD.state='closed' OR
  NEW.version<>OLD.version+1 OR
  (NEW.state='active' AND (NEW.closed_at IS NOT NULL OR NEW.close_reason IS NOT NULL)) OR
  (NEW.state='closed' AND (
    NEW.closed_at IS NULL OR NEW.close_reason IS NULL OR
    NEW.close_reason NOT IN (
      'completed','replaced','human_takeover','ownership_lost',
      'non_actionable_ack','superseded','expired'
    )
  )) OR
  (NEW.clarification_prompts_sent=0 AND
    (NEW.requested_slot IS NOT NULL OR NEW.clarification_action_id IS NOT NULL)) OR
  (NEW.clarification_action_id IS NULL AND NEW.requested_slot IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT,'episode_update_non_monotonic');
END;
CREATE TRIGGER episodes_terminal_protocol_guard_v4
BEFORE UPDATE OF state ON episodes
WHEN OLD.state='active' AND NEW.state='closed' AND (
  (NEW.close_reason IN ('human_takeover','ownership_lost') AND NOT EXISTS (
    SELECT 1 FROM continuation_owners co
    JOIN human_terminal_cuts htc
      ON htc.stream_id=co.stream_id AND htc.stream_revision=co.stream_revision
    WHERE co.stream_id=OLD.stream_id
      AND co.episode_id=OLD.episode_id
      AND co.episode_version=OLD.version
      AND co.owner_kind='HUMAN' AND co.terminal_outcome IS NULL
      AND htc.terminal_outcome=CASE NEW.close_reason
        WHEN 'human_takeover' THEN 'HUMAN_TAKEOVER'
        ELSE 'OWNERSHIP_LOST'
      END
  )) OR
  (NEW.close_reason='non_actionable_ack' AND NOT EXISTS (
    SELECT 1 FROM semantic_origins so
    JOIN conversation_streams cs ON cs.stream_id=so.stream_id
    JOIN non_actionable_ack_cuts ac
      ON ac.stream_id=so.stream_id AND ac.stream_revision=so.stream_revision
    WHERE so.stream_id=OLD.stream_id
      AND so.stream_revision=cs.stream_revision
      AND so.origin_kind='NON_ACTIONABLE_ACK'
      AND ac.episode_id=OLD.episode_id
      AND ac.episode_version=OLD.version
  ))
)
BEGIN
  SELECT RAISE(ABORT,'episode_terminal_protocol_unproven');
END;
CREATE TRIGGER episodes_clarification_open_guard_v4
BEFORE UPDATE ON episodes
WHEN OLD.clarification_prompts_sent=0 AND NEW.clarification_prompts_sent=1 AND NOT EXISTS (
  SELECT 1 FROM public_actions pa
  JOIN continuation_owners co
    ON co.stream_id=pa.stream_id
    AND co.stream_revision=pa.prepared_stream_revision
    AND co.action_id=pa.action_id
  WHERE pa.action_id=NEW.clarification_action_id
    AND pa.stream_id=OLD.stream_id
    AND pa.episode_id=OLD.episode_id
    AND pa.episode_version=NEW.version
    AND pa.action_type='CLARIFY'
    AND pa.state='PREPARED'
    AND pa.requested_slot IS NEW.requested_slot
    AND co.owner_kind='PUBLIC_ACTION'
    AND co.terminal_outcome IS NULL
)
BEGIN
  SELECT RAISE(ABORT,'clarification_budget_open_unproven');
END;
CREATE TRIGGER episodes_clarification_release_guard_v4
BEFORE UPDATE ON episodes
WHEN OLD.clarification_prompts_sent=1 AND NEW.clarification_prompts_sent=0 AND NOT EXISTS (
  SELECT 1 FROM public_actions pa
  JOIN continuation_owners co
    ON co.stream_id=pa.stream_id
    AND co.stream_revision=pa.prepared_stream_revision
    AND co.action_id=pa.action_id
  JOIN conversation_streams cs ON cs.stream_id=pa.stream_id
  WHERE pa.action_id=OLD.clarification_action_id
    AND pa.stream_id=OLD.stream_id
    AND pa.episode_id=OLD.episode_id
    AND pa.action_type='CLARIFY'
    AND pa.state IN ('STALE','CANCELLED')
    AND pa.send_started_at IS NULL
    AND cs.stream_revision>pa.prepared_stream_revision
    AND co.owner_kind='PUBLIC_ACTION'
    AND co.terminal_outcome='SUPERSEDED'
)
BEGIN
  SELECT RAISE(ABORT,'clarification_budget_release_unproven');
END;
CREATE TRIGGER episodes_clarification_binding_guard_v4
BEFORE UPDATE ON episodes
WHEN OLD.clarification_prompts_sent=1 AND NEW.clarification_prompts_sent=1 AND (
  (NEW.clarification_action_id IS OLD.clarification_action_id AND
   NEW.requested_slot IS NOT OLD.requested_slot) OR
  (NEW.clarification_action_id IS NOT OLD.clarification_action_id AND NOT (
    OLD.clarification_action_id IS NOT NULL AND
    NEW.clarification_action_id IS NULL AND
    NEW.requested_slot IS NULL AND
    EXISTS (
      SELECT 1 FROM public_actions pa
      JOIN continuation_owners co
        ON co.stream_id=pa.stream_id
        AND co.stream_revision=pa.prepared_stream_revision
        AND co.action_id=pa.action_id
      WHERE pa.action_id=OLD.clarification_action_id
        AND pa.stream_id=OLD.stream_id
        AND pa.episode_id=OLD.episode_id
        AND pa.action_type='CLARIFY'
        AND pa.state='CONFIRMED'
        AND co.owner_kind='PUBLIC_ACTION'
        AND co.terminal_outcome='CONFIRMED'
    )
  ))
)
BEGIN
  SELECT RAISE(ABORT,'clarification_binding_non_monotonic');
END;
CREATE TRIGGER episode_constraint_latches_validate_insert_v4
BEFORE INSERT ON episode_constraint_latches
WHEN NOT EXISTS (
  SELECT 1 FROM episodes e
  JOIN conversation_events ce
    ON ce.stream_id=e.stream_id AND ce.event_seq=NEW.first_event_seq
  WHERE e.episode_id=NEW.episode_id
)
BEGIN
  SELECT RAISE(ABORT,'constraint_latch_provenance_invalid');
END;
CREATE TRIGGER episode_constraint_latches_no_update_v4
BEFORE UPDATE ON episode_constraint_latches
BEGIN
  SELECT RAISE(ABORT,'constraint_latch_immutable');
END;
CREATE TRIGGER episode_constraint_latches_no_delete_v4
BEFORE DELETE ON episode_constraint_latches
BEGIN
  SELECT RAISE(ABORT,'constraint_latch_immutable');
END;
CREATE TRIGGER episode_slots_validate_insert_v4
BEFORE INSERT ON episode_slots
WHEN NEW.derived_through_event_seq IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM episodes e
  JOIN conversation_events ce
    ON ce.stream_id=e.stream_id AND ce.event_seq=NEW.derived_through_event_seq
  WHERE e.episode_id=NEW.episode_id
)
BEGIN
  SELECT RAISE(ABORT,'episode_slot_provenance_invalid');
END;
CREATE TRIGGER episode_slots_validate_update_v4
BEFORE UPDATE ON episode_slots
WHEN
  NEW.episode_id<>OLD.episode_id OR
  NEW.slot_name<>OLD.slot_name OR
  (NEW.derived_through_event_seq IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM episodes e
    JOIN conversation_events ce
      ON ce.stream_id=e.stream_id AND ce.event_seq=NEW.derived_through_event_seq
    WHERE e.episode_id=NEW.episode_id
  ))
BEGIN
  SELECT RAISE(ABORT,'episode_slot_update_invalid');
END;
CREATE TRIGGER semantic_origins_validate_insert
BEFORE INSERT ON semantic_origins
WHEN
  (NEW.origin_kind IN ('DIRECT_HUMAN','NON_ACTIONABLE_ACK') AND (
    NOT EXISTS (
      SELECT 1 FROM conversation_streams cs
      WHERE cs.stream_id=NEW.stream_id AND cs.stream_revision=NEW.stream_revision
    ) OR
    EXISTS (
      SELECT 1 FROM public_actions pa
      WHERE pa.stream_id=NEW.stream_id
        AND pa.prepared_stream_revision=NEW.stream_revision
    )
  )) OR
  (NEW.origin_kind='PUBLIC_ACTION' AND NOT EXISTS (
    SELECT 1 FROM public_actions pa
    WHERE pa.action_id=NEW.action_id
      AND pa.stream_id=NEW.stream_id
      AND pa.prepared_stream_revision=NEW.stream_revision
      AND (
        (EXISTS (
          SELECT 1 FROM public_action_descriptors d
          WHERE d.action_id=NEW.action_id AND d.stream_id=NEW.stream_id
        ) AND NOT EXISTS (
          SELECT 1 FROM legacy_v3_actions l WHERE l.action_id=NEW.action_id
        )) OR
        (EXISTS (
          SELECT 1 FROM legacy_v3_actions l
          WHERE l.action_id=NEW.action_id
        ) AND NOT EXISTS (
          SELECT 1 FROM public_action_descriptors d WHERE d.action_id=NEW.action_id
        ))
      )
      AND EXISTS (
        SELECT 1 FROM public_action_candidate_sets pcs
        WHERE pcs.action_id=NEW.action_id
          AND pcs.candidate_count=(
            SELECT COUNT(*) FROM public_action_candidates pac
            WHERE pac.action_id=NEW.action_id
          )
      )
      AND json_valid(pa.basis_event_seqs_json)
      AND json_type(pa.basis_event_seqs_json)='array'
      AND json_array_length(pa.basis_event_seqs_json)=(
        SELECT COUNT(*) FROM public_action_source_events pse
        WHERE pse.action_id=NEW.action_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public_action_source_events pse
        WHERE pse.action_id=NEW.action_id AND (
          pse.stream_id<>NEW.stream_id OR
          pse.ordinal<1 OR
          pse.ordinal>json_array_length(pa.basis_event_seqs_json) OR
          pse.event_seq<>json_extract(
            pa.basis_event_seqs_json,
            '$[' || (pse.ordinal-1) || ']'
          )
        )
      )
  ))
BEGIN
  SELECT RAISE(ABORT,'semantic_origin_revision_not_current');
END;
CREATE TRIGGER semantic_origins_no_update
BEFORE UPDATE ON semantic_origins
BEGIN
  SELECT RAISE(ABORT,'semantic_origin_immutable');
END;
CREATE TRIGGER semantic_origins_no_delete
BEFORE DELETE ON semantic_origins
BEGIN
  SELECT RAISE(ABORT,'semantic_origin_immutable');
END;
CREATE TRIGGER public_action_descriptors_validate_insert
BEFORE INSERT ON public_action_descriptors
WHEN
  EXISTS (
    SELECT 1 FROM semantic_origins so WHERE so.action_id=NEW.action_id
  ) OR
  EXISTS (
    SELECT 1 FROM legacy_v3_actions l WHERE l.action_id=NEW.action_id
  ) OR
  (NEW.product_event_seq IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public_action_source_events s
    WHERE s.action_id=NEW.action_id AND s.stream_id=NEW.stream_id
      AND s.event_seq=NEW.product_event_seq
  )) OR
  (NEW.variant_event_seq IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public_action_source_events s
    WHERE s.action_id=NEW.action_id AND s.stream_id=NEW.stream_id
      AND s.event_seq=NEW.variant_event_seq
  )) OR
  (NEW.category_event_seq IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public_action_source_events s
    WHERE s.action_id=NEW.action_id AND s.stream_id=NEW.stream_id
      AND s.event_seq=NEW.category_event_seq
  )) OR
  (NEW.brand_event_seq IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public_action_source_events s
    WHERE s.action_id=NEW.action_id AND s.stream_id=NEW.stream_id
      AND s.event_seq=NEW.brand_event_seq
  )) OR
  (NEW.store_event_seq IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public_action_source_events s
    WHERE s.action_id=NEW.action_id AND s.stream_id=NEW.stream_id
      AND s.event_seq=NEW.store_event_seq
  )) OR
  (NEW.money_currency_event_seq IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public_action_source_events s
    WHERE s.action_id=NEW.action_id AND s.stream_id=NEW.stream_id
      AND s.event_seq=NEW.money_currency_event_seq
  )) OR
  (NEW.min_price_event_seq IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public_action_source_events s
    WHERE s.action_id=NEW.action_id AND s.stream_id=NEW.stream_id
      AND s.event_seq=NEW.min_price_event_seq
  )) OR
  (NEW.max_price_event_seq IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public_action_source_events s
    WHERE s.action_id=NEW.action_id AND s.stream_id=NEW.stream_id
      AND s.event_seq=NEW.max_price_event_seq
  ))
BEGIN
  SELECT RAISE(ABORT,'public_action_descriptor_provenance_outside_basis');
END;
CREATE TRIGGER public_action_descriptors_no_update
BEFORE UPDATE ON public_action_descriptors
BEGIN
  SELECT RAISE(ABORT,'public_action_descriptor_immutable');
END;
CREATE TRIGGER public_action_descriptors_no_delete
BEFORE DELETE ON public_action_descriptors
BEGIN
  SELECT RAISE(ABORT,'public_action_descriptor_immutable');
END;
CREATE TRIGGER public_action_source_events_validate_insert_v4
BEFORE INSERT ON public_action_source_events
WHEN
  EXISTS (SELECT 1 FROM semantic_origins so WHERE so.action_id=NEW.action_id) OR
  NOT EXISTS (
    SELECT 1 FROM public_actions pa
    WHERE pa.action_id=NEW.action_id AND pa.stream_id=NEW.stream_id
      AND json_valid(pa.basis_event_seqs_json)
      AND json_type(pa.basis_event_seqs_json)='array'
      AND NEW.ordinal BETWEEN 1 AND json_array_length(pa.basis_event_seqs_json)
      AND NEW.event_seq<=pa.prepared_stream_revision
      AND json_extract(
        pa.basis_event_seqs_json,
        '$[' || (NEW.ordinal-1) || ']'
      )=NEW.event_seq
  )
BEGIN
  SELECT RAISE(ABORT,'public_action_source_event_outside_prepared_revision');
END;
CREATE TRIGGER public_action_source_events_no_update
BEFORE UPDATE ON public_action_source_events
BEGIN
  SELECT RAISE(ABORT,'public_action_source_event_immutable');
END;
CREATE TRIGGER public_action_source_events_no_delete
BEFORE DELETE ON public_action_source_events
BEGIN
  SELECT RAISE(ABORT,'public_action_source_event_immutable');
END;
CREATE TRIGGER deferred_event_parents_validate_insert
BEFORE INSERT ON deferred_event_parents
WHEN
  NOT EXISTS (
    SELECT 1 FROM conversation_events ce
    WHERE ce.stream_id=NEW.stream_id AND ce.event_seq=NEW.event_seq
      AND ce.event_kind='CUSTOMER_MESSAGE'
  ) OR
  NOT EXISTS (
    SELECT 1 FROM public_actions pa
    WHERE pa.action_id=NEW.action_id AND pa.stream_id=NEW.stream_id
      AND pa.state IN ('SENDING','UNCERTAIN')
      AND pa.send_started_at IS NOT NULL
      AND NEW.event_seq>pa.prepared_stream_revision
  )
BEGIN
  SELECT RAISE(ABORT,'deferred_event_parent_invalid');
END;
CREATE TRIGGER deferred_event_parents_no_update
BEFORE UPDATE ON deferred_event_parents
BEGIN
  SELECT RAISE(ABORT,'deferred_event_parent_immutable');
END;
CREATE TRIGGER deferred_event_parents_no_delete
BEFORE DELETE ON deferred_event_parents
BEGIN
  SELECT RAISE(ABORT,'deferred_event_parent_immutable');
END;
CREATE TRIGGER continuation_owners_validate_insert
BEFORE INSERT ON continuation_owners
WHEN
  (NEW.action_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public_action_descriptors d WHERE d.action_id=NEW.action_id
  ) AND (
    NEW.owner_kind<>'PUBLIC_ACTION' OR
    NEW.terminal_outcome IS NOT NULL OR
    NEW.human_reason IS NOT NULL
  )) OR
  (NEW.owner_kind='PUBLIC_ACTION' AND NOT EXISTS (
    SELECT 1
    FROM semantic_origins so
    JOIN public_actions pa ON pa.action_id=so.action_id
    WHERE so.stream_id=NEW.stream_id AND so.stream_revision=NEW.stream_revision
      AND so.origin_kind='PUBLIC_ACTION' AND so.action_id=NEW.action_id
      AND pa.stream_id=NEW.stream_id
      AND pa.prepared_stream_revision=NEW.stream_revision
      AND pa.episode_id IS NEW.episode_id
      AND pa.episode_version IS NEW.episode_version
  )) OR
  (NEW.owner_kind='HUMAN' AND NEW.action_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM semantic_origins so
    WHERE so.stream_id=NEW.stream_id AND so.stream_revision=NEW.stream_revision
      AND so.origin_kind='DIRECT_HUMAN'
      AND (
        (NEW.episode_id IS NULL AND NEW.episode_version IS NULL) OR
        EXISTS (
          SELECT 1 FROM episodes e
          WHERE e.episode_id=NEW.episode_id AND e.stream_id=NEW.stream_id
            AND e.state='active' AND e.version=NEW.episode_version
        )
      )
  )) OR
  (NEW.owner_kind='HUMAN' AND NEW.action_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM semantic_origins so
    JOIN public_actions pa ON pa.action_id=so.action_id
    WHERE so.stream_id=NEW.stream_id AND so.stream_revision=NEW.stream_revision
      AND so.origin_kind='PUBLIC_ACTION' AND so.action_id=NEW.action_id
      AND pa.stream_id=NEW.stream_id
      AND pa.prepared_stream_revision=NEW.stream_revision
      AND pa.episode_id IS NEW.episode_id
      AND (
        (pa.episode_id IS NULL AND NEW.episode_version IS NULL) OR
        (pa.episode_id IS NOT NULL AND NEW.episode_version>=pa.episode_version AND EXISTS (
          SELECT 1 FROM episodes e
          WHERE e.episode_id=NEW.episode_id AND e.stream_id=NEW.stream_id
            AND e.state='active' AND e.version=NEW.episode_version
        ))
      )
  ))
BEGIN
  SELECT RAISE(ABORT,'continuation_owner_origin_mismatch');
END;
CREATE TRIGGER continuation_owners_no_delete
BEFORE DELETE ON continuation_owners
BEGIN
  SELECT RAISE(ABORT,'continuation_owner_history_immutable');
END;
CREATE TRIGGER continuation_owners_monotonic_update
BEFORE UPDATE ON continuation_owners
WHEN
  NEW.stream_id <> OLD.stream_id OR
  NEW.stream_revision <> OLD.stream_revision OR
  COALESCE(NEW.action_id,'') <> COALESCE(OLD.action_id,'') OR
  COALESCE(NEW.episode_id,'') <> COALESCE(OLD.episode_id,'') OR
  (
    COALESCE(NEW.episode_version,-1) <> COALESCE(OLD.episode_version,-1) AND
    NOT (
      OLD.owner_kind='PUBLIC_ACTION' AND NEW.owner_kind='HUMAN' AND
      OLD.episode_id IS NOT NULL AND NEW.episode_version >= OLD.episode_version AND
      EXISTS (
        SELECT 1 FROM episodes e
        WHERE e.episode_id=OLD.episode_id AND e.stream_id=OLD.stream_id
          AND e.state='active' AND e.version=NEW.episode_version
      )
    )
  ) OR
  (OLD.owner_kind='HUMAN' AND NEW.owner_kind<>'HUMAN') OR
  (OLD.owner_kind='PUBLIC_ACTION' AND NEW.owner_kind='HUMAN' AND
    EXISTS (
      SELECT 1 FROM public_actions pa
      JOIN public_action_descriptors pad ON pad.action_id=pa.action_id
      WHERE pa.action_id=OLD.action_id AND pa.stream_id=OLD.stream_id
        AND pa.send_started_at IS NOT NULL
    ) AND NOT EXISTS (
      SELECT 1 FROM public_action_human_cuts hc
      WHERE hc.action_id=OLD.action_id AND hc.stream_id=OLD.stream_id
    )) OR
  (OLD.owner_kind='PUBLIC_ACTION' AND NEW.owner_kind='HUMAN' AND NEW.terminal_outcome IS NOT NULL) OR
  (OLD.terminal_outcome IS NULL AND NEW.terminal_outcome='LEGACY_V3_TERMINAL') OR
  (OLD.terminal_outcome IS NOT NULL AND (
    COALESCE(NEW.terminal_outcome,'') <> OLD.terminal_outcome OR
    COALESCE(NEW.terminal_at,-1) <> OLD.terminal_at OR
    NEW.owner_kind <> OLD.owner_kind OR
    COALESCE(NEW.human_reason,'') <> COALESCE(OLD.human_reason,'')
  )) OR
  (OLD.owner_kind='HUMAN' AND COALESCE(NEW.human_reason,'') <> OLD.human_reason) OR
  (OLD.owner_kind='PUBLIC_ACTION' AND NEW.owner_kind='PUBLIC_ACTION' AND NEW.human_reason IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT,'continuation_owner_non_monotonic');
END;
CREATE TRIGGER continuation_owners_human_escalation_claim_guard_v4
BEFORE UPDATE OF owner_kind ON continuation_owners
WHEN OLD.owner_kind='PUBLIC_ACTION' AND NEW.owner_kind='HUMAN' AND
  EXISTS (
    SELECT 1 FROM public_actions pa
    WHERE pa.action_id=OLD.action_id
      AND pa.stream_id=OLD.stream_id
      AND pa.prepared_stream_revision=OLD.stream_revision
      AND pa.state IN ('PREPARED','GATING')
  ) AND (
    NOT EXISTS (
      SELECT 1 FROM conversation_streams cs
      WHERE cs.stream_id=OLD.stream_id
        AND cs.stream_revision=OLD.stream_revision
    ) OR
    EXISTS (
      SELECT 1 FROM public_actions pa
      WHERE pa.action_id=OLD.action_id
        AND pa.state='GATING'
        AND (
          pa.lease_token IS NULL OR pa.lease_expires_at IS NULL OR
          pa.lease_expires_at<=bp_now_ms() OR
          bp_mutation_lease_token() IS NOT pa.lease_token
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT,'continuation_owner_human_escalation_claim_unproven');
END;
CREATE TRIGGER continuation_owners_superseded_guard_v4
BEFORE UPDATE ON continuation_owners
WHEN OLD.terminal_outcome IS NULL AND NEW.terminal_outcome='SUPERSEDED' AND (
  OLD.owner_kind<>'PUBLIC_ACTION' OR
  NOT EXISTS (
    SELECT 1
    FROM public_actions pa
    JOIN conversation_streams cs ON cs.stream_id=pa.stream_id
    WHERE pa.action_id=OLD.action_id
      AND pa.stream_id=OLD.stream_id
      AND pa.prepared_stream_revision=OLD.stream_revision
      AND pa.state IN ('STALE','CANCELLED')
      AND cs.stream_revision>OLD.stream_revision
  )
)
BEGIN
  SELECT RAISE(ABORT,'continuation_owner_supersession_unproven');
END;
CREATE TRIGGER continuation_owners_confirmed_guard_v4
BEFORE UPDATE ON continuation_owners
WHEN OLD.terminal_outcome IS NULL AND NEW.terminal_outcome='CONFIRMED' AND (
  OLD.owner_kind<>'PUBLIC_ACTION' OR
  NOT EXISTS (
    SELECT 1 FROM public_action_confirmation_cuts pc
    WHERE pc.action_id=OLD.action_id AND pc.stream_id=OLD.stream_id
  ) OR
  NOT EXISTS (
    SELECT 1 FROM public_actions pa
    JOIN conversation_events ce
      ON ce.stream_id=pa.stream_id
      AND ce.source_message_id=pa.confirmed_source_message_id
      AND ce.source_id=pa.action_id
      AND ce.event_kind='BABYPARK_PUBLIC_REPLY'
    WHERE pa.action_id=OLD.action_id
      AND pa.stream_id=OLD.stream_id
      AND pa.prepared_stream_revision=OLD.stream_revision
      AND pa.state='CONFIRMED'
      AND pa.confirmed_source_message_id IS NOT NULL
      AND pa.confirmed_at IS NOT NULL
  ) OR
  (SELECT COUNT(*) FROM conversation_events ce
   WHERE ce.stream_id=OLD.stream_id AND ce.source_id=OLD.action_id)<>1 OR
  NOT EXISTS (
    SELECT 1 FROM conversation_events ce
    WHERE ce.stream_id=OLD.stream_id AND ce.source_id=OLD.action_id
      AND ce.event_kind='BABYPARK_PUBLIC_REPLY'
  )
)
BEGIN
  SELECT RAISE(ABORT,'continuation_owner_confirmation_unproven');
END;
CREATE TRIGGER continuation_owners_terminal_episode_v4
BEFORE UPDATE ON continuation_owners
WHEN
  OLD.owner_kind='HUMAN' AND OLD.terminal_outcome IS NULL AND
  NEW.terminal_outcome IN ('HUMAN_TAKEOVER','OWNERSHIP_LOST') AND (
    NOT EXISTS (
      SELECT 1 FROM human_terminal_cuts htc
      WHERE htc.stream_id=NEW.stream_id
        AND htc.stream_revision=NEW.stream_revision
        AND htc.terminal_outcome=NEW.terminal_outcome
    ) OR
    (NEW.episode_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM episodes e
      WHERE e.episode_id=NEW.episode_id AND e.stream_id=NEW.stream_id
        AND e.state='closed'
        AND e.version=OLD.episode_version+1
        AND e.close_reason=CASE NEW.terminal_outcome
          WHEN 'HUMAN_TAKEOVER' THEN 'human_takeover'
          ELSE 'ownership_lost'
        END
    )) OR
    (NEW.action_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public_actions pa
      WHERE pa.action_id=NEW.action_id AND pa.stream_id=NEW.stream_id
        AND pa.prepared_stream_revision=NEW.stream_revision
        AND pa.state IN ('HANDOFF_DONE','STALE','CANCELLED')
        AND (pa.state<>'HANDOFF_DONE' OR pa.terminal_reason=CASE NEW.terminal_outcome
          WHEN 'HUMAN_TAKEOVER' THEN 'human_takeover'
          ELSE 'ownership_lost'
        END)
    ))
  )
BEGIN
  SELECT RAISE(ABORT,'continuation_owner_terminal_episode_mismatch');
END;
CREATE TRIGGER recovery_barriers_no_delete
BEFORE DELETE ON recovery_barriers
BEGIN
  SELECT RAISE(ABORT,'recovery_barrier_history_immutable');
END;
CREATE TRIGGER recovery_barriers_monotonic_update
BEFORE UPDATE ON recovery_barriers
WHEN
  NEW.recovery_epoch <> OLD.recovery_epoch OR
  NEW.authority_key <> OLD.authority_key OR
  NEW.reason <> OLD.reason OR
  NEW.entered_at <> OLD.entered_at OR
  OLD.completed_at IS NOT NULL OR
  NEW.completed_at IS NULL OR
  NEW.completion_kind IS NULL
BEGIN
  SELECT RAISE(ABORT,'recovery_barrier_non_monotonic');
END;
`;

const SCHEMA = `
PRAGMA foreign_keys=ON;
PRAGMA user_version=4;
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
${V4_ADDITIONS_SCHEMA_SQL}
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
  public_action_source_events: ['action_id','ordinal','stream_id','event_seq'],
  public_action_confirmation_cuts: ['action_id','stream_id','confirmed_through_event_seq','created_at'],
  public_action_human_cuts: ['action_id','stream_id','human_through_event_seq','created_at'],
  public_action_candidate_sets: ['action_id','candidate_count','candidate_slot'],
  public_action_descriptors: ['action_id','stream_id','descriptor_version','reason','template_id','response_locale','product_id','product_event_seq','variant_id','variant_event_seq','category_id','category_match_mode','category_event_seq','brand_id','brand_event_seq','store_id','store_event_seq','money_currency','money_currency_event_seq','min_price_minor','min_price_event_seq','max_price_minor','max_price_event_seq'],
  legacy_v3_actions: ['action_id','marker'],
  semantic_origins: ['stream_id','stream_revision','origin_kind','action_id','created_at'],
  continuation_owners: ['stream_id','stream_revision','owner_kind','action_id','episode_id','episode_version','human_reason','terminal_outcome','created_at','updated_at','terminal_at'],
  deferred_event_parents: ['stream_id','event_seq','action_id','created_at'],
  recovery_barriers: ['recovery_epoch','authority_key','reason','entered_at','completion_kind','completed_at'],
  non_actionable_ack_cuts: ['stream_id','stream_revision','ack_through_event_seq','episode_id','episode_version','created_at'],
  human_terminal_cuts: ['stream_id','stream_revision','terminal_through_event_seq','terminal_outcome','created_at'],
});
const V4_TABLES = new Set([
  'public_action_source_events',
  'public_action_confirmation_cuts',
  'public_action_human_cuts',
  'public_action_candidate_sets',
  'public_action_descriptors',
  'legacy_v3_actions',
  'semantic_origins',
  'continuation_owners',
  'deferred_event_parents',
  'recovery_barriers',
  'non_actionable_ack_cuts',
  'human_terminal_cuts',
]);
const EXPECTED_COLUMNS_V3 = Object.freeze(
  Object.fromEntries(
    Object.entries(EXPECTED_COLUMNS)
      .filter(([table]) => !V4_TABLES.has(table))
  )
);
const EXPECTED_COLUMNS_V2 = Object.freeze(
  Object.fromEntries(
    Object.entries(EXPECTED_COLUMNS_V3)
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
const REQUIRED_INDEXES_V3 = new Set([
  ...REQUIRED_INDEXES_V2,
  'sqlite_autoindex_episode_constraint_latches_1',
]);
const REQUIRED_INDEXES = new Set([
  ...REQUIRED_INDEXES_V3,
  'public_actions_action_stream_revision',
  'public_actions_action_stream',
  'episodes_episode_stream',
  'sqlite_autoindex_public_action_source_events_1',
  'sqlite_autoindex_public_action_source_events_2',
  'sqlite_autoindex_public_action_confirmation_cuts_1',
  'sqlite_autoindex_public_action_human_cuts_1',
  'sqlite_autoindex_public_action_candidate_sets_1',
  'sqlite_autoindex_public_action_descriptors_1',
  'sqlite_autoindex_legacy_v3_actions_1',
  'sqlite_autoindex_semantic_origins_1',
  'sqlite_autoindex_continuation_owners_1',
  'one_unresolved_continuation_owner_per_stream',
  'sqlite_autoindex_deferred_event_parents_1',
  'one_active_recovery_barrier',
  'sqlite_autoindex_non_actionable_ack_cuts_1',
  'sqlite_autoindex_human_terminal_cuts_1',
]);
const REQUIRED_TRIGGERS = new Set([
  'conversation_events_validate_insert_v4',
  'conversation_events_defer_customer_v4',
  'conversation_events_advance_stream_v4',
  'conversation_events_no_update_v4',
  'conversation_events_no_delete_v4',
  'conversation_streams_no_delete_v4',
  'conversation_streams_update_guard_v4',
  'public_actions_validate_insert_v4',
  'public_actions_immutable_semantics_v4',
  'public_actions_monotonic_lifecycle_v4',
  'public_actions_claim_cas_guard_v4',
  'public_actions_sending_admission_guard_v4',
  'public_actions_gating_terminal_claim_guard_v4',
  'public_actions_handoff_guard_v4',
  'public_actions_terminal_owner_transition_v4',
  'episodes_no_delete_v4',
  'episodes_terminal_protocol_guard_v4',
  'episodes_identity_state_guard_v4',
  'episodes_clarification_open_guard_v4',
  'episodes_clarification_release_guard_v4',
  'episodes_clarification_binding_guard_v4',
  'episode_constraint_latches_validate_insert_v4',
  'episode_constraint_latches_no_update_v4',
  'episode_constraint_latches_no_delete_v4',
  'episode_slots_validate_insert_v4',
  'episode_slots_validate_update_v4',
  'public_action_confirmation_cuts_validate_insert_v4',
  'public_action_confirmation_cuts_no_update_v4',
  'public_action_confirmation_cuts_no_delete_v4',
  'public_action_human_cuts_validate_insert_v4',
  'public_action_human_cuts_no_update_v4',
  'public_action_human_cuts_no_delete_v4',
  'public_action_candidate_sets_validate_insert_v4',
  'public_action_candidate_sets_no_update',
  'public_action_candidate_sets_no_delete',
  'public_action_candidates_validate_insert_v4',
  'public_action_candidates_no_update_v4',
  'public_action_candidates_no_delete_v4',
  'semantic_origins_validate_insert',
  'semantic_origins_no_update',
  'semantic_origins_no_delete',
  'public_action_descriptors_validate_insert',
  'public_action_descriptors_no_update',
  'public_action_descriptors_no_delete',
  'legacy_v3_actions_validate_insert',
  'legacy_v3_actions_no_update',
  'legacy_v3_actions_no_delete',
  'public_action_source_events_validate_insert_v4',
  'public_action_source_events_no_update',
  'public_action_source_events_no_delete',
  'deferred_event_parents_validate_insert',
  'deferred_event_parents_no_update',
  'deferred_event_parents_no_delete',
  'continuation_owners_validate_insert',
  'continuation_owners_no_delete',
  'continuation_owners_monotonic_update',
  'continuation_owners_human_escalation_claim_guard_v4',
  'continuation_owners_superseded_guard_v4',
  'continuation_owners_confirmed_guard_v4',
  'continuation_owners_terminal_episode_v4',
  'recovery_barriers_no_delete',
  'recovery_barriers_monotonic_update',
  'non_actionable_ack_cuts_validate_insert_v4',
  'non_actionable_ack_cuts_no_update_v4',
  'non_actionable_ack_cuts_no_delete_v4',
  'human_terminal_cuts_validate_insert_v4',
  'human_terminal_cuts_no_update_v4',
  'human_terminal_cuts_no_delete_v4',
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

export function consumeClarificationReservationAttestation(value) {
  if (!value || typeof value !== 'object' ||
      value.schema !== CLARIFICATION_RESERVATION_ATTESTATION_SCHEMA ||
      !clarificationReservationBindings.has(value) ||
      consumedClarificationReservationAttestations.has(value)) {
    return null;
  }
  consumedClarificationReservationAttestations.add(value);
  return clarificationReservationBindings.get(value);
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
  if (kind === 'category_match_mode') {
    if (!CATEGORY_MATCH_MODES.has(value)) {
      fail('FIRST_LINE_VALUE_INVALID',
        'category_match_mode must be NODE_ONLY or INCLUDE_DESCENDANTS',
        { slot_name: slotName });
    }
    return value;
  }
  fail('FIRST_LINE_SLOT_UNSUPPORTED', 'unsupported stable slot kind');
}

function normalizeCategorySelection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'category_id,match_mode') {
    fail('FIRST_LINE_CANDIDATE_INVALID',
      'CATEGORY selection must contain only category_id and match_mode');
  }
  return Object.freeze({
    category_id: normalizeSlotValue('category_id', value.category_id),
    match_mode: normalizeSlotValue('category_match_mode', value.match_mode),
  });
}

function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) ||
      Object.keys(candidate).sort().join(',') !== 'slot,value') {
    fail('FIRST_LINE_CANDIDATE_INVALID', 'candidate must contain only slot and value');
  }
  if (candidate.slot === 'category_id') {
    return { slot: candidate.slot, value: normalizeCategorySelection(candidate.value) };
  }
  if (candidate.slot === 'category_match_mode') {
    fail('FIRST_LINE_CANDIDATE_INVALID',
      'category_match_mode cannot be reserved independently');
  }
  return { slot: candidate.slot, value: normalizeSlotValue(candidate.slot, candidate.value) };
}
function validateCandidateRows(rows, actionId, { expectedCount = null, expectedSlot = undefined } = {}) {
  if (!Array.isArray(rows)) {
    fail('FIRST_LINE_DB_CORRUPT', 'persisted candidate rows are not an array', { action_id: actionId });
  }
  if (expectedCount !== null && rows.length !== expectedCount) {
    fail('FIRST_LINE_DB_CORRUPT',
      'public action candidate count differs from frozen metadata', {
        action_id: actionId, expected: expectedCount, actual: rows.length,
      });
  }
  const candidates = rows.map((item, index) => {
    if (item.ordinal !== index + 1) {
      fail('FIRST_LINE_DB_CORRUPT',
        'public action candidate ordinals are not contiguous', {
          action_id: actionId, expected_ordinal: index + 1, actual_ordinal: item.ordinal,
        });
    }
    const value = parseJson(item.value_json);
    return validatePersistedCandidate(item.slot_name, value);
  });
  const slots = new Set(candidates.map(candidate => candidate.slot));
  if (slots.size > 1) {
    fail('FIRST_LINE_DB_CORRUPT',
      'public action candidate reservation mixes slot kinds', { action_id: actionId });
  }
  const slot = candidates.length === 0 ? null : candidates[0].slot;
  if (expectedSlot !== undefined && slot !== expectedSlot) {
    fail('FIRST_LINE_DB_CORRUPT',
      'public action candidate slot differs from frozen metadata', {
        action_id: actionId, expected_slot: expectedSlot, actual_slot: slot,
      });
  }
  return Object.freeze({ candidates: Object.freeze(candidates), candidate_slot: slot });
}

function normalizeSemanticScope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'brand_id,category,money,product,store_id') {
    fail('FIRST_LINE_ACTION_DESCRIPTOR_INVALID',
      'semantic_scope must contain exactly product, category, brand_id, store_id and money');
  }

  let product = null;
  if (value.product !== null) {
    if (!value.product || typeof value.product !== 'object' ||
        Array.isArray(value.product) ||
        Object.keys(value.product).sort().join(',') !== 'product_id,variant_id') {
      fail('FIRST_LINE_ACTION_DESCRIPTOR_INVALID',
        'semantic_scope.product must contain product_id and variant_id');
    }
    product = Object.freeze({
      product_id: normalizeSlotValue('product_id', value.product.product_id),
      variant_id: value.product.variant_id === null
        ? null
        : normalizeSlotValue('variant_id', value.product.variant_id),
    });
  }

  let category = null;
  if (value.category !== null) {
    if (!value.category || typeof value.category !== 'object' ||
        Array.isArray(value.category) ||
        Object.keys(value.category).sort().join(',') !== 'category_id,match_mode') {
      fail('FIRST_LINE_ACTION_DESCRIPTOR_INVALID',
        'semantic_scope.category must contain category_id and match_mode');
    }
    category = Object.freeze({
      category_id: normalizeSlotValue('category_id', value.category.category_id),
      match_mode: normalizeSlotValue('category_match_mode', value.category.match_mode),
    });
  }

  const brandId = value.brand_id === null
    ? null
    : normalizeSlotValue('brand_id', value.brand_id);
  const storeId = value.store_id === null
    ? null
    : normalizeSlotValue('store_id', value.store_id);

  let money = null;
  if (value.money !== null) {
    if (!value.money || typeof value.money !== 'object' ||
        Array.isArray(value.money) ||
        Object.keys(value.money).sort().join(',') !==
          'currency,max_price_minor,min_price_minor') {
      fail('FIRST_LINE_ACTION_DESCRIPTOR_INVALID',
        'semantic_scope.money must contain currency and both nullable bounds');
    }
    if (value.money.currency !== 'UAH') {
      fail('FIRST_LINE_ACTION_DESCRIPTOR_INVALID',
        'semantic_scope.money currency must be UAH');
    }
    const min = value.money.min_price_minor === null
      ? null
      : nonNegativeInteger(value.money.min_price_minor, 'min_price_minor');
    const max = value.money.max_price_minor === null
      ? null
      : nonNegativeInteger(value.money.max_price_minor, 'max_price_minor');
    if (min === null && max === null) {
      fail('FIRST_LINE_ACTION_DESCRIPTOR_INVALID',
        'semantic_scope.money requires at least one bound');
    }
    if (min !== null && max !== null && min > max) {
      fail('FIRST_LINE_ACTION_DESCRIPTOR_INVALID',
        'semantic_scope.money min must not exceed max');
    }
    money = Object.freeze({
      currency: 'UAH',
      min_price_minor: min,
      max_price_minor: max,
    });
  }

  return Object.freeze({
    product,
    category,
    brand_id: brandId,
    store_id: storeId,
    money,
  });
}

function normalizeActionDescriptor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !==
        'descriptor_version,reason,response_locale,semantic_scope,template_id') {
    fail('FIRST_LINE_ACTION_DESCRIPTOR_INVALID',
      'descriptor must contain exactly version, reason, template, locale and semantic scope');
  }
  if (value.descriptor_version !== 1) {
    fail('FIRST_LINE_ACTION_DESCRIPTOR_INVALID',
      'descriptor_version must be exactly 1');
  }
  return Object.freeze({
    descriptor_version: 1,
    reason: safeToken(value.reason, 'descriptor_reason'),
    template_id: safeToken(value.template_id, 'template_id'),
    response_locale: enumValue(
      value.response_locale,
      new Set(['uk', 'ru']),
      'response_locale'
    ),
    semantic_scope: normalizeSemanticScope(value.semantic_scope),
  });
}

function expectedScopeProvenanceKeys(descriptor) {
  const scope = descriptor.semantic_scope;
  const keys = [];
  if (scope.product !== null) {
    keys.push('product_id');
    if (scope.product.variant_id !== null) keys.push('variant_id');
  }
  if (scope.category !== null) {
    keys.push('category_id', 'category_match_mode');
  }
  if (scope.brand_id !== null) keys.push('brand_id');
  if (scope.store_id !== null) keys.push('store_id');
  if (scope.money !== null) {
    keys.push('currency');
    if (scope.money.min_price_minor !== null) keys.push('min_price_minor');
    if (scope.money.max_price_minor !== null) keys.push('max_price_minor');
  }
  return keys.sort();
}

function normalizeScopeProvenance(value, descriptor, basis) {
  const expectedKeys = expectedScopeProvenanceKeys(descriptor);
  const supplied = value ?? {};
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) {
    fail('FIRST_LINE_ACTION_DESCRIPTOR_INVALID',
      'scope provenance must be an object');
  }
  const actualKeys = Object.keys(supplied).sort();
  if (actualKeys.join(',') !== expectedKeys.join(',')) {
    fail('FIRST_LINE_ACTION_DESCRIPTOR_INVALID',
      'scope provenance keys must exactly match effective semantic scope', {
        expected_keys: expectedKeys,
        actual_keys: actualKeys,
      });
  }

  const basisSet = new Set(basis);
  const normalized = {};
  for (const key of expectedKeys) {
    const seq = positiveInteger(
      supplied[key],
      'scope_provenance_' + key
    );
    if (!basisSet.has(seq)) {
      fail('FIRST_LINE_ACTION_DESCRIPTOR_INVALID',
        'scope provenance must reference an action basis event', {
          scope_key: key,
          event_seq: seq,
        });
    }
    normalized[key] = seq;
  }

  if (descriptor.semantic_scope.category !== null &&
      normalized.category_id !== normalized.category_match_mode) {
    fail('FIRST_LINE_ACTION_DESCRIPTOR_INVALID',
      'CATEGORY id/match_mode must share one source-event provenance');
  }
  if (descriptor.semantic_scope.money !== null) {
    const boundSources = [];
    if (descriptor.semantic_scope.money.min_price_minor !== null) {
      boundSources.push(normalized.min_price_minor);
    }
    if (descriptor.semantic_scope.money.max_price_minor !== null) {
      boundSources.push(normalized.max_price_minor);
    }
    if (!boundSources.includes(normalized.currency)) {
      fail('FIRST_LINE_ACTION_DESCRIPTOR_INVALID',
        'MONEY currency provenance must be owned by an effective bound');
    }
  }

  return Object.freeze(normalized);
}

function descriptorSqlValues(streamId, descriptor, provenance) {
  const scope = descriptor.semantic_scope;
  return [
    streamId,
    descriptor.descriptor_version,
    descriptor.reason,
    descriptor.template_id,
    descriptor.response_locale,
    scope.product?.product_id ?? null,
    provenance.product_id ?? null,
    scope.product?.variant_id ?? null,
    provenance.variant_id ?? null,
    scope.category?.category_id ?? null,
    scope.category?.match_mode ?? null,
    provenance.category_id ?? null,
    scope.brand_id,
    provenance.brand_id ?? null,
    scope.store_id,
    provenance.store_id ?? null,
    scope.money?.currency ?? null,
    provenance.currency ?? null,
    scope.money?.min_price_minor ?? null,
    provenance.min_price_minor ?? null,
    scope.money?.max_price_minor ?? null,
    provenance.max_price_minor ?? null,
  ];
}

function persistedActionDescriptor(row, actionId) {
  if (!row) return null;
  return persistedGuard(() => normalizeActionDescriptor({
    descriptor_version: row.descriptor_version,
    reason: row.reason,
    template_id: row.template_id,
    response_locale: row.response_locale,
    semantic_scope: {
      product: row.product_id === null
        ? null
        : { product_id: row.product_id, variant_id: row.variant_id },
      category: row.category_id === null
        ? null
        : { category_id: row.category_id, match_mode: row.category_match_mode },
      brand_id: row.brand_id,
      store_id: row.store_id,
      money: row.money_currency === null
        ? null
        : {
            currency: row.money_currency,
            min_price_minor: row.min_price_minor,
            max_price_minor: row.max_price_minor,
          },
    },
  }), 'persisted public action descriptor is invalid', { action_id: actionId });
}

function persistedScopeProvenance(row, descriptor, basis, actionId, streamId) {
  return persistedGuard(() => {
    if (row.stream_id !== streamId) {
      fail('FIRST_LINE_VALUE_INVALID',
        'descriptor stream does not match public action stream');
    }
    const supplied = {};
    if (row.product_event_seq !== null) supplied.product_id = row.product_event_seq;
    if (row.variant_event_seq !== null) supplied.variant_id = row.variant_event_seq;
    if (row.category_event_seq !== null) {
      supplied.category_id = row.category_event_seq;
      supplied.category_match_mode = row.category_event_seq;
    }
    if (row.brand_event_seq !== null) supplied.brand_id = row.brand_event_seq;
    if (row.store_event_seq !== null) supplied.store_id = row.store_event_seq;
    if (row.money_currency_event_seq !== null) {
      supplied.currency = row.money_currency_event_seq;
    }
    if (row.min_price_event_seq !== null) {
      supplied.min_price_minor = row.min_price_event_seq;
    }
    if (row.max_price_event_seq !== null) {
      supplied.max_price_minor = row.max_price_event_seq;
    }
    return normalizeScopeProvenance(supplied, descriptor, basis);
  }, 'persisted public action scope provenance is invalid', {
    action_id: actionId,
  });
}

function validateActionStateEvidence(row, code = 'FIRST_LINE_DB_CORRUPT') {
  const pairMismatch =
    (row.confirmed_source_message_id === null) !== (row.confirmed_at === null);
  const evidenceBeforeBoundary =
    row.confirmed_source_message_id !== null && row.send_started_at === null;
  const sentStateMissingBoundary =
    ['SENDING', 'UNCERTAIN', 'CONFIRMED'].includes(row.state) &&
    row.send_started_at === null;
  const confirmedStateMissingEvidence =
    row.state === 'CONFIRMED' && row.confirmed_source_message_id === null;
  const leasePairMismatch =
    (row.lease_token === null) !== (row.lease_expires_at === null);
  const preparedClaimShapeInvalid =
    row.state === 'PREPARED' &&
    (row.lease_token !== null || row.lease_expires_at !== null || row.attempts !== 0);
  const gatingClaimShapeInvalid =
    row.state === 'GATING' &&
    (row.lease_token === null || row.lease_expires_at === null ||
     row.attempts < 1 || row.send_started_at !== null ||
     row.lease_expires_at <= row.updated_at);
  const sendingClaimShapeInvalid =
    row.state === 'SENDING' &&
    (row.lease_token === null || row.lease_expires_at === null ||
     row.attempts < 1 || row.send_started_at === null ||
     row.lease_expires_at <= row.updated_at);
  const uncertainClaimShapeInvalid =
    row.state === 'UNCERTAIN' &&
    (row.lease_token !== null || row.lease_expires_at !== null ||
     row.attempts < 1 || row.send_started_at === null);
  const unsentTerminalHasSendBoundary =
    ['STALE', 'CANCELLED', 'NOT_SENT'].includes(row.state) &&
    row.send_started_at !== null;
  if (pairMismatch || evidenceBeforeBoundary || sentStateMissingBoundary ||
      confirmedStateMissingEvidence || leasePairMismatch ||
      preparedClaimShapeInvalid || gatingClaimShapeInvalid ||
      sendingClaimShapeInvalid || uncertainClaimShapeInvalid ||
      unsentTerminalHasSendBoundary) {
    fail(code, 'public action state evidence is inconsistent', {
      action_id: row.action_id,
      state: row.state,
    });
  }
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
  #mutationLeaseToken = null;

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
      db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}`);
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
      db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=' + BUSY_TIMEOUT_MS);
      const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
      if (integrity !== 'ok') {
        fail('FIRST_LINE_DB_INVALID', 'pre-migration integrity check failed', { integrity });
      }
      const version = Number(db.prepare('PRAGMA user_version').get().user_version);
      if (version === V3_SCHEMA_VERSION) {
        return Object.freeze({ schema_version: V3_SCHEMA_VERSION });
      }
      if (version !== V2_SCHEMA_VERSION) {
        fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
          'database schema cannot be migrated by the v2-to-v3 step', {
            expected_from: V2_SCHEMA_VERSION,
            expected_to: V3_SCHEMA_VERSION,
            actual: version,
          });
      }
      const metadata = db.prepare(
        'SELECT schema_version FROM metadata WHERE singleton=1'
      ).get();
      if (Number(metadata?.schema_version) !== V2_SCHEMA_VERSION) {
        fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
          'database metadata does not match v2 migration source');
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
        const actual = db.prepare('PRAGMA table_info(' + table + ')').all().map(row => row.name);
        if (actual.length !== columns.length ||
            actual.some((name, index) => name !== columns[index])) {
          fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
            'v2 migration source schema attestation failed', {
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
            'v2 migration source required index is missing', { index: name });
        }
      }
      tx(db, () => {
        db.exec(LATCH_SCHEMA_SQL);
        db.prepare('UPDATE metadata SET schema_version=? WHERE singleton=1')
          .run(V3_SCHEMA_VERSION);
        db.exec('PRAGMA user_version=' + V3_SCHEMA_VERSION);
      });
      const after = Number(db.prepare('PRAGMA user_version').get().user_version);
      const afterMeta = Number(
        db.prepare('SELECT schema_version FROM metadata WHERE singleton=1')
          .get()?.schema_version
      );
      if (after !== V3_SCHEMA_VERSION || afterMeta !== V3_SCHEMA_VERSION) {
        fail('FIRST_LINE_DB_MIGRATION_FAILED',
          'v2-to-v3 schema version did not advance atomically', {
            user_version: after,
            metadata_version: afterMeta,
          });
      }
      return Object.freeze({ schema_version: V3_SCHEMA_VERSION });
    } finally {
      try { db.close(); } catch {}
      fs.chmodSync(resolved, 0o600);
    }
  }

  static migrateV3ToV4(file, options = {}) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) fail('FIRST_LINE_DB_MISSING', 'database is missing');
    if ((fs.statSync(resolved).mode & 0o077) !== 0) {
      fail('FIRST_LINE_DB_PERMISSIONS_UNSAFE', 'database must be mode 0600');
    }
    const db = new DatabaseSync(resolved);
    try {
      db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=' + BUSY_TIMEOUT_MS);
      const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
      if (integrity !== 'ok') {
        fail('FIRST_LINE_DB_INVALID', 'pre-migration integrity check failed', { integrity });
      }
      const foreignKeyFailures = db.prepare('PRAGMA foreign_key_check').all();
      if (foreignKeyFailures.length !== 0) {
        fail('FIRST_LINE_DB_INVALID',
          'pre-migration foreign-key check failed', {
            foreign_key_failures: foreignKeyFailures.length,
          });
      }
      const version = Number(db.prepare('PRAGMA user_version').get().user_version);
      if (version === SCHEMA_VERSION) {
        return FirstLineStateStore.open(file, options);
      }
      if (version !== V3_SCHEMA_VERSION) {
        fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
          'database schema cannot be migrated by the v3-to-v4 step', {
            expected_from: V3_SCHEMA_VERSION,
            expected_to: SCHEMA_VERSION,
            actual: version,
          });
      }
      const metadata = db.prepare(
        'SELECT schema_version FROM metadata WHERE singleton=1'
      ).get();
      if (Number(metadata?.schema_version) !== V3_SCHEMA_VERSION) {
        fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
          'database metadata does not match v3 migration source');
      }
      const sourceSchemaFingerprint = schemaMasterFingerprint(db);
      if (sourceSchemaFingerprint !== V3_SCHEMA_MASTER_SHA256) {
        fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
          'database sqlite_master does not match the frozen v3 schema', {
            expected_schema_fingerprint: V3_SCHEMA_MASTER_SHA256,
            actual_schema_fingerprint: sourceSchemaFingerprint,
          });
      }
      for (const [table, columns] of Object.entries(EXPECTED_COLUMNS_V3)) {
        const actual = db.prepare('PRAGMA table_info(' + table + ')').all().map(row => row.name);
        if (actual.length !== columns.length ||
            actual.some((name, index) => name !== columns[index])) {
          fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
            'v3 migration source schema attestation failed', {
              table, actual, expected: columns,
            });
        }
      }
      const sourceIndexes = new Set(
        db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all()
          .map(row => row.name)
      );
      for (const name of REQUIRED_INDEXES_V3) {
        if (!sourceIndexes.has(name)) {
          fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
            'v3 migration source required index is missing', { index: name });
        }
      }

      const streams = db.prepare(
        'SELECT * FROM conversation_streams ORDER BY stream_id'
      ).all();
      for (const stream of streams) {
        persistedGuard(() => {
          safeToken(stream.stream_id, 'stream_id');
          sourceProvider(stream.source_provider);
          positiveInteger(stream.source_conversation_id, 'source_conversation_id');
          nonNegativeInteger(stream.stream_revision, 'stream_revision');
          nonNegativeInteger(stream.last_event_seq, 'last_event_seq');
          if (stream.stream_revision !== stream.last_event_seq) {
            fail('FIRST_LINE_VALUE_INVALID', 'v3 stream counters diverged');
          }
          if (stream.scan_highwater !== null) {
            positiveInteger(stream.scan_highwater, 'scan_highwater');
          }
        }, 'v3 stream metadata is corrupt before migration', {
          stream_id: stream.stream_id,
        });
        const rows = db.prepare(
          'SELECT * FROM conversation_events WHERE stream_id=? ORDER BY event_seq'
        ).all(stream.stream_id);
        if (rows.length !== stream.last_event_seq) {
          fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
            'v3 stream event count does not match durable head', {
              stream_id: stream.stream_id,
              last_event_seq: stream.last_event_seq,
              event_count: rows.length,
            });
        }
        for (const [index, event] of rows.entries()) {
          if (event.event_seq !== index + 1) {
            fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
              'v3 stream event sequence is not contiguous', {
                stream_id: stream.stream_id,
                expected_event_seq: index + 1,
                actual_event_seq: event.event_seq,
              });
          }
          persistedGuard(() => {
            positiveInteger(event.source_message_id, 'source_message_id');
            enumValue(event.event_kind, EVENT_KINDS, 'event_kind');
            enumValue(event.message_type, MESSAGE_TYPES, 'message_type');
            enumValue(event.sender_class, SENDER_CLASSES, 'sender_class');
            if (event.sender_id !== null) positiveInteger(event.sender_id, 'sender_id');
            contentType(event.content_type);
            if (![0, 1].includes(event.deleted_flag) ||
                ![0, 1].includes(event.unsupported_flag) ||
                ![0, 1].includes(event.has_attachments)) {
              fail('FIRST_LINE_VALUE_INVALID', 'v3 event flags are invalid');
            }
            if (event.source_id !== null) safeToken(event.source_id, 'source_id');
            nonNegativeInteger(event.accepted_at, 'accepted_at');
            validateEventTopology({
              eventKind: event.event_kind,
              messageType: event.message_type,
              senderClass: event.sender_class,
              senderId: event.sender_id,
            });
          }, 'v3 event metadata is corrupt before migration', {
            stream_id: stream.stream_id,
            event_seq: event.event_seq,
          });
        }
      }

      const episodes = db.prepare(
        'SELECT * FROM episodes ORDER BY episode_id'
      ).all();
      for (const episode of episodes) {
        try {
          safeToken(episode.episode_id, 'episode_id');
          safeToken(episode.stream_id, 'stream_id');
          enumValue(episode.state, new Set(['active', 'closed']), 'episode_state');
          positiveInteger(episode.version, 'episode_version');
          if (![0, 1].includes(episode.clarification_prompts_sent)) {
            fail('FIRST_LINE_VALUE_INVALID', 'clarification budget is invalid');
          }
          const requested = normalizeRequestedSlot(episode.requested_slot);
          if (episode.clarification_action_id !== null) {
            safeToken(episode.clarification_action_id, 'clarification_action_id');
          }
          if (episode.state === 'active' &&
              (episode.closed_at !== null || episode.close_reason !== null)) {
            fail('FIRST_LINE_VALUE_INVALID', 'active episode has terminal metadata');
          }
          if (episode.state === 'closed' &&
              (episode.closed_at === null || episode.close_reason === null)) {
            fail('FIRST_LINE_VALUE_INVALID', 'closed episode lacks terminal metadata');
          }
          if (episode.close_reason !== null) {
            enumValue(episode.close_reason, new Set([
              'completed', 'replaced', 'human_takeover', 'ownership_lost',
              'non_actionable_ack', 'superseded', 'expired',
            ]), 'close_reason');
          }
          if (episode.clarification_prompts_sent === 0 &&
              (requested !== null || episode.clarification_action_id !== null)) {
            fail('FIRST_LINE_VALUE_INVALID', 'unused clarification budget has reservation');
          }
          if (episode.clarification_action_id === null && requested !== null) {
            fail('FIRST_LINE_VALUE_INVALID', 'requested slot lacks clarification action');
          }
          const clarificationRows = db.prepare(
            "SELECT action_id,state FROM public_actions WHERE episode_id=? AND action_type='CLARIFY'"
          ).all(episode.episode_id);
          if (episode.clarification_prompts_sent === 1 && clarificationRows.length === 0) {
            fail('FIRST_LINE_VALUE_INVALID', 'consumed clarification budget lacks action history');
          }
          if (episode.clarification_prompts_sent === 0 && clarificationRows.some(row =>
              !['STALE', 'CANCELLED'].includes(row.state))) {
            fail('FIRST_LINE_VALUE_INVALID',
              'v3 clarification budget was reset after a consuming action state');
          }
          if (episode.clarification_action_id !== null) {
            const linked = db.prepare(
              'SELECT stream_id,episode_id,action_type,requested_slot FROM public_actions WHERE action_id=?'
            ).get(episode.clarification_action_id) ?? null;
            if (!linked || linked.stream_id !== episode.stream_id ||
                linked.episode_id !== episode.episode_id || linked.action_type !== 'CLARIFY' ||
                (linked.requested_slot ?? null) !== (requested ?? null)) {
              fail('FIRST_LINE_VALUE_INVALID', 'clarification binding is invalid');
            }
          }
        } catch (error) {
          if (error instanceof FirstLineStateError) {
            fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
              'v3 episode metadata is corrupt before migration', {
                episode_id: episode.episode_id,
                cause: error.code,
              });
          }
          throw error;
        }

        const slots = db.prepare(
          'SELECT * FROM episode_slots WHERE episode_id=? ORDER BY slot_name'
        ).all(episode.episode_id);
        const byName = new Map();
        for (const slot of slots) {
          let value;
          try {
            value = parseJson(slot.value_json);
            normalizeSlotValue(slot.slot_name, value);
            if (slot.derived_through_event_seq !== null) {
              positiveInteger(slot.derived_through_event_seq, 'derived_through_event_seq');
              const event = db.prepare(
                'SELECT 1 AS ok FROM conversation_events WHERE stream_id=? AND event_seq=?'
              ).get(episode.stream_id, slot.derived_through_event_seq);
              if (!event) fail('FIRST_LINE_VALUE_INVALID', 'slot provenance is outside episode stream');
            }
          } catch (error) {
            if (error instanceof FirstLineStateError) {
              fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
                'v3 episode slot is corrupt before migration', {
                  episode_id: episode.episode_id,
                  slot_name: slot.slot_name,
                  cause: error.code,
                });
            }
            throw error;
          }
          byName.set(slot.slot_name, slot);
        }
        const category = byName.get('category_id') ?? null;
        const categoryMode = byName.get('category_match_mode') ?? null;
        if ((category === null) !== (categoryMode === null) ||
            (category && category.derived_through_event_seq !== categoryMode.derived_through_event_seq)) {
          fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
            'v3 CATEGORY stable provenance is incomplete/split', {
              episode_id: episode.episode_id,
            });
        }

        const latches = db.prepare(
          'SELECT * FROM episode_constraint_latches WHERE episode_id=?'
        ).all(episode.episode_id);
        for (const latch of latches) {
          if (!CONSTRAINT_LATCH_CLASSES.has(latch.latch_class) ||
              !Number.isSafeInteger(latch.first_event_seq) || latch.first_event_seq < 1 ||
              !db.prepare(
                'SELECT 1 AS ok FROM conversation_events WHERE stream_id=? AND event_seq=?'
              ).get(episode.stream_id, latch.first_event_seq)) {
            fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
              'v3 constraint latch provenance is corrupt before migration', {
                episode_id: episode.episode_id,
                latch_class: latch.latch_class,
              });
          }
        }
      }

      const actions = db.prepare(
        'SELECT * FROM public_actions ORDER BY created_at,action_id'
      ).all().map(row => {
        const basis = persistedGuard(
          () => normalizeBasisEventSeqs(parseJson(row.basis_event_seqs_json)),
          'v3 action basis is corrupt before migration',
          { action_id: row.action_id }
        );
        validateActionStateEvidence(row, 'FIRST_LINE_DB_MIGRATION_UNSUPPORTED');
        if (row.episode_id === null || row.episode_version === null) {
          fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
            'v3 customer-visible action lacks required episode provenance', {
              action_id: row.action_id,
            });
        }
        const actionStream = db.prepare(
          'SELECT stream_revision FROM conversation_streams WHERE stream_id=?'
        ).get(row.stream_id) ?? null;
        if (!actionStream || row.prepared_stream_revision > actionStream.stream_revision) {
          fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
            'v3 action revision is outside its stream history', {
              action_id: row.action_id,
              prepared_stream_revision: row.prepared_stream_revision,
              stream_revision: actionStream?.stream_revision ?? null,
            });
        }
        for (const eventSeq of basis) {
          if (eventSeq > row.prepared_stream_revision) {
            fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
              'v3 action basis contains event newer than prepared revision', {
                action_id: row.action_id,
                event_seq: eventSeq,
                prepared_stream_revision: row.prepared_stream_revision,
              });
          }
          const event = db.prepare(
            'SELECT 1 AS ok FROM conversation_events WHERE stream_id=? AND event_seq=?'
          ).get(row.stream_id, eventSeq);
          if (!event) {
            fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
              'v3 action basis references missing/cross-stream event', {
                action_id: row.action_id,
                stream_id: row.stream_id,
                event_seq: eventSeq,
              });
          }
        }
        if (row.episode_id !== null) {
          const episode = db.prepare(
            'SELECT stream_id,state,version,clarification_prompts_sent,requested_slot,clarification_action_id ' +
            'FROM episodes WHERE episode_id=?'
          ).get(row.episode_id);
          if (!episode || episode.stream_id !== row.stream_id ||
              !Number.isSafeInteger(row.episode_version) || row.episode_version < 1 ||
              !Number.isSafeInteger(episode.version) || episode.version < row.episode_version) {
            fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
              'v3 action episode provenance is invalid', { action_id: row.action_id });
          }
          if (LIVE_ACTION_STATES.has(row.state) && episode.state !== 'active') {
            fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
              'live v3 action is bound to a closed episode', {
                action_id: row.action_id,
                episode_id: row.episode_id,
              });
          }
          if (LIVE_ACTION_STATES.has(row.state) && row.action_type === 'CLARIFY' &&
              (episode.state !== 'active' || episode.clarification_prompts_sent !== 1 ||
               episode.clarification_action_id !== row.action_id ||
               (episode.requested_slot ?? null) !== (row.requested_slot ?? null))) {
            fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
              'live v3 CLARIFY reservation is not owned by its episode', {
                action_id: row.action_id, episode_id: row.episode_id,
              });
          }
        }
        const sourceMatches = db.prepare(
          'SELECT source_message_id,event_kind,event_seq FROM conversation_events ' +
          'WHERE stream_id=? AND source_id=? ORDER BY event_seq'
        ).all(row.stream_id, row.action_id);
        if (sourceMatches.length > 1) {
          fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
            'v3 action source identity is ambiguous', {
              action_id: row.action_id,
              count: sourceMatches.length,
            });
        }
        if (row.confirmed_source_message_id !== null &&
            (sourceMatches.length !== 1 ||
             sourceMatches[0].event_kind !== 'BABYPARK_PUBLIC_REPLY' ||
             sourceMatches[0].source_message_id !== row.confirmed_source_message_id ||
             sourceMatches[0].event_seq <= row.prepared_stream_revision)) {
          fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
            'v3 confirmation provenance is inconsistent', {
              action_id: row.action_id,
            });
        }
        const candidateRows = db.prepare(
          'SELECT * FROM public_action_candidates WHERE action_id=? ORDER BY ordinal'
        ).all(row.action_id);
        const candidateSet = validateCandidateRows(candidateRows, row.action_id);
        if (row.action_type === 'ANSWER' &&
            (row.requested_slot !== null || candidateRows.length !== 0)) {
          fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
            'v3 ANSWER carries clarification reservation metadata', { action_id: row.action_id });
        }
        if (row.action_type === 'CLARIFY') {
          if (row.requested_slot === null && candidateRows.length === 0) {
            fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
              'v3 CLARIFY has no requested slot or candidates', { action_id: row.action_id });
          }
          if (row.requested_slot !== null && candidateSet.candidate_slot !== null &&
              candidateSet.candidate_slot !== row.requested_slot) {
            fail('FIRST_LINE_DB_MIGRATION_UNSUPPORTED',
              'v3 CLARIFY candidate slot conflicts with requested slot', { action_id: row.action_id });
          }
        }
        return {
          row,
          basis,
          candidate_count: candidateRows.length,
          candidate_slot: candidateSet.candidate_slot,
        };
      });

      tx(db, () => {
        db.exec(V4_ADDITIONS_SCHEMA_SQL);
        for (const { row, basis, candidate_count, candidate_slot } of actions) {
          db.prepare(
            'INSERT INTO public_action_candidate_sets(action_id,candidate_count,candidate_slot) ' +
            'VALUES (?,?,?)'
          ).run(row.action_id, candidate_count, candidate_slot);
          for (const [index, eventSeq] of basis.entries()) {
            db.prepare(
              'INSERT INTO public_action_source_events ' +
              '(action_id,ordinal,stream_id,event_seq) VALUES (?,?,?,?)'
            ).run(row.action_id, index + 1, row.stream_id, eventSeq);
          }
          db.prepare(
            "INSERT INTO legacy_v3_actions(action_id,marker) " +
            "VALUES (?,'DESCRIPTOR_UNAVAILABLE')"
          ).run(row.action_id);
          db.prepare(
            "INSERT INTO semantic_origins " +
            "(stream_id,stream_revision,origin_kind,action_id,created_at) " +
            "VALUES (?,?,'PUBLIC_ACTION',?,?)"
          ).run(
            row.stream_id,
            row.prepared_stream_revision,
            row.action_id,
            row.created_at
          );

          const live = LIVE_ACTION_STATES.has(row.state);
          const ownerKind = live ? 'HUMAN' : 'PUBLIC_ACTION';
          const humanReason = live ? 'migration_v3_descriptor_missing' : null;
          let ownerEpisodeVersion = row.episode_version;
          if (live && row.episode_id !== null) {
            const currentEpisode = db.prepare(
              'SELECT stream_id,state,version FROM episodes WHERE episode_id=?'
            ).get(row.episode_id);
            if (currentEpisode?.state === 'active' &&
                currentEpisode.stream_id === row.stream_id &&
                currentEpisode.version >= row.episode_version) {
              ownerEpisodeVersion = currentEpisode.version;
            }
          }
          let terminalOutcome = null;
          let terminalAt = null;
          if (!live) {
            terminalOutcome = row.state === 'CONFIRMED'
              ? 'CONFIRMED'
              : 'LEGACY_V3_TERMINAL';
            terminalAt = row.state === 'CONFIRMED'
              ? (row.confirmed_at ?? row.updated_at)
              : row.updated_at;
          }
          db.prepare(
            'INSERT INTO continuation_owners ' +
            '(stream_id,stream_revision,owner_kind,action_id,episode_id,episode_version,' +
            'human_reason,terminal_outcome,created_at,updated_at,terminal_at) ' +
            'VALUES (?,?,?,?,?,?,?,?,?,?,?)'
          ).run(
            row.stream_id,
            row.prepared_stream_revision,
            ownerKind,
            row.action_id,
            row.episode_id,
            ownerEpisodeVersion,
            humanReason,
            terminalOutcome,
            row.created_at,
            row.updated_at,
            terminalAt
          );
        }
        db.prepare('UPDATE metadata SET schema_version=? WHERE singleton=1')
          .run(SCHEMA_VERSION);
        db.exec('PRAGMA user_version=' + SCHEMA_VERSION);
      });

      const after = Number(db.prepare('PRAGMA user_version').get().user_version);
      const afterMeta = Number(
        db.prepare('SELECT schema_version FROM metadata WHERE singleton=1')
          .get()?.schema_version
      );
      if (after !== SCHEMA_VERSION || afterMeta !== SCHEMA_VERSION) {
        fail('FIRST_LINE_DB_MIGRATION_FAILED',
          'v3-to-v4 schema version did not advance atomically', {
            user_version: after,
            metadata_version: afterMeta,
          });
      }
    } finally {
      try { db.close(); } catch {}
      fs.chmodSync(resolved, 0o600);
    }
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
    this.db.function('bp_now_ms', () => {
      const value = this.now();
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError('FirstLineStateStore now() must return a non-negative safe integer');
      }
      return value;
    });
    this.db.function('bp_mutation_lease_token', () => this.#mutationLeaseToken);
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
      const existing = this.db.prepare(
        'SELECT * FROM conversation_events WHERE stream_id=? AND source_message_id=?'
      ).get(id, normalized.sourceMessageId);
      if (existing) {
        this.#assertDeferredRelationsValid(id);
        const deferredParent = this.#readDeferredParent(id, existing.event_seq);
        return {
          inserted: false,
          event: this.#eventDto(existing),
          stream: this.#readStream(id),
          deferred_parent: deferredParent,
        };
      }
      this.#assertAutonomousAllowed();
      this.#assertDeferredRelationsValid(id);

      let deferredAction = null;
      if (normalized.eventKind === 'CUSTOMER_MESSAGE') {
        const owner = this.#readUnresolvedOwner(id);
        if (!owner || owner.owner_kind !== 'HUMAN') {
          const sending = this.db.prepare(
            "SELECT action_id,prepared_stream_revision,state FROM public_actions " +
            "WHERE stream_id=? AND state IN ('SENDING','UNCERTAIN')"
          ).all(id);
          if (sending.length > 1) {
            fail('FIRST_LINE_DB_CORRUPT',
              'multiple same-stream SENDING/UNCERTAIN actions exist', { stream_id: id });
          }
          if (sending.length === 1) {
            const action = sending[0];
            if (!owner ||
                owner.owner_kind !== 'PUBLIC_ACTION' ||
                owner.action_id !== action.action_id ||
                owner.stream_revision !== action.prepared_stream_revision) {
              fail('FIRST_LINE_DB_CORRUPT',
                'SENDING/UNCERTAIN action lacks matching continuation owner', {
                  stream_id: id,
                  action_id: action.action_id,
                });
            }
            deferredAction = action;
          }
        }
      }

      const seq = stream.last_event_seq + 1;
      this.db.prepare(
        'INSERT INTO conversation_events ' +
        '(stream_id,event_seq,source_message_id,event_kind,message_type,sender_class,sender_id,content_type,' +
        'deleted_flag,unsupported_flag,has_attachments,source_id,accepted_at) ' +
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
      ).run(
        id, seq, normalized.sourceMessageId, normalized.eventKind, normalized.messageType,
        normalized.senderClass, normalized.senderId, normalized.contentType, normalized.deleted,
        normalized.unsupported, normalized.hasAttachments, normalized.sourceId, at
      );
      const advancedStream = this.#readStream(id);
      if (!advancedStream || advancedStream.last_event_seq !== seq ||
          advancedStream.stream_revision !== stream.stream_revision + 1) {
        fail('FIRST_LINE_DB_CORRUPT',
          'event append did not atomically advance stream revision', {
            stream_id: id,
            event_seq: seq,
          });
      }

      const deferredParent = this.#readDeferredParent(id, seq);
      if ((deferredAction === null) !== (deferredParent === null) ||
          (deferredAction !== null && deferredParent.action_id !== deferredAction.action_id)) {
        fail('FIRST_LINE_DB_CORRUPT',
          'deferred-parent trigger result differs from accepting transaction', {
            stream_id: id,
            event_seq: seq,
            expected_action_id: deferredAction?.action_id ?? null,
            actual_action_id: deferredParent?.action_id ?? null,
          });
      }

      return {
        inserted: true,
        event: this.#eventDto(
          this.db.prepare(
            'SELECT * FROM conversation_events WHERE stream_id=? AND event_seq=?'
          ).get(id, seq)
        ),
        stream: this.#readStream(id),
        deferred_parent: deferredParent,
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
      this.#assertAutonomousAllowed();
      this.#assertNoHumanContinuation(id);
      const currentOrigin = stream.stream_revision > 0
        ? this.#readSemanticOrigin(id, stream.stream_revision)
        : null;
      if (currentOrigin && currentOrigin.origin_kind !== 'PUBLIC_ACTION') {
        fail('FIRST_LINE_SEMANTIC_ORIGIN_CONFLICT',
          'current stream revision already has an absorbing non-action origin', {
            stream_id: id,
            stream_revision: stream.stream_revision,
            origin_kind: currentOrigin.origin_kind,
          });
      }
      this.#assertDeferredRelationsValid(id);

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
        if (clarificationAction.descriptor === null) {
          fail('FIRST_LINE_ACTION_DESCRIPTOR_MISSING',
            'legacy clarification cannot authorize autonomous continuation', {
              action_id: clarificationAction.action_id,
              episode_id: activeEpisode.episode_id,
            });
        }
      }

      let confirmedClarificationAction = null;
      if (activeEpisode) {
        const rows = this.db.prepare(
          "SELECT action_id FROM public_actions WHERE stream_id=? AND episode_id=? " +
          "AND action_type='CLARIFY' AND state='CONFIRMED' ORDER BY created_at,action_id"
        ).all(id, activeEpisode.episode_id);
        if (rows.length > 1) {
          fail('FIRST_LINE_DB_CORRUPT',
            'active episode has multiple confirmed clarification actions', {
              stream_id: id,
              episode_id: activeEpisode.episode_id,
              count: rows.length,
            });
        }
        if (rows.length === 1) {
          confirmedClarificationAction = this.#readAction(rows[0].action_id);
          if (confirmedClarificationAction?.descriptor === null) {
            fail('FIRST_LINE_ACTION_DESCRIPTOR_MISSING',
              'legacy confirmed clarification cannot authorize autonomous continuation', {
                action_id: confirmedClarificationAction.action_id,
                episode_id: activeEpisode.episode_id,
              });
          }
        }
      }

      const snapshot = deepFreezeRoutingValue({
        schema: ROUTING_SNAPSHOT_SCHEMA,
        stream,
        active_episode: activeEpisode,
        live_public_action: livePublicAction,
        clarification_action: clarificationAction,
        confirmed_clarification_action: confirmedClarificationAction,
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
      const action = this.#requireReadableAction(id);
      this.#assertDeferredRelationsValid(action.stream_id);
      if (action.state === 'CONFIRMED') {
        return this.#readAction(id);
      }
      if (!['SENDING', 'UNCERTAIN', 'HANDOFF_DONE', 'CANCELLED', 'STALE']
        .includes(action.state)) {
        fail('FIRST_LINE_ACTION_STATE_INVALID',
          'action state cannot accept authoritative send evidence', {
            action_id: id,
            state: action.state,
          });
      }
      const rows = this.db.prepare(
        'SELECT * FROM conversation_events WHERE stream_id=? AND source_id=? ORDER BY event_seq'
      ).all(action.stream_id, id);
      if (rows.length === 0) return null;
      if (rows.length !== 1) {
        fail('FIRST_LINE_SOURCE_ID_AMBIGUOUS',
          'multiple ledger events share action source id', {
            action_id: id,
            count: rows.length,
          });
      }
      const event = this.#eventDto(rows[0]);
      if (event.event_kind !== 'BABYPARK_PUBLIC_REPLY') {
        fail('FIRST_LINE_ACTION_CONFIRMATION_INVALID',
          'action source id is attached to non-BabyPark event', {
            action_id: id,
            event_kind: event.event_kind,
          });
      }
      if (event.event_seq <= action.prepared_stream_revision) {
        fail('FIRST_LINE_ACTION_CONFIRMATION_INVALID',
          'action source event predates its prepared revision', {
            action_id: id,
            source_event_seq: event.event_seq,
            prepared_stream_revision: action.prepared_stream_revision,
          });
      }
      const origin = this.#readSemanticOrigin(
        action.stream_id,
        action.prepared_stream_revision
      );
      const owner = this.#readContinuationOwner(
        action.stream_id,
        action.prepared_stream_revision
      );
      if (!origin || origin.origin_kind !== 'PUBLIC_ACTION' ||
          origin.action_id !== id || !owner || owner.action_id !== id) {
        fail('FIRST_LINE_DB_CORRUPT',
          'public action confirmation lacks immutable origin/owner', {
            action_id: id,
          });
      }
      if (!Number.isSafeInteger(action.send_started_at)) {
        fail('FIRST_LINE_ACTION_CONFIRMATION_INVALID',
          'send evidence requires prior SENDING state', { action_id: id });
      }
      if (owner.owner_kind === 'PUBLIC_ACTION' &&
          !['SENDING', 'UNCERTAIN'].includes(action.state)) {
        fail('FIRST_LINE_ACTION_STATE_INVALID',
          'only unresolved SENDING/UNCERTAIN public owner may normally confirm', {
            action_id: id,
            state: action.state,
          });
      }

      const at = this.now();
      if (owner.owner_kind === 'HUMAN') {
        this.db.prepare(
          'UPDATE public_actions SET confirmed_source_message_id=?,confirmed_at=?,' +
          'updated_at=? WHERE action_id=?'
        ).run(event.source_message_id, at, at, id);
        return this.#readAction(id);
      }
      if (owner.terminal_outcome !== null) {
        fail('FIRST_LINE_ACTION_STATE_INVALID',
          'terminal continuation cannot be confirmed again', {
            action_id: id,
            terminal_outcome: owner.terminal_outcome,
          });
      }

      const confirmationStream = this.#readStream(action.stream_id);
      if (!confirmationStream) {
        fail('FIRST_LINE_DB_CORRUPT',
          'confirmation stream disappeared before durable cut', { action_id: id });
      }
      this.db.prepare(
        'INSERT INTO public_action_confirmation_cuts ' +
        '(action_id,stream_id,confirmed_through_event_seq,created_at) VALUES (?,?,?,?)'
      ).run(id, action.stream_id, confirmationStream.last_event_seq, at);

      const actionChanged = this.db.prepare(
        "UPDATE public_actions SET state='CONFIRMED',confirmed_source_message_id=?," +
        'confirmed_at=?,lease_token=NULL,lease_expires_at=NULL,updated_at=? ' +
        "WHERE action_id=? AND state IN ('SENDING','UNCERTAIN')"
      ).run(event.source_message_id, at, at, id).changes;
      if (actionChanged !== 1) {
        fail('FIRST_LINE_STALE_WRITE',
          'public action changed before confirmation', { action_id: id });
      }
      const ownerChanged = this.db.prepare(
        "UPDATE continuation_owners SET terminal_outcome='CONFIRMED'," +
        'terminal_at=?,updated_at=? WHERE stream_id=? AND stream_revision=? ' +
        "AND owner_kind='PUBLIC_ACTION' AND action_id=? AND terminal_outcome IS NULL"
      ).run(
        at,
        at,
        action.stream_id,
        action.prepared_stream_revision,
        id
      ).changes;
      if (ownerChanged !== 1) {
        fail('FIRST_LINE_STALE_WRITE',
          'continuation owner changed before confirmation', {
            action_id: id,
          });
      }
      return this.#readAction(id);
    });
  }

  beginEpisode({ streamId }) {
    const stream = safeToken(streamId, 'stream_id');
    const at = this.now();
    return tx(this.db, () => {
      const currentStream = this.#requireStream(stream);
      this.#assertAutonomousAllowed();
      this.#assertNoHumanContinuation(stream);
      this.#assertDeferredRelationsValid(stream);
      if (currentStream.stream_revision > 0 &&
          this.#readSemanticOrigin(stream, currentStream.stream_revision)) {
        fail('FIRST_LINE_SEMANTIC_ORIGIN_CONFLICT',
          'current stream revision already has an immutable semantic outcome', {
            stream_id: stream,
            stream_revision: currentStream.stream_revision,
          });
      }
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
    const touchesCategory =
      Object.hasOwn(patch, 'category_id') || Object.hasOwn(patch, 'category_match_mode');
    if (touchesCategory) {
      if (!Object.hasOwn(patch, 'category_id') || !Object.hasOwn(patch, 'category_match_mode')) {
        fail('FIRST_LINE_SLOT_PATCH_INVALID',
          'CATEGORY stable selection must update category_id and category_match_mode atomically');
      }
      const deleting = patch.category_id == null && patch.category_match_mode == null;
      const setting = patch.category_id != null && patch.category_match_mode != null;
      if (!deleting && !setting) {
        fail('FIRST_LINE_SLOT_PATCH_INVALID',
          'CATEGORY stable selection cannot persist a partial pair');
      }
    }
    const normalized = Object.entries(patch).map(([name, value]) => [name, value == null ? null : normalizeSlotValue(name, value)]);
    return tx(this.db, () => {
      const episode = this.#requireActiveEpisode(id, version);
      this.#assertAutonomousAllowed();
      this.#assertNoHumanContinuation(episode.stream_id);
      this.#assertDeferredRelationsValid(episode.stream_id);
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
      const episode = this.#requireActiveEpisode(id, version);
      this.#assertAutonomousAllowed();
      this.#assertNoHumanContinuation(episode.stream_id);
      const stream = this.#requireStream(episode.stream_id);
      if (stream.stream_revision > 0) {
        fail('FIRST_LINE_EPISODE_CLOSE_PROTOCOL_REQUIRED',
          'accepted customer work may close only through v0.8 owning-store protocols', {
            episode_id: id,
            stream_id: episode.stream_id,
            stream_revision: stream.stream_revision,
            requested_close_reason: closeReason,
          });
      }
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
      this.#assertAutonomousAllowed();
      this.#assertNoHumanContinuation(stream);
      this.#assertDeferredRelationsValid(stream);
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
      this.#assertAutonomousAllowed();
      this.#assertNoHumanContinuation(stream);
      this.#assertDeferredRelationsValid(stream);
      const committedOrigin = this.#readSemanticOrigin(stream, revision);
      if (committedOrigin) {
        fail('FIRST_LINE_SEMANTIC_ORIGIN_CONFLICT',
          'standalone transition cannot replace an immutable same-revision origin', {
            stream_id: stream,
            stream_revision: revision,
            origin_kind: committedOrigin.origin_kind,
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
        this.#supersedeUnsentAction(
          liveAction,
          'standalone_episode_replaced',
          'STALE',
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
    const categorySelection = slot === 'category_id'
      ? normalizeCategorySelection(selectionValue)
      : null;
    const moneySelection = slot === 'max_price_minor'
      ? normalizeRequestedMoneySelection(selectionValue)
      : null;
    const value = categorySelection ?? (
      moneySelection === null
        ? normalizeSlotValue(slot, selectionValue)
        : moneySelection
    );
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
      this.#assertAutonomousAllowed();
      this.#assertNoHumanContinuation(stream);
      this.#assertDeferredRelationsValid(stream);
      const committedOrigin = this.#readSemanticOrigin(stream, revision);
      if (committedOrigin) {
        fail('FIRST_LINE_SEMANTIC_ORIGIN_CONFLICT',
          'selection revision already has an immutable semantic origin', {
            stream_id: stream,
            stream_revision: revision,
            origin_kind: committedOrigin.origin_kind,
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
      if (categorySelection !== null) {
        for (const [categorySlot, categoryValue] of [
          ['category_id', categorySelection.category_id],
          ['category_match_mode', categorySelection.match_mode],
        ]) {
          this.db.prepare(`INSERT INTO episode_slots(episode_id,slot_name,value_json,derived_through_event_seq)
            VALUES (?,?,?,?) ON CONFLICT(episode_id,slot_name) DO UPDATE SET
            value_json=excluded.value_json,derived_through_event_seq=excluded.derived_through_event_seq`)
            .run(episodeId, categorySlot, canonicalJson(categoryValue), sourceEvent.event_seq);
        }
      } else if (moneySelection !== null) {
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
    descriptor, scopeProvenance = {},
  }) {
    const stream = safeToken(streamId, 'stream_id');
    const revision = positiveInteger(preparedStreamRevision, 'prepared_stream_revision');
    const type = enumValue(actionType, ACTION_TYPES, 'action_type');
    const basis = normalizeBasisEventSeqs(basisEventSeqs);
    const requested = normalizeRequestedSlot(requestedSlot);
    const deadline = positiveInteger(deadlineAt, 'deadline_at');
    const normalizedDescriptor = normalizeActionDescriptor(descriptor);
    const normalizedScopeProvenance = normalizeScopeProvenance(
      scopeProvenance,
      normalizedDescriptor,
      basis
    );
    if (!Array.isArray(presentedCandidates) ||
        presentedCandidates.length > MAX_PRESENTED_CANDIDATES) {
      fail('FIRST_LINE_CANDIDATE_LIMIT_EXCEEDED',
        'candidate list exceeds bound', { limit: MAX_PRESENTED_CANDIDATES });
    }
    const candidates = presentedCandidates.map(normalizeCandidate);
    const candidateSlots = new Set(candidates.map(candidate => candidate.slot));
    if (candidateSlots.size > 1) {
      fail('FIRST_LINE_CLARIFICATION_INVALID',
        'presented candidates must reserve exactly one slot kind');
    }
    const candidateSlot = candidates.length === 0 ? null : candidates[0].slot;
    if (type === 'ANSWER' && (requested !== null || candidates.length !== 0)) {
      fail('FIRST_LINE_ACTION_DESCRIPTOR_INVALID',
        'ANSWER cannot carry clarification reservation metadata');
    }
    if (type === 'CLARIFY' && requested == null && candidates.length === 0) {
      fail('FIRST_LINE_CLARIFICATION_INVALID',
        'CLARIFY requires requested slot or candidates');
    }
    if (type === 'CLARIFY' && requested === 'money') {
      fail('FIRST_LINE_CLARIFICATION_INVALID',
        'generic money clarification is legacy-only; v4 requires max_price_minor');
    }
    if (type === 'CLARIFY' && requested !== null && candidates.length > 0 &&
        candidates.some(candidate => candidate.slot !== requested)) {
      fail('FIRST_LINE_CLARIFICATION_INVALID',
        'CLARIFY candidates must resolve the reserved requested slot', {
          requested_slot: requested,
        });
    }
    if (episodeId == null || expectedEpisodeVersion == null) {
      fail('FIRST_LINE_ACTION_EPISODE_REQUIRED',
        'every v4 customer-visible public action requires episode identity/version');
    }
    const epId = safeToken(episodeId, 'episode_id');
    const epVersion = positiveInteger(expectedEpisodeVersion, 'expected_episode_version');
    const at = this.now();

    return tx(this.db, () => {
      const currentStream = this.#requireStream(stream);
      this.#assertDeferredRelationsValid(stream);

      const sameRevision = this.db.prepare(
        'SELECT action_id FROM public_actions WHERE stream_id=? AND prepared_stream_revision=?'
      ).get(stream, revision);
      if (sameRevision) {
        const origin = this.#readSemanticOrigin(stream, revision);
        if (!origin || origin.origin_kind !== 'PUBLIC_ACTION' ||
            origin.action_id !== sameRevision.action_id) {
          fail('FIRST_LINE_DB_CORRUPT',
            'same-revision action lacks immutable PUBLIC_ACTION origin', {
              stream_id: stream,
              stream_revision: revision,
            });
        }
        const existing = this.#readAction(sameRevision.action_id);
        if (!existing.descriptor) {
          fail('FIRST_LINE_ACTION_DESCRIPTOR_MISSING',
            'legacy action has no v4 descriptor and cannot be replayed autonomously', {
              action_id: existing.action_id,
            });
        }
        if (existing.action_type !== type ||
            existing.episode_id !== epId ||
            existing.episode_version !== epVersion ||
            canonicalJson(existing.basis_event_seqs) !== canonicalJson(basis) ||
            (existing.requested_slot ?? null) !== requested ||
            canonicalJson(existing.presented_candidates) !== canonicalJson(candidates) ||
            canonicalJson(existing.descriptor) !== canonicalJson(normalizedDescriptor) ||
            canonicalJson(existing.scope_provenance) !== canonicalJson(normalizedScopeProvenance)) {
          fail('FIRST_LINE_ACTION_REPLAY_CONFLICT',
            'same-revision retry does not match immutable action semantics', {
              action_id: existing.action_id,
              stream_revision: revision,
            });
        }
        return existing;
      }

      const existingOrigin = this.#readSemanticOrigin(stream, revision);
      if (existingOrigin) {
        fail('FIRST_LINE_SEMANTIC_ORIGIN_CONFLICT',
          'stream revision already has an immutable non-action semantic origin', {
            stream_id: stream,
            stream_revision: revision,
            origin_kind: existingOrigin.origin_kind,
          });
      }

      this.#assertAutonomousAllowed();
      if (currentStream.stream_revision !== revision) {
        fail('FIRST_LINE_ACTION_STALE_REVISION',
          'prepared revision is not current', {
            prepared_stream_revision: revision,
            current_stream_revision: currentStream.stream_revision,
          });
      }

      const unresolvedOwner = this.#assertNoHumanContinuation(stream);

      for (const seq of basis) {
        const event = this.db.prepare(
          'SELECT 1 AS ok FROM conversation_events WHERE stream_id=? AND event_seq=?'
        ).get(stream, seq);
        if (!event) {
          fail('FIRST_LINE_ACTION_BASIS_INVALID',
            'action basis references an unknown stream event', {
              stream_id: stream,
              event_seq: seq,
            });
        }
      }

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
          fail('FIRST_LINE_ACTION_EPISODE_STREAM_MISMATCH',
            'episode does not belong to action stream', {
              episode_id: epId,
              stream_id: stream,
              episode_stream_id: episode.stream_id,
            });
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

      const liveHead = this.db.prepare(
        "SELECT action_id FROM public_actions WHERE stream_id=? " +
        "AND state IN ('PREPARED','GATING','SENDING','UNCERTAIN')"
      ).get(stream) ?? null;
      const live = liveHead ? this.#requireReadableAction(liveHead.action_id) : null;
      if (live && (live.state === 'SENDING' || live.state === 'UNCERTAIN')) {
        fail('FIRST_LINE_ACTION_SEND_UNRESOLVED',
          'existing send must be reconciled before another action', {
            action_id: live.action_id,
            state: live.state,
          });
      }
      if (live && (!unresolvedOwner ||
          unresolvedOwner.owner_kind !== 'PUBLIC_ACTION' ||
          unresolvedOwner.action_id !== live.action_id ||
          unresolvedOwner.stream_revision !== live.prepared_stream_revision)) {
        fail('FIRST_LINE_DB_CORRUPT',
          'live public action lacks matching continuation owner', {
            action_id: live.action_id,
            stream_id: stream,
          });
      }

      const replacingClarification =
        Boolean(live && episode && live.action_type === 'CLARIFY' &&
          live.episode_id === epId);
      if (replacingClarification &&
          (episode.clarification_prompts_sent !== 1 ||
           episode.clarification_action_id !== live.action_id)) {
        fail('FIRST_LINE_ACTION_STALE_EPISODE',
          'live clarification no longer owns its episode reservation', {
            action_id: live.action_id,
            episode_id: epId,
          });
      }

      if (type === 'CLARIFY') {
        if (!episode) {
          fail('FIRST_LINE_CLARIFICATION_INVALID',
            'CLARIFY requires active episode');
        }
        const reservationFree =
          episode.clarification_prompts_sent === 0 &&
          episode.clarification_action_id === null;
        if (!reservationFree && !replacingClarification) {
          fail('FIRST_LINE_CLARIFICATION_LIMIT_REACHED',
            'clarification already reserved/sent');
        }
      }

      if (live) {
        this.#supersedeUnsentAction(live, 'newer_stream_revision');
        if (episode && replacingClarification) {
          episode = this.#requireActiveEpisode(epId, epVersion + 1);
        }
      } else if (unresolvedOwner) {
        fail('FIRST_LINE_DB_CORRUPT',
          'unresolved PUBLIC_ACTION owner has no live action', {
            stream_id: stream,
            owner_revision: unresolvedOwner.stream_revision,
          });
      }

      if (type === 'CLARIFY' &&
          (episode.clarification_prompts_sent !== 0 ||
           episode.clarification_action_id !== null)) {
        fail('FIRST_LINE_CLARIFICATION_LIMIT_REACHED',
          'clarification reservation was not safely released');
      }

      const actionId = safeToken(this.actionIdFactory(), 'action_id');
      const actionIdCollision = this.db.prepare(
        'SELECT 1 AS collision FROM public_actions WHERE action_id=? ' +
        'UNION ALL SELECT 1 AS collision FROM conversation_events WHERE source_id=? LIMIT 1'
      ).get(actionId, actionId);
      if (actionIdCollision) {
        fail('FIRST_LINE_ACTION_ID_COLLISION',
          'new public action id already exists in durable action/source identity space', {
            action_id: actionId,
          });
      }
      const actionEpisodeVersion = episode === null
        ? null
        : (type === 'CLARIFY' ? episode.version + 1 : episode.version);

      this.db.prepare(
        "INSERT INTO public_actions " +
        "(action_id,stream_id,episode_id,episode_version,prepared_stream_revision,action_type,state," +
        "basis_event_seqs_json,requested_slot,deadline_at,created_at,updated_at) " +
        "VALUES (?,?,?,?,?,?,'PREPARED',?,?,?,?,?)"
      ).run(
        actionId,
        stream,
        epId,
        actionEpisodeVersion,
        revision,
        type,
        canonicalJson(basis),
        requested,
        deadline,
        at,
        at
      );

      this.db.prepare(
        'INSERT INTO public_action_candidate_sets(action_id,candidate_count,candidate_slot) ' +
        'VALUES (?,?,?)'
      ).run(actionId, candidates.length, candidateSlot);
      for (const [index, candidate] of candidates.entries()) {
        this.db.prepare(
          'INSERT INTO public_action_candidates(action_id,slot_name,ordinal,value_json) ' +
          'VALUES (?,?,?,?)'
        ).run(actionId, candidate.slot, index + 1, canonicalJson(candidate.value));
      }
      for (const [index, eventSeq] of basis.entries()) {
        this.db.prepare(
          'INSERT INTO public_action_source_events(action_id,ordinal,stream_id,event_seq) ' +
          'VALUES (?,?,?,?)'
        ).run(actionId, index + 1, stream, eventSeq);
      }

      this.db.prepare(
        'INSERT INTO public_action_descriptors ' +
        '(action_id,stream_id,descriptor_version,reason,template_id,response_locale,' +
        'product_id,product_event_seq,variant_id,variant_event_seq,' +
        'category_id,category_match_mode,category_event_seq,' +
        'brand_id,brand_event_seq,store_id,store_event_seq,' +
        'money_currency,money_currency_event_seq,min_price_minor,min_price_event_seq,' +
        'max_price_minor,max_price_event_seq) ' +
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
      ).run(
        actionId,
        ...descriptorSqlValues(
          stream,
          normalizedDescriptor,
          normalizedScopeProvenance
        )
      );

      this.db.prepare(
        "INSERT INTO semantic_origins " +
        "(stream_id,stream_revision,origin_kind,action_id,created_at) " +
        "VALUES (?,?,'PUBLIC_ACTION',?,?)"
      ).run(stream, revision, actionId, at);

      this.db.prepare(
        "INSERT INTO continuation_owners " +
        "(stream_id,stream_revision,owner_kind,action_id,episode_id,episode_version," +
        "human_reason,terminal_outcome,created_at,updated_at,terminal_at) " +
        "VALUES (?,?,'PUBLIC_ACTION',?,?,?,NULL,NULL,?,?,NULL)"
      ).run(
        stream,
        revision,
        actionId,
        epId,
        actionEpisodeVersion,
        at,
        at
      );

      if (type === 'CLARIFY') {
        const changed = this.db.prepare(
          'UPDATE episodes SET clarification_prompts_sent=1,requested_slot=?,' +
          'clarification_action_id=?,version=version+1,updated_at=? ' +
          "WHERE episode_id=? AND state='active' AND version=? " +
          'AND clarification_prompts_sent=0 AND clarification_action_id IS NULL'
        ).run(requested, actionId, at, epId, episode.version).changes;
        if (changed !== 1) {
          fail('FIRST_LINE_STALE_WRITE',
            'episode changed before clarification reservation');
        }
      }
      return this.#readAction(actionId);
    });
  }

  claimNextPublicAction({ leaseMs, token = crypto.randomUUID() } = {}) {
    const lease = positiveInteger(leaseMs, 'lease_ms');
    const claim = safeToken(token, 'lease_token');
    const at = this.now();
    return tx(this.db, () => {
      this.#assertAutonomousAllowed();
      const rows = this.db.prepare(
        "SELECT action_id FROM public_actions " +
        "WHERE state IN ('PREPARED','GATING') " +
        "AND (lease_expires_at IS NULL OR lease_expires_at<=?) " +
        "ORDER BY created_at,action_id"
      ).all(at);
      for (const row of rows) {
        const action = this.#readAction(row.action_id);
        if (!action) {
          fail('FIRST_LINE_DB_CORRUPT',
            'claim candidate disappeared from durable state', {
              action_id: row.action_id,
            });
        }
        this.#assertDeferredRelationsValid(action.stream_id);
        if (action.continuation_owner.owner_kind !== 'PUBLIC_ACTION' ||
            action.continuation_owner.terminal_outcome !== null) {
          continue;
        }
        if (action.descriptor === null) {
          fail('FIRST_LINE_DB_CORRUPT',
            'autonomous claim candidate lacks v4 descriptor', {
              action_id: action.action_id,
            });
        }
        const changed = this.#withMutationLeaseToken(claim, () =>
          this.db.prepare(
            "UPDATE public_actions SET state='GATING',lease_token=?,lease_expires_at=?," +
            "attempts=attempts+1,updated_at=? WHERE action_id=? AND state=? AND " +
            "(lease_expires_at IS NULL OR lease_expires_at<=?)"
          ).run(
            claim,
            at + lease,
            at,
            action.action_id,
            action.state,
            at
          ).changes
        );
        if (changed === 1) return this.#readAction(action.action_id);
      }
      return null;
    });
  }

  markActionSending(actionId, leaseToken) {
    const id = safeToken(actionId, 'action_id');
    const token = safeToken(leaseToken, 'lease_token');
    const at = this.now();
    return tx(this.db, () => {
      this.#assertAutonomousAllowed();
      const action = this.#readAction(id);
      if (!action) {
        fail('FIRST_LINE_ACTION_NOT_FOUND',
          'public action not found', { action_id: id });
      }
      this.#assertDeferredRelationsValid(action.stream_id);
      if (action.state !== 'GATING' || action.lease_token !== token) {
        fail('FIRST_LINE_ACTION_CLAIM_INVALID', 'action is not held by this gating claim', { action_id: id });
      }
      const origin = this.#readSemanticOrigin(
        action.stream_id,
        action.prepared_stream_revision
      );
      const owner = this.#readContinuationOwner(
        action.stream_id,
        action.prepared_stream_revision
      );
      const descriptorRow = this.db.prepare(
        'SELECT * FROM public_action_descriptors WHERE action_id=?'
      ).get(id);
      if (!origin || origin.origin_kind !== 'PUBLIC_ACTION' ||
          origin.action_id !== id ||
          !owner || owner.owner_kind !== 'PUBLIC_ACTION' ||
          owner.action_id !== id || owner.terminal_outcome !== null) {
        fail('FIRST_LINE_ACTION_CLAIM_INVALID',
          'GATING action no longer owns autonomous continuation', {
            action_id: id,
          });
      }
      if (!descriptorRow) {
        fail('FIRST_LINE_ACTION_DESCRIPTOR_MISSING',
          'v4 send admission requires immutable descriptor', {
            action_id: id,
          });
      }
      persistedActionDescriptor(descriptorRow, id);
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
      const changed = this.#withMutationLeaseToken(token, () =>
        this.db.prepare(`UPDATE public_actions SET state='SENDING',send_started_at=?,updated_at=?
          WHERE action_id=? AND state='GATING' AND lease_token=? AND lease_expires_at>? AND deadline_at>?`)
          .run(at, at, id, token, at, at).changes
      );
      if (changed !== 1) fail('FIRST_LINE_STALE_WRITE', 'action changed before SENDING');
      return this.#readAction(id);
    });
  }

  markActionUncertain(actionId, { reason = 'send_outcome_unknown' } = {}) {
    const id = safeToken(actionId, 'action_id');
    const terminalReason = safeToken(reason, 'terminal_reason');
    return tx(this.db, () => {
      const action = this.#requireReadableAction(id);
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


  cancelActionBeforeSend(
    actionId,
    { reason = 'cancelled_before_send', leaseToken = null } = {}
  ) {
    return this.#finishActionBeforeSend(
      actionId,
      'CANCELLED',
      reason,
      leaseToken
    );
  }

  markActionStaleBeforeSend(
    actionId,
    { reason = 'stale_before_send', leaseToken = null } = {}
  ) {
    return this.#finishActionBeforeSend(
      actionId,
      'STALE',
      reason,
      leaseToken
    );
  }

  listRecoverablePublicActions({ now = this.now() } = {}) {
    nonNegativeInteger(now, 'now');
    return readTx(this.db, () => {
      const rows = this.db.prepare(
        "SELECT action_id FROM public_actions " +
        "WHERE state IN ('PREPARED','GATING','SENDING','UNCERTAIN') " +
        "ORDER BY created_at,action_id"
      ).all();
      const recoverable = [];
      for (const row of rows) {
        const action = this.#readAction(row.action_id);
        if (!action) {
          fail('FIRST_LINE_DB_CORRUPT',
            'recoverable action disappeared from durable state', {
              action_id: row.action_id,
            });
        }
        this.#assertDeferredRelationsValid(action.stream_id);
        if (action.continuation_owner.owner_kind === 'PUBLIC_ACTION' &&
            action.continuation_owner.terminal_outcome === null) {
          if (action.descriptor === null) {
            fail('FIRST_LINE_DB_CORRUPT',
              'autonomous recoverable action lacks v4 descriptor', {
                action_id: action.action_id,
              });
          }
          recoverable.push(action);
        }
      }
      return recoverable;
    });
  }

  getPublicAction(actionId) {
    const id = safeToken(actionId, 'action_id');
    return readTx(this.db, () => this.#readAction(id));
  }

  getSemanticOrigin(streamId, streamRevision) {
    const stream = safeToken(streamId, 'stream_id');
    const revision = positiveInteger(streamRevision, 'stream_revision');
    return readTx(this.db, () => {
      this.#requireStream(stream);
      return this.#readSemanticOrigin(stream, revision);
    });
  }

  getContinuationOwner(streamId, streamRevision) {
    const stream = safeToken(streamId, 'stream_id');
    const revision = positiveInteger(streamRevision, 'stream_revision');
    return readTx(this.db, () => {
      this.#requireStream(stream);
      return this.#readContinuationOwner(stream, revision);
    });
  }

  getUnresolvedContinuationOwner(streamId) {
    const stream = safeToken(streamId, 'stream_id');
    return readTx(this.db, () => {
      this.#requireStream(stream);
      return this.#readUnresolvedOwner(stream);
    });
  }

  getDeferredEventParent(streamId, eventSeq) {
    const stream = safeToken(streamId, 'stream_id');
    const seq = positiveInteger(eventSeq, 'event_seq');
    return readTx(this.db, () => {
      this.#requireStream(stream);
      return this.#readDeferredParent(stream, seq);
    });
  }

  getActiveRecoveryBarrier() {
    return readTx(this.db, () => this.#readRecoveryBarrier());
  }

  enterRecoveryBarrier({ reason }) {
    const barrierReason = safeToken(reason, 'recovery_reason');
    const at = this.now();
    return tx(this.db, () => {
      const active = this.#readRecoveryBarrier();
      if (active) return active;
      const nextEpoch = Number(this.db.prepare(
        'SELECT COALESCE(MAX(recovery_epoch),0)+1 AS next_epoch FROM recovery_barriers'
      ).get().next_epoch);
      positiveInteger(nextEpoch, 'recovery_epoch');
      this.db.prepare(
        'INSERT INTO recovery_barriers ' +
        '(recovery_epoch,authority_key,reason,entered_at,completion_kind,completed_at) ' +
        'VALUES (?,1,?,?,NULL,NULL)'
      ).run(nextEpoch, barrierReason, at);
      return this.#readRecoveryBarrier();
    });
  }

  completeRecoveryBarrier(recoveryEpoch, { completion }) {
    const epoch = positiveInteger(recoveryEpoch, 'recovery_epoch');
    const completionKind = enumValue(
      completion,
      new Set(['LOSSLESS_SEMANTIC_CUT']),
      'recovery_completion'
    );
    const at = this.now();
    return tx(this.db, () => {
      const active = this.#readRecoveryBarrier();
      if (!active || active.recovery_epoch !== epoch) {
        fail('FIRST_LINE_RECOVERY_BARRIER_STALE',
          'recovery barrier is no longer the active recovery epoch', {
            recovery_epoch: epoch,
            active_recovery_epoch: active?.recovery_epoch ?? null,
          });
      }
      const changed = this.db.prepare(
        'UPDATE recovery_barriers SET completion_kind=?,completed_at=? ' +
        'WHERE recovery_epoch=? AND completed_at IS NULL'
      ).run(completionKind, at, epoch).changes;
      if (changed !== 1) {
        fail('FIRST_LINE_STALE_WRITE',
          'recovery barrier changed before completion', {
            recovery_epoch: epoch,
          });
      }
      return this.#readRecoveryBarrier(epoch);
    });
  }

  commitDirectHumanOrigin({
    streamId,
    streamRevision,
    reason,
    episodeId = null,
    expectedEpisodeVersion = null,
  }) {
    const stream = safeToken(streamId, 'stream_id');
    const revision = positiveInteger(streamRevision, 'stream_revision');
    const humanReason = safeToken(reason, 'human_reason');
    const requestedEpisodeId = episodeId === null
      ? null
      : safeToken(episodeId, 'episode_id');
    const requestedEpisodeVersion = requestedEpisodeId === null
      ? null
      : positiveInteger(expectedEpisodeVersion, 'expected_episode_version');
    const at = this.now();

    return tx(this.db, () => {
      const currentStream = this.#requireStream(stream);
      this.#assertDeferredRelationsValid(stream);
      const existing = this.#readSemanticOrigin(stream, revision);
      if (existing) {
        if (existing.origin_kind !== 'DIRECT_HUMAN') {
          fail('FIRST_LINE_SEMANTIC_ORIGIN_CONFLICT',
            'stream revision already has another semantic origin', {
              stream_id: stream,
              stream_revision: revision,
              origin_kind: existing.origin_kind,
            });
        }
        const owner = this.#readContinuationOwner(stream, revision);
        if (!owner || owner.owner_kind !== 'HUMAN' || owner.action_id !== null) {
          fail('FIRST_LINE_DB_CORRUPT',
            'DIRECT_HUMAN origin lacks matching durable HUMAN owner', {
              stream_id: stream,
              stream_revision: revision,
            });
        }
        if (owner.human_reason !== humanReason) {
          fail('FIRST_LINE_SEMANTIC_ORIGIN_CONFLICT',
            'DIRECT_HUMAN replay conflicts with immutable HUMAN reason', {
              stream_id: stream,
              stream_revision: revision,
              human_reason: owner.human_reason,
            });
        }
        if (requestedEpisodeId !== null &&
            (owner.episode_id !== requestedEpisodeId ||
             owner.episode_version !== requestedEpisodeVersion)) {
          fail('FIRST_LINE_SEMANTIC_ORIGIN_CONFLICT',
            'DIRECT_HUMAN replay conflicts with immutable episode binding', {
              stream_id: stream,
              stream_revision: revision,
              episode_id: owner.episode_id,
              episode_version: owner.episode_version,
            });
        }
        return Object.freeze({ origin: existing, continuation_owner: owner });
      }

      if (currentStream.stream_revision !== revision) {
        fail('FIRST_LINE_ROUTING_PLAN_STALE',
          'DIRECT_HUMAN origin requires the current stream revision', {
            expected_stream_revision: revision,
            current_stream_revision: currentStream.stream_revision,
          });
      }

      const unresolved = this.#readUnresolvedOwner(stream);
      if (unresolved) {
        fail('FIRST_LINE_CONTINUATION_OWNER_CONFLICT',
          'another continuation already owns the stream', {
            stream_id: stream,
            owner_revision: unresolved.stream_revision,
            owner_kind: unresolved.owner_kind,
          });
      }
      const action = this.db.prepare(
        'SELECT action_id FROM public_actions WHERE stream_id=? AND prepared_stream_revision=?'
      ).get(stream, revision);
      if (action) {
        fail('FIRST_LINE_DB_CORRUPT',
          'same-revision action exists without semantic origin', {
            stream_id: stream,
            stream_revision: revision,
            action_id: action.action_id,
          });
      }

      const activeHead = this.db.prepare(
        "SELECT episode_id FROM episodes WHERE stream_id=? AND state='active'"
      ).get(stream) ?? null;
      let boundEpisode = null;
      if (activeHead) {
        boundEpisode = this.#readEpisode(activeHead.episode_id);
        if (requestedEpisodeId !== null &&
            (requestedEpisodeId !== boundEpisode.episode_id ||
             requestedEpisodeVersion !== boundEpisode.version)) {
          fail('FIRST_LINE_STALE_WRITE',
            'active episode changed before DIRECT_HUMAN commit', {
              stream_id: stream,
              active_episode_id: boundEpisode.episode_id,
              active_episode_version: boundEpisode.version,
            });
        }
      } else if (requestedEpisodeId !== null) {
        fail('FIRST_LINE_STALE_WRITE',
          'requested DIRECT_HUMAN episode is no longer active', {
            episode_id: requestedEpisodeId,
          });
      }

      this.db.prepare(
        "INSERT INTO semantic_origins " +
        "(stream_id,stream_revision,origin_kind,action_id,created_at) " +
        "VALUES (?,?,'DIRECT_HUMAN',NULL,?)"
      ).run(stream, revision, at);
      this.db.prepare(
        "INSERT INTO continuation_owners " +
        "(stream_id,stream_revision,owner_kind,action_id,episode_id,episode_version," +
        "human_reason,terminal_outcome,created_at,updated_at,terminal_at) " +
        "VALUES (?,?,'HUMAN',NULL,?,?,?,NULL,?,?,NULL)"
      ).run(
        stream,
        revision,
        boundEpisode?.episode_id ?? null,
        boundEpisode?.version ?? null,
        humanReason,
        at,
        at
      );
      return Object.freeze({
        origin: this.#readSemanticOrigin(stream, revision),
        continuation_owner: this.#readContinuationOwner(stream, revision),
      });
    });
  }

  commitNonActionableAckOrigin({
    streamId,
    streamRevision,
    expectedThroughEventSeq,
    expectedRoutingLedgerFingerprint,
    episodeId = null,
    expectedEpisodeVersion = null,
  }) {
    const stream = safeToken(streamId, 'stream_id');
    const revision = positiveInteger(streamRevision, 'stream_revision');
    const through = positiveInteger(expectedThroughEventSeq, 'expected_through_event_seq');
    const expectedLedgerFingerprint = routingLedgerFingerprintValue(
      expectedRoutingLedgerFingerprint,
      'expected_routing_ledger_fingerprint'
    );
    const requestedEpisodeId = episodeId === null
      ? null
      : safeToken(episodeId, 'episode_id');
    const requestedEpisodeVersion = requestedEpisodeId === null
      ? null
      : positiveInteger(expectedEpisodeVersion, 'expected_episode_version');
    const at = this.now();

    return tx(this.db, () => {
      const currentStream = this.#requireStream(stream);
      this.#assertDeferredRelationsValid(stream);
      const existing = this.#readSemanticOrigin(stream, revision);
      if (existing) {
        if (existing.origin_kind !== 'NON_ACTIONABLE_ACK') {
          fail('FIRST_LINE_SEMANTIC_ORIGIN_CONFLICT',
            'stream revision already has another semantic origin', {
              stream_id: stream,
              stream_revision: revision,
              origin_kind: existing.origin_kind,
            });
        }
        const ackCut = this.#readNonActionableAckCut(stream, revision);
        if (!ackCut) {
          fail('FIRST_LINE_DB_CORRUPT',
            'NON_ACTIONABLE_ACK origin lacks immutable routing cut', {
              stream_id: stream,
              stream_revision: revision,
            });
        }
        if (requestedEpisodeId !== null && ackCut.episode_id !== requestedEpisodeId) {
          fail('FIRST_LINE_SEMANTIC_ORIGIN_CONFLICT',
            'NON_ACTIONABLE_ACK replay conflicts with immutable episode binding', {
              stream_id: stream,
              stream_revision: revision,
            });
        }
        return existing;
      }

      this.#assertAutonomousAllowed();
      this.#assertNoHumanContinuation(stream);
      if (currentStream.stream_revision !== revision ||
          currentStream.last_event_seq !== through) {
        fail('FIRST_LINE_ROUTING_PLAN_STALE',
          'NON_ACTIONABLE_ACK requires the unchanged routed stream head', {
            expected_stream_revision: revision,
            current_stream_revision: currentStream.stream_revision,
            expected_through_event_seq: through,
            current_last_event_seq: currentStream.last_event_seq,
          });
      }

      const currentLedger = this.#readRoutingLedger(currentStream);
      if (currentLedger.fingerprint !== expectedLedgerFingerprint) {
        fail('FIRST_LINE_ROUTING_PLAN_STALE',
          'NON_ACTIONABLE_ACK routing ledger changed before durable commit', {
            stream_id: stream,
            expected_routing_ledger_fingerprint: expectedLedgerFingerprint,
            current_routing_ledger_fingerprint: currentLedger.fingerprint,
          });
      }

      if (this.#readUnresolvedOwner(stream)) {
        fail('FIRST_LINE_CONTINUATION_OWNER_CONFLICT',
          'ACK cannot replace a live public/HUMAN continuation', {
            stream_id: stream,
          });
      }
      const action = this.db.prepare(
        'SELECT action_id FROM public_actions WHERE stream_id=? AND prepared_stream_revision=?'
      ).get(stream, revision);
      if (action) {
        fail('FIRST_LINE_DB_CORRUPT',
          'same-revision action exists without semantic origin', {
            stream_id: stream,
            stream_revision: revision,
            action_id: action.action_id,
          });
      }

      this.db.prepare(
        "INSERT INTO semantic_origins " +
        "(stream_id,stream_revision,origin_kind,action_id,created_at) " +
        "VALUES (?,?,'NON_ACTIONABLE_ACK',NULL,?)"
      ).run(stream, revision, at);

      const activeHead = this.db.prepare(
        "SELECT episode_id FROM episodes WHERE stream_id=? AND state='active'"
      ).get(stream) ?? null;
      if (activeHead) {
        if (requestedEpisodeId === null) {
          fail('FIRST_LINE_ACTION_EPISODE_REQUIRED',
            'ACK must CAS-close the active episode in the same transaction', {
              stream_id: stream,
              active_episode_id: activeHead.episode_id,
            });
        }
        const episode = this.#requireActiveEpisode(
          requestedEpisodeId,
          requestedEpisodeVersion
        );
        if (episode.stream_id !== stream ||
            episode.episode_id !== activeHead.episode_id) {
          fail('FIRST_LINE_ACTION_EPISODE_STREAM_MISMATCH',
            'ACK episode does not own the stream', {
              episode_id: requestedEpisodeId,
              stream_id: stream,
            });
        }
        if (episode.clarification_prompts_sent !== 0 ||
            episode.clarification_action_id !== null ||
            episode.requested_slot !== null) {
          fail('FIRST_LINE_CLARIFICATION_LIMIT_REACHED',
            'silent ACK cannot close an episode with consumed/pending clarification budget', {
              episode_id: episode.episode_id,
              clarification_prompts_sent: episode.clarification_prompts_sent,
              clarification_action_id: episode.clarification_action_id,
            });
        }
        const latch = this.db.prepare(
          'SELECT latch_class FROM episode_constraint_latches WHERE episode_id=? LIMIT 1'
        ).get(episode.episode_id) ?? null;
        if (latch) {
          fail('FIRST_LINE_PENDING_HUMAN_LATCH',
            'pending HUMAN latch forbids silent ACK', {
              episode_id: episode.episode_id,
              latch_class: latch.latch_class,
            });
        }
        this.db.prepare(
          'INSERT INTO non_actionable_ack_cuts ' +
          '(stream_id,stream_revision,ack_through_event_seq,episode_id,episode_version,created_at) ' +
          'VALUES (?,?,?,?,?,?)'
        ).run(stream, revision, through, episode.episode_id, episode.version, at);
        const changed = this.db.prepare(
          "UPDATE episodes SET state='closed',version=version+1,updated_at=?," +
          "closed_at=?,close_reason='non_actionable_ack' " +
          "WHERE episode_id=? AND stream_id=? AND state='active' AND version=?"
        ).run(
          at,
          at,
          episode.episode_id,
          stream,
          episode.version
        ).changes;
        if (changed !== 1) {
          fail('FIRST_LINE_STALE_WRITE',
            'episode changed before ACK commit', {
              episode_id: episode.episode_id,
            });
        }
      } else if (requestedEpisodeId !== null) {
        fail('FIRST_LINE_STALE_WRITE',
          'requested ACK episode is no longer active', {
            episode_id: requestedEpisodeId,
          });
      } else {
        this.db.prepare(
          'INSERT INTO non_actionable_ack_cuts ' +
          '(stream_id,stream_revision,ack_through_event_seq,episode_id,episode_version,created_at) ' +
          'VALUES (?,?,?,NULL,NULL,?)'
        ).run(stream, revision, through, at);
      }

      return this.#readSemanticOrigin(stream, revision);
    });
  }

  escalatePublicActionToHuman(
    actionId,
    { reason, leaseToken = null }
  ) {
    const id = safeToken(actionId, 'action_id');
    const humanReason = safeToken(reason, 'human_reason');
    const suppliedLease = leaseToken === null
      ? null
      : safeToken(leaseToken, 'lease_token');
    const at = this.now();
    return tx(this.db, () => {
      const action = this.#requireReadableAction(id);
      const origin = this.#readSemanticOrigin(
        action.stream_id,
        action.prepared_stream_revision
      );
      const owner = this.#readContinuationOwner(
        action.stream_id,
        action.prepared_stream_revision
      );
      if (!origin || origin.origin_kind !== 'PUBLIC_ACTION' ||
          origin.action_id !== id || !owner || owner.action_id !== id) {
        fail('FIRST_LINE_DB_CORRUPT',
          'public action lacks immutable origin/continuation owner', {
            action_id: id,
          });
      }
      if (owner.terminal_outcome !== null) {
        fail('FIRST_LINE_ACTION_STATE_INVALID',
          'terminal continuation cannot escalate to HUMAN', {
            action_id: id,
            terminal_outcome: owner.terminal_outcome,
          });
      }
      if (owner.owner_kind === 'HUMAN') {
        if (owner.human_reason !== humanReason) {
          fail('FIRST_LINE_HUMAN_CONTINUATION_ACTIVE',
            'HUMAN continuation reason is immutable', {
              action_id: id,
              human_reason: owner.human_reason,
            });
        }
        return owner;
      }

      if (action.state === 'PREPARED' || action.state === 'GATING') {
        const currentStream = this.#requireStream(action.stream_id);
        if (currentStream.stream_revision !== action.prepared_stream_revision) {
          fail('FIRST_LINE_ACTION_STALE_REVISION',
            'superseded unsent action cannot acquire HUMAN continuation', {
              action_id: id,
              action_revision: action.prepared_stream_revision,
              current_stream_revision: currentStream.stream_revision,
            });
        }
        if (action.state === 'GATING') {
          if (suppliedLease === null || action.lease_token !== suppliedLease) {
            fail('FIRST_LINE_ACTION_CLAIM_INVALID',
              'current GATING action may escalate only under its live lease', {
                action_id: id,
              });
          }
          if (!Number.isSafeInteger(action.lease_expires_at) ||
              action.lease_expires_at <= at) {
            fail('FIRST_LINE_ACTION_CLAIM_EXPIRED',
              'GATING claim expired before HUMAN escalation', {
                action_id: id,
              });
          }
        } else if (suppliedLease !== null) {
          fail('FIRST_LINE_ACTION_CLAIM_INVALID',
            'PREPARED HUMAN escalation does not accept a lease token', {
              action_id: id,
            });
        }
      } else if (suppliedLease !== null) {
        fail('FIRST_LINE_ACTION_CLAIM_INVALID',
          'post-SENDING HUMAN escalation does not use a GATING lease', {
            action_id: id,
          });
      }

      this.#assertDeferredRelationsValid(action.stream_id);
      if (Number.isSafeInteger(action.send_started_at)) {
        const humanCutStream = this.#readStream(action.stream_id);
        if (!humanCutStream) {
          fail('FIRST_LINE_DB_CORRUPT',
            'HUMAN escalation stream disappeared before durable cut', { action_id: id });
        }
        this.db.prepare(
          'INSERT INTO public_action_human_cuts ' +
          '(action_id,stream_id,human_through_event_seq,created_at) VALUES (?,?,?,?)'
        ).run(id, action.stream_id, humanCutStream.last_event_seq, at);
      }

      let humanEpisodeVersion = owner.episode_version;
      if (owner.episode_id !== null) {
        const currentEpisode = this.#readEpisode(owner.episode_id);
        if (currentEpisode?.state === 'active' &&
            currentEpisode.stream_id === action.stream_id &&
            currentEpisode.version >= owner.episode_version) {
          humanEpisodeVersion = currentEpisode.version;
        }
      }
      const changeOwner = () => this.db.prepare(
        "UPDATE continuation_owners SET owner_kind='HUMAN',human_reason=?," +
        'episode_version=?,updated_at=? ' +
        "WHERE stream_id=? AND stream_revision=? AND owner_kind='PUBLIC_ACTION' " +
        'AND action_id=? AND terminal_outcome IS NULL'
      ).run(
        humanReason,
        humanEpisodeVersion,
        at,
        action.stream_id,
        action.prepared_stream_revision,
        id
      ).changes;
      const changed = action.state === 'GATING'
        ? this.#withMutationLeaseToken(suppliedLease, changeOwner)
        : changeOwner();
      if (changed !== 1) {
        fail('FIRST_LINE_STALE_WRITE',
          'continuation changed before HUMAN escalation', {
            action_id: id,
          });
      }
      return this.#readContinuationOwner(
        action.stream_id,
        action.prepared_stream_revision
      );
    });
  }

  terminalizeHumanContinuation(
    streamId,
    streamRevision,
    { outcome }
  ) {
    const stream = safeToken(streamId, 'stream_id');
    const revision = positiveInteger(streamRevision, 'stream_revision');
    const terminalOutcome = enumValue(
      outcome,
      new Set(['HUMAN_TAKEOVER', 'OWNERSHIP_LOST']),
      'human_terminal_outcome'
    );
    const at = this.now();
    return tx(this.db, () => {
      const owner = this.#readContinuationOwner(stream, revision);
      if (!owner || owner.owner_kind !== 'HUMAN') {
        fail('FIRST_LINE_ACTION_STATE_INVALID',
          'only HUMAN continuation may terminalize as handoff/ownership loss', {
            stream_id: stream,
            stream_revision: revision,
          });
      }
      if (owner.terminal_outcome !== null) {
        if (owner.terminal_outcome !== terminalOutcome) {
          fail('FIRST_LINE_ACTION_STATE_INVALID',
            'HUMAN continuation already has a different terminal outcome', {
              stream_id: stream,
              stream_revision: revision,
              terminal_outcome: owner.terminal_outcome,
            });
        }
        const terminalCut = this.#readHumanTerminalCut(stream, revision);
        if (!terminalCut || terminalCut.terminal_outcome !== terminalOutcome) {
          fail('FIRST_LINE_DB_CORRUPT',
            'terminal HUMAN continuation lacks matching immutable event cut', {
              stream_id: stream,
              stream_revision: revision,
            });
        }
        return owner;
      }

      this.#assertDeferredRelationsValid(stream);
      const terminalStream = this.#requireStream(stream);
      if (terminalStream.last_event_seq < revision) {
        fail('FIRST_LINE_DB_CORRUPT',
          'HUMAN terminal cut cannot precede its semantic origin revision', {
            stream_id: stream,
            stream_revision: revision,
            last_event_seq: terminalStream.last_event_seq,
          });
      }
      this.db.prepare(
        'INSERT INTO human_terminal_cuts ' +
        '(stream_id,stream_revision,terminal_through_event_seq,terminal_outcome,created_at) ' +
        'VALUES (?,?,?,?,?)'
      ).run(
        stream,
        revision,
        terminalStream.last_event_seq,
        terminalOutcome,
        at
      );

      const ownedAction = owner.action_id === null
        ? null
        : this.#requireReadableAction(owner.action_id);

      if (owner.episode_id !== null) {
        const episode = this.#readEpisode(owner.episode_id);
        if (!episode || episode.stream_id !== stream) {
          fail('FIRST_LINE_DB_CORRUPT',
            'HUMAN continuation episode is missing/mismatched', {
              stream_id: stream,
              episode_id: owner.episode_id,
            });
        }
        if (episode.state === 'active') {
          if (episode.version !== owner.episode_version) {
            fail('FIRST_LINE_STALE_WRITE',
              'HUMAN continuation episode version changed before terminal proof', {
                episode_id: owner.episode_id,
                expected_version: owner.episode_version,
                actual_version: episode.version,
              });
          }
          const closeReason = terminalOutcome === 'HUMAN_TAKEOVER'
            ? 'human_takeover'
            : 'ownership_lost';
          const changed = this.db.prepare(
            "UPDATE episodes SET state='closed',version=version+1,updated_at=?," +
            'closed_at=?,close_reason=? ' +
            "WHERE episode_id=? AND stream_id=? AND state='active' AND version=?"
          ).run(
            at,
            at,
            closeReason,
            owner.episode_id,
            stream,
            owner.episode_version
          ).changes;
          if (changed !== 1) {
            fail('FIRST_LINE_STALE_WRITE',
              'episode changed before HUMAN terminalization', {
                episode_id: owner.episode_id,
              });
          }
        }
      }

      if (ownedAction !== null) {
        if (['PREPARED', 'GATING', 'SENDING', 'UNCERTAIN'].includes(ownedAction.state)) {
          const actionChanged = this.db.prepare(
            "UPDATE public_actions SET state='HANDOFF_DONE',terminal_reason=?," +
            'lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE action_id=? AND state=?'
          ).run(
            terminalOutcome === 'HUMAN_TAKEOVER'
              ? 'human_takeover'
              : 'ownership_lost',
            at,
            owner.action_id,
            ownedAction.state
          ).changes;
          if (actionChanged !== 1) {
            fail('FIRST_LINE_STALE_WRITE',
              'public action changed before HUMAN terminalization', {
                action_id: owner.action_id,
              });
          }
        }
      }

      const changed = this.db.prepare(
        'UPDATE continuation_owners SET terminal_outcome=?,terminal_at=?,updated_at=? ' +
        "WHERE stream_id=? AND stream_revision=? AND owner_kind='HUMAN' " +
        'AND terminal_outcome IS NULL'
      ).run(terminalOutcome, at, at, stream, revision).changes;
      if (changed !== 1) {
        fail('FIRST_LINE_STALE_WRITE',
          'HUMAN continuation changed before terminalization', {
            stream_id: stream,
            stream_revision: revision,
          });
      }

      return this.#readContinuationOwner(stream, revision);
    });
  }

  issueClarificationReservationAttestation(
    actionId,
    { leaseToken = null } = {}
  ) {
    const id = safeToken(actionId, 'action_id');
    const suppliedLease = leaseToken === null
      ? null
      : safeToken(leaseToken, 'lease_token');
    const at = this.now();
    return readTx(this.db, () => {
      this.#assertAutonomousAllowed();
      const action = this.#readAction(id);
      if (action) {
        this.#assertNoHumanContinuation(action.stream_id);
        this.#assertDeferredRelationsValid(action.stream_id);
      }
      if (!action || action.continuation_owner?.owner_kind !== 'PUBLIC_ACTION' ||
          action.continuation_owner?.terminal_outcome !== null ||
          action.action_type !== 'CLARIFY' ||
          !['PREPARED', 'GATING'].includes(action.state) ||
          action.episode_id === null || action.episode_version === null) {
        fail('FIRST_LINE_CLARIFICATION_ATTESTATION_INVALID',
          'only an owning unsent CLARIFY can receive reservation attestation',
          { action_id: id, state: action?.state ?? null });
      }

      if (action.state === 'GATING') {
        if (suppliedLease === null ||
            action.lease_token !== suppliedLease ||
            !Number.isSafeInteger(action.lease_expires_at) ||
            action.lease_expires_at <= at) {
          fail('FIRST_LINE_CLARIFICATION_ATTESTATION_INVALID',
            'GATING clarification attestation requires the current live claim',
            { action_id: id });
        }
      } else if (suppliedLease !== null) {
        fail('FIRST_LINE_CLARIFICATION_ATTESTATION_INVALID',
          'PREPARED clarification attestation does not accept a lease token',
          { action_id: id });
      }

      const stream = this.#readStream(action.stream_id);
      if (!stream ||
          stream.stream_revision !== action.prepared_stream_revision) {
        fail('FIRST_LINE_CLARIFICATION_ATTESTATION_INVALID',
          'clarification stream revision changed',
          { action_id: id });
      }

      const activeHead = this.db.prepare(
        "SELECT episode_id FROM episodes WHERE stream_id=? AND state='active'"
      ).get(action.stream_id) ?? null;
      const episode = activeHead
        ? this.#readEpisode(activeHead.episode_id)
        : null;
      if (!episode ||
          episode.episode_id !== action.episode_id ||
          episode.version !== action.episode_version ||
          episode.clarification_prompts_sent !== 1 ||
          episode.clarification_action_id !== action.action_id ||
          (episode.requested_slot ?? null) !==
            (action.requested_slot ?? null)) {
        fail('FIRST_LINE_CLARIFICATION_ATTESTATION_INVALID',
          'clarification action no longer owns the active reservation',
          { action_id: id });
      }

      const token = Object.freeze({
        schema: CLARIFICATION_RESERVATION_ATTESTATION_SCHEMA,
      });
      clarificationReservationBindings.set(
        token,
        deepFreezeRoutingValue({
          action_id: action.action_id,
          action_state: action.state,
          stream_id: action.stream_id,
          prepared_stream_revision: action.prepared_stream_revision,
          episode_id: action.episode_id,
          episode_version: action.episode_version,
          requested_slot: action.requested_slot,
          presented_candidates_json: canonicalJson(
            action.presented_candidates
          ),
          lease_token: action.state === 'GATING'
            ? action.lease_token
            : null,
        })
      );
      return token;
    });
  }

  #withMutationLeaseToken(token, fn) {
    if (this.#mutationLeaseToken !== null) {
      fail('FIRST_LINE_INTERNAL_STATE_INVALID',
        'nested lease mutation context is forbidden');
    }
    this.#mutationLeaseToken = token;
    try {
      return fn();
    } finally {
      this.#mutationLeaseToken = null;
    }
  }

  #finishActionBeforeSend(actionId, terminalState, reason, leaseToken = null) {
    const id = safeToken(actionId, 'action_id');
    const terminalReason = safeToken(reason, 'terminal_reason');
    const suppliedLease = leaseToken === null
      ? null
      : safeToken(leaseToken, 'lease_token');
    if (terminalState !== 'CANCELLED' && terminalState !== 'STALE') {
      fail('FIRST_LINE_ACTION_STATE_INVALID',
        'invalid unsent terminal state', { terminal_state: terminalState });
    }
    return tx(this.db, () => {
      const action = this.#requireReadableAction(id);
      if (action.state !== 'PREPARED' && action.state !== 'GATING') {
        fail('FIRST_LINE_ACTION_STATE_INVALID',
          'only unsent action may become terminal', {
            action_id: action.action_id,
            state: action.state,
          });
      }
      const stream = this.#requireStream(action.stream_id);
      if (stream.stream_revision < action.prepared_stream_revision) {
        fail('FIRST_LINE_DB_CORRUPT',
          'action revision is newer than owning stream', { action_id: action.action_id });
      }
      if (stream.stream_revision > action.prepared_stream_revision) {
        this.#supersedeUnsentAction(
          action,
          terminalReason,
          terminalState
        );
      } else if (action.state === 'GATING') {
        const at = this.now();
        if (suppliedLease === null || action.lease_token !== suppliedLease) {
          fail('FIRST_LINE_ACTION_CLAIM_INVALID',
            'current GATING action may terminalize only under its live lease', {
              action_id: action.action_id,
            });
        }
        if (!Number.isSafeInteger(action.lease_expires_at) ||
            action.lease_expires_at <= at) {
          fail('FIRST_LINE_ACTION_CLAIM_EXPIRED',
            'GATING claim expired before unsent terminalization', {
              action_id: action.action_id,
            });
        }
        this.#withMutationLeaseToken(suppliedLease, () =>
          this.#attachHumanToUnsentAction(
            action,
            terminalReason,
            terminalState,
            at
          )
        );
      } else {
        if (suppliedLease !== null) {
          fail('FIRST_LINE_ACTION_CLAIM_INVALID',
            'PREPARED terminalization does not accept a lease token', {
              action_id: action.action_id,
            });
        }
        this.#attachHumanToUnsentAction(
          action,
          terminalReason,
          terminalState
        );
      }
      return this.#readAction(id);
    });
  }

  #cancelUnsentAction(action, reason) {
    this.#supersedeUnsentAction(action, reason, 'CANCELLED');
  }

  #supersedeUnsentAction(
    action,
    reason,
    terminalState = 'CANCELLED',
    at = this.now()
  ) {
    if (action.state !== 'PREPARED' && action.state !== 'GATING') {
      fail('FIRST_LINE_ACTION_STATE_INVALID',
        'only unsent action may be superseded', { action_id: action.action_id });
    }
    const stream = this.#requireStream(action.stream_id);
    if (stream.stream_revision <= action.prepared_stream_revision) {
      fail('FIRST_LINE_ACTION_STALE_REVISION',
        'unsent action may release ownership only after a newer stream revision', {
          action_id: action.action_id,
          action_revision: action.prepared_stream_revision,
          current_stream_revision: stream.stream_revision,
        });
    }
    const owner = this.#readContinuationOwner(
      action.stream_id,
      action.prepared_stream_revision
    );
    if (!owner || owner.owner_kind !== 'PUBLIC_ACTION' ||
        owner.action_id !== action.action_id ||
        owner.terminal_outcome !== null) {
      fail('FIRST_LINE_HUMAN_CONTINUATION_ACTIVE',
        'action cannot be superseded after continuation left public ownership', {
          action_id: action.action_id,
        });
    }

    const actionChanged = this.db.prepare(
      'UPDATE public_actions SET state=?,terminal_reason=?,lease_token=NULL,' +
      "lease_expires_at=NULL,updated_at=? WHERE action_id=? AND state IN ('PREPARED','GATING')"
    ).run(terminalState, reason, at, action.action_id).changes;
    if (actionChanged !== 1) {
      fail('FIRST_LINE_STALE_WRITE',
        'public action changed before supersession', { action_id: action.action_id });
    }
    const supersededOwner = this.#readContinuationOwner(
      action.stream_id,
      action.prepared_stream_revision
    );
    if (!supersededOwner ||
        supersededOwner.owner_kind !== 'PUBLIC_ACTION' ||
        supersededOwner.action_id !== action.action_id ||
        supersededOwner.terminal_outcome !== 'SUPERSEDED') {
      fail('FIRST_LINE_DB_CORRUPT',
        'terminal action did not atomically supersede its continuation owner', {
          action_id: action.action_id,
        });
    }

    if (action.action_type === 'CLARIFY' && action.episode_id) {
      const episode = this.db.prepare(
        'SELECT * FROM episodes WHERE episode_id=?'
      ).get(action.episode_id);
      if (episode?.state === 'active' &&
          episode.clarification_action_id === action.action_id) {
        const changed = this.db.prepare(
          'UPDATE episodes SET clarification_prompts_sent=0,requested_slot=NULL,' +
          'clarification_action_id=NULL,version=version+1,updated_at=? ' +
          "WHERE episode_id=? AND state='active' AND clarification_action_id=?"
        ).run(at, action.episode_id, action.action_id).changes;
        if (changed !== 1) {
          fail('FIRST_LINE_STALE_WRITE',
            'clarification reservation changed before safe supersession', {
              action_id: action.action_id,
              episode_id: action.episode_id,
            });
        }
      }
    }
  }

  #attachHumanToUnsentAction(action, reason, terminalState, at = this.now()) {
    const owner = this.#readContinuationOwner(
      action.stream_id,
      action.prepared_stream_revision
    );
    if (!owner || owner.action_id !== action.action_id ||
        owner.terminal_outcome !== null) {
      fail('FIRST_LINE_DB_CORRUPT',
        'unsent action lacks unresolved continuation owner', {
          action_id: action.action_id,
        });
    }
    if (owner.owner_kind === 'PUBLIC_ACTION') {
      let humanEpisodeVersion = owner.episode_version;
      if (owner.episode_id !== null) {
        const currentEpisode = this.#readEpisode(owner.episode_id);
        if (currentEpisode?.state === 'active' &&
            currentEpisode.stream_id === action.stream_id &&
            currentEpisode.version >= owner.episode_version) {
          humanEpisodeVersion = currentEpisode.version;
        }
      }
      const changed = this.db.prepare(
        "UPDATE continuation_owners SET owner_kind='HUMAN',human_reason=?," +
        'episode_version=?,updated_at=? ' +
        "WHERE stream_id=? AND stream_revision=? AND owner_kind='PUBLIC_ACTION' " +
        'AND action_id=? AND terminal_outcome IS NULL'
      ).run(
        reason,
        humanEpisodeVersion,
        at,
        action.stream_id,
        action.prepared_stream_revision,
        action.action_id
      ).changes;
      if (changed !== 1) {
        fail('FIRST_LINE_STALE_WRITE',
          'continuation changed before HUMAN escalation', {
            action_id: action.action_id,
          });
      }
    }
    this.db.prepare(
      'UPDATE public_actions SET state=?,terminal_reason=?,lease_token=NULL,' +
      'lease_expires_at=NULL,updated_at=? WHERE action_id=?'
    ).run(terminalState, reason, at, action.action_id);
  }

  #readRoutingLedger(stream) {
    const id = stream.stream_id;
    let routingFloor = 0;
    const ackCutRows = this.db.prepare(
      'SELECT stream_revision FROM non_actionable_ack_cuts WHERE stream_id=? ORDER BY stream_revision'
    ).all(id);
    for (const row of ackCutRows) {
      const cut = this.#readNonActionableAckCut(id, row.stream_revision);
      routingFloor = Math.max(routingFloor, cut.ack_through_event_seq);
    }
    const terminalCutRows = this.db.prepare(
      'SELECT stream_revision FROM human_terminal_cuts WHERE stream_id=? ORDER BY stream_revision'
    ).all(id);
    for (const row of terminalCutRows) {
      const cut = this.#readHumanTerminalCut(id, row.stream_revision);
      routingFloor = Math.max(routingFloor, cut.terminal_through_event_seq);
    }
    const visibleEventCount = stream.last_event_seq - routingFloor;
    if (!Number.isSafeInteger(visibleEventCount) || visibleEventCount < 0) {
      fail('FIRST_LINE_DB_CORRUPT',
        'HUMAN terminal routing cut is newer than stream head', {
          stream_id: id,
          routing_floor: routingFloor,
          last_event_seq: stream.last_event_seq,
        });
    }
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
      ' WHERE ce.stream_id=? AND ce.event_seq>?' +
      ' ORDER BY ce.event_seq DESC LIMIT ?'
    ).all(id, routingFloor, ROUTING_SUFFIX_FETCH_LIMIT);

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
        const sourceMatches = this.db.prepare(
          'SELECT COUNT(*) AS n FROM conversation_events WHERE stream_id=? AND source_id=?'
        ).get(id, row.confirmed_action_id).n;
        if (sourceMatches !== 1) {
          fail('FIRST_LINE_SOURCE_ID_AMBIGUOUS',
            'confirmed routing boundary no longer has unique source-id evidence', {
              stream_id: id,
              action_id: row.confirmed_action_id,
              count: sourceMatches,
            });
        }
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

    if (visibleEventCount === 0 && rows.length !== 0) {
      fail('FIRST_LINE_DB_CORRUPT',
        'routing ledger exposes events at or before terminal HUMAN cut', {
          stream_id: id,
          routing_floor: routingFloor,
        });
    }
    if (visibleEventCount > 0 && rows.length === 0) {
      fail('FIRST_LINE_DB_CORRUPT',
        'post-HUMAN routing head has no persisted events', {
          stream_id: id,
          routing_floor: routingFloor,
          last_event_seq: stream.last_event_seq,
        });
    }

    const eventSuffix = descending.reverse();
    return {
      event_suffix: eventSuffix,
      suffix_truncated: visibleEventCount > rows.length,
      fingerprint: routingLedgerFingerprint(eventSuffix),
    };
  }

  #readSemanticOrigin(streamId, streamRevision) {
    const row = this.db.prepare(
      'SELECT * FROM semantic_origins WHERE stream_id=? AND stream_revision=?'
    ).get(streamId, streamRevision);
    if (!row) return null;
    persistedGuard(() => {
      safeToken(row.stream_id, 'stream_id');
      positiveInteger(row.stream_revision, 'stream_revision');
      enumValue(
        row.origin_kind,
        new Set(['PUBLIC_ACTION', 'DIRECT_HUMAN', 'NON_ACTIONABLE_ACK']),
        'origin_kind'
      );
      if (row.action_id !== null) safeToken(row.action_id, 'action_id');
      nonNegativeInteger(row.created_at, 'created_at');
      if (row.origin_kind === 'PUBLIC_ACTION' && row.action_id === null) {
        fail('FIRST_LINE_VALUE_INVALID', 'PUBLIC_ACTION origin requires action id');
      }
      if (row.origin_kind !== 'PUBLIC_ACTION' && row.action_id !== null) {
        fail('FIRST_LINE_VALUE_INVALID', 'non-action origin cannot carry action id');
      }
    }, 'persisted semantic origin is invalid', {
      stream_id: streamId,
      stream_revision: streamRevision,
    });
    const stream = this.db.prepare(
      'SELECT 1 AS ok FROM conversation_streams WHERE stream_id=?'
    ).get(row.stream_id) ?? null;
    if (!stream) {
      fail('FIRST_LINE_DB_CORRUPT', 'semantic origin references missing stream', {
        stream_id: row.stream_id,
        stream_revision: row.stream_revision,
      });
    }
    if (row.origin_kind === 'PUBLIC_ACTION') {
      const action = this.db.prepare(
        'SELECT stream_id,prepared_stream_revision FROM public_actions WHERE action_id=?'
      ).get(row.action_id) ?? null;
      if (!action || action.stream_id !== row.stream_id ||
          action.prepared_stream_revision !== row.stream_revision) {
        fail('FIRST_LINE_DB_CORRUPT',
          'PUBLIC_ACTION semantic origin/action provenance is inconsistent', {
            stream_id: row.stream_id,
            stream_revision: row.stream_revision,
            action_id: row.action_id,
          });
      }
    }
    return Object.freeze({
      stream_id: row.stream_id,
      stream_revision: row.stream_revision,
      origin_kind: row.origin_kind,
      action_id: row.action_id,
      created_at: row.created_at,
    });
  }

  #readContinuationOwner(streamId, streamRevision) {
    const row = this.db.prepare(
      'SELECT * FROM continuation_owners WHERE stream_id=? AND stream_revision=?'
    ).get(streamId, streamRevision);
    if (!row) return null;
    persistedGuard(() => {
      safeToken(row.stream_id, 'stream_id');
      positiveInteger(row.stream_revision, 'stream_revision');
      enumValue(row.owner_kind, new Set(['PUBLIC_ACTION', 'HUMAN']), 'owner_kind');
      if (row.action_id !== null) safeToken(row.action_id, 'action_id');
      if (row.episode_id !== null) safeToken(row.episode_id, 'episode_id');
      if (row.episode_version !== null) positiveInteger(row.episode_version, 'episode_version');
      if ((row.episode_id === null) !== (row.episode_version === null)) {
        fail('FIRST_LINE_VALUE_INVALID', 'continuation episode pair is incomplete');
      }
      if (row.human_reason !== null) safeToken(row.human_reason, 'human_reason');
      if (row.owner_kind === 'PUBLIC_ACTION' &&
          (row.action_id === null || row.human_reason !== null)) {
        fail('FIRST_LINE_VALUE_INVALID', 'PUBLIC_ACTION continuation shape is invalid');
      }
      if (row.owner_kind === 'HUMAN' && row.human_reason === null) {
        fail('FIRST_LINE_VALUE_INVALID', 'HUMAN continuation requires reason');
      }
      if (row.terminal_outcome !== null) {
        enumValue(
          row.terminal_outcome,
          new Set([
            'CONFIRMED', 'SUPERSEDED', 'HUMAN_TAKEOVER',
            'OWNERSHIP_LOST', 'LEGACY_V3_TERMINAL',
          ]),
          'terminal_outcome'
        );
      }
      nonNegativeInteger(row.created_at, 'created_at');
      nonNegativeInteger(row.updated_at, 'updated_at');
      if (row.terminal_at !== null) nonNegativeInteger(row.terminal_at, 'terminal_at');
      if ((row.terminal_outcome === null) !== (row.terminal_at === null)) {
        fail('FIRST_LINE_VALUE_INVALID', 'continuation terminal pair is incomplete');
      }
    }, 'persisted continuation owner is invalid', {
      stream_id: streamId,
      stream_revision: streamRevision,
    });

    const origin = this.db.prepare(
      'SELECT origin_kind,action_id FROM semantic_origins WHERE stream_id=? AND stream_revision=?'
    ).get(row.stream_id, row.stream_revision) ?? null;
    if (!origin) {
      fail('FIRST_LINE_DB_CORRUPT',
        'continuation owner lacks immutable semantic origin', {
          stream_id: row.stream_id, stream_revision: row.stream_revision,
        });
    }
    let action = null;
    if (row.action_id !== null) {
      action = this.db.prepare(
        'SELECT action_id,stream_id,prepared_stream_revision,episode_id,episode_version,state ' +
        'FROM public_actions WHERE action_id=?'
      ).get(row.action_id) ?? null;
      if (!action || origin.origin_kind !== 'PUBLIC_ACTION' ||
          origin.action_id !== row.action_id ||
          action.stream_id !== row.stream_id ||
          action.prepared_stream_revision !== row.stream_revision ||
          action.episode_id !== row.episode_id ||
          (row.owner_kind === 'PUBLIC_ACTION' && action.episode_version !== row.episode_version) ||
          (row.owner_kind === 'HUMAN' && action.episode_id !== null &&
           row.episode_version < action.episode_version)) {
        fail('FIRST_LINE_DB_CORRUPT',
          'continuation owner/action provenance is inconsistent', {
            stream_id: row.stream_id, stream_revision: row.stream_revision,
            action_id: row.action_id,
          });
      }
      if (row.owner_kind === 'PUBLIC_ACTION' && row.terminal_outcome === null &&
          !LIVE_ACTION_STATES.has(action.state)) {
        fail('FIRST_LINE_DB_CORRUPT',
          'unresolved PUBLIC_ACTION continuation points to terminal action state', {
            action_id: row.action_id, state: action.state,
          });
      }
      if (row.owner_kind === 'PUBLIC_ACTION' && row.terminal_outcome === 'CONFIRMED' &&
          action.state !== 'CONFIRMED') {
        fail('FIRST_LINE_DB_CORRUPT',
          'CONFIRMED continuation/action state mismatch', {
            action_id: row.action_id, state: action.state,
          });
      }
      if (row.owner_kind === 'PUBLIC_ACTION' && row.terminal_outcome === 'SUPERSEDED' &&
          !['STALE','CANCELLED'].includes(action.state)) {
        fail('FIRST_LINE_DB_CORRUPT',
          'SUPERSEDED continuation/action state mismatch', {
            action_id: row.action_id, state: action.state,
          });
      }
      if (row.owner_kind === 'PUBLIC_ACTION' && row.terminal_outcome === 'LEGACY_V3_TERMINAL' &&
          !['STALE','CANCELLED','HANDOFF_DONE','NOT_SENT'].includes(action.state)) {
        fail('FIRST_LINE_DB_CORRUPT',
          'legacy continuation/action state mismatch', {
            action_id: row.action_id, state: action.state,
          });
      }
      if (row.owner_kind === 'HUMAN' &&
          ['HUMAN_TAKEOVER','OWNERSHIP_LOST'].includes(row.terminal_outcome) &&
          !['HANDOFF_DONE','STALE','CANCELLED'].includes(action.state)) {
        fail('FIRST_LINE_DB_CORRUPT',
          'terminal HUMAN continuation/action state mismatch', {
            action_id: row.action_id, state: action.state,
          });
      }
    } else if (origin.origin_kind !== 'DIRECT_HUMAN' || origin.action_id !== null ||
               row.owner_kind !== 'HUMAN') {
      fail('FIRST_LINE_DB_CORRUPT',
        'actionless continuation is not a DIRECT_HUMAN owner', {
          stream_id: row.stream_id, stream_revision: row.stream_revision,
        });
    }

    if (row.episode_id !== null) {
      const episode = this.db.prepare(
        'SELECT stream_id,state,version,close_reason FROM episodes WHERE episode_id=?'
      ).get(row.episode_id) ?? null;
      if (!episode || episode.stream_id !== row.stream_id) {
        fail('FIRST_LINE_DB_CORRUPT',
          'continuation owner episode is missing or cross-stream', {
            stream_id: row.stream_id, episode_id: row.episode_id,
          });
      }
      if (row.owner_kind === 'HUMAN' && row.terminal_outcome === null &&
          (episode.state !== 'active' || episode.version !== row.episode_version)) {
        fail('FIRST_LINE_DB_CORRUPT',
          'unresolved HUMAN continuation is not bound to the current active episode version', {
            episode_id: row.episode_id, expected_version: row.episode_version,
            actual_version: episode.version, state: episode.state,
          });
      }
      if (row.owner_kind === 'HUMAN' &&
          ['HUMAN_TAKEOVER','OWNERSHIP_LOST'].includes(row.terminal_outcome)) {
        const expectedReason = row.terminal_outcome === 'HUMAN_TAKEOVER'
          ? 'human_takeover'
          : 'ownership_lost';
        if (episode.state !== 'closed' || episode.version !== row.episode_version + 1 ||
            episode.close_reason !== expectedReason) {
          fail('FIRST_LINE_DB_CORRUPT',
            'terminal HUMAN continuation lacks matching episode terminal evidence', {
              episode_id: row.episode_id, terminal_outcome: row.terminal_outcome,
            });
        }
      }
    }

    return Object.freeze({
      stream_id: row.stream_id,
      stream_revision: row.stream_revision,
      owner_kind: row.owner_kind,
      action_id: row.action_id,
      episode_id: row.episode_id,
      episode_version: row.episode_version,
      human_reason: row.human_reason,
      terminal_outcome: row.terminal_outcome,
      created_at: row.created_at,
      updated_at: row.updated_at,
      terminal_at: row.terminal_at,
    });
  }

  #readUnresolvedOwner(streamId) {
    const rows = this.db.prepare(
      'SELECT stream_revision FROM continuation_owners ' +
      'WHERE stream_id=? AND terminal_outcome IS NULL'
    ).all(streamId);
    if (rows.length > 1) {
      fail('FIRST_LINE_DB_CORRUPT',
        'multiple unresolved continuation owners exist', { stream_id: streamId });
    }
    return rows.length === 1
      ? this.#readContinuationOwner(streamId, rows[0].stream_revision)
      : null;
  }

  #readDeferredParent(streamId, eventSeq) {
    const row = this.db.prepare(
      'SELECT * FROM deferred_event_parents WHERE stream_id=? AND event_seq=?'
    ).get(streamId, eventSeq);
    if (!row) return null;
    persistedGuard(() => {
      safeToken(row.stream_id, 'stream_id');
      positiveInteger(row.event_seq, 'event_seq');
      safeToken(row.action_id, 'action_id');
      nonNegativeInteger(row.created_at, 'created_at');

      const event = this.db.prepare(
        'SELECT event_kind FROM conversation_events WHERE stream_id=? AND event_seq=?'
      ).get(row.stream_id, row.event_seq) ?? null;
      const action = this.#readAction(row.action_id);
      if (!event || event.event_kind !== 'CUSTOMER_MESSAGE' ||
          !action || action.stream_id !== row.stream_id ||
          action.descriptor === null ||
          row.event_seq <= action.prepared_stream_revision ||
          !Number.isSafeInteger(action.send_started_at)) {
        fail('FIRST_LINE_VALUE_INVALID',
          'deferred parent relationship is inconsistent');
      }

      const owner = action.continuation_owner;
      const unresolvedPublicSend =
        owner.owner_kind === 'PUBLIC_ACTION' &&
        owner.terminal_outcome === null &&
        ['SENDING', 'UNCERTAIN'].includes(action.state);

      const normalConfirmedHistory =
        owner.owner_kind === 'PUBLIC_ACTION' &&
        owner.terminal_outcome === 'CONFIRMED' &&
        action.state === 'CONFIRMED' &&
        action.confirmation_cut !== null &&
        row.event_seq <= action.confirmation_cut.confirmed_through_event_seq;

      let humanOwnedHistory = false;
      if (owner.owner_kind === 'HUMAN') {
        const humanCut = this.db.prepare(
          'SELECT human_through_event_seq FROM public_action_human_cuts ' +
          'WHERE action_id=? AND stream_id=?'
        ).get(action.action_id, action.stream_id) ?? null;
        humanOwnedHistory =
          humanCut !== null &&
          Number.isSafeInteger(humanCut.human_through_event_seq) &&
          row.event_seq <= humanCut.human_through_event_seq;
      }

      if (!unresolvedPublicSend &&
          !normalConfirmedHistory &&
          !humanOwnedHistory) {
        fail('FIRST_LINE_VALUE_INVALID',
          'deferred parent lies outside its provable SENDING/UNCERTAIN history');
      }
    }, 'persisted deferred event parent is invalid', {
      stream_id: streamId,
      event_seq: eventSeq,
    });
    return Object.freeze({
      stream_id: row.stream_id,
      event_seq: row.event_seq,
      action_id: row.action_id,
      created_at: row.created_at,
    });
  }
  #assertSemanticOwnershipValid(streamId) {
    const invalid = this.db.prepare(
      "SELECT so.stream_revision,so.origin_kind,so.action_id," +
      "co.owner_kind,co.action_id AS owner_action_id " +
      "FROM semantic_origins so " +
      "LEFT JOIN continuation_owners co ON co.stream_id=so.stream_id " +
      "AND co.stream_revision=so.stream_revision " +
      "WHERE so.stream_id=? AND (" +
      "(so.origin_kind='PUBLIC_ACTION' AND (co.stream_id IS NULL OR co.action_id IS NOT so.action_id)) OR " +
      "(so.origin_kind='DIRECT_HUMAN' AND (co.stream_id IS NULL OR co.owner_kind<>'HUMAN' OR co.action_id IS NOT NULL)) OR " +
      "(so.origin_kind='NON_ACTIONABLE_ACK' AND co.stream_id IS NOT NULL)" +
      ") ORDER BY so.stream_revision LIMIT 1"
    ).get(streamId) ?? null;
    if (invalid) {
      fail('FIRST_LINE_DB_CORRUPT',
        'semantic origin/continuation-owner cardinality is inconsistent', {
          stream_id: streamId,
          stream_revision: invalid.stream_revision,
          origin_kind: invalid.origin_kind,
          action_id: invalid.action_id,
        });
    }
  }

  #assertDeferredRelationsValid(streamId) {
    this.#assertSemanticOwnershipValid(streamId);
    const rows = this.db.prepare(
      'SELECT event_seq FROM deferred_event_parents WHERE stream_id=? ORDER BY event_seq'
    ).all(streamId);
    for (const row of rows) this.#readDeferredParent(streamId, row.event_seq);

    const cutActionRows = this.db.prepare(
      'SELECT action_id FROM public_action_confirmation_cuts WHERE stream_id=? ' +
      'UNION SELECT action_id FROM public_action_human_cuts WHERE stream_id=?'
    ).all(streamId, streamId);
    for (const row of cutActionRows) this.#readAction(row.action_id);

    const ackCuts = this.db.prepare(
      'SELECT stream_revision FROM non_actionable_ack_cuts WHERE stream_id=? ORDER BY stream_revision'
    ).all(streamId);
    for (const row of ackCuts) {
      this.#readNonActionableAckCut(streamId, row.stream_revision);
    }
    const missingAckCut = this.db.prepare(
      "SELECT so.stream_revision FROM semantic_origins so " +
      "LEFT JOIN non_actionable_ack_cuts ac ON ac.stream_id=so.stream_id " +
      "AND ac.stream_revision=so.stream_revision " +
      "WHERE so.stream_id=? AND so.origin_kind='NON_ACTIONABLE_ACK' " +
      'AND ac.stream_id IS NULL LIMIT 1'
    ).get(streamId);
    if (missingAckCut) {
      fail('FIRST_LINE_DB_CORRUPT',
        'NON_ACTIONABLE_ACK semantic origin lacks immutable routing cut', {
          stream_id: streamId,
          stream_revision: missingAckCut.stream_revision,
        });
    }

    const terminalCuts = this.db.prepare(
      'SELECT stream_revision FROM human_terminal_cuts WHERE stream_id=? ORDER BY stream_revision'
    ).all(streamId);
    for (const row of terminalCuts) {
      this.#readHumanTerminalCut(streamId, row.stream_revision);
    }
    const missingTerminalCut = this.db.prepare(
      "SELECT co.stream_revision FROM continuation_owners co " +
      "LEFT JOIN human_terminal_cuts htc ON htc.stream_id=co.stream_id " +
      "AND htc.stream_revision=co.stream_revision " +
      "WHERE co.stream_id=? AND co.owner_kind='HUMAN' " +
      "AND co.terminal_outcome IN ('HUMAN_TAKEOVER','OWNERSHIP_LOST') " +
      'AND htc.stream_id IS NULL LIMIT 1'
    ).get(streamId);
    if (missingTerminalCut) {
      fail('FIRST_LINE_DB_CORRUPT',
        'terminal HUMAN continuation lacks immutable routing boundary', {
          stream_id: streamId,
          stream_revision: missingTerminalCut.stream_revision,
        });
    }

    const missingConfirmationCut = this.db.prepare(
      "SELECT pa.action_id FROM public_actions pa " +
      "JOIN public_action_descriptors pad ON pad.action_id=pa.action_id " +
      "LEFT JOIN public_action_confirmation_cuts pc ON pc.action_id=pa.action_id " +
      "AND pc.stream_id=pa.stream_id " +
      "WHERE pa.stream_id=? AND pa.state='CONFIRMED' AND pc.action_id IS NULL " +
      'LIMIT 1'
    ).get(streamId);
    if (missingConfirmationCut) {
      fail('FIRST_LINE_DB_CORRUPT',
        'normal v4 confirmation lacks its immutable local cut', {
          stream_id: streamId,
          action_id: missingConfirmationCut.action_id,
        });
    }

    const missingHumanCut = this.db.prepare(
      "SELECT pa.action_id FROM public_actions pa " +
      "JOIN public_action_descriptors pad ON pad.action_id=pa.action_id " +
      "JOIN continuation_owners co ON co.stream_id=pa.stream_id " +
      "AND co.stream_revision=pa.prepared_stream_revision AND co.action_id=pa.action_id " +
      "LEFT JOIN public_action_human_cuts hc ON hc.action_id=pa.action_id " +
      "AND hc.stream_id=pa.stream_id " +
      "WHERE pa.stream_id=? AND pa.send_started_at IS NOT NULL " +
      "AND co.owner_kind='HUMAN' AND hc.action_id IS NULL LIMIT 1"
    ).get(streamId);
    if (missingHumanCut) {
      fail('FIRST_LINE_DB_CORRUPT',
        'sent v4 HUMAN continuation lacks its immutable escalation cut', {
          stream_id: streamId,
          action_id: missingHumanCut.action_id,
        });
    }

    const unresolved = this.db.prepare(
      "SELECT pa.action_id,pa.prepared_stream_revision FROM public_actions pa " +
      "JOIN continuation_owners co ON co.stream_id=pa.stream_id " +
      "AND co.stream_revision=pa.prepared_stream_revision AND co.action_id=pa.action_id " +
      "WHERE pa.stream_id=? AND pa.state IN ('SENDING','UNCERTAIN') " +
      "AND pa.send_started_at IS NOT NULL AND co.owner_kind='PUBLIC_ACTION' " +
      'AND co.terminal_outcome IS NULL'
    ).all(streamId);
    if (unresolved.length > 1) {
      fail('FIRST_LINE_DB_CORRUPT',
        'multiple unresolved public sends exist while validating deferred topology', {
          stream_id: streamId,
          count: unresolved.length,
        });
    }
    for (const action of unresolved) {
      const missing = this.db.prepare(
        "SELECT ce.event_seq FROM conversation_events ce " +
        "LEFT JOIN deferred_event_parents dp " +
        "ON dp.stream_id=ce.stream_id AND dp.event_seq=ce.event_seq " +
        "WHERE ce.stream_id=? AND ce.event_kind='CUSTOMER_MESSAGE' " +
        'AND ce.event_seq>? AND (dp.action_id IS NULL OR dp.action_id<>?) ' +
        'ORDER BY ce.event_seq LIMIT 1'
      ).get(streamId, action.prepared_stream_revision, action.action_id);
      if (missing) {
        fail('FIRST_LINE_DB_CORRUPT',
          'customer event accepted behind unresolved send lacks its immutable parent', {
            stream_id: streamId,
            event_seq: missing.event_seq,
            action_id: action.action_id,
          });
      }
    }

    const confirmed = this.db.prepare(
      "SELECT pa.action_id,pa.prepared_stream_revision,pc.confirmed_through_event_seq " +
      "FROM public_actions pa " +
      "JOIN continuation_owners co ON co.stream_id=pa.stream_id " +
      "AND co.stream_revision=pa.prepared_stream_revision AND co.action_id=pa.action_id " +
      "JOIN public_action_descriptors pad ON pad.action_id=pa.action_id " +
      "JOIN public_action_confirmation_cuts pc ON pc.action_id=pa.action_id " +
      "AND pc.stream_id=pa.stream_id " +
      "WHERE pa.stream_id=? AND pa.state='CONFIRMED' " +
      "AND co.owner_kind='PUBLIC_ACTION' AND co.terminal_outcome='CONFIRMED'"
    ).all(streamId);
    for (const action of confirmed) {
      const missing = this.db.prepare(
        "SELECT ce.event_seq FROM conversation_events ce " +
        "LEFT JOIN deferred_event_parents dp " +
        "ON dp.stream_id=ce.stream_id AND dp.event_seq=ce.event_seq " +
        "WHERE ce.stream_id=? AND ce.event_kind='CUSTOMER_MESSAGE' " +
        'AND ce.event_seq>? AND ce.event_seq<=? ' +
        'AND (dp.action_id IS NULL OR dp.action_id<>?) ' +
        'ORDER BY ce.event_seq LIMIT 1'
      ).get(
        streamId,
        action.prepared_stream_revision,
        action.confirmed_through_event_seq,
        action.action_id
      );
      if (missing) {
        fail('FIRST_LINE_DB_CORRUPT',
          'customer event accepted before normal confirmation lacks its immutable parent', {
            stream_id: streamId,
            event_seq: missing.event_seq,
            action_id: action.action_id,
          });
      }
    }

    const humanCuts = this.db.prepare(
      "SELECT pa.action_id,pa.prepared_stream_revision,hc.human_through_event_seq " +
      "FROM public_actions pa " +
      "JOIN public_action_descriptors pad ON pad.action_id=pa.action_id " +
      "JOIN public_action_human_cuts hc ON hc.action_id=pa.action_id " +
      "AND hc.stream_id=pa.stream_id " +
      "WHERE pa.stream_id=? AND pa.send_started_at IS NOT NULL"
    ).all(streamId);
    for (const action of humanCuts) {
      const missing = this.db.prepare(
        "SELECT ce.event_seq FROM conversation_events ce " +
        "LEFT JOIN deferred_event_parents dp " +
        "ON dp.stream_id=ce.stream_id AND dp.event_seq=ce.event_seq " +
        "WHERE ce.stream_id=? AND ce.event_kind='CUSTOMER_MESSAGE' " +
        'AND ce.event_seq>? AND ce.event_seq<=? ' +
        'AND (dp.action_id IS NULL OR dp.action_id<>?) ' +
        'ORDER BY ce.event_seq LIMIT 1'
      ).get(
        streamId,
        action.prepared_stream_revision,
        action.human_through_event_seq,
        action.action_id
      );
      if (missing) {
        fail('FIRST_LINE_DB_CORRUPT',
          'customer event accepted before HUMAN escalation lacks its immutable parent', {
            stream_id: streamId,
            event_seq: missing.event_seq,
            action_id: action.action_id,
          });
      }
    }
  }

  #readNonActionableAckCut(streamId, streamRevision) {
    const row = this.db.prepare(
      'SELECT * FROM non_actionable_ack_cuts WHERE stream_id=? AND stream_revision=?'
    ).get(streamId, streamRevision);
    if (!row) return null;
    persistedGuard(() => {
      safeToken(row.stream_id, 'stream_id');
      positiveInteger(row.stream_revision, 'stream_revision');
      positiveInteger(row.ack_through_event_seq, 'ack_through_event_seq');
      if (row.episode_id !== null) safeToken(row.episode_id, 'episode_id');
      if (row.episode_version !== null) positiveInteger(row.episode_version, 'episode_version');
      if ((row.episode_id === null) !== (row.episode_version === null)) {
        fail('FIRST_LINE_VALUE_INVALID', 'ACK cut episode binding is incomplete');
      }
      nonNegativeInteger(row.created_at, 'created_at');
    }, 'persisted NON_ACTIONABLE_ACK cut is invalid', {
      stream_id: streamId,
      stream_revision: streamRevision,
    });
    const origin = this.db.prepare(
      'SELECT origin_kind,action_id FROM semantic_origins WHERE stream_id=? AND stream_revision=?'
    ).get(row.stream_id, row.stream_revision) ?? null;
    const stream = this.db.prepare(
      'SELECT last_event_seq,stream_revision FROM conversation_streams WHERE stream_id=?'
    ).get(row.stream_id) ?? null;
    const event = this.db.prepare(
      'SELECT 1 AS ok FROM conversation_events WHERE stream_id=? AND event_seq=?'
    ).get(row.stream_id, row.ack_through_event_seq) ?? null;
    if (!origin || origin.origin_kind !== 'NON_ACTIONABLE_ACK' || origin.action_id !== null ||
        !stream || stream.stream_revision !== stream.last_event_seq ||
        row.ack_through_event_seq !== row.stream_revision ||
        row.ack_through_event_seq > stream.last_event_seq || !event) {
      fail('FIRST_LINE_DB_CORRUPT',
        'NON_ACTIONABLE_ACK cut does not match semantic origin/stream history', {
          stream_id: row.stream_id,
          stream_revision: row.stream_revision,
        });
    }
    if (row.episode_id !== null) {
      const episode = this.db.prepare(
        'SELECT stream_id,state,version,close_reason FROM episodes WHERE episode_id=?'
      ).get(row.episode_id) ?? null;
      if (!episode || episode.stream_id !== row.stream_id || episode.state !== 'closed' ||
          episode.version !== row.episode_version + 1 ||
          episode.close_reason !== 'non_actionable_ack') {
        fail('FIRST_LINE_DB_CORRUPT',
          'NON_ACTIONABLE_ACK cut episode binding is inconsistent', {
            stream_id: row.stream_id,
            stream_revision: row.stream_revision,
            episode_id: row.episode_id,
          });
      }
    }
    return Object.freeze({
      stream_id: row.stream_id,
      stream_revision: row.stream_revision,
      ack_through_event_seq: row.ack_through_event_seq,
      episode_id: row.episode_id,
      episode_version: row.episode_version,
      created_at: row.created_at,
    });
  }

  #readHumanTerminalCut(streamId, streamRevision) {
    const row = this.db.prepare(
      'SELECT * FROM human_terminal_cuts WHERE stream_id=? AND stream_revision=?'
    ).get(streamId, streamRevision);
    if (!row) return null;
    persistedGuard(() => {
      safeToken(row.stream_id, 'stream_id');
      positiveInteger(row.stream_revision, 'stream_revision');
      positiveInteger(row.terminal_through_event_seq, 'terminal_through_event_seq');
      enumValue(
        row.terminal_outcome,
        new Set(['HUMAN_TAKEOVER', 'OWNERSHIP_LOST']),
        'human_terminal_outcome'
      );
      nonNegativeInteger(row.created_at, 'created_at');
    }, 'persisted HUMAN terminal cut is invalid', {
      stream_id: streamId,
      stream_revision: streamRevision,
    });
    const owner = this.db.prepare(
      'SELECT owner_kind,terminal_outcome,terminal_at FROM continuation_owners ' +
      'WHERE stream_id=? AND stream_revision=?'
    ).get(row.stream_id, row.stream_revision) ?? null;
    const stream = this.db.prepare(
      'SELECT last_event_seq,stream_revision FROM conversation_streams WHERE stream_id=?'
    ).get(row.stream_id) ?? null;
    const event = this.db.prepare(
      'SELECT 1 AS ok FROM conversation_events WHERE stream_id=? AND event_seq=?'
    ).get(row.stream_id, row.terminal_through_event_seq) ?? null;
    if (!owner || owner.owner_kind !== 'HUMAN' ||
        owner.terminal_outcome !== row.terminal_outcome ||
        owner.terminal_at === null ||
        !stream || stream.stream_revision !== stream.last_event_seq ||
        row.terminal_through_event_seq < row.stream_revision ||
        row.terminal_through_event_seq > stream.last_event_seq || !event) {
      fail('FIRST_LINE_DB_CORRUPT',
        'HUMAN terminal cut does not match terminal continuation/stream history', {
          stream_id: row.stream_id,
          stream_revision: row.stream_revision,
        });
    }
    return Object.freeze({
      stream_id: row.stream_id,
      stream_revision: row.stream_revision,
      terminal_through_event_seq: row.terminal_through_event_seq,
      terminal_outcome: row.terminal_outcome,
      created_at: row.created_at,
    });
  }

  #readRecoveryBarrier(recoveryEpoch = null) {
    const row = recoveryEpoch === null
      ? this.db.prepare(
          'SELECT * FROM recovery_barriers WHERE completed_at IS NULL ' +
          'ORDER BY recovery_epoch DESC LIMIT 1'
        ).get()
      : this.db.prepare(
          'SELECT * FROM recovery_barriers WHERE recovery_epoch=?'
        ).get(recoveryEpoch);
    if (!row) return null;
    persistedGuard(() => {
      positiveInteger(row.recovery_epoch, 'recovery_epoch');
      if (row.authority_key !== 1) {
        fail('FIRST_LINE_VALUE_INVALID',
          'recovery barrier authority key must be 1');
      }
      safeToken(row.reason, 'recovery_reason');
      nonNegativeInteger(row.entered_at, 'entered_at');
      if (row.completion_kind !== null) {
        enumValue(
          row.completion_kind,
          new Set(['LOSSLESS_SEMANTIC_CUT']),
          'recovery_completion'
        );
      }
      if (row.completed_at !== null) {
        nonNegativeInteger(row.completed_at, 'completed_at');
      }
      if ((row.completion_kind === null) !== (row.completed_at === null)) {
        fail('FIRST_LINE_VALUE_INVALID',
          'recovery completion pair is incomplete');
      }
    }, 'persisted recovery barrier is invalid', {
      recovery_epoch: row.recovery_epoch,
    });
    return Object.freeze({
      recovery_epoch: row.recovery_epoch,
      reason: row.reason,
      entered_at: row.entered_at,
      completion_kind: row.completion_kind,
      completed_at: row.completed_at,
    });
  }

  #assertAutonomousAllowed() {
    const barrier = this.#readRecoveryBarrier();
    if (barrier) {
      fail('FIRST_LINE_RECOVERY_BARRIER_ACTIVE',
        'autonomous semantic work is disabled during recovery', {
          recovery_epoch: barrier.recovery_epoch,
          reason: barrier.reason,
        });
    }
  }

  #assertNoHumanContinuation(streamId) {
    const owner = this.#readUnresolvedOwner(streamId);
    if (owner?.owner_kind === 'HUMAN') {
      fail('FIRST_LINE_HUMAN_CONTINUATION_ACTIVE',
        'durable HUMAN continuation blocks autonomous semantic mutation', {
          stream_id: streamId,
          owner_revision: owner.stream_revision,
          action_id: owner.action_id,
        });
    }
    this.#assertLegacyAutonomousSafe(streamId);
    return owner;
  }

  #assertLegacyAutonomousSafe(streamId) {
    const legacy = this.db.prepare(
      "SELECT pa.action_id,pa.state,pa.prepared_stream_revision " +
      "FROM public_actions pa JOIN legacy_v3_actions l ON l.action_id=pa.action_id " +
      "WHERE pa.stream_id=? " +
      'ORDER BY pa.prepared_stream_revision DESC,pa.created_at DESC,pa.action_id DESC LIMIT 1'
    ).get(streamId) ?? null;
    if (!legacy || legacy.state === 'CONFIRMED') return;
    const floor = Number(this.db.prepare(
      'SELECT COALESCE(MAX(terminal_through_event_seq),0) AS n ' +
      'FROM human_terminal_cuts WHERE stream_id=?'
    ).get(streamId).n);
    if (Number.isSafeInteger(floor) && floor >= legacy.prepared_stream_revision) return;
    fail('FIRST_LINE_LEGACY_STATE_UNPROVABLE',
      'legacy v3 terminal action cannot authorize autonomous v0.8 continuation', {
        stream_id: streamId,
        action_id: legacy.action_id,
        action_state: legacy.state,
        prepared_stream_revision: legacy.prepared_stream_revision,
      });
  }

  #requireStream(streamId) {
    const row = this.db.prepare('SELECT * FROM conversation_streams WHERE stream_id=?').get(streamId);
    if (!row) fail('FIRST_LINE_STREAM_NOT_FOUND', 'conversation stream not found', { stream_id: streamId });
    return row;
  }
  #requireReadableAction(actionId) {
    const action = this.#readAction(actionId);
    if (!action) {
      fail('FIRST_LINE_ACTION_NOT_FOUND',
        'public action not found', { action_id: actionId });
    }
    return action;
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
      if (row.stream_revision !== row.last_event_seq) {
        fail('FIRST_LINE_VALUE_INVALID',
          'stream revision and accepted event sequence diverged');
      }
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
      if (row.clarification_prompts_sent !== 0 &&
          row.clarification_prompts_sent !== 1) {
        fail('FIRST_LINE_VALUE_INVALID',
          'clarification_prompts_sent must be exactly 0 or 1');
      }
      if (row.clarification_action_id !== null) safeToken(row.clarification_action_id, 'clarification_action_id');
      if (row.state === 'active' &&
          (row.closed_at !== null || row.close_reason !== null)) {
        fail('FIRST_LINE_VALUE_INVALID', 'active episode carries terminal metadata');
      }
      if (row.state === 'closed' &&
          (row.closed_at === null || row.close_reason === null)) {
        fail('FIRST_LINE_VALUE_INVALID', 'closed episode lacks terminal metadata');
      }
      if (row.clarification_prompts_sent === 0 &&
          (row.requested_slot !== null || row.clarification_action_id !== null)) {
        fail('FIRST_LINE_VALUE_INVALID',
          'unused clarification budget cannot carry reservation metadata');
      }
      if (row.clarification_action_id === null && row.requested_slot !== null) {
        fail('FIRST_LINE_VALUE_INVALID',
          'requested clarification slot lacks owning action');
      }
      nonNegativeInteger(row.created_at, 'created_at');
      nonNegativeInteger(row.updated_at, 'updated_at');
      if (row.closed_at !== null) nonNegativeInteger(row.closed_at, 'closed_at');
      if (row.close_reason !== null) {
        enumValue(row.close_reason, new Set([
          'completed', 'replaced', 'human_takeover', 'ownership_lost',
          'non_actionable_ack', 'superseded', 'expired',
        ]), 'close_reason');
      }
    }, 'persisted episode metadata is invalid', { episode_id: episodeId });
    const clarificationRows = this.db.prepare(
      "SELECT action_id,state FROM public_actions WHERE episode_id=? AND action_type='CLARIFY'"
    ).all(row.episode_id);
    if (row.clarification_prompts_sent === 1 && clarificationRows.length === 0) {
      fail('FIRST_LINE_DB_CORRUPT',
        'consumed clarification budget lacks durable action history', {
          episode_id: row.episode_id,
        });
    }
    if (row.clarification_prompts_sent === 0 && clarificationRows.some(item =>
        !['STALE', 'CANCELLED'].includes(item.state))) {
      fail('FIRST_LINE_DB_CORRUPT',
        'clarification budget was reset after a consuming action state', {
          episode_id: row.episode_id,
        });
    }
    if (row.clarification_action_id !== null) {
      const linked = this.db.prepare(
        'SELECT stream_id,episode_id,action_type,requested_slot FROM public_actions WHERE action_id=?'
      ).get(row.clarification_action_id) ?? null;
      if (!linked || linked.stream_id !== row.stream_id ||
          linked.episode_id !== row.episode_id || linked.action_type !== 'CLARIFY' ||
          (linked.requested_slot ?? null) !== (row.requested_slot ?? null)) {
        fail('FIRST_LINE_DB_CORRUPT', 'persisted clarification binding is invalid', {
          episode_id: row.episode_id,
        });
      }
    }
    const slots = {};
    for (const item of this.db.prepare('SELECT * FROM episode_slots WHERE episode_id=? ORDER BY slot_name').all(episodeId)) {
      const value = parseJson(item.value_json);
      validatePersistedSlot(item.slot_name, value);
      if (item.derived_through_event_seq !== null) {
        positiveInteger(item.derived_through_event_seq, 'derived_through_event_seq');
        const source = this.db.prepare(
          'SELECT 1 AS ok FROM conversation_events WHERE stream_id=? AND event_seq=?'
        ).get(row.stream_id, item.derived_through_event_seq);
        if (!source) {
          fail('FIRST_LINE_DB_CORRUPT', 'persisted slot provenance is outside episode stream', {
            episode_id: row.episode_id,
            slot_name: item.slot_name,
            event_seq: item.derived_through_event_seq,
          });
        }
      }
      slots[item.slot_name] = { value, derived_through_event_seq: item.derived_through_event_seq };
    }
    if (slots.category_match_mode && !slots.category_id) {
      fail('FIRST_LINE_DB_CORRUPT',
        'persisted category_match_mode has no category_id',
        { episode_id: episodeId });
    }
    if (slots.category_id && slots.category_match_mode &&
        slots.category_id.derived_through_event_seq !==
          slots.category_match_mode.derived_through_event_seq) {
      fail('FIRST_LINE_DB_CORRUPT',
        'persisted CATEGORY identity pair has split provenance',
        { episode_id: episodeId });
    }
    return {
      episode_id: row.episode_id, stream_id: row.stream_id, state: row.state, version: row.version,
      clarification_prompts_sent: row.clarification_prompts_sent, requested_slot: requested,
      clarification_action_id: row.clarification_action_id, stable_slots: slots,
      created_at: row.created_at, updated_at: row.updated_at, closed_at: row.closed_at, close_reason: row.close_reason,
    };
  }

  #readAction(actionId) {
    const row = this.db.prepare(
      'SELECT * FROM public_actions WHERE action_id=?'
    ).get(actionId);
    if (!row) return null;
    if (!ACTION_TYPES.has(row.action_type) ||
        (!LIVE_ACTION_STATES.has(row.state) &&
         !TERMINAL_ACTION_STATES.has(row.state))) {
      fail('FIRST_LINE_DB_CORRUPT',
        'persisted public action enum is invalid', { action_id: actionId });
    }
    persistedGuard(() => {
      safeToken(row.action_id, 'action_id');
      safeToken(row.stream_id, 'stream_id');
      if (row.episode_id !== null) safeToken(row.episode_id, 'episode_id');
      if (row.episode_version !== null) {
        positiveInteger(row.episode_version, 'episode_version');
      }
      if ((row.episode_id === null) !== (row.episode_version === null)) {
        fail('FIRST_LINE_VALUE_INVALID',
          'public action episode provenance pair is incomplete');
      }
      positiveInteger(row.prepared_stream_revision, 'prepared_stream_revision');
      normalizeRequestedSlot(row.requested_slot);
      if (row.lease_token !== null) safeToken(row.lease_token, 'lease_token');
      if (row.lease_expires_at !== null) {
        nonNegativeInteger(row.lease_expires_at, 'lease_expires_at');
      }
      nonNegativeInteger(row.attempts, 'attempts');
      positiveInteger(row.deadline_at, 'deadline_at');
      if (row.confirmed_source_message_id !== null) {
        positiveInteger(
          row.confirmed_source_message_id,
          'confirmed_source_message_id'
        );
      }
      if (row.terminal_reason !== null) {
        safeToken(row.terminal_reason, 'terminal_reason');
      }
      nonNegativeInteger(row.created_at, 'created_at');
      nonNegativeInteger(row.updated_at, 'updated_at');
      if (row.send_started_at !== null) {
        nonNegativeInteger(row.send_started_at, 'send_started_at');
      }
      if (row.confirmed_at !== null) {
        nonNegativeInteger(row.confirmed_at, 'confirmed_at');
      }
    }, 'persisted public action metadata is invalid', { action_id: actionId });
    validateActionStateEvidence(row);

    const basis = persistedGuard(
      () => normalizeBasisEventSeqs(parseJson(row.basis_event_seqs_json)),
      'persisted public action basis is invalid',
      { action_id: actionId }
    );
    const sourceRows = this.db.prepare(
      'SELECT * FROM public_action_source_events WHERE action_id=? ORDER BY ordinal'
    ).all(actionId);
    if (sourceRows.length !== basis.length) {
      fail('FIRST_LINE_DB_CORRUPT',
        'public action relational source coverage count differs from basis', {
          action_id: actionId,
          expected: basis.length,
          actual: sourceRows.length,
        });
    }
    for (const [index, sourceRow] of sourceRows.entries()) {
      if (sourceRow.ordinal !== index + 1 ||
          sourceRow.stream_id !== row.stream_id ||
          sourceRow.event_seq !== basis[index] ||
          sourceRow.event_seq > row.prepared_stream_revision) {
        fail('FIRST_LINE_DB_CORRUPT',
          'public action relational source coverage is non-canonical', {
            action_id: actionId,
            ordinal: sourceRow.ordinal,
          });
      }
      const event = this.db.prepare(
        'SELECT 1 AS ok FROM conversation_events WHERE stream_id=? AND event_seq=?'
      ).get(sourceRow.stream_id, sourceRow.event_seq);
      if (!event) {
        fail('FIRST_LINE_DB_CORRUPT',
          'public action source coverage references missing event', {
            action_id: actionId,
            event_seq: sourceRow.event_seq,
          });
      }
    }

    const candidateSetRow = this.db.prepare(
      'SELECT * FROM public_action_candidate_sets WHERE action_id=?'
    ).get(actionId) ?? null;
    if (!candidateSetRow || !Number.isSafeInteger(candidateSetRow.candidate_count) ||
        candidateSetRow.candidate_count < 0 ||
        candidateSetRow.candidate_count > MAX_PRESENTED_CANDIDATES) {
      fail('FIRST_LINE_DB_CORRUPT',
        'public action lacks valid frozen candidate-count metadata', { action_id: actionId });
    }
    if (candidateSetRow.candidate_slot !== null) {
      persistedGuard(
        () => safeToken(candidateSetRow.candidate_slot, 'candidate_slot', { max: 64 }),
        'persisted candidate slot metadata is invalid',
        { action_id: actionId }
      );
    }
    const candidateRows = this.db.prepare(
      'SELECT * FROM public_action_candidates WHERE action_id=? ORDER BY ordinal'
    ).all(actionId);
    const candidateSet = validateCandidateRows(candidateRows, actionId, {
      expectedCount: candidateSetRow.candidate_count,
      expectedSlot: candidateSetRow.candidate_slot,
    });
    const candidates = candidateSet.candidates;
    if (row.action_type === 'ANSWER' &&
        (row.requested_slot !== null || candidates.length !== 0)) {
      fail('FIRST_LINE_DB_CORRUPT',
        'persisted ANSWER carries clarification reservation metadata', { action_id: actionId });
    }
    if (row.action_type === 'CLARIFY') {
      if (row.requested_slot === null && candidates.length === 0) {
        fail('FIRST_LINE_DB_CORRUPT',
          'persisted CLARIFY has no requested slot or candidates', { action_id: actionId });
      }
      if (row.requested_slot !== null && candidateSet.candidate_slot !== null &&
          row.requested_slot !== candidateSet.candidate_slot) {
        fail('FIRST_LINE_DB_CORRUPT',
          'persisted CLARIFY candidate slot conflicts with requested slot', { action_id: actionId });
      }
    }

    const descriptorRow = this.db.prepare(
      'SELECT * FROM public_action_descriptors WHERE action_id=?'
    ).get(actionId) ?? null;
    const legacyMarker = this.db.prepare(
      'SELECT marker FROM legacy_v3_actions WHERE action_id=?'
    ).get(actionId) ?? null;
    if ((descriptorRow === null) === (legacyMarker === null)) {
      fail('FIRST_LINE_DB_CORRUPT',
        'action must have exactly one v4 descriptor or legacy-v3 marker', {
          action_id: actionId,
        });
    }
    if (legacyMarker && legacyMarker.marker !== 'DESCRIPTOR_UNAVAILABLE') {
      fail('FIRST_LINE_DB_CORRUPT',
        'legacy-v3 action marker is invalid', { action_id: actionId });
    }
    if (descriptorRow && (row.episode_id === null || row.episode_version === null)) {
      fail('FIRST_LINE_DB_CORRUPT',
        'v4 public action is detached from required episode identity', { action_id: actionId });
    }
    let boundEpisode = null;
    if (row.episode_id !== null) {
      boundEpisode = this.#readEpisode(row.episode_id);
      if (!boundEpisode || boundEpisode.stream_id !== row.stream_id) {
        fail('FIRST_LINE_DB_CORRUPT',
          'public action episode is missing or belongs to another stream', {
            action_id: actionId, episode_id: row.episode_id, stream_id: row.stream_id,
          });
      }
      if (row.action_type === 'CLARIFY' && LIVE_ACTION_STATES.has(row.state) &&
          (boundEpisode.state !== 'active' ||
           boundEpisode.clarification_prompts_sent !== 1 ||
           boundEpisode.clarification_action_id !== actionId ||
           (boundEpisode.requested_slot ?? null) !== (row.requested_slot ?? null))) {
        fail('FIRST_LINE_DB_CORRUPT',
          'live CLARIFY reservation does not point back to its owning action', {
            action_id: actionId, episode_id: row.episode_id,
          });
      }
    }
    const descriptor = descriptorRow
      ? persistedActionDescriptor(descriptorRow, actionId)
      : null;
    const scopeProvenance = descriptorRow
      ? persistedScopeProvenance(
          descriptorRow,
          descriptor,
          basis,
          actionId,
          row.stream_id
        )
      : null;
    const confirmationCutRow = this.db.prepare(
      'SELECT * FROM public_action_confirmation_cuts WHERE action_id=?'
    ).get(actionId) ?? null;
    if (descriptorRow && row.state === 'CONFIRMED' && !confirmationCutRow) {
      fail('FIRST_LINE_DB_CORRUPT',
        'normal v4 confirmation lacks immutable local confirmation cut', {
          action_id: actionId,
        });
    }
    if ((!descriptorRow || row.state !== 'CONFIRMED') && confirmationCutRow) {
      fail('FIRST_LINE_DB_CORRUPT',
        'confirmation cut exists outside normal v4 CONFIRMED state', {
          action_id: actionId,
          state: row.state,
        });
    }
    if (confirmationCutRow) {
      persistedGuard(() => {
        safeToken(confirmationCutRow.action_id, 'action_id');
        safeToken(confirmationCutRow.stream_id, 'stream_id');
        positiveInteger(
          confirmationCutRow.confirmed_through_event_seq,
          'confirmed_through_event_seq'
        );
        nonNegativeInteger(confirmationCutRow.created_at, 'created_at');
        if (confirmationCutRow.stream_id !== row.stream_id ||
            confirmationCutRow.confirmed_through_event_seq <= row.prepared_stream_revision) {
          fail('FIRST_LINE_VALUE_INVALID', 'confirmation cut is outside action stream/revision');
        }
      }, 'persisted confirmation cut is invalid', { action_id: actionId });
    }

    const origin = this.#readSemanticOrigin(
      row.stream_id,
      row.prepared_stream_revision
    );
    if (!origin || origin.origin_kind !== 'PUBLIC_ACTION' ||
        origin.action_id !== actionId) {
      fail('FIRST_LINE_DB_CORRUPT',
        'public action lacks matching immutable semantic origin', {
          action_id: actionId,
          stream_id: row.stream_id,
          stream_revision: row.prepared_stream_revision,
        });
    }
    const owner = this.#readContinuationOwner(
      row.stream_id,
      row.prepared_stream_revision
    );
    const ownerEpisodeMatches = owner &&
      owner.episode_id === row.episode_id &&
      (
        owner.episode_version === row.episode_version ||
        (owner.owner_kind === 'HUMAN' &&
         owner.episode_id !== null &&
         owner.episode_version >= row.episode_version)
      );
    if (!owner || owner.action_id !== actionId || !ownerEpisodeMatches) {
      fail('FIRST_LINE_DB_CORRUPT',
        'public action continuation owner is missing/mismatched', {
          action_id: actionId,
        });
    }
    if (owner.owner_kind === 'PUBLIC_ACTION' &&
        owner.terminal_outcome === null &&
        !LIVE_ACTION_STATES.has(row.state)) {
      fail('FIRST_LINE_DB_CORRUPT',
        'unresolved PUBLIC_ACTION owner points to terminal action state', {
          action_id: actionId,
          state: row.state,
        });
    }
    if (owner.owner_kind === 'PUBLIC_ACTION' &&
        owner.terminal_outcome === 'CONFIRMED' &&
        row.state !== 'CONFIRMED') {
      fail('FIRST_LINE_DB_CORRUPT',
        'CONFIRMED continuation conflicts with action state', {
          action_id: actionId,
          state: row.state,
        });
    }
    if (owner.owner_kind === 'PUBLIC_ACTION' &&
        owner.terminal_outcome === 'SUPERSEDED' &&
        !['STALE', 'CANCELLED'].includes(row.state)) {
      fail('FIRST_LINE_DB_CORRUPT',
        'SUPERSEDED continuation conflicts with action state', {
          action_id: actionId,
          state: row.state,
        });
    }
    if (owner.owner_kind === 'PUBLIC_ACTION' &&
        owner.terminal_outcome === 'LEGACY_V3_TERMINAL' &&
        !['STALE', 'CANCELLED', 'HANDOFF_DONE', 'NOT_SENT'].includes(row.state)) {
      fail('FIRST_LINE_DB_CORRUPT',
        'legacy terminal continuation conflicts with action state', {
          action_id: actionId,
          state: row.state,
        });
    }
    if (owner.owner_kind === 'HUMAN' &&
        owner.terminal_outcome !== null &&
        LIVE_ACTION_STATES.has(row.state)) {
      fail('FIRST_LINE_DB_CORRUPT',
        'terminal HUMAN continuation still exposes live action state', {
          action_id: actionId,
          state: row.state,
        });
    }

    const humanCutRow = this.db.prepare(
      'SELECT * FROM public_action_human_cuts WHERE action_id=?'
    ).get(actionId) ?? null;
    const requiresHumanCut = descriptorRow !== null &&
      owner.owner_kind === 'HUMAN' && row.send_started_at !== null;
    if (requiresHumanCut && humanCutRow === null) {
      fail('FIRST_LINE_DB_CORRUPT',
        'sent v4 action in HUMAN continuation lacks immutable escalation cut', {
          action_id: actionId,
        });
    }
    if (humanCutRow !== null) {
      persistedGuard(() => {
        safeToken(humanCutRow.action_id, 'action_id');
        safeToken(humanCutRow.stream_id, 'stream_id');
        positiveInteger(humanCutRow.human_through_event_seq, 'human_through_event_seq');
        nonNegativeInteger(humanCutRow.created_at, 'created_at');
        if (descriptorRow === null || owner.owner_kind !== 'HUMAN' ||
            row.send_started_at === null ||
            humanCutRow.stream_id !== row.stream_id ||
            humanCutRow.human_through_event_seq < row.prepared_stream_revision) {
          fail('FIRST_LINE_VALUE_INVALID',
            'HUMAN escalation cut conflicts with public action ownership');
        }
      }, 'persisted HUMAN escalation cut is invalid', { action_id: actionId });
    }

    const sourceMatches = this.db.prepare(
      'SELECT * FROM conversation_events WHERE stream_id=? AND source_id=? ORDER BY event_seq'
    ).all(row.stream_id, actionId);
    if (sourceMatches.length > 1) {
      fail('FIRST_LINE_SOURCE_ID_AMBIGUOUS',
        'multiple ledger rows claim the same public action source id', {
          action_id: actionId, count: sourceMatches.length,
        });
    }
    if (sourceMatches.length === 1) {
      const sourceEvent = this.#eventDto(sourceMatches[0]);
      if (sourceEvent.event_kind !== 'BABYPARK_PUBLIC_REPLY') {
        fail('FIRST_LINE_DB_CORRUPT',
          'public action source id is attached to a non-BabyPark event', {
            action_id: actionId, event_kind: sourceEvent.event_kind,
          });
      }
      if (sourceEvent.event_seq <= row.prepared_stream_revision) {
        fail('FIRST_LINE_DB_CORRUPT',
          'public action source event predates its prepared revision', {
            action_id: actionId,
            source_event_seq: sourceEvent.event_seq,
            prepared_stream_revision: row.prepared_stream_revision,
          });
      }
      if (confirmationCutRow &&
          sourceEvent.event_seq > confirmationCutRow.confirmed_through_event_seq) {
        fail('FIRST_LINE_DB_CORRUPT',
          'confirmation source event is newer than its immutable local cut', {
            action_id: actionId,
            source_event_seq: sourceEvent.event_seq,
            confirmed_through_event_seq: confirmationCutRow.confirmed_through_event_seq,
          });
      }
      if (row.confirmed_source_message_id !== null &&
          sourceEvent.source_message_id !== row.confirmed_source_message_id) {
        fail('FIRST_LINE_DB_CORRUPT',
          'confirmed public action points to a different source message', { action_id: actionId });
      }
    }
    if (row.confirmed_source_message_id !== null && sourceMatches.length !== 1) {
      fail('FIRST_LINE_DB_CORRUPT',
        'confirmation evidence does not resolve to one authoritative BabyPark row', {
          action_id: actionId, confirmed_source_message_id: row.confirmed_source_message_id,
        });
    }
    if (row.state === 'CONFIRMED' && row.confirmed_source_message_id === null) {
      fail('FIRST_LINE_DB_CORRUPT',
        'CONFIRMED action lacks authoritative source-message evidence', { action_id: actionId });
    }

    return {
      action_id: row.action_id,
      stream_id: row.stream_id,
      episode_id: row.episode_id,
      episode_version: row.episode_version,
      prepared_stream_revision: row.prepared_stream_revision,
      action_type: row.action_type,
      state: row.state,
      basis_event_seqs: basis,
      requested_slot: row.requested_slot,
      presented_candidates: candidates,
      descriptor,
      scope_provenance: scopeProvenance,
      semantic_origin: origin,
      continuation_owner: owner,
      confirmation_cut: confirmationCutRow === null
        ? null
        : Object.freeze({
            confirmed_through_event_seq: confirmationCutRow.confirmed_through_event_seq,
            created_at: confirmationCutRow.created_at,
          }),
      lease_token: row.lease_token,
      lease_expires_at: row.lease_expires_at,
      attempts: row.attempts,
      deadline_at: row.deadline_at,
      confirmed_source_message_id: row.confirmed_source_message_id,
      terminal_reason: row.terminal_reason,
      created_at: row.created_at,
      updated_at: row.updated_at,
      send_started_at: row.send_started_at,
      confirmed_at: row.confirmed_at,
    };
  }

  #attestSchema() {
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    const metadata = this.db.prepare('SELECT schema_version FROM metadata WHERE singleton=1').get();
    const integrity = this.db.prepare('PRAGMA integrity_check').get().integrity_check;
    const foreignKeyFailures = this.db.prepare('PRAGMA foreign_key_check').all();
    if (version !== SCHEMA_VERSION || metadata?.schema_version !== SCHEMA_VERSION ||
        integrity !== 'ok' || foreignKeyFailures.length !== 0) {
      fail('FIRST_LINE_DB_INVALID', 'schema/integrity version check failed', {
        user_version: version,
        metadata_version: metadata?.schema_version,
        integrity,
        foreign_key_failures: foreignKeyFailures.length,
      });
    }
    const schemaFingerprint = schemaMasterFingerprint(this.db);
    if (schemaFingerprint !== V4_SCHEMA_MASTER_SHA256) {
      fail('FIRST_LINE_DB_INVALID', 'database sqlite_master does not match the frozen v4 schema', {
        expected_schema_fingerprint: V4_SCHEMA_MASTER_SHA256,
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
    const triggers = new Set(
      this.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all()
        .map(row => row.name)
    );
    for (const name of REQUIRED_TRIGGERS) {
      if (!triggers.has(name)) fail('FIRST_LINE_DB_INVALID', 'required trigger missing', { trigger: name });
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
    'persisted stable slot is invalid',
    { slot_name: slotName }
  );
}

function validatePersistedCandidate(slotName, value) {
  return persistedGuard(
    () => normalizeCandidate({ slot: slotName, value }),
    'persisted candidate slot is invalid',
    { slot_name: slotName }
  );
}

export {
  ACTION_TYPES,
  BUSY_TIMEOUT_MS,
  CANONICAL_ID_PATTERNS,
  CATEGORY_MATCH_MODES,
  CLARIFICATION_RESERVATION_ATTESTATION_SCHEMA,
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
