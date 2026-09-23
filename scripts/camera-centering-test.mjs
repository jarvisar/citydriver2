import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const directory = '.artifacts/camera-centering';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], results = [];
try {
  for (const [width, height, touch] of [[1280, 800, false], [390, 844, true], [320, 568, true], [844, 390, true]]) {
    const page = await browser.newPage({ viewport: { width, height }, isMobile: touch, hasTouch: touch });
    page.setDefaultTimeout(60000);
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('citydriver.graphics', JSON.stringify({ mode: 'basic' })));
    await page.goto(`${process.env.TEST_URL ?? 'http://127.0.0.1:5173'}/?seed=4817&ao=0`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__citydriver && document.querySelector('#loading.loaded'));
    const measurements = await page.evaluate(() => {
      const a = window.__citydriver, r = a.rendering;
      a.beginFree(); a.action('pause'); r.renderer.setAnimationLoop(null);
      a.vehicle.render(1, a.world.origin);
      const car = a.vehicle.car;
      document.querySelector('#pause-overlay').hidden = true;
      const original = car.position.clone(), measured = [];
      for (let view = 0; view < 4; view++) {
        car.position.copy(original); r.setView(view); r.snap();
        let origin = a.world.origin;
        for (let step = 0; step < 20; step++) {
          // Include motion, elevation changes, zoom interpolation and a world-origin shift.
          if (step) { car.position.x += .75; car.position.z -= 1.25; car.position.y += .02; }
          if (step === 10) { origin += 112; car.position.z += 112; }
          r.update(car, step ? 1 / 60 : 0, origin);
          r.camera.updateMatrixWorld();
          const projected = car.position.clone().project(r.camera);
          measured.push({ view, step, offsetX: projected.x * innerWidth / 2, offsetY: projected.y * innerHeight / 2 });
        }
      }
      car.position.copy(original); r.setView(3); r.snap(); r.update(car, 1, a.world.origin); r.render();
      const silhouette = r.scene.getObjectByName('car-silhouette');
      return { measured, silhouetteColor: silhouette.children[0].material.color.getHexString() };
    });
    assert.equal(measurements.silhouetteColor, '506678');
    assert.ok(measurements.measured.every(p => Math.abs(p.offsetX) < .01 && Math.abs(p.offsetY) < .01), 'all overhead views keep the car centered during motion and origin shifts');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#welcome')).visibility === 'hidden');
    await page.screenshot({ path: `${directory}/${width}x${height}.png` });
    results.push({ width, height, ...measurements });
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${directory}/report.json`, JSON.stringify({ passed: true, errors, results }, null, 2));
  console.log('Camera checks passed: all four isometric zooms stay centered on desktop, portrait and landscape during movement, elevation changes and origin shifts.');
} finally { await browser.close(); }
