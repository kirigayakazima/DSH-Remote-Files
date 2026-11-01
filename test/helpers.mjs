import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
export const token = () => randomBytes(32).toString('base64url');
export function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-remote-test-'));
  const source = path.join(root, 'source'); fs.mkdirSync(source);
  t.after(() => {
    const absolute = path.resolve(root);
    if (path.dirname(absolute) !== path.resolve(os.tmpdir()) || !path.basename(absolute).startsWith('dsh-remote-test-')) throw Error('invalid fixture cleanup');
    fs.rmSync(absolute, {recursive: true, force: true});
  });
  return {root, source, roots: [{id: 'test', path: source, label: '合成文件'}]};
}
export function certificates(root) {
  const openssl = process.env.OPENSSL || (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
  const result = {};
  for (const role of ['phone', 'pc', 'stranger']) {
    const key = path.join(root, `${role}.key`), cert = path.join(root, `${role}.pem`);
    execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', `/CN=${role}`, '-addext', 'subjectAltName=IP:127.0.0.1'], {stdio: 'ignore', windowsHide: true});
    result[role] = {key: fs.readFileSync(key), cert: fs.readFileSync(cert)};
  }
  return result;
}
