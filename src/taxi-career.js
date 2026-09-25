// A driver's career outlives any one shift. It keeps lifetime totals, the
// records a shift can beat, and a rank that grows with career earnings. Each
// rank unlocks a livery for the cab, so a long-serving driver's taxi looks
// the part, and the results screen always has a next milestone to name.
export const CAREER_KEY = 'citydriver-taxi-career';
export const DRIVER_RANKS = [
  { id: 'rookie', name: 'Rookie', earnings: 0 },
  { id: 'cabbie', name: 'Cabbie', earnings: 2000 },
  { id: 'regular', name: 'Regular', earnings: 6000 },
  { id: 'pro', name: 'Pro', earnings: 15000 },
  { id: 'veteran', name: 'Veteran', earnings: 35000 },
  { id: 'ace', name: 'Ace', earnings: 75000 },
  { id: 'legend', name: 'City Legend', earnings: 150000 },
];
export function driverRank(earnings = 0) {
  const index = DRIVER_RANKS.findLastIndex(rank => earnings >= rank.earnings);
  return { ...DRIVER_RANKS[index], index, next: DRIVER_RANKS[index + 1] ?? null };
}
export const rankIndex = id => DRIVER_RANKS.findIndex(rank => rank.id === id);

// Cab colours, one per rank. A null colour is the cab's own factory yellow.
export const LIVERIES = [
  { id: 'yellow', name: 'Classic Yellow', color: null, rank: 'rookie' },
  { id: 'cream', name: 'Checker Cream', color: '#e7e3d5', rank: 'cabbie' },
  { id: 'signal', name: 'Signal Red', color: '#b8232f', rank: 'regular' },
  { id: 'seaglass', name: 'Sea Glass', color: '#6fa9c2', rank: 'pro' },
  { id: 'forest', name: 'Forest Green', color: '#3f6b4a', rank: 'veteran' },
  { id: 'midnight', name: 'Midnight Blue', color: '#2f4a6d', rank: 'ace' },
  { id: 'graphite', name: 'Graphite', color: '#4a5257', rank: 'legend' },
];
export const liveryById = id => LIVERIES.find(livery => livery.id === id) ?? LIVERIES[0];

// What a shift can set a personal best in. Best cash is the licence's job.
export const RECORDS = [
  { id: 'fares', value: run => run.delivered },
  { id: 'combo', value: run => run.bestCombo },
  { id: 'streak', value: run => run.bestStreak },
  { id: 'tips', value: run => run.tipsBanked },
  { id: 'shift', value: run => Math.round(run.elapsed) },
];
const validCount = value => Number.isSafeInteger(value) && value >= 0;

export class TaxiCareer {
  constructor(storage = null) {
    this.storage = storage; this.saved = Boolean(storage);
    this.shifts = 0; this.fares = 0; this.riders = 0; this.groups = 0; this.earnings = 0; this.tips = 0; this.goals = 0; this.goalCash = 0;
    this.records = Object.fromEntries(RECORDS.map(record => [record.id, 0]));
    try {
      const data = JSON.parse(storage?.getItem(CAREER_KEY) ?? 'null');
      if (data?.version === 1) {
        for (const key of ['shifts', 'fares', 'riders', 'groups', 'earnings', 'tips', 'goals', 'goalCash']) if (validCount(data[key])) this[key] = data[key];
        for (const record of RECORDS) if (validCount(data.records?.[record.id])) this.records[record.id] = data.records[record.id];
      }
    } catch { /* Corrupt or unavailable storage starts a fresh career. */ }
  }
  get rank() { return driverRank(this.earnings); }
  unlocked(liveryId) { return rankIndex(liveryById(liveryId).rank) <= this.rank.index; }
  get liveries() { return LIVERIES.filter(livery => this.unlocked(livery.id)); }
  save() {
    try {
      if (!this.storage) throw new Error('Storage unavailable');
      this.storage.setItem(CAREER_KEY, JSON.stringify({ version: 1, shifts: this.shifts, fares: this.fares, riders: this.riders, groups: this.groups,
        earnings: this.earnings, tips: this.tips, goals: this.goals, goalCash: this.goalCash, records: this.records }));
      this.saved = true;
    } catch { this.saved = false; }
  }
  // Closes a shift: totals grow, records fall, and a rank may be earned. The
  // summary drives the results screen, so it names every record beaten and
  // every livery the new rank unlocked.
  record(run) {
    const before = this.rank;
    this.shifts++; this.fares += run.delivered; this.riders += run.deliveredPassengers; this.groups += run.groups;
    this.earnings += run.cash; this.tips += run.tipsBanked;
    const done = (run.goals ?? []).filter(goal => goal.done);
    this.goals += done.length; this.goalCash += run.goalCash ?? 0;
    const beaten = [];
    for (const record of RECORDS) {
      const value = record.value(run);
      if (!validCount(value) || value <= this.records[record.id]) continue;
      // The first shift sets every record; only later shifts beat one.
      if (this.shifts > 1 && value > 0) beaten.push(record.id);
      this.records[record.id] = value;
    }
    const after = this.rank;
    const liveries = LIVERIES.filter(livery => rankIndex(livery.rank) > before.index && rankIndex(livery.rank) <= after.index);
    this.save();
    return { before, after, promoted: after.index > before.index, beaten, liveries };
  }
}
