import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const out = process.argv[2] ?? '.scratch/camera-controls';
await mkdir(out, { recursive: true });
const server = await createServer({ server: { port: 0, host: '127.0.0.1', watch: null, hmr: false }, logLevel: 'error' });
await server.listen();
let browser;
try {
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH }
      : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}),
    args: ['--ignore-gpu-blocklist'],
  });
  const errors = [], page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(90000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const url = `http://127.0.0.1:${server.httpServer.address().port}/?seed=4817&ao=0`;
  const ready = () => page.waitForFunction(() => window.__citydriver && document.querySelector('#loading.loaded'));
  await page.goto(url); await ready(); await page.click('#free-drive');
  await page.evaluate(() => { const g = window.__citydriver; g.traffic.setEnabled(false); g.action('pause'); });
  await page.click('#camera-toggle');
  const range = (id, value) => page.locator(id).evaluate((input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }, String(value));
  const profile = () => page.evaluate(() => {
    const r = window.__citydriver.rendering;
    return { mode: r.cameraMode, view: r.viewIndex, zoom: r.zoomLevel, preferences: r.cameraPreferences.inputs, profiles: r.cameraPreferences.profiles };
  });
  await page.selectOption('#camera-source', 'mouse'); await range('#look-sensitivity', 150); await page.click('#invert-look');
  await page.selectOption('#camera-source', 'touch'); await range('#look-sensitivity', 65);
  await page.selectOption('#camera-source', 'controller'); await range('#look-sensitivity', 125);
  await range('#camera-distance', 250);
  const pausedLens = await page.evaluate(() => window.__citydriver.rendering.camera.position.toArray());
  await range('#camera-distance', 150);
  assert.notDeepEqual(await page.evaluate(() => window.__citydriver.rendering.camera.position.toArray()), pausedLens, 'distance previews while paused');
  await range('#camera-distance', 250);
  await page.selectOption('#camera-view', '5');
  assert.equal(await page.locator('#camera-distance').isDisabled(), true);
  await page.selectOption('#camera-source', 'mouse');
  assert.equal(await page.locator('#look-sensitivity').inputValue(), '150');
  assert.equal(await page.locator('#invert-look').getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: `${out}/desktop-settings.png` });
  const saved = await profile();
  await page.reload(); await ready(); await page.click('#free-drive');
  assert.deepEqual(await profile(), saved, 'choices survive reload and starting a new drive');

  // Walking changes profiles, entering another vehicle restores driving.
  await page.evaluate(() => { const g = window.__citydriver; g.vehicle.speed = 0; g.action('use'); });
  await page.waitForFunction(() => window.__citydriver.rendering.cameraMode === 'walking');
  assert.equal((await profile()).view, 4); assert.equal((await profile()).zoom, 1);
  await page.evaluate(() => window.__citydriver.action('pause'));
  await page.click('#camera-toggle'); await range('#camera-distance', 75); await page.selectOption('#camera-view', '5');
  await page.evaluate(() => { const g = window.__citydriver; g.action('pause'); g.chooseCar('taxi'); });
  await page.waitForFunction(() => window.__citydriver.rendering.cameraMode === 'driving');
  assert.equal((await profile()).view, 5); assert.equal((await profile()).zoom, 2.5);
  await page.evaluate(() => { const g = window.__citydriver; g.vehicle.speed = 0; g.action('use'); });
  await page.waitForFunction(() => window.__citydriver.rendering.cameraMode === 'walking');
  assert.equal((await profile()).view, 5); assert.equal((await profile()).zoom, .75);
  await page.evaluate(() => window.__citydriver.action('pause'));
  await page.selectOption('#camera-source', 'mouse'); await page.click('#reset-look');
  assert.deepEqual((await profile()).preferences.mouse, { sensitivity: 1, invertY: false });
  assert.equal((await profile()).preferences.touch.sensitivity, .65, 'reset affects only the selected input');

  // Native keyboard adjustment owns the input, never the car or global keys.
  await page.focus('#look-sensitivity'); await page.keyboard.press('ArrowRight');
  assert.equal((await profile()).preferences.mouse.sensitivity, 1.05);
  assert.deepEqual(await page.evaluate(() => [...window.__citydriver.input.keys]), []);
  console.log('settings, live paused preview, reload, profile switching, input isolation and keyboard editing passed');

  // Real pointer-lock movement uses these settings, not only their menu values.
  await page.click('#resume'); await page.mouse.click(500, 350);
  await page.waitForFunction(() => document.pointerLockElement?.id === 'scene');
  const angles = () => page.evaluate(() => {
    const m = window.__citydriver.rendering.camera.matrixWorld.elements;
    return [Math.atan2(m[8], m[10]), Math.asin(-m[9])];
  });
  const deltas = [];
  let mx = 500, my = 350;
  for (const [sensitivity, invertY] of [[1, false], [.5, true]]) {
    await page.evaluate(({ sensitivity, invertY }) => {
      const g = window.__citydriver;
      g.rendering.cameraPreferences.setInput('mouse', { sensitivity, invertY });
      g.rendering.snap(); g.rendering.update(g.vehicle.car, 0, g.world.origin);
    }, { sensitivity, invertY });
    const before = await angles();
    await page.mouse.move(mx += 40, my += 20); await page.waitForTimeout(120);
    const after = await angles();
    deltas.push(after.map((value, i) => Math.atan2(Math.sin(value - before[i]), Math.cos(value - before[i]))));
  }
  assert.ok(Math.abs(deltas[0][0]) > .05);
  assert.ok(Math.abs(deltas[1][0] / deltas[0][0] - .5) < .05, 'mouse sensitivity changes actual camera speed');
  assert.ok(Math.abs(deltas[1][1] / deltas[0][1] + .5) < .05, 'vertical inversion changes actual look direction');
  const zoom = (await profile()).zoom;
  await page.keyboard.press('KeyQ'); await page.waitForTimeout(1200);
  assert.ok(Math.abs((await angles())[1]) < .005, 'Q recenters a stationary first-person view');
  assert.equal((await profile()).zoom, zoom);
  console.log('native mouse sensitivity, vertical inversion and Q recenter passed');

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  mobile.setDefaultTimeout(90000); mobile.on('pageerror', e => errors.push(e.message));
  await mobile.goto(url); await mobile.waitForFunction(() => window.__citydriver && document.querySelector('#loading.loaded'));
  await mobile.tap('#free-drive'); await mobile.waitForTimeout(500);
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [568, 320], [768, 1024]]) {
    await mobile.setViewportSize({ width, height }); await mobile.waitForTimeout(150);
    const bounds = await mobile.evaluate(() => {
      const selectors = ['#camera-tools', '#stick-help', '#taxi-buttons', '.drive-actions', '.city-hud'];
      return selectors.map(selector => {
        const element = document.querySelector(selector), r = element.getBoundingClientRect();
        return { selector, visible: element.checkVisibility({ visibilityProperty: true }), x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      }).filter(r => r.visible);
    });
    for (const r of bounds) assert.ok(r.x >= -1 && r.y >= -1 && r.right <= width + 1 && r.bottom <= height + 1, `${width}x${height}: ${r.selector} in bounds`);
    const tools = bounds.find(r => r.selector === '#camera-tools');
    for (const r of bounds.filter(r => r !== tools)) assert.ok(Math.min(r.right, tools.right) <= Math.max(r.x, tools.x) || Math.min(r.bottom, tools.bottom) <= Math.max(r.y, tools.y), `${width}x${height}: camera tools overlap ${r.selector}`);
    await mobile.screenshot({ path: `${out}/touch-${width}x${height}.png` });
    await mobile.tap('#pause');
    if (!(await mobile.locator('#camera-settings').isVisible())) await mobile.tap('#camera-toggle');
    await mobile.locator('#camera-source').scrollIntoViewIfNeeded();
    const source = await mobile.locator('#camera-source').boundingBox();
    assert.ok(source.width >= 44 && source.height >= 44);
    await mobile.screenshot({ path: `${out}/settings-${width}x${height}.png` });
    await mobile.tap('#resume');
  }
  console.log('camera HUD and settings fit narrow phones, landscape and tablet layouts');
  assert.deepEqual(errors, []);
} finally { await browser?.close(); await server.close(); }
