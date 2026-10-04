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
  await page.selectOption('#camera-view', '3');
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
  assert.equal((await profile()).view, 2); assert.equal((await profile()).zoom, 1);
  await page.evaluate(() => window.__citydriver.action('pause'));
  await page.click('#camera-toggle'); await range('#camera-distance', 75); await page.selectOption('#camera-view', '3');
  await page.evaluate(() => { const g = window.__citydriver; g.action('pause'); g.chooseCar('taxi'); });
  await page.waitForFunction(() => window.__citydriver.rendering.cameraMode === 'driving');
  assert.equal((await profile()).view, 3); assert.equal((await profile()).zoom, 2.5);
  await page.evaluate(() => { const g = window.__citydriver; g.vehicle.speed = 0; g.action('use'); });
  await page.waitForFunction(() => window.__citydriver.rendering.cameraMode === 'walking');
  assert.equal((await profile()).view, 3); assert.equal((await profile()).zoom, .75);
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

  // Stop rendering time so a native wheel event's first frame can be measured.
  const lens = () => page.evaluate(() => {
    const r = window.__citydriver.rendering, camera = r.camera;
    return { position: camera.position.toArray(), rotation: camera.quaternion.toArray(), fov: camera.fov,
      view: r.viewIndex, zoom: r.zoomLevel, saved: r.cameraPreferences.profiles[r.cameraMode] };
  });
  const step = async (seconds = .5) => page.evaluate(seconds => {
    const g = window.__citydriver;
    for (let time = 0; time < seconds - 1e-8; time += 1 / 60) g.rendering.update(g.vehicle.car, Math.min(1 / 60, seconds - time), g.world.origin);
    g.rendering.render();
  }, seconds);
  const samePose = (a, b) => {
    for (const key of ['position', 'rotation']) a[key].forEach((value, i) => assert.ok(Math.abs(value - b[key][i]) < 1e-8, `${key}: no camera cut`));
    assert.equal(a.fov, b.fov);
  };
  await page.evaluate(() => {
    const g = window.__citydriver, r = g.rendering;
    g.beginFree(); r.renderer.setAnimationLoop(null); r.setView(2, true); r.setZoom(.5, true); r.snap();
    r.update(g.vehicle.car, 0, g.world.origin); r.look(.6, .2); r.update(g.vehicle.car, 0, g.world.origin); r.render();
  });
  let before = await lens();
  await page.mouse.wheel(0, -100);
  await page.waitForFunction(() => window.__citydriver.rendering.firstPersonView);
  let after = await lens(); samePose(before, after);
  assert.deepEqual(after.saved, { view: 3, zoom: .45 });
  assert.match(await page.locator('#view').getAttribute('aria-label'), /First-person/);
  assert.equal(await page.locator('#camera-distance').isDisabled(), true);
  await step(.1);
  const middle = await lens(); assert.notDeepEqual(middle.position, before.position);
  await page.screenshot({ path: `${out}/zoom-entering-first.png` });
  await page.mouse.wheel(0, 100);
  await page.waitForFunction(() => window.__citydriver.rendering.chaseView);
  after = await lens(); samePose(middle, after);
  assert.ok(after.zoom > .45 && after.zoom < .6, 'outward scroll returns to the closest chase distance');
  await step(.08);
  before = await lens();
  await page.mouse.wheel(0, -100);
  await page.waitForFunction(() => window.__citydriver.rendering.firstPersonView);
  samePose(before, await lens());
  await step();
  await page.screenshot({ path: `${out}/zoom-first.png` });
  before = await lens(); await page.mouse.wheel(0, -800); await page.waitForTimeout(50);
  assert.deepEqual(await lens(), before, 'remaining inward scrolls stay in first person');
  await page.keyboard.press('BracketRight');
  assert.equal((await lens()).view, 2); assert.ok(Math.abs((await lens()).zoom - .54) < 1e-9);
  samePose(before, await lens()); await step();
  await page.screenshot({ path: `${out}/zoom-third.png` });
  await page.keyboard.press('BracketLeft'); assert.equal((await lens()).view, 3); await step();

  // The physical D-pad shares zoom, while steering cannot change the seat.
  const padViews = await page.evaluate(() => {
    const pad = { index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ value: 0 })) };
    const g = window.__citydriver, input = g.input.gamepad, getGamepads = input.getGamepads;
    input.getGamepads = () => [pad]; input.update(); input.update();
    pad.axes[0] = 1; input.update(); const steering = g.rendering.viewIndex;
    pad.axes[0] = 0; input.update(); pad.buttons[15].value = 1; input.update(); const out = g.rendering.viewIndex;
    pad.buttons[15].value = 0; input.update(); pad.buttons[14].value = 1; input.update(); const inward = g.rendering.viewIndex;
    input.getGamepads = getGamepads; input.update();
    return [steering, out, inward];
  });
  assert.deepEqual(padViews, [3, 2, 3]); await step();
  const savedZoom = (await lens()).saved;
  await page.reload(); await ready(); await page.click('#free-drive');
  assert.deepEqual((await lens()).saved, savedZoom, 'scroll-selected perspective survives reload');
  assert.equal((await lens()).view, 3);
  await page.evaluate(() => {
    const g = window.__citydriver;
    g.traffic.setEnabled(false); g.vehicle.speed = 0; g.action('use');
  });
  await page.waitForFunction(() => window.__citydriver.rendering.cameraMode === 'walking');
  await page.evaluate(() => {
    const g = window.__citydriver, r = g.rendering;
    r.renderer.setAnimationLoop(null); g.vehicle.render(1, g.world.origin); g.onFoot.render(1, g.world.origin);
    r.setView(2, true); r.setZoom(.5, true); r.update(g.vehicle.car, 0, g.world.origin); r.look(.7, .15); r.update(g.vehicle.car, 0, g.world.origin);
    window.__zoomGaze = r.camera.getWorldDirection(r.camera.position.clone()).toArray();
  });
  await page.mouse.move(600, 400); await page.mouse.wheel(0, -100);
  await page.waitForFunction(() => window.__citydriver.rendering.firstPersonView); await step();
  const gaze = await page.evaluate(() => {
    const r = window.__citydriver.rendering;
    return { before: window.__zoomGaze, after: r.camera.getWorldDirection(r.camera.position.clone()).toArray() };
  });
  gaze.before.forEach((value, i) => assert.ok(Math.abs(value - gaze.after[i]) < 1e-6, 'walking retains gaze'));
  assert.equal((await lens()).saved.view, 3);
  assert.deepEqual((await profile()).profiles.driving, savedZoom, 'walking scroll does not overwrite driving');
  await page.mouse.wheel(0, 100); await page.waitForFunction(() => window.__citydriver.rendering.chaseView); await step();
  await page.screenshot({ path: `${out}/zoom-walking.png` });
  await page.evaluate(() => window.__citydriver.action('pause'));
  before = await lens(); await page.mouse.wheel(0, -2000); await page.keyboard.press('BracketLeft');
  assert.deepEqual(await lens(), before, 'pause consumes zoom shortcuts');
  await page.evaluate(() => { const g = window.__citydriver; g.action('pause'); g.rendering.setView(1, true); });
  before = await lens(); await page.mouse.wheel(0, -2000); await page.keyboard.press('BracketRight');
  assert.deepEqual(await lens(), before, 'overhead views ignore perspective zoom');
  console.log('native wheel, continuous reversal, keyboard, physical D-pad, walking gaze, saved views and menu guards passed');

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
    // (a phone leaves them out: the distance is in the Camera settings)
    assert.equal(Boolean(tools), width > 760 && height > 560, `${width}x${height}: camera tools only where there is room`);
    if (tools) for (const r of bounds.filter(r => r !== tools)) assert.ok(Math.min(r.right, tools.right) <= Math.max(r.x, tools.x) || Math.min(r.bottom, tools.bottom) <= Math.max(r.y, tools.y), `${width}x${height}: camera tools overlap ${r.selector}`);
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
  await mobile.tap('#pause'); await mobile.selectOption('#camera-view', '2'); await mobile.tap('#resume');
  await mobile.evaluate(() => window.__citydriver.rendering.setZoom(.45, true));
  await mobile.tap('[data-camera-action="zoomIn"]');
  assert.equal(await mobile.evaluate(() => window.__citydriver.rendering.firstPersonView), true);
  assert.equal(await mobile.locator('[data-camera-action="zoomIn"]').isHidden(), true);
  assert.equal(await mobile.locator('[data-camera-action="zoomOut"]').isEnabled(), true);
  assert.equal(await mobile.locator('[data-camera-action="zoomOut"]').getAttribute('aria-label'), 'Switch to third-person view');
  await mobile.tap('[data-camera-action="zoomOut"]');
  assert.equal(await mobile.evaluate(() => window.__citydriver.rendering.chaseView), true);
  console.log('tablet zoom buttons enter and leave first person');
  assert.deepEqual(errors, []);
} finally { await browser?.close(); await server.close(); }
