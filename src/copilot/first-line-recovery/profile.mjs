import crypto from 'node:crypto';
import fs from 'node:fs';
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import path from 'node:path';
import {
  canonicalBackupJson,
  createEncryptedSqliteBackup,
  sha256Buffer,
  verifyAndRestoreEncryptedSqliteBackup,
} from '../../ops/durable-sqlite-backup.mjs';
import {
  FirstLineStateStore,
  SCHEMA_VERSION,
} from '../first-line-state-store.mjs';

export const FIRST_LINE_RECOVERY_EVIDENCE_SCHEMA =
  'bp.first-line-recovery-evidence/1';

export class FirstLineRecoveryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FirstLineRecoveryError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new FirstLineRecoveryError(code, message, details);
}

function sortedCounts(rows, field) {
  const out = {};
  for (const row of rows) {
    const value = row[field] === null ? 'NULL' : String(row[field]);
    out[value] = Number(row.n);
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(out).sort(([a], [b]) => a.localeCompare(b))
    )
  );
}

function count(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
}

function enumerateSemanticRows(filePath) {
  const db = new DatabaseSync(path.resolve(filePath), { readOnly: true });
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
    const streamIds = db.prepare(
      'SELECT stream_id FROM conversation_streams ORDER BY stream_id'
    ).all().map(row => row.stream_id);
    const episodeIds = db.prepare(
      'SELECT episode_id FROM episodes ORDER BY episode_id'
    ).all().map(row => row.episode_id);
    const actionIds = db.prepare(
      'SELECT action_id FROM public_actions ORDER BY action_id'
    ).all().map(row => row.action_id);
    const origins = db.prepare(
      'SELECT stream_id,stream_revision,origin_kind FROM semantic_origins ' +
      'ORDER BY stream_id,stream_revision'
    ).all();
    const owners = db.prepare(
      'SELECT stream_id,stream_revision,owner_kind,terminal_outcome ' +
      'FROM continuation_owners ORDER BY stream_id,stream_revision'
    ).all();
    const deferred = db.prepare(
      'SELECT stream_id,event_seq FROM deferred_event_parents ' +
      'ORDER BY stream_id,event_seq'
    ).all();
    const recoveryBarriers = db.prepare(
      'SELECT recovery_epoch,authority_key,reason,entered_at,completion_kind,' +
      'completed_at FROM recovery_barriers ORDER BY recovery_epoch'
    ).all();

    return Object.freeze({
      streamIds,
      episodeIds,
      actionIds,
      origins,
      owners,
      deferred,
      recoveryBarriers,
      summary: Object.freeze({
        schema_version: Number(
          db.prepare('PRAGMA user_version').get().user_version
        ),
        rows: Object.freeze({
          conversation_streams: count(db, 'conversation_streams'),
          conversation_events: count(db, 'conversation_events'),
          episodes: count(db, 'episodes'),
          episode_slots: count(db, 'episode_slots'),
          episode_constraint_latches: count(db, 'episode_constraint_latches'),
          public_actions: count(db, 'public_actions'),
          public_action_source_events: count(db, 'public_action_source_events'),
          public_action_confirmation_cuts: count(
            db,
            'public_action_confirmation_cuts'
          ),
          public_action_human_cuts: count(db, 'public_action_human_cuts'),
          public_action_candidate_sets: count(
            db,
            'public_action_candidate_sets'
          ),
          public_action_candidates: count(db, 'public_action_candidates'),
          public_action_descriptors: count(db, 'public_action_descriptors'),
          legacy_v3_actions: count(db, 'legacy_v3_actions'),
          semantic_origins: count(db, 'semantic_origins'),
          continuation_owners: count(db, 'continuation_owners'),
          deferred_event_parents: count(db, 'deferred_event_parents'),
          recovery_barriers: count(db, 'recovery_barriers'),
          non_actionable_ack_cuts: count(db, 'non_actionable_ack_cuts'),
          human_terminal_cuts: count(db, 'human_terminal_cuts'),
        }),
        event_kinds: sortedCounts(
          db.prepare(
            'SELECT event_kind,COUNT(*) AS n FROM conversation_events ' +
            'GROUP BY event_kind ORDER BY event_kind'
          ).all(),
          'event_kind'
        ),
        episode_states: sortedCounts(
          db.prepare(
            'SELECT state,COUNT(*) AS n FROM episodes ' +
            'GROUP BY state ORDER BY state'
          ).all(),
          'state'
        ),
        action_states: sortedCounts(
          db.prepare(
            'SELECT state,COUNT(*) AS n FROM public_actions ' +
            'GROUP BY state ORDER BY state'
          ).all(),
          'state'
        ),
        origin_kinds: sortedCounts(
          db.prepare(
            'SELECT origin_kind,COUNT(*) AS n FROM semantic_origins ' +
            'GROUP BY origin_kind ORDER BY origin_kind'
          ).all(),
          'origin_kind'
        ),
        owner_kinds: sortedCounts(
          db.prepare(
            'SELECT owner_kind,COUNT(*) AS n FROM continuation_owners ' +
            'GROUP BY owner_kind ORDER BY owner_kind'
          ).all(),
          'owner_kind'
        ),
        owner_terminal_outcomes: sortedCounts(
          db.prepare(
            "SELECT COALESCE(terminal_outcome,'UNRESOLVED') AS " +
            'terminal_outcome,COUNT(*) AS n FROM continuation_owners ' +
            'GROUP BY terminal_outcome ORDER BY terminal_outcome'
          ).all(),
          'terminal_outcome'
        ),
      }),
    });
  } finally {
    db.close();
  }
}

function assertRecoveryBarrierRows(inventory, activeBarrier) {
  const active = inventory.recoveryBarriers.filter(
    row => row.completion_kind === null
  );
  if (active.length > 1) {
    fail(
      'FIRST_LINE_RECOVERY_BARRIER_INVALID',
      'multiple active recovery barriers exist'
    );
  }
  if ((activeBarrier === null) !== (active.length === 0)) {
    fail(
      'FIRST_LINE_RECOVERY_BARRIER_INVALID',
      'active recovery barrier view differs from persisted rows'
    );
  }
  if (activeBarrier &&
      activeBarrier.recovery_epoch !== active[0].recovery_epoch) {
    fail(
      'FIRST_LINE_RECOVERY_BARRIER_INVALID',
      'active recovery barrier identity mismatch'
    );
  }
  for (const row of inventory.recoveryBarriers) {
    const complete = row.completion_kind !== null;
    if (!Number.isSafeInteger(row.recovery_epoch) ||
        row.recovery_epoch < 1 ||
        row.authority_key !== 1 ||
        typeof row.reason !== 'string' ||
        row.reason.length === 0 ||
        !Number.isSafeInteger(row.entered_at) ||
        row.entered_at < 0 ||
        complete !== (row.completed_at !== null) ||
        (complete && row.completion_kind !== 'LOSSLESS_SEMANTIC_CUT') ||
        (row.completed_at !== null &&
          (!Number.isSafeInteger(row.completed_at) ||
           row.completed_at < row.entered_at))) {
      fail(
        'FIRST_LINE_RECOVERY_BARRIER_INVALID',
        'persisted recovery barrier metadata is invalid'
      );
    }
  }
}

function duplicateAdmissionInput(event) {
  return {
    sourceMessageId: event.source_message_id,
    eventKind: event.event_kind,
    messageType: event.message_type,
    senderClass: event.sender_class,
    senderId: event.sender_id,
    contentType: event.content_type,
    deleted: event.deleted,
    unsupported: event.unsupported,
    hasAttachments: event.has_attachments,
    sourceId: event.source_id,
  };
}

export function buildFirstLineRecoveryEvidence(filePath) {
  const inventory = enumerateSemanticRows(filePath);
  if (inventory.summary.schema_version !== SCHEMA_VERSION) {
    fail(
      'FIRST_LINE_RECOVERY_SCHEMA_INVALID',
      'First Line recovery source must use the current schema version',
      {
        expected: SCHEMA_VERSION,
        actual: inventory.summary.schema_version,
      }
    );
  }

  const store = FirstLineStateStore.open(filePath);
  try {
    const changesBefore = Number(
      store.db.prepare('SELECT total_changes() AS n').get().n
    );
    for (const streamId of inventory.streamIds) {
      const stream = store.getConversationStream(streamId);
      if (!stream) {
        fail(
          'FIRST_LINE_RECOVERY_STREAM_MISSING',
          'enumerated stream disappeared'
        );
      }
      const events = store.listConversationEvents(streamId);
      if (events.length !== stream.last_event_seq) {
        fail(
          'FIRST_LINE_RECOVERY_EVENT_COVERAGE_INVALID',
          'validated stream event count differs from durable head'
        );
      }
      if (events.length > 0) {
        // Reuse the existing duplicate-admission path because it invokes the
        // state store's complete deferred/cut/ownership attestation before it
        // returns the already accepted event. The exact source event guarantees
        // the idempotent branch; total_changes below proves no data mutation.
        const replay = store.ingestConversationEvent(
          streamId,
          duplicateAdmissionInput(events[0])
        );
        if (replay.inserted !== false) {
          fail(
            'FIRST_LINE_RECOVERY_ATTESTATION_MUTATED',
            'semantic attestation unexpectedly inserted an event'
          );
        }
      }
      store.getUnresolvedContinuationOwner(streamId);
    }
    const changesAfter = Number(
      store.db.prepare('SELECT total_changes() AS n').get().n
    );
    if (changesAfter !== changesBefore) {
      fail(
        'FIRST_LINE_RECOVERY_ATTESTATION_MUTATED',
        'semantic attestation changed durable rows',
        { before: changesBefore, after: changesAfter }
      );
    }

    // Comprehensive state-store attestation above completed without mutation.
    // Lock the remaining traversal to read-only at SQLite level.
    store.db.exec('PRAGMA query_only=ON');

    for (const episodeId of inventory.episodeIds) {
      const episode = store.getEpisode(episodeId);
      if (!episode) {
        fail(
          'FIRST_LINE_RECOVERY_EPISODE_MISSING',
          'enumerated episode disappeared'
        );
      }
      store.listEpisodeConstraintLatches(episodeId);
    }

    for (const actionId of inventory.actionIds) {
      const action = store.getPublicAction(actionId);
      if (!action) {
        fail(
          'FIRST_LINE_RECOVERY_ACTION_MISSING',
          'enumerated action disappeared'
        );
      }
    }

    for (const row of inventory.origins) {
      const origin = store.getSemanticOrigin(
        row.stream_id,
        row.stream_revision
      );
      if (!origin) {
        fail(
          'FIRST_LINE_RECOVERY_ORIGIN_MISSING',
          'enumerated semantic origin disappeared'
        );
      }
    }

    for (const row of inventory.owners) {
      const owner = store.getContinuationOwner(
        row.stream_id,
        row.stream_revision
      );
      if (!owner) {
        fail(
          'FIRST_LINE_RECOVERY_OWNER_MISSING',
          'enumerated continuation owner disappeared'
        );
      }
    }

    for (const row of inventory.deferred) {
      const parent = store.getDeferredEventParent(
        row.stream_id,
        row.event_seq
      );
      if (!parent) {
        fail(
          'FIRST_LINE_RECOVERY_DEFERRED_PARENT_MISSING',
          'enumerated deferred parent disappeared'
        );
      }
    }

    // This existing read-only listing path invokes the state store's own
    // deferred-topology attestation for every live recoverable action stream.
    const recoverableActions = store.listRecoverablePublicActions();

    const activeBarrier = store.getActiveRecoveryBarrier();
    assertRecoveryBarrierRows(inventory, activeBarrier);

    const body = Object.freeze({
      schema: FIRST_LINE_RECOVERY_EVIDENCE_SCHEMA,
      schema_version: SCHEMA_VERSION,
      row_counts: inventory.summary.rows,
      event_kinds: inventory.summary.event_kinds,
      episode_states: inventory.summary.episode_states,
      action_states: inventory.summary.action_states,
      origin_kinds: inventory.summary.origin_kinds,
      owner_kinds: inventory.summary.owner_kinds,
      owner_terminal_outcomes:
        inventory.summary.owner_terminal_outcomes,
      recoverable_action_count: recoverableActions.length,
      recovery_barriers: Object.freeze({
        total: inventory.recoveryBarriers.length,
        active: activeBarrier === null ? 0 : 1,
        completed: inventory.recoveryBarriers.filter(
          row => row.completion_kind !== null
        ).length,
      }),
    });

    return Object.freeze({
      ...body,
      evidence_sha256: sha256Buffer(
        Buffer.from(canonicalBackupJson(body), 'utf8')
      ),
    });
  } finally {
    store.close();
  }
}

export function verifyFirstLineRecoveryEvidence(
  filePath,
  expectedEvidence
) {
  if (!expectedEvidence ||
      expectedEvidence.schema !==
        FIRST_LINE_RECOVERY_EVIDENCE_SCHEMA) {
    fail(
      'FIRST_LINE_RECOVERY_EVIDENCE_SCHEMA_INVALID',
      'First Line recovery evidence schema is invalid'
    );
  }

  const actual = buildFirstLineRecoveryEvidence(filePath);
  if (canonicalBackupJson(actual) !==
      canonicalBackupJson(expectedEvidence)) {
    throw new FirstLineRecoveryError(
      'FIRST_LINE_RECOVERY_SEMANTIC_MISMATCH',
      'restored First Line semantic evidence differs from backup evidence',
      {
        expected_sha256:
          expectedEvidence.evidence_sha256 ?? null,
        actual_sha256: actual.evidence_sha256,
      }
    );
  }

  return Object.freeze({
    ok: true,
    evidence_sha256: actual.evidence_sha256,
    schema_version: actual.schema_version,
    row_counts: actual.row_counts,
    recoverable_action_count: actual.recoverable_action_count,
    recovery_barriers: actual.recovery_barriers,
  });
}

async function withFrozenFirstLineSource(
  sourcePath,
  artifactPath,
  fn
) {
  const source = path.resolve(sourcePath);
  const artifact = path.resolve(artifactPath);
  const artifactDir = path.dirname(artifact);
  // SQLite backup() creates plaintext with the process umask (often 0644).
  // The unchanged generic core also stages plaintext in this directory.
  // Require a private parent before either stage can create a file.
  const parent = fs.statSync(artifactDir);
  const effectiveUid = typeof process.geteuid === 'function'
    ? process.geteuid() : null;
  if (!parent.isDirectory() ||
      parent.uid !== effectiveUid ||
      (parent.mode & 0o077) !== 0) {
    fail(
      'FIRST_LINE_BACKUP_PARENT_INSECURE',
      'First Line backup directory must be owner-private (0700)'
    );
  }
  const snapshotPath = path.join(
    artifactDir,
    `.${path.basename(artifact)}.first-line-source-snapshot.` +
      `${process.pid}.${crypto.randomUUID()}.sqlite`
  );

  let sourceDb = null;
  try {
    sourceDb = new DatabaseSync(source, { readOnly: true });
    sourceDb.exec('PRAGMA busy_timeout=5000');
    await sqliteBackup(sourceDb, snapshotPath);
    sourceDb.close();
    sourceDb = null;
    fs.chmodSync(snapshotPath, 0o600);
    return await fn(snapshotPath);
  } finally {
    try { sourceDb?.close(); } catch {}
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try { fs.rmSync(snapshotPath + suffix, { force: true }); } catch {}
    }
  }
}

export async function createFirstLineEncryptedBackup({
  sourcePath,
  artifactPath,
  manifestPath,
  masterKey,
  keyId,
  createdAtUtc,
}) {
  // Freeze one SQLite-consistent source image first. Semantic evidence and the
  // encrypted artifact are both derived from this immutable snapshot, avoiding
  // a live-write race between semantic traversal and the generic backup step.
  return withFrozenFirstLineSource(
    sourcePath,
    artifactPath,
    async frozenPath => {
      const semanticEvidence =
        buildFirstLineRecoveryEvidence(frozenPath);
      return createEncryptedSqliteBackup({
        sourcePath: frozenPath,
        artifactPath,
        manifestPath,
        masterKey,
        keyId,
        semanticEvidence,
        createdAtUtc,
      });
    }
  );
}

export async function verifyAndRestoreFirstLineBackup({
  artifactPath,
  manifestPath,
  scratchPath,
  masterKey,
  expectedKeyId = null,
}) {
  return verifyAndRestoreEncryptedSqliteBackup({
    artifactPath,
    manifestPath,
    scratchPath,
    masterKey,
    expectedKeyId,
    semanticVerifier: async (
      restoredPath,
      expectedEvidence
    ) => verifyFirstLineRecoveryEvidence(
      restoredPath,
      expectedEvidence
    ),
  });
}

export function decodeFirstLineBackupKeyBase64(value) {
  if (typeof value !== 'string' || value === '') {
    throw new TypeError('backup key is required');
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 ||
      key.toString('base64').replace(/=+$/, '') !==
        value.replace(/=+$/, '')) {
    throw new TypeError(
      'backup key must be canonical base64 for exactly 32 bytes'
    );
  }
  return key;
}
