import { spawn } from 'node:child_process';
import electronPath from 'electron';
import { createServer } from 'vite';

// Launch the desktop shell from source.
//
//   npm run electron:dev             start a Vite dev server and open it in Electron;
//                                    web changes hot-reload inside the window
//   npm run electron:dev -- --url=http://127.0.0.1:5173
//                                    attach to a dev server that is already running
//   npm run electron:start           open the production build in dist-electron/ (--built)
//
// Any other flag goes to the app, for example --seed=4817, --fullscreen, --devtools.
const argv = process.argv.slice(2);
const built = argv.includes('--built');
let url = argv.find(arg => arg.startsWith('--url='))?.slice(6) ?? process.env.CITYDRIVER_DEV_URL;
let server;
if (!built && !url) {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 }, clearScreen: false });
  await server.listen();
  url = `http://127.0.0.1:${server.httpServer.address().port}/`;
  console.log(`Vite dev server for Electron: ${url}`);
}
// Editor terminals often export ELECTRON_RUN_AS_NODE, which would start Electron as plain Node.
const { ELECTRON_RUN_AS_NODE: _ignored, CITYDRIVER_DEV_URL: _unused, ...env } = process.env;
const appArgs = argv.filter(arg => arg !== '--built' && !arg.startsWith('--url='));
const child = spawn(electronPath, ['.', ...appArgs], {
  stdio: 'inherit', env: built ? env : { ...env, CITYDRIVER_DEV_URL: url },
});
child.on('exit', async code => { await server?.close(); process.exit(code ?? 0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
