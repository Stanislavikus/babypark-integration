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
  KNOWLEDGE_RECORD_TYPES,
  KNOWLEDGE_REQUIRED_TABLES,
  KNOWLEDGE_SCHEMA_VERSION,
  knowledgeSchemaSql,
} from './schema.mjs';

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

function revisionBody(row) {
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
    effective_from_utc: row.effective_from_utc,
    expires_at_utc: row.expires_at_utc,
    parent_revision_id: row.parent_revision_id,
    exception_of_revision_id: row.exception_of_revision_id,
    author_actor_id: row.author_actor_id,
    created_at_utc: row.created_at_utc,
  };
}
function eventBody(row) {
  return {
    event_id: row.event_id,
    event_seq: row.event_seq,
    revision_id: row.revision_id,
    event_type: row.event_type,
    actor_id: row.actor_id,
    occurred_at_utc: row.occurred_at_utc,
    reason: row.reason,
    metadata_json: parseCanonicalKnowledgeJson(
      row.metadata_json,
      'metadata_json'
    ),
    previous_event_hash: row.previous_event_hash,
  };
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
    store.verifyLedger();
    return store;
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

      return Object.freeze({
        revision_id: revisionId,
        revision_hash: revisionHash,
        event_id: eventId,
        event_seq: eventSeq,
        event_hash: eventHash,
      });
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
    const firstEvent = new Map();
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
      if (!firstEvent.has(row.revision_id)) {
        firstEvent.set(row.revision_id, row);
      }
      previousHash = row.event_hash;
    }

    for (const revision of revisions) {
      const first = firstEvent.get(revision.revision_id);
      if (!first || first.event_type !== 'DRAFT_CREATED') {
        fail(
          'KNOWLEDGE_DRAFT_EVENT_MISSING',
          'Every revision must begin with DRAFT_CREATED',
          { revision_id: revision.revision_id }
        );
      }
      if (first.actor_id !== revision.author_actor_id) {
        fail(
          'KNOWLEDGE_DRAFT_AUTHOR_MISMATCH',
          'DRAFT_CREATED actor must match revision author',
          { revision_id: revision.revision_id }
        );
      }
    }

    return Object.freeze({
      ok: true,
      revisions: revisions.length,
      events: events.length,
      event_head_hash: previousHash,
    });
  }
}
