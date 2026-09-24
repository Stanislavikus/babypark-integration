export class CatalogServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CatalogServiceError';
    this.code = code;
    this.details = details;
  }
}

export function serviceError(code, message, details = {}) {
  return new CatalogServiceError(code, message, details);
}

