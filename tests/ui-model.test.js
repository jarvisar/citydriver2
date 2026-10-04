import test from 'node:test';
import assert from 'node:assert/strict';
import { TaxiRun, STOP_SECONDS } from '../src/taxi-run.js';
import { TaxiFleet } from '../src/taxi-fleet.js';
import { TaxiCareer } from '../src/taxi-career.js';
import { DemolitionRun, CHAIN_SECONDS } from '../src/demolition-run.js';
import { garageModel, savingFor } from '../src/chooser-model.js';
import { carPrice, testDrivePrice } from '../src/cars.js';
import { menuControls, menuModel, WEATHER_CHOICES, cycleChoice } from '../src/menu-model.js';
import { taxiHudModel, demolitionHudModel, locationHudModel, headsetHudModel } from '../src/run-hud-model.js';
import { renderRunHud } from '../src/run-hud-dom.js';
import { taxiResultModel, demolitionResultModel } from '../src/result-model.js';
import { DEFAULT_PAINT } from '../src/car-paint.js';

const player = () => ({ s: 25, u: 3, heading: 0, speed: 0, distance: 1609.344, boosting: false, drifting: false });
const state = (extra = {}) => ({ started: true, paused: true, loading: false, chooser: null, mode: 'taxi', over: false, running: true,
  location: { place: 'Downtown', distance: '1.0' }, carName: 'City Taxi', weather: 'sunset', view: 'Chase view',
  graphics: 'Auto', sound: true, mix: 'balanced', comfort: true, rates: [], rateChoice: null, ...extra });
const actions = calls => new Proxy({}, { get: (_, key) => () => calls.push(key) });

test('menu choices and commands cover the title, pause modes, choosers and results without a page', () => {
  const calls = [], commands = actions(calls);
  const build = (s, data) => menuModel(s, menuControls(s, commands), data);
  let model = build(state({ started: false, paused: false }));
  assert.equal(model.id, 'title'); model.items[0].activate(); assert.deepEqual(calls, ['start']);
  assert.equal(menuControls(state({ started: false }), commands).garage.disabled, false, 'a garage visit before starting is allowed');
  assert.equal(menuControls(state(), commands).garage.disabled, false, 'in a shift the garage is the cabs, for the next one');
  assert.equal(menuControls(state({ mode: 'demolition' }), commands).garage.disabled, true, 'a demolition run keeps its truck');
  assert.equal(build(state({ paused: false })), null);
  assert.equal(build(state({ loading: true })).id, 'loading');
  // The pause screen's two mode buttons: in a run, Free drive beside the other run; on a job's standby, Free drive in its place
  for (const [extra, modes] of [[{ mode: 'free' }, [['Taxi shift', 'taxi'], ['Demolition', 'demolition']]], [{ mode: 'free', standby: 'taxi' }, [['Free drive', 'free'], ['Demolition', 'demolition']]],
    [{ mode: 'free', standby: 'demolition' }, [['Taxi shift', 'taxi'], ['Free drive', 'free']]], [{ mode: 'taxi' }, [['Free drive', 'free'], ['Demolition', 'demolition']]],
    [{ mode: 'demolition' }, [['Free drive', 'free'], ['Taxi shift', 'taxi']]]]) {
    const controls = menuControls(state(extra), commands);
    assert.deepEqual([controls.switchMode, controls.otherRun].map(({ label, job }) => [label, job]), modes, JSON.stringify(extra));
  }
  for (const [mode, driving] of [['taxi', ['End shift', 'Free drive', 'Demolition', 'Garage', 'Tap to drift', 'Reset car']],
    ['demolition', ['Restart run', 'End run', 'Free drive', 'Taxi shift', 'Tap to drift', 'Reset car']], ['free', ['Taxi shift', 'Demolition', 'Garage', 'Autodrive', 'Traffic', 'Tap to drift', 'Reset car']]]) {
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
    assert.deepEqual(model.items.slice(0, 3).map(item => item.label), mode === 'taxi' ? ['Next shift', 'Free drive', 'Garage'] : ['Play again', 'Free drive', 'Taxi shift']);
    assert.equal(model.items[2].value, undefined, 'results keep the short action labels');
    model.items[0].activate(); assert.equal(calls.at(-1), mode);
    model.items[1].activate(); assert.equal(calls.at(-1), 'keep');
  }
});

const garageActions = calls => ({ chooseCar: id => calls.push(id), applyPaint: paint => calls.push(paint), openOffer: id => calls.push(`offer:${id}`),
  closeOffer: () => calls.push('close'), buyCar: id => calls.push(`buy:${id}`), testDrive: id => calls.push(`test:${id}`), saveFor: id => calls.push(`save:${id}`), useGear: id => calls.push(id),
  chooseCab: id => calls.push(`cab:${id}`), chooseLivery: id => calls.push(`livery:${id}`) });
test('the garage says when progress is not being saved', () => {
  let full = false; const values = new Map();
  const disk = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { if (full) throw Error('Quota'); values.set(key, value); } };
  const fleet = new TaxiFleet(disk), career = new TaxiCareer(disk), ownPaint = () => '#123456';
  const garage = shift => garageModel({ carId: 'coast', paint: null, ownPaint, fleet, career, shift }, garageActions([]));
  assert.equal(garage(false).unsaved, false); assert.doesNotMatch(garage(false).summary, /not saved/);
  full = true; fleet.credit(100);
  assert.equal(garage(false).unsaved, true); assert.match(garage(false).summary, /\$100 · \d+ of \d+ owned · Progress not saved/);
  const s = state({ mode: 'taxi', started: true, chooser: 'garage' });
  assert.match(menuModel(s, menuControls(s, actions([])), { garage: garage(true) }).subtitle, /Progress not saved/);
  full = false; fleet.credit(1);
  assert.equal(garage(false).unsaved, false, 'a later save that works clears it');
});

test('garage selection uses car and paint state, and preserves paint-first headset paging', () => {
  const calls = [], ownPaint = () => '#123456', fleet = new TaxiFleet();
  fleet.credit(carPrice('sports')); fleet.buy('sports');
  const garage = garageModel({ carId: 'sports', paint: '#abcdef', ownPaint, fleet }, garageActions(calls));
  assert.equal(garage.cars.find(car => car.current).id, 'sports');
  assert.ok(garage.paints.every(paint => !paint.current), 'custom paint selects no preset');
  garage.cars.find(car => car.id === 'taxi').activate(); garage.paints[0].activate();
  assert.deepEqual(calls, ['taxi', DEFAULT_PAINT]);
  const s = state({ mode: 'free', chooser: 'garage' }), model = menuModel(s, menuControls(s, actions([])), { garage });
  assert.equal(model.items[0].group, 'Paint'); assert.equal(model.items[0].swatch, '#123456');
  assert.match(model.subtitle, /\$0 · 3 of 21 owned/);
  assert.equal(model.items.find(item => item.id === 'jetpack')?.label, 'Jetpack', 'the gear after the cars');
  assert.ok(!garage.paints.some(item => item.id === 'rainbow'), 'no rainbow before the code');
  assert.ok(garage.paints.filter(item => item.id !== DEFAULT_PAINT).every(item => item.disabled), 'no color without the money for it');
  assert.equal(garage.paints[0].disabled, false, 'each car\'s own color is free');
  assert.deepEqual([...new Set(garage.cars.map(car => car.group))], ['Cabs', 'Cars', 'Specials', 'Aircraft'], 'the garage in sections');
  assert.ok(!garage.cars.some(car => ['auto', 'desert', 'city'].includes(car.id)), 'without the old route wagons');
  assert.equal(model.items.at(-1).label, 'Back');
});

test('an unowned car opens its offer: buy it, test drive it or save for it, the same commands on the page and in a headset', () => {
  const calls = [], fleet = new TaxiFleet(), ownPaint = () => '#123456', build = offer => garageModel({ carId: 'taxi', paint: null, ownPaint, fleet, offer }, garageActions(calls));
  let garage = build(null);
  const plane = garage.cars.find(car => car.id === 'plane');
  assert.equal(plane.owned, false); assert.equal(plane.value, '$140,000'); assert.equal(plane.affordable, false);
  plane.activate(); assert.deepEqual(calls, ['offer:plane']);
  garage = build('plane');
  const s = state({ mode: 'free', chooser: 'garage' }), model = menuModel(s, menuControls(s, actions([])), { garage });
  assert.equal(model.id, 'car-offer'); assert.equal(model.title, 'Plane');
  const [buy, drive, save, back] = model.items;
  assert.equal(buy.disabled, true, 'not yet'); assert.equal(buy.value, '$140,000 to go');
  assert.equal(drive.disabled, false); assert.equal(drive.value, 'Free · 2 min'); assert.equal(drive.primary, true, 'the test drive leads while the car is out of reach');
  drive.activate(); save.activate(); back.activate();
  assert.deepEqual(calls.slice(1), ['test:plane', 'save:plane', 'close']);
  fleet.testDrive('plane'); fleet.setGoal('plane');
  garage = build('plane');
  assert.equal(garage.offer.items[1].disabled, true, 'a second test drive costs money'); assert.equal(garage.offer.items[1].value, `$${testDrivePrice('plane').toLocaleString('en-US')} to go`);
  assert.equal(garage.offer.items[2].toggle, true); garage.offer.items[2].activate(); assert.equal(calls.at(-1), 'save:null');
  assert.equal(garage.cars.find(car => car.id === 'plane').goal, true);
  fleet.credit(carPrice('plane'));
  garage = build('plane');
  assert.equal(garage.offer.items[0].disabled, false); assert.equal(garage.offer.items[0].primary, true); assert.match(garage.offer.progress, /^Leaves/);
  fleet.buy('plane');
  assert.equal(build('plane').offer, null, 'a car owned has no offer');
  fleet.credit(carPrice('jetpack')); fleet.buy('jetpack');
  const jetpack = build(null).gear.find(item => item.id === 'jetpack');
  assert.equal(jetpack.value, 'Owned'); jetpack.activate(); assert.equal(calls.at(-1), 'jetpack', 'owned gear says how to use it');
  const poorer = new TaxiFleet(), offer = garageModel({ carId: 'taxi', paint: null, ownPaint, fleet: poorer, offer: 'jetpack' }, garageActions(calls)).offer;
  assert.equal(offer.items[1].label, 'Try it'); assert.match(offer.note, /on foot/);
  poorer.enterKonami(); assert.ok(garageModel({ carId: 'taxi', paint: null, ownPaint, fleet: poorer }, garageActions(calls)).paints.some(item => item.id === 'rainbow' && !item.disabled), 'the code adds the rainbow');
});

test('saving for a car: the one chosen, else the cheapest still out of reach, and none once the garage is full', () => {
  const fleet = new TaxiFleet();
  assert.equal(savingFor(fleet).id, 'hatchback'); assert.equal(savingFor(fleet).text, 'City Hatch in $2,000');
  fleet.credit(2100);
  assert.equal(savingFor(fleet).id, 'sedan', 'one it can buy already is not a goal');
  fleet.setGoal('helicopter');
  assert.equal(savingFor(fleet).id, 'helicopter'); assert.equal(savingFor(fleet).chosen, true); assert.ok(savingFor(fleet).fraction > 0);
  fleet.credit(2e6);
  for (const car of garageModel({ carId: 'taxi', paint: null, ownPaint: () => '', fleet }, garageActions([])).cars) fleet.buy(car.id);
  assert.equal(savingFor(fleet), null);
});

test('the garage holds the fleet too: the shift cab and liveries, and in a shift only the cabs, for the next one', () => {
  const calls = [], fleet = new TaxiFleet(), career = new TaxiCareer(), ownPaint = () => '#123456';
  const build = (shift, offer = null) => garageModel({ carId: 'hatchback', paint: null, ownPaint, fleet, career, shift, offer }, garageActions(calls));
  let garage = build(false);
  assert.equal(garage.cars.find(car => car.id === 'taxi').value, 'Shift cab', 'the shift\'s cab is marked among the cars');
  assert.ok(garage.liveries.some(livery => livery.disabled) && garage.liveries.some(livery => livery.current), 'liveries, locked by rank');
  garage = build(true);
  assert.deepEqual([...new Set(garage.cars.map(car => car.group))], ['Cabs']); assert.equal(garage.paints.length, 0); assert.equal(garage.gear.length, 0);
  assert.equal(garage.cars.find(car => car.current).id, 'taxi', 'the next shift\'s cab is the current one');
  garage.cars.find(car => car.id === 'taxi').activate(); assert.equal(calls.at(-1), 'cab:taxi', 'an owned cab is picked for the next shift, not driven');
  garage.cars.find(car => car.id === 'taxiGT').activate(); assert.equal(calls.at(-1), 'offer:taxiGT');
  const offer = build(true, 'taxiGT').offer;
  assert.equal(offer.items[1].disabled, true, 'no test drives mid-shift'); assert.match(offer.note, /next shift/);
  assert.equal(build(true, 'plane').offer, null, 'nothing but cabs on offer in a shift');
  const s = state({ chooser: 'garage' }), model = menuModel(s, menuControls(s, actions([])), { garage });
  assert.deepEqual([...new Set(model.items.map(item => item.group).filter(Boolean))], ['Cab livery', 'Cabs']); assert.match(model.subtitle, /next shift/);
  garage.liveries.find(livery => livery.id === 'cream').activate(); assert.equal(calls.at(-1), 'livery:cream');
  // (a stale row is checked again when chosen: TaxiFleet takes only what the rank unlocks)
  assert.equal(fleet.setLivery('cream', career), false); career.earnings = 2000; assert.equal(fleet.setLivery('cream', career), true);
  assert.equal(build(true).liveries.find(livery => livery.current).id, 'cream');
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
  const car = player(), location = locationHudModel({ ...car, heading: -Math.PI / 2 }, 'Harbor', 'Night');
  assert.deepEqual(location, { distance: '1.0', heading: 'W', place: 'Harbor', weather: 'Night', cash: '' });
  assert.equal(headsetHudModel(null, location).place, 'Harbor');
  const run = new TaxiRun(); run.start(car); run.cash = 600; run.timeLeft = .01; run.update(.02, car);
  const taxi = taxiResultModel(run, [{ name: 'Museum' }]);
  assert.equal(taxi.cash, '$600'); assert.match(taxi.best, /1 new place found/); assert.match(taxi.next, /New best license/);
  const demolition = new DemolitionRun(); demolition.start(); demolition.score = 1e6; demolition.timeLeft = .01; demolition.update(.02);
  const result = demolitionResultModel(demolition);
  assert.equal(result.cash, '$1,000,000'); assert.match(result.next, /New high score/);
});
