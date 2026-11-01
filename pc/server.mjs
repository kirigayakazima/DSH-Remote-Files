import http from 'node:http';
import fs from 'node:fs/promises';
import {tokenVerifier} from '../lib/auth.mjs';
import {fault, publicCode, statusCode} from '../lib/errors.mjs';
import {json} from '../lib/server.mjs';

const assets = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']]]);
const remoteRoutes = new Set(['status', 'roots', 'list', 'read', 'stat']);
export async function startBrowserServer({remoteClient, uiToken, getVaultStatus = () => ({available: false}), port = 0}) {
  const verify = tokenVerifier(uiToken);
  let stopped = false;
  const server = http.createServer(async (req, res) => {
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    try {
      if (req.headers.host !== `127.0.0.1:${server.address().port}` || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) throw fault('PATH_DENIED');
      if (req.method !== 'GET') { json(res, 405, {ok: false, errorCode: 'READ_ONLY'}); return; }
      if ((req.url || '').length > 4096 || req.headers['transfer-encoding'] || Number(req.headers['content-length'] || 0)) throw fault('INVALID_REQUEST');
      const url = new URL(req.url, 'http://local.invalid');
      const asset = assets.get(url.pathname);
      if (asset) {
        if (url.search) throw fault('INVALID_REQUEST');
        const data = await fs.readFile(new URL(`../web/${asset[0]}`, import.meta.url));
        res.writeHead(200, {'Content-Type': asset[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'", 'Referrer-Policy': 'no-referrer'});
        res.end(data); return;
      }
      if (!verify(req.headers.authorization)) throw fault('UNAUTHORIZED');
      let result;
      if (url.pathname === '/api/vault') {
        if (url.search) throw fault('INVALID_REQUEST');
        result = await getVaultStatus();
      } else {
        const route = url.pathname.replace(/^\/api\//, '');
        if (!remoteRoutes.has(route) || url.pathname !== `/api/${route}`) throw fault('NOT_FOUND');
        result = await remoteClient.request(`/v1/${route}${url.search}`, {signal: abort.signal});
      }
      if (!stopped && !res.destroyed) json(res, 200, result);
    } catch (error) { if (!res.headersSent && !res.destroyed) json(res, statusCode(publicCode(error)), {ok: false, errorCode: publicCode(error)}); }
  });
  server.headersTimeout = 5000; server.requestTimeout = 10000; server.maxHeadersCount = 32;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return {server, url: `http://127.0.0.1:${server.address().port}`, async close() { stopped = true; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }};
}
