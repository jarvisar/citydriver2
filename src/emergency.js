import { carEntry } from './cars.js';

// An emergency vehicle's gear while the player drives one (`emergency` in
// CARS): its beacons flash, the left set and the right in turn, and holding
// Boost sounds its siren (`siren`, the sound's name: see DriveAudio), which
// the traffic ahead gives way to (see CityTraffic.giveWay). Both stop once
// they are out of it, and the beacons of one left standing go dark.
// FLASH is how many times a second each set flashes, each flash two quick
// pulses. A lit beacon glows DAY by day and NIGHT after dark.
const FLASH = 1.6, DAY = 1.1, NIGHT = 1.9;
export class EmergencyGear {
  constructor() { this.time = 0; this.lit = null; this.siren = null; }
  // `boost`: whether Boost is held this step
  update(dt, vehicle, boost = false) {
    const motion = vehicle.actor.motion, entry = carEntry(motion.carId), on = Boolean(entry.emergency) && !motion.walker;
    if (this.lit && this.lit !== motion) this.lit.flash(0, 0);
    this.lit = on ? motion : null;
    this.siren = on && boost ? entry.siren : null;
    if (!on) { this.time = 0; return; }
    this.time += dt;
    const glow = DAY + (NIGHT - DAY) * (Number(motion.night) || 0), phase = this.time * FLASH % 1;
    motion.flash(pulse(phase, glow), pulse((phase + .5) % 1, glow));
  }
}
// A set's glow `phase` of the way through a flash: two pulses in its first half
function pulse(phase, glow) {
  const t = phase * 2;
  return t < .3 || (t >= .45 && t < .75) ? glow : 0;
}
