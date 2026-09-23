import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { _electron as electron } from '@playwright/test';

// Smoke test for the desktop shell. It launches the real Electron app on the
// production renderer build and checks the few things the wrapper is responsible
// for: serving the build over app://, keeping the worker and secure-context APIs
// working, hiding web-only install UI, keyboard driving, fullscreen, and city
// settings. Screenshots and a JSON report go to .artifacts/electron/.
//
//   npm run test:electron               build dist-electron/ if missing, test `electron .`
//   npm run test:electron -- --build    rebuild dist-electron/ first
//   npm run test:electron -- --packaged test the unpacked app under release/ (after electron:pack)
//   npm run test:electron -- --software-gl   force SwiftShader (used on CI)
const root = path.resolve(import.meta.dirname, '..');
const flags = new Set(process.argv.slice(2));
const packaged = flags.has('--packaged');
const softwareGl = flags.has('--software-gl') || process.env.CITYDRIVER_SOFTWARE_GL === '1';
const out = path.join(root, '.artifacts', 'electron');
const userData = path.join(out, 'user-data');
if (!path.resolve(userData).startsWith(path.resolve(root, '.artifacts') + path.sep)) throw new Error('Test profile must stay in workspace artifacts');
await rm(userData, { recursive: true, force: true });
await mkdir(userData, { recursive: true });

const require = createRequire(import.meta.url);
const builderConfig = require('../electron/builder.config.cjs');
const productName = builderConfig.productName;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!packaged && (flags.has('--build') || !existsSync(path.join(root, 'dist-electron', 'index.html')))) {
  console.log('Building the renderer into dist-electron/ ...');
  const build = spawnSync(npm, ['run', 'electron:web'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

function packagedExecutable() {
  const release = path.join(root, 'release');
  const candidates = process.platform === 'win32'
    ? [path.join(release, 'win-unpacked', `${productName}.exe`)]
    : process.platform === 'darwin'
      ? ['mac-arm64', 'mac', 'mac-universal'].map(dir => path.join(release, dir, `${productName}.app`, 'Contents', 'MacOS', productName))
      : [path.join(release, 'linux-unpacked', builderConfig.linux.executableName)];
  const found = candidates.find(existsSync);
  if (!found) throw new Error(`No unpacked build under release/. Run "npm run electron:pack" first. Looked for:\n  ${candidates.join('\n  ')}`);
  return found;
}

const appArgs = ['--seed=4817', ...(flags.has('--windowed') ? ['--windowed'] : []), ...(softwareGl ? ['--software-gl'] : [])];
// Editor terminals often export ELECTRON_RUN_AS_NODE, which would start Electron as plain Node.
const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
const launchOptions = {
  cwd: root,
  env: { ...env, CITYDRIVER_FULLSCREEN: '', CITYDRIVER_USER_DATA: userData },
  args: packaged ? appArgs : ['.', ...appArgs],
  ...(packaged ? { executablePath: packagedExecutable() } : {}),
  timeout: 60_000,
};
console.log(`Launching ${packaged ? launchOptions.executablePath : 'electron .'} ${appArgs.join(' ')}`);

const report = { mode: packaged ? 'packaged' : 'source', softwareGl, platform: process.platform, checks: [], warnings: [], errors: [] };
const check = (name, condition, detail) => {
  report.checks.push({ name, ok: Boolean(condition), ...(detail === undefined ? {} : { detail }) });
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ` (${JSON.stringify(detail)})`}`);
  if (!condition) report.errors.push(`Check failed: ${name}`);
};
const warn = (name, detail) => { report.warnings.push({ name, detail }); console.log(`warn ${name} (${JSON.stringify(detail)})`); };

const electronApp = await electron.launch(launchOptions);
const consoleErrors = [];
electronApp.on('window', page => {
  page.on('pageerror', error => consoleErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
});
let page;
try {
  page = await electronApp.firstWindow();
  const windowState = () => electronApp.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    return { fullscreen: window.isFullScreen(), title: window.getTitle(), bounds: window.getBounds(), visible: window.isVisible() };
  });
  await page.waitForFunction(() => document.querySelector('#loading.loaded') && document.querySelector('#error')?.hidden, null, { timeout: 90_000 });
  await page.waitForTimeout(800);

  const environment = await page.evaluate(async () => ({
    href: location.href,
    secureContext: window.isSecureContext,
    webgl2: Boolean(document.createElement('canvas').getContext('webgl2')),
    installUi: document.querySelectorAll('.pwa-install, #pwa-install-invitation').length,
    serviceWorkers: 'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations().catch(() => [])).length : 0,
    storage: (() => { try { localStorage.setItem('citydriver-desktop-check', '1'); localStorage.removeItem('citydriver-desktop-check'); return true; } catch { return false; } })(),
    journey: document.body.dataset.journey,
    title: document.title,
    pixelRatio: window.devicePixelRatio,
    viewport: [window.innerWidth, window.innerHeight],
  }));
  check('renderer served over app://', environment.href.startsWith('app://citydriver/'), environment.href);
  check('seed flag reaches the page', new URL(environment.href).searchParams.get('seed') === '4817');
  check('secure context', environment.secureContext);
  check('WebGL 2 available', environment.webgl2);
  check('web-only install UI suppressed', environment.installUi === 0, environment.installUi);
  check('no service worker registered', environment.serviceWorkers === 0, environment.serviceWorkers);
  check('localStorage works on app://', environment.storage);
  check('city scene active', environment.journey === 'city', environment.journey);
  check('no update destination', await page.evaluate(async () => (await window.citydriverDesktop.getUpdate()) === undefined));
  const initial = await windowState();
  const strictFullscreen = process.platform !== 'linux';
  const fullscreenCheck = (name, condition, detail) => strictFullscreen ? check(name, condition, detail) : condition ? check(name, true) : warn(`${name} (not enforced on Linux CI without a window manager)`, detail);
  check('window visible', initial.visible);
  check('window title', initial.title.includes(productName), initial.title);
  fullscreenCheck('startup fullscreen matches launch option', initial.fullscreen === !flags.has('--windowed'));
  report.environment = { ...environment, bounds: initial.bounds };
  await page.screenshot({ path: path.join(out, 'welcome.png') });

  // Keyboard driving through the shell.
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => document.querySelector('#distance').textContent !== '0.0', null, { timeout: 25_000 });
  await page.keyboard.up('KeyW');
  check('keyboard drives the car', await page.locator('#welcome').evaluate(el => el.classList.contains('hidden')));
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => !document.querySelector('#pause-overlay').hidden);
  check('P pauses', true);
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => document.querySelector('#pause-overlay').hidden);

  // All fullscreen controls share native state, without HTML fullscreen swallowing Escape.
  // Playwright's synthetic keys bypass Electron's before-input-event, so the shell's
  // own shortcuts are sent through Chromium's input pipeline with sendInputEvent.
  const sendKey = keyCode => electronApp.evaluate(({ BrowserWindow }, keyCode) => {
    const { webContents } = BrowserWindow.getAllWindows()[0];
    webContents.focus();
    webContents.sendInputEvent({ type: 'keyDown', keyCode });
    webContents.sendInputEvent({ type: 'keyUp', keyCode });
  }, keyCode);
  if (!(await windowState()).fullscreen) {
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(800);
  }
  let state = await windowState();
  fullscreenCheck('native fullscreen active', state.fullscreen, state.bounds);
  check('no HTML fullscreen session', await page.evaluate(() => document.fullscreenElement === null));
  check('fullscreen setting reflects native state', await page.locator('#fullscreen').getAttribute('aria-pressed') === String(state.fullscreen));
  await sendKey('Escape');
  await page.waitForFunction(() => !document.querySelector('#pause-overlay').hidden);
  fullscreenCheck('Escape opens pause without leaving fullscreen', (await windowState()).fullscreen);
  await sendKey('Escape');
  await page.waitForFunction(() => document.querySelector('#pause-overlay').hidden);
  fullscreenCheck('Escape resumes without leaving fullscreen', (await windowState()).fullscreen);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(800);
  fullscreenCheck('F exits native fullscreen', !(await windowState()).fullscreen);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(800);
  fullscreenCheck('F enters native fullscreen', (await windowState()).fullscreen);
  await sendKey('Escape');
  await page.waitForFunction(() => !document.querySelector('#pause-overlay').hidden);
  fullscreenCheck('Escape after F still preserves fullscreen', (await windowState()).fullscreen);
  await page.locator('#fullscreen').click();
  await page.waitForTimeout(800);
  fullscreenCheck('menu button exits native fullscreen', !(await windowState()).fullscreen);
  await sendKey('Escape');
  await page.waitForFunction(() => document.querySelector('#pause-overlay').hidden);
  await sendKey('F11');
  await page.waitForTimeout(800);
  state = await windowState();
  fullscreenCheck('F11 toggles the window fullscreen', state.fullscreen, state.bounds);
  check('F11 updates the menu setting', await page.locator('#fullscreen').getAttribute('aria-pressed') === String(state.fullscreen));
  await sendKey('F11');
  await page.waitForTimeout(800);
  state = await windowState();
  fullscreenCheck('F11 restores the window', !state.fullscreen, state.bounds);

  // City-only settings and garage remain available in the local bundle.
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => !document.querySelector('#pause-overlay').hidden);
  await page.locator('#city-weather').selectOption('night');
  check('weather setting available', await page.locator('#city-weather').inputValue() === 'night');
  await page.locator('#change-car').click();
  check('garage opens', await page.locator('#car-dialog').evaluate(dialog => dialog.open));
  await page.locator('#close-cars').click();
  check('route chooser removed', !(await page.locator('#change-journey').isVisible()));
  await page.screenshot({ path: path.join(out, 'city.png') });

  const benign = [/Autofill\./, /DevTools/];
  const errors = consoleErrors.filter(text => !benign.some(pattern => pattern.test(text)));
  check('no console or page errors', errors.length === 0, errors);
} catch (error) {
  report.errors.push(String(error?.stack ?? error));
  console.error(error);
  // Capture what the page looked like so a CI failure can be diagnosed from the artifacts.
  if (page) {
    report.failureState = await page.evaluate(() => ({
      href: location.href, readyState: document.readyState,
      loading: document.querySelector('#loading')?.className, errorShown: document.querySelector('#error')?.hidden === false,
      errorText: document.querySelector('#error:not([hidden])')?.textContent?.trim(),
      webgl2: Boolean(document.createElement('canvas').getContext('webgl2')),
      webgl2Renderer: (() => { try { const gl = document.createElement('canvas').getContext('webgl2'); const ext = gl?.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null; } catch { return null; } })(),
      userAgent: navigator.userAgent,
    })).catch(reason => ({ unavailable: String(reason) }));
    console.error('Page state at failure:', JSON.stringify(report.failureState, null, 2));
    await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  }
} finally {
  await electronApp.close().catch(() => {});
  report.consoleErrors = consoleErrors;
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
}
const failed = report.errors.length > 0;
console.log(`\n${failed ? 'FAILED' : 'PASSED'}: ${report.checks.filter(c => c.ok).length}/${report.checks.length} checks, ${report.warnings.length} warnings. Report: ${path.relative(root, path.join(out, 'report.json'))}`);
process.exit(failed ? 1 : 0);
