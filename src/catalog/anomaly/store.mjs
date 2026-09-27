import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { anomalyError } from './errors.mjs';
import { computeObservationSetDigest } from './fingerprint.mjs';
import { validateObservation } from './observation.mjs';
import {
  ANOMALY_REQUIRED_TABLES,
  ANOMALY_SCHEMA_VERSION,
  anomalySchemaSql,
} from './schema.mjs';

export const DEFAULT_CLEAN_THRESHOLD = 2;

function requireText(name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw anomalyError(
      'ANOMALY_INVALID_ARGUMENT',
      `${name} must be a non-empty string`,
      { argument: name }
    );
  }
  return value;
}

function tableExists(db, table) {
  return Boolean(
    db.prepare(
      'SELECT 1 FROM sqlite_master WHERE type=? AND name=?'
    ).get('table', table)
  );
}

function integrityCheck(db) {
  return db.prepare('PRAGMA integrity_check').all()
    .map(row => String(Object.values(row)[0]));
}

function transaction(db, fn) {
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

function defaultIncidentId() {
  return `inc_${crypto.randomUUID()}`;
}

function defaultEventId() {
  return `evt_${crypto.randomUUID()}`;
}

export class AnomalyStore {
  static createNew(filePath, {
    now = () => new Date().toISOString(),
  } = {}) {
    const resolved = path.resolve(filePath);
    const parent = path.dirname(resolved);

    if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
      throw anomalyError(
        'ANOMALY_PARENT_MISSING',
        'Anomaly database parent directory must already exist',
        { parent }
      );
    }

    let fd;
    try {
      fd = fs.openSync(resolved, 'wx', 0o600);
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw anomalyError(
          'ANOMALY_ALREADY_EXISTS',
          'Anomaly database already exists',
          { path: resolved }
        );
      }
      throw error;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }

    let db;
    try {
      db = new DatabaseSync(resolved);
      db.exec(anomalySchemaSql(now()));
      db.close();
      db = null;
      fs.chmodSync(resolved, 0o600);
      return AnomalyStore.openExisting(resolved, { now });
    } catch (error) {
      if (db) {
        try { db.close(); } catch {}
      }
      try { fs.unlinkSync(resolved); } catch {}
      throw error;
    }
  }

  static openExisting(filePath, {
    now = () => new Date().toISOString(),
    readOnly = false,
  } = {}) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      throw anomalyError(
        'ANOMALY_MISSING',
        'Anomaly database is missing; automatic recreation is forbidden',
        { path: resolved }
      );
    }
    if (!fs.statSync(resolved).isFile()) {
      throw anomalyError(
        'ANOMALY_NOT_FILE',
        'Anomaly database path is not a regular file',
        { path: resolved }
      );
    }

    const mode = fs.statSync(resolved).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw anomalyError(
        'ANOMALY_PERMISSIONS_UNSAFE',
        'Anomaly database must not be group/world accessible',
        { path: resolved, mode: mode.toString(8) }
      );
    }

    let store;
    try {
      store = new AnomalyStore(resolved, { now, readOnly });
    } catch (error) {
      throw anomalyError(
        'ANOMALY_OPEN_FAILED',
        'Failed to open anomaly database',
        { path: resolved, cause: error.message }
      );
    }
    store.validate();
    return store;
  }

  constructor(filePath, { now, readOnly = false }) {
    this.filePath = path.resolve(filePath);
    this.now = now;
    this.readOnly = readOnly;
    this.db = new DatabaseSync(this.filePath, {
      readOnly,
      timeout: 5000,
    });
  }

  validate() {
    const integrity = integrityCheck(this.db);
    if (integrity.length !== 1 || integrity[0] !== 'ok') {
      throw anomalyError(
        'ANOMALY_INTEGRITY_FAILED',
        'Anomaly database integrity check failed',
        { results: integrity }
      );
    }

    const userVersion = Number(this.db.prepare('PRAGMA user_version').get().user_version);
    if (userVersion !== ANOMALY_SCHEMA_VERSION) {
      throw anomalyError(
        'ANOMALY_SCHEMA_INCOMPATIBLE',
        'Anomaly database schema version is incompatible',
        { expected: ANOMALY_SCHEMA_VERSION, actual: userVersion }
      );
    }

    for (const table of ANOMALY_REQUIRED_TABLES) {
      if (!tableExists(this.db, table)) {
        throw anomalyError(
          'ANOMALY_SCHEMA_INCOMPLETE',
          'Anomaly database is missing required table',
          { table }
        );
      }
    }

    const meta = this.db.prepare(
      'SELECT schema_version FROM anomaly_meta WHERE singleton = 1'
    ).get();
    if (!meta || Number(meta.schema_version) !== ANOMALY_SCHEMA_VERSION) {
      throw anomalyError(
        'ANOMALY_SCHEMA_INCOMPATIBLE',
        'Anomaly meta schema version is incompatible',
        { expected: ANOMALY_SCHEMA_VERSION, actual: meta?.schema_version ?? null }
      );
    }
  }

  close() {
    this.db.close();
  }

  status() {
    const meta = this.db.prepare(
      'SELECT schema_version, created_at, updated_at FROM anomaly_meta WHERE singleton = 1'
    ).get();
    const incidentCount = this.db.prepare('SELECT COUNT(*) AS count FROM incidents').get().count;
    const batchCount = this.db.prepare('SELECT COUNT(*) AS count FROM observation_batches').get().count;
    const eventCount = this.db.prepare('SELECT COUNT(*) AS count FROM incident_events').get().count;
    return {
      path: this.filePath,
      schema_version: Number(meta.schema_version),
      created_at: meta.created_at,
      updated_at: meta.updated_at,
      incident_count: incidentCount,
      batch_count: batchCount,
      event_count: eventCount,
    };
  }

  listIncidents({ limit = 100, offset = 0 } = {}) {
    return this.db.prepare(`
      SELECT *
      FROM incidents
      ORDER BY fingerprint ASC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
  }

  getIncidentByFingerprint(fingerprint) {
    return this.db.prepare(
      'SELECT * FROM incidents WHERE fingerprint = ?'
    ).get(fingerprint) ?? null;
  }

  listEvents(incidentId) {
    return this.db.prepare(`
      SELECT event_type, created_at, details_json
      FROM incident_events
      WHERE incident_id = ?
      ORDER BY event_id ASC
    `).all(incidentId);
  }

  bumpUpdatedAt(now) {
    this.db.prepare(`
      UPDATE anomaly_meta
      SET updated_at = ?
      WHERE singleton = 1
    `).run(now);
  }

  appendEvent(incidentId, eventType, details = {}, now) {
    this.db.prepare(`
      INSERT INTO incident_events(event_id, incident_id, event_type, created_at, details_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      defaultEventId(),
      incidentId,
      eventType,
      now,
      JSON.stringify(details)
    );
  }

  reconcileAuthoritativeBatch({
    batchId,
    provider,
    sourceEpoch,
    detectorNamespace,
    detectorVersion,
    snapshotWatermark = null,
    observations = [],
    cleanThreshold = DEFAULT_CLEAN_THRESHOLD,
    now = this.now(),
  }) {
    if (this.readOnly) {
      throw anomalyError('ANOMALY_READ_ONLY', 'Anomaly store is read-only');
    }

    requireText('batchId', batchId);
    requireText('provider', provider);
    requireText('sourceEpoch', sourceEpoch);
    requireText('detectorNamespace', detectorNamespace);
    if (!Number.isInteger(detectorVersion) || detectorVersion < 1) {
      throw anomalyError(
        'ANOMALY_INVALID_ARGUMENT',
        'detectorVersion must be a positive integer'
      );
    }
    if (snapshotWatermark !== null) {
      requireText('snapshotWatermark', snapshotWatermark);
    }
    if (!Array.isArray(observations)) {
      throw anomalyError(
        'ANOMALY_INVALID_ARGUMENT',
        'observations must be an array'
      );
    }

    for (const [index, observation] of observations.entries()) {
      try {
        validateObservation(observation);
      } catch (error) {
        throw anomalyError(
          'ANOMALY_INVALID_OBSERVATION',
          'Authoritative batch contains an invalid observation',
          { index, cause: error.message }
        );
      }
      if (observation.provider !== provider ||
          observation.sourceEpoch !== sourceEpoch ||
          observation.detectorNamespace !== detectorNamespace ||
          observation.detectorVersion !== detectorVersion) {
        throw anomalyError(
          'ANOMALY_OBSERVATION_DOMAIN_MISMATCH',
          'Observation identity does not match authoritative batch domain',
          {
            index,
            batch: {
              provider,
              sourceEpoch,
              detectorNamespace,
              detectorVersion,
            },
            observation: {
              provider: observation.provider,
              sourceEpoch: observation.sourceEpoch,
              detectorNamespace: observation.detectorNamespace,
              detectorVersion: observation.detectorVersion,
            },
          }
        );
      }
    }

    const digest = computeObservationSetDigest(observations);
    const existingBatch = this.db.prepare(`
      SELECT provider, source_epoch, detector_namespace, detector_version,
             authoritative, snapshot_watermark, observation_set_digest
      FROM observation_batches
      WHERE batch_id = ?
    `).get(batchId);

    if (existingBatch) {
      const sameIdentity =
        existingBatch.provider === provider &&
        existingBatch.source_epoch === sourceEpoch &&
        existingBatch.detector_namespace === detectorNamespace &&
        Number(existingBatch.detector_version) === detectorVersion &&
        Number(existingBatch.authoritative) === 1 &&
        existingBatch.snapshot_watermark === snapshotWatermark;
      if (!sameIdentity) {
        throw anomalyError(
          'ANOMALY_BATCH_IDENTITY_CONFLICT',
          'Batch ID was reused with different authoritative batch identity',
          {
            batchId,
            expected: {
              provider: existingBatch.provider,
              sourceEpoch: existingBatch.source_epoch,
              detectorNamespace: existingBatch.detector_namespace,
              detectorVersion: Number(existingBatch.detector_version),
              authoritative: Number(existingBatch.authoritative) === 1,
              snapshotWatermark: existingBatch.snapshot_watermark,
            },
            actual: {
              provider,
              sourceEpoch,
              detectorNamespace,
              detectorVersion,
              authoritative: true,
              snapshotWatermark,
            },
          }
        );
      }
      if (existingBatch.observation_set_digest !== digest) {
        throw anomalyError(
          'ANOMALY_BATCH_DIGEST_CONFLICT',
          'Batch ID was reused with a different observation set digest',
          { batchId, expected: existingBatch.observation_set_digest, actual: digest }
        );
      }
      return {
        idempotent: true,
        batch_id: batchId,
        observation_set_digest: digest,
        observed_count: observations.length,
        transitions: [],
      };
    }

    const transitions = [];

    return transaction(this.db, () => {
      this.db.prepare(`
        INSERT INTO observation_batches(
          batch_id, provider, source_epoch, detector_namespace, detector_version,
          authoritative, snapshot_watermark, observation_set_digest, completed_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
      `).run(
        batchId,
        provider,
        sourceEpoch,
        detectorNamespace,
        detectorVersion,
        snapshotWatermark,
        digest,
        now
      );

      const observedFingerprints = new Set();
      for (const observation of observations) {
        observedFingerprints.add(observation.fingerprint);
        const transition = this.#observeIncident(observation, now);
        if (transition) transitions.push(transition);
      }

      const domainIncidents = this.db.prepare(`
        SELECT *
        FROM incidents
        WHERE provider = ?
          AND source_epoch = ?
          AND detector_namespace = ?
          AND detector_version = ?
      `).all(provider, sourceEpoch, detectorNamespace, detectorVersion);

      for (const incident of domainIncidents) {
        if (observedFingerprints.has(incident.fingerprint)) continue;
        const transition = this.#markAbsentIncident(incident, cleanThreshold, now);
        if (transition) transitions.push(transition);
      }

      this.bumpUpdatedAt(now);

      return {
        idempotent: false,
        batch_id: batchId,
        observation_set_digest: digest,
        observed_count: observations.length,
        transitions,
      };
    });
  }

  #observeIncident(observation, now) {
    const existing = this.getIncidentByFingerprint(observation.fingerprint);
    const evidenceJson = JSON.stringify(observation.materialEvidence);
    const contextJson = JSON.stringify(observation.context ?? {});

    if (!existing) {
      const incidentId = defaultIncidentId();
      this.db.prepare(`
        INSERT INTO incidents(
          incident_id, fingerprint, anomaly_type, provider, source_epoch,
          detector_namespace, detector_version, identifier_kind, identifier_key,
          observation_state, review_state, first_seen_at, last_seen_at,
          occurrence_count, consecutive_occurrence_count, clean_observation_count,
          recurrence_count, last_material_change_at, last_notified_at,
          material_evidence_sha256, latest_evidence_json, latest_context_json
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OBSERVED', 'NEW', ?, ?, 1, 1, 0, 0, ?, NULL, ?, ?, ?
        )
      `).run(
        incidentId,
        observation.fingerprint,
        observation.anomalyType,
        observation.provider,
        observation.sourceEpoch,
        observation.detectorNamespace,
        observation.detectorVersion,
        observation.identifierKind,
        observation.identifierKey,
        now,
        now,
        now,
        observation.materialEvidenceSha256,
        evidenceJson,
        contextJson
      );
      this.appendEvent(incidentId, 'OPENED', { fingerprint: observation.fingerprint }, now);
      return { fingerprint: observation.fingerprint, event: 'OPENED' };
    }

    const wasAbsent = existing.observation_state !== 'OBSERVED';
    const wasCleared = existing.observation_state === 'CLEARED';
    const materialChanged = existing.material_evidence_sha256 !== observation.materialEvidenceSha256;
    const events = [];

    let recurrenceCount = existing.recurrence_count;
    if (wasCleared) {
      recurrenceCount += 1;
      events.push('REOPENED');
    }
    if (materialChanged) {
      events.push('MATERIAL_EVIDENCE_CHANGED');
    }

    this.db.prepare(`
      UPDATE incidents
      SET observation_state = 'OBSERVED',
          last_seen_at = ?,
          occurrence_count = occurrence_count + 1,
          consecutive_occurrence_count = CASE
            WHEN ? THEN 1
            ELSE consecutive_occurrence_count + 1
          END,
          clean_observation_count = 0,
          recurrence_count = ?,
          last_material_change_at = CASE WHEN ? THEN ? ELSE last_material_change_at END,
          material_evidence_sha256 = ?,
          latest_evidence_json = ?,
          latest_context_json = ?
      WHERE incident_id = ?
    `).run(
      now,
      wasAbsent ? 1 : 0,
      recurrenceCount,
      materialChanged ? 1 : 0,
      now,
      observation.materialEvidenceSha256,
      evidenceJson,
      contextJson,
      existing.incident_id
    );

    for (const eventType of events) {
      this.appendEvent(existing.incident_id, eventType, {
        fingerprint: observation.fingerprint,
      }, now);
    }

    if (events.length === 0) return null;
    return { fingerprint: observation.fingerprint, events };
  }

  #markAbsentIncident(incident, cleanThreshold, now) {
    if (incident.observation_state === 'CLEARED') {
      return null;
    }

    const nextCleanCount = incident.clean_observation_count + 1;
    if (incident.observation_state === 'OBSERVED' && nextCleanCount === 1) {
      this.db.prepare(`
        UPDATE incidents
        SET observation_state = 'NOT_OBSERVED',
            consecutive_occurrence_count = 0,
            clean_observation_count = ?
        WHERE incident_id = ?
      `).run(nextCleanCount, incident.incident_id);
      this.appendEvent(incident.incident_id, 'NOT_OBSERVED', {}, now);
      return { fingerprint: incident.fingerprint, event: 'NOT_OBSERVED' };
    }

    if (nextCleanCount >= cleanThreshold) {
      this.db.prepare(`
        UPDATE incidents
        SET observation_state = 'CLEARED',
            consecutive_occurrence_count = 0,
            clean_observation_count = ?
        WHERE incident_id = ?
      `).run(nextCleanCount, incident.incident_id);
      this.appendEvent(incident.incident_id, 'AUTO_CLEARED', {}, now);
      return { fingerprint: incident.fingerprint, event: 'AUTO_CLEARED' };
    }

    this.db.prepare(`
      UPDATE incidents
      SET clean_observation_count = ?
      WHERE incident_id = ?
    `).run(nextCleanCount, incident.incident_id);
    return null;
  }
}
