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
// A shift starts with its first fare: into a ring and stopped there
async function pickUp(page) {
  await page.evaluate(() => {
    const g = window.__citydriver, v = g.vehicle, fare = g.taxi.customers.find(customer => customer.id !== g.taxi.blockedPickup?.id);
    v.s = fare.s; v.u = fare.u; v.heading = fare.heading; v.speed = 0; v.update(0, {});
  });
  await page.waitForFunction(() => window.__citydriver.taxi.running);
}
async function startAndPause(page) {
  await page.click('#start'); await page.waitForFunction(() => window.__citydriver.taxi.waiting);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#welcome')).visibility === 'hidden');
  await pickUp(page);
  await page.click('#pause');
}
try {
  const page = await open({ viewport: { width: 1440, height: 960 } });
  await startAndPause(page);
  // (the cabs are the garage's: in a shift it holds just them, for the next shift)
  assert.equal(await page.locator('#change-car').isVisible(), true);
  await page.click('#change-car');
  assert.equal(await page.locator('#car-dialog').getAttribute('data-shift'), 'true');
  assert.equal(await page.locator('[data-car=hatchback]').isVisible(), false, 'only cabs in a shift');
  assert.equal(await page.locator('#paint-shop').isVisible(), false);
  assert.ok(await page.locator('#garage-liveries [data-livery]').count() > 1, 'the liveries over the cabs');
  await page.click('[data-car=taxiGT]');
  assert.equal(await page.locator('#offer-buy').isDisabled(), true, 'not enough to buy it');
  assert.equal(await page.locator('#offer-test').isDisabled(), true, 'no test drives mid-shift');
  const time = await page.evaluate(() => window.__citydriver.taxi.timeLeft);
  await page.waitForTimeout(250); assert.equal(await page.evaluate(() => window.__citydriver.taxi.timeLeft), time);
  await page.screenshot({ path: '.artifacts/fleet/desktop-locked.png' });
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.locator('#pause-overlay').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#pause-overlay').isVisible(), true);
  assert.equal(await page.locator('#change-car').evaluate(button => button === document.activeElement), true);
  // Fund the shop fixture; actual fare banking is exercised in taxi-fleet.test.js.
  await page.evaluate(() => window.__citydriver.taxi.fleet.credit(10000));
  await page.click('#change-car'); await page.click('[data-car=taxiGT]'); await page.click('#offer-buy');
  assert.equal(await page.evaluate(() => window.__citydriver.taxi.fleet.balance), 0);
  assert.equal(await page.evaluate(() => window.__citydriver.vehicle.carId), 'taxi', 'purchase never swaps a cab mid-run');
  // (back on the pause screen: a dialog's close event restores it a task later)
  await page.locator('#pause-overlay').waitFor({ state: 'visible', timeout: 5000 });
  await page.click('#change-car'); await page.click('[data-car=taxiGT]');
  assert.equal(await page.evaluate(() => window.__citydriver.taxi.fleet.balance), 0, 'picking an owned cab only selects it');
  await page.click('#end-run');
  await page.waitForFunction(() => window.__citydriver.taxi.status === 'over');
  await page.click('#taxi-retry');
  assert.equal(await page.evaluate(() => window.__citydriver.vehicle.carId), 'taxiGT', 'the next shift is in the cab bought');
  await pickUp(page);
  await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
  await page.waitForFunction(() => window.__citydriver.taxi.boostActive && window.__citydriver.vehicle.speed > 15);
  await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
  await page.click('#pause');
  await page.evaluate(() => window.__citydriver.taxi.fleet.credit(40000));
  await page.click('#change-car'); await page.click('[data-car=taxiFormula]'); await page.click('#offer-buy');
  await page.click('#change-car'); await page.screenshot({ path: '.artifacts/fleet/desktop-owned.png' });
  await page.click('#close-cars'); await page.click('#end-run');
  await page.waitForFunction(() => window.__citydriver.taxi.status === 'over');
  await page.click('#taxi-retry');
  assert.equal(await page.evaluate(() => window.__citydriver.vehicle.carId), 'taxiFormula');
  assert.equal(await page.evaluate(() => window.__citydriver.vehicle.car.userData.seats), 2);
  await page.screenshot({ path: '.artifacts/fleet/formula-driving.png' });
  await pickUp(page);
  await page.evaluate(() => { window.__citydriver.taxi.timeLeft = .01; window.__citydriver.taxi.fareLeft = .01; });
  await page.waitForFunction(() => window.__citydriver.taxi.status === 'over');
  await page.click('#taxi-garage-results'); await page.click('[data-car=taxiGT]');
  assert.equal(await page.locator('#taxi-results').isVisible(), true);
  assert.equal(await page.locator('#pause-overlay').isVisible(), false);
  await page.click('#taxi-retry'); assert.equal(await page.evaluate(() => window.__citydriver.vehicle.carId), 'taxiGT');
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForFunction(() => window.__citydriver);
  await startAndPause(page);
  assert.equal(await page.evaluate(() => window.__citydriver.vehicle.carId), 'taxiGT');
  assert.deepEqual(await page.evaluate(() => [...window.__citydriver.taxi.fleet.owned]), ['taxi', 'coast', 'taxiGT', 'taxiFormula']);
  await page.click('#end-run'); await page.waitForFunction(() => window.__citydriver.taxi.status === 'over');
  await page.click('#taxi-keep'); await page.click('#pause');
  assert.equal(await page.evaluate(() => window.__citydriver.gameMode), 'free');
  assert.equal(await page.locator('#end-run').isVisible(), false);
  assert.equal(await page.locator('#change-car').isVisible(), true);
  await page.close();

  const mobile = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  // Fresh save: a cab the fleet doesn't own opens its offer in the garage,
  // and its free test drive goes straight to the street without granting ownership.
  await mobile.tap('#free-drive'); await mobile.waitForFunction(() => window.__citydriver.gameMode === 'free');
  await mobile.waitForFunction(() => getComputedStyle(document.querySelector('#welcome')).visibility === 'hidden');
  for (const id of ['taxiGT', 'taxiFormula']) {
    await mobile.tap('#pause'); await mobile.tap('#change-car'); await mobile.tap(`[data-car=${id}]`);
    assert.equal(await mobile.locator('#garage-offer').isVisible(), true);
    assert.equal(await mobile.locator('#offer-buy').isDisabled(), true, 'not enough to buy it');
    assert.equal(await mobile.locator('#offer-test').textContent(), 'Test drive · Free');
    await mobile.tap('#offer-test');
    await mobile.waitForFunction(() => !window.__citydriver.paused);
    assert.equal(await mobile.evaluate(() => window.__citydriver.vehicle.carId), id);
    assert.equal(await mobile.evaluate(() => window.__citydriver.testDrive.id), id);
    assert.deepEqual(await mobile.evaluate(() => [...window.__citydriver.taxi.fleet.owned]), ['taxi', 'coast']);
    await mobile.waitForTimeout(200);
    assert.equal(await mobile.evaluate(() => window.__citydriver.taxi.status), 'idle', 'a test drive takes no fares');
  }
  await mobile.tap('#pause'); await mobile.tap('#switch-mode');
  assert.equal(await mobile.evaluate(() => window.__citydriver.vehicle.carId), 'taxi', 'free selection does not bypass ownership');
  await mobile.tap('#pause'); await mobile.tap('#change-car');
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await mobile.locator('#car-dialog').evaluate(el => el.scrollWidth <= el.clientWidth));
  await mobile.locator('#garage-liveries').scrollIntoViewIfNeeded();
  await mobile.screenshot({ path: '.artifacts/fleet/mobile.png' });
  await mobile.locator('[data-car=taxiFormula]').scrollIntoViewIfNeeded();
  await mobile.screenshot({ path: '.artifacts/fleet/mobile-formula.png' });
  await mobile.tap('#close-cars');
  await mobile.setViewportSize({ width: 844, height: 390 });
  await mobile.tap('#change-car');
  assert.ok(await mobile.locator('#car-dialog').evaluate(el => el.scrollWidth <= el.clientWidth));
  await mobile.locator('[data-car=taxiFormula]').scrollIntoViewIfNeeded();
  await mobile.screenshot({ path: '.artifacts/fleet/mobile-landscape.png' });
  await mobile.tap('#close-cars'); await mobile.tap('#resume');
  await pickUp(mobile);
  await mobile.evaluate(() => { window.__citydriver.taxi.timeLeft = .01; window.__citydriver.taxi.fareLeft = .01; });
  await mobile.waitForFunction(() => window.__citydriver.taxi.status === 'over');
  await mobile.locator('#taxi-garage-results').scrollIntoViewIfNeeded();
  await mobile.tap('#taxi-garage-results'); await mobile.tap('#close-cars');
  await mobile.locator('#taxi-keep').scrollIntoViewIfNeeded(); await mobile.tap('#taxi-keep');
  assert.equal(await mobile.evaluate(() => window.__citydriver.gameMode), 'free');
  assert.deepEqual(errors, []);
  await writeFile('.artifacts/fleet/browser-report.json', JSON.stringify({ passed: true, errors }, null, 2));
  console.log('Fleet checks passed (through the garage): purchases, persistence, next-shift selection, results, mode-specific menus, test drives, desktop and touch layouts.');
} finally { await browser.close(); }
