import test from 'node:test';
import assert from 'node:assert/strict';
import { CITY, DISTRICT_STYLES, buildCity } from '../src/world/city.js';
import { worldMapLabels, DISTRICT_COLORS } from '../src/city-world-map.js';
import { CityMapCache } from '../src/city-map.js';

const cities = [CITY, buildCity(1065425237), buildCity(3)];

test('every city has one district of each kind, none of them tiny or most of the city', () => {
  for (const city of cities) {
    for (const style of [...DISTRICT_STYLES, 'Midtown']) assert.equal(city.districts.filter(d => d.style === style).length, 1, `seed ${city.seed}: ${style}`);
    const counts = {};
    for (const block of city.blocks) if (block.style) counts[block.style] = (counts[block.style] ?? 0) + 1;
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    for (const style of DISTRICT_STYLES) {
      const share = (counts[style] ?? 0) / total;
      assert.ok(share > .05 && share < .4, `seed ${city.seed}: ${style} is ${Math.round(share * 100)}% of the city`);
    }
  }
});

test('the city map names every district the city has, on land, and has a colour for each', () => {
  for (const city of cities) {
    const labels = worldMapLabels(city), named = new Set(labels.map(label => label.style));
    for (const block of city.blocks) if (block.style) assert.ok(named.has(block.style), `seed ${city.seed}: ${block.style} unnamed`);
    assert.ok(labels.filter(label => label.downtown).length <= 1);
    for (const label of labels) {
      assert.ok(DISTRICT_COLORS[label.style], `no colour for ${label.style}`);
      assert.ok(!city.mask.at(label.x, label.y), `seed ${city.seed}: ${label.name} label in the water at ${label.x.toFixed(0)},${label.y.toFixed(0)}`);
    }
    // one name per district, and none twice
    assert.equal(labels.filter(label => !label.downtown).length, new Set(labels.filter(label => !label.downtown).map(label => label.style)).size);
    assert.ok(labels.length >= 6, `seed ${city.seed}: only ${labels.length} names`);
  }
});

test('the street map draws every shape that reaches its view, in the city order, and the whole city for the city map', () => {
  // Paths that remember their shapes, by first points and length
  const makePath = () => ({ shapes: [], moveTo(x, y) { this.shapes.push([x, y]); }, lineTo(x, y) { const s = this.shapes.at(-1); if (s.length < 4) s.push(x, y); s.count = (s.count ?? 1) + 1; },
    closePath() {}, addPath(other) { this.shapes.push(...other.shapes); } });
  const key = shape => shape.join(',') + `:${shape.count ?? 1}`;
  const keyOf = points => [points[0].x, points[0].y, ...(points[1] ? [points[1].x, points[1].y] : [])].join(',') + `:${points.length}`;
  const cache = new CityMapCache(CITY, makePath), drawn = [];
  const ctx = { save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, fill(path) { drawn.push(path); }, stroke(path) { drawn.push(path); } };
  // (in the order they are drawn)
  const layers = [...['blocks', 'lots', 'grounds', 'parks', 'water'].map(name => [cache.shapes[name], 0]), ...[...cache.lines].map(([width, lines]) => [lines, (width === 'path' ? 6 : width) / 2])];
  const reach = Math.hypot(208, 144) / 2 / .36;
  for (const [s, u] of [[0, 0], [400, -700], [-600, 900], [CITY.height / 2, 0], [0, -CITY.width / 2]]) for (const heading of [0, 1.1, -2.6]) {
    drawn.length = 0;
    cache.draw(ctx, { s, u, heading }, .36, 208, 144);
    assert.equal(drawn.length, layers.length, 'one fill or stroke a layer, as before');
    layers.forEach(([list, width], i) => {
      const order = new Map(list.map((points, k) => [keyOf(points), k])), seen = drawn[i].shapes.map(shape => order.get(key(shape)));
      assert.ok(seen.every((k, j) => k !== undefined && (!j || k > seen[j - 1])), 'shapes of this layer, in their order');
      const shown = new Set(seen);
      list.forEach((points, k) => {
        const xs = points.map(p => p.x), ys = points.map(p => p.y);
        const near = Math.min(...xs) - width <= u + reach && Math.max(...xs) + width >= u - reach && Math.min(...ys) - width <= s + reach && Math.max(...ys) + width >= s - reach;
        if (near) assert.ok(shown.has(k), `a shape reaching the view at ${s},${u} is left out`);
      });
    });
  }
  // The city map's whole paths hold every shape, in order
  for (const [name, list] of Object.entries(cache.shapes)) assert.deepEqual(cache[name].shapes.map(key), list.map(keyOf));
});
