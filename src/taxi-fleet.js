import { LIVERIES, liveryById } from './taxi-career.js';
import { CARS, GARAGE_IDS, STARTING_CAB, STARTING_CAR, carPrice, testDrivePrice } from './cars.js';
import { PAINT_PRICE, RAINBOW_PAINT, isPaint } from './car-paint.js';

export const FLEET_KEY = 'citydriver-taxi-fleet';
// The garage's own save (main.js): the car a player last picked. And the
// jetpack's once-only hint, told to anyone who has been on foot
const CAR_KEY = 'citydriver-car', JETPACK_HINT_KEY = 'citydriver-jetpack-hint';
export const TAXI_FLEET = [
  { id: 'taxi', title: 'The original', description: 'A dependable city cab. Plenty of pace to get your fleet started.' },
  { id: 'taxiGT', title: 'The fast lane', description: 'A sports coupe with quicker launches, sharper turns and stronger brakes.' },
  { id: 'taxiFormula', title: 'The ultimate fare', description: 'Open wheels and formula power, with the best grip in the fleet.' },
].map(cab => ({ ...cab, price: carPrice(cab.id) }));
const validMoney = value => Number.isSafeInteger(value) && value >= 0;
const isCab = id => typeof id === 'string' && Object.hasOwn(CARS, id) && Boolean(CARS[id].taxi);
// What each entry of the Konami code pays
export const KONAMI_PAY = 10000;

// Everything the player owns: the one balance that every mode pays into, the
// vehicles bought with it, the cab that works shifts and its livery. One save
// keeps a purchase together. Completed fares and shift goal bonuses bank
// immediately, including when a run is later abandoned.
//
// Version 1 saves held only cabs, from when the garage lent every other car
// out for free. A player who had picked a car there keeps it, and one who
// has been on foot keeps the jetpack, so nobody comes back to find what
// they used locked.
export class TaxiFleet {
  constructor(storage = null) {
    this.storage = storage; this.balance = 0; this.owned = new Set([STARTING_CAB, STARTING_CAR]); this.selected = STARTING_CAB; this.livery = LIVERIES[0].id; this.saved = Boolean(storage);
    // Test drives used (the first of each car is free) and the car being saved for
    this.tried = new Set(); this.goal = null;
    // The garage's paint (null: each car's own) and whether the Konami code has been entered
    this.paint = null; this.konami = false;
    // The save as this tab last read or wrote it (see sync)
    this.seen = null;
    let data = null;
    try { this.seen = storage?.getItem(FLEET_KEY) ?? null; data = JSON.parse(this.seen ?? 'null'); } catch { /* Corrupt or unavailable storage starts a usable local fleet. */ }
    const version = data?.version;
    if ((version === 1 || version === 2) && validMoney(data.balance)) this.load(data);
    if (version === 2) return;
    let legacy = null, walked = false;
    try { legacy = storage?.getItem(CAR_KEY); walked = storage?.getItem(JETPACK_HINT_KEY) === 'shown'; } catch { /* Optional storage. */ }
    if (walked) this.owned.add('jetpack');
    // (cabs were always bought, so a cab picked there was only a test drive)
    if (GARAGE_IDS.includes(legacy) && carPrice(legacy) !== null && !isCab(legacy)) this.owned.add(legacy);
    if (version === 1 || this.owned.size > 1) this.save();
  }
  // The colour the selected livery paints the cab, or null for factory yellow.
  get liveryColor() { return liveryById(this.livery).color; }
  // A save's contents, over the defaults. The sets are refilled in place.
  load(data) {
    const version = data.version, list = value => Array.isArray(value) ? value : [];
    this.balance = data.balance;
    this.owned.clear(); this.owned.add(STARTING_CAB).add(STARTING_CAR);
    for (const id of list(data.owned)) if (version === 2 ? carPrice(id) !== null : isCab(id)) this.owned.add(id);
    this.tried.clear(); this.goal = null; this.konami = false; this.paint = null;
    if (version === 2) {
      for (const id of list(data.tried)) if (carPrice(id) !== null) this.tried.add(id);
      if (carPrice(data.goal) !== null && !this.owned.has(data.goal)) this.goal = data.goal;
      this.konami = data.konami === true;
      if (isPaint(data.paint) || (data.paint === RAINBOW_PAINT && this.konami)) this.paint = data.paint;
    }
    this.selected = this.owned.has(data.selected) && isCab(data.selected) ? data.selected : STARTING_CAB;
    this.livery = LIVERIES.some(livery => livery.id === data.livery) ? data.livery : LIVERIES[0].id;
  }
  // Another tab may have saved since this one last did. Every change starts
  // from that save, or the two tabs would overwrite each other's money and
  // purchases. Not while saves are failing: this tab's progress is only in
  // memory then.
  sync() {
    if (!this.saved) return;
    let text;
    try { text = this.storage.getItem(FLEET_KEY); } catch { return; }
    if (text === this.seen) return;
    this.seen = text;
    let data = null;
    try { data = JSON.parse(text ?? 'null'); } catch { return; }
    if (data?.version === 2 && validMoney(data.balance)) this.load(data);
  }
  save() {
    try {
      if (!this.storage) throw new Error('Storage unavailable');
      const text = JSON.stringify({ version: 2, balance: this.balance, owned: [...this.owned], selected: this.selected,
        livery: this.livery, tried: [...this.tried], goal: this.goal, paint: this.paint, konami: this.konami });
      this.storage.setItem(FLEET_KEY, text);
      this.seen = text; this.saved = true;
    } catch { this.saved = false; }
  }
  // Liveries are earned by rank, not bought: the career says which are open.
  setLivery(id, career = null) {
    this.sync();
    if (!LIVERIES.some(livery => livery.id === id) || (career && !career.unlocked(id))) return false;
    this.livery = id; this.save(); return true;
  }
  credit(amount) {
    this.sync();
    if (!validMoney(amount) || !Number.isSafeInteger(this.balance + amount)) return false;
    this.balance += amount; this.save(); return true;
  }
  // The cab for shifts
  select(id) {
    this.sync();
    if (!this.owned.has(id) || !isCab(id)) return false;
    this.selected = id; this.save(); return true;
  }
  // A cab bought is the one the next shift uses
  buy(id) {
    this.sync();
    const price = carPrice(id);
    if (price === null || this.owned.has(id) || this.balance < price) return false;
    this.balance -= price; this.owned.add(id);
    if (isCab(id)) this.selected = id;
    if (this.goal === id) this.goal = null;
    this.save(); return true;
  }
  // What a test drive of `id` costs now: 0 for the first, null for one owned or not for sale
  testDriveCost(id) {
    if (carPrice(id) === null || this.owned.has(id)) return null;
    return this.tried.has(id) ? testDrivePrice(id) : 0;
  }
  // Pays for a test drive, if it can: true when it may go ahead
  testDrive(id) {
    this.sync();
    const cost = this.testDriveCost(id);
    if (cost === null || this.balance < cost) return false;
    this.balance -= cost; this.tried.add(id); this.save(); return true;
  }
  // What painting the garage `color` costs now: nothing for the colour it
  // already wears or each car's own, else PAINT_PRICE
  paintCost(color) { return color === this.paint || color === null ? 0 : PAINT_PRICE; }
  // Paints the garage, if it can: rainbow only once the code has unlocked it
  setPaint(color) {
    this.sync();
    if (color !== null && !isPaint(color) && !(color === RAINBOW_PAINT && this.konami)) return false;
    const cost = this.paintCost(color);
    if (this.balance < cost) return false;
    this.balance -= cost; this.paint = color; this.save(); return true;
  }
  // Each entry adds KONAMI_PAY and unlocks rainbow paint. Returns what it paid.
  enterKonami() {
    this.sync();
    this.konami = true;
    const paid = this.credit(KONAMI_PAY) ? KONAMI_PAY : 0;
    if (!paid) this.save();
    return paid;
  }
  // The car being saved for, shown on the results and in the garage (null to clear)
  setGoal(id) {
    this.sync();
    if (id !== null && (carPrice(id) === null || this.owned.has(id))) return false;
    this.goal = id; this.save(); return true;
  }
}
