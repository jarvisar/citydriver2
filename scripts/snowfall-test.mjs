import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 800 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${process.env.TEST_URL ?? 'http://127.0.0.1:5173'}/?seed=4817&ao=0`);
  await page.waitForFunction(() => window.__citydriver && document.querySelector('#loading').classList.contains('loaded'), null, { timeout: 60000 });
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const a = window.__citydriver;
    a.weather.setMode('snow', { immediate: true });
    a.weather.update(20, a.vehicle, a.world.origin);
    a.rendering.setWeather(a.weather.state);
    const snow = a.weather.snowfall, renderer = a.rendering.renderer;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0);
    const points = snow.points.clone();
    scene.add(points);
    const target = new THREE.WebGLRenderTarget(400, 240);
    const pixels = new Uint8Array(400 * 240 * 4);
    function capture(camera) {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, 400, 240, pixels);
      renderer.setRenderTarget(null);
      return pixels.slice();
    }
    const results = [];
    for (const aspect of [0.46, 1.5, 2, 3.5]) {
      for (const height of [75, 115, 165, 235]) {
        const camera = new THREE.OrthographicCamera(-height * aspect / 2, height * aspect / 2, height / 2, -height / 2, 1, 1200);
        camera.position.copy(a.vehicle.car.position).add(new THREE.Vector3(-220, 245, 260));
        camera.lookAt(a.vehicle.car.position);
        const first = capture(camera);
        const cells = Array(16).fill(0);
        for (let y = 0; y < 240; y++) for (let x = 0; x < 400; x++) {
          if (first[(y * 400 + x) * 4] > 20) cells[Math.floor(y / 60) * 4 + Math.floor(x / 100)]++;
        }
        const paused = capture(camera).every((value, i) => value === first[i]);
        // A floating-origin shift must leave the same logical flakes on screen.
        snow.uniforms.snowOrigin.value += 128;
        points.position.z += 128;
        camera.position.z += 128;
        const rebased = capture(camera).every((value, i) => value === first[i]);
        snow.uniforms.snowOrigin.value -= 128;
        points.position.z -= 128;
        results.push({ aspect, height, cells, paused, rebased });
      }
    }
    target.dispose();
    for (const view of [4, 5]) {
      a.rendering.setView(view);
      a.rendering.update(a.vehicle.car, 1, a.world.origin);
      a.rendering.render();
    }
    a.rendering.setView(0);
    a.rendering.update(a.vehicle.car, 10, a.world.origin);
    a.rendering.render();
    return results;
  });
  for (const result of results) {
    assert.ok(result.cells.every(count => count > 20), `Snow leaves an empty screen region: ${JSON.stringify(result)}`);
    assert.ok(result.paused, 'Paused snowfall moved');
    assert.ok(result.rebased, 'Origin rebase moved snowfall');
  }
  await mkdir('.artifacts/snowfall', { recursive: true });
  await page.screenshot({ path: '.artifacts/snowfall/scenic.png' });
  assert.deepEqual(errors, []);
  console.log(`Snowfall covers all 16 screen regions at ${results.length} zoom/aspect combinations; pause and origin rebases remain stable.`);
} finally {
  await browser.close();
}
