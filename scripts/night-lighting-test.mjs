import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('.artifacts/night-lighting', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => localStorage.setItem('citydriver.graphics', JSON.stringify({ mode: 'basic' })));
  await page.goto(`${process.env.TEST_URL ?? 'http://127.0.0.1:5173'}/?seed=4817`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__citydriver && document.querySelector('#loading.loaded'), null, { timeout: 90000 });
  await page.evaluate(() => window.__citydriver.beginFree());
  await page.waitForFunction(() => !window.__citydriver.changingJourney);
  await page.evaluate(() => {
    const a = window.__citydriver; if (!a.paused) a.action('pause'); a.rendering.renderer.setAnimationLoop(null);
    a.world.update(a.vehicle.s, a.vehicle.u); a.vehicle.render(1, a.world.origin); a.traffic.render(1, a.world.origin);
    document.querySelector('#pause-overlay').hidden = true;
    document.querySelector('#welcome').style.display = 'none';
  });
  await page.selectOption('#city-weather', 'night', { force: true });
  const report = await page.evaluate(() => {
    const a = window.__citydriver, r = a.rendering.renderer, scene = a.world.scene;
    const lights = scene.getObjectByName('night-lighting'), records = [];
    for (let view = 0; view < 6; view++) {
      a.rendering.setView(view); a.rendering.update(a.vehicle.car, 1, a.world.origin);
      a.rendering.render();
      if (!lights.getObjectByName('street-light-pools').count) throw new Error('Street lamps missing');
      const enabled = { calls: r.info.render.calls, triangles: r.info.render.triangles, textures: r.info.memory.textures };
      lights.visible = false;
      if (view === 5) a.vehicle.car.visible = false;
      r.render(scene, a.rendering.camera);
      a.vehicle.car.visible = true;
      const disabled = { calls: r.info.render.calls, triangles: r.info.render.triangles, textures: r.info.memory.textures };
      records.push({ view, calls: enabled.calls - disabled.calls, triangles: enabled.triangles - disabled.triangles });
    }
    return records;
  });
  assert.ok(report.every(row => row.calls <= 4 && row.calls > 0), JSON.stringify(report));
  assert.ok(report.every(row => row.triangles <= 96 * 16 + 25 * 2), JSON.stringify(report));
  for (const view of [2, 4, 5]) {
    await page.evaluate(view => { const a = window.__citydriver; a.rendering.setView(view); a.rendering.snap(); a.rendering.update(a.vehicle.car, 2, a.world.origin); a.rendering.render(); }, view);
    await page.screenshot({ path: `.artifacts/night-lighting/view-${view}.png` });
  }
  await page.selectOption('#city-weather', 'clear', { force: true });
  assert.equal(await page.evaluate(() => { const a = window.__citydriver; a.rendering.render(); return a.world.scene.getObjectByName('night-lighting').visible; }), false);
  assert.deepEqual(errors, []);
  await writeFile('.artifacts/night-lighting/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
