// Repeatable driving-camera survey, with the same poses before and after edits.
// node scripts/city-polish-review.mjs [outDir] [seed ...]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const out = process.argv[2] ?? '.artifacts/city-polish';
const seeds = process.argv.slice(3).length ? process.argv.slice(3) : ['4817', '1', '2', '3', '1065425237', '90210'];
const server = await createServer({ server: { port: 0, host: '127.0.0.1', watch: null }, logLevel: 'error' });
await server.listen();
const executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch({ ...(executablePath && existsSync(executablePath) ? { executablePath } : {}),
  args: process.platform === 'win32' ? ['--use-angle=d3d11', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  for (const [seedIndex, seed] of seeds.entries()) {
    const dir = `${out}/${seed}`;
    await mkdir(dir, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(180000);
    page.on('pageerror', e => errors.push(`${seed}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${seed}: ${m.text()}`); });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?seed=${seed}`);
    await page.waitForFunction(() => document.querySelector('#loading.loaded') && window.__citydriver);
    await page.click('#free-drive');
    let poses = await page.evaluate(async seedIndex => {
      const g = window.__citydriver;
      const { cityStyleDistrict } = await import('/src/world/city.js');
      const { cityPlaces } = await import('/src/city-exploration.js');
      const { CITY_PLACES } = await import('/src/world/city-places.js');
      const { planLot } = await import('/src/world/city-buildings.js');
      const { cityParks } = await import('/src/world/city-parks.js');
      const { yardDrive } = await import('/src/world/city-yards.js');
      if (!g.paused) g.action('pause');
      g.traffic.setEnabled(false);
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
      // Look across the street at the details a forward-facing tour can miss.
      const lots = [...g.world.lotsByChunk.values()].flat();
      for (const name of ['shopfront', 'balconies']) {
        for (const lot of lots) {
          const b = planLot({ east: 0, start: 0 }, lot);
          if (b.kind !== 'building' || (name === 'shopfront' ? !b.shopfront || b.variation !== 2 || b.district !== 'Old town' : b.type !== 'apartment' || b.variation !== 0)) continue;
          const i = b.street.findIndex(Boolean), a = b.footprint[i], q = b.footprint[(i + 1) % b.footprint.length];
          const dx = q.x - a.x, dy = q.y - a.y, length = Math.hypot(dx, dy);
          if (length < 10) continue;
          const bays = Math.max(1, Math.floor((length - 1.6) / 4.8)), offset = name === 'balconies' ? -(bays - 1) / 2 * (length - 1.8) / bays : 0;
          const x = (a.x + q.x) / 2 + dx / length * offset, y = (a.y + q.y) / 2 + dy / length * offset;
          const p = g.nearestLanePose(y - dx / length * 14, x + dy / length * 14, Math.atan2(dx, dy), 35);
          if (!p) continue;
          result.push({ name, ...p, heading: Math.atan2(x - p.u, y - p.s), view: 5 });
          break;
        }
      }
      // Ordinary entrances need their own close view as well as landmarks.
      for (const type of ['townhouse', 'warehouse', 'office']) {
        for (const lot of lots) {
          const b = planLot({ east: 0, start: 0 }, lot);
          if (b.kind !== 'building' || b.type !== type || b.shopfront) continue;
          const front = b.footprint.map((a, i) => ({ a, q: b.footprint[(i + 1) % b.footprint.length], street: b.street[i] }))
            .filter(f => f.street).sort((a, b) => Math.hypot(b.q.x - b.a.x, b.q.y - b.a.y) - Math.hypot(a.q.x - a.a.x, a.q.y - a.a.y))[0];
          if (!front) continue;
          const { a, q } = front, length = Math.hypot(q.x - a.x, q.y - a.y);
          const x = (a.x + q.x) / 2, y = (a.y + q.y) / 2;
          const p = g.nearestLanePose(y - (q.x - a.x) / length * 10, x + (q.y - a.y) / length * 10, 0, 25);
          if (!p || Math.hypot(x - p.u, y - p.s) > 22) continue;
          result.push({ name: `front-${type}`, ...p, heading: Math.atan2(x - p.u, y - p.s), view: 5 });
          break;
        }
      }
      // Look at a car-park mouth from its own street, where painted bays
      // must leave a gap for the approach across the pavement.
      for (const block of g.city.blocks) {
        const drive = yardDrive(block.index);
        if (!drive) continue;
        const { mouth: m } = drive, p = g.nearestLanePose(m.y, m.x, 0, 35);
        if (!p || !g.roadAt(p.s, p.u)?.road.profile.parking) continue;
        result.push({ name: 'driveway', ...p, heading: Math.atan2(m.x - p.u, m.y - p.s), view: 5 });
        break;
      }
      // Four different venues per seed cover the full catalogue in the default tour.
      const venues = Object.keys(CITY_PLACES).filter(type => !['park', 'plaza'].includes(type));
      for (let i = 0; i < 4; i++) {
        const type = venues[(seedIndex * 4 + i) % venues.length], place = cityPlaces().find(p => p.type === type);
        if (!place) continue;
        const p = g.nearestLanePose(place.entrance.s, place.entrance.u, place.entrance.heading ?? 0, 150);
        if (p) result.push({ name: `venue-${type}`, ...p, heading: Math.atan2(place.u - p.u, place.s - p.s), view: 5 });
      }
      result.push({ ...result.find(p => p.name === 'shopfront'), name: 'basic-shopfront', quality: 'basic' });
      // Public-space details, viewed from the closest ordinary driving lane.
      const furniture = [...g.world.furnitureByChunk.values()].flat();
      for (const kind of ['shelter', 'bed', 'glasshouse', 'bandstand', 'bench', 'cafe', 'stall']) {
        const candidates = furniture.filter(f => f.kind === kind).map(f => {
          const p = g.nearestLanePose(f.s, f.u, 0, 100);
          return p && { f, p, distance: Math.hypot(f.s - p.s, f.u - p.u) };
        }).filter(c => c && c.distance > 7).sort((a, b) => a.distance - b.distance);
        const chosen = candidates[0];
        if (chosen) {
          const { f, p } = chosen;
          result.push({ name: `detail-${kind}`, ...p, heading: Math.atan2(f.u - p.u, f.s - p.s), view: 5 });
          if (['cafe', 'stall', 'bench', 'bandstand'].includes(kind)) {
            // Also inspect the actual furniture at eye height in its square.
            const angle = (f.yaw ?? 0) + (kind === 'bench' ? -Math.PI / 3 : Math.PI / 4);
            const distance = kind === 'bandstand' ? 13 : kind === 'bench' ? 5 : 8;
            const u = f.u + Math.sin(angle) * distance, s = f.s - Math.cos(angle) * distance;
            result.push({ name: `detail-${kind}-close`, u, s, heading: Math.atan2(f.u - u, f.s - s), view: 5 });
          }
        }
      }
      const square = cityParks().find(e => !e.paved && e.park.square && e.walks.some(w => w.length === 2));
      const entrance = square?.walks.find(w => w.length === 2)?.[0];
      if (entrance) {
        const p = g.nearestLanePose(entrance.y, entrance.x, 0, 100);
        if (p) result.push({ name: 'square-entrance', ...p, heading: Math.atan2(entrance.x - p.u, entrance.y - p.s), view: 5 });
      }
      // These are ordinary first-person views from the drivable park paths.
      const junction = g.nav.nodes.find(n => n.edges.length >= 3 && n.edges.every(e => e.kind === 'path') && n.edges.some(e => e.length > 35));
      if (junction) {
        const e = junction.edges.find(e => e.length > 35), direction = e.a === junction.id ? -1 : 1;
        const p = g.nav.pose(e, e.length - 14, direction, 0);
        result.push({ name: 'path-junction', ...p, view: 5 });
      }
      result.push({ ...result[0], name: 'night', weather: 'night' });
      return result.filter(p => Number.isFinite(p.s)).map(({ name, s, u, heading, view, weather, quality }) => ({ name, s, u, heading, view, weather, quality }));
    }, seedIndex);
    // Parking/furniture edits can change the nearest collision-free lane.
    // Reuse recorded poses when comparing geometry across those changes.
    if (process.env.REVIEW_POSES) {
      const saved = JSON.parse(await readFile(`${process.env.REVIEW_POSES}/${seed}/poses.json`, 'utf8'));
      poses = poses.map(p => saved.find(q => q.name === p.name) ?? p);
    }
    await writeFile(`${dir}/poses.json`, JSON.stringify(poses, null, 2));
    const shots = [], metrics = [];
    for (const pose of poses.filter(p => !process.env.REVIEW_VIEWS || process.env.REVIEW_VIEWS.split(',').includes(p.name))) {
      await page.evaluate(p => {
        const g = window.__citydriver, v = g.vehicle;
        g.graphics.setMode(p.quality ?? 'balanced'); g.graphics.setDensity(1);
        g.weather.setMode(p.weather ?? 'clear', { immediate: true });
        v.s = p.s; v.u = p.u; v.heading = p.heading; v.speed = 0;
        v.wheelSpin = 0; v.bodyPitch = 0; v.bodyRoll = 0; v.steer = 0;
        v.update(0, {});
        g.world.update(v.s, v.u);
        while (g.world.pending.length || g.world.distantPending.length) g.world.update(v.s, v.u);
        g.weather.update(0, v, g.world.origin); g.rendering.setWeather(g.weather.state, 0);
        g.world.setWetness(g.weather.state.wetness); g.world.setWindowGlow(g.weather.state.windowGlow); v.setLights(g.weather.state.lightLevel);
        g.rendering.setView(p.view); g.rendering.snap(); v.render(0, g.world.origin);
        g.rendering.update(v.car, 1, g.world.origin);
        g.world.animate(0, 0, g.rendering.camera);
      }, pose);
      await page.waitForTimeout(250);
      const { data, counts, medianRenderMs } = await page.evaluate(timing => {
        const r = window.__citydriver.rendering; r.render();
        const times = [];
        if (timing) {
          const gl = r.renderer.getContext();
          for (let i = 0; i < 8; i++) r.render();
          gl.finish();
          for (let i = 0; i < 15; i++) {
            const start = performance.now(); r.render(); gl.finish(); times.push(performance.now() - start);
          }
          times.sort((a, b) => a - b);
        }
        return { data: r.renderer.domElement.toDataURL('image/png'), counts: { ...r.renderer.info.render, ...r.renderer.info.memory }, medianRenderMs: times[7] };
      }, Boolean(process.env.REVIEW_TIMING));
      metrics.push({ name: pose.name, quality: pose.quality ?? 'balanced', ...counts, medianRenderMs });
      await writeFile(`${dir}/${pose.name}.png`, Buffer.from(data.split(',')[1], 'base64'));
      shots.push({ name: pose.name, data });
    }
    await writeFile(`${dir}/metrics.json`, JSON.stringify(metrics, null, 2));
    await page.evaluate(p => {
      const g = window.__citydriver;
      // A focused furniture review may end inside a square. Always start
      // the driving check from the same known lane, regardless of filters.
      const v = g.vehicle;
      v.s = p.s; v.u = p.u; v.heading = p.heading; v.speed = 0; v.update(0, {});
      g.world.update(v.s, v.u);
      while (g.world.pending.length || g.world.distantPending.length) g.world.update(v.s, v.u);
      g.rendering.setView(4); g.rendering.snap();
      g.weather.setMode('clear', { immediate: true });
      g.traffic.setEnabled(true, g.vehicle);
      if (g.paused) g.action('pause');
    }, poses[0]);
    await page.keyboard.press('KeyH');
    const start = await page.evaluate(() => window.__citydriver.vehicle.distance);
    await page.waitForTimeout(6000);
    const drive = await page.evaluate(start => {
      const g = window.__citydriver, v = g.vehicle;
      return { enabled: g.autodrive.enabled, distance: v.distance - start, speed: v.speed, surface: g.roadAt(v.s, v.u)?.road.kind };
    }, start);
    await writeFile(`${dir}/drive.json`, JSON.stringify(drive, null, 2));
    if (!drive.enabled || !(drive.distance > 2) || !drive.surface) errors.push(`${seed}: autodrive did not make progress on a road`);
    await page.screenshot({ path: `${dir}/driving.png` });
    await page.close();
    for (let i = 0; i < shots.length; i += 8) {
      const batch = shots.slice(i, i + 8);
      const contact = await browser.newPage({ viewport: { width: 1280, height: Math.ceil(batch.length / 2) * 420 } });
      await contact.setContent(`<body style="margin:0;background:#18252c;color:white;font:16px sans-serif;display:grid;grid-template-columns:1fr 1fr">${batch.map(s => `<div><div style="height:20px">${seed} / ${s.name}</div><img width="640" height="400" src="${s.data}"></div>`).join('')}</body>`);
      await contact.screenshot({ path: `${dir}/contact-${i / 8 + 1}.png` });
      await contact.close();
    }
    console.log(`Reviewed seed ${seed}: ${shots.length} driving views; autodrive ${drive.distance.toFixed(1)} m`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); await server.close(); }
