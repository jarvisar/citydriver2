import test from 'node:test';
import assert from 'node:assert/strict';
import { navGraph, routeDistance } from '../src/world/nav-graph.js';
import { journeyStart, onRoadAt } from '../src/world/city-route.js';

test('the navigation graph joins every street at its junctions', () => {
  const nav = navGraph();
  assert.ok(nav.nodes.length > 100 && nav.edges.length > 150);
  assert.ok(nav.nodes.filter(node => node.edges.length >= 3).length > 50, 'few junctions');
  for (const edge of nav.edges) {
    assert.ok(edge.length > 0 && edge.points.length >= 2);
    assert.ok(nav.nodes[edge.a].edges.includes(edge) && nav.nodes[edge.b].edges.includes(edge));
    assert.ok(edge.profile.halfWidth > 0);
  }
  // No stub left over from the generator's overshoot past a crossing
  const stubs = nav.edges.filter(edge => edge.length < 14 && edge.a !== edge.b && (nav.nodes[edge.a].edges.length === 1 || nav.nodes[edge.b].edges.length === 1));
  assert.equal(stubs.length, 0);
});

test('lane poses run along the edge on the right-hand side and choices rank straight on first', () => {
  const nav = navGraph();
  const edge = nav.edges.find(e => e.length > 80 && e.kind !== 'path');
  const ahead = nav.pose(edge, 20, 1, 3), further = nav.pose(edge, 30, 1, 3), back = nav.pose(edge, 20, -1, 3);
  assert.ok(Math.cos(ahead.heading - Math.atan2(further.u - ahead.u, further.s - ahead.s)) > .95);
  assert.ok(Math.cos(back.heading - ahead.heading) < 0);
  // Right of travel: the offset lane sits on the right of the centre line
  const centre = nav.pose(edge, 20, 1, 0);
  const right = Math.sin(ahead.heading) * (ahead.s - centre.s) - Math.cos(ahead.heading) * (ahead.u - centre.u);
  assert.ok(right < 0 || Math.abs(right) < 1e-9, `lane offset ${right}`);
  assert.ok(onRoadAt(ahead.s, ahead.u));
  const choices = nav.choices(edge, 1);
  for (let i = 1; i < choices.length; i++) assert.ok(Math.abs(choices[i - 1].turn) <= Math.abs(choices[i].turn));
});

test('routes follow the streets and are never shorter than the straight line', () => {
  const nav = navGraph();
  const start = journeyStart();
  for (const target of [{ s: start.s + 400, u: start.u + 300 }, { s: start.s - 500, u: start.u + 50 }, { s: start.s + 20, u: start.u - 700 }]) {
    const route = nav.route(start, target);
    assert.ok(route.length >= 2);
    const length = routeDistance(route), straight = Math.hypot(target.s - start.s, target.u - start.u);
    assert.ok(length >= straight * .95, `${length} < ${straight}`);
    assert.ok(length < straight * 3 + 400, `${length} for a straight ${straight}`);
    for (const p of route.slice(1, -1)) assert.ok(onRoadAt(p.s, p.u) || nav.nearest(p.s, p.u, 40), 'route point off the streets');
  }
});
