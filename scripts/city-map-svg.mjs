// Draw a generated city map as an SVG, for checking the generator without the
// game: node scripts/city-map-svg.mjs [seed] [out.svg]
import { writeFileSync } from 'node:fs';
import { generateCityMap, cityStats } from '../src/mapgen/generate.js';

const seed = Number(process.argv[2] ?? 4817), out = process.argv[3] ?? `city-${seed}.svg`;
const city = generateCityMap({ seed });
const { width, height, origin } = city;
const point = p => `${(p.x - origin.x).toFixed(1)},${(height - (p.y - origin.y)).toFixed(1)}`;
const polygon = (points, style) => points.length >= 3 ? `<polygon points="${points.map(point).join(' ')}" ${style}/>` : '';
const polyline = (points, style) => `<polyline points="${points.map(point).join(' ')}" fill="none" ${style}/>`;
const widths = { main: 22, major: 18, coast: 18, riverbank: 16, minor: 13 };
const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#b9bfb4"/>`];
parts.push(polygon(city.sea, 'fill="#5f8fa2"'));
parts.push(polygon(city.river, 'fill="#5f8fa2"'));
for (const park of city.parks) parts.push(polygon(park, 'fill="#7fa36a"'));
for (const block of city.blocks) parts.push(polygon(block.sidewalk, 'fill="#d3d2c6"'));
for (const lot of city.lots) parts.push(polygon(lot, 'fill="#8d7c6e" stroke="#5b4f46" stroke-width="1"'));
for (const road of city.roads) parts.push(polyline(road.points, `stroke="#3d4347" stroke-width="${widths[road.kind]}" stroke-linecap="round" stroke-linejoin="round"`));
for (const road of city.roads) if (road.kind !== 'minor') parts.push(polyline(road.points, 'stroke="#c8b98a" stroke-width="1.5" stroke-dasharray="8 8"'));
parts.push(polyline(city.coastline, 'stroke="#2c4f5b" stroke-width="3"'));
for (const node of city.nav) if (node.adj.length !== 2) parts.push(`<circle cx="${(node.x - origin.x).toFixed(1)}" cy="${(height - (node.y - origin.y)).toFixed(1)}" r="4" fill="${node.adj.length === 1 ? '#d05050' : '#f5e9b8'}"/>`);
parts.push('</svg>');
writeFileSync(out, parts.join('\n'));
console.log(out, JSON.stringify(cityStats(city)));
