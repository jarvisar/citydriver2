import test from 'node:test';
import assert from 'node:assert/strict';
import { GOALS, GOALS_PER_SHIFT, shiftGoals, goalTier, goalProgress } from '../src/taxi-goals.js';
import { TaxiRun, STOP_SECONDS, TIPS } from '../src/taxi-run.js';
import { DRIVER_RANKS } from '../src/taxi-career.js';

const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };
const player = () => ({ s: 25, u: 3, heading: 0, speed: 0 });
const solo = run => run.customers.find(c => c.passengers === 1 && c.id !== run.blockedPickup?.id);
function deliver(run, car, customer) {
  Object.assign(car, { s: customer.s, u: customer.u, speed: 0 }); run.update(STOP_SECONDS, car);
  assert.equal(run.status, 'driving'); run.drainEvents();
  while (run.status === 'driving') { Object.assign(car, { s: run.target.s, u: run.target.u }); run.update(STOP_SECONDS, car); }
}

test('every shift draws three distinct goals, seeded by the shift number and stepped up by rank', () => {
  assert.ok(GOALS.length >= 8);
  for (const goal of GOALS) {
    assert.equal(goal.targets.length, 3); assert.equal(goal.bonus.length, 3);
    for (let i = 1; i < 3; i++) { assert.ok(goal.targets[i] >= goal.targets[i - 1]); assert.ok(goal.bonus[i] >= goal.bonus[i - 1]); }
    assert.match(goal.text(goal.targets[0]), /\S/);
  }
  const drawn = new Set();
  for (let shift = 0; shift < 40; shift++) {
    const goals = shiftGoals(shift, 0);
    assert.equal(goals.length, GOALS_PER_SHIFT);
    assert.equal(new Set(goals.map(goal => goal.id)).size, GOALS_PER_SHIFT, 'no goal repeats within a shift');
    assert.deepEqual(goals, shiftGoals(shift, 0), 'restarting a shift keeps its goals');
    assert.deepEqual(goals.slice(0, 2).map(goal => goal.tier), [0, 0]); assert.equal(goals[2].tier, 1, 'the last goal is the stretch');
    for (const goal of goals) { assert.equal(goal.progress, 0); assert.equal(goal.done, false); assert.ok(goal.bonus >= 100); }
    goals.forEach(goal => drawn.add(goal.id));
  }
  assert.ok(drawn.size >= GOALS.length - 1, `many shifts see nearly every goal: ${[...drawn]}`);
  assert.notDeepEqual(shiftGoals(1, 0).map(g => g.id), shiftGoals(2, 0).map(g => g.id));
  assert.deepEqual(DRIVER_RANKS.map((_, index) => goalTier(index)), [0, 0, 1, 1, 2, 2, 2]);
  assert.deepEqual(shiftGoals(3, 6).map(goal => goal.tier), [2, 2, 2]);
  assert.ok(shiftGoals(3, 6).reduce((sum, goal) => sum + goal.bonus, 0) > shiftGoals(3, 0).reduce((sum, goal) => sum + goal.bonus, 0));
  assert.equal(goalProgress({ stat: 'delivered', target: 3 }, { delivered: 7 }), 3);
  assert.equal(goalProgress({ stat: 'missing', target: 3 }, {}), 0);
});

test('goals track the shift, bank their bonus with the fleet once, and leave the score alone', () => {
  const disk = storage(), run = new TaxiRun(disk), car = player(); run.start(car);
  run.goals = [{ id: 'fares', stat: 'delivered', tier: 0, target: 2, bonus: 150, text: 'Deliver 2 fares', progress: 0, done: false },
    { id: 'combo', stat: 'combo', tier: 0, target: 3, bonus: 100, text: 'Chain a ×3 stunt combo', progress: 0, done: false },
    { id: 'tips', stat: 'tips', tier: 2, target: 100000, bonus: 500, text: 'Bank $100000 in tips', progress: 0, done: false }];
  deliver(run, car, solo(run)); run.drainEvents();
  assert.equal(run.goals[0].progress, 1); assert.equal(run.goals[0].done, false);
  assert.equal(run.fleet.balance, run.cash, 'nothing extra banks before a goal completes');
  deliver(run, car, solo(run));
  const events = run.drainEvents();
  assert.equal(events[0].kind, 'paid', 'the fare still announces first');
  const goal = events.find(e => e.kind === 'goal');
  assert.equal(goal.text, 'Goal · Deliver 2 fares · +$150'); assert.equal(goal.bonus, 150);
  assert.equal(run.goals[0].done, true); assert.equal(run.goalCash, 150);
  assert.equal(run.fleet.balance, run.cash + 150, 'the bonus goes to the fleet bank');
  assert.equal(run.delivered, 2);
  // Stunts count toward goals mid-fare.
  Object.assign(car, solo(run)); run.update(STOP_SECONDS, car); run.drainEvents();
  run.reward('Drift', TIPS.drift); run.reward('Drift', TIPS.drift);
  assert.equal(run.bestCombo, 3); assert.equal(run.goals[1].done, true); assert.equal(run.goalCash, 250);
  assert.deepEqual(run.drainEvents().map(e => e.kind), ['tip', 'tip', 'goal']);
  assert.equal(run.goals[2].done, false); assert.equal(run.goals[2].progress, run.tipsBanked);
  const balance = run.fleet.balance; run.checkGoals(); run.checkGoals();
  assert.equal(run.fleet.balance, balance, 'a finished goal never pays twice');
  assert.equal(run.stats.nearMisses, 0); assert.equal(run.stats.combo, 3);
  run.timeLeft = .01; run.update(.02, car);
  assert.equal(run.status, 'over'); assert.equal(run.goalCash, 250);
  assert.equal(new TaxiRun(disk).fleet.balance, run.cash + 250, 'goal money survives reload');
  run.start(car); assert.equal(run.goalCash, 0); assert.ok(run.goals.every(goal => !goal.done && goal.progress === 0));
});

test('a shift counts groups, full cabs, long rides, stunts and streaks for its goals', () => {
  const run = new TaxiRun(), car = player();
  for (let s = -750; s <= 750 && !run.fare; s += 250) for (let u = -750; u <= 750; u += 250) {
    Object.assign(car, { s, u }); run.start(car);
    const group = run.customers.find(c => c.passengers === 4 && c.id !== run.blockedPickup?.id);
    if (!group) continue;
    Object.assign(car, { s: group.s, u: group.u, speed: 0 }); run.update(STOP_SECONDS, car); break;
  }
  assert.equal(run.status, 'driving'); assert.equal(run.onboard, 4);
  const band = run.fare.band;
  run.reward('Near miss', TIPS.nearMiss); run.reward('Crazy stop', TIPS.crazyStop, false);
  assert.equal(run.nearMisses, 1); assert.equal(run.crazyStops, 1); assert.equal(run.drifts, 0);
  while (run.status === 'driving') { Object.assign(car, { s: run.target.s, u: run.target.u }); run.update(STOP_SECONDS, car); }
  assert.equal(run.groups, 1); assert.equal(run.fullCabs, 1); assert.equal(run.longRides, band === 'long' ? 1 : 0);
  assert.equal(run.stats.riders, 4); assert.ok(run.tipsBanked > 0); assert.equal(run.stats.tips, run.tipsBanked);
  assert.ok(run.bestStreak >= 1, 'instant arrivals are Speedy');
});
