// Desktop shell for Citydriver.
//
// The renderer is the unmodified Vite build (dist-electron/), served through a
// privileged app:// scheme so absolute asset URLs, the module Web Worker,
// storage, and secure-context APIs behave exactly as on the HTTPS deployment.
// A sandboxed preload exposes only native fullscreen controls, Escape input, and
// the update notice.
import { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, shell } from 'electron';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WindowState } from './window-state.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const rendererDir = path.join(root, 'dist-electron');
const APP_HOST = 'citydriver';
const APP_ORIGIN = `app://${APP_HOST}`;
// Web-only helpers (install banner, offline service worker) are served as empty
// scripts instead of being stripped from the build, so index.html stays untouched.
const WEB_ONLY_SCRIPTS = new Set(['/pwa-register.js', '/pwa-install.js']);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

// --- Command line ----------------------------------------------------------
// Flags may appear anywhere: `electron . --seed=1`, `Citydriver.exe --fullscreen`,
// or Steam launch options. Unknown switches fall through to Chromium.
const argv = process.argv.slice(1);
const has = flag => argv.includes(flag);
const value = flag => argv.find(arg => arg.startsWith(`${flag}=`))?.slice(flag.length + 1);
const options = {
  devUrl: value('--dev-url') ?? process.env.CITYDRIVER_DEV_URL,
  seed: value('--seed'),
  devtools: has('--devtools') || process.env.CITYDRIVER_DEVTOOLS === '1',
  softwareGl: has('--software-gl') || process.env.CITYDRIVER_SOFTWARE_GL === '1',
  fullscreen: has('--fullscreen') ? true : has('--windowed') ? false
    : process.env.CITYDRIVER_FULLSCREEN ? process.env.CITYDRIVER_FULLSCREEN === '1' : true,
};
if (has('--help') || has('-h')) {
  process.stdout.write([
    'Citydriver desktop options:',
    '  --fullscreen | --windowed   Start fullscreen or windowed (default: fullscreen)',
    '  --seed=<number>             Open a specific world, like ?seed= on the web',
    '  --software-gl               Render with SwiftShader instead of the GPU (slow; for testing)',
    '  --devtools                  Open DevTools at startup (F12 toggles them any time)',
    '  --dev-url=<url>             Load a running Vite dev server instead of dist-electron/',
    '',
    'In the game, F toggles fullscreen; F11 or Alt+Enter toggle the window itself.',
    '',
  ].join('\n'));
  app.exit(0);
}

// --- Metadata shared with the web app ---------------------------------------
// The web manifest is the single source of truth for name, description, and colors.
function readManifest() {
  for (const file of [path.join(rendererDir, 'manifest.webmanifest'), path.join(root, 'public', 'manifest.webmanifest')]) {
    try { return JSON.parse(readFileSync(file, 'utf8')); } catch { /* try the next location */ }
  }
  return {};
}
const manifest = readManifest();
const productName = manifest.short_name ?? 'Citydriver';
const backgroundColor = manifest.background_color ?? '#20323d';
app.setName(productName);
if (process.env.CITYDRIVER_USER_DATA) app.setPath('userData', path.resolve(process.env.CITYDRIVER_USER_DATA));

// --- Chromium switches (must run before `ready`) ----------------------------
if (options.softwareGl) {
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
} else {
  // The game requires WebGL 2; prefer a blocklisted GPU over the software fallback.
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
}
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
}]);

// --- Serving the renderer ---------------------------------------------------
const emptyScript = () => new Response('// Not used in the desktop app.\n', { headers: { 'content-type': MIME['.js'] } });
const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': MIME['.txt'] } });

function resolveRendererFile(pathname) {
  const file = path.normalize(path.join(rendererDir, pathname));
  if (file !== rendererDir && !file.startsWith(rendererDir + path.sep)) return null;
  try { return statSync(file).isFile() ? file : null; } catch { return null; }
}

async function serveFile(file) {
  const response = await net.fetch(pathToFileURL(file).href);
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  return new Response(response.body, { status: response.status, headers: { 'content-type': type, 'cache-control': 'no-cache' } });
}

function installProtocols() {
  protocol.handle('app', request => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) return notFound();
    const pathname = decodeURIComponent(url.pathname);
    if (WEB_ONLY_SCRIPTS.has(pathname)) return emptyScript();
    const file = resolveRendererFile(pathname === '/' ? '/index.html' : pathname);
    if (file) return serveFile(file);
    // Extension-less paths are page navigations for the single-page app.
    if (!path.extname(pathname)) return serveFile(path.join(rendererDir, 'index.html'));
    return notFound();
  });
  if (options.devUrl) {
    // Development against Vite: hide the same web-only scripts without editing them.
    const devOrigin = new URL(options.devUrl).origin;
    const scheme = devOrigin.startsWith('https') ? 'https' : 'http';
    protocol.handle(scheme, request => {
      const url = new URL(request.url);
      if (url.origin === devOrigin && WEB_ONLY_SCRIPTS.has(url.pathname)) return emptyScript();
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    });
  }
}

function startUrl() {
  const url = new URL(options.devUrl ?? `${APP_ORIGIN}/`);
  if (options.seed !== undefined) url.searchParams.set('seed', options.seed);
  return url.href;
}

// --- Window -----------------------------------------------------------------
let mainWindow;
function createWindow() {
  const state = new WindowState(path.join(app.getPath('userData'), 'window-state.json'), { width: 1280, height: 800 });
  const window = new BrowserWindow({
    ...state.bounds(), minWidth: 640, minHeight: 400,
    title: productName, backgroundColor, show: false, autoHideMenuBar: true,
    fullscreen: options.fullscreen,
    ...(process.platform === 'linux' ? { icon: path.join(here, 'build', 'icon.png') } : {}),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, preload: path.join(here, 'preload.cjs') },
  });
  mainWindow = window;
  window.on('enter-full-screen', () => window.webContents.send('citydriver:fullscreen-changed', true));
  window.on('leave-full-screen', () => window.webContents.send('citydriver:fullscreen-changed', false));
  if (state.maximized && !options.fullscreen) window.maximize();
  state.track(window);
  window.once('ready-to-show', () => {
    window.show();
    if (options.devtools) window.webContents.openDevTools({ mode: 'detach' });
  });

  const allowedOrigin = new URL(startUrl()).origin;
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === allowedOrigin) return;
    event.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const modifier = input.control || input.meta;
    if (input.key === 'Escape') {
      event.preventDefault();
      if (!input.isAutoRepeat) window.webContents.send('citydriver:escape');
    } else if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      event.preventDefault(); window.setFullScreen(!window.isFullScreen());
    } else if (input.key === 'F12' || (modifier && input.shift && input.key.toUpperCase() === 'I')) {
      event.preventDefault(); window.webContents.toggleDevTools();
    } else if (!app.isPackaged && modifier && !input.shift && input.key.toUpperCase() === 'R') {
      event.preventDefault(); window.webContents.reload();
    }
  });
  window.webContents.on('render-process-gone', async (_event, details) => {
    if (['clean-exit', 'killed'].includes(details.reason)) return;
    console.error(`Renderer process gone: ${details.reason} (exit code ${details.exitCode})`);
    if (window.isDestroyed()) return;
    const { response } = await dialog.showMessageBox(window, {
      type: 'error', title: productName, message: 'The game stopped unexpectedly.',
      detail: `Reason: ${details.reason}.`, buttons: ['Reload', 'Quit'], defaultId: 0, cancelId: 1,
    });
    if (response === 0) window.webContents.reload(); else app.quit();
  });
  window.on('closed', () => { if (mainWindow === window) mainWindow = undefined; });
  void window.loadURL(startUrl());
  return window;
}

function installMenu() {
  if (process.platform !== 'darwin') { Menu.setApplicationMenu(null); return; }
  // macOS needs an application menu for Cmd+Q, Cmd+H, and Cmd+M to work.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }, { type: 'separator' }, { role: 'toggleDevTools' }] },
    { role: 'windowMenu' },
  ]));
}

// --- Lifecycle --------------------------------------------------------------
app.whenReady().then(() => {
  if (!options.devUrl && !existsSync(path.join(rendererDir, 'index.html'))) {
    dialog.showErrorBox(productName, `The web build is missing.\n\nRun "npm run electron:web" first, or start with --dev-url=<vite url>.\n\nLooked in: ${rendererDir}`);
    app.exit(1);
    return;
  }
  installProtocols();
  installMenu();
  for (const [channel, toggle] of [['citydriver:fullscreen-get', false], ['citydriver:fullscreen-toggle', true]]) {
    ipcMain.handle(channel, event => {
      if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return false;
      if (toggle) mainWindow.setFullScreen(!mainWindow.isFullScreen());
      return mainWindow.isFullScreen();
    });
  }
  // No update feed until a Citydriver release destination is configured; this
  // fork never checks the original game's releases.
  ipcMain.handle('citydriver:update-get', () => undefined);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', event => event.preventDefault());
});
