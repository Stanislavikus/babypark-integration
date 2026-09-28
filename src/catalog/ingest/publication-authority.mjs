import { FULL_RECORD_CONTRACT_VERSION, RECORD_VALIDATOR_VERSION } from './full-record-v2.mjs';
import { SKU_NORMALIZER_VERSION } from './dependency-fingerprint.mjs';
import { HEADER_SCHEMA_V2 } from './run-protocol.mjs';

export const DRUPAL_SPOOL_SCHEMA = 'bp.drupal-exporter.spool/3';
export const NATIVE_IDENTITY_SCHEME = 'bp.drupal.native-identity/1';
export const REQUIRED_CONFIG_KEYS = Object.freeze([
  'drupal-anomaly-publication-policy',
  'drupal-collisions',
]);

export class PublicationAuthorityError extends Error {
  constructor(code, message) { super(message); this.name = 'PublicationAuthorityError'; this.code = code; }
}
const fail = (code, message) => { throw new PublicationAuthorityError(code, message); };

export function identityConfigDigests(identityStore) {
  return Object.fromEntries(identityStore.db.prepare(
    'SELECT config_key,sha256 FROM config_state ORDER BY config_key'
  ).all().map(row => [row.config_key, row.sha256]));
}

export function validateProductionPublicationAuthority(header, identityStore) {
  if (header.schema !== HEADER_SCHEMA_V2) fail('RUN_HEADER_V2_REQUIRED', 'New production FULL requires run-header/2');
  const authority = header.publication_authority;
  const supported = [
    ['spool_schema', DRUPAL_SPOOL_SCHEMA, 'PUBLICATION_SPOOL_SCHEMA_UNSUPPORTED'],
    ['full_record_contract_version', FULL_RECORD_CONTRACT_VERSION, 'PUBLICATION_FULL_CONTRACT_UNSUPPORTED'],
    ['record_validator_version', RECORD_VALIDATOR_VERSION, 'PUBLICATION_RECORD_VALIDATOR_UNSUPPORTED'],
    ['sku_normalizer_version', SKU_NORMALIZER_VERSION, 'PUBLICATION_SKU_NORMALIZER_UNSUPPORTED'],
    ['native_identity_scheme', NATIVE_IDENTITY_SCHEME, 'PUBLICATION_NATIVE_IDENTITY_UNSUPPORTED'],
  ];
  for (const [field, expected, code] of supported) {
    if (authority[field] !== expected) fail(code, `Unsupported ${field}`);
  }
  const signed = authority.config_digests;
  const live = identityConfigDigests(identityStore);
  const exactKeys = value => Object.keys(value).sort().join('\0') === REQUIRED_CONFIG_KEYS.join('\0');
  if (!exactKeys(signed) || !exactKeys(live) ||
      REQUIRED_CONFIG_KEYS.some(key => signed[key] !== live[key])) {
    fail('CONFIG_AUTHORITY_MISMATCH', 'Signed publication config authority differs from IdentityStore');
  }
  return authority;
}
