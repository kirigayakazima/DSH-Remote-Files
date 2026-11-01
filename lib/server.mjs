import http from 'node:http';
import https from 'node:https';
import {createFileStore} from './files.mjs';
import {tokenVerifier, loopback, privateAddress} from './auth.mjs';
import {fault, publicCode, statusCode} from './errors.mjs';

export function json(res, status, value) {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
  res.end(JSON.stringify(value));
}
const routes = new Map([
  ['/v1/status', []], ['/v1/roots', []], ['/v1/list', ['root', 'path', 'offset', 'limit', 'revision']],
  ['/v1/read', ['root', 'path', 'offset', 'limit', 'revision']], ['/v1/stat', ['root', 'path']],
]);
export async function startFileServer(config, {onAccess = () => {}, getHeartStatus = () => ({available: false})} = {}) {
  const host = config.host || '127.0.0.1', port = config.port ?? 0;
  if (!loopback(host) && !privateAddress(host)) throw fault('PRIVATE_NETWORK_REQUIRED');
  if ((!loopback(host) || config.tls) && (!config.tls?.key || !config.tls?.cert || !config.tls?.ca || !config.tls?.peerFingerprint)) throw fault('MTLS_REQUIRED');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw fault('INVALID_PORT');
  const verify = tokenVerifier(config.token);
  const files = await createFileStore(config.roots, config.limits);
  let active = 0, closed = false;
  const handler = async (req, res) => {
    try {
      if (!verify(req.headers.authorization)) throw fault('UNAUTHORIZED');
      if (config.tls && (!req.socket.authorized || req.socket.getPeerCertificate().fingerprint256 !== config.tls.peerFingerprint)) throw fault('UNAUTHORIZED');
      if (req.headers.origin) throw fault('PATH_DENIED'); // Browser talks to the local broker, never directly here.
      if (req.method !== 'GET') { json(res, 405, {ok: false, errorCode: 'READ_ONLY'}); return; }
      if (req.headers['transfer-encoding'] || Number(req.headers['content-length'] || 0) !== 0 || (req.url || '').length > 4096) throw fault('INVALID_REQUEST');
      if (active >= 4) throw fault('BUSY');
      const url = new URL(req.url, 'http://read-only.invalid');
      const allowed = routes.get(url.pathname);
      if (!allowed) throw fault('NOT_FOUND');
      const seen = new Set();
      for (const [key] of url.searchParams) {
        if (!allowed.includes(key) || seen.has(key)) throw fault('INVALID_REQUEST');
        seen.add(key);
      }
      active++;
      try {
        const args = Object.fromEntries(url.searchParams);
        let data;
        if (url.pathname === '/v1/status') data = {schema: 1, mode: 'live', readOnly: true, version: '0.1.1', observedAt: new Date().toISOString(), heart: getHeartStatus()};
        else if (url.pathname === '/v1/roots') data = {roots: files.roots()};
        else if (url.pathname === '/v1/list') data = await files.list(args.root, args.path, args);
        else if (url.pathname === '/v1/stat') data = await files.stat(args.root, args.path);
        else data = await files.read(args.root, args.path, args);
        if (closed || res.destroyed) return;
        json(res, 200, {ok: true, ...data});
        try { onAccess({kind: url.pathname === '/v1/read' ? 'read' : 'browse'}); } catch {}
      } finally { active--; }
    } catch (error) { if (!res.headersSent && !res.destroyed) json(res, statusCode(publicCode(error)), {ok: false, errorCode: publicCode(error)}); }
  };
  const server = config.tls ? https.createServer({...config.tls, requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.2'}, handler) : http.createServer(handler);
  server.on('tlsClientError', () => {});
  server.headersTimeout = 5000; server.requestTimeout = 10000; server.maxHeadersCount = 32;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const address = server.address();
  return {server, host, port: address.port, async close() { closed = true; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }};
}
