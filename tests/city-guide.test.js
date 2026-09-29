import test from 'node:test';
import assert from 'node:assert/strict';
import { CityGuide } from '../src/city-guide.js';

globalThis.window = { devicePixelRatio: 2 };

function guideFixture() {
  const poses = [], ctx = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}) });
  const vehicle = { s: 0, u: 0, heading: 0 };
  const guide = Object.assign(Object.create(CityGuide.prototype), {
    expanded: true, canvas: { width: 416, height: 288 }, ctx, position: () => vehicle,
    mapCache: { drawCached: (ctx, pose) => poses.push({ ...pose }) }, foundPlaces: () => [],
  });
  return { guide, poses, vehicle };
}

test('the street map follows the rendered pose without refreshing navigation every frame', () => {
  const { guide, poses, vehicle } = guideFixture();
  let routes = 0;
  const target = { s: 100, u: 0 };
  guide.taxi = { running: true, status: 'driving', target, fare: { stops: [{ destination: target }] }, stopIndex: 0,
    approach: () => { routes++; return target; } };
  guide.draw(vehicle);
  const route = guide.mapState.route;
  for (let i = 1; i <= 60; i++) {
    guide.render({ position: { x: i * .1, z: 1024 - i * .5 }, rotation: { y: -i * .01 } }, 1024);
  }
  assert.equal(routes, 1, 'frame updates reuse the HUD route');
  assert.equal(guide.mapState.route, route);
  assert.deepEqual(poses.at(-1), { u: 6, s: 30, heading: .6 });
  assert.equal(poses.length, 61, 'every distinct display pose is drawn');
  guide.draw({ s: 30, u: 6, heading: .6 });
  assert.equal(routes, 2, 'the next HUD refresh updates navigation');
  guide.taxi.status = 'pickup'; guide.taxi.customers = [];
  guide.draw(vehicle);
  assert.equal(guide.mapState.target, null, 'the old destination disappears after a fare');
  assert.deepEqual(guide.mapState.route, []);
});

test('the street map skips unchanged and folded views and handles origin shifts', () => {
  const { guide, poses, vehicle } = guideFixture();
  guide.draw(vehicle); guide.draw(vehicle);
  assert.equal(poses.length, 1, 'standing still does not redraw');
  const car = { position: { x: 20, z: -30 }, rotation: { y: -Math.PI + .01 } };
  guide.render(car, 0);
  const count = poses.length;
  car.position.z += 1024; guide.render(car, 1024);
  assert.equal(poses.length, count, 'rebasing does not move the map');
  car.rotation.y = Math.PI - .01; guide.render(car, 1024);
  assert.equal(poses.at(-1).heading, -Math.PI + .01, 'heading wraps without an interpolated full turn');
  guide.expanded = false; car.position.x += 10; guide.render(car, 1024);
  assert.equal(poses.length, count + 1, 'a folded map does no frame work');
});
