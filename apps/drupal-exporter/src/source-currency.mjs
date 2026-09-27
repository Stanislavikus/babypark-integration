import fs from 'node:fs';
import path from 'node:path';
import { BLOCKER_CODES, Blocker } from './blockers.mjs';
import { parsePhpSerializedString } from './php-variable.mjs';

export function validateSourceCurrencyConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('currency config must be an object');
  }
  const { code, precision } = config;
  if (typeof code !== 'string' || !/^[A-Z]{3}$/.test(code)) {
    throw new Error('currency code must be a 3-letter uppercase code');
  }
  if (!Number.isInteger(precision) || precision < 0 || precision > 2) {
    throw new Error('currency precision is out of supported range');
  }
  return { code, precision };
}

export function parseSourceCurrencyFromVariables(rows, blockers) {
  const byName = new Map(rows.map(row => [row.name, row.value]));
  try {
    const code = parsePhpSerializedString(byName.get('uc_currency_code'));
    const precisionText = parsePhpSerializedString(byName.get('uc_currency_prec'));
    if (!/^\d+$/.test(precisionText)) {
      throw new Error('currency precision must be a non-negative integer string');
    }
    const precision = Number(precisionText);
    return validateSourceCurrencyConfig({ code, precision });
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
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(currencyPath, 'utf8'));
    } catch (error) {
      blockers.add(new Blocker(
        BLOCKER_CODES.SOURCE_UNSTABLE,
        'Malformed source currency snapshot artifact',
        { path: currencyPath, reason: error.message }
      ));
      return null;
    }
    try {
      return validateSourceCurrencyConfig(parsed);
    } catch (error) {
      blockers.add(new Blocker(
        BLOCKER_CODES.SOURCE_UNSTABLE,
        'Invalid source currency snapshot artifact',
        { path: currencyPath, reason: error.message }
      ));
      return null;
    }
  }
  if (config.sourceCurrency) {
    try {
      return validateSourceCurrencyConfig(config.sourceCurrency);
    } catch (error) {
      blockers.add(new Blocker(
        BLOCKER_CODES.SOURCE_UNSTABLE,
        'Invalid source currency fixture override',
        { reason: error.message }
      ));
      return null;
    }
  }
  blockers.add(new Blocker(
    BLOCKER_CODES.SOURCE_UNSTABLE,
    'Missing source currency snapshot artifact',
    { path: currencyPath }
  ));
  return null;
}
