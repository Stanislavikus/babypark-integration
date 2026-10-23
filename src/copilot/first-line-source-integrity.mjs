// Shared transient comparison of persisted v4 *metadata* with one current
// Chatwoot authoritative row. No customer body, hash or attachment URL.
const EVENT_FIELDS = Object.freeze([
  ['source_message_id', 'sourceMessageId'],
  ['event_kind', 'eventKind'],
  ['message_type', 'messageType'],
  ['sender_class', 'senderClass'],
  ['sender_id', 'senderId'],
  ['content_type', 'contentType'],
  ['deleted', 'deleted'],
  ['unsupported', 'unsupported'],
  ['has_attachments', 'hasAttachments'],
  ['source_id', 'sourceId'],
]);

export function sameFirstLineSourceEvent(stored, current) {
  if (!stored || typeof stored !== 'object' ||
      !current || typeof current !== 'object') return false;
  return EVENT_FIELDS.every(([persisted, live]) =>
    Object.hasOwn(stored, persisted) &&
    Object.hasOwn(current, live) &&
    stored[persisted] === current[live]
  );
}
