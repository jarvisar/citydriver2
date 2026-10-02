// The headset's menus and HUD, through Meta's WebXR emulator (IWER, the dev
// server's `?xr` hook): enters VR, walks the title, a taxi run, the pause
// menu, the city map, the fleet, the results, free drive (and out of the car on foot), the garage, and
// checks the game's state at each step. Saves the headset's view, a close-up
// at about a Quest 3's sharpness and each panel's own canvas.
// node scripts/vr-review.mjs [output directory]   (STEREO=1 draws both eyes)
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const out = process.argv[2] ?? '.artifacts/vr-review';
await mkdir(out, { recursive: true });
const server = await createServer({ server: { port: 0, host: '127.0.0.1', watch: null, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH }
    : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}),
  args: process.platform === 'win32' ? ['--use-angle=d3d11', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [], checks = [];
const check = (name, ok, detail = '') => checks.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(120000);
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.addInitScript(() => {
  localStorage.setItem('citydriver.graphics', JSON.stringify({ mode: 'balanced' })); localStorage.setItem('citydriver-weather', 'clear');
  localStorage.setItem('citydriver.camera', JSON.stringify({ profiles: { driving: { view: 2, zoom: 2 }, walking: { view: 5, zoom: .8 } } }));
});
const wait = ms => page.waitForTimeout(ms);
// Controls, as a hand would work them: a press lasts a few headset frames.
const set = (hand, id, value) => page.evaluate(([hand, id, value]) => window.__xr.controllers[hand].updateButtonValue(id, value), [hand, id, value]);
async function press(hand, id) { await set(hand, id, 1); await wait(100); await set(hand, id, 0); await wait(150); }
async function stick(hand, x, y) {
  await page.evaluate(([hand, x, y]) => window.__xr.controllers[hand].updateAxes('thumbstick', x, y), [hand, x, y]); await wait(120);
  await page.evaluate(hand => window.__xr.controllers[hand].updateAxes('thumbstick', 0, 0), hand); await wait(120);
}
// Point a controller at the middle of a menu row. The emulator's local space
// starts at its head, 1.6 m up.
async function aim(hand, label) {
  const found = await page.evaluate(([hand, label]) => {
    const game = window.__citydriver, status = game.vrStatus, mesh = status.menu.mesh, rig = game.rendering.vrCamera.rig;
    const region = status.regions.find(region => status.entries[region.index].label === label);
    if (!region) return false;
    const V = game.vehicle.car.position.constructor, Q = game.vehicle.car.quaternion.constructor;
    mesh.updateWorldMatrix(true, false);
    const target = new V((region.x + region.width / 2) / status.menu.width - .5, .5 - (region.y + region.height / 2) / status.menu.height, 0).applyMatrix4(mesh.matrixWorld);
    target.applyMatrix4(rig.matrixWorld.clone().invert()); target.y += 1.6;
    const from = new V(hand === 'right' ? .18 : -.18, 1.3, -.25), turn = new Q().setFromUnitVectors(new V(0, 0, -1), target.sub(from).normalize());
    const controller = window.__xr.controllers[hand];
    controller.position.set(from.x, from.y, from.z); controller.quaternion.set(turn.x, turn.y, turn.z, turn.w);
    return true;
  }, [hand, label]);
  check(`a "${label}" row to point at`, found);
  await wait(200);
}
const state = () => page.evaluate(() => {
  const game = window.__citydriver, status = game.vrStatus;
  return { vr: game.vr.active, paused: game.paused, started: game.started, mode: game.gameMode, taxi: game.taxi.status,
    menu: status.model?.id ?? null, selected: status.entries[status.selected]?.label ?? null, hud: Boolean(status.hudPanel?.mesh.visible), speed: game.vehicle.speed,
    walking: Boolean(game.vehicle.walker), s: game.vehicle.s, u: game.vehicle.u, look: game.rendering.camera.rotation.y };
});
async function shot(name, { close = false } = {}) {
  await wait(350);
  await page.screenshot({ path: `${out}/${name}.png` });
  const panels = await page.evaluate(() => {
    const status = window.__citydriver.vrStatus, grab = panel => {
      if (!panel?.mesh.visible) return null;
      const canvas = document.createElement('canvas'); canvas.width = panel.width; canvas.height = panel.height;
      canvas.getContext('2d').drawImage(panel.canvas, 0, 0); return canvas.toDataURL();
    };
    return { menu: grab(status.menu), hud: grab(status.hudPanel) };
  });
  for (const [kind, data] of Object.entries(panels)) if (data) await writeFile(`${out}/${name}-${kind}.png`, Buffer.from(data.split(',')[1], 'base64'));
  if (close) {
    // The middle of the view at 25 pixels a degree
    await page.evaluate(() => { window.__xr.fovy = 35 * Math.PI / 180; }); await wait(250);
    await page.screenshot({ path: `${out}/${name}-close.png` });
    await page.evaluate(() => { window.__xr.fovy = Math.PI / 2; }); await wait(150);
  }
  return state();
}
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?seed=4817&xr${process.env.STEREO ? '=stereo' : ''}`);
  await page.waitForFunction(() => window.__citydriver && document.querySelector('#loading.loaded') && !window.__citydriver.changingJourney);
  await page.waitForFunction(() => !document.querySelector('#enter-vr').hidden);
  await page.evaluate(() => window.__citydriver.traffic.setEnabled(false, window.__citydriver.vehicle));
  check('a headset\'s browser puts Enter VR first', await page.evaluate(() => document.querySelector('.menu-actions').firstElementChild.id === 'enter-vr'));
  await page.click('#enter-vr');
  await page.waitForFunction(() => window.__citydriver.vr.active);
  await wait(1200);
  let now = await shot('01-title', { close: true });
  check('VR opens on the title menu with the car still and no clock running', now.menu === 'title' && !now.started && Math.abs(now.speed) < .5);
  await page.evaluate(() => { const angle = 1.2; window.__xr.controllers.right.quaternion.set(Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)); });
  await wait(150); await press('right', 'trigger');
  check('a trigger pulled at the sky starts nothing', !(await state()).started);
  await aim('right', 'Free drive');
  now = await shot('02-title-pointing');
  check('pointing at a row selects it', now.selected === 'Free drive', now.selected);
  await aim('right', 'Taxi shift'); await press('right', 'trigger'); await wait(300);
  now = await state();
  check('the trigger on Taxi shift puts the cab on standby, the clock waiting for a fare', now.started && now.mode === 'free' && now.taxi === 'standby');
  await set('right', 'trigger', 1); await wait(1500);
  now = await shot('03-taxi');
  check('the HUD shows while driving', now.hud && now.menu === null);
  await page.evaluate(() => window.__xr.controllers.left.updateAxes('thumbstick', -1, 0)); await wait(900);
  const vignette = await page.evaluate(() => window.__citydriver.rendering.vrCamera.comfort.amount);
  await shot('04-turning');
  check('a hard turn brings in the comfort vignette', vignette > .2, vignette.toFixed(2));
  await page.evaluate(() => window.__xr.controllers.left.updateAxes('thumbstick', 0, 0)); await set('right', 'trigger', 0); await wait(1500);
  await set('right', 'trigger', 1); await set('right', 'squeeze', 1); await wait(600);
  check('the right grip boosts', await page.evaluate(() => window.__citydriver.taxi.boostActive || window.__citydriver.vehicle.boosting));
  await set('right', 'trigger', 0); await set('right', 'squeeze', 0);
  // A fare: stop in the lane by a waiting passenger, the camera behind along the street
  await page.evaluate(() => {
    const game = window.__citydriver, rider = game.taxi.customers.find(rider => rider.passengers === 1 && rider.id !== game.taxi.blockedPickup?.id) ?? game.taxi.customers[0];
    const pose = game.nearestLanePose(rider.s, rider.u, game.vehicle.heading);
    Object.assign(game.vehicle, { s: pose.s, u: pose.u, heading: pose.heading, speed: 0 }); game.vehicle.knock.x = game.vehicle.knock.z = game.vehicle.knock.spin = 0;
    game.rendering.snap();
  });
  await page.waitForFunction(() => window.__citydriver.taxi.status === 'driving', null, { timeout: 20000 }).catch(() => {});
  await wait(1200);
  await shot('05-fare', { close: true });
  check('the first fare starts the shift', (await state()).mode === 'taxi');
  check('a fare floats the arrow over the car', await page.evaluate(() => window.__citydriver.taxiView.navigation.headset.visible));
  // Pause while looking to the right: the menu opens where the player looks
  await page.evaluate(() => window.__xr.quaternion.set(0, Math.sin(-.35), 0, Math.cos(-.35)));
  await press('left', 'y-button');
  now = await shot('06-paused');
  check('Y pauses (it no longer leaves VR) and Resume is selected', now.vr && now.paused && now.menu === 'pause' && now.selected === 'Resume', now.selected);
  const beforeLook = await page.evaluate(() => window.__citydriver.rendering.vrCamera.camera.quaternion.toArray());
  await aim('right', 'Stick look speed'); await press('right', 'trigger');
  check('headset settings change stick look speed', await page.evaluate(() => window.__citydriver.rendering.cameraPreferences.inputs.controller.sensitivity === 1.25));
  check('look speed does not rotate tracked head orientation', await page.evaluate(before => window.__citydriver.rendering.vrCamera.camera.quaternion.toArray().every((value, i) => Math.abs(value - before[i]) < 1e-6), beforeLook));
  check('headset view changes leave screen preferences alone', await page.evaluate(() => {
    const r = window.__citydriver.rendering, before = JSON.stringify(r.cameraPreferences.profiles);
    r.toggleView(); r.setView(4); r.cameraPreferences.setInput('controller', { sensitivity: 1 });
    return JSON.stringify(r.cameraPreferences.profiles) === before;
  }));
  await page.evaluate(() => window.__xr.quaternion.set(0, 0, 0, 1));
  await shot('07-paused-ahead', { close: true });
  await stick('left', 0, 1); await stick('right', 1, 0);
  now = await shot('08-paused-moved');
  check('the stick walks the rows and crosses to the other column', now.selected !== 'Resume', now.selected);
  await aim('right', 'City map'); await press('right', 'trigger');
  now = await shot('09-map');
  check('the city map opens as a panel', now.menu === 'map');
  await press('right', 'b-button');
  now = await state();
  check('B returns to the pause menu, on the row that opened the map', now.menu === 'pause' && now.selected === 'City map', now.selected);
  await aim('right', 'Taxi fleet'); await press('right', 'trigger');
  now = await shot('10-fleet');
  check('the taxi fleet opens', now.menu === 'taxi-fleet-dialog');
  await press('right', 'b-button');
  await aim('right', 'End shift'); await press('right', 'trigger'); await wait(300);
  check('End shift opens the results', (await state()).menu === 'taxi-results');
  await aim('right', 'Keep driving'); await press('right', 'trigger'); await wait(1000);
  now = await shot('11-free');
  check('Keep driving carries on in free drive, where the cab is', now.mode === 'free' && !now.paused);
  const address = await page.evaluate(() => location.href);
  await press('left', 'x-button'); await wait(500);
  check('X resets the car and keeps the session and the city', (await state()).vr && await page.evaluate(() => location.href) === address);
  // On foot: Y gets out in free drive, the left stick walks, the right looks
  // round, walking straight back returns to the car, and Y gets back in
  await press('left', 'y-button'); await wait(700);
  now = await shot('11a-on-foot', { close: true });
  check('Y gets out of the car in free drive, the drive still running', now.walking && !now.paused && now.menu === null && now.hud);
  const out = now;
  await page.evaluate(() => window.__xr.controllers.left.updateAxes('thumbstick', 0, -1)); await wait(1000);
  await page.evaluate(() => window.__xr.controllers.left.updateAxes('thumbstick', 0, 0)); await wait(400);
  now = await shot('11b-walked');
  check('the left stick walks', Math.hypot(now.s - out.s, now.u - out.u) > 3, `${Math.hypot(now.s - out.s, now.u - out.u).toFixed(1)} m`);
  const walked = now;
  await page.evaluate(() => window.__xr.controllers.right.updateAxes('thumbstick', 1, 0)); await wait(500);
  await page.evaluate(() => window.__xr.controllers.right.updateAxes('thumbstick', 0, 0)); await wait(200);
  check('the right stick turns the view round them', Math.abs((await state()).look - walked.look) > .3);
  await page.evaluate(() => window.__xr.controllers.right.updateAxes('thumbstick', -1, 0)); await wait(500);
  await page.evaluate(() => window.__xr.controllers.right.updateAxes('thumbstick', 0, 0)); await wait(200);
  await set('left', 'squeeze', 1); await wait(150);
  check('the left grip jumps', await page.evaluate(() => !window.__citydriver.vehicle.walker.grounded));
  await set('left', 'squeeze', 0); await wait(600);
  await page.evaluate(() => window.__xr.controllers.left.updateAxes('thumbstick', 0, 1)); await wait(1000);
  await page.evaluate(() => window.__xr.controllers.left.updateAxes('thumbstick', 0, 0)); await wait(400);
  now = await shot('11c-back-by-the-car');
  check('walking back toward the camera returns to the car', await page.evaluate(() => window.__citydriver.onFoot.offer()?.own === true));
  await press('left', 'y-button'); await wait(500);
  now = await state();
  check('Y gets back in', !now.walking && !now.paused);
  await press('right', 'b-button');
  await aim('right', 'Garage'); await press('right', 'trigger');
  now = await shot('12-garage');
  check('the garage opens', now.menu === 'car-dialog');
  await stick('right', 1, 0); await stick('right', 1, 0);
  await shot('13-garage-cars');
  await press('right', 'b-button');
  await aim('right', 'Taxi shift'); await press('right', 'trigger');
  await page.evaluate(() => {
    const game = window.__citydriver, rider = game.taxi.customers.find(rider => rider.id !== game.taxi.blockedPickup?.id);
    Object.assign(game.vehicle, { s: rider.s, u: rider.u, heading: rider.heading, speed: 0 }); game.vehicle.update(0, {});
  });
  await page.waitForFunction(() => window.__citydriver.taxi.running, null, { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => { window.__citydriver.taxi.timeLeft = .05; window.__citydriver.taxi.fareLeft = .05; });
  await page.waitForFunction(() => window.__citydriver.taxi.status === 'over', null, { timeout: 20000 }).catch(() => {});
  now = await shot('14-results');
  check('the results open on Next shift', now.menu === 'taxi-results' && now.selected === 'Next shift', now.selected);
  await aim('right', 'Keep driving'); await press('right', 'trigger');
  await press('right', 'b-button');
  await aim('right', 'Exit VR'); await press('right', 'trigger'); await wait(800);
  now = await shot('15-exited');
  check('Exit VR returns to the page, paused', !now.vr && now.paused);
  check('Exit VR restores the saved screen camera', await page.evaluate(() => window.__citydriver.rendering.viewIndex === 2 && window.__citydriver.rendering.zoomLevel === 2));
} catch (error) { errors.push(error.stack); }
finally { await browser.close(); await server.close(); }
await writeFile(`${out}/checks.txt`, `${checks.join('\n')}\n\nerrors: ${errors.join('\n') || 'none'}\n`);
console.log(checks.join('\n'));
console.log(`errors: ${errors.join('\n') || 'none'}`);
if (errors.length || checks.some(line => line.startsWith('FAIL'))) process.exitCode = 1;
