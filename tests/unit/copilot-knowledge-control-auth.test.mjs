import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  createCloudflareAccessKeyProvider,
  mapAccessIdentityToActor,
  verifyCloudflareAccessJwt,
} from '../../src/copilot/knowledge-control/access-auth.mjs';
import {
  parseKnowledgeControlConfig,
} from '../../src/copilot/knowledge-control/config.mjs';
import {
  authorizeKnowledgeAction,
  authorizeRevisionAction,
} from '../../src/copilot/knowledge-control/rbac.mjs';

function keys() {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKey: pair.privateKey,
    jwk: pair.publicKey.export({ format: 'jwk' }),
  };
}

function jwt(privateKey, claims, header = { alg: 'RS256', kid: 'k1', typ: 'JWT' }) {
  const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const h = enc(header);
  const p = enc(claims);
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey)
    .toString('base64url');
  return `${h}.${p}.${sig}`;
}

test('Cloudflare Access JWT verifies signature/iss/aud/exp and maps stable actor', () => {
  const { privateKey, jwk } = keys();
  const now = 1_800_000_000;
  const token = jwt(privateKey, {
    iss: 'https://team.cloudflareaccess.com',
    aud: ['babypark-ai'],
    sub: 'access-user-1',
    email: 'Olga@BabyPark.UA',
    exp: now + 300,
    nbf: now - 10,
  });
  const identity = verifyCloudflareAccessJwt(token, {
    issuer: 'https://team.cloudflareaccess.com',
    audience: 'babypark-ai',
    keys: { k1: jwk },
    nowSec: now,
  });
  const actor = mapAccessIdentityToActor(identity, [
    { actor_id: 'actor_olga', email: 'olga@babypark.ua' },
  ]);
  assert.equal(actor.actor_id, 'actor_olga');
  assert.equal(actor.email, 'olga@babypark.ua');

  assert.throws(
    () => verifyCloudflareAccessJwt(token, {
      issuer: 'https://wrong.example',
      audience: 'babypark-ai',
      keys: { k1: jwk },
      nowSec: now,
    }),
    error => error.code === 'ACCESS_JWT_ISSUER_INVALID'
  );
  assert.throws(
    () => verifyCloudflareAccessJwt(token, {
      issuer: 'https://team.cloudflareaccess.com',
      audience: 'wrong-aud',
      keys: { k1: jwk },
      nowSec: now,
    }),
    error => error.code === 'ACCESS_JWT_AUDIENCE_INVALID'
  );
  assert.throws(
    () => verifyCloudflareAccessJwt(token, {
      issuer: 'https://team.cloudflareaccess.com',
      audience: 'babypark-ai',
      keys: { k1: jwk },
      nowSec: now + 1000,
      clockSkewSec: 0,
    }),
    error => error.code === 'ACCESS_JWT_EXPIRED'
  );
});

test('Access signature and actor mapping fail closed', () => {
  const trusted = keys();
  const attacker = keys();
  const now = 1_800_000_000;
  const forged = jwt(attacker.privateKey, {
    iss: 'https://team.cloudflareaccess.com',
    aud: 'babypark-ai',
    sub: 'attacker',
    exp: now + 300,
  });
  assert.throws(
    () => verifyCloudflareAccessJwt(forged, {
      issuer: 'https://team.cloudflareaccess.com',
      audience: 'babypark-ai',
      keys: { k1: trusted.jwk },
      nowSec: now,
    }),
    error => error.code === 'ACCESS_JWT_SIGNATURE_INVALID'
  );

  const valid = jwt(trusted.privateKey, {
    iss: 'https://team.cloudflareaccess.com',
    aud: 'babypark-ai',
    sub: 'unknown',
    exp: now + 300,
  });
  const identity = verifyCloudflareAccessJwt(valid, {
    issuer: 'https://team.cloudflareaccess.com',
    audience: 'babypark-ai',
    keys: { k1: trusted.jwk },
    nowSec: now,
  });
  assert.throws(
    () => mapAccessIdentityToActor(identity, []),
    error => error.code === 'ACTOR_NOT_MAPPED'
  );
});

test('scoped grants are deny-by-default and store-specific', () => {
  const grants = [{
    role: 'VIEWER',
    actions: ['VIEW'],
    namespace: '*',
    subject_type: 'store',
    subject_id: 'store_1',
  }];
  assert.doesNotThrow(() => authorizeKnowledgeAction({
    actorId: 'actor_viewer',
    grants,
    action: 'VIEW',
    namespace: 'store.weekly_hours',
    subjectType: 'store',
    subjectId: 'store_1',
  }));
  assert.throws(
    () => authorizeKnowledgeAction({
      actorId: 'actor_viewer',
      grants,
      action: 'VIEW',
      namespace: 'store.weekly_hours',
      subjectType: 'store',
      subjectId: 'store_2',
    }),
    error => error.code === 'KNOWLEDGE_FORBIDDEN'
  );
});

test('direct temporary publish requires an OPERATIONAL_EDITOR grant', () => {
  const revision = {
    namespace: 'store.temporary_closure',
    subject_type: 'store',
    subject_id: 'store_1',
  };
  const adminOnly = [{
    role: 'KNOWLEDGE_ADMIN',
    actions: ['PUBLISH'],
    namespace: 'store.temporary_closure',
    subject_type: 'store',
    subject_id: 'store_1',
  }];
  assert.throws(
    () => authorizeRevisionAction({
      actorId: 'actor_admin',
      grants: adminOnly,
      action: 'PUBLISH',
      revision,
    }),
    error => error.code === 'KNOWLEDGE_FORBIDDEN'
  );
  assert.doesNotThrow(() => authorizeRevisionAction({
    actorId: 'actor_operator',
    grants: [{
      role: 'OPERATIONAL_EDITOR',
      actions: ['PUBLISH'],
      namespace: 'store.temporary_closure',
      subject_type: 'store',
      subject_id: 'store_1',
    }],
    action: 'PUBLISH',
    revision,
  }));
});


test('Access key provider caches keys and refreshes when a new kid appears', async () => {
  const first = keys();
  const second = keys();
  let calls = 0;
  let now = 1000;
  const fetchFn = async () => {
    calls += 1;
    const available = calls === 1
      ? [{ ...first.jwk, kid: 'k1', alg: 'RS256', use: 'sig' }]
      : [
          { ...first.jwk, kid: 'k1', alg: 'RS256', use: 'sig' },
          { ...second.jwk, kid: 'k2', alg: 'RS256', use: 'sig' },
        ];
    return {
      ok: true,
      status: 200,
      async json() { return { keys: available }; },
    };
  };
  const provider = createCloudflareAccessKeyProvider({
    certsUrl: 'https://team.cloudflareaccess.com/cdn-cgi/access/certs',
    fetchFn,
    cacheTtlMs: 60_000,
    nowMs: () => now,
  });
  const baseClaims = {
    iss: 'https://team.cloudflareaccess.com',
    aud: 'babypark-ai',
    sub: 'user',
    exp: 2_000_000_000,
  };
  const token1 = jwt(first.privateKey, baseClaims, {
    alg: 'RS256', kid: 'k1', typ: 'JWT',
  });
  const token2 = jwt(second.privateKey, baseClaims, {
    alg: 'RS256', kid: 'k2', typ: 'JWT',
  });

  assert.ok((await provider.keysForToken(token1)).k1);
  assert.equal(calls, 1);
  assert.ok((await provider.keysForToken(token1)).k1);
  assert.equal(calls, 1);
  assert.ok((await provider.keysForToken(token2)).k2);
  assert.equal(calls, 2);

  now += 61_000;
  await provider.keysForToken(token1);
  assert.equal(calls, 3);
});

test('control config derives official Access cert endpoint and permits dynamic keys', () => {
  const config = parseKnowledgeControlConfig({
    BP_AI_ACCESS_ISSUER: 'https://babypark.cloudflareaccess.com',
    BP_AI_ACCESS_AUDIENCE: 'babypark-ai',
    BP_AI_ACTORS_JSON: '[]',
    BP_AI_GRANTS_JSON: '{}',
  });
  assert.equal(
    config.access.certsUrl,
    'https://babypark.cloudflareaccess.com/cdn-cgi/access/certs'
  );
  assert.equal(config.access.keys, null);
  assert.equal(config.publicOrigin, 'https://ai.babypark.ua');
});
