// Screenshots around the generated city for checking the world by eye:
// coast, river and bridge, a park, downtown, a junction, a taxi pickup,
// autodrive and night. Starts its own dev server.
// node scripts/city-tour.mjs [seed] [outDir]
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const seed = process.argv[2] ?? '4817', out = process.argv[3] ?? '.artifacts/tour';
await mkdir(out, { recursive: true });
const server = await createServer({ server: { port: 0, host: '127.0.0.1' } });
await server.listen();
const executablePath = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium'].find(candidate => candidate && existsSync(candidate));
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.setDefaultTimeout(120000);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?seed=${seed}`);
  await page.waitForFunction(() => document.querySelector('#loading.loaded') && window.__citydriver);
  await page.click('#free-drive');
  await page.waitForTimeout(500);
  // Teleport the car and settle the world around it
  const place = (pose, view = 4) => page.evaluate(({ pose, view }) => {
    const g = window.__citydriver, v = g.vehicle;
    v.s = pose.s; v.u = pose.u; v.heading = pose.heading ?? v.heading; v.speed = 0; v.update(0, {});
    g.world.update(v.s, v.u); while (g.world.pending.length || g.world.distantPending.length) g.world.update(v.s, v.u);
    g.rendering.setView(view); g.rendering.snap();
    v.render(0, g.world.origin); g.rendering.update(v.car, 1, g.world.origin);
    g.traffic.reset(v.route, v.s, 'city', v.u);
    return { s: v.s, u: v.u, chunks: g.world.chunks.size };
  }, { pose, view });
  const shot = async name => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };
  const poses = await page.evaluate(() => {
    const g = window.__citydriver, city = g.city, nav = g.nav;
    const middle = road => { const p = road.points[Math.floor(road.points.length / 2)]; const q = road.points[Math.min(road.points.length - 1, Math.floor(road.points.length / 2) + 1)]; return g.lanePose({ ...g.roadAt(p.y, p.x, 40) }, Math.atan2(q.x - p.x, q.y - p.y)); };
    const byKind = kind => city.roads.filter(r => r.kind === kind).sort((a, b) => b.points.length - a.points.length)[0];
    const out = {};
    const coast = byKind('coast'); if (coast) out.coast = middle(coast);
    const bank = byKind('riverbank'); if (bank) out.river = middle(bank);
    const bridge = g.world.bridges.slice().sort((a, b) => b.points.length - a.points.length)[0];
    if (bridge) { const p = bridge.points[0], q = bridge.points[Math.floor(bridge.points.length / 2)]; out.bridge = g.lanePose(g.roadAt(p.y, p.x, 40), Math.atan2(q.x - p.x, q.y - p.y)); }
    const path = byKind('path'); if (path) out.park = middle(path);
    const near = g.nearestLanePose(city.downtown.s, city.downtown.u, 0, 400); out.downtown = near;
    const junction = nav.nodes.filter(n => n.edges.length === 4 && n.edges.every(e => e.kind !== 'path')).sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))[0];
    if (junction) { const edge = junction.edges[0], direction = edge.a === junction.id ? -1 : 1; const along = direction > 0 ? edge.length - 30 : 30; out.junction = nav.pose(edge, direction > 0 ? along : edge.length - along, direction, edge.profile.lane); }
    return out;
  });
  console.log('poses', JSON.stringify(poses));
  for (const [name, pose] of Object.entries(poses)) {
    if (!pose) continue;
    console.log(name, JSON.stringify(await place(pose, 4)));
    await shot(`${name}-chase`);
    if (name === 'coast' || name === 'downtown') { await page.evaluate(() => { const g = window.__citydriver; g.rendering.setView(0); g.rendering.update(g.vehicle.car, 1, g.world.origin); }); await shot(`${name}-scenic`); }
  }
  // Night at the junction
  await page.evaluate(() => { const g = window.__citydriver; g.weather.setMode('night', { immediate: true }); g.rendering.setView(4); });
  await page.waitForTimeout(1500); await shot('night');
  await page.evaluate(() => window.__citydriver.weather.setMode('clear', { immediate: true }));
  // Autodrive for a few seconds
  await page.keyboard.press('KeyH');
  await page.waitForTimeout(6000);
  const auto = await page.evaluate(() => { const g = window.__citydriver; return { enabled: g.autodrive.enabled, speed: Math.round(g.vehicle.speed), distance: Math.round(g.vehicle.distance), onRoad: Boolean(g.roadAt(g.vehicle.s, g.vehicle.u)?.distance <= 11) }; });
  console.log('autodrive', JSON.stringify(auto));
  await shot('autodrive');
  await page.keyboard.press('KeyH');
  // A taxi run: the nearest pickup ring
  await page.evaluate(() => window.__citydriver.beginTaxi());
  await page.waitForTimeout(800);
  const taxi = await page.evaluate(() => { const g = window.__citydriver, t = g.taxi, v = g.vehicle; const c = t.customers[0]; return { status: t.status, customers: t.customers.length, first: c && { name: c.name, passengers: c.passengers, fare: c.fare, length: Math.round(c.length), distance: Math.round(Math.hypot(c.s - v.s, c.u - v.u)) } }; });
  console.log('taxi', JSON.stringify(taxi));
  await page.evaluate(() => { const g = window.__citydriver, t = g.taxi, v = g.vehicle, c = t.customers[0]; if (c) { v.s = c.s - Math.cos(c.heading) * 14; v.u = c.u - Math.sin(c.heading) * 14; v.heading = c.heading; v.update(0, {}); while (g.world.pending.length) g.world.update(v.s, v.u); v.render(0, 0); g.rendering.update(v.car, 1, 0); } });
  await shot('taxi-pickup');
  await page.evaluate(() => { const g = window.__citydriver, t = g.taxi, v = g.vehicle, c = t.customers[0]; if (c) { v.s = c.s; v.u = c.u; v.speed = 0; v.update(0, {}); } });
  await page.waitForTimeout(1500);
  const boarded = await page.evaluate(() => { const g = window.__citydriver, t = g.taxi; return { status: t.status, target: t.target?.name, timeLeft: Math.round(t.timeLeft), onboard: t.onboard }; });
  console.log('boarded', JSON.stringify(boarded));
  await shot('taxi-driving');
} finally {
  console.log('errors', errors.length, errors.slice(0, 5));
  await browser.close(); await server.close();
}
