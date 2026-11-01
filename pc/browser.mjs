import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readConfig, readToken, tlsFiles} from '../lib/config.mjs';
import {createRemoteClient} from '../lib/client.mjs';
import {startBrowserServer} from './server.mjs';
import {publicCode, fault} from '../lib/errors.mjs';

try {
  const config = readConfig(process.argv[2]);
  const token = readToken(config.remote.tokenFile), uiToken = readToken(config.uiTokenFile);
  if (token === uiToken) throw fault('SEPARATE_CREDENTIALS_REQUIRED');
  const remoteClient = createRemoteClient({...config.remote, token, tls: tlsFiles(config.remote.tls)});
  let getVaultStatus;
  if (config.vault) {
    // Optional PC-only integration. Imports the public projection, never a CLI/controller.
    if (!path.isAbsolute(config.vault.projectPath || '') || !path.isAbsolute(config.vault.configFile || '')) throw fault('INVALID_VAULT_CONFIG');
    const {readVaultStatus} = await import(pathToFileURL(path.join(config.vault.projectPath, 'lib/status.mjs')).href);
    const vaultConfig = readConfig(config.vault.configFile);
    getVaultStatus = () => {
      try { return {available: true, ...readVaultStatus(vaultConfig.dataRoot, vaultConfig.deviceId)}; }
      catch (error) { return {available: false, errorCode: publicCode(error)}; }
    };
  }
  const browser = await startBrowserServer({remoteClient, uiToken, getVaultStatus, port: config.port ?? 0});
  console.log(JSON.stringify({service: 'remote-files-browser', url: browser.url, login: 'use the independent UI token file; do not paste it into chat'}));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => browser.close().then(() => process.exit(0)));
} catch (error) { console.error(JSON.stringify({ok: false, errorCode: publicCode(error)})); process.exitCode = 1; }
