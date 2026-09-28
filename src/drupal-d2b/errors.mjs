export class D2bError extends Error {
  constructor(code, message, { retryable = false, details = undefined } = {}) {
    super(message);
    this.name = 'D2bError';
    this.code = code;
    this.retryable = retryable;
    if (details !== undefined) this.details = details;
  }
}

export function fail(code, message, options) {
  throw new D2bError(code, message, options);
}
