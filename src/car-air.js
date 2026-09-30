import * as THREE from 'three';
import { clamp } from './world/route.js';
import { roofSurface, shapeSlope, surfacesUnder } from './collision.js';
import { propTop } from './loose-props.js';

// A car on its wheels, up and down (see ActorMotion): it keeps to the ground
// while it can, leaves it where the ground falls away faster than it can fall
// (a ramp's lip, a crest taken fast) and comes back down with its weight.
// What it meets in the air is met as on the ground, height and all (see passes).
//
//   GRAVITY    a little over the real thing, so a car comes down with weight
//   TRAVEL     how far a wheel reaches down and still grips: a kerb stepped
//              down never lifts the car off its tyres
//   STEP       the highest a wheel climbs, a kerb or a ramp's foot. Higher is a wall
//   BELLY      how far the floor pan clears the ground under the middle
//   AIRBORNE   up this far over the street it clears traffic, people, walls
//              and railings, as the helicopter does
export const GRAVITY = 13;
const TRAVEL = .3;
export const STEP = .45;
const BELLY = .2, AIRBORNE = 2.5;
// In the air the nose follows the arc (FOLLOW of the way it flies, never more
// than PITCH_MOST) and comes round to the ground under it over the last LEVEL
// metres, so it lands on its wheels. Slower than TIPS m/s over an edge it tips.
const FOLLOW = .55, PITCH_MOST = .6, ROLL_MOST = .45, LEVEL = 2.2, TIPS = 6;
// Steering in the air turns the nose up to LEAN off the way it flies, and it
// comes straight again at STRAIGHTEN. With drift held it spins at SPIN rad/s
const LEAN = .42, STRAIGHTEN = 5, SPIN = 6.8;
// Landing more than SLIDE_MOST off the way it is going spins it out. A nose
// landed just off it slides for SETTLE seconds while the tyres bite again
const SLIDE_MOST = .55, SETTLE = .35;
// Faster down than this (m/s) is a hard landing, and onto a car faster than
// STOMP it takes the blow
export const HARD_LANDING = 12;
const STOMP = 2;
// What counts as a jump: this long in the air
export const JUMP_AIR = .45;
// The body on its springs: it rides up EXTEND over its wheels in the air and
// squats into a landing
const EXTEND = .09, SPRING = 170, DAMP = 16, SQUAT = .3;
// In the water it sinks, and after SINK seconds it is fished out (see main.js)
const SINK = 1.6;

const WHOLE = Math.PI * 2;

export class CarAir {
  constructor(motion) {
    this.motion = motion;
    // The four wheels and the middle (along, across the car), and where they
    // are now, as the colliders lie
    this.layout = [[1.3, -.8], [1.3, .8], [-1.3, -.8], [-1.3, .8], [0, 0]];
    this.wheelbase = 2.6; this.track = 1.6;
    this.points = this.layout.map(() => ({ x: 0, z: 0 }));
    this.limits = new Float64Array(5); this.heights = new Float64Array(5); this.solids = new Array(5).fill(null);
    this.floors = new Float64Array(5); this.ground = new Float64Array(5); this.last = new Float64Array(5);
    this.slope = { x: 0, z: 0 };
    this.reset();
  }
  // Where the wheels are on this model (see createCar): its outermost axles
  // and track, or near enough from its footprint
  fit(wheels, width, length) {
    let front = -Infinity, rear = Infinity, track = 0;
    for (const w of wheels ?? []) {
      const p = w.pivot?.position;
      if (!p) continue;
      front = Math.max(front, -p.z); rear = Math.min(rear, -p.z); track = Math.max(track, Math.abs(p.x));
    }
    if (!(front > rear) || !track) { front = length * .33; rear = -length * .33; track = width * .42; }
    this.layout = [[front, -track], [front, track], [rear, -track], [rear, track], [0, 0]];
    this.wheelbase = front - rear; this.track = track * 2;
    this.last.fill(NaN);
  }
  reset() {
    const m = this.motion;
    m.y = NaN; m.vy = 0; m.aloft = false; m.air = 0; m.lift = 0; m.liftRate = 0; m.sinking = null;
    this.turn = 0; this.spinRate = 0; this.spinning = 0; this.free = 0; this.flight = null; this.settle = SETTLE;
    this.water = false; this.splashed = false; this.under = null; this.floor = NaN; this.held = NaN; this.rate = 0; this.street = true; this.last.fill(NaN);
  }
  // Steering in the air: the nose leans off the way the car flies, and with
  // drift held it spins right round. Let go, it comes straight again, on
  // round to the next whole turn if it was spinning. Returns the heading.
  steer(dt, steering, spinning, travel) {
    if (spinning && Math.abs(steering) > .25) {
      this.spinRate = THREE.MathUtils.damp(this.spinRate, Math.sign(steering) * SPIN, 10, dt);
      this.spinning = Math.sign(this.spinRate);
    } else {
      // (let go part way round a spin, it carries on round rather than back)
      let whole = Math.round(this.turn / WHOLE) * WHOLE;
      if (this.spinning && Math.sign(whole - this.turn) === -this.spinning) whole += this.spinning * WHOLE;
      if (Math.abs(whole - this.turn) < .2) this.spinning = 0;
      this.spinRate = clamp((whole + steering * LEAN - this.turn) * STRAIGHTEN, -SPIN, SPIN);
    }
    this.turn += this.spinRate * dt;
    return travel + this.turn;
  }
  // The ramp or mound under the car's middle, when that is what it stands on
  get shape() { return this.heights[4] >= this.ground[4] ? this.solids[4]?.shape ?? null : null; }
  // Whether the car's middle is up on something over the street: a ramp, a roof
  get raised() { return this.heights[4] >= this.ground[4]; }
  // How fast the ground under the car's middle rises as it drives over it
  // (m/s), going `vs` north and `vu` east
  groundRate(vs, vu) {
    const shape = this.shape;
    if (!shape) return 0;
    // (the slope is per metre east and south: s runs north)
    shapeSlope(shape, this.points[4], this.slope);
    return this.slope.x * vu - this.slope.z * vs;
  }
  // How much the ground climbs per metre the car goes along `heading`, under its middle
  grade(heading) {
    const shape = this.shape;
    if (!shape) return 0;
    shapeSlope(shape, this.points[4], this.slope);
    return this.slope.x * Math.sin(heading) - this.slope.z * Math.cos(heading);
  }
  // What each wheel stands on: the street, or a roof, a ramp, a mound or a
  // car it could climb onto from where it is, which for a car means coming
  // down on it (`put` down somewhere, the highest there)
  sample(put = false) {
    const m = this.motion, route = m.route, cos = Math.cos(m.heading), sin = Math.sin(m.heading);
    const sp = Math.sin(m.pitch), sr = Math.sin(m.roll), placed = Number.isFinite(m.y) && !put;
    for (let i = 0; i < 5; i++) {
      const [along, across] = this.layout[i], s = m.s + along * cos - across * sin, u = m.u + along * sin + across * cos;
      const p = route.position(s, u, 0);
      this.points[i].x = p.x; this.points[i].z = p.z;
      this.ground[i] = route.height(s, u);
      this.limits[i] = put ? Infinity : (placed ? m.y + along * sp + across * sr : this.ground[i]) + STEP;
    }
    // (a car put down is never put on another)
    if (m.scenery) surfacesUnder(m.scenery.values(), this.points, this.limits, this.heights, this.solids, !put);
    else { this.heights.fill(-Infinity); this.solids.fill(null); }
    if (!put) m.traffic?.roofsUnder(this.points, this.limits, this.heights, this.solids);
    for (let i = 0; i < 5; i++) this.floors[i] = Math.max(this.ground[i], this.heights[i]);
    this.water = Boolean(route.water?.(m.s, m.u)) && this.heights[4] === -Infinity;
  }
  // The height the car's wheels hold it at, pitched and rolled as it is
  support() {
    const m = this.motion, sp = Math.sin(m.pitch), sr = Math.sin(m.roll);
    let held = this.floors[4] - BELLY;
    for (let i = 0; i < 4; i++) {
      const [along, across] = this.layout[i];
      held = Math.max(held, this.floors[i] - along * sp - across * sr);
    }
    return held;
  }
  // Which way the ground under the wheels tilts the car, counting a wheel
  // over a drop for as much as the car is slow: at speed it goes off an edge
  // level, slowly it tips over it
  groundTilt(speed) {
    const m = this.motion, f = this.floors, sp = Math.sin(m.pitch), sr = Math.sin(m.roll), hang = clamp(1 - Math.abs(speed) / TIPS, 0, 1);
    const reach = i => {
      const [along, across] = this.layout[i], wheel = m.y + along * sp + across * sr, below = wheel - f[i];
      return below > TRAVEL + STEP ? wheel - below * hang : f[i];
    };
    const fl = reach(0), fr = reach(1), rl = reach(2), rr = reach(3);
    const pitch = Math.atan2((fl + fr - rl - rr) / 2, this.wheelbase), roll = Math.atan2((fr + rr - fl - rl) / 2, this.track);
    return { pitch: clamp(pitch, -PITCH_MOST, PITCH_MOST), roll: clamp(roll, -ROLL_MOST, ROLL_MOST) };
  }
  // One step up and down, after the car has moved along the ground: it keeps
  // to what its wheels stand on, falls where that falls away faster than it
  // can, and lands. `vs`, `vu` is how fast it is going north and east.
  update(dt, vs, vu) {
    const m = this.motion, telemetry = m.audioTelemetry;
    // (a step of no time is a car put down somewhere: on the ground there)
    if (!dt) { m.sinking = null; m.aloft = false; this.flight = null; this.turn = this.spinRate = 0; }
    const placed = Number.isFinite(m.y) && dt > 0;
    this.sample(!placed);
    if (m.sinking) { this.sink(dt); return; }
    // (put down, it sits as the ground under it tilts it)
    if (!placed) { const tilt = this.groundTilt(0); m.pitch = tilt.pitch; m.roll = tilt.roll; }
    const held = this.support(), rate = this.groundRate(vs, vu);
    let vy = m.vy - GRAVITY * dt, y = placed ? m.y + vy * dt : held, landing = -1;
    // A kerb stepped down (no deeper than the suspension reaches) the wheels
    // follow at once and the body settles after them. Only the street has
    // kerbs: a ramp or a mound falls away smoothly, and that is left to
    // gravity, as is anything deeper.
    const street = this.heights.every(h => h === -Infinity), kerbs = street && this.street && placed && !this.free;
    this.street = street;
    const drop = kerbs ? this.held + this.rate * dt - held : 0;
    if (drop > .01 && drop <= TRAVEL && y > held && vy <= this.rate + .5) { m.lift += drop * .8; y = held; }
    // (and stepping up one, the body squats into it)
    else if (drop < -.01 && drop >= -STEP && y <= held) m.lift += drop * .6;
    const contact = y <= held;
    if (!placed) vy = rate;
    else if (contact) {
      // (and if it was coming down, how hard onto the ground under it)
      if (this.free > 0) landing = Math.max(0, rate - vy);
      y = held; vy = rate;
    }
    this.held = held; this.rate = rate;
    // A kerb under a wheel thumps (see DriveAudio.bump), front and back
    if (placed && landing < 0 && Math.hypot(vs, vu) > 1) for (let i = 0; i < 4; i++) {
      const step = Math.abs(this.floors[i] - this.last[i]);
      if (step > .05 && step < .5) { telemetry.bump = step; telemetry.bumpSerial++; break; }
    }
    this.last.set(this.floors);
    const was = m.aloft;
    m.y = y; m.vy = vy;
    // Off the ground once no wheel reaches it, or neither front one does:
    // leaving a ramp's lip on its back wheels it can't steer, and flies on.
    // Down on its belly (on a car's roof, its wheels either side of it) it
    // scrabbles along on it rather than being stuck there.
    const sp = Math.sin(m.pitch), sr = Math.sin(m.roll), reach = i => y + this.layout[i][0] * sp + this.layout[i][1] * sr - this.floors[i];
    const belly = contact && this.floors[4] - BELLY >= held - 1e-6;
    m.aloft = y - held > TRAVEL || (!belly && Math.min(reach(0), reach(1)) > TRAVEL + .1);
    m.airborne = y - this.ground[4] > AIRBORNE && !this.water;
    this.free = contact ? 0 : this.free + dt;
    // On the ground: what it stands on, for where a jump leaves from
    if (contact) { this.floor = held; this.under = this.solids[4]; }
    if (m.aloft && !was && !this.flight) this.takeOff();
    if (this.flight) { this.flight.time += dt; this.flight.peak = Math.max(this.flight.peak, y); }
    // (down in the water only if no wheel has the quay under it)
    this.splashed = contact && this.water && this.floors.every((floor, i) => i === 4 || floor <= this.ground[4] + .05);
    if (landing >= 0) this.land(landing);
    m.air = m.aloft ? m.air + dt : 0;
    this.settle = Math.min(SETTLE, this.settle + dt);
    this.spring(dt);
  }
  // Where a jump begins: the ground it left and the way it was going, and a
  // named jump it left from (see city-jumps.js)
  takeOff() {
    const m = this.motion, p = m.groundedPosition;
    this.flight = { x: p.x, z: p.z, s: m.s, u: m.u, heading: m.slideHeading ?? m.heading, y: this.floor, time: 0, peak: m.y, speed: Math.abs(m.speed), jump: this.under?.jump ?? null };
    this.turn = 0; this.spinRate = 0; this.spinning = 0;
  }
  // Down on its wheels: the body squats as hard as it came down, the nose
  // comes round to the way it is going (well off it, it spins out), and a
  // jump is tallied
  land(impact) {
    const m = this.motion, telemetry = m.audioTelemetry, flight = this.flight;
    if (impact > .6) {
      m.liftRate -= impact * SQUAT;
      telemetry.bump = Math.min(.5, .06 + impact * .045); telemetry.bumpSerial++;
      if (impact > HARD_LANDING) m.trauma = Math.min(1, m.trauma + (impact - HARD_LANDING) / 40);
    }
    if (this.splashed) this.splash();
    // Come down on a car: it takes the blow (see CityTraffic.stomp)
    if (impact > STOMP) {
      const roof = this.solids.find((solid, i) => (solid?.car || solid?.parked) && this.floors[i] === this.heights[i]);
      if (roof) { const p = m.groundedPosition; m.events.push({ kind: 'stomp', on: roof, impact, x: p.x, z: p.z }); }
    }
    if (!flight) return;
    // Hard down, the tyres scrub a little speed off
    if (impact > 5) m.speed *= 1 - clamp((impact - 5) * .012, 0, .15);
    const turns = Math.round(this.turn / WHOLE), off = this.turn - turns * WHOLE;
    let landing = impact > HARD_LANDING ? 'hard' : 'clean';
    if (this.splashed) landing = 'splash';
    else if (Math.abs(off) > SLIDE_MOST) {
      // Well off the way it is going: the tyres take the slide and the spin
      // (see carryKnock), as after a blow
      const travel = m.slideHeading, heading = travel + off, speed = m.speed, along = speed * Math.cos(off);
      m.knock.x += Math.sin(travel) * speed - Math.sin(heading) * along; m.knock.z += -Math.cos(travel) * speed + Math.cos(heading) * along;
      m.knock.spin = clamp(m.knock.spin + this.spinRate * .6, -5, 5);
      m.speed = along; m.slideHeading = heading; landing = 'spun';
    } else if (Math.abs(off) > .12) { this.settle = 0; if (landing === 'clean') landing = 'slid'; }
    m.heading = m.slideHeading + (landing === 'spun' ? 0 : off);
    this.turn = 0; this.spinRate = 0; this.spinning = 0;
    if (flight.time >= JUMP_AIR) {
      const p = m.groundedPosition, distance = Math.hypot(p.x - flight.x, p.z - flight.z);
      m.events.push({ kind: 'jump', air: flight.time, distance, height: Math.max(0, flight.peak - flight.y), turns, landing, impact, speed: flight.speed, jump: flight.jump, from: flight, x: p.x, z: p.z });
    }
    this.flight = null;
    if (landing === 'splash') m.sinking.from = flight;
  }
  // Into the water: a splash, and down it goes
  splash() {
    const m = this.motion, p = m.groundedPosition;
    m.sinking = { time: 0, from: null };
    m.props?.bits?.burst('spray', p.x, p.y + .1, p.z, 0, 0, 16, 3.2, 3.4);
    m.props?.sounds?.push({ kind: 'splash', strength: 12, x: p.x, z: p.z });
    m.events.push({ kind: 'splash', x: p.x, z: p.z });
  }
  sink(dt) {
    const m = this.motion, sinking = m.sinking;
    sinking.time += dt;
    m.speed *= Math.exp(-dt * 2.2); m.knock.x *= Math.exp(-dt * 3); m.knock.z *= Math.exp(-dt * 3); m.knock.spin *= Math.exp(-dt * 3);
    m.vy = -1.2; m.y = Math.max(this.ground[4] - 2.2, m.y + m.vy * dt); m.aloft = false; m.airborne = false;
    m.pitch = THREE.MathUtils.damp(m.pitch, .3, 1.5, dt);
    if (sinking.time >= SINK && !sinking.done) { sinking.done = true; m.events.push({ kind: 'sunk', from: sinking.from }); }
    this.spring(dt);
  }
  // The body on its springs over the wheels
  spring(dt) {
    const m = this.motion;
    if (!dt) { m.lift = m.aloft ? EXTEND : 0; m.liftRate = 0; return; }
    m.liftRate += (SPRING * ((m.aloft ? EXTEND : 0) - m.lift) - DAMP * m.liftRate) * dt;
    m.lift = clamp(m.lift + m.liftRate * dt, -.2, .14);
  }
  // The nose's pitch and the roll: along the ground on it, along the arc in
  // the air, and round to the ground coming down to it
  tilt(dt, speed) {
    const m = this.motion, ground = this.groundTilt(speed);
    if (!m.aloft || m.sinking) {
      if (m.sinking) return;
      m.pitch = THREE.MathUtils.damp(m.pitch, ground.pitch, 10, dt || 1);
      m.roll = THREE.MathUtils.damp(m.roll, ground.roll, 9, dt || 1);
      return;
    }
    const flying = clamp(Math.atan2(m.vy, Math.max(1, Math.abs(speed))) * FOLLOW, -PITCH_MOST, PITCH_MOST);
    const near = clamp(1 - (m.y - this.support()) / LEVEL, 0, 1) ** 2;
    m.pitch = THREE.MathUtils.damp(m.pitch, flying + (ground.pitch - flying) * near, 2.6 + 6 * near, dt);
    m.roll = THREE.MathUtils.damp(m.roll, ground.roll * near, 2 + 6 * near, dt);
  }
  // Whether the car clears a standing thing (see collideScenery): up on a
  // ramp or over a roof, over furniture, a railing or a parked car, or for
  // anything else high over the street. `contact` is where they would meet.
  passes(solid, contact) {
    const m = this.motion, bottom = m.y, at = contact?.point ?? m.groundedPosition;
    if (!Number.isFinite(bottom)) return false;
    if (solid.top !== undefined) {
      if (bottom >= roofSurface(solid, at) - STEP) return true;
      // (on it already: up a ramp, over a mound)
      return Boolean(solid.shape) && this.on(solid);
    }
    const street = this.ground[4];
    if (solid.base !== undefined) return bottom >= solid.base + (solid.height ?? 1.2);
    if (solid.prop) return bottom >= propTop(solid);
    if (solid.parked) return bottom >= street + (solid.parked.height ?? 2) || this.on(solid);
    return bottom - street > AIRBORNE;
  }
  // Whether a wheel stands on `solid` (a ramp, a mound, a car's roof). A
  // parked car woken under it (see CityTraffic.stomp) is the one it stood on.
  on(solid) {
    const m = this.motion, sp = Math.sin(m.pitch), sr = Math.sin(m.roll), bay = solid?.car?.parked;
    for (let i = 0; i < 5; i++) {
      if (this.solids[i] !== solid && !(bay && this.solids[i] === bay)) continue;
      const [along, across] = this.layout[i];
      if (m.y + along * sp + across * sr >= this.heights[i] - STEP) return true;
    }
    return false;
  }
  // The share of grip the tyres have, a moment after landing just off the
  // way the car is going: it slides, then bites
  get grip() { return this.settle >= SETTLE ? 1 : .18 + .82 * this.settle / SETTLE; }
}
