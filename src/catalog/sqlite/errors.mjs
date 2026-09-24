export class CatalogError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CatalogError';
    this.code = code;
    this.details = details;
  }
}

export function catalogError(code, message, details = {}) {
  return new CatalogError(code, message, details);
}
