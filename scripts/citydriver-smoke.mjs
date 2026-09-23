// Headless drive through the generated city: loads the page, starts a free
// drive, holds the throttle and reports console errors and screenshots.
// node scripts/citydriver-smoke.mjs [url] [outDir]
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/?seed=4817';
const out = process.argv[3] ?? '.artifacts/smoke';
mkdirSync(out, { recursive: true });
// A pinned Playwright may not match the browsers on the machine: prefer an
// explicit executable (CHROME_PATH), then the Playwright browsers directory.
import { existsSync } from 'node:fs';
const executablePath = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(candidate => candidate && existsSync(candidate));
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [], logs = [];
page.on('console', message => { const text = message.text(); logs.push(`${message.type()}: ${text}`); if (message.type() === 'error') errors.push(text); });
page.on('pageerror', error => errors.push(`pageerror: ${error.message}\n${error.stack ?? ''}`));
const started = Date.now();
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
try {
  await page.waitForSelector('#loading.loaded', { timeout: 120000 });
  console.log('loaded in', Date.now() - started, 'ms');
} catch (error) { console.log('loading screen never cleared:', error.message); }
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/01-menu.png` });
const status = await page.evaluate(() => {
  const game = window.__citydriver;
  if (!game) return { noGame: true, error: document.querySelector('#error')?.hidden === false };
  return { started: game.started, s: game.vehicle.s, u: game.vehicle.u, heading: game.vehicle.heading, chunks: game.world.chunks.size, distant: game.world.distant?.size, pending: game.world.pending.length, distantPending: game.world.distantPending?.length, colliders: [...game.world.chunks.values()].reduce((n, c) => n + c.features.colliders.length, 0), lamps: [...game.world.chunks.values()].reduce((n, c) => n + c.features.lamps.length, 0) };
});
console.log('status', JSON.stringify(status));
if (!status.noGame) {
  await page.click('#free-drive');
  await page.waitForTimeout(600);
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(1500);
    const state = await page.evaluate(() => { const v = window.__citydriver.vehicle; return { s: Math.round(v.s), u: Math.round(v.u), speed: Math.round(v.speed * 10) / 10, height: Math.round(v.car.position.y * 100) / 100, distance: Math.round(v.distance), chunks: window.__citydriver.world.chunks.size }; });
    console.log('drive', JSON.stringify(state));
    await page.screenshot({ path: `${out}/0${2 + i}-drive.png` });
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyV'); await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/06-view.png` });
  const fps = await page.evaluate(() => new Promise(resolve => { let frames = 0; const start = performance.now(); const tick = () => { frames++; if (performance.now() - start < 2000) requestAnimationFrame(tick); else resolve(Math.round(frames / 2)); }; requestAnimationFrame(tick); }));
  console.log('approximate rAF/s (software GL):', fps);
}
console.log('console errors:', errors.length);
for (const error of errors.slice(0, 10)) console.log(' -', error.slice(0, 600));
console.log('last logs:', logs.slice(-6).join('\n'));
await browser.close();
process.exit(errors.length ? 1 : 0);
