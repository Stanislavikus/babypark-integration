export const ANOMALY_SCHEMA_VERSION = 1;

export const OBSERVATION_STATES = Object.freeze([
  'OBSERVED',
  'NOT_OBSERVED',
  'CLEARED',
]);

export const REVIEW_STATES = Object.freeze([
  'NEW',
  'ACKNOWLEDGED',
  'INVESTIGATING',
  'PENDING_ADMIN',
  'RESOLVED',
]);

export const INCIDENT_EVENT_TYPES = Object.freeze([
  'OPENED',
  'MATERIAL_EVIDENCE_CHANGED',
  'NOT_OBSERVED',
  'AUTO_CLEARED',
  'REOPENED',
]);

export function anomalySchemaSql(now) {
  const createdAt = String(now).replaceAll("'", "''");

  return `
    PRAGMA foreign_keys=ON;
    PRAGMA journal_mode=DELETE;
    PRAGMA synchronous=FULL;

    CREATE TABLE anomaly_meta (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      schema_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO anomaly_meta(
      singleton, schema_version, created_at, updated_at
    ) VALUES (
      1, ${ANOMALY_SCHEMA_VERSION},
      '${createdAt}',
      '${createdAt}'
    );

    CREATE TABLE incidents (
      incident_id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL UNIQUE,
      anomaly_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      source_epoch TEXT NOT NULL,
      detector_namespace TEXT NOT NULL,
      detector_version INTEGER NOT NULL,
      identifier_kind TEXT NOT NULL,
      identifier_key TEXT NOT NULL,
      observation_state TEXT NOT NULL
        CHECK(observation_state IN ('OBSERVED','NOT_OBSERVED','CLEARED')),
      review_state TEXT NOT NULL
        CHECK(review_state IN ('NEW','ACKNOWLEDGED','INVESTIGATING','PENDING_ADMIN','RESOLVED')),
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      occurrence_count INTEGER NOT NULL,
      consecutive_occurrence_count INTEGER NOT NULL,
      clean_observation_count INTEGER NOT NULL,
      recurrence_count INTEGER NOT NULL,
      last_material_change_at TEXT NOT NULL,
      last_notified_at TEXT,
      material_evidence_sha256 TEXT NOT NULL,
      latest_evidence_json TEXT NOT NULL,
      latest_context_json TEXT NOT NULL
    );

    CREATE INDEX idx_incidents_domain
      ON incidents(provider, source_epoch, detector_namespace, detector_version);

    CREATE TABLE observation_batches (
      batch_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      source_epoch TEXT NOT NULL,
      detector_namespace TEXT NOT NULL,
      detector_version INTEGER NOT NULL,
      authoritative INTEGER NOT NULL CHECK(authoritative IN (0, 1)),
      snapshot_watermark TEXT,
      observation_set_digest TEXT NOT NULL,
      completed_at TEXT NOT NULL
    );

    CREATE TABLE incident_events (
      event_id TEXT PRIMARY KEY,
      incident_id TEXT NOT NULL,
      event_type TEXT NOT NULL
        CHECK(event_type IN (
          'OPENED',
          'MATERIAL_EVIDENCE_CHANGED',
          'NOT_OBSERVED',
          'AUTO_CLEARED',
          'REOPENED'
        )),
      created_at TEXT NOT NULL,
      details_json TEXT NOT NULL,
      FOREIGN KEY(incident_id)
        REFERENCES incidents(incident_id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT
    );

    CREATE INDEX idx_incident_events_incident
      ON incident_events(incident_id, created_at);

    PRAGMA user_version=${ANOMALY_SCHEMA_VERSION};
  `;
}

export const ANOMALY_REQUIRED_TABLES = Object.freeze([
  'anomaly_meta',
  'incidents',
  'observation_batches',
  'incident_events',
]);
