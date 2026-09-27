import crypto from 'node:crypto';
import fs from 'node:fs';
import YAML from 'yaml';
import { BLOCKER_CODES, Blocker } from '../blockers.mjs';

export function sha256File(filePath) {
  const bytes = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function loadCollisionConfig(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = YAML.parse(raw);
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.mappings)) {
    throw new Error('Invalid collision config schema');
  }
  return {
    raw,
    sha256: crypto.createHash('sha256').update(raw).digest('hex'),
    mappings: parsed.mappings,
  };
}

function validateMappingShape(mapping) {
  if (!mapping || typeof mapping !== 'object') {
    return 'mapping must be an object';
  }
  if (!mapping.sku_key || !mapping.action || !mapping.reviewed_source || !mapping.reason) {
    return 'mapping missing required fields';
  }
  if (mapping.action === 'exclude_product') {
    const required = [
      'retain_native_product_id',
      'exclude_native_product_id',
    ];
    for (const field of required) {
      if (!mapping[field]) return `exclude_product missing ${field}`;
    }
    return null;
  }
  if (mapping.action === 'exclude_variant') {
    const required = [
      'native_product_id',
      'retain_native_variant_id',
      'exclude_native_variant_id',
    ];
    for (const field of required) {
      if (!mapping[field]) return `exclude_variant missing ${field}`;
    }
    return null;
  }
  return `unsupported action: ${mapping.action}`;
}

export function parseCollisionMappings(config) {
  const mappings = [];
  for (const mapping of config.mappings) {
    const error = validateMappingShape(mapping);
    if (error) {
      throw new Error(error);
    }
    mappings.push(mapping);
  }
  return mappings;
}

function mappingIdentityKey(mapping) {
  if (mapping.action === 'exclude_product') {
    return `exclude_product:${mapping.sku_key}`;
  }
  if (mapping.action === 'exclude_variant') {
    return `exclude_variant:${mapping.native_product_id}:${mapping.sku_key}`;
  }
  return `unsupported:${JSON.stringify(mapping)}`;
}

export function validateCollisionMappingUniqueness(mappings, blockers) {
  const seen = new Map();
  for (const mapping of mappings) {
    const key = mappingIdentityKey(mapping);
    if (seen.has(key)) {
      blockers.add(new Blocker(
        BLOCKER_CODES.COLLISION_MAPPING_UNSUPPORTED,
        'Duplicate or conflicting collision mapping for same collision identity',
        {
          collision_identity: key,
          existing_mapping: seen.get(key),
          conflicting_mapping: mapping,
        }
      ));
      continue;
    }
    seen.set(key, mapping);
  }
}
