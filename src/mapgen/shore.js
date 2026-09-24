import Vector from './vector.js';
import { insidePolygon, offsetPolylineClean, offsetPolygon, signedArea } from './polygon-util.js';
import { union, difference, intersection, region, solids, clean, grow } from './booleans.js';

// Where the land ends. The city is an island with a harbour's edge all
// round: the shore follows the promenade outside the ring road, the harbour
// side is cut by the promenade along the coast road, and the river runs
// through it from shore to shore. Land and water are computed with polygon
// booleans from those few shapes, so together they cover the whole world
// exactly once, whatever the shapes do: no gaps, no overlaps.


// Points at most `step` apart along a polyline
export function densify(points, step) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], count = Math.max(1, Math.ceil(a.distanceTo(b) / step));
    for (let k = 1; k <= count; k++) out.push(a.clone().add(b.clone().sub(a).multiplyScalar(k / count)));
  }
  return out;
}

// The shore round the ring road: the ring pushed out by `reach`, the outer
// edge of its promenade. The ring is round-cornered and star shaped, so this
// is one simple ring.
export function islandOutline(ring, reach) {
  const loop = ring[0].distanceTo(ring[ring.length - 1]) < 1e-6 ? ring.slice(0, -1) : ring.slice();
  return offsetPolygon(loop, reach);
}

// The sea side of a line that crosses the world: the line carried far out at
// both ends and closed round the far side. It may fold; the booleans do not mind.
function seaBeyond(line, side, reach = 20000) {
  const a = line[0], b = line[line.length - 1], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
  const tx = dx / length, ty = dy / length, nx = -ty * side, ny = tx * side;
  const start = new Vector(a.x - tx * reach, a.y - ty * reach), end = new Vector(b.x + tx * reach, b.y + ty * reach);
  return [start, ...line, end, new Vector(end.x + nx * reach, end.y + ny * reach), new Vector(start.x + nx * reach, start.y + ny * reach)];
}

// The river from where it leaves the sea to where it reaches it again: its
// centre line carried on until it is past the shore at both ends.
function riverThrough(centre, onIsland, beyond = 60) {
  const extend = (points, length) => {
    const out = points.slice(), a = out[0], b = out[1], c = out[out.length - 1], d = out[out.length - 2];
    out.unshift(a.clone().add(a.clone().sub(b).setLength(length)));
    out.push(c.clone().add(c.clone().sub(d).setLength(length)));
    return out;
  };
  const line = densify(extend(centre, 3000), 8);
  // Walk out from the middle of the original line until each end is at sea
  let middle = Math.floor(line.length / 2);
  if (!onIsland(line[middle])) middle = line.findIndex(onIsland);
  if (middle < 0) return null;
  const steps = Math.ceil(beyond / 8);
  let first = middle, last = middle;
  while (first > 0 && onIsland(line[first])) first--;
  while (last < line.length - 1 && onIsland(line[last])) last++;
  return line.slice(Math.max(0, first - steps), Math.min(line.length, last + steps + 1));
}

// The harbour's water: the sea side of the coast road's promenade
export function harbourWater(coast) {
  if (!coast || coast.line.length < 2) return null;
  return seaBeyond(offsetPolylineClean(coast.line, coast.seaSide * coast.reach), coast.seaSide);
}

// Land, sea and river for the whole world:
//   island     the outline from islandOutline
//   coast      the coast road's centre line, and reach: how far its water's edge
//              stands from it; seaSide: +1 if the sea is on its left
//   river      the river's centre line and its channel's half width
//   bounds     { minX, minY, maxX, maxY } the sea covers
//   keep       optional rings the city stands on (its blocks, and each road
//              with its promenade): land on the shore outside them is a bare
//              tip past where the roads round a corner, and goes to the sea
// Returns { land, sea, river } as lists of { outer, holes } (anticlockwise
// outers), the island's dry land before the river, and the river's centre
// line as used.
export function landAndWater({ island, coast = null, river = null, bounds, keep = null }) {
  const harbour = harbourWater(coast);
  // The island less the harbour
  let dryPieces = harbour ? difference(region(union([island])), [harbour]) : union([island]);
  if (keep?.length) dryPieces = withoutTips(dryPieces, keep);
  const dry = region(dryPieces);
  const onIsland = p => dryPieces.some(piece => insidePolygon(p, piece.outer) && !piece.holes.some(hole => insidePolygon(p, hole)));
  let land = dry, channel = null, riverCentre = null;
  if (river && river.centre.length > 1) {
    riverCentre = riverThrough(river.centre, onIsland);
    if (riverCentre) {
      channel = region(union([[...offsetPolylineClean(riverCentre, river.halfWidth), ...offsetPolylineClean(riverCentre, -river.halfWidth).reverse()]]));
      land = region(difference(dry, channel));
    }
  }
  // Needles of land where two shores meet at a sharp angle are blunted, and
  // the water is whatever the land is not: the river's channel on the island,
  // the sea everywhere else
  // (and a sliver the booleans leave where two shores all but touch is no
  // land, nor a puddle they leave nearly cut off from the sea any water)
  const landPieces = union(region(bluntTips(union(land)))).filter(piece => Math.abs(signedArea(piece.outer)) > 1)
    .map(piece => ({ ...piece, holes: piece.holes.filter(hole => Math.abs(signedArea(hole)) > 500) }));
  const { minX, minY, maxX, maxY } = bounds;
  const world = [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }];
  const water = region(difference([world], region(landPieces)));
  const riverWater = channel ? intersection(water, region(intersection(channel, dry))) : [];
  // (The river's water is grown by a hair first: cut from the water itself,
  // it shares hundreds of edges with it, and Clipper joins shared edges in
  // time that grows with the square of them)
  const sea = channel ? difference(water, region(grow(region(riverWater), .002))) : difference([world], region(landPieces));
  return { land: landPieces, sea, river: riverWater, dry: dryPieces, riverCentre };
}

// The land less every piece of it outside `keep` that reaches the shore:
// where the ring road and the coast road meet at a corner and the corner is
// rounded, the shapes the land is cut from run on to a point the roads no
// longer reach. Land inside the city that `keep` misses stays land.
function withoutTips(pieces, keep, { least = 25 } = {}) {
  const shore = region(pieces), edges = [];
  for (const ring of shore) for (let i = 0; i < ring.length; i++) edges.push([ring[i], ring[(i + 1) % ring.length]]);
  const onShore = p => edges.some(([a, b]) => {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t) < .05;
  });
  const kept = union(solids(keep));
  const tips = difference(shore, region(kept)).filter(piece => signedArea(piece.outer) > least && piece.outer.some(onShore));
  return tips.length ? clean(difference(shore, tips.map(piece => piece.outer))) : pieces;
}

// Cuts back each sharp tip of land (a left turn sharper than maxAngle, land
// being on the left of every ring) to where it is `width` across, walking
// along the shore either side of it as far as that takes.
function bluntTips(pieces, { maxAngle = 90 * Math.PI / 180, width = 8, reach = 40 } = {}) {
  const blunt = ring => {
    const n = ring.length;
    if (n < 4) return ring;
    const removed = new Array(n).fill(false), cuts = new Map();
    // The point `distance` along the ring from vertex i, stepping by step (+1 or -1)
    const walk = (i, distance, step) => {
      let j = i, left = distance;
      for (let guard = 0; guard < n - 2; guard++) {
        const k = (j + step + n) % n, length = ring[j].distanceTo(ring[k]);
        if (length >= left) return { point: ring[j].clone().add(ring[k].clone().sub(ring[j]).multiplyScalar(left / length)), last: j };
        left -= length; j = k;
      }
      return null;
    };
    for (let i = 0; i < n; i++) {
      if (removed[i]) continue;
      const a = ring[(i - 1 + n) % n], p = ring[i], b = ring[(i + 1) % n];
      const ux = a.x - p.x, uy = a.y - p.y, vx = b.x - p.x, vy = b.y - p.y, lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
      if (lu < 1e-9 || lv < 1e-9 || (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) <= 0) continue;
      const angle = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv))));
      if (angle >= maxAngle) continue;
      // Walk down both sides of the needle together until it is `width`
      // across: a needle with straight sides is cut where its angle says, and
      // a spike off an open shore just at its foot, taking no bite of the shore
      let back = null, ahead = null;
      for (let distance = .5; distance <= reach; distance += .5) {
        back = walk(i, distance, -1); ahead = walk(i, distance, 1);
        if (!back || !ahead || back.point.distanceTo(ahead.point) >= width) break;
      }
      if (!back || !ahead || back.point.distanceTo(ahead.point) < width) continue;
      // Every vertex from back.last to ahead.last goes; the two cut points take their place
      const gone = [];
      for (let j = back.last; ; j = (j + 1) % n) { gone.push(j); if (j === ahead.last) break; if (gone.length > n / 3) break; }
      if (gone.length > n / 3 || gone.some(j => removed[j])) continue;
      for (const j of gone) removed[j] = true;
      cuts.set(back.last, [back.point, ahead.point]);
    }
    const out = [];
    for (let i = 0; i < n; i++) { if (cuts.has(i)) out.push(...cuts.get(i)); else if (!removed[i]) out.push(ring[i]); }
    return out.length >= 3 ? out : ring;
  };
  return pieces.map(piece => ({ outer: blunt(piece.outer), holes: piece.holes.map(blunt) }));
}

// The edges between land and water as runs, water on the right: every one a
// quay wall, the city's edge being a harbour all round.
export function shoreRuns(land, { step = 6 } = {}) {
  const runs = [];
  for (const piece of land) for (const ring of [piece.outer, ...piece.holes]) {
    if (ring.length < 3) continue;
    const points = densify([...ring, ring[0]], step);
    runs.push({ kind: 'quay', points, closed: true });
  }
  return runs;
}
