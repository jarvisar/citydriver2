import { AMBIENCE } from './profiles.js';

const note = midi => 440 * 2 ** ((midi - 69) / 12);
// Original, sparse suspended chords. The route changes the key; cruising adds
// occasional upper notes. No network, recordings or repeating music file.
const CHORDS = [[0, 7, 14], [-3, 4, 12], [-5, 2, 9], [-7, 0, 7]];
export class SoundDirector {
  constructor() { this.seed = 0x51ca9; this.reset(); }
  random() {
    this.seed ^= this.seed << 13; this.seed ^= this.seed >>> 17; this.seed ^= this.seed << 5;
    return (this.seed >>> 0) / 4294967296;
  }
  reset(now = 0) { this.nextWildlife = now + 2.5; this.nextWeather = now + 12; this.nextThunder = Infinity; this.lastLightning = -Infinity; this.nextBeat = now; this.beat = 0; this.chord = 0; this.musicActive = false; }
  update(audio, state, now, scene = null) {
    const { graph: g, journey, mix } = audio, profile = AMBIENCE[journey];
    if (now >= this.nextWildlife) {
      this.nextWildlife = now + profile.interval[0] + this.random() * (profile.interval[1] - profile.interval[0]);
      if (mix.ambience > 0 && (journey !== 'city' || (scene?.rain ?? 0) > .05)) this.wildlife(g, profile.wildlife, now, 1 - state.motion * .45);
    }
    if (scene?.lightning > .05 && now - this.lastLightning > 6) {
      this.lastLightning = now; this.nextThunder = now + 1.4 + this.random() * 1.6;
    }
    if (now >= this.nextThunder) {
      this.nextThunder = Infinity;
      this.nextWeather = now + 24 + this.random() * 25;
      if (journey === 'city' && mix.ambience > 0) g.event('weather', { time: now, duration: 4.5, frequency: 140, endFrequency: 65, level: .12, pan: this.random() - .5, attack: .7 });
    }
    if (mix.music <= 0) {
      for (const pad of g.pads) audio.target(pad.level, 0, .4);
      this.musicActive = false;
      return;
    }
    if (!this.musicActive) { this.musicActive = true; this.nextBeat = now; this.beat = 0; }
    // Only a short lookahead; never catch up a backlog after a suspended tab.
    if (this.nextBeat < now - .15) this.nextBeat = now;
    if (this.nextBeat <= now + .1) {
      if (this.beat % 8 === 0) this.chord = Math.floor(this.beat / 8) % CHORDS.length;
      const chord = CHORDS[this.chord];
      if (this.beat % 2 === 0 && (this.beat % 4 === 0 || state.motion > .25)) {
        const pitch = chord[Math.floor(this.random() * chord.length)] + (this.beat % 4 === 0 ? 12 : 24);
        g.event('music', { time: Math.max(now, this.nextBeat), duration: 2.5, frequency: note(profile.root + pitch), level: .035 + state.motion * .012, attack: .025, pan: this.random() * 1.1 - .55 });
      }
      this.beat++; this.nextBeat += 60 / 76;
    }
    const chord = CHORDS[this.chord];
    for (let i = 0; i < g.pads.length; i++) {
      audio.target(g.pads[i].frequency, note(profile.root - 12 + chord[i]), 1.2);
      audio.target(g.pads[i].level, .026 + .005 * Math.sin(now * .21 + i * 2), 1);
    }
  }
  wildlife(g, kind, now, distance) {
    const pan = (this.random() * 1.6 - .8), variation = .88 + this.random() * .24;
    const sing = (offset, frequency, endFrequency, duration, level) => g.event('ambience', {
      time: now + offset, frequency: frequency * variation, endFrequency: endFrequency * variation,
      duration, level: level * distance, pan, attack: .04,
    });
    if (kind === 'gull') {
      sing(0, 1050, 1550, .24, .015); sing(.28, 1500, 740, .65, .02); sing(1, 1100, 800, .45, .012);
    } else if (kind === 'bird' || kind === 'lark') {
      const base = kind === 'bird' ? 1800 : 2400;
      for (let i = 0; i < 4; i++) sing(i * .19, base + i % 2 * 650, base + (i % 2 ? -200 : 800), .14 + this.random() * .09, .012);
    } else if (kind === 'owl') {
      sing(0, 390, 330, .48, .028); sing(.7, 360, 310, .75, .024);
    } else if (kind === 'wind') {
      g.event('weather', { time: now, duration: 3.5, frequency: 640, endFrequency: 350, level: .05, pan, attack: .9 });
    } else if (kind === 'drip') {
      sing(0, 1700, 700, .11, .012); sing(.32, 2200, 900, .09, .008);
    }
  }
}
