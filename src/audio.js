import { DriveSoundModel, trafficSound } from './audio/model.js';
import { createSoundGraph } from './audio/synthesis.js';
import { AMBIENCE, MIX_CHANNELS, MIX_PRESETS, engineFor, sanitizeMix } from './audio/profiles.js';
import { SoundDirector } from './audio/director.js';

const STORAGE_KEY = 'citydriver-audio-v1';

// One lazy graph for the entire visit. Sources and event voices are bounded;
// all transitions use the audio clock, and silent contexts sleep after fading.
export class DriveAudio {
  constructor() {
    this.enabled = false; this.context = null; this.graph = null; this.journey = 'coast'; this.car = 'auto';
    this.paused = false; this.hidden = false; this.disposed = false;
    this.model = new DriveSoundModel(); this.director = new SoundDirector(); this.targets = new WeakMap();
    this.revision = 0; this.lastUpdate = -Infinity; this.suspendTimer = null;
    this.mix = sanitizeMix(null);
    try { this.mix = sanitizeMix(JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null')); } catch { /* Storage is optional. */ }
    this.trafficSlots = Array(4).fill(null); this.impactSerial = 0; this.lastImpact = -Infinity; this.shiftSerial = 0;
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
  setMix(channel, value) {
    if (!MIX_CHANNELS.includes(channel) && channel !== 'night') return;
    this.mix = sanitizeMix({ ...this.mix, [channel]: value }); this.saveMix(); this.syncOutput();
  }
  setPreset(id) {
    if (!Object.hasOwn(MIX_PRESETS, id)) return;
    this.mix = { ...MIX_PRESETS[id] }; this.saveMix(); this.syncOutput();
  }
  saveMix() { try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.mix)); } catch { /* Keep the mix for this visit. */ } }
  setJourney(id) {
    this.journey = Object.hasOwn(AMBIENCE, id) ? id : 'coast';
    this.setCar(this.car, true); this.reset();
  }
  setCar(id, force = false) {
    if (!force && this.car === id) return;
    this.car = id; this.profile = engineFor(id, this.journey);
    this.model.setProfile(this.profile); this.graph?.setEngine(this.profile); this.shiftSerial = 0;
    this.targets = new WeakMap();
  }
  reset() {
    this.model.reset(); this.lastUpdate = -Infinity; this.shiftSerial = 0;
    this.graph?.silenceEvents(); this.director.reset(this.context?.currentTime ?? 0);
    this.trafficSlots.fill(null);
    if (this.graph) for (const voice of this.graph.traffic) this.target(voice.level, 0, .04);
  }
  async toggle() {
    if (this.disposed) return false;
    const revision = ++this.revision;
    this.enabled = !this.enabled;
    try {
      if (this.enabled) { this.ensureContext(); await this.wake(); }
      this.syncOutput();
    } catch (error) {
      if (revision === this.revision) { this.enabled = false; this.syncOutput(); }
      throw error;
    }
    return this.enabled;
  }
  ensureContext() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('Web Audio is unavailable');
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      try { this.graph = createSoundGraph(ctx); this.context = ctx; }
      catch (error) { void ctx.close().catch(() => {}); throw error; }
      this.setCar(this.car, true);
      this.update({}, 1 / 60, true);
    }
  }
  async wake() {
    clearTimeout(this.suspendTimer); this.suspendTimer = null;
    if (this.audible && this.context && this.context.state !== 'running') await this.context.resume();
  }
  unlock() {
    if (!this.audible || !this.context || this.context.state === 'running') return;
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
  update(telemetry = {}, dt, force = false, scene = null) {
    if (!this.graph || this.disposed) return;
    if (scene?.player) this.setCar(scene.player.carId);
    const state = this.model.update(telemetry, this.paused || this.hidden ? 0 : dt); this.state = state;
    const now = this.context.currentTime;
    if (!this.audible) {
      this.shiftSerial = state.shiftSerial;
      if (Number.isFinite(telemetry.impactSerial)) this.impactSerial = telemetry.impactSerial;
      if (scene?.props) scene.props.sounds.length = 0;
    }
    if (!force && (!this.audible || this.context.state !== 'running' || now - this.lastUpdate < 1 / 30)) return;
    this.lastUpdate = now;
    const g = this.graph, profile = this.profile ?? engineFor(this.car, this.journey);
    const set = (param, value, seconds) => this.target(param, value, seconds);
    g.engineBank.update(state.rpm, state.load, set);
    set(g.body.frequency, state.rpm / 60, .09);
    set(g.engineLevel, state.engineLevel * 2.8); set(g.engineFilter, state.engineCutoff * 1.5, .18);
    set(g.bodyLevel, (.004 + state.load * .008) * profile.body);
    set(g.combustion.level, (.004 + state.load * .01) * profile.rasp); set(g.combustion.frequency, 380 + state.load * 700);
    set(g.intake.level, state.load ** 2 * .022 * profile.intake);
    set(g.intake.frequency, 800 + state.rpm * .22);
    set(g.reverse.frequency, state.reverseFrequency); set(g.reverseLevel, state.reverseLevel);
    const wetness = this.journey === 'city' ? Math.max(0, Math.min(1, scene?.wetness ?? scene?.rain ?? 0)) : 0;
    set(g.road.level, state.roadLevel * (1.4 + wetness * .25)); set(g.road.frequency, 480 + state.motion * (1000 + wetness * 1600), .25);
    set(g.road.rate, .65 + state.motion * .7, .3);
    const roughness = state.roughLevel * 1.8;
    set(g.rough.level, roughness); set(g.roughPulse, roughness * .16); set(g.roughMod.frequency, 12 + state.motion * 31);
    set(g.rough.rate, .55 + state.motion * .5, .25);
    set(g.rough.frequency, AMBIENCE[this.journey].rough, .8);
    set(g.wind.level, state.windLevel * (1 + .09 * Math.sin(now * .71)), .4); set(g.wind.frequency, 650 + state.motion * 1350, .4);
    set(g.skid.level, state.skidLevel); set(g.skid.frequency, state.skidFrequency);
    set(g.skidTone.frequency, state.skidFrequency * 1.13); set(g.skidToneLevel, state.skidLevel * .12);
    // Grinding along a wall or a car lasts as long as the contact does
    const scrape = Math.min(1, Math.max(0, ((Number(telemetry.scrape) || 0) - 1.5) / 12));
    set(g.scrape.level, this.audible ? scrape * .06 : 0, .03); set(g.scrape.frequency, 1150 + scrape * 900, .05); set(g.scrape.rate, .75 + scrape * .5, .05);
    const cabin = scene?.interior && !profile.open;
    for (const name of ['engine', 'road', 'ambience', 'traffic']) set(g.perspective[name], cabin ? name === 'engine' ? 2200 : 1600 : 14000, .35);
    this.ambience(state, now, scene);
    if (this.audible) {
      this.effects(telemetry, state, now);
      this.furniture(scene);
      this.director.update(this, state, now, scene);
    }
    this.updateTraffic(scene);
  }
  ambience(state, now, scene = null) {
    const g = this.graph, profile = AMBIENCE[this.journey], set = (param, value, seconds = .8) => this.target(param, value, seconds);
    const swell = (.5 + .5 * Math.sin(now * .47 + .6 * Math.sin(now * .113))) ** 2;
    const gust = .5 + .3 * Math.sin(now * .23) + .2 * Math.sin(now * .61 + 2);
    const envelope = this.journey === 'coast' ? swell : this.journey === 'city' ? .62 + gust * .38 : gust;
    const rain = this.journey === 'city' ? Math.max(0, Math.min(1, scene?.rain ?? 0)) : 0;
    set(g.bed.level, (profile.bed + envelope * profile.swell) * (this.journey === 'city' ? .6 + rain * .4 : 1));
    set(g.bed.frequency, profile.low);
    // Wind breathes slowly; city rain uses its own droplet texture. The foam
    // and insect branches only apply to Citydriver 1's journeys.
    const foam = this.journey === 'coast' ? (.5 + .5 * Math.sin(now * .47 - .7 + .6 * Math.sin(now * .113))) ** 3 : envelope ** 1.5;
    set(g.air.level, this.journey === 'city' ? .012 + .02 * rain : profile.air + foam * profile.wash, 1);
    set(g.air.frequency, profile.high * (.8 + envelope * .4), 1);
    set(g.rain.level, rain * (.28 + gust * .09), 1);
    const insects = ['jungle', 'plains'].includes(this.journey) ? (.018 + .012 * Math.sin(now * .83) ** 4) * (1 - state.motion * .4) : 0;
    set(g.insects.level, insects); set(g.insectPulse, insects * .7);
    set(g.insects.frequency, this.journey === 'plains' ? 4300 : 3600);
    set(g.insectMod.frequency, this.journey === 'plains' ? 36 : 47);
  }
  effects(telemetry, state, now) {
    if (state.shiftSerial !== this.shiftSerial) {
      this.shiftSerial = state.shiftSerial;
      if (state.load > .18) this.graph.event('engine', { duration: .13, frequency: 170, endFrequency: 70, level: .055 });
    }
    // An event serial survives multiple fixed physics ticks in one video frame.
    if (Number.isFinite(telemetry.impactSerial) && telemetry.impactSerial !== this.impactSerial) {
      this.impactSerial = telemetry.impactSerial;
      if (now - this.lastImpact > .3 && Number.isFinite(telemetry.impact) && telemetry.impact > .4) {
        this.lastImpact = now;
        this.graph.event('road', { duration: .32, frequency: 240, endFrequency: 65, level: Math.min(.3, telemetry.impact * .018), attack: .008 });
        // and a hard one crunches as well as thuds
        if (telemetry.impact > 6) this.graph.event('road', { duration: .2, frequency: 1600, endFrequency: 380, level: Math.min(.13, (telemetry.impact - 6) * .009), attack: .004 });
      }
    }
  }
  // Street furniture knocked flying, and landing (see LooseProps): a post
  // rings, timber cracks, a bin or a chair clatters, quieter further off
  furniture(scene) {
    const props = scene?.props, player = scene?.player;
    if (!props?.sounds.length) return;
    const heading = scene.heading ?? player?.heading ?? 0;
    for (const { kind, strength, x, z } of props.sounds) {
      const dx = x - (player?.groundedPosition?.x ?? x), dz = z - (player?.groundedPosition?.z ?? z), distance = Math.hypot(dx, dz);
      const loud = Math.min(1, strength / 14) * Math.max(0, 1 - distance / 70) ** 2;
      if (!(loud > .02)) continue;
      const pan = Math.min(.95, Math.max(-.95, (dx * Math.cos(heading) + dz * Math.sin(heading)) / Math.max(6, distance * .55)));
      const event = (pool, duration, frequency, endFrequency, level, attack = .004) => this.graph.event(pool, { duration, frequency, endFrequency, level: level * loud, pan, attack });
      if (kind === 'metal') { event('clang', .7, 620, 575, .05, .003); event('clang', .45, 1710, 1640, .022, .003); event('smash', .14, 1900, 650, .06, .003); }
      else if (kind === 'wood') event('smash', .22, 950, 260, .12);
      else if (kind === 'bin') event('smash', .18, 560, 180, .1);
      else if (kind === 'light') event('smash', .1, 2100, 900, .05, .003);
      else if (kind === 'splash') event('smash', .55, 1300, 380, .08, .03);
    }
    props.sounds.length = 0;
  }
  updateTraffic(scene) {
    const player = scene?.player, fleet = scene?.traffic?.enabled ? scene.traffic.vehicles : [];
    const candidates = player ? fleet.map(car => ({ car, sound: trafficSound(player, car, scene.heading ?? player.heading) })).filter(entry => entry.sound.distance < 85).sort((a, b) => a.sound.distance - b.sound.distance).slice(0, 4) : [];
    // Keep a car in the same stereo voice while it passes, even when ranking
    // changes. Recycling a distant car cannot teleport an audible source.
    for (let i = 0; i < this.trafficSlots.length; i++) if (!candidates.some(entry => entry.car === this.trafficSlots[i])) this.trafficSlots[i] = null;
    for (const { car } of candidates) if (!this.trafficSlots.includes(car)) this.trafficSlots[this.trafficSlots.indexOf(null)] = car;
    for (let i = 0; i < this.graph.traffic.length; i++) {
      const voice = this.graph.traffic[i], entry = candidates.find(entry => entry.car === this.trafficSlots[i]);
      this.target(voice.level, entry?.sound.level ?? 0, .09);
      if (!entry) continue;
      const { car, sound } = entry;
      this.target(voice.pan, sound.pan, .065); this.target(voice.tone, (55 + car.speed * 3 + car.index * 3) * sound.doppler, .07);
      this.target(voice.wash, 650 + car.speed * 35 + (this.journey === 'city' ? 900 : 0), .15);
      this.target(voice.rate, sound.doppler, .1);
    }
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true; this.enabled = false; ++this.revision;
    clearTimeout(this.suspendTimer); this.graph?.dispose();
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.graph = null; this.context = null;
  }
}
