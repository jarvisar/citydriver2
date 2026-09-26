import * as THREE from 'three';
import { Rainfall } from './rainfall.js';
import { Snowfall } from './snowfall.js';

// A complete cycle takes fourteen minutes of driving. This clock belongs to
// the game, so pausing or hiding the tab also pauses the sky and precipitation.
export const WEATHER_INTERVAL = 105;
export const WEATHER_TRANSITION = 22;
// Shuffle once per game load so sampling the clock stays stable while driving.
const middlePhases = ['clear', 'clear', 'overcast', 'rain', 'storm', 'snow'];
for (let i = middlePhases.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [middlePhases[i], middlePhases[j]] = [middlePhases[j], middlePhases[i]];
}
export const WEATHER_CYCLE = Object.freeze(['sunset', ...middlePhases, 'night']);
const NUMBER_KEYS = ['rain', 'snow', 'wetness', 'lightLevel', 'windowGlow', 'cloudCover', 'skyIntensity', 'sunIntensity', 'exposure', 'fogNear', 'fogFar', 'drivingFogNear', 'drivingFogFar', 'sunX', 'sunY', 'sunZ'];
const COLOR_KEYS = ['background', 'fogColor', 'skyColor', 'groundColor', 'sunColor', 'cloudColor'];
const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

function preset(label, values) {
  const result = { label, snow: 0, ...values };
  for (const key of COLOR_KEYS) result[key] = new THREE.Color(result[key]);
  return result;
}

// lightLevel is vehicle/street lamp strength: on only in a thunderstorm and at
// night. Golden hour, rain, snow and overcast skies are still daylight.
// windowGlow is how brightly the lit rooms show through their windows: a
// faint warmth by day, more as the light fails, and full at night.
// cloudCover is the share of the sky's clouds out (see sky-clouds.js).
export const WEATHER_PRESETS = {
  clear: preset('Day', { rain: 0, wetness: 0, lightLevel: 0, windowGlow: 0, cloudCover: .42, cloudColor: '#ffffff',
    background: '#b6d5e8', fogColor: '#c9dbe2', skyColor: '#c9e2f2', groundColor: '#717977', sunColor: '#fff0d5',
    skyIntensity: 1.6, sunIntensity: 2.8, exposure: .77, fogNear: 390, fogFar: 780, drivingFogNear: 190, drivingFogFar: 420, sunX: -150, sunY: 230, sunZ: 110 }),
  overcast: preset('Overcast', { rain: 0, wetness: .08, lightLevel: 0, windowGlow: .15, cloudCover: .95, cloudColor: '#d9dfe4',
    background: '#a8b8c6', fogColor: '#b2bec7', skyColor: '#d8e2ea', groundColor: '#69737b', sunColor: '#e1eaf0',
    skyIntensity: 1.85, sunIntensity: 1.15, exposure: .72, fogNear: 340, fogFar: 670, drivingFogNear: 150, drivingFogFar: 355, sunX: -150, sunY: 210, sunZ: 110 }),
  rain: preset('Rain', { rain: .65, wetness: .86, lightLevel: 0, windowGlow: .25, cloudCover: 1, cloudColor: '#aeb8c2',
    background: '#929faa', fogColor: '#a0adb8', skyColor: '#c7d6e2', groundColor: '#596773', sunColor: '#d5e3ef',
    skyIntensity: 1.75, sunIntensity: .85, exposure: .62, fogNear: 240, fogFar: 590, drivingFogNear: 110, drivingFogFar: 305, sunX: -150, sunY: 210, sunZ: 110 }),
  storm: preset('Thunderstorm', { rain: 1, wetness: 1, lightLevel: .8, windowGlow: .6, cloudCover: 1, cloudColor: '#7f8b99',
    background: '#606e81', fogColor: '#7b899b', skyColor: '#a5bcd6', groundColor: '#465465', sunColor: '#b5c8e1',
    skyIntensity: 1.4, sunIntensity: .55, exposure: .59, fogNear: 185, fogFar: 495, drivingFogNear: 75, drivingFogFar: 260, sunX: -150, sunY: 210, sunZ: 110 }),
  snow: preset('Snow', { rain: 0, snow: 1, wetness: .15, lightLevel: 0, windowGlow: .18, cloudCover: .9, cloudColor: '#e9eef3',
    background: '#becddc', fogColor: '#cedae5', skyColor: '#e0ebf5', groundColor: '#7d8997', sunColor: '#e4edff',
    skyIntensity: 1.9, sunIntensity: .9, exposure: .76, fogNear: 210, fogFar: 530, drivingFogNear: 80, drivingFogFar: 280, sunX: -150, sunY: 210, sunZ: 110 }),
  sunset: preset('Golden hour', { rain: 0, wetness: .12, lightLevel: 0, windowGlow: .4, cloudCover: .5, cloudColor: '#ffdcc4',
    background: '#d8c2b4', fogColor: '#d9c8b8', skyColor: '#c5d6e7', groundColor: '#777685', sunColor: '#ffd09a',
    skyIntensity: 1.65, sunIntensity: 3.1, exposure: .82, fogNear: 340, fogFar: 740, drivingFogNear: 170, drivingFogFar: 395, sunX: -210, sunY: 105, sunZ: 140 }),
  night: preset('Night', { rain: 0, wetness: 0, lightLevel: 1, windowGlow: 1, cloudCover: .35, cloudColor: '#9aa8c2',
    background: '#202d49', fogColor: '#34405a', skyColor: '#97b3dc', groundColor: '#3c425b', sunColor: '#c3d7f4',
    skyIntensity: .88, sunIntensity: .75, exposure: .68, fogNear: 240, fogFar: 615, drivingFogNear: 100, drivingFogFar: 335, sunX: 130, sunY: 220, sunZ: -130 }),
};

function emptyState() {
  const result = {};
  for (const key of COLOR_KEYS) result[key] = new THREE.Color();
  return result;
}

function mixState(from, to, amount, result) {
  for (const key of NUMBER_KEYS) result[key] = from[key] + (to[key] - from[key]) * amount;
  for (const key of COLOR_KEYS) result[key].copy(from[key]).lerp(to[key], amount);
  return result;
}

// Pure sampling also makes a restored game clock and low frame rates agree.
// Each phase holds its conditions before fading into the next phase.
export function sampleCityWeather(time, mode = 'auto', result = emptyState()) {
  time = Number.isFinite(time) ? Math.max(0, time) : 0;
  if (mode !== 'auto' && !Object.hasOwn(WEATHER_PRESETS, mode)) mode = 'auto';
  let current = mode, next = mode, blend = 0;
  if (mode === 'auto') {
    const phase = Math.floor(time / WEATHER_INTERVAL);
    current = WEATHER_CYCLE[phase % WEATHER_CYCLE.length];
    next = WEATHER_CYCLE[(phase + 1) % WEATHER_CYCLE.length];
    blend = ease((time % WEATHER_INTERVAL - (WEATHER_INTERVAL - WEATHER_TRANSITION)) / WEATHER_TRANSITION);
  }
  mixState(WEATHER_PRESETS[current], WEATHER_PRESETS[next], blend, result);
  result.id = blend >= .5 ? next : current;
  result.label = WEATHER_PRESETS[result.id].label;
  result.mode = mode;
  result.flash = 0;
  return result;
}

export function weatherLightning(time, rain, reducedMotion = false) {
  if (reducedMotion || rain < .93 || !Number.isFinite(time)) return 0;
  // Two soft pulses at most, well separated from the next distant strike.
  const phase = ((time % 29) + 29) % 29;
  return (Math.exp(-(((phase - 8.4) / .105) ** 2)) * .58 + Math.exp(-(((phase - 8.78) / .13) ** 2)) * .32) * clamp((rain - .93) / .07);
}

export class CityWeather {
  constructor(scene, { reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, mode = 'auto' } = {}) {
    this.mode = Object.hasOwn(WEATHER_PRESETS, mode) ? mode : 'auto';
    this.reducedMotion = reducedMotion;
    this.time = 0;
    this.state = sampleCityWeather(0, this.mode);
    this.targetState = emptyState();
    this.transitionState = emptyState();
    mixState(this.state, this.state, 0, this.transitionState);
    this.transitionStart = -Infinity;
    this.rainfall = new Rainfall();
    this.rainfall.points.visible = false;
    scene.add(this.rainfall.points);
    this.snowfall = new Snowfall();
    this.snowfall.points.visible = false;
    scene.add(this.snowfall.points);
    this.anchor = new THREE.Vector3();
  }
  get flash() { return this.state.flash; }
  setMode(mode, { immediate = false } = {}) {
    if (mode !== 'auto' && !Object.hasOwn(WEATHER_PRESETS, mode)) return false;
    mixState(this.state, this.state, 0, this.transitionState);
    this.mode = mode;
    this.transitionStart = immediate ? -Infinity : this.time;
    return true;
  }
  update(time, vehicle, origin = 0) {
    const nextTime = Number.isFinite(time) ? Math.max(0, time) : this.time;
    // If the game clock rewinds, a manual crossfade must not wait for its old
    // timestamp to recur.
    if (nextTime < this.time) this.transitionStart = -Infinity;
    this.time = nextTime;
    sampleCityWeather(this.time, this.mode, this.targetState);
    const transition = ease((this.time - this.transitionStart) / 6);
    mixState(this.transitionState, this.targetState, transition, this.state);
    this.state.id = this.targetState.id;
    this.state.label = this.targetState.label;
    this.state.mode = this.mode;
    this.state.flash = weatherLightning(this.time, this.state.rain, this.reducedMotion);
    this.rainfall.points.visible = this.state.rain > .01;
    this.rainfall.material.opacity = .92 * this.state.rain;
    this.snowfall.points.visible = this.state.snow > .01;
    this.snowfall.material.opacity = .85 * this.state.snow;
    if (this.rainfall.points.visible || this.snowfall.points.visible) {
      const position = vehicle?.position ?? vehicle?.car?.position ?? vehicle?.groundedPosition ?? vehicle?.mesh?.position;
      this.anchor.set(vehicle?.u ?? position?.x ?? 0, (position?.y ?? 24) + 55, -(vehicle?.s ?? 0));
      if (this.rainfall.points.visible) this.rainfall.update(this.time, this.anchor, origin);
      if (this.snowfall.points.visible) this.snowfall.update(this.time, this.anchor, origin);
    }
    return this.state;
  }
  dispose() { this.rainfall.dispose(); this.snowfall.dispose(); }
}
