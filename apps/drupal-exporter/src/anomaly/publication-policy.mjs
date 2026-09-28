import crypto from 'node:crypto';
import fs from 'node:fs';
import YAML from 'yaml';

const POLICY_SCHEMA = 'bp.catalog.anomaly-publication-policy/1';
const SUPPORTED_ACTIONS = new Set(['QUARANTINE_SOURCE_PRODUCTS']);
const ALLOWED_TOP_LEVEL = new Set(['schema', 'version', 'rules', 'unknown_action']);

export function sha256File(filePath) {
  const bytes = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function loadPublicationPolicy(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = YAML.parse(raw);
  validatePublicationPolicy(parsed);
  return {
    raw,
    sha256: crypto.createHash('sha256').update(raw).digest('hex'),
    policy: parsed,
  };
}

export function validatePublicationPolicy(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid publication policy');
  }

  for (const key of Object.keys(parsed)) {
    if (!ALLOWED_TOP_LEVEL.has(key)) {
      throw new Error(`Unknown publication policy field: ${key}`);
    }
  }

  if (parsed.schema !== POLICY_SCHEMA) {
    throw new Error('Unsupported publication policy schema');
  }
  if (parsed.version !== 1) {
    throw new Error('Unsupported publication policy version');
  }
  if (!parsed.rules || typeof parsed.rules !== 'object') {
    throw new Error('Publication policy rules must be an object');
  }
  if (parsed.unknown_action !== 'BLOCK_RUN') {
    throw new Error('Publication policy unknown_action must be BLOCK_RUN');
  }

  const seenTypes = new Set();
  for (const [anomalyType, rule] of Object.entries(parsed.rules)) {
    if (seenTypes.has(anomalyType)) {
      throw new Error(`Duplicate publication policy rule: ${anomalyType}`);
    }
    seenTypes.add(anomalyType);
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new Error(`Invalid rule for ${anomalyType}`);
    }
    const keys = Object.keys(rule);
    if (keys.length !== 1 || keys[0] !== 'action') {
      throw new Error(`Rule for ${anomalyType} must contain action only`);
    }
    if (!SUPPORTED_ACTIONS.has(rule.action)) {
      throw new Error(`Unsupported publication policy action: ${rule.action}`);
    }
  }
}

export function resolvePublicationAction(policy, anomalyType) {
  const action = policy.rules?.[anomalyType]?.action ?? policy.unknown_action;
  if (action === 'BLOCK_RUN') {
    return null;
  }
  return action;
}

export function deriveQuarantineProductIds(observations, policy) {
  const quarantined = new Set();
  for (const observation of observations) {
    const action = resolvePublicationAction(policy, observation.anomalyType);
    if (action !== 'QUARANTINE_SOURCE_PRODUCTS') {
      throw new Error(`Unsupported anomaly publication action for ${observation.anomalyType}`);
    }
    for (const productId of observation.affectedNativeProductIds) {
      quarantined.add(productId);
    }
  }
  return quarantined;
}
