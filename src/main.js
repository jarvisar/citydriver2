import './style.css';
import './journey.css';
import './ui.css';
import './layout.css';
import './car.css';
import './menu.css';
import './audio/mixer.css';
import './pause.css';
import './city-ui.css';
import './taxi.css';
import './taxi-fleet.css';
import './city-theme.css';
import { setupTaxiFleet } from './taxi-fleet-view.js';
import { createRendering } from './rendering.js';
import { Graphics } from './graphics.js';
import { JOURNEYS } from './journeys.js';
import { CARS, CAR_IDS, DEFAULT_CAR, ROUTE_PAINT, carEntry, carMeters } from './cars.js';
import { carArt } from './car-art.js';
import { PAINTS, DEFAULT_PAINT, DEFAULT_PAINT_NAME, paintName, readPaint } from './car-paint.js';
import { SEED } from './world/route.js';
import { resolveWorldSeed } from './world/generation.js';
import { CityWeather } from './world/city-weather.js';
import { NightLighting } from './night-lighting.js';
import { cityCell, cityDistrict, nearestLanePose, journeyStart, lanePose, roadAt } from './world/city-route.js';
import { CITY } from './world/city.js';
import { navGraph } from './world/nav-graph.js';
import { CityGuide } from './city-guide.js';
import { WorldMap, DISTRICT_COLORS } from './city-world-map.js';
import { TaxiRun } from './taxi-run.js';
import { taxiLicense } from './taxi-license.js';
import { goalProgress } from './taxi-goals.js';
import { TaxiView } from './taxi-view.js';
import { setResidentWindow } from './world/resident.js';
import { DrivingController } from './vehicle.js';
import { CityTraffic as Traffic } from './city-traffic.js';
import { TRAFFIC_CRUISE_SPEED } from './traffic.js';
import { collideScenery } from './collision.js';
import { PedestrianContacts } from './world/pedestrian-reactions.js';
import { CityAutodrive as Autodrive } from './city-autodrive.js';
import { Input } from './input.js';
import { touchDrivingInput, thirdPersonDrivingInput } from './touch-stick.js';
import { DriveAudio } from './audio.js';
import { setupAudioMixer } from './audio/mixer.js';
import { FrameClock } from './timing.js';
import { setupControlHelp, controlHelpDismissed, updateControlHelp } from './control-help.js';
import { BrowserVR } from './vr.js';
import { VRStatus } from './vr-status.js';
import { setupPwaFullscreen } from './pwa-fullscreen.js';
import { moveMenuFocus, confirmMenuFocus, scrollMenu } from './menu-focus.js';

setupControlHelp();
setupPwaFullscreen();

const $ = selector => document.querySelector(selector);
const MENU_MOVES = ['menuNext', 'menuPrevious', 'menuUp', 'menuDown'];
const MENU_CRUISE_SPEED = TRAFFIC_CRUISE_SPEED * 1.4;
const mileageFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
let paused = false, started = false, time = 0, hudTime = 0, gameMode = 'taxi';
document.body.dataset.mode = gameMode;
const frameClock = new FrameClock();
let toastTimer; let sceneReady = false;
// The chosen car and scene outlive the visit; positions and mileage do not.
const carStorageKey = 'citydriver-car';
const journeyStorageKey = 'citydriver-journey';
let carId = DEFAULT_CAR;
try { const saved = localStorage.getItem(carStorageKey); if (saved && CARS[saved]) carId = saved; } catch { /* Storage is optional. */ }
// One colour dresses the whole garage and follows the player from car to car.
// It lasts the visit and is not stored: the fleet's own finishes are the thing
// worth keeping, and Default hands them straight back.
let paint = null;
const toast = (message, tone = '') => {
  const element = $('#toast');
  // Taxi feedback shares the instruction slot, keeping notifications off the road.
  const parent = gameMode === 'taxi' && started && !paused ? $('.taxi-task-copy') : $('#app');
  if (element.parentElement !== parent) parent.append(element);
  // Taxi arrivals take their rating's colour: Speedy green, Normal yellow, Slow red.
  element.textContent = message; element.dataset.tone = tone; element.classList.add('show'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 2200);
};

async function boot() {
  try {
    // `?ao=0` still forces the soft shading off, whatever the quality level is.
    const graphics = new Graphics({ ambientOcclusion: new URLSearchParams(window.location.search).get('ao') === '0' ? false : null });
    // How much of the route stays built is a quality setting too, so it has to
    // be in place before the first world is streamed.
    setResidentWindow(graphics.settings.chunks);
    // The stylesheet leaves costly HUD effects out of the lighter levels.
    document.documentElement.dataset.graphics = graphics.levelId;
    graphics.onChange(settings => { setResidentWindow(settings.chunks); document.documentElement.dataset.graphics = settings.id; });
    const rendering = createRendering($('#scene'), graphics, { showCarSilhouette: () => started,
      beforeDraw: camera => taxiView.navigation.update(taxi, vehicle, camera) });
    const { renderer, scene } = rendering;
    let vr;
    const vrStatus = new VRStatus(rendering.vrCamera.camera);
    const hidden = () => vr?.active ? !vr.visible : document.hidden;
    const fpsCounter = $('#fps-counter');
    let fpsStart = null, fpsFrames = 0;
    function updateFPS(timestamp, rendered) {
      if (fpsCounter.hidden) return;
      if (paused || document.hidden || changingJourney) {
        fpsCounter.textContent = 'FPS: paused'; fpsStart = null; fpsFrames = 0; return;
      }
      if (fpsStart === null) { fpsStart = timestamp; fpsFrames = 0; return; }
      if (rendered) fpsFrames++;
      const elapsed = timestamp - fpsStart;
      if (elapsed >= 500) {
        fpsCounter.textContent = `${Math.round(fpsFrames * 1000 / elapsed)} FPS`;
        fpsStart = timestamp; fpsFrames = 0;
      }
    }
    let needsRender = true;
    window.addEventListener('resize', () => { needsRender = true; });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) needsRender = true; });
    let journey = 'city';
    try { const saved = localStorage.getItem(journeyStorageKey); if (saved && Object.hasOwn(JOURNEYS, saved)) journey = saved; } catch { /* Storage is optional. */ }
    let world = new JOURNEYS[journey].World(scene);
    // (whichever world is current: a route change replaces it)
    rendering.addCuller((camera, shadow) => world.cull?.(camera, shadow));
    const weather = new CityWeather(scene);
    try { weather.setMode(localStorage.getItem('citydriver-weather') ?? 'auto', { immediate: true }); } catch { /* Storage is optional. */ }
    let changingJourney = true, journeyWasPaused = false;
    const savedJourneys = Object.fromEntries(Object.keys(JOURNEYS).map(id => [id, journeyStart()]));
    // The menu cruises in a cab; starting either mode applies its own saved car.
    const vehicle = new DrivingController(JOURNEYS[journey].route, savedJourneys[journey], 'taxi'); const audio = new DriveAudio();
    const refreshAudioMixer = setupAudioMixer(audio);
    // Free driving starts on for now, while off-road collision is being tried
    // out. The hidden code only changes the paint.
    vehicle.toggleFreeDriving();
    vehicle.setAppearance(journey);
    vehicle.setLights(weather.state.lightLevel);
    rendering.setJourney(journey); audio.setJourney(journey);
    const journeyDialog = $('#journey-dialog'), carDialog = $('#car-dialog'), pauseOverlay = $('#pause-overlay');
    const fleetDialog = $('#taxi-fleet-dialog'), worldMapDialog = $('#world-map-dialog');
    const openChooser = () => [journeyDialog, carDialog, fleetDialog, worldMapDialog].find(dialog => dialog.open) ?? null;
    // The pause screen is a menu too: it is up whenever the drive is paused
    // with no chooser over it, and the controller walks it the same way.
    const openPauseMenu = () => !$('#taxi-results').hidden ? $('#taxi-results') : paused && !pauseOverlay.hidden ? pauseOverlay : null;
    // The title screen is a menu of its own until a drive begins.
    const openWelcomeMenu = () => !started && !paused && !$('#welcome').classList.contains('hidden') ? $('#welcome') : null;
    scene.add(vehicle.car);
    const traffic = new Traffic(scene, vehicle.route, vehicle.s, journey, vehicle.u);
    const pedestrianContacts = new PedestrianContacts();
    const nightLighting = new NightLighting(scene);
    const drawScene = rendering.render;
    rendering.render = (...args) => {
      nightLighting.update(world, vehicle, traffic, weather.state.lightLevel);
      return drawScene(...args);
    };
    const cityGuide = new CityGuide(toast, () => vehicle);
    let taxiStorage; try { taxiStorage = localStorage; } catch { /* Optional storage. */ }
    const taxi = new TaxiRun(taxiStorage), taxiView = new TaxiView(scene); cityGuide.taxi = taxi;
    const fleetView = setupTaxiFleet(taxi.fleet, { running: () => taxi.running, career: taxi.career, onChange: () => { needsRender = true; },
      // A livery is only paint, so unlike a cab it can change mid-run.
      onLivery: color => { if (started && gameMode === 'taxi') { vehicle.setPaint(color); vehicle.render(0, world.origin); rendering.update(vehicle.car, 0, world.origin); } } });
    // The pause screen lists the shift's goals with live progress.
    function renderGoals() {
      const goals = gameMode === 'taxi' && taxi.status !== 'idle' ? taxi.goals : [], stats = taxi.stats;
      $('#shift-goals').innerHTML = goals.map(goal => {
        const progress = goal.done ? goal.target : goalProgress(goal, stats);
        return `<li data-done="${goal.done}"><span class="goal-check" aria-hidden="true">${goal.done ? '✓' : '○'}</span><span class="goal-copy"><strong>${goal.text}</strong><small>${goal.done ? `+$${goal.bonus} banked` : `${progress} / ${goal.target} · $${goal.bonus}`}</small></span></li>`;
      }).join('');
      $('#goals-summary').textContent = goals.length ? `${goals.filter(goal => goal.done).length} of ${goals.length} · Bonuses bank to your fleet` : '';
    }
    let fleetReturnFocus;
    function openFleet() {
      if (changingJourney || openChooser()) return;
      fleetReturnFocus = document.activeElement;
      journeyWasPaused = paused; setPaused(true); pauseOverlay.hidden = true;
      fleetView.render(); $('#fleet-feedback').textContent = ''; fleetDialog.showModal();
      fleetDialog.querySelector(`[data-fleet-car="${taxi.fleet.selected}"]`).focus();
    }
    document.querySelectorAll('[data-open-fleet]').forEach(button => button.addEventListener('click', openFleet));
    // The whole city, from the pause screen: built the first time it opens,
    // drawn again whenever it opens or the window changes size
    let worldMap = null;
    const worldMapCanvas = $('#world-map');
    const hereText = () => `You are in ${cityDistrict(vehicle.s, vehicle.u)}`;
    function drawWorldMap() {
      if (!worldMapDialog.open) return;
      // as wide as the dialog, or as the window's height leaves room for
      const room = Math.max(220, window.innerHeight - 250);
      worldMapCanvas.style.width = `${Math.floor(Math.min(worldMapCanvas.parentElement.clientWidth, room * worldMap.aspect))}px`;
      worldMap.draw(worldMapCanvas, vehicle);
    }
    function openWorldMap() {
      if (changingJourney || openChooser()) return;
      journeyWasPaused = paused; setPaused(true); pauseOverlay.hidden = true;
      if (!worldMap) {
        worldMap = new WorldMap(CITY, cityGuide.mapCache);
        // The legend: each district this city has, and its share of the blocks
        const blocks = new Map();
        for (const label of worldMap.labels) blocks.set(label.style, (blocks.get(label.style) ?? 0) + label.blocks);
        const total = [...blocks.values()].reduce((sum, n) => sum + n, 0);
        $('#world-map-legend').innerHTML = Object.keys(DISTRICT_COLORS).filter(style => blocks.has(style)).map(style =>
          `<li><span class="world-map-swatch" style="--district-color:${DISTRICT_COLORS[style]}"></span>${style}<small>${Math.round(blocks.get(style) / total * 100)}%</small></li>`).join('');
      }
      worldMapCanvas.style.aspectRatio = String(worldMap.aspect);
      $('#world-map-status').textContent = hereText();
      worldMapDialog.showModal();
      drawWorldMap();
      $('#close-world-map').focus();
    }
    $('#open-world-map').addEventListener('click', openWorldMap);
    // and from the street map on screen, its button or the map itself
    $('#city-map-open').addEventListener('click', openWorldMap);
    $('#city-map').addEventListener('click', openWorldMap);
    $('#close-world-map').addEventListener('click', () => worldMapDialog.close());
    window.addEventListener('resize', drawWorldMap);
    worldMapCanvas.addEventListener('pointermove', event => {
      const box = worldMapCanvas.getBoundingClientRect();
      const name = worldMap?.districtAt(event.clientX - box.left, event.clientY - box.top, box.width);
      $('#world-map-status').textContent = name ?? hereText();
    });
    worldMapCanvas.addEventListener('pointerleave', () => { $('#world-map-status').textContent = hereText(); });
    $('#close-fleet').addEventListener('click', () => fleetDialog.close());
    const soundScene = { player: vehicle, traffic, interior: false, heading: 0 };
    const autodrive = new Autodrive();
    const touchControls = $('.touch-controls');
    let touchControlsTimer;
    function revealTouchControls() {
      clearTimeout(touchControlsTimer);
      touchControls.classList.remove('autodrive-hidden');
      touchControls.inert = false;
      if (autodrive.enabled) touchControlsTimer = setTimeout(() => {
        touchControls.classList.add('autodrive-hidden');
        touchControls.inert = true;
      }, 3000);
    }
    // Capture taps even when a menu or the joystick handles the event itself.
    window.addEventListener('pointerdown', () => {
      if (autodrive.enabled) revealTouchControls();
    }, { capture: true, passive: true });
    $('#autodrive').addEventListener('click', () => action('autodrive'));
    const trafficStorageKey = 'citydriver-traffic';
    try { traffic.setEnabled(localStorage.getItem(trafficStorageKey) !== 'false', vehicle); } catch { /* Storage is optional. */ }
    primeMenuDrive();
    $('#traffic').setAttribute('aria-pressed', String(traffic.enabled));
    $('#traffic').addEventListener('click', () => {
      traffic.setEnabled(!traffic.enabled, vehicle);
      traffic.render(1, world.origin);
      $('#traffic').setAttribute('aria-pressed', String(traffic.enabled));
      try { localStorage.setItem(trafficStorageKey, String(traffic.enabled)); } catch { /* Keep the setting for this visit. */ }
      needsRender = true;
    });
    function primeMenuDrive() {
      if (started) return;
      // Reveal the menu already cruising, at a speed that respects traffic.
      vehicle.speed = MENU_CRUISE_SPEED;
      const state = autodrive.update(vehicle, traffic, MENU_CRUISE_SPEED, 0);
      vehicle.speed = state.touchDrive.amount * vehicle.stats.topSpeed;
      vehicle.update(0, state);
    }
    let freeTraffic;
    function modeUi() {
      document.body.dataset.mode = gameMode;
      for (const id of ['change-car', 'autodrive', 'traffic']) $(`#${id}`).disabled = gameMode === 'taxi';
      $('#change-car').hidden = gameMode === 'taxi';
      $('#pause-fleet').hidden = gameMode !== 'taxi';
      $('#restart-run').hidden = gameMode !== 'taxi';
      $('#goals-panel').hidden = gameMode !== 'taxi';
      $('#switch-mode span').textContent = gameMode === 'taxi' ? 'Free drive' : 'Taxi run';
      $('#reset').title = gameMode === 'taxi' ? 'Reset car: −5 seconds (R)' : 'Reset city (R)';
      $('#reset').setAttribute('aria-label', $('#reset').title);
      updateCarUi();
    }
    function recoverTaxi(penalty = false) {
      const pose = nearestLanePose(vehicle.s, vehicle.u, vehicle.heading);
      vehicle.s = pose.s; vehicle.u = pose.u; vehicle.heading = pose.heading;
      vehicle.speed = 0; vehicle.knock.x = vehicle.knock.z = vehicle.knock.spin = 0; vehicle.update(0, {});
      if (penalty) { taxi.timeLeft = Math.max(0, taxi.timeLeft - 5); toast('Reset −5s'); }
      taxi.hold = 0;
      world.update(vehicle.s, vehicle.u); vehicle.render(0, world.origin); rendering.snap(); needsRender = true;
    }
    function beginTaxi() {
      if (changingJourney) return;
      if (freeTraffic === undefined || gameMode === 'free') freeTraffic = traffic.enabled;
      started = true; gameMode = 'taxi'; autodrive.reset(); vehicle.arcade = true;
      vehicle.setCar(taxi.fleet.selected, { paint: taxi.fleet.liveryColor }); recoverTaxi(); traffic.setEnabled(true, vehicle);
      $('#traffic').setAttribute('aria-pressed', 'true'); $('#autodrive').setAttribute('aria-pressed', 'false');
      taxi.start(vehicle); taxiView.reset(); renderGoals(); $('#taxi-results').hidden = true; $('#welcome').classList.add('hidden');
      rendering.setView(4); updateViewUi(); setPaused(false); modeUi(); updateHud();
      taxiView.render(taxi, vehicle, world.origin, time); rendering.update(vehicle.car, 1, world.origin);
    }
    function beginFree({ preserveInput = false } = {}) {
      if (changingJourney) return;
      const wasTaxi = taxi.status !== 'idle'; taxi.stop(); started = true; gameMode = 'free';
      autodrive.reset(); vehicle.arcade = false; vehicle.setCar(carId, { paint }); vehicle.speed = 0; vehicle.update(0, {});
      if (wasTaxi && freeTraffic !== undefined) traffic.setEnabled(freeTraffic, vehicle);
      $('#traffic').setAttribute('aria-pressed', String(traffic.enabled)); $('#autodrive').setAttribute('aria-pressed', 'false');
      $('#taxi-results').hidden = true; $('#welcome').classList.add('hidden');
      rendering.setView(4); updateViewUi();
      taxiView.render(taxi, vehicle, world.origin, time); setPaused(false, { preserveInput }); modeUi(); updateHud();
    }
    function start() {
      if (paused || changingJourney) return;
      if (!started) {
        if (gameMode === 'taxi') beginTaxi(); else beginFree();
      }
    }
    function setPaused(value, { preserveInput = false } = {}) {
      paused = value; if (!preserveInput) input.clear(); frameClock.suspend();
      if (!paused && autodrive.enabled) start();
      if (paused) { clearTimeout(toastTimer); $('#toast').classList.remove('show'); }
      audio.setPaused(paused);
      pauseOverlay.hidden = !paused; $('#pause').setAttribute('aria-pressed', String(paused)); $('#pause').setAttribute('aria-label', paused ? 'Resume' : 'Pause');
      $('#pause .control-label').textContent = paused ? 'resume' : 'pause';
      if (paused) { renderGoals(); $('#resume').focus(); } else $('#pause').blur();
    }
    function updateJourneyUi() {
      const data = JOURNEYS[journey];
      document.body.dataset.journey = journey;
      $('.location-title').textContent = data.label;
      $('.location svg text').textContent = data.routeNumber;
      $('#menu-route').textContent = 'TAXI';
      $('#scene').setAttribute('aria-label', data.canvas);
      document.querySelector('meta[name="theme-color"]').content = '#263b47';
      document.querySelectorAll('button[data-journey]').forEach(button => button.setAttribute('aria-current', String(button.dataset.journey === journey)));
    }
    function buildCarCards() {
      const current = '<span class="chooser-current">CURRENT CAR</span>';
      $('.car-options').innerHTML = CAR_IDS.map(id => {
        const entry = CARS[id];
        // The plain row stands for whichever car the road brings: no portrait
        // and no meters, so it sits above the fleet as a single line.
        if (entry.plain) return `<button type="button" class="chooser-card car-card car-card-plain" data-car="${id}" aria-current="false">`
          + `<span class="chooser-card-title">${entry.name}</span>${current}</button>`;
        const meters = carMeters(id).map(({ label, level }) =>
          `<span class="car-meter"><span>${label}</span><span class="car-meter-track"><span style="width:${level}%"></span></span></span>`).join('');
        // The portrait is drawn in whatever the garage is wearing, so the grid
        // doubles as the preview: one colour repaints the whole fleet at once.
        return `<button type="button" class="chooser-card car-card" data-car="${id}" aria-label="${entry.name}" aria-current="false" style="--car-paint:${cardPaint(id)}">`
          + carArt(id)
          + `<span class="chooser-card-copy"><span class="chooser-card-title">${entry.name}</span>`
          + `<span class="car-meters">${meters}</span>${current}</span></button>`;
      }).join('');
      for (const button of carDialog.querySelectorAll('[data-car]')) button.addEventListener('click', () => chooseCar(button.dataset.car));
    }
    const paintSwatches = $('#paint-swatches'), paintWell = $('#paint-custom-well'), paintInput = $('#paint-custom');
    function buildPaintSwatches() {
      paintSwatches.innerHTML = [`<button type="button" class="paint-swatch paint-default" role="radio" aria-checked="false" data-paint="${DEFAULT_PAINT}" aria-label="${DEFAULT_PAINT_NAME}" title="${DEFAULT_PAINT_NAME}"><span class="paint-chip" aria-hidden="true"></span></button>`,
        ...PAINTS.map(({ name, color }) => `<button type="button" class="paint-swatch" role="radio" aria-checked="false" data-paint="${color}" style="--swatch:${color}" aria-label="${name}" title="${name}"><span class="paint-chip" aria-hidden="true"></span></button>`)].join('');
      for (const swatch of paintSwatches.querySelectorAll('[data-paint]')) {
        swatch.addEventListener('click', () => applyPaint(swatch.dataset.paint));
        // A row of bare colours says nothing on its own, so the one under the
        // pointer or the keyboard focus names itself beside the heading.
        for (const event of ['pointerenter', 'focus']) swatch.addEventListener(event, () => { $('#paint-current').textContent = swatch.getAttribute('aria-label'); });
        for (const event of ['pointerleave', 'blur']) swatch.addEventListener(event, showPaintName);
      }
      paintInput.addEventListener('input', () => applyPaint(paintInput.value));
    }
    // With no garage colour set, every car shows the finish it arrived in. The
    // default car has none of its own, so it shows whatever the road it is on
    // would give it.
    const ownPaint = id => (carEntry(id).plain ? ROUTE_PAINT[journey] ?? ROUTE_PAINT.coast : carEntry(id).paint);
    const cardPaint = id => paint ?? ownPaint(id);
    const paintCards = () => { for (const card of carDialog.querySelectorAll('[data-car]')) card.style.setProperty('--car-paint', cardPaint(card.dataset.car)); };
    function showPaintName() {
      $('#paint-current').textContent = paint ? paintName(paint) ?? paint.toUpperCase() : DEFAULT_PAINT_NAME;
    }
    function updatePaintUi() {
      for (const swatch of paintSwatches.querySelectorAll('[data-paint]')) {
        const value = swatch.dataset.paint;
        swatch.setAttribute('aria-checked', String(value === DEFAULT_PAINT ? !paint : value === paint));
      }
      paintWell.dataset.active = String(Boolean(paint) && !PAINTS.some(swatch => swatch.color === paint));
      paintWell.style.setProperty('--swatch', paint ?? ownPaint(carId));
      paintInput.value = paint ?? ownPaint(carId);
      showPaintName();
    }
    // Repainting needs no new scenery either: the colour lands on the car where
    // it stands and on every card at once, and the drive carries on. Default
    // clears it, and the fleet goes back to its own finishes.
    function applyPaint(value) {
      const color = value === DEFAULT_PAINT ? null : readPaint(value);
      if (value !== DEFAULT_PAINT && !color) return;
      paint = color;
      if (started) vehicle.setPaint(paint);
      paintCards(); updatePaintUi();
      vehicle.render(0, world.origin); rendering.update(vehicle.car, 0, world.origin); needsRender = true;
    }
    function updateCarUi() {
      for (const button of carDialog.querySelectorAll('[data-car]')) button.setAttribute('aria-current', String(button.dataset.car === carId));
      $('#current-car').textContent = started && gameMode === 'taxi' ? carEntry(vehicle.carId).name : carEntry(carId).name;
      $('#change-car').setAttribute('aria-label', started && gameMode === 'taxi' ? 'Garage: free drive only' : `Garage: ${carEntry(carId).name}`);
      updatePaintUi();
    }
    // Swapping cars needs no new scenery, so the drive simply carries on.
    function chooseCar(id) {
      if (started && gameMode === 'taxi') return;
      carDialog.close();
      if (id === carId || !CARS[id]) return;
      carId = id;
      try { localStorage.setItem(carStorageKey, id); } catch { /* Still drive it for this visit. */ }
      if (started) { vehicle.setCar(id, { paint }); vehicle.render(0, world.origin); }
      autodrive.reset();
      rendering.update(vehicle.car, 0, world.origin);
      updateCarUi(); updateHud(); needsRender = true;
      toast(`${carEntry(id).name} selected`);
    }
    function openCars() {
      if (started && gameMode === 'taxi') { openFleet(); return; }
      if (changingJourney || openChooser()) return;
      journeyWasPaused = paused; setPaused(true); pauseOverlay.hidden = true;
      carDialog.showModal();
      carDialog.querySelector(`[data-car="${carId}"]`).focus();
    }
    function openJourneys() {
      if (changingJourney || openChooser()) return;
      journeyWasPaused = paused; setPaused(true); pauseOverlay.hidden = true;
      journeyDialog.showModal();
      journeyDialog.querySelector(`[data-journey="${journey}"]`).focus();
    }
    async function changeJourney(id, { regenerate = false } = {}) {
      if (changingJourney || !JOURNEYS[id]) return;
      if (id === journey && !regenerate) { journeyDialog.close(); return; }
      if (!openChooser()) journeyWasPaused = paused;
      changingJourney = true; paused = true; input.clear(); frameClock.suspend();
      // Building and compiling the next route says nothing about how it runs,
      // and the new route may afford a level the last one could not.
      graphics.relax();
      audio.setPaused(true);
      $('#journey-transition').classList.add('active'); journeyDialog.close(); carDialog.close();
      pauseOverlay.hidden = true;
      savedJourneys[journey] = { s: vehicle.s, u: vehicle.u, heading: vehicle.heading, distance: vehicle.distance };
      const nextState = regenerate ? journeyStart() : savedJourneys[id];
      let nextWorld;
      try {
        await new Promise(resolve => setTimeout(resolve, 320));
        nextWorld = new JOURNEYS[id].World(scene);
        nextWorld.update(nextState.s, 2.4);
        while (nextWorld.pending.length) nextWorld.update(nextState.s, 2.4);
        await rendering.precompile([...nextWorld.warmupObjects(), ...taxiView.warmupObjects()]);
        world.dispose(); world = nextWorld; journey = id;
        savedJourneys[id] = nextState;
        if (regenerate) { time = 0; hudTime = 0; vehicle.wheelSpin = 0; }
        vehicle.setRoute(JOURNEYS[id].route, nextState);
        autodrive.reset();
        vehicle.setAppearance(id);
        vehicle.setLights(weather.state.lightLevel);
        traffic.reset(vehicle.route, vehicle.s, id); traffic.render(1, world.origin);
        primeMenuDrive();
        rendering.setJourney(id); audio.setJourney(id); updateJourneyUi(); paintCards(); updatePaintUi();
        vehicle.render(0, world.origin);
        rendering.snap(); rendering.update(vehicle.car, 1, world.origin); world.animate(time, traffic.time);
        weather.update(time, vehicle, world.origin); rendering.setWeather(weather.state, 0);
        world.setWetness(weather.state.wetness); vehicle.setLights(weather.state.lightLevel); traffic.models.setLights(weather.state.lightLevel);
        updateHud();
        if (renderer.xr.isPresenting) needsRender = true;
        else rendering.render();
        try { localStorage.setItem(journeyStorageKey, id); } catch { /* Still drive it for this visit. */ }
        toast(regenerate ? 'City reset' : `${JOURNEYS[id].title} selected`);
      } catch (error) {
        if (nextWorld && nextWorld !== world) nextWorld.dispose();
        console.error('Could not change journey:', error); toast('Loading failed');
      } finally {
        input.clear(); frameClock.reset(); changingJourney = false;
        setPaused(journeyWasPaused || hidden());
        $('#journey-transition').classList.remove('active');
      }
    }
    async function action(name, routeNumber) {
      if (name === 'exitVR') { if (vr?.active) await vr.toggle(); return; }
      if (name === 'recenterVR') { rendering.vrCamera.recenter(); return; }
      if (vr?.active && name.startsWith('vrMenu')) {
        if (name === 'vrMenuConfirm') vrStatus.activate();
        else vrStatus.move(name === 'vrMenuNext' ? 1 : -1);
        return;
      }
      if (name === 'fps') {
        fpsCounter.hidden = !fpsCounter.hidden;
        fpsCounter.textContent = 'FPS: …'; fpsStart = null; fpsFrames = 0;
        return;
      }
      if (name === 'fullscreen') { await toggleFullscreen(); return; }
      if (changingJourney) return;
      if (name === 'selectJourney') {
        const id = Object.keys(JOURNEYS).find(id => JOURNEYS[id].routeNumber === routeNumber);
        await changeJourney(id);
        return;
      }
      const chooser = openChooser();
      if (chooser) {
        if (name === 'menuClose' || (vr?.active && name === 'pause') || (name === 'car' && (chooser === carDialog || chooser === fleetDialog)) || (name === 'map' && chooser === worldMapDialog)) chooser.close();
        if (MENU_MOVES.includes(name)) moveMenuFocus(chooser, name);
        if (name === 'menuConfirm') confirmMenuFocus(chooser);
        return;
      }
      // The pause screen is not modal, so it takes the menu actions and leaves
      // the drive's own shortcuts — the garage, the routes, the next scene — to
      // the handling below. B closes it the way it closes a chooser.
      const pauseMenu = openPauseMenu();
      if (pauseMenu && name.startsWith('menu')) {
        if (name === 'menuClose') { if (taxi.status !== 'over') setPaused(false); }
        else if (name !== 'menuConfirm') moveMenuFocus(pauseMenu, name);
        else confirmMenuFocus(pauseMenu, pauseMenu === pauseOverlay ? $('#resume') : $('#taxi-retry'));
        return;
      }
      const welcomeMenu = openWelcomeMenu();
      if (welcomeMenu && name.startsWith('menu')) {
        if (name === 'menuConfirm') confirmMenuFocus(welcomeMenu, $('#start'));
        else if (name !== 'menuClose') moveMenuFocus(welcomeMenu, name);
        return;
      }
      // M or View / Share: the city map, from the drive or the pause screen
      if (name === 'map') { if ((started || paused) && taxi.status !== 'over') openWorldMap(); return; }
      if (name === 'nextJourney') return;
      if (taxi.status === 'over') { if (name === 'reset') beginTaxi(); return; }
      if (name === 'car') { openCars(); return; }
      if (name === 'autodrive') {
        if (started && gameMode === 'taxi') { toast('Autodrive: free drive only'); return; }
        if (!autodrive.enabled && !autodrive.canStart(vehicle)) { toast('Autodrive requires a street'); return; }
        const enabled = autodrive.toggle();
        revealTouchControls();
        // D-pad Up also begins the hidden code, so this shortcut must keep its progress.
        if (enabled) input.clear({ preserveKonami: true });
        $('#autodrive').setAttribute('aria-pressed', String(enabled));
        if (enabled) start();
        toast(`Autodrive ${enabled ? 'on' : 'off'}`);
        return;
      }
      if (name === 'drive') {
        if (!started && !paused) beginFree({ preserveInput: true });
        return;
      }
      if (name === 'pause') setPaused(!paused);
      if (name === 'reset') {
        if (taxi.running) { recoverTaxi(true); return; }
        {
          // The seed also initializes shared layouts and scenery at module load.
          // Reload with a fresh seed to regenerate the whole city consistently.
          const url = new URL(window.location.href);
          let seed = resolveWorldSeed();
          if (seed === SEED) seed = (seed + 1) >>> 0;
          url.searchParams.set('seed', String(seed));
          changingJourney = true; input.clear();
          window.location.replace(url.href);
          return;
        }
      }
      if (name === 'view') {
        toast(rendering.toggleView()); updateViewUi();
        rendering.update(vehicle.car, 0, world.origin);
        needsRender = true;
      }
      if (name === 'ambientOcclusion') {
        const enabled = rendering.toggleAO();
        needsRender = true; toast(`Soft shading ${enabled ? 'on' : 'off'}`);
        return;
      }
      if (name === 'sound') {
        try {
          const enabled = await audio.toggle(); $('#sound').setAttribute('aria-pressed', String(enabled));
          $('#sound').setAttribute('aria-label', enabled ? 'Turn sound off' : 'Turn sound on'); $('#sound').title = enabled ? 'Turn sound off' : 'Turn sound on';
          toast(enabled ? JOURNEYS[journey].sound : 'Sound off');
        } catch { toast('Sound unavailable'); }
      }
    }
    const input = new Input(action, connected => {
      toast(connected ? controlHelpDismissed() ? 'Controller connected' : 'Controller connected · RT / R2 to drive' : 'Controller disconnected');
      // Show the focus ring straight away, so the title screen reads as a menu.
      if (connected && openWelcomeMenu() && !$('#welcome').contains(document.activeElement)) $('#start').focus();
      if (!connected && started && !paused) setPaused(true);
    }, () => {
      if (changingJourney) return;
      const enabled = vehicle.toggleRainbow();
      needsRender = true;
      toast(`Rainbow paint ${enabled ? 'on' : 'off'}`);
    });
    vr = new BrowserVR({
      renderer, buttons: [$('#enter-vr'), $('#enter-vr-pause')], canEnter: () => !changingJourney && !openChooser(),
      onStart() {
        $('#vr-error').hidden = true;
        input.xrActive = true; input.clear();
        rendering.enterVR(); rendering.update(vehicle.car, 0, world.origin); updateViewUi();
        rendering.vrCamera.recenter(); graphics.suspend();
        setPaused(false); start();
        audio.setHidden(!vr.visible); needsRender = true;
        document.body.dataset.vr = 'true';
      },
      onEnd() {
        input.xrActive = false; input.clear();
        vrStatus.update(null); graphics.suspend();
        rendering.exitVR(); rendering.update(vehicle.car, 0, world.origin); updateViewUi();
        audio.setHidden(document.hidden); setPaused(true); needsRender = true;
        document.body.dataset.vr = 'false';
      },
      onVisibility(visible) {
        input.clear(); frameClock.suspend(); audio.setHidden(!visible);
        if (!visible) { if (changingJourney) journeyWasPaused = true; setPaused(true); }
        needsRender = true;
      },
      onError(error) {
        const message = error.name === 'NotAllowedError' ? 'VR permission was declined. Select Enter VR to try again.' : 'Could not enter VR. Try again in your headset browser.';
        $('#vr-error').textContent = message; $('#vr-error').hidden = false;
      },
    });
    $('#change-journey').addEventListener('click', openJourneys);
    // The route button rides the title screen's stack and leads the toolbar
    // for the drive, however the menu comes and goes.
    function placeJourneyButton() {
      const button = $('#change-journey'), onMenu = !$('#welcome').classList.contains('hidden');
      for (const name of ['start-button', 'menu-secondary']) button.classList.toggle(name, onMenu);
      if (onMenu) $('#enter-vr').before(button); else $('.drive-actions').prepend(button);
    }
    new MutationObserver(placeJourneyButton).observe($('#welcome'), { attributeFilter: ['class'] });
    placeJourneyButton();
    $('#change-car').addEventListener('click', openCars);
    $('#close-cars').addEventListener('click', () => carDialog.close());
    $('#next-journey').addEventListener('click', event => {
      if (event.pointerType !== 'touch') action('nextJourney');
    });
    let fullscreenPending = false;
    const desktop = window.citydriverDesktop;
    let desktopFullscreen = false;
    const fullscreenDisplay = window.matchMedia('(display-mode: fullscreen)');
    function updateFullscreenUi() {
      const active = desktop ? desktopFullscreen : Boolean(document.fullscreenElement || document.webkitFullscreenElement || fullscreenDisplay.matches);
      $('#fullscreen').setAttribute('aria-pressed', String(active));
      $('#fullscreen').setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
      $('#fullscreen').title = `${active ? 'Exit' : 'Enter'} fullscreen (F / D-pad Down)`;
    }
    async function toggleFullscreen() {
      if (fullscreenPending) return;
      fullscreenPending = true;
      try {
        if (desktop) {
          desktopFullscreen = await desktop.toggleFullscreen();
        } else if (document.fullscreenElement || document.webkitFullscreenElement) {
          await (document.exitFullscreen ?? document.webkitExitFullscreen).call(document);
        } else {
          const request = document.documentElement.requestFullscreen ?? document.documentElement.webkitRequestFullscreen;
          if (!request) { toast('Fullscreen unavailable'); return; }
          await request.call(document.documentElement);
        }
      } catch {
        toast('Press F for fullscreen');
      } finally { fullscreenPending = false; updateFullscreenUi(); }
    }
    document.addEventListener('fullscreenchange', updateFullscreenUi);
    document.addEventListener('webkitfullscreenchange', updateFullscreenUi);
    fullscreenDisplay.addEventListener('change', updateFullscreenUi);
    if (desktop) {
      desktop.onFullscreenChange(active => { desktopFullscreen = active; updateFullscreenUi(); });
      desktop.getFullscreen().then(active => { desktopFullscreen = active; updateFullscreenUi(); });
      desktop.onEscape(() => {
        const chooser = openChooser();
        if (chooser) chooser.close(); else action('pause');
      });
      // Desktop builds that cannot update themselves get a download button on both menus.
      let updateShown = false;
      const showUpdate = update => {
        if (!update || updateShown) return;
        updateShown = true;
        for (const [anchor, classes] of [['#enter-vr', 'start-button menu-secondary'], ['#enter-vr-pause', 'panel-button']]) {
          const button = document.createElement('button');
          button.type = 'button'; button.className = `${classes} update-entry`;
          button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v10m-4-4 4 4 4-4M5 16v4h14v-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span></span>';
          button.lastChild.textContent = `Get version ${update.version}`;
          button.title = 'Opens the download page';
          button.addEventListener('click', () => window.open(update.url)); // the wrapper hands it to the system browser
          $(anchor).after(button);
        }
      };
      desktop.onUpdate(showUpdate);
      desktop.getUpdate().then(showUpdate);
    }
    updateFullscreenUi();
    $('#fullscreen').addEventListener('click', event => {
      if (event.pointerType !== 'touch') action('fullscreen');
    });
    $('#fullscreen').addEventListener('pointerup', event => {
      if (event.pointerType === 'touch') { event.preventDefault(); action('fullscreen'); }
    });
    $('#next-journey').addEventListener('pointerup', event => {
      if (event.pointerType === 'touch') { event.preventDefault(); action('nextJourney'); }
    });
    $('#close-journeys').addEventListener('click', () => journeyDialog.close());
    for (const dialog of [journeyDialog, carDialog, fleetDialog, worldMapDialog]) {
      dialog.addEventListener('close', () => {
        if (!changingJourney) setPaused(journeyWasPaused || document.hidden);
        if (taxi.status === 'over') pauseOverlay.hidden = true;
        if (dialog === fleetDialog) fleetReturnFocus?.focus();
        if (dialog === worldMapDialog && paused && !pauseOverlay.hidden) $('#open-world-map').focus();
      });
      dialog.addEventListener('click', event => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
      });
    }
    document.querySelectorAll('button[data-journey]').forEach(button => button.addEventListener('click', () => changeJourney(button.dataset.journey)));
    for (const name of ['pause', 'reset', 'view', 'sound']) $(`#${name}`).addEventListener('click', event => {
      if (['pause', 'view'].includes(name) && event.pointerType === 'touch') return;
      action(name);
    });
    // A secondary finger may not synthesize a click while the stick is held.
    for (const name of ['pause', 'view']) $(`#${name}`).addEventListener('pointerup', event => {
      if (event.pointerType === 'touch') { event.preventDefault(); action(name); }
    });
    $('#start').addEventListener('click', start);
    $('#free-drive').addEventListener('click', beginFree);
    $('#taxi-retry').addEventListener('click', beginTaxi);
    $('#taxi-free').addEventListener('click', beginFree);
    $('#restart-run').addEventListener('click', beginTaxi);
    $('#switch-mode').addEventListener('click', () => gameMode === 'taxi' ? beginFree() : beginTaxi());
    window.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (started || paused || changingJourney || document.querySelector('dialog[open]')) return;
      if (event.target.closest?.('button, a, input, select, textarea, [contenteditable]') && event.target !== $('#start')) return;
      event.preventDefault();
      if (!event.repeat) $('#start').click();
    });
    $('#resume').addEventListener('click', () => setPaused(false));
    document.addEventListener('visibilitychange', () => { if (vr.active || vr.pending) return; audio.setHidden(document.hidden); if (document.hidden) { if (openChooser() || changingJourney) journeyWasPaused = true; if (started) setPaused(true); input.clear(); } frameClock.suspend(); });
    window.addEventListener('blur', () => { if (vr.active || vr.pending) return; audio.setHidden(true); if (openChooser() || changingJourney) journeyWasPaused = true; if (started) setPaused(true); });
    window.addEventListener('focus', () => audio.setHidden(hidden()));
    window.addEventListener('pointerdown', () => audio.unlock(), { capture: true, passive: true });
    window.addEventListener('keydown', () => audio.unlock(), { capture: true });
    window.addEventListener('pagehide', event => { audio.setHidden(true); if (!event.persisted) { nightLighting.dispose(); world.dispose(); weather.dispose(); traffic.dispose(); taxiView.dispose(); void audio.dispose().catch(() => {}); } });
    window.addEventListener('pageshow', () => { audio.setHidden(document.hidden); needsRender = true; });
    $('#scene').addEventListener('webglcontextlost', event => { event.preventDefault(); setPaused(true); toast('Graphics lost. Reload to restart.'); });
    $('#scene').addEventListener('webglcontextrestored', () => { needsRender = true; });
    const qualityButtons = [...document.querySelectorAll('[data-quality]')];
    const graphicsToggle = $('#graphics-toggle'), graphicsPanel = $('#graphics-settings');
    graphicsToggle.addEventListener('click', () => {
      graphicsPanel.hidden = !graphicsPanel.hidden;
      graphicsToggle.setAttribute('aria-expanded', String(!graphicsPanel.hidden));
    });
    const softShading = $('#soft-shading'), graphicsStatus = $('#graphics-status');
    const pixelDensity = $('#pixel-density'), pixelDensityValue = $('#pixel-density-value');
    function updateGraphicsUi(settings = graphics.settings) {
      for (const button of qualityButtons) button.setAttribute('aria-checked', String(button.dataset.quality === graphics.mode));
      softShading.setAttribute('aria-pressed', String(settings.ambientOcclusion));
      const densityPercent = Math.round(settings.density * 100);
      $('#graphics-summary').textContent = `${graphics.auto ? 'Auto' : settings.label} · ${densityPercent}%`;
      pixelDensity.value = String(densityPercent);
      pixelDensity.style.setProperty('--control-level', `${(densityPercent - 50) * 2}%`);
      pixelDensityValue.textContent = `${densityPercent}%${settings.customDensity ? (densityPercent === 100 ? ' · Native' : '') : ' · Preset limit'}`;
      pixelDensity.setAttribute('aria-valuetext', `${densityPercent}% of native resolution${settings.customDensity ? '' : ', capped by the preset'}`);
      // The drawing buffer is the thing the quality level actually changes, so
      // show it: it explains a softer picture without any further digging.
      graphicsStatus.textContent = `${graphics.auto ? 'Auto · ' : ''}${settings.label} · ${renderer.domElement.width} × ${renderer.domElement.height} · soft shading ${settings.ambientOcclusion ? 'on' : 'off'}`;
    }
    graphics.onChange((settings, reason) => {
      // A frozen canvas keeps its old buffer until something asks for a frame.
      needsRender = true;
      updateGraphicsUi(settings);
      if (reason === 'auto') toast(`Graphics · ${settings.label}${settings.ambientOcclusion ? '' : ' · soft shading off'}`);
    });
    for (const button of qualityButtons) button.addEventListener('click', () => graphics.setMode(button.dataset.quality));
    softShading.addEventListener('click', () => action('ambientOcclusion'));
    pixelDensity.addEventListener('input', () => graphics.setDensity(Number(pixelDensity.value) / 100));
    const hud = { distance: $('#distance') };
    const weatherSelect = $('#city-weather');
    weatherSelect.value = weather.mode;
    weatherSelect.addEventListener('change', () => {
      weather.setMode(weatherSelect.value, { immediate: paused });
      weather.update(time, vehicle, world.origin); rendering.setWeather(weather.state, 0);
      world.setWetness(weather.state.wetness); vehicle.setLights(weather.state.lightLevel); traffic.models.setLights(weather.state.lightLevel);
      try { localStorage.setItem('citydriver-weather', weather.mode); } catch { /* Storage is optional. */ }
      updateHud(); needsRender = true;
    });
    function updateHud() {
      // Physics uses meters; convert only the displayed measurement. The drive
      // itself shows nothing, so this is read on the pause screen.
      const distance = mileageFormat.format(vehicle.distance / 1609.344);
      // Replacing unchanged text still invalidates layout, including while paused.
      if (hud.distance.textContent !== distance) hud.distance.textContent = distance;
      const degrees = ((vehicle.heading * 180 / Math.PI) % 360 + 360) % 360;
      const text = (selector, value) => { const element = $(selector); if (element.textContent !== value) element.textContent = value; };
      text('#city-heading', ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8]);
      text('#city-location', cityDistrict(vehicle.s, vehicle.u));
      text('#world-map-here', cityDistrict(vehicle.s, vehicle.u));
      text('#weather-label', weather.state.label);
      cityGuide.update(started && !paused && !changingJourney);
      taxiView.hud(taxi, vehicle);
    }
    function updateViewUi() {
      $('#view').title = `${rendering.viewLabel} · Change camera (V)`;
      $('#view').setAttribute('aria-label', `${rendering.viewLabel}. Change camera`);
      const thirdPerson = rendering.camera.isPerspectiveCamera;
      $('.stick-help-copy').firstChild.textContent = thirdPerson ? 'Touch anywhere · ↑ Drive · ↔ Steer' : 'Drag anywhere to drive';
      $('.stick-help-line').textContent = thirdPerson ? '↓ Brake · Release to stop' : 'Release to stop';
      $('#touch-stick').setAttribute('aria-label', thirdPerson ? 'Virtual joystick: up to accelerate, left and right to steer, down to brake or reverse, release to stop' : 'Virtual joystick');
    }
    function vrMenuModel() {
      if (!vr.active) return null;
      if (changingJourney) return { id: 'loading', title: 'Loading road…', items: [] };
      const item = (label, name) => ({ label, activate: () => action(name) });
      const chooser = openChooser();
      if (chooser) {
        const cars = chooser === carDialog;
        const fleet = chooser === fleetDialog;
        const buttons = [...chooser.querySelectorAll(fleet ? '[data-fleet-car]:not(:disabled), [data-livery]:not(:disabled)' : cars ? '[data-car], [data-paint]' : '[data-journey]')];
        return { id: chooser.id, title: fleet ? 'Taxi fleet' : cars ? 'Garage & paint' : chooser === worldMapDialog ? 'City map' : 'Choose a route', items: [
          { label: 'Back', activate: () => chooser.close() },
          ...buttons.map(button => ({
            label: (button.hasAttribute('data-paint') ? 'Paint: ' : button.hasAttribute('data-livery') ? 'Livery: ' : '') + (button.getAttribute('aria-label') ?? button.querySelector('.chooser-card-title')?.textContent ?? button.textContent).trim() + (button.getAttribute('aria-current') === 'true' || button.getAttribute('aria-checked') === 'true' ? ' ✓' : ''),
            activate: () => button.click(),
          })),
        ] };
      }
      if (taxi.status === 'over') return { id: 'taxi-results', title: `Time up · $${taxi.cash} · ${taxiLicense(taxi.cash).name}`, items: [
        { label: 'Play again', activate: beginTaxi }, { label: 'Taxi fleet', activate: openFleet }, { label: 'Free drive', activate: beginFree }, item('Exit VR', 'exitVR'),
      ] };
      if (!paused) return { id: 'driving', title: taxi.running ? `${Math.ceil(taxi.timeLeft)}s · $${taxi.cash} · ${taxi.status === 'pickup' ? 'Pick up' : taxi.target.name}` : '', items: [item('Pause', 'pause')] };
      const modes = ['auto', 'high', 'balanced', 'smooth', 'basic'];
      return { id: 'pause', title: 'Paused', items: [
        { label: gameMode === 'taxi' ? 'Restart run' : 'Taxi run', activate: beginTaxi },
        ...(gameMode === 'taxi' ? [{ label: 'Free drive', activate: beginFree }] : []),
        item('Resume', 'pause'), item(`Camera: ${rendering.viewLabel}`, 'view'),
        item(gameMode === 'taxi' ? 'Taxi fleet' : 'Garage & paint', 'car'),
        item(`Autodrive: ${autodrive.enabled ? 'on' : 'off'}`, 'autodrive'),
        { label: `Traffic: ${traffic.enabled ? 'on' : 'off'}`, activate: () => $('#traffic').click() },
        item(`Sound: ${$('#sound').getAttribute('aria-pressed') === 'true' ? 'on' : 'off'}`, 'sound'),
        { label: `Sound mix: ${audio.preset}`, activate: () => { const presets = ['balanced', 'scenic', 'night']; audio.setPreset(presets[(presets.indexOf(audio.preset) + 1) % presets.length]); refreshAudioMixer(); } },
        { label: `Graphics: ${graphics.mode}`, activate: () => graphics.setMode(modes[(modes.indexOf(graphics.mode) + 1) % modes.length]) },
        item('Reset car', 'reset'), item('Recenter view', 'recenterVR'), item('Exit VR', 'exitVR'),
      ] };
    }
    const simulate = dt => {
      let state = started ? input.state : {};
      if (autodrive.enabled && (state.forward || state.brake || state.left || state.right || state.handbrake || state.touchStick)) action('autodrive');
      // Cruise behind the welcome menu without toggling the player's setting
      // or showing a notification. Starting hands control straight to input.
      if (!started || autodrive.enabled) state = autodrive.update(vehicle, traffic, started ? vehicle.stats.topSpeed : MENU_CRUISE_SPEED, dt);
      if (state.touchStick) {
        if (rendering.camera.isPerspectiveCamera) {
          const touch = thirdPersonDrivingInput(state.touchStick);
          touch.handbrake ||= state.handbrake;
          state = { ...state, ...touch };
        }
        else state.touchDrive = touchDrivingInput(state.touchStick, rendering.camera, vehicle.route, vehicle.s, vehicle.u, world.origin);
      }
      if (paused || changingJourney) return;
      if (taxi.running) state = taxi.controls(dt, state);
      vehicle.update(dt, state);
      if (started) updateControlHelp(vehicle.speed);
      collideScenery(vehicle, world.chunks, dt);
      traffic.update(dt, vehicle);
      if (started && taxi.running) {
        taxi.update(dt, vehicle, traffic.enabled ? traffic.vehicles : []);
        for (const event of taxi.drainEvents()) {
          if (event.kind === 'over') {
            vehicle.speed = 0; vehicle.knock.x = vehicle.knock.z = vehicle.knock.spin = 0; vehicle.update(0, {});
            setPaused(true); pauseOverlay.hidden = true; taxiView.hud(taxi, vehicle); taxiView.results(taxi); fleetView.render(); $('#taxi-retry').focus();
          } else if (event.kind === 'goal') {
            // A goal usually completes on a payout, whose toast lands first.
            renderGoals(); setTimeout(() => { if (taxi.running && !paused) toast(event.text, 'goal'); }, 1500);
          } else toast(event.text, event.rating ?? (event.kind === 'missed' ? 'slow' : ''));
        }
      }
    };
    function frame(timestamp, xrFrame) {
      vrStatus.update(vrMenuModel());
      if (vr.active) input.xr.update(vr.session.inputSources, { blocked: !vr.visible || changingJourney, paused });
      else {
        input.gamepad.update({ blocked: document.hidden || !document.hasFocus() || changingJourney, paused, menu: openChooser() ? 'chooser' : openPauseMenu() ? 'pause' : openWelcomeMenu() ? 'welcome' : false });
        const menu = input.gamepad.scroll && (openChooser() ?? openPauseMenu() ?? openWelcomeMenu());
        if (menu) scrollMenu(menu, input.gamepad.scroll * 18);
      }
      const running = !paused && !hidden();
      frameClock.tick(timestamp, running, simulate);
      const dt = frameClock.dt;
      if (running) {
        time += dt;
        world.update(vehicle.s, vehicle.u, { budgetMs: 3 }); vehicle.render(frameClock.alpha, world.origin);
        traffic.render(frameClock.alpha, world.origin);
        pedestrianContacts.update(vehicle, traffic, time);
        rendering.update(vehicle.car, dt, world.origin); world.animate(time, traffic.time, vr.active ? null : rendering.camera, pedestrianContacts);
        taxiView.render(taxi, vehicle, world.origin, time, pedestrianContacts);
        weather.update(time, vehicle, world.origin); rendering.setWeather(weather.state, dt);
        world.setWetness(weather.state.wetness); vehicle.setLights(weather.state.lightLevel); traffic.models.setLights(weather.state.lightLevel);
      }
      soundScene.interior = rendering.viewLabel === 'First-person view';
      soundScene.lightning = weather.flash; soundScene.rain = weather.state.rain; soundScene.wetness = weather.state.wetness;
      const cameraMatrix = (vr.active ? rendering.vrCamera.camera : rendering.camera).matrixWorld.elements;
      soundScene.heading = Math.atan2(cameraMatrix[2], cameraMatrix[0]);
      audio.update(vehicle.audioTelemetry, dt, false, soundScene);
      hudTime += dt; if (hudTime > .1) { updateHud(); hudTime = 0; }
      // The desktop quality sampler targets 60 Hz and resizes a canvas, whereas
      // the headset owns its framebuffer and refresh rate.
      rendering.recordFrame(timestamp, !vr.active && !paused && !document.hidden && document.hasFocus() && !changingJourney);
      // A paused desktop canvas only redraws when invalidated. In VR, keep
      // drawing every headset frame so head tracking continues while stopped.
      const rendered = vr.active ? Boolean(xrFrame) : !document.hidden && (!paused || needsRender);
      if (rendered) {
        vrStatus.update(vrMenuModel());
        rendering.render(xrFrame, () => {
          vrStatus.point(xrFrame, renderer.xr.getReferenceSpace(), rendering.vrCamera.rig, vr.visible && !changingJourney);
          vrStatus.update(vrMenuModel());
        }); needsRender = false;
        if (!sceneReady) { sceneReady = true; $('#loading').classList.add('loaded'); }
      }
      updateFPS(timestamp, rendered);
    }
    world.update(vehicle.s, vehicle.u);
    while (world.pending.length) world.update(vehicle.s, vehicle.u);
    weather.update(time, vehicle, world.origin); rendering.setWeather(weather.state, 0);
    world.setWetness(weather.state.wetness); vehicle.setLights(weather.state.lightLevel); traffic.models.setLights(weather.state.lightLevel);
    buildCarCards(); buildPaintSwatches(); updateCarUi();
    vehicle.render(0, world.origin); traffic.render(1, world.origin); rendering.update(vehicle.car, 1, world.origin); updateHud(); updateJourneyUi(); updateViewUi(); updateGraphicsUi();
    nightLighting.update(world, vehicle, traffic, weather.state.lightLevel);
    await rendering.precompile([...world.warmupObjects(), ...taxiView.warmupObjects()]);
    try { taxiView.navigation.prepare(); } catch { /* The first fare tries again. */ }
    changingJourney = false;
    renderer.setAnimationLoop(frame);
    void vr.detect();
    // Development-only inspection surface for automated driving and streaming checks.
    if (import.meta.env.DEV) window.__citydriver = { seed: SEED, city: CITY, nav: navGraph(), lanePose, roadAt, nearestLanePose, vehicle, traffic, weather, autodrive, audio, graphics, vr, cityGuide, taxi, taxiView, beginTaxi, beginFree, get gameMode() { return gameMode; }, get world() { return world; }, rendering, input, action, changeJourney, chooseCar, applyPaint, get carId() { return carId; }, get paint() { return paint; }, get journey() { return journey; }, get changingJourney() { return changingJourney; }, get paused() { return paused; }, get started() { return started; } };
  } catch (error) { console.error('Could not start Citydriver:', error); $('#loading').classList.add('loaded'); $('#error').hidden = false; }
}
boot();
