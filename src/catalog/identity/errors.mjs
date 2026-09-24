export class IdentityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'IdentityError';
    this.code = code;
    this.details = details;
  }
}

export function identityError(code, message, details = {}) {
  return new IdentityError(code, message, details);
}
