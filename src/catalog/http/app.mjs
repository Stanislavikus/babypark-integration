import crypto from 'node:crypto';
import http from 'node:http';
import { verifySignedRequest } from '../ingest/auth.mjs';
import { processProductionFullChunk } from '../ingest/production-full-coordinator.mjs';
import { extractSignedHeaders } from './headers.mjs';
import { readBoundedBody, MAX_BODY_BYTES } from './body.mjs';
import { publicError, translateResult } from './responses.mjs';
import { readCatalogState } from './state.mjs';

const ROUTES = new Map([['/api/catalog/ingest/v1/full', 'POST'], ['/api/catalog/ingest/v1/state', 'GET'], ['/health', 'GET']]);

function send(res, status, body, headers = {}) {
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length, ...headers });
  res.end(bytes);
}

function transportEncoding(req) {
  const value = req.headersDistinct?.['content-encoding'];
  if (value === undefined) return 'identity';
  if (!Array.isArray(value) || value.length !== 1 || value[0] !== 'identity') throw Object.assign(new Error('unsupported encoding'), { code: 'TRANSPORT_UNSUPPORTED' });
  return value[0];
}

export function createCatalogHttpRuntime({ config, identityStore, replayStore, mutex, reader, publisher, logger = { log() {} }, now = () => Math.floor(Date.now() / 1000), coordinator = processProductionFullChunk }) {
  const handler = async (req, res) => {
    const requestId = crypto.randomUUID(); const started = Date.now();
    let verified; let publicCode; let publicAction;
    const finishLog = status => logger.log({ request_id: requestId, method: req.method, route: ROUTES.has(req.url) ? req.url : 'unknown', ...(verified ? { kid: verified.kid, run_id: verified.run_id, seq: verified.seq, final: verified.final } : {}), status, public_code: publicCode, public_action: publicAction, duration_ms: Date.now() - started });
    try {
      const expectedMethod = ROUTES.get(req.url);
      if (!expectedMethod) { const e = publicError('ROUTE_INVALID', requestId); e.status = 404; e.body.status = 404; e.body.code = 'ROUTE_INVALID'; e.body.action = 'fix_request'; publicCode=e.body.code; publicAction=e.body.action; send(res,e.status,e.body); return finishLog(e.status); }
      if (req.method !== expectedMethod) { const e = publicError('METHOD_NOT_ALLOWED',requestId); e.status=405; e.body.status=405; e.body.code='METHOD_NOT_ALLOWED'; e.body.action='fix_request'; publicCode=e.body.code; publicAction=e.body.action; send(res,405,e.body,{ Allow: expectedMethod }); return finishLog(405); }
      if (req.url === '/health') {
        try { const state = readCatalogState(reader, config); send(res,200,{ ok:true, service:'babypark-catalog-ingest', state:state.state, accepting_ingest:state.accepting_ingest, blockers:state.blockers },{'Cache-Control':'no-store'}); finishLog(200); }
        catch { publicCode='INTERNAL_INVARIANT'; publicAction='operator'; send(res,500,{ ok:false, service:'babypark-catalog-ingest', state:'INVALID', accepting_ingest:false, blockers:['INTERNAL_INVARIANT'] },{'Cache-Control':'no-store'}); finishLog(500); }
        return;
      }
      transportEncoding(req);
      if (req.url.endsWith('/full') && req.headers['content-type'] !== 'application/json') throw Object.assign(new Error('media'), { code:'TRANSPORT_UNSUPPORTED' });
      if (req.url.endsWith('/full') && !config.ingestEnabled) throw Object.assign(new Error('disabled'), { code:'INGEST_DISABLED' });
      const body = await readBoundedBody(req, { maximum: MAX_BODY_BYTES, requireEmpty: req.url.endsWith('/state') });
      const headers = extractSignedHeaders(req);
      verified = verifySignedRequest({ method:req.method, path:req.url, headers, bodyBytes:body, secrets:config.secrets, audience:config.audience, maxAgeSec:config.maxAgeSec, maxBodyBytes:MAX_BODY_BYTES, allowGzip:false, now });
      if (req.url.endsWith('/state')) {
        if (verified.run_id !== 'state' || verified.seq !== 0 || verified.final !== false || verified.content_encoding !== 'identity') throw Object.assign(new Error('state tuple'), { code:'INGEST_AUTH_HEADER_INVALID' });
        const state = readCatalogState(reader, config); send(res,200,state,{'Cache-Control':'no-store'}); return finishLog(200);
      }
      const key = { kid:verified.kid, runId:verified.run_id, layer:'full', seq:verified.seq, final:verified.final, contentEncoding:verified.content_encoding, bodySha256:verified.body_sha256 };
      const result = coordinator({ store:replayStore, publisher, mutex, reader, identityStore, key, verifiedBody:body });
      const translated = translateResult(result, Number(now()));
      publicCode=translated.body.code; publicAction=translated.body.action;
      send(res,translated.status,translated.body,translated.retryAfter ? {'Retry-After':String(translated.retryAfter)} : {}); finishLog(translated.status);
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      const code = error?.code === 'BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' : error?.code === 'TRANSPORT_UNSUPPORTED' ? 'TRANSPORT_UNSUPPORTED' : error?.code || 'INTERNAL_INVARIANT';
      let e;
      if (code === 'BODY_TOO_LARGE') e={ status:413, body:{schema:'bp.catalog.error/1',status:413,code,action:'fix_request',request_id:requestId} };
      else if (code === 'TRANSPORT_UNSUPPORTED') e={ status:415, body:{schema:'bp.catalog.error/1',status:415,code,action:'fix_request',request_id:requestId} };
      else e=publicError(code,requestId);
      publicCode=e.body.code; publicAction=e.body.action;
      logger.log({ request_id:requestId, method:req.method, route:ROUTES.has(req.url)?req.url:'unknown', status:e.status, public_code:publicCode, public_action:publicAction, internal_code:code, duration_ms:Date.now()-started });
      send(res,e.status,e.body,e.retryAfter ? {'Retry-After':String(e.retryAfter)} : {});
    }
  };
  const server = http.createServer({ maxHeaderSize:8192, insecureHTTPParser:false }, handler);
  server.headersTimeout=10000; server.requestTimeout=30000; server.keepAliveTimeout=5000; server.maxHeadersCount=32;
  server.on('checkContinue',(req,res)=>{ const e=publicError('EXPECTATION_FAILED'); e.status=417; e.body.status=417; e.body.code='EXPECTATION_FAILED'; e.body.action='fix_request'; send(res,417,e.body); });
  server.on('clientError',(_error,socket)=>{ if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  return { server, async listen({ host=config.host, port=config.port }={}) { await new Promise((resolve,reject)=>server.listen(port,host,resolve).once('error',reject)); return server.address(); }, async close() { if (server.listening) await new Promise(resolve=>server.close(resolve)); } };
}
