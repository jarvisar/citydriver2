import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('.artifacts/fleet', { recursive: true });
const url = process.env.TEST_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
async function open(options) {
  const page = await browser.newPage(options); page.setDefaultTimeout(60000);
  await page.addInitScript(() => localStorage.setItem('citydriver.graphics', JSON.stringify({ mode: 'basic' })));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${url}/?seed=4817&ao=0`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__citydriver && document.querySelector('#loading.loaded'));
  return page;
}
async function startAndPause(page) {
  await page.click('#start'); await page.waitForFunction(() => window.__citydriver.taxi.running);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#welcome')).visibility === 'hidden');
  await page.click('#pause');
}
try {
  const page = await open({ viewport: { width: 1440, height: 960 } });
  assert.equal(await page.locator('#welcome [data-open-fleet]').count(), 0);
  await startAndPause(page);
  assert.equal(await page.locator('#change-car').isVisible(), false);
  assert.equal(await page.locator('#pause-fleet').isVisible(), true);
  await page.click('#pause-fleet');
  assert.equal(await page.locator('[data-fleet-car=taxiGT]').isDisabled(), true);
  assert.equal(await page.locator('[data-fleet-car=taxiFormula]').isDisabled(), true);
  const time = await page.evaluate(() => window.__citydriver.taxi.timeLeft);
  await page.waitForTimeout(250); assert.equal(await page.evaluate(() => window.__citydriver.taxi.timeLeft), time);
  await page.screenshot({ path: '.artifacts/fleet/desktop-locked.png' });
  await page.keyboard.press('Escape');
  await page.locator('#pause-overlay').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#pause-overlay').isVisible(), true);
  assert.equal(await page.locator('#pause-fleet').evaluate(button => button === document.activeElement), true);
  // Fund the shop fixture; actual fare banking is exercised in taxi-fleet.test.js.
  await page.evaluate(() => window.__citydriver.taxi.fleet.credit(1500));
  await page.click('#pause-fleet'); await page.click('[data-fleet-car=taxiGT]');
  assert.equal(await page.locator('#fleet-balance').textContent(), '$0');
  assert.equal(await page.evaluate(() => window.__citydriver.vehicle.carId), 'taxi', 'purchase never swaps a cab mid-run');
  await page.click('[data-fleet-car=taxiGT]'); assert.equal(await page.locator('#fleet-balance').textContent(), '$0');
  await page.click('#close-fleet'); await page.click('#restart-run');
  assert.equal(await page.evaluate(() => window.__citydriver.vehicle.carId), 'taxiGT');
  await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
  await page.waitForFunction(() => window.__citydriver.taxi.boostActive && window.__citydriver.vehicle.speed > 15);
  await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
  await page.click('#pause');
  await page.evaluate(() => window.__citydriver.taxi.fleet.credit(4500));
  await page.click('#pause-fleet'); await page.click('[data-fleet-car=taxiFormula]');
  await page.screenshot({ path: '.artifacts/fleet/desktop-owned.png' });
  await page.click('#close-fleet'); await page.click('#restart-run');
  assert.equal(await page.evaluate(() => window.__citydriver.vehicle.carId), 'taxiFormula');
  assert.equal(await page.evaluate(() => window.__citydriver.vehicle.car.userData.seats), 2);
  await page.screenshot({ path: '.artifacts/fleet/formula-driving.png' });
  await page.evaluate(() => { window.__citydriver.taxi.timeLeft = .01; });
  await page.waitForFunction(() => window.__citydriver.taxi.status === 'over');
  await page.click('#taxi-fleet-results'); await page.click('[data-fleet-car=taxiGT]'); await page.click('#close-fleet');
  assert.equal(await page.locator('#taxi-results').isVisible(), true);
  assert.equal(await page.locator('#pause-overlay').isVisible(), false);
  await page.click('#taxi-retry'); assert.equal(await page.evaluate(() => window.__citydriver.vehicle.carId), 'taxiGT');
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForFunction(() => window.__citydriver);
  await startAndPause(page);
  assert.equal(await page.evaluate(() => window.__citydriver.vehicle.carId), 'taxiGT');
  assert.deepEqual(await page.evaluate(() => [...window.__citydriver.taxi.fleet.owned]), ['taxi', 'taxiGT', 'taxiFormula']);
  await page.click('#switch-mode'); await page.click('#pause');
  assert.equal(await page.locator('#pause-fleet').isVisible(), false);
  assert.equal(await page.locator('#change-car').isVisible(), true);
  await page.close();

  const mobile = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  // Fresh save: every cab still works for free and does not grant ownership.
  await mobile.tap('#free-drive'); await mobile.waitForFunction(() => window.__citydriver.gameMode === 'free');
  await mobile.waitForFunction(() => getComputedStyle(document.querySelector('#welcome')).visibility === 'hidden');
  for (const id of ['taxiGT', 'taxiFormula']) {
    await mobile.tap('#pause'); await mobile.tap('#change-car'); await mobile.tap(`[data-car=${id}]`);
    assert.equal(await mobile.evaluate(() => window.__citydriver.vehicle.carId), id);
    assert.deepEqual(await mobile.evaluate(() => [...window.__citydriver.taxi.fleet.owned]), ['taxi']);
    await mobile.tap('#resume');
  }
  await mobile.tap('#pause'); await mobile.tap('#switch-mode');
  assert.equal(await mobile.evaluate(() => window.__citydriver.vehicle.carId), 'taxi', 'free selection does not bypass ownership');
  await mobile.tap('#pause'); await mobile.tap('#pause-fleet');
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await mobile.locator('#taxi-fleet-dialog').evaluate(el => el.scrollWidth <= el.clientWidth));
  await mobile.screenshot({ path: '.artifacts/fleet/mobile.png' });
  await mobile.locator('[data-fleet-car=taxiFormula]').scrollIntoViewIfNeeded();
  await mobile.screenshot({ path: '.artifacts/fleet/mobile-formula.png' });
  await mobile.tap('#close-fleet');
  await mobile.setViewportSize({ width: 844, height: 390 });
  await mobile.tap('#pause-fleet');
  assert.ok(await mobile.locator('#taxi-fleet-dialog').evaluate(el => el.scrollWidth <= el.clientWidth));
  await mobile.locator('[data-fleet-car=taxiFormula]').scrollIntoViewIfNeeded();
  await mobile.screenshot({ path: '.artifacts/fleet/mobile-landscape.png' });
  await mobile.tap('#close-fleet'); await mobile.tap('#resume');
  await mobile.evaluate(() => { window.__citydriver.taxi.timeLeft = .01; });
  await mobile.waitForFunction(() => window.__citydriver.taxi.status === 'over');
  await mobile.locator('#taxi-fleet-results').scrollIntoViewIfNeeded();
  await mobile.tap('#taxi-fleet-results'); await mobile.tap('#close-fleet');
  await mobile.locator('#taxi-free').scrollIntoViewIfNeeded(); await mobile.tap('#taxi-free');
  assert.equal(await mobile.evaluate(() => window.__citydriver.gameMode), 'free');
  assert.deepEqual(errors, []);
  await writeFile('.artifacts/fleet/browser-report.json', JSON.stringify({ passed: true, errors }, null, 2));
  console.log('Fleet checks passed: purchases, persistence, next-run selection, results, mode-specific menus, free access, desktop and touch layouts.');
} finally { await browser.close(); }
