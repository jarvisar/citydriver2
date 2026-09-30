import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DrivingController } from '../src/vehicle.js';
import { FrameClock } from '../src/timing.js';
import { DRIFT_MIN, DRIFT_END, STAGES, TURBOS, TRICK } from '../src/drift.js';
import { DriftEffects, STAGE_COLOURS } from '../src/drift-effects.js';
import { TaxiRun, TIPS } from '../src/taxi-run.js';
import { taxiHudModel } from '../src/run-hud-model.js';
import { cueNotes } from '../src/audio/cues.js';

const STEP = 1 / 120, GROUND = 24;
// A flat open road, and a ramp in it `at` metres north for the jumps
const road = { grid: true, laneAssist: false, frame: () => ({ angle: 0, scale: 1 }), position: (s, u, y = GROUND) => ({ x: u, y, z: -s }), height: () => GROUND, water: () => false, bounds: () => [-1e9, 1e9], looseness: () => 0 };
function ramp(at = 40, rise = 1.6, run = 6, flat = 1.2, width = 4) {
  const z0 = -at, z1 = -(at + run + flat), w = width / 2;
  return { corners: [{ x: -w, z: z0 }, { x: w, z: z0 }, { x: w, z: z1 }, { x: -w, z: z1 }], x: 0, z: (z0 + z1) / 2, reach: Math.hypot(w, (run + flat) / 2) + 1, heading: 0, top: GROUND + rise,
    shape: { kind: 'ramp', x: 0, z: z0, dx: 0, dz: -1, run, rise, curve: .5, flat, base: GROUND } };
}
const chunks = (...solids) => new Map([['test', { collisionBounds: { minX: -50, maxX: 50, minZ: -500, maxZ: 50 }, features: { colliders: solids } }]]);
function car(id = 'taxi', speed = 18, scenery = null) {
  // (on the ramps' line, not the controller's default lane)
  const c = new DrivingController(road, { s: 24, u: 0, heading: 0 }, id);
  c.freeDriving = true; c.scenery = scenery; c.speed = speed; c.update(0, {});
  return c;
}
// Holds `input` for `seconds`, keeping `speed` if given, and returns the events
function hold(c, seconds, input, speed = null, hz = 120) {
  const events = [];
  for (let t = 0; t < seconds - 1e-9; t += 1 / hz) {
    if (speed !== null) c.speed = speed;
    c.update(1 / hz, input);
    events.push(...c.drain());
  }
  return events;
}

test('the drift button hops the car at speed, a quick hop that keeps its tyres working, and a thump as it lands', () => {
  const c = car();
  try {
    const bumps = c.audioTelemetry.bumpSerial;
    let peak = 0, aloft = false;
    for (let i = 0; i < 60; i++) { c.update(STEP, { forward: 1, handbrake: true }); peak = Math.max(peak, c.y - GROUND); aloft ||= c.aloft; }
    assert.ok(peak > .07 && peak < .2, `hopped ${peak.toFixed(3)} m`);
    assert.ok(!aloft, 'never off its tyres');
    assert.ok(Math.abs(c.y - GROUND) < 1e-6 && c.audioTelemetry.bumpSerial > bumps, 'down again with a thump');
    // Held on going straight, no drift, no brake and no second hop
    const speed = c.speed, hops = c.drift.hops;
    hold(c, 1, { forward: 1, handbrake: true });
    assert.ok(!c.drifting && c.speed >= speed - .5 && c.drift.hops === hops);
    // Slow, no hop: it is the handbrake
    const slow = car('taxi', 2);
    try { slow.update(STEP, { handbrake: true }); assert.equal(slow.drift.hops, 0); } finally { slow.disposeModel(); }
  } finally { c.disposeModel(); }
});

test('steering into a drift turns it tighter and charges two and a half times as fast as steering out or not at all', () => {
  const yaw = {}, stage = {};
  for (const [name, steer] of [['in', 1], ['none', 0], ['out', -1]]) {
    const c = car();
    try {
      hold(c, .1, { right: 1, handbrake: true }, 18);
      const events = hold(c, 3, { right: Math.max(0, steer), left: Math.max(0, -steer), handbrake: true }, 18);
      assert.ok(c.drifting && c.driftDirection === 1, `${name}: still drifting right`);
      yaw[name] = c.yawRate;
      stage[name] = events.filter(e => e.kind === 'drift').map(e => e.stage);
    } finally { c.disposeModel(); }
  }
  assert.ok(yaw.in > yaw.none * 1.2 && yaw.none > yaw.out * 1.3 && yaw.out > 0, JSON.stringify(yaw));
  assert.deepEqual(stage.in, [1, 2, 3], 'all three stages steered in, within three seconds');
  assert.deepEqual(stage.none, [1], 'only blue otherwise');
  // (the thresholds: inward seconds)
  const c = car();
  try {
    hold(c, .05, { right: 1, handbrake: true }, 18);
    const times = [];
    for (let t = .05; t < 3; t += STEP) { c.speed = 18; c.update(STEP, { right: 1, handbrake: true }); for (const e of c.drain()) if (e.kind === 'drift') times.push(t); }
    STAGES.forEach((threshold, i) => assert.ok(Math.abs(times[i] - threshold) < .07, `stage ${i + 1} at ${times[i]?.toFixed(2)} s`));
  } finally { c.disposeModel(); }
});

test('letting go fires a turbo by the stage reached: a kick at once, then past top speed, longer and faster at each stage', () => {
  const runs = [];
  for (const seconds of [.3, .8, 1.6, 2.5]) {
    const c = car('auto', 27);
    try {
      // (near top speed, where a turbo takes it past)
      hold(c, seconds, { forward: 1, right: 1, handbrake: true }, c.stats.topSpeed * .97);
      const stage = c.drift.stage, before = c.speed;
      c.update(STEP, { forward: 1 });
      const events = c.drain(), kicked = c.speed;
      let fastest = 0, lasted = 0;
      for (let i = 0; i < 360; i++) { c.update(STEP, { forward: 1 }); fastest = Math.max(fastest, c.speed); if (c.drift.turbo > 0) lasted += STEP; }
      runs.push({ stage, fired: events.find(e => e.kind === 'turbo')?.stage ?? 0, kick: kicked - before, fastest: fastest / c.stats.topSpeed, lasted });
    } finally { c.disposeModel(); }
  }
  assert.deepEqual(runs.map(r => r.stage), [0, 1, 2, 3]);
  assert.deepEqual(runs.map(r => r.fired), [0, 1, 2, 3], 'nothing before blue, then each stage fires its own');
  assert.ok(runs[0].fastest <= 1 + 1e-9, 'no turbo, no more than top speed');
  for (let i = 1; i < 4; i++) {
    assert.ok(runs[i].kick > 1, `stage ${i}: a kick at once (${runs[i].kick.toFixed(2)} m/s)`);
    assert.ok(Math.abs(runs[i].lasted - TURBOS[i].time) < .02, `stage ${i}: lasts ${runs[i].lasted.toFixed(2)} s`);
    assert.ok(runs[i].fastest > 1.05 && runs[i].fastest <= 1 + TURBOS[i].top + 1e-9, `stage ${i}: up to ${runs[i].fastest.toFixed(3)} of top speed`);
    if (i > 1) assert.ok(runs[i].fastest > runs[i - 1].fastest && runs[i].lasted > runs[i - 1].lasted);
  }
});

test('a drift ends and loses its charge when too slow or in a crash, and a crash stops a turbo too', () => {
  const c = car();
  try {
    hold(c, 1, { right: 1, handbrake: true }, 18);
    assert.equal(c.drift.stage, 1);
    const losses = c.drift.losses;
    c.speed = DRIFT_END - .5;
    const events = hold(c, .05, { right: 1, handbrake: true });
    assert.ok(!c.drifting && c.drift.losses === losses + 1 && !events.some(e => e.kind === 'turbo'), 'too slow: over, charge lost');
    // A crash mid-drift, and one mid-turbo
    c.reset(); c.speed = 18; c.update(0, {});
    hold(c, 1, { right: 1, handbrake: true }, 18);
    assert.ok(c.drifting, 'drifting again');
    c.audioTelemetry.crashSerial++;
    hold(c, STEP, { right: 1, handbrake: true });
    assert.ok(!c.drifting && c.drift.charge === 0, 'a crash ends it');
    hold(c, .2, {}, 18);
    hold(c, 1, { right: 1, handbrake: true }, 18);
    hold(c, .05, {}, 18);
    assert.ok(c.drift.turbo > 0, 'a turbo going');
    c.audioTelemetry.crashSerial++;
    hold(c, STEP, {});
    assert.equal(c.drift.turbo, 0, 'stopped by a crash');
    assert.ok(DRIFT_MIN > DRIFT_END, 'a drift starts faster than it ends');
  } finally { c.disposeModel(); }
});

test('braking in a drift tightens it and slows it more gently than braking out of one (a brake drift)', () => {
  const plain = car(), braked = car();
  try {
    for (const c of [plain, braked]) hold(c, .5, { right: 1, handbrake: true }, 18);
    hold(plain, .3, { right: 1, handbrake: true }, 18);
    hold(braked, .3, { right: 1, brake: 1, handbrake: true }, 18);
    assert.ok(braked.drifting && braked.yawRate > plain.yawRate * 1.05, 'tighter');
    const straight = car('taxi', 18);
    try {
      braked.speed = straight.speed = 18;
      hold(braked, .3, { right: 1, brake: 1, handbrake: true }); hold(straight, .3, { brake: 1 });
      assert.ok(braked.speed > straight.speed + 1.5, `${braked.speed.toFixed(1)} against ${straight.speed.toFixed(1)} m/s`);
    } finally { straight.disposeModel(); }
  } finally { plain.disposeModel(); braked.disposeModel(); }
});

test('a drift waits out a jump: no charge in the air, on again on the landing if still held', () => {
  const c = car('taxi', 22, chunks(ramp(40, 1.6, 6, 1.2, 10)));
  try {
    // Drifting toward the ramp, steered out of it (a wide arc), held through the flight
    c.s = 36; c.update(0, {});
    let charged = null, flew = false, before = 0;
    for (let i = 0; i < 480; i++) {
      c.update(STEP, { forward: 1, left: i > 3 ? 1 : 0, right: i <= 3 ? 1 : 0, handbrake: true });
      if (c.aloft && !flew) { flew = true; before = c.drift.charge; }
      if (flew && c.aloft) charged ??= c.drift.charge;
      if (flew && !c.aloft && c.drift.charge > before + .05) break;
      c.drain();
    }
    assert.ok(flew, 'it left the ramp');
    assert.equal(charged, before, 'no charge in the air');
    assert.ok(c.drifting && c.driftDirection === 1, 'still drifting after the landing');
  } finally { c.disposeModel(); }
});

test('a press just after leaving a ramp is a trick, and a trick or a spin landed fires a turbo', () => {
  // (a spin wants a second or so in the air)
  for (const [name, input, stage, rise] of [['trick', 'tap', 1, 3.4], ['spin', 'spin', 2, 5], ['nothing', null, 0, 3.4]]) {
    // (no level top, where the car would land a hop before the real jump)
    const c = car('taxi', 32, chunks(ramp(40, rise, 12, 0)));
    try {
      c.s = 10; c.update(0, {});
      const turbos = [];
      let took = null;
      for (let i = 0; i < 600; i++) {
        let keys = { forward: 1 };
        if (c.aloft && took === null) took = i;
        const since = took === null ? -1 : (i - took) * STEP;
        if (input === 'tap' && since >= 0 && since < .08) keys.handbrake = true;
        if (input === 'spin' && since >= 0 && since < .5) keys = { ...keys, handbrake: true, right: 1 };
        c.update(STEP, keys);
        for (const e of c.drain()) if (e.kind === 'turbo') turbos.push(e.stage);
        // (down once the flight has landed: `aloft` clears a little before the wheels touch)
        if (took !== null && !c.carAir.flight && since > .3) break;
      }
      assert.ok(took !== null, `${name}: it flew`);
      assert.deepEqual(turbos, stage ? [stage] : [], `${name}: turbo ${turbos}`);
    } finally { c.disposeModel(); }
  }
});

test('a drift held off a ramp is not a spin: spinning needs the button pressed again in the air', () => {
  const c = car('taxi', 26, chunks(ramp()));
  try {
    c.s = 20; c.update(0, {});
    let turned = 0;
    for (let i = 0; i < 480; i++) {
      c.update(STEP, { forward: 1, right: 1, handbrake: true });
      if (c.aloft) turned = Math.max(turned, Math.abs(c.carAir.turn));
      c.drain();
    }
    assert.ok(turned < .6, `leaned ${turned.toFixed(2)} rad, no spin`);
  } finally { c.disposeModel(); }
});

test('tap to drift: a press starts a drift when steered, the next lets it go, and nothing needs holding', () => {
  const c = car();
  try {
    c.driftMode = 'tap';
    hold(c, 3 / 120, { right: 1, handbrake: true }, 18);
    hold(c, 1.2, { right: 1 }, 18);
    assert.ok(c.drifting && c.drift.stage >= 1, 'drifting and charging, the button up');
    const events = [...hold(c, 3 / 120, { right: 1, handbrake: true }, 18), ...hold(c, .1, { right: 1 }, 18)];
    assert.ok(!c.drifting && events.some(e => e.kind === 'turbo'), 'the next press fires the turbo');
    // A press going straight waits for the steering
    hold(c, 3 / 120, { handbrake: true }, 18);
    hold(c, .5, {}, 18);
    hold(c, .2, { left: 1 }, 18);
    assert.ok(c.drifting && c.driftDirection === -1);
    // and slow, a latch is let go, the button still the handbrake
    hold(c, 3 / 120, { handbrake: true }, 18); hold(c, .05, {});
    c.speed = 4; hold(c, .05, {});
    assert.ok(!c.drift.latched);
  } finally { c.disposeModel(); }
});

test('the charge and its stages come at the same moments at every frame rate', () => {
  let reference = null;
  for (const hz of [30, 60, 120, 144, 240]) {
    const c = car(), clock = new FrameClock();
    try {
      const events = [];
      for (let frame = 0; frame <= hz * 3; frame++) {
        clock.tick(frame * 1000 / hz, true, dt => { c.speed = 18; c.update(dt, { right: 1, handbrake: true }); for (const e of c.drain()) events.push(`${e.kind}${e.stage}@${e.time.toFixed(4)}`); });
        c.render(clock.alpha);
      }
      const result = [events.join(' '), c.drift.stage, c.drift.charge, c.s, c.u, c.heading];
      reference ??= result;
      assert.deepEqual(result, reference, `${hz} Hz`);
    } finally { c.disposeModel(); }
  }
});

test('a taxi rider tips at each spark stage, more at each, but not for a drift that ground along something', () => {
  const run = new TaxiRun(null);
  Object.assign(run, { status: 'driving', fare: { mood: null, passengers: 1 }, onboard: 1, combo: 1, crashCooldown: 0, elapsed: 10, scrapedAt: -Infinity, drifts: 0 });
  run.onTheWay = () => true;
  const tips = [];
  for (const stage of [1, 2, 3]) { run.drifted({ stage, time: 2 }, {}); tips.push(...run.drainEvents().filter(e => e.kind === 'tip')); }
  assert.deepEqual(tips.map(t => t.trick), ['Drift', 'Super drift', 'Ultra drift']);
  assert.ok(TIPS.drift < TIPS.superDrift && TIPS.superDrift < TIPS.ultraDrift);
  assert.equal(run.drifts, 3);
  run.scrapedAt = 9;
  run.drifted({ stage: 1, time: 2 }, {});
  assert.equal(run.drainEvents().filter(e => e.kind === 'tip').length, 0, 'scraped a second into a two-second drift');
  run.drifted({ stage: 1, time: .5 }, {});
  assert.equal(run.drainEvents().filter(e => e.kind === 'tip').length, 1, 'a drift begun after the scrape tips');
});

test('the Drift button shows the charge toward the next stage, then the turbo', () => {
  const c = car(), run = new TaxiRun(null);
  try {
    let model = taxiHudModel(run, c, { free: true });
    assert.equal(model.driftState, null);
    hold(c, .3, { right: 1, handbrake: true }, 18);
    model = taxiHudModel(run, c, { free: true });
    assert.ok(model.driftState === 'Drifting' && model.driftStage === 0 && model.driftCharge > .3 && model.driftCharge < .7);
    hold(c, .5, { right: 1, handbrake: true }, 18);
    model = taxiHudModel(run, c, { free: true });
    assert.ok(model.driftState === 'Blue' && model.driftStage === 1);
    hold(c, .05, {});
    model = taxiHudModel(run, c, { free: true });
    assert.ok(model.driftState === 'Turbo' && model.turbo && model.driftStage === 1 && model.driftCharge > .8);
  } finally { c.disposeModel(); }
});

test('sparks fly in the stage\'s colour, a burst at each stage, flames while a turbo lasts, and tyre marks', () => {
  const scene = new THREE.Scene(), c = car(), effects = new DriftEffects(scene, () => .5);
  scene.add(c.car);
  try {
    const frame = seconds => { for (let t = 0; t < seconds; t += 1 / 60) { c.speed = 18; c.update(1 / 60, input); c.render(1, 0); effects.update(c, 1 / 60); } };
    let input = { right: 1, handbrake: true };
    frame(.4);
    assert.equal(effects.sparks.count, 0, 'no sparks before blue');
    assert.ok(effects.marks.count > 4, 'tyre marks');
    frame(.3);
    assert.ok(effects.sparks.count > 10, `a burst at blue (${effects.sparks.count})`);
    assert.ok(effects.list.every(spark => spark.stage === 1), 'blue sparks');
    const colour = new THREE.Color(), older = effects.list.findIndex(spark => spark.age > .06);
    effects.sparks.getColorAt(older, colour);
    assert.ok(older >= 0 && colour.b > colour.r && new THREE.Color(STAGE_COLOURS[1]).b > .9, 'cooled to blue');
    input = {}; frame(.1);
    assert.equal(effects.flames.count, 4, 'flames from the back');
    frame(1);
    assert.equal(effects.flames.count, 0, 'out when the turbo is');
    assert.equal(effects.warmupObjects().length, 4);
  } finally { effects.dispose(); c.disposeModel(); }
});

test('each stage chimes a step higher', () => {
  const tops = [1, 2, 3].map(stage => Math.max(...cueNotes('drift', { stage }).map(note => note.step)));
  assert.ok(tops[0] < tops[1] && tops[1] < tops[2]);
});
