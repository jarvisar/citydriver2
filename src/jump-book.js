import { cityJumps } from './world/city-jumps.js';

// Jumps in free drive (see CarAir and city-jumps.js): what a landing is
// worth saying, how far each of the city's named jumps has been taken
// (stars, for this visit, as the places are), and the longest and highest
// jumps ever, which are saved.
const KEY = 'citydriver-jumps';
// A jump is worth a word from this far or this long in the air, or with a spin
const WORTH = { distance: 18, air: .8 };
// (and a big one from this long)
const BIG_AIR = 1.6;
const STAR = '★', NO_STAR = '☆';

export const starText = count => STAR.repeat(count) + NO_STAR.repeat(3 - count);

export class JumpBook {
  constructor(storage = null) {
    this.storage = storage; this.best = new Map();
    this.records = { longest: 0, air: 0, turns: 0, jumps: 0 };
    try {
      const saved = JSON.parse(storage?.getItem(KEY) ?? 'null');
      if (saved && typeof saved === 'object') for (const key of Object.keys(this.records)) if (Number.isFinite(saved[key]) && saved[key] >= 0) this.records[key] = saved[key];
    } catch { /* Optional storage. */ }
  }
  save() { try { this.storage?.setItem(KEY, JSON.stringify(this.records)); } catch { /* Optional storage. */ } }
  // The city's named jumps: loading ramps and the river jump (mounds have no names)
  get sites() { return cityJumps().sites.filter(site => site.stars); }
  stars(site, distance = this.best.get(site.id) ?? 0) { return site.stars.filter(d => distance >= d).length; }
  // How many of the city's named jumps have been landed
  get landed() { return this.sites.filter(site => this.best.has(site.id)).length; }
  // A landing: the word it is worth ({ text, amount, caption, gold }), or null
  land(event) {
    if (event.landing === 'splash') return null;
    const distance = Math.round(event.distance), spun = event.landing === 'spun', site = event.jump?.stars ? event.jump : null;
    const records = this.records, first = records.jumps === 0;
    records.jumps++;
    // (a spin out lands, but badly: no records from it)
    let record = '';
    if (!spun) {
      if (distance > records.longest) { if (!first && records.longest) record = 'Longest yet'; records.longest = distance; }
      if (event.air > records.air) { if (!first && records.air && !record) record = 'Most air yet'; records.air = +event.air.toFixed(2); }
      const turns = Math.abs(event.turns);
      if (turns > records.turns) { if (!first && !record) record = `${turns * 360} spin, a first`; records.turns = turns; }
    }
    this.save();
    const trick = event.turns ? `${Math.abs(event.turns) * 360}` : '';
    if (site && !spun) {
      const before = this.best.get(site.id), stars = this.stars(site, distance);
      if (before === undefined || distance > before) this.best.set(site.id, distance);
      const better = before !== undefined && distance > before, name = site.kind === 'river' && !stars ? 'River jump · short' : site.name;
      return { text: [name, `${distance} m`, starText(stars), trick, better ? 'Best here' : '', record].filter(Boolean).join(' · '), amount: `${distance} m`, caption: stars ? starText(stars) : 'SHORT', gold: stars > 0 };
    }
    if (!trick && distance < WORTH.distance && event.air < WORTH.air) return null;
    if (spun) return { text: trick ? `${trick} · spun out` : 'Spun out', amount: 'SPUN', caption: '', gold: false };
    const word = trick || (event.air >= BIG_AIR ? 'Big air' : 'Air');
    return { text: [word, `${distance} m`, event.air >= BIG_AIR && !trick ? `${event.air.toFixed(1)} s` : '', record].filter(Boolean).join(' · '), amount: `${distance} m`, caption: word.toUpperCase(), gold: Boolean(trick) };
  }
}
