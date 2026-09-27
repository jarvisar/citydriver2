import test from 'node:test';
import assert from 'node:assert/strict';
import { DriveSoundModel, cityAmbience, gearRatios, trafficSound, trafficVoice } from '../src/audio/model.js';
import { ENGINES, engineFor, sanitizeMix, MIX_PRESETS } from '../src/audio/profiles.js';
import { cueFrequency, cueNotes } from '../src/audio/cues.js';
import { createEngineBuffer, engineBandWeights } from '../src/audio/engine.js';
import { createTextureBuffer } from '../src/audio/textures.js';
import { SoundDirector } from '../src/audio/director.js';
import { createNoiseBuffer } from '../src/audio/synthesis.js';
import { DriveAudio } from '../src/audio.js';
import { DrivingController } from '../src/vehicle.js';
import { CAR_IDS, carStats } from '../src/cars.js';
import { CITY, citySoundscape } from '../src/world/city.js';

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
  assert.ok(stopped.rpm < model.profile.idle + 5);
  assert.equal(stopped.roadLevel + stopped.roughLevel + stopped.windLevel, 0);
});

test('every car holds its top speed in top gear below the redline, whatever its speed', () => {
  for (const id of CAR_IDS) {
    const profile = engineFor(id), { cruise } = carStats(id), model = new DriveSoundModel();
    model.setProfile(profile, cruise);
    const top = settle(model, { speed: cruise, throttle: 1 }, 4);
    assert.equal(top.gear, profile.gears, id);
    assert.ok(top.rpm > profile.redline * .7 && top.rpm < profile.redline * .9, `${id}: ${top.rpm.toFixed(0)} rpm`);
    const ratios = gearRatios(profile, cruise);
    assert.ok(ratios.every((ratio, i) => i === 0 || ratio < ratios[i - 1]));
  }
  assert.ok(carStats('formula').cruise < 80 && carStats('formula').cruise > 78, 'the Formula tops out where the air stops it');
});

test('the sound gearbox changes up later under full throttle, kicks down, and never hunts', () => {
  const firstShift = throttle => {
    const model = new DriveSoundModel(); model.setProfile(ENGINES.taxi, 40);
    for (let t = 0; t < 8; t += 1 / 60) if (model.update({ speed: t * 4, throttle }, 1 / 60).gear > 1) return t * 4;
    return Infinity;
  };
  assert.ok(firstShift(1) > firstShift(.3) * 1.5, 'a gentle pull changes up early');
  const model = new DriveSoundModel(); model.setProfile(ENGINES.taxi, 40);
  const cruising = settle(model, { speed: 20, throttle: .2 }, 3);
  const floored = settle(model, { speed: 20, throttle: 1 }, 1);
  assert.ok(floored.gear < cruising.gear && floored.rpm > cruising.rpm * 1.3, 'flooring it kicks down');
  // Wavering round a shift point, at any pedal, changes gear at most once
  for (const throttle of [0, .3, 1]) {
    const hunting = new DriveSoundModel(); hunting.setProfile(ENGINES.taxi, 40);
    let shifts = 0, gear = null;
    for (let speed = 0; speed < 40; speed += .05) {
      gear = hunting.update({ speed, throttle }, 1 / 60).gear;
      if (hunting.update({ speed, throttle }, 1 / 60).gear !== gear) shifts++;
    }
    const start = hunting.update({ speed: 20, throttle }, 1 / 60).gear;
    for (let i = 0; i < 600; i++) if (hunting.update({ speed: 20 + (i % 20 < 10 ? .4 : -.4), throttle }, 1 / 60).gear !== start) shifts += 100;
    assert.ok(shifts < 100, `throttle ${throttle} hunts`);
  }
});

test('standing on the gas revs before the car moves, and reverse has its own bounded range', () => {
  const model = new DriveSoundModel(); model.setProfile(ENGINES.taxi, 40);
  const { idle, redline } = ENGINES.taxi;
  const launch = settle(model, { speed: 0, throttle: 1 }, 1);
  assert.ok(launch.rpm > idle + (redline - idle) * .3 && launch.rpm < redline * .5);
  assert.ok(settle(model, { speed: 0 }, 1).rpm < idle + 5);
  const reverse = settle(model, { speed: -7, throttle: 1 });
  assert.equal(reverse.gear, -1); assert.ok(reverse.rpm > idle * 2 && reverse.rpm < redline);
});

test('snapping the throttle shut from high revs crackles once; a gentle lift does not', () => {
  const model = new DriveSoundModel(); model.setProfile(ENGINES.sports, 33);
  settle(model, { speed: 18, throttle: 1 }, 2);
  const before = model.liftSerial;
  settle(model, { speed: 18 }, 1);
  assert.equal(model.liftSerial, before + 1);
  settle(model, { speed: 18, throttle: .3 }, 2); settle(model, { speed: 18 }, 1);
  assert.equal(model.liftSerial, before + 1);
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
  car.update(1 / 60, { forward: 1, boost: true });
  assert.equal(car.audioTelemetry.boost, 1);
  car.update(1 / 60, { forward: 1 });
  assert.equal(car.audioTelemetry.boost, 0);
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
  assert.equal(engineFor('auto'), ENGINES.city);
  assert.equal(engineFor('taxi'), ENGINES.taxi);
  assert.equal(engineFor('taxiGT'), ENGINES.sports);
  assert.equal(engineFor('pickup'), ENGINES.pickup);
  assert.equal(engineFor('unknown'), ENGINES.city);
  for (const id of CAR_IDS) assert.ok(id === 'auto' || id.startsWith('taxi') || engineFor(id) === ENGINES[id], id);
  const model = new DriveSoundModel(); model.setProfile(ENGINES.formula, carStats('formula').cruise);
  const fast = settle(model, { speed: 50, throttle: 1 }, 5);
  assert.ok(fast.rpm > 9000 && fast.rpm <= 12500);
  assert.ok(settle(model, { speed: 0 }).rpm < 1810);
});

test('reverse whine follows reversing', () => {
  const model = new DriveSoundModel();
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

test('a traffic car idles quieter than it drives, a van is deeper, and a far one is duller', () => {
  const player = { groundedPosition: { x: 0, z: 0 }, heading: 0, speed: 0 };
  const at = (z, speed, name = 'sedan') => { const car = { position: { x: 3, z }, heading: 0, speed, index: 0, spec: { name } }; return trafficVoice(car, trafficSound(player, car)); };
  const idle = at(-12, 0), moving = at(-12, 14);
  assert.ok(idle.engine < moving.engine * .5 && idle.tyres === 0 && moving.tyres > 0);
  assert.ok(at(-12, 8, 'van').pitch < at(-12, 8, 'hatchback').pitch);
  assert.ok(at(-70, 14).hiss < moving.hiss);
});

test('the city sounds busier downtown, thinner in the parks and at night, and wetter in the rain', () => {
  const downtown = cityAmbience({ urban: 1 }, {}, 10), garden = cityAmbience({ urban: .3, green: 1 }, {}, 10);
  assert.ok(downtown.hum > garden.hum * 1.5 && downtown.humFrequency > garden.humFrequency);
  assert.ok(cityAmbience({ urban: 1 }, { night: 1 }, 10).hum < downtown.hum * .7);
  assert.equal(cityAmbience({}, { rain: 0 }, 10).rain, 0);
  assert.equal(cityAmbience({}, { rain: 1 }, 10).rain, cityAmbience({}, { rain: .5 }, 10).rain * 2);
  assert.ok(cityAmbience({}, { rain: 1, cabin: true }, 10).rainFrequency < cityAmbience({}, { rain: 1 }, 10).rainFrequency);
  assert.ok(cityAmbience({ green: 1 }, { snow: 1 }, 10).air < cityAmbience({ green: 1 }, {}, 10).air * .5);
  for (const value of Object.values(cityAmbience({ urban: NaN }, { rain: Infinity }, NaN))) assert.ok(Number.isFinite(value));
});

// A minute of the director at 30 Hz somewhere, returning the events it asked for
function listen(place, scene = {}, seconds = 60) {
  const events = [], director = new SoundDirector();
  const audio = { place, mix: { ambience: 1 }, graph: { event: (pool, options) => { events.push({ pool, ...options }); return true; } } };
  for (let t = 0; t < seconds; t += 1 / 30) director.update(audio, { motion: 0 }, t, scene);
  return events;
}
test('the director places the city\'s life by where the car is and the hour', () => {
  const park = listen({ urban: .3, green: 1 }), harbour = listen({ urban: .4, water: 1, sea: 1 }), downtown = listen({ urban: 1 });
  const birdsong = events => events.filter(e => e.pool === 'ambience' && !e.wave && !e.buffer && e.contour?.[0][1] > 2000);
  assert.ok(birdsong(park).length > 10 && birdsong(downtown).length === 0);
  assert.ok(harbour.some(e => e.wave === 'gull') && harbour.some(e => e.pool === 'water') && !park.some(e => e.pool === 'water'));
  assert.ok(downtown.some(e => e.pool === 'horn') && !park.some(e => e.pool === 'horn'));
  const night = listen({ urban: .3, green: 1 }, { night: 1 });
  assert.ok(night.filter(e => e.buffer === 'cricket').length > 100 && birdsong(night).length === 0);
  assert.equal(listen({ urban: .3, green: 1 }, { night: 1, rain: .5 }).filter(e => e.buffer === 'cricket').length, 0);
  // Dry weather has no gusts, drips or thunder
  assert.ok(![...park, ...harbour, ...downtown].some(e => e.pool === 'weather' || (e.pool === 'ambience' && e.frequency !== undefined)));
});

test('game cues stay in the city\'s key, short and quiet', () => {
  const scale = [0, 2, 4, 5, 7, 9, 11].map(step => (53 + step) % 12);
  for (const kind of ['pickup', 'dropoff', 'paid', 'missed', 'tip', 'tick', 'goal', 'discovery']) {
    const notes = cueNotes(kind, { rating: 'speedy', combo: 3, urgent: true });
    assert.ok(notes.length > 0, kind);
    for (const note of notes) {
      assert.ok(scale.includes((53 + 24 + note.step) % 12), `${kind} is out of key`);
      assert.ok(note.at + note.length < 1 && note.level <= .06 && cueFrequency(note.step) < 6000, kind);
    }
  }
  assert.deepEqual(cueNotes('crash'), []);
  assert.ok(cueNotes('tip', { combo: 5 })[0].step > cueNotes('tip', { combo: 1 })[0].step, 'a combo climbs');
});

// A stand-in for the parts of a Web Audio graph DriveAudio touches
function stubAudio() {
  const param = () => ({ value: 0, cancelScheduledValues() {}, setTargetAtTime(value) { this.value = value; }, setValueAtTime(value) { this.value = value; } });
  const node = () => ({ links: 0, connect() { this.links++; }, disconnect() { this.links--; } });
  const audio = new DriveAudio(), events = [];
  audio.enabled = true; audio.context = { currentTime: 0, state: 'running' };
  const source = node(), level = node(), layer = { level: param(), links: [[source, level]], open: false, closeAt: Infinity };
  audio.graph = { layers: [layer], event: (pool, options) => { events.push({ pool, ...options }); return true; }, random: () => .5 };
  return { audio, layer, source, events };
}
test('a silent layer is unhooked from its source once it has faded, and hooked back when heard', () => {
  const { audio, layer, source } = stubAudio();
  audio.layer(layer, .02); assert.equal(source.links, 1); assert.equal(layer.level.value, .02);
  audio.layer(layer, .03); assert.equal(source.links, 1, 'connected once');
  audio.layer(layer, 0, .1); audio.sweep(.5); assert.equal(source.links, 1, 'still fading');
  audio.context.currentTime = 1; audio.sweep(1); assert.equal(source.links, 0); assert.equal(layer.open, false);
  audio.layer(layer, 0); audio.sweep(2); assert.equal(source.links, 0);
  audio.layer(layer, .01); assert.equal(source.links, 1);
});

test('a driver the player hits honks once, and one held up honks after a few seconds', () => {
  const { audio, events } = stubAudio();
  const player = { groundedPosition: { x: 0, z: 0 }, heading: 0, speed: 0 };
  const car = { index: 2, position: { x: 0, z: -8 }, heading: 0, speed: 0, bumped: 0, held: 0 };
  audio.horn(car, player, {}, 0); assert.equal(events.length, 0);
  car.bumped = .5; audio.horn(car, player, {}, 1); audio.horn(car, player, {}, 1.1);
  assert.equal(events.length, 1); assert.equal(events[0].pool, 'horn'); assert.ok(events[0].level > .05 && events[0].time > 1);
  car.bumped = 0; car.held = 2; audio.horn(car, player, {}, 3); assert.equal(events.length, 1);
  car.held = 4; audio.horn(car, player, {}, 12); assert.equal(events.length, 3, 'two short blasts');
  audio.horn(car, player, {}, 13); assert.equal(events.length, 3, 'not again at once');
});

test('the soundscape knows the parks, the harbour and downtown', () => {
  const downtown = citySoundscape(CITY.downtown.s, CITY.downtown.u);
  assert.ok(downtown.urban > .5);
  // The greenest park middle there is
  const middles = CITY.parkPlans.filter(plan => !plan.square && plan.lawn.length > 2).map(plan => plan.lawn.reduce((sum, p) => ({ x: sum.x + p.x / plan.lawn.length, y: sum.y + p.y / plan.lawn.length }), { x: 0, y: 0 }));
  const green = middles.filter(c => CITY.pavement.find(c.x, c.y)?.kind === 'park').map(c => citySoundscape(c.y, c.x)).reduce((best, s) => s.green > best.green ? s : best, { green: 0, urban: 1 });
  assert.ok(green.green > .3 && green.urban < downtown.urban, JSON.stringify(green));
  // A point on the ring road's promenade looks out to sea
  const ring = CITY.roads.find(road => road.kind === 'ring' || road.kind === 'coast');
  const sea = ring.points.map(p => citySoundscape(p.y, p.x)).reduce((best, s) => s.sea > best.sea ? s : best);
  assert.ok(sea.sea > .2 && sea.water >= sea.sea);
  for (const value of Object.values(sea)) assert.ok(value >= 0 && value <= 1);
});

test('mix storage rejects invalid values and clamps valid numeric volumes', () => {
  assert.deepEqual(sanitizeMix(null), MIX_PRESETS.balanced);
  const mix = sanitizeMix({ master: Infinity, engine: -4, road: 8, cues: '1', night: 'false' });
  assert.equal(mix.master, MIX_PRESETS.balanced.master);
  assert.equal(mix.engine, 0); assert.equal(mix.road, 1); assert.equal(mix.cues, MIX_PRESETS.balanced.cues); assert.equal(mix.night, false);
  assert.equal('music' in sanitizeMix({ music: .5 }), false, 'a mix saved with music drops it');
  assert.equal(sanitizeMix({ master: .5 }).cues, MIX_PRESETS.balanced.cues, 'a mix saved before cues gets the default');
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

test('director is silent with the environment off and never catches up a backlog', () => {
  const director = new SoundDirector(), events = [], scene = { night: 1 };
  const audio = { place: { green: 1, water: 1, sea: 1 }, mix: { ambience: 0 }, graph: { event: (...args) => events.push(args) } };
  for (let t = 0; t < 60; t += 1 / 30) director.update(audio, { motion: 0 }, t, scene);
  assert.deepEqual(events, []);
  audio.mix.ambience = 1; director.update(audio, { motion: 0 }, 200, scene);
  const before = events.length;
  director.update(audio, { motion: 0 }, 10000, scene);
  assert.ok(events.length - before <= 5, 'a suspended tab does not bring back every missed chirp');
});
