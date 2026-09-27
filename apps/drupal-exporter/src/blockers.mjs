export const BLOCKER_CODES = Object.freeze({
  SOURCE_UNSTABLE: 'SOURCE_UNSTABLE',
  UNSUPPORTED_LANGUAGE: 'UNSUPPORTED_LANGUAGE',
  CATEGORY_ID_COLLISION: 'CATEGORY_ID_COLLISION',
  CATEGORY_PARENT_MISSING: 'CATEGORY_PARENT_MISSING',
  CATEGORY_PARENT_CONFLICT: 'CATEGORY_PARENT_CONFLICT',
  CATEGORY_CYCLE: 'CATEGORY_CYCLE',
  BRAND_MULTIPLE: 'BRAND_MULTIPLE',
  STATUS_INVALID: 'STATUS_INVALID',
  VARIANT_STATUS_INVALID: 'VARIANT_STATUS_INVALID',
  VARIANT_STATUS_AMBIGUOUS: 'VARIANT_STATUS_AMBIGUOUS',
  PHP_COMBINATION_INVALID: 'PHP_COMBINATION_INVALID',
  VARIANT_COMBINATION_INVALID: 'VARIANT_COMBINATION_INVALID',
  VARIANT_DEFAULT_INVALID: 'VARIANT_DEFAULT_INVALID',
  SKU_COLLISION_CROSS_PRODUCT: 'SKU_COLLISION_CROSS_PRODUCT',
  SKU_COLLISION_WITHIN_PRODUCT: 'SKU_COLLISION_WITHIN_PRODUCT',
  COLLISION_MAPPING_STALE: 'COLLISION_MAPPING_STALE',
  COLLISION_MAPPING_UNSUPPORTED: 'COLLISION_MAPPING_UNSUPPORTED',
  PRICE_NOT_MINOR_ALIGNED: 'PRICE_NOT_MINOR_ALIGNED',
  PRICE_NEGATIVE: 'PRICE_NEGATIVE',
  IMAGE_SCHEME_UNSUPPORTED: 'IMAGE_SCHEME_UNSUPPORTED',
  FULL_RECORD_INVALID: 'FULL_RECORD_INVALID',
  RECORD_TOO_LARGE: 'RECORD_TOO_LARGE',
  URL_ALIAS_MULTIPLE: 'URL_ALIAS_MULTIPLE',
  CATEGORY_REFERENCE_MISSING: 'CATEGORY_REFERENCE_MISSING',
  BRAND_REFERENCE_MISSING: 'BRAND_REFERENCE_MISSING',
  STOCK_DUPLICATE_NORMALIZED: 'STOCK_DUPLICATE_NORMALIZED',
});

export class Blocker {
  constructor(code, message, details = {}) {
    this.code = code;
    this.message = message;
    this.details = details;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export class BlockerCollection {
  constructor() {
    this.blockers = [];
    this.warnings = [];
  }

  add(blocker) {
    this.blockers.push(blocker);
  }

  addWarning(warning) {
    this.warnings.push(warning);
  }

  hasBlockers() {
    return this.blockers.length > 0;
  }

  sortBlockers() {
    this.blockers.sort((a, b) => {
      const keyA = `${a.code}\0${a.message}\0${JSON.stringify(a.details)}`;
      const keyB = `${b.code}\0${b.message}\0${JSON.stringify(b.details)}`;
      return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
    });
    return this;
  }

  toReport() {
    this.sortBlockers();
    const counts = {};
    for (const blocker of this.blockers) {
      counts[blocker.code] = (counts[blocker.code] ?? 0) + 1;
    }
    return {
      blocker_count: this.blockers.length,
      warning_count: this.warnings.length,
      blocker_codes: counts,
      blockers: this.blockers.map(b => b.toJSON()),
      warnings: this.warnings,
    };
  }
}
