import crypto from 'node:crypto';

export class AccessAuthError extends Error {
  constructor(code, message, status = 401, details = {}) {
    super(message);
    this.name = 'AccessAuthError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function fail(code, message, status = 401, details = {}) {
  throw new AccessAuthError(code, message, status, details);
}

function decodeSegment(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    fail('ACCESS_JWT_MALFORMED', `${name} is malformed`);
  }
  try {
    return Buffer.from(value, 'base64url');
  } catch {
    fail('ACCESS_JWT_MALFORMED', `${name} cannot be decoded`);
  }
}

function decodeJson(value, name) {
  try {
    const parsed = JSON.parse(decodeSegment(value, name).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      fail('ACCESS_JWT_MALFORMED', `${name} must be an object`);
    }
    return parsed;
  } catch (error) {
    if (error instanceof AccessAuthError) throw error;
    fail('ACCESS_JWT_MALFORMED', `${name} is not valid JSON`);
  }
}

function audienceMatches(actual, expected) {
  if (typeof actual === 'string') return actual === expected;
  return Array.isArray(actual) && actual.some(value => value === expected);
}

function publicKeyFor(keys, kid) {
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
    fail('ACCESS_KEYSET_INVALID', 'Access key set is invalid', 503);
  }
  const value = keys[kid];
  if (!value) fail('ACCESS_KID_UNKNOWN', 'Access JWT kid is not trusted');
  try {
    if (typeof value === 'string') return crypto.createPublicKey(value);
    return crypto.createPublicKey({ key: value, format: 'jwk' });
  } catch {
    fail('ACCESS_KEY_INVALID', 'Trusted Access public key is invalid', 503);
  }
}

export function verifyCloudflareAccessJwt(token, {
  issuer,
  audience,
  keys,
  nowSec = Math.floor(Date.now() / 1000),
  clockSkewSec = 30,
} = {}) {
  if (typeof token !== 'string' || token.length > 16384) {
    fail('ACCESS_JWT_MISSING', 'Cloudflare Access JWT is missing');
  }
  if (typeof issuer !== 'string' || issuer === '' ||
      typeof audience !== 'string' || audience === '') {
    fail('ACCESS_CONFIG_INVALID', 'Access issuer/audience are required', 503);
  }
  if (!Number.isSafeInteger(nowSec) || !Number.isSafeInteger(clockSkewSec) || clockSkewSec < 0) {
    throw new TypeError('nowSec/clockSkewSec are invalid');
  }

  const parts = token.split('.');
  if (parts.length !== 3) fail('ACCESS_JWT_MALFORMED', 'JWT must have three segments');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJson(encodedHeader, 'JWT header');
  const claims = decodeJson(encodedPayload, 'JWT claims');

  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid === '') {
    fail('ACCESS_JWT_ALG_INVALID', 'Only trusted RS256 Access JWTs are accepted');
  }
  const key = publicKeyFor(keys, header.kid);
  const signature = decodeSegment(encodedSignature, 'JWT signature');
  const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`);
  if (!crypto.verify('RSA-SHA256', signingInput, key, signature)) {
    fail('ACCESS_JWT_SIGNATURE_INVALID', 'Access JWT signature is invalid');
  }

  if (claims.iss !== issuer) fail('ACCESS_JWT_ISSUER_INVALID', 'Access JWT issuer mismatch');
  if (!audienceMatches(claims.aud, audience)) {
    fail('ACCESS_JWT_AUDIENCE_INVALID', 'Access JWT audience mismatch');
  }
  if (!Number.isSafeInteger(claims.exp) || nowSec - clockSkewSec >= claims.exp) {
    fail('ACCESS_JWT_EXPIRED', 'Access JWT is expired');
  }
  if (claims.nbf !== undefined &&
      (!Number.isSafeInteger(claims.nbf) || nowSec + clockSkewSec < claims.nbf)) {
    fail('ACCESS_JWT_NOT_YET_VALID', 'Access JWT is not yet valid');
  }
  if (typeof claims.sub !== 'string' || claims.sub === '') {
    fail('ACCESS_JWT_SUBJECT_INVALID', 'Access JWT subject is required');
  }
  if (claims.email !== undefined &&
      (typeof claims.email !== 'string' || claims.email.trim() === '')) {
    fail('ACCESS_JWT_EMAIL_INVALID', 'Access JWT email is invalid');
  }

  return Object.freeze({
    sub: claims.sub,
    email: claims.email?.toLowerCase() ?? null,
    claims: Object.freeze({ ...claims }),
    kid: header.kid,
  });
}

export function mapAccessIdentityToActor(identity, actors) {
  if (!Array.isArray(actors)) {
    fail('ACTOR_MAP_INVALID', 'Actor mapping must be an array', 503);
  }
  const matches = actors.filter(actor => {
    if (!actor || typeof actor !== 'object') return false;
    const subMatches = actor.access_sub !== undefined && actor.access_sub === identity.sub;
    const emailMatches = actor.email !== undefined &&
      identity.email !== null &&
      String(actor.email).toLowerCase() === identity.email;
    return subMatches || emailMatches;
  });
  if (matches.length !== 1) {
    fail(
      matches.length === 0 ? 'ACTOR_NOT_MAPPED' : 'ACTOR_MAPPING_AMBIGUOUS',
      matches.length === 0
        ? 'Authenticated identity is not mapped to a BabyPark actor'
        : 'Authenticated identity maps to multiple BabyPark actors',
      403
    );
  }
  const actor = matches[0];
  if (typeof actor.actor_id !== 'string' || actor.actor_id.trim() === '') {
    fail('ACTOR_MAP_INVALID', 'Mapped actor_id is invalid', 503);
  }
  return Object.freeze({
    actor_id: actor.actor_id,
    email: identity.email,
    access_sub: identity.sub,
  });
}


function unverifiedKid(token) {
  if (typeof token !== 'string') fail('ACCESS_JWT_MISSING', 'Cloudflare Access JWT is missing');
  const parts = token.split('.');
  if (parts.length !== 3) fail('ACCESS_JWT_MALFORMED', 'JWT must have three segments');
  const header = decodeJson(parts[0], 'JWT header');
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid === '') {
    fail('ACCESS_JWT_ALG_INVALID', 'Only trusted RS256 Access JWTs are accepted');
  }
  return header.kid;
}

export function createCloudflareAccessKeyProvider({
  certsUrl,
  fetchFn = globalThis.fetch,
  cacheTtlMs = 5 * 60 * 1000,
  nowMs = () => Date.now(),
} = {}) {
  let parsed;
  try { parsed = new URL(certsUrl); }
  catch { throw new TypeError('certsUrl must be a valid URL'); }
  if (parsed.protocol !== 'https:') throw new TypeError('certsUrl must use https');
  if (typeof fetchFn !== 'function') throw new TypeError('fetchFn is required');
  if (!Number.isSafeInteger(cacheTtlMs) || cacheTtlMs < 1000) {
    throw new TypeError('cacheTtlMs must be >= 1000');
  }

  let cache = Object.freeze({});
  let fetchedAt = 0;
  let inflight = null;

  async function refresh() {
    if (inflight) return inflight;
    inflight = (async () => {
      let response;
      try {
        response = await fetchFn(parsed.href, {
          method: 'GET',
          redirect: 'error',
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        fail('ACCESS_KEYS_FETCH_FAILED', 'Access signing keys could not be refreshed', 503);
      }
      if (!response?.ok) {
        fail(
          'ACCESS_KEYS_FETCH_FAILED',
          'Access signing key endpoint returned an error',
          503,
          { status: response?.status ?? null }
        );
      }
      let body;
      try { body = await response.json(); }
      catch { fail('ACCESS_KEYS_INVALID', 'Access signing key response is invalid JSON', 503); }
      if (!body || !Array.isArray(body.keys) || body.keys.length === 0) {
        fail('ACCESS_KEYS_INVALID', 'Access signing key response has no keys', 503);
      }
      const next = {};
      for (const jwk of body.keys) {
        if (!jwk || jwk.kty !== 'RSA' || jwk.alg !== 'RS256' ||
            typeof jwk.kid !== 'string' || jwk.kid === '') {
          continue;
        }
        next[jwk.kid] = jwk;
      }
      if (Object.keys(next).length === 0) {
        fail('ACCESS_KEYS_INVALID', 'Access signing key response has no trusted RS256 keys', 503);
      }
      cache = Object.freeze(next);
      fetchedAt = nowMs();
      return cache;
    })();
    try { return await inflight; }
    finally { inflight = null; }
  }

  return Object.freeze({
    async keysForToken(token) {
      const kid = unverifiedKid(token);
      const stale = nowMs() - fetchedAt >= cacheTtlMs;
      if (fetchedAt === 0 || stale || !cache[kid]) {
        await refresh();
      }
      if (!cache[kid]) {
        fail('ACCESS_KID_UNKNOWN', 'Access JWT kid is not trusted after key refresh');
      }
      return cache;
    },
    async refresh() {
      return refresh();
    },
    snapshot() {
      return Object.freeze({
        fetched_at_ms: fetchedAt,
        kids: Object.freeze(Object.keys(cache).sort()),
      });
    },
  });
}
