import {createHash, timingSafeEqual} from 'node:crypto';
import {fault} from './errors.mjs';
export function tokenVerifier(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43,256}$/.test(token)) throw fault('STRONG_TOKEN_REQUIRED');
  const expected = createHash('sha256').update(token).digest();
  return header => {
    if (typeof header !== 'string' || header.length > 300 || !header.startsWith('Bearer ')) return false;
    return timingSafeEqual(expected, createHash('sha256').update(header.slice(7)).digest());
  };
}
export const loopback = host => host === '127.0.0.1' || host === '::1';
export const privateAddress = host => /^(?:192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(host);
export function transportURL(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !['https:', 'http:'].includes(url.protocol)) throw fault('INVALID_REMOTE_URL');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol === 'http:' && !loopback(host)) throw fault('TLS_REQUIRED');
  if (!loopback(host) && !privateAddress(host)) throw fault('PRIVATE_NETWORK_REQUIRED');
  return url;
}
