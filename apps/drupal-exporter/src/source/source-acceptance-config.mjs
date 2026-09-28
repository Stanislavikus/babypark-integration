import fs from 'node:fs';
import YAML from 'yaml';

export const SOURCE_ACCEPTANCE_CASES_SCHEMA = 'bp.drupal.source-acceptance-cases/1';

function fail(message) {
  const error = new Error(message);
  error.code = 'SOURCE_ACCEPTANCE_CASES_INVALID';
  throw error;
}

export function loadSourceAcceptanceCases(filePath) {
  let parsed;
  try {
    parsed = YAML.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`source acceptance cases cannot be loaded: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('source acceptance cases must be an object');
  const keys = Object.keys(parsed).sort();
  if (JSON.stringify(keys) !== JSON.stringify(['cases', 'schema', 'version'])) {
    fail('source acceptance cases have unexpected or missing top-level keys');
  }
  if (parsed.schema !== SOURCE_ACCEPTANCE_CASES_SCHEMA || parsed.version !== 1) {
    fail('unsupported source acceptance cases schema/version');
  }
  if (!Array.isArray(parsed.cases) || parsed.cases.length === 0) fail('source acceptance cases must be non-empty');

  const ids = new Set();
  const caseIds = new Set();
  const cases = parsed.cases.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('source acceptance case must be an object');
    const entryKeys = Object.keys(entry).sort();
    if (JSON.stringify(entryKeys) !== JSON.stringify(['id', 'native_product_ids', 'purpose'])) {
      fail('source acceptance case has unexpected or missing keys');
    }
    if (typeof entry.id !== 'string' || !entry.id.trim() || caseIds.has(entry.id)) fail('source acceptance case id invalid/duplicate');
    if (typeof entry.purpose !== 'string' || !entry.purpose.trim()) fail('source acceptance case purpose required');
    if (!Array.isArray(entry.native_product_ids) || entry.native_product_ids.length === 0) fail('source acceptance native_product_ids required');
    caseIds.add(entry.id);
    const nativeProductIds = entry.native_product_ids.map(value => {
      const id = String(value);
      if (!/^\d+$/.test(id)) fail(`invalid native product id: ${id}`);
      if (ids.has(id)) fail(`duplicate native product id across acceptance cases: ${id}`);
      ids.add(id);
      return id;
    });
    return Object.freeze({ id: entry.id, purpose: entry.purpose, native_product_ids: Object.freeze(nativeProductIds) });
  });

  return Object.freeze({
    schema: parsed.schema,
    version: parsed.version,
    cases: Object.freeze(cases),
    native_product_ids: Object.freeze([...ids].sort((a, b) => Number(a) - Number(b))),
  });
}
