const SCALE = 5;
const SCALE_FACTOR = 10n ** 5n;
const MINOR_SCALE = 2n;
const MINOR_FACTOR = 100n;

export class MoneyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
  }
}

/**
 * Parse DECIMAL(16,5) string to fixed-scale BigInt (scale 5).
 */
export function parseDecimal(value) {
  if (value === null || value === undefined) {
    throw new MoneyError('MONEY_INVALID', 'value is required');
  }
  const text = typeof value === 'string' ? value.trim() : String(value);
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new MoneyError('MONEY_INVALID', 'invalid decimal format');
  }
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ''] = unsigned.split('.');
  if (fraction.length > SCALE) {
    throw new MoneyError('MONEY_PRECISION', 'too many decimal places');
  }
  const padded = fraction.padEnd(SCALE, '0');
  const combined = BigInt(whole + padded);
  return negative ? -combined : combined;
}

export function addDecimal(...values) {
  return values.reduce((sum, value) => sum + value, 0n);
}

/**
 * Convert scale-5 BigInt to minor units (kopiyky) if exactly representable.
 */
export function toMinorUnits(value) {
  if (value < 0n) {
    throw new MoneyError('PRICE_NEGATIVE', 'negative price');
  }
  const remainder = value % (SCALE_FACTOR / MINOR_FACTOR);
  if (remainder !== 0n) {
    throw new MoneyError('PRICE_NOT_MINOR_ALIGNED', 'price has sub-cent precision');
  }
  return value / (SCALE_FACTOR / MINOR_FACTOR);
}

export function formatDecimal(value) {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / SCALE_FACTOR;
  const fraction = abs % SCALE_FACTOR;
  const fractionText = fraction.toString().padStart(SCALE, '0');
  return `${negative ? '-' : ''}${whole}.${fractionText}`;
}
