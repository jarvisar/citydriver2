import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { build, createServer as createViteServer } from 'vite';

const launchOptions = {
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH }
    : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
};
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
// This Playwright build treats an async waitForFunction predicate as truthy.
const waitForPage = (page, predicate) => expect.poll(() => page.evaluate(predicate), { timeout: 60_000 }).toBe(true);

async function waitForAutomaticActivation(context, page, scriptURL) {
  // An uncontrolled observer waits while all app clients are closed. Reopening
  // the game sooner can hold the old worker alive and block natural activation.
  const observer = await context.newPage();
  const session = await context.newCDPSession(observer), versions = new Map();
  session.on('ServiceWorker.workerVersionUpdated', ({ versions: changed }) => {
    for (const version of changed) versions.set(version.versionId, version);
  });
  try {
    await session.send('ServiceWorker.enable');
    const installed = () => [...versions.values()].find(version => version.scriptURL === scriptURL && version.status === 'installed');
    await expect.poll(() => Boolean(installed()), { timeout: 60_000 }).toBe(true);
    const candidate = installed();
    await page.close();
    await expect.poll(() => versions.get(candidate.versionId)?.status, { timeout: 60_000 }).toBe('activated');
  } finally {
    await session.detach();
    await observer.close();
  }
}

async function checkProduction(base) {
  const outDir = path.resolve('.artifacts', base === '/' ? 'pwa-root' : 'pwa-subpath');
  await build({ base, build: { outDir } });
  let version;
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (!pathname.startsWith(base)) { res.writeHead(404).end(); return; }
      const relative = pathname.slice(base.length) || 'index.html';
      const filename = path.resolve(outDir, relative);
      if (!filename.startsWith(`${outDir}${path.sep}`)) { res.writeHead(403).end(); return; }
      let content = await readFile(filename);
      if (relative === 'sw.js' && version) {
        content = content.toString().replace(/const VERSION = "[^"]+";/, `const VERSION = "${version}";`);
      }
      // Fixture-only identity: all real versions have the same script URL.
      if (relative === 'sw.js') content = content.toString() + '\nself.addEventListener("message", event => { if (event.data === "test-version") event.ports[0].postMessage(VERSION); });';
      res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(content);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}${base}`;
  const profile = await mkdtemp(path.resolve('.artifacts/pwa-browser-'));
  const context = await chromium.launchPersistentContext(profile, launchOptions);
  // Installation and cache lifecycle checks use the lightest rendering preset.
  // Detailed graphics are exercised separately by the city browser check.
  await context.addInitScript(() => {
    try { localStorage.setItem('citydriver.graphics', JSON.stringify({ mode: 'basic' })); } catch { /* about:blank has no storage */ }
    window.testWorkerVersion = worker => !worker ? Promise.resolve(null) : new Promise(resolve => {
      const channel = new MessageChannel();
      const finish = version => { clearTimeout(timer); channel.port1.close(); resolve(version); };
      const timer = setTimeout(() => finish(null), 1000);
      channel.port1.onmessage = event => finish(event.data);
      worker.postMessage('test-version', [channel.port2]);
    });
  });
  context.setDefaultNavigationTimeout(60_000);
  context.setDefaultTimeout(60_000);
  for (const page of context.pages()) await page.close();
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  try {
    let page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#loading.loaded') && document.querySelector('#error').hidden);
    assert.equal(await page.locator('#menu-title').textContent(), 'citydriver');
    assert.equal(await page.locator('#change-journey').isVisible(), false);
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    assert.equal(await page.locator('#pwa-install-invitation').count(), 0);
    await page.setViewportSize({ width: 393, height: 851 });
    assert.equal(await page.locator('#welcome :is(.pwa-install, .pwa-install-button, #pwa-install-invitation)').count(), 0, 'The install prompt stays out of the main menu');
    await page.screenshot({ path: path.resolve('.artifacts', base === '/' ? 'pwa-invitation.png' : 'pwa-invitation-subpath.png') });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.setViewportSize({ width: 1280, height: 720 });
    const manifest = await page.evaluate(async () => {
      const link = document.querySelector('link[rel=manifest]');
      return { url: link.href, data: await (await fetch(link.href)).json() };
    });
    assert.equal(manifest.data.display, 'fullscreen');
    assert.equal(new URL(manifest.data.start_url, manifest.url).href, url);
    assert.ok(manifest.data.screenshots.some(screenshot => screenshot.form_factor === 'wide'));
    assert.ok(manifest.data.screenshots.some(screenshot => screenshot.form_factor === 'narrow'));
    for (const icon of [...manifest.data.icons, ...manifest.data.screenshots]) {
      const dimensions = await page.evaluate(async src => {
        const image = new Image(); image.src = src; await image.decode();
        return `${image.naturalWidth}x${image.naturalHeight}`;
      }, new URL(icon.src, manifest.url).href);
      assert.equal(dimensions, icon.sizes);
    }
    assert.equal(await page.locator('link[rel=apple-touch-icon]').count(), 1);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Page.enable');
    const installability = await cdp.send('Page.getInstallabilityErrors');
    assert.deepEqual(installability.installabilityErrors, [], 'Chrome installability requirements');
    await cdp.detach();

    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#loading.loaded') && document.querySelector('#error').hidden);
    assert.equal(await page.locator('#city-location').textContent() !== '', true, 'offline city navigation is ready');
    assert.equal(await page.locator('#pwa-install-invitation').isVisible(), false, 'Dismissal survives reload');
    await page.keyboard.press('KeyP');
    await page.locator('#city-weather').selectOption('night');
    assert.equal(await page.locator('#city-weather').inputValue(), 'night');
    await page.locator('#change-car').click();
    assert.ok(await page.locator('#car-dialog .car-card').count() > 0, 'garage is bundled offline');
    await page.locator('#close-cars').click();
    await page.goto(`${url}?from=homescreen`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#loading.loaded') && document.querySelector('#error').hidden);
    await page.locator('#start').click();
    await page.keyboard.down('ArrowUp');
    await page.waitForFunction(() => document.querySelector('#distance').textContent !== '0.0', null, { timeout: 20_000 });
    await page.keyboard.up('ArrowUp');

    await context.setOffline(false);
    await page.evaluate(() => caches.open('unrelated-app-cache'));
    const oldCache = await page.evaluate(async () => (await caches.keys()).find(name => name.startsWith('citydriver:')));
    version = 'test-update';
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await waitForPage(page, async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting));
    assert.ok((await page.evaluate(() => caches.keys())).includes(oldCache), 'Active version stays cached during play');
    await page.locator('#pause-overlay .update-notice').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.update-notice').first().isVisible(), false, 'No update notice over a drive');
    await page.keyboard.press('KeyP');
    await page.locator('#pause-overlay .update-notice button').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#welcome .update-notice').count(), 1);
    await waitForAutomaticActivation(context, page, new URL('sw.js', url).href);
    page = await context.newPage();
    console.log(`Checking ${base}: activate the waiting update after closing the game`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await waitForPage(page, async () => {
      const names = await caches.keys();
      return names.some(name => name.endsWith(':test-update')) && names.filter(name => name.startsWith('citydriver:')).length === 1;
    });
    assert.ok((await page.evaluate(() => caches.keys())).includes('unrelated-app-cache'));
    await page.waitForFunction(() => document.querySelector('#loading.loaded') && document.querySelector('#error').hidden);
    console.log(`Checking ${base}: the new cache is active and the updated game is ready`);
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#loading.loaded') && document.querySelector('#error').hidden);
    await page.keyboard.press('KeyP');
    await page.locator('#pause-overlay .pwa-install-button').waitFor({ state: 'visible' });
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      event.prompt = async () => { window.testInstallPromptCalled = true; };
      event.userChoice = Promise.resolve({ outcome: 'dismissed' });
      window.dispatchEvent(event);
      // Trigger the stub in the same task, before Chrome can emit a real prompt event.
      document.querySelector('#pause-overlay .pwa-install-button').click();
    });
    assert.equal(await page.evaluate(() => window.testInstallPromptCalled), true);
    // Chrome can emit another native prompt after the stub finishes. Exercise
    // fallback deterministically instead of depending on that event's timing.
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      event.prompt = async () => { throw new Error('Install prompt unavailable'); };
      event.userChoice = Promise.resolve({ outcome: 'dismissed' });
      window.dispatchEvent(event);
      document.querySelector('#pause-overlay .pwa-install-button').click();
    });
    await page.locator('#pause-overlay .pwa-install-help').waitFor({ state: 'visible' });
    assert.match(await page.locator('#pause-overlay .pwa-install-help').textContent(), /browser menu/);
    await page.setViewportSize({ width: 393, height: 851 });
    await page.screenshot({ path: path.resolve('.artifacts', base === '/' ? 'pwa-mobile-install.png' : 'pwa-mobile-subpath-install.png') });
    await page.locator('#pause-overlay .pwa-install-button').focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#pause-overlay .pwa-install-help').isVisible(), false);
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    assert.equal(await page.locator('#pause-overlay .pwa-install-button').isVisible(), false);

    console.log(`Checking ${base}: the update notice reloads into the next version`);
    await context.setOffline(false);
    version = 'test-update-2';
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    // An earlier activation can leave its Reload notice on this page. Wait
    // for this download before pressing it, rather than reloading the old one.
    await waitForPage(page, async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration.waiting?.state === 'installed' && await window.testWorkerVersion(registration.waiting) === 'test-update-2';
    });
    const reload = page.locator('#pause-overlay .update-notice button');
    await reload.waitFor({ state: 'visible' });
    await page.screenshot({ path: path.resolve('.artifacts', base === '/' ? 'pwa-update.png' : 'pwa-update-subpath.png') });
    await Promise.all([page.waitForEvent('load'), reload.click()]);
    await waitForPage(page, async () => await window.testWorkerVersion(navigator.serviceWorker.controller) === 'test-update-2');
    await page.waitForFunction(() => document.querySelector('#loading.loaded') && document.querySelector('#error').hidden);
    await waitForPage(page, async () => {
      const names = (await caches.keys()).filter(name => name.startsWith('citydriver:'));
      return names.length === 1 && names[0].endsWith(':test-update-2');
    });
    const names = (await page.evaluate(() => caches.keys())).filter(name => name.startsWith('citydriver:'));
    assert.deepEqual(names.map(name => name.split(':').pop()), ['test-update-2']);
    assert.equal(await page.locator('.update-notice').count(), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${base}: Chrome installability, icons/screenshots, install button/fallback, offline city/driving, safe updates, the update notice and cache cleanup`);
  } finally {
    await context.close();
    await new Promise(resolve => server.close(resolve));
  }
}

if (!process.argv.includes('--dev-only')) {
  await checkProduction('/');
  await checkProduction('/citydriver/');
}
const dev = await createViteServer({ cacheDir: '.scratch/vite-pwa-test', server: { port: 0, host: '127.0.0.1' } });
try {
  await dev.listen();
  const html = await (await fetch(`http://127.0.0.1:${dev.httpServer.address().port}/`)).text();
  assert.ok(html.includes('manifest.webmanifest'));
  assert.ok(html.includes('pwa-install.js'), 'Development includes the install setting');
  assert.ok(html.includes('pwa-install.css'), 'Development includes installation styling');
  assert.ok(!html.includes('pwa-register.js'), 'Development never registers an offline worker');
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({ viewport: { width: 393, height: 851 }, hasTouch: true, isMobile: true });
    const url = `http://127.0.0.1:${dev.httpServer.address().port}/`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#loading.loaded'));
    assert.equal(await page.locator('#pwa-install-invitation').isVisible(), false);
    await page.keyboard.press('KeyP');
    assert.equal(await page.locator('#pause-overlay .pwa-install-button').isVisible(), true);
    await page.screenshot({ path: path.resolve('.artifacts/pwa-dev-install.png') });
    await page.locator('#pause-overlay .pwa-install-button').click();
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#loading.loaded') && document.querySelector('#error').hidden);
    assert.equal(await page.locator('#pwa-install-invitation').isVisible(), false);
    await page.keyboard.press('KeyP');
    assert.equal(await page.locator('#pause-overlay .pwa-install-button').isVisible(), true);
    assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0);
  } finally { await browser.close(); }
  console.log('PASS development: manifest and install UI available, service worker registration disabled');
} finally { await dev.close(); }
