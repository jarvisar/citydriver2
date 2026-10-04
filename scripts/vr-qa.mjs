// Interruptions, input, flight and stereo coverage beyond vr-review's menu tour.
// node scripts/vr-qa.mjs [out]   SEED=2 SOFTWARE=1 for the second renderer path.
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const out = process.argv[2] ?? '.artifacts/vr-qa';
const seed = Number(process.env.SEED ?? 4817);
await mkdir(out, { recursive: true });
const checks = [], errors = [], observations = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
};
const server = await createServer({ server: { port: 0, host: '127.0.0.1', watch: null, hmr: false }, logLevel: 'error' });
await server.listen();
let browser;
try {
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH }
      : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}),
    args: process.env.SOFTWARE || process.platform !== 'win32'
      ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.stack));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    localStorage.setItem('citydriver.graphics', JSON.stringify({ mode: 'basic', ambientOcclusion: false, frameCap: 30 }));
    localStorage.setItem('citydriver-weather', 'clear');
    localStorage.setItem('citydriver.camera', JSON.stringify({ version: 2, profiles: { driving: { view: 1, zoom: 2 }, walking: { view: 3, zoom: .8 } } }));
  });
  const wait = ms => page.waitForTimeout(ms);
  // Software rendering can take longer than a whole short button press.
  // Both edges need a sampled frame, including the neutral frame between them.
  const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const get = () => page.evaluate(() => {
    const g = window.__citydriver, v = g.vehicle, r = g.rendering;
    return { active: g.vr.active, visible: g.vr.visible, started: g.started, paused: g.paused, mode: g.gameMode,
      menu: g.vrStatus.model?.id ?? null, selected: g.vrStatus.entries[g.vrStatus.selected]?.label,
      hud: Boolean(g.vrStatus.hudPanel?.mesh.visible), speed: v.speed, s: v.s, u: v.u, y: v.groundedPosition.y,
      walker: Boolean(v.walker), grounded: v.walker?.grounded, pilot: Boolean(v.pilot),
      input: structuredClone(g.input.xr.state), sources: g.input.xr.sources.length,
      heading: v.heading, look: r.camera.rotation.y, view: r.viewIndex, zoom: r.zoomLevel,
      comfort: r.vrCamera.comfort.amount, blink: r.vrCamera.comfort.dark,
      cash: g.taxi.fleet.balance, taxi: g.taxi.status, clock: g.taxi.timeLeft, demolition: g.demolition.status,
      car: v.carId, test: g.testDrive.id, testLeft: g.testDrive.left,
      target: g.graphics.target, scale: g.graphics.xrScale, level: g.graphics.levelId,
    };
  });
  const set = async (hand, id, value) => {
    await page.evaluate(([hand, id, value]) => window.__xr.controllers[hand].updateButtonValue(id, value), [hand, id, value]);
    await frames();
    await wait(130);
  };
  const press = async (hand, id) => { await set(hand, id, 1); await set(hand, id, 0); };
  const axes = async (hand, x, y) => {
    await page.evaluate(([hand, x, y]) => window.__xr.controllers[hand].updateAxes('thumbstick', x, y), [hand, x, y]);
    await frames();
    await wait(180);
  };
  const neutral = async () => {
    await page.evaluate(() => {
      window.__xr.primaryInputMode = 'controller';
      for (const [hand, c] of Object.entries(window.__xr.controllers)) {
        c.connected = true;
        for (const id of ['trigger', 'squeeze', 'thumbstick', ...(hand === 'right' ? ['a-button', 'b-button'] : ['x-button', 'y-button'])]) c.updateButtonValue(id, 0);
        c.updateAxes('thumbstick', 0, 0);
      }
    });
    await frames();
    await wait(250);
  };
  const aim = async (label, hand = 'right', hands = false) => {
    const found = await page.evaluate(({ label, hand, hands }) => {
      const g = window.__citydriver, status = g.vrStatus, mesh = status.menu.mesh, rig = g.rendering.vrCamera.rig;
      const region = status.regions.find(r => status.entries[r.index].label === label);
      if (!region) return false;
      const V = g.vehicle.car.position.constructor, Q = g.vehicle.car.quaternion.constructor;
      mesh.updateWorldMatrix(true, false); rig.updateWorldMatrix(true, false);
      const target = new V((region.x + region.width / 2) / status.menu.width - .5,
        .5 - (region.y + region.height / 2) / status.menu.height, 0).applyMatrix4(mesh.matrixWorld);
      target.applyMatrix4(rig.matrixWorld.clone().invert()); target.y += 1.6;
      const from = new V(hand === 'right' ? .18 : -.18, 1.3, -.25);
      const q = new Q().setFromUnitVectors(new V(0, 0, -1), target.sub(from).normalize());
      const c = (hands ? window.__xr.hands : window.__xr.controllers)[hand];
      c.position.set(from.x, from.y, from.z); c.quaternion.set(q.x, q.y, q.z, q.w);
      return true;
    }, { label, hand, hands });
    if (!found) throw new Error(`No visible row: ${label}`);
    await wait(220);
  };
  const pick = async label => { await aim(label); await press('right', 'trigger'); await wait(200); };
  const pause = async () => { if (!(await get()).paused) await press('right', 'b-button'); };
  const resume = async () => {
    await neutral();
    if ((await get()).paused) await pick('Resume');
    await wait(250);
  };
  const stage = async (id = 'hatchback') => {
    await neutral();
    await page.evaluate(id => {
      const g = window.__citydriver;
      g.beginFree(); g.chooseCar(id); g.vehicle.reset(); g.input.clear();
      g.rendering.setView(2); g.rendering.snap(); g.traffic.setEnabled(false, g.vehicle);
    }, id);
    await frames();
    await wait(350);
  };
  const shot = async name => {
    await page.screenshot({ path: `${out}/${name}.png` });
    observations.push({ name, state: await get() });
  };
  const scenario = async (name, run) => {
    try { await run(); } catch (error) { check(`${name} completes`, false, error.stack); }
  };
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?seed=${seed}&ao=0&xr=stereo`);
  await page.waitForFunction(() => window.__citydriver && document.querySelector('#loading.loaded') && !window.__citydriver.changingJourney,
    null, { timeout: 120000 });
  await page.waitForFunction(() => !document.querySelector('#enter-vr').hidden);
  await page.click('#enter-vr'); await page.waitForFunction(() => window.__citydriver.vr.active); await wait(600);

  await scenario('Entry and stereo', async () => {
    let s = await get();
    check('entry holds title, car and clock', s.menu === 'title' && !s.started && Math.abs(s.speed) < .5);
    check('XR input takes over page input', await page.evaluate(() => window.__citydriver.input.xrActive));
    const info = await page.evaluate(() => {
      const g = window.__citydriver, xr = g.rendering.renderer.xr, eyes = xr.getCamera().cameras;
      return { renderer: g.rendering.renderer.getContext().getParameter(0x9246),
        eyes: eyes.map(c => ({ viewport: c.viewport.toArray(), matrix: c.matrixWorld.toArray() })),
        foveation: xr.getFoveation(), rate: g.vr.session.frameRate, rates: [...g.vr.session.supportedFrameRates],
        shadows: g.graphics.shadows, scalable: 'requestViewportScale' in XRView.prototype };
    });
    observations.push({ name: 'environment', info, browser: browser.version(), seed });
    check('stereo has two separate eye viewports', info.eyes.length === 2 && info.eyes[0].viewport[0] !== info.eyes[1].viewport[0], info.eyes.map(e => e.viewport));
    check('stereo eye poses have nonzero separation', info.eyes.length === 2 && Math.hypot(...[12, 13, 14].map(i => info.eyes[0].matrix[i] - info.eyes[1].matrix[i])) > .05);
    check('foveation stays off', info.foveation === 0);
    observations.push({ name: 'viewport-scale-api', available: info.scalable });
    await page.evaluate(() => window.__xr.controllers.right.quaternion.set(Math.sin(.6), 0, 0, Math.cos(.6)));
    await wait(180); await set('right', 'trigger', 1); check('trigger aimed at sky does not start', !(await get()).started); await set('right', 'trigger', 0);
    await shot('01-stereo-title');
    await pick('Free drive'); s = await get();
    check('trigger starts free drive and read-only HUD', s.started && !s.paused && s.hud && s.menu === null);
  });

  await scenario('Drive and walking', async () => {
    await stage(); await set('right', 'trigger', .55); await wait(350); let s = await get();
    check('analog right trigger accelerates', s.speed > .5 && s.input.forward > .45 && s.input.forward < .6, s.speed);
    await press('right', 'b-button'); s = await get(); check('B pauses with gas held', s.paused && s.active);
    const stopped = s; await wait(450); s = await get();
    check('pause freezes simulation and hides vignette', Math.hypot(s.s - stopped.s, s.u - stopped.u) < .001 && s.comfort === 0);
    await press('right', 'b-button'); s = await get(); check('B resumes with gas held', !s.paused && s.active);
    check('gas stays blocked until neutral', !s.input.forward);
    await set('right', 'trigger', 0); await set('right', 'trigger', 1);
    check('release and repull restores gas', (await get()).input.forward === 1);
    await set('right', 'trigger', 0); await stage(); await set('left', 'trigger', .5); await wait(350); s = await get();
    check('analog brake reverses from rest', s.speed < -.5 && s.input.brake > .4 && s.input.brake < .5, s.speed);
    await set('left', 'trigger', 0); await stage();
    for (const [hand, action] of [['left', 'handbrake'], ['right', 'boost']]) {
      await set(hand, 'squeeze', 1); check(`${hand} grip maps to ${action}`, (await get()).input[action]); await set(hand, 'squeeze', 0);
    }
    const before = await get(); await axes('left', -1, 0); s = await get();
    check('left stick steers without zoom', s.input.left === 1 && s.zoom === before.zoom); await axes('left', 0, 0);
    await axes('right', 1, 0); await wait(350); s = await get();
    check('right stick turns view without zoom', Math.abs(s.look - before.look) > .2 && s.zoom === before.zoom); await axes('right', 0, 0);
    await stage(); await press('right', 'a-button'); check('A changes view without exiting', (await get()).active && (await get()).view === 3);
    await press('right', 'thumbstick'); check('right stick click recenters and stays in VR', (await get()).active && !(await get()).paused);
    await press('left', 'x-button'); check('X recovers without reloading', (await get()).active && (await get()).speed < .5);
    await press('left', 'y-button'); s = await get(); check('Y gets out in free drive', s.walker && !s.paused && s.hud);
    await axes('left', 0, -.8); await set('right', 'squeeze', 1); s = await get();
    check('walking analog stick and sprint are mapped', s.input.moveY > .7 && s.input.sprint);
    await axes('left', 0, 0); await set('right', 'squeeze', 0);
    await page.waitForFunction(() => {
      const walker = window.__citydriver.vehicle.walker;
      return walker?.grounded && !walker.down;
    });
    // Observe the rise inside the page: a delayed automation round trip can
    // otherwise inspect the walker after a perfectly good jump has landed.
    const jump = await page.evaluate(() => new Promise(resolve => {
      const g = window.__citydriver, walker = g.vehicle.walker, start = walker.y;
      let peak = start, frame, timer;
      const finish = ok => {
        clearTimeout(timer); cancelAnimationFrame(frame);
        window.__xr.controllers.left.updateButtonValue('squeeze', 0);
        resolve({ ok, start, peak, grounded: walker.grounded, input: g.input.xr.state.jump });
      };
      const sample = () => {
        peak = Math.max(peak, walker.y);
        if (g.input.xr.state.jump && !walker.grounded && peak > start + .05) finish(true);
        else frame = requestAnimationFrame(sample);
      };
      window.__xr.controllers.left.updateButtonValue('squeeze', 1);
      timer = setTimeout(() => finish(false), 1500);
      frame = requestAnimationFrame(sample);
    }));
    check('left grip jumps on foot', jump.ok, jump); await wait(130);
    await shot('02-stereo-walking');
    await stage(); await page.keyboard.down('KeyW'); await wait(250);
    check('keyboard gas cannot move VR vehicle', Math.abs((await get()).speed) < .2); await page.keyboard.up('KeyW');
  });

  await scenario('Menus and settings', async () => {
    await stage(); await pause(); let s = await get(); check('fresh pause selects Resume', s.menu === 'pause' && s.selected === 'Resume');
    await pick('City map'); check('city map renders in headset', (await get()).menu === 'map');
    await shot('03-stereo-map'); await press('right', 'b-button');
    check('B returns to opener row', (await get()).selected === 'City map');
    await pick('Garage'); check('garage renders in headset', (await get()).menu === 'car-dialog');
    await pick('Next ›');
    check('garage pages through grouped choices', await page.evaluate(() => window.__citydriver.vrStatus.pageIndex > 0));
    await shot('04-stereo-garage'); await press('right', 'b-button');
    check('garage back restores pause selection', (await get()).menu === 'pause' && (await get()).selected === 'Garage');
    for (const [label, read] of [
      ['Comfort vignette', () => window.__citydriver.rendering.vrCamera.comfort.enabled],
      ['Sound', () => window.__citydriver.audio.enabled],
      ['Vibration', () => window.__citydriver.currentMenuModel().items.find(e => e.id === 'vibration').toggle],
      ['Tap to drift', () => window.__citydriver.vehicle.driftMode === 'tap'],
    ]) {
      const before = await page.evaluate(read); await pick(label); const after = await page.evaluate(read);
      check(`${label} toggle responds`, before !== after, { before, after }); await pick(label);
    }
    const before = await page.evaluate(() => window.__citydriver.rendering.cameraPreferences.inputs.controller.sensitivity);
    await pick('Stick look speed'); check('stick sensitivity changes', await page.evaluate(before => window.__citydriver.rendering.cameraPreferences.inputs.controller.sensitivity !== before, before));
    const rates = await page.evaluate(() => [...window.__citydriver.vr.session.supportedFrameRates]);
    await pick('Refresh rate'); check('chosen refresh rate is applied', await page.evaluate(rates => rates.includes(window.__citydriver.graphics.rateChoice) && window.__citydriver.vr.session.frameRate === window.__citydriver.graphics.rateChoice, rates));
    const mode = await page.evaluate(() => window.__citydriver.graphics.mode);
    await pick('Graphics'); check('graphics can change while paused', (await get()).menu === 'pause' && await page.evaluate(before => window.__citydriver.graphics.mode !== before, mode));
    await page.evaluate(() => window.__citydriver.graphics.setMode('basic'));
    await pick('Weather'); check('weather setting responds', await page.evaluate(() => window.__citydriver.weather.mode !== 'clear'));
    const mix = await page.evaluate(() => window.__citydriver.audio.preset);
    await pick('Sound mix'); check('sound mix responds', await page.evaluate(before => window.__citydriver.audio.preset !== before, mix));
    await pick('Recenter view'); check('menu recenter leaves VR active', (await get()).active);
    await shot('05-stereo-pause'); await resume();
  });

  await scenario('Visibility and tracking', async () => {
    await stage(); await set('right', 'trigger', 1);
    for (const state of ['visible-blurred', 'hidden']) {
      await page.evaluate(state => window.__xr.updateVisibilityState(state), state); await wait(350); let s = await get();
      check(`${state} pauses and blocks input`, s.paused && !s.visible && !s.input.forward);
      const at = s; await wait(350); s = await get(); check(`${state} keeps vehicle still`, Math.hypot(s.s - at.s, s.u - at.u) < .001);
      await page.evaluate(() => window.__xr.updateVisibilityState('visible')); await wait(350);
      check(`return from ${state} stays paused`, (await get()).paused);
      await resume(); await set('right', 'trigger', 1);
    }
    await set('right', 'trigger', 0); await pause(); await aim('Resume');
    // Hidden sessions may deliver no frames. Send both visibility events between
    // frames, preserving the sources instead of IWER's removal while blurred.
    await page.evaluate(() => {
      const session = window.__citydriver.vr.session;
      Object.defineProperty(session, 'visibilityState', { configurable: true, value: 'hidden' });
      session.dispatchEvent(new Event('visibilitychange'));
      window.__xr.controllers.right.updateButtonValue('trigger', 1);
      Object.defineProperty(session, 'visibilityState', { configurable: true, value: 'visible' });
      session.dispatchEvent(new Event('visibilitychange'));
    });
    await wait(300);
    check('held pointer trigger cannot activate after a frame-free interruption', (await get()).paused);
    await shot('06-visibility-return');
    await page.evaluate(() => { delete window.__citydriver.vr.session.visibilityState; });
    await set('right', 'trigger', 0); await pause();
    await page.evaluate(() => {
      const session = window.__citydriver.vr.session;
      Object.defineProperty(session, 'visibilityState', { configurable: true, value: 'hidden' }); session.dispatchEvent(new Event('visibilitychange'));
      window.__xr.controllers.right.updateButtonValue('b-button', 1);
      Object.defineProperty(session, 'visibilityState', { configurable: true, value: 'visible' }); session.dispatchEvent(new Event('visibilitychange'));
    });
    await wait(300);
    check('held B cannot resume after a frame-free interruption', (await get()).paused);
    await page.evaluate(() => { delete window.__citydriver.vr.session.visibilityState; });
    await set('right', 'b-button', 0); await stage();
    await page.evaluate(() => { window.__xr.controllers.left.connected = false; }); await wait(250);
    await set('right', 'trigger', 1); await axes('right', .8, 0); let s = await get();
    check('one right controller can steer and drive', s.sources === 1 && s.input.forward === 1 && s.input.right > .7);
    check('one right stick does not also look', s.input.lookX === 0);
    await neutral(); await page.evaluate(() => { window.__xr.primaryInputMode = 'hand'; }); await wait(300);
    check('switching to hands pauses', (await get()).paused && (await get()).sources === 0);
    await aim('City map', 'right', true); await page.evaluate(() => window.__xr.hands.right.updatePinchValue(1)); await wait(180);
    await page.evaluate(() => window.__xr.hands.right.updatePinchValue(0)); await wait(180);
    check('hand pinch opens map', (await get()).menu === 'map');
    await aim('Back', 'right', true); await page.evaluate(() => window.__xr.hands.right.updatePinchValue(1)); await wait(180);
    await page.evaluate(() => window.__xr.hands.right.updatePinchValue(0)); await wait(180);
    check('hand pinch closes map', (await get()).menu === 'pause');
    await aim('Resume', 'right', true); await page.evaluate(() => window.__xr.hands.right.updatePinchValue(1)); await wait(180);
    await page.evaluate(() => window.__xr.hands.right.updatePinchValue(0)); await wait(180);
    check('hand-only resume retains accessible menu', (await get()).paused && (await get()).menu === 'pause');
    await neutral(); await resume();
    await pause();
    const before = await page.evaluate(() => window.__citydriver.rendering.vrCamera.rig.quaternion.toArray());
    await page.evaluate(() => { window.__xr.quaternion.set(.2, .1, .1, Math.sqrt(.94)); }); await wait(250);
    check('tracked pitch and roll do not tilt rig', await page.evaluate(before => window.__citydriver.rendering.vrCamera.rig.quaternion.toArray().every((v, i) => Math.abs(v - before[i]) < 1e-5), before));
    await page.evaluate(() => window.__xr.quaternion.set(0, 0, 0, 1));
    const anchor = await page.evaluate(() => window.__citydriver.vrStatus.hudFrame.matrixWorld.toArray());
    await page.evaluate(() => { window.__xr.quaternion.set(0, .5, 0, Math.sqrt(.75)); }); await wait(250);
    check('HUD does not follow head turn', await page.evaluate(before => window.__citydriver.vrStatus.hudFrame.matrixWorld.toArray().every((v, i) => Math.abs(v - before[i]) < 1e-5), anchor));
    await page.evaluate(() => window.__xr.quaternion.set(0, 0, 0, 1));
    await pause(); const panel = await page.evaluate(() => window.__citydriver.vrStatus.menu.mesh.matrixWorld.toArray());
    await page.evaluate(() => { window.__xr.position.set(.5, 1.8, .3); window.__xr.quaternion.set(0, .4, 0, Math.sqrt(.84)); }); await wait(250);
    check('open menu stays put under head movement', await page.evaluate(before => window.__citydriver.vrStatus.menu.mesh.matrixWorld.toArray().every((v, i) => Math.abs(v - before[i]) < 1e-5), panel));
    const fog = await page.evaluate(() => {
      const r = window.__citydriver.rendering, required = r.scene.fog.far + r.vrCamera.head.distanceTo(r.scene.fog.origin);
      return { required, actual: r.vrCamera.camera.far, near: r.vrCamera.camera.near };
    });
    check('room-scale far plane covers fog sphere', fog.actual >= fog.required, fog);
    check('near plane preserves comfort mask and panels', fog.near <= .2);
    await page.evaluate(() => { window.__xr.position.set(0, 1.6, 0); window.__xr.quaternion.set(0, 0, 0, 1); });
    await resume();
  });

  await scenario('Flight and runs', async () => {
    for (const id of ['helicopter', 'plane']) {
      await stage(id); const before = await get(); await set('right', 'trigger', 1); await set('left', 'squeeze', 1); await wait(2200); let s = await get();
      if (s.y <= before.y + 1) {
        // FrameClock caps a slow frame at 0.1 s. At software-rendered stereo
        // rates, a few seconds of takeoff need much longer on the wall clock.
        await page.waitForFunction(y => window.__citydriver.vehicle.groundedPosition.y > y + 1, before.y,
          { timeout: process.env.SOFTWARE || process.platform !== 'win32' ? 60000 : 15000 }); s = await get();
      }
      check(`${id} takes off with gas and left grip`, s.pilot && s.y > before.y + 1 && s.input.climb === 1, { before: before.y, after: s.y });
      await set('left', 'squeeze', 0); await axes('right', 0, -1); check(`${id} right stick climbs`, (await get()).input.climb === 1);
      await axes('right', 0, 1); check(`${id} right stick descends`, (await get()).input.descend === 1); await axes('right', 0, 0);
      await set('right', 'squeeze', 1); check(`${id} right grip descends`, (await get()).input.descend === 1); await set('right', 'squeeze', 0);
      await page.evaluate(() => window.__citydriver.rendering.setView(3)); await wait(250);
      check(`${id} first-person rig stays level`, await page.evaluate(() => {
        const q = window.__citydriver.rendering.vrCamera.rig.quaternion;
        return Math.abs(q.x) + Math.abs(q.z) < 1e-8;
      }));
      await pause(); const stopped = await get(); await wait(350); s = await get();
      check(`${id} pauses in midair`, Math.abs(s.y - stopped.y) < .001 && s.active); await shot(`07-${id}`);
    }
    await stage(); await pause(); await pick('Demolition'); await wait(350); let s = await get();
    check('demolition can start without ending VR', s.active && s.mode === 'free' && s.demolition === 'standby', s);
    await set('right', 'trigger', 1); await wait(350);
    check('demolition driving on standby leaves clock waiting', (await get()).demolition === 'standby');
    await page.evaluate(() => window.__citydriver.demolition.smash(['bin'])); await wait(350); s = await get();
    check('a staged hit starts demolition run and HUD', s.mode === 'demolition' && s.hud && !s.paused);
    await set('right', 'trigger', 0); await pause();
    const disabled = await page.evaluate(() => window.__citydriver.vrStatus.entries.filter(e => e.disabled).map(e => e.label));
    observations.push({ name: 'demolition-disabled', disabled });
    await pick('End run'); check('demolition results remain in headset', (await get()).menu === 'demolition-results'); await shot('08-demolition-results');
    await pick('Free drive'); check('demolition results return to free drive', (await get()).mode === 'free' && !(await get()).paused);
  });

  await scenario('Weather and camera views', async () => {
    await stage();
    await page.evaluate(() => { const g = window.__citydriver; g.traffic.setEnabled(true, g.vehicle); });
    for (const mode of ['clear', 'overcast', 'rain', 'storm', 'snow', 'sunset', 'night']) {
      await page.evaluate(mode => window.__citydriver.weather.setMode(mode, { immediate: true }), mode);
      await wait(600);
      const sample = await page.evaluate(() => {
        const g = window.__citydriver, r = g.rendering, xr = r.renderer.xr.getCamera(), gl = r.renderer.getContext();
        return { id: g.weather.state.id, rain: g.weather.rainfall.points.visible, snow: g.weather.snowfall.points.visible,
          error: gl.getError(), eyes: xr.cameras.length, finite: xr.cameras.every(c => [...c.matrixWorld.elements, ...c.projectionMatrix.elements].every(Number.isFinite)),
          calls: r.renderer.info.render.calls, triangles: r.renderer.info.render.triangles, fps: g.graphics.fps, target: g.graphics.target,
          level: g.graphics.levelId, scale: g.graphics.xrScale };
      });
      check(`${mode} draws two finite eyes without WebGL errors`, sample.id === mode && sample.eyes === 2 && sample.finite && sample.error === 0, sample);
      if (mode === 'rain' || mode === 'storm') check(`${mode} precipitation is visible`, sample.rain);
      if (mode === 'snow') check('snow precipitation is visible', sample.snow);
      await shot(`10-weather-${mode}`);
    }
    for (const view of [0, 1, 2, 3]) {
      await page.evaluate(view => { const g = window.__citydriver; g.rendering.setView(view); g.rendering.snap(); }, view); await wait(250);
      const sample = await page.evaluate(() => {
        const r = window.__citydriver.rendering, q = r.vrCamera.rig.quaternion;
        return { view: r.viewIndex, finite: [...r.vrCamera.rig.matrixWorld.elements].every(Number.isFinite), upright: Math.abs(q.x) + Math.abs(q.z) < 1e-8,
          near: r.vrCamera.camera.near, far: r.vrCamera.camera.far };
      });
      check(`camera view ${view} keeps a finite upright rig`, sample.view === view && sample.finite && sample.upright && sample.near >= .1 && sample.far > sample.near, sample);
      await shot(`11-view-${view}`);
    }
    await page.evaluate(() => { const g = window.__citydriver; g.weather.setMode('clear', { immediate: true }); g.traffic.setEnabled(false, g.vehicle); });
  });

  await scenario('Exit and reentry', async () => {
    await stage(); await pause(); const saved = await page.evaluate(() => ({ profiles: window.__citydriver.rendering.cameraPreferences.profiles,
      mode: window.__citydriver.graphics.mode }));
    for (let i = 0; i < 3; i++) {
      if (i === 0) await pick('Exit VR'); else await page.evaluate(() => window.__citydriver.vr.session.end());
      await wait(350); let s = await get();
      check(`exit ${i + 1} restores paused page`, !s.active && s.paused && !s.menu && !s.hud);
      check(`exit ${i + 1} restores screen camera`, s.view === saved.profiles.driving.view && s.zoom === saved.profiles.driving.zoom);
      check(`exit ${i + 1} restores graphics controller`, await page.evaluate(() => !window.__citydriver.graphics.headset && window.__citydriver.graphics.xrScale === 1));
      await page.click('#enter-vr-pause'); await page.waitForFunction(() => window.__citydriver.vr.active); await wait(350);
      s = await get(); check(`reentry ${i + 1} opens paused menu`, s.active && s.paused && s.menu === 'pause');
    }
    await shot('09-reentered');
    await pick('Exit VR');
    check('XR input relinquishes control on exit', await page.evaluate(() => !window.__citydriver.input.xrActive));
    const programs = await page.evaluate(() => window.__citydriver.rendering.renderer.info.memory);
    observations.push({ name: 'resources-after-reentry', programs });
  });
  check('no browser errors', errors.length === 0, errors);
} catch (error) { errors.push(error.stack); }
finally {
  await browser?.close(); await server.close();
  await writeFile(`${out}/results.json`, JSON.stringify({ seed, software: Boolean(process.env.SOFTWARE), checks, errors, observations }, null, 2));
  console.log(`${checks.filter(c => c.ok).length}/${checks.length} passed. ${errors.length} browser errors.`);
  if (errors.length || checks.some(c => !c.ok)) process.exitCode = 1;
}
