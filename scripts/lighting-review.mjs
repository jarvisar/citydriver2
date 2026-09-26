// Fixed street-level night/storm comparisons, including the basic graphics tier.
// node scripts/lighting-review.mjs [output directory]
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const out = process.argv[2] ?? '.artifacts/lighting-review';
await mkdir(out, { recursive: true });
const server = await createServer({ server: { port: 0, host: '127.0.0.1', watch: null }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH }
    : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}),
  args: process.platform === 'win32' ? ['--use-angle=d3d11', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [], metrics = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?seed=4817`);
  await page.waitForFunction(() => document.querySelector('#loading.loaded') && window.__citydriver);
  await page.click('#free-drive');
  const poses = await page.evaluate(async () => {
    const g = window.__citydriver;
    const { cityStyleDistrict } = await import('/src/world/city.js');
    if (!g.paused) g.action('pause');
    g.traffic.setEnabled(false);
    const edges = g.nav.edges.filter(e => e.kind !== 'path' && e.length > 65);
    return ['Midtown', 'Old town', 'Garden quarter'].map(style => {
      const district = g.city.districts.find(d => d.style === style);
      const middle = e => g.nav.pose(e, e.length / 2, 1, e.profile.lane);
      const edge = edges.filter(e => { const p = middle(e); return cityStyleDistrict(p.s, p.u) === style; })
        .sort((a, b) => { const p = middle(a), q = middle(b); return Math.hypot(p.u - district.centre.x, p.s - district.centre.y) - Math.hypot(q.u - district.centre.x, q.s - district.centre.y); })[0];
      return { name: style.toLowerCase().replaceAll(' ', '-'), ...middle(edge) };
    });
  });
  await writeFile(`${out}/poses.json`, JSON.stringify(poses, null, 2));
  for (const pose of poses) for (const weather of ['night', 'storm']) for (const quality of ['balanced', 'basic']) {
    const name = `${pose.name}-${weather}-${quality}`;
    await page.evaluate(({ pose, weather, quality }) => {
      const g = window.__citydriver, v = g.vehicle;
      g.graphics.setMode(quality); g.graphics.setDensity(1);
      g.weather.setMode(weather, { immediate: true });
      v.s = pose.s; v.u = pose.u; v.heading = pose.heading; v.speed = 0; v.update(0, {});
      v.wheelSpin = 0; v.bodyPitch = 0; v.bodyRoll = 0;
      g.world.update(v.s, v.u);
      while (g.world.pending.length || g.world.distantPending.length) g.world.update(v.s, v.u);
      g.weather.update(0, v, g.world.origin); g.rendering.setWeather(g.weather.state, 0);
      g.world.setWetness(g.weather.state.wetness); g.world.setWindowGlow(g.weather.state.windowGlow); v.setLights(g.weather.state.lightLevel);
      g.rendering.setView(pose.name === 'old-town' ? 5 : 4); g.rendering.snap(); v.render(0, g.world.origin);
      g.rendering.update(v.car, 1, g.world.origin); g.world.animate(0, 0, g.rendering.camera);
    }, { pose, weather, quality });
    await page.waitForTimeout(250);
    const result = await page.evaluate(async () => {
      const r = window.__citydriver.rendering, gl = r.renderer.getContext();
      for (let i = 0; i < 8; i++) r.render();
      const times = [];
      // Finish the GPU work as well: indicative local render timings, not FPS.
      for (let i = 0; i < 24; i++) {
        const start = performance.now(); r.render(); gl.finish(); times.push(performance.now() - start);
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      r.render();
      const lights = r.scene.getObjectByName('night-lighting');
      return { data: r.renderer.domElement.toDataURL('image/png'),
        counts: { ...r.renderer.info.render, ...r.renderer.info.memory },
        lights: lights.children.map(m => ({ name: m.name, count: m.count })),
        medianRenderMs: times.sort((a, b) => a - b)[Math.floor(times.length / 2)] };
    });
    await writeFile(`${out}/${name}.png`, Buffer.from(result.data.split(',')[1], 'base64'));
    metrics.push({ name, ...result, data: undefined });
    console.log(`${name}: ${result.counts.calls} draws, ${result.medianRenderMs.toFixed(1)} ms`);
  }
  await writeFile(`${out}/metrics.json`, JSON.stringify(metrics, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); await server.close(); }
