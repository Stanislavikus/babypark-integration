import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  FirstLineStateStore,
} from '../../src/copilot/first-line-state-store.mjs';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../..'
);
const RUNTIME_ROOTS = ['src', 'scripts', 'apps'];
const CODE_EXTENSIONS = new Set(['.mjs', '.js', '.cjs', '.ts']);
const SKIP_DIRS = new Set(['node_modules', 'tests', 'test', 'fixtures', 'vendor']);

// An explicit operator-only bootstrap command would need a separately reviewed
// path added here. Currently no runtime/CLI path is allowed to create v4 state.
const APPROVED_EXPLICIT_V4_BOOTSTRAP_PATHS = new Set();

function collectRuntimeSourceFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        collectRuntimeSourceFiles(full, files);
      }
    } else if (entry.isFile() &&
               CODE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

// This is a deliberate direct-call CI tripwire, not a full JavaScript data-flow
// analyzer. The eventual Runtime must separately test its real startup behavior
// and prove no DB creation and no Chatwoot POST on a missing v4 authority.
function forbiddenV4CreationReference(source) {
  if (/\bFirstLineStateStore\s*(?:\.\s*create|\[\s*['"`]create['"`]\s*\])\s*\(/u.test(source)) {
    return 'direct-or-bracket-create';
  }
  if (/\bFirstLineStateStore\s+as\s+[A-Za-z_$][\w$]*/u.test(source)) {
    return 'aliased-import-requires-review';
  }
  if (/\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*FirstLineStateStore\b/u.test(source)) {
    return 'store-aliased-requires-review';
  }
  if (/\b(?:const|let|var)\s*\{[^}]*\bcreate\b[^}]*\}\s*=\s*FirstLineStateStore\b/u.test(source)) {
    return 'create-destructuring-requires-review';
  }
  return null;
}

test('CI guard detects direct, computed and aliased automatic v4 creation', () => {
  assert.equal(
    forbiddenV4CreationReference('FirstLineStateStore.create(file)'),
    'direct-or-bracket-create'
  );
  assert.equal(
    forbiddenV4CreationReference('FirstLineStateStore["create"](file)'),
    'direct-or-bracket-create'
  );
  assert.equal(
    forbiddenV4CreationReference('FirstLineStateStore [\'create\'] (file)'),
    'direct-or-bracket-create'
  );
  assert.equal(
    forbiddenV4CreationReference('import { FirstLineStateStore as Store } from "./first-line-state-store.mjs"'),
    'aliased-import-requires-review'
  );
  assert.equal(
    forbiddenV4CreationReference('const Store = FirstLineStateStore; Store.create(file)'),
    'store-aliased-requires-review'
  );
  assert.equal(
    forbiddenV4CreationReference('const { create: boot } = FirstLineStateStore; boot(file)'),
    'create-destructuring-requires-review'
  );
  assert.equal(forbiddenV4CreationReference('FirstLineStateStore.open(file)'), null);
  assert.equal(forbiddenV4CreationReference('CopilotStore.create(file)'), null);
});

test('production source has no unapproved FirstLineStateStore.create caller', () => {
  const paths = RUNTIME_ROOTS.flatMap(root =>
    collectRuntimeSourceFiles(path.join(ROOT, root))
  ).sort();
  assert.ok(paths.length > 0, 'runtime source inventory must be nonempty');

  const violations = [];
  for (const full of paths) {
    const relative = path.relative(ROOT, full).split(path.sep).join('/');
    if (APPROVED_EXPLICIT_V4_BOOTSTRAP_PATHS.has(relative)) continue;
    const reason = forbiddenV4CreationReference(fs.readFileSync(full, 'utf8'));
    if (reason) violations.push({ path: relative, reason });
  }
  assert.deepEqual(
    violations, [],
    'explicit first v4 creation requires reviewed operator bootstrap, not runtime fallback'
  );
});

test('missing v4 authority fails closed without creating DB or sidecars', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-first-line-no-lazy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const missing = path.join(root, 'episode.sqlite');
  assert.throws(
    () => FirstLineStateStore.open(missing),
    error => error?.code === 'FIRST_LINE_DB_MISSING'
  );
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    assert.equal(
      fs.existsSync(missing + suffix), false,
      'opening missing v4 DB may not create ' + suffix
    );
  }
});
