import test from 'node:test';
import assert from 'node:assert/strict';
import { DriveSoundModel, trafficSound } from '../src/audio/model.js';
import { ENGINES, engineFor, sanitizeMix, MIX_PRESETS } from '../src/audio/profiles.js';
import { createEngineBuffer, engineBandWeights } from '../src/audio/engine.js';
import { createTextureBuffer } from '../src/audio/textures.js';
import { SoundDirector } from '../src/audio/director.js';
import { createNoiseBuffer } from '../src/audio/synthesis.js';
import { DriveAudio } from '../src/audio.js';
import { DrivingController } from '../src/vehicle.js';

function settle(model, telemetry, seconds = 2, hz = 60) {
  let result;
  for (let i = 0; i < seconds * hz; i++) result = model.update(telemetry, 1 / hz);
  return result;
}

test('engine responds to load separately from speed and quiets down when coasting', () => {
  const model = new DriveSoundModel();
  const loaded = settle(model, { speed: 12, throttle: 1 });
  const coast = settle(model, { speed: 12 });
  assert.ok(loaded.engineLevel > coast.engineLevel * 1.5);
  assert.ok(loaded.engineCutoff > coast.engineCutoff * 1.5);
  assert.equal(loaded.roadLevel, coast.roadLevel);
  const stopped = settle(model, { speed: 0 });
  assert.ok(stopped.rpm < 825);
  assert.equal(stopped.roadLevel + stopped.roughLevel + stopped.windLevel, 0);
});

test('sound gears shift without hunting and reverse has its own bounded range', () => {
  const model = new DriveSoundModel();
  const first = settle(model, { speed: 7.4, throttle: 1 });
  const second = settle(model, { speed: 7.6, throttle: 1 });
  assert.equal(first.gear, 1); assert.equal(second.gear, 2);
  assert.ok(second.rpm < first.rpm - 400);
  for (let i = 0; i < 300; i++) assert.equal(model.update({ speed: i % 2 ? 7.4 : 7.6 }, 1 / 60).gear, 2);
  assert.equal(settle(model, { speed: 4.8 }).gear, 1);
  const reverse = settle(model, { speed: -7, throttle: 1 });
  assert.equal(reverse.gear, -1); assert.ok(reverse.rpm > 1800 && reverse.rpm < 2800);
});

test('surface texture blends in only when moving off road', () => {
  const model = new DriveSoundModel();
  const road = model.update({ speed: 14 });
  const shoulder = model.update({ speed: 14, offRoad: .5 });
  const rough = model.update({ speed: 14, offRoad: 1 });
  assert.equal(road.roughLevel, 0);
  assert.ok(rough.roughLevel > shoulder.roughLevel && shoulder.roughLevel > 0);
  assert.ok(rough.roadLevel < shoulder.roadLevel && shoulder.roadLevel < road.roadLevel);
  assert.equal(model.update({ speed: 0, offRoad: 1 }).roughLevel, 0);
});

test('audio model handles invalid telemetry and variable frame delivery', () => {
  for (const telemetry of [{}, { speed: NaN, throttle: Infinity }, { speed: -1000, offRoad: -1 }]) {
    for (const value of Object.values(new DriveSoundModel().update(telemetry, NaN))) assert.ok(Number.isFinite(value));
  }
  const low = settle(new DriveSoundModel(), { speed: 12, throttle: .5 }, 3, 30);
  const high = settle(new DriveSoundModel(), { speed: 12, throttle: .5 }, 3, 144);
  assert.ok(Math.abs(low.rpm - high.rpm) < 1);
  assert.ok(Math.abs(low.load - high.load) < .001);
});

test('vehicle reports keyboard, reverse, analog, touch and reset effort', () => {
  const car = new DrivingController();
  car.update(1 / 60, { forward: .4 });
  assert.equal(car.audioTelemetry.throttle, .4);
  car.speed = 10; car.update(1 / 60, { brake: .7 });
  assert.equal(car.audioTelemetry.brake, .7); assert.equal(car.audioTelemetry.throttle, 0);
  car.speed = -3; car.update(1 / 60, { brake: .6 });
  assert.equal(car.audioTelemetry.throttle, .6); assert.equal(car.audioTelemetry.brake, 0);
  car.update(1 / 60, { forward: 1, handbrake: true });
  assert.equal(car.audioTelemetry.throttle, 0); assert.equal(car.audioTelemetry.brake, 1);
  car.reset();
  assert.equal(car.audioTelemetry.speed + car.audioTelemetry.throttle + car.audioTelemetry.brake, 0);
  car.update(1 / 60, { touchDrive: { amount: .5, heading: car.heading, along: 1, across: 0 } });
  assert.ok(car.audioTelemetry.throttle > .9);
  car.update(1 / 60, { touchDrive: { amount: 0 } });
  assert.ok(car.audioTelemetry.brake > 0);
});

test('stereo noise is deterministic, decorrelated and has a continuous loop join', () => {
  const context = {
    sampleRate: 8000,
    createBuffer(channels, length) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { getChannelData: i => data[i] };
    },
  };
  const a = createNoiseBuffer(context), b = createNoiseBuffer(context);
  const left = a.getChannelData(0), right = a.getChannelData(1);
  assert.deepEqual(left, b.getChannelData(0));
  let ll = 0, rr = 0, lr = 0, steps = 0;
  for (let i = 1; i < left.length; i++) {
    ll += left[i] ** 2; rr += right[i] ** 2; lr += left[i] * right[i];
    steps += (left[i] - left[i - 1]) ** 2;
  }
  assert.ok(Math.abs(lr / Math.sqrt(ll * rr)) < .15);
  assert.ok(Math.abs(left[0] - left.at(-1)) < 4 * Math.sqrt(steps / left.length));
});

test('unsupported audio fails cleanly and leaves sound disabled', async () => {
  const original = globalThis.window;
  globalThis.window = {};
  try {
    const audio = new DriveAudio();
    await assert.rejects(audio.toggle(), /unavailable/);
    assert.equal(audio.enabled, false); assert.equal(audio.context, null);
    await audio.dispose(); await audio.dispose();
  } finally { if (original === undefined) delete globalThis.window; else globalThis.window = original; }
});

test('engine personalities cover the garage and Formula retains its full rev range', () => {
  assert.equal(engineFor('auto', 'snow'), ENGINES.snow);
  assert.equal(engineFor('pickup', 'snow'), ENGINES.pickup);
  assert.equal(engineFor('unknown'), ENGINES.coast);
  const model = new DriveSoundModel(); model.setProfile(ENGINES.formula);
  const fast = settle(model, { speed: 50, throttle: 1 }, 5);
  assert.equal(fast.gear, 6); assert.ok(fast.rpm > 10000 && fast.rpm <= 12500);
  assert.ok(settle(model, { speed: 0 }).rpm < 1810);
});

test('tire scrub and reverse whine follow motion and road contact', () => {
  const model = new DriveSoundModel();
  assert.equal(model.update({ speed: 0, steer: 1, brake: 1, handbrake: 1 }).skidLevel, 0);
  assert.equal(model.update({ speed: 20 }).skidLevel, 0);
  const tarmac = model.update({ speed: 20, steer: 1, handbrake: 1 });
  const gravel = model.update({ speed: 20, steer: 1, handbrake: 1, offRoad: 1 });
  assert.ok(tarmac.skidLevel > gravel.skidLevel * 4);
  assert.ok(model.update({ speed: -5 }).reverseLevel > 0);
  assert.equal(model.update({ speed: 5 }).reverseLevel, 0);
});

test('passing traffic pans with the listener, fades with distance, and changes pitch at the pass', () => {
  const player = { groundedPosition: { x: 0, z: 0 }, heading: 0, speed: 15 };
  const car = { position: { x: -5, z: -20 }, heading: Math.PI, speed: 20 };
  const approaching = trafficSound(player, car);
  assert.ok(approaching.pan < 0 && approaching.doppler > 1 && approaching.level > 0);
  assert.ok(trafficSound(player, car, Math.PI).pan > 0);
  car.position.z = 20;
  assert.ok(trafficSound(player, car).doppler < 1);
  car.position.z = 100;
  assert.equal(trafficSound(player, car).level, 0);
});

test('mix storage rejects invalid values and clamps valid numeric volumes', () => {
  assert.deepEqual(sanitizeMix(null), MIX_PRESETS.balanced);
  const mix = sanitizeMix({ master: Infinity, engine: -4, road: 8, music: '1', night: 'false' });
  assert.equal(mix.master, MIX_PRESETS.balanced.master);
  assert.equal(mix.engine, 0); assert.equal(mix.road, 1); assert.equal(mix.music, 0); assert.equal(mix.night, false);
});

const bufferContext = { sampleRate: 12000, createBuffer(channels, length) {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return { getChannelData: i => data[i] };
} };
function signalStats(data) {
  let energy = 0, steps = 0, peak = 0, mean = 0;
  for (let i = 1; i < data.length; i++) { energy += data[i] ** 2; steps += (data[i] - data[i - 1]) ** 2; peak = Math.max(peak, Math.abs(data[i])); mean += data[i]; }
  return { rms: Math.sqrt(energy / data.length), step: Math.sqrt(steps / data.length), peak, mean: mean / data.length };
}
test('combustion takes are deterministic, centered, matched in level, and distinct under load', () => {
  for (const profile of [ENGINES.coast, ENGINES.pickup, ENGINES.formula]) {
    const coast = createEngineBuffer(bufferContext, profile, profile.idle, false).getChannelData(0);
    const load = createEngineBuffer(bufferContext, profile, profile.idle, true).getChannelData(0);
    assert.deepEqual(coast, createEngineBuffer(bufferContext, profile, profile.idle, false).getChannelData(0));
    assert.notDeepEqual(coast, load);
    for (const data of [coast, load]) {
      const stats = signalStats(data);
      assert.ok(stats.rms > .19 && stats.rms < .21);
      assert.ok(Math.abs(stats.mean) < .01);
      assert.ok(stats.peak < 1);
      assert.ok(Math.abs(data[0] - data.at(-1)) < stats.step * 5, 'no seam impulse');
    }
  }
});

test('RPM band crossfades preserve energy and stay continuous across band boundaries', () => {
  const refs = [820, 2200, 3800];
  let previous = engineBandWeights(400, refs);
  for (let rpm = 401; rpm < 7000; rpm++) {
    const weights = engineBandWeights(rpm, refs);
    assert.ok(Math.abs(weights.reduce((sum, value) => sum + value * value, 0) - 1) < 1e-10);
    assert.ok(weights.every((value, i) => Math.abs(value - previous[i]) < .004));
    previous = weights;
  }
});

test('contact, wind and rain textures have different spectra and smooth stereo loops', () => {
  const brightness = [];
  for (const kind of ['road', 'wind', 'rain']) {
    const buffer = createTextureBuffer(bufferContext, kind);
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1), stats = signalStats(left);
    assert.notDeepEqual(left, right);
    assert.ok(stats.peak < 1 && stats.rms > .01);
    assert.ok(Math.abs(left[0] - left.at(-1)) < stats.step * 5);
    brightness.push(stats.step / stats.rms);
  }
  assert.ok(brightness[1] < brightness[0] && brightness[0] < brightness[2]);
});

test('director skips silent layers and avoids a note backlog after interruption', () => {
  const director = new SoundDirector(), events = [];
  const audio = { journey: 'coast', mix: { ambience: 0, music: 0 }, graph: { pads: [], event: (...args) => events.push(args) } };
  director.update(audio, { motion: 1 }, 100);
  assert.deepEqual(events, []);
  audio.mix.music = .5; director.update(audio, { motion: 1 }, 200);
  assert.equal(events.length, 1); assert.equal(events[0][1].time, 200);
  director.update(audio, { motion: 1 }, 10000);
  assert.ok(events.length <= 2, 'never catches up missed beats');
});
