import test from 'node:test';
import assert from 'node:assert/strict';
import { CITY, DISTRICT_STYLES, buildCity } from '../src/world/city.js';
import { worldMapLabels, DISTRICT_COLORS } from '../src/city-world-map.js';

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
