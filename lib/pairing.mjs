// One-time credential transfer: phone exports ciphertext, PC retains the key.
import {createHash, generateKeyPairSync, privateDecrypt, constants, randomUUID} from 'node:crypto';
import {fault} from './errors.mjs';

export function newPairing(now = Date.now()) {
  const keys = generateKeyPairSync('rsa', {modulusLength: 3072, publicKeyEncoding: {type: 'spki', format: 'pem'}, privateKeyEncoding: {type: 'pkcs8', format: 'pem'}});
  const session = randomUUID(), expiresAt = now + 60 * 60 * 1000;
  return {session, expiresAt, ...keys, fingerprint: createHash('sha256').update(keys.publicKey).digest('hex')};
}

export function phonePairingScript({session, expiresAt, publicKey, tokenFile, outputFile}) {
  // This script contains a public key and paths only; no phone or PC credential.
  const settings = JSON.stringify({session, expiresAt, publicKey, tokenFile, outputFile});
  return `import fs from 'node:fs';
import {publicEncrypt, constants} from 'node:crypto';
const config = ${settings};
try {
  if (Date.now() > config.expiresAt) throw Error('PAIRING_EXPIRED');
  const before = fs.lstatSync(config.tokenFile, {bigint: true});
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > 1024n) throw Error('INVALID_TOKEN_FILE');
  const fd = fs.openSync(config.tokenFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  let token;
  try {
    const opened = fs.fstatSync(fd, {bigint: true});
    if (before.dev !== opened.dev || before.ino !== opened.ino || before.ctimeNs !== opened.ctimeNs) throw Error('TOKEN_CHANGED');
    token = fs.readFileSync(fd, 'utf8').trim();
    const after = fs.fstatSync(fd, {bigint: true});
    if (opened.ctimeNs !== after.ctimeNs || opened.mtimeNs !== after.mtimeNs || opened.size !== after.size) throw Error('TOKEN_CHANGED');
  } finally { fs.closeSync(fd); }
  if (!/^[A-Za-z0-9_-]{43,256}$/.test(token)) throw Error('INVALID_TOKEN');
  const payload = Buffer.from(JSON.stringify({session: config.session, token}));
  const ciphertext = publicEncrypt({key: config.publicKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING}, payload).toString('base64');
  payload.fill(0);
  fs.writeFileSync(config.outputFile, JSON.stringify({schema: 1, session: config.session, ciphertext}) + '\\n', {mode: 0o600, flag: 'wx'});
  console.log(JSON.stringify({pairedExport: true, file: config.outputFile, contains: 'RSA-OAEP-SHA256 ciphertext only'}));
} catch (error) {
  const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'PAIRING_EXPORT_FAILED';
  console.error(JSON.stringify({ok: false, errorCode: code})); process.exitCode = 1;
}
`;
}

export function decodePairing(pair, envelope, now = Date.now()) {
  if (now > pair.expiresAt) throw fault('PAIRING_EXPIRED');
  if (envelope?.schema !== 1 || envelope.session !== pair.session || typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length > 2048) throw fault('INVALID_PAIRING');
  let plain;
  try {
    plain = privateDecrypt({key: pair.privateKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING}, Buffer.from(envelope.ciphertext, 'base64'));
    const data = JSON.parse(plain.toString('utf8'));
    if (data.session !== pair.session || !/^[A-Za-z0-9_-]{43,256}$/.test(data.token || '')) throw fault('INVALID_PAIRING');
    return data.token;
  } catch { throw fault('INVALID_PAIRING'); }
  finally { plain?.fill(0); }
}
