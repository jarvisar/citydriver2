import * as THREE from 'three';
import { clamp } from './world/route.js';
import { cityWalker, createWalkerMaterial, setWalkerAppearance } from './world/city-walkers.js';
import { stableShadowDepth } from './world/shadow-depth.js';

// The player on foot: one of the city's own residents (see city-walkers.js),
// walked as a character rather than driven as a car. They go the way the
// stick or the keys point, turn quickly to face it, jog, sprint and hop, and
// stop at whatever stands in their way, round so they slide along a wall and
// round a corner, knocking none of it loose (see collideScenery). They move
// no car either (see CityTraffic.collidePlayer), but a car that runs into
// them knocks them over: a loose body like a resident's (LooseProps.person),
// who lies a moment and gets up where they landed.
//
// Like the helicopter's pilot, the walker keeps the DrivingController's
// shared state (s, u, heading, speed, groundedPosition, poses, telemetry)
// current, so the traffic, the streaming, the maps and the cameras need not
// know the player is walking. Only people shoved aside (PedestrianContacts)
// and the chase camera's framing tell the difference.

// A resident's coat and haircut for the player: an existing look for now
export const PLAYER_LOOK = { look: 13, skin: 2, hair: 1, style: 0 };
// The footprint traffic and the furniture meet: a person's width, round
// (`radius`, see circleContact), and what they weigh in a blow (tonnes)
export const WALKER_SPEC = { name: 'walker', width: .64, length: .64, radius: .32, mass: .08, breaks: [] };

// Speeds in m/s, rates in 1/s
//   JOG, SPRINT     with the stick pushed all the way (or a key), and with sprint held;
//                   a gentle push walks
//   GRIP, AIR       how fast they change speed on their feet and in the air (m/s²)
//   TURN            how quickly they turn to face the way they go
//   TURNING         the turn keys' rate through their own eyes (rad/s)
//   JUMP, GRAVITY   take-off speed and fall (m/s, m/s²): a hop of about .6 m
//   STEP            the highest kerb they step up or down without a hop; a
//                   drop further than that they fall down
//   KNOCK           a car coming at them faster than this (m/s) knocks them over
//   LIE, RISE       seconds lying still once they come to rest, and getting up
const JOG = 4.4, SPRINT = 7.4, GRIP = 24, AIR = 5, TURN = 12, TURNING = 2.6;
const JUMP = 4.6, GRAVITY = 17, STEP = .45, KNOCK = 4, LIE = 1.1, RISE = .7;
// What a car's stats say, for whatever reads them (the sound's gearing, say)
export const WALKER_STATS = { topSpeed: SPRINT, acceleration: GRIP, braking: GRIP, grip: 1, offRoad: SPRINT, reverseSpeed: JOG, cruise: SPRINT };
// Where their eyes are, and how the chase camera frames them: at this share
// of a car's distance and height, lifted this much (see ThirdPersonCamera)
const EYE = new THREE.Vector3(0, 1.62, -.12), CHASE_SCALE = .36, CHASE_LIFT = .75;
// and the overhead views come this much nearer
const OVERHEAD = .5;

const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);
const root = new THREE.Matrix4(), world = new THREE.Matrix4(), place = new THREE.Vector3(), turn = new THREE.Quaternion();
const from = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() };

// The figure, as createCar makes a car's model: one instance of the
// residents' shared geometry and palette shader, in a group that bobs and
// leans about the feet. Nothing to light or paint.
export function createWalkerModel(appearance = PLAYER_LOOK) {
  const car = new THREE.Group(); car.name = 'walker';
  const body = new THREE.Group(); car.add(body);
  const material = createWalkerMaterial(), figure = new THREE.InstancedMesh(cityWalker, material, 1);
  figure.name = 'walker-figure'; figure.castShadow = true; figure.receiveShadow = true;
  setWalkerAppearance(figure, 0, appearance); stableShadowDepth(figure);
  body.add(figure);
  return {
    car, body, figure, wheels: [], nightLights: [],
    applyTrim() {}, paintCar() {},
    // (the geometry is the residents', and stays)
    disposeModel() { figure.dispose(); material.dispose(); },
  };
}

export class Walker {
  constructor(vehicle, model) {
    this.vehicle = vehicle; this.figure = model.figure;
    this.vx = 0; this.vz = 0; this.vy = 0; this.y = NaN; this.grounded = true;
    // How far into their stride they are (radians, a step each turn), how
    // strongly they bob with it, and the clock the getting up keeps
    this.phase = 0; this.stride = 0; this.time = 0; this.jumping = false; this.sprinting = false;
    // Knocked over: their body (see LooseProps.person); getting up: from where it lay
    this.down = null; this.rise = null;
    Object.assign(vehicle.car.userData, { driverEye: EYE, chaseLift: CHASE_LIFT, chaseScale: CHASE_SCALE, overheadScale: OVERHEAD, leash: true, velocity: { x: 0, z: 0 } });
  }
  get velocity() { return { x: this.vx, z: this.vz }; }
  // On their feet, not knocked over or getting up
  get standing() { return !this.down && !this.rise; }
  // Stop where they stand
  stop() { this.vx = this.vz = 0; if (this.grounded) this.vy = 0; }
  // Standing on the ground where the controller is, at rest (stepping out of a car, a reset)
  takeOver() {
    const v = this.vehicle;
    this.stop(); this.vy = 0; this.grounded = true; this.y = v.route.height(v.s, v.u);
  }
  update(dt, input) {
    const v = this.vehicle, telemetry = v.audioTelemetry;
    v.copyPose(v.previousPose, v.currentPose);
    this.time += dt;
    if (!Number.isFinite(this.y)) this.takeOver();
    if (this.down) this.lie();
    else if (this.rise && this.time - this.rise.at >= RISE) this.rise = null;
    const control = !this.down && !this.rise, walk = control ? input.walk : null;
    // The way they want to go, and how fast: the stick's push, a key's all the way
    const amount = walk ? Math.min(1, Math.hypot(walk.x, walk.z)) : 0, top = input.sprint ? SPRINT : JOG;
    const wx = amount ? walk.x * top : 0, wz = amount ? walk.z * top : 0;
    if (control && input.turn) v.heading += input.turn * dt;
    const dx = wx - this.vx, dz = wz - this.vz, gap = Math.hypot(dx, dz), change = Math.min(gap, (this.grounded ? GRIP : AIR) * dt);
    if (gap > 1e-9) { this.vx += dx / gap * change; this.vz += dz / gap * change; }
    // They turn to face the way they are asked to go (not through their own
    // eyes, where the keys turn them and back is a step back)
    if (control && input.face !== false && amount > .05) v.heading += wrap(Math.atan2(wx, -wz) - v.heading) * (1 - Math.exp(-TURN * dt));
    v.heading = wrap(v.heading);
    // A hop, once for each press
    if (control && input.jump && !this.jumping && this.grounded) { this.vy = JUMP; this.grounded = false; }
    this.jumping = Boolean(input.jump);
    // Along the ground, but never into the water: the half of the move that
    // stays dry is kept, so they walk along a quay's edge rather than stick
    const fromS = v.s, fromU = v.u;
    if (!this.down) {
      v.shift(this.vx * dt, this.vz * dt);
      if (this.wet(v.s, v.u) && !this.wet(fromS, fromU)) {
        const toS = v.s, toU = v.u;
        v.u = fromU;
        if (this.wet(v.s, v.u)) { v.s = fromS; v.u = toU; }
        if (this.wet(v.s, v.u)) { v.s = fromS; v.u = fromU; }
        this.vx = (v.u - fromU) / (dt || 1); this.vz = -(v.s - fromS) / (dt || 1);
      }
    }
    // Up a kerb or down it in their stride; off anything higher they fall
    const ground = v.route.height(v.s, v.u), wasGrounded = this.grounded;
    if (this.down) this.y = ground;
    else if (this.grounded && Math.abs(ground - this.y) <= STEP) this.y = ground;
    else {
      if (this.grounded && ground > this.y) { v.s = fromS; v.u = fromU; this.vx = this.vz = 0; }
      else { this.grounded = false; this.vy -= GRAVITY * dt; this.y += this.vy * dt; }
      const under = v.route.height(v.s, v.u);
      if (this.y <= under) { this.y = under; this.vy = 0; this.grounded = true; }
    }
    // Landing thuds; every step is a footfall (see DriveAudio)
    const speed = Math.hypot(this.vx, this.vz), before = this.phase;
    if (this.grounded && !wasGrounded && dt) { telemetry.step = 1; telemetry.stepSerial++; }
    this.sprinting = input.sprint && speed > JOG + .5;
    // (pressed against a wall, each step's little push into it is no stride)
    if (this.grounded && !this.down && !this.rise) this.phase += dt * Math.PI * 2 * (1.6 + speed * .35) * clamp((speed - .3) / 1.2, 0, 1);
    if (Math.floor((this.phase - Math.PI * 1.5) / (Math.PI * 2)) > Math.floor((before - Math.PI * 1.5) / (Math.PI * 2))) { telemetry.step = clamp(speed / SPRINT, .25, 1); telemetry.stepSerial++; }
    this.stride = dt ? THREE.MathUtils.damp(this.stride, this.grounded ? clamp(speed / JOG, 0, 1.3) : 0, 8, dt) : this.stride;
    // The controller's state, as the rest of the game reads it
    v.speed = speed; v.slideHeading = v.heading; v.steer = 0; v.slip = 0; v.yawRate = 0;
    v.drifting = false; v.boosting = this.sprinting; v.driftAmount = 0; v.weight = 0; v.load = 0; v.airborne = false;
    v.pitch = 0; v.roll = 0; v.wheelSpin = this.phase;
    // Leaning into a run, more as they set off; swaying with each step
    const lean = this.down || this.rise ? 0 : clamp(speed * .022 + change / (dt || 1) * .004 * Math.sign(this.vx * dx + this.vz * dz), -.08, .22);
    v.bodyPitch = -lean; v.bodyRoll = Math.sin(this.phase * .5) * .04 * this.stride;
    const data = v.car.userData;
    data.speed = speed; data.speedRush = 0; data.velocity.x = this.down ? 0 : this.vx; data.velocity.z = this.down ? 0 : this.vz;
    v.trauma = Math.max(0, v.trauma - dt * 1.4); data.trauma = v.trauma;
    telemetry.speed = speed; telemetry.throttle = 0; telemetry.brake = 0; telemetry.offRoad = 0; telemetry.steer = 0;
    telemetry.handbrake = 0; telemetry.boost = 0; telemetry.slip = 0; telemetry.scrape *= Math.exp(-dt * 14);
    if (dt === 0) telemetry.impact = 0;
    this.pose(dt === 0);
  }
  wet(s, u) { return Boolean(this.vehicle.route.water?.(s, u)); }
  // Knocked over, they go where their body goes, and once it has lain still a
  // moment they get up where it lies (the harbour gives them back at the kerb)
  lie() {
    const v = this.vehicle, body = this.down.body;
    if (body.removed || body.sunk) {
      if (!body.removed) v.props.release(body);
      const lane = v.route.nearestLane?.(v.s, v.u, v.heading);
      if (lane) { v.s = lane.s; v.u = lane.u; }
      this.down = null; this.takeOver();
      return;
    }
    v.s = -body.p.z; v.u = body.p.x;
    if (!body.asleep || body.slept < LIE) return;
    // From where they lie to standing, feet under them, facing on
    v.props.personMatrix(body, world).decompose(from.p, from.q, from.s);
    v.props.release(body);
    this.down = null; this.rise = { at: this.time, from: { p: from.p.clone(), q: from.q.clone(), s: from.s.clone() } };
    this.stop(); this.vy = 0; this.grounded = true;
  }
  // Where they stand now, for the controller's poses and the scene
  pose(teleport = false) {
    const v = this.vehicle, p = v.route.position(v.s, v.u, this.y);
    v.groundedPosition.set(p.x, p.y, p.z); v.car.position.copy(v.groundedPosition);
    v.car.rotation.set(0, -v.heading, 0, 'YXZ');
    v.currentPose.position.copy(v.groundedPosition); v.currentPose.quaternion.copy(v.car.quaternion);
    for (const key of ['bodyPitch', 'bodyRoll', 'wheelSpin', 'steer', 'slip']) v.currentPose[key] = v[key];
    if (teleport) v.copyPose(v.previousPose, v.currentPose);
    v.render(0);
  }
  // The figure, from DrivingController.render with the stride interpolated:
  // bobbing in its stride, or where its body lies and on its way up from there
  animate(phase, origin = 0) {
    const v = this.vehicle, figure = this.figure, body = v.body;
    if (!this.down && !this.rise) {
      figure.position.set(0, 0, 0); figure.quaternion.identity();
      figure.scale.set(1, 1 + Math.cos(phase) * .02 * this.stride, 1);
      body.position.y = (.05 + Math.sin(phase) * .05) * Math.min(1, this.stride);
      return;
    }
    body.position.set(0, 0, 0); body.rotation.set(0, 0, 0);
    // (the figure is placed in the world, under wherever the controller stands)
    place.copy(v.car.position); place.z -= origin;
    root.compose(place, v.car.quaternion, ONE).invert();
    if (this.down) v.props.personMatrix(this.down.body, world);
    else {
      const rise = this.rise, k = THREE.MathUtils.smoothstep(this.time - rise.at, 0, RISE);
      place.copy(v.groundedPosition);
      world.compose(from.p.lerpVectors(rise.from.p, place, k), from.q.slerpQuaternions(rise.from.q, turn.setFromAxisAngle(UP, -v.heading), k), from.s.lerpVectors(rise.from.s, ONE, k));
    }
    world.premultiply(root).decompose(figure.position, figure.quaternion, figure.scale);
  }
  // A blow (as DrivingController.strike takes one). Hard enough, it knocks
  // them over; otherwise it shoves them.
  strike(dvx, dvz, spin, impact) {
    if (this.down || this.rise) return;
    if (impact > KNOCK) { this.knockDown(dvx, dvz); return; }
    this.vx += dvx; this.vz += dvz;
  }
  // Knocked flying the way the blow went, as a car coming that way would
  // knock a resident (see LooseProps.person)
  knockDown(vx, vz) {
    const v = this.vehicle, props = v.props, speed = Math.hypot(vx, vz);
    if (!props || speed < 1e-3) { this.vx += vx; this.vz += vz; return; }
    const p = v.groundedPosition, dx = vx / speed, dz = vz / speed;
    world.compose(p, turn.setFromAxisAngle(UP, -v.heading), ONE);
    const car = { x: p.x - dx * 2.6, z: p.z - dz * 2.6, heading: Math.atan2(dx, -dz), halfWidth: 1, halfLength: 2.2, vx, vz, spin: 0, mass: 1.7, y: p.y, height: 1.5 };
    this.down = { body: props.person(cityWalker, world, car).body };
    this.stop(); this.vy = 0; this.grounded = true; this.rise = null;
    v.trauma = Math.min(1, v.trauma + .5); v.audioTelemetry.impact = speed; v.audioTelemetry.impactSerial++;
  }
  // A car against them (see CityTraffic.collidePlayer): they are put back
  // outside it. One that came at them hard knocks them over; one that
  // merely leans on them carries them along; one they walked into stops them.
  resolveTrafficCollision(dx, dz, dvx, dvz, spin, impact) {
    const v = this.vehicle, length = Math.hypot(dx, dz);
    if (this.down) return;
    v.shift(dx, dz);
    if (length > 1e-9) {
      // (their own speed out along (nx, nz), and the car's: they closed at `impact`)
      const nx = dx / length, nz = dz / length, into = this.vx * nx + this.vz * nz, theirs = impact + into;
      if (theirs > KNOCK && !this.rise) this.knockDown(nx * theirs, nz * theirs);
      else if (into < Math.max(0, theirs)) { const add = Math.max(0, theirs) - into; this.vx += nx * add; this.vz += nz * add; }
    }
    this.pose();
  }
  // A wall, a tree or a post: they are put back outside it, and slide along it
  resolveSceneryCollision(nx, nz, depth) {
    const v = this.vehicle, into = this.vx * nx + this.vz * nz;
    v.shift(nx * (depth + 1e-4), nz * (depth + 1e-4));
    if (into < 0) { this.vx -= into * nx; this.vz -= into * nz; }
    this.pose();
  }
  // Pushing past someone they shove aside (see PedestrianContacts), who is
  // that way, (nx, nz): they keep only `keep` of their way toward them, and
  // are put back `depth` where the other gives no further. (From the render,
  // so the scene catches up at the next frame's.)
  brush(nx, nz, depth = 0, keep = 1) {
    const v = this.vehicle, into = this.vx * nx + this.vz * nz;
    if (into > 0) { this.vx -= into * nx * (1 - keep); this.vz -= into * nz * (1 - keep); }
    if (!(depth > 0) || this.down) return;
    v.shift(-nx * depth, -nz * depth);
    const p = v.route.position(v.s, v.u, this.y);
    v.groundedPosition.set(p.x, p.y, p.z); v.currentPose.position.copy(v.groundedPosition);
  }
  // Only the helicopter clears what it meets (see collideScenery)
  passes() { return false; }
}

// What the controls ask of someone on foot, from the input's state (see
// Input: moveX / moveY, the touch stick, lookX, jump and sprint) and the
// camera they are seen through: `walk`, the way to go in the world (x east,
// z south), as long as the stick is pushed; `face`, whether to turn that
// way; `turn`, a turn of their own (rad/s). Chased or seen from above they
// go the way the stick points on the screen; through their own eyes,
// forward and back go the way they face and the sides turn them, as in a
// first-person game played on keys. `out` is filled and returned.
export function walkingInput(state, camera, { firstPerson = false, heading = 0 } = {}, out = { walk: { x: 0, z: 0 } }) {
  let x = clamp(Number(state.moveX) || 0, -1, 1), y = clamp(Number(state.moveY) || 0, -1, 1);
  const stick = state.touchStick;
  if (stick && (stick.x || stick.y)) { x = stick.x; y = stick.y; }
  out.jump = Boolean(state.jump); out.sprint = Boolean(state.sprint); out.face = !firstPerson; out.turn = 0;
  const walk = out.walk;
  walk.x = walk.z = 0;
  if (firstPerson) {
    out.turn = clamp(x + (Number(state.lookX) || 0), -1, 1) * TURNING;
    walk.x = Math.sin(heading) * y; walk.z = -Math.cos(heading) * y;
    return out;
  }
  const amount = Math.min(1, Math.hypot(x, y));
  if (!amount) return out;
  camera.updateMatrixWorld();
  const m = camera.matrixWorld.elements;
  let gx, gz;
  if (camera.isPerspectiveCamera) {
    // (the camera's right, and its forward laid flat on the ground)
    const rx = m[0], rz = m[2], fx = -m[8], fz = -m[10], r = Math.hypot(rx, rz) || 1, f = Math.hypot(fx, fz) || 1;
    gx = x * rx / r + y * fx / f; gz = x * rz / r + y * fz / f;
  } else {
    // Seen from above, the ground direction that crosses the screen the way the stick does
    const det = m[0] * m[6] - m[2] * m[4];
    if (Math.abs(det) < 1e-6) return out;
    gx = (x * m[6] - m[2] * y) / det; gz = (m[0] * y - m[4] * x) / det;
  }
  const length = Math.hypot(gx, gz);
  if (length < 1e-9) return out;
  walk.x = gx / length * amount; walk.z = gz / length * amount;
  return out;
}
