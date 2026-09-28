import test from 'node:test';
import assert from 'node:assert/strict';
import { compass, howFar, residentName, streetLine } from '../src/street-talk.js';

const place = { name: 'Blue Note Club', metres: 320, way: 'north-east' };

test('a chat opens on the weather or their part of town, then gives the way to a landmark not found yet, then the car, then goodbye', () => {
  const context = { weather: 'rain', district: 'Old town', place, car: { name: 'Surf Wagon', borrowed: false } };
  const openers = new Set([0, 1, 2, 3, 4, 5].map(key => streetLine(0, context, key).text));
  assert.ok(openers.size > 3, 'openers vary with the key');
  assert.ok([...openers].some(text => text.includes('umbrella') || text.includes('soaking') || text.includes('ducks')), 'the weather comes into it');
  assert.ok([...openers].some(text => text.includes('streets') || text.includes('gran') || text.includes('Old town')), 'and so does their district');
  for (let key = 0; key < 6; key++) {
    const first = streetLine(0, context, key), way = streetLine(1, context, key), car = streetLine(2, context, key), bye = streetLine(3, context, key);
    assert.ok(!first.ending && !first.pointing);
    assert.ok(way.pointing && way.text.includes('Blue Note Club') && way.text.includes('north-east'), way.text);
    assert.ok(car.text.includes('Surf Wagon') && !car.ending, car.text);
    assert.ok(bye.ending && !bye.pointing);
  }
  // Every landmark found, and no car of theirs near: something else to say
  const bare = { weather: 'clear', district: 'Midtown', place: null, car: null };
  assert.ok(!streetLine(1, bare, 1).pointing && streetLine(2, bare, 1).text.length > 5);
  // A borrowed car is remarked on as someone else's
  assert.match(streetLine(2, { ...bare, car: { name: 'Hatchback', borrowed: true } }, 0).text, /someone else|owner/);
  // Asked again soon after goodbye, they only say they are surprised
  const again = streetLine(0, { ...context, again: true }, 2);
  assert.ok(again.ending && /again|Still|done/.test(again.text), again.text);
});

test('residents call out when shoved, knocked over or passed, and every line fits a bubble', () => {
  for (const kind of ['shoved', 'floored', 'run', 'passing']) {
    const line = streetLine(kind, { night: false }, 3);
    assert.ok(line.ending && line.text.length > 1 && line.text.length < 40, `${kind}: ${line.text}`);
  }
  assert.ok(['Evening.', 'Night.', 'Alright?'].includes(streetLine('passing', { night: true }, 5).text));
  // (no line is too long for two rows of a bubble)
  const weathers = ['clear', 'sunset', 'overcast', 'rain', 'storm', 'snow', 'night'];
  const districts = ['Old town', 'Garden quarter', 'Warehouse district', 'Market district', 'Civic quarter', 'Midtown', 'Downtown', 'Harbour', 'Riverfront'];
  for (const weather of weathers) for (const district of districts) for (let key = 0; key < 12; key++) for (let turn = 0; turn < 4; turn++) {
    const { text } = streetLine(turn, { weather, district, place: { ...place, name: 'Neighborhood Gardens', metres: 1400 }, car: { name: 'Highway Sedan' } }, key);
    assert.ok(text.length <= 72, `${text.length}: ${text}`);
  }
});

test('the way to somewhere is a compass word and a walk said as people say it', () => {
  assert.equal(compass(0, 10), 'north'); assert.equal(compass(10, 0), 'east'); assert.equal(compass(-7, -7), 'south-west');
  assert.match(howFar(90, 'west'), /round the corner/);
  assert.match(howFar(300, 'west'), /short walk west/);
  assert.match(howFar(700, 'west'), /good walk/);
  assert.match(howFar(2000, 'west'), /long way west/);
  // (and a long way off, they say to take a car, if the line has room)
  assert.match(streetLine(1, { place: { name: 'City Hall', metres: 2000, way: 'west' } }, 1).text, /want a car/);
  assert.equal(residentName({ presentation: 'masculine' }, 3), residentName({ presentation: 'masculine' }, 3));
  assert.notEqual(residentName({ presentation: 'masculine' }, 3), residentName({ presentation: 'feminine' }, 3));
});
