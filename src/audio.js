import { DriveSoundModel, cityAmbience, trafficSound, trafficVoice } from './audio/model.js';
import { createSoundGraph } from './audio/synthesis.js';
import { MIX_CHANNELS, MIX_PRESETS, engineFor, sanitizeMix } from './audio/profiles.js';
import { SoundDirector } from './audio/director.js';
import { cueFrequency, cueNotes } from './audio/cues.js';

const STORAGE_KEY = 'citydriver-audio-v1', SOUND_KEY = 'citydriver-sound';
const storage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

// One lazy graph for the entire visit. Sources and event voices are bounded;
// all transitions use the audio clock, and silent contexts sleep after fading.
export class DriveAudio {
  constructor() {
    this.enabled = false; this.context = null; this.graph = null; this.car = 'auto'; this.cruise = 0;
    this.paused = false; this.hidden = false; this.disposed = false;
    this.model = new DriveSoundModel(); this.director = new SoundDirector(); this.targets = new WeakMap();
    this.revision = 0; this.lastUpdate = -Infinity; this.suspendTimer = null;
    this.mix = sanitizeMix(null);
    try { this.mix = sanitizeMix(JSON.parse(storage()?.getItem(STORAGE_KEY) ?? 'null')); } catch { /* Storage is optional. */ }
    // Whether sound was on last visit: it comes back on at the first click or key
    try { this.remembered = storage()?.getItem(SOUND_KEY) === 'on'; } catch { this.remembered = false; }
    this.trafficSlots = Array(4).fill(null); this.nearby = [];
    this.impactSerial = 0; this.bumpSerial = 0; this.stepSerial = 0; this.shiftSerial = 0; this.liftSerial = 0; this.lastImpact = -Infinity;
    this.boosting = false; this.deck = null; this.duckUntil = -Infinity; this.lastHonk = -Infinity; this.honks = new WeakMap();
    // Where the car is, eased so the soundscape changes as smoothly as the streets do
    this.place = { urban: .6, green: .1, water: 0, sea: 0 };
  }
  get audible() { return this.enabled && !this.paused && !this.hidden && !this.disposed; }
  get preset() { return Object.keys(MIX_PRESETS).find(id => Object.keys(this.mix).every(key => this.mix[key] === MIX_PRESETS[id][key])) ?? 'custom'; }
  target(param, value, seconds = .12) {
    if (Number.isFinite(param.maxValue)) value = Math.min(param.maxValue, Math.max(param.minValue, value));
    if (!Number.isFinite(value) || Math.abs((this.targets.get(param) ?? Infinity) - value) < .0001) return;
    // Replace obsolete automation so hours of driving cannot grow its queue.
    param.cancelScheduledValues(this.context.currentTime);
    param.setTargetAtTime(value, this.context.currentTime, seconds); this.targets.set(param, value);
  }
  // A continuous layer fades to `value`. Once it has faded out it is unhooked
  // from its source, so the filters after it sleep and a source nothing
  // listens to is not played at all (see sweep).
  layer(layer, value, seconds = .12) {
    if (!(value > .00005)) value = 0;
    if (value > 0) {
      if (!layer.open) { for (const [from, to] of layer.links) from.connect(to); layer.open = true; }
      layer.closeAt = Infinity;
    } else if (layer.open && layer.closeAt === Infinity) layer.closeAt = this.context.currentTime + seconds * 6 + .05;
    this.target(layer.level, value, seconds);
  }
  sweep(now) {
    for (const layer of this.graph.layers) if (layer.open && now >= layer.closeAt) {
      layer.level.cancelScheduledValues(now); layer.level.setValueAtTime(0, now); this.targets.set(layer.level, 0);
      for (const [from, to] of layer.links) from.disconnect(to);
      layer.open = false; layer.closeAt = Infinity;
    }
  }
  setMix(channel, value) {
    if (!MIX_CHANNELS.includes(channel) && channel !== 'night') return;
    this.mix = sanitizeMix({ ...this.mix, [channel]: value }); this.saveMix(); this.syncOutput();
  }
  setPreset(id) {
    if (!Object.hasOwn(MIX_PRESETS, id)) return;
    this.mix = { ...MIX_PRESETS[id] }; this.saveMix(); this.syncOutput();
  }
  saveMix() { try { storage()?.setItem(STORAGE_KEY, JSON.stringify(this.mix)); } catch { /* Keep the mix for this visit. */ } }
  // `cruise` is the speed the car holds (carStats), which sets its gearing
  setCar(id, force = false, cruise = this.cruise) {
    if (!force && this.car === id && this.cruise === cruise) return;
    this.car = id; this.cruise = cruise; this.profile = engineFor(id);
    this.model.setProfile(this.profile, cruise || 28); this.graph?.setEngine(this.profile); this.shiftSerial = 0; this.liftSerial = 0;
    this.targets = new WeakMap();
  }
  reset() {
    this.model.reset(); this.lastUpdate = -Infinity; this.shiftSerial = 0; this.liftSerial = 0; this.boosting = false; this.deck = null;
    this.graph?.silenceEvents(); this.director.reset(this.context?.currentTime ?? 0);
    this.trafficSlots.fill(null);
    if (this.graph) for (const voice of this.graph.traffic) { this.layer(voice.tone, 0, .04); this.layer(voice.wash, 0, .04); }
  }
  async toggle() {
    if (this.disposed) return false;
    const revision = ++this.revision;
    this.enabled = !this.enabled; this.remember();
    try {
      if (this.enabled) { this.ensureContext(); await this.wake(); }
      this.syncOutput();
    } catch (error) {
      if (revision === this.revision) { this.enabled = false; this.remember(); this.syncOutput(); }
      throw error;
    }
    return this.enabled;
  }
  remember() { try { storage()?.setItem(SOUND_KEY, this.enabled ? 'on' : 'off'); } catch { /* Optional storage. */ } }
  // Sound left on last visit: the graph is built now, behind the loading
  // screen, and waits suspended until the first click or key (browsers only
  // start audio from a gesture; see unlock).
  restore() {
    if (!this.remembered || this.disposed) return false;
    this.enabled = true;
    // (asleep until heard, even where the browser would let it start)
    try { this.ensureContext(); this.syncOutput(); } catch { this.enabled = false; }
    return this.enabled;
  }
  ensureContext() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('Web Audio is unavailable');
      this.attach(new AudioContext({ latencyHint: 'interactive' }));
    }
  }
  attach(ctx) {
    try { this.graph = createSoundGraph(ctx); this.context = ctx; }
    catch (error) { void ctx.close?.().catch(() => {}); throw error; }
    this.setCar(this.car, true);
    this.update({}, 1 / 60, true);
  }
  async wake() {
    clearTimeout(this.suspendTimer); this.suspendTimer = null;
    if (this.audible && this.context && this.context.state !== 'running') await this.context.resume();
  }
  unlock() {
    if (!this.audible) return;
    if (!this.context) {
      try { this.ensureContext(); } catch { this.enabled = false; return; }
      this.syncOutput();
    }
    if (this.context.state === 'running') return;
    void this.wake().then(() => this.syncOutput()).catch(() => {});
  }
  syncOutput() {
    if (!this.graph || this.disposed) return;
    this.target(this.graph.master, this.audible ? this.mix.master * .75 : 0, this.audible ? .16 : .065);
    for (const [channel, param] of Object.entries(this.graph.buses)) this.target(param, this.mix[channel], .12);
    this.target(this.graph.compressor.threshold, this.mix.night ? -28 : -14, .3);
    this.target(this.graph.compressor.ratio, this.mix.night ? 6 : 3, .3);
    clearTimeout(this.suspendTimer); this.suspendTimer = null;
    if (!this.audible) this.graph.silenceEvents();
    if (!this.audible && this.context.state === 'running') {
      this.suspendTimer = setTimeout(() => {
        if (!this.audible && !this.disposed) {
          const param = this.graph.master;
          param.cancelScheduledValues(this.context.currentTime);
          param.setValueAtTime(0, this.context.currentTime); this.targets.set(param, 0);
          void this.context.suspend().catch(() => {});
        }
      }, 750);
    }
  }
  setPaused(value) { this.paused = Boolean(value); this.syncOutput(); this.unlock(); }
  setHidden(value) { this.hidden = Boolean(value); this.syncOutput(); this.unlock(); }
  // A game cue (see cues.js): the taxi's pickups and payouts, the shift's
  // last seconds, a landmark found. Heard only while the drive is.
  cue(kind, detail = {}) {
    if (!this.audible || !this.graph || !(this.mix.cues > 0)) return;
    const now = this.context.currentTime + .01;
    for (const { at, step, length, level, wave } of cueNotes(kind, detail)) {
      this.graph.event('cue', { time: now + at, duration: length, frequency: cueFrequency(step), level, attack: .005, wave, pan: 0 });
    }
  }
  update(telemetry = {}, dt, force = false, scene = null) {
    if (!this.graph || this.disposed) return;
    if (scene?.player) this.setCar(scene.player.carId, false, scene.player.stats?.cruise ?? scene.player.stats?.topSpeed ?? 0);
    const state = this.model.update(telemetry, this.paused || this.hidden ? 0 : dt); this.state = state;
    const now = this.context.currentTime;
    if (!this.audible) {
      this.shiftSerial = state.shiftSerial; this.liftSerial = state.liftSerial; this.boosting = Boolean(telemetry.boost);
      if (Number.isFinite(telemetry.impactSerial)) this.impactSerial = telemetry.impactSerial;
      if (Number.isFinite(telemetry.bumpSerial)) this.bumpSerial = telemetry.bumpSerial;
      if (Number.isFinite(telemetry.stepSerial)) this.stepSerial = telemetry.stepSerial;
      if (scene?.props) scene.props.sounds.length = 0;
    }
    if (!force && (!this.audible || this.context.state !== 'running' || now - this.lastUpdate < 1 / 30)) return;
    const elapsed = Math.min(1, Math.max(0, now - this.lastUpdate));
    this.lastUpdate = now;
    const g = this.graph, profile = this.profile ?? engineFor(this.car);
    const set = (param, value, seconds) => this.target(param, value, seconds);
    const layer = (target, value, seconds) => this.layer(target, value, seconds);
    // The car: engine, then tyres, wind and whatever it is scraping along
    g.engineBank.update(state.rpm, state.load, set);
    set(g.engineLevel, state.engineLevel * 3.2); set(g.engineFilter, state.engineCutoff * 1.5, .18);
    layer(g.combustion, (.004 + state.load * .01) * profile.rasp); set(g.combustion.frequency, 380 + state.load * 700);
    layer(g.intake, state.load ** 2 * .022 * profile.intake); set(g.intake.frequency, 800 + state.rpm * .22);
    layer(g.boost, state.boost * (.03 + state.motion * .03), state.boost ? .15 : .3); set(g.boost.frequency, 900 + state.motion * 1700, .4);
    layer(g.reverse, state.reverseLevel); set(g.reverse.frequency, state.reverseFrequency);
    const wetness = clamp01(scene?.wetness ?? scene?.rain);
    layer(g.road, state.roadLevel * (1.4 + wetness * .3)); set(g.road.frequency, 480 + state.motion * (1000 + wetness * 2600), .25);
    // (the same judder, low and deep, is a helicopter's blades beating)
    const roughness = state.roughLevel * 1.8, chop = state.chop;
    layer(g.rough, roughness); set(g.roughPulse, roughness * (chop ? .9 : .16)); set(g.roughMod.frequency, chop || 12 + state.motion * 31);
    set(g.rough.frequency, chop ? 190 : 1000);
    // In first person the cabin muffles the world, unless the car has none
    const cabin = Boolean(scene?.interior && !profile.open);
    set(g.cabin.engine, cabin ? 2200 : 20000, .35); set(g.cabin.world, cabin ? 1600 : 20000, .35);
    set(g.engineShelf, cabin ? -1 : -5, .35);
    const city = this.ambience(scene, now, elapsed, cabin);
    layer(g.wind, state.windLevel * (.9 + .2 * city.gust), .4); set(g.wind.frequency, 650 + state.motion * 1350, .4);
    // Grinding along a wall or a car lasts as long as the contact does
    const scrape = Math.min(1, Math.max(0, ((Number(telemetry.scrape) || 0) - 1.5) / 12));
    layer(g.scrape, scrape * .06, .03); set(g.scrape.frequency, 1150 + scrape * 900, .05);
    this.effects(telemetry, state, now, scene);
    this.furniture(scene);
    this.director.update(this, state, now, scene);
    this.updateTraffic(scene, now);
    // After a crash the world comes back up
    set(g.backdrop, now < this.duckUntil ? .45 : 1, now < this.duckUntil ? .02 : .6);
    this.sweep(now);
  }
  ambience(scene, now, elapsed, cabin) {
    const target = scene?.place;
    if (target) {
      const ease = 1 - Math.exp(-elapsed / 2.5);
      for (const key of Object.keys(this.place)) this.place[key] += (clamp01(target[key]) - this.place[key]) * ease;
    }
    const g = this.graph, city = cityAmbience(this.place, { rain: scene?.rain, snow: scene?.snow, night: scene?.night, cabin }, now);
    this.layer(g.bed, city.hum, .8); this.target(g.bed.frequency, city.humFrequency, 2);
    this.layer(g.air, city.air, 1); this.target(g.air.frequency, city.airFrequency, 1);
    this.layer(g.rain, city.rain, 1); this.target(g.rain.frequency, city.rainFrequency, .4);
    return city;
  }
  duck(seconds) { this.duckUntil = Math.max(this.duckUntil, this.context.currentTime + seconds); }
  effects(telemetry, state, now, scene) {
    const g = this.graph, profile = this.profile ?? engineFor(this.car), speed = Math.abs(Number(telemetry.speed) || 0);
    if (state.shiftSerial !== this.shiftSerial) {
      this.shiftSerial = state.shiftSerial;
      if (state.load > .3) g.event('engine', { duration: .11, frequency: 170, endFrequency: 70, level: .05 });
    }
    // A sporty engine crackles when the throttle snaps shut at high revs
    if (state.liftSerial !== this.liftSerial) {
      this.liftSerial = state.liftSerial;
      for (let i = 0, at = .06, n = profile.pops ? 2 + Math.floor(g.random() * 3 * profile.pops) : 0; i < n; i++, at += .07 + g.random() * .16) {
        g.event('engine', { time: now + at, duration: .05 + g.random() * .04, frequency: 900 + g.random() * 700, endFrequency: 260, level: (.05 + g.random() * .04) * profile.pops, attack: .002, q: 1.1 });
      }
    }
    // Boost comes in with a rush of air and goes with the blow-off's hiss
    const boosting = Boolean(telemetry.boost);
    if (boosting !== this.boosting) {
      this.boosting = boosting;
      if (boosting) g.event('engine', { duration: .55, frequency: 420, endFrequency: 1900, level: .045, attack: .12, q: 1.4 });
      else if (speed > 5) g.event('engine', { duration: .32, frequency: 3400, endFrequency: 1700, level: .022, attack: .006, q: 1.8 });
    }
    // An event serial survives multiple fixed physics ticks in one video frame.
    if (Number.isFinite(telemetry.impactSerial) && telemetry.impactSerial !== this.impactSerial) {
      this.impactSerial = telemetry.impactSerial;
      const impact = Number(telemetry.impact) || 0;
      if (now - this.lastImpact > .3 && impact > .4) {
        this.lastImpact = now;
        // A thud with body to it, the crunch of panels, and on a hard hit, glass
        const v = .92 + g.random() * .16;
        g.event('thump', { duration: .3, frequency: 105 * v, endFrequency: 42, level: Math.min(.3, impact * .028), attack: .004 });
        g.event('road', { duration: .26, frequency: 900 * v, endFrequency: 180, level: Math.min(.22, impact * .016), attack: .003, q: .9 });
        if (impact > 6) {
          for (let i = 0; i < 3; i++) g.event('smash', { time: now + .02 + i * (.03 + g.random() * .05), duration: .08 + g.random() * .08, frequency: 3000 + g.random() * 2400, endFrequency: 2200, level: Math.min(.06, (impact - 6) * .008), attack: .002, q: 2.5, pan: (g.random() - .5) * .6 });
        }
        if (impact > 3) this.duck(Math.min(.45, impact * .03));
      }
    }
    // Over a kerb: the front wheels, then the back ones a wheelbase later
    if (Number.isFinite(telemetry.bumpSerial) && telemetry.bumpSerial !== this.bumpSerial) {
      this.bumpSerial = telemetry.bumpSerial;
      this.bump(now, speed, Math.min(1, (Number(telemetry.bump) || .12) / .12));
    }
    // On foot, each footfall, and landing from a hop (see Walker): soft, and a little different each time
    if (Number.isFinite(telemetry.stepSerial) && telemetry.stepSerial !== this.stepSerial) {
      this.stepSerial = telemetry.stepSerial;
      const strength = Math.min(1, Math.max(0, Number(telemetry.step) || .5)), v = .9 + g.random() * .2;
      g.event('road', { duration: .045 + strength * .03, frequency: 1100 * v, endFrequency: 420 * v, level: .012 + strength * .02, attack: .002, q: .9 });
    }
    // Over a bridge's expansion joint, at either end
    const deck = scene?.deck === undefined ? null : Boolean(scene.deck);
    if (deck !== null && this.deck !== null && deck !== this.deck && speed > 2) this.bump(now, speed, .8, true);
    this.deck = deck;
  }
  bump(now, speed, size, joint = false) {
    const g = this.graph, strength = Math.min(1, speed / 16) * size;
    if (!(strength > .05)) return;
    const axle = 2.7 / Math.max(2, speed);
    for (const [at, share] of [[0, 1], [axle, .75]]) {
      if (at > .45) break;
      g.event('thump', { time: now + at, duration: .14, frequency: joint ? 150 : 120, endFrequency: joint ? 70 : 60, level: .1 * strength * share, attack: .003 });
      g.event('road', { time: now + at, duration: joint ? .07 : .06, frequency: joint ? 1600 : 700, endFrequency: joint ? 600 : 260, level: (joint ? .07 : .06) * strength * share, attack: .002, q: 1 });
    }
  }
  // Street furniture knocked flying, and landing (see LooseProps): a post
  // rings, timber cracks, a bin or a chair clatters, quieter further off
  furniture(scene) {
    const props = scene?.props, player = scene?.player;
    if (!props?.sounds.length) return;
    const g = this.graph, heading = scene.heading ?? player?.heading ?? 0;
    for (const { kind, strength, x, z } of props.sounds) {
      const dx = x - (player?.groundedPosition?.x ?? x), dz = z - (player?.groundedPosition?.z ?? z), distance = Math.hypot(dx, dz);
      const loud = Math.min(1, strength / 14) * Math.max(0, 1 - distance / 70) ** 2;
      if (!(loud > .02)) continue;
      const pan = Math.min(.95, Math.max(-.95, (dx * Math.cos(heading) + dz * Math.sin(heading)) / Math.max(6, distance * .55)));
      // (each a little different, so a row of bins is not one sound repeated)
      const v = .94 + g.random() * .12;
      const event = (pool, duration, frequency, endFrequency, level, attack = .004) => g.event(pool, { duration, frequency: frequency * v, endFrequency: endFrequency * v, level: level * loud, pan, attack });
      if (kind === 'metal') { event('clang', .7, 620, 575, .05, .003); event('clang', .45, 1710, 1640, .022, .003); event('smash', .14, 1900, 650, .035, .003); }
      else if (kind === 'wood') event('smash', .22, 950, 260, .07);
      else if (kind === 'bin') event('smash', .18, 560, 180, .06);
      else if (kind === 'light') event('smash', .1, 2100, 900, .03, .003);
      else if (kind === 'splash') event('smash', .55, 1300, 380, .05, .03);
      else if (kind === 'thud') { event('thump', .2, 150, 62, .09, .006); event('smash', .12, 520, 220, .03, .006); }
    }
    props.sounds.length = 0;
  }
  // The four nearest cars each keep a voice while they pass; a driver the
  // player has hit, or has held up, sounds the horn.
  updateTraffic(scene, now) {
    const player = scene?.player, fleet = player && scene?.traffic?.enabled ? scene.traffic.vehicles : [];
    const near = this.nearby; near.length = 0;
    const px = player?.groundedPosition?.x ?? 0, pz = player?.groundedPosition?.z ?? 0;
    for (const car of fleet) {
      const d = Math.hypot((car.position?.x ?? Infinity) - px, (car.position?.z ?? Infinity) - pz);
      if (!(d < 85)) continue;
      let i = near.length;
      while (i > 0 && near[i - 1].d > d) i--;
      if (i < 4) { near.splice(i, 0, { car, d }); if (near.length > 4) near.pop(); }
      this.horn(car, player, scene, now);
    }
    // Keep a car in the same stereo voice while it passes, even when ranking
    // changes. Recycling a distant car cannot teleport an audible source.
    for (let i = 0; i < this.trafficSlots.length; i++) if (!near.some(entry => entry.car === this.trafficSlots[i])) this.trafficSlots[i] = null;
    for (const { car } of near) if (!this.trafficSlots.includes(car)) this.trafficSlots[this.trafficSlots.indexOf(null)] = car;
    const g = this.graph, heading = scene?.heading ?? player?.heading ?? 0;
    for (let i = 0; i < g.traffic.length; i++) {
      const voice = g.traffic[i], car = this.trafficSlots[i];
      // (a car leaving the nearest four fades out, rather than stopping short)
      if (!car) { this.layer(voice.tone, 0, .25); this.layer(voice.wash, 0, .25); continue; }
      const sound = trafficSound(player, car, heading), sounds = trafficVoice(car, sound);
      // (a new car in the voice brings its own engine; it arrives silent from the edge)
      const wave = g.waves[car.spec?.name] ? car.spec.name : 'sedan';
      if (voice.wave !== wave) { voice.engine.setPeriodicWave(g.waves[wave]); voice.wave = wave; }
      this.layer(voice.tone, sounds.engine * .11, .09); this.layer(voice.wash, sounds.tyres * .24, .09);
      this.target(voice.pan, sound.pan, .065); this.target(voice.tone.frequency, sounds.pitch, .07);
      this.target(voice.wash.frequency, sounds.hiss, .15);
    }
  }
  horn(car, player, scene, now) {
    const struck = Boolean(car.loose || car.bumped > 0), memory = this.honks.get(car) ?? { struck: false, at: -Infinity, held: 0 };
    let blasts = 0;
    if (struck && !memory.struck && now - memory.at > 4) blasts = 1;
    // Held up by the player alone for a few seconds (see CityTraffic.following)
    else if (car.held > 3 && now - memory.at > 6 + (car.index % 3) * 1.5) blasts = 2;
    memory.struck = struck;
    if (blasts && now - this.lastHonk > .8) {
      memory.at = now; this.lastHonk = now;
      const sound = trafficSound(player, car, scene?.heading ?? player.heading), g = this.graph;
      const frequency = 100 + car.index % 7 * 3, level = .15 * Math.sqrt(sound.level), tone = 2200 + 1800 * sound.level, start = now + .3 + g.random() * .4;
      if (blasts === 1) g.event('horn', { time: start, duration: .8 + g.random() * .4, hold: .6, frequency, level, attack: .015, pan: sound.pan, tone, wave: 'horn' });
      else for (let i = 0; i < 2; i++) g.event('horn', { time: start + i * .2, duration: .14, hold: .08, frequency, level: level * .8, attack: .01, pan: sound.pan, tone, wave: 'horn' });
    }
    this.honks.set(car, memory);
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true; this.enabled = false; ++this.revision;
    clearTimeout(this.suspendTimer); this.graph?.dispose();
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.graph = null; this.context = null;
  }
}
