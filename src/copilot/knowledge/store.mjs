import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  canonicalKnowledgeJson,
  canonicalKnowledgeTimestamp,
  knowledgeSha256,
  parseCanonicalKnowledgeJson,
} from './canonical.mjs';
import {
  KNOWLEDGE_EVENT_TYPES,
  KNOWLEDGE_RECORD_TYPES,
  KNOWLEDGE_REQUIRED_TABLES,
  KNOWLEDGE_SCHEMA_VERSION,
  knowledgeSchemaSql,
} from './schema.mjs';
import {
  assertSupersessionCompatible,
  knowledgeRequiresApproval,
  validateKnowledgePublishEnvelope,
} from './publication-policy.mjs';

export class KnowledgeStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'KnowledgeStoreError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new KnowledgeStoreError(code, message, details);
}
function text(name, value) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    throw new TypeError(`${name} must be non-empty text`);
  }
  return value;
}

function optionalText(name, value) {
  if (value === null || value === undefined) return null;
  return text(name, value);
}

function positiveInt(name, value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function tableExists(db, name) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
  ).get(name));
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
function defaultIds() {
  return {
    revision: () => `kr_${crypto.randomUUID()}`,
    event: () => `ke_${crypto.randomUUID()}`,
  };
}

function storedTimestamp(name, value) {
  const normalized = canonicalKnowledgeTimestamp(value, name);
  if (normalized !== value) {
    throw new TypeError(`${name} must be canonical UTC Z`);
  }
  return value;
}

function revisionBody(row) {
  if (!KNOWLEDGE_RECORD_TYPES.includes(row.record_type)) {
    throw new TypeError('record_type is not supported');
  }
  positiveInt('schema_version', row.schema_version);
  for (const [name, value] of [
    ['revision_id', row.revision_id],
    ['namespace', row.namespace],
    ['effect_family', row.effect_family],
    ['subject_type', row.subject_type],
    ['subject_id', row.subject_id],
    ['effect_type', row.effect_type],
    ['author_actor_id', row.author_actor_id],
  ]) text(name, value);
  optionalText('parent_revision_id', row.parent_revision_id);
  optionalText('exception_of_revision_id', row.exception_of_revision_id);
  const effective = storedTimestamp('effective_from_utc', row.effective_from_utc);
  const expires = row.expires_at_utc === null
    ? null
    : storedTimestamp('expires_at_utc', row.expires_at_utc);
  if (expires !== null && Date.parse(effective) >= Date.parse(expires)) {
    throw new TypeError('stored expiry must be after effective_from_utc');
  }
  return {
    revision_id: row.revision_id,
    record_type: row.record_type,
    schema_version: row.schema_version,
    namespace: row.namespace,
    effect_family: row.effect_family,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    scope_json: parseCanonicalKnowledgeJson(row.scope_json, 'scope_json'),
    effect_type: row.effect_type,
    effect_value_json: parseCanonicalKnowledgeJson(
      row.effect_value_json,
      'effect_value_json'
    ),
    effective_from_utc: effective,
    expires_at_utc: expires,
    parent_revision_id: row.parent_revision_id,
    exception_of_revision_id: row.exception_of_revision_id,
    author_actor_id: row.author_actor_id,
    created_at_utc: storedTimestamp('created_at_utc', row.created_at_utc),
  };
}
function eventBody(row) {
  text('event_id', row.event_id);
  positiveInt('event_seq', row.event_seq);
  text('revision_id', row.revision_id);
  if (!KNOWLEDGE_EVENT_TYPES.includes(row.event_type)) {
    throw new TypeError('event_type is not supported');
  }
  text('actor_id', row.actor_id);
  optionalText('reason', row.reason);
  if (
    row.previous_event_hash !== null &&
    !/^[a-f0-9]{64}$/.test(row.previous_event_hash)
  ) {
    throw new TypeError('previous_event_hash must be null or lowercase SHA-256');
  }
  return {
    event_id: row.event_id,
    event_seq: row.event_seq,
    revision_id: row.revision_id,
    event_type: row.event_type,
    actor_id: row.actor_id,
    occurred_at_utc: storedTimestamp('occurred_at_utc', row.occurred_at_utc),
    reason: row.reason,
    metadata_json: parseCanonicalKnowledgeJson(
      row.metadata_json,
      'metadata_json'
    ),
    previous_event_hash: row.previous_event_hash,
  };
}

function policyGuard(fn) {
  try { return fn(); }
  catch (error) {
    if (error?.code) {
      fail(error.code, error.message, error.details ?? {});
    }
    throw error;
  }
}

function revisionHistoryState(revision, events, {
  revisionsById,
  publishedSeqByRevision,
} = {}) {
  if (!events.length || events[0].event_type !== 'DRAFT_CREATED') {
    fail(
      'KNOWLEDGE_DRAFT_EVENT_INVALID',
      'Every revision must begin with DRAFT_CREATED',
      { revision_id: revision.revision_id }
    );
  }
  if (events.filter(row => row.event_type === 'DRAFT_CREATED').length !== 1) {
    fail(
      'KNOWLEDGE_DRAFT_EVENT_INVALID',
      'Every revision must contain exactly one DRAFT_CREATED',
      { revision_id: revision.revision_id }
    );
  }
  if (events[0].actor_id !== revision.author_actor_id) {
    fail(
      'KNOWLEDGE_DRAFT_AUTHOR_MISMATCH',
      'DRAFT_CREATED actor must match revision author',
      { revision_id: revision.revision_id }
    );
  }

  const approvalRequired = knowledgeRequiresApproval(revision);
  let index = 1;
  let approved = false;

  if (events[index]?.event_type === 'APPROVED') {
    if (!approvalRequired) {
      fail(
        'KNOWLEDGE_APPROVAL_NOT_REQUIRED',
        'Direct-publish revision cannot enter APPROVED state',
        { revision_id: revision.revision_id }
      );
    }
    if (
      revision.record_type === 'COMMERCE_POLICY' &&
      events[index].actor_id === revision.author_actor_id
    ) {
      fail(
        'KNOWLEDGE_SELF_APPROVAL_FORBIDDEN',
        'CommercePolicy author cannot approve own revision',
        { revision_id: revision.revision_id }
      );
    }
    approved = true;
    index += 1;
  }

  if (events[index]?.event_type === 'WITHDRAWN') {
    if (index !== events.length - 1) {
      fail(
        'KNOWLEDGE_TERMINAL_STATE_VIOLATION',
        'No event may follow WITHDRAWN',
        { revision_id: revision.revision_id }
      );
    }
    return 'WITHDRAWN';
  }

  if (!events[index]) {
    return approved ? 'APPROVED' : 'DRAFT';
  }

  if (events[index].event_type !== 'PUBLISHED') {
    fail(
      'KNOWLEDGE_STATE_TRANSITION_INVALID',
      'Invalid Knowledge revision state transition',
      {
        revision_id: revision.revision_id,
        event_type: events[index].event_type,
      }
    );
  }

  if (approvalRequired && !approved) {
    fail(
      'KNOWLEDGE_APPROVAL_REQUIRED',
      'Revision requires APPROVED before PUBLISHED',
      { revision_id: revision.revision_id }
    );
  }
  policyGuard(() => validateKnowledgePublishEnvelope(revision));
  index += 1;

  if (!events[index]) return 'PUBLISHED';
  if (index !== events.length - 1) {
    fail(
      'KNOWLEDGE_TERMINAL_STATE_VIOLATION',
      'Authority-changing terminal event must be final',
      { revision_id: revision.revision_id }
    );
  }

  const terminal = events[index];
  if (terminal.event_type === 'REVOKED') return 'REVOKED';

  if (terminal.event_type === 'SUPERSEDED') {
    const metadata = parseCanonicalKnowledgeJson(
      terminal.metadata_json,
      'metadata_json'
    );
    const successorId = metadata?.successor_revision_id;
    text('successor_revision_id', successorId);
    const successor = revisionsById?.get(successorId);
    if (!successor) {
      fail(
        'KNOWLEDGE_SUPERSESSION_SUCCESSOR_MISSING',
        'SUPERSEDED must reference an existing successor revision',
        { revision_id: revision.revision_id, successor_revision_id: successorId }
      );
    }
    policyGuard(() => assertSupersessionCompatible(revision, successor));
    const successorPublishedSeq = publishedSeqByRevision?.get(successorId);
    if (
      !Number.isSafeInteger(successorPublishedSeq) ||
      successorPublishedSeq >= terminal.event_seq
    ) {
      fail(
        'KNOWLEDGE_SUPERSESSION_SUCCESSOR_NOT_PUBLISHED',
        'SUPERSEDED successor must already be published',
        { revision_id: revision.revision_id, successor_revision_id: successorId }
      );
    }
    return 'SUPERSEDED';
  }

  fail(
    'KNOWLEDGE_STATE_TRANSITION_INVALID',
    'PUBLISHED revision may only become REVOKED or SUPERSEDED',
    { revision_id: revision.revision_id, event_type: terminal.event_type }
  );
}

function inspectFile(resolved) {
  if (!fs.existsSync(resolved)) {
    fail('KNOWLEDGE_MISSING', 'Knowledge database is missing', { path: resolved });
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    fail('KNOWLEDGE_NOT_FILE', 'Knowledge database path is not a regular file');
  }
  const mode = stat.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    fail(
      'KNOWLEDGE_PERMISSIONS_UNSAFE',
      'Knowledge database must not be group/world accessible',
      { mode: mode.toString(8) }
    );
  }
}
export class KnowledgeStore {
  static createNew(filePath, {
    now = () => new Date().toISOString(),
    idFactory = defaultIds(),
  } = {}) {
    const resolved = path.resolve(filePath);
    const parent = path.dirname(resolved);
    if (!fs.existsSync(parent)) {
      fail('KNOWLEDGE_PARENT_MISSING', 'Knowledge database parent is missing');
    }
    if (fs.existsSync(resolved)) {
      fail('KNOWLEDGE_ALREADY_EXISTS', 'Knowledge database already exists');
    }
    const createdAt = canonicalKnowledgeTimestamp(now(), 'created_at_utc');
    const fd = fs.openSync(resolved, 'wx', 0o600);
    fs.closeSync(fd);
    const db = new DatabaseSync(resolved);
    try {
      db.exec(knowledgeSchemaSql(createdAt));
    } catch (error) {
      try { db.close(); } catch {}
      fs.rmSync(resolved, { force: true });
      throw error;
    }
    db.close();
    fs.chmodSync(resolved, 0o600);
    return KnowledgeStore.openExisting(resolved, { now, idFactory });
  }

  static openExisting(filePath, {
    now = () => new Date().toISOString(),
    idFactory = defaultIds(),
    readOnly = false,
  } = {}) {
    const resolved = path.resolve(filePath);
    inspectFile(resolved);
    const db = new DatabaseSync(resolved, { readOnly });
    try {
      db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      const integrity = db.prepare('PRAGMA integrity_check').get()?.integrity_check;
      if (integrity !== 'ok') {
        fail('KNOWLEDGE_INTEGRITY_FAILED', 'SQLite integrity check failed');
      }
      const version = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
      if (version !== KNOWLEDGE_SCHEMA_VERSION) {
        fail('KNOWLEDGE_SCHEMA_MISMATCH', 'Knowledge schema version mismatch', {
          expected: KNOWLEDGE_SCHEMA_VERSION,
          actual: version,
        });
      }
      const missing = KNOWLEDGE_REQUIRED_TABLES.filter(name => !tableExists(db, name));
      if (missing.length) {
        fail('KNOWLEDGE_SCHEMA_INCOMPLETE', 'Knowledge schema is incomplete', {
          missing_tables: missing,
        });
      }
      const meta = db.prepare(
        'SELECT schema_version FROM knowledge_meta WHERE singleton=1'
      ).get();
      if (!meta || Number(meta.schema_version) !== KNOWLEDGE_SCHEMA_VERSION) {
        fail('KNOWLEDGE_META_INVALID', 'Knowledge metadata is invalid');
      }
      const journal = String(
        db.prepare('PRAGMA journal_mode').get()?.journal_mode ?? ''
      ).toLowerCase();
      if (journal !== 'delete') {
        fail(
          'KNOWLEDGE_JOURNAL_MODE_UNSAFE',
          'Knowledge database must use DELETE journal mode',
          { journal_mode: journal }
        );
      }
    } catch (error) {
      try { db.close(); } catch {}
      throw error;
    }
    db.close();
    const store = new KnowledgeStore(resolved, { now, idFactory, readOnly });
    try {
      store.verifyLedger();
      return store;
    } catch (error) {
      try { store.close(); } catch {}
      throw error;
    }
  }

  constructor(filePath, { now, idFactory, readOnly }) {
    this.filePath = filePath;
    this.now = now;
    this.idFactory = idFactory;
    this.readOnly = readOnly;
    this.db = new DatabaseSync(filePath, { readOnly, timeout: 5000 });
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  }

  close() {
    this.db.close();
  }

  assertWritable() {
    if (this.readOnly) {
      fail('KNOWLEDGE_READ_ONLY', 'KnowledgeStore is read-only');
    }
  }
  metadata() {
    return this.db.prepare('SELECT * FROM knowledge_meta WHERE singleton=1').get();
  }

  getRevision(revisionId) {
    text('revisionId', revisionId);
    return this.db.prepare(
      'SELECT * FROM knowledge_revisions WHERE revision_id=?'
    ).get(revisionId);
  }

  eventsForRevision(revisionId) {
    text('revisionId', revisionId);
    return this.db.prepare(
      'SELECT * FROM knowledge_events WHERE revision_id=? ORDER BY event_seq'
    ).all(revisionId);
  }

  stats() {
    return {
      revisions: Number(
        this.db.prepare('SELECT count(*) n FROM knowledge_revisions').get().n
      ),
      events: Number(
        this.db.prepare('SELECT count(*) n FROM knowledge_events').get().n
      ),
      event_head_hash: this.db.prepare(
        'SELECT event_hash FROM knowledge_events ORDER BY event_seq DESC LIMIT 1'
      ).get()?.event_hash ?? null,
    };
  }
  createDraft({
    recordType,
    schemaVersion = 1,
    namespace,
    effectFamily,
    subjectType,
    subjectId,
    scope = {},
    effectType,
    effectValue,
    effectiveFromUtc,
    expiresAtUtc = null,
    parentRevisionId = null,
    exceptionOfRevisionId = null,
    authorActorId,
    reason = null,
    metadata = {},
  }) {
    this.assertWritable();
    if (!KNOWLEDGE_RECORD_TYPES.includes(recordType)) {
      throw new TypeError('recordType is not supported');
    }
    positiveInt('schemaVersion', schemaVersion);
    for (const [name, value] of [
      ['namespace', namespace],
      ['effectFamily', effectFamily],
      ['subjectType', subjectType],
      ['subjectId', subjectId],
      ['effectType', effectType],
      ['authorActorId', authorActorId],
    ]) text(name, value);
    optionalText('parentRevisionId', parentRevisionId);
    optionalText('exceptionOfRevisionId', exceptionOfRevisionId);
    optionalText('reason', reason);
    const effective = canonicalKnowledgeTimestamp(
      effectiveFromUtc,
      'effectiveFromUtc'
    );
    const expires = expiresAtUtc === null
      ? null
      : canonicalKnowledgeTimestamp(expiresAtUtc, 'expiresAtUtc');
    if (expires !== null && Date.parse(effective) >= Date.parse(expires)) {
      throw new TypeError('expiresAtUtc must be after effectiveFromUtc');
    }

    const scopeJson = canonicalKnowledgeJson(scope);
    const effectJson = canonicalKnowledgeJson(effectValue);
    const metadataJson = canonicalKnowledgeJson(metadata);
    const createdAt = canonicalKnowledgeTimestamp(this.now(), 'created_at_utc');
    const revisionId = text('generated revision id', this.idFactory.revision());
    const eventId = text('generated event id', this.idFactory.event());

    return tx(this.db, () => {
      this.verifyLedger();
      if (parentRevisionId && !this.getRevision(parentRevisionId)) {
        fail('KNOWLEDGE_PARENT_MISSING', 'Parent revision does not exist');
      }
      if (exceptionOfRevisionId && !this.getRevision(exceptionOfRevisionId)) {
        fail('KNOWLEDGE_EXCEPTION_PARENT_MISSING', 'Exception parent does not exist');
      }
      const revision = {
        revision_id: revisionId,
        record_type: recordType,
        schema_version: schemaVersion,
        namespace,
        effect_family: effectFamily,
        subject_type: subjectType,
        subject_id: subjectId,
        scope_json: JSON.parse(scopeJson),
        effect_type: effectType,
        effect_value_json: JSON.parse(effectJson),
        effective_from_utc: effective,
        expires_at_utc: expires,
        parent_revision_id: parentRevisionId,
        exception_of_revision_id: exceptionOfRevisionId,
        author_actor_id: authorActorId,
        created_at_utc: createdAt,
      };
      const revisionHash = knowledgeSha256(revision);

      this.db.prepare(`
        INSERT INTO knowledge_revisions(
          revision_id,record_type,schema_version,namespace,effect_family,
          subject_type,subject_id,scope_json,effect_type,effect_value_json,
          effective_from_utc,expires_at_utc,parent_revision_id,
          exception_of_revision_id,author_actor_id,created_at_utc,revision_hash
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        revisionId, recordType, schemaVersion, namespace, effectFamily,
        subjectType, subjectId, scopeJson, effectType, effectJson,
        effective, expires, parentRevisionId, exceptionOfRevisionId,
        authorActorId, createdAt, revisionHash
      );

      const head = this.db.prepare(
        'SELECT event_seq,event_hash FROM knowledge_events ORDER BY event_seq DESC LIMIT 1'
      ).get();
      const eventSeq = Number(head?.event_seq ?? 0) + 1;
      const previousEventHash = head?.event_hash ?? null;
      const event = {
        event_id: eventId,
        event_seq: eventSeq,
        revision_id: revisionId,
        event_type: 'DRAFT_CREATED',
        actor_id: authorActorId,
        occurred_at_utc: createdAt,
        reason,
        metadata_json: JSON.parse(metadataJson),
        previous_event_hash: previousEventHash,
      };
      const eventHash = knowledgeSha256(event);
      this.db.prepare(`
        INSERT INTO knowledge_events(
          event_seq,event_id,revision_id,event_type,actor_id,occurred_at_utc,
          reason,metadata_json,previous_event_hash,event_hash
        ) VALUES(?,?,?,?,?,?,?,?,?,?)
      `).run(
        eventSeq, eventId, revisionId, 'DRAFT_CREATED', authorActorId,
        createdAt, reason, metadataJson, previousEventHash, eventHash
      );

      const result = Object.freeze({
        revision_id: revisionId,
        revision_hash: revisionHash,
        event_id: eventId,
        event_seq: eventSeq,
        event_hash: eventHash,
      });
      this.verifyLedger();
      return result;
    });
  }

  #requireRevisionLocked(revisionId) {
    text('revisionId', revisionId);
    const revision = this.getRevision(revisionId);
    if (!revision) {
      fail(
        'KNOWLEDGE_REVISION_NOT_FOUND',
        'Knowledge revision does not exist',
        { revision_id: revisionId }
      );
    }
    return revision;
  }

  #currentStateLocked(revisionId) {
    const last = this.db.prepare(
      'SELECT event_type FROM knowledge_events WHERE revision_id=? ORDER BY event_seq DESC LIMIT 1'
    ).get(revisionId);
    return {
      DRAFT_CREATED: 'DRAFT',
      APPROVED: 'APPROVED',
      PUBLISHED: 'PUBLISHED',
      WITHDRAWN: 'WITHDRAWN',
      REVOKED: 'REVOKED',
      SUPERSEDED: 'SUPERSEDED',
    }[last?.event_type] ?? null;
  }

  #appendEventLocked({
    revisionId,
    eventType,
    actorId,
    reason = null,
    metadata = {},
  }) {
    text('revisionId', revisionId);
    if (!KNOWLEDGE_EVENT_TYPES.includes(eventType) || eventType === 'DRAFT_CREATED') {
      throw new TypeError('eventType is not a supported authority transition');
    }
    text('actorId', actorId);
    optionalText('reason', reason);
    const metadataJson = canonicalKnowledgeJson(metadata);
    const occurredAt = canonicalKnowledgeTimestamp(this.now(), 'occurred_at_utc');
    const eventId = text('generated event id', this.idFactory.event());
    const head = this.db.prepare(
      'SELECT event_seq,event_hash FROM knowledge_events ORDER BY event_seq DESC LIMIT 1'
    ).get();
    const eventSeq = Number(head?.event_seq ?? 0) + 1;
    const previousEventHash = head?.event_hash ?? null;
    const event = {
      event_id: eventId,
      event_seq: eventSeq,
      revision_id: revisionId,
      event_type: eventType,
      actor_id: actorId,
      occurred_at_utc: occurredAt,
      reason,
      metadata_json: JSON.parse(metadataJson),
      previous_event_hash: previousEventHash,
    };
    const eventHash = knowledgeSha256(event);
    this.db.prepare(`
      INSERT INTO knowledge_events(
        event_seq,event_id,revision_id,event_type,actor_id,occurred_at_utc,
        reason,metadata_json,previous_event_hash,event_hash
      ) VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run(
      eventSeq, eventId, revisionId, eventType, actorId, occurredAt,
      reason, metadataJson, previousEventHash, eventHash
    );
    return Object.freeze({
      event_id: eventId,
      event_seq: eventSeq,
      event_hash: eventHash,
      event_type: eventType,
      revision_id: revisionId,
    });
  }

  approveRevision({
    revisionId,
    actorId,
    reason = null,
    metadata = {},
  }) {
    this.assertWritable();
    return tx(this.db, () => {
      this.verifyLedger();
      const revision = this.#requireRevisionLocked(revisionId);
      if (!knowledgeRequiresApproval(revision)) {
        fail(
          'KNOWLEDGE_APPROVAL_NOT_REQUIRED',
          'Direct-publish revision does not accept APPROVED',
          { revision_id: revisionId }
        );
      }
      if (this.#currentStateLocked(revisionId) !== 'DRAFT') {
        fail(
          'KNOWLEDGE_STATE_TRANSITION_INVALID',
          'APPROVED requires DRAFT state',
          { revision_id: revisionId }
        );
      }
      if (
        revision.record_type === 'COMMERCE_POLICY' &&
        actorId === revision.author_actor_id
      ) {
        fail(
          'KNOWLEDGE_SELF_APPROVAL_FORBIDDEN',
          'CommercePolicy author cannot approve own revision',
          { revision_id: revisionId }
        );
      }
      const event = this.#appendEventLocked({
        revisionId,
        eventType: 'APPROVED',
        actorId,
        reason,
        metadata,
      });
      this.verifyLedger();
      return event;
    });
  }

  withdrawRevision({
    revisionId,
    actorId,
    reason = null,
    metadata = {},
  }) {
    this.assertWritable();
    return tx(this.db, () => {
      this.verifyLedger();
      this.#requireRevisionLocked(revisionId);
      const state = this.#currentStateLocked(revisionId);
      if (state !== 'DRAFT' && state !== 'APPROVED') {
        fail(
          'KNOWLEDGE_STATE_TRANSITION_INVALID',
          'WITHDRAWN requires DRAFT or APPROVED state',
          { revision_id: revisionId, state }
        );
      }
      const event = this.#appendEventLocked({
        revisionId,
        eventType: 'WITHDRAWN',
        actorId,
        reason,
        metadata,
      });
      this.verifyLedger();
      return event;
    });
  }

  publishRevision({
    revisionId,
    actorId,
    reason = null,
    metadata = {},
    supersedeRevisionId = null,
  }) {
    this.assertWritable();
    return tx(this.db, () => {
      this.verifyLedger();
      const revision = this.#requireRevisionLocked(revisionId);
      const required = knowledgeRequiresApproval(revision);
      const state = this.#currentStateLocked(revisionId);
      if (
        (required && state !== 'APPROVED') ||
        (!required && state !== 'DRAFT')
      ) {
        fail(
          required ? 'KNOWLEDGE_APPROVAL_REQUIRED' : 'KNOWLEDGE_STATE_TRANSITION_INVALID',
          required
            ? 'Revision requires APPROVED before PUBLISHED'
            : 'Direct-publish revision requires DRAFT state',
          { revision_id: revisionId, state }
        );
      }
      policyGuard(() => validateKnowledgePublishEnvelope(revision));

      let predecessor = null;
      if (supersedeRevisionId !== null) {
        text('supersedeRevisionId', supersedeRevisionId);
        if (supersedeRevisionId === revisionId) {
          fail(
            'KNOWLEDGE_SUPERSESSION_SELF',
            'Revision cannot supersede itself',
            { revision_id: revisionId }
          );
        }
        predecessor = this.#requireRevisionLocked(supersedeRevisionId);
        if (this.#currentStateLocked(supersedeRevisionId) !== 'PUBLISHED') {
          fail(
            'KNOWLEDGE_SUPERSESSION_PREDECESSOR_NOT_PUBLISHED',
            'Supersession predecessor must be PUBLISHED',
            { predecessor_revision_id: supersedeRevisionId }
          );
        }
        policyGuard(() => assertSupersessionCompatible(predecessor, revision));
      }

      const published = this.#appendEventLocked({
        revisionId,
        eventType: 'PUBLISHED',
        actorId,
        reason,
        metadata,
      });
      if (!predecessor) {
        this.verifyLedger();
        return Object.freeze({ published, superseded: null });
      }
      const superseded = this.#appendEventLocked({
        revisionId: predecessor.revision_id,
        eventType: 'SUPERSEDED',
        actorId,
        reason,
        metadata: { successor_revision_id: revisionId },
      });
      this.verifyLedger();
      return Object.freeze({ published, superseded });
    });
  }

  revokeRevision({
    revisionId,
    actorId,
    reason = null,
    metadata = {},
  }) {
    this.assertWritable();
    return tx(this.db, () => {
      this.verifyLedger();
      this.#requireRevisionLocked(revisionId);
      const state = this.#currentStateLocked(revisionId);
      if (state !== 'PUBLISHED') {
        fail(
          'KNOWLEDGE_STATE_TRANSITION_INVALID',
          'REVOKED requires PUBLISHED state',
          { revision_id: revisionId, state }
        );
      }
      const event = this.#appendEventLocked({
        revisionId,
        eventType: 'REVOKED',
        actorId,
        reason,
        metadata,
      });
      this.verifyLedger();
      return event;
    });
  }

  verifyLedger() {
    const revisions = this.db.prepare(
      'SELECT * FROM knowledge_revisions ORDER BY revision_id'
    ).all();
    const byRevision = new Map();

    for (const row of revisions) {
      let expected;
      try { expected = knowledgeSha256(revisionBody(row)); }
      catch (error) {
        fail('KNOWLEDGE_REVISION_INVALID', error.message, {
          revision_id: row.revision_id,
        });
      }
      if (expected !== row.revision_hash) {
        fail('KNOWLEDGE_REVISION_HASH_MISMATCH', 'Revision hash mismatch', {
          revision_id: row.revision_id,
        });
      }
      byRevision.set(row.revision_id, row);
    }

    const events = this.db.prepare(
      'SELECT * FROM knowledge_events ORDER BY event_seq'
    ).all();
    const eventsByRevision = new Map();
    const publishedSeqByRevision = new Map();
    let previousHash = null;

    for (let index = 0; index < events.length; index++) {
      const row = events[index];
      const expectedSeq = index + 1;
      if (row.event_seq !== expectedSeq) {
        fail('KNOWLEDGE_EVENT_SEQUENCE_INVALID', 'Event sequence is not contiguous', {
          expected: expectedSeq,
          actual: row.event_seq,
        });
      }
      if (row.previous_event_hash !== previousHash) {
        fail('KNOWLEDGE_EVENT_CHAIN_INVALID', 'Event chain linkage mismatch', {
          event_seq: row.event_seq,
        });
      }
      if (!byRevision.has(row.revision_id)) {
        fail('KNOWLEDGE_EVENT_REVISION_MISSING', 'Event revision is missing', {
          event_seq: row.event_seq,
        });
      }
      let expectedHash;
      try { expectedHash = knowledgeSha256(eventBody(row)); }
      catch (error) {
        fail('KNOWLEDGE_EVENT_INVALID', error.message, {
          event_seq: row.event_seq,
        });
      }
      if (expectedHash !== row.event_hash) {
        fail('KNOWLEDGE_EVENT_HASH_MISMATCH', 'Event hash mismatch', {
          event_seq: row.event_seq,
        });
      }
      const revisionEvents = eventsByRevision.get(row.revision_id) ?? [];
      revisionEvents.push(row);
      eventsByRevision.set(row.revision_id, revisionEvents);
      if (
        row.event_type === 'PUBLISHED' &&
        !publishedSeqByRevision.has(row.revision_id)
      ) {
        publishedSeqByRevision.set(row.revision_id, row.event_seq);
      }
      previousHash = row.event_hash;
    }

    for (const revision of revisions) {
      revisionHistoryState(
        revision,
        eventsByRevision.get(revision.revision_id) ?? [],
        {
          revisionsById: byRevision,
          publishedSeqByRevision,
        }
      );
    }

    return Object.freeze({
      ok: true,
      revisions: revisions.length,
      events: events.length,
      event_head_hash: previousHash,
    });
  }
}
