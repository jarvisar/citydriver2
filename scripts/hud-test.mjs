import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const directory = '.artifacts/hud';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], report = [];
const url = process.env.TEST_URL ?? 'http://127.0.0.1:5173';
const intersects = (a, b) => a.x < b.x + b.width - 1 && a.x + a.width > b.x + 1 && a.y < b.y + b.height - 1 && a.y + a.height > b.y + 1;
async function inspect(page, name) {
  const layout = await page.evaluate(() => {
    const selectors = ['#taxi-hud', '#taxi-task', '.city-hud', '.drive-actions', '#city-guide', '#taxi-buttons', '#taxi-dash', '#touch-stick', '#stick-help'];
    const boxes = selectors.flatMap(selector => {
      const el = document.querySelector(selector), style = getComputedStyle(el), r = el.getBoundingClientRect();
      return style.display === 'none' || style.visibility === 'hidden' || !r.width || !r.height ? [] : [{ selector, x: r.x, y: r.y, width: r.width, height: r.height }];
    });
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, boxes };
  });
  await page.screenshot({ path: `${directory}/${name}.png` });
  assert.ok(layout.scrollWidth <= layout.width, `${name}: no horizontal overflow`);
  for (const a of layout.boxes) {
    assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.width <= layout.width + 1 && a.y + a.height <= layout.height + 1, `${name}: ${a.selector} inside viewport ${JSON.stringify(a)}`);
    for (const b of layout.boxes) if (a.selector < b.selector) assert.ok(!intersects(a, b), `${name}: ${a.selector} overlaps ${b.selector}`);
  }
  for (const selector of ['#city-map-toggle', '#pause', '[data-drive-button=boost]', '[data-drive-button=handbrake]']) {
    const el = page.locator(selector);
    if (await el.isVisible()) { const r = await el.boundingBox(); assert.ok(r.width >= 44 && r.height >= 44, `${name}: ${selector} touch target`); }
  }
  report.push({ name, ...layout });
}
try {
  for (const [name, width, height, touch] of [['phone', 390, 844, true], ['small-phone', 320, 568, true], ['landscape', 844, 390, true], ['small-landscape', 667, 375, true], ['short-landscape', 568, 320, true], ['tablet', 768, 1024, true], ['desktop', 1440, 960, false]]) {
    if (process.env.HUD_VIEWPORT && !process.env.HUD_VIEWPORT.split(',').includes(name)) continue;
    const page = await browser.newPage({ viewport: { width, height }, isMobile: touch, hasTouch: touch });
    page.setDefaultTimeout(60000);
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('citydriver.graphics', JSON.stringify({ mode: 'basic' })));
    await page.goto(`${url}/?seed=4817&ao=0`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__citydriver && document.querySelector('#loading.loaded'));
    await page.click('#start');
    await page.waitForFunction(() => window.__citydriver.taxi.running && getComputedStyle(document.querySelector('#welcome')).visibility === 'hidden');
    await page.evaluate(() => {
      const a = window.__citydriver, v = a.vehicle;
      a.traffic.setEnabled(false, v);
      // Start away from incidental pickups so screenshots do not board a passerby.
      v.s += 40; v.speed = 0; v.knock.x = v.knock.z = v.knock.spin = 0;
      v.update(0, {}); a.world.update(v.s, v.u); a.taxi.start(v);
      v.render(1, a.world.origin); a.rendering.snap(); a.rendering.update(v.car, 1, a.world.origin);
    });
    await page.waitForTimeout(2400);
    await inspect(page, `${name}-pickup`);
    const compact = width <= 760 || height <= 560;
    assert.equal(await page.locator('#city-map-toggle').getAttribute('aria-expanded'), String(!compact));
    assert.equal(await page.evaluate(() => window.__citydriver.taxi.target), null);
    if (compact) await page.click('#city-map-toggle');
    assert.equal(await page.locator('#city-map').isVisible(), true);
    await page.waitForTimeout(250);
    await inspect(page, `${name}-map`);
    await page.click('#city-map-toggle');
    await page.evaluate(() => {
      // A solo rider: the checks below read the single drop-off copy, and the nearest ring may hold a group.
      const a = window.__citydriver, t = a.taxi.customers.find(p => p.passengers === 1 && p.id !== a.taxi.blockedPickup?.id) ?? a.taxi.customers[0];
      Object.assign(a.vehicle, { s: t.s, u: t.u, speed: 0 });
      a.vehicle.knock.x = a.vehicle.knock.z = a.vehicle.knock.spin = 0;
    });
    await page.waitForFunction(() => window.__citydriver.taxi.status === 'driving');
    await page.waitForFunction(() => document.querySelector('#taxi-stage').textContent === 'Drop off');
    assert.match(await page.locator('#taxi-timer').textContent(), /^\d+s Speedy$/);
    assert.equal(await page.locator('#taxi-timer').getAttribute('data-rating'), 'speedy');
    assert.match(await page.locator('#taxi-fare-status').textContent(), /^\$\d/);
    assert.equal(await page.locator('#next-city-stop').count(), 0);
    await inspect(page, `${name}-fare`);
    await page.evaluate(() => { window.__citydriver.taxi.fareLeft = 8; });
    await page.waitForFunction(() => document.querySelector('#taxi-task').dataset.urgent === 'true'
      && document.querySelector('#taxi-timer').dataset.rating === 'slow');
    await page.evaluate(() => {
      const a = window.__citydriver, t = a.taxi.target ?? a.taxi.customers[0];
      Object.assign(a.vehicle, { s: t.s, u: t.u, speed: 0 });
      a.vehicle.knock.x = a.vehicle.knock.z = a.vehicle.knock.spin = 0;
    });
    await page.waitForFunction(() => window.__citydriver.taxi.delivered === 1);
    await page.waitForFunction(() => document.querySelector('#taxi-task-title').textContent === 'Find a passenger');
    await inspect(page, `${name}-choose`);
    await page.evaluate(() => {
      const a = window.__citydriver;
      a.taxi.cash = 9999; a.taxi.boost = 0; a.input.touchButtons.boost = true;
      a.taxiView.hud(a.taxi, a.vehicle);
    });
    await inspect(page, `${name}-recharging`);
    await page.evaluate(() => { window.__citydriver.input.touchButtons.boost = false; });
    if (name === 'landscape') {
      await page.evaluate(() => {
        for (const edge of ['left', 'right']) document.documentElement.style.setProperty(`--safe-${edge}`, '44px');
        document.documentElement.style.setProperty('--safe-bottom', '21px');
        window.dispatchEvent(new Event('resize'));
      });
      await inspect(page, `${name}-safe-area`);
    }
    await page.evaluate(() => { document.body.dataset.controller = 'true'; });
    assert.equal(await page.locator('#taxi-buttons').isVisible(), false);
    assert.equal(await page.locator('#taxi-controller-boost').isVisible(), true);
    await inspect(page, `${name}-controller`);
    await page.evaluate(() => { document.body.dataset.controller = 'false'; });
    await page.click('#pause');
    for (const selector of ['#taxi-task', '#taxi-dash', '#taxi-buttons']) assert.equal(await page.locator(selector).isVisible(), false);
    await page.click('#resume');
    await page.evaluate(() => window.__citydriver.beginFree());
    await inspect(page, `${name}-free`);
    await page.close();
    console.log(`${name}: passed`);
  }
  assert.deepEqual(errors, []);
  await writeFile(`${directory}/report${process.env.HUD_VIEWPORT ? '-focused' : ''}.json`, JSON.stringify({ passed: true, errors, layouts: report }, null, 2));
  console.log('HUD checks passed: touch targets, no overlap, expanded maps, free fare choice, pickup/drop-off, deadlines, depleted boost, large earnings, safe areas, controller HUD, pause and free drive.');
} finally { await browser.close(); }
