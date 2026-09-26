import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CityWeather, sampleCityWeather, weatherLightning, WEATHER_CYCLE, WEATHER_INTERVAL, WEATHER_PRESETS } from '../src/world/city-weather.js';
import { DriveAudio } from '../src/audio.js';
import { SoundDirector } from '../src/audio/director.js';

test('new cities default to automatic weather, starting in golden hour before cycling', () => {
  const weather = new CityWeather(new THREE.Scene());
  assert.equal(weather.mode, 'auto');
  assert.equal(weather.state.label, 'Golden hour');
  weather.update(WEATHER_INTERVAL);
  assert.equal(weather.state.id, WEATHER_CYCLE[1]);
  weather.update(WEATHER_INTERVAL * (WEATHER_CYCLE.length - 1));
  assert.equal(weather.state.id, 'night');
  weather.update(WEATHER_INTERVAL * WEATHER_CYCLE.length);
  assert.equal(weather.state.id, 'sunset');
  weather.dispose();
});

test('an explicitly selected golden hour stays fixed', () => {
  const weather = new CityWeather(new THREE.Scene(), { mode: 'sunset' });
  weather.update(WEATHER_INTERVAL * 12);
  assert.equal(weather.state.id, 'sunset');
  weather.dispose();
});

test('automatic weather covers every condition, repeats, and stays continuous at phase boundaries', () => {
  // Street lamps and headlights are on only at night and in a thunderstorm.
  for (const id of Object.keys(WEATHER_PRESETS)) {
    const level = sampleCityWeather(0, id).lightLevel;
    if (id === 'night' || id === 'storm') assert.ok(level >= .8, `${id} turns the lights on`);
    else assert.equal(level, 0, `${id} is daylight`);
  }
  const period = WEATHER_CYCLE.length * WEATHER_INTERVAL;
  assert.equal(WEATHER_CYCLE[0], 'sunset');
  assert.equal(WEATHER_CYCLE.at(-1), 'night');
  assert.deepEqual(WEATHER_CYCLE.slice(1, -1).sort(), ['clear', 'clear', 'overcast', 'rain', 'snow', 'storm']);
  assert.deepEqual(new Set(WEATHER_CYCLE), new Set(Object.keys(WEATHER_PRESETS)));
  for (let phase = 0; phase < WEATHER_CYCLE.length; phase++) {
    const start = phase * WEATHER_INTERVAL;
    assert.equal(sampleCityWeather(start).id, WEATHER_CYCLE[phase]);
    assert.deepEqual(sampleCityWeather(start + 11), sampleCityWeather(start + 11 + period));
    const before = sampleCityWeather(start + WEATHER_INTERVAL - .001);
    const after = sampleCityWeather(start + WEATHER_INTERVAL + .001);
    for (const field of ['rain', 'snow', 'wetness', 'lightLevel', 'exposure', 'fogNear', 'sunY']) {
      assert.ok(Math.abs(before[field] - after[field]) < .00001, `${field} jumps between weather phases`);
    }
    for (const channel of ['r', 'g', 'b']) assert.ok(Math.abs(before.background[channel] - after.background[channel]) < .00001);
  }
});

test('the clock makes weather independent of frame delivery and leaves paused rain still', () => {
  const first = new CityWeather(new THREE.Scene(), { mode: 'auto' });
  const second = new CityWeather(new THREE.Scene(), { mode: 'auto' });
  const car = { u: 500, s: -320, car: { position: { y: 24 } } };
  const rainTime = WEATHER_INTERVAL * WEATHER_CYCLE.indexOf('rain');
  for (let tick = 0; tick <= rainTime * 2; tick++) first.update(tick / 2, car, -1024);
  second.update(rainTime, car, -1024);
  assert.deepEqual(first.state, second.state);
  assert.ok(first.state.rain > 0);
  const drops = first.rainfall.geometry.attributes.position.array.slice();
  const sky = first.state.background.clone();
  first.update(rainTime, car, -1024);
  assert.deepEqual(first.rainfall.geometry.attributes.position.array, drops);
  assert.deepEqual(first.state.background, sky);
  first.dispose(); second.dispose();
});

test('rain follows east and west movement, bridges, and the rebased north-south origin', () => {
  const scene = new THREE.Scene();
  const weather = new CityWeather(scene, { mode: 'rain' });
  for (const u of [-5000, 0, 8400]) {
    weather.update(10, { u, s: 3180, car: { position: { y: 39 } } }, 3072);
    assert.deepEqual(weather.rainfall.points.position.toArray(), [u, 94, -108]);
    const points = weather.rainfall.geometry.attributes.position;
    for (let i = 0; i < points.count; i++) {
      assert.ok(Math.abs(points.getX(i)) <= 150);
      assert.ok(Math.abs(points.getY(i)) <= 100);
      assert.ok(Math.abs(points.getZ(i)) <= 180);
    }
  }
  let disposed = false;
  weather.rainfall.geometry.addEventListener('dispose', () => { disposed = true; });
  weather.dispose();
  assert.equal(scene.children.length, 0); assert.equal(disposed, true);
});

test('snow crossfades, stays still when paused, and does no particle work when inactive', () => {
  const weather = new CityWeather(new THREE.Scene(), { mode: 'clear' });
  weather.update(10);
  const positions = weather.snowfall.geometry.attributes.position;
  const dormantVersion = positions.version;
  weather.update(11);
  assert.equal(positions.version, dormantVersion);
  assert.equal(weather.snowfall.points.visible, false);
  weather.setMode('snow'); weather.update(14);
  assert.equal(weather.state.snow, .5);
  assert.equal(weather.snowfall.points.visible, true);
  weather.update(17);
  assert.equal(weather.state.snow, 1);
  assert.equal(weather.state.rain, 0);
  assert.equal(weather.flash, 0);
  assert.equal(weather.rainfall.points.visible, false);
  const flakes = positions.array.slice();
  weather.update(17);
  assert.deepEqual(positions.array, flakes);
  weather.update(18);
  assert.notDeepEqual(positions.array, flakes);
  weather.setMode('clear', { immediate: true }); weather.update(18);
  const stoppedVersion = positions.version;
  weather.update(19);
  assert.equal(weather.snowfall.points.visible, false);
  assert.equal(positions.version, stoppedVersion);
  weather.dispose();
});

test('snow stays world-anchored through driving and origin rebases and releases its resources', () => {
  const scene = new THREE.Scene(), weather = new CityWeather(scene, { mode: 'snow' });
  const car = { u: -5000, s: 3180, car: { position: { y: 39 } } };
  weather.update(10, car, 3072);
  const points = weather.snowfall.geometry.attributes.position;
  assert.ok(points.count <= 2000);
  assert.deepEqual(weather.snowfall.points.position.toArray(), [-5000, 94, -108]);
  const before = points.array.slice();
  car.u += 1;
  weather.update(10, car, 3200);
  assert.deepEqual(weather.snowfall.points.position.toArray(), [-4999, 94, 20]);
  for (let i = 0; i < points.count; i++) {
    assert.ok(Math.abs(points.getX(i)) <= 120);
    assert.ok(Math.abs(points.getY(i)) <= 80);
    assert.ok(Math.abs(points.getZ(i)) <= 140);
    assert.equal(points.getY(i), before[i * 3 + 1]);
    assert.equal(points.getZ(i), before[i * 3 + 2]);
    const dx = points.getX(i) - before[i * 3];
    assert.ok([-1, 71, 239].some(expected => Math.abs(dx - expected) < .00002));
  }
  let disposed = 0;
  weather.snowfall.geometry.addEventListener('dispose', () => disposed++);
  weather.snowfall.material.addEventListener('dispose', () => disposed++);
  weather.dispose();
  assert.equal(disposed, 2);
  assert.equal(scene.children.length, 0);
});

test('manual weather transitions can be interrupted and paused selections apply immediately', () => {
  const weather = new CityWeather(new THREE.Scene());
  weather.update(20);
  assert.equal(weather.setMode('storm'), true);
  weather.update(23);
  assert.ok(weather.state.rain > .4 && weather.state.rain < .6);
  const halfway = weather.state.rain;
  weather.setMode('clear'); weather.update(23);
  assert.equal(weather.state.rain, halfway);
  weather.update(29); assert.equal(weather.state.rain, 0);
  weather.setMode('rain', { immediate: true }); weather.update(29);
  assert.equal(weather.state.rain, WEATHER_PRESETS.rain.rain);
  assert.equal(weather.setMode('invalid'), false);
  assert.equal(weather.mode, 'rain');
  const stormTime = WEATHER_INTERVAL * WEATHER_CYCLE.indexOf('storm');
  weather.setMode('auto', { immediate: true }); weather.update(stormTime);
  assert.equal(weather.state.id, 'storm');
  weather.setMode('night'); weather.update(stormTime + 1);
  assert.ok(weather.state.rain > 0);
  weather.update(0);
  assert.equal(weather.state.rain, 0);
  assert.equal(weather.state.lightLevel, 1);
  for (const value of Object.values(weather.state)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
  weather.dispose();
});

test('lightning appears only in heavy storms and honors reduced motion', () => {
  assert.ok(weatherLightning(8.4, 1) > .5);
  assert.equal(weatherLightning(8.4, .65), 0);
  assert.equal(weatherLightning(8.4, 1, true), 0);
  const weather = new CityWeather(new THREE.Scene(), { mode: 'storm', reducedMotion: true });
  weather.update(8.4);
  assert.equal(weather.flash, 0);
  assert.equal(weather.state.rain, 1);
  weather.dispose();
});

test('city rain audio follows rain intensity and dry skies have no drips or thunder', () => {
  const audio = new DriveAudio(); audio.setJourney('city');
  audio.graph = Object.fromEntries(['bed', 'air', 'rain', 'insects'].map(key => [key, { level: { value: 0 }, frequency: { value: 0 } }]));
  audio.graph.insectPulse = {}; audio.graph.insectMod = { frequency: {} };
  audio.target = (parameter, value) => { parameter.value = value; };
  audio.ambience({ motion: 0 }, 20, { rain: 0 }); assert.equal(audio.graph.rain.level.value, 0);
  audio.ambience({ motion: 0 }, 20, { rain: .5 }); const lightRain = audio.graph.rain.level.value;
  audio.ambience({ motion: 0 }, 20, { rain: 1 }); assert.equal(audio.graph.rain.level.value, lightRain * 2);
  const events = [], director = new SoundDirector();
  const ambience = { journey: 'city', mix: { ambience: 1, music: 0 }, graph: { pads: [], event: (...args) => events.push(args) } };
  director.update(ambience, { motion: 0 }, 100, { rain: 0, lightning: 0 });
  assert.deepEqual(events, []);
  director.update(ambience, { motion: 0 }, 101, { rain: 1, lightning: .5 });
  director.update(ambience, { motion: 0 }, 105, { rain: 1, lightning: 0 });
  assert.ok(events.some(([kind]) => kind === 'weather'));
});
