import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../web/contact-launcher/babypark-launcher.js', import.meta.url), 'utf8');
const doc = readFileSync(new URL('../../docs/BP_CALLBACK_V1_IMPLEMENTATION_TRACEABILITY_20261024.md', import.meta.url), 'utf8');
test('pinned upstream Chatwoot v4.18.0 widget request contract is documented', () => {
  assert.match(doc,/9f920b549c14491a4e587687a3eed5d21c6ccc7d/);
  assert.match(doc,/c4fd9c82027a5a5fa9987a8af25a789c374d8b15/);
  assert.match(doc,/90f3728fbf5ce6597a592935bd5d4f146f9ae434/);
  assert.match(doc,/message_created/);
});
test('internal widget transport is narrow and is not the unsafe public Client API', () => {
  assert.match(source,/\/api\/v1\/widget\/messages\?website_token=/);
  assert.doesNotMatch(source,/\/public\/api\/v1\/inboxes/);
  assert.match(source,/BABYPARK_CALLBACK_V1/);
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
  assert.ok(rule.conditions[1].values.includes('BABYPARK_CALLBACK_V1'));
  assert.equal(rule.conditions.some(c => c.attribute_key === 'inbox_id' || c.attribute_key === 'team_id'), false);
  assert.equal(rule.actions.some(a => a.action_name === 'assign_team' || a.action_name === 'assign_agent'), false);
});
