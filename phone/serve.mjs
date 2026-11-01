import {phoneConfig} from '../lib/config.mjs';
import {startFileServer} from '../lib/server.mjs';
import {publicCode} from '../lib/errors.mjs';

try {
  const server = await startFileServer(phoneConfig(process.argv[2]));
  console.log(JSON.stringify({service: 'remote-files', readOnly: true, port: server.port}));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close().then(() => process.exit(0)));
} catch (error) { console.error(JSON.stringify({ok: false, errorCode: publicCode(error)})); process.exitCode = 1; }
