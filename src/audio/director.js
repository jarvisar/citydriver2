const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
// Two crickets, each with its own pace, pitch and side
const CRICKETS = [{ period: .42, rate: 1, pan: -.55 }, { period: .57, rate: .94, pan: .6 }];

// The life of the city round the car, placed by where it is (see
// citySoundscape) and the weather: songbirds in the parks and gardens by
// day, gulls and lapping water by the harbor, crickets and an owl on a dry
// night, horns somewhere off in the busy streets, gusts and thunder in a
// storm, drips in the rain. Each is an occasional event, never a loop.
export class SoundDirector {
  constructor() { this.seed = 0x51ca9; this.reset(); }
  random() {
    this.seed ^= this.seed << 13; this.seed ^= this.seed >>> 17; this.seed ^= this.seed << 5;
    return (this.seed >>> 0) / 4294967296;
  }
  between(low, high) { return low + this.random() * (high - low); }
  reset(now = 0) {
    this.next = { bird: now + 1.5, gull: now + 3, water: now + 1, owl: now + 10, honk: now + 6, gust: now + 3, drip: now + 2 };
    this.crickets = CRICKETS.map((_, i) => now + .3 + i * .2);
    this.nextThunder = Infinity; this.lastLightning = -Infinity;
  }
  // Whether an occasional sound is due: `chance` (0 to 1) shortens the wait;
  // under `least` it is not heard here and the director looks again shortly.
  due(key, now, chance, [low, high], least = .1) {
    if (now < this.next[key]) return false;
    if (!(chance > least)) { this.next[key] = now + this.between(1, 2); return false; }
    this.next[key] = now + this.between(low, high) / Math.min(1, chance * 1.4);
    return true;
  }
  update(audio, state, now, scene = null) {
    const { graph: g, mix } = audio, place = audio.place ?? {};
    const rain = clamp01(scene?.rain), snow = clamp01(scene?.snow), night = clamp01(scene?.night), day = 1 - night;
    const urban = clamp01(place.urban ?? .6), green = clamp01(place.green), water = clamp01(place.water), sea = clamp01(place.sea);
    // The car's own noise covers the distant things
    const hush = 1 - state.motion * .45, fair = rain < .3 && snow < .5;
    if (mix.ambience > 0) {
      if (this.due('bird', now, green * day * (fair ? 1 : .15), [3, 9], .12)) this.bird(g, now, hush);
      if (this.due('gull', now, sea * day * (rain < .6 ? 1 : .3), [7, 18], .2)) this.gull(g, now, hush);
      if (this.due('water', now, water, [.5, 1.5], .12)) this.lap(g, now, water * (1 - state.motion * .7));
      if (this.due('owl', now, green * night * (fair ? 1 : 0), [18, 40], .25)) this.owl(g, now, hush);
      if (this.due('honk', now, (urban - .35) * (1 - night * .7) * (snow < .5 ? 1 : .4), [9, 26])) this.distantHorn(g, now, hush);
      if (this.due('gust', now, (rain - .75) * 4, [5, 12], .2)) {
        g.event('weather', { time: now, duration: this.between(3, 5), contour: [[0, 320], [.45, this.between(650, 900)], [1, 350]], level: .03, attack: 1.2, q: .9, pan: this.between(-.6, .6) });
      }
      if (this.due('drip', now, rain * 4, [2, 5], .2)) {
        const pan = this.between(-.8, .8), v = this.between(.88, 1.12);
        g.event('ambience', { time: now, duration: .11, frequency: 1700 * v, endFrequency: 700 * v, level: .012 * hush, attack: .004, pan });
        g.event('ambience', { time: now + .32, duration: .09, frequency: 2200 * v, endFrequency: 900 * v, level: .008 * hush, attack: .004, pan });
      }
      // Crickets keep time, a little unevenly, only on a dry night among green
      const chirping = night > .6 && green > .12 && rain < .15 && snow < .1;
      for (const [i, cricket] of CRICKETS.entries()) {
        if (this.crickets[i] < now - .2) this.crickets[i] = now;
        if (this.crickets[i] > now + .1) continue;
        if (chirping) g.event('ambience', { time: this.crickets[i], buffer: 'cricket', duration: .16, rate: cricket.rate, level: .007 * Math.min(1, green * 1.5) * hush, attack: .002, pan: cricket.pan });
        this.crickets[i] += cricket.period * this.between(.9, 1.1);
      }
    }
    if (scene?.lightning > .05 && now - this.lastLightning > 6) {
      this.lastLightning = now; this.nextThunder = now + 1.4 + this.random() * 1.6;
    }
    if (now >= this.nextThunder) {
      this.nextThunder = Infinity;
      // A near strike cracks before it rolls; a far one only rumbles
      if (mix.ambience > 0) {
        const near = this.random(), pan = this.random() - .5;
        g.event('weather', { time: now, duration: 3.5 + near * 1.5, contour: [[0, 220 + near * 200], [.2, 120], [1, 55]], level: .07 + near * .05, attack: .08 + (1 - near) * .5, q: .7, pan });
        g.event('weather', { time: now + .7 + this.random() * .8, duration: 4, contour: [[0, 110], [1, 48]], level: .05, attack: .4, q: .7, pan: -pan });
      }
    }
  }
  // Songbirds: quick falling "tsip"s, a warbled phrase, or a two-note call
  bird(g, now, hush) {
    const pan = this.between(-.85, .85), pitch = this.between(.9, 1.1), kind = Math.floor(this.random() * 3);
    const sing = (at, duration, contour, level = 1) => g.event('ambience', { time: now + at, duration, contour: contour.map(([t, f]) => [t, f * pitch]), level: .01 * level * hush, attack: .008, pan });
    if (kind === 0) {
      const gap = this.between(.09, .14);
      for (let i = 0, n = 3 + Math.floor(this.random() * 4); i < n; i++) sing(i * gap, .05, [[0, 5000], [1, 3600]], .8);
    } else if (kind === 1) {
      let at = 0;
      for (let i = 0, n = 5 + Math.floor(this.random() * 4); i < n; i++) {
        const f = this.between(2400, 4200), length = this.between(.06, .15);
        sing(at, length, [[0, f], [.5, f * this.between(.85, 1.2)], [1, f * this.between(.8, 1.1)]]);
        at += length + this.between(.02, .06);
      }
    } else {
      for (let i = 0, n = 2 + Math.floor(this.random() * 2); i < n; i++) { sing(i * .34, .09, [[0, 4300], [1, 4100]]); sing(i * .34 + .12, .12, [[0, 3200], [1, 3000]]); }
    }
  }
  // A gull's long call (a rising "kee" falling to "ow"), or its laugh
  gull(g, now, hush) {
    const pan = this.between(-.8, .8), pitch = this.between(.9, 1.12), level = .016 * hush;
    if (this.random() < .5) {
      for (let i = 0, n = 1 + Math.floor(this.random() * 2); i < n; i++) g.event('ambience', { time: now + i * .62, wave: 'gull', duration: .5, contour: [[0, 1050 * pitch], [.25, 1420 * pitch], [1, 760 * pitch]], level, attack: .03, pan });
    } else {
      for (let i = 0; i < 5; i++) g.event('ambience', { time: now + i * .17, wave: 'gull', duration: .13, contour: [[0, 1250 * pitch * (1 - i * .03)], [1, 980 * pitch * (1 - i * .04)]], level: level * (1 - i * .1), attack: .015, pan });
    }
  }
  // Water lapping at the quay wall, now and then slapping against it
  lap(g, now, level) {
    const f = this.between(550, 950);
    g.event('water', { time: now, duration: this.between(.35, .8), contour: [[0, f], [1, f * this.between(.35, .5)]], level: .035 * level, attack: this.between(.04, .1), q: 1.4, pan: this.between(-.7, .7) });
    if (this.random() < .3) g.event('water', { time: now + this.between(.1, .25), duration: .14, contour: [[0, 1500], [1, 700]], level: .02 * level, attack: .008, q: 2, pan: this.between(-.7, .7) });
  }
  owl(g, now, hush) {
    const pan = this.between(-.8, .8), v = this.between(.92, 1.08);
    g.event('ambience', { time: now, duration: .48, contour: [[0, 390 * v], [1, 330 * v]], level: .026 * hush, attack: .04, pan });
    g.event('ambience', { time: now + .7, duration: .75, contour: [[0, 360 * v], [.3, 372 * v], [1, 310 * v]], level: .022 * hush, attack: .04, pan });
  }
  // Somebody else's horn, a street or two away: one blast or two quick ones
  distantHorn(g, now, hush) {
    const pan = this.between(-.9, .9), frequency = this.between(95, 118), level = .022 * hush, tone = this.between(900, 1400);
    if (this.random() < .5) g.event('horn', { time: now, duration: this.between(.35, .7), hold: .25, frequency, level, attack: .015, pan, tone, wave: 'horn' });
    else for (let i = 0; i < 2; i++) g.event('horn', { time: now + i * .22, duration: .15, hold: .08, frequency, level, attack: .01, pan, tone, wave: 'horn' });
  }
}
