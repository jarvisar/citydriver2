import { engineFor } from './profiles.js';

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = value => Number.isFinite(value) ? value : 0;
const damp = (from, to, dt, seconds) => from + (to - from) * (1 - Math.exp(-dt / seconds));

// Engine revs per m/s in each gear, from the speed the car really holds
// (`cruise`, see carStats): first gear runs out at about a quarter of it and
// top gear holds it at 80% of the redline, so a car at full speed is still
// pulling and boost takes it the rest of the way. Steps are geometric.
export function gearRatios(profile, cruise = 28) {
  const top = .8 * profile.redline / Math.max(5, cruise), first = profile.redline / (Math.max(5, cruise) * .26);
  const step = (first / top) ** (1 / Math.max(1, profile.gears - 1));
  return Array.from({ length: profile.gears }, (_, gear) => first / step ** gear);
}

// Sound-only automatic gearbox. It changes up late under full throttle and
// early when cruising, kicks down when the pedal goes to the floor, and a
// torque converter lets the engine rev before the car moves. Each downshift
// point sits well under the revs the upshift before it lands on, so it never
// hunts. Physics and the controls remain independent of this model.
export class DriveSoundModel {
  constructor() { this.setProfile(engineFor('city')); }
  setProfile(profile, cruise = this.cruise ?? 28) {
    this.profile = profile; this.cruise = cruise; this.ratios = gearRatios(profile, cruise); this.reset();
  }
  reset() {
    this.gear = 0; this.rpm = this.profile.idle; this.load = 0; this.shift = 0; this.reverse = false;
    this.shiftSerial = 0; this.liftSerial = 0; this.drive = 0; this.lifted = true;
  }
  update(telemetry = {}, delta = 1 / 60) {
    const dt = clamp(finite(delta), 0, .1);
    const { idle, redline } = this.profile, ratios = this.ratios, last = ratios.length - 1;
    const signedSpeed = clamp(finite(telemetry.speed), -120, 120);
    const speed = Math.abs(signedSpeed), reverse = signedSpeed < -.3;
    const throttle = clamp(finite(telemetry.throttle), 0, 1);
    const brake = clamp(finite(telemetry.brake), 0, 1);
    const boost = telemetry.boost ? 1 : 0;
    // The gearbox reads a settled pedal: a stab kicks down a moment later
    this.drive = damp(this.drive, Math.max(throttle, boost), dt, .25);
    if (speed < 1 || reverse !== this.reverse) { this.gear = 0; this.shift = 0; }
    this.reverse = reverse;
    this.shift = Math.max(0, this.shift - dt);
    if (!reverse && speed >= 1 && this.shift === 0) {
      const up = redline * (.36 + .54 * this.drive), wheel = speed * ratios[this.gear];
      const previous = this.gear;
      if (this.gear < last && wheel > up) this.gear++;
      else if (this.gear > 0 && wheel < .8 * up * ratios[this.gear] / ratios[this.gear - 1]) this.gear--;
      if (this.gear !== previous) { this.shift = .22; this.shiftSerial++; }
    }
    // A lift from high revs: the sporty ones crackle (see DriveAudio.effects)
    if (throttle > .5) this.lifted = false;
    else if (!this.lifted && throttle < .15 && this.drive > .6 && this.rpm > redline * .55) { this.lifted = true; this.liftSerial++; }
    const clutch = this.shift > 0 ? .35 : 1;
    const wheel = speed * (reverse ? ratios[0] * .85 : ratios[this.gear]);
    // Standing on the gas at a standstill takes the engine a third of the way up its range
    const slip = idle + (redline - idle) * .36 * Math.max(throttle, boost);
    const targetRpm = clamp(Math.max(wheel, slip) + boost * (redline - idle) * .03, idle, redline);
    this.rpm = damp(this.rpm, targetRpm, dt, this.shift ? .07 : .16);
    this.load = damp(this.load, Math.max(throttle * (1 - brake), boost) * clutch, dt, .12);
    const motion = clamp(speed / 28, 0, 1);
    const offRoad = clamp(finite(telemetry.offRoad), 0, 1);
    return {
      rpm: this.rpm, load: this.load, gear: reverse ? -1 : this.gear + 1, motion, boost,
      shiftSerial: this.shiftSerial, liftSerial: this.liftSerial, clutch,
      engineLevel: (.085 + this.load * .09 + motion * .018) * (this.shift > 0 ? .8 : 1),
      engineCutoff: 380 + this.load * 1350 + motion * 550 + (redline > 8000 ? 1100 : 0),
      roadLevel: Math.pow(motion, .85) * .18 * (1 - offRoad * .65),
      roughLevel: Math.sqrt(motion) * offRoad * .17,
      windLevel: Math.pow(motion, 1.7) * .12,
      reverseLevel: reverse ? Math.min(1, speed / 5) * .035 : 0,
      reverseFrequency: 260 + speed * 65,
    };
  }
}

// Listener-relative traffic without depending on Three.js or render-origin
// rebasing. Relative radial velocity supplies a bounded Doppler pitch shift.
export function trafficSound(player, car, listenerHeading = player.heading) {
  const dx = finite(car.position?.x) - finite(player.groundedPosition?.x);
  const dz = finite(car.position?.z) - finite(player.groundedPosition?.z);
  const distance = Math.hypot(dx, dz);
  const vx = Math.sin(finite(car.heading)) * finite(car.speed) - Math.sin(finite(player.heading)) * finite(player.speed);
  const vz = -Math.cos(finite(car.heading)) * finite(car.speed) + Math.cos(finite(player.heading)) * finite(player.speed);
  const radial = (vx * dx + vz * dz) / Math.max(1, distance);
  return {
    distance,
    level: Math.pow(clamp(1 - distance / 85, 0, 1), 2) / (1 + distance * .035),
    pan: clamp((dx * Math.cos(listenerHeading) + dz * Math.sin(listenerHeading)) / Math.max(6, distance * .55), -.95, .95),
    doppler: clamp(343 / (343 + radial), .78, 1.28),
  };
}
// What one traffic car sounds like from where it is heard: its engine,
// quieter idling than pulling away and deeper for a van; its tyres, which
// only a moving car has; and the air taking the edge off a distant one.
const HEAVY = { van: 1, pickup: .6 };
export function trafficVoice(car, sound) {
  const speed = Math.abs(finite(car.speed)), heavy = HEAVY[car.spec?.name] ?? 0;
  return {
    engine: sound.level * (.35 + .65 * clamp(speed / 12, 0, 1)) * (1 + heavy * .25),
    tyres: sound.level * clamp(speed / 16, 0, 1) ** 1.3,
    pitch: (58 - heavy * 13 + speed * 2.6 + finite(car.index) % 5 * 2.5) * sound.doppler,
    hiss: (550 + speed * 38) * (1 - .45 * clamp(sound.distance / 85, 0, 1)),
  };
}

// The city round the car: a hum of distant traffic that thins out in the
// parks and at night, leaves and air stirring as the wind gusts (more in a
// storm, less under snow), and the rain, drumming duller on the roof from
// inside. `place` comes from citySoundscape (world/city.js).
export function cityAmbience(place = {}, weather = {}, now = 0) {
  const urban = clamp(finite(place.urban ?? .6), 0, 1), green = clamp(finite(place.green), 0, 1), water = clamp(finite(place.water), 0, 1);
  const rain = clamp(finite(weather.rain), 0, 1), snow = clamp(finite(weather.snow), 0, 1), night = clamp(finite(weather.night), 0, 1);
  now = finite(now);
  const gust = .5 + .3 * Math.sin(now * .23) + .2 * Math.sin(now * .61 + 2), storm = clamp((rain - .75) * 4, 0, 1);
  return {
    hum: (.02 + .055 * urban + .012 * water) * (1 - .35 * night) * (1 - .45 * snow) * (.85 + .15 * gust),
    humFrequency: 230 + 120 * urban,
    air: (.004 + .016 * green * gust * gust + .012 * rain + .03 * storm * gust) * (1 - .7 * snow),
    airFrequency: 2300 * (.8 + gust * .4),
    rain: rain * (.28 + gust * .09) * (weather.cabin ? 1.2 : 1),
    rainFrequency: weather.cabin ? 1800 : 4700,
    gust, storm,
  };
}
