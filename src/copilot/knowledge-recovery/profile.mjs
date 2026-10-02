import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalKnowledgeJson,
  knowledgeSha256,
} from '../knowledge/canonical.mjs';
import { KnowledgeStore } from '../knowledge/store.mjs';
import { resolveStoreOperationalState } from '../knowledge/operational-resolver.mjs';
import { resolveCommercePolicy } from '../knowledge/commerce-policy.mjs';
import {
  createEncryptedSqliteBackup,
  verifyAndRestoreEncryptedSqliteBackup,
} from '../../ops/durable-sqlite-backup.mjs';

export const KNOWLEDGE_RECOVERY_EVIDENCE_SCHEMA =
  'bp.knowledge-recovery-evidence/1';

function canonicalProbePlan(plan = {}) {
  const operational = Array.isArray(plan.operational) ? plan.operational : [];
  const commerce = Array.isArray(plan.commerce) ? plan.commerce : [];
  return Object.freeze({
    operational: Object.freeze(operational.map(item => Object.freeze({
      id: String(item.id),
      nowUtc: String(item.nowUtc),
      storeId: String(item.storeId),
    }))),
    commerce: Object.freeze(commerce.map(item => Object.freeze({
      id: String(item.id),
      nowUtc: String(item.nowUtc),
      subjectType: String(item.subjectType),
      subjectId: String(item.subjectId),
      effectFamily: String(item.effectFamily),
      bindings: Object.freeze({ ...(item.bindings ?? {}) }),
    }))),
  });
}

export function buildKnowledgeRecoveryEvidence(filePath, probePlan = {}) {
  const plan = canonicalProbePlan(probePlan);
  const store = KnowledgeStore.openExisting(filePath, { readOnly: true });
  try {
    const ledger = store.verifyLedger();
    const snapshot = store.authoritySnapshot();
    const operational = plan.operational.map(probe => Object.freeze({
      id: probe.id,
      input: probe,
      result: resolveStoreOperationalState(store, {
        nowUtc: probe.nowUtc,
        storeId: probe.storeId,
      }),
    }));
    const commerce = plan.commerce.map(probe => Object.freeze({
      id: probe.id,
      input: probe,
      result: resolveCommercePolicy(store, {
        nowUtc: probe.nowUtc,
        subjectType: probe.subjectType,
        subjectId: probe.subjectId,
        effectFamily: probe.effectFamily,
        bindings: probe.bindings,
      }),
    }));
    const body = {
      schema: KNOWLEDGE_RECOVERY_EVIDENCE_SCHEMA,
      ledger: {
        revisions: ledger.revisions,
        events: ledger.events,
        event_head_hash: ledger.event_head_hash,
      },
      authority_snapshot_sha256: knowledgeSha256(snapshot),
      probe_plan: plan,
      operational_results: operational,
      commerce_results: commerce,
    };
    return Object.freeze({
      ...body,
      evidence_sha256: knowledgeSha256(body),
    });
  } finally {
    store.close();
  }
}

export function verifyKnowledgeRecoveryEvidence(filePath, expectedEvidence) {
  if (!expectedEvidence ||
      expectedEvidence.schema !== KNOWLEDGE_RECOVERY_EVIDENCE_SCHEMA) {
    throw new Error('knowledge_recovery_evidence_schema_invalid');
  }
  const actual = buildKnowledgeRecoveryEvidence(
    filePath,
    expectedEvidence.probe_plan
  );
  if (canonicalKnowledgeJson(actual) !== canonicalKnowledgeJson(expectedEvidence)) {
    const error = new Error('knowledge_recovery_semantic_mismatch');
    error.code = 'KNOWLEDGE_RECOVERY_SEMANTIC_MISMATCH';
    error.expected_sha256 = expectedEvidence.evidence_sha256;
    error.actual_sha256 = actual.evidence_sha256;
    throw error;
  }
  return Object.freeze({
    ok: true,
    evidence_sha256: actual.evidence_sha256,
    ledger: actual.ledger,
    operational_probes: actual.operational_results.length,
    commerce_probes: actual.commerce_results.length,
  });
}

function readProbePlan(probePlanPath) {
  if (probePlanPath === null || probePlanPath === undefined) {
    return {};
  }
  const resolved = path.resolve(probePlanPath);
  const value = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('probe plan must be a JSON object');
  }
  return value;
}

export async function createKnowledgeEncryptedBackup({
  sourcePath,
  artifactPath,
  manifestPath,
  masterKey,
  keyId,
  probePlan = {},
  probePlanPath = null,
  createdAtUtc,
}) {
  const plan = probePlanPath ? readProbePlan(probePlanPath) : probePlan;
  const semanticEvidence = buildKnowledgeRecoveryEvidence(sourcePath, plan);
  return createEncryptedSqliteBackup({
    sourcePath,
    artifactPath,
    manifestPath,
    masterKey,
    keyId,
    semanticEvidence,
    createdAtUtc,
  });
}

export async function verifyAndRestoreKnowledgeBackup({
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
    semanticVerifier: async (restoredPath, expectedEvidence) =>
      verifyKnowledgeRecoveryEvidence(restoredPath, expectedEvidence),
  });
}

export function decodeBackupKeyBase64(value) {
  if (typeof value !== 'string' || value === '') {
    throw new TypeError('backup key is required');
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64').replace(/=+$/,'') !==
      value.replace(/=+$/,'')) {
    throw new TypeError('backup key must be canonical base64 for exactly 32 bytes');
  }
  return key;
}
