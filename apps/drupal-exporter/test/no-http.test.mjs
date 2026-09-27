import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, '..', 'src');

function walk(dir) {
  const entries = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) entries.push(...walk(full));
    else entries.push(full);
  }
  return entries;
}

test('exporter source contains no HTTP client usage', () => {
  const forbidden = [
    /\bfetch\s*\(/,
    /\bhttp\.request\b/,
    /\bhttps\.request\b/,
    /\baxios\b/,
    /\/api\/catalog\/ingest\/v1\/full/,
    /\/api\/catalog\/ingest\/v1\/state/,
  ];
  const files = walk(SRC).filter(f => f.endsWith('.mjs'));
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      assert.equal(
        pattern.test(content),
        false,
        `${file} matched ${pattern}`
      );
    }
  }
});
