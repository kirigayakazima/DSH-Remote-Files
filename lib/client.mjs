import http from 'node:http';
import https from 'node:https';
import {transportURL, tokenVerifier} from './auth.mjs';
import {fault} from './errors.mjs';

export function createRemoteClient({url, token, tls}) {
  const base = transportURL(url); tokenVerifier(token);
  if (base.protocol === 'https:' && (!tls?.key || !tls?.cert || !tls?.ca)) throw fault('MTLS_REQUIRED');
  const request = (route, {signal} = {}) => new Promise((resolve, reject) => {
    if (!/^\/v1\/(?:status|roots|list|read|stat)(?:\?|$)/.test(route)) { reject(fault('PATH_DENIED')); return; }
    const library = base.protocol === 'https:' ? https : http;
    const req = library.request(new URL(route, base), {...tls, rejectUnauthorized: true, method: 'GET', agent: false, signal, headers: {Authorization: `Bearer ${token}`}}, res => {
      if (base.protocol === 'https:' && tls.peerFingerprint && res.socket.getPeerCertificate().fingerprint256 !== tls.peerFingerprint) {
        res.resume(); req.destroy(fault('REMOTE_UNAVAILABLE')); reject(fault('REMOTE_UNAVAILABLE')); return;
      }
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 4 * 1024 * 1024) req.destroy(fault('RESPONSE_LIMIT')); else chunks.push(chunk); });
      res.on('error', () => reject(fault('REMOTE_UNAVAILABLE')));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (res.statusCode !== 200 || data.ok !== true) { reject(fault(/^[A-Z0-9_]{1,80}$/.test(data.errorCode || '') ? data.errorCode : 'REMOTE_REJECTED')); return; }
          resolve(data);
        } catch { reject(fault('INVALID_RESPONSE')); }
      });
    });
    req.setTimeout(8000, () => req.destroy(fault('REMOTE_TIMEOUT')));
    req.on('error', error => reject(fault(error.code === 'REMOTE_TIMEOUT' || error.code === 'RESPONSE_LIMIT' ? error.code : 'REMOTE_UNAVAILABLE')));
    req.end();
  });
  return Object.freeze({request});
}
