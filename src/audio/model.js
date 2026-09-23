import { engineFor } from './profiles.js';

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = value => Number.isFinite(value) ? value : 0;
const damp = (from, to, dt, seconds) => from + (to - from) * (1 - Math.exp(-dt / seconds));

// Sound-only automatic gearing. Different up/down thresholds avoid hunting
// between gears; physics and the controls remain independent of this model.
export class DriveSoundModel {
  constructor() { this.profile = engineFor('coast'); this.reset(); }
  setProfile(profile) { this.profile = profile; this.reset(); }
  reset() { this.gear = 0; this.rpm = this.profile.idle; this.load = 0; this.shift = 0; this.reverse = false; this.shiftSerial = 0; }
  update(telemetry = {}, delta = 1 / 60) {
    const dt = clamp(finite(delta), 0, .1);
    const profile = this.profile;
    const signedSpeed = clamp(finite(telemetry.speed), -80, 80);
    const speed = Math.abs(signedSpeed), reverse = signedSpeed < -.3;
    const throttle = clamp(finite(telemetry.throttle), 0, 1);
    const brake = clamp(finite(telemetry.brake), 0, 1);
    const thresholds = profile.redline > 8000 ? [8, 16, 25, 35, 44] : profile.redline > 5000 ? [8.5, 16, 24, 30] : [7.5, 14.5, 22];
    if (speed < .5 || reverse !== this.reverse) { this.gear = 0; this.shift = 0; }
    this.reverse = reverse;
    this.shift = Math.max(0, this.shift - dt);
    if (!reverse && this.shift === 0) {
      const previousGear = this.gear;
      if (this.gear < thresholds.length && speed > thresholds[this.gear]) this.gear++;
      else if (this.gear > 0 && speed < thresholds[this.gear - 1] - 2.5) this.gear--;
      if (this.gear !== previousGear) { this.shift = .3; this.shiftSerial++; }
    }
    const clutch = this.shift > 0 ? .75 : 1;
    const targetRpm = clamp(profile.idle + speed * (reverse ? 205 : [230, 145, 105, 80, 68, 59][this.gear]) * profile.gearing + throttle * 220, profile.idle, profile.redline);
    this.rpm = damp(this.rpm, targetRpm, dt, this.shift ? .12 : .2);
    this.load = damp(this.load, throttle * (1 - brake) * clutch, dt, .16);
    const motion = clamp(speed / 28, 0, 1);
    const offRoad = clamp(finite(telemetry.offRoad), 0, 1);
    // Corner scrub plus actual chassis/travel slip keep a powerslide audible
    // after the handbrake is released, fading as the tires catch.
    const corner = Math.abs(clamp(finite(telemetry.steer), -1, 1)) * motion;
    const slide = clamp(finite(telemetry.slip) / .4, 0, 1) * motion;
    const skid = clamp((corner - .38) * 1.5 + brake * Math.max(0, motion - .28) * .6 + Math.max(slide, finite(telemetry.handbrake) * motion * .7), 0, 1);
    return {
      rpm: this.rpm, load: this.load, gear: reverse ? -1 : this.gear + 1, motion,
      shiftSerial: this.shiftSerial, clutch,
      engineLevel: (.085 + this.load * .09 + motion * .018) * clutch,
      engineCutoff: 380 + this.load * 1350 + motion * 550 + (profile.redline > 8000 ? 1100 : 0),
      roadLevel: Math.pow(motion, .85) * .18 * (1 - offRoad * .65),
      roughLevel: Math.sqrt(motion) * offRoad * .17,
      windLevel: Math.pow(motion, 1.7) * .12,
      skidLevel: skid * (1 - offRoad * .85) * .075,
      skidFrequency: 950 + corner * 600,
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
