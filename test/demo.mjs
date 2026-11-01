// Local visual acceptance fixture only. Never reads phone or real Vault data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {startFileServer} from '../lib/server.mjs';
import {createRemoteClient} from '../lib/client.mjs';
import {startBrowserServer} from '../pc/server.mjs';
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-remote-demo-')));
const source = path.join(root, 'source'); fs.mkdirSync(source); fs.mkdirSync(path.join(source, 'body'));
fs.writeFileSync(path.join(source, 'notebook.md'), '# 合成演示\n\n- 先把事情说明白，再慢慢做完。\n- 这里没有小满的真实记忆。\n');
fs.writeFileSync(path.join(source, 'body', 'voice.md'), '# 合成表达习惯\n\n这是一份用于界面验收的测试文件。\n');
fs.writeFileSync(path.join(source, 'mood.json'), JSON.stringify({state: 'calm', source: 'synthetic demo'}, null, 2));
const access = randomBytes(32).toString('base64url');
const uiToken = 'demo-only-local-ui-token-0000000000000000000000';
const phone = await startFileServer({roots: [{id: 'heart', label: 'Heart · 合成演示', path: source}], token: access});
const browser = await startBrowserServer({remoteClient: createRemoteClient({url: `http://127.0.0.1:${phone.port}/`, token: access}), uiToken,
  getVaultStatus: () => ({available: true, lastVerified: {snapshotId: 'a'.repeat(64), verifiedAt: '2026-11-01T00:00:00.000Z', files: 3}})});
console.log(JSON.stringify({url: browser.url, uiToken, scope: 'synthetic localhost demo only'}));
let stopped = false;
async function close() {
  if (stopped) return; stopped = true;
  await browser.close(); await phone.close();
  if (path.dirname(root) === fs.realpathSync.native(os.tmpdir()) && path.basename(root).startsWith('dsh-remote-demo-')) fs.rmSync(root, {recursive: true, force: true});
}
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, close);
setTimeout(close, 300000).unref();
