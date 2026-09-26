import { ENGINES } from './profiles.js';
import { createEngineBank } from './engine.js';
import { createTextureBuffer } from './textures.js';

// Stereo pink noise with a seamless join: the noise layers' default buffer.
export function createNoiseBuffer(ctx, seed = 0x71ca9) {
  const length = Math.ceil(ctx.sampleRate * 12), overlap = Math.ceil(ctx.sampleRate * .15);
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

export function createSoundGraph(ctx) {
  const nodes = [], sources = [];
  const keep = node => { nodes.push(node); return node; };
  const gain = (value, destination) => {
    const node = keep(ctx.createGain()); node.gain.value = value;
    node.connect(destination); return node;
  };
  const filter = (type, frequency, destination, q = .65) => {
    const node = keep(ctx.createBiquadFilter()); node.type = type; node.frequency.value = frequency; node.Q.value = q;
    node.connect(destination); return node;
  };
  const oscillator = (frequency, destination, type = 'sine') => {
    const node = keep(ctx.createOscillator()); node.frequency.value = frequency;
    node.type = type;
    node.connect(destination); node.start(); sources.push(node); return node;
  };
  const master = gain(0, ctx.destination);
  const compressor = keep(ctx.createDynamicsCompressor());
  compressor.threshold.value = -14; compressor.knee.value = 12; compressor.ratio.value = 3;
  compressor.attack.value = .006; compressor.release.value = .24; compressor.connect(master);
  const highpass = filter('highpass', 28, compressor, .7);
  const bus = filter('lowpass', 7200, highpass);
  const buses = {}, perspective = {};
  for (const name of ['engine', 'road', 'ambience', 'traffic', 'music']) {
    perspective[name] = filter('lowpass', 14000, bus);
    buses[name] = gain(0, perspective[name]);
  }
  const pink = createNoiseBuffer(ctx);
  const contactNoise = createTextureBuffer(ctx, 'road'), windNoise = createTextureBuffer(ctx, 'wind'), rainNoise = createTextureBuffer(ctx, 'rain');
  const noiseLayer = (type, frequency, low, offset, rate = 1, destination = buses.road, q = .65, buffer = pink) => {
    const level = gain(0, destination);
    const shape = filter(type, frequency, level, q);
    const cut = filter('highpass', low, shape);
    const source = keep(ctx.createBufferSource()); source.buffer = buffer; source.loop = true; source.playbackRate.value = rate;
    source.connect(cut); source.start(0, offset); sources.push(source);
    return { level: level.gain, frequency: shape.frequency, rate: source.playbackRate };
  };
  const engineLevel = gain(0, buses.engine);
  const engineFilter = filter('lowpass', 420, engineLevel);
  const engineBank = createEngineBank(ctx, engineFilter);
  engineBank.setProfile(ENGINES.coast);
  // Distant traffic uses a cheaper harmonic voice; the player's engine uses
  // combustion textures with separate RPM and load blends.
  const waves = new Map(Object.values(ENGINES).map(profile => {
    const harmonics = new Float32Array([0, ...profile.harmonics]);
    return [profile, ctx.createPeriodicWave(new Float32Array(harmonics.length), harmonics)];
  }));
  const bodyLevel = gain(.018, buses.engine);
  const body = oscillator(820 / 60, bodyLevel);
  const combustion = noiseLayer('bandpass', 550, 150, 1.7, 1, buses.engine);
  const intake = noiseLayer('bandpass', 1400, 480, 4.4, 1, buses.engine);
  const reverseLevel = gain(0, buses.engine);
  const reverse = oscillator(260, reverseLevel, 'triangle');
  const road = noiseLayer('lowpass', 1100, 90, 3.1, 1, buses.road, .65, contactNoise);
  const rough = noiseLayer('bandpass', 1000, 110, 5.6, .74, buses.road, .8, contactNoise);
  const roughPulse = gain(0, rough.level);
  const roughMod = oscillator(17, roughPulse);
  const wind = noiseLayer('lowpass', 1500, 100, 4.3, 1, buses.road, .65, windNoise);
  const skid = noiseLayer('bandpass', 1100, 650, 2.3, 1, buses.road, 3);
  // Metal grinding along a wall or another car
  const scrape = noiseLayer('bandpass', 1500, 380, 7.7, 1, buses.road, 1.6, contactNoise);
  const skidToneLevel = gain(0, buses.road);
  const skidTone = oscillator(1050, skidToneLevel);
  const bed = noiseLayer('lowpass', 440, 65, 0, .83, buses.ambience, .65, windNoise);
  const air = noiseLayer('bandpass', 2300, 600, 6.9, .91, buses.ambience, .65, rainNoise);
  const rain = noiseLayer('lowpass', 4700, 350, 1.2, 1, buses.ambience, .65, rainNoise);
  const insects = noiseLayer('bandpass', 4200, 2800, 6.1, 1.1, buses.ambience, 5);
  const insectPulse = gain(0, insects.level);
  const insectMod = oscillator(31, insectPulse);

  const traffic = Array.from({ length: 4 }, (_, index) => {
    const pan = keep(ctx.createStereoPanner()); pan.connect(buses.traffic);
    const level = gain(0, pan);
    const toneLevel = gain(.11, level);
    const tone = oscillator(75 + index * 9, toneLevel);
    tone.setPeriodicWave(waves.get(ENGINES.sedan));
    const wash = noiseLayer('bandpass', 900, 150, index * 2.6, 1, level);
    wash.level.value = .2;
    return { level: level.gain, pan: pan.pan, tone: tone.frequency, wash: wash.frequency, rate: wash.rate };
  });

  // Fixed voice pools: a long session never accumulates oscillators, buffers,
  // onended callbacks or timers. Busy voices are skipped, never cut mid-note.
  const pools = {};
  for (const [name, count, noisy] of [['ambience', 5, false], ['engine', 2, true], ['road', 2, true], ['weather', 2, true], ['music', 6, false]]) {
    pools[name] = Array.from({ length: count }, (_, index) => {
      const pan = keep(ctx.createStereoPanner()); pan.connect(buses[name === 'weather' ? 'ambience' : name]);
      const envelope = gain(0, pan);
      let frequency;
      if (noisy) {
        const noise = noiseLayer('bandpass', 500, 70, index * 3.7, 1, envelope);
        noise.level.value = 1; frequency = noise.frequency;
      } else {
        frequency = oscillator(440, envelope, name === 'music' ? 'triangle' : 'sine').frequency;
      }
      return { envelope: envelope.gain, pan: pan.pan, frequency, until: 0 };
    });
  }
  const pads = Array.from({ length: 3 }, (_, index) => {
    const pan = keep(ctx.createStereoPanner()); pan.pan.value = (index - 1) * .45; pan.connect(buses.music);
    const level = gain(0, pan);
    const low = filter('lowpass', 850, level);
    const tone = oscillator(220, low, 'triangle'); tone.detune.value = (index - 1) * 4;
    return { level: level.gain, frequency: tone.frequency };
  });
  function event(name, { time = ctx.currentTime, duration = .2, level = .02, frequency = 440, endFrequency = frequency, pan = 0, attack = .02 }) {
    const voice = pools[name]?.find(voice => voice.until <= time);
    if (!voice) return false;
    voice.until = time + duration + .025;
    voice.pan.setValueAtTime(pan, time);
    voice.frequency.cancelScheduledValues(time);
    voice.frequency.setValueAtTime(frequency, time);
    voice.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), time + duration);
    voice.envelope.cancelScheduledValues(time);
    voice.envelope.setValueAtTime(0, time);
    voice.envelope.linearRampToValueAtTime(level, time + Math.min(attack, duration * .3));
    voice.envelope.exponentialRampToValueAtTime(.00001, time + duration);
    voice.envelope.setValueAtTime(0, voice.until);
    return true;
  }
  function silenceEvents() {
    const now = ctx.currentTime;
    for (const pool of Object.values(pools)) for (const voice of pool) {
      voice.envelope.cancelScheduledValues(now);
      voice.envelope.setTargetAtTime(0, now, .025);
      voice.frequency.cancelScheduledValues(now);
      voice.until = now + .15;
    }
  }
  let disposed = false;
  return {
    master: master.gain, engineBank, engineLevel: engineLevel.gain, engineFilter: engineFilter.frequency,
    compressor, buses: Object.fromEntries(Object.entries(buses).map(([name, node]) => [name, node.gain])),
    perspective: Object.fromEntries(Object.entries(perspective).map(([name, node]) => [name, node.frequency])),
    body, bodyLevel: bodyLevel.gain, combustion, intake, reverse, reverseLevel: reverseLevel.gain,
    road, rough, roughPulse: roughPulse.gain, roughMod, wind, skid, skidTone, skidToneLevel: skidToneLevel.gain, scrape,
    bed, air, rain, insects, insectPulse: insectPulse.gain, insectMod, traffic, pads, event, silenceEvents,
    setEngine(profile) { engineBank.setProfile(profile); },
    nodeCount: nodes.length + engineBank.nodeCount, sourceCount: sources.length + engineBank.sourceCount,
    dispose() { if (disposed) return; disposed = true; engineBank.dispose(); for (const source of sources) source.stop(); for (const node of nodes) node.disconnect(); },
  };
}
