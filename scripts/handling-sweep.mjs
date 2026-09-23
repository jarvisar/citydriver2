import { mkdir, writeFile } from 'node:fs/promises';
import { CAR_IDS, carEntry, carStats } from '../src/cars.js';
import { turningRadius } from '../src/handling.js';

// Steady-state full-lock chassis radius, independent of frame rate. Actual
// junction tests include turn-in, tire recovery and the whole car body.
const speeds = [6, 10, 15, 20, 25, 35, 50];
const rows = CAR_IDS.map(id => {
  const stats = carStats(id);
  return { id, name: carEntry(id).name, grip: stats.grip,
    radii: Object.fromEntries(speeds.filter(speed => speed <= stats.topSpeed).map(speed => [speed, +turningRadius(speed, stats).toFixed(2)])) };
});
await mkdir('.artifacts/handling', { recursive: true });
await writeFile('.artifacts/handling/radii.json', JSON.stringify({ units: 'speed m/s, radius m', rows }, null, 2));
console.table(rows.map(row => ({ car: row.name, grip: row.grip,
  ...Object.fromEntries(speeds.map(speed => [`${speed} m/s`, row.radii[speed] ?? '—'])) })));
