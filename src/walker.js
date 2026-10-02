import * as THREE from 'three';
import { clamp } from './world/route.js';
import { cityWalker, createWalkerMaterial, setWalkerAppearance, setWalkerTurn, walkerDepthMaterial, walkerPose } from './world/city-walkers.js';
import { stableShadowDepth } from './world/shadow-depth.js';
import { roofAt, roofSurface } from './collision.js';
import { propTop } from './loose-props.js';
import { SEA_REACH } from './helicopter.js';

// The player on foot: one of the city's own residents (see city-walkers.js),
// walked as a character rather than driven as a car. They go the way the
// stick or the keys point, turn quickly to face it, jog, sprint and jump, and
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
//
// With no limbs, the figure moves as a cartoon does: each step a little hop,
// the body squashed as it lands and stretched as it leaves the ground, and
// the floating head a moment behind it, dipping and nodding as the body
// stops and starts. It leans into a run and banks into turns, and the head
// turns first into a turn, and to look at whatever is about (`watch`).

// A resident's coat and haircut for the player: an existing look for now
export const PLAYER_LOOK = { look: 13, skin: 2, hair: 1, style: 0, outfit: 9, face: 0, gear: 1, legs: 0, accent: 1 };
// The footprint traffic and the furniture meet: a person's width, round
// (`radius`, see circleContact), and what they weigh in a blow (tonnes)
export const WALKER_SPEC = { name: 'walker', width: .64, length: .64, radius: .32, mass: .08, breaks: [] };

// Speeds in m/s, rates in 1/s
//   JOG, SPRINT     with the stick pushed all the way (or a key), and with sprint held;
//                   a gentle push walks
//   GRIP, AIR       how fast they change speed on their feet and in the air (m/s²)
//   TURN            how quickly they turn to face the way they go
//   STEP            the highest kerb they step up or down without a jump. A
//                   drop further than that they fall down
//   KNOCK           a car coming at them faster than this (m/s) knocks them over
//   LIE, GET_UP     seconds lying still once they come to rest, and getting up
const JOG = 4.4, SPRINT = 7.4, GRIP = 24, AIR = 5, TURN = 12;
const STEP = .45, KNOCK = 4, LIE = 1.1, GET_UP = .7;
// More than AIRBORNE m over the street (on a roof, falling or under a
// parachute), the traffic and what stands in the street take no notice of them
const AIRBORNE = 2.5;
// Jumping as platformers do it (m/s, m/s², s): off the ground at JUMP, slowed
// by RISE while the button is held on the way up and by LET_GO once it is let
// go, so a tap hops about half a metre and a held press jumps about a metre,
// and falling faster than they rose, at FALL. A second press in the air
// flips them over and on up at FLIP, once a jump. A press up to BUFFER
// before they land jumps as they land, and one up to COYOTE after they step
// off an edge still jumps.
const JUMP = 5.2, FLIP = 4.6, RISE = 13, LET_GO = 34, FALL = 24, BUFFER = .13, COYOTE = .1;
// Down from high up faster than HARD_LANDING (m/s), still on their feet, the
// view shakes and the pad thumps, as for a car's hard landing (see CarAir)
const HARD_LANDING = 12;
// A flip is once round, forward, about their middle, over FLIP_TIME s
const FLIP_TIME = .42, MIDDLE = .95;
// With more than CHUTE_ROOM to go, a tap of jump opens their pack into a
// parachute over CHUTE_OPEN s, and another folds it away again (the user's
// request: it used to open by itself). Under it they come down at CHUTE_SINK
// (faster with sprint held), taking CHUTE_BRAKE to slow to it, and the stick
// steers them at up to CHUTE_GLIDE, the canopy's drag taking CHUTE_PULL m/s²
// off whatever else they had. Down, it folds away over CHUTE_FOLD s. The
// camera frames them at CHUTE_FRAME.
const CHUTE_ROOM = 4, CHUTE_OPEN = .45, CHUTE_SINK = 4.2, CHUTE_BRAKE = 3.2, CHUTE_GLIDE = 5.5, CHUTE_PULL = 6, CHUTE_FOLD = .5, CHUTE_FRAME = .8;
// The jetpack: jump held IGNITE s in the air (past a jump's rise, or a tap's
// length) burns it, pushing up at THRUST m/s² against JET_FALL's gravity to
// CLIMB m/s, easing off to hover CEILING m over the street. It flies them at
// up to JET m/s (JET_SPRINT with sprint), turning at JET_GRIP m/s². Let go,
// they fall at JET_FALL, never faster than DIVE, and land on their feet.
// The camera frames them at JET_FRAME.
const IGNITE = .2, THRUST = 34, CLIMB = 9, CEILING = 90, JET = 11, JET_SPRINT = 17, JET_GRIP = 10, JET_FALL = 16, DIVE = 22, JET_FRAME = .7;
// What a car's stats say, for whatever reads them (the sound's gearing, say)
export const WALKER_STATS = { topSpeed: SPRINT, acceleration: GRIP, braking: GRIP, grip: 1, offRoad: SPRINT, reverseSpeed: JOG, cruise: SPRINT };
// Where their eyes are, and how the chase camera frames them: at this share
// of a car's distance and height, lifted this much (see ThirdPersonCamera)
const EYE = new THREE.Vector3(0, 1.62, -.12), CHASE_SCALE = .36, CHASE_LIFT = .75;
// and the overhead views come this much nearer
const OVERHEAD = .5;
// The figure's springs, [stiffness, damping ratio]: the body's squash and
// stretch, and the head over it, which drops and nods a moment behind the
// body. The head keeps its gap over the collar (COLLAR m up) however the body
// squashes, and drops into it no further than DROP.
const SQUASH = [320, .35], BOB = [260, .3], NOD = [180, .4], COLLAR = 1.13, DROP = .03;
// The head turns up to LOOK_MOST from the body: LEAD of the way into a turn
// they are making (quickly, at LEAD_RATE), or to watch something within
// WATCH m that is not behind them (at LOOK_RATE, springs per second)
const LOOK_MOST = 1.1, LEAD = .8, LEAD_RATE = 18, WATCH = 12, LOOK_RATE = 6;
// Hopping into a car and down out of one (see OnFoot): how high the hop
// arcs (m), how long getting out takes (s), and how far they shrink into the
// seat, where the car's body hides them. Into a car, the hop to its door
// takes DOOR of the time and the rest is climbing in.
const HOP = .35, ALIGHT = .42, SEATED = .55, DOOR = .6;

const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
// A damped spring kept on `s` ({ x, v }), pulled toward `goal`
function spring(s, goal, [stiffness, ratio], dt) {
  s.v += (stiffness * (goal - s.x) - 2 * ratio * Math.sqrt(stiffness) * s.v) * dt;
  s.x += s.v * dt;
}
// A turn on a critically damped spring (the head's), kept on `s` ({ x, v })
function turnToward(s, goal, rate, dt) {
  for (let left = dt; left > 1e-6; left -= 1 / 120) {
    const step = Math.min(left, 1 / 120);
    s.v += (rate * rate * wrap(goal - s.x) - 2 * rate * s.v) * step;
    s.x += s.v * step;
  }
}
const UP = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0), ONE = new THREE.Vector3(1, 1, 1);
const root = new THREE.Matrix4(), world = new THREE.Matrix4(), place = new THREE.Vector3(), turn = new THREE.Quaternion();
const from = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() };
const tilt = new THREE.Matrix4(), yaw = new THREE.Matrix4(), unyaw = new THREE.Matrix4(), euler = new THREE.Euler(0, 0, 0, 'YXZ');

// The figure, as createCar makes a car's model: one instance of the
// residents' shared geometry and palette shader, in a group that bobs and
// leans about the feet. Nothing to light or paint. Its material and shadow
// read its own pose (see walkerPose), which the residents' do not.
export function createWalkerModel(appearance = PLAYER_LOOK) {
  const car = new THREE.Group(); car.name = 'walker';
  const body = new THREE.Group(); car.add(body);
  const posture = walkerPose(), material = createWalkerMaterial(posture), figure = new THREE.InstancedMesh(cityWalker, material, 1);
  figure.name = 'walker-figure'; figure.castShadow = true; figure.receiveShadow = true;
  figure.customDepthMaterial = walkerDepthMaterial(posture); figure.userData.posture = posture;
  setWalkerAppearance(figure, 0, appearance);
  body.add(figure);
  const canopy = createCanopy(); car.add(canopy);
  return {
    car, body, figure, canopy, wheels: [], nightLights: [],
    applyTrim() {}, paintCar() {},
    // (the geometry is the residents', and stays)
    disposeModel() { figure.dispose(); material.dispose(); figure.customDepthMaterial.dispose(); canopy.geometry.dispose(); canopy.material.dispose(); },
  };
}

// The parachute out of their pack (see Walker's `chute`): a round canopy of
// eight gores in free drive's teal and cream and its lines down to the pack,
// one mesh, built about the pack so it opens out of it and sways from it.
// Its material is the vehicles' vertex-coloured trim's, so it needs no
// program of its own, and the canopy is two skins, facing out and in, to be
// seen from below as well.
const CANOPY = { radius: 2.3, rise: 1.1, up: 3.1, pack: new THREE.Vector3(0, 1.28, .14) };
function createCanopy() {
  const positions = [], colors = [], teal = new THREE.Color('#5fd0c0'), cream = new THREE.Color('#f2ead8'), cord = new THREE.Color('#3a4446');
  const dome = new THREE.SphereGeometry(1, 8, 3, 0, Math.PI * 2, 0, Math.PI * .44).toNonIndexed(), p = dome.attributes.position;
  const rim = Math.cos(Math.PI * .44), lift = CANOPY.up, pack = new THREE.Vector3();
  const at = i => new THREE.Vector3(p.getX(i) * CANOPY.radius, lift + (p.getY(i) - rim) / (1 - rim) * CANOPY.rise, p.getZ(i) * CANOPY.radius);
  const face = (a, b, c, color) => { for (const v of [a, b, c]) positions.push(v.x, v.y, v.z); for (let k = 0; k < 3; k++) colors.push(color.r, color.g, color.b); };
  for (let i = 0; i < p.count; i += 3) {
    const a = at(i), b = at(i + 1), c = at(i + 2), middle = a.clone().add(b).add(c);
    const gore = Math.floor(((Math.atan2(middle.x, middle.z) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)), color = gore % 2 ? teal : cream;
    face(a, b, c, color);
    // (the inside, a hair under the outside)
    face(...[c, b, a].map(v => v.clone().setY(v.y - .02)), color);
  }
  dome.dispose();
  // A line from each seam of the rim down to the pack
  for (let k = 0; k < 8; k++) {
    const angle = k * Math.PI / 4, top = new THREE.Vector3(Math.sin(angle) * CANOPY.radius * .98, lift, Math.cos(angle) * CANOPY.radius * .98);
    const side = new THREE.Vector3(0, 1, 0).cross(top).setLength(.018);
    const a = pack.clone().sub(side), b = pack.clone().add(side), c = top.clone().add(side), d = top.clone().sub(side);
    face(a, b, c, cord); face(a, c, d, cord); face(c, b, a, cord); face(d, c, a, cord);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const canopy = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .74, flatShading: true, vertexColors: true }));
  canopy.name = 'walker-canopy'; canopy.visible = false; canopy.castShadow = true; canopy.position.copy(CANOPY.pack);
  canopy.traverse(stableShadowDepth);
  return canopy;
}

export class Walker {
  constructor(vehicle, model) {
    this.vehicle = vehicle; this.figure = model.figure; this.posture = model.figure.userData.posture;
    this.vx = 0; this.vz = 0; this.vy = 0; this.y = NaN; this.grounded = true;
    // How far into their stride they are (radians, a step each turn), how
    // strongly they bob with it, and the clock the rest keeps
    this.phase = 0; this.stride = 0; this.time = 0; this.sprinting = false;
    // Jumping (see JUMP): whether the button is held, when it was last
    // pressed, when they last stood on the ground, and whether this time in
    // the air began with a jump and has had its flip
    this.held = false; this.asked = -Infinity; this.footing = 0; this.jumped = false; this.flipped = false; this.flipAt = -Infinity;
    // The jetpack (see IGNITE): when the press now held began, whether it is
    // burning, whether it has this time in the air, and how hot (0 to 1, for
    // the flames)
    this.heldAt = -Infinity; this.burning = false; this.jetting = false; this.jet = 0;
    // The figure's springs (see SQUASH: `nod` is the chin down, radians),
    // the head's turn from the body, and how fast they are turning,
    // speeding up (m/s²) and skidding
    this.squash = { x: 0, v: 0 }; this.drop = { x: 0, v: 0 }; this.nod = { x: 0, v: 0 }; this.look = { x: 0, v: 0 };
    this.turnRate = 0; this.accel = 0; this.skid = 0; this.idle = 0;
    // Something to look at, { x, z } in the world, or null (see OnFoot.lookAround)
    this.watch = null;
    // Knocked over: their body (see LooseProps.person); getting up: from where it lay
    this.down = null; this.rise = null;
    // Hopping into a car (see boardCar), and down out of one (see alightFrom)
    this.board = null; this.alight = null;
    // Under a parachute: when it opened, and when it began to fold away once
    // they were down ({ at, folding }), and the canopy itself
    this.chute = null; this.canopy = model.canopy ?? null;
    Object.assign(vehicle.car.userData, { driverEye: EYE, chaseLift: CHASE_LIFT, chaseScale: CHASE_SCALE, overheadScale: OVERHEAD, leash: true, velocity: { x: 0, z: 0 }, eyeBob: 0, chaseDip: 0 });
  }
  get velocity() { return { x: this.vx, z: this.vz }; }
  // On their feet, not knocked over or getting up
  get standing() { return !this.down && !this.rise; }
  // Stop where they stand
  stop() { this.vx = this.vz = 0; if (this.grounded) this.vy = 0; }
  // Standing where the controller is, at rest (stepping out of a car, a
  // reset): at `y`, or on the highest ground or roof there
  takeOver(y = NaN) {
    const v = this.vehicle;
    this.stop(); this.vy = 0; this.grounded = true; this.y = Number.isFinite(y) ? y : this.floorAt(v.s, v.u, Infinity);
    this.jumped = this.flipped = false; this.asked = this.flipAt = -Infinity; this.footing = this.time;
    for (const s of [this.squash, this.drop, this.nod]) s.x = s.v = 0;
    this.skid = this.turnRate = this.accel = 0; this.board = this.alight = null; this.chute = null;
  }
  // Leaping out of something flying (see OnFoot.jump), from `y` going at
  // (vx, vy, vz): no flip in this jump. A tap of jump opens the parachute
  leap(y, vx, vy, vz) {
    this.takeOver(y);
    this.grounded = false; this.jumped = this.flipped = true; this.footing = -Infinity; this.jetting = this.burning = false;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.squash.v += 2; this.nod.v -= 1;
  }
  // The highest thing they could stand on at (s, u) no higher than `below`:
  // the street, or a roof there (on a pitched one, where they are on its slope)
  floorAt(s, u, below = this.y + STEP) {
    const v = this.vehicle, ground = v.route.height(s, u);
    if (!v.scenery) return ground;
    const p = v.route.position(s, u, 0);
    return Math.max(ground, roofAt(v.scenery.values(), p, below));
  }
  // Into a car (see OnFoot.board): a hop to its door and in over `duration`
  // s, `doorway()` saying where its door and seat are now ({ x, z, seat, heading }, or null)
  boardCar(doorway, duration) {
    const p = this.vehicle.groundedPosition;
    this.board = { doorway, duration, at: this.time, x: p.x, y: p.y, z: p.z, heading: this.vehicle.heading };
    this.stop();
  }
  get boarded() { return Boolean(this.board) && this.time - this.board.at >= this.board.duration; }
  // Out of a car (see OnFoot.getOut): down from its seat at `seat` (a
  // Vector3), facing `heading`, to where they stand
  alightFrom(seat, heading) { this.alight = { at: this.time, seat: seat.clone(), heading }; }
  get alighting() { return Boolean(this.alight) && this.time - this.alight.at < ALIGHT; }
  update(dt, input) {
    const v = this.vehicle, telemetry = v.audioTelemetry;
    v.copyPose(v.previousPose, v.currentPose);
    this.time += dt;
    if (!Number.isFinite(this.y)) this.takeOver();
    if (this.down) this.lie();
    else if (this.rise && this.time - this.rise.at >= GET_UP) this.rise = null;
    // Down from a car's seat: they land, and are theirs to move
    if (this.alight && !this.alighting) {
      this.alight = null; this.squash.v -= 2.6; this.drop.v -= .35; this.nod.v += 1.4;
      telemetry.step = .5; telemetry.stepSerial++; telemetry.landing = 0; telemetry.surface = this.surface();
    }
    const control = !this.down && !this.rise && !this.board && !this.alight, walk = control ? input.walk : null;
    // (hanging under the parachute, not yet down)
    const chute = Boolean(this.chute) && !this.chute.folding;
    // The way they want to go, and how fast: the stick's push, a key's all the
    // way, and under the parachute the way to steer it
    const amount = walk ? Math.min(1, Math.hypot(walk.x, walk.z)) : 0;
    const top = chute ? CHUTE_GLIDE : this.jetting ? input.sprint ? JET_SPRINT : JET : input.sprint ? SPRINT : JOG;
    const wx = amount ? walk.x * top : 0, wz = amount ? walk.z * top : 0;
    if (control && Number.isFinite(input.aim)) v.heading = input.aim;
    const before = v.heading, ahead = { x: Math.sin(before), z: -Math.cos(before) };
    const forward = this.vx * ahead.x + this.vz * ahead.z, moving = Math.hypot(this.vx, this.vz);
    // Pushing hard against the way they are running, they skid
    const against = this.grounded && amount > .5 && moving > 3 && wx * this.vx + wz * this.vz < -.3 * moving * Math.hypot(wx, wz);
    if (against && this.skid === 0) this.puff(3, 1.4, this.vx * .3, this.vz * .3);
    this.skid = dt ? clamp(this.skid + (against ? 8 : -5) * dt, 0, 1) : this.skid;
    const dx = wx - this.vx, dz = wz - this.vz, gap = Math.hypot(dx, dz), change = Math.min(gap, (chute ? CHUTE_PULL : this.grounded ? GRIP : this.jetting ? JET_GRIP : AIR) * dt);
    if (gap > 1e-9) { this.vx += dx / gap * change; this.vz += dz / gap * change; }
    // They turn to face the way they are asked to go (not through their own
    // eyes, where they face where the view looks and back is a step back),
    // and under the parachute the way it carries them
    if (chute) { if (moving > .8) v.heading += wrap(Math.atan2(this.vx, -this.vz) - v.heading) * (1 - Math.exp(-3 * dt)); }
    else if (control && input.face !== false && amount > .05) v.heading += wrap(Math.atan2(wx, -wz) - v.heading) * (1 - Math.exp(-TURN * dt));
    v.heading = wrap(v.heading);
    if (dt > 0) {
      this.turnRate = THREE.MathUtils.damp(this.turnRate, wrap(v.heading - before) / dt, 12, dt);
      this.accel = THREE.MathUtils.damp(this.accel, (this.vx * ahead.x + this.vz * ahead.z - forward) / dt, 10, dt);
    }
    // Jumping (see JUMP): a press waits BUFFER for the ground to answer it.
    // High up a tap opens or folds the parachute instead of flipping, and held
    // anywhere in the air, jump burns the jetpack (see IGNITE)
    const pressed = control && Boolean(input.jump) && !this.held, released = control && !input.jump && this.held;
    this.held = Boolean(input.jump);
    if (pressed) { this.asked = this.time; this.heldAt = this.time; }
    const high = !this.grounded && this.y - this.floorAt(v.s, v.u) > CHUTE_ROOM;
    if (released && high && !this.burning && this.time - this.heldAt < IGNITE) {
      if (chute) this.chute.folding = this.time; else if (!this.chute) this.openChute();
    }
    // (only with a jetpack: it is bought, see GEAR)
    this.burning = control && v.jetpack !== false && this.held && !this.grounded && this.time - this.heldAt >= IGNITE;
    if (this.burning) { this.jetting = true; if (chute) this.chute.folding = this.time; }
    if (control && !chute && !high && this.time - this.asked <= BUFFER) {
      const footing = this.grounded || (!this.jumped && this.time - this.footing <= COYOTE);
      // (in the air, a press the ground will answer in a moment waits for it, rather than flipping)
      const above = Math.max(0, this.y - this.floorAt(v.s, v.u));
      const landing = !this.grounded && this.vy <= 0 && (this.vy + Math.sqrt(this.vy * this.vy + 2 * FALL * above)) / FALL < BUFFER;
      if (footing) {
        this.vy = JUMP; this.grounded = false; this.jumped = true; this.asked = -Infinity;
        this.squash.v += 2.8; this.drop.v -= .45; this.nod.v -= 1.2;
      } else if (pressed && !this.flipped && !this.jetting && !landing) {
        // (not once the jetpack has been lit: a press just lights it again)
        this.vy = FLIP; this.flipped = true; this.flipAt = this.time; this.asked = -Infinity;
        this.squash.v += 1.5; this.drop.v -= .3;
      }
    }
    // Along the ground, but never into the water: the half of the move that
    // stays dry is kept, so they walk along a quay's edge rather than stick.
    // (in the air they may drift out over it, and be fished out: see ashore)
    const fromS = v.s, fromU = v.u, fromY = this.y;
    if (!this.down) {
      v.shift(this.vx * dt, this.vz * dt);
      if (this.grounded && this.wet(v.s, v.u) && !this.wet(fromS, fromU)) {
        const toU = v.u;
        v.u = fromU;
        if (this.wet(v.s, v.u)) { v.s = fromS; v.u = toU; }
        if (this.wet(v.s, v.u)) { v.s = fromS; v.u = fromU; }
        this.vx = (v.u - fromU) / (dt || 1); this.vz = -(v.s - fromS) / (dt || 1);
      }
    }
    // Up a kerb or down it in their stride, and off anything higher they
    // fall. Rising with the button held they are slowed least, falling most.
    // Under a parachute they come down at its own pace.
    const ground = this.floorAt(v.s, v.u), wasGrounded = this.grounded;
    const gravity = this.jetting ? JET_FALL : this.vy > 0 ? (this.held && (this.jumped || this.flipped) ? RISE : LET_GO) : FALL;
    let landed = 0;
    if (this.down) this.y = ground;
    else if (this.grounded && Math.abs(ground - this.y) <= STEP) this.y = ground;
    else {
      if (this.grounded && ground > this.y) { v.s = fromS; v.u = fromU; this.vx = this.vz = 0; }
      else {
        this.grounded = false;
        if (chute) this.vy = THREE.MathUtils.damp(this.vy, -CHUTE_SINK * (input.sprint ? 1.8 : 1), CHUTE_BRAKE, dt);
        else this.vy -= gravity * dt;
        // (burning, up to its climb, easing off to a hover under the ceiling)
        if (this.burning) this.vy = Math.min(this.vy + THRUST * dt, Math.max(this.vy, CLIMB * clamp((CEILING - (this.y - v.route.height(v.s, v.u))) / 12, 0, 1)));
        if (this.jetting) this.vy = Math.max(this.vy, -DIVE);
        this.y += this.vy * dt;
      }
      const under = this.floorAt(v.s, v.u, fromY + STEP);
      if (this.y <= under) { landed = Math.max(.5, -this.vy); this.y = under; this.vy = 0; this.grounded = true; }
    }
    if (this.grounded) { this.footing = this.time; this.jumped = this.flipped = this.jetting = this.burning = false; }
    this.jet = dt ? THREE.MathUtils.damp(this.jet, this.burning ? 1 : 0, this.burning ? 14 : 7, dt) : 0;
    // Down, the parachute folds away
    if (this.grounded && chute) this.chute.folding = this.time;
    if (this.chute?.folding && this.time - this.chute.folding > CHUTE_FOLD) this.chute = null;
    // (and down in the water, they are fished out)
    if (landed && this.wet(v.s, v.u)) { this.ashore(); landed = 0; }
    // Landing: a squash as deep as the fall was fast, the head dipping into
    // it, a thud and a puff. Every step is a footfall (see DriveAudio).
    const speed = Math.hypot(this.vx, this.vz), stepped = this.phase;
    if (landed && !wasGrounded && dt) {
      this.squash.v -= 1.4 + landed * .6; this.drop.v -= .2 + landed * .07; this.nod.v += 1 + landed * .25;
      telemetry.step = clamp(landed / 8, .35, 1); telemetry.stepSerial++; telemetry.landing = landed; telemetry.surface = this.surface();
      if (landed > 3) this.puff(Math.round(clamp(landed, 4, 9)), .6 + landed * .12);
      if (landed > HARD_LANDING) { v.trauma = Math.min(1, v.trauma + (landed - HARD_LANDING) / 40); v.events.push({ kind: 'thud', impact: landed }); }
    }
    const sprinted = this.sprinting;
    this.sprinting = input.sprint && speed > JOG + .5;
    // (pressed against a wall, each step's little push into it is no stride)
    if (this.grounded && !this.down && !this.rise) this.phase += dt * Math.PI * 2 * (1.6 + speed * .35) * clamp((speed - .3) / 1.2, 0, 1);
    if (Math.floor((this.phase - Math.PI * 1.5) / (Math.PI * 2)) > Math.floor((stepped - Math.PI * 1.5) / (Math.PI * 2))) {
      telemetry.step = clamp(speed / SPRINT, .25, 1); telemetry.stepSerial++; telemetry.landing = 0; telemetry.surface = this.surface();
      this.drop.v -= .12 * Math.min(1, this.stride);
      // (a wet street splashes at every step)
      if (v.props && v.props.underfoot !== 'dust') this.puff(this.sprinting ? 2 : 1, .5, -this.vx * .15, -this.vz * .15);
    }
    // Breaking into a sprint kicks up a little dust behind them
    if (this.sprinting && !sprinted && this.grounded) this.puff(3, .8, -this.vx * .25, -this.vz * .25);
    this.stride = dt ? THREE.MathUtils.damp(this.stride, this.grounded ? clamp(speed / JOG, 0, 1.3) : 0, 8, dt) : this.stride;
    this.idle = control && !amount && speed < .2 && this.grounded ? this.idle + dt : 0;
    // The figure's follow-through (see SQUASH): a run's lean and a skid tip
    // the head too, and standing a while they breathe
    if (dt > 0) {
      const breath = this.idle > 1 ? Math.sin(this.time * Math.PI * 2 * .28) * .012 : 0;
      spring(this.squash, breath, SQUASH, dt); spring(this.drop, 0, BOB, dt);
      spring(this.nod, clamp(-this.accel * .012, -.14, .14) + this.skid * .15, NOD, dt);
      this.squash.x = clamp(this.squash.x, -.3, .25); this.drop.x = clamp(this.drop.x, -DROP, .08);
      turnToward(this.look, this.lookGoal(control, amount, wx, wz, speed), amount > .05 && !this.watching ? LEAD_RATE : LOOK_RATE, dt);
    }
    // The controller's state, as the rest of the game reads it
    v.speed = speed; v.slideHeading = v.heading; v.steer = 0; v.slip = 0; v.yawRate = 0;
    v.drifting = false; v.boosting = this.sprinting; v.driftAmount = 0; v.weight = 0; v.load = 0; v.airborne = this.y - v.route.height(v.s, v.u) > AIRBORNE;
    v.pitch = 0; v.roll = 0; v.wheelSpin = this.phase;
    // Leaning into a run, more as they set off, and back into a skid,
    // swaying with each step, and banking into turns
    // (hanging under a parachute, they swing a little under it instead)
    const lean = this.down || this.rise || chute ? 0 : this.jetting ? clamp(speed * .032, -.05, .45) : clamp(speed * .022 + this.accel * .004, -.08, .22);
    const bank = this.down || this.rise ? 0 : chute ? Math.sin(this.time * 2.1) * .05 : clamp(-this.turnRate * speed * .016, -.2, .2);
    v.bodyPitch = -lean + this.skid * .28; v.bodyRoll = Math.sin(this.phase * .5) * .04 * this.stride + bank;
    const data = v.car.userData;
    data.speed = speed; data.velocity.x = this.down ? 0 : this.vx; data.velocity.z = this.down ? 0 : this.vz;
    // (a sprint opens the chase camera's lens a little, as a car's speed does)
    data.speedRush = this.sprinting ? clamp((speed - JOG) / (SPRINT - JOG), 0, 1) * .6 : 0;
    // (under a parachute it stands back to take in the canopy, and on the
    // jetpack or dropping from high up, out of the helicopter or off a roof,
    // to take them in, and high up looks down past them)
    const dropping = this.jetting || (!this.grounded && !this.down && this.y - ground > CHUTE_ROOM);
    data.chaseScale = this.chute ? CHUTE_FRAME : dropping ? JET_FRAME : CHASE_SCALE;
    // (and follows their height loosely, as a car's jump, so a landing doesn't jerk it)
    data.loose = dropping || Boolean(this.chute);
    data.chaseDip = this.chute || dropping ? clamp((this.y - ground - 4) / 30, 0, 1) * .45 : 0;
    v.trauma = Math.max(0, v.trauma - dt * 1.4); data.trauma = v.trauma;
    telemetry.speed = speed; telemetry.throttle = 0; telemetry.brake = 0; telemetry.offRoad = 0;
    // (the jetpack roars as the boost does, see DriveAudio)
    telemetry.handbrake = 0; telemetry.boost = this.burning ? 1 : 0; telemetry.scrape *= Math.exp(-dt * 14);
    if (dt === 0) telemetry.impact = 0;
    this.pose(dt === 0);
  }
  // Where the head turns from the body (see LOOK_MOST): into a turn they are
  // making, else toward what they are watching, else now and then about them
  lookGoal(control, amount, wx, wz, speed) {
    const v = this.vehicle, p = v.groundedPosition;
    this.watching = false;
    if (!control) return 0;
    if (amount > .05) {
      const into = wrap(Math.atan2(wx, -wz) - v.heading);
      if (Math.abs(into) > .15) return clamp(into * LEAD, -LOOK_MOST, LOOK_MOST);
    }
    // (running flat out, they look where they are going)
    const watch = this.watch, calm = 1 - clamp((speed - JOG) / (SPRINT - JOG), 0, 1);
    if (watch && calm > 0) {
      const dx = watch.x - p.x, dz = watch.z - p.z, d = Math.hypot(dx, dz);
      const turn = wrap(Math.atan2(dx, -dz) - v.heading);
      if (d > .3 && d < WATCH && Math.abs(turn) < 2.1) { this.watching = true; return clamp(turn, -LOOK_MOST, LOOK_MOST) * calm; }
    }
    if (this.idle < 1.5) return 0;
    // (a new whim every couple of seconds: ahead, about them, or right round to one side)
    const beat = Math.floor(this.time / 1.9), whim = Math.abs(Math.sin(beat * 12.9898 + 78.233) * 43758.5453) % 1;
    return whim < .35 ? 0 : whim < .5 ? -.8 : whim < .65 ? .8 : whim < .75 ? -.4 : whim < .85 ? .4 : whim < .93 ? -1.05 : 1.05;
  }
  // Whether they clear a standing thing (see collideScenery): a building
  // whose roof they stand on, or are above, furniture they are over, and
  // anything else once well off the street (see AIRBORNE)
  passes(solid) {
    if (solid.top !== undefined) return this.y >= roofSurface(solid, this.vehicle.groundedPosition) - STEP;
    // (furniture only once off their feet or up high: a jump clears a bin)
    if (solid.prop) return (!this.grounded || this.vehicle.airborne) && this.y >= propTop(solid);
    return this.vehicle.airborne;
  }
  // The pack opens (see CHUTE_ROOM), with a flutter of cloth
  openChute() {
    const v = this.vehicle, p = v.groundedPosition;
    this.chute = { at: this.time, folding: 0 };
    v.props?.sounds.push({ kind: 'flutter', strength: 9, x: p.x, z: p.z });
  }
  // Down in the water off a parachute: a splash, and they are back at the
  // kerb, as the harbour gives back anyone knocked into it (see lie)
  ashore() {
    const v = this.vehicle, p = v.groundedPosition;
    v.props?.bits?.burst('splash', p.x, this.y, p.z);
    let lane = v.route.nearestLane?.(v.s, v.u, v.heading);
    // (far out at sea no street is within the usual reach, and they were left standing on the water)
    if (lane && Math.hypot(lane.s - v.s, lane.u - v.u) < 1) lane = v.route.nearestLane(v.s, v.u, v.heading, SEA_REACH);
    if (lane) { v.s = lane.s; v.u = lane.u; }
    this.takeOver();
  }
  wet(s, u) { return Boolean(this.vehicle.route.water?.(s, u)); }
  // What they are standing on, for their footsteps: 'pavement', 'road' and so on (see surfaceAt)
  surface() { const v = this.vehicle; return v.route.surface?.(v.s, v.u) ?? 'road'; }
  // A puff of what the ground gives underfoot, dust or spray (see
  // LooseProps' bits): `count` bits thrown out `spread` times as fast, carried
  // along at (vx, vz), from round the hem, so none sits under it like a foot
  puff(count, spread = 1, vx = 0, vz = 0) {
    const props = this.vehicle.props, p = this.vehicle.groundedPosition;
    if (!props?.bits || !(count > 0)) return;
    props.bits.burst(props.underfoot ?? 'dust', p.x, this.y + .04, p.z, vx, vz, count, spread, .34);
  }
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
  // hopping along in its stride, squashed and stretched, flipping, or where
  // its body lies and on its way up from there
  animate(phase, origin = 0) {
    const v = this.vehicle, figure = this.figure, body = v.body, posture = this.posture;
    this.drawCanopy();
    if (this.board || this.alighting) { this.hop(origin); return; }
    if (!this.down && !this.rise) {
      // Each step a little hop off one foot onto the other: squashed as it
      // lands, stretched at the top, higher the faster they go
      const u = ((phase - Math.PI * 1.5) / (Math.PI * 2) % 1 + 1) % 1, arc = Math.sin(Math.PI * u), stride = Math.min(1, this.stride);
      body.position.y = arc * (.045 + .03 * Math.min(1.3, this.stride)) * stride;
      const squash = clamp((1 + this.squash.x) * (1 + (arc - .4) * .07 * stride), .6, 1.5);
      posture.walkerSquash.value = squash;
      posture.walkerHeadShift.value.set(0, COLLAR * (squash - 1) + this.drop.x, 0);
      // The head nods about its own middle, and tilts against a bank to stay
      // nearly level. (Its turn is a yaw, the other way round from a heading.)
      const turned = -this.look.x;
      euler.set(-this.nod.x, 0, -v.bodyRoll * .45);
      tilt.makeRotationFromEuler(euler);
      tilt.premultiply(yaw.makeRotationY(turned)).multiply(unyaw.makeRotationY(-turned));
      posture.walkerHeadTilt.value.setFromMatrix4(tilt);
      setWalkerTurn(figure, 0, turned); figure.instanceColor.needsUpdate = true;
      // A flip: once round, forward, about their middle
      const t = (this.time - this.flipAt) / FLIP_TIME;
      if (t >= 0 && t < 1 && !this.grounded) {
        turn.setFromAxisAngle(X, -Math.PI * 2 * THREE.MathUtils.smootherstep(t, 0, 1));
        figure.quaternion.copy(turn); figure.position.set(0, MIDDLE, 0).sub(place.set(0, MIDDLE, 0).applyQuaternion(turn));
      } else { figure.position.set(0, 0, 0); figure.quaternion.identity(); }
      figure.scale.set(1, 1, 1);
      // Through their eyes, each step bobs the view a little, and a landing dips it
      v.car.userData.eyeBob = (arc - .5) * .03 * stride + this.drop.x * .8 + Math.min(0, this.squash.x) * .25;
      return;
    }
    posture.walkerSquash.value = 1; posture.walkerHeadShift.value.set(0, 0, 0); posture.walkerHeadTilt.value.identity();
    setWalkerTurn(figure, 0, 0); figure.instanceColor.needsUpdate = true;
    v.car.userData.eyeBob = 0;
    body.position.set(0, 0, 0); body.rotation.set(0, 0, 0);
    // (the figure is placed in the world, under wherever the controller stands)
    place.copy(v.car.position); place.z -= origin;
    root.compose(place, v.car.quaternion, ONE).invert();
    if (this.down) v.props.personMatrix(this.down.body, world);
    else {
      const rise = this.rise, k = THREE.MathUtils.smoothstep(this.time - rise.at, 0, GET_UP);
      place.copy(v.groundedPosition);
      world.compose(from.p.lerpVectors(rise.from.p, place, k), from.q.slerpQuaternions(rise.from.q, turn.setFromAxisAngle(UP, -v.heading), k), from.s.lerpVectors(rise.from.s, ONE, k));
    }
    world.premultiply(root).decompose(figure.position, figure.quaternion, figure.scale);
  }
  // The parachute: opening out of the pack with a little overshoot, trailing
  // back from the way they drift and swaying, and once they are down folding
  // back over behind them
  drawCanopy() {
    const canopy = this.canopy, chute = this.chute;
    if (!canopy) return;
    canopy.visible = Boolean(chute);
    if (!chute) return;
    const v = this.vehicle, open = clamp((this.time - chute.at) / CHUTE_OPEN, 0, 1), fold = chute.folding ? clamp((this.time - chute.folding) / CHUTE_FOLD, 0, 1) : 0;
    const size = Math.max(.05, THREE.MathUtils.smootherstep(open, 0, 1) * (1 + Math.sin(open * Math.PI) * .15));
    canopy.scale.set(size * (1 + fold * .3), Math.max(.05, size * (1 - fold * .9)), size * (1 + fold * .3));
    // (the drift in their own frame: ahead and to the right)
    const cos = Math.cos(v.heading), sin = Math.sin(v.heading), ahead = this.vx * sin - this.vz * cos, right = this.vx * cos + this.vz * sin;
    const swing = fold ? 0 : Math.sin(this.time * 2.1) * .06;
    canopy.rotation.set(clamp(ahead * .03, -.25, .25) + fold * 1.2, 0, clamp(right * .03, -.25, .25) + swing);
  }
  // The chase camera pulled in by a wall can come up inside the canopy: it
  // is left out of that frame (`lens` where the camera is, in the scene)
  clearView(lens) {
    const canopy = this.canopy;
    if (!canopy?.visible) return;
    const p = this.vehicle.car.position, top = p.y + CANOPY.pack.y + CANOPY.up * canopy.scale.y;
    if (Math.hypot(lens.x - p.x, lens.z - p.z) < CANOPY.radius * canopy.scale.x + .6 && lens.y > top - .8 && lens.y < top + CANOPY.rise * canopy.scale.y + .6) canopy.visible = false;
  }
  // Hopping into a car or down out of one, placed in the world as getting up
  // is. Into it, a hop to its door, then climbing in, shrinking into the
  // seat and turning to face the way it does. Out, from the seat to where
  // they stand, growing back as they come out through the door.
  hop(origin) {
    const v = this.vehicle, figure = this.figure, posture = this.posture;
    posture.walkerSquash.value = 1; posture.walkerHeadShift.value.set(0, 0, 0); posture.walkerHeadTilt.value.identity();
    setWalkerTurn(figure, 0, 0); figure.instanceColor.needsUpdate = true;
    v.car.userData.eyeBob = 0;
    v.body.position.set(0, 0, 0); v.body.rotation.set(0, 0, 0);
    place.copy(v.car.position); place.z -= origin;
    root.compose(place, v.car.quaternion, ONE).invert();
    let size = 1, heading = v.heading;
    if (this.board) {
      const b = this.board, t = clamp((this.time - b.at) / b.duration, 0, 1), door = b.doorway();
      from.p.set(b.x, b.y, b.z);
      if (door && t < DOOR) {
        const u = t / DOOR, k = THREE.MathUtils.smootherstep(u, 0, 1);
        from.p.lerp(place.set(door.x, b.y, door.z), k); from.p.y += HOP * 4 * u * (1 - u);
        heading = b.heading + wrap(door.heading - b.heading) * k;
      } else if (door) {
        const k = THREE.MathUtils.smoothstep((t - DOOR) / (1 - DOOR), 0, 1);
        from.p.set(door.x, b.y, door.z).lerp(place.set(door.seat.x, door.seat.y, door.seat.z), k);
        size = 1 - (1 - SEATED) * k; heading = door.heading;
      }
    } else {
      const a = this.alight, t = clamp((this.time - a.at) / ALIGHT, 0, 1), k = THREE.MathUtils.smoothstep(t, 0, 1);
      from.p.copy(a.seat).lerp(v.groundedPosition, k); from.p.y += HOP * 4 * t * (1 - t);
      size = SEATED + (1 - SEATED) * k; heading = a.heading + wrap(v.heading - a.heading) * k;
    }
    world.compose(from.p, turn.setFromAxisAngle(UP, -heading), from.s.setScalar(size));
    world.premultiply(root).decompose(figure.position, figure.quaternion, figure.scale);
  }
  // Leaping from a car going at (vx, vz) (see OnFoot.bail): a body thrown on
  // at most of its speed and clear to the side (sx, sz), tumbling head over
  // heels the way it goes, who lies a moment and gets up as one knocked down does
  bail(vx, vz, sx, sz) {
    const v = this.vehicle, props = v.props, speed = Math.hypot(vx, vz);
    if (!props) { this.vx = vx; this.vz = vz; return; }
    world.compose(v.groundedPosition, turn.setFromAxisAngle(UP, -v.heading), ONE);
    const thrown = new THREE.Vector3(vx * .8 + sx * 2.5, 2.4, vz * .8 + sz * 2.5), spin = new THREE.Vector3(-vz, 0, vx).setLength(speed * .9);
    this.down = { body: props.thrown(cityWalker, world, thrown, spin) };
    this.stop(); this.vy = 0; this.grounded = true; this.rise = null; this.alight = null;
    v.trauma = Math.min(1, v.trauma + .3);
  }
  // A blow (as DrivingController.strike takes one). Hard enough, it knocks
  // them over, and otherwise it shoves them. (Climbing into a car, nothing does.)
  strike(dvx, dvz, spin, impact) {
    if (this.down || this.rise || this.board) return;
    if (impact > KNOCK) { this.knockDown(dvx, dvz); return; }
    this.vx += dvx; this.vz += dvz;
  }
  // Knocked flying the way the blow went, as a car coming that way would
  // knock a resident (see LooseProps.person)
  knockDown(vx, vz) {
    const v = this.vehicle, props = v.props, speed = Math.hypot(vx, vz);
    if (!props || speed < 1e-3) { this.vx += vx; this.vz += vz; return; }
    const p = v.groundedPosition, dx = vx / speed, dz = vz / speed;
    this.chute = null;
    world.compose(p, turn.setFromAxisAngle(UP, -v.heading), ONE);
    const car = { x: p.x - dx * 2.6, z: p.z - dz * 2.6, heading: Math.atan2(dx, -dz), halfWidth: 1, halfLength: 2.2, vx, vz, spin: 0, mass: 1.7, y: p.y, height: 1.5 };
    this.down = { body: props.person(cityWalker, world, car).body };
    this.stop(); this.vy = 0; this.grounded = true; this.rise = null;
    v.trauma = Math.min(1, v.trauma + .5); v.audioTelemetry.impact = speed; v.audioTelemetry.impactSerial++; v.audioTelemetry.crashSerial++;
  }
  // A car against them (see CityTraffic.collidePlayer): they are put back
  // outside it. One that came at them hard knocks them over; one that
  // merely leans on them carries them along; one they walked into stops them.
  resolveTrafficCollision(dx, dz, dvx, dvz, spin, impact) {
    const v = this.vehicle, length = Math.hypot(dx, dz);
    if (this.down || this.board) return;
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
}

// What the controls ask of someone on foot, from the input's state (see
// Input: moveX / moveY, the touch stick, jump and sprint) and the camera
// they are seen through: `walk`, the way to go in the world (x east, z
// south), as long as the stick is pushed; `face`, whether to turn that way;
// `aim`, a way to face instead. Chased or seen from above they go the way
// the stick points on the screen. Through their own eyes they face where
// the view looks (see FirstPersonCamera), forward and back go that way, and
// the sides step aside (`strafe`: with a mouse or a stick to turn the view)
// or else turn the view (see main.js). `out` is filled and returned.
export function walkingInput(state, camera, { firstPerson = false, strafe = false } = {}, out = { walk: { x: 0, z: 0 } }) {
  let x = clamp(Number(state.moveX) || 0, -1, 1), y = clamp(Number(state.moveY) || 0, -1, 1);
  const stick = state.touchStick;
  if (stick && (stick.x || stick.y)) { x = stick.x; y = stick.y; }
  if (firstPerson && !strafe) x = 0;
  out.jump = Boolean(state.jump); out.sprint = Boolean(state.sprint); out.face = !firstPerson; out.aim = NaN;
  const walk = out.walk, amount = Math.min(1, Math.hypot(x, y));
  walk.x = walk.z = 0;
  if (!amount && !firstPerson) return out;
  camera.updateMatrixWorld();
  const m = camera.matrixWorld.elements;
  if (firstPerson) out.aim = Math.atan2(-m[8], m[10]);
  if (!amount) return out;
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
