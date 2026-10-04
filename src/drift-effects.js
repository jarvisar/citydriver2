import * as THREE from 'three';

// What a drift looks like from outside (see Drift), for the player's car in
// every mode: tire smoke while it charges, then sparks off the back wheels in
// the charge's color, each wheel glowing with it, a burst of sparks at each
// new stage, flames from the back while a turbo or the boost lasts, and tire
// marks. Sparks, glows and flames are unlit, so they read at night. They
// are not added to what is behind them: over grass that turned orange sparks
// yellow-green, and the color is how the stage is told.

// Each stage's color (blue, orange, pink, as Mario Kart's), and the boost's
export const STAGE_COLOURS = [null, '#57c3ff', '#ffa12e', '#ff58d8'];
const BOOST_COLOUR = '#ffc84a';
// Sparks a second from each back wheel at each stage, how many at once when
// a stage is reached, and how many there can be
const SPARK_RATE = [0, 34, 44, 56], BURST = 14, SPARKS = 160;
// Smoke puffs a second from each back wheel before the first stage and after,
// and how many there can be
const SMOKE_RATE = [12, 5], PUFFS = 64;
// Tire marks: a length laid each time a wheel has gone MARK_STEP meters, as
// many as MARKS, the oldest going first
const MARKS = 600, MARK_STEP = .6;
const GRAVITY = 9.8;

const colour = new THREE.Color(), matrix = new THREE.Matrix4(), turn = new THREE.Quaternion(), size = new THREE.Vector3();
const point = new THREE.Vector3(), way = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), forward = new THREE.Vector3(0, 0, 1);
const WHITE = new THREE.Color('#ffffff');
// A jetpack's nozzles on the walker's figure (x right, z back, from its feet),
// and turning a flame from pointing back to pointing down
const NOZZLES = [-.09, .09], NOZZLE_Y = .93, NOZZLE_Z = .2, DOWNWARD = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

function glowMaterial() {
  return new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .92, depthWrite: false, toneMapped: false, fog: false });
}
function instanced(geometry, material, count, colours = true) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.count = 0; mesh.frustumCulled = false; mesh.userData.ambientOcclusion = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (colours) mesh.setColorAt(0, colour.set('#ffffff'));
  return mesh;
}

export class DriftEffects {
  constructor(scene, random = Math.random) {
    this.random = random; this.group = new THREE.Group(); this.group.name = 'drift-effects'; scene.add(this.group);
    // Sparks: short streaks, each stretched along the way it flies
    const streak = new THREE.OctahedronGeometry(1, 0); streak.scale(.035, .035, .12);
    this.glow = glowMaterial();
    this.sparks = instanced(streak, this.glow, SPARKS);
    // A glow at each back wheel in the stage's color
    this.flares = instanced(new THREE.IcosahedronGeometry(.16, 0), this.glow, 2);
    // Flames: a colored cone from each side of the back, a white core in each
    // (the cone's point out behind, its base at the back of the car)
    const cone = new THREE.ConeGeometry(.17, 1, 7, 1, true); cone.rotateX(Math.PI / 2); cone.translate(0, 0, .5);
    this.flames = instanced(cone, this.glow, 4);
    // Smoke: pale puffs that rise and swell as they thin out
    this.smokeMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .34, depthWrite: false });
    this.puffs = instanced(new THREE.IcosahedronGeometry(1, 0), this.smokeMaterial, PUFFS);
    // Tire marks, a length of tread at a time, each from where the wheel last laid one
    const mark = new THREE.PlaneGeometry(.24, 1); mark.rotateX(-Math.PI / 2);
    this.markMaterial = new THREE.MeshBasicMaterial({ color: '#1e2324', transparent: true, opacity: .42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.marks = instanced(mark, this.markMaterial, MARKS, false);
    this.group.add(this.marks, this.puffs, this.sparks, this.flares, this.flames);
    this.list = []; this.smoke = []; this.markIndex = 0; this.laid = [null, null];
    this.spawn = [0, 0]; this.fume = 0; this.seen = null; this.flicker = 0;
  }
  // Stand-ins to compile their programs with everything else, as they are
  // drawn the moment they are wanted (with instance colors where they have them)
  warmupObjects() {
    return [this.sparks, this.flames, this.puffs, this.marks].map(mesh => {
      const standIn = new THREE.InstancedMesh(mesh.geometry, mesh.material, 1);
      standIn.setMatrixAt(0, matrix.identity());
      if (mesh.instanceColor) standIn.setColorAt(0, colour.set('#ffffff'));
      return standIn;
    });
  }
  reset() {
    this.list = []; this.smoke = []; this.laid = [null, null];
    for (const mesh of [this.sparks, this.flares, this.flames, this.puffs, this.marks]) mesh.count = 0;
    this.markIndex = 0; this.seen = null;
  }
  // A point on the car, in its own meters (x right, z back), as the scene has it
  at(car, x, y, z, out = point) { return out.set(x, y, z).applyQuaternion(car.quaternion).add(car.position); }
  // One frame. `vehicle` the player's (see ActorMotion), `running` false
  // while paused, when nothing moves
  update(vehicle, dt, running = true) {
    const drift = vehicle.drift, car = vehicle.car;
    if (!running || !dt) return;
    this.age(dt);
    if (vehicle.walker) { this.jetpack(vehicle.walker, dt); this.draw(); return; }
    if (!drift || vehicle.pilot) { this.flames.count = this.flares.count = 0; this.seen = null; this.laid = [null, null]; this.draw(); return; }
    const air = vehicle.carAir, layout = air.layout, drifting = vehicle.drifting;
    // What has happened since the last frame (counts, so nothing is missed between frames)
    const seen = this.seen ?? { stages: drift.stagesReached, losses: drift.losses };
    const rose = drift.stagesReached > seen.stages, lost = drift.losses > seen.losses;
    this.seen = { stages: drift.stagesReached, losses: drift.losses };
    // The back wheels, as the car sits on the ground (x right, z back), and the floor under each
    const wheels = [2, 3].map(i => ({ x: layout[i][1], z: -layout[i][0], floor: air.floors[i] }));
    const velocity = vehicle.velocity, out = -drift.dir;
    this.flares.count = 0;
    if (drifting) {
      const stage = drift.stage;
      // Smoke all through, thicker before the first stage, then sparks in the stage's color
      this.fume += dt * SMOKE_RATE[stage ? 1 : 0] * 2 * Math.min(1, Math.abs(vehicle.speed) / 12);
      for (; this.fume >= 1; this.fume--) this.puff(car, wheels[this.random() < .5 ? 0 : 1], velocity, out);
      if (stage) {
        wheels.forEach((wheel, i) => {
          this.spawn[i] += dt * SPARK_RATE[stage];
          for (; this.spawn[i] >= 1; this.spawn[i]--) this.spark(car, wheel, velocity, out, stage, 1);
        });
        if (rose) for (const wheel of wheels) for (let k = 0; k < BURST; k++) this.spark(car, wheel, velocity, out, stage, 1.7);
        this.flare(car, wheels, stage);
      }
      wheels.forEach((wheel, i) => this.mark(car, wheel, i));
    } else { this.spawn[0] = this.spawn[1] = 0; this.laid = [null, null]; }
    // A charge lost (too slow, a crash): a puff of smoke off the back
    if (lost) for (const wheel of wheels) for (let k = 0; k < 3; k++) this.puff(car, wheel, velocity, out, 1.4);
    this.flame(vehicle, dt);
    this.draw();
  }
  spark(car, wheel, velocity, out, stage, strength) {
    if (this.list.length >= SPARKS) this.list.shift();
    const r = this.random, p = this.at(car, wheel.x + out * .1, .06, wheel.z + .1).clone();
    // (off the back and out from the bend, up a little, dragged along with the car)
    const back = this.at(car, 0, 0, 1, way).sub(car.position), across = this.at(car, 1, 0, 0, side).sub(car.position);
    const kick = (2.2 + r() * 2.8) * strength, spread = (r() - .3) * 2.4 * strength;
    this.list.push({
      p, v: new THREE.Vector3(velocity.x * .55 + back.x * kick + across.x * out * spread, (1.5 + r() * 2.8) * strength, velocity.z * .55 + back.z * kick + across.z * out * spread),
      age: 0, life: .24 + r() * .28, stage, size: 1 + r() * .8 + (stage - 1) * .25,
    });
  }
  puff(car, wheel, velocity, out, strength = 1) {
    if (this.smoke.length >= PUFFS) this.smoke.shift();
    const r = this.random, p = this.at(car, wheel.x + out * .15, .18, wheel.z + .25).clone();
    this.smoke.push({ p, v: new THREE.Vector3(velocity.x * .18 + (r() - .5) * 1.2, .5 + r() * .7, velocity.z * .18 + (r() - .5) * 1.2), age: 0, life: .55 + r() * .4, size: (.22 + r() * .12) * strength, grey: .82 + r() * .14 });
  }
  flare(car, wheels, stage) {
    this.flicker += .7;
    wheels.forEach((wheel, i) => {
      const pulse = 1 + Math.sin(this.flicker * 1.7 + i * 2) * .18 + stage * .12;
      matrix.compose(this.at(car, wheel.x, .1, wheel.z + .05), car.quaternion, size.set(pulse, pulse * .8, pulse * 1.3));
      this.flares.setMatrixAt(i, matrix);
      this.flares.setColorAt(i, colour.set(STAGE_COLOURS[stage]).multiplyScalar(1.3));
    });
    this.flares.count = 2;
    this.flares.instanceMatrix.needsUpdate = true; this.flares.instanceColor.needsUpdate = true;
  }
  // A length of tread from where this wheel last laid one to where it is
  mark(car, wheel, index) {
    const p = this.at(car, wheel.x, 0, wheel.z), y = (Number.isFinite(wheel.floor) ? wheel.floor : p.y) + .025, last = this.laid[index];
    if (!last) { this.laid[index] = { x: p.x, y, z: p.z }; return; }
    const dx = p.x - last.x, dz = p.z - last.z, length = Math.hypot(dx, dz);
    if (length < MARK_STEP) return;
    // (a jump, a reset: start again rather than streak across)
    if (length > 4 || Math.abs(y - last.y) > .3) { this.laid[index] = { x: p.x, y, z: p.z }; return; }
    matrix.compose(point.set((p.x + last.x) / 2, (y + last.y) / 2, (p.z + last.z) / 2), turn.setFromAxisAngle(up, Math.atan2(dx, dz)), size.set(1, 1, length + .08));
    this.marks.setMatrixAt(this.markIndex, matrix);
    this.markIndex = (this.markIndex + 1) % MARKS;
    this.marks.count = Math.min(MARKS, this.marks.count + 1);
    this.marks.instanceMatrix.needsUpdate = true;
    this.laid[index] = { x: p.x, y, z: p.z };
  }
  age(dt) {
    for (const list of [this.list, this.smoke]) for (let i = list.length - 1; i >= 0; i--) {
      const bit = list[i];
      bit.age += dt;
      if (bit.age >= bit.life) { list.splice(i, 1); continue; }
      if (list === this.list) bit.v.y -= GRAVITY * dt;
      else bit.v.multiplyScalar(Math.exp(-dt * 2.5));
      bit.p.addScaledVector(bit.v, dt);
    }
  }
  // Flames from the back: a turbo's in its stage's color, bigger for a
  // bigger one, the boost's gold
  flame(vehicle, dt) {
    const drift = vehicle.drift, boost = drift.boost, turbo = boost > 0;
    const burning = turbo ? Math.min(1, .4 + boost) * (1 + drift.turboStage * .15) : vehicle.boosting ? .65 : 0;
    if (!burning || (vehicle.aloft && !turbo)) { this.flames.count = 0; return; }
    this.flicker += dt * 38;
    const hue = turbo ? STAGE_COLOURS[drift.turboStage] : BOOST_COLOUR;
    // (out of the body, so they rock and lift with it, from where its tail is: see tailPipes)
    const body = vehicle.body ?? vehicle.car, tail = vehicle.spec?.tail ?? { x: .34, y: .36, z: (vehicle.spec?.length ?? 4) / 2 - .05 };
    body.updateWorldMatrix(true, false); body.getWorldQuaternion(turn);
    let n = 0;
    for (const x of [-tail.x, tail.x]) for (const core of [false, true]) {
      const flicker = 1 + Math.sin(this.flicker + x * 9 + (core ? 2 : 0)) * .14;
      const length = (core ? .55 : 1) * burning * flicker, width = (core ? .55 : 1.05) * Math.min(1.2, .8 + burning * .3);
      matrix.compose(point.set(x, tail.y, tail.z).applyMatrix4(body.matrixWorld), turn, size.set(width, width, length));
      this.flames.setMatrixAt(n, matrix);
      // (the core only a little paler than the flame, so the stage's color holds)
      this.flames.setColorAt(n, core ? colour.set(hue).lerp(WHITE, .45) : colour.set(hue));
      n++;
    }
    this.flames.count = n;
    this.flames.instanceMatrix.needsUpdate = true; this.flames.instanceColor.needsUpdate = true;
  }
  // A jetpack burning (see Walker's IGNITE): two gold flames down out of the
  // pack along the figure, however it leans or flips, and a trail of smoke
  jetpack(walker, dt) {
    const figure = walker.figure, burn = walker.jet;
    this.flares.count = 0; this.seen = null; this.laid = [null, null];
    if (burn < .05) { this.flames.count = 0; return; }
    figure.updateWorldMatrix(true, false);
    figure.getWorldQuaternion(turn).multiply(DOWNWARD);
    this.flicker += dt * 38;
    let n = 0;
    for (const x of NOZZLES) for (const core of [false, true]) {
      const flicker = 1 + Math.sin(this.flicker + x * 40 + (core ? 2 : 0)) * .16;
      matrix.compose(point.set(x, NOZZLE_Y, NOZZLE_Z).applyMatrix4(figure.matrixWorld), turn, size.set(core ? .2 : .38, core ? .2 : .38, (core ? .55 : 1.15) * burn * flicker));
      this.flames.setMatrixAt(n, matrix);
      this.flames.setColorAt(n, core ? colour.set(BOOST_COLOUR).lerp(WHITE, .45) : colour.set(BOOST_COLOUR));
      n++;
    }
    this.flames.count = n;
    this.flames.instanceMatrix.needsUpdate = true; this.flames.instanceColor.needsUpdate = true;
    this.fume += dt * 18 * burn;
    for (const r = this.random; this.fume >= 1; this.fume--) {
      if (this.smoke.length >= PUFFS) this.smoke.shift();
      const p = point.set((r() - .5) * .2, NOZZLE_Y - .45, NOZZLE_Z).applyMatrix4(figure.matrixWorld).clone();
      this.smoke.push({ p, v: new THREE.Vector3(walker.vx * .3 + (r() - .5) * .8, -3 - r() * 2, walker.vz * .3 + (r() - .5) * .8), age: 0, life: .35 + r() * .2, size: .09 + r() * .07, grey: .8 + r() * .12 });
    }
  }
  draw() {
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const spark = list[i], fade = 1 - spark.age / spark.life, stretch = 1 + spark.v.length() * .12;
      turn.setFromUnitVectors(forward, way.copy(spark.v).normalize());
      matrix.compose(spark.p, turn, size.set(spark.size * fade, spark.size * fade, spark.size * stretch));
      this.sparks.setMatrixAt(i, matrix);
      // (a spark cools from white to its color as it goes)
      this.sparks.setColorAt(i, colour.set(STAGE_COLOURS[spark.stage]).lerp(WHITE, Math.max(0, 1 - spark.age / .07)).multiplyScalar(1.6 * fade + .3));
    }
    this.sparks.count = list.length;
    if (list.length) { this.sparks.instanceMatrix.needsUpdate = true; this.sparks.instanceColor.needsUpdate = true; }
    const smoke = this.smoke;
    for (let i = 0; i < smoke.length; i++) {
      const puff = smoke[i], age = puff.age / puff.life, scale = puff.size * (1 + age * 2.6) * (1 - age * age);
      matrix.compose(puff.p, turn.identity(), size.set(scale, scale * .8, scale));
      this.puffs.setMatrixAt(i, matrix);
      this.puffs.setColorAt(i, colour.setScalar(puff.grey));
    }
    this.puffs.count = smoke.length;
    if (smoke.length) { this.puffs.instanceMatrix.needsUpdate = true; this.puffs.instanceColor.needsUpdate = true; }
  }
  dispose() {
    for (const mesh of [this.sparks, this.flares, this.flames, this.puffs, this.marks]) { mesh.geometry.dispose(); mesh.dispose(); }
    for (const material of [this.glow, this.smokeMaterial, this.markMaterial]) material.dispose();
    this.group.removeFromParent();
  }
}
