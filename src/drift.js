import * as THREE from 'three';

// Drifting, after Mario Kart's inside drift (see ActorMotion). The drift
// button is held: pressed at speed the car hops, and steered either way (then
// or any time while it is held) the car commits to a drift that way. The
// drift carries the car round its own arc, tighter steered into it, wider
// steered out of it, and steering never ends it: letting go does. Held long
// enough it charges a turbo in three stages (blue, orange and pink sparks),
// two and a half times as fast steered more than halfway into the drift, as
// in Mario Kart Wii and 8, and letting go fires it. In the air a drift waits
// for the landing. A press just after leaving a ramp is a trick, and a trick
// or a spin landed fires a turbo too (see CarAir).
//
// Slow, the button is still the handbrake (see ActorMotion.update).

// A drift starts from DRIFT_MIN m/s and ends below DRIFT_END. The hop is
// from HOP_MIN, at HOP m/s up (about 20 cm, a third of a second in the air)
export const DRIFT_MIN = 8, DRIFT_END = 5.5;
const HOP = 2.3, HOP_MIN = 3;
// Steering past PICK either way picks the drift's way
const PICK = .3;
// Steered out of the drift, not at all, and into it: how fast the way it
// travels turns (rad/s, a taxi's: grippier cars turn tighter), and how far
// the nose points in past the way it goes (rad). Inside drifting keeps that
// small: the car follows the inside line rather than swinging its tail out.
// The turn eases off only as the square root of the speed past SWIFT m/s
// (the tyres' grip alone would go as the speed itself), so a fast drift turns
// tighter than the tyres could (the Taxi's from about 23 m/s).
// Below SLOW m/s it turns slower too, or a slow drift would spin on the spot.
const YAW = [.9, 1.6, 2.5], SLIP = [.1, .18, .28], SWIFT = 14, SLOW = 10;
// Braking tightens a drift this much at full pedal (a brake drift), at this
// share of the brakes, and a drift costs DRAG m/s² of speed and takes only
// POWER of the engine's pull: the tyres are sliding, and a drift that kept
// gathering speed would run wide however it was steered
export const BRAKE_BEND = .6, BRAKE_SHARE = .55, DRAG = .6, POWER = .45;
// How fast the nose swings to its angle, and the steering follows into the arc
const SLIP_RATE = 7, BEND_RATE = 12;
// Charge a second steered more than halfway into the drift, and otherwise
const TIGHT = 1, LOOSE = .4;
// The charge each stage needs: blue, orange, pink
export const STAGES = [.6, 1.35, 2.3];
// Each stage's turbo: how long it lasts (s), the kick it gives at once and
// the speed it may reach (both shares of the car's top speed), and its push
// (a share of the car's own acceleration)
export const TURBOS = [null,
  { time: .55, kick: .07, top: .15, push: 1 },
  { time: 1.05, kick: .1, top: .21, push: 1.15 },
  { time: 1.7, kick: .13, top: .27, push: 1.3 },
];
// A press this soon after leaving the ground is a trick
export const TRICK = .35;

const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
// A value picked from [out, plain, in] by how far into the drift it is steered
const along = (values, bend) => bend < 0 ? values[1] + (values[0] - values[1]) * -bend : values[1] + (values[2] - values[1]) * bend;

export class Drift {
  constructor(motion) {
    this.motion = motion;
    // (what the effects and the sound have seen happen, by count: see drift-effects.js)
    this.hops = 0; this.stagesReached = 0; this.turbos = 0; this.losses = 0;
    this.reset();
  }
  reset() {
    this.held = false; this.latched = false; this.spent = false; this.dir = 0; this.bend = 0; this.slip = 0;
    this.charge = 0; this.stage = 0; this.time = 0;
    this.turbo = 0; this.turboStage = 0; this.turboTime = 0; this.kick = 0;
    this.airPress = false;
  }
  get active() { return this.dir !== 0; }
  // Held in the air after a press up there: CarAir spins the car
  get spinning() { return this.airPress && this.held; }
  // How much of the turbo is left, 0 to 1
  get boost() { return this.turbo > 0 ? this.turbo / this.turboTime : 0; }
  // How far the charge is toward the next stage, 0 to 1 (1 at the last)
  get progress() {
    if (this.stage >= STAGES.length) return 1;
    const from = this.stage ? STAGES[this.stage - 1] : 0;
    return (this.charge - from) / (STAGES[this.stage] - from);
  }
  // One step of the controls, before the car moves: `steering` is the
  // player's (-1 left to 1 right), `touch` a stick that points the car
  // itself (the overhead views), where there is no drifting
  control(dt, input, steering, aloft, touch = false) {
    const m = this.motion, speed = m.speed, held = Number(input.handbrake) > .5, pressed = held && !this.held;
    this.held = held;
    if (!dt) { this.dir = 0; this.charge = 0; this.stage = 0; this.airPress = false; this.latched = false; return; }
    // Tap to drift (see the Drift setting): a press latches the button down
    // and the next lets it go. A drift ended by a crash or by slowing down
    // needs a fresh press for the next.
    if (m.driftMode === 'tap') { if (pressed) { this.latched = !this.latched; this.spent = false; } }
    else { this.latched = held; if (!held) this.spent = false; }
    if (aloft) {
      // (a fresh press up there is a trick, or held and steered a spin)
      const air = m.carAir;
      if (pressed) {
        this.airPress = true;
        if (air?.flight && air.flight.time < TRICK && Math.abs(steering) < PICK) air.trick();
      }
      // Let go in the air, the charge fires, waiting for the ground
      if (this.dir && !this.latched) this.release();
      return;
    }
    this.airPress = false;
    if (pressed && speed >= HOP_MIN && !touch && m.carAir?.hop(HOP)) this.hops++;
    if (this.turbo > 0) this.turbo = Math.max(0, this.turbo - dt);
    if (!this.dir) {
      if (this.latched && !this.spent && !touch && speed >= DRIFT_MIN && Math.abs(steering) >= PICK) this.start(Math.sign(steering));
      // (a latch with nothing to drift is let go, once the car is slow)
      else if (m.driftMode === 'tap' && speed < DRIFT_MIN) this.latched = false;
      return;
    }
    if (!this.latched) { this.release(); return; }
    if (touch || speed < DRIFT_END) { this.lose(); return; }
    const brake = Math.max(0, Math.min(1, Number(input.brake) || 0));
    // (the brake tightens it past the tightest steering alone gives)
    this.bend = THREE.MathUtils.damp(this.bend, Math.max(-1, Math.min(1, steering * this.dir)) + brake * BRAKE_BEND, BEND_RATE, dt);
    this.time += dt;
    this.charge += dt * (steering * this.dir > .5 ? TIGHT : LOOSE);
    while (this.stage < STAGES.length && this.charge >= STAGES[this.stage]) {
      this.stage++; this.stagesReached++;
      m.events.push({ kind: 'drift', stage: this.stage, time: this.time });
    }
  }
  start(dir) {
    const m = this.motion;
    this.dir = dir; this.charge = 0; this.stage = 0; this.time = 0; this.bend = 0;
    // (the nose swings in from wherever it pointed)
    this.slip = wrap(m.heading - m.slideHeading);
  }
  // Let go: a charged drift fires its turbo
  release() {
    if (this.stage) this.fire(this.stage);
    this.dir = 0; this.charge = 0; this.stage = 0;
  }
  // Ended some other way (too slow, a crash): the charge is lost
  lose() {
    if (this.stage) this.losses++;
    this.dir = 0; this.charge = 0; this.stage = 0; this.latched = false; this.spent = true;
  }
  // A crash ends a drift and a turbo
  crash() { if (this.dir) this.lose(); this.turbo = 0; this.kick = 0; }
  fire(stage) {
    const turbo = TURBOS[stage];
    // (a smaller turbo never cuts a bigger one short)
    if (this.turbo > 0 && this.turboStage > stage && this.turbo > turbo.time) return;
    this.turboStage = stage; this.turbo = this.turboTime = turbo.time; this.kick = turbo.kick;
    this.turbos++;
    this.motion.events.push({ kind: 'turbo', stage });
  }
  // A trick or a spin landed (see CarAir.land)
  landed(stage) { if (stage) this.fire(Math.min(stage, STAGES.length)); }
  // How fast the way the car travels turns in the drift (rad/s, signed), at
  // `speed` on ground `loose` (0 road to 1 open ground)
  turn(speed, stats, loose = 0) {
    const v = Math.abs(speed), handling = Math.sqrt(stats.grip / 1.4) * (1 - .3 * loose);
    return this.dir * along(YAW, this.bend) * handling * Math.min(1, v / SLOW, Math.sqrt(SWIFT / Math.max(v, 1e-6)));
  }
  // The nose's lead past the way it goes, eased there
  lead(dt) {
    this.slip = THREE.MathUtils.damp(this.slip, this.dir * along(SLIP, this.bend), SLIP_RATE, dt);
    return this.slip;
  }
}
