import test from 'node:test';
import assert from 'node:assert/strict';
import { trafficContact } from '../src/collision.js';
import { collisionImpulse, contactPoint } from '../src/impact.js';

test('opposite lanes pass without collision and rotated footprints collide accurately', () => {
  const a = { x: 2.4, z: 0, heading: 0, halfWidth: 1, halfLength: 2 };
  assert.equal(trafficContact(a, { ...a, x: -2.4, heading: Math.PI }), null);
  assert.equal(trafficContact(a, { ...a, z: 4.1 }), null);
  const sideways = { ...a, x: 4.8, heading: Math.PI / 2 };
  const contact = trafficContact(a, sideways);
  assert.ok(contact && contact.depth > .5);
  assert.equal(trafficContact({ ...a, x: a.x + contact.x * (contact.depth + .01), z: a.z + contact.z * (contact.depth + .01) }, sideways), null);
});

test('a blow lands where the cars overlap and conserves momentum and spin', () => {
  const car = { x: 0, z: 0, heading: 0, halfWidth: 1, halfLength: 2, vx: 0, vz: -20 };
  // Square behind a slower car: the point is the nose, and nothing turns.
  const ahead = { ...car, z: -3.9, vz: -10 };
  let point = contactPoint(car, ahead);
  assert.ok(Math.abs(point.x) < 1e-9 && Math.abs(point.z + 1.95) < 1e-9);
  let blow = collisionImpulse(car, ahead, trafficContact(car, ahead), point);
  assert.ok(Math.abs(blow.a.spin) < 1e-12 && Math.abs(blow.b.spin) < 1e-12);
  // Equal cars part at a fifth of the speed they met at.
  assert.ok(Math.abs((-10 + blow.b.z) - (-20 + blow.a.z) + .2 * 10) < 1e-9);
  // Offset to the right: the point is the middle of the overlap. The car behind
  // is held back by its right corner and the one ahead is pushed on by its left,
  // so both swing their noses to the right.
  const offset = { ...ahead, x: 1.2 };
  point = contactPoint(car, offset);
  assert.ok(Math.abs(point.x - .6) < 1e-9 && Math.abs(point.z + 1.95) < 1e-9);
  blow = collisionImpulse(car, offset, trafficContact(car, offset), point);
  assert.ok(blow.a.spin > 0 && blow.b.spin > 0);
  assert.ok(blow.a.z > 0 && blow.a.z < 6, 'an offset hit moves the pair less than a square one');
  // A heavy car into the side of a light one, off-center.
  const van = { x: -3.2, z: .4, heading: Math.PI / 2, halfWidth: 1.05, halfLength: 2.4, vx: 15, vz: 0 }, hatch = { ...car, halfWidth: .9, halfLength: 1.7, vz: -16 };
  const normal = trafficContact(van, hatch);
  point = contactPoint(van, hatch);
  assert.ok(Math.abs(point.x + .8) < 1e-9 && Math.abs(point.z - .4) < 1e-9);
  blow = collisionImpulse(van, hatch, normal, point);
  const mass = body => 4 * body.halfWidth * body.halfLength, inertia = body => mass(body) * (body.halfWidth ** 2 + body.halfLength ** 2) / 3;
  assert.ok(Math.abs(mass(van) * blow.a.x + mass(hatch) * blow.b.x) < 1e-9 && Math.abs(mass(van) * blow.a.z + mass(hatch) * blow.b.z) < 1e-9);
  const turning = (body, change) => inertia(body) * change.spin + mass(body) * (body.x * change.z - body.z * change.x);
  assert.ok(Math.abs(turning(van, blow.a) + turning(hatch, blow.b)) < 1e-9, 'angular momentum about the origin');
  assert.ok(Math.hypot(blow.b.x, blow.b.z) > Math.hypot(blow.a.x, blow.a.z) * 1.5, 'the light car moves more');
  assert.ok(blow.b.spin < 0, 'struck behind its middle from the left, the hatchback swings its nose left');
  // Already coming apart: no blow at all.
  assert.equal(collisionImpulse({ ...car, vz: -5 }, ahead, trafficContact(car, ahead), contactPoint(car, ahead)), null);
});

test('a slow touch does not bounce, and cars sliding past each other scrape', () => {
  const car = { x: 0, z: 0, heading: 0, halfWidth: 1, halfLength: 2, vx: 0, vz: -11 }, ahead = { ...car, z: -3.9, vz: -10 };
  // Nudged at 1 m/s they move off together, rather than chattering
  const nudge = collisionImpulse(car, ahead, trafficContact(car, ahead), contactPoint(car, ahead));
  assert.ok(Math.abs((-11 + nudge.a.z) - (-10 + nudge.b.z)) < 1e-9 && nudge.closing === 1);
  // Side by side and closing across at 3 m/s while one passes the other at 8:
  // the scrape slows the faster, speeds the slower, and keeps their momentum
  const passing = { ...car, vx: 3, vz: -18 }, beside = { ...car, x: 1.95, vz: -10 };
  const blow = collisionImpulse(passing, beside, trafficContact(passing, beside), contactPoint(passing, beside));
  assert.ok(blow.slide > 7 && blow.a.z > 0 && blow.b.z < 0, 'the scrape runs against the way they pass');
  assert.ok(Math.abs(blow.a.z + blow.b.z) < 1e-9 && Math.abs(blow.a.x + blow.b.x) < 1e-9);
  assert.ok(blow.a.z < .3 * 1.2 * 3, 'never more than friction allows');
});

