// Real browser multi-touch: the drive thumb, camera thumb and HUD own separate
// pointers. CDP dispatches physical touches, including compatibility clicks.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const out = process.argv[2] ?? '.scratch/touch-camera';
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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.setDefaultTimeout(120000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?seed=4817&ao=0`);
  await page.waitForFunction(() => window.__citydriver && document.querySelector('#loading.loaded'));
  await page.tap('#free-drive');
  await page.waitForFunction(() => window.__citydriver.started && !window.__citydriver.paused && !window.__citydriver.changingJourney);
  await page.evaluate(() => { const g = window.__citydriver; g.traffic.setEnabled(false); g.graphics.setMode('basic'); });
  const cdp = await page.context().newCDPSession(page);
  let active = [];
  const touch = async (type, points) => {
    // Callers pass the fingers left on the screen; CDP touchEnd instead
    // names the fingers to lift (an empty list lifts every finger).
    const changed = type === 'touchEnd' && points.length ? active.filter(([id]) => !points.some(p => p[0] === id)) : points;
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: changed.map(([id, x, y]) => ({ id, x, y, radiusX: 8, radiusY: 8, force: 1 })) });
    active = points.map(point => [...point]);
  };
  const state = () => page.evaluate(() => {
    const g = window.__citydriver, t = g.input.touchStick;
    return { drive: t.pointer, look: t.lookPointer, vector: t.vector, camera: g.rendering.camera.quaternion.toArray(),
      paused: g.paused, boost: g.input.state.boost, walking: Boolean(g.vehicle.walker), hint: document.querySelector('.stick-help-line').textContent };
  });
  const view = firstPerson => page.evaluate(firstPerson => {
    const g = window.__citydriver;
    for (let i = 0; i < 6 && !(firstPerson ? g.rendering.firstPersonView : g.rendering.chaseView); i++) g.action('view');
  }, firstPerson);
  const changed = (a, b) => a.some((v, i) => Math.abs(v - b[i]) > .01);
  for (const [name, width, height] of [['portrait', 390, 844], ['landscape', 844, 390]]) {
    await page.setViewportSize({ width, height });
    await view(false);
    await page.waitForTimeout(350);
    const drive = [1, Math.round(width * .2), Math.round(height * .65)], look = [2, Math.round(width * .72), Math.round(height * .45)];
    assert.deepEqual(await page.evaluate(points => points.map(([, x, y]) => document.elementFromPoint(x, y)?.id), [drive, look]), ['scene', 'scene']);
    await touch('touchStart', [drive]);
    drive[2] -= 30; await touch('touchMove', [drive]);
    const steering = (await state()).vector;
    assert.ok(steering.y > .3);
    await touch('touchStart', [drive, look]);
    const before = await state();
    assert.ok(before.drive !== null && before.look !== null && before.drive !== before.look);
    look[1] += 45; look[2] -= 20; await touch('touchMove', [drive, look]);
    await page.waitForTimeout(200);
    let after = await state();
    assert.deepEqual(after.vector, steering, 'looking must not steer');
    assert.ok(changed(before.camera, after.camera), 'second thumb must move the camera');
    assert.match(after.hint, /Second thumb/);
    // Camera buttons have their own touches, with no extra drive/look role.
    const zoomBox = await page.locator('[data-camera-action="zoomOut"]').boundingBox();
    const zoom = [6, zoomBox.x + zoomBox.width / 2, zoomBox.y + zoomBox.height / 2];
    const zoomBefore = await page.evaluate(() => window.__citydriver.rendering.zoomLevel);
    await touch('touchStart', [drive, look, zoom]); await touch('touchEnd', [drive, look]);
    assert.ok(await page.evaluate(value => window.__citydriver.rendering.zoomLevel > value, zoomBefore));
    assert.equal((await state()).look, before.look); assert.equal((await state()).drive, before.drive);
    await page.screenshot({ path: `${out}/${name}-two-thumbs.png` });

    // A third finger on Boost belongs to its button, never the camera.
    const box = await page.locator('[data-drive-button="boost"]').boundingBox();
    const boost = [3, box.x + box.width / 2, box.y + box.height / 2];
    await touch('touchStart', [drive, look, boost]);
    assert.ok((await state()).boost);
    await touch('touchEnd', [drive, look]);
    assert.equal((await state()).look, before.look);
    assert.equal((await state()).boost, false);

    // Lifting the driver cannot turn the camera thumb into an accelerator.
    await touch('touchEnd', [look]);
    after = await state();
    assert.equal(after.drive, null); assert.equal(after.look, before.look);
    assert.deepEqual(after.vector, { x: 0, y: 0 });
    const released = after.camera;
    look[1] -= 60; await touch('touchMove', [look]);
    await page.waitForTimeout(200);
    assert.ok(changed(released, (await state()).camera));
    drive[0] = 4; await touch('touchStart', [drive, look]);
    assert.deepEqual((await state()).vector, { x: 0, y: 0 }, 'replacement thumb starts at rest');
    assert.equal((await state()).look, before.look);

    // Resize cancels both roles even while the glass is still being touched.
    await page.setViewportSize({ width: height, height: width });
    await page.waitForTimeout(200);
    assert.equal((await state()).drive, null); assert.equal((await state()).look, null);
    await touch('touchEnd', []);
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(200);

    // First-person gets the same gesture. Pausing with a third finger must
    // release both captures and must not click the new Resume button.
    await view(true);
    await touch('touchStart', [drive]); await touch('touchStart', [drive, look]);
    const first = await state();
    look[1] += 40; await touch('touchMove', [drive, look]);
    await page.waitForTimeout(200);
    assert.ok(changed(first.camera, (await state()).camera));
    const pauseBox = await page.locator('#pause').boundingBox();
    const pause = [5, pauseBox.x + pauseBox.width / 2, pauseBox.y + pauseBox.height / 2];
    await touch('touchStart', [drive, look, pause]); await touch('touchEnd', [drive, look]);
    await page.waitForTimeout(200);
    after = await state();
    assert.equal(after.paused, true); assert.equal(after.drive, null); assert.equal(after.look, null);
    await touch('touchEnd', []);
    await page.evaluate(() => window.__citydriver.action('pause'));

    // Overhead view keeps its screen-relative single-stick controls.
    await page.evaluate(() => window.__citydriver.action('view'));
    await touch('touchStart', [drive]); await touch('touchStart', [drive, look]);
    assert.equal((await state()).look, null);
    await touch('touchCancel', []);
    assert.equal((await state()).drive, null);
    console.log(`${name}: drive + look, independent Boost, finger replacement, resize, first person, pause and overhead passed`);
  }
  await page.evaluate(() => {
    const g = window.__citydriver;
    g.vehicle.speed = 0; g.action('use');
  });
  await page.waitForFunction(() => Boolean(window.__citydriver.vehicle.walker));
  await view(true);
  await page.waitForTimeout(250);
  const foot = await page.evaluate(() => {
    const g = window.__citydriver, camera = g.rendering.camera;
    return { heading: Math.atan2(camera.matrixWorld.elements[8], camera.matrixWorld.elements[10]), s: g.vehicle.s, u: g.vehicle.u };
  });
  const drive = [11, 165, 230], look = [12, 590, 155];
  await touch('touchStart', [drive]); drive[1] += 30; await touch('touchMove', [drive]);
  await page.waitForTimeout(600);
  const walked = await page.evaluate(() => {
    const g = window.__citydriver, m = g.rendering.camera.matrixWorld.elements;
    return { heading: Math.atan2(m[8], m[10]), s: g.vehicle.s, u: g.vehicle.u, right: [m[0], m[2]] };
  });
  assert.ok(Math.abs(walked.heading - foot.heading) < .01, 'first-person movement thumb strafes instead of turning');
  assert.ok((walked.u - foot.u) * walked.right[0] - (walked.s - foot.s) * walked.right[1] > .1, 'sideways touch moves the walker across the view');
  await touch('touchStart', [drive, look]);
  const beforeLook = (await state()).camera;
  look[1] += 45; await touch('touchMove', [drive, look]);
  await page.waitForTimeout(200);
  assert.ok(changed(beforeLook, (await state()).camera), 'second thumb turns first-person walking');
  await touch('touchCancel', []);
  console.log('on foot: first-person strafe and independent camera drag passed');
  assert.deepEqual(errors, []);
} finally { await browser?.close(); await server.close(); }
