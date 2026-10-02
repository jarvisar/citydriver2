import { CARS, GARAGE_IDS, GARAGE_GROUPS, carEntry, carMeters, garageGroup } from './cars.js';
import { PAINTS, DEFAULT_PAINT, DEFAULT_PAINT_NAME } from './car-paint.js';
import { TAXI_FLEET } from './taxi-fleet.js';
import { LIVERIES, DRIVER_RANKS, rankIndex, liveryById } from './taxi-career.js';

export const fleetMoney = amount => `$${amount.toLocaleString('en-US')}`;
const GROUP_NAMES = Object.fromEntries(GARAGE_GROUPS);

export function garageModel(carId, paint, ownPaint, { chooseCar, applyPaint }) {
  return {
    cars: GARAGE_IDS.map(id => ({ id, label: carEntry(id).name, plain: carEntry(id).plain, meters: carMeters(id),
      paint: paint ?? ownPaint(id), group: GROUP_NAMES[garageGroup(id)], current: id === carId, activate: () => chooseCar(id) })),
    paints: [{ name: DEFAULT_PAINT_NAME, color: DEFAULT_PAINT }, ...PAINTS].map(({ name, color }) => ({ id: color, label: name,
      swatch: color === DEFAULT_PAINT ? ownPaint(carId) : color, current: color === DEFAULT_PAINT ? !paint : color === paint,
      group: 'Paint', activate: () => applyPaint(color) })),
  };
}

export function fleetModel(fleet, career, running, { chooseCab, chooseLivery }) {
  const rank = career?.rank, next = career && LIVERIES.find(livery => !career.unlocked(livery.id));
  return { balance: fleetMoney(fleet.balance), saved: fleet.saved,
    note: running ? 'Cab changes apply to your next run.' : 'Fares and goal bonuses bank as you drive.',
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
