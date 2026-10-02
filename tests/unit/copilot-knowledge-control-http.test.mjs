import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KnowledgeStore } from '../../src/copilot/knowledge/store.mjs';
import { createKnowledgeControlPlane } from '../../src/copilot/knowledge-control/http.mjs';

function keyPair() {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKey: pair.privateKey,
    jwk: pair.publicKey.export({ format: 'jwk' }),
  };
}

function token(privateKey, claims) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const payload = encode(claims);
  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(`${header}.${payload}`),
    privateKey
  ).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-control-a7-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let revisionSeq = 0;
  let eventSeq = 0;
  let clock = 0;
  const store = KnowledgeStore.createNew(path.join(root, 'knowledge.sqlite'), {
    now: () => new Date(Date.UTC(2026, 9, 2, 12, 0, clock++)).toISOString(),
    idFactory: {
      revision: () => `kr_http_${++revisionSeq}`,
      event: () => `ke_http_${++eventSeq}`,
    },
  });
  t.after(() => store.close());
  return store;
}

function grant(role, actions, namespace, subjectType, subjectId) {
  return { role, actions, namespace, subject_type: subjectType, subject_id: subjectId };
}

test('direct control plane enforces Access identity, scoped grants and state machine', async t => {
  const store = fixture(t);
  const { privateKey, jwk } = keyPair();
  const nowSec = 1_800_000_000;
  const issuer = 'https://babypark.cloudflareaccess.com';
  const audience = 'babypark-ai';
  const actors = [
    { actor_id: 'operator', access_sub: 'sub-operator' },
    { actor_id: 'drafter', access_sub: 'sub-drafter' },
    { actor_id: 'approver', access_sub: 'sub-approver' },
    { actor_id: 'admin', access_sub: 'sub-admin' },
  ];
  const grantsByActor = {
    operator: [
      grant('OPERATIONAL_EDITOR',
        ['VIEW','RESOLVE','DRAFT_CREATE','PUBLISH','REVOKE','WITHDRAW'],
        'store.temporary_closure','store','store_1'),
      grant('VIEWER',['VIEW'],'*','store','store_1'),
      grant('VIEWER',['RESOLVE'],'*','store','store_1'),
    ],
    drafter: [
      grant('COMMERCE_DRAFTER',['DRAFT_CREATE','VIEW'],
        'commerce.prepayment','business','babypark'),
    ],
    approver: [
      grant('COMMERCE_APPROVER',['VIEW','APPROVE','PUBLISH'],
        'commerce.prepayment','business','babypark'),
      grant('COMMERCE_APPROVER',['RESOLVE'],'*','business','babypark'),
    ],
    admin: [
      grant('KNOWLEDGE_ADMIN',['PUBLISH'],
        'store.temporary_closure','store','store_1'),
    ],
  };
  const access = {
    issuer,
    audience,
    keys: { k1: jwk },
    actors,
    grantsByActor,
    clockSkewSec: 0,
  };
  const runtime = createKnowledgeControlPlane({
    store,
    access,
    publicOrigin: 'https://ai.babypark.ua',
    nowMs: () => nowSec * 1000,
  });
  const address = await runtime.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => runtime.close());
  const base = `http://127.0.0.1:${address.port}`;

  const jwtFor = sub => token(privateKey, {
    iss: issuer,
    aud: audience,
    sub,
    exp: nowSec + 300,
    nbf: nowSec - 10,
  });
  async function request(pathname, {
    jwt,
    method = 'GET',
    body,
    origin = 'https://ai.babypark.ua',
  } = {}) {
    const headers = {};
    if (jwt) headers['cf-access-jwt-assertion'] = jwt;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET' && origin !== null) headers.origin = origin;
    return fetch(base + pathname, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  assert.equal((await request('/api/knowledge/revisions')).status, 401);

  const rootPage = await request('/', { jwt: jwtFor('sub-operator') });
  assert.equal(rootPage.status, 200);
  assert.match(await rootPage.text(), /Actor: <strong>operator<\/strong>/);
  assert.match(rootPage.headers.get('content-security-policy'), /frame-ancestors https:\/\/chat\.babypark\.ua/);

  const closureDraft = {
    recordType: 'OPERATIONAL_FACT',
    namespace: 'store.temporary_closure',
    effectFamily: 'store.operating_state',
    subjectType: 'store',
    subjectId: 'store_1',
    scope: {},
    effectType: 'CLOSED',
    effectValue: { closed: true },
    effectiveFromUtc: '2026-10-02T13:00:00Z',
    expiresAtUtc: '2026-10-02T16:00:00Z',
  };

  const crossSite = await request('/api/knowledge/drafts', {
    jwt: jwtFor('sub-operator'),
    method: 'POST',
    origin: 'https://evil.example',
    body: closureDraft,
  });
  assert.equal(crossSite.status, 403);

  const createdResponse = await request('/api/knowledge/drafts', {
    jwt: jwtFor('sub-operator'),
    method: 'POST',
    body: closureDraft,
  });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).created;

  const published = await request(
    `/api/knowledge/revisions/${created.revision_id}/publish`,
    { jwt: jwtFor('sub-operator'), method: 'POST', body: {} }
  );
  assert.equal(published.status, 200);

  const detail = await request(
    `/api/knowledge/revisions/${created.revision_id}`,
    { jwt: jwtFor('sub-operator') }
  );
  assert.equal(detail.status, 200);
  const detailBody = await detail.json();
  assert.equal(detailBody.revision.author_actor_id, 'operator');
  assert.deepEqual(
    detailBody.events.map(event => event.event_type),
    ['DRAFT_CREATED', 'PUBLISHED']
  );
  assert.deepEqual(
    detailBody.events.map(event => event.actor_id),
    ['operator', 'operator']
  );

  const resolved = await request(
    '/api/knowledge/operational?store_id=store_1&now_utc=2026-10-02T14:00:00Z',
    { jwt: jwtFor('sub-operator') }
  );
  assert.equal(resolved.status, 200);
  assert.equal((await resolved.json()).result.open, false);

  const secondResponse = await request('/api/knowledge/drafts', {
    jwt: jwtFor('sub-operator'),
    method: 'POST',
    body: { ...closureDraft, effectiveFromUtc: '2026-10-02T17:00:00Z',
      expiresAtUtc: '2026-10-02T18:00:00Z' },
  });
  const second = (await secondResponse.json()).created;
  const adminPublish = await request(
    `/api/knowledge/revisions/${second.revision_id}/publish`,
    { jwt: jwtFor('sub-admin'), method: 'POST', body: {} }
  );
  assert.equal(adminPublish.status, 403);

  const commerceDraft = {
    recordType: 'COMMERCE_POLICY',
    namespace: 'commerce.prepayment',
    effectFamily: 'commerce.prepayment',
    subjectType: 'business',
    subjectId: 'babypark',
    scope: { category_id: 'furniture' },
    effectType: 'PREPAYMENT',
    effectValue: { amount_minor: 200000, currency: 'UAH' },
    effectiveFromUtc: '2026-10-01T00:00:00Z',
    expiresAtUtc: null,
  };
  const commerceCreatedResponse = await request('/api/knowledge/drafts', {
    jwt: jwtFor('sub-drafter'),
    method: 'POST',
    body: commerceDraft,
  });
  assert.equal(commerceCreatedResponse.status, 201);
  const commerceCreated = (await commerceCreatedResponse.json()).created;

  const drafterApprove = await request(
    `/api/knowledge/revisions/${commerceCreated.revision_id}/approve`,
    { jwt: jwtFor('sub-drafter'), method: 'POST', body: {} }
  );
  assert.equal(drafterApprove.status, 403);

  assert.equal((await request(
    `/api/knowledge/revisions/${commerceCreated.revision_id}/approve`,
    { jwt: jwtFor('sub-approver'), method: 'POST', body: {} }
  )).status, 200);
  assert.equal((await request(
    `/api/knowledge/revisions/${commerceCreated.revision_id}/publish`,
    { jwt: jwtFor('sub-approver'), method: 'POST', body: {} }
  )).status, 200);

  const commerceResolved = await request('/api/knowledge/commerce/resolve', {
    jwt: jwtFor('sub-approver'),
    method: 'POST',
    body: {
      nowUtc: '2026-10-02T14:00:00Z',
      subjectType: 'business',
      subjectId: 'babypark',
      effectFamily: 'commerce.prepayment',
      bindings: { category_id: 'furniture' },
    },
  });
  assert.equal(commerceResolved.status, 200);
  assert.equal((await commerceResolved.json()).result.status, 'RESOLVED');
});
