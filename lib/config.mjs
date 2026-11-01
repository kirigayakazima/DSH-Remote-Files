import fs from 'node:fs';
import path from 'node:path';
import {X509Certificate} from 'node:crypto';
import {fault} from './errors.mjs';

export function readConfig(file) {
  if (!file || !path.isAbsolute(path.resolve(file))) throw fault('CONFIG_REQUIRED');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fault('INVALID_CONFIG');
  return value;
}
export function readToken(file) {
  if (!file || !path.isAbsolute(file)) throw fault('TOKEN_FILE_REQUIRED');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) throw fault('INVALID_TOKEN_FILE');
  return fs.readFileSync(file, 'utf8').trim();
}
export function tlsFiles(value) {
  if (!value) return undefined;
  for (const key of ['keyFile', 'certFile', 'peerCertFile']) if (!path.isAbsolute(value[key] || '')) throw fault('TLS_FILES_REQUIRED');
  const key = fs.readFileSync(value.keyFile), cert = fs.readFileSync(value.certFile), ca = fs.readFileSync(value.peerCertFile);
  return {key, cert, ca, peerFingerprint: new X509Certificate(ca).fingerprint256};
}
export function phoneConfig(file) {
  const config = readConfig(file);
  const protectedFiles = [file, config.tokenFile, config.tls?.keyFile, config.tls?.certFile, config.tls?.peerCertFile].filter(Boolean).map(item => path.resolve(item));
  for (const root of config.roots || []) for (const protectedFile of protectedFiles) {
    const relative = path.relative(path.resolve(root.path || ''), protectedFile);
    if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw fault('CONFIG_SOURCE_OVERLAP');
  }
  return {...config, token: readToken(config.tokenFile), tls: tlsFiles(config.tls)};
}
