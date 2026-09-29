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
import { createFleetMenu, garageModel } from './chooser-model.js';
import { menuControls, menuModel, WEATHER_CHOICES, cycleChoice } from './menu-model.js';
import { bindMenuControls, renderMenuControls } from './menu-dom.js';
import { locationHudModel, headsetHudModel } from './run-hud-model.js';
import { renderLocationHud, renderRunHud } from './run-hud-dom.js';
import { taxiResultModel, demolitionResultModel } from './result-model.js';
import { createRendering } from './rendering.js';
import { FRAME_CAPS, Graphics, headsetBrowser } from './graphics.js';
import { JOURNEYS } from './journeys.js';
import { CARS, DEFAULT_CAR, ROUTE_PAINT, carEntry } from './cars.js';
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
import { CITY_PLACES } from './world/city-places.js';
import { Pigeons } from './world/city-pigeons.js';
import { WorldMap, DISTRICT_COLORS } from './city-world-map.js';
import { TaxiRun } from './taxi-run.js';
import { goalProgress } from './taxi-goals.js';
import { TaxiView } from './taxi-view.js';
import { DemolitionRun, DEMOLITION_CAR, DEMOLITION_PAINT } from './demolition-run.js';
import { DemolitionView } from './demolition-view.js';
import { setResidentWindow } from './world/resident.js';
import { PlayerController } from './vehicle.js';
import { OnFoot, EnterMarker } from './on-foot.js';
import { walkingInput, createWalkerModel } from './walker.js';
import { CityTraffic as Traffic } from './city-traffic.js';
import { TRAFFIC_CRUISE_SPEED } from './traffic.js';
import { collideScenery, sightLine, cameraClearance } from './collision.js';
import { PedestrianContacts } from './world/pedestrian-reactions.js';
import { CityAutodrive as Autodrive } from './city-autodrive.js';
import { Input } from './input.js';
import { touchDrivingInput, thirdPersonDrivingInput, pressOnRelease } from './touch-stick.js';
import { MouseLook } from './mouse-look.js';
import { DriveAudio } from './audio.js';
import { setupAudioMixer } from './audio/mixer.js';
import { FrameClock, FramePacer } from './timing.js';
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
let paused = false, started = false, time = 0, hudTime = 0, gameMode = 'taxi';
document.body.dataset.mode = gameMode;
const frameClock = new FrameClock(), pacer = new FramePacer();
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
      // (the page's fare arrow has its own WebGL context, which a headset can't see)
      beforeDraw: camera => { if (!vr?.active) taxiView.navigation.update(taxi, vehicle, camera); } });
    const { renderer, scene } = rendering;
    let vr, vrHintTime = 0, vrMapCanvas = null, vrMapKey = 0;
    const vrStatus = new VRStatus(rendering.vrCamera.camera, rendering.vrCamera.anchor);
    rendering.vrCamera.nearLimit = () => vrStatus.visible ? .1 : .2;
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
    rendering.setGround((x, z) => cityHeight(world.origin - z, x), (x, z) => Boolean(vehicle.route.under?.(world.origin - z, x)));
    rendering.setCameraClearance(point => Math.max(.1, Math.min(
      (point.y - cityHeight(world.origin - point.z, point.x)) * .5,
      cameraClearance(world.chunks.values(), point, world.origin))));
    const weather = new CityWeather(scene);
    try { weather.setMode(localStorage.getItem('citydriver-weather') ?? 'auto', { immediate: true }); } catch { /* Storage is optional. */ }
    let changingJourney = true, journeyWasPaused = false;
    // The menu cruises in a cab; starting either mode applies its own saved car.
    const vehicle = new PlayerController(JOURNEYS[journey].route, journeyStart(), 'taxi'); const audio = new DriveAudio();
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
    const carDialog = $('#car-dialog'), pauseOverlay = $('#pause-overlay');
    const fleetDialog = $('#taxi-fleet-dialog'), worldMapDialog = $('#world-map-dialog');
    const choosers = [carDialog, fleetDialog, worldMapDialog];
    const chooserDialogs = { garage: carDialog, fleet: fleetDialog, map: worldMapDialog };
    let chooserName = null;
    const openChooser = () => chooserDialogs[chooserName] ?? null;
    // A chooser pauses the drive over the pause screen; closing it restores
    // whatever pause state it found (see the dialogs' close handlers).
    function holdForChooser() {
      if (changingJourney || openChooser()) return false;
      journeyWasPaused = paused; setPaused(true); pauseOverlay.hidden = true;
      return true;
    }
    // The pause screen is a menu too: it is up whenever the drive is paused
    // with no chooser over it, and the controller walks it the same way.
    const resultsCard = () => taxi.status === 'over' ? $('#taxi-results') : demolition.status === 'over' ? $('#demolition-results') : null;
    const openPauseMenu = () => resultsCard() ?? (paused && !openChooser() ? pauseOverlay : null);
    // The title screen is a menu of its own until a drive begins.
    const openWelcomeMenu = () => !started && !paused ? $('#welcome') : null;
    scene.add(vehicle.car);
    const traffic = new Traffic(scene, vehicle.route, vehicle.s, journey, vehicle.u);
    // (and the bus calls at the world's stops)
    traffic.stops = world.busStops;
    // Street furniture knocked loose (see loose-props.js), which loose traffic can knock over too
    const props = new LooseProps(scene, world.materials.props);
    traffic.props = props;
    // (and takes the player on foot, when a car knocks them over)
    vehicle.props = props;
    // Getting out of the car and into another, in free drive (see on-foot.js),
    // and on foot, a marker over the car they would get into
    const onFoot = new OnFoot(vehicle, traffic), enterMarker = new EnterMarker(scene);
    const pedestrianContacts = new PedestrianContacts();
    onFoot.world = world;
    // Pigeons round the benches, which the player puts up on foot or driving
    // by (see city-pigeons.js), with a flutter of wings (see DriveAudio)
    const pigeons = new Pigeons(scene, world.materials.props);
    pigeons.onFlight = (x, z, count) => props.sounds.push({ kind: 'flutter', strength: 6 + count, x, z });
    // (on the pavement, a park or a square: not the road or the water)
    const pigeonGround = (x, z) => surfaceAt(-z, x) === 'pavement' ? cityHeight(-z, x) + .02 : NaN;
    const nightLighting = new NightLighting(scene);
    // The weather's light, sky and wet roads, on the scene and every car
    function applyWeather(dt = 0) {
      weather.update(time, vehicle, world.origin); rendering.setWeather(weather.state, dt);
      world.setWetness(weather.state.wetness); world.setWindowGlow(weather.state.windowGlow); vehicle.setLights(weather.state.lightLevel); traffic.models.setLights(weather.state.lightLevel);
      // (and what a footstep kicks up: see Walker.puff. Snow lies on nothing, so it is slush.)
      props.underfoot = weather.state.snow > .35 || weather.state.wetness > .35 ? 'spray' : 'dust';
    }
    const haltCar = () => { vehicle.speed = 0; vehicle.knock.x = vehicle.knock.z = vehicle.knock.spin = 0; vehicle.pilot?.stop(); vehicle.walker?.stop(); vehicle.update(0, {}); };
    const drawScene = rendering.render;
    rendering.render = (...args) => {
      nightLighting.update(world, vehicle, traffic, weather.state.lightLevel);
      return drawScene(...args);
    };
    // No discovery toasts during a run: they cover the task card's instruction
    const cityGuide = new CityGuide(text => { if (started && gameMode !== 'free') return; toast(text); audio.cue('discovery'); }, () => vehicle);
    let taxiStorage; try { taxiStorage = localStorage; } catch { /* Optional storage. */ }
    const taxi = new TaxiRun(taxiStorage), taxiView = new TaxiView(scene, taxiStorage); cityGuide.taxi = taxi;
    // (the street map marks the car the player left parked)
    cityGuide.onFoot = onFoot;
    // Demolition: the truck's timed run, scored by the damage it does (see
    // demolition-run.js). While it runs, everything knocked loose is the
    // truck's doing, directly or through what it sent flying; ordinary
    // traffic knocking someone over is not.
    const demolition = new DemolitionRun(taxiStorage), demolitionView = new DemolitionView(scene, taxiStorage);
    props.onSmash = (kinds, at) => demolition.smash(kinds, at);
    traffic.onDamage = (car, closing) => demolition.damageCar(car, closing);
    pedestrianContacts.onKnock = (by, at, kind) => { if (by !== 'traffic') demolition.pedestrian(at, by, kind); };
    // The street map marks what the open contracts ask for where the city
    // has few of them (trees and lamps are on every street): bus shelters,
    // traffic lights, parked cars and traffic. A fresh list twice a second.
    cityGuide.demolition = demolition;
    let targets = [], targetsAt = -Infinity;
    cityGuide.targets = () => {
      if (performance.now() - targetsAt < 500) return targets;
      targetsAt = performance.now(); targets = [];
      const open = new Set(demolition.contracts.filter(contract => !contract.done).map(contract => contract.id));
      const kinds = [...open.has('shelters') ? ['shelter'] : [], ...open.has('signals') ? ['signal', 'mast'] : []];
      if (kinds.length || open.has('parked')) {
        for (const chunk of world.chunks.values()) for (const collider of chunk.features?.colliders ?? []) {
          if (collider.woken) continue;
          if (collider.prop?.ready ? kinds.includes(collider.prop.pieces[0].kind) : open.has('parked') && collider.parked?.ready) targets.push({ u: collider.x, s: -collider.z });
        }
      }
      if (open.has('takedowns') && traffic.enabled) for (const car of traffic.vehicles) if (car.car.visible && !car.loose) targets.push({ u: car.position.x, s: -car.position.z });
      return targets;
    };
    const runOver = () => taxi.status === 'over' || demolition.status === 'over';
    const fleetMenu = createFleetMenu(taxi.fleet, { running: () => taxi.running, career: taxi.career, onChange: () => { needsRender = true; },
      // A livery is only paint, so unlike a cab it can change mid-run.
      onLivery: color => { if (started && gameMode === 'taxi') { vehicle.setPaint(color); vehicle.render(0, world.origin); rendering.update(vehicle.car, 0, world.origin); } } });
    const fleetView = setupTaxiFleet(fleetMenu);
    // The pause screen lists the shift's goals with live progress (in a
    // demolition run, its contracts and the high score table).
    function renderGoals() {
      if (gameMode === 'demolition') { demolitionView.contracts(demolition); demolitionView.scores(demolition); return; }
      const goals = gameMode === 'taxi' && taxi.status !== 'idle' ? taxi.goals : [], stats = taxi.stats;
      $('#shift-goals').innerHTML = goals.map(goal => {
        const progress = goal.done ? goal.target : goalProgress(goal, stats);
        return `<li data-done="${goal.done}"><span class="goal-check" aria-hidden="true">${goal.done ? '✓' : '○'}</span><span class="goal-copy"><strong>${goal.text}</strong><small>${goal.done ? `+$${goal.bonus} banked` : `${progress} / ${goal.target} · $${goal.bonus}`}</small></span></li>`;
      }).join('');
      $('#goals-summary').textContent = goals.length ? `${goals.filter(goal => goal.done).length} of ${goals.length} · Bonuses bank to your fleet` : '';
    }
    let fleetReturnFocus;
    function openFleet() {
      // (pausing focuses Resume, so note the focus first)
      const focus = document.activeElement;
      if (!holdForChooser()) return;
      fleetReturnFocus = focus;
      fleetView.render(); $('#fleet-feedback').textContent = ''; fleetDialog.showModal(); chooserName = 'fleet';
      fleetDialog.querySelector(`[data-fleet-car="${taxi.fleet.selected}"]`).focus();
    }
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
      worldMap.draw(worldMapCanvas, vehicle, onFoot.parked, cityGuide.foundPlaces());
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
          + '<li id="world-map-places"><span class="world-map-place"></span>Places found<small></small></li>'
          + '<li id="world-map-car" hidden><span class="world-map-marker"></span>Your car<small></small></li>';
      }
      // and the player's own car, where they left it, and how far off
      const parked = onFoot.parked;
      $('#world-map-car').hidden = !parked;
      $('#world-map-places small').textContent = String(cityGuide.foundPlaces().length);
      if (parked) $('#world-map-car small').textContent = `${Math.round(Math.hypot(parked.s - vehicle.s, parked.u - vehicle.u) / 10) * 10} m`;
      worldMapCanvas.style.aspectRatio = String(worldMap.aspect);
      $('#world-map-status').textContent = hereText();
      worldMapDialog.showModal(); chooserName = 'map';
      drawWorldMap();
      // (and once more for the headset's panel, which cannot show the page)
      if (vr?.active) { vrMapCanvas ??= document.createElement('canvas'); vrMapCanvas.width = 940; worldMap.draw(vrMapCanvas, vehicle, onFoot.parked, cityGuide.foundPlaces()); vrMapKey++; }
      $('#close-world-map').focus();
    }
    window.addEventListener('resize', drawWorldMap);
    worldMapCanvas.addEventListener('pointermove', event => {
      const box = worldMapCanvas.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top;
      const place = worldMap?.placeAt(x, y, box.width, cityGuide.foundPlaces()), name = place ? `${place.name} · ${CITY_PLACES[place.type].label}` : worldMap?.districtAt(x, y, box.width);
      $('#world-map-status').textContent = name ?? hereText();
    });
    worldMapCanvas.addEventListener('pointerleave', () => { $('#world-map-status').textContent = hereText(); });
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
    const trafficStorageKey = 'citydriver-traffic';
    try { traffic.setEnabled(localStorage.getItem(trafficStorageKey) !== 'false', vehicle); } catch { /* Storage is optional. */ }
    primeMenuDrive();
    $('#traffic').setAttribute('aria-pressed', String(traffic.enabled));
    function toggleTraffic() {
      if (started && gameMode !== 'free') return;
      traffic.setEnabled(!traffic.enabled, vehicle);
      traffic.render(1, world.origin);
      $('#traffic').setAttribute('aria-pressed', String(traffic.enabled));
      try { localStorage.setItem(trafficStorageKey, String(traffic.enabled)); } catch { /* Keep the setting for this visit. */ }
      needsRender = true;
    }
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
      $('#change-car').hidden = run;
      $('#pause-fleet').hidden = gameMode !== 'taxi';
      // (free drive's makes a new city, as R does: a controller's Y gets in and out of cars there,
      // and it comes last, well away from Resume)
      renderMenuControls(controls());
      if (run) $('#switch-mode').before($('#restart-run')); else $('#traffic').after($('#restart-run'));
      $('#goals-panel').hidden = !run; $('#goals-heading').textContent = gameMode === 'demolition' ? 'Contracts' : 'Shift goals';
      $('#shift-goals').setAttribute('aria-label', $('#goals-heading').textContent);
      $('#scores-panel').hidden = gameMode !== 'demolition';
      $('#taxi-clock-label').textContent = 'TIME';
      $('#taxi-clock').setAttribute('aria-label', gameMode === 'demolition' ? 'Seconds remaining' : 'Shift seconds remaining');
      $('#reset').title = run ? 'Reset car: −5 seconds (R)' : 'Reset city (R)';
      $('#reset').setAttribute('aria-label', $('#reset').title);
      vrStatus.setAccent(gameMode);
      // Residents cost a fine in a demolition run: they glow red, through props too
      world.setPeopleAlert(gameMode === 'demolition', rendering.stencil);
      // (and dive out of the truck's way)
      pedestrianContacts.dodge = gameMode === 'demolition';
      renderGoals(); updateCarUi();
    }
    function recoverCar(penalty = false) {
      const pose = nearestLanePose(vehicle.s, vehicle.u, vehicle.heading);
      vehicle.s = pose.s; vehicle.u = pose.u; vehicle.heading = pose.heading;
      // (on foot, stood on the lane: from a roof they were left up at its height, and fell)
      vehicle.pilot?.land(); vehicle.walker?.takeOver(); haltCar();
      const run = demolition.running ? demolition : taxi;
      if (penalty) { run.timeLeft = Math.max(0, run.timeLeft - 5); toast('Reset −5s'); }
      taxi.hold = 0;
      world.update(vehicle.s, vehicle.u); vehicle.render(0, world.origin); rendering.snap(); needsRender = true;
    }
    function beginTaxi() {
      if (changingJourney) return;
      demolition.stop(); enterRun('taxi', taxi.fleet.selected, taxi.fleet.liveryColor);
      taxi.start(vehicle); taxiView.reset(); renderGoals(); cityGuide.lately = [];
      showRun();
    }
    // Demolition: the truck, a minute on the clock, and a city to wreck. The
    // furniture and parked cars a previous go knocked about are put back.
    function beginDemolition() {
      if (changingJourney) return;
      taxi.stop(); props.reset(); enterRun('demolition', DEMOLITION_CAR, DEMOLITION_PAINT);
      demolition.start(); demolitionView.reset();
      showRun();
      toast('Wreck everything · Mind the pedestrians');
    }
    // What either run does first: the player at the wheel of its car, in traffic
    function enterRun(mode, id, carPaint) {
      if (freeTraffic === undefined || gameMode === 'free') freeTraffic = traffic.enabled;
      started = true; gameMode = mode; vehicle.arcade = true;
      // (autodrive is free drive's alone)
      if (autodrive.enabled) { autodrive.toggle(); revealTouchControls(); }
      autodrive.reset();
      onFoot.setCar(id, { paint: carPaint }); recoverCar(); traffic.setEnabled(true, vehicle);
    }
    // and last, once the run itself has started
    function showRun() {
      $('#traffic').setAttribute('aria-pressed', 'true'); $('#autodrive').setAttribute('aria-pressed', 'false');
      $('#taxi-results').hidden = true; $('#demolition-results').hidden = true; $('#welcome').classList.add('hidden');
      rendering.setView(4); updateViewUi(); setPaused(false); modeUi(); updateHud();
      taxiView.render(taxi, vehicle, world.origin, time); rendering.update(vehicle.car, 1, world.origin);
    }
    function beginFree({ preserveInput = false } = {}) {
      if (changingJourney) return;
      const wasRun = taxi.status !== 'idle' || demolition.status !== 'idle'; taxi.stop(); demolition.stop(); started = true; gameMode = 'free';
      autodrive.reset(); vehicle.arcade = false; onFoot.setCar(carId, { paint }); haltCar();
      if (wasRun && freeTraffic !== undefined) traffic.setEnabled(freeTraffic, vehicle);
      $('#traffic').setAttribute('aria-pressed', String(traffic.enabled)); $('#autodrive').setAttribute('aria-pressed', String(autodrive.enabled));
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
      $('.car-options').innerHTML = garageChoices().cars.map(({ id, label, plain, meters: values }) => {
        const entry = { name: label, plain };
        // The plain row stands for whichever car the road brings: no portrait
        // and no meters, so it sits above the fleet as a single line.
        if (entry.plain) return `<button type="button" class="chooser-card car-card car-card-plain" data-car="${id}" aria-current="false">`
          + `<span class="chooser-card-title">${entry.name}</span>${current}</button>`;
        const meters = values.map(({ label, level }) =>
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
      const choices = garageChoices().paints;
      paintSwatches.innerHTML = choices.map(choice => `<button type="button" class="paint-swatch${choice.id === DEFAULT_PAINT ? ' paint-default' : ''}" role="radio" aria-checked="${choice.current}" data-paint="${choice.id}" style="--swatch:${choice.swatch}" aria-label="${choice.label}" title="${choice.label}"><span class="paint-chip" aria-hidden="true"></span></button>`).join('');
      for (const swatch of paintSwatches.querySelectorAll('[data-paint]')) {
        const choice = choices.find(choice => choice.id === swatch.dataset.paint);
        swatch.addEventListener('click', choice.activate);
        for (const event of ['pointerenter', 'focus']) swatch.addEventListener(event, () => { $('#paint-current').textContent = choice.label; });
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
      for (const choice of garageChoices().paints) paintSwatches.querySelector(`[data-paint="${choice.id}"]`)?.setAttribute('aria-checked', String(choice.current));
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
    let driveMode = null, driveMachine = null;
    function updateDriveUi() {
      const free = started && gameMode === 'free', mode = free && vehicle.pilot ? 'flying' : free && vehicle.walker ? 'walking' : 'driving';
      // (the helicopter and the plane fly on the same buttons, but the stick's help differs)
      if (mode === driveMode && vehicle.carId === driveMachine) return;
      driveMode = mode; driveMachine = vehicle.carId; document.body.dataset.flying = String(mode === 'flying'); document.body.dataset.walking = String(mode === 'walking'); updateViewUi();
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
      // (stopping fast, or landing high up, a second press jumps out: see OnFoot.bail and jump)
      const stopping = offer.flying ? 'Landing' : 'Stopping';
      const own = offer.own && (carEntry(offer.car.actor.carId).flies ? `Your ${offer.name.toLowerCase()}` : 'Your car');
      const label = offer.out ? offer.bail ? 'Jump out' : offer.stopping ? stopping : 'Get out' : 'Get in', detail = offer.out ? offer.bail ? stopping : '' : own || offer.name;
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
      for (const choice of garageChoices().cars) carDialog.querySelector(`[data-car="${choice.id}"]`)?.setAttribute('aria-current', String(choice.current));
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
        onFoot.setCar(id, { paint }); vehicle.render(0, world.origin);
        if (walked) recoverCar();
      }
      autodrive.reset();
      rendering.update(vehicle.car, 0, world.origin);
      updateCarUi(); updateHud(); needsRender = true;
      // (how to fly, on whatever the player is holding: the plane needs a run at it first)
      const device = vr?.active ? 'vr' : document.body.dataset.controller === 'true' ? 'pad' : matchMedia('(pointer: coarse)').matches ? 'touch' : 'keys';
      const takeOff = { vr: 'Right trigger', pad: 'RT', touch: 'Push the stick up', keys: 'Hold W' }[device];
      const climbing = { vr: 'Right stick: climb / descend', pad: 'Right stick or RB / LB: climb / descend', touch: 'Hold Climb or Descend', keys: 'Space / Shift: climb / descend' }[device];
      const flight = !CARS[id].flies ? '' : CARS[id].kind === 'plane' ? ` · ${takeOff} to take off · ${climbing}` : ` · ${climbing}`;
      toast(`${carEntry(id).name} selected${flight}`);
    }
    // The plane's stunts (see Plane), told once each: the roll after a while
    // up in the air, and the loop after the first roll
    const flightHintKey = 'citydriver-flight-hints';
    let flightHints = {};
    try { flightHints = JSON.parse(localStorage.getItem(flightHintKey)) ?? {}; } catch { /* Storage is optional. */ }
    function hintFlight(stunt = null) {
      const pilot = vehicle.pilot;
      if (!pilot || vehicle.carId !== 'plane' || !started || gameMode !== 'free') return;
      const hint = !flightHints.roll && pilot.aloft > 6 && !pilot.stunt ? 'roll' : !flightHints.loop && stunt === 'Barrel roll' ? 'loop' : null;
      if (!hint) return;
      // (this runs every step in the plane: the device only once there is something to say)
      const device = vr?.active ? 'vr' : document.body.dataset.controller === 'true' ? 'pad' : matchMedia('(pointer: coarse)').matches ? 'touch' : 'keys';
      if (hint === 'roll') toast({ keys: 'Double-tap A or D to barrel roll', pad: 'Flick the left stick twice to barrel roll', vr: 'Flick the left stick twice to barrel roll', touch: 'Flick the stick twice sideways to barrel roll' }[device]);
      else setTimeout(() => { if (vehicle.pilot && !paused) toast({ keys: 'Double-tap Space to loop the loop', pad: 'Double-tap RB to loop the loop', vr: 'Double-tap the right grip to loop the loop', touch: 'Double-tap Climb to loop the loop' }[device]); }, 2400);
      flightHints[hint] = true;
      try { localStorage.setItem(flightHintKey, JSON.stringify(flightHints)); } catch { /* Told for this visit. */ }
    }
    function openCars() {
      if (started && gameMode === 'taxi') { openFleet(); return; }
      if (started && gameMode === 'demolition') { toast('Garage: free drive only'); return; }
      if (!holdForChooser()) return;
      carDialog.showModal(); chooserName = 'garage';
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
        // (from the title the cruising car drives on into free drive, where autodrive belongs)
        if (enabled && !started) beginFree({ preserveInput: true });
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
        // (the title holds the car still, and has no pause screen to leave behind on exit)
        if (!visible) { if (changingJourney) journeyWasPaused = true; if (started) setPaused(true); }
        needsRender = true;
      },
      onError(error) {
        const message = error.name === 'NotAllowedError' ? 'VR permission was declined. Select Enter VR to try again.' : 'Could not enter VR. Try again in your headset browser.';
        $('#vr-error').textContent = message; $('#vr-error').hidden = false;
      },
      onSupport: supported => headsetLayout(supported && headsetBrowser()),
    });
    // In a headset's own browser (see headsetBrowser) the page is a flat window
    // and the controllers only point, so Enter VR goes first on the title and
    // pause screens and targets are touch-sized.
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
    for (const dialog of choosers) {
      dialog.addEventListener('close', () => {
        if (openChooser() === dialog) chooserName = null;
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
    window.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (started || paused || changingJourney || document.querySelector('dialog[open]')) return;
      if (event.target.closest?.('button, a, input, select, textarea, [contenteditable]') && event.target !== $('#start')) return;
      event.preventDefault();
      if (!event.repeat) start();
    });
    document.addEventListener('visibilitychange', () => { if (vr.active || vr.pending) return; audio.setHidden(document.hidden); if (document.hidden) { if (openChooser() || changingJourney) journeyWasPaused = true; if (started) setPaused(true); input.clear(); } frameClock.suspend(); });
    window.addEventListener('blur', () => { if (vr.active || vr.pending) return; audio.setHidden(true); if (openChooser() || changingJourney) journeyWasPaused = true; if (started) setPaused(true); });
    window.addEventListener('focus', () => audio.setHidden(hidden()));
    window.addEventListener('pointerdown', () => audio.unlock(), { capture: true, passive: true });
    window.addEventListener('keydown', () => audio.unlock(), { capture: true });
    window.addEventListener('pagehide', event => { audio.setHidden(true); if (!event.persisted) { onFoot.clear(); vehicle.disposeModel(); enterMarker.dispose(); nightLighting.dispose(); props.dispose(); world.dispose(); weather.dispose(); traffic.dispose(); taxiView.dispose(); demolitionView.dispose(); void audio.dispose().catch(() => {}); } });
    window.addEventListener('pageshow', () => { audio.setHidden(document.hidden); needsRender = true; });
    $('#scene').addEventListener('webglcontextlost', event => { event.preventDefault(); setPaused(true); toast('Graphics lost. Reload to restart.'); });
    $('#scene').addEventListener('webglcontextrestored', () => { needsRender = true; });
    const qualityButtons = [...document.querySelectorAll('[data-quality]')];
    const graphicsToggle = $('#graphics-toggle'), graphicsPanel = $('#graphics-settings');
    graphicsToggle.addEventListener('click', () => {
      graphicsPanel.hidden = !graphicsPanel.hidden;
      graphicsToggle.setAttribute('aria-expanded', String(!graphicsPanel.hidden));
      // (the display's rate is known by now, for the frame-rate label)
      if (!graphicsPanel.hidden) updateGraphicsUi();
    });
    const softShading = $('#soft-shading'), graphicsStatus = $('#graphics-status');
    const pixelDensity = $('#pixel-density'), pixelDensityValue = $('#pixel-density-value');
    const frameCapInput = $('#frame-cap'), frameCapValue = $('#frame-cap-value');
    // What the cap slider says, Auto with what it has worked out (see Graphics.frameCap)
    function frameCapText() {
      const choice = graphics.capChoice, cap = graphics.cap, display = pacer.displayRate;
      if (choice === null) return cap ? `Auto · ${Math.round(cap)} fps` : display ? `Auto · ${Math.round(display)} fps` : 'Auto';
      return choice ? `${choice} fps` : 'Uncapped';
    }
    function updateGraphicsUi(settings = graphics.settings) {
      for (const button of qualityButtons) button.setAttribute('aria-checked', String(button.dataset.quality === graphics.mode));
      softShading.setAttribute('aria-pressed', String(settings.ambientOcclusion));
      const densityPercent = Math.round(settings.density * 100);
      $('#graphics-summary').textContent = `${graphics.auto ? 'Auto' : settings.label} · ${densityPercent}%`;
      pixelDensity.value = String(densityPercent);
      pixelDensity.style.setProperty('--control-level', `${(densityPercent - 50) * 2}%`);
      pixelDensityValue.textContent = `${densityPercent}%${settings.customDensity ? (densityPercent === 100 ? ' · Native' : '') : ' · Preset limit'}`;
      pixelDensity.setAttribute('aria-valuetext', `${densityPercent}% of native resolution${settings.customDensity ? '' : ', capped by the preset'}`);
      const capAt = Math.max(0, FRAME_CAPS.indexOf(graphics.capChoice));
      frameCapInput.value = String(capAt);
      frameCapInput.style.setProperty('--control-level', `${capAt / (FRAME_CAPS.length - 1) * 100}%`);
      frameCapValue.textContent = frameCapText(); frameCapInput.setAttribute('aria-valuetext', frameCapText());
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
    frameCapInput.addEventListener('input', () => graphics.chooseFrameCap(FRAME_CAPS[Number(frameCapInput.value)]));
    const weatherSelect = $('#city-weather');
    weatherSelect.innerHTML = WEATHER_CHOICES.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
    weatherSelect.value = weather.mode;
    weatherSelect.addEventListener('change', () => chooseWeather(weatherSelect.value));
    function chooseWeather(mode) {
      weather.setMode(mode, { immediate: paused });
      weatherSelect.value = weather.mode;
      applyWeather();
      try { localStorage.setItem('citydriver-weather', weather.mode); } catch { /* Storage is optional. */ }
      updateHud(); needsRender = true;
    }
    const locationModel = () => locationHudModel(vehicle, cityDistrict(vehicle.s, vehicle.u), weather.state.label);
    function updateHud() {
      const location = locationModel();
      renderLocationHud(location);
      renderMenuControls(controls());
      cityGuide.update(started && !paused && !changingJourney, { draw: !vr?.active });
      const run = gameMode === 'demolition' ? demolitionView.buildHud(demolition, vehicle)
        : taxiView.buildHud(taxi, vehicle, started && gameMode === 'free');
      renderRunHud(run);
      updateUseUi();
      if (vr?.active) vrStatus.hud(started && !paused && !changingJourney ? headsetHudModel(run, location, vrHint()) : null);
    }
    function updateViewUi() {
      $('#view').title = `${rendering.viewLabel} · Change camera (V)`;
      $('#view').setAttribute('aria-label', `${rendering.viewLabel}. Change camera`);
      const thirdPerson = rendering.camera.isPerspectiveCamera, flying = document.body.dataset.flying === 'true', walking = document.body.dataset.walking === 'true';
      $('.stick-help-copy').firstChild.textContent = walking ? rendering.firstPersonView ? 'Touch anywhere · ↑ Walk · ↔ Turn' : 'Drag anywhere to walk' : thirdPerson ? `Touch anywhere · ↑ ${flying ? 'Fly' : 'Drive'} · ↔ ${flying ? 'Turn' : 'Steer'}` : `Drag anywhere to ${flying ? 'fly' : 'drive'}`;
      // (the plane never stops in the air: let go, it cruises)
      const cruising = flying && carEntry(vehicle.carId).kind === 'plane';
      $('.stick-help-line').textContent = walking ? 'Push further to run' : cruising ? thirdPerson ? '↓ Slow down · Release to cruise' : 'Release to cruise'
        : flying ? thirdPerson ? '↓ Back · Release to hover' : 'Release to hover' : thirdPerson ? '↓ Brake · Release to stop' : 'Release to stop';
      $('#touch-stick').setAttribute('aria-label', walking ? 'Virtual joystick: push the way to walk, further to run' : thirdPerson ? 'Virtual joystick: up to accelerate, left and right to steer, down to brake or reverse, release to stop' : 'Virtual joystick');
    }
    const menuActions = {
      start: () => vr.active ? beginTaxi() : start(), taxi: beginTaxi, demolition: beginDemolition, free: beginFree, resume: () => setPaused(false),
      back: () => openChooser()?.close(), exit: () => action('exitVR'), fleet: openFleet, garage: openCars,
      autodrive: () => action('autodrive'), traffic: toggleTraffic, reset: () => action('reset'), map: openWorldMap,
      weather: () => chooseWeather(cycleChoice(WEATHER_CHOICES.map(([id]) => id), weather.mode)),
      view: () => action('view'), recenter: () => action('recenterVR'), comfort: toggleComfort,
      graphics: () => graphics.setMode(cycleChoice(['auto', 'high', 'balanced', 'smooth', 'basic'], graphics.mode)),
      rate: () => graphics.chooseHeadsetRate(cycleChoice([null, ...headsetRates()], graphics.rateChoice)),
      sound: () => action('sound'), mix: () => { audio.setPreset(cycleChoice(['balanced', 'scenic', 'night'], audio.preset)); refreshAudioMixer(); },
    };
    const headsetRates = () => [...(vr.session?.supportedFrameRates ?? [])].sort((a, b) => a - b);
    function menuState() {
      return { loading: changingJourney, started, paused, mode: gameMode, chooser: chooserName, over: runOver(),
        running: taxi.running || demolition.running, location: locationModel(), carName: carEntry(started && gameMode !== 'free' ? vehicle.carId : carId).name,
        fleetName: carEntry(taxi.fleet.selected).name, autodrive: autodrive.enabled, traffic: traffic.enabled,
        weather: weather.mode, view: rendering.viewLabel, comfort: comfort.enabled, graphics: graphics.auto ? 'Auto' : graphics.settings.label,
        rates: headsetRates(), rateChoice: graphics.rateChoice, frameRate: vr.session?.frameRate, sound: audio.enabled, mix: audio.preset };
    }
    const controls = () => menuControls(menuState(), menuActions);
    const garageChoices = () => garageModel(carId, paint, ownPaint, { chooseCar, applyPaint });
    const brandMark = new Image(); brandMark.src = `${import.meta.env.BASE_URL}brand-mark.svg`;
    function currentMenuModel() {
      const state = menuState();
      return menuModel(state, menuControls(state, menuActions), {
        garage: state.chooser === 'garage' ? garageChoices() : null,
        fleet: state.chooser === 'fleet' ? fleetMenu.model() : null,
        result: state.over ? gameMode === 'demolition' ? demolitionResultModel(demolition) : taxiResultModel(taxi, cityGuide.lately) : null,
        mapImage: vrMapCanvas, mapKey: vrMapKey, mark: brandMark,
      });
    }
    bindMenuControls(controls);
    function vrHint() {
      return vrHintTime >= 10 ? '' : vehicle.pilot ? `Triggers: forward, back · Left stick: turn · Right stick or grips: up, down${gameMode === 'free' ? ' · Y: get out' : ''} · B: pause`
        : vehicle.walker ? 'Left stick: walk · Right stick: look · Left grip: jump · Right grip: sprint · Y: get in · B: pause'
          : `Right trigger: gas · Left trigger: brake · Left stick: steer · Grips: drift, boost${gameMode === 'free' ? ' · Y: get out' : ''} · B: pause`;
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
      // (a flying machine's stunts and landings)
      if (vehicle.pilot) {
        for (const event of vehicle.pilot.drain()) { toast(event.text, event.kind === 'stunt' ? 'stunt' : ''); if (event.kind === 'stunt') hintFlight(event.text); }
        hintFlight();
      }
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
            setPaused(true); pauseOverlay.hidden = true; taxiView.hud(taxi, vehicle); taxiView.results(taxi, cityGuide.lately); fleetView.render(); $('#taxi-retry').focus();
          } else if (event.kind === 'goal') {
            // A goal usually completes on a payout, whose toast lands first.
            renderGoals(); setTimeout(() => { if (taxi.running && !paused) { toast(event.text, 'goal'); audio.cue('goal'); } }, 1500);
          } else { toast(event.text, event.rating ?? event.tone ?? ''); audio.cue(event.kind, event); taxiView.pop(event, vehicle); }
          // (a fare's drop-off finds its place, quietly during the shift)
          if (event.destination) cityGuide.arrive(event.destination.id);
        }
        tickClock(taxi.timeLeft);
      }
      if (started && demolition.running) {
        demolition.update(dt);
        demolitionEvents(demolition.drainEvents());
        tickClock(demolition.timeLeft);
      }
    };
    // A run's last ten seconds tick away
    function tickClock(timeLeft) {
      const left = Math.ceil(timeLeft);
      if (left < shiftTick && left <= 10 && left > 0) audio.cue('tick', { urgent: left <= 5 });
      shiftTick = left;
    }
    // What a demolition run has to say: prices float up off the wreckage, and
    // the step's biggest news takes the panel's last line (a contract done
    // outranks the multiplier's callout on the same smash)
    function demolitionEvents(events) {
      let news = null, later = null;
      const say = (text, tone, weight) => { if (!news || weight >= news.weight) news = { text, tone, weight }; };
      for (const event of events) {
        if (event.kind === 'smash' || event.kind === 'dent') { demolitionView.pop(event); audio.cue('smash', event); }
        else if (event.kind === 'wreck') {
          demolitionView.pop(event); audio.cue('wreck');
          if (event.seconds) { demolitionView.pop({ ...event, kind: 'bonus' }); say(`Takedown · +${event.seconds}s`, 'bonus', 2); audio.cue('bonus'); }
        } else if (event.kind === 'progress') say(event.text, '', 1);
        else if (event.kind === 'multiplier') { say(event.text, 'chain', 3); audio.cue('multiplier', event); }
        else if (event.kind === 'contract') { demolitionView.pop(event); say(event.text, 'goal', 4); audio.cue('goal'); }
        else if (event.kind === 'banked') {
          say(event.text, 'banked', 3); audio.cue('banked');
          // (a new rating is its own news, a moment later, as a taxi goal is)
          if (event.rank) later = `Rating · ${event.rank.name}`;
        } else if (event.kind === 'record') later = later ? `${event.text} ${later}` : event.text;
        else if (event.kind === 'penalty') { demolitionView.pop(event); say(event.text, 'slow', 5); audio.cue('penalty'); }
        else if (event.kind === 'overtime') { say(event.text, 'slow', 5); audio.cue('overtime'); }
        else if (event.kind === 'over') {
          haltCar();
          setPaused(true); pauseOverlay.hidden = true; demolitionView.hud(demolition, vehicle); demolitionView.results(demolition); $('#demolition-retry').focus();
          return;
        }
      }
      if (news) toast(news.text, news.tone);
      if (later) setTimeout(() => { if (demolition.running && !paused) { toast(later, 'goal'); audio.cue('goal'); } }, 1300);
    }
    function frame(timestamp, xrFrame) {
      // The page's frame-rate cap (see Graphics.frameCap). A headset sets its own rate.
      if (pacer.skip(timestamp, vr.active ? null : graphics.frameCap(pacer.displayRate))) return;
      vrStatus.update(vr.active ? currentMenuModel() : null);
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
        // (on foot, what catches their eye, the camera included, as the colliders lie, and the car they would get into)
        const lens = rendering.camera.position;
        onFoot.lookAround(world, time, { x: lens.x, z: lens.z - world.origin });
        enterMarker.update(onFoot, time, world.origin);
        traffic.render(frameClock.alpha, world.origin); props.render(frameClock.alpha, world.origin);
        pedestrianContacts.update(vehicle, traffic, time, props);
        // In VR, residents are culled with the last frame's head frustum. The head
        // turns little in a frame and each chunk's bound is about a cell across.
        rendering.update(vehicle.car, dt, world.origin); world.animate(time, traffic.time, vr.active ? rendering.vrCamera.camera : rendering.camera, pedestrianContacts);
        // (a parachute the chase camera has been pulled up into is not drawn)
        vehicle.walker?.clearView(rendering.camera.position);
        taxiView.render(taxi, vehicle, world.origin, time, pedestrianContacts, vr.active ? null : rendering.camera);
        demolitionView.render(world.origin, time, vr.active ? null : rendering.camera);
        const at = vehicle.groundedPosition;
        pigeons.gather(world.chunks.values(), at.x, at.z, time, pigeonGround);
        pigeons.scare({ x: at.x, y: at.y, z: at.z, speed: Math.abs(vehicle.speed), car: !vehicle.walker, airborne: Boolean(vehicle.walker && !vehicle.walker.grounded) }, time, world.chunks.values());
        pigeons.render(world.origin, time);
        applyWeather(dt);
      }
      // (a flying machine's climbs and dives count as surges too, and so does a
      // fall on foot, past the 7 m/s a jump lands at: counting a hop's take-off,
      // the vignette pulsed with every jump)
      const walker = vehicle.walker, vy = vehicle.pilot ? vehicle.pilot.vy : walker ? Math.max(0, Math.abs(walker.vy) - 8) : null;
      comfort.update(rendering.camera, vy === null ? vehicle.speed : Math.hypot(vehicle.speed, vy), running ? dt : 0, vr.active && running && started);
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
      // Only frames while driving say anything about performance. In a headset
      // they're measured against its refresh rate (see Graphics.setHeadset).
      rendering.recordFrame(timestamp, !paused && !changingJourney && (vr.active ? vr.visible && started : !document.hidden && document.hasFocus()));
      // A paused desktop canvas only redraws when invalidated. In VR, keep
      // drawing every headset frame so head tracking continues while stopped.
      const rendered = vr.active ? Boolean(xrFrame) : !document.hidden && (!paused || needsRender);
      if (rendered) {
        if (!vr.active && started && !paused) cityGuide.render(vehicle.car, world.origin);
        taxiView.navigation.float(taxi, vehicle, vehicle.car, rendering.camera, { visible: vr.active, ahead: soundScene.interior });
        vrStatus.update(vr.active ? currentMenuModel() : null);
        rendering.render(xrFrame, () => {
          vrStatus.point(xrFrame, renderer.xr.getReferenceSpace(), rendering.vrCamera.rig, vr.visible && !changingJourney);
          vrStatus.update(vr.active ? currentMenuModel() : null);
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
    // (someone on foot, and their parachute)
    const onFootWarmup = createWalkerModel(); onFootWarmup.canopy.visible = true;
    await rendering.precompile([...world.warmupObjects(), ...taxiView.warmupObjects(), ...demolitionView.warmupObjects(), ...enterMarker.warmupObjects(), ...pigeons.warmupObjects(), onFootWarmup.figure, onFootWarmup.canopy]);
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
    if (import.meta.env.DEV) window.__citydriver = { seed: SEED, city: CITY, nav: navGraph(), lanePose, roadAt, nearestLanePose, vehicle, onFoot, pigeons, traffic, props, nightLighting, weather, autodrive, audio, graphics, vr, vrStatus, currentMenuModel, fleetMenu, cityGuide, taxi, taxiView, beginTaxi, beginFree, demolition, demolitionView, beginDemolition, get gameMode() { return gameMode; }, world, rendering, input, action, chooseCar, applyPaint, get carId() { return carId; }, get paint() { return paint; }, get journey() { return journey; }, get changingJourney() { return changingJourney; }, get paused() { return paused; }, get started() { return started; } };
  } catch (error) { console.error('Could not start Citydriver:', error); $('#loading').classList.add('loaded'); $('#error').hidden = false; }
}
boot();
