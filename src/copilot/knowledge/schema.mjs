export const KNOWLEDGE_SCHEMA_VERSION = 1;

export const KNOWLEDGE_RECORD_TYPES = Object.freeze([
  'OPERATIONAL_FACT',
  'COMMERCE_POLICY',
  'VOCABULARY_ENTRY',
]);

export const KNOWLEDGE_EVENT_TYPES = Object.freeze([
  'DRAFT_CREATED',
  'APPROVED',
  'PUBLISHED',
  'REVOKED',
  'SUPERSEDED',
  'WITHDRAWN',
]);

export function knowledgeSchemaSql(createdAtUtc) {
  const created = String(createdAtUtc).replaceAll("'", "''");
  return `
    PRAGMA foreign_keys=ON;
    PRAGMA journal_mode=DELETE;
    PRAGMA synchronous=FULL;
    PRAGMA user_version=${KNOWLEDGE_SCHEMA_VERSION};

    CREATE TABLE knowledge_meta (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1),
      schema_version INTEGER NOT NULL,
      created_at_utc TEXT NOT NULL
    );
    INSERT INTO knowledge_meta(singleton,schema_version,created_at_utc)
    VALUES(1,${KNOWLEDGE_SCHEMA_VERSION},'${created}');

    CREATE TABLE knowledge_revisions (
      revision_id TEXT PRIMARY KEY,
      record_type TEXT NOT NULL
        CHECK(record_type IN ('OPERATIONAL_FACT','COMMERCE_POLICY','VOCABULARY_ENTRY')),
      schema_version INTEGER NOT NULL,
      namespace TEXT NOT NULL,
      effect_family TEXT NOT NULL,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      scope_json TEXT NOT NULL,
      effect_type TEXT NOT NULL,
      effect_value_json TEXT NOT NULL,
      effective_from_utc TEXT NOT NULL,
      expires_at_utc TEXT,
      parent_revision_id TEXT,
      exception_of_revision_id TEXT,
      author_actor_id TEXT NOT NULL,
      created_at_utc TEXT NOT NULL,
      revision_hash TEXT NOT NULL UNIQUE,
      FOREIGN KEY(parent_revision_id)
        REFERENCES knowledge_revisions(revision_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY(exception_of_revision_id)
        REFERENCES knowledge_revisions(revision_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
    );

    CREATE INDEX knowledge_revisions_subject
      ON knowledge_revisions(subject_type,subject_id,namespace,effect_family);

    CREATE TABLE knowledge_events (
      event_seq INTEGER PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      revision_id TEXT NOT NULL,
      event_type TEXT NOT NULL
        CHECK(event_type IN ('DRAFT_CREATED','APPROVED','PUBLISHED','REVOKED','SUPERSEDED','WITHDRAWN')),
      actor_id TEXT NOT NULL,
      occurred_at_utc TEXT NOT NULL,
      reason TEXT,
      metadata_json TEXT NOT NULL,
      previous_event_hash TEXT,
      event_hash TEXT NOT NULL UNIQUE,
      FOREIGN KEY(revision_id)
        REFERENCES knowledge_revisions(revision_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
    );

    CREATE INDEX knowledge_events_revision
      ON knowledge_events(revision_id,event_seq);

    CREATE TRIGGER knowledge_revisions_no_update
    BEFORE UPDATE ON knowledge_revisions
    BEGIN
      SELECT RAISE(ABORT,'knowledge_revisions_immutable');
    END;

    CREATE TRIGGER knowledge_revisions_no_delete
    BEFORE DELETE ON knowledge_revisions
    BEGIN
      SELECT RAISE(ABORT,'knowledge_revisions_immutable');
    END;

    CREATE TRIGGER knowledge_events_no_update
    BEFORE UPDATE ON knowledge_events
    BEGIN
      SELECT RAISE(ABORT,'knowledge_events_append_only');
    END;

    CREATE TRIGGER knowledge_events_no_delete
    BEFORE DELETE ON knowledge_events
    BEGIN
      SELECT RAISE(ABORT,'knowledge_events_append_only');
    END;
  `;
}

export const KNOWLEDGE_REQUIRED_TABLES = Object.freeze([
  'knowledge_meta',
  'knowledge_revisions',
  'knowledge_events',
]);
