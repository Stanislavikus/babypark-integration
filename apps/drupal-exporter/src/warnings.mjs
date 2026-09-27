export const WARNING_CODES = Object.freeze({
  BRAND_REFERENCE_MISSING_OMITTED: 'BRAND_REFERENCE_MISSING_OMITTED',
  TRANSLATION_DUPLICATE_RESOLVED: 'TRANSLATION_DUPLICATE_RESOLVED',
  TRANSLATION_DUPLICATE_OMITTED: 'TRANSLATION_DUPLICATE_OMITTED',
  OPTION_LABEL_MISSING: 'OPTION_LABEL_MISSING',
  VARIANT_STATUS_FALLBACK: 'VARIANT_STATUS_FALLBACK',
});

export class Warning {
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
