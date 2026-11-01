import fs from 'node:fs';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {newPairing, phonePairingScript, decodePairing} from '../lib/pairing.mjs';
import {createRemoteClient} from '../lib/client.mjs';
import {fault, publicCode} from '../lib/errors.mjs';

const [command, privateDir, adb, serial] = process.argv.slice(2);
try {
  if (!['prepare', 'finish'].includes(command) || !path.isAbsolute(privateDir || '') || !path.isAbsolute(adb || '') || !/^[a-zA-Z0-9._:-]+$/.test(serial || '')) throw fault('PAIRING_ARGUMENTS_REQUIRED');
  fs.mkdirSync(privateDir, {recursive: true, mode: 0o700});
  if (fs.lstatSync(privateDir).isSymbolicLink() || path.resolve(fs.realpathSync(privateDir)) !== path.resolve(privateDir)) throw fault('PRIVATE_DIRECTORY_REQUIRED');
  if (process.platform === 'win32') {
    const owner = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {encoding: 'utf8', windowsHide: true}).match(/S-1-5-(?:\d+-)*\d+/)?.[0];
    if (!owner) throw fault('PRIVATE_DIRECTORY_REQUIRED');
    execFileSync('icacls.exe', [privateDir, '/inheritance:r', '/grant:r', `*${owner}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], {windowsHide: true, stdio: 'pipe'});
  } else fs.chmodSync(privateDir, 0o700);
  const stateFile = path.join(privateDir, 'pairing-state.json'), keyFile = path.join(privateDir, 'pairing-private.pem');
  const store = (name, value) => fs.writeFileSync(path.join(privateDir, name), value, {mode: 0o600, flag: 'wx'});
  let state;
  if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (state?.serial && state.serial !== serial) throw fault('PAIRING_DEVICE_MISMATCH');
  if (command === 'prepare') {
    if (state?.phase === 'paired') { console.log(JSON.stringify({paired: true, configFile: path.join(privateDir, 'pc.local.json')})); }
    else if (state) {
      if (Date.now() > state.expiresAt) throw fault('PAIRING_EXPIRED');
      console.log(JSON.stringify({prepared: true, scriptFile: path.join(privateDir, 'pair-remote-files.mjs'), phoneCommand: `node ${state.remoteScript}`}));
    } else {
      const pair = newPairing();
      const remoteScript = `/sdcard/dshproject/updates/pair-remote-files-${pair.session}.mjs`;
      const remoteResult = `/sdcard/dshproject/updates/remote-files-pairing-${pair.session}.json`;
      const script = phonePairingScript({...pair, tokenFile: '/root/.dsh-remote-files/access.token', outputFile: remoteResult});
      store('pairing-private.pem', pair.privateKey);
      store('pair-remote-files.mjs', script);
      store('pairing-state.json', JSON.stringify({schema: 1, phase: 'pending', session: pair.session, expiresAt: pair.expiresAt, fingerprint: pair.fingerprint, serial, remoteScript, remoteResult}, null, 2) + '\n');
      console.log(JSON.stringify({prepared: true, scriptFile: path.join(privateDir, 'pair-remote-files.mjs'), phoneCommand: `node ${remoteScript}`, expiresAt: new Date(pair.expiresAt).toISOString()}));
    }
  } else {
    if (!state) throw fault('PAIRING_NOT_PREPARED');
    if (state.phase === 'paired') { console.log(JSON.stringify({paired: true, configFile: path.join(privateDir, 'pc.local.json')})); }
    else {
      if (!/^\/sdcard\/dshproject\/updates\/remote-files-pairing-[a-f0-9-]+\.json$/.test(state.remoteResult)) throw fault('INVALID_PAIRING');
      const result = spawnSync(adb, ['-s', serial, 'exec-out', 'cat', state.remoteResult], {maxBuffer: 8192, timeout: 10000, windowsHide: true});
      if (result.status !== 0) throw fault('PAIRING_RESULT_NOT_FOUND');
      const token = decodePairing({...state, privateKey: fs.readFileSync(keyFile, 'utf8')}, JSON.parse(result.stdout.toString('utf8')));
      const client = createRemoteClient({url: 'http://127.0.0.1:22225/', token});
      const status = await client.request('/v1/status');
      const roots = await client.request('/v1/roots');
      if (status.readOnly !== true || status.mode !== 'live') throw fault('UNEXPECTED_REMOTE_SERVICE');
      if (!fs.existsSync(path.join(privateDir, 'access.token'))) store('access.token', token + '\n');
      else if (fs.readFileSync(path.join(privateDir, 'access.token'), 'utf8').trim() !== token) throw fault('EXISTING_CREDENTIAL_MISMATCH');
      if (!fs.existsSync(path.join(privateDir, 'ui.token'))) store('ui.token', randomBytes(32).toString('base64url') + '\n');
      const configFile = path.join(privateDir, 'pc.local.json');
      const config = {port: 22226, uiTokenFile: path.join(privateDir, 'ui.token'), remote: {url: 'http://127.0.0.1:22225/', tokenFile: path.join(privateDir, 'access.token')}};
      if (!fs.existsSync(configFile)) store('pc.local.json', JSON.stringify(config, null, 2) + '\n');
      fs.writeFileSync(stateFile, JSON.stringify({...state, phase: 'paired', pairedAt: new Date().toISOString()}, null, 2) + '\n', {mode: 0o600});
      fs.unlinkSync(keyFile); // Retire this one-time key; the exported file contains ciphertext only.
      console.log(JSON.stringify({paired: true, configFile, url: 'http://127.0.0.1:22226/', roots: roots.roots.map(({id, label}) => ({id, label})), heartAvailable: status.heart?.available ?? null}));
    }
  }
} catch (error) { console.error(JSON.stringify({ok: false, errorCode: publicCode(error)})); process.exitCode = 1; }
