export const PROVIDER = 'drupal';
export const SOURCE_EPOCH = 'drupal-prod-v1';
export const FULL_RECORD_SCHEMA = 'bp.catalog.full-record/2';
export const CHUNK_BODY_BYTE_LIMIT = 1_048_576;

export const SUPPORTED_AUTHORITY_LANGUAGES = ['ru', 'uk'];

export const STATUS_WEIGHT_MAP = Object.freeze({
  1: 'IN_STOCK',
  2: 'EXPECTED',
  3: 'OUT_OF_STOCK',
  4: 'DISCONTINUED',
  5: 'MADE_TO_ORDER',
});

export const EXCLUDED_PRODUCT_TYPES = new Set(['product_kit']);
