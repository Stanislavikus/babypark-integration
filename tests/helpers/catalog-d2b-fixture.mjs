export const TEST_CONFIG_DIGESTS = Object.freeze({
  'drupal-anomaly-publication-policy': 'b'.repeat(64),
  'drupal-collisions': 'a'.repeat(64),
});

export const TEST_PUBLICATION_AUTHORITY = Object.freeze({
  schema: 'bp.catalog.publication-authority/1',
  spool_schema: 'bp.drupal-exporter.spool/3',
  spool_manifest_sha256: 'c'.repeat(64),
  anomaly_report_sha256: 'd'.repeat(64),
  config_digests: TEST_CONFIG_DIGESTS,
  full_record_contract_version: 2,
  record_validator_version: 3,
  sku_normalizer_version: 1,
  native_identity_scheme: 'bp.drupal.native-identity/1',
  producer_commit: 'e'.repeat(40),
  producer_release_provenance_sha256: 'f'.repeat(64),
});

export function seedD2bConfig(identityStore) {
  for (const [key, digest] of Object.entries(TEST_CONFIG_DIGESTS)) identityStore.setConfigHash(key, digest);
  return identityStore;
}

export function d2bHeader(fields) {
  return { ...fields, schema: 'bp.catalog.run-header/2', publication_authority: TEST_PUBLICATION_AUTHORITY };
}
