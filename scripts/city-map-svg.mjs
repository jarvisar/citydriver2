// Draw a generated city map as an SVG, for checking the generator without the
// game: node scripts/city-map-svg.mjs [seed] [out.svg]
import { writeFileSync } from 'node:fs';
import { generateCityMap, cityStats } from '../src/mapgen/generate.js';

const seed = Number(process.argv[2] ?? 4817), out = process.argv[3] ?? `city-${seed}.svg`;
const city = generateCityMap({ seed });
// The domain and the island's shore round it
const pad = 360, width = city.width + pad * 2, height = city.height + pad * 2, origin = { x: city.origin.x - pad, y: city.origin.y - pad };
const point = p => `${(p.x - origin.x).toFixed(1)},${(height - (p.y - origin.y)).toFixed(1)}`;
const area = (piece, style) => `<path fill-rule="evenodd" d="${[piece.outer, ...piece.holes].map(ring => 'M' + ring.map(point).join('L') + 'Z').join(' ')}" ${style}/>`;
const polygon = (points, style) => points.length >= 3 ? `<polygon points="${points.map(point).join(' ')}" ${style}/>` : '';
const polyline = (points, style) => `<polyline points="${points.map(point).join(' ')}" fill="none" ${style}/>`;
const widths = { main: 22, major: 18, ring: 18, coast: 18, riverbank: 16, minor: 13, path: 7 };
const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#5f8fa2"/>`];
for (const piece of city.shore?.land ?? []) parts.push(area(piece, 'fill="#b9bfb4"'));
for (const park of city.parks) parts.push(polygon(park, 'fill="#7fa36a"'));
for (const block of city.blocks) parts.push(polygon(block.sidewalk, 'fill="#d3d2c6"'));
for (const block of city.blocks) if (block.yard?.length) parts.push(polygon(block.yard, 'fill="#a9b98f"'));
for (const lot of city.lots) parts.push(polygon(lot, 'fill="#8d7c6e" stroke="#5b4f46" stroke-width="1"'));
for (const road of city.roads) parts.push(polyline(road.points, `stroke="${road.kind === 'path' ? '#b9ad8e' : '#3d4347'}" stroke-width="${widths[road.kind]}" stroke-linecap="round" stroke-linejoin="round"`));
for (const road of city.roads) if (road.kind !== 'minor' && road.kind !== 'path') parts.push(polyline(road.points, 'stroke="#c8b98a" stroke-width="1.5" stroke-dasharray="8 8"'));
for (const node of city.nav) if (node.adj.length !== 2) parts.push(`<circle cx="${(node.x - origin.x).toFixed(1)}" cy="${(height - (node.y - origin.y)).toFixed(1)}" r="4" fill="${node.adj.length === 1 ? '#d05050' : '#f5e9b8'}"/>`);
parts.push('</svg>');
writeFileSync(out, parts.join('\n'));
console.log(out, JSON.stringify(cityStats(city)));
