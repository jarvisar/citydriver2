import * as THREE from 'three';
import { clamp } from './world/route.js';
import { collisionImpulse, leadingPoint, rock, rockFrom, SCENERY_SURFACE } from './impact.js';
import { roofUnder, sceneryContacts } from './collision.js';
import { propTop } from './loose-props.js';
import { PLANE_SHAPE } from './plane-model.js';
import { landward, meetPiers } from './helicopter.js';

// How the plane flies: an arcade toy, as the helicopter is. Hands off in the
// air it levels its wings and cruises at CRUISE, holding its height; forward
// and brake speed it up and slow it down, steering banks it into a turn, and
// climb and descend pitch it up and down. On the ground it taxis on its
// nose wheel, and once fast enough climb lifts it off (full throttle alone
// does too, a little later). It never flies into the ground: near it the
// dive flattens out, so holding descend sets it down on whatever is below,
// street, park or flat roof. Over the water it only skims: it has no floats.
// A double tap on a steering direction rolls it right round, and on climb it
// loops the loop.
//
// Speeds in m/s, rates in 1/s, angles in radians, heights in meters.
//   MIN, CRUISE     the slowest it flies (brake held) and its speed hands off
//   LIFT, ROTATE    on the ground, climb lifts it off from LIFT; full throttle alone at ROTATE
//   REVERSE         it backs up this slowly on the ground
//   EASE, AIR_BRAKE how fast it slows to cruise hands off, and to MIN on the brake (m/s²)
//   ROLLING         how fast it slows rolling along the ground hands off (m/s²)
//   GRAVITY         the share of a climb or dive's weight that goes into its speed (m/s²)
//   CLIMB, DIVE     how steeply it climbs and dives with the button all the way down
//   BANK, TURN      its steepest bank, and how fast that turns it at cruise
//   GROUND_TURN     how fast the nose wheel turns it, taxiing
//   SAG             how fast it sinks once it has slowed to a stop in the air
//   FLARE           descending near the floor, it sinks no faster than
//                   FLARE[0] plus FLARE[1] m/s a meter up: it settles on rather than hits
//   HARD            a touchdown faster than this (m/s down) bounces it
//   SKIM            the least it flies over the water
//   AIRBORNE        above the street by this much it clears traffic, people, walls and railings
//   STEP            the highest a roof or curb can be above the wheels to roll onto; higher is a wall
//   CEILING         its highest, over the ground
//   APPROACH, GLIDE landing on its own (see `land`): its speed, and how fast it comes down,
//   SHORE           and over the water, how high it keeps making for the shore
//   CIRCLE          with nobody aboard, it circles down at this bank while more than
//                   CIRCLE_ABOVE m over the street, so it comes down near where it was
//                   left, among the streets built round the player (a straight glide
//                   from 60 m up ran 400 m)
const MIN = 17, CRUISE = 34, LIFT = 19, ROTATE = 25, REVERSE = 4;
const EASE = 3.5, AIR_BRAKE = 8, ROLLING = 2.6, GRAVITY = 5;
const CLIMB = .5, DIVE = .6, PITCH_RATE = 2.4, BANK = 1, BANK_RATE = 4.5, TURN = .95, GROUND_TURN = 1.3;
const SAG = 9, FLARE = [1.1, .75], HARD = 4.5, SKIM = 1.1, AIRBORNE = 2.5, STEP = .7, CEILING = 120;
const APPROACH = 22, GLIDE = 3.2, SHORE = 14, CIRCLE = .3, CIRCLE_ABOVE = 10;
// Flying into something, it keeps all but GLANCE of its speed met square
// on, less met at a slant, and is pushed off at up to PUSH_OFF m/s
const GLANCE = .45, PUSH_OFF = 2.5;
// A bridge's deck a little too low to pass under (by no more than DUCK),
// it ducks under it at DUCKING m/s
const DUCK = 1.2, DUCKING = 12;
// The engine's share of full power idling on the ground, and how fast it spools
const IDLE = .26, SPOOL = 1.6;
// Its knock (a slide a blow leaves it) fades at SLIDE_GRIP in the air, and
// quicker on its wheels
const SLIDE_GRIP = 1.6, WHEEL_GRIP = 5;
// Stunts. A tap is a press let go within TAP s, and a second within DOUBLE s
// of the first is a double tap. A loop is LOOP_RADIUS round, flown no slower
// than LOOP_SPEED, and needs LOOP_ROOM under it; a roll takes ROLL_TIME and
// steps it SIDESTEP to that side.
const TAP = .28, DOUBLE = .36, LOOP_RADIUS = 22, LOOP_SPEED = 24, LOOP_ROOM = 5, ROLL_TIME = .8, SIDESTEP = 5;
// Where its wheels meet the ground (across, along) from the middle of the
// footprint, and where the wing is: its height over the wheels, how far
// ahead of the middle, and its chord
const FEET = [[0, 0], [-1.02, .15], [1.02, .15], [0, 2.85]];
const WING = { y: 2.25, along: .75, chord: 1.6 };
// A blow this hard (m/s) is a crash, as a car's is (see vehicle.js): the pad rumbles
const TOUCH = 1, CRASH = 6;
const TWO_PI = Math.PI * 2;
// How tall it stands, wheels to fin, for going under a bridge
const TOP = 2.8;

const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const smootherstep = t => t * t * t * (t * (t * 6 - 15) + 10);

export class Plane {
  constructor(vehicle, parts) {
    this.vehicle = vehicle; this.parts = parts;
    // Airspeed along its path, the path's pitch (it loops right round, so it
    // is not kept to a turn), its bank, the extra turn of a barrel roll, and
    // the slide a blow leaves it with
    this.speed = 0; this.pitch = 0; this.bank = 0; this.roll = 0; this.slide = { x: 0, z: 0 };
    this.vx = 0; this.vz = 0; this.vy = 0; this.y = NaN; this.below = NaN; this.landed = true; this.blocked = false;
    // (the street right under it, and whether that is water, as `floor` last found them)
    this.ground = NaN; this.water = false;
    // The engine's power, the propeller's turn, how far the wheels have rolled and the nose wheel's steer
    this.power = IDLE; this.angle = 0; this.rolled = 0; this.steer = 0;
    // How the controls stand, for the model's surfaces: -1 to 1
    this.aileron = 0; this.elevator = 0; this.rudder = 0;
    // A stunt under way ({ kind: 'loop', from, turned } or { kind: 'roll', side, t }),
    // double taps being watched for, the clock, and time aloft
    this.stunt = null; this.taps = { climb: { held: false, at: -Infinity }, left: { held: false, at: -Infinity }, right: { held: false, at: -Infinity } };
    this.time = 0; this.aloft = 0;
    // Flown by nobody (someone bailed out, see OnFoot): it comes down by
    // itself and, stopped, its engine dies
    this.unmanned = false;
    // What it has to tell the player (stunts, landings), drained by `drain`
    this.events = [];
    this.feet = FEET.map(() => ({ x: 0, z: 0 }));
    const data = vehicle.car.userData;
    // (the chase camera sits a little further back for the wings and leans
    // with a climb, and the first-person view banks and pitches with the body)
    data.chaseScale = 1.2; data.chasePitch = 0; data.flight = { body: vehicle.body };
  }
  get velocity() { return { x: this.vx, z: this.vz }; }
  // Its height over what is under it
  get height() { return this.y - this.below; }
  // Stopped on its wheels with its engine dead: left, it is parked
  get settled() { return this.landed && Math.abs(this.speed) < .3 && this.power < .06; }
  drain() { const events = this.events; this.events = []; return events; }
  // Stop dead where it is: on the ground, at rest; in the air, it will fall and pick up speed
  stop() { this.speed = 0; this.vx = this.vz = this.vy = 0; this.slide.x = this.slide.z = 0; this.stunt = null; this.roll = 0; }
  // Stop and set down on whatever is under it (a reset)
  land() { this.stop(); this.y = NaN; this.landed = true; this.pitch = this.bank = 0; }
  // Taking over from another machine: moving as it was, where it was
  takeOver(heading, speed, y) {
    const v = this.vehicle;
    this.speed = Math.max(0, speed); this.y = this.below = y;
    // (no higher than a step up: its nose wheel reaches further than a car's
    // nose, and from beside a tower it once stood on the tower's roof)
    this.below = this.floor(v.s, v.u, heading, Number.isFinite(y) ? y + STEP : Infinity);
    this.landed = this.y <= this.below + .05 && !this.water;
    if (this.landed) this.y = this.below;
    this.vx = Math.sin(heading) * this.speed; this.vz = -Math.cos(heading) * this.speed;
  }
  // What it would stand on at (s, u) facing `heading`, no higher than
  // `below`: the street under each wheel, over the water SKIM above it, or a
  // roof there. `blocked` says whether the street under a wheel is higher than
  // that: it has run into a quay or a bridge's side, a wall. Low enough under
  // a bridge's deck, the water is under it and the deck a ceiling
  // (`ceiling`, the highest it can be; `bridged`, under one now).
  floor(s, u, heading, below) {
    const route = this.vehicle.route, cos = Math.cos(heading), sin = Math.sin(heading), feet = this.feet;
    let floor = -Infinity, centre = 0;
    this.blocked = false; this.ceiling = Infinity;
    for (let i = 0; i < FEET.length; i++) {
      const [across, along] = FEET[i], fs = s - across * sin + along * cos, fu = u + across * cos + along * sin;
      const deck = route.under?.(fs, fu), under = Boolean(deck) && this.y + TOP <= deck.lid + DUCK;
      const height = under ? deck.water : route.height(fs, fu), water = under || Boolean(route.water?.(fs, fu)), street = water ? height + SKIM : height;
      if (under) this.ceiling = Math.min(this.ceiling, deck.lid - TOP);
      if (!i) { centre = street; this.ground = height; this.water = water; this.bridged = under; }
      if (street > below) this.blocked = true; else floor = Math.max(floor, street);
      const p = route.position(fs, fu, 0); feet[i].x = p.x; feet[i].z = p.z;
    }
    const scenery = this.vehicle.scenery;
    if (scenery) floor = Math.max(floor, roofUnder(scenery.values(), feet, below, true));
    return floor === -Infinity ? centre : floor;
  }
  // Whether its wheels and fuselage clear a standing thing (see
  // collideScenery): over a building's roof or the top of a piece of
  // furniture, or anything else once it is well off the street. Anything
  // standing on a bridge it is under is over its head. (Its wings meet only
  // buildings: see `wings`.)
  passes(solid) {
    if (solid.top !== undefined) return this.y >= (solid.ridge ?? solid.top) - STEP;
    if ((solid.base ?? this.vehicle.route.height(-solid.z, solid.x)) > this.y + TOP) return true;
    if (solid.prop) return this.y >= propTop(solid);
    return this.vehicle.airborne;
  }
  // A double tap of `key` (see TAP): `value` how far it is pressed now
  tapped(key, value) {
    const tap = this.taps[key];
    if (value > .6 && !tap.held) {
      tap.held = true;
      const double = this.time - tap.at < DOUBLE;
      tap.at = double ? -Infinity : this.time;
      return double;
    }
    if (value < .3 && tap.held) { tap.held = false; if (this.time - tap.at > TAP) tap.at = -Infinity; }
    return false;
  }
  update(dt, input) {
    const v = this.vehicle, stats = v.stats, telemetry = v.audioTelemetry, top = stats.topSpeed;
    v.copyPose(v.previousPose, v.currentPose);
    this.time += dt;
    let forward = clamp(Number(input.forward) || 0, 0, 1), back = clamp(Number(input.brake) || 0, 0, 1);
    let steering = clamp((Number(input.right) || 0) - (Number(input.left) || 0), -1, 1);
    let climb = clamp(Number(input.climb) || 0, 0, 1), descend = clamp(Number(input.descend) || 0, 0, 1);
    // An overhead view's stick points where to go: turn that way, and push further to go faster
    const touch = input.touchDrive;
    if (touch) {
      const off = touch.amount ? wrap(touch.heading - v.heading) : 0;
      steering = clamp(off * 2, -1, 1); forward = clamp((touch.amount - .6) / .4, 0, 1); back = 0;
    }
    // Setting down by itself (see OnFoot's landing, and a plane left flying)
    const landing = Boolean(input.land) || this.unmanned;
    if (landing) { forward = 0; steering = 0; climb = 0; descend = 0; back = this.landed && this.speed > .3 ? 1 : 0; }
    if (!Number.isFinite(this.y)) { this.y = this.below = this.floor(v.s, v.u, v.heading, Infinity); this.landed = !this.water; }
    // Stunts, from double taps, only up in the air with room to fly them
    if (dt && !landing) {
      const roll = this.tapped('right', steering) ? 1 : this.tapped('left', -steering) ? -1 : 0, loop = this.tapped('climb', climb);
      if (!this.stunt && !this.landed && this.speed > MIN) {
        if (loop && this.speed >= LOOP_SPEED && this.height > LOOP_ROOM) this.stunt = { kind: 'loop', from: this.pitch, turned: 0 };
        else if (roll) this.stunt = { kind: 'roll', side: roll, t: 0 };
      }
    }
    const headingBefore = v.heading, loop = this.stunt?.kind === 'loop' ? this.stunt : null, barrel = this.stunt?.kind === 'roll' ? this.stunt : null;
    if (this.landed) {
      // Taxiing: the throttle and the brakes, the nose wheel, and off it goes once fast enough
      let pull;
      if (forward) pull = forward * stats.acceleration * clamp(1 - this.speed / (top * 1.1), .15, 1);
      else if (back) pull = this.speed > .3 ? -back * stats.braking : -back * 3;
      else pull = -Math.sign(this.speed) * Math.min(ROLLING, Math.abs(this.speed) / Math.max(dt, 1e-6));
      const before = this.speed;
      this.speed = clamp(this.speed + pull * dt, -REVERSE, top);
      if (!forward && !back && before * this.speed < 0) this.speed = 0;
      const grip = clamp(Math.abs(this.speed) / 2.5, 0, 1) * (1 - .6 * clamp((Math.abs(this.speed) - 8) / 25, 0, 1));
      v.yawRate = dt ? THREE.MathUtils.damp(v.yawRate, steering * GROUND_TURN * grip * Math.sign(this.speed || 1), 8, dt) : v.yawRate;
      this.steer = dt ? THREE.MathUtils.damp(this.steer, steering, 10, dt) : this.steer;
      this.bank = dt ? THREE.MathUtils.damp(this.bank, 0, 6, dt) : 0;
      // (the nose comes up a little as it gets going, ready to fly)
      const rotating = climb * clamp((this.speed - LIFT * .7) / (LIFT * .3), 0, 1) * .12;
      this.pitch = dt ? THREE.MathUtils.damp(this.pitch, rotating, 6, dt) : rotating;
      if (this.speed >= LIFT && (climb > .3 || (forward > .5 && this.speed >= ROTATE))) { this.landed = false; this.aloft = 0; this.pitch = Math.max(this.pitch, .1); }
      this.aileron = 0; this.elevator = climb - descend; this.rudder = this.steer;
    } else {
      // Flying: toward the speed the pedals ask for, cruising with neither,
      // and a climb's weight taken off it and a dive's given to it
      this.aloft += dt;
      const target = landing ? APPROACH : CRUISE + (top - CRUISE) * forward - (CRUISE - MIN) * back;
      if (this.speed < target) this.speed = Math.min(target, this.speed + stats.acceleration * (forward ? 1 : .6) * dt);
      else this.speed = Math.max(target, this.speed - (back || landing ? AIR_BRAKE : EASE) * dt);
      this.speed = clamp(this.speed - GRAVITY * Math.sin(this.pitch) * dt, 0, top + 14);
      if (loop) {
        // Round the loop at its own rate, wings level, whatever is asked
        loop.turned += Math.max(this.speed, LOOP_SPEED - 4) / LOOP_RADIUS * dt;
        this.pitch = loop.from + Math.min(loop.turned, TWO_PI);
        if (dt) this.bank = THREE.MathUtils.damp(this.bank, 0, 10, dt);
        this.elevator = 1; this.aileron = 0;
      } else {
        // (landing over the water, it heads for the nearest street first, high
        // enough to clear the quay)
        const seek = landing && this.water ? landward(this) : null;
        let pitch = seek !== null ? clamp((SHORE - (this.y - this.ground)) / 20, -.15, .3) : landing ? -Math.asin(clamp(GLIDE / Math.max(this.speed, 1), 0, .5)) : climb * CLIMB - descend * DIVE;
        // (slowed right down, its nose drops until it has the speed to fly)
        if (this.speed < MIN) pitch = Math.min(pitch, -.7 * (1 - this.speed / MIN));
        pitch = Math.min(pitch, (CEILING - (this.y - this.ground)) / 25);
        const circling = this.unmanned && seek === null && this.y - this.ground > CIRCLE_ABOVE;
        const bank = seek !== null ? clamp(wrap(seek - v.heading) * 1.2, -.6, .6) : circling ? CIRCLE * (this.bank < 0 ? -1 : 1) : landing || barrel ? 0 : steering * BANK;
        if (dt) { this.pitch = THREE.MathUtils.damp(this.pitch, pitch, PITCH_RATE, dt); this.bank = THREE.MathUtils.damp(this.bank, bank, BANK_RATE, dt); }
        this.aileron = barrel ? barrel.side : steering; this.elevator = climb - descend;
      }
      // Turning with the bank, tighter slow than fast
      const turn = TURN * Math.sin(this.bank) / Math.sin(BANK) * clamp(Math.sqrt(CRUISE / Math.max(this.speed, 1)), .75, 1.35);
      v.yawRate = loop ? 0 : turn * clamp(this.speed / MIN, .3, 1);
      this.rudder = this.aileron * .5; this.steer = dt ? THREE.MathUtils.damp(this.steer, 0, 4, dt) : 0;
    }
    v.heading += (v.yawRate + v.knock.spin) * dt;
    v.knock.spin *= Math.exp(-dt * 4);
    // Up and down: along its path, sinking once too slow to fly, and near
    // the floor never faster than it can settle
    const height = this.y - this.below, sag = this.landed ? 0 : Math.max(0, MIN - this.speed) / MIN * SAG;
    this.vy = this.landed ? 0 : this.speed * Math.sin(this.pitch) - sag;
    if (!this.landed && !loop && this.vy < 0) {
      const most = FLARE[0] + Math.max(0, height) * FLARE[1];
      if (this.vy < -most) {
        this.vy = -most;
        // (the path flattens, and the nose with it, never up: a stalled plane only sinks slower)
        if (this.speed > 1) this.pitch = Math.max(this.pitch, Math.min(0, Math.asin(clamp((this.vy + sag) / this.speed, -1, 1))));
      }
    }
    // Along and across the way it faces: its own way, a roll's step aside, and the slide
    const fx = Math.sin(v.heading), fz = -Math.cos(v.heading), rx = Math.cos(v.heading), rz = Math.sin(v.heading);
    const along = this.speed * Math.cos(this.pitch);
    let aside = 0;
    if (barrel) {
      barrel.t = Math.min(1, barrel.t + dt / ROLL_TIME);
      aside = barrel.side * SIDESTEP * Math.PI / (2 * ROLL_TIME) * Math.sin(Math.PI * barrel.t);
      this.roll = barrel.side * TWO_PI * smootherstep(barrel.t);
    }
    const grip = Math.exp(-dt * (this.landed ? WHEEL_GRIP : SLIDE_GRIP));
    this.slide.x *= grip; this.slide.z *= grip;
    this.vx = fx * along + rx * aside + this.slide.x; this.vz = fz * along + rz * aside + this.slide.z;
    // Move, unless the ground ahead rises into it (a quay seen from the water,
    // a bridge's side): then keep whichever half of the move stays clear, or
    // failing that stay put, and it is a crash
    const fromS = v.s, fromU = v.u;
    this.y += this.vy * dt;
    const limit = this.y + STEP;
    v.shift(this.vx * dt, this.vz * dt);
    let floor = this.floor(v.s, v.u, v.heading, limit);
    if (this.blocked) {
      const toU = v.u;
      v.u = fromU; floor = this.floor(v.s, v.u, v.heading, limit);
      if (this.blocked) { v.s = fromS; v.u = toU; floor = this.floor(v.s, v.u, v.heading, limit); }
      if (this.blocked) { v.u = fromU; floor = this.floor(v.s, v.u, v.heading, limit); }
      if (this.blocked) { v.heading = headingBefore; v.yawRate = 0; floor = this.floor(v.s, v.u, v.heading, limit); }
      if (dt && this.speed > 4) this.strike(0, 0, 0, this.speed * .5);
      this.speed *= .4; this.slide.x *= .5; this.slide.z *= .5;
    }
    this.below = floor;
    // Under a bridge it flies no higher than the deck, and out from under it, a word
    if (this.y > this.ceiling) {
      if (dt && this.vy > 3) this.strike(0, 0, 0, this.vy);
      if (loop) this.endStunt(true);
      this.y = Math.max(this.ceiling, this.y - DUCKING * dt); this.vy = Math.min(0, this.vy); this.pitch = Math.min(this.pitch, 0);
    }
    if (this.wasBridged && !this.bridged && dt && !this.unmanned) this.events.push({ kind: 'stunt', text: 'Under the bridge' });
    this.wasBridged = this.bridged;
    // Down on the floor: over land it lands, unless it came down too hard or
    // too far over on a wing, and bounces; over the water it only skims
    const wasLanded = this.landed;
    if (this.landed) {
      // (rolled off a ledge: it falls, and flies once it has the speed)
      if (floor < this.y - .35) { this.landed = false; this.aloft = 0; } else this.y = floor;
    } else if (this.y <= floor + .02 && this.vy <= 0 || this.y < floor) {
      const sink = -this.vy;
      this.y = floor;
      if (this.water) { this.vy = Math.max(0, this.vy); this.pitch = Math.max(this.pitch, 0); }
      else if (loop) {
        // (the bottom of a loop begun too low: a hard knock, and out of it)
        this.strike(0, 0, 0, Math.max(sink, 6)); this.endStunt(true);
      } else if (sink > HARD || Math.abs(this.bank) > .6 || barrel) {
        // A bounce: back up off the ground a little, shaken
        this.strike(0, 0, 0, sink + TOUCH); this.speed *= .8; this.bank *= .3;
        this.pitch = Math.asin(clamp(Math.min(3, sink * .35) / Math.max(this.speed, 3), 0, .4));
        if (dt && !this.unmanned) this.events.push({ kind: 'bounce', text: 'Hard landing' });
      } else {
        this.landed = true; this.vy = 0; this.pitch = 0; this.stunt = null; this.roll = 0;
        if (dt && sink > .4) { telemetry.bump = Math.min(.5, sink * .08); telemetry.bumpSerial++; v.jolt.pitchRate -= sink * .03; }
        // (a landing worth a word: gentle, or on a roof)
        if (dt && this.aloft > 3 && !this.unmanned) {
          const roof = floor > this.ground + 1;
          if (roof) this.events.push({ kind: 'landing', text: 'Rooftop landing' });
          else if (sink < 1.3) this.events.push({ kind: 'landing', text: 'Smooth landing' });
        }
      }
    }
    if (this.landed && !wasLanded) this.aloft = 0;
    v.airborne = this.y - this.ground > AIRBORNE;
    v.distance += Math.hypot(v.s - fromS, v.u - fromU);
    // Its wings meet the buildings as well as its wheels do, and low over the
    // river, body and wings, a bridge's piers
    if (v.scenery && !this.landed) this.wings();
    if (this.water) {
      const fx = Math.sin(v.heading), fz = -Math.cos(v.heading);
      meetPiers(this, () => ({ x: v.groundedPosition.x, z: v.groundedPosition.z, heading: v.heading, halfWidth: v.spec.width / 2, halfLength: v.spec.length / 2 }));
      meetPiers(this, () => ({ x: v.groundedPosition.x + fx * WING.along, z: v.groundedPosition.z + fz * WING.along, heading: v.heading, halfWidth: PLANE_SHAPE.span / 2 * Math.abs(Math.cos(v.bodyRoll)), halfLength: WING.chord / 2 }));
    }
    // The stunts come round
    if (loop && loop.turned >= TWO_PI) this.endStunt();
    if (barrel && barrel.t >= 1) this.endStunt();
    rock(v.jolt, dt);
    // The engine: idling on the ground, working in the air, dying once left stopped
    const power = this.unmanned && this.landed && Math.abs(this.speed) < .5 ? 0 : this.landed ? (forward ? 1 : back || Math.abs(this.speed) > .5 ? .4 : IDLE)
      : clamp(.55 + .45 * forward - .2 * back, 0, 1);
    this.power = dt ? THREE.MathUtils.damp(this.power, power, this.unmanned ? 1 : SPOOL, dt) : this.power;
    if (this.power < .02 && power === 0) this.power = 0;
    this.angle += this.power * 58 * dt;
    if (this.landed) this.rolled += this.speed * dt;
    // The controller's state, as the rest of the game reads it
    v.speed = along; v.slideHeading = v.heading; v.steer = 0; v.slip = 0;
    v.drifting = false; v.boosting = false; v.driftAmount = 0; v.weight = 0; v.load = 0;
    v.bodyPitch = this.pitch; v.bodyRoll = -(this.bank + this.roll); v.wheelSpin = this.angle;
    v.pitch = 0; v.roll = 0;
    const data = v.car.userData;
    data.speedRush = clamp((this.speed / top - .45) / .55, 0, 1); data.speed = this.speed;
    data.chaseDip = clamp((this.y - this.ground - 10) / 45, 0, 1);
    // (and under a bridge the chase camera keeps under its deck too)
    data.lid = this.bridged ? this.ceiling + TOP : null;
    // (the chase camera leans with a climb or a dive, and holds still round a loop)
    data.chasePitch = loop ? 0 : clamp(Math.sin(this.pitch) * .55, -.3, .3);
    v.trauma = Math.max(0, v.trauma - dt * 1.4); data.trauma = v.trauma;
    telemetry.speed = this.speed; telemetry.throttle = Math.max(forward, this.landed ? 0 : .35);
    telemetry.brake = this.landed ? back : 0; telemetry.offRoad = 0; telemetry.handbrake = 0; telemetry.boost = 0;
    telemetry.rotor = this.power;
    telemetry.scrape *= Math.exp(-dt * 14);
    if (dt === 0) telemetry.impact = 0;
    this.pose(dt === 0);
  }
  // A stunt comes round: a loop's pitch and a roll's turn go back by a whole
  // turn, in the last pose too, so the body is drawn turning on through it
  endStunt(cut = false) {
    const v = this.vehicle, stunt = this.stunt;
    if (!stunt) return;
    this.stunt = null;
    if (stunt.kind === 'loop') {
      // (cut short, it comes out of the loop from wherever it was, as the
      // pitch eases back: set level at once, it flipped over in a frame)
      const turns = Math.round((this.pitch - (cut ? 0 : stunt.from)) / TWO_PI) * TWO_PI;
      this.pitch -= turns; v.previousPose.bodyPitch -= turns;
      if (!cut && !this.unmanned) this.events.push({ kind: 'stunt', text: 'Loop the loop' });
    } else {
      this.roll = 0; v.previousPose.bodyRoll += stunt.side * TWO_PI;
      if (!cut && !this.unmanned) this.events.push({ kind: 'stunt', text: 'Barrel roll' });
    }
  }
  // The wings against the buildings: the span, less as it banks, across the
  // chord, below a roof. A wingtip clipping a wall swings it round.
  wings() {
    const v = this.vehicle, lean = v.bodyRoll, half = PLANE_SHAPE.span / 2;
    const reach = Math.max(v.spec.width / 2, half * Math.abs(Math.cos(lean))), low = this.y + WING.y - half * Math.abs(Math.sin(lean));
    const fx = Math.sin(v.heading), fz = -Math.cos(v.heading);
    const box = () => ({ x: v.groundedPosition.x + fx * WING.along, z: v.groundedPosition.z + fz * WING.along, heading: v.heading, halfWidth: reach, halfLength: WING.chord / 2 });
    sceneryContacts(box, v.scenery.values(), (contact, solid) => {
      if (solid.top === undefined || low >= (solid.ridge ?? solid.top)) return;
      this.resolveSceneryCollision(contact.x, contact.z, contact.depth, contact.point);
    });
  }
  // Where it stands now, for the controller's poses and the scene
  pose(teleport = false) {
    const v = this.vehicle, p = v.route.position(v.s, v.u, this.y);
    v.groundedPosition.set(p.x, p.y, p.z); v.car.position.copy(v.groundedPosition);
    v.car.rotation.set(0, -v.heading, 0, 'YXZ');
    v.currentPose.position.copy(v.groundedPosition); v.currentPose.quaternion.copy(v.car.quaternion);
    for (const key of ['bodyPitch', 'bodyRoll', 'wheelSpin', 'steer', 'slip']) v.currentPose[key] = v[key];
    // Half the bank for the body and cockpit camera, keeping handling and barrel rolls intact.
    v.currentPose.bodyRoll += this.bank * .5;
    v.currentPose.bodyPitch += v.jolt.pitch; v.currentPose.bodyRoll += v.jolt.roll;
    if (teleport) v.copyPose(v.previousPose, v.currentPose);
    v.render(0);
  }
  // The propeller (from DrivingController.render, with its turn
  // interpolated), the wheels, the nose wheel and the control surfaces
  animate(angle) {
    const { propeller, disc, wheels, nose, surfaces } = this.parts;
    propeller.rotation.z = angle;
    const blur = Math.max(0, this.power - .4) / .6;
    disc.visible = blur > 0; disc.material.opacity = blur * .16;
    for (const wheel of wheels) wheel.group.rotation.x = -this.rolled / wheel.radius;
    if (nose) nose.rotation.y = -this.steer * .5;
    if (surfaces) {
      surfaces.aileronLeft.rotation.x = this.aileron * .35; surfaces.aileronRight.rotation.x = -this.aileron * .35;
      surfaces.elevator.rotation.x = -this.elevator * .35; surfaces.rudder.rotation.y = this.rudder * .35;
    }
  }
  // A blow, as DrivingController.strike takes one: the part along its way is
  // speed (never through rest), the rest a slide that fades, and a turn
  strike(dvx, dvz, spin, impact, scrape = 0) {
    const v = this.vehicle, telemetry = v.audioTelemetry;
    if (impact > TOUCH) {
      telemetry.impact = impact; telemetry.impactSerial++;
      v.trauma = Math.min(1, v.trauma + (impact - TOUCH) / 28);
      if (impact >= CRASH) telemetry.crashSerial++;
    }
    telemetry.scrape = Math.max(telemetry.scrape, scrape);
    const cos = Math.cos(v.heading), sin = Math.sin(v.heading), along = dvx * sin - dvz * cos, flat = Math.cos(this.pitch);
    // (its speed is along its path, so only so much of the blow can go into
    // it climbing or diving steeply, and none of it upside down round a loop)
    let taken = 0;
    if (flat > .3) { const speed = Math.max(0, this.speed + along / flat); taken = (speed - this.speed) * flat; this.speed = speed; }
    this.slide.x += dvx - sin * taken; this.slide.z += dvz + cos * taken;
    v.knock.spin = clamp(v.knock.spin + spin, -3, 3);
    rockFrom(v.jolt, dvx * sin - dvz * cos, dvx * cos + dvz * sin);
  }
  // A building's wall, a tree or a post. Flying into one it is not stopped
  // dead in the air, as a car would be, but glances off, as arcade planes
  // do: slowed the more squarely it met it, pushed off it a little and
  // turned to run along it, away from the side it was hit on, or the way its
  // nose is nearer. Anything else meeting it (a wing along a wall) is a
  // blow, as a car takes one.
  resolveSceneryCollision(nx, nz, depth, point = null) {
    const v = this.vehicle, car = v.motion(), normal = { x: nx, z: nz };
    point ??= leadingPoint(car, normal);
    const blow = collisionImpulse(car, { x: point.x, z: point.z, vx: 0, vz: 0, mass: Infinity }, normal, point, SCENERY_SURFACE);
    const fx = Math.sin(v.heading), fz = -Math.cos(v.heading), rx = Math.cos(v.heading), rz = Math.sin(v.heading), into = fx * nx + fz * nz;
    if (blow && into < -.1 && !this.landed) {
      const side = (point.x - car.x) * rx + (point.z - car.z) * rz, flip = -nz * fx + nx * fz < 0 ? -1 : 1;
      const way = Math.abs(side) > .8 ? -Math.sign(side) : Math.sign((-nz * rx + nx * rz) * flip) || 1;
      this.speed *= 1 - GLANCE * -into;
      this.slide.x += nx * PUSH_OFF * -into; this.slide.z += nz * PUSH_OFF * -into;
      // (a turn that fades as the knocks do, adding up to most of the angle to the wall: see update)
      const turn = way * Math.min(4, Math.asin(Math.min(1, -into)) * 2.8);
      if (Math.abs(turn) > Math.abs(v.knock.spin)) v.knock.spin = turn;
      this.strike(0, 0, 0, blow.closing, blow.slide);
      rockFrom(v.jolt, blow.a.x * fx + blow.a.z * fz, blow.a.x * rx + blow.a.z * rz);
    } else if (blow) this.strike(blow.a.x, blow.a.z, blow.a.spin, blow.closing, blow.slide);
    v.shift(nx * (depth + .005), nz * (depth + .005));
    this.pose();
  }
}
