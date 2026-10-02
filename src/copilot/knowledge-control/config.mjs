function jsonEnv(env, name, fallback = undefined) {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`${name} is required`);
  }
  try { return JSON.parse(raw); }
  catch { throw new Error(`${name} must be valid JSON`); }
}

function integerEnv(env, name, fallback) {
  const raw = env[name] ?? String(fallback);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} is out of range`);
  }
  return value;
}

export function parseKnowledgeControlConfig(env = process.env) {
  const issuer = env.BP_AI_ACCESS_ISSUER;
  const audience = env.BP_AI_ACCESS_AUDIENCE;
  if (typeof issuer !== 'string' || issuer === '') {
    throw new Error('BP_AI_ACCESS_ISSUER is required');
  }
  if (typeof audience !== 'string' || audience === '') {
    throw new Error('BP_AI_ACCESS_AUDIENCE is required');
  }
  const publicOrigin = env.BP_AI_PUBLIC_ORIGIN ?? 'https://ai.babypark.ua';
  const origin = new URL(publicOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== publicOrigin) {
    throw new Error('BP_AI_PUBLIC_ORIGIN must be an https origin');
  }
  const issuerUrl = new URL(issuer);
  if (issuerUrl.protocol !== 'https:') {
    throw new Error('BP_AI_ACCESS_ISSUER must use https');
  }
  const certsUrl = env.BP_AI_ACCESS_CERTS_URL ??
    new URL('/cdn-cgi/access/certs', issuerUrl).href;
  if (new URL(certsUrl).protocol !== 'https:') {
    throw new Error('BP_AI_ACCESS_CERTS_URL must use https');
  }
  return Object.freeze({
    databasePath: env.BP_KNOWLEDGE_DB ??
      '/var/lib/babypark-integration/knowledge.sqlite',
    host: env.BP_AI_HOST ?? '127.0.0.1',
    port: integerEnv(env, 'BP_AI_PORT', 3210),
    publicOrigin,
    access: Object.freeze({
      issuer,
      audience,
      certsUrl,
      keys: jsonEnv(env, 'BP_AI_ACCESS_KEYS_JSON', null),
      actors: jsonEnv(env, 'BP_AI_ACTORS_JSON'),
      grantsByActor: jsonEnv(env, 'BP_AI_GRANTS_JSON', {}),
      clockSkewSec: 30,
    }),
  });
}
