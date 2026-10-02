import crypto from 'node:crypto';
import http from 'node:http';
import {
  mapAccessIdentityToActor,
  verifyCloudflareAccessJwt,
} from './access-auth.mjs';
import {
  authorizeKnowledgeAction,
  authorizeRevisionAction,
} from './rbac.mjs';
import { resolveStoreOperationalState } from '../knowledge/operational-resolver.mjs';
import { resolveCommercePolicy } from '../knowledge/commerce-policy.mjs';

const MAX_BODY = 64 * 1024;

function sendJson(res, status, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function readJson(req) {
  const contentType = req.headers['content-type'];
  if (contentType !== 'application/json') {
    const error = new Error('content-type must be application/json');
    error.code = 'CONTENT_TYPE_INVALID';
    error.status = 415;
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      const error = new Error('request body too large');
      error.code = 'BODY_TOO_LARGE';
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('JSON body must be an object');
    }
    return value;
  } catch (error) {
    error.code ??= 'JSON_INVALID';
    error.status ??= 400;
    throw error;
  }
}

function mutationOrigin(req, publicOrigin) {
  if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return;
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== publicOrigin) {
    const error = new Error('origin is not allowed');
    error.code = 'ORIGIN_FORBIDDEN';
    error.status = 403;
    throw error;
  }
  const site = req.headers['sec-fetch-site'];
  if (site === 'cross-site') {
    const error = new Error('cross-site mutation is forbidden');
    error.code = 'CROSS_SITE_FORBIDDEN';
    error.status = 403;
    throw error;
  }
}

async function authenticate(req, config, nowMs) {
  const token = req.headers['cf-access-jwt-assertion'];
  if (Array.isArray(token)) {
    const error = new Error('multiple Access JWT headers');
    error.code = 'ACCESS_JWT_MALFORMED';
    error.status = 401;
    throw error;
  }
  const keys = config.keyProvider
    ? await config.keyProvider.keysForToken(token)
    : config.keys;
  const identity = verifyCloudflareAccessJwt(token, {
    issuer: config.issuer,
    audience: config.audience,
    keys,
    nowSec: Math.floor(nowMs() / 1000),
    clockSkewSec: config.clockSkewSec ?? 30,
  });
  const actor = mapAccessIdentityToActor(identity, config.actors);
  return Object.freeze({
    ...actor,
    grants: config.grantsByActor?.[actor.actor_id] ?? [],
  });
}

function revisionScope(row) {
  return {
    namespace: row.namespace,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
  };
}

function viewableRows(store, actor) {
  return store.authoritySnapshot().filter(row => {
    try {
      authorizeKnowledgeAction({
        actorId: actor.actor_id,
        grants: actor.grants,
        action: 'VIEW',
        ...revisionScope(row),
      });
      return true;
    } catch {
      return false;
    }
  });
}

function htmlPage(store, actor, publicOrigin) {
  const nonce = crypto.randomBytes(18).toString('base64url');
  const rows = viewableRows(store, actor);
  const table = rows.map(row =>
    `<tr><td>${escapeHtml(row.revision_id)}</td><td>${escapeHtml(row.namespace)}</td><td>${escapeHtml(row.subject_id)}</td><td>${escapeHtml(row.state)}</td></tr>`
  ).join('');
  const sample = escapeHtml(JSON.stringify({
    recordType: 'OPERATIONAL_FACT',
    namespace: 'store.temporary_closure',
    effectFamily: 'store.operating_state',
    subjectType: 'store',
    subjectId: 'store_example',
    scope: {},
    effectType: 'CLOSED',
    effectValue: { closed: true },
    effectiveFromUtc: new Date().toISOString(),
    expiresAtUtc: new Date(Date.now() + 3600000).toISOString(),
  }, null, 2));
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>BabyPark Knowledge Authority</title></head>
<body><h1>BabyPark Knowledge Authority</h1>
<p>Actor: <strong>${escapeHtml(actor.actor_id)}</strong></p>
<h2>Visible revisions</h2>
<table border="1"><thead><tr><th>ID</th><th>Namespace</th><th>Subject</th><th>State</th></tr></thead><tbody>${table}</tbody></table>
<h2>Create draft</h2><textarea id="draft" rows="18" cols="100">${sample}</textarea><br><button id="create">Create draft</button>
<h2>Revision action</h2>
<input id="revision" size="55" placeholder="revision_id">
<input id="successor" size="55" placeholder="supersede predecessor id (publish only, optional)">
<button data-action="approve">Approve</button>
<button data-action="publish">Publish</button>
<button data-action="revoke">Revoke</button>
<button data-action="withdraw">Withdraw</button>
<pre id="result"></pre>
<script nonce="${nonce}">
const out=document.getElementById('result');
async function call(url,body){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});out.textContent=JSON.stringify(await r.json(),null,2);if(r.ok)setTimeout(()=>location.reload(),400);}
document.getElementById('create').onclick=()=>{try{call('/api/knowledge/drafts',JSON.parse(document.getElementById('draft').value));}catch(e){out.textContent=e.message;}};
for(const b of document.querySelectorAll('button[data-action]'))b.onclick=()=>{const id=document.getElementById('revision').value;const action=b.dataset.action;const body={};if(action==='publish'){const p=document.getElementById('successor').value.trim();if(p)body.supersede_revision_id=p;}call('/api/knowledge/revisions/'+encodeURIComponent(id)+'/'+action,body);};
</script></body></html>`;
  return {
    body: Buffer.from(body),
    nonce,
    origin: publicOrigin,
  };
}

function errorStatus(error) {
  if (Number.isInteger(error?.status)) return error.status;
  if (error?.code === 'KNOWLEDGE_REVISION_NOT_FOUND') return 404;
  if (error?.code === 'KNOWLEDGE_FORBIDDEN') return 403;
  if (error?.code === 'POLICY_CONFLICT') return 409;
  return error instanceof TypeError ? 400 : 400;
}

export function createKnowledgeControlPlane({
  store,
  access,
  publicOrigin = 'https://ai.babypark.ua',
  nowMs = () => Date.now(),
  logger = () => {},
}) {
  if (!store || typeof store.authoritySnapshot !== 'function') {
    throw new TypeError('store is required');
  }
  const handler = async (req, res) => {
    try {
      if (req.url === '/health' && req.method === 'GET') {
        return sendJson(res, 200, { ok: true, service: 'babypark-knowledge-control' });
      }
      mutationOrigin(req, publicOrigin);
      const actor = await authenticate(req, access, nowMs);
      const url = new URL(req.url, publicOrigin);

      if (req.method === 'GET' && url.pathname === '/') {
        const page = htmlPage(store, actor, publicOrigin);
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-length': page.body.length,
          'cache-control': 'no-store',
          'content-security-policy': `default-src 'self'; script-src 'nonce-${page.nonce}'; object-src 'none'; base-uri 'none'; frame-ancestors https://chat.babypark.ua`,
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff',
        });
        return res.end(page.body);
      }

      if (req.method === 'GET' && url.pathname === '/api/knowledge/revisions') {
        return sendJson(res, 200, {
          ok: true,
          actor_id: actor.actor_id,
          revisions: viewableRows(store, actor),
        });
      }

      const detailMatch = url.pathname.match(
        /^\/api\/knowledge\/revisions\/([^/]+)$/
      );
      if (req.method === 'GET' && detailMatch) {
        const revisionId = decodeURIComponent(detailMatch[1]);
        const revision = store.authoritySnapshot()
          .find(row => row.revision_id === revisionId);
        if (!revision) {
          const error = new Error('revision not found');
          error.code = 'KNOWLEDGE_REVISION_NOT_FOUND';
          error.status = 404;
          throw error;
        }
        authorizeKnowledgeAction({
          actorId: actor.actor_id,
          grants: actor.grants,
          action: 'VIEW',
          ...revisionScope(revision),
        });
        return sendJson(res, 200, {
          ok: true,
          revision,
          events: store.eventsForRevision(revisionId),
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/knowledge/drafts') {
        const body = await readJson(req);
        authorizeKnowledgeAction({
          actorId: actor.actor_id,
          grants: actor.grants,
          action: 'DRAFT_CREATE',
          namespace: body.namespace,
          subjectType: body.subjectType,
          subjectId: body.subjectId,
        });
        const created = store.createDraft({
          ...body,
          authorActorId: actor.actor_id,
        });
        return sendJson(res, 201, { ok: true, created });
      }

      const actionMatch = url.pathname.match(
        /^\/api\/knowledge\/revisions\/([^/]+)\/(approve|publish|revoke|withdraw)$/
      );
      if (req.method === 'POST' && actionMatch) {
        const revisionId = decodeURIComponent(actionMatch[1]);
        const action = actionMatch[2];
        const revision = store.getRevision(revisionId);
        if (!revision) {
          const error = new Error('revision not found');
          error.code = 'KNOWLEDGE_REVISION_NOT_FOUND';
          error.status = 404;
          throw error;
        }
        const actionMap = {
          approve: 'APPROVE',
          publish: 'PUBLISH',
          revoke: 'REVOKE',
          withdraw: 'WITHDRAW',
        };
        authorizeRevisionAction({
          actorId: actor.actor_id,
          grants: actor.grants,
          action: actionMap[action],
          revision,
        });
        const body = await readJson(req);

        if (action === 'approve') {
          return sendJson(res, 200, { ok: true, event: store.approveRevision({
            revisionId,
            actorId: actor.actor_id,
            reason: body.reason ?? null,
            metadata: body.metadata ?? {},
          }) });
        }
        if (action === 'publish') {
          const predecessorId = body.supersede_revision_id ?? null;
          if (predecessorId !== null) {
            const predecessor = store.getRevision(predecessorId);
            if (!predecessor) {
              const error = new Error('predecessor not found');
              error.code = 'KNOWLEDGE_REVISION_NOT_FOUND';
              error.status = 404;
              throw error;
            }
            authorizeRevisionAction({
              actorId: actor.actor_id,
              grants: actor.grants,
              action: 'SUPERSEDE',
              revision: predecessor,
            });
          }
          return sendJson(res, 200, { ok: true, result: store.publishRevision({
            revisionId,
            actorId: actor.actor_id,
            reason: body.reason ?? null,
            metadata: body.metadata ?? {},
            supersedeRevisionId: predecessorId,
          }) });
        }
        if (action === 'revoke') {
          return sendJson(res, 200, { ok: true, event: store.revokeRevision({
            revisionId,
            actorId: actor.actor_id,
            reason: body.reason ?? null,
            metadata: body.metadata ?? {},
          }) });
        }
        return sendJson(res, 200, { ok: true, event: store.withdrawRevision({
          revisionId,
          actorId: actor.actor_id,
          reason: body.reason ?? null,
          metadata: body.metadata ?? {},
        }) });
      }

      if (req.method === 'GET' && url.pathname === '/api/knowledge/operational') {
        const storeId = url.searchParams.get('store_id');
        const nowUtc = url.searchParams.get('now_utc') ?? new Date(nowMs()).toISOString();
        authorizeKnowledgeAction({
          actorId: actor.actor_id,
          grants: actor.grants,
          action: 'RESOLVE',
          namespace: '*',
          subjectType: 'store',
          subjectId: storeId,
        });
        return sendJson(res, 200, {
          ok: true,
          result: resolveStoreOperationalState(store, { nowUtc, storeId }),
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/knowledge/commerce/resolve') {
        const body = await readJson(req);
        authorizeKnowledgeAction({
          actorId: actor.actor_id,
          grants: actor.grants,
          action: 'RESOLVE',
          namespace: '*',
          subjectType: body.subjectType,
          subjectId: body.subjectId,
        });
        return sendJson(res, 200, {
          ok: true,
          result: resolveCommercePolicy(store, {
            nowUtc: body.nowUtc ?? new Date(nowMs()).toISOString(),
            subjectType: body.subjectType,
            subjectId: body.subjectId,
            effectFamily: body.effectFamily,
            bindings: body.bindings ?? {},
          }),
        });
      }

      return sendJson(res, 404, { ok: false, error: 'ROUTE_NOT_FOUND' });
    } catch (error) {
      logger('error', 'knowledge_control_request_failed', {
        code: String(error?.code ?? error?.name ?? 'ERROR').slice(0, 128),
      });
      return sendJson(res, errorStatus(error), {
        ok: false,
        error: error?.code ?? 'REQUEST_INVALID',
      });
    }
  };

  const server = http.createServer({
    maxHeaderSize: 16384,
    insecureHTTPParser: false,
  }, handler);
  server.headersTimeout = 10000;
  server.requestTimeout = 30000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 48;

  return {
    server,
    async listen({ host = '127.0.0.1', port = 0 } = {}) {
      await new Promise((resolve, reject) =>
        server.listen(port, host, resolve).once('error', reject)
      );
      return server.address();
    },
    async close() {
      if (server.listening) {
        await new Promise(resolve => server.close(resolve));
      }
    },
  };
}
