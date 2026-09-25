// Repeatable driving-camera survey, with the same poses before and after edits.
// node scripts/city-polish-review.mjs [outDir] [seed ...]
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const out = process.argv[2] ?? '.artifacts/city-polish';
const seeds = process.argv.slice(3).length ? process.argv.slice(3) : ['4817', '1', '2', '3', '1065425237', '90210'];
const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch({ ...(executablePath && existsSync(executablePath) ? { executablePath } : {}),
  args: process.platform === 'win32' ? ['--use-angle=d3d11', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  for (const seed of seeds) {
    const dir = `${out}/${seed}`;
    await mkdir(dir, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(180000);
    page.on('pageerror', e => errors.push(`${seed}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${seed}: ${m.text()}`); });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?seed=${seed}`);
    await page.waitForFunction(() => document.querySelector('#loading.loaded') && window.__citydriver);
    await page.click('#free-drive');
    const poses = await page.evaluate(async () => {
      const g = window.__citydriver;
      const { cityStyleDistrict } = await import('/src/world/city.js');
      const { cityPlaces } = await import('/src/city-exploration.js');
      g.graphics.setMode('balanced'); g.graphics.setDensity(1);
      g.weather.setMode('clear', { immediate: true });
      const edges = g.nav.edges.filter(e => e.kind !== 'path' && e.length > 65);
      const middle = e => g.nav.pose(e, e.length / 2, 1, e.profile.lane);
      const result = g.city.districts.map(d => {
        const e = edges.filter(e => { const p = middle(e); return cityStyleDistrict(p.s, p.u) === d.style; })
          .sort((a, b) => { const p = middle(a), q = middle(b); return Math.hypot(p.u - d.centre.x, p.s - d.centre.y) - Math.hypot(q.u - d.centre.x, q.s - d.centre.y); })[0];
        return e && { name: d.style.toLowerCase().replaceAll(' ', '-'), ...middle(e), view: 4 };
      }).filter(Boolean);
      for (const kind of ['coast', 'riverbank', 'main', 'ring']) {
        const e = edges.filter(e => e.kind === kind).sort((a, b) => b.length - a.length)[0];
        if (e) result.push({ name: kind, ...middle(e), view: 5 });
      }
      for (const type of ['park', 'plaza']) {
        const place = cityPlaces().find(p => p.type === type);
        if (!place) continue;
        const p = g.nearestLanePose(place.entrance.s, place.entrance.u, place.entrance.heading ?? 0, 150);
        if (p) result.push({ name: type, ...p, heading: Math.atan2(place.u - p.u, place.s - p.s), view: 5 });
      }
      const bridge = g.world.bridges.slice().sort((a, b) => (b.to - b.from) - (a.to - a.from))[0];
      if (bridge) {
        const a = bridge.points[0], b = bridge.points[1], heading = Math.atan2(b.x - a.x, b.y - a.y);
        const p = g.nearestLanePose(a.y - Math.cos(heading) * 12, a.x - Math.sin(heading) * 12, heading, 80);
        if (p) result.push({ name: 'bridge', ...p, view: 4 });
      }
      let state = g.seed >>> 0;
      for (let i = 0; i < 4; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        result.push({ name: `sample-${i}`, ...middle(edges[state % edges.length]), view: i % 2 ? 5 : 4 });
      }
      result.push({ ...result[0], name: 'night', weather: 'night' });
      return result.map(({ name, s, u, heading, view, weather }) => ({ name, s, u, heading, view, weather }));
    });
    await writeFile(`${dir}/poses.json`, JSON.stringify(poses, null, 2));
    const shots = [];
    for (const pose of poses) {
      await page.evaluate(p => {
        const g = window.__citydriver, v = g.vehicle;
        g.weather.setMode(p.weather ?? 'clear', { immediate: true });
        v.s = p.s; v.u = p.u; v.heading = p.heading; v.speed = 0; v.update(0, {});
        g.world.update(v.s, v.u);
        while (g.world.pending.length || g.world.distantPending.length) g.world.update(v.s, v.u);
        g.rendering.setView(p.view); g.rendering.snap(); v.render(0, g.world.origin);
        g.rendering.update(v.car, 1, g.world.origin);
        g.traffic.reset(v.route, v.s, 'city', v.u);
      }, pose);
      await page.waitForTimeout(250);
      const data = await page.evaluate(() => { const r = window.__citydriver.rendering; r.render(); return r.renderer.domElement.toDataURL('image/png'); });
      await writeFile(`${dir}/${pose.name}.png`, Buffer.from(data.split(',')[1], 'base64'));
      shots.push({ name: pose.name, data });
    }
    await page.evaluate(() => window.__citydriver.weather.setMode('clear', { immediate: true }));
    await page.keyboard.press('KeyH');
    const start = await page.evaluate(() => window.__citydriver.vehicle.distance);
    await page.waitForTimeout(6000);
    const drive = await page.evaluate(start => {
      const g = window.__citydriver, v = g.vehicle;
      return { enabled: g.autodrive.enabled, distance: v.distance - start, speed: v.speed, surface: g.roadAt(v.s, v.u)?.road.kind };
    }, start);
    await writeFile(`${dir}/drive.json`, JSON.stringify(drive, null, 2));
    await page.screenshot({ path: `${dir}/driving.png` });
    await page.close();
    for (let i = 0; i < shots.length; i += 8) {
      const batch = shots.slice(i, i + 8);
      const contact = await browser.newPage({ viewport: { width: 1280, height: Math.ceil(batch.length / 2) * 420 } });
      await contact.setContent(`<body style="margin:0;background:#18252c;color:white;font:16px sans-serif;display:grid;grid-template-columns:1fr 1fr">${batch.map(s => `<div><div style="height:20px">${seed} / ${s.name}</div><img width="640" height="400" src="${s.data}"></div>`).join('')}</body>`);
      await contact.screenshot({ path: `${dir}/contact-${i / 8 + 1}.png` });
      await contact.close();
    }
    console.log(`Reviewed seed ${seed}: ${poses.length} driving views; autodrive ${drive.distance.toFixed(1)} m`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); await server.close(); }
