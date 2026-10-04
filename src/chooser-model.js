import { CARS, GARAGE_IDS, GARAGE_GROUPS, GEAR, SHOP_IDS, TEST_DRIVE_SECONDS, carEntry, carMeters, carPrice, garageGroup, shopName } from './cars.js';
import { PAINTS, DEFAULT_PAINT, DEFAULT_PAINT_NAME, PAINT_PRICE, RAINBOW_PAINT, RAINBOW_NAME, RAINBOW_SWATCH } from './car-paint.js';
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

// Shown with the balance while saves are failing
export const UNSAVED = 'Progress not saved';

// The garage, for the page and the headset alike. A car the fleet owns is
// picked at once, and any other opens its offer (`offer`, its id): buy it,
// test drive it for a couple of minutes, or save for it. Gear (the jetpack)
// is sold the same way, under the cars, and tried on foot. The cabs have the
// taxi's liveries over them (`career` unlocks them by rank), and one of them
// is the shift's cab. In a taxi shift (`shift`) it is only the cabs and liveries, and a cab
// picked or bought there drives the next shift: nothing is swapped mid-run.
export function garageModel({ carId, paint, ownPaint, fleet, offer = null, career = null, shift = false }, actions) {
  const { chooseCar, chooseCab, applyPaint, openOffer, useGear } = actions;
  const cars = GARAGE_IDS.filter(id => !shift || isCab(id)).map(id => {
    const owned = fleet.owned.has(id), price = carPrice(id), shiftCab = isCab(id) && fleet.selected === id;
    return { id, label: carEntry(id).name, plain: carEntry(id).plain, meters: carMeters(id),
      paint: paint && paint !== RAINBOW_PAINT ? paint : ownPaint(id), group: GROUP_NAMES[garageGroup(id)], current: shift ? shiftCab : id === carId, owned, price, shiftCab,
      affordable: !owned && fleet.balance >= price, goal: fleet.goal === id,
      value: owned ? shiftCab && !shift ? 'Shift cab' : '' : fleetMoney(price), activate: () => !owned ? openOffer(id) : shift ? chooseCab(id) : chooseCar(id) };
  });
  const gear = shift ? [] : Object.entries(GEAR).map(([id, { name, about }]) => {
    const owned = fleet.owned.has(id), price = carPrice(id);
    return { id, label: name, about, meters: [], group: 'Gear', gear: true, owned, price, affordable: !owned && fleet.balance >= price,
      goal: fleet.goal === id, value: owned ? 'Owned' : fleetMoney(price), activate: () => owned ? useGear(id) : openOffer(id) };
  });
  const shop = shift ? SHOP_IDS : [...cars, ...gear].map(item => item.id), owned = shop.filter(id => fleet.owned.has(id)).length;
  const items = [...cars, ...gear];
  // (storage refused the last save: what was earned or bought lasts only for this visit)
  const unsaved = !fleet.saved || career?.saved === false;
  return { balance: fleetMoney(fleet.balance), owned, total: shop.length, saving: savingFor(fleet), shift, unsaved,
    summary: `${fleetMoney(fleet.balance)} · ${owned} of ${shop.length} owned${unsaved ? ` · ${UNSAVED}` : ''}`, paintPrice: fleetMoney(PAINT_PRICE),
    cars, gear, ...liveryModel(fleet, career, actions),
    // (each car's own color is free, the rest cost PAINT_PRICE, and the rainbow is the Konami code's)
    paints: shift ? [] : [{ name: DEFAULT_PAINT_NAME, color: DEFAULT_PAINT }, ...PAINTS, ...fleet.konami ? [{ name: RAINBOW_NAME, color: RAINBOW_PAINT }] : []].map(({ name, color }) => {
      const current = color === DEFAULT_PAINT ? !paint : color === paint;
      return { id: color, label: name, swatch: color === DEFAULT_PAINT ? ownPaint(carId) : color === RAINBOW_PAINT ? RAINBOW_SWATCH : color, current,
        disabled: !current && color !== DEFAULT_PAINT && fleet.balance < PAINT_PRICE, group: 'Paint', activate: () => applyPaint(color) };
    }),
    offer: offer && !fleet.owned.has(offer) && carPrice(offer) !== null && items.some(item => item.id === offer)
      ? offerModel(offer, fleet, actions, items.find(item => item.id === offer), shift) : null,
  };
}
const isCab = id => Boolean(carEntry(id).taxi);

// The cabs' liveries, earned by rank rather than bought. Each paints every cab
// at once, mid-shift too.
function liveryModel(fleet, career, { chooseLivery }) {
  if (!career) return { liveries: [], liveryName: '', career: '' };
  const rank = career.rank, next = LIVERIES.find(livery => !career.unlocked(livery.id));
  return {
    liveries: LIVERIES.map(livery => {
      const unlocked = career.unlocked(livery.id), required = DRIVER_RANKS[rankIndex(livery.rank)].name;
      return { id: livery.id, label: livery.name, accessibilityLabel: unlocked ? `${livery.name} livery` : `${livery.name} livery: unlocks at ${required} rank`,
        current: fleet.livery === livery.id, disabled: !unlocked, swatch: livery.color ?? CARS.taxi.paint,
        value: unlocked ? '' : required, group: 'Cab livery', activate: () => chooseLivery(livery.id) };
    }),
    liveryName: [`${liveryById(fleet.livery).name} livery`, next ? `${next.name} at ${DRIVER_RANKS[rankIndex(next.rank)].name}` : 'Every livery unlocked'].join(' · '),
    career: [rank.name, `${fleetMoney(career.earnings)} career`, `${career.fares} fare${career.fares === 1 ? '' : 's'}`,
      rank.next ? `${fleetMoney(rank.next.earnings - career.earnings)} to ${rank.next.name}` : 'Top rank'].join(' · '),
  };
}

// One car's offer, or gear's. `items` are its controls, in the order the headset lists them.
// (in a shift, a cab bought drives the next one, and test drives wait for free drive)
function offerModel(id, fleet, { buyCar, testDrive, saveFor, closeOffer }, car, shift = false) {
  const price = carPrice(id), short = Math.max(0, price - fleet.balance), cost = fleet.testDriveCost(id), goal = fleet.goal === id;
  const minutes = TEST_DRIVE_SECONDS / 60, testShort = shift ? 0 : Math.max(0, cost - fleet.balance);
  const test = shift ? 'Free drive only' : cost === 0 ? 'Free' : fleetMoney(cost), trying = car.gear ? 'Try it' : 'Test drive';
  return { ...car, price: fleetMoney(price), short, fraction: Math.min(1, fleet.balance / price),
    progress: short ? `${fleetMoney(fleet.balance)} of ${fleetMoney(price)} · ${fleetMoney(short)} to go` : `Leaves ${fleetMoney(fleet.balance - price)} in your balance`,
    // (the headset's line under the name: the rows say what is still to go)
    summary: `${fleetMoney(price)} · ${short ? `you have ${fleetMoney(fleet.balance)}` : `leaves ${fleetMoney(fleet.balance - price)}`}`,
    canBuy: !short, buy: `Buy · ${fleetMoney(price)}`, test, trying, canTest: !shift && !testShort, goal, canSave: Boolean(short || goal),
    note: shift ? 'Bought now, it drives your next shift. Test drives are in free drive.' : car.gear ? cost === 0 ? `Your first try is free: ${minutes} minutes of it, counted only while you're on foot.`
      : `You've had your free try. Another is ${fleetMoney(cost)} for ${minutes} minutes on foot.`
      : cost === 0 ? `Your first test drive of each car is free. It lasts ${minutes} minutes, and stunts pay as usual.`
        : `You've had your free test drive. Another is ${fleetMoney(cost)} for ${minutes} minutes.`,
    earn: short ? EARN_TEXT : '',
    items: [
      { id: 'offer-buy', label: 'Buy', value: short ? `${fleetMoney(short)} to go` : fleetMoney(price), disabled: Boolean(short), primary: !short, activate: () => buyCar(id) },
      { id: 'offer-test', label: trying, value: shift ? test : testShort ? `${fleetMoney(testShort)} to go` : `${test} · ${minutes} min`, disabled: shift || Boolean(testShort), primary: !shift && Boolean(short), activate: () => testDrive(id) },
      // (nothing to save for once it can be bought)
      ...short || goal ? [{ id: 'offer-goal', label: 'Save for this', toggle: goal, activate: () => saveFor(goal ? null : id) }] : [],
      { id: 'offer-back', label: 'Back', footer: true, activate: closeOffer },
    ] };
}

