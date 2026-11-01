import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {newPairing, phonePairingScript, decodePairing} from '../lib/pairing.mjs';
import {fixture, token} from './helpers.mjs';

test('phone pairing exports only ciphertext and PC binds the response to the session', t => {
  const f = fixture(t), secret = token(), pair = newPairing();
  const tokenFile = path.join(f.root, 'access.token'), outputFile = path.join(f.root, 'result.json'), script = path.join(f.root, 'pair.mjs');
  fs.writeFileSync(tokenFile, secret + '\n');
  fs.writeFileSync(script, phonePairingScript({...pair, tokenFile, outputFile}));
  const result = spawnSync(process.execPath, [script], {encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 0, result.stderr);
  const output = fs.readFileSync(outputFile, 'utf8');
  assert.ok(!output.includes(secret) && !result.stdout.includes(secret) && !result.stderr.includes(secret));
  assert.ok(!fs.readFileSync(script, 'utf8').includes(pair.privateKey));
  const envelope = JSON.parse(output);
  assert.equal(decodePairing(pair, envelope), secret);
  assert.throws(() => decodePairing({...pair, session: 'wrong-session'}, envelope), /INVALID_PAIRING/);
  assert.throws(() => decodePairing(pair, {...envelope, ciphertext: 'tampered'}), /INVALID_PAIRING/);
  assert.throws(() => decodePairing(pair, envelope, pair.expiresAt + 1), /PAIRING_EXPIRED/);
});

test('expired phone pairing never reads or exports the token', t => {
  const f = fixture(t), pair = newPairing(0), outputFile = path.join(f.root, 'result.json'), script = path.join(f.root, 'expired.mjs');
  fs.writeFileSync(script, phonePairingScript({...pair, tokenFile: path.join(f.root, 'absent.token'), outputFile}));
  const result = spawnSync(process.execPath, [script], {encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 1); assert.match(result.stderr, /PAIRING_EXPIRED/);
  assert.equal(fs.existsSync(outputFile), false);
});
