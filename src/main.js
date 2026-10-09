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
import './demolition.css';
import './city-theme.css';
import './update-notice.css';
import { garageModel, savingFor, UNSAVED } from './chooser-model.js';
import { menuControls, menuModel, WEATHER_CHOICES, cycleChoice } from './menu-model.js';
import { bindMenuControls, renderMenuControls } from './menu-dom.js';
import { locationHudModel, headsetHudModel, freeHudModel } from './run-hud-model.js';
import { renderLocationHud, renderRunHud } from './run-hud-dom.js';
import { taxiResultModel, demolitionResultModel } from './result-model.js';
import { createRendering } from './rendering.js';
import { setupCameraControls } from './camera-controls.js';
import { DEFAULT_FOG_DISTANCE, FRAME_CAPS, Graphics, headsetBrowser } from './graphics.js';
import { JOURNEYS } from './journeys.js';
import { CARS, GARAGE_IDS, GEAR, STARTING_CAR, ROUTE_PAINT, carEntry, carPrice, shopName } from './cars.js';
import { TestDrive, TEST_DRIVE_WARN } from './test-drive.js';
import { carArt, gearArt } from './car-art.js';
import { PAINTS, DEFAULT_PAINT, DEFAULT_PAINT_NAME, PAINT_PRICE, RAINBOW_PAINT, RAINBOW_NAME, paintName, readPaint } from './car-paint.js';
import { SEED } from './world/route.js';
import { resolveWorldSeed } from './world/generation.js';
import { CityWeather } from './world/city-weather.js';
import { NightLighting } from './night-lighting.js';
import { LooseProps } from './loose-props.js';
import { cityDistrict, citySoundscape, cityHeight, nearestLanePose, journeyStart, lanePose, roadAt, surfaceAt, waterAt } from './world/city-route.js';
import { CITY } from './world/city.js';
import { signSheet } from './world/city-signs.js';
import { loadingStage, startupErrorMessage } from './loading-status.js';
import { warmInterface } from './interface-warmup.js';
import { navGraph } from './world/nav-graph.js';
import { CityGuide, placePay } from './city-guide.js';
import { CITY_PLACES } from './world/city-places.js';
import { Pigeons } from './world/city-pigeons.js';
import { WorldMap, DISTRICT_COLORS } from './city-world-map.js';
import { TaxiRun } from './taxi-run.js';
import { FLEET_KEY } from './taxi-fleet.js';
import { CAREER_KEY } from './taxi-career.js';
import { goalProgress } from './taxi-goals.js';
import { TaxiView } from './taxi-view.js';
import { DemolitionRun, DEMOLITION_CAR, DEMOLITION_PAINT } from './demolition-run.js';
import { DemolitionView } from './demolition-view.js';
import { DriftEffects } from './drift-effects.js';
import { StuntChain } from './stunt-chain.js';
import { JumpBook, starText, STAR_PAY } from './jump-book.js';
import { setResidentWindow } from './world/resident.js';
import { PlayerController } from './vehicle.js';
import { OnFoot, EnterMarker } from './on-foot.js';
import { walkingInput, createWalkerModel } from './walker.js';
import { CityTraffic } from './city-traffic.js';
import { collideScenery, sightLine, cameraClearance } from './collision.js';
import { PedestrianContacts } from './world/pedestrian-reactions.js';
import { CityAutodrive as Autodrive } from './city-autodrive.js';
import { Input } from './input.js';
import { touchDrivingInput, thirdPersonDrivingInput, pressOnRelease } from './touch-stick.js';
import { MouseLook } from './mouse-look.js';
import { createFullscreen } from './fullscreen.js';
import { DriveAudio } from './audio.js';
import { setupAudioMixer } from './audio/mixer.js';
import { FrameClock, FramePacer } from './timing.js';
import { setupControlHelp, controlHelpDismissed, updateControlHelp } from './control-help.js';
import { BrowserVR } from './vr.js';
import { VRStatus } from './vr-status.js';
import { moveMenuFocus, confirmMenuFocus, scrollMenu, handleMenuKey } from './menu-focus.js';
import { setupMenuIdle } from './menu-idle.js';
import { OnceHints, readHintFlags } from './hud-dom.js';

setupControlHelp();

const $ = selector => document.querySelector(selector);
const MENU_MOVES = ['menuNext', 'menuPrevious', 'menuUp', 'menuDown'];
const MENU_CRUISE_SPEED = 16 * 1.4;
// How fast the right stick turns the camera, pushed all the way (rad/s)
const STICK_LOOK = 2.4;
let paused = false, started = false, time = 0, hudTime = 0, gameMode = 'taxi';
document.body.dataset.mode = gameMode;
const frameClock = new FrameClock(), pacer = new FramePacer();
let toastTimer, toastShown = -Infinity; let sceneReady = false;
// The chosen car outlives the visit, positions and mileage do not. It is
// free drive's car, so a cab is never kept as it (cabs are the shift's: see
// chooseCar), and a save holding one, from when new players had only the
// Taxi, starts in the Surf Wagon.
const carStorageKey = 'citydriver-car';
let carId = STARTING_CAR;
try { const saved = localStorage.getItem(carStorageKey); if (saved && GARAGE_IDS.includes(saved) && !carEntry(saved).taxi) carId = saved; } catch { /* Storage is optional. */ }
// (free drive's car, which `carId`, the garage's pick, is too unless that is a cab)
let freeCarId = carId;
// The garage's pick: a cab is driven now and becomes the shift's cab,
// anything else is free drive's car from now on
function pickCar(id, fleet) {
  carId = id;
  if (carEntry(id).taxi) { fleet.select(id); return; }
  freeCarId = id;
  try { localStorage.setItem(carStorageKey, id); } catch { /* Still drive it for this visit. */ }
}
// One color dresses the whole garage and follows the player from car to car.
// It is saved with the fleet (it costs money: see TaxiFleet.setPaint), and
// Default hands every car its own finish back.
let paint = null;
// A headset shows toasts in its own HUD (set up in boot).
let echoToast = null;
// Feedback shares the task card's second line whenever the card is up (all
// through a run, and in free drive while it has something to show), keeping
// notifications off the road. A toast showing moves with the card as it comes and goes.
function placeToast() {
  const element = $('#toast'), parent = started && !paused && !$('#taxi-task').hidden ? $('.taxi-task-main') : $('#app');
  if (element.parentElement !== parent) parent.append(element);
}
const toast = (message, tone = '') => {
  echoToast?.(message, tone);
  const element = $('#toast');
  placeToast();
  // Taxi arrivals take their rating's color: Speedy green, Normal yellow, Slow red.
  element.textContent = message; element.dataset.tone = tone; element.classList.add('show'); clearTimeout(toastTimer); toastShown = performance.now();
  toastTimer = setTimeout(() => element.classList.remove('show'), 2200);
};

async function boot() {
  try {
    // Without the fixed app layout, menus and controls are not usable.
    if (getComputedStyle($('#app')).position !== 'fixed') throw new Error('Game styles could not load');
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
    rendering.addCuller((camera, shadow, fog) => world.cull(camera, shadow, fog));
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
    // One set of driving rules everywhere: the brake holds the car still a
    // moment before reversing, for fares and drop-offs (see vehicle.js)
    vehicle.arcade = true;
    vehicle.setAppearance(journey);
    vehicle.setLights(weather.state.lightLevel);
    const carDialog = $('#car-dialog'), pauseOverlay = $('#pause-overlay');
    const worldMapDialog = $('#world-map-dialog');
    const choosers = [carDialog, worldMapDialog];
    const chooserDialogs = { garage: carDialog, map: worldMapDialog };
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
    const menuIdle = setupMenuIdle({ app: $('#app'), welcome: $('#welcome'), fade: $('#menu-view-fade'), rendering,
      enabled: () => sceneReady && !started && !paused && !changingJourney && !openChooser() && !vr?.active && !vr?.pending && !document.hidden });
    scene.add(vehicle.car);
    const traffic = new CityTraffic(scene, vehicle.route, vehicle.s, journey, vehicle.u);
    // (and the bus calls at the world's stops)
    traffic.stops = world.busStops;
    // Street furniture knocked loose (see loose-props.js), which loose traffic can knock over too
    const props = new LooseProps(scene, world.materials.props);
    traffic.props = props;
    // (and takes the player on foot, when a car knocks them over. The
    // traffic's roofs are there for a car to come down on)
    vehicle.props = props; vehicle.traffic = traffic;
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
    // A new place pays, a new kind of place more. No toasts during a run:
    // they cover the task card's instruction (the results list them).
    const cityGuide = new CityGuide((text, found) => {
      const pay = placePay(found);
      earn(pay);
      if (started && gameMode !== 'free') return;
      toast(`${text} · +$${pay}`); audio.cue('discovery');
    }, () => vehicle);
    let taxiStorage; try { taxiStorage = localStorage; } catch { /* Optional storage. */ }
    const taxi = new TaxiRun(taxiStorage), taxiView = new TaxiView(scene, taxiStorage); cityGuide.taxi = taxi;
    // Only a car the player owns comes out of the garage (anything else is a test drive)
    if (!taxi.fleet.owned.has(carId)) carId = freeCarId = STARTING_CAR;
    paint = taxi.fleet.paint;
    // Free drive's stunt chain (see stunt-chain.js)
    const stunts = new StuntChain();
    // Everything the player earns, wherever: the fleet balance that buys cabs,
    // and the career's earnings that set the driver's rank
    function earn(amount) {
      if (!(amount > 0)) return;
      taxi.fleet.credit(amount);
      const promotion = taxi.career.earn(amount);
      if (promotion) setTimeout(() => { if (!paused) { toast(promotion.text, 'goal'); audio.cue('goal'); } }, 1400);
    }
    // (the street map marks the car the player left parked)
    cityGuide.onFoot = onFoot;
    // Demolition: the truck's timed run, scored by the damage it does (see
    // demolition-run.js). While it runs, everything knocked loose is the
    // truck's doing, directly or through what it sent flying; ordinary
    // traffic knocking someone over is not.
    const demolition = new DemolitionRun(taxiStorage), demolitionView = new DemolitionView(scene, taxiStorage);
    // A drift's smoke, sparks and tire marks, and the flames of a turbo or the boost (see drift.js)
    const driftEffects = new DriftEffects(scene);
    // Whether free drive's stunts count: not under autodrive, which would
    // earn for nobody
    const freeStunts = () => started && gameMode === 'free' && !autodrive.enabled;
    // (in the demolition truck on standby, the first hit starts the run: see DemolitionRun.begin)
    const wrecking = () => demolition.running || demolition.waiting;
    props.onSmash = (kinds, at) => wrecking() ? demolition.smash(kinds, at) : freeStunts() ? stunts.smashed(kinds, at) : 0;
    // Free drive's jumps: what a landing is worth saying, and how far the
    // city's named jumps have been taken (see jump-book.js)
    const jumpBook = new JumpBook(taxiStorage); cityGuide.jumps = jumpBook; cityGuide.refreshJumps();
    traffic.onDamage = (car, closing) => wrecking() ? demolition.damageCar(car, closing) : freeStunts() ? stunts.damaged(car, closing) : 0;
    pedestrianContacts.onKnock = (by, at, kind) => {
      if (by === 'traffic') return;
      if (demolition.running) demolition.pedestrian(at, by, kind);
      else if (freeStunts() && by === 'player') stunts.pedestrian();
    };
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
    // In free drive, out of work, the street map shows where it is: the cabs
    // and the demolition truck in the traffic
    cityGuide.jobs = () => started && gameMode === 'free' && traffic.enabled && !taxi.waiting && !demolition.waiting
      ? traffic.vehicles.filter(car => car.job && car.car.visible) : [];
    const runOver = () => taxi.status === 'over' || demolition.status === 'over';
    // A cab's livery, from the garage (rank unlocks them). It is only paint, so
    // unlike a cab it can change mid-shift.
    function chooseLivery(id) {
      if (!taxi.fleet.setLivery(id, taxi.career)) return;
      if (started && gameMode === 'taxi') { vehicle.setPaint(taxi.fleet.liveryColor); vehicle.render(0, world.origin); rendering.update(vehicle.car, 0, world.origin); }
      renderGarage(); needsRender = true;
    }
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
    // The pause screen's header names the driver's rank (from everything
    // earned, anywhere) and the fleet balance
    const careerText = () => `${taxi.career.rank.name} · ${cashText()}${taxi.fleet.saved && taxi.career.saved ? '' : ` · ${UNSAVED}`}`;
    function renderCareer() { $('#pause-career').textContent = careerText(); }
    // The whole city, from the pause screen: built while the game loads (see
    // prepareWorldMap), drawn again whenever it opens or the window changes size
    let worldMap = null;
    const worldMapCanvas = $('#world-map');
    const hereText = () => `You are in ${cityDistrict(vehicle.s, vehicle.u)}`;
    function drawWorldMap(dialog = worldMapDialog) {
      if (!dialog.open) return;
      // as wide as its column, or as tall as the dialog leaves room for once
      // its heading, and the key when that sits below the map, are counted
      const canvas = dialog.querySelector('#world-map'), body = canvas.closest('.world-map-body'), key = body.lastElementChild;
      const below = getComputedStyle(body).gridTemplateColumns.split(' ').length < 2;
      const chrome = dialog.offsetHeight - body.offsetHeight + (below ? key.offsetHeight + parseFloat(getComputedStyle(body).rowGap) : 0);
      const room = Math.max(140, parseFloat(getComputedStyle(dialog).maxHeight) - chrome - 2);
      canvas.style.width = `${Math.floor(Math.min(canvas.parentElement.clientWidth, room * worldMap.aspect))}px`;
      worldMap.draw(canvas, vehicle, onFoot.parked, cityGuide.foundPlaces(), mapJumps());
    }
    // The city's named jumps for the city map, gold once landed (see JumpBook)
    const mapJumps = () => jumpBook.sites.map(site => ({ u: site.u, s: site.s, heading: site.heading, landed: jumpBook.best.has(site.id), site }));
    const jumpName = ({ site }) => {
      const best = jumpBook.best.get(site.id);
      return [site.kind === 'river' ? site.name : `${site.name} by ${site.where}`, best === undefined ? '' : `best ${best} m ${starText(jumpBook.stars(site))}`].filter(Boolean).join(' · ');
    };
    function prepareWorldMap() {
      worldMap = new WorldMap(CITY, cityGuide.mapCache);
      // The legend: each district this city has, and its share of the blocks
      const blocks = new Map();
      for (const label of worldMap.labels) blocks.set(label.style, (blocks.get(label.style) ?? 0) + label.blocks);
      const total = [...blocks.values()].reduce((sum, n) => sum + n, 0);
      $('#world-map-legend').innerHTML = Object.keys(DISTRICT_COLORS).filter(style => blocks.has(style)).map(style =>
        `<li><span class="world-map-swatch" style="--district-color:${DISTRICT_COLORS[style]}"></span>${style}<small>${Math.round(blocks.get(style) / total * 100)}%</small></li>`).join('')
        + '<li id="world-map-places"><span class="world-map-place"></span>Places found<small></small></li>'
        + '<li id="world-map-jumps"><span class="world-map-jump"></span>Jumps landed<small></small></li>'
        + '<li id="world-map-car" hidden><span class="world-map-marker"></span>Your car<small></small></li>';
      worldMapCanvas.style.aspectRatio = String(worldMap.aspect);
    }
    function openWorldMap() {
      if (!holdForChooser()) return;
      // and the player's own car, where they left it, and how far off
      const parked = onFoot.parked;
      $('#world-map-car').hidden = !parked;
      $('#world-map-places small').textContent = String(cityGuide.foundPlaces().length);
      $('#world-map-jumps').hidden = !jumpBook.sites.length;
      $('#world-map-jumps small').textContent = `${jumpBook.landed} / ${jumpBook.sites.length}`;
      if (parked) $('#world-map-car small').textContent = `${Math.round(Math.hypot(parked.s - vehicle.s, parked.u - vehicle.u) / 10) * 10} m`;
      $('#world-map-status').textContent = hereText();
      worldMapDialog.showModal(); chooserName = 'map';
      drawWorldMap();
      // (and once more for the headset's panel, which cannot show the page)
      if (vr?.active) { vrMapCanvas ??= document.createElement('canvas'); vrMapCanvas.width = 940; worldMap.draw(vrMapCanvas, vehicle, onFoot.parked, cityGuide.foundPlaces(), mapJumps()); vrMapKey++; }
      $('#close-world-map').focus();
    }
    window.addEventListener('resize', () => drawWorldMap());
    worldMapCanvas.addEventListener('pointermove', event => {
      const box = worldMapCanvas.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top;
      const place = worldMap?.placeAt(x, y, box.width, cityGuide.foundPlaces()), jump = !place && worldMap?.jumpAt(x, y, box.width, mapJumps());
      const name = place ? `${place.name} · ${CITY_PLACES[place.type].label}` : jump ? jumpName(jump) : worldMap?.districtAt(x, y, box.width);
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
    // Drifting held or tapped (see Drift): tapped, one press starts a drift
    // and the next lets it go, for anyone who can't hold it while steering
    const driftModeKey = 'citydriver-drift-mode';
    function setDriftMode(mode) {
      vehicle.driftMode = mode === 'tap' ? 'tap' : 'hold';
      try { localStorage.setItem(driftModeKey, vehicle.driftMode); } catch { /* Keep the setting for this visit. */ }
      renderMenuControls(controls()); updateDriveUi();
    }
    try { vehicle.driftMode = localStorage.getItem(driftModeKey) === 'tap' ? 'tap' : 'hold'; } catch { /* Storage is optional. */ }
    // Rumble in a controller, a headset's controllers or a phone (see
    // GamepadInput.rumble): a tick at each drift stage, a push with a turbo, a
    // jolt for a crash or a hard landing. The switch is under Sound.
    const vibrationKey = 'citydriver-vibration';
    let vibration = true, crashesFelt = 0;
    try { vibration = localStorage.getItem(vibrationKey) !== 'off'; } catch { /* Storage is optional. */ }
    function setVibration(on) {
      vibration = on;
      try { localStorage.setItem(vibrationKey, on ? 'on' : 'off'); } catch { /* Keep the setting for this visit. */ }
      renderMenuControls(controls());
    }
    // Pay, time and stunt labels over the car. Off, what they show is toasted where a toast can say it.
    const popupsKey = 'citydriver-popups';
    let popups = true;
    try { popups = localStorage.getItem(popupsKey) !== 'off'; } catch { /* Storage is optional. */ }
    taxiView.labels.enabled = demolitionView.labels.enabled = popups;
    function setPopups(on) {
      popups = on; taxiView.labels.enabled = demolitionView.labels.enabled = on;
      try { localStorage.setItem(popupsKey, on ? 'on' : 'off'); } catch { /* Keep the setting for this visit. */ }
      renderMenuControls(controls());
    }
    function rumble(strong, weak, seconds) {
      if (!vibration || !started || paused) return;
      if (vr?.active) input.xr.rumble(Math.max(strong, weak), seconds);
      else if (input.gamepad.connected) input.gamepad.rumble(strong, weak, seconds);
      // (a phone buzzes, a little longer the harder)
      else if (matchMedia('(pointer: coarse)').matches) navigator.vibrate?.(Math.round(seconds * 1000 * Math.max(strong, weak)));
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
      // (in a shift the garage is the cabs, for the next one. Demolition brings its own truck)
      $('#change-car').hidden = gameMode === 'demolition';
      // A run ends with End shift or End run, and its results; a shift has no
      // restart (the next starts with a fare)
      $('#end-run').hidden = !run; $('#restart-run').hidden = gameMode === 'taxi';
      // (free drive's makes a new city, asked twice: a controller's Y gets in and out of cars there,
      // and it comes last, well away from Resume)
      renderMenuControls(controls());
      if (run) $('#garage-heading').after($('#restart-run'), $('#end-run')); else $('#drift-tap').after($('#restart-run'));
      $('#goals-panel').hidden = !run; $('#goals-heading').textContent = gameMode === 'demolition' ? 'Contracts' : 'Shift goals';
      $('#shift-goals').setAttribute('aria-label', $('#goals-heading').textContent);
      $('#scores-panel').hidden = gameMode !== 'demolition';
      $('#taxi-clock-label').textContent = 'TIME';
      $('#taxi-clock').setAttribute('aria-label', gameMode === 'demolition' ? 'Seconds remaining' : 'Shift seconds remaining');
      $('#reset').title = run ? 'Reset car: −5 seconds (R)' : 'Reset car (R)';
      $('#reset').setAttribute('aria-label', $('#reset').title);
      vrStatus.setAccent(gameMode);
      // Residents cost a fine in a demolition run: they glow red, through props too
      world.setPeopleAlert(gameMode === 'demolition', rendering.stencil);
      // (and dive out of the truck's way)
      pedestrianContacts.dodge = gameMode === 'demolition';
      renderGoals(); updateCarUi();
    }
    // (`at`, where to put it back instead: the run at a jump that ended in the river)
    function recoverCar(penalty = false, at = null) {
      const pose = at ? nearestLanePose(at.s, at.u, at.heading) : nearestLanePose(vehicle.s, vehicle.u, vehicle.heading);
      vehicle.s = pose.s; vehicle.u = pose.u; vehicle.heading = pose.heading;
      // (on foot, stood on the lane: from a roof they were left up at its height, and fell)
      vehicle.pilot?.land(); vehicle.walker?.takeOver(); haltCar();
      const run = demolition.running ? demolition : taxi;
      if (penalty) { run.timeLeft = Math.max(0, run.timeLeft - 5); toast('Reset −5s'); }
      taxi.hold = 0;
      world.update(vehicle.s, vehicle.u); vehicle.render(0, world.origin); rendering.snap(); needsRender = true;
    }
    // Into car `id` where the player is (on the road nearby if they were on
    // foot or flying), unless they're already in it. The swap is a cut
    // through dark: under the camera it popped from one car to the other.
    function takeCar(id, carPaint) {
      if (vehicle.carId === id && !vehicle.walker && !onFoot.borrowed && !onFoot.bay) return;
      dipToDark(); onFoot.setCar(id, { paint: carPaint }); recoverCar();
    }
    // Free drive in a cab the fleet owns is a taxi on standby: the fares wait
    // round it, and stopping in a ring starts a shift there and then (see
    // TaxiRun.standby). So is a cab taken from the traffic. Getting out, or
    // into anything else, puts it away. A cab the fleet doesn't own is only a
    // test drive. The demolition truck is the same: the run's clock waits for
    // the first thing it hits (see DemolitionRun.standby).
    const ownCab = id => carEntry(id).taxi && taxi.fleet.owned.has(id);
    const streetCar = () => vehicle.actor.source !== 'garage';
    const workingCab = () => carEntry(vehicle.carId).taxi && (streetCar() || ownCab(vehicle.carId));
    const onStandby = () => started && gameMode === 'free' && !autodrive.enabled && !vehicle.walker;
    const cabbing = () => onStandby() && workingCab();
    const trucking = () => onStandby() && vehicle.carId === DEMOLITION_CAR;
    function syncStandby() {
      if (cabbing() && taxi.status === 'idle') taxi.standby(vehicle);
      else if (!cabbing() && taxi.waiting) taxi.stop();
      if (trucking() && demolition.status === 'idle') demolition.standby();
      else if (!trucking() && demolition.waiting) demolition.stop();
      const standby = taxi.waiting ? 'taxi' : demolition.waiting ? 'demolition' : 'false';
      if (document.body.dataset.standby === standby) return;
      document.body.dataset.standby = standby;
      // (the headset's menus and HUD take its accent too)
      vrStatus.setAccent(standby === 'false' ? gameMode : standby);
    }
    // A taxi shift from a menu: into the player's cab where they are, on
    // standby, so the clock starts with the first fare as it does in free
    // drive. A cab they took off the street stays theirs.
    function beginTaxi() {
      if (changingJourney) return;
      leaveRun(); menuIdle.stop(); started = true; stopAutodrive(); testDrive.stop();
      if (vehicle.walker || !workingCab() || !streetCar()) takeCar(taxi.fleet.selected, taxi.fleet.liveryColor);
      taxi.stop(); taxiView.reset();
      showFree();
    }
    // Demolition from a menu: the truck where they are, on standby, its clock
    // waiting for the first thing it hits. The furniture and parked cars a
    // previous go knocked about are put back.
    function beginDemolition() {
      if (changingJourney) return;
      leaveRun(); menuIdle.stop(); started = true; stopAutodrive(); testDrive.stop();
      props.reset(); stunts.bank(); stuntEvents(stunts.drainEvents());
      if (vehicle.walker || vehicle.carId !== DEMOLITION_CAR) takeCar(DEMOLITION_CAR, DEMOLITION_PAINT);
      demolition.stop(); demolitionView.reset(); driftEffects.reset();
      showFree();
      toast(`Demolition · ${standbyText('demolition')}`);
    }
    // What a job on standby asks, said on getting into its car
    const standbyText = job => job === 'taxi' ? 'Stop in a ring for a fare' : 'Hit anything to start the clock';
    // Into a cab or the demolition truck off the street: its job
    function tellJob() {
      const job = carEntry(vehicle.carId).taxi ? 'taxi' : vehicle.carId === DEMOLITION_CAR ? 'demolition' : null;
      if (job && streetCar() && gameMode === 'free') toast(`${carEntry(vehicle.carId).name} · ${standbyText(job)}`);
    }
    // Either run, once its first fare is aboard or its first hit lands: on,
    // wherever the car is, in traffic. (Traffic already on is left as it is:
    // turning it on again puts every car somewhere new, the one just hit too.)
    function startRun(mode) {
      if (freeTraffic === undefined || gameMode === 'free') freeTraffic = traffic.enabled;
      stunts.bank(); stuntEvents(stunts.drainEvents());
      gameMode = mode; outAfter = false;
      if (!traffic.enabled) traffic.setEnabled(true, vehicle);
      if (mode === 'taxi' && ownCab(vehicle.carId) && !streetCar()) taxi.fleet.select(vehicle.carId);
      cityGuide.lately = []; document.body.dataset.standby = 'false';
      $('#traffic').setAttribute('aria-pressed', 'true'); $('#autodrive').setAttribute('aria-pressed', 'false');
      modeUi(); updateHud();
    }
    // (autodrive is free drive's alone)
    function stopAutodrive() {
      if (autodrive.enabled) { autodrive.toggle(); revealTouchControls(); }
      autodrive.reset();
    }
    // Free drive from the title, in the garage's car
    function beginFree({ preserveInput = false } = {}) {
      if (changingJourney) return;
      menuIdle.stop(); leaveRun(); started = true;
      // (in their own car: a cab picked in the garage was for the shift)
      if (carEntry(carId).taxi) carId = freeCarId;
      autodrive.reset(); takeCar(carId, paint);
      showFree({ preserveInput });
    }
    // Free drive after a run, in whatever the run left the player in, where
    // they are: nothing is swapped or moved. A run ended by getting out
    // (`outAfter`) gets them out now.
    let leaveUntil = -Infinity, outAfter = false;
    const useKey = () => ({ keys: 'E', pad: 'Y', vr: 'Y', touch: 'Get out' })[inputDevice()];
    function keepDriving() {
      if (changingJourney) return;
      leaveRun(); started = true; showFree();
      if (outAfter) { outAfter = false; const said = onFoot.use(); if (said) toast(said); changedCar(); }
    }
    // Ends any run (unrecorded, as a run left half way always was) and puts
    // free drive's traffic setting back
    function leaveRun() {
      const wasRun = taxi.running || taxi.status === 'over' || demolition.running || demolition.status === 'over';
      if (!taxi.waiting) taxi.stop();
      if (!demolition.waiting) demolition.stop();
      gameMode = 'free';
      if (wasRun && freeTraffic !== undefined && freeTraffic !== traffic.enabled) traffic.setEnabled(freeTraffic, vehicle);
    }
    function showFree({ preserveInput = false } = {}) {
      $('#traffic').setAttribute('aria-pressed', String(traffic.enabled)); $('#autodrive').setAttribute('aria-pressed', String(autodrive.enabled));
      $('#taxi-results').hidden = true; $('#demolition-results').hidden = true; $('#welcome').classList.add('hidden');
      rendering.useCameraProfile(vehicle.walker ? 'walking' : 'driving', true); updateViewUi();
      syncStandby(); taxiView.render(taxi, vehicle, world.origin, time); setPaused(false, { preserveInput }); modeUi(); updateHud();
    }
    // A run ended early from the pause menu: its results, as when time runs out
    function endRun() {
      if (taxi.running) { taxi.finish(); for (const event of taxi.drainEvents()) taxiEvent(event); }
      else if (demolition.running) { demolition.finish(); demolitionEvents(demolition.drainEvents()); }
    }
    // The title's main button
    function start() {
      if (paused || changingJourney || started) return;
      beginTaxi();
    }
    function setPaused(value, { preserveInput = false } = {}) {
      menuIdle.stop();
      paused = value; if (!preserveInput) input.clear(); frameClock.suspend();
      if (!paused && autodrive.enabled && !started) beginFree();
      if (!paused) fullscreen.resume();
      if (paused) { clearTimeout(toastTimer); $('#toast').classList.remove('show'); }
      // (the title screen is silent: sound begins with the drive)
      audio.setPaused(paused || !started);
      pauseOverlay.hidden = !paused; $('#pause').setAttribute('aria-pressed', String(paused)); $('#pause').setAttribute('aria-label', paused ? 'Resume' : 'Pause');
      $('#pause .control-label').textContent = paused ? 'resume' : 'pause';
      // (the menu opens at the top, wherever it was last scrolled)
      if (paused) { renderGoals(); renderCareer(); pauseOverlay.scrollTop = 0; $('#resume').focus(); } else $('#pause').blur();
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
    // The garage's cards, under a heading for each kind (cabs, cars, specials,
    // aircraft), with the cabs' liveries under theirs
    function buildCarCards() {
      const current = '<span class="chooser-current">CURRENT CAR</span>', sections = new Map();
      for (const car of garageChoices(false).cars) sections.set(car.group, [...sections.get(car.group) ?? [], car]);
      const livery = '<div class="garage-livery"><div class="garage-livery-heading"><span>Livery</span><span id="garage-livery-name" role="status"></span></div>'
        + '<div id="garage-liveries" class="paint-swatches" role="radiogroup" aria-label="Cab livery"></div><p id="garage-career" class="garage-livery-note"></p></div>';
      $('#garage-sections').innerHTML = [...sections].map(([group, cars], index) => `<h3 id="garage-group-${index}" class="garage-subheading" data-group="${group}">${group}</h3>`
        + (cars.some(car => carEntry(car.id).taxi) ? livery : '')
        + `<div class="chooser-options car-options" role="group" aria-labelledby="garage-group-${index}" data-group="${group}">${cars.map(({ id, label, meters: values }) => {
          const meters = values.map(({ label, level }) =>
            `<span class="car-meter"><span>${label}</span><span class="car-meter-track"><span style="width:${level}%"></span></span></span>`).join('');
          // The portrait is drawn in whatever the garage is wearing, so the grid
          // doubles as the preview: one color repaints the whole fleet at once.
          return `<button type="button" class="chooser-card car-card" data-car="${id}" aria-label="${label}" aria-current="false" style="--car-paint:${cardPaint(id)}">`
            + '<span class="car-price" hidden></span>' + carArt(id)
            + `<span class="chooser-card-copy"><span class="chooser-card-title">${label}</span>`
            + `<span class="car-meters">${meters}</span>${current}</span></button>`;
        }).join('')}</div>`).join('')
        // (and the gear, the jetpack, under its own heading)
        + `<h3 id="garage-group-gear" class="garage-subheading" data-group="Gear">Gear</h3><div class="chooser-options car-options" role="group" aria-labelledby="garage-group-gear" data-group="Gear">`
        + garageChoices(false).gear.map(({ id, label, about }) => `<button type="button" class="chooser-card car-card gear-card" data-gear="${id}" aria-label="${label}">`
          + '<span class="car-price" hidden></span>' + gearArt(id)
          + `<span class="chooser-card-copy"><span class="chooser-card-title">${label}</span><span class="gear-about">${about}</span></span></button>`).join('') + '</div>';
      // (a car the fleet owns is picked, any other opens its offer)
      for (const button of carDialog.querySelectorAll('[data-car]')) button.addEventListener('click', () => garageChoices().cars.find(car => car.id === button.dataset.car)?.activate());
      for (const button of carDialog.querySelectorAll('[data-gear]')) button.addEventListener('click', () => garageChoices().gear.find(item => item.id === button.dataset.gear)?.activate());
      $('#garage-liveries').addEventListener('click', event => {
        const swatch = event.target.closest('[data-livery]');
        if (!swatch) return;
        garageChoices().liveries.find(livery => livery.id === swatch.dataset.livery)?.activate();
        $('#garage-liveries').querySelector(`[data-livery="${swatch.dataset.livery}"]`)?.focus();
      });
    }
    const shopCard = id => carDialog.querySelector(GEAR[id] ? `[data-gear="${id}"]` : `[data-car="${id}"]`);
    // What the garage says about money: a price on each car the fleet doesn't
    // own (gold once it can be bought), the balance over them all, and the
    // car being saved for. An offer, when one is open, takes the cards' place.
    // An unowned car's offer, open over the garage's cards (its id)
    let garageOffer = null;
    const money = amount => `$${amount.toLocaleString('en-US')}`;
    function renderGarage() {
      const garage = garageChoices(), saving = garage.saving;
      // (in a shift it shows only the cabs and their liveries: see garageModel)
      carDialog.dataset.shift = String(garage.shift); paintCards();
      $('#garage-wallet').textContent = garage.summary;
      $('#garage-saving').textContent = garage.shift ? 'Cab changes apply to your next shift' : !saving ? 'Every car in the garage is yours' : saving.short
        ? `${saving.chosen ? 'Saving for' : 'Next up:'} ${saving.label} · ${money(saving.short)} to go` : `${saving.label} · ready to buy`;
      for (const car of [...garage.cars, ...garage.gear]) {
        const card = shopCard(car.id), tag = card?.querySelector('.car-price');
        if (!card) continue;
        tag.hidden = Boolean(car.current); tag.textContent = car.owned ? car.shiftCab ? 'Shift cab' : 'Owned' : car.goal ? `Saving · ${car.value}` : car.value;
        card.dataset.owned = String(car.owned); card.dataset.affordable = String(car.affordable); card.dataset.shiftCab = String(Boolean(car.shiftCab));
        card.setAttribute('aria-label', car.owned ? `${car.label}${car.shiftCab ? ', shift cab' : ''}` : `${car.label}, ${car.value}${car.affordable ? ', can buy now' : ''}`);
        if (!car.gear) { card.setAttribute('aria-current', String(car.current)); card.querySelector('.chooser-current').textContent = garage.shift ? 'NEXT SHIFT' : 'CURRENT CAR'; }
      }
      $('#garage-liveries').innerHTML = garage.liveries.map(({ id, current, disabled, swatch, accessibilityLabel }) =>
        `<button type="button" class="paint-swatch garage-livery-swatch" role="radio" aria-checked="${current}" data-livery="${id}" data-locked="${disabled}"
          style="--swatch:${swatch}" aria-label="${accessibilityLabel}" title="${accessibilityLabel}" ${disabled ? 'disabled' : ''}><span class="paint-chip" aria-hidden="true"></span></button>`).join('');
      $('#garage-livery-name').textContent = garage.liveryName; $('#garage-career').textContent = garage.career;
      renderBank();
      renderOffer(garage.offer);
    }
    // (a shift's results end on the balance and the car it is going toward)
    function renderBank() { $('#taxi-result-bank').textContent = [`Balance ${money(taxi.fleet.balance)}`, savingFor(taxi.fleet)?.text].filter(Boolean).join(' · '); }
    let offerShown = null;
    function renderOffer(offer) {
      const panel = $('#garage-offer');
      // (All cars sits in the heading, where it stays in reach however far the offer scrolls, in place of the balance the offer shows itself)
      panel.hidden = !offer; $('#paint-shop').hidden = Boolean(offer); $('#garage-sections').hidden = Boolean(offer);
      $('#offer-back').hidden = !offer; $('#garage-wallet').parentElement.hidden = Boolean(offer);
      if (!offer) { offerShown = null; return; }
      if (offerShown !== offer.id) {
        offerShown = offer.id;
        $('#offer-art').innerHTML = offer.gear ? gearArt(offer.id) : carArt(offer.id);
        // (gear has no meters: it says what it does)
        $('#offer-meters').innerHTML = offer.gear ? `<span class="gear-about">${offer.about}</span>` : offer.meters.map(({ label, level }) =>
          `<span class="car-meter"><span>${label}</span><span class="car-meter-track"><span style="width:${level}%"></span></span></span>`).join('');
      }
      panel.style.setProperty('--car-paint', offer.paint);
      $('#offer-group').textContent = offer.group; $('#offer-name').textContent = offer.label; $('#offer-price').textContent = offer.price;
      $('#offer-progress').textContent = offer.progress; $('#offer-savings').value = offer.fraction;
      const buy = $('#offer-buy'), test = $('#offer-test'), goal = $('#offer-goal');
      buy.textContent = offer.buy; buy.disabled = !offer.canBuy; buy.dataset.primary = String(offer.canBuy);
      test.textContent = `${offer.trying} · ${offer.test}`; test.disabled = !offer.canTest; test.dataset.primary = String(!offer.canBuy && offer.canTest);
      goal.textContent = offer.goal ? 'Saving for this' : 'Save for this'; goal.setAttribute('aria-pressed', String(offer.goal)); goal.hidden = !offer.canSave;
      $('#offer-note').textContent = offer.note; $('#offer-earn').textContent = offer.earn; $('#offer-earn').hidden = !offer.earn;
    }
    function openOffer(id) {
      garageOffer = id; renderGarage(); needsRender = true;
      // (Buy if it can be bought, else whatever can be done, with as much of the offer above it in view as fits)
      const first = [$('#offer-buy'), $('#offer-test'), $('#offer-goal')].find(button => !button.disabled && !button.hidden);
      carDialog.scrollTop = 0; first.focus({ preventScroll: true }); first.scrollIntoView({ block: 'nearest' });
    }
    function closeOffer() {
      const id = garageOffer;
      garageOffer = null; renderGarage(); needsRender = true;
      if (id) shopCard(id)?.focus();
    }
    // The car to save for (null: none), shown on the results and in the garage
    let goalTold = null;
    function saveFor(id) {
      if (!taxi.fleet.setGoal(id)) return;
      // (said once when the balance first covers it, unless it already does)
      goalTold = id && taxi.fleet.balance >= carPrice(id) ? id : null;
      if (id) toast(`Saving for the ${shopName(id)}`);
      renderGarage(); needsRender = true;
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
      updatePaintUi();
    }
    // (the custom color is shown while it is picked, and paid for once it is let go)
    paintInput.addEventListener('input', () => applyPaint(paintInput.value, { preview: true }));
    paintInput.addEventListener('change', () => applyPaint(paintInput.value));
    // With no garage color set, every car shows the finish it arrived in. The
    // default car has none of its own, so it shows whatever the road it is on
    // would give it.
    const ownPaint = id => (carEntry(id).plain ? ROUTE_PAINT[journey] ?? ROUTE_PAINT.coast : carEntry(id).paint);
    // (the rainbow cycles the cards' paint in CSS, from each car's own color.
    // In a shift the cabs wear their livery, as the shift's cab does)
    const cardPaint = id => inShift() && carEntry(id).taxi ? taxi.fleet.liveryColor ?? ownPaint(id) : paint && paint !== RAINBOW_PAINT ? paint : ownPaint(id);
    const paintCards = () => {
      for (const card of carDialog.querySelectorAll('[data-car]')) card.style.setProperty('--car-paint', cardPaint(card.dataset.car));
      carDialog.dataset.rainbow = String(paint === RAINBOW_PAINT && !inShift());
    };
    function showPaintName() {
      $('#paint-current').textContent = paint === RAINBOW_PAINT ? RAINBOW_NAME : paint ? paintName(paint) ?? paint.toUpperCase() : DEFAULT_PAINT_NAME;
    }
    function updatePaintUi() {
      for (const choice of garageChoices().paints) {
        const swatch = paintSwatches.querySelector(`[data-paint="${choice.id}"]`);
        swatch?.setAttribute('aria-checked', String(choice.current));
        if (swatch) swatch.disabled = choice.disabled;
      }
      const custom = Boolean(paint) && paint !== RAINBOW_PAINT && !PAINTS.some(swatch => swatch.color === paint), own = custom ? paint : ownPaint(carId);
      paintWell.dataset.active = String(custom);
      paintWell.style.setProperty('--swatch', own);
      paintInput.value = own; paintInput.disabled = taxi.fleet.balance < PAINT_PRICE && !custom;
      showPaintName();
    }
    // The color lands on the car where it stands and on every card at once.
    // Default clears it, and the fleet goes back to its own finishes. A new
    // color is paid for as it is chosen (`preview`: shown but not paid for,
    // and put back if the garage closes on it).
    function applyPaint(value, { preview = false } = {}) {
      const color = value === DEFAULT_PAINT ? null : value === RAINBOW_PAINT ? RAINBOW_PAINT : readPaint(value);
      if (value !== DEFAULT_PAINT && !color) return;
      if (!preview && !taxi.fleet.setPaint(color)) {
        showPaint(taxi.fleet.paint);
        $('#paint-current').textContent = `A new color is ${money(PAINT_PRICE)}`;
        return;
      }
      showPaint(color);
      if (!preview) renderGarage();
    }
    function showPaint(color) {
      paint = color;
      // (on the garage car, wherever it is: under the player, or parked)
      if (started && !onFoot.paint(paint)) vehicle.setPaint(paint);
      paintCards(); updatePaintUi();
      vehicle.render(0, world.origin); rendering.update(vehicle.car, 0, world.origin); needsRender = true;
    }
    // Free drive's two buttons climb and descend in the helicopter, and jump
    // and sprint on foot (Space and Shift do, see Input), and are named for it
    const driveButtons = { driving: [['Drift', 'Hold + steer'], ['Boost']], flying: [['Climb', 'Hold'], ['Descend']], walking: [['Jump', 'Hold to fly'], ['Sprint']] };
    let driveMode = null, driveMachine = null, driveTap = null, driveJet = null;
    function updateDriveUi() {
      const free = started && gameMode === 'free', mode = free && vehicle.pilot ? 'flying' : free && vehicle.walker ? 'walking' : 'driving';
      // (the helicopter and the plane fly on the same buttons, but the stick's help differs)
      if (mode === driveMode && vehicle.carId === driveMachine && vehicle.driftMode === driveTap && hasJetpack() === driveJet) return;
      driveMode = mode; driveMachine = vehicle.carId; driveTap = vehicle.driftMode; driveJet = hasJetpack(); document.body.dataset.flying = String(mode === 'flying'); document.body.dataset.walking = String(mode === 'walking');
      if (started) rendering.useCameraProfile(mode === 'walking' ? 'walking' : 'driving');
      updateViewUi();
      ['handbrake', 'boost'].forEach((key, i) => {
        const button = $(`[data-drive-button="${key}"]`), [label, given] = driveButtons[mode][i];
        // (drifting tapped rather than held, see setDriftMode)
        // (and on foot, the jetpack's Hold to fly only with one)
        const hint = mode === 'driving' && key === 'handbrake' && vehicle.driftMode === 'tap' ? 'Tap + steer' : mode === 'walking' && key === 'handbrake' && !hasJetpack() ? 'Tap' : given;
        button.querySelector('span').textContent = label;
        // (and what the Drift button says when it has no drift to show: see renderRunHud)
        if (hint) { const small = button.querySelector('small'); small.textContent = hint; small.dataset.idle = hint; }
      });
      $('.controls .control-label').textContent = mode === 'walking' ? 'walk' : mode === 'flying' ? 'fly' : 'drive';
    }
    // Getting out, and into the car within reach: the button beside Jump and
    // Sprint, which is E's and Y's prompt too, says which (see OnFoot.offer)
    const useButton = $('#use-car');
    function updateUseUi() {
      const offer = started && !paused && gameMode === 'free' && !(testDrive.over && inTestCar()) ? onFoot.offer() : null;
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
      $('#current-car').textContent = garageValue();
      $('#change-car').setAttribute('aria-label', `Garage: ${garageValue()}`);
      updatePaintUi();
    }
    // One garage car at a time: the new one takes the player where they are,
    // in the nearest lane if they were on foot, and the parked one goes
    function swapCar(id) {
      const walked = onFoot.walking;
      onFoot.setCar(id, { paint }); vehicle.render(0, world.origin);
      if (walked) recoverCar();
      autodrive.reset();
      rendering.update(vehicle.car, 0, world.origin);
      updateCarUi(); updateHud(); needsRender = true;
    }
    // (how to fly, on whatever the player is holding: the plane needs a run at it first)
    function flightHelp(id) {
      if (!CARS[id].flies) return '';
      const device = inputDevice();
      const takeOff = { vr: 'Right trigger', pad: 'RT', touch: 'Push the stick up', keys: 'Hold W' }[device];
      const climbing = { vr: 'Right stick: climb / descend', pad: 'Right stick or LB / RB: climb / descend', touch: 'Hold Climb or Descend', keys: 'Space / Shift: climb / descend' }[device];
      return CARS[id].kind === 'plane' ? ` · ${takeOff} to take off · ${climbing}` : ` · ${climbing}`;
    }
    // Buying or test driving goes straight to the drive, wherever the garage was opened from
    function leaveGarage() {
      garageOffer = null;
      if (started) journeyWasPaused = false;
      carDialog.close();
    }
    // A car the fleet owns, from the garage (`bought`: just now)
    function chooseCar(id, bought = false) {
      if ((started && gameMode !== 'free') || !CARS[id] || !taxi.fleet.owned.has(id)) return;
      if (bought) leaveGarage(); else { garageOffer = null; carDialog.close(); }
      // (bought while test driving it, it is theirs where it is)
      if (testDrive.id === id) testDrive.stop();
      const here = (!vehicle.walker && vehicle.actor.source === 'garage' && vehicle.carId === id) || onFoot.garage?.carId === id;
      if (id === carId && here) return;
      pickCar(id, taxi.fleet);
      if (started && !here) swapCar(id);
      else {
        // (bought on the title: straight into it, as a test drive goes, a cab on standby)
        if (!started && bought) { if (carEntry(id).taxi) beginTaxi(); else beginFree(); }
        updateCarUi(); updateHud();
      }
      toast(`${carEntry(id).name} ${bought ? 'bought' : 'selected'}${carEntry(id).taxi ? started ? ` · ${standbyText('taxi')}` : ' for shifts' : flightHelp(id)}`, bought ? 'goal' : '');
    }
    // In a taxi shift the garage holds only the cabs (see garageModel): one
    // picked or bought there drives the next shift, and this one carries on in
    // the cab it started with, back on the pause screen.
    function inShift() { return started && gameMode === 'taxi'; }
    function chooseCab(id, bought = false) {
      if (!bought && !taxi.fleet.select(id)) return;
      garageOffer = null; carDialog.close(); updateCarUi();
      toast(`${carEntry(id).name} ${bought ? 'bought' : 'selected'} · ready for your next shift`, bought ? 'goal' : '');
    }
    function buyCar(id) {
      if ((started && gameMode !== 'free' && !(inShift() && carEntry(id).taxi)) || !taxi.fleet.buy(id)) return;
      audio.cue('goal');
      // (a cab bought is the next shift's: see TaxiFleet.buy)
      if (inShift()) chooseCab(id, true);
      else if (GEAR[id]) { jetTrial.stop(); leaveGarage(); if (!started) beginFree(); toast(`Jetpack bought · ${jetpackHelp()}`, 'goal'); updateCarUi(); }
      else chooseCar(id, true);
    }
    // Owned gear, picked in the garage: how to use it
    function useGear() { leaveGarage(); if (!started) beginFree(); toast(jetpackHelp()); }
    const jetpackHelp = () => `Get out and hold ${{ keys: 'Space', pad: 'A', vr: 'the left grip', touch: 'Jump' }[inputDevice()]} in the air to fly`;
    // The jetpack, tried: TEST_DRIVE_SECONDS of it, counted only on foot (see
    // TestDrive). It cuts out when they're up; the parachute is still theirs.
    const jetTrial = new TestDrive();
    const hasJetpack = () => taxi.fleet.owned.has('jetpack') || (jetTrial.active && !jetTrial.over);
    // A test drive: a couple of minutes in a car the fleet doesn't own (see
    // TestDrive), then the player's own car again. The car they own stays
    // `carId` throughout.
    const testDrive = new TestDrive();
    const inTestCar = () => testDrive.active && !vehicle.walker && vehicle.actor.source === 'garage' && vehicle.carId === testDrive.id;
    function startTestDrive(id) {
      if ((started && gameMode !== 'free') || !(CARS[id] || GEAR[id])) return;
      const cost = taxi.fleet.testDriveCost(id);
      if (!taxi.fleet.testDrive(id)) return;
      leaveGarage();
      if (!started) beginFree();
      if (GEAR[id]) {
        jetTrial.start(id);
        toast(`Jetpack · ${jetTrial.clock} on foot${cost ? ` · −${money(cost)}` : ''} · ${jetpackHelp()}`);
        updateCarUi(); return;
      }
      testDrive.start(id);
      swapCar(id);
      toast(`Test drive · ${carEntry(id).name} · ${testDrive.clock}${cost ? ` · −${money(cost)}` : ''}${flightHelp(id)}`);
    }
    // Once time is up: the car stopped (or landed) and swapped for theirs,
    // through a moment of dark. A car is swapped where it stopped. Something
    // that flew may be on a roof or in a park, so theirs goes in the nearest lane.
    const TEST_STOP = { stop: 1 }, TEST_LAND = { land: true };
    function testDriveStep(dt) {
      const id = testDrive.id;
      // (another car took its place: the garage's, or a run's)
      if (!inTestCar() && onFoot.garage?.carId !== id) { testDrive.stop(); return; }
      // (bought meanwhile, in the Taxi fleet: theirs to keep driving)
      if (taxi.fleet.owned.has(id)) {
        testDrive.stop(); pickCar(id, taxi.fleet);
        updateCarUi(); return;
      }
      const v = vehicle, still = Math.abs(v.speed) < .8 && (!v.pilot || v.pilot.landed) && !v.aloft;
      const news = testDrive.update(dt, { inCar: inTestCar(), still });
      const name = carEntry(id).name;
      if (news === 'warn') toast(`Test drive · ${TEST_DRIVE_WARN} seconds left`);
      else if (news === 'over') { onFoot.leaving = false; toast(`Test drive over · ${v.pilot ? 'landing' : 'stopping'}`, 'slow'); }
      else if (news === 'gone') { onFoot.dropParked(); toast(`Test drive over · ${name} back in the garage`); changedCar(); }
      else if (news === 'done') {
        const flew = CARS[id].flies;
        dipToDark();
        onFoot.setCar(carId, { paint }); haltCar();
        if (flew) recoverCar(); else { vehicle.render(0, world.origin); rendering.snap(); }
        changedCar(); updateHud();
        const short = Math.max(0, carPrice(id) - taxi.fleet.balance);
        toast(`Back in your ${carEntry(carId).name} · ${name} ${short ? `in ${money(short)}` : 'ready to buy'}`);
      }
    }
    // A cut through dark, for swapping the car under the player
    function dipToDark() {
      const fade = $('#menu-view-fade');
      fade.style.transition = 'none'; fade.style.opacity = '1';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        fade.style.transition = 'opacity .5s'; fade.style.opacity = '0';
        fade.addEventListener('transitionend', () => { fade.style.transition = ''; }, { once: true });
      }));
    }
    // The jetpack's try-out, a step on foot: its warning, and its end
    function jetTrialStep(dt) {
      if (taxi.fleet.owned.has('jetpack')) { jetTrial.stop(); return; }
      const news = jetTrial.update(dt, { inCar: true, still: true });
      if (news === 'warn') toast(`Jetpack · ${TEST_DRIVE_WARN} seconds left`);
      else if (news === 'over') { toast(`Jetpack try over · ${money(carPrice('jetpack'))} in the Garage`, 'slow'); updateCarUi(); }
    }
    // The test drive's card in the HUD (see freeHudModel), or the jetpack's on foot
    function testCard() {
      if (jetTrial.active && !jetTrial.over && vehicle.walker) {
        const short = Math.max(0, carPrice('jetpack') - taxi.fleet.balance);
        return { stage: 'Jetpack try', label: 'Jetpack', clock: jetTrial.clock, left: jetTrial.left, fraction: jetTrial.fraction, over: false, price: money(carPrice('jetpack')),
          note: short ? `${money(short)} to go · Garage` : 'Yours to buy in the Garage' };
      }
      if (!testDrive.active) return null;
      const id = testDrive.id, price = carPrice(id), short = Math.max(0, price - taxi.fleet.balance);
      return { label: carEntry(id).name, clock: testDrive.clock, left: testDrive.left, fraction: testDrive.fraction, over: testDrive.over,
        landing: Boolean(vehicle.pilot), own: carEntry(carId).name, price: money(price),
        note: carEntry(id).taxi ? 'No fares until it\'s yours' : short ? `${money(short)} to go · Garage` : 'Yours to buy in the Garage' };
    }
    // What the player is holding, for anything that names a button
    const inputDevice = () => vr?.active ? 'vr' : document.body.dataset.controller === 'true' ? 'pad' : matchMedia('(pointer: coarse)').matches ? 'touch' : 'keys';
    // Once-only hints (how to drift, spin, roll, fly the jetpack) wait their
    // turn: never over another toast and a few seconds apart, so what just
    // happened is said first and one hint never wipes out another. One that
    // no longer applies when its turn comes (`still`) is dropped, to be asked
    // again, and `told` keeps it from being said again once it shows.
    const HINT_AFTER = 3000, HINT_GAP = 7000, hints = [];
    let hintShown = -Infinity;
    function hint(text, still, told) {
      if (!hints.some(queued => queued.text === text)) hints.push({ text, still, told });
    }
    function showHints(now) {
      if (!started || paused || !hints.length || now - toastShown < HINT_AFTER || now - hintShown < HINT_GAP) return;
      while (hints.length) {
        const next = hints.shift();
        if (!next.still()) continue;
        toast(next.text); next.told(); hintShown = now;
        return;
      }
    }
    const free = () => started && gameMode === 'free';
    const driving = () => free() && !vehicle.pilot && !vehicle.walker;
    // (the button a car drifts with, which also tricks and spins it in the air)
    const driftButton = () => ({ keys: 'Space', pad: 'X', vr: 'the left grip', touch: 'Drift' })[inputDevice()];
    // The plane's stunts (see Plane), told once each: the roll after a while
    // up in the air, and the loop after the first roll
    const flightHintKey = 'citydriver-flight-hints';
    const flightHints = readHintFlags(flightHintKey, taxiStorage);
    const flying = () => free() && vehicle.carId === 'plane' && Boolean(vehicle.pilot) && !vehicle.pilot.landed;
    function hintFlight(stunt = null) {
      const pilot = vehicle.pilot;
      if (!pilot || !flying()) return;
      const which = !flightHints.roll && pilot.aloft > 6 && !pilot.stunt ? 'roll' : !flightHints.loop && stunt === 'Barrel roll' ? 'loop' : null;
      if (!which) return;
      const device = inputDevice();
      const text = which === 'roll' ? { keys: 'Double-tap A or D to barrel roll', pad: 'Flick the left stick twice to barrel roll', vr: 'Flick the left stick twice to barrel roll', touch: 'Flick the stick twice sideways to barrel roll' }[device]
        : { keys: 'Double-tap Space to loop the loop', pad: 'Double-tap LB to loop the loop', vr: 'Double-tap the left grip to loop the loop', touch: 'Double-tap Climb to loop the loop' }[device];
      hint(text, flying, () => {
        flightHints[which] = true;
        try { localStorage.setItem(flightHintKey, JSON.stringify(flightHints)); } catch { /* Told for this visit. */ }
      });
    }
    // Jumps in free drive, told once each after a landing: how to spin, once a
    // jump has had the air for it, then how to do a trick, and where the
    // city's jumps are kept
    const airHintKey = 'citydriver-air-hints';
    const airHints = readHintFlags(airHintKey, taxiStorage);
    const toldAir = which => { airHints[which] = true; try { localStorage.setItem(airHintKey, JSON.stringify(airHints)); } catch { /* Told for this visit. */ } };
    function hintAir(event) {
      if (!free() || event.landing === 'splash') return;
      // (a player who spins or tricks already needs no telling)
      if (event.turns && !airHints.spin) toldAir('spin');
      if (event.trick && !airHints.trick) toldAir('trick');
      const which = !airHints.spin && event.air >= 1 ? 'spin' : airHints.spin && !airHints.trick && event.air >= .8 ? 'trick'
        : !airHints.book && event.jump?.stars ? 'book' : null;
      if (!which) return;
      // (held from the ground it does not spin: see Drift.spinning)
      const text = which === 'spin' ? `In the air, press and hold ${driftButton()} and steer to spin`
        : which === 'trick' ? `Tap ${driftButton()} as you leave a ramp for a trick and a boost`
        : 'Pause to see the city\'s jumps and your stars';
      hint(text, () => driving() && !airHints[which], () => toldAir(which));
    }
    // Drifting in free drive, told once each: how to, once the car has been
    // going fast for a while and hasn't drifted, and after the first blue
    // turbo, that there is more to a drift than blue sparks
    const driftHintKey = 'citydriver-drift-hints';
    const driftHints = readHintFlags(driftHintKey, taxiStorage);
    let fastTime = 0;
    const toldDrift = which => { driftHints[which] = true; try { localStorage.setItem(driftHintKey, JSON.stringify(driftHints)); } catch { /* Told for this visit. */ } };
    function hintDrift(event = null, dt = 0) {
      if (!driving() || !vehicle.drift) return;
      if (event) {
        // (a first turbo past blue, and there is nothing to tell)
        if (event.stage > 1) toldDrift('stages');
        if (!driftHints.stages) hint('Drift for longer: orange, then pink sparks, bigger boosts', () => driving() && !driftHints.stages, () => toldDrift('stages'));
        return;
      }
      if (driftHints.drift) return;
      if (vehicle.drifting) { toldDrift('drift'); return; }
      fastTime += Math.abs(vehicle.speed) > 12 ? dt : 0;
      if (fastTime < 8) return;
      const button = driftButton();
      hint(vehicle.driftMode === 'tap' ? `Tap ${button} while steering to drift · tap again to boost` : `Hold ${button} and steer to drift · let go to boost`, () => driving() && !driftHints.drift, () => toldDrift('drift'));
    }
    // On foot in free drive, told once after a moment: the jetpack and the
    // parachute are both on jump
    let jetHinted = false, footTime = 0;
    try { jetHinted = localStorage.getItem('citydriver-jetpack-hint') === 'shown'; } catch { /* Storage is optional. */ }
    const walkingFree = () => free() && Boolean(vehicle.walker) && !jetHinted && hasJetpack();
    // (without it, a jump held in the air says where it is sold, once a visit)
    let jetAsked = false;
    function hintJetpack(dt) {
      const walker = vehicle.walker;
      if (free() && walker && !hasJetpack() && !jetAsked && walker.held && !walker.grounded && walker.time - walker.heldAt > .5) {
        jetAsked = true;
        hint(`The jetpack is in the Garage · ${money(carPrice('jetpack'))}`, () => free() && !hasJetpack(), () => {});
      }
      if (!walkingFree()) { footTime = 0; return; }
      if ((footTime += dt) < 1.5) return;
      const button = { keys: 'Space', pad: 'A', vr: 'the left grip', touch: 'Jump' }[inputDevice()];
      hint(`Hold ${button} to fly the jetpack · tap it up high for the parachute`, walkingFree, () => {
        jetHinted = true;
        try { localStorage.setItem('citydriver-jetpack-hint', 'shown'); } catch { /* Told for this visit. */ }
      });
    }
    // A cab or the demolition truck going by, told once each: it can be
    // taken, and what for (from another car, getting out first)
    const jobHintKey = 'citydriver-job-hints';
    const jobHints = readHintFlags(jobHintKey, taxiStorage);
    const working = () => taxi.waiting || demolition.waiting;
    function hintJobs() {
      if (!free() || vehicle.pilot || working() || !traffic.enabled || autodrive.enabled) return;
      for (const car of traffic.vehicles) {
        if (!car.job || jobHints[car.job] || !car.car.visible || Math.hypot(car.s - vehicle.s, car.u - vehicle.u) > 25) continue;
        const job = car.job, take = vehicle.walker ? 'get in' : 'get out and take it';
        hint(job === 'taxi' ? `That's a cab · ${take} to pick up fares` : `That's the demolition truck · ${take} for a run`,
          () => free() && !vehicle.pilot && !working() && !jobHints[job], () => { jobHints[job] = true; try { localStorage.setItem(jobHintKey, JSON.stringify(jobHints)); } catch { /* Told for this visit. */ } });
      }
    }
    // (closing it goes back to whatever opened it: the pause screen's row, or the results' button)
    let garageReturnFocus = null;
    function openCars() {
      if (started && gameMode === 'demolition') { toast('Garage: not in a demolition run'); return; }
      // (pausing focuses Resume, so note the focus first)
      const focus = document.activeElement;
      if (!holdForChooser()) return;
      garageReturnFocus = focus;
      garageOffer = null; renderGarage();
      carDialog.showModal(); chooserName = 'garage'; carDialog.scrollTop = 0;
      carDialog.querySelector(`[data-car="${inShift() ? taxi.fleet.selected : carId}"]`).focus();
    }
    // What the pause screen's Garage row says: the car, or in a shift the next shift's cab
    function garageValue() {
      return inShift() ? `${carEntry(taxi.fleet.selected).name} · next shift` : carEntry(started && gameMode !== 'free' ? vehicle.carId : carId).name;
    }
    // Back, from a chooser (Escape, B): out of a car's offer to the garage,
    // else out of the chooser. Its close button always closes it.
    function backOut(chooser) {
      if (chooser === carDialog && garageOffer) closeOffer(); else chooser.close();
    }
    carDialog.addEventListener('cancel', event => { if (garageOffer) { event.preventDefault(); closeOffer(); } });
    // (and a custom color picked but never let go is put back)
    carDialog.addEventListener('close', () => { garageOffer = null; if (paint !== taxi.fleet.paint) showPaint(taxi.fleet.paint); });
    $('#offer-back').addEventListener('click', closeOffer);
    for (const [button, item] of [['#offer-buy', 'offer-buy'], ['#offer-test', 'offer-test'], ['#offer-goal', 'offer-goal']])
      $(button).addEventListener('click', () => garageChoices().offer?.items.find(each => each.id === item).activate());
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
      if (name === 'fullscreen') { await fullscreen.toggle(); return; }
      if (changingJourney) return;
      const chooser = openChooser();
      if (chooser) {
        if (name === 'menuClose' || (vr?.active && name === 'pause')) backOut(chooser);
        else if ((name === 'car' && chooser === carDialog) || (name === 'map' && chooser === worldMapDialog)) chooser.close();
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
      // N: the street map shown or folded away, while it is on screen (not in a headset, which has none)
      if (name === 'streetMap') { if (started && !paused && !vr.active && !runOver()) cityGuide.toggle(); return; }
      if (name === 'nextJourney') return;
      if (name === 'recenter') {
        if (!started) return;
        if (vr.active) rendering.vrCamera.recenter();
        else { rendering.recenter(paused); if (paused) rendering.update(vehicle.car, 0, world.origin); }
        needsRender = true; return;
      }
      if (name === 'zoomIn' || name === 'zoomOut') {
        if (!started || paused || changingJourney || vr.active || !(rendering.chaseView || rendering.firstPersonView)) return;
        zoomCamera(name === 'zoomIn' ? 1 / 1.2 : 1.2); return;
      }
      if (taxi.status === 'over') { if (name === 'reset') beginTaxi(); return; }
      if (demolition.status === 'over') { if (name === 'reset') beginDemolition(); return; }
      if (name === 'car') { openCars(); return; }
      // E, Y or the button: out of the car, or into the one within reach (free drive only)
      if (name === 'use') {
        if (!started || paused) return;
        // In a run, getting out ends it, as leaving the cab ends GTA's taxi
        // work. The first press asks: a second within a few seconds ends it,
        // and they get out once its results are put away (see keepDriving).
        if (gameMode !== 'free') {
          const shift = gameMode === 'taxi' ? 'shift' : 'run';
          if (performance.now() > leaveUntil) { leaveUntil = performance.now() + 4000; toast(`Press ${useKey()} again to end the ${shift} and get out`); return; }
          leaveUntil = -Infinity; outAfter = true; endRun();
          return;
        }
        // (a test drive that is over is handed back first)
        if (testDrive.over && inTestCar()) return;
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
      if (name === 'pause' && !(paused && fullscreen.recentlyReleased)) setPaused(!paused);
      // R puts the car back on the road in every mode (a run's clock pays for
      // it). A new city is only ever the pause menu's, asked twice.
      if (name === 'reset') {
        if (taxi.running || demolition.running) { recoverCar(true); return; }
        if (!started || paused) return;
        recoverCar(); toast(vehicle.walker ? 'Back on the street' : 'Back on the road');
        return;
      }
      if (name === 'newCity') {
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
      const paid = taxi.fleet.enterKonami();
      toast(paid ? `+${money(paid)}` : 'Balance limit reached', 'goal');
      if (!paid) return;
      audio.cue('goal'); buildPaintSwatches(); renderGarage(); needsRender = true;
      // (entered on the pause screen, its header shows the new balance)
      if (paused) renderCareer();
    });
    vr = new BrowserVR({
      renderer, buttons: [$('#enter-vr'), $('#enter-vr-pause')], canEnter: () => !changingJourney && !openChooser(),
      onStart() {
        menuIdle.stop();
        $('#vr-error').hidden = true;
        input.xrActive = true; input.clear(); input.xr.clear({ consumeEdges: true });
        vrStatus.attach(vr.session); vrHintTime = 0;
        rendering.enterVR(); rendering.update(vehicle.car, 0, world.origin); updateViewUi();
        rendering.vrCamera.recenter(); graphics.suspend();
        // Holding the headset's own button recenters its space: the game's seat and panels follow.
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
        input.xr.clear({ consumeEdges: true }); vrStatus.clearPointers();
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
      $('#enter-vr').classList.toggle('menu-secondary', !on); for (const id of ['#start', '#demolition', '#free-drive']) $(id).classList.toggle('menu-secondary', on);
      if (on) { $('.menu-actions').prepend($('#enter-vr')); $('.pause-column').prepend($('#enter-vr-pause')); }
      else { $('.menu-actions').append($('#enter-vr')); $('.graphics-panel').after($('#enter-vr-pause')); }
    }
    // WebXR needs a secure page, which a headset opening the dev server over
    // the local network is not; say so rather than hide Enter VR unexplained.
    if (headsetBrowser() && !window.isSecureContext) { $('#vr-error').textContent = 'VR needs a secure page. Open Citydriver over HTTPS to play in your headset.'; $('#vr-error').hidden = false; }
    const fullscreen = createFullscreen({ button: $('#fullscreen'), state: () => ({ started, paused, vr: vr.active }), pause: () => setPaused(true), toast });
    $('#fullscreen').addEventListener('click', () => action('fullscreen'));
    const desktop = window.citydriverDesktop;
    if (desktop) {
      desktop.onEscape(() => {
        const chooser = openChooser();
        if (chooser) chooser.close(); else action('pause');
      });
      // Desktop builds that cannot update themselves get the web build's toast
      // on the title and a download button in the pause menu.
      let updateShown = false;
      const showUpdate = update => {
        if (!update || updateShown) return;
        updateShown = true;
        const download = () => window.open(update.url); // the wrapper hands it to the system browser
        const notice = document.createElement('div');
        notice.className = 'update-notice';
        notice.innerHTML = '<span role="status"></span><button type="button" title="Opens the download page">Download</button>';
        notice.firstChild.textContent = `Version ${update.version} available`;
        for (const type of ['keydown', 'keyup']) notice.addEventListener(type, event => event.stopPropagation());
        notice.lastChild.addEventListener('click', download);
        $('#welcome').insertBefore(notice, $('#welcome > .controller-hint'));
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'panel-button update-entry';
        button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v10m-4-4 4 4 4-4M5 16v4h14v-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span></span>';
        button.lastChild.textContent = `Get version ${update.version}`;
        button.title = 'Opens the download page';
        button.addEventListener('click', download);
        $('#enter-vr-pause').after(button);
      };
      desktop.onUpdate(showUpdate);
      desktop.getUpdate().then(showUpdate);
    }
    // In either perspective view, the wheel brings the camera in or out, and
    // the mouse looks round the car, or through the player's eyes, once a
    // click on the scene has taken the pointer (in fullscreen, at once)
    const looking = () => started && !paused && !changingJourney && !vr.active && (rendering.chaseView || rendering.firstPersonView);
    function zoomCamera(factor) {
      const view = rendering.viewIndex;
      rendering.zoom(factor);
      if (rendering.viewIndex !== view) updateViewUi();
    }
    const lookHintKey = 'citydriver-mouse-look';
    let lookHint = 0, lookKnown = false, lookHinted = false;
    try { lookKnown = lookHinted = localStorage.getItem(lookHintKey) === 'known'; } catch { /* Storage is optional. */ }
    const cameraPreferences = rendering.cameraPreferences;
    const mouseLook = new MouseLook($('#scene'), { lookable: looking, automatic: () => fullscreen.active, zoomable: looking, look: (yaw, pitch) => cameraPreferences.look('mouse', yaw, pitch, rendering.look), zoom: zoomCamera,
      released: () => fullscreen.released(),
      captured: () => {
        fullscreen.captured();
        if (lookKnown) return;
        lookKnown = lookHinted = true;
        try { localStorage.setItem(lookHintKey, 'known'); } catch { /* Known for this visit. */ }
      } });
    input.touchStick.lookable = looking;
    input.touchStick.onLook = (yaw, pitch) => cameraPreferences.look('touch', yaw, pitch, rendering.look);
    const cameraControls = setupCameraControls(rendering, { action,
      chooseView: index => { rendering.setView(index, true); updateViewUi(); rendering.update(vehicle.car, 0, world.origin); needsRender = true; },
      changed: () => { rendering.update(vehicle.car, 0, world.origin); needsRender = true; },
      inputSource: () => input.gamepad.connected ? 'controller' : matchMedia('(any-pointer: coarse)').matches ? 'touch' : 'mouse',
    });
    // A first drive with a mouse says, once, how to look round with it
    function hintMouseLook(dt) {
      if (lookHinted || !looking() || !mouseLook.mouse.matches || mouseLook.locked || input.gamepad.connected || controlHelpDismissed() || Math.abs(vehicle.speed) < 2) return;
      lookHint += dt;
      if (lookHint < 5) return;
      lookHinted = true;
      hint('Click to look around with the mouse', () => looking() && !mouseLook.locked && !lookKnown, () => {});
    }
    // On foot through their own eyes, movement strafes when the mouse, right
    // stick or second thumb owns the view; keyboard alone turns it.
    const strafing = () => vr.active || input.gamepad.connected || mouseLook.locked || input.touchStick.engaged;
    // A touch acts on pointerup: a secondary finger may not synthesize a
    // click while the stick is held (and see pressOnRelease).
    for (const name of ['pause', 'view']) pressOnRelease($(`#${name}`), () => action(name));
    for (const dialog of choosers) {
      dialog.addEventListener('close', () => {
        if (openChooser() === dialog) chooserName = null;
        if (!changingJourney) setPaused(journeyWasPaused || document.hidden);
        if (runOver()) pauseOverlay.hidden = true;
        if (dialog === carDialog && garageReturnFocus?.checkVisibility()) garageReturnFocus.focus();
        if (dialog === worldMapDialog && paused && !pauseOverlay.hidden) $('#open-world-map').focus();
      });
      dialog.addEventListener('click', event => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
      });
    }
    window.addEventListener('keydown', event => {
      const menu = openChooser() ?? openPauseMenu();
      if (menu) handleMenuKey(menu, event);
    }, { capture: true });
    window.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (started || paused || changingJourney || document.querySelector('dialog[open]')) return;
      if (event.target.closest?.('button, a, input, select, textarea, [contenteditable]') && event.target !== $('#start')) return;
      event.preventDefault();
      if (!event.repeat) start();
    });
    document.addEventListener('visibilitychange', () => { if (vr.active || vr.pending) return; audio.setHidden(document.hidden); if (document.hidden) { if (openChooser() || changingJourney) journeyWasPaused = true; if (started && !paused) setPaused(true); input.clear(); } frameClock.suspend(); });
    window.addEventListener('blur', () => { if (vr.active || vr.pending) return; audio.setHidden(true); if (openChooser() || changingJourney) journeyWasPaused = true; if (started && !paused) setPaused(true); });
    window.addEventListener('focus', () => audio.setHidden(hidden()));
    window.addEventListener('pointerdown', () => audio.unlock(), { capture: true, passive: true });
    window.addEventListener('keydown', () => audio.unlock(), { capture: true });
    window.addEventListener('pagehide', event => { audio.setHidden(true); if (!event.persisted) { onFoot.clear(); vehicle.disposeModel(); enterMarker.dispose(); nightLighting.dispose(); props.dispose(); world.dispose(); weather.dispose(); traffic.dispose(); taxiView.dispose(); demolitionView.dispose(); driftEffects.dispose(); void audio.dispose().catch(() => {}); } });
    window.addEventListener('pageshow', () => { audio.setHidden(document.hidden); needsRender = true; });
    // Progress saved in another tab shows here too (every change also picks it
    // up first: see TaxiFleet.sync)
    window.addEventListener('storage', event => {
      if (event.key !== FLEET_KEY && event.key !== CAREER_KEY) return;
      taxi.fleet.sync(); taxi.career.sync();
      if (paused) renderCareer();
      if (carDialog.open) renderGarage();
    });
    $('#scene').addEventListener('webglcontextlost', event => { event.preventDefault(); setPaused(true); toast('Graphics lost. Reload to restart.'); });
    $('#scene').addEventListener('webglcontextrestored', () => { needsRender = true; toast('Graphics restored. Resume when ready.'); });
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
    const fogDistance = $('#fog-distance'), fogDistanceValue = $('#fog-distance-value');
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
      const fogPercent = Math.round(settings.fogDistance * 100);
      const fogText = `${fogPercent}%${settings.fogDistance === DEFAULT_FOG_DISTANCE ? ' · Default' : ''}`;
      fogDistance.value = String(fogPercent);
      fogDistance.style.setProperty('--control-level', `${fogPercent}%`);
      fogDistanceValue.textContent = fogText; fogDistance.setAttribute('aria-valuetext', fogText);
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
    fogDistance.addEventListener('input', () => graphics.setFogDistance(Number(fogDistance.value) / 100));
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
    const cashText = () => `$${taxi.fleet.balance.toLocaleString('en-US')}`;
    const locationModel = () => locationHudModel(vehicle, cityDistrict(vehicle.s, vehicle.u), weather.state.label, cashText());
    // The district card (heading, district and weather) only comes up for a
    // few seconds on driving into a district, and at the start of a drive.
    // A new name has to hold for a moment first, and one shown in the last
    // half minute isn't shown again: along the water the name flicks between
    // Harbor or Riverfront and the district behind it.
    const district = { current: null, next: null, since: 0, until: -Infinity, shown: new Map() };
    const cityHud = $('.city-hud');
    function announceDistrict(place) {
      district.current = place; district.next = null; district.shown.set(place, time); district.until = time + 4;
    }
    function updateDistrictCard(place) {
      const driving = gameMode === 'free' && started && !paused && !changingJourney;
      // (and with the fleet balance on it, it comes up for a few seconds when that changes)
      const balance = taxi.fleet.balance;
      if (driving && district.cash !== undefined && balance !== district.cash) district.until = time + 4;
      district.cash = balance;
      if (!started || gameMode !== 'free') district.current = null;
      else if (driving) {
        if (district.current === null) announceDistrict(place);
        else if (place === district.current) district.next = null;
        else if (place !== district.next) { district.next = place; district.since = time; }
        else if (time - district.since >= 1.5) {
          if (time - (district.shown.get(place) ?? -Infinity) > 30) announceDistrict(place);
          else district.current = place;
        }
      }
      const show = String(driving && time < district.until);
      if (cityHud.dataset.show !== show) cityHud.dataset.show = show;
    }
    // (a phone only offers reset in a run once the car has sat still for a
    // few seconds, see taxi.css)
    let movedAt = 0;
    function updateStuck() {
      if (!started || paused || vehicle.walker || vehicle.pilot || Math.abs(vehicle.speed) > 1.5) movedAt = time;
      const stuck = String(time - movedAt > 3);
      if (document.body.dataset.stuck !== stuck) document.body.dataset.stuck = stuck;
    }
    // Free drive's tips, each shown once in the task card (see freeHudModel)
    const freeTips = new OnceHints({
      chain: 'Stunts chain up · a crash loses it',
    }, 'citydriver-free-hints', taxiStorage);
    // The car being saved for is said once, in free drive, when the balance first covers it
    function tellGoal() {
      const goal = taxi.fleet.goal;
      if (!goal || goal === goalTold || taxi.fleet.balance < carPrice(goal) || !started || paused || gameMode !== 'free') return;
      goalTold = goal; toast(`You can buy the ${shopName(goal)} · open the Garage`, 'goal'); audio.cue('goal');
    }
    function updateHud() {
      const location = locationModel();
      renderLocationHud(location);
      updateDistrictCard(location.place); updateStuck();
      renderMenuControls(controls());
      cityGuide.update(started && !paused && !changingJourney, { draw: !vr?.active });
      const run = gameMode === 'demolition' ? demolitionView.buildHud(demolition, vehicle)
        : started && gameMode === 'free' ? freeHudModel(stunts, vehicle, { taxi, demolition, test: testCard(), hint: id => freeTips.get(id) })
        : taxiView.buildHud(taxi, vehicle);
      renderRunHud(run); placeToast(); tellGoal();
      updateUseUi();
      if (vr?.active) vrStatus.hud(started && !paused && !changingJourney ? headsetHudModel(run, location, vrHint()) : null);
    }
    function updateViewUi() {
      input.touchStick.releaseLook();
      cameraControls?.refresh();
      $('#view').title = `${rendering.viewLabel} · Change camera (V)`;
      $('#view').setAttribute('aria-label', `${rendering.viewLabel}. Change camera`);
      const thirdPerson = rendering.camera.isPerspectiveCamera, flying = document.body.dataset.flying === 'true', walking = document.body.dataset.walking === 'true';
      $('.stick-help-copy').firstChild.textContent = walking ? rendering.firstPersonView ? 'Touch anywhere · ↑ Walk · ↔ Step' : 'Drag anywhere to walk' : thirdPerson ? `Touch anywhere · ↑ ${flying ? 'Fly' : 'Drive'} · ↔ ${flying ? 'Turn' : 'Steer'}` : `Drag anywhere to ${flying ? 'fly' : 'drive'}`;
      // (the plane never stops in the air: let go, it cruises)
      const cruising = flying && carEntry(vehicle.carId).kind === 'plane';
      $('.stick-help-line').textContent = thirdPerson ? 'Second thumb: drag to look' : walking ? 'Push further to run'
        : cruising ? 'Release to cruise' : flying ? 'Release to hover' : 'Release to stop';
      $('#touch-stick').setAttribute('aria-label', walking ? 'Virtual joystick: push the way to walk, further to run' : thirdPerson ? 'Virtual joystick: up to accelerate, left and right to steer, down to brake or reverse, release to stop' : 'Virtual joystick');
    }
    const menuActions = {
      start: () => vr.active ? beginTaxi() : start(), taxi: beginTaxi, demolition: beginDemolition, free: beginFree, resume: () => setPaused(false),
      back: () => openChooser()?.close(), exit: () => action('exitVR'), garage: openCars, keep: keepDriving, end: endRun, newCity: askNewCity,
      autodrive: () => action('autodrive'), traffic: toggleTraffic, driftTap: () => setDriftMode(vehicle.driftMode === 'tap' ? 'hold' : 'tap'),
      vibration: () => setVibration(!vibration), popups: () => setPopups(!popups), reset: () => action('reset'), map: openWorldMap,
      weather: () => chooseWeather(cycleChoice(WEATHER_CHOICES.map(([id]) => id), weather.mode)),
      view: () => action('view'), recenter: () => action('recenter'), comfort: toggleComfort,
      lookSensitivity: () => cameraPreferences.setInput('controller', { sensitivity: cycleChoice([.25, .5, .75, 1, 1.25, 1.5, 2], cameraPreferences.inputs.controller.sensitivity) }),
      graphics: () => graphics.setMode(cycleChoice(['auto', 'high', 'balanced', 'smooth', 'basic'], graphics.mode)),
      rate: () => graphics.chooseHeadsetRate(cycleChoice([null, ...headsetRates()], graphics.rateChoice)),
      sound: () => action('sound'), mix: () => { audio.setPreset(cycleChoice(['balanced', 'scenic', 'night'], audio.preset)); refreshAudioMixer(); },
    };
    const headsetRates = () => [...(vr.session?.supportedFrameRates ?? [])].sort((a, b) => a - b);
    function menuState() {
      return { loading: changingJourney, started, paused, mode: gameMode, chooser: chooserName, over: runOver(),
        running: taxi.running || demolition.running, location: locationModel(), carName: garageValue(),
        autodrive: autodrive.enabled, traffic: traffic.enabled, driftTap: vehicle.driftMode === 'tap', vibration, popups,
        weather: weather.mode, view: rendering.viewLabel, lookSensitivity: cameraPreferences.inputs.controller.sensitivity, comfort: comfort.enabled, graphics: graphics.auto ? 'Auto' : graphics.settings.label,
        rates: headsetRates(), rateChoice: graphics.rateChoice, frameRate: vr.session?.frameRate, sound: audio.enabled, mix: audio.preset,
        career: careerText(), newCityArmed: performance.now() < newCityUntil, standby: taxi.waiting ? 'taxi' : demolition.waiting ? 'demolition' : null };
    }
    // A new city is asked twice, the second press within a few seconds: it
    // throws away the places found and the jump stars
    let newCityUntil = -Infinity;
    function askNewCity() {
      if (performance.now() < newCityUntil) { newCityUntil = -Infinity; action('newCity'); return; }
      newCityUntil = performance.now() + 4000; renderMenuControls(controls());
      setTimeout(() => renderMenuControls(controls()), 4100);
    }
    const controls = () => menuControls(menuState(), menuActions);
    const garageChoices = (shift = inShift()) => garageModel({ carId, paint, ownPaint, fleet: taxi.fleet, offer: garageOffer, career: taxi.career, shift },
      { chooseCar, chooseCab, chooseLivery, applyPaint, openOffer, closeOffer, buyCar, testDrive: startTestDrive, saveFor, useGear });
    const brandMark = new Image(); brandMark.src = `${import.meta.env.BASE_URL}brand-mark.svg`;
    function currentMenuModel() {
      const state = menuState();
      return menuModel(state, menuControls(state, menuActions), {
        garage: state.chooser === 'garage' ? garageChoices() : null,
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
      // (the jetpack is bought, or tried)
      vehicle.jetpack = hasJetpack();
      // (a test drive's time is up: the car stops, or lands itself)
      if (testDrive.over && inTestCar()) state = vehicle.pilot ? TEST_LAND : TEST_STOP;
      vehicle.update(dt, state);
      if (started) updateControlHelp(vehicle.speed);
      // (a flying machine's stunts and landings)
      if (vehicle.pilot) {
        for (const event of vehicle.pilot.drain()) pilotEvent(event);
        hintFlight();
      }
      // (a car's jumps, and the river it came down in: see CarAir)
      for (const event of vehicle.drain()) carEvent(event);
      hintDrift(null, dt); hintJetpack(dt); hintJobs();
      if (vehicle.audioTelemetry.crashSerial !== crashesFelt) { crashesFelt = vehicle.audioTelemetry.crashSerial; rumble(.8, .6, .2); }
      // Furniture the player hits may be knocked flying, and a parked car
      // knocked loose while there is traffic to take it; on foot, nothing is
      collideScenery(vehicle, world.chunks, dt, vehicle.walker ? null : (collider, contact) => collider.prop ? props.hit(collider, contact, vehicle) : traffic.enabled && traffic.wake(collider));
      // (working as a cab, on standby or in a shift, the other cabs keep off the road, and the same for the truck)
      traffic.offDuty = taxi.waiting || taxi.running ? 'taxi' : demolition.waiting || demolition.running ? 'demolition' : null;
      traffic.update(dt, vehicle, world.chunks);
      // Out of the car once it has stopped, and the car left parked
      const walked = onFoot.walking, said = onFoot.update(dt, world.chunks);
      if (said) toast(said);
      if (onFoot.walking !== walked) { changedCar(); if (walked) tellJob(); }
      if (started && gameMode === 'free' && testDrive.active) testDriveStep(dt);
      if (started && gameMode === 'free' && jetTrial.active && vehicle.walker) jetTrialStep(dt);
      props.update(dt, vehicle, traffic, world.chunks);
      // Free drive: the stunt chain, and in the player's cab the fares waiting
      if (started && gameMode === 'free') {
        stunts.update(dt, vehicle, traffic.enabled ? traffic.vehicles : [], { active: freeStunts(), aloft: Boolean(vehicle.aloft) });
        stuntEvents(stunts.drainEvents());
        syncStandby();
        // (not while stopping to get out: that stop is no pickup)
        if (taxi.waiting && !onFoot.leaving) { taxi.update(dt, vehicle); for (const event of taxi.drainEvents()) taxiEvent(event); }
      }
      if (started && taxi.running) {
        taxi.update(dt, vehicle, traffic.enabled ? traffic.vehicles : []);
        for (const event of taxi.drainEvents()) taxiEvent(event);
        tickClock(taxi.timeLeft);
      }
      if (started && demolition.running) {
        demolition.update(dt, Boolean(vehicle.aloft));
        demolitionEvents(demolition.drainEvents());
        tickClock(demolition.timeLeft);
      }
    };
    // What a shift has to say, and its end
    function taxiEvent(event) {
      if (event.kind === 'over') {
        haltCar();
        setPaused(true); pauseOverlay.hidden = true; taxiView.hud(taxi, vehicle); taxiView.results(taxi, cityGuide.lately); renderBank(); $('#taxi-retry').focus();
        return;
      }
      // (the first fare from standby: the shift begins with it)
      if (event.first) startRun('taxi');
      if (event.kind === 'goal') {
        // A goal usually completes on a payout, whose toast lands first.
        renderGoals(); setTimeout(() => { if (taxi.running && !paused) { toast(event.text, 'goal'); audio.cue('goal'); } }, 1500);
      } else {
        // (what the labels over the cab show isn't said again in a toast)
        const words = taxiView.pop(event) ? event.brief : event.text;
        if (words) toast(words, event.rating ?? event.tone ?? '');
        audio.cue(event.kind, event);
      }
      // (a fare's drop-off finds its place, quietly during the shift)
      if (event.destination) cityGuide.arrive(event.destination.id);
    }
    // Free drive's stunts: the multiplier called out, and the chain's pot paid
    // when it banks (or lost). Only the bank pops a label: one for every stunt
    // was too busy, and the task card already names each one and its pay.
    function stuntEvents(events) {
      for (const event of events) {
        if (event.kind === 'stunt' || event.kind === 'smash') {
          if (event.kind === 'smash') audio.cue('smash', event); else audio.cue('tip', { combo: event.chain });
        } else if (event.kind === 'multiplier') { toast(event.text, 'chain'); audio.cue('multiplier', event); }
        else if (event.kind === 'banked') {
          earn(event.amount); audio.cue('banked');
          taxiView.labels.pop({ amount: `+$${event.amount.toLocaleString('en-US')}`, caption: 'BANKED', colour: '#ffe07a' });
        } else if (event.kind === 'lost') { toast(event.text, 'slow'); audio.cue('penalty'); }
      }
    }
    // A flying machine's stunts and landings join free drive's chain as a
    // car's jumps do, with a chime for a stunt and a jolt through the pad for
    // a hard landing
    function pilotEvent(event) {
      const p = vehicle.groundedPosition, stunt = event.kind === 'stunt';
      if (freeStunts()) stunts.flew(event, p);
      if (event.kind === 'bounce') { toast(event.text); rumble(.6, .4, .15); return; }
      if (stunt) { audio.cue('bonus'); rumble(0, .35, .1); hintFlight(event.text); }
    }
    // A jump landed counts for whichever run is on, or goes in free drive's
    // book of jumps. A car come down on takes the blow. Down in the river,
    // the car is fished out at the run it took at the jump, to have another go.
    function carEvent(event) {
      if (event.kind === 'jump') {
        if (event.landing === 'hard' || event.landing === 'spun') rumble(.6, .4, .15);
        if (taxi.running) taxi.jumped(event, vehicle);
        else if (demolition.running) demolition.jumped(event);
        else if (started && gameMode === 'free') {
          const news = jumpBook.land(event), p = vehicle.groundedPosition, pay = (news?.gained ?? 0) * STAR_PAY;
          if (freeStunts()) stunts.jumped(event, p);
          // (each star newly taken off a named jump pays)
          earn(pay);
          hintAir(event);
          if (!news) return;
          if (news.gold) audio.cue('bonus');
          cityGuide.refreshJumps();
        }
      } else if (event.kind === 'drift') {
        if (taxi.running) taxi.drifted(event, vehicle); else if (freeStunts()) stunts.drifted(event, vehicle.groundedPosition);
        rumble(0, .2 + event.stage * .12, .06);
      }
      else if (event.kind === 'turbo') { hintDrift(event); rumble(.3 + event.stage * .15, .5, .12 + event.stage * .08); }
      else if (event.kind === 'stomp') { traffic.stomp(event.on, event.impact, event); rumble(.7, .5, .18); }
      // (on foot, down on their feet from high up: see Walker's HARD_LANDING)
      else if (event.kind === 'thud') rumble(Math.min(.7, event.impact / 40), .4, .15);
      else if (event.kind === 'sunk') {
        const run = taxi.running || demolition.running, from = event.from, h = from?.heading ?? vehicle.heading;
        const at = from?.jump?.runup ?? (from ? { s: from.s - Math.cos(h) * 30, u: from.u - Math.sin(h) * 30, heading: h } : null);
        recoverCar(run, at);
        if (!run) toast('Into the river · back for another go');
      }
    }
    // A run's last ten seconds tick away
    function tickClock(timeLeft) {
      const left = Math.ceil(timeLeft);
      if (left < shiftTick && left <= 10 && left > 0) audio.cue('tick', { urgent: left <= 5 });
      shiftTick = left;
    }
    // What a demolition run has to say: prices float up over the truck, and
    // the step's biggest news that no label shows takes the panel's last line
    function demolitionEvents(events) {
      let news = null, later = null;
      const say = (text, tone, weight) => { if (!news || weight >= news.weight) news = { text, tone, weight }; };
      for (const event of events) {
        // (the first hit from standby: the run begins with it)
        if (event.kind === 'begin') { startRun('demolition'); say('Wreck everything · Mind the pedestrians', 'goal', 6); audio.cue('goal'); }
        else if (event.kind === 'smash' || event.kind === 'dent') { demolitionView.pop(event); audio.cue('smash', event); }
        else if (event.kind === 'wreck') {
          demolitionView.pop(event); audio.cue('wreck');
          if (event.seconds) { demolitionView.pop({ ...event, kind: 'bonus' }); audio.cue('bonus'); }
        } else if (event.kind === 'progress') say(event.text, '', 1);
        else if (event.kind === 'multiplier') { say(event.text, 'chain', 3); audio.cue('multiplier', event); }
        else if (event.kind === 'contract') { if (!demolitionView.pop(event)) say(event.text, 'goal', 4); audio.cue('goal'); }
        else if (event.kind === 'banked') {
          say(event.text, 'banked', 3); audio.cue('banked');
          // (the contractor's cut of the damage goes into the fleet balance)
          earn(event.pay);
          // (a new rating is its own news, a moment later, as a taxi goal is)
          if (event.rank) later = `Rating · ${event.rank.name}`;
        } else if (event.kind === 'record') later = later ? `${event.text} ${later}` : event.text;
        else if (event.kind === 'penalty') {
          if (!demolitionView.pop(event)) say(event.text, 'slow', 4);
          audio.cue('penalty');
          if (event.fine && event.lost) demolitionView.pop({ ...event, fine: 0 });
        }
        else if (event.kind === 'overtime') { say(event.text, 'slow', 5); audio.cue('overtime'); }
        else if (event.kind === 'over') {
          haltCar();
          setPaused(true); pauseOverlay.hidden = true; demolitionView.hud(demolition, vehicle); demolitionView.results(demolition, savingFor(taxi.fleet)?.text); $('#demolition-retry').focus();
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
      // (in free drive, a headset's Y gets in and out of cars)
      const freeDrive = started && gameMode === 'free';
      const wokeMenu = menuIdle.update(performance.now());
      if (vr.active) input.xr.update(vr.session.inputSources, { blocked: !vr.visible || changingJourney, paused: paused || vrStatus.visible, freeDrive });
      else {
        input.gamepad.update({ blocked: wokeMenu || document.hidden || !document.hasFocus() || changingJourney, paused, menu: openChooser() ? 'chooser' : openPauseMenu() ? 'pause' : openWelcomeMenu() ? 'welcome' : false });
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
          if (vehicle.walker && rendering.firstPersonView && !strafing()) rendering.look((input.state.moveX || 0) * STICK_LOOK * dt, 0);
          if (yaw || pitch) cameraPreferences.look('controller', yaw * STICK_LOOK * dt, pitch * STICK_LOOK * dt, rendering.look);
        }
        hintMouseLook(dt); showHints(performance.now());
        if (input.touchStick.lookPointer !== null && looking()) rendering.look(0, 0);
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
        demolitionView.render(vehicle, time, vr.active ? null : rendering.camera);
        driftEffects.update(vehicle, dt, started);
        const at = vehicle.groundedPosition;
        pigeons.gather(world.chunks.values(), at.x, at.z, time, pigeonGround);
        pigeons.scare({ x: at.x, y: at.y, z: at.z, speed: Math.abs(vehicle.speed), car: !vehicle.walker, airborne: Boolean(vehicle.walker && !vehicle.walker.grounded) }, time, world.chunks.values());
        pigeons.render(world.origin, time);
        applyWeather(dt);
      }
      // (a flying machine's climbs and dives count as surges too, and so does a
      // fall on foot, past the 7 m/s a jump lands at: counting a hop's take-off,
      // the vignette pulsed with every jump)
      // (and a car's jumps, from a ramp's lip to the landing)
      const walker = vehicle.walker, vy = vehicle.pilot ? vehicle.pilot.vy : walker ? Math.max(0, Math.abs(walker.vy) - 8) : vehicle.carAir && Math.abs(vehicle.vy) > 2 ? Math.abs(vehicle.vy) - 2 : null;
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
        if (!sceneReady) { sceneReady = true; $('#loading').classList.add('loaded'); $('#error').hidden = true; }
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
    $('#paint-note').textContent = `Paint applies to all cars. A new color is ${money(PAINT_PRICE)}, and each car's own color is free.`;
    buildCarCards(); paintCards(); buildPaintSwatches(); updateCarUi();
    vehicle.render(0, world.origin); traffic.render(1, world.origin); rendering.update(vehicle.car, 1, world.origin); updateHud(); updateJourneyUi(); updateViewUi(); updateGraphicsUi();
    nightLighting.update(world, vehicle, traffic, weather.state.lightLevel);
    prepareWorldMap();
    // The menus and the HUD's states, drawn once out of sight so the first
    // pause, garage, boost or drift doesn't wait on the browser's own shaders.
    // It runs alongside the graphics stage (only a missed head start if it fails).
    const buttonStates = [{}, { boosting: 'true' }, { drifting: 'true', stage: '1' }, { turbo: 'true', stage: '3' }];
    const interfaceWarmed = warmInterface($('#app'), [
      async ({ copy, show }) => {
        for (const part of ['.topbar', '#city-guide', '#taxi-hud', '#taxi-dash']) copy($(part));
        copy($('#toast')).classList.add('show');
        const task = copy($('#taxi-task')), buttons = copy($('#taxi-buttons'));
        // (the bars part full, as they are while they fill and run down)
        for (const bar of [task, buttons].flatMap(part => [...part.querySelectorAll('[id$=-fill], #taxi-stop-progress')])) bar.style.width = '37.3%';
        for (const state of buttonStates) { for (const key of ['boosting', 'drifting', 'turbo', 'stage']) delete buttons.dataset[key]; Object.assign(buttons.dataset, state); await show(); }
        task.dataset.arriving = 'true'; await show();
      },
      async ({ copy, show }) => { copy(pauseOverlay); await show(); },
      async ({ copy, show }) => { copy(carDialog, { dialog: true }); await show(); },
      async ({ copy, show }) => { drawWorldMap(copy(worldMapDialog, { dialog: true })); copy($('#taxi-results')); copy($('#demolition-results')); await show(); },
    ]).catch(error => console.warn('Interface warm-up failed', error));
    await loadingStage('graphics');
    // (the shop signs are blank until their sheet has loaded)
    await signSheet;
    // (someone on foot, and their parachute)
    const onFootWarmup = createWalkerModel(); onFootWarmup.canopy.visible = true;
    await rendering.precompile([...world.warmupObjects(), ...props.warmupObjects(), ...taxiView.warmupObjects(), ...demolitionView.warmupObjects(), ...driftEffects.warmupObjects(), ...enterMarker.warmupObjects(), ...pigeons.warmupObjects(), onFootWarmup.figure, onFootWarmup.canopy]);
    try { taxiView.navigation.prepare(); } catch { /* The first fare tries again. */ }
    // Soft shading too, where it is on: loaded and drawn once behind the
    // loading screen, since its first frame compiles for ~200 ms.
    await rendering.ambientOcclusion.prepare();
    await interfaceWarmed;
    changingJourney = false;
    renderer.setAnimationLoop(frame);
    // `?xr` in development emulates a Quest 3 (see xr-emulator.js).
    const emulate = new URLSearchParams(window.location.search).get('xr');
    if (import.meta.env.DEV && emulate !== null) (await import('./xr-emulator.js')).installXREmulator(emulate);
    void vr.detect();
    // Development-only inspection surface for automated driving and streaming checks.
    if (import.meta.env.DEV) window.__citydriver = { seed: SEED, city: CITY, nav: navGraph(), lanePose, roadAt, nearestLanePose, vehicle, onFoot, pigeons, traffic, props, nightLighting, weather, autodrive, audio, graphics, vr, vrStatus, currentMenuModel, stunts, keepDriving, endRun, cityGuide, taxi, taxiView, beginTaxi, beginFree, demolition, demolitionView, beginDemolition, testDrive, jetTrial, startTestDrive, buyCar, get gameMode() { return gameMode; }, world, rendering, input, action,
      // (review kits stage any car through this, so it hands the car over first, as the garage once did)
      chooseCar: id => { if (CARS[id]) taxi.fleet.owned.add(id); chooseCar(id); }, applyPaint, get carId() { return carId; }, get paint() { return paint; }, get journey() { return journey; }, get changingJourney() { return changingJourney; }, get paused() { return paused; }, get started() { return started; } };
  } catch (error) { console.error('Could not start Citydriver:', error); $('#loading').classList.add('loaded'); $('#error p').textContent = startupErrorMessage(error); $('#error').hidden = false; $('#error button').focus(); }
}
boot();
