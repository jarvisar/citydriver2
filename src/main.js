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
import './demolition.css';
import './city-theme.css';
import { setupTaxiFleet } from './taxi-fleet-view.js';
import { createRendering } from './rendering.js';
import { Graphics } from './graphics.js';
import { JOURNEYS } from './journeys.js';
import { CARS, GARAGE_IDS, DEFAULT_CAR, ROUTE_PAINT, carEntry, carMeters } from './cars.js';
import { carArt } from './car-art.js';
import { PAINTS, DEFAULT_PAINT, DEFAULT_PAINT_NAME, paintName, readPaint } from './car-paint.js';
import { SEED } from './world/route.js';
import { resolveWorldSeed } from './world/generation.js';
import { CityWeather } from './world/city-weather.js';
import { NightLighting } from './night-lighting.js';
import { LooseProps } from './loose-props.js';
import { cityDistrict, citySoundscape, cityHeight, nearestLanePose, journeyStart, lanePose, roadAt, surfaceAt, waterAt } from './world/city-route.js';
import { CITY } from './world/city.js';
import { signSheet } from './world/city-signs.js';
import { loadingStage } from './loading-status.js';
import { navGraph } from './world/nav-graph.js';
import { CityGuide } from './city-guide.js';
import { WorldMap, DISTRICT_COLORS } from './city-world-map.js';
import { TaxiRun } from './taxi-run.js';
import { taxiLicense } from './taxi-license.js';
import { goalProgress } from './taxi-goals.js';
import { TaxiView } from './taxi-view.js';
import { DemolitionRun, DEMOLITION_CAR, DEMOLITION_PAINT } from './demolition-run.js';
import { DemolitionView } from './demolition-view.js';
import { setResidentWindow } from './world/resident.js';
import { DrivingController } from './vehicle.js';
import { OnFoot } from './on-foot.js';
import { walkingInput, createWalkerModel } from './walker.js';
import { CityTraffic as Traffic } from './city-traffic.js';
import { TRAFFIC_CRUISE_SPEED } from './traffic.js';
import { collideScenery, sightLine } from './collision.js';
import { PedestrianContacts } from './world/pedestrian-reactions.js';
import { CityAutodrive as Autodrive } from './city-autodrive.js';
import { Input } from './input.js';
import { touchDrivingInput, thirdPersonDrivingInput, pressOnRelease } from './touch-stick.js';
import { MouseLook } from './mouse-look.js';
import { DriveAudio } from './audio.js';
import { setupAudioMixer } from './audio/mixer.js';
import { FrameClock } from './timing.js';
import { setupControlHelp, controlHelpDismissed, updateControlHelp } from './control-help.js';
import { BrowserVR } from './vr.js';
import { VRStatus } from './vr-status.js';
import { moveMenuFocus, confirmMenuFocus, scrollMenu } from './menu-focus.js';

setupControlHelp();

const $ = selector => document.querySelector(selector);
const MENU_MOVES = ['menuNext', 'menuPrevious', 'menuUp', 'menuDown'];
const MENU_CRUISE_SPEED = TRAFFIC_CRUISE_SPEED * 1.4;
// How fast the right stick turns the camera, pushed all the way (rad/s)
const STICK_LOOK = 2.4;
const mileageFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
let paused = false, started = false, time = 0, hudTime = 0, gameMode = 'taxi';
document.body.dataset.mode = gameMode;
const frameClock = new FrameClock();
let toastTimer; let sceneReady = false;
// Set when an Escape left fullscreen mid-drive and paused it (see fullscreenchange)
let fullscreenOnResume = false;
// The chosen car outlives the visit; positions and mileage do not.
const carStorageKey = 'citydriver-car';
let carId = DEFAULT_CAR;
try { const saved = localStorage.getItem(carStorageKey); if (saved && CARS[saved]) carId = saved; } catch { /* Storage is optional. */ }
// One colour dresses the whole garage and follows the player from car to car.
// It lasts the visit and is not stored: the fleet's own finishes are the thing
// worth keeping, and Default hands them straight back.
let paint = null;
// A headset shows toasts in its own HUD (set up in boot).
let echoToast = null;
const toast = (message, tone = '') => {
  echoToast?.(message, tone);
  const element = $('#toast');
  // Run feedback (taxi or demolition) shares the instruction slot, keeping notifications off the road.
  const parent = gameMode !== 'free' && started && !paused ? $('.taxi-task-copy') : $('#app');
  if (element.parentElement !== parent) parent.append(element);
  // Taxi arrivals take their rating's colour: Speedy green, Normal yellow, Slow red.
  element.textContent = message; element.dataset.tone = tone; element.classList.add('show'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 2200);
};

async function boot() {
  try {
    // `?ao=0` turns soft shading off for this visit, whatever was saved or detected.
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
    let vr, vrHintTime = 0, vrMapCanvas = null, vrMapKey = 0;
    const vrStatus = new VRStatus(rendering.vrCamera.camera, rendering.vrCamera.anchor);
    echoToast = (message, tone) => { if (vr?.active) vrStatus.toast(message, tone); };
    const comfortStorageKey = 'citydriver-vr-comfort', comfort = rendering.vrCamera.comfort;
    try { comfort.enabled = localStorage.getItem(comfortStorageKey) !== 'off'; } catch { /* Storage is optional. */ }
    function toggleComfort() {
      comfort.enabled = !comfort.enabled; toast(`Comfort vignette ${comfort.enabled ? 'on' : 'off'}`);
      try { localStorage.setItem(comfortStorageKey, comfort.enabled ? 'on' : 'off'); } catch { /* Keep it for this visit. */ }
    }
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
    const journey = 'city';
    await loadingStage('furniture');
    const world = new JOURNEYS[journey].World(scene);
    // (at lower levels, and in a standalone headset, small things cast no shadow)
    world.setShadowDetail(graphics.settings.shadowDetail); graphics.onChange(settings => world.setShadowDetail(settings.shadowDetail));
    rendering.addCuller((camera, shadow) => world.cull(camera, shadow));
    // The chase camera stays out of the buildings and above the ground, and
    // following someone on foot, out of the cars
    rendering.setSightLine((from, to) => sightLine(world.chunks.values(), from, to, world.origin, vehicle.walker ? onFoot.sightCars() : null));
    rendering.setGround((x, z) => cityHeight(world.origin - z, x));
    const weather = new CityWeather(scene);
    try { weather.setMode(localStorage.getItem('citydriver-weather') ?? 'auto', { immediate: true }); } catch { /* Storage is optional. */ }
    let changingJourney = true, journeyWasPaused = false;
    // The menu cruises in a cab; starting either mode applies its own saved car.
    const vehicle = new DrivingController(JOURNEYS[journey].route, journeyStart(), 'taxi'); const audio = new DriveAudio();
    // (the roofs the helicopter can set down on)
    vehicle.scenery = world.chunks;
    const refreshAudioMixer = setupAudioMixer(audio);
    const showSound = enabled => {
      $('#sound').setAttribute('aria-pressed', String(enabled));
      $('#sound').setAttribute('aria-label', enabled ? 'Turn sound off' : 'Turn sound on'); $('#sound').title = enabled ? 'Turn sound off' : 'Turn sound on';
    };
    // Silent until a drive starts. Sound left on last visit is built now and
    // comes back with the first click or key after that.
    audio.setPaused(true); showSound(audio.restore());
    // Free driving starts on; the hidden code only changes the paint.
    vehicle.toggleFreeDriving();
    vehicle.setAppearance(journey);
    vehicle.setLights(weather.state.lightLevel);
    rendering.setJourney(journey);
    const carDialog = $('#car-dialog'), pauseOverlay = $('#pause-overlay');
    const fleetDialog = $('#taxi-fleet-dialog'), worldMapDialog = $('#world-map-dialog');
    const choosers = [carDialog, fleetDialog, worldMapDialog];
    const openChooser = () => choosers.find(dialog => dialog.open) ?? null;
    // A chooser pauses the drive over the pause screen; closing it restores
    // whatever pause state it found (see the dialogs' close handlers).
    function holdForChooser() {
      if (changingJourney || openChooser()) return false;
      journeyWasPaused = paused; setPaused(true); pauseOverlay.hidden = true;
      return true;
    }
    // The pause screen is a menu too: it is up whenever the drive is paused
    // with no chooser over it, and the controller walks it the same way.
    const resultsCard = () => !$('#taxi-results').hidden ? $('#taxi-results') : !$('#demolition-results').hidden ? $('#demolition-results') : null;
    const openPauseMenu = () => resultsCard() ?? (paused && !pauseOverlay.hidden ? pauseOverlay : null);
    // The title screen is a menu of its own until a drive begins.
    const openWelcomeMenu = () => !started && !paused && !$('#welcome').classList.contains('hidden') ? $('#welcome') : null;
    scene.add(vehicle.car);
    const traffic = new Traffic(scene, vehicle.route, vehicle.s, journey, vehicle.u);
    // Street furniture knocked loose (see loose-props.js), which loose traffic can knock over too
    const props = new LooseProps(scene, world.materials.props);
    traffic.props = props;
    // (and takes the player on foot, when a car knocks them over)
    vehicle.props = props;
    // Getting out of the car and into another, in free drive (see on-foot.js)
    const onFoot = new OnFoot(vehicle, traffic);
    const pedestrianContacts = new PedestrianContacts();
    const nightLighting = new NightLighting(scene);
    // The weather's light, sky and wet roads, on the scene and every car
    function applyWeather(dt = 0) {
      weather.update(time, vehicle, world.origin); rendering.setWeather(weather.state, dt);
      world.setWetness(weather.state.wetness); world.setWindowGlow(weather.state.windowGlow); vehicle.setLights(weather.state.lightLevel); traffic.models.setLights(weather.state.lightLevel);
    }
    const haltCar = () => { vehicle.speed = 0; vehicle.knock.x = vehicle.knock.z = vehicle.knock.spin = 0; vehicle.pilot?.stop(); vehicle.walker?.stop(); vehicle.update(0, {}); };
    const drawScene = rendering.render;
    rendering.render = (...args) => {
      nightLighting.update(world, vehicle, traffic, weather.state.lightLevel);
      return drawScene(...args);
    };
    const cityGuide = new CityGuide(text => { toast(text); audio.cue('discovery'); }, () => vehicle);
    let taxiStorage; try { taxiStorage = localStorage; } catch { /* Optional storage. */ }
    const taxi = new TaxiRun(taxiStorage), taxiView = new TaxiView(scene); cityGuide.taxi = taxi;
    // (the street map marks the car the player left parked)
    cityGuide.onFoot = onFoot;
    // Demolition: the truck's timed run, scored by the damage it does (see
    // demolition-run.js). While it runs, everything knocked loose is the
    // truck's doing, directly or through what it sent flying; ordinary
    // traffic knocking someone over is not.
    const demolition = new DemolitionRun(taxiStorage), demolitionView = new DemolitionView(scene);
    props.onSmash = (kinds, at) => demolition.smash(kinds, at);
    traffic.onDamage = (car, closing) => demolition.damageCar(car, closing);
    pedestrianContacts.onKnock = (by, at) => { if (by !== 'traffic') demolition.pedestrian(at); };
    const runOver = () => taxi.status === 'over' || demolition.status === 'over';
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
      // (and in a demolition run, the high score table)
      if (gameMode === 'demolition') demolitionView.scores(demolition);
    }
    let fleetReturnFocus;
    function openFleet() {
      // (pausing focuses Resume, so note the focus first)
      const focus = document.activeElement;
      if (!holdForChooser()) return;
      fleetReturnFocus = focus;
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
      // as wide as its column, or as tall as the dialog leaves room for once
      // its heading, and the key when that sits below the map, are counted
      const body = worldMapCanvas.closest('.world-map-body'), key = body.lastElementChild;
      const below = getComputedStyle(body).gridTemplateColumns.split(' ').length < 2;
      const chrome = worldMapDialog.offsetHeight - body.offsetHeight + (below ? key.offsetHeight + parseFloat(getComputedStyle(body).rowGap) : 0);
      const room = Math.max(140, parseFloat(getComputedStyle(worldMapDialog).maxHeight) - chrome - 2);
      worldMapCanvas.style.width = `${Math.floor(Math.min(worldMapCanvas.parentElement.clientWidth, room * worldMap.aspect))}px`;
      worldMap.draw(worldMapCanvas, vehicle, onFoot.parked);
    }
    function openWorldMap() {
      if (!holdForChooser()) return;
      if (!worldMap) {
        worldMap = new WorldMap(CITY, cityGuide.mapCache);
        // The legend: each district this city has, and its share of the blocks
        const blocks = new Map();
        for (const label of worldMap.labels) blocks.set(label.style, (blocks.get(label.style) ?? 0) + label.blocks);
        const total = [...blocks.values()].reduce((sum, n) => sum + n, 0);
        $('#world-map-legend').innerHTML = Object.keys(DISTRICT_COLORS).filter(style => blocks.has(style)).map(style =>
          `<li><span class="world-map-swatch" style="--district-color:${DISTRICT_COLORS[style]}"></span>${style}<small>${Math.round(blocks.get(style) / total * 100)}%</small></li>`).join('')
          + '<li id="world-map-car" hidden><span class="world-map-marker"></span>Your car<small></small></li>';
      }
      // and the player's own car, where they left it, and how far off
      const parked = onFoot.parked;
      $('#world-map-car').hidden = !parked;
      if (parked) $('#world-map-car small').textContent = `${Math.round(Math.hypot(parked.s - vehicle.s, parked.u - vehicle.u) / 10) * 10} m`;
      worldMapCanvas.style.aspectRatio = String(worldMap.aspect);
      $('#world-map-status').textContent = hereText();
      worldMapDialog.showModal();
      drawWorldMap();
      // (and once more for the headset's panel, which cannot show the page)
      if (vr?.active) { vrMapCanvas ??= document.createElement('canvas'); vrMapCanvas.width = 940; worldMap.draw(vrMapCanvas, vehicle, onFoot.parked); vrMapKey++; }
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
    const soundScene = { player: vehicle, traffic, props, interior: false, heading: 0 };
    let placeTime = -Infinity, shiftTick = Infinity;
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
    // Each mode dresses the interface in its own accent (see city-theme.css):
    // taxi yellow, demolition orange and free-drive teal
    function modeUi() {
      document.body.dataset.mode = gameMode;
      const run = gameMode !== 'free';
      for (const id of ['change-car', 'autodrive', 'traffic']) $(`#${id}`).disabled = run;
      $('#change-car').hidden = run;
      $('#pause-fleet').hidden = gameMode !== 'taxi';
      // (free drive's makes a new city, as R does: a controller's Y gets in and out of cars there,
      // and it comes last, well away from Resume)
      $('#restart-run span').textContent = run ? 'Restart run' : 'New city';
      if (run) $('#switch-mode').before($('#restart-run')); else $('#traffic').after($('#restart-run'));
      $('#goals-panel').hidden = gameMode !== 'taxi';
      $('#scores-panel').hidden = gameMode !== 'demolition';
      $('#switch-mode span').textContent = run ? 'Free drive' : 'Taxi run';
      $('#other-run span').textContent = gameMode === 'demolition' ? 'Taxi run' : 'Demolition';
      $('#taxi-clock-label').textContent = gameMode === 'demolition' ? 'TIME' : 'SHIFT';
      $('#taxi-clock').setAttribute('aria-label', gameMode === 'demolition' ? 'Seconds remaining' : 'Shift seconds remaining');
      $('#reset').title = run ? 'Reset car: −5 seconds (R)' : 'Reset city (R)';
      $('#reset').setAttribute('aria-label', $('#reset').title);
      vrStatus.setAccent(gameMode);
      // Residents cost a fine in a demolition run: they glow red, through props too
      world.setPeopleAlert(gameMode === 'demolition', rendering.stencil);
      updateCarUi();
    }
    function recoverCar(penalty = false) {
      const pose = nearestLanePose(vehicle.s, vehicle.u, vehicle.heading);
      vehicle.s = pose.s; vehicle.u = pose.u; vehicle.heading = pose.heading;
      vehicle.pilot?.land(); haltCar();
      const run = demolition.running ? demolition : taxi;
      if (penalty) { run.timeLeft = Math.max(0, run.timeLeft - 5); toast('Reset −5s'); }
      taxi.hold = 0;
      world.update(vehicle.s, vehicle.u); vehicle.render(0, world.origin); rendering.snap(); needsRender = true;
    }
    function beginTaxi() {
      if (changingJourney) return;
      if (freeTraffic === undefined || gameMode === 'free') freeTraffic = traffic.enabled;
      demolition.stop(); started = true; gameMode = 'taxi'; autodrive.reset(); vehicle.arcade = true;
      onFoot.clear(); vehicle.setCar(taxi.fleet.selected, { paint: taxi.fleet.liveryColor }); recoverCar(); traffic.setEnabled(true, vehicle);
      $('#traffic').setAttribute('aria-pressed', 'true'); $('#autodrive').setAttribute('aria-pressed', 'false');
      taxi.start(vehicle); taxiView.reset(); renderGoals(); $('#taxi-results').hidden = true; $('#demolition-results').hidden = true; $('#welcome').classList.add('hidden');
      rendering.setView(4); updateViewUi(); setPaused(false); modeUi(); updateHud();
      taxiView.render(taxi, vehicle, world.origin, time); rendering.update(vehicle.car, 1, world.origin);
    }
    // Demolition: the truck, a minute on the clock, and a city to wreck. The
    // furniture and parked cars a previous go knocked about are put back.
    function beginDemolition() {
      if (changingJourney) return;
      if (freeTraffic === undefined || gameMode === 'free') freeTraffic = traffic.enabled;
      taxi.stop(); started = true; gameMode = 'demolition'; autodrive.reset(); vehicle.arcade = true;
      props.reset(); onFoot.clear(); vehicle.setCar(DEMOLITION_CAR, { paint: DEMOLITION_PAINT }); recoverCar(); traffic.setEnabled(true, vehicle);
      $('#traffic').setAttribute('aria-pressed', 'true'); $('#autodrive').setAttribute('aria-pressed', 'false');
      demolition.start(); demolitionView.reset(); $('#taxi-results').hidden = true; $('#demolition-results').hidden = true; $('#welcome').classList.add('hidden');
      rendering.setView(4); updateViewUi(); setPaused(false); modeUi(); updateHud();
      taxiView.render(taxi, vehicle, world.origin, time); rendering.update(vehicle.car, 1, world.origin);
      toast('Wreck everything · Mind the pedestrians');
    }
    function beginFree({ preserveInput = false } = {}) {
      if (changingJourney) return;
      const wasRun = taxi.status !== 'idle' || demolition.status !== 'idle'; taxi.stop(); demolition.stop(); started = true; gameMode = 'free';
      autodrive.reset(); vehicle.arcade = false; onFoot.clear(); vehicle.setCar(carId, { paint }); vehicle.speed = 0; vehicle.pilot?.stop(); vehicle.update(0, {});
      if (wasRun && freeTraffic !== undefined) traffic.setEnabled(freeTraffic, vehicle);
      $('#traffic').setAttribute('aria-pressed', String(traffic.enabled)); $('#autodrive').setAttribute('aria-pressed', 'false');
      $('#taxi-results').hidden = true; $('#demolition-results').hidden = true; $('#welcome').classList.add('hidden');
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
      // (back into the fullscreen an Escape took the drive out of, where the
      // browser gives Escape no other way to pause: see fullscreenchange)
      if (!paused) {
        if (fullscreenOnResume && started && !vr?.active) void setFullscreen(true, { quiet: true });
        fullscreenOnResume = false;
      }
      if (paused) { clearTimeout(toastTimer); $('#toast').classList.remove('show'); }
      // (the title screen is silent: sound begins with the drive)
      audio.setPaused(paused || !started);
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
    }
    function buildCarCards() {
      const current = '<span class="chooser-current">CURRENT CAR</span>';
      $('.car-options').innerHTML = GARAGE_IDS.map(id => {
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
    // The colour lands on the car where it stands and on every card at once.
    // Default clears it, and the fleet goes back to its own finishes.
    function applyPaint(value) {
      const color = value === DEFAULT_PAINT ? null : readPaint(value);
      if (value !== DEFAULT_PAINT && !color) return;
      paint = color;
      // (on the garage car, wherever it is: under the player, or parked)
      if (started && !onFoot.paint(paint)) vehicle.setPaint(paint);
      paintCards(); updatePaintUi();
      vehicle.render(0, world.origin); rendering.update(vehicle.car, 0, world.origin); needsRender = true;
    }
    // Free drive's two buttons climb and descend in the helicopter, and jump
    // and sprint on foot (Space and Shift do, see Input), and are named for it
    const driveButtons = { driving: [['Drift', 'Tap + steer'], ['Boost']], flying: [['Climb', 'Hold'], ['Descend']], walking: [['Jump', 'Tap'], ['Sprint']] };
    let driveMode = null;
    function updateDriveUi() {
      const free = started && gameMode === 'free', mode = free && vehicle.pilot ? 'flying' : free && vehicle.walker ? 'walking' : 'driving';
      if (mode === driveMode) return;
      driveMode = mode; document.body.dataset.flying = String(mode === 'flying'); document.body.dataset.walking = String(mode === 'walking'); updateViewUi();
      ['handbrake', 'boost'].forEach((key, i) => {
        const button = $(`[data-drive-button="${key}"]`), [label, hint] = driveButtons[mode][i];
        button.querySelector('span').textContent = label;
        if (hint) button.querySelector('small').textContent = hint;
      });
      $('.controls .control-label').textContent = mode === 'walking' ? 'walk' : mode === 'flying' ? 'fly' : 'drive';
    }
    // Getting out, and into the car within reach: the button beside Jump and
    // Sprint, which is E's and Y's prompt too, says which (see OnFoot.offer)
    const useButton = $('#use-car');
    function updateUseUi() {
      const offer = started && !paused && gameMode === 'free' ? onFoot.offer() : null;
      if (useButton.hidden !== !offer) useButton.hidden = !offer;
      if (!offer) return;
      const label = offer.out ? offer.stopping ? 'Stopping' : 'Get out' : 'Get in', detail = offer.out ? '' : offer.own ? 'Your car' : offer.name;
      if (useButton.querySelector('span').textContent !== label) useButton.querySelector('span').textContent = label;
      if (useButton.querySelector('small').textContent !== detail) useButton.querySelector('small').textContent = detail;
    }
    pressOnRelease(useButton, () => action('use'));
    // After getting in or out: the buttons, the camera and the HUD follow
    function changedCar() {
      updateCarUi(); updateUseUi(); needsRender = true;
    }
    function updateCarUi() {
      updateDriveUi();
      for (const button of carDialog.querySelectorAll('[data-car]')) button.setAttribute('aria-current', String(button.dataset.car === carId));
      $('#current-car').textContent = started && gameMode !== 'free' ? carEntry(vehicle.carId).name : carEntry(carId).name;
      $('#change-car').setAttribute('aria-label', started && gameMode !== 'free' ? 'Garage: free drive only' : `Garage: ${carEntry(carId).name}`);
      updatePaintUi();
    }
    function chooseCar(id) {
      if (started && gameMode !== 'free') return;
      carDialog.close();
      if (id === carId || !CARS[id]) return;
      carId = id;
      try { localStorage.setItem(carStorageKey, id); } catch { /* Still drive it for this visit. */ }
      // One garage car at a time: the new one takes the player where they are,
      // in the nearest lane if they were on foot, and the parked one goes
      if (started) {
        const walked = onFoot.walking;
        onFoot.clear(); vehicle.setCar(id, { paint }); vehicle.render(0, world.origin);
        if (walked) recoverCar();
      }
      autodrive.reset();
      rendering.update(vehicle.car, 0, world.origin);
      updateCarUi(); updateHud(); needsRender = true;
      // (how to fly, on whatever the player is holding)
      const flight = !CARS[id].flies ? '' : vr?.active ? ' · Right stick: climb / descend' : document.body.dataset.controller === 'true' ? ' · Right stick or RB / LB: climb / descend'
        : matchMedia('(pointer: coarse)').matches ? ' · Hold Climb or Descend' : ' · Space / Shift: climb / descend';
      toast(`${carEntry(id).name} selected${flight}`);
    }
    function openCars() {
      if (started && gameMode === 'taxi') { openFleet(); return; }
      if (started && gameMode === 'demolition') { toast('Garage: free drive only'); return; }
      if (!holdForChooser()) return;
      carDialog.showModal();
      carDialog.querySelector(`[data-car="${carId}"]`).focus();
    }
    async function action(name) {
      if (name === 'exitVR') { if (vr?.active) await vr.toggle(); return; }
      if (name === 'recenterVR') { rendering.vrCamera.recenter(); return; }
      if (vr?.active && name.startsWith('vrMenu')) {
        if (name === 'vrMenuConfirm') vrStatus.activate();
        else vrStatus.move(name);
        return;
      }
      if (name === 'fps') {
        fpsCounter.hidden = !fpsCounter.hidden;
        fpsCounter.textContent = 'FPS: …'; fpsStart = null; fpsFrames = 0;
        return;
      }
      if (name === 'fullscreen') { fullscreenOnResume = false; await setFullscreen(!fullscreenActive()); return; }
      if (changingJourney) return;
      const chooser = openChooser();
      if (chooser) {
        if (name === 'menuClose' || (vr?.active && name === 'pause') || (name === 'car' && (chooser === carDialog || chooser === fleetDialog)) || (name === 'map' && chooser === worldMapDialog)) chooser.close();
        if (MENU_MOVES.includes(name)) moveMenuFocus(chooser, name);
        if (name === 'menuConfirm') confirmMenuFocus(chooser);
        return;
      }
      // The pause screen is not modal, so it takes the menu actions and leaves
      // the drive's own shortcuts, such as the garage and the map, to the
      // handling below. B closes it the way it closes a chooser.
      const pauseMenu = openPauseMenu();
      if (pauseMenu && name.startsWith('menu')) {
        if (name === 'menuClose') { if (!runOver()) setPaused(false); }
        else if (name !== 'menuConfirm') moveMenuFocus(pauseMenu, name);
        else confirmMenuFocus(pauseMenu, pauseMenu === pauseOverlay ? $('#resume') : pauseMenu.querySelector('button'));
        return;
      }
      const welcomeMenu = openWelcomeMenu();
      if (welcomeMenu && name.startsWith('menu')) {
        if (name === 'menuConfirm') confirmMenuFocus(welcomeMenu, $('#start'));
        else if (name !== 'menuClose') moveMenuFocus(welcomeMenu, name);
        return;
      }
      // The headset's title is a menu with nothing to pause.
      if (vr?.active && !started && name === 'pause') return;
      // M or View / Share: the city map, from the drive or the pause screen
      if (name === 'map') { if ((started || paused) && !runOver()) openWorldMap(); return; }
      if (name === 'nextJourney') return;
      if (taxi.status === 'over') { if (name === 'reset') beginTaxi(); return; }
      if (demolition.status === 'over') { if (name === 'reset') beginDemolition(); return; }
      if (name === 'car') { openCars(); return; }
      // E, Y or the button: out of the car, or into the one within reach (free drive only)
      if (name === 'use') {
        if (!started || paused || gameMode !== 'free') return;
        if (autodrive.enabled) action('autodrive');
        const said = onFoot.use();
        if (said) toast(said);
        changedCar();
        return;
      }
      if (name === 'autodrive') {
        if (started && gameMode !== 'free') { toast('Autodrive: free drive only'); return; }
        if (!autodrive.enabled && (vehicle.pilot || vehicle.walker)) { toast('Autodrive: cars only'); return; }
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
      // (not the Escape that freed the pointer, when it reaches the page after the pause the freeing made)
      if (name === 'pause' && !(paused && performance.now() - releasedAt < 400)) setPaused(!paused);
      if (name === 'reset') {
        if (taxi.running || demolition.running) { recoverCar(true); return; }
        // A headset keeps its session: back on the road rather than a new city.
        if (vr?.active) { recoverCar(); toast('Car reset'); return; }
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
          const enabled = await audio.toggle(); showSound(enabled);
          toast(enabled ? JOURNEYS[journey].sound : 'Sound off');
        } catch { toast('Sound unavailable'); }
      }
    }
    const input = new Input(action, connected => {
      toast(connected ? controlHelpDismissed() ? 'Controller connected' : 'Controller connected · RT / R2 to drive' : 'Controller disconnected');
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
        vrStatus.attach(vr.session); vrHintTime = 0;
        rendering.enterVR(); rendering.update(vehicle.car, 0, world.origin); updateViewUi();
        rendering.vrCamera.recenter(); graphics.suspend();
        // Holding the headset's own button recentres its space: the game's seat and panels follow.
        renderer.xr.getReferenceSpace()?.addEventListener?.('reset', () => rendering.vrCamera.recenter());
        // The headset opens on a menu with the car standing still: the title,
        // or the pause menu Enter VR was chosen from. Nothing moves, and no
        // shift clock runs, until the player has their bearings and says go.
        if (started) setPaused(true); else haltCar();
        audio.setHidden(!vr.visible); needsRender = true;
        document.body.dataset.vr = 'true';
      },
      onEnd() {
        input.xrActive = false; input.clear();
        vrStatus.update(null); vrStatus.hud(null); graphics.suspend();
        rendering.exitVR(); rendering.update(vehicle.car, 0, world.origin); updateViewUi();
        // Back on the page, a drive waits paused and the title cruises on.
        audio.setHidden(document.hidden); if (started) setPaused(true); else primeMenuDrive();
        needsRender = true;
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
      onSupport: supported => headsetLayout(supported && headsetBrowser()),
    });
    // A headset's own browser shows the page as a flat window whose
    // controllers only point, so there Enter VR leads the title and the pause
    // screen, and targets are touch-sized. A user agent is no feature test,
    // but nothing else tells a Quest's browser from a desktop with a headset.
    function headsetBrowser() { return /OculusBrowser|PicoBrowser|Wolvic|\bVR Safari\b|Mobile VR/.test(navigator.userAgent); }
    function headsetLayout(on) {
      if ((document.documentElement.dataset.headset === 'true') === on) return;
      document.documentElement.dataset.headset = String(on);
      $('#enter-vr').classList.toggle('menu-secondary', !on); for (const id of ['#start', '#demolition']) $(id).classList.toggle('menu-secondary', on);
      if (on) { $('.menu-actions').prepend($('#enter-vr')); $('.pause-column').prepend($('#enter-vr-pause')); }
      else { $('.menu-actions').append($('#enter-vr')); $('.graphics-panel').after($('#enter-vr-pause')); }
    }
    // WebXR needs a secure page, which a headset opening the dev server over
    // the local network is not; say so rather than hide Enter VR unexplained.
    if (headsetBrowser() && !window.isSecureContext) { $('#vr-error').textContent = 'VR needs a secure page. Open Citydriver over HTTPS to play in your headset.'; $('#vr-error').hidden = false; }
    $('#change-car').addEventListener('click', openCars);
    $('#close-cars').addEventListener('click', () => carDialog.close());
    // Fullscreen is the player's to choose, never the game's: F, D-pad Down
    // while driving, or the pause screen's Fullscreen switch, which shows
    // whichever way it is however it got there (F11, the desktop app's own).
    let fullscreenPending = false, leavingFullscreen = false, leftFullscreen = -Infinity, escapeKept = false, releasedAt = -Infinity;
    const desktop = window.citydriverDesktop;
    let desktopFullscreen = false;
    const fullscreenDisplay = window.matchMedia('(display-mode: fullscreen)');
    const fullscreenActive = () => desktop ? desktopFullscreen : Boolean(document.fullscreenElement || document.webkitFullscreenElement || fullscreenDisplay.matches);
    const fullscreenButton = $('#fullscreen');
    function updateFullscreenUi() {
      const on = fullscreenActive();
      if (fullscreenButton.getAttribute('aria-pressed') !== String(on)) fullscreenButton.setAttribute('aria-pressed', String(on));
      if (on) awaitGesture(false);
    }
    // Enters or leaves fullscreen (`quiet`: a page that cannot says nothing)
    async function setFullscreen(on, { quiet = false } = {}) {
      const element = document.fullscreenElement || document.webkitFullscreenElement;
      if (fullscreenPending || (desktop ? on === desktopFullscreen : on === fullscreenActive())) return;
      // (the browser's own, F11 or an installed app's, is not the page's to leave)
      if (!desktop && !on && !element) { if (!quiet) toast(matchMedia('(any-pointer: fine)').matches ? 'Press F11 to leave fullscreen' : 'Fullscreen is set by the browser'); return; }
      // A browser grants fullscreen only inside a click, tap or key press, and
      // a controller's button is none of them
      const gesture = navigator.userActivation?.isActive ?? true;
      fullscreenPending = true;
      try {
        if (!on) leftFullscreen = performance.now();
        if (desktop) {
          desktopFullscreen = await desktop.toggleFullscreen();
        } else if (!on) {
          leavingFullscreen = true;
          await (document.exitFullscreen ?? document.webkitExitFullscreen).call(document);
        } else {
          const request = document.documentElement.requestFullscreen ?? document.documentElement.webkitRequestFullscreen;
          if (!request) { if (!quiet) toast('Fullscreen unavailable'); return; }
          // (asked for from the controller: the next click or key goes fullscreen)
          if (!gesture) { if (!quiet) { awaitGesture(true); toast('Click or press any key for fullscreen'); } return; }
          await request.call(document.documentElement);
        }
      } catch {
        leavingFullscreen = false;
        if (!quiet) toast('Fullscreen unavailable');
      } finally { fullscreenPending = false; updateFullscreenUi(); }
    }
    // Asked for without a gesture, fullscreen waits a few seconds for one
    let gestureTimer = 0;
    function awaitGesture(on) {
      clearTimeout(gestureTimer);
      for (const type of ['pointerup', 'keydown']) window[on ? 'addEventListener' : 'removeEventListener'](type, onGesture, true);
      if (on) gestureTimer = setTimeout(() => awaitGesture(false), 10000);
    }
    function onGesture(event) {
      if (!event.isTrusted || (event.type === 'keydown' && (event.repeat || ['Escape', 'Shift', 'Control', 'Alt', 'Meta'].includes(event.key)))) return;
      awaitGesture(false);
      // (F and the switch go fullscreen themselves)
      if (event.code === 'KeyF' || event.key === 'F11' || event.target.closest?.('#fullscreen')) return;
      void setFullscreen(true, { quiet: true });
    }
    // A browser's fullscreen takes Escape to leave, and the page never hears
    // it. Keyboard Lock (Chromium) hands a tap of Escape to the page, so it
    // pauses and resumes as in a window, and a hold still leaves for good.
    // Without it (Firefox, Safari), leaving fullscreen mid-drive other than
    // by F or the switch pauses, as Escape would, and Resume goes back in.
    document.addEventListener('onfullscreenchange' in document ? 'fullscreenchange' : 'webkitfullscreenchange', () => {
      updateFullscreenUi();
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        navigator.keyboard?.lock?.(['Escape'])?.then(() => { escapeKept = true; }, () => {});
        return;
      }
      const kept = escapeKept; escapeKept = false;
      if (fullscreenActive()) return;
      // (an Escape that freed the pointer may have paused the drive already)
      const driving = started && !vr.active && (!paused || performance.now() - releasedAt < 500);
      if (!leavingFullscreen && driving) { setPaused(true); fullscreenOnResume = !kept; }
      leavingFullscreen = false;
    });
    fullscreenDisplay.addEventListener?.('change', updateFullscreenUi);
    fullscreenButton.addEventListener('click', () => action('fullscreen'));
    // (an iPhone gives a page no fullscreen, so the switch would do nothing)
    fullscreenButton.hidden = !desktop && !(document.fullscreenEnabled || document.webkitFullscreenEnabled);
    updateFullscreenUi();
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
    // Driving in the chase view, the wheel brings the camera in or out, and
    // the mouse looks round the car, or through the player's eyes, once a
    // click on the scene has taken the pointer (in fullscreen, at once)
    const chasing = () => started && !paused && !changingJourney && !vr.active && rendering.chaseView;
    const looking = () => started && !paused && !changingJourney && !vr.active && (rendering.chaseView || rendering.firstPersonView);
    const lookHintKey = 'citydriver-mouse-look';
    let lookHint = 0, lookKnown = false, lookHinted = false;
    try { lookKnown = lookHinted = localStorage.getItem(lookHintKey) === 'known'; } catch { /* Storage is optional. */ }
    const mouseLook = new MouseLook($('#scene'), { lookable: looking, automatic: fullscreenActive, zoomable: chasing, look: rendering.look, zoom: rendering.zoom,
      // Escape frees the pointer, and pauses, as it does everywhere else
      // (unless fullscreen, by F or the switch, took it with it)
      released: () => {
        if (performance.now() - leftFullscreen < 1000) return false;
        setPaused(true); releasedAt = performance.now();
      },
      captured: () => {
        if (lookKnown) return;
        lookKnown = lookHinted = true;
        try { localStorage.setItem(lookHintKey, 'known'); } catch { /* Known for this visit. */ }
      } });
    // A first drive with a mouse says, once, how to look round with it
    function hintMouseLook(dt) {
      if (lookHinted || !looking() || !mouseLook.mouse.matches || mouseLook.locked || input.gamepad.connected || controlHelpDismissed() || Math.abs(vehicle.speed) < 2) return;
      lookHint += dt;
      if (lookHint < 5) return;
      lookHinted = true;
      toast('Click to look around with the mouse');
    }
    // On foot through their own eyes, the sides step aside when a mouse or a
    // stick can turn the view (see walkingInput); otherwise they turn it
    const strafing = () => vr.active || input.gamepad.connected || mouseLook.locked;
    // A touch acts on pointerup: a secondary finger may not synthesize a
    // click while the stick is held (and see pressOnRelease).
    for (const name of ['pause', 'view']) pressOnRelease($(`#${name}`), () => action(name));
    for (const name of ['reset', 'sound']) $(`#${name}`).addEventListener('click', () => action(name));
    for (const dialog of choosers) {
      dialog.addEventListener('close', () => {
        if (!changingJourney) setPaused(journeyWasPaused || document.hidden);
        if (runOver()) pauseOverlay.hidden = true;
        if (dialog === fleetDialog) fleetReturnFocus?.focus();
        if (dialog === worldMapDialog && paused && !pauseOverlay.hidden) $('#open-world-map').focus();
      });
      dialog.addEventListener('click', event => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
      });
    }
    $('#start').addEventListener('click', start);
    $('#free-drive').addEventListener('click', beginFree);
    $('#taxi-retry').addEventListener('click', beginTaxi);
    $('#taxi-free').addEventListener('click', beginFree);
    $('#demolition').addEventListener('click', beginDemolition);
    $('#demolition-retry').addEventListener('click', beginDemolition);
    $('#demolition-taxi').addEventListener('click', beginTaxi);
    $('#demolition-free').addEventListener('click', beginFree);
    $('#restart-run').addEventListener('click', () => gameMode === 'demolition' ? beginDemolition() : gameMode === 'taxi' ? beginTaxi() : action('reset'));
    $('#switch-mode').addEventListener('click', () => gameMode === 'free' ? beginTaxi() : beginFree());
    $('#other-run').addEventListener('click', () => gameMode === 'demolition' ? beginTaxi() : beginDemolition());
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
    window.addEventListener('pagehide', event => { audio.setHidden(true); if (!event.persisted) { nightLighting.dispose(); props.dispose(); world.dispose(); weather.dispose(); traffic.dispose(); taxiView.dispose(); demolitionView.dispose(); void audio.dispose().catch(() => {}); } });
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
      // Show the drawing buffer, which is what the quality level changes: it
      // explains a softer picture.
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
      applyWeather();
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
      const district = cityDistrict(vehicle.s, vehicle.u);
      text('#city-location', district);
      text('#world-map-here', district);
      text('#weather-label', weather.state.label);
      cityGuide.update(started && !paused && !changingJourney);
      if (gameMode === 'demolition') demolitionView.hud(demolition, vehicle);
      else taxiView.hud(taxi, vehicle, started && gameMode === 'free');
      updateUseUi();
      if (vr?.active) vrStatus.hud(vrHudModel());
    }
    function updateViewUi() {
      $('#view').title = `${rendering.viewLabel} · Change camera (V)`;
      $('#view').setAttribute('aria-label', `${rendering.viewLabel}. Change camera`);
      const thirdPerson = rendering.camera.isPerspectiveCamera, flying = document.body.dataset.flying === 'true', walking = document.body.dataset.walking === 'true';
      $('.stick-help-copy').firstChild.textContent = walking ? rendering.firstPersonView ? 'Touch anywhere · ↑ Walk · ↔ Turn' : 'Drag anywhere to walk' : thirdPerson ? `Touch anywhere · ↑ ${flying ? 'Fly' : 'Drive'} · ↔ ${flying ? 'Turn' : 'Steer'}` : `Drag anywhere to ${flying ? 'fly' : 'drive'}`;
      $('.stick-help-line').textContent = walking ? 'Push further to run' : flying ? thirdPerson ? '↓ Back · Release to hover' : 'Release to hover' : thirdPerson ? '↓ Brake · Release to stop' : 'Release to stop';
      $('#touch-stick').setAttribute('aria-label', walking ? 'Virtual joystick: push the way to walk, further to run' : thirdPerson ? 'Virtual joystick: up to accelerate, left and right to steer, down to brake or reverse, release to stop' : 'Virtual joystick');
    }
    // The headset's menus: the page's own choices, drawn by VRStatus.
    const VR_CONTROLS = 'Right trigger: gas · Left trigger: brake\nLeft stick: steer · Left grip: drift\nRight grip: boost · A: camera · B: pause';
    // (in free drive, Y gets out of the car, and into another)
    const vrControls = () => started && gameMode === 'free' ? `${VR_CONTROLS} · Y: get out` : VR_CONTROLS;
    const VR_POINTING = 'Point and pull the trigger, or use either stick and A · B: back';
    function vrMenuModel() {
      if (!vr.active) return null;
      if (changingJourney) return { id: 'loading', title: 'Loading…', subtitle: 'Your drive will be ready shortly', items: [] };
      const back = chooser => ({ label: 'Back', footer: true, activate: () => chooser.close() });
      const chooser = openChooser();
      if (chooser === worldMapDialog) return { id: 'map', title: 'City map', subtitle: hereText(), image: vrMapCanvas, imageKey: vrMapKey, items: [back(chooser)], hint: 'B: back' };
      if (chooser) {
        const fleet = chooser === fleetDialog;
        // Each of the page chooser's buttons, pressed as the page would press it
        const buttons = [...chooser.querySelectorAll(fleet ? '[data-fleet-car], [data-livery]' : '[data-car], [data-paint]')];
        const items = buttons.map(button => {
          const [name, state = ''] = (button.getAttribute('aria-label') ?? button.querySelector('.chooser-card-title')?.textContent ?? button.textContent).trim().split(': ');
          const { paint, livery, fleetCar } = button.dataset, swatch = paint === DEFAULT_PAINT ? ownPaint(carId) : paint ?? button.style.getPropertyValue('--swatch');
          // A cab shows its price or that it is owned; a locked livery the rank that opens it.
          const value = fleetCar ? state.startsWith('Buy') ? state.split(' · ')[1] : state === 'Select cab' ? 'Owned' : ''
            : livery && button.disabled ? state.replace(/^unlocks at (.*) rank$/, '$1') : '';
          return { label: name, value, swatch: swatch || undefined, group: fleet ? livery ? 'Livery' : 'Cabs' : paint ? 'Paint' : 'Cars',
            current: ['aria-current', 'aria-checked', 'aria-pressed'].some(attribute => button.getAttribute(attribute) === 'true'), disabled: button.disabled, activate: () => button.click() };
        });
        return { id: chooser.id, title: fleet ? 'Taxi fleet' : 'Garage', subtitle: fleet ? `Fleet balance ${$('#fleet-balance').textContent} · Faster cabs fit more fares into a run` : 'Paint applies to all cars',
          flow: true, items: [...items, back(chooser)], hint: VR_POINTING };
      }
      if (demolition.status === 'over') return { id: 'demolition-results', title: `Time up · ${$('#demolition-result-score').textContent}`,
        subtitle: [$('#demolition-rank-name').textContent, $('#demolition-rank-next').textContent].filter(Boolean).join(' · '), hint: VR_POINTING, items: [
          { label: 'Play again', primary: true, activate: beginDemolition }, { label: 'Taxi run', activate: beginTaxi }, { label: 'Free drive', activate: beginFree },
          { label: 'Exit VR', footer: true, activate: () => action('exitVR') },
        ] };
      if (taxi.status === 'over') return { id: 'taxi-results', title: `Time up · ${$('#taxi-result-cash').textContent}`, subtitle: [$('#taxi-license-name').textContent, $('#taxi-result-best').textContent].join(' · '), hint: VR_POINTING, items: [
        { label: 'Play again', primary: true, activate: beginTaxi }, { label: 'Taxi fleet', activate: openFleet }, { label: 'Free drive', activate: beginFree },
        { label: 'Exit VR', footer: true, activate: () => action('exitVR') },
      ] };
      if (!started) return { id: 'title', title: 'citydriver', wordmark: true, mark: $('.brand-mark'), subtitle: 'Pick up. Drop off. Beat the clock.', hint: VR_CONTROLS, items: [
        { label: 'Start run', primary: true, activate: beginTaxi }, { label: 'Demolition', activate: beginDemolition }, { label: 'Free drive', activate: beginFree },
        { label: 'Exit VR', activate: () => action('exitVR') },
      ] };
      if (!paused) return null;
      const taxiMode = gameMode === 'taxi', cycle = (list, value) => list[(list.indexOf(value) + 1) % list.length];
      const drive = (label, activate, extra) => ({ group: 'Driving', label, activate, ...extra });
      const option = weatherSelect.options[weatherSelect.selectedIndex];
      return { id: 'pause', title: 'Paused', subtitle: `${cityDistrict(vehicle.s, vehicle.u)} · ${hud.distance.textContent} mi driven`, columns: 2, hint: vrControls(), items: [
        { label: 'Resume', primary: true, header: true, activate: () => setPaused(false) },
        ...(taxiMode ? [drive('Restart run', beginTaxi), drive('Free drive', beginFree), drive('Demolition', beginDemolition), drive('Taxi fleet', openFleet, { value: carEntry(taxi.fleet.selected).name })]
          : gameMode === 'demolition' ? [drive('Restart run', beginDemolition), drive('Free drive', beginFree), drive('Taxi run', beginTaxi)]
          : [drive('Taxi run', beginTaxi), drive('Demolition', beginDemolition), drive('Garage', openCars, { value: carEntry(carId).name }),
            drive('Autodrive', () => action('autodrive'), { toggle: autodrive.enabled }), drive('Traffic', () => $('#traffic').click(), { toggle: traffic.enabled })]),
        drive('Reset car', () => action('reset'), { value: taxi.running || demolition.running ? '−5 seconds' : '' }),
        { group: 'The city', label: 'City map', value: cityDistrict(vehicle.s, vehicle.u), activate: openWorldMap },
        { group: 'The city', label: 'Weather', value: option?.textContent, activate: () => { weatherSelect.selectedIndex = (weatherSelect.selectedIndex + 1) % weatherSelect.options.length; weatherSelect.dispatchEvent(new Event('change')); } },
        { column: 1, group: 'View', label: 'Camera', value: rendering.viewLabel.replace(/ view$/, ''), activate: () => action('view') },
        { column: 1, group: 'View', label: 'Recenter view', activate: () => action('recenterVR') },
        { column: 1, group: 'View', label: 'Comfort vignette', toggle: comfort.enabled, activate: toggleComfort },
        { column: 1, group: 'View', label: 'Graphics', value: graphics.auto ? 'Auto' : graphics.settings.label, activate: () => graphics.setMode(cycle(['auto', 'high', 'balanced', 'smooth', 'basic'], graphics.mode)) },
        { column: 1, group: 'Sound', label: 'Sound', toggle: $('#sound').getAttribute('aria-pressed') === 'true', activate: () => action('sound') },
        { column: 1, group: 'Sound', label: 'Sound mix', value: audio.preset[0].toUpperCase() + audio.preset.slice(1), activate: () => { audio.setPreset(cycle(['balanced', 'scenic', 'night'], audio.preset)); refreshAudioMixer(); } },
        { label: 'Exit VR', footer: true, activate: () => action('exitVR') },
      ] };
    }
    // The headset's HUD says what the page's HUD says: taxiView.hud() and
    // updateHud() keep the page's current whether or not it is on screen.
    function vrHudModel() {
      if (!vr.active || !started || paused || changingJourney) return null;
      const read = id => document.getElementById(id).textContent;
      const hint = vrHintTime >= 10 ? '' : vehicle.pilot ? 'Triggers: forward, back · Left stick: turn · Right stick or grips: up, down · B: pause'
        : vehicle.walker ? 'Left stick: walk · Right stick: look · Left grip: jump · Right grip: sprint · Y: get in · B: pause'
          : `Right trigger: gas · Left trigger: brake · Left stick: steer · Grips: drift, boost${gameMode === 'free' ? ' · Y: get out' : ''} · B: pause`;
      if (!taxi.running && !demolition.running) return { heading: read('city-heading'), place: read('city-location'), weather: read('weather-label'), hint };
      // (a demolition run writes its chain into the same panels)
      const pickup = taxi.status === 'pickup', timer = $('#taxi-timer');
      return { taxi: true, clockLabel: read('taxi-clock-label'), clock: read('taxi-clock'), urgent: $('#taxi-clock').dataset.urgent === 'true', cash: read('taxi-cash'), fares: read('taxi-fares'),
        stage: [read('taxi-stage'), read('taxi-fare-status')].filter(Boolean).join(' · '), title: read('taxi-task-title'),
        distance: pickup || $('#taxi-nav').hidden ? '' : read('taxi-nav-distance'),
        detail: pickup ? [read('taxi-party'), read('taxi-task-detail')].filter(Boolean).join(' · ')
          : read('taxi-task-detail') || read('taxi-next-stop') || [read('taxi-party'), read('taxi-combo')].filter(Boolean).join(' · '),
        // (to the percent: each change redraws and uploads the HUD's texture)
        timer: timer.hidden ? null : { text: read('taxi-timer'), tone: timer.dataset.rating, fraction: Math.round(parseFloat($('#taxi-timer-fill').style.width)) / 100 || 0 }, hint };
    }
    // (what the controls ask of the player on foot, refilled each step)
    const walking = { walk: { x: 0, z: 0 } };
    const simulate = dt => {
      // (the autodrive drives cars: the helicopter is not one, nor are feet)
      if (autodrive.enabled && (vehicle.pilot || vehicle.walker)) action('autodrive');
      let state = started ? input.state : {};
      if (autodrive.enabled && (state.forward || state.brake || state.left || state.right || state.handbrake || state.touchStick)) action('autodrive');
      // Cruise behind the welcome menu without toggling the player's setting
      // or showing a notification. Starting hands control straight to input.
      // In a headset the title holds the car still: a drive nobody is
      // steering makes for an uneasy start.
      if (!started && vr.active) state = {};
      else if (!started || autodrive.enabled) state = autodrive.update(vehicle, traffic, started ? vehicle.stats.topSpeed : MENU_CRUISE_SPEED, dt);
      // On foot the stick and keys point the way to walk, from the camera's point of view
      if (vehicle.walker) state = walkingInput(state, rendering.camera, { firstPerson: rendering.firstPersonView, strafe: strafing() }, walking);
      else if (state.touchStick) {
        if (rendering.camera.isPerspectiveCamera) {
          const touch = thirdPersonDrivingInput(state.touchStick);
          touch.handbrake ||= state.handbrake;
          state = { ...state, ...touch };
        }
        else state.touchDrive = touchDrivingInput(state.touchStick, rendering.camera, vehicle.route, vehicle.s, vehicle.u, world.origin);
      }
      if (paused || changingJourney) return;
      if (taxi.running) state = taxi.controls(dt, state);
      else if (demolition.running) state = demolition.controls(dt, state);
      // (stopping, to get out)
      state = onFoot.control(state);
      vehicle.update(dt, state);
      if (started) updateControlHelp(vehicle.speed);
      // Furniture the player hits may be knocked flying, and a parked car
      // knocked loose while there is traffic to take it; on foot, nothing is
      collideScenery(vehicle, world.chunks, dt, vehicle.walker ? null : (collider, contact) => collider.prop ? props.hit(collider, contact, vehicle) : traffic.enabled && traffic.wake(collider));
      traffic.update(dt, vehicle, world.chunks);
      // Out of the car once it has stopped, and the car left parked
      const walked = onFoot.walking, said = onFoot.update(dt, world.chunks);
      if (said) toast(said);
      if (onFoot.walking !== walked) changedCar();
      props.update(dt, vehicle, traffic, world.chunks);
      if (started && taxi.running) {
        taxi.update(dt, vehicle, traffic.enabled ? traffic.vehicles : []);
        for (const event of taxi.drainEvents()) {
          if (event.kind === 'over') {
            haltCar();
            setPaused(true); pauseOverlay.hidden = true; taxiView.hud(taxi, vehicle); taxiView.results(taxi); fleetView.render(); $('#taxi-retry').focus();
          } else if (event.kind === 'goal') {
            // A goal usually completes on a payout, whose toast lands first.
            renderGoals(); setTimeout(() => { if (taxi.running && !paused) { toast(event.text, 'goal'); audio.cue('goal'); } }, 1500);
          } else { toast(event.text, event.rating ?? (event.kind === 'missed' ? 'slow' : '')); audio.cue(event.kind, event); }
        }
        // The shift's last ten seconds tick away
        const left = Math.ceil(taxi.timeLeft);
        if (left < shiftTick && left <= 10 && left > 0) audio.cue('tick', { urgent: left <= 5 });
        shiftTick = left;
      }
      if (started && demolition.running) {
        demolition.update(dt);
        for (const event of demolition.drainEvents()) demolitionEvent(event);
        const left = Math.ceil(demolition.timeLeft);
        if (left < shiftTick && left <= 10 && left > 0) audio.cue('tick', { urgent: left <= 5 });
        shiftTick = left;
      }
    };
    // What a demolition run has to say: prices float up off the wreckage, and
    // the chain's news, a takedown's time and a fine take the panel's last line
    function demolitionEvent(event) {
      if (event.kind === 'smash' || event.kind === 'dent') { demolitionView.pop(event); audio.cue('smash', event); }
      else if (event.kind === 'wreck') {
        demolitionView.pop(event); audio.cue('wreck');
        if (event.seconds) { demolitionView.pop({ ...event, kind: 'bonus' }); toast(`Takedown · +${event.seconds}s`, 'bonus'); audio.cue('bonus'); }
      } else if (event.kind === 'multiplier') { toast(event.text, 'chain'); audio.cue('multiplier', event); }
      else if (event.kind === 'banked') {
        toast(event.text, 'banked'); audio.cue('banked');
        // (a new rating is its own news, a moment later, as a taxi goal is)
        if (event.rank) setTimeout(() => { if (demolition.running && !paused) { toast(`Rating · ${event.rank.name}`, 'goal'); audio.cue('goal'); } }, 1300);
      } else if (event.kind === 'penalty') { demolitionView.pop(event); toast(event.text, 'slow'); audio.cue('penalty'); }
      else if (event.kind === 'over') {
        haltCar();
        setPaused(true); pauseOverlay.hidden = true; demolitionView.hud(demolition, vehicle); demolitionView.results(demolition); $('#demolition-retry').focus();
      }
    }
    function frame(timestamp, xrFrame) {
      vrStatus.update(vrMenuModel());
      // (in free drive, Y gets in and out of cars)
      const freeDrive = started && gameMode === 'free';
      if (vr.active) input.xr.update(vr.session.inputSources, { blocked: !vr.visible || changingJourney, paused: paused || vrStatus.visible, freeDrive });
      else {
        input.gamepad.update({ blocked: document.hidden || !document.hasFocus() || changingJourney, paused, menu: openChooser() ? 'chooser' : openPauseMenu() ? 'pause' : openWelcomeMenu() ? 'welcome' : false, freeDrive });
        const menu = input.gamepad.scroll && (openChooser() ?? openPauseMenu() ?? openWelcomeMenu());
        if (menu) scrollMenu(menu, input.gamepad.scroll * 18);
      }
      mouseLook.update();
      const running = !paused && !hidden();
      frameClock.tick(timestamp, running, simulate);
      const dt = frameClock.dt;
      if (running) {
        time += dt;
        if (vr.active && started && (Math.abs(vehicle.speed) > 2 || vehicle.airborne)) vrHintTime += dt;
        // The right stick looks round in the chase view and through the
        // player's eyes, as the mouse does (a headset's only turns, and the
        // helicopter's only turns when pushed more across than up or down,
        // which climb). On foot through their own eyes, with no mouse or
        // stick to turn the view, the sides turn it.
        if (started && (rendering.chaseView || rendering.firstPersonView)) {
          const stick = vr.active ? input.xr.state : input.gamepad.state, flying = Boolean(vehicle.pilot);
          let yaw = stick.lookX || 0;
          if (flying && Math.abs(yaw) <= Math.abs(stick.lookY || 0)) yaw = 0;
          const pitch = vr.active || flying ? 0 : stick.lookY || 0;
          if (vehicle.walker && rendering.firstPersonView && !strafing()) { const keys = input.state; yaw += keys.touchStick?.x || keys.moveX || 0; }
          if (yaw || pitch) rendering.look(yaw * STICK_LOOK * dt, pitch * STICK_LOOK * dt);
        }
        hintMouseLook(dt);
        world.update(vehicle.s, vehicle.u, { budgetMs: 3 }); vehicle.render(frameClock.alpha, world.origin); onFoot.render(frameClock.alpha, world.origin);
        traffic.render(frameClock.alpha, world.origin); props.render(frameClock.alpha, world.origin);
        pedestrianContacts.update(vehicle, traffic, time, props);
        rendering.update(vehicle.car, dt, world.origin); world.animate(time, traffic.time, vr.active ? null : rendering.camera, pedestrianContacts);
        taxiView.render(taxi, vehicle, world.origin, time, pedestrianContacts);
        demolitionView.render(world.origin, time, vr.active ? null : rendering.camera);
        applyWeather(dt);
      }
      // (a helicopter's climbs and dives count as surges too)
      comfort.update(rendering.camera, vehicle.pilot ? Math.hypot(vehicle.speed, vehicle.pilot.vy) : vehicle.speed, running ? dt : 0, vr.active && running && started);
      soundScene.interior = rendering.viewLabel === 'First-person view' && !vehicle.walker;
      soundScene.lightning = weather.flash; soundScene.rain = weather.state.rain; soundScene.wetness = weather.state.wetness;
      soundScene.snow = weather.state.snow; soundScene.night = weather.state.stars;
      // Where the car is, for the soundscape (twice a second, and only with sound on)
      if (audio.enabled) {
        soundScene.deck = waterAt(vehicle.s, vehicle.u) && surfaceAt(vehicle.s, vehicle.u) === 'road';
        if (!(timestamp - placeTime < 500)) { soundScene.place = citySoundscape(vehicle.s, vehicle.u); placeTime = timestamp; }
      }
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
        taxiView.navigation.float(taxi, vehicle, vehicle.car, rendering.camera, { visible: vr.active, ahead: soundScene.interior });
        vrStatus.update(vrMenuModel());
        rendering.render(xrFrame, () => {
          vrStatus.point(xrFrame, renderer.xr.getReferenceSpace(), rendering.vrCamera.rig, vr.visible && !changingJourney);
          vrStatus.update(vrMenuModel());
        }); needsRender = false;
        if (!sceneReady) { sceneReady = true; $('#loading').classList.add('loaded'); }
      }
      updateFPS(timestamp, rendered);
    }
    // The streets round the car, then the skyline, each named on the loading screen
    await loadingStage('buildings');
    world.update(vehicle.s, vehicle.u, { skyline: false });
    while (world.pending.length) world.update(vehicle.s, vehicle.u, { skyline: false });
    await loadingStage('skyline');
    world.update(vehicle.s, vehicle.u);
    applyWeather();
    buildCarCards(); buildPaintSwatches(); updateCarUi();
    vehicle.render(0, world.origin); traffic.render(1, world.origin); rendering.update(vehicle.car, 1, world.origin); updateHud(); updateJourneyUi(); updateViewUi(); updateGraphicsUi();
    nightLighting.update(world, vehicle, traffic, weather.state.lightLevel);
    await loadingStage('graphics');
    // (the shop signs are blank until their sheet has loaded)
    await signSheet;
    await rendering.precompile([...world.warmupObjects(), ...taxiView.warmupObjects(), ...demolitionView.warmupObjects(), createWalkerModel().figure]);
    try { taxiView.navigation.prepare(); } catch { /* The first fare tries again. */ }
    // Soft shading too, where it is on: loaded and drawn once behind the
    // loading screen, since its first frame compiles for ~200 ms.
    await rendering.ambientOcclusion.prepare();
    changingJourney = false;
    renderer.setAnimationLoop(frame);
    // `?xr` in development emulates a Quest 3 (see xr-emulator.js).
    const emulate = new URLSearchParams(window.location.search).get('xr');
    if (import.meta.env.DEV && emulate !== null) (await import('./xr-emulator.js')).installXREmulator(emulate);
    void vr.detect();
    // Development-only inspection surface for automated driving and streaming checks.
    if (import.meta.env.DEV) window.__citydriver = { seed: SEED, city: CITY, nav: navGraph(), lanePose, roadAt, nearestLanePose, vehicle, onFoot, traffic, props, nightLighting, weather, autodrive, audio, graphics, vr, vrStatus, cityGuide, taxi, taxiView, beginTaxi, beginFree, demolition, demolitionView, beginDemolition, get gameMode() { return gameMode; }, world, rendering, input, action, chooseCar, applyPaint, get carId() { return carId; }, get paint() { return paint; }, get journey() { return journey; }, get changingJourney() { return changingJourney; }, get paused() { return paused; }, get started() { return started; } };
  } catch (error) { console.error('Could not start Citydriver:', error); $('#loading').classList.add('loaded'); $('#error').hidden = false; }
}
boot();
