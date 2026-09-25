import test from 'node:test';
import assert from 'node:assert/strict';
import { CITY, DISTRICT_STYLES, buildCity } from '../src/world/city.js';
import { worldMapLabels, DISTRICT_COLORS } from '../src/city-world-map.js';

const cities = [CITY, buildCity(1065425237), buildCity(3)];

test('every city is a patchwork of all its districts, none of them most of it', () => {
  for (const city of cities) {
    const counts = {};
    for (const block of city.blocks) if (block.style) counts[block.style] = (counts[block.style] ?? 0) + 1;
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    for (const style of [...DISTRICT_STYLES, 'Midtown']) assert.ok(counts[style] > 0, `seed ${city.seed}: no ${style}`);
    for (const [style, n] of Object.entries(counts)) assert.ok(n / total < .4, `seed ${city.seed}: ${style} is ${Math.round(n / total * 100)}% of the city`);
    // and each style is more than one neighbourhood
    for (const style of DISTRICT_STYLES) assert.ok(city.districts.filter(n => n.style === style).length >= 2, `seed ${city.seed}: one ${style}`);
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
    // one name per neighbourhood big enough to read
    assert.ok(labels.length >= 12, `seed ${city.seed}: only ${labels.length} names`);
  }
});
