import { CARS, GARAGE_IDS, GARAGE_GROUPS, GEAR, SHOP_IDS, TEST_DRIVE_SECONDS, carEntry, carMeters, carPrice, garageGroup, shopName } from './cars.js';
import { PAINTS, DEFAULT_PAINT, DEFAULT_PAINT_NAME, PAINT_PRICE, RAINBOW_PAINT, RAINBOW_NAME, RAINBOW_SWATCH } from './car-paint.js';
import { TAXI_FLEET } from './taxi-fleet.js';
import { LIVERIES, DRIVER_RANKS, rankIndex, liveryById } from './taxi-career.js';

export const fleetMoney = amount => `$${amount.toLocaleString('en-US')}`;
const GROUP_NAMES = Object.fromEntries(GARAGE_GROUPS);
// Said wherever the player is short of money, so every mode reads as a way to the next car
export const EARN_TEXT = 'Taxi shifts, demolition runs, stunt chains and new places all pay into your balance.';

// What the player is saving for: the car (or gear) they chose to save for,
// else the cheapest one they can't buy yet. Null once the garage is full.
export function savingFor(fleet) {
  const unowned = SHOP_IDS.filter(id => !fleet.owned.has(id) && carPrice(id) !== null);
  const id = fleet.goal && unowned.includes(fleet.goal) ? fleet.goal
    : unowned.filter(id => carPrice(id) > fleet.balance).sort((a, b) => carPrice(a) - carPrice(b))[0];
  if (!id) return null;
  const price = carPrice(id), short = Math.max(0, price - fleet.balance), label = shopName(id);
  return { id, label, price, short, chosen: id === fleet.goal, fraction: Math.min(1, fleet.balance / price),
    text: short ? `${label} in ${fleetMoney(short)}` : `${label} · ready to buy` };
}

// The garage, for the page and the headset alike. A car the fleet owns is
// picked at once, and any other opens its offer (`offer`, its id): buy it,
// test drive it for a couple of minutes, or save for it. Gear (the jetpack)
// is sold the same way, under the cars, and tried on foot.
export function garageModel({ carId, paint, ownPaint, fleet, offer = null }, actions) {
  const { chooseCar, applyPaint, openOffer, useGear } = actions;
  const cars = GARAGE_IDS.map(id => {
    const owned = fleet.owned.has(id), price = carPrice(id);
    return { id, label: carEntry(id).name, plain: carEntry(id).plain, meters: carMeters(id),
      paint: paint && paint !== RAINBOW_PAINT ? paint : ownPaint(id), group: GROUP_NAMES[garageGroup(id)], current: id === carId, owned, price,
      affordable: !owned && fleet.balance >= price, goal: fleet.goal === id,
      value: owned ? '' : fleetMoney(price), activate: () => owned ? chooseCar(id) : openOffer(id) };
  });
  const gear = Object.entries(GEAR).map(([id, { name, about }]) => {
    const owned = fleet.owned.has(id), price = carPrice(id);
    return { id, label: name, about, meters: [], group: 'Gear', gear: true, owned, price, affordable: !owned && fleet.balance >= price,
      goal: fleet.goal === id, value: owned ? 'Owned' : fleetMoney(price), activate: () => owned ? useGear(id) : openOffer(id) };
  });
  const all = [...cars, ...gear], owned = all.filter(item => item.owned).length;
  return { balance: fleetMoney(fleet.balance), owned, total: all.length, saving: savingFor(fleet),
    summary: `${fleetMoney(fleet.balance)} · ${owned} of ${all.length} owned`, paintPrice: fleetMoney(PAINT_PRICE),
    cars, gear,
    // (each car's own colour is free, the rest cost PAINT_PRICE, and the rainbow is the Konami code's)
    paints: [{ name: DEFAULT_PAINT_NAME, color: DEFAULT_PAINT }, ...PAINTS, ...fleet.konami ? [{ name: RAINBOW_NAME, color: RAINBOW_PAINT }] : []].map(({ name, color }) => {
      const current = color === DEFAULT_PAINT ? !paint : color === paint;
      return { id: color, label: name, swatch: color === DEFAULT_PAINT ? ownPaint(carId) : color === RAINBOW_PAINT ? RAINBOW_SWATCH : color, current,
        disabled: !current && color !== DEFAULT_PAINT && fleet.balance < PAINT_PRICE, group: 'Paint', activate: () => applyPaint(color) };
    }),
    offer: offer && !fleet.owned.has(offer) && carPrice(offer) !== null ? offerModel(offer, fleet, actions, all.find(item => item.id === offer)) : null,
  };
}

// One car's offer, or gear's. `items` are its controls, in the order the headset lists them.
function offerModel(id, fleet, { buyCar, testDrive, saveFor, closeOffer }, car) {
  const price = carPrice(id), short = Math.max(0, price - fleet.balance), cost = fleet.testDriveCost(id), goal = fleet.goal === id;
  const minutes = TEST_DRIVE_SECONDS / 60, testShort = Math.max(0, cost - fleet.balance);
  const test = cost === 0 ? 'Free' : fleetMoney(cost), trying = car.gear ? 'Try it' : 'Test drive';
  return { ...car, price: fleetMoney(price), short, fraction: Math.min(1, fleet.balance / price),
    progress: short ? `${fleetMoney(fleet.balance)} of ${fleetMoney(price)} · ${fleetMoney(short)} to go` : `Leaves ${fleetMoney(fleet.balance - price)} in your balance`,
    // (the headset's line under the name: the rows say what is still to go)
    summary: `${fleetMoney(price)} · ${short ? `you have ${fleetMoney(fleet.balance)}` : `leaves ${fleetMoney(fleet.balance - price)}`}`,
    canBuy: !short, buy: `Buy · ${fleetMoney(price)}`, test, trying, canTest: !testShort, goal, canSave: Boolean(short || goal),
    note: car.gear ? cost === 0 ? `Your first try is free: ${minutes} minutes of it, counted only while you're on foot.`
      : `You've had your free try. Another is ${fleetMoney(cost)} for ${minutes} minutes on foot.`
      : cost === 0 ? `Your first test drive of each car is free. It lasts ${minutes} minutes, and stunts pay as usual.`
        : `You've had your free test drive. Another is ${fleetMoney(cost)} for ${minutes} minutes.`,
    earn: short ? EARN_TEXT : '',
    items: [
      { id: 'offer-buy', label: 'Buy', value: short ? `${fleetMoney(short)} to go` : fleetMoney(price), disabled: Boolean(short), primary: !short, activate: () => buyCar(id) },
      { id: 'offer-test', label: trying, value: testShort ? `${fleetMoney(testShort)} to go` : `${test} · ${minutes} min`, disabled: Boolean(testShort), primary: Boolean(short), activate: () => testDrive(id) },
      // (nothing to save for once it can be bought)
      ...short || goal ? [{ id: 'offer-goal', label: 'Save for this', toggle: goal, activate: () => saveFor(goal ? null : id) }] : [],
      { id: 'offer-back', label: 'Back', footer: true, activate: closeOffer },
    ] };
}

export function fleetModel(fleet, career, running, { chooseCab, chooseLivery }) {
  const rank = career?.rank, next = career && LIVERIES.find(livery => !career.unlocked(livery.id));
  return { balance: fleetMoney(fleet.balance), saved: fleet.saved, saving: savingFor(fleet),
    note: running ? 'Cab changes apply to your next run.' : 'Every mode pays into the one balance. Cabs bought here are in the garage too.',
    cabs: TAXI_FLEET.map(({ id, price, title, description }, index) => {
      const entry = CARS[id], owned = fleet.owned.has(id), current = fleet.selected === id, short = Math.max(0, price - fleet.balance);
      const action = current ? 'Selected for next run' : owned ? 'Select cab' : `Buy & select · ${fleetMoney(price)}`;
      return { id, price, title, description, index, label: entry.name, owned, current, short, action,
        accessibilityLabel: `${entry.name}: ${action}`, paint: fleet.liveryColor ?? entry.paint,
        value: current ? '' : owned ? 'Owned' : fleetMoney(price), group: 'Cabs', disabled: !owned && short > 0,
        savings: Math.min(price, fleet.balance), progress: owned ? index === 0 ? 'Included with your fleet' : 'Yours for every taxi run' : short ? `${fleetMoney(short)} to go` : 'Ready for an upgrade',
        stats: [['Top speed', `${Math.round(entry.stats.topSpeed * 2.23694)} mph`, entry.stats.topSpeed / 55],
          ['Acceleration', `${entry.stats.acceleration} m/s²`, entry.stats.acceleration / 42],
          ['Handling', `${entry.stats.grip.toFixed(2)}×`, entry.stats.grip / 1.8], ['Braking', `${entry.stats.braking} m/s²`, entry.stats.braking / 38]],
        activate: () => chooseCab(id) };
    }),
    liveries: !career ? [] : LIVERIES.map(livery => {
      const unlocked = career.unlocked(livery.id), required = DRIVER_RANKS[rankIndex(livery.rank)].name;
      return { id: livery.id, label: livery.name, accessibilityLabel: unlocked ? livery.name : `${livery.name}: unlocks at ${required} rank`,
        current: fleet.livery === livery.id, disabled: !unlocked, swatch: livery.color ?? CARS.taxi.paint,
        value: unlocked ? '' : required, group: 'Livery', activate: () => chooseLivery(livery.id) };
    }),
    liveryName: career ? [`${liveryById(fleet.livery).name} livery`, next ? `${next.name} at ${DRIVER_RANKS[rankIndex(next.rank)].name}` : 'Every livery unlocked'].join(' · ') : '',
    career: rank ? [rank.name, `${fleetMoney(career.earnings)} career`, `${career.fares} fare${career.fares === 1 ? '' : 's'}`,
      rank.next ? `${fleetMoney(rank.next.earnings - career.earnings)} to ${rank.next.name}` : 'Top rank'].join(' · ') : '' };
}

// Commands validate current ownership and rank, including when an older menu
// snapshot is still on screen. Neither input path needs a button to buy a cab.
export function createFleetMenu(fleet, { running, career = null, onChange = () => {}, onLivery = null }) {
  const listeners = new Set();
  const changed = feedback => { for (const listener of listeners) listener(feedback); onChange(); };
  const actions = {
    chooseCab(id) {
      const owned = fleet.owned.has(id);
      if (!(owned ? fleet.select(id) : fleet.buy(id))) return false;
      changed(`${CARS[id].name} ${owned ? 'selected' : 'purchased'} for your next run.`); return true;
    },
    chooseLivery(id) {
      if (!fleet.setLivery(id, career)) return false;
      onLivery?.(fleet.liveryColor);
      changed(`${liveryById(fleet.livery).name} livery selected.`); return true;
    },
  };
  return { ...actions, model: () => fleetModel(fleet, career, running(), actions), subscribe: listener => listeners.add(listener) };
}
