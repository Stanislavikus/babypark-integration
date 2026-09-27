import fs from 'node:fs';
import path from 'node:path';
import { BLOCKER_CODES, Blocker } from './blockers.mjs';
import { parsePhpSerializedString } from './php-variable.mjs';

export const DEFAULT_SOURCE_CURRENCY = Object.freeze({
  code: 'UAH',
  precision: 0,
});

export function parseSourceCurrencyFromVariables(rows, blockers) {
  const byName = new Map(rows.map(row => [row.name, row.value]));
  try {
    const code = parsePhpSerializedString(byName.get('uc_currency_code'));
    const precisionText = parsePhpSerializedString(byName.get('uc_currency_prec'));
    if (!/^\d+$/.test(precisionText)) {
      throw new Error('currency precision must be a non-negative integer string');
    }
    const precision = Number(precisionText);
    if (!Number.isInteger(precision) || precision < 0 || precision > 2) {
      throw new Error('currency precision is out of supported range');
    }
    if (!/^[A-Z]{3}$/.test(code)) {
      throw new Error('currency code must be a 3-letter uppercase code');
    }
    return { code, precision };
  } catch (error) {
    blockers.add(new Blocker(
      BLOCKER_CODES.SOURCE_UNSTABLE,
      'Invalid Drupal currency configuration in snapshot',
      { reason: error.message }
    ));
    return null;
  }
}

export function loadSourceCurrency({ sourceDir, config, blockers }) {
  const currencyPath = path.join(sourceDir, 'source-currency.json');
  if (fs.existsSync(currencyPath)) {
    const parsed = JSON.parse(fs.readFileSync(currencyPath, 'utf8'));
    return {
      code: parsed.code,
      precision: parsed.precision,
    };
  }
  if (config.sourceCurrency) {
    return config.sourceCurrency;
  }
  return { ...DEFAULT_SOURCE_CURRENCY };
}
