import {
  isCertifiedRoutingSnapshot,
  MAX_OPEN_TURN_EVENTS,
  ROUTING_SNAPSHOT_SCHEMA,
} from './first-line-state-store.mjs';

export const OPEN_TURN_PROJECTION_SCHEMA = 'bp.first-line.open-turn-projection/1';

const certifiedOpenTurnProjections = new WeakSet();

export function isCertifiedOpenTurnProjection(value) {
  return Boolean(value && typeof value === 'object' && certifiedOpenTurnProjections.has(value));
}

const BLOCKING_PUBLIC_KINDS = new Set([
  'OTHER_BOT_PUBLIC_REPLY',
  'AUTOMATION_PUBLIC',
  'UNKNOWN_PUBLIC',
]);

export class FirstLineRoutingError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FirstLineRoutingError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new FirstLineRoutingError(code, message, details);
}

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail('FIRST_LINE_ROUTING_INPUT_INVALID', field + ' must be a positive safe integer', { field });
  }
  return value;
}

function nonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('FIRST_LINE_ROUTING_INPUT_INVALID', field + ' must be a non-negative safe integer', { field });
  }
  return value;
}

function requireSnapshot(snapshot) {
  if (!isCertifiedRoutingSnapshot(snapshot)) {
    fail('FIRST_LINE_ROUTING_INPUT_INVALID',
      'routing snapshot must be a transient certified state-store snapshot');
  }
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
      snapshot.schema !== ROUTING_SNAPSHOT_SCHEMA ||
      !snapshot.stream || typeof snapshot.stream !== 'object' ||
      !Array.isArray(snapshot.event_suffix) ||
      typeof snapshot.routing_ledger_fingerprint !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/.test(snapshot.routing_ledger_fingerprint) ||
      typeof snapshot.suffix_truncated !== 'boolean' ||
      snapshot.max_open_turn_events !== MAX_OPEN_TURN_EVENTS ||
      (snapshot.live_public_action !== null &&
       (typeof snapshot.live_public_action !== 'object' ||
        Array.isArray(snapshot.live_public_action))) ||
      (snapshot.clarification_action !== null &&
       (typeof snapshot.clarification_action !== 'object' ||
        Array.isArray(snapshot.clarification_action))) ||
      (snapshot.confirmed_clarification_action !== null &&
       snapshot.confirmed_clarification_action !== undefined &&
       (typeof snapshot.confirmed_clarification_action !== 'object' ||
        Array.isArray(snapshot.confirmed_clarification_action)))) {
    fail('FIRST_LINE_ROUTING_INPUT_INVALID', 'routing snapshot contract is invalid');
  }
  positiveInteger(snapshot.stream.source_conversation_id, 'source_conversation_id');
  nonNegativeInteger(snapshot.stream.stream_revision, 'stream_revision');
  nonNegativeInteger(snapshot.stream.last_event_seq, 'last_event_seq');
  if (snapshot.stream.source_provider !== 'chatwoot') {
    fail('FIRST_LINE_ROUTING_INPUT_INVALID', 'routing snapshot source provider is unsupported');
  }
  return snapshot;
}

function planToken(snapshot) {
  const episode = snapshot.active_episode;
  return Object.freeze({
    stream_id: snapshot.stream.stream_id,
    stream_revision: snapshot.stream.stream_revision,
    through_event_seq: snapshot.stream.last_event_seq,
    routing_ledger_fingerprint: snapshot.routing_ledger_fingerprint,
    episode_id: episode?.episode_id ?? null,
    episode_version: episode?.version ?? null,
    live_action_id: snapshot.live_public_action?.action_id ?? null,
    live_action_state: snapshot.live_public_action?.state ?? null,
  });
}

function boundaryDto(entry) {
  if (!entry) return null;
  return Object.freeze({
    event_seq: entry.event.event_seq,
    source_message_id: entry.event.source_message_id,
    event_kind: entry.event.event_kind,
    confirmed_action_id: entry.confirmed_babypark_action?.action_id ?? null,
    confirmed_action_type: entry.confirmed_babypark_action?.action_type ?? null,
  });
}

function certifyProjection(value) {
  certifiedOpenTurnProjections.add(value);
  return value;
}

function resultBase(snapshot) {
  return {
    schema: OPEN_TURN_PROJECTION_SCHEMA,
    stream_id: snapshot.stream.stream_id,
    source_conversation_id: snapshot.stream.source_conversation_id,
    stream_revision: snapshot.stream.stream_revision,
    through_event_seq: snapshot.stream.last_event_seq,
    plan_token: planToken(snapshot),
    active_episode: snapshot.active_episode,
    live_public_action: snapshot.live_public_action,
    clarification_action: snapshot.clarification_action,
    confirmed_clarification_action:
      snapshot.confirmed_clarification_action ?? null,
  };
}

function unprovable(snapshot, reason, blocker = null) {
  return certifyProjection(Object.freeze({
    ...resultBase(snapshot),
    code: 'TOPOLOGY_UNPROVABLE',
    reason,
    open_turn: null,
    boundary: boundaryDto(blocker),
  }));
}

function noOpenTurn(snapshot, reason, boundary = null) {
  return certifyProjection(Object.freeze({
    ...resultBase(snapshot),
    code: 'NO_OPEN_TURN',
    reason,
    open_turn: null,
    boundary: boundaryDto(boundary),
  }));
}

function openTurn(snapshot, customerEntries, reason, boundary = null) {
  const ordered = [...customerEntries].reverse();
  return certifyProjection(Object.freeze({
    ...resultBase(snapshot),
    code: 'OPEN_TURN',
    reason,
    open_turn: Object.freeze({
      event_seqs: Object.freeze(ordered.map(entry => entry.event.event_seq)),
      source_message_ids: Object.freeze(ordered.map(entry => entry.event.source_message_id)),
      first_event_seq: ordered[0].event.event_seq,
      last_event_seq: ordered.at(-1).event.event_seq,
      message_count: ordered.length,
    }),
    boundary: boundaryDto(boundary),
  }));
}

function supportedCustomerEvent(event) {
  return event.event_kind === 'CUSTOMER_MESSAGE' &&
    event.message_type === 'incoming' &&
    event.sender_class === 'contact' &&
    event.deleted === false &&
    event.unsupported === false &&
    event.has_attachments === false &&
    event.content_type === 'text';
}

function supportedNeutralTemplate(event) {
  return event.event_kind === 'SYSTEM_TEMPLATE' &&
    event.message_type === 'template' &&
    event.sender_class === 'none' &&
    event.sender_id === null &&
    event.deleted === false &&
    event.unsupported === false &&
    event.has_attachments === false &&
    ['text', 'input_email', 'input_csat'].includes(event.content_type);
}

function supportedConfirmedBabyparkReply(event, confirmedAction) {
  const supportedContentType =
    confirmedAction?.action_type === 'ANSWER'
      ? event.content_type === 'text'
      : confirmedAction?.action_type === 'CLARIFY' &&
        ['text', 'input_select'].includes(event.content_type);

  return event.event_kind === 'BABYPARK_PUBLIC_REPLY' &&
    event.message_type === 'outgoing' &&
    event.sender_class === 'configured_agent_bot' &&
    event.deleted === false &&
    event.unsupported === false &&
    event.has_attachments === false &&
    supportedContentType &&
    confirmedAction &&
    confirmedAction.action_id === event.source_id &&
    ['ANSWER', 'CLARIFY'].includes(confirmedAction.action_type) &&
    Number.isSafeInteger(confirmedAction.prepared_stream_revision) &&
    confirmedAction.prepared_stream_revision > 0;
}

export function projectOpenTurn(rawSnapshot) {
  const snapshot = requireSnapshot(rawSnapshot);
  const suffix = snapshot.event_suffix;

  if (suffix.length === 0) {
    return snapshot.suffix_truncated
      ? unprovable(snapshot, 'ROUTING_SUFFIX_LIMIT')
      : noOpenTurn(snapshot, 'NO_ACCEPTED_EVENTS');
  }

  let expectedSeq = suffix[0].event?.event_seq;
  if (!Number.isSafeInteger(expectedSeq) || expectedSeq <= 0) {
    fail('FIRST_LINE_ROUTING_INPUT_INVALID', 'event suffix has invalid first event sequence');
  }
  for (const entry of suffix) {
    if (!entry || typeof entry !== 'object' || !entry.event ||
        entry.event.event_seq !== expectedSeq) {
      fail('FIRST_LINE_ROUTING_INPUT_INVALID', 'event suffix must be contiguous and ordered');
    }
    expectedSeq += 1;
  }
  if (suffix.at(-1).event.event_seq !== snapshot.stream.last_event_seq) {
    fail('FIRST_LINE_ROUTING_INPUT_INVALID', 'event suffix does not reach stream head');
  }

  const customerEntries = [];

  for (let index = suffix.length - 1; index >= 0; index -= 1) {
    const entry = suffix[index];
    const event = entry.event;

    if (event.event_kind === 'SYSTEM_TEMPLATE') {
      if (!supportedNeutralTemplate(event)) {
        return unprovable(snapshot, 'UNSUPPORTED_SYSTEM_TEMPLATE', entry);
      }
      continue;
    }

    if (event.event_kind === 'CUSTOMER_MESSAGE') {
      if (!supportedCustomerEvent(event)) {
        return unprovable(snapshot, 'UNSUPPORTED_CUSTOMER_EVENT', entry);
      }
      customerEntries.push(entry);
      if (customerEntries.length > MAX_OPEN_TURN_EVENTS) {
        return unprovable(snapshot, 'OPEN_TURN_EVENT_LIMIT');
      }
      continue;
    }

    if (event.event_kind === 'BABYPARK_PUBLIC_REPLY') {
      if (!entry.confirmed_babypark_action) {
        return unprovable(snapshot, 'UNCONFIRMED_BABYPARK_REPLY', entry);
      }
      if (!supportedConfirmedBabyparkReply(event, entry.confirmed_babypark_action)) {
        return unprovable(snapshot, 'UNSUPPORTED_CONFIRMED_BABYPARK_REPLY', entry);
      }
      return customerEntries.length > 0
        ? openTurn(snapshot, customerEntries, 'AFTER_CONFIRMED_BABYPARK_REPLY', entry)
        : noOpenTurn(snapshot, 'CONFIRMED_BABYPARK_REPLY_LAST', entry);
    }

    if (event.event_kind === 'HUMAN_PUBLIC_REPLY') {
      return unprovable(snapshot, 'OWNERSHIP_BLOCKER', entry);
    }

    if (BLOCKING_PUBLIC_KINDS.has(event.event_kind)) {
      return unprovable(snapshot, 'OWNERSHIP_BLOCKER', entry);
    }

    return unprovable(snapshot, 'UNKNOWN_EVENT_KIND', entry);
  }

  if (snapshot.suffix_truncated) {
    return unprovable(snapshot, 'ROUTING_SUFFIX_LIMIT');
  }
  if (customerEntries.length === 0) {
    return noOpenTurn(snapshot, 'NO_CUSTOMER_EVENT');
  }
  return openTurn(snapshot, customerEntries, 'FROM_STREAM_START');
}


export function projectConfirmedClarificationBasis(rawSnapshot) {
  const snapshot = requireSnapshot(rawSnapshot);
  const episode = snapshot.active_episode;
  const action = snapshot.confirmed_clarification_action ?? null;
  if (!episode || episode.state !== 'active' ||
      episode.clarification_prompts_sent !== 1 ||
      !action || action.action_type !== 'CLARIFY' ||
      action.state !== 'CONFIRMED' ||
      action.stream_id !== snapshot.stream.stream_id ||
      action.episode_id !== episode.episode_id ||
      !Array.isArray(action.basis_event_seqs) ||
      action.basis_event_seqs.length === 0) {
    fail('FIRST_LINE_ROUTING_INPUT_INVALID',
      'confirmed clarification historical basis is unavailable');
  }

  const bySeq = new Map(
    snapshot.event_suffix.map(entry => [entry.event.event_seq, entry])
  );
  const customerEntries = [];
  for (const eventSeq of action.basis_event_seqs) {
    const entry = bySeq.get(eventSeq);
    if (!entry ||
        entry.event.event_kind !== 'CUSTOMER_MESSAGE' ||
        entry.event.message_type !== 'incoming' ||
        entry.event.sender_class !== 'contact') {
      fail('FIRST_LINE_ROUTING_BASIS_UNAVAILABLE',
        'confirmed clarification basis event is unavailable from certified ledger',
        { event_seq: eventSeq, action_id: action.action_id });
    }
    customerEntries.push(entry);
  }

  const ordered = [...customerEntries].sort(
    (a, b) => a.event.event_seq - b.event.event_seq
  );
  const projection = Object.freeze({
    ...resultBase(snapshot),
    code: 'OPEN_TURN',
    reason: 'CONFIRMED_CLARIFICATION_ORIGINAL_BASIS',
    open_turn: Object.freeze({
      event_seqs: Object.freeze(ordered.map(entry => entry.event.event_seq)),
      source_message_ids: Object.freeze(
        ordered.map(entry => entry.event.source_message_id)
      ),
      first_event_seq: ordered[0].event.event_seq,
      last_event_seq: ordered.at(-1).event.event_seq,
      message_count: ordered.length,
    }),
    boundary: null,
  });
  return certifyProjection(projection);
}
