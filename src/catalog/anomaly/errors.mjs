export class AnomalyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AnomalyError';
    this.code = code;
    this.details = details;
  }
}

export function anomalyError(code, message, details = {}) {
  return new AnomalyError(code, message, details);
}
