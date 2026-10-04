import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { build, createServer, preview } from 'vite';

const out = path.resolve('.artifacts/startup');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH }
    : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let checks = 0;

async function fixture(url, scenario, gamePath, loaderPath, mobile = false) {
  const label = `${gamePath.startsWith('/src/') ? 'dev' : new URL(url).pathname.includes('/citydriver/') ? 'subpath' : 'built'}-${mobile ? 'mobile' : 'desktop'}`;
  const context = await browser.newContext({
    serviceWorkers: 'block', viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    ...(mobile ? { isMobile: true, hasTouch: true } : {}),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  await context.addInitScript(() => {
    window.startupEvents = [];
    window.addEventListener('error', event => startupEvents.push(event.target.src ?? event.message), true);
    window.addEventListener('unhandledrejection', event => startupEvents.push(event.reason.message));
  });
  // Exercise the live site's optional analytics without contacting Cloudflare.
  await page.route('https://static.cloudflareinsights.com/**', route => route.abort('blockedbyclient'));
  await page.route(url, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace(
      "location.hostname === 'citydriver2.jarvisar.com'", "location.hostname === '127.0.0.1'",
    ) });
  });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  if (scenario === 'optional') await page.route(`**${gamePath}`, async route => { await gate; await route.continue(); });
  else if (scenario === 'module' || scenario === 'loader') await page.route(`**${scenario === 'loader' ? loaderPath : gamePath}`, route => route.abort('failed'));
  else if (scenario === 'throw' || scenario === 'reject') await page.route(`**${gamePath}`, route => route.fulfill({
    contentType: 'text/javascript', body: scenario === 'throw' ? 'throw new Error("Game module failed");' : 'await Promise.reject(new Error("Game initialization failed"));',
  }));
  else if (scenario === 'css') await page.route('**/assets/*.css', route => route.abort('failed'));
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (scenario === 'optional') {
      await page.waitForFunction(() => startupEvents.some(event => event?.includes('cloudflareinsights')));
      assert.equal(await page.locator('#error').isVisible(), false, 'blocked analytics must leave Loading visible');
      assert.equal(await page.locator('#loading').isVisible(), true);
      await page.evaluate(() => {
        setTimeout(() => { throw new Error('Optional script failed'); });
        void Promise.reject(new Error('Optional promise failed'));
      });
      await page.waitForFunction(() => ['Optional script failed', 'Optional promise failed'].every(message => startupEvents.some(event => event?.includes(message))));
      assert.equal(await page.locator('#error').isVisible(), false, 'unrelated errors must leave Loading visible');
      assert.equal(await page.locator('#loading').isVisible(), true);
      await page.screenshot({ path: `${out}/${label}-loading.png` });
      release();
      await page.waitForFunction(() => document.querySelector('#loading.loaded') && document.querySelector('#error').hidden);
      await page.locator('#free-drive').click();
      await page.waitForFunction(() => document.querySelector('#welcome').classList.contains('hidden'));
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#menu-view-fade')).opacity) < .01);
      await page.screenshot({ path: `${out}/${label}-drive.png` });
    } else {
      await page.locator('#error').waitFor({ state: 'visible' });
      await page.locator('#loading').waitFor({ state: 'hidden' });
      const retry = page.locator('#error button');
      await retry.focus();
      for (const key of ['Tab', 'Shift+Tab']) {
        await page.keyboard.press(key);
        assert.equal(await retry.evaluate(button => button === document.activeElement), true);
      }
      const box = await retry.boundingBox(), viewport = page.viewportSize();
      assert.ok(box && box.width > 0 && box.height > 0 && box.x >= 0 && box.y >= 0
        && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height);
      if (scenario === 'module' && gamePath.startsWith('/src/')) {
        await page.unroute(`**${gamePath}`);
        await retry.click();
        await page.waitForFunction(() => window.__citydriver && document.querySelector('#loading.loaded') && document.querySelector('#error').hidden);
      }
    }
    console.log(`PASS ${url} ${scenario}${mobile ? ' mobile' : ''}`);
    checks++;
  } finally {
    release();
    await context.close();
  }
}

try {
  const dev = await createServer({ server: { port: 0, host: '127.0.0.1', watch: null }, logLevel: 'error' });
  await dev.listen();
  try {
    const url = `http://127.0.0.1:${dev.httpServer.address().port}/?seed=4817&ao=0`;
    for (const scenario of ['optional', 'module', 'throw', 'reject']) await fixture(url, scenario, '/src/main.js');
    await fixture(url, 'optional', '/src/main.js', null, true);
  } finally { await dev.close(); }
  for (const base of ['/', '/citydriver/']) {
    const outDir = path.join(out, base === '/' ? 'root-build' : 'subpath-build');
    const bundle = await build({ base, logLevel: 'error', build: { outDir, emptyOutDir: true } });
    const game = bundle.output.find(file => file.type === 'chunk' && file.facadeModuleId?.replaceAll('\\', '/').endsWith('/src/main.js'));
    const html = await readFile(path.join(outDir, 'index.html'), 'utf8');
    const loader = html.match(/<script type="module"[^>]*src="([^"]+)"/)[1];
    const server = await preview({ base, logLevel: 'error', build: { outDir }, preview: { port: 0, host: '127.0.0.1' } });
    try {
      const url = `http://127.0.0.1:${server.httpServer.address().port}${base}?seed=4817&ao=0`;
      for (const scenario of ['optional', 'module', 'loader', 'throw', 'reject', 'css']) await fixture(url, scenario, `${base}${game.fileName}`, loader);
    } finally { await new Promise(resolve => server.httpServer.close(resolve)); }
  }
  console.log(`${checks} startup scenarios passed`);
} finally { await browser.close(); }
