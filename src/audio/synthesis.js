import { ENGINES } from './profiles.js';
import { createEngineBank } from './engine.js';
import { createTextureBuffer } from './textures.js';

// Stereo pink noise with a seamless join: the noise layers' default buffer.
export function createNoiseBuffer(ctx, seed = 0x71ca9) {
  const length = Math.ceil(ctx.sampleRate * 8), overlap = Math.ceil(ctx.sampleRate * .15);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  let state = seed >>> 0;
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel), tail = new Float32Array(overlap);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < length + overlap; i++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      const white = (state >>> 0) / 2147483648 - 1;
      b0 = .99765 * b0 + white * .099046;
      b1 = .963 * b1 + white * .2965164;
      b2 = .57 * b2 + white * 1.0526913;
      const sample = (b0 + b1 + b2 + white * .1848) * .18;
      if (i < length) data[i] = sample; else tail[i - length] = sample;
    }
    // The tail follows the last sample naturally, then blends into the start.
    for (let i = 0; i < overlap; i++) {
      const phase = i / (overlap - 1) * Math.PI / 2;
      data[i] = tail[i] * Math.cos(phase) + data[i] * Math.sin(phase);
    }
  }
  return buffer;
}

// One cricket's chirp: four quick pulses of a high tone, each a shade lower
// as the wing's file runs down. Played as a sample, a few times a second.
export function createCricketBuffer(ctx) {
  const rate = ctx.sampleRate, buffer = ctx.createBuffer(1, Math.round(rate * .16), rate), data = buffer.getChannelData(0);
  for (let pulse = 0; pulse < 4; pulse++) {
    const start = Math.round(rate * pulse * .036), n = Math.round(rate * .022);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      phase += 2 * Math.PI * (4750 - pulse * 40 - i / n * 120) / rate;
      data[start + i] = Math.sin(phase) * Math.sin(Math.PI * i / n) ** 2 * (1 - pulse * .08);
    }
  }
  return buffer;
}

// A two-tone car horn as one waveform: a fundamental a fifth of the way down
// whose 4th and 5th harmonics are the two notes (a major third apart), each
// with its own reedy overtones up to about 3.5 kHz.
function hornPartials() {
  const imag = new Float32Array(41);
  for (const note of [4, 5]) for (let k = 1; note * k <= 40; k++) imag[note * k] += (note === 4 ? 1 : .85) / k ** .8 * (k === 1 ? 1 : .7);
  return imag;
}

// Continuous parameters move at the control rate (once every 128 samples):
// Chromium otherwise recomputes an automated filter's coefficients every
// sample, which costs it twice as much and is inaudible at these speeds.
function controlRate(param) {
  try { param.automationRate = 'k-rate'; } catch { /* Fixed-rate parameter. */ }
  return param;
}

// The whole graph, built once. Silence is kept cheap: a continuous layer is
// unhooked from its source once it has faded out (see DriveAudio.layer), four
// shared noise loops feed every noise layer, and an event plays a one-shot
// source through a fixed voice, so an idle voice costs nothing either.
export function createSoundGraph(ctx) {
  const nodes = [], sources = [], layers = [];
  const keep = node => { nodes.push(node); return node; };
  const gain = (value, destination) => {
    const node = keep(ctx.createGain()); node.gain.value = value;
    if (destination) node.connect(destination);
    return node;
  };
  const filter = (type, frequency, destination, q = .65) => {
    const node = keep(ctx.createBiquadFilter()); node.type = type; node.frequency.value = frequency; node.Q.value = q;
    controlRate(node.frequency); controlRate(node.Q);
    node.connect(destination); return node;
  };
  const loop = buffer => {
    const node = keep(ctx.createBufferSource()); node.buffer = buffer; node.loop = true;
    node.start(); sources.push(node); return node;
  };
  const oscillator = (type, frequency, wave = null) => {
    const node = keep(ctx.createOscillator()); node.frequency.value = frequency; controlRate(node.frequency);
    if (wave) node.setPeriodicWave(wave); else node.type = type;
    node.start(); sources.push(node); return node;
  };
  const periodic = partials => ctx.createPeriodicWave(new Float32Array(partials.length), partials);

  // Output: every bus, the cabin's muffling in first person, the world's
  // backdrop (ducked under a crash), then protection against rumble and peaks
  const master = gain(0, ctx.destination);
  const compressor = keep(ctx.createDynamicsCompressor());
  compressor.threshold.value = -14; compressor.knee.value = 12; compressor.ratio.value = 3;
  compressor.attack.value = .006; compressor.release.value = .24; compressor.connect(master);
  const mix = gain(1, filter('highpass', 50, compressor, .7));
  const cabin = { engine: filter('lowpass', 20000, mix, 0), world: filter('lowpass', 20000, mix, 0) };
  const backdrop = gain(1, cabin.world);
  const buses = {
    engine: gain(0, cabin.engine), road: gain(0, cabin.world), ambience: gain(0, backdrop), traffic: gain(0, backdrop), cues: gain(0, mix),
  };

  const buffers = { pink: createNoiseBuffer(ctx), road: createTextureBuffer(ctx, 'road'), wind: createTextureBuffer(ctx, 'wind'), rain: createTextureBuffer(ctx, 'rain'), cricket: createCricketBuffer(ctx) };
  const noise = { pink: loop(buffers.pink), road: loop(buffers.road), wind: loop(buffers.wind), rain: loop(buffers.rain) };
  // A continuous layer: its source (a shared loop or its own oscillator)
  // through its level, then its filters. `frequency` is the last filter's.
  const layer = (input, destination, ...shape) => {
    const level = gain(0);
    let node = level, frequency = input.frequency ?? null;
    for (const [type, value, q] of shape) {
      const next = keep(ctx.createBiquadFilter()); next.type = type; next.frequency.value = value; next.Q.value = q ?? .65;
      controlRate(next.frequency); node.connect(next); node = next; frequency = next.frequency;
    }
    node.connect(destination);
    const result = { level: level.gain, frequency, links: [[input, level]], open: false, closeAt: Infinity };
    layers.push(result); return result;
  };

  const engineLevel = gain(0, buses.engine);
  // The exhaust's fixed low resonance droned under everything: outside the car
  // it is taken down so the revs carry; the cabin keeps more of its boom
  const engineShelf = filter('lowshelf', 150, engineLevel, 0); engineShelf.gain.value = -5;
  const engineFilter = filter('lowpass', 420, engineShelf);
  const engineBank = createEngineBank(ctx, engineFilter);
  engineBank.setProfile(ENGINES.city);
  const combustion = layer(noise.pink, buses.engine, ['bandpass', 550]);
  const intake = layer(noise.pink, buses.engine, ['bandpass', 1400]);
  // Boost: the intake roaring as the charge comes in
  const boost = layer(noise.pink, buses.engine, ['bandpass', 1000, 1.2]);
  const reverse = layer(oscillator('triangle', 260), buses.engine);
  const road = layer(noise.road, buses.road, ['highpass', 90], ['lowpass', 1100]);
  const rough = layer(noise.road, buses.road, ['bandpass', 1000, .8]);
  // Loose ground judders: a low oscillator swings the rough layer's level
  const roughMod = oscillator('sine', 17), roughPulse = gain(0);
  roughPulse.connect(rough.level); rough.links.push([roughMod, roughPulse]);
  const wind = layer(noise.wind, buses.road, ['highpass', 100], ['lowpass', 1500]);
  // Metal grinding along a wall or another car
  const scrape = layer(noise.road, buses.road, ['bandpass', 1500, 1.6]);
  const bed = layer(noise.wind, buses.ambience, ['highpass', 60], ['lowpass', 300]);
  const air = layer(noise.rain, buses.ambience, ['highpass', 600], ['bandpass', 2300]);
  const rain = layer(noise.rain, buses.ambience, ['highpass', 350], ['lowpass', 4700]);

  // Distant traffic uses a cheaper harmonic voice; the player's engine uses
  // combustion textures with separate RPM and load blends.
  const waves = { horn: periodic(hornPartials()), gull: periodic(new Float32Array([0, 1, .75, .55, .38, .24, .14, .08, .05])) };
  for (const name of ['hatchback', 'sedan', 'wagon', 'pickup', 'van']) waves[name] = periodic(new Float32Array([0, ...ENGINES[name].harmonics]));
  const traffic = Array.from({ length: 4 }, () => {
    const pan = keep(ctx.createStereoPanner()); controlRate(pan.pan); pan.connect(buses.traffic);
    const engine = oscillator('sine', 60, waves.sedan);
    return { pan: pan.pan, engine, tone: layer(engine, pan), wash: layer(noise.pink, pan, ['highpass', 150], ['bandpass', 900]), wave: 'sedan' };
  });

  // Fixed voice pools: a long session never accumulates nodes. Busy voices
  // are skipped, never cut mid-note. `tone` voices play a fresh oscillator (or
  // a sample) per note; `noise` voices a slice of noise through a bandpass
  // whose centre sweeps; a horn voice has a lowpass for distance.
  const pools = {};
  for (const [name, count, bus, kind] of [
    ['ambience', 6, 'ambience', 'tone'], ['cue', 6, 'cues', 'tone'], ['clang', 4, 'road', 'tone'], ['thump', 3, 'road', 'tone'], ['horn', 2, 'traffic', 'horn'],
    ['engine', 3, 'engine', 'noise'], ['road', 3, 'road', 'noise'], ['smash', 3, 'road', 'noise'], ['weather', 2, 'ambience', 'noise'], ['water', 3, 'ambience', 'noise'],
  ]) {
    pools[name] = Array.from({ length: count }, () => {
      const pan = keep(ctx.createStereoPanner()); pan.connect(buses[bus]);
      const shape = kind === 'noise' ? filter('bandpass', 500, pan) : kind === 'horn' ? filter('lowpass', 3000, pan, 0) : null;
      const envelope = gain(0, shape ?? pan);
      return { kind, envelope: envelope.gain, input: envelope, pan: pan.pan, frequency: kind === 'noise' ? shape.frequency : null, q: kind === 'noise' ? shape.Q : null, tone: kind === 'horn' ? shape.frequency : null, until: 0 };
    });
  }

  let seed = 0x2f6e2b1;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  // `contour` is [[fraction of the note, frequency], ...]; without one the
  // pitch sweeps from `frequency` to `endFrequency`. A `hold` keeps the note
  // at full level before it decays; `buffer` plays a sample (`rate` its speed).
  // A noise voice's `level` means about what a tone's does: filtering noise to
  // a band keeps only a share of it, less the narrower the band (`q`).
  function event(name, { time = ctx.currentTime, duration = .2, level = .02, frequency = 440, endFrequency = frequency, contour = null, pan = 0, attack = .02, hold = 0, q = null, wave = 'sine', tone = null, buffer = null, rate = 1 }) {
    time = Math.max(time, ctx.currentTime);
    const voice = pools[name]?.find(voice => voice.until <= time);
    if (!voice || !(level > 0) || !(duration > 0)) return false;
    const end = time + duration;
    voice.until = end + .03;
    voice.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), time);
    let source, pitch = voice.frequency;
    if (buffer) { source = ctx.createBufferSource(); source.buffer = buffers[buffer]; source.playbackRate.value = rate; pitch = null; }
    else if (voice.kind === 'noise') { source = ctx.createBufferSource(); source.buffer = buffers.pink; source.loop = true; }
    else {
      source = ctx.createOscillator(); controlRate(source.frequency);
      if (waves[wave]) source.setPeriodicWave(waves[wave]); else source.type = wave;
      pitch = source.frequency;
    }
    if (pitch) {
      pitch.cancelScheduledValues(time);
      const points = contour ?? [[0, frequency], [1, endFrequency]];
      pitch.setValueAtTime(Math.max(20, points[0][1]), time);
      for (const [at, value] of points.slice(1)) pitch.exponentialRampToValueAtTime(Math.max(20, value), time + at * duration);
    }
    voice.q?.setValueAtTime(q ?? .65, time);
    voice.tone?.setValueAtTime(tone ?? 3000, time);
    if (voice.kind === 'noise' && !buffer) level *= 3.8 * Math.sqrt((q ?? .65) / .65);
    const envelope = voice.envelope, peak = time + Math.min(attack, duration * .5);
    envelope.cancelScheduledValues(time);
    envelope.setValueAtTime(0, time);
    envelope.linearRampToValueAtTime(level, peak);
    if (hold > 0) envelope.setValueAtTime(level, Math.min(end - .01, peak + hold));
    envelope.exponentialRampToValueAtTime(.0001, end);
    envelope.setValueAtTime(0, end + .01);
    source.connect(voice.input);
    source.start(time, voice.kind === 'noise' && !buffer ? random() * 7 : 0); source.stop(end + .02);
    return true;
  }
  function silenceEvents() {
    const now = ctx.currentTime;
    for (const pool of Object.values(pools)) for (const voice of pool) {
      voice.envelope.cancelScheduledValues(now);
      voice.envelope.setTargetAtTime(0, now, .025);
      voice.envelope.setValueAtTime(0, now + .15);
      voice.until = now + .15;
    }
  }
  let disposed = false;
  return {
    master: master.gain, engineBank, engineLevel: engineLevel.gain, engineFilter: engineFilter.frequency, engineShelf: engineShelf.gain,
    compressor, backdrop: backdrop.gain, cabin: { engine: cabin.engine.frequency, world: cabin.world.frequency },
    buses: Object.fromEntries(Object.entries(buses).map(([name, node]) => [name, node.gain])),
    combustion, intake, boost, reverse, road, rough, roughPulse: roughPulse.gain, roughMod, wind, scrape,
    bed, air, rain, traffic, waves, layers, event, silenceEvents, random,
    setEngine(profile) { engineBank.setProfile(profile); },
    nodeCount: nodes.length + engineBank.nodeCount, sourceCount: sources.length + engineBank.sourceCount,
    dispose() {
      if (disposed) return; disposed = true; engineBank.dispose();
      for (const source of sources) source.stop();
      for (const node of nodes) node.disconnect();
    },
  };
}
