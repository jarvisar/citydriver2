import test from 'node:test';
import assert from 'node:assert/strict';
import { TaxiRun, STOP_SECONDS } from '../src/taxi-run.js';
import { TaxiFleet } from '../src/taxi-fleet.js';
import { TaxiCareer } from '../src/taxi-career.js';
import { DemolitionRun, CHAIN_SECONDS } from '../src/demolition-run.js';
import { garageModel, createFleetMenu } from '../src/chooser-model.js';
import { menuControls, menuModel, WEATHER_CHOICES, cycleChoice } from '../src/menu-model.js';
import { taxiHudModel, demolitionHudModel, locationHudModel, headsetHudModel } from '../src/run-hud-model.js';
import { renderRunHud } from '../src/run-hud-dom.js';
import { taxiResultModel, demolitionResultModel } from '../src/result-model.js';
import { DEFAULT_PAINT } from '../src/car-paint.js';

const player = () => ({ s: 25, u: 3, heading: 0, speed: 0, distance: 1609.344, boosting: false, drifting: false });
const state = (extra = {}) => ({ started: true, paused: true, loading: false, chooser: null, mode: 'taxi', over: false, running: true,
  location: { place: 'Downtown', distance: '1.0' }, carName: 'City Taxi', fleetName: 'City Taxi', weather: 'sunset', view: 'Chase view',
  graphics: 'Auto', sound: true, mix: 'balanced', comfort: true, rates: [], rateChoice: null, ...extra });
const actions = calls => new Proxy({}, { get: (_, key) => () => calls.push(key) });

test('menu choices and commands cover the title, pause modes, choosers and results without a page', () => {
  const calls = [], commands = actions(calls);
  const build = (s, data) => menuModel(s, menuControls(s, commands), data);
  let model = build(state({ started: false, paused: false }));
  assert.equal(model.id, 'title'); model.items[0].activate(); assert.deepEqual(calls, ['start']);
  assert.equal(menuControls(state({ started: false }), commands).garage.disabled, false, 'a garage visit before starting is allowed');
  assert.equal(menuControls(state(), commands).garage.disabled, true, 'an active taxi run keeps its cab');
  assert.equal(build(state({ paused: false })), null);
  assert.equal(build(state({ loading: true })).id, 'loading');
  for (const [mode, driving] of [['taxi', ['End shift', 'Demolition', 'Taxi fleet', 'Tap to drift', 'Reset car']],
    ['demolition', ['Restart run', 'End run', 'Taxi shift', 'Tap to drift', 'Reset car']], ['free', ['Taxi shift', 'Demolition', 'Garage', 'Taxi fleet', 'Autodrive', 'Traffic', 'Tap to drift', 'Reset car']]]) {
    model = build(state({ mode, running: mode !== 'free' }));
    assert.deepEqual(model.items.filter(item => item.group === 'Driving').map(item => item.label), driving);
    assert.equal(model.items[0].label, 'Resume'); assert.equal(model.items[0].primary, true);
    assert.equal(model.items.find(item => item.id === 'weather').value, 'Golden hour');
    assert.equal(model.items.find(item => item.id === 'sound').toggle, true);
    assert.equal(model.items.some(item => item.id === 'rate'), false);
  }
  model = build(state({ rates: [72, 90], frameRate: 90 }));
  assert.equal(model.items.find(item => item.id === 'rate').value, 'Auto · 90 Hz');
  assert.equal(cycleChoice(WEATHER_CHOICES.map(([id]) => id), 'night'), 'auto');
  model = build(state({ over: true, chooser: 'map' }), { mapKey: 1 });
  assert.equal(model.id, 'map', 'a chooser can cover results'); model.items[0].activate(); assert.equal(calls.at(-1), 'back');
  for (const mode of ['taxi', 'demolition']) {
    model = build(state({ mode, over: true }), { result: { cash: '$500', name: 'Class D', next: 'Next rating', best: 'Best $600' } });
    assert.equal(model.title, 'Time up · $500');
    assert.deepEqual(model.items.slice(0, 3).map(item => item.label), mode === 'taxi' ? ['Next shift', 'Keep driving', 'Taxi fleet'] : ['Play again', 'Keep driving', 'Taxi shift']);
    assert.equal(model.items[2].value, undefined, 'results keep the short action labels');
    model.items[0].activate(); assert.equal(calls.at(-1), mode);
    model.items[1].activate(); assert.equal(calls.at(-1), 'keep');
  }
});

test('garage selection uses car and paint state, and preserves paint-first headset paging', () => {
  const calls = [], ownPaint = () => '#123456';
  const garage = garageModel('sports', '#abcdef', ownPaint, { chooseCar: id => calls.push(id), applyPaint: paint => calls.push(paint) });
  assert.equal(garage.cars.find(car => car.current).id, 'sports');
  assert.ok(garage.paints.every(paint => !paint.current), 'custom paint selects no preset');
  garage.cars.find(car => car.id === 'taxi').activate(); garage.paints[0].activate();
  assert.deepEqual(calls, ['taxi', DEFAULT_PAINT]);
  const s = state({ mode: 'free', chooser: 'garage' }), model = menuModel(s, menuControls(s, actions([])), { garage });
  assert.equal(model.items[0].group, 'Paint'); assert.equal(model.items[0].swatch, '#123456');
  assert.deepEqual([...new Set(garage.cars.map(car => car.group))], ['Cabs', 'Cars', 'Specials', 'Aircraft'], 'the garage in sections');
  assert.ok(!garage.cars.some(car => ['auto', 'desert', 'city'].includes(car.id)), 'without the old route wagons');
  assert.equal(model.items.at(-1).label, 'Back');
});

test('fleet models validate purchases and locked liveries without desktop buttons, including stale rows', () => {
  const fleet = new TaxiFleet(), career = new TaxiCareer(), changes = [], paint = [];
  const menu = createFleetMenu(fleet, { running: () => true, career, onChange: () => changes.push(fleet.selected), onLivery: color => paint.push(color) });
  const locked = menu.model().cabs.find(cab => cab.id === 'taxiGT');
  assert.equal(locked.disabled, true); assert.equal(locked.value, '$1,500');
  assert.equal(locked.activate(), false); assert.equal(changes.length, 0);
  fleet.credit(1500); assert.equal(menu.model().cabs.find(cab => cab.id === 'taxiGT').disabled, false);
  assert.equal(locked.activate(), true); assert.equal(fleet.balance, 0); assert.equal(fleet.selected, 'taxiGT');
  assert.equal(locked.activate(), true); assert.equal(fleet.balance, 0, 'a second activation only selects an owned cab');
  assert.match(menu.model().note, /next run/);
  const livery = menu.model().liveries.find(livery => livery.id === 'cream');
  assert.equal(livery.disabled, true); assert.equal(livery.activate(), false);
  career.earnings = 2000; assert.equal(livery.activate(), true); assert.equal(paint.length, 1);
  assert.equal(menu.model().liveries.find(livery => livery.current).id, 'cream');
});

test('taxi HUD covers nearby fares, boarding, rating changes, group stops and overtime from run state', () => {
  const run = new TaxiRun(), car = player(); run.start(car);
  const customer = run.customers.find(customer => customer.passengers > 1 && customer.id !== run.blockedPickup?.id);
  Object.assign(car, { s: customer.s, u: customer.u });
  let model = taxiHudModel(run, car);
  assert.equal(model.title, `To ${customer.destination.name}`); assert.equal(model.detail, 'Stop to pick up'); assert.equal(model.timer, null);
  run.update(STOP_SECONDS / 2, car); model = taxiHudModel(run, car);
  assert.equal(model.detail, 'Boarding…'); assert.equal(model.stopProgress.visible, true);
  run.update(STOP_SECONDS / 2, car); assert.equal(run.status, 'driving');
  for (const [fraction, tone] of [[.8, 'speedy'], [.4, 'normal'], [.1, 'slow']]) {
    run.legElapsed = run.currentStop.limit * (1 - fraction);
    model = taxiHudModel(run, car);
    assert.equal(model.timer.tone, tone); assert.ok(Math.abs(model.timer.fraction - fraction) < 1e-6);
    assert.match(model.nextStop, /^Next · /); assert.match(model.party, /aboard/);
    assert.equal(headsetHudModel(model).timer.fraction, fraction);
  }
  run.overtime = true; model = taxiHudModel(run, car);
  assert.equal(model.clockLabel, 'LAST RIDE'); assert.equal(model.stage, 'Last ride');
  Object.assign(car, { s: run.target.s, u: run.target.u }); model = taxiHudModel(run, car);
  assert.equal(model.navigation.distance, 'Here'); assert.equal(model.detail, 'Dropping off…');
});

test('demolition HUD switches between contracts, chains and overtime without stale taxi fields', () => {
  const run = new DemolitionRun(), car = player(); run.start();
  let model = demolitionHudModel(run, car);
  assert.equal(model.timer.fraction, null); assert.equal(model.navigation, null);
  assert.match(headsetHudModel(model).detail, /\+.*s/);
  run.smash(['bench']); model = demolitionHudModel(run, car);
  assert.equal(model.timer.text, '1 hit'); assert.equal(model.timer.tone, 'chain'); assert.ok(model.timer.fraction > 0);
  assert.equal(model.nextStop, '3 more for ×2');
  run.timeLeft = .01; run.update(.02); model = demolitionHudModel(run, car);
  assert.equal(model.clockLabel, 'LAST CHAIN'); assert.equal(model.clock, '');
  assert.equal(headsetHudModel(model).clock, '');
  run.update(CHAIN_SECONDS + 1); assert.equal(demolitionHudModel(run, car).running, false);
});

test('rendering the same HUD twice does not advance cash or hints, and desktop edits cannot change the headset model', () => {
  const run = new TaxiRun(), car = player(); run.start(car); run.cash = 1000;
  car.s = car.u = 1e6;
  let hints = 0;
  const model = taxiHudModel(run, car, { hint: () => { hints++; return 'A hint'; } });
  assert.equal(model.shownCash, 350); assert.equal(hints, 1);
  const headset = headsetHudModel(model), elements = new Map();
  let writes = 0;
  const element = () => {
    const attributes = new Map();
    return { textContent: '', hidden: false, dataset: {}, style: {}, value: 0,
      getAttribute: name => attributes.get(name), setAttribute: (name, value) => { writes++; attributes.set(name, value); } };
  };
  const previous = globalThis.document;
  globalThis.document = { getElementById(id) { if (!elements.has(id)) { const el = element(); el.parentElement = element(); elements.set(id, el); } return elements.get(id); } };
  try {
    renderRunHud(model); const firstWrites = writes; renderRunHud(model);
    assert.equal(writes, firstWrites, 'unchanged attributes are not rewritten');
    assert.equal(elements.get('taxi-cash').textContent, headset.cash);
    elements.get('taxi-cash').textContent = 'Changed on desktop';
    elements.get('taxi-timer-fill').style.width = '100%';
    assert.deepEqual(headsetHudModel(model), headset); assert.equal(hints, 1);
    const free = taxiHudModel({ running: false }, { ...car, boosting: true, walker: {} }, { free: true });
    renderRunHud(free); assert.equal(elements.get('taxi-hud').hidden, true); assert.equal(elements.get('taxi-buttons').hidden, false);
    assert.equal(elements.get('taxi-boost-state').textContent, 'Sprinting');
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

test('location and result summaries are available before either interface renders', () => {
  const car = player(), location = locationHudModel({ ...car, heading: -Math.PI / 2 }, 'Harbour', 'Night');
  assert.deepEqual(location, { distance: '1.0', heading: 'W', place: 'Harbour', weather: 'Night', cash: '' });
  assert.equal(headsetHudModel(null, location).place, 'Harbour');
  const run = new TaxiRun(); run.start(car); run.cash = 600; run.timeLeft = .01; run.update(.02, car);
  const taxi = taxiResultModel(run, [{ name: 'Museum' }]);
  assert.equal(taxi.cash, '$600'); assert.match(taxi.best, /1 new place found/); assert.match(taxi.next, /New best license/);
  const demolition = new DemolitionRun(); demolition.start(); demolition.score = 1e6; demolition.timeLeft = .01; demolition.update(.02);
  const result = demolitionResultModel(demolition);
  assert.equal(result.cash, '$1,000,000'); assert.match(result.next, /New high score/);
});
