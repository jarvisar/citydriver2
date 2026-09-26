import test from 'node:test';
import assert from 'node:assert/strict';
import { CITY, QUAY } from '../src/world/city.js';
import { deckEdges, onDeck, bridgePiers, COPING_TOP } from '../src/world/city-streets.js';
import { insidePolygon, polygonBounds, distanceToPolyline, bufferPolyline } from '../src/mapgen/polygon-util.js';

// Bridges as the city lays them (see layDecks in city.js and deckEdges in
// city-streets.js): whatever is paved over the water stands on a deck, and
// each edge of a deck over the water has the quays' coping and a railing.
const onLand = p => CITY.land.some(piece => insidePolygon(p, piece.outer) && !piece.holes.some(hole => insidePolygon(p, hole)));
// (clear of the shore by more than the hairline a promenade leaves along it)
const wellOut = p => [[0, 0], [.8, 0], [-.8, 0], [0, .8], [0, -.8]].every(([dx, dy]) => !onLand({ x: p.x + dx, y: p.y + dy }));
// (paved as drawn: the carriageways square ended, and the corners handed to them)
const surfaces = [...CITY.roads.filter(road => road.kind !== 'path').map(road => bufferPolyline(road.points, road.profile.halfWidth)), ...CITY.cornerPatches]
  .map(polygon => ({ polygon, bounds: polygonBounds(polygon) }));
const paved = p => Boolean(CITY.pavement.find(p.x, p.y)) ||
  surfaces.some(({ polygon, bounds: b }) => p.x > b.minX && p.x < b.maxX && p.y > b.minY && p.y < b.maxY && insidePolygon(p, polygon));

test('whatever is paved over the water stands on a deck', () => {
  let samples = 0;
  for (const bridge of CITY.bridges) {
    const points = bridge.points, reach = bridge.road.profile.halfWidth + QUAY;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1], length = Math.hypot(b.x - a.x, b.y - a.y) || 1, tx = (b.x - a.x) / length, ty = (b.y - a.y) / length;
      for (let d = 0; d < length; d += 2) for (let across = -reach + .3; across < reach; across += 1) {
        const p = { x: a.x + tx * d - ty * across, y: a.y + ty * d + tx * across };
        if (!paved(p) || !wellOut(p)) continue;
        samples++;
        assert.ok(onDeck(p.x, p.y, .1), `paving over the water with no deck under it at ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
      }
    }
  }
  assert.ok(samples > 100, 'the bridges carry paving over the water');
});

test('a deck is only where there is paving, not across the water between two bridges', () => {
  for (const deck of CITY.decks) {
    const b = polygonBounds(deck.outer);
    for (let x = b.minX + .7; x < b.maxX; x += 2.5) for (let y = b.minY + .9; y < b.maxY; y += 2.5) {
      const p = { x, y };
      if (!insidePolygon(p, deck.outer) || deck.holes.some(hole => insidePolygon(p, hole))) continue;
      // (a notch the deck closes over under its coping aside)
      const near = [[0, 0], [.7, 0], [-.7, 0], [0, .7], [0, -.7]].some(([dx, dy]) => paved({ x: x + dx, y: y + dy }));
      assert.ok(near, `a deck with no paving on it at ${x.toFixed(1)},${y.toFixed(1)}`);
    }
  }
});

test('a deck\'s railing follows its edge over the water, facing the water, unbroken between its posts', () => {
  let pieces = 0;
  for (const { line, rail } of deckEdges()) {
    const ends = [line[0], line.at(-1)];
    for (const piece of rail.pieces) {
      pieces++;
      const at = `${piece.x.toFixed(1)},${piece.y.toFixed(1)}`;
      // Along the deck's edge (or carried on a little onto the bank), never out across a road
      assert.ok(distanceToPolyline(piece, line) < 1.3 || ends.some(end => Math.hypot(end.x - piece.x, end.y - piece.y) < 3), `a railing off the deck's edge at ${at}`);
      // The water on its outer side (the right, going along the deck's edge)
      const out = { x: piece.x + piece.ty * 1.8, y: piece.y - piece.tx * 1.8 };
      if (wellOut(out)) assert.ok(!paved(out), `a railing with paving on its water side at ${at}`);
    }
    // (every half metre of the line between the posts has a length of railing
  // along it, give or take a chord across a bevel)
    const along = rail.line;
    for (let i = 0; i < along.length - 1; i++) {
      const a = along[i], b = along[i + 1], length = Math.hypot(b.x - a.x, b.y - a.y);
      for (let d = 0; d <= length; d += .5) {
        const p = { x: a.x + (b.x - a.x) * d / (length || 1), y: a.y + (b.y - a.y) * d / (length || 1) };
        if (rail.posts.some(post => Math.hypot(post.x - p.x, post.y - p.y) < .35)) continue;
        const covered = rail.pieces.some(q => distanceToPolyline(p, [{ x: q.x - q.tx * q.length / 2, y: q.y - q.ty * q.length / 2 }, { x: q.x + q.tx * q.length / 2, y: q.y + q.ty * q.length / 2 }]) < .25);
        assert.ok(covered, `a gap in a bridge's railing at ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
      }
    }
  }
  assert.ok(pieces > 0, 'the bridges have railings');
});

test('a railing on a coping is a timber truss from post to post, its panels even and its chord over the coping', () => {
  let panels = 0;
  for (const { rail, truss, y } of deckEdges()) {
    // (a promenade's railing is the quay's own)
    if (y !== COPING_TOP) { assert.equal(truss.length, 0, 'a truss along a promenade'); continue; }
    assert.equal(truss.length, rail.spans.length, 'a truss over every span');
    truss.forEach((nodes, k) => {
      const span = rail.spans[k], at = `${span[0].x.toFixed(1)},${span[0].y.toFixed(1)}`;
      assert.ok(Math.hypot(nodes[0].x - span[0].x, nodes[0].y - span[0].y) < 1e-6 && Math.hypot(nodes.at(-1).x - span.at(-1).x, nodes.at(-1).y - span.at(-1).y) < 1e-6, `a truss short of its posts at ${at}`);
      for (let i = 0; i < nodes.length - 1; i++) {
        const a = nodes[i], b = nodes[i + 1], length = Math.hypot(b.x - a.x, b.y - a.y);
        panels++;
        assert.ok(length < 16.5 && length > .5, `a truss panel ${length.toFixed(1)} m long at ${at}`);
        for (let t = .1; t < 1; t += .1) assert.ok(distanceToPolyline({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, span) < .3, `a truss's chord off its coping at ${at}`);
      }
    });
  }
  assert.ok(panels > 0, 'the bridges have trusses');
});

test('piers stand in the water, under a deck', () => {
  const piers = bridgePiers();
  assert.ok(piers.length > 0, 'the bridges have piers');
  for (const pier of piers) for (const p of pier.outline) {
    assert.ok(!onLand(p), `a pier on the bank at ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    assert.ok(onDeck(p.x, p.y, 0), `a pier out from under its deck at ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  }
});
