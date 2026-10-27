import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const source = readFileSync(new URL('../../web/contact-launcher/babypark-launcher.js', import.meta.url), 'utf8');
const doc = readFileSync(new URL('../../docs/BP_CALLBACK_V1_IMPLEMENTATION_TRACEABILITY_20261024.md', import.meta.url), 'utf8');
test('V12 G1: every current requirement has a six-column mapping without invented production completion', () => {
  const current = doc.split('## Current V12 §6 traceability')[1].split('## 2026-10-26 V9')[0];
  for (const id of ['V12-PHONE-DISPLAY', 'V12-PHONE-SOURCE', 'V12-PHONE-EDIT-B1',
    'V12-NAME-LETTERS', 'V12-NAME-80', 'V12-COMMENT-500', 'V12-HINT',
    'V12-GEOMETRY-EMBLEM', 'V12-SEND', 'V12-PREVIEW-G2']) {
    const rows = current.split('\n').filter(line => line.startsWith('| ' + id + ':'));
    assert.equal(rows.length, 1, 'one mapping for ' + id);
    const cells = rows[0].split('|').slice(1, -1).map(cell => cell.trim());
    assert.equal(cells.length, 6);
    assert.ok(cells.every(Boolean), 'no missing implementation/test/fail-closed/durable/status cell');
    assert.equal(cells[5], 'DONE', 'candidate implementation/evidence complete for ' + id);
  }
  // Owner-frozen stock Chatwoot routing has no Callback-only duty/alert gate.
  // The successful Chatwoot snapshot restore must not be demanded again.
  assert.doesNotMatch(current, /^\| OPS-NOTIFY:/m);
  assert.doesNotMatch(current, /^\| OPS-RECOVERY:/m);
  const restoreRow = current.split('\n').find(line => line.startsWith('| OPS-RECOVERY-SNAPSHOT:'));
  assert.ok(restoreRow?.endsWith('| DONE |'), 'existing snapshot restore evidence is reused');
  // Security, real cutover and the existing Agreement review are not waived.
  for (const id of ['OPS-PRIVACY', 'OPS-CUTOVER', 'GATE-HEAVY']) {
    const row = current.split('\n').find(line => line.startsWith('| ' + id + ':'));
    assert.ok(row, 'unproved hard-safety/review gate remains visible: ' + id);
    assert.ok(row.endsWith('| IN PROGRESS |'), 'no invented DONE/DEFERRED for ' + id);
  }
  assert.match(current, /G1 scope disposition:/);
  assert.match(doc, /owner-frozen scope correction/i);
});

test('V12 G2: all documented callback previews have exact observed registry identities', () => {
  const root = new URL('../../docs/', import.meta.url);
  const registry = readFileSync(new URL('INFRASTRUCTURE_REGISTRY.md', root), 'utf8');
  const current = registry.split('## 2026-10-26 — five existing Callback previews')[1].split('## Historical')[0];
  const expected = new Map([
    ['preview-callback-v11-5c6586d9', 'c9a79677de52238abe451c1b64a4d8546ec3794cb216fd79d35cf0de6dbf9c8c'],
    ['preview-callback-v1-4432d4a895546c29ce630503675da359', '121ae5d84a3436c6d0f99aedb1b881c6222bd40390013e9cdb8322cf6c96ae7b'],
    ['preview-callback-visual-approved-20261026', '060f378586899a75d38550343809599e554da07a1c9063aa00cbcbdced031714'],
    ['preview-callback-visual-chatwoot-font-20261026', '53c1eb1a8b092cb092eefb8a065f10488532aadaec7f9b8dec2e57717020d186'],
    ['preview-callback-visual-chatwoot-emblem-20261026', '772420cfc6914c1c03c15f1435900674b3aa597a3d39615bb47257ed49697cd0']
  ]);
  const mentioned = new Set();
  for (const entry of readdirSync(root, { recursive: true })) {
    if (!entry.endsWith('.md')) continue;
    for (const name of readFileSync(new URL(entry, root), 'utf8').matchAll(/preview-callback-[A-Za-z0-9-]+/g)) mentioned.add(name[0]);
  }
  assert.deepEqual([...mentioned].sort(), [...expected.keys()].sort());
  for (const [name, sha] of expected) {
    const row = current.split('\n').find(line => line.includes('/' + name + '/index.html'));
    assert.ok(row?.includes('/home/babypark/sites/babypark.ua/sites/all/themes/babypark2/assets/contact/'), name);
    assert.ok(row.includes(sha), 'owner-observed index hash: ' + name);
  }
  assert.match(current, /6423267053/);
  assert.match(current, /No cleanup or deletion was performed/);
  const state = readFileSync(new URL('CURRENT_STATE.md', root), 'utf8');
  const active = state.split('## 2026-10-26 — Callback V12')[1].split('## Historical')[0];
  assert.match(active, /digits are removed on input and before POST/);
  assert.doesNotMatch(active, /allowing digits|latest.*c87e6b3/i);
});
test('pinned upstream Chatwoot v4.18.0 widget request contract is documented', () => {
  assert.match(doc,/9f920b549c14491a4e587687a3eed5d21c6ccc7d/);
  assert.match(doc,/c4fd9c82027a5a5fa9987a8af25a789c374d8b15/);
  assert.match(doc,/90f3728fbf5ce6597a592935bd5d4f146f9ae434/);
  assert.match(doc,/message_created/);
});
test('native human phrase remains a bound account-level release smoke dependency', () => {
  const runbook = readFileSync(new URL('../../docs/CONTACT_LAUNCHER_L1_PREVIEW_RUNBOOK.md', import.meta.url), 'utf8');
  assert.match(runbook, /post-change synthetic callback smoke/i);
  assert.match(runbook, /existing open and resolved/i);
  assert.match(runbook, /Unassigned/i);
});
test('internal widget transport is narrow and is not the unsafe public Client API', () => {
  assert.match(source,/\/api\/v1\/widget\/messages\?website_token=/);
  assert.doesNotMatch(source,/\/public\/api\/v1\/inboxes/);
  assert.match(source,/Ви замовили дзвінок/);
  assert.doesNotMatch(source,/BABYPARK_CALLBACK_V1/,
    'technical marker must not be exposed in public message source');
  assert.match(source,/custom_attributes:\s*\{ callback_phone: phone \}/);
  assert.doesNotMatch(source,/contact:\s*\{\s*phone_number/);
});
test('there is no optimistic success, automatic retry, background prefetch or raw phone persistence', () => {
  assert.match(source,/response\.status !== 200/);
  assert.match(source,/Number\.isSafeInteger\(data\.id\)/);
  assert.match(source,/state\.callbackUncertain = true/);
  assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB|sendBeacon|setInterval/);
});

test('native automation fixture is account-scoped and does not hard-code inbox or team', () => {
  const rule = JSON.parse(readFileSync(
    new URL('../../config/chatwoot/callback-v1-automation.example.json', import.meta.url), 'utf8'));
  assert.equal(rule.event_name, 'message_created');
  assert.equal(rule.conditions.length, 2);
  assert.deepEqual(rule.conditions.map(c => c.attribute_key), ['message_type', 'content']);
  assert.deepEqual(rule.conditions[0].values, ['incoming']);
  assert.equal(rule.conditions[0].query_operator, 'AND');
  assert.equal(rule.conditions[1].query_operator, null);
  assert.deepEqual(rule.actions.map(a => a.action_name), ['add_label']);
  assert.equal(rule.actions[0].action_params[0], 'callback');
  assert.equal(rule.conditions[1].filter_operator, 'contains');
  const expectedPrefix = 'Ви замовили дзвінок\nЗворотний дзвінок: ';
  assert.deepEqual(rule.conditions[1].values, [expectedPrefix]);
  assert.ok(source.includes("Ви замовили дзвінок\\nЗворотний дзвінок: "),
    'exact customer-facing two-line prefix must be in Widget payload and rule');
  assert.equal(expectedPrefix.includes('BABYPARK_CALLBACK_V1'), false,
    'native rule no longer depends on user-visible machine marker');
  assert.equal(rule.conditions.some(c => c.attribute_key === 'inbox_id' || c.attribute_key === 'team_id'), false);
  assert.equal(rule.actions.some(a => a.action_name === 'assign_team' || a.action_name === 'assign_agent'), false);
});

test('V7 native-only scan and operational headers have an explicit release fence', () => {
  const scan=readFileSync(new URL('../../docs/BP_CALLBACK_V1_V7_NATIVE_OPTIONS_SCAN_20261025.md',import.meta.url),'utf8');
  const runbook=readFileSync(new URL('../../docs/CONTACT_LAUNCHER_L1_PREVIEW_RUNBOOK.md',import.meta.url),'utf8');
  const nginx=readFileSync(new URL('../../deploy/contact-launcher/chatwoot-widget-cors.nginx.example',import.meta.url),'utf8');
  const example=readFileSync(new URL('../../web/contact-launcher/config.example.js',import.meta.url),'utf8');
  assert.match(scan,/no new customer PII storage/i);
  assert.match(runbook,/HSTS\/CSP/);
  assert.match(nginx,/add_header at location replaces server\/http inheritance/);
  assert.doesNotMatch(example,/label\+team automation/);
  assert.equal((doc.match(/# BabyPark Callback V1 — bounded implementation evidence/g)||[]).length,1,
    'single authoritative document rather than corrupted concatenated copies');
});
