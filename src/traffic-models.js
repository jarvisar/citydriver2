import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { stableShadowDepth } from './world/shadow-depth.js';

export const TRAFFIC_MODELS = [
  { name: 'hatchback', width: 1.85, length: 3.45, cabin: [1.63, .75, 2.36], cabinZ: .455 },
  { name: 'sedan', width: 1.98, length: 4.25, cabin: [1.75, .7, 2.05], cabinZ: .05 },
  { name: 'wagon', width: 2, length: 4.55, cabin: [1.78, .85, 3.2], cabinZ: .495 },
  { name: 'pickup', width: 2.12, length: 5.2, cabin: [1.89, .95, 1.8], cabinZ: -.7 },
  { name: 'van', width: 2.08, length: 5.15, cabin: [1.93, 1.35, 4.2], cabinZ: .445 },
];

// Chooser-only: a low coupe with a long bonnet and a fastback. It is never
// spawned into traffic, so the roads keep their ordinary-looking fleet.
export const SPORTS_MODEL = { name: 'sports', width: 1.94, length: 4.2, cabin: [1.6, .56, 2], cabinZ: .38, drop: .2 };

export const TRAFFIC_COLORS = ['#d8c7a0', '#e9e5d9', '#577f96', '#829789', '#b34e43', '#d2a345', '#58636a', '#b7c4c9', '#796c8c', '#397e7b'];

// Wheels sit in their arches, the tyre's face just proud of the body side.
export const WHEEL = { radius: .43, width: .25, hubRadius: .21, hubWidth: .26, y: .43, inset: .11 };

// Each shape's side profile in metres, before a lowered shape's `drop`: the
// nose and tail faces as [bottom, top], the bonnet's front edge, the scuttle
// under the windscreen, the boot or floor at the tail's top edge, the sills
// and the crowns of the wheel arches. `shoulder` chamfers the body's top edges
// [in, down], `corner` its plan corners [nose, tail], and `rake` leans the
// glass [windscreen, rear screen]. Door posts stand at fractions along the
// side glass, and `pillar` is the rear pillar's width. A pickup's cab drops to
// its `bed`, walled up to `rail`; a van's glass ends `cab` metres back, where
// its load box takes over. `bumper` is a colour (none for null) and `lamps`
// resizes the lamps [width, height].
const BODIES = {
  hatchback: { nose: [.42, 1.1], bonnet: 1.17, scuttle: 1.3, deck: 1.28, tail: [.44, 1.25], sill: .34, arch: .93, shoulder: [.1, .12], corner: [.14, .12], rake: [.44, .46], posts: [.58], pillar: .2 },
  sedan: { nose: [.42, 1.12], bonnet: 1.18, scuttle: 1.3, deck: 1.28, tail: [.44, 1.22], sill: .34, arch: .93, shoulder: [.1, .12], corner: [.13, .12], rake: [.46, .46], posts: [.5], pillar: .2 },
  wagon: { nose: [.42, 1.12], bonnet: 1.18, scuttle: 1.3, deck: 1.29, tail: [.44, 1.25], sill: .34, arch: .93, shoulder: [.1, .12], corner: [.13, .1], rake: [.44, .1], posts: [.37, .7], pillar: .14 },
  pickup: { nose: [.5, 1.24], bonnet: 1.32, scuttle: 1.44, deck: 1.08, tail: [.52, 1.08], sill: .46, arch: .98, shoulder: [.1, .1], corner: [.12, 0], rake: [.34, .06], posts: [.5], pillar: .14, bed: 1.08, rail: 1.5 },
  van: { nose: [.44, 1.08], bonnet: 1.16, scuttle: 1.3, deck: 1.3, tail: [.46, 1.28], sill: .38, arch: .95, shoulder: [.06, .1], corner: [.15, .07], rake: [.5, 0], posts: [], cab: 1.25, bumper: '#4a5553', lamps: { tail: [.2, .36] } },
  sports: { nose: [.44, 1.12], bonnet: 1.2, scuttle: 1.32, deck: 1.33, tail: [.46, 1.3], sill: .44, arch: 1.1, shoulder: [.12, .09], corner: [.16, .14], rake: [.52, .84], posts: [], pillar: .24, bumper: null, lamps: { head: [.42, .11], tail: [.46, .12], panel: true, plate: .7 } },
};
// An arch's half-width at the sill and at its crown.
const ARCH = [.58, .32];
const GLASS = '#344e55', UNDERSIDE = '#171d1d', TRIM = '#2b3434';

// Keep a polyline's points only while z increases.
const increasing = points => points.filter(([z], i) => points.slice(0, i).every(([other]) => other < z));
// A polyline's height at z, level beyond its ends.
export function heightAt(points, z) {
  if (z <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) if (z <= points[i][0]) {
    const [z0, y0] = points[i - 1], [z1, y1] = points[i];
    return y0 + (y1 - y0) * (z - z0) / (z1 - z0);
  }
  return points.at(-1)[1];
}

// A body's outline from the side, nose to tail, as the model and the chooser's
// portrait both draw it: its top line and its underside, notched over the wheels.
export function bodyProfile(spec) {
  const { width: w, length: l, cabin: [, , cl], cabinZ: cz } = spec, body = BODIES[spec.name] ?? BODIES.sedan;
  const [nose, tail] = body.corner, front = cz - cl / 2, rear = cz + cl / 2, wheelZ = l * .3;
  const top = increasing([[-l / 2, body.nose[1]], [-l / 2 + nose, body.bonnet], [front, body.scuttle], [rear, body.scuttle],
    ...(body.bed ? [[rear + .04, body.bed]] : []), [l / 2 - tail, body.deck], [l / 2, body.tail[1]]]);
  const arch = z => [[z - ARCH[0], body.sill], [z - ARCH[1], body.arch], [z + ARCH[1], body.arch], [z + ARCH[0], body.sill]];
  const bottom = [[-l / 2, body.nose[0]], ...arch(-wheelZ), ...arch(wheelZ), [l / 2, body.tail[0]]];
  // Where the side glass ends (a van's at its cab), the roof's run and the posts.
  const glassRear = body.cab ? front + body.cab : rear;
  const roof = [front + body.rake[0], body.cab ? rear : rear - body.rake[1]];
  const posts = body.posts.map(f => front + body.rake[0] / 2 + (rear - body.rake[1] / 2 - front - body.rake[0] / 2) * f);
  // Lamps [width, height, x, y] in the nose and tail faces, under the shoulders.
  const lamp = ([width, height], corner, face) => [width, height, w / 2 - corner - .08 - width / 2, face - body.shoulder[1] - .03 - height / 2];
  const { head = [.36, .18], tail: rearLamp = [.32, .18] } = body.lamps ?? {};
  const lamps = { head: lamp(head, nose, body.nose[1]), tail: lamp(rearLamp, tail, body.tail[1]) };
  return { body, top, bottom, front, rear, glassRear, roof, posts, wheelZ, lamps };
}

// Triangles from a list of corners, turned to face `out`, into a flat list.
// A section squeezed to nothing (a side with no height left over an arch)
// leaves slivers with no normal, which are dropped.
function face(list, points, out) {
  for (let i = 1; i + 1 < points.length; i++) {
    const a = points[0], b = points[i], c = points[i + 1];
    const n = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).cross(new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]));
    if (n.lengthSq() < 1e-10) continue;
    list.push(...(n.dot(out) >= 0 ? [a, b, c] : [a, c, b]));
  }
}
// A flat list of triangles as box-compatible geometry (indexed, with normals).
function triangles(list) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(list.flat(), 3));
  geometry.setIndex(list.map((_, i) => i));
  geometry.computeVertexNormals();
  return geometry;
}

// Loft the body through stations along its length. Each section is a hexagon:
// a flat floor, upright sides and chamfered shoulders. The plan corners narrow
// the end sections; the arches lift the floor over the wheels, and dark liners
// inboard of the tyres close the arches from the side.
function loftBody(spec, profile) {
  const { width: w, length: l } = spec, { body, top, bottom, wheelZ } = profile;
  const [nose, tail] = body.corner, [inset, fall] = body.shoulder;
  // The ends and arches first, then the plan corners and the top's breaks,
  // each kept unless a station already stands within 3 cm.
  const zs = [];
  for (const z of [-l / 2, l / 2, ...bottom.map(p => p[0]), -l / 2 + nose, l / 2 - tail, ...top.map(p => p[0])])
    if (!zs.some(other => Math.abs(other - z) < .03)) zs.push(z);
  zs.sort((a, b) => a - b);
  const rings = zs.map(z => {
    const hw = w / 2 - Math.max(0, nose - (z + l / 2), tail - (l / 2 - z));
    const yb = heightAt(bottom, z), yt = heightAt(top, z);
    const shoulder = Math.max(yt - fall, yb), s = inset * (yt - shoulder) / fall;
    return [[hw, yb], [hw, shoulder], [hw - s, yt], [s - hw, yt], [-hw, shoulder], [-hw, yb]].map(([x, y]) => [x, y, z]);
  });
  const shell = [], under = [];
  rings.forEach((ring, i) => {
    const next = rings[i + 1];
    if (next) for (let k = 0; k < 6; k++) {
      const quad = [ring[k], ring[(k + 1) % 6], next[(k + 1) % 6], next[k]];
      const [cx, cy, cz] = [0, 1, 2].map(j => quad.reduce((sum, p) => sum + p[j], 0) / 4);
      const mid = (ring[0][1] + ring[2][1] + next[0][1] + next[2][1]) / 4;
      face(k === 5 ? under : shell, quad, new THREE.Vector3(cx, cy - mid, 0));
    }
  });
  face(shell, rings[0], new THREE.Vector3(0, 0, -1));
  face(shell, rings.at(-1), new THREE.Vector3(0, 0, 1));
  for (const side of [-1, 1]) for (const z of [-wheelZ, wheelZ]) {
    const x = side * (w / 2 - WHEEL.inset - WHEEL.width / 2 - .015);
    face(under, [[x, body.sill, z - ARCH[0]], [x, body.arch, z - ARCH[1]], [x, body.arch, z + ARCH[1]], [x, body.sill, z + ARCH[0]]], new THREE.Vector3(side, 0, 0));
  }
  return { shell: triangles(shell), under: triangles(under) };
}

// Lean a box's top: pull its sides in to `taper` and its ends back by the rakes.
function rake(geometry, front, rear, taper = .94) {
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) {
    p.setX(i, p.getX(i) * taper);
    p.setZ(i, p.getZ(i) + (p.getZ(i) < 0 ? front : -rear));
  }
  geometry.computeVertexNormals();
  return geometry;
}

// A flat plan outline, extruded from `bottom` up by `height`.
function slab(points, bottom, height) {
  const outline = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  const geometry = new THREE.ExtrudeGeometry(outline, { depth: height, bevelEnabled: false, steps: 1 });
  geometry.rotateX(Math.PI / 2);
  // Extrusion is non-indexed; all pieces must share the box geometry format.
  geometry.setIndex(Array.from({ length: geometry.attributes.position.count }, (_, i) => i));
  geometry.translate(0, bottom + height, 0);
  return geometry;
}

// Build one body shape as four merged geometries. Traffic bakes its wheels into
// the details mesh; a driven car asks for them separately so they can turn.
export function vehicleGeometry(spec, { separateWheels = false } = {}) {
  const parts = { paint: [], details: [], headlights: [], taillights: [] };
  const wheels = [];
  function add(geometry, location, category, color) {
    geometry.deleteAttribute('uv');
    geometry.translate(...location);
    if (color) {
      const tint = new THREE.Color(color), colors = [];
      for (let i = 0; i < geometry.attributes.position.count; i++) colors.push(tint.r, tint.g, tint.b);
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    }
    parts[category].push(geometry);
  }
  const box = (size, location, category = 'paint', color) => add(new THREE.BoxGeometry(...size), location, category, color);
  const { width: w, length: l, cabin: [cw, ch], name, drop = 0 } = spec;
  const profile = bodyProfile(spec), { body, top, front, rear, glassRear, roof: [roofFront, roofRear], wheelZ } = profile;
  const [nose, tail] = body.corner, [rf, rr] = body.rake, roofY = 1.22 + ch;
  const { shell, under } = loftBody(spec, profile);
  add(shell, [0, 0, 0], 'paint');
  add(under, [0, 0, 0], 'details', UNDERSIDE);
  // Raked glass keeps the silhouettes in the player's faceted style. A van's
  // stops at the cab and runs just into its load box, which is a touch wider
  // so their sides never share a plane.
  const glassEnd = body.cab ? glassRear + .02 : rear;
  add(rake(new THREE.BoxGeometry(cw, ch, glassEnd - front), rf, body.cab ? 0 : rr), [0, 1.22 + ch / 2, (front + glassEnd) / 2], 'details', GLASS);
  if (body.cab) add(rake(new THREE.BoxGeometry(cw + .02, ch, rear - glassRear), 0, 0), [0, 1.22 + ch / 2, (glassRear + rear) / 2], 'paint');
  box([cw * .94 + .08, .1, roofRear - roofFront + (body.cab ? .07 : .12)], [0, roofY + .025, (roofFront + roofRear) / 2 - (body.cab ? .025 : 0)]);
  for (const side of [-1, 1]) {
    // Follow the sloped glass edges: vertical posts would leave the windshield
    // looking like a dark box perched on the doors.
    for (const [end, lean, depth] of [[-1, rf, .1], [1, -rr, body.pillar ?? .14]]) {
      if (end > 0 && body.cab) continue;
      const pillar = new THREE.BoxGeometry(.085, ch + .02, depth), p = pillar.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) {
        p.setX(i, p.getX(i) - side * cw * .03);
        p.setZ(i, p.getZ(i) + lean);
      }
      pillar.computeVertexNormals();
      add(pillar, [side * (cw / 2 - .015), 1.22 + ch / 2, end < 0 ? front + depth / 2 - .025 : rear - depth / 2 + .025], 'paint');
    }
    for (const z of profile.posts) {
      const post = new THREE.BoxGeometry(.085, ch, .12), pv = post.attributes.position;
      for (let i = 0; i < pv.count; i++) if (pv.getY(i) > 0) pv.setX(i, pv.getX(i) - side * cw * .03);
      post.computeVertexNormals();
      add(post, [side * (cw / 2 - .02), 1.22 + ch / 2, z], 'paint');
    }
    // Door mirrors stand off the foot of each windscreen pillar.
    const out = w / 2 + .07, inner = cw / 2 - .03;
    box([out - inner, .11, .09], [side * (out + inner) / 2, body.scuttle + .1, front + .14]);
    for (const z of [-wheelZ, wheelZ]) {
      const x = side * (w / 2 - WHEEL.inset);
      if (separateWheels) { wheels.push({ x, y: WHEEL.y, z, front: z < 0 }); continue; }
      const tire = new THREE.CylinderGeometry(WHEEL.radius, WHEEL.radius, WHEEL.width, 10);
      // A vertex at the bottom keeps the faceted, unanimated tyre on the road.
      tire.rotateY(Math.PI / 2); tire.rotateZ(Math.PI / 2);
      add(tire, [x, WHEEL.y, z], 'details', TRIM);
      // Only the hub's face shows past the tyre.
      const hub = new THREE.CircleGeometry(WHEEL.hubRadius, 8); hub.rotateY(side * Math.PI / 2);
      add(hub, [x + side * (WHEEL.width / 2 + .006), WHEEL.y, z], 'details', '#bfc4b9');
    }
  }
  // Lamps sit just into the nose and tail faces.
  const lamps = body.lamps ?? {}, [hw, hh, headX, headY] = profile.lamps.head, [tw, th, tailX, tailY] = profile.lamps.tail;
  for (const side of [-1, 1]) {
    box([hw, hh, .04], [side * headX, headY, -l / 2 - .012], 'headlights');
    if (!body.bed) box([tw, th, .04], [side * tailX, tailY, l / 2 + .012], 'taillights');
  }
  box([2 * (headX - hw / 2) - .1, hh * .9, .04], [0, headY, -l / 2 - .01], 'details', TRIM);
  // A dark panel behind the tail lamps keeps them clear of a red paint.
  if (lamps.panel) box([2 * tailX + tw + .12, th + .1, .03], [0, tailY, l / 2 + .005], 'details', TRIM);
  box([.46, .15, .04], [0, lamps.plate ?? (body.bed ? .86 : tailY - .02), l / 2 + .01], 'details', '#e9e2cb');
  // Bumpers wrap round the plan corners onto the sides, short of the arches.
  const bumper = body.bumper === undefined ? '#bbc0b6' : body.bumper;
  if (bumper) for (const end of [-1, 1]) {
    const corner = end < 0 ? nose : tail, low = (end < 0 ? body.nose : body.tail)[0] + .03;
    const reach = Math.min(corner + .1, l / 2 - wheelZ - ARCH[0] + .04), half = w / 2, out = .05, flank = half + .02;
    const plan = [[corner - half - .02, -out], [half - corner + .02, -out], [flank, corner - .03], [flank, reach], [half - .06, reach], [.06 - half, reach], [-flank, reach], [-flank, corner - .03]];
    add(slab(plan.map(([x, z]) => [x, end * (l / 2 - z)]), low, .18), [0, 0, 0], 'details', bumper);
  }
  if (body.bed) {
    // An open bed behind the cab: floor, walls and a tailgate standing just
    // proud of them, with the tail lamps up on the walls' ends.
    const bedFront = rear + .06, bedLength = l / 2 - bedFront, bedZ = (bedFront + l / 2) / 2, low = body.bed - body.shoulder[1];
    box([w - .3, .04, bedLength - .1], [0, body.bed + .02, bedZ - .05], 'details', '#414c4b');
    for (const side of [-1, 1]) {
      box([.14, body.rail - low, bedLength], [side * (w / 2 - .07), (body.rail + low) / 2, bedZ]);
      box([.1, .26, .03], [side * (w / 2 - .07), body.rail - .19, l / 2 + .008], 'taillights');
    }
    box([w - .28, body.rail - low, .1], [0, (body.rail + low) / 2, l / 2 - .04]);
    box([.34, .06, .02], [0, body.rail - .1, l / 2 + .018], 'details', TRIM);
  }
  if (body.cab) {
    // Rubbing strips along the load box's flanks, and the rear doors' glass.
    for (const side of [-1, 1]) box([.03, .07, 2 * (wheelZ - ARCH[0]) - .2], [side * (w / 2 + .005), .8, 0], 'details', '#46514f');
    box([cw * .62, .46, .025], [0, roofY - .42, rear + .008], 'details', GLASS);
    // A painted header over the windscreen, flush with the glass at its foot:
    // the raked glass runs up inside it.
    const header = .3, low = roofY - header, zf = front + rf * (low - 1.22) / ch;
    const across = y => cw * (1 - .06 * (y - 1.22) / ch) + .02;
    add(rake(new THREE.BoxGeometry(across(low), header, glassEnd - zf), 0, 0, across(roofY) / across(low)), [0, low + header / 2, (zf + glassEnd) / 2], 'paint');
  }
  if (name === 'wagon') for (const side of [-1, 1]) {
    box([.06, .06, roofRear - roofFront - .2], [side * (cw * .47 - .06), roofY + .105, (roofFront + roofRear) / 2 + .04], 'details', '#46514f');
  }
  if (name === 'sports') {
    // A splitter under the nose and a wing on stalks over the tail read as quick
    // from the chase view.
    box([w * .84, .05, .16], [0, body.nose[0] + .02, -l / 2 - .03], 'details', '#2f3a3c');
    for (const side of [-1, 1]) box([.04, .12, 2 * (wheelZ - ARCH[0]) - .04], [side * (w / 2 + .01), body.sill + .07, 0], 'details', '#2f3a3c');
    const deck = heightAt(top, l / 2 - .3);
    for (const x of [-.52, .52]) box([.07, .17, .1], [x, deck + .08, l / 2 - .3]);
    box([w * .82, .05, .34], [0, deck + .18, l / 2 - .28]);
  }
  const merged = Object.fromEntries(Object.entries(parts).map(([key, geometries]) => {
    const geometry = mergeGeometries(geometries);
    // A lowered body sits closer to unchanged wheels, so drop only the shell.
    if (drop) geometry.translate(0, -drop, 0);
    for (const part of geometries) part.dispose();
    return [key, geometry];
  }));
  // Where the roof is, for what a taxi carries on it.
  return { ...merged, wheels, roof: { y: roofY + .075 - drop, z: (roofFront + roofRear) / 2, length: roofRear - roofFront, width: cw * .94 } };
}

// Merge each model into four meshes, with shared geometry across the small fleet.
// Only the paint material belongs to an individual car.
export function createTrafficModels() {
  const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .76, flatShading: true, ...extra });
  const details = material('#ffffff', { vertexColors: true });
  const headlights = material('#fff0c3', { emissive: '#ffe3a3', emissiveIntensity: .3 });
  const taillights = material('#a5382e', { emissive: '#e12e18', emissiveIntensity: .25 });
  const templates = TRAFFIC_MODELS.map(spec => {
    const { paint, details: trim, headlights: front, taillights: rear } = vehicleGeometry(spec);
    // Each car casts its whole shadow in one draw instead of four. The trim
    // and lamp triangles follow the paint's in one buffer: the colour pass
    // draws only the paint's range, and the shadow pass all of it. The same
    // triangles reach the shadow map either way.
    const paintCount = paint.index.count, outline = trim.clone();
    outline.deleteAttribute('color');
    const body = mergeGeometries([paint, outline, front, rear]);
    outline.dispose(); paint.dispose();
    body.setDrawRange(0, paintCount);
    return { parts: { paint: body, details: trim, headlights: front, taillights: rear }, paintCount };
  });
  const paints = [];
  return {
    create(index, color) {
      const spec = TRAFFIC_MODELS[index], car = new THREE.Group(), paint = material(color);
      paints.push(paint); car.name = `traffic-${spec.name}`;
      const { parts, paintCount } = templates[index];
      for (const [key, geometry] of Object.entries(parts)) {
        const mesh = new THREE.Mesh(geometry, { paint, details, headlights, taillights }[key]);
        mesh.receiveShadow = true;
        if (key === 'paint') {
          mesh.castShadow = true; stableShadowDepth(mesh);
          mesh.onBeforeShadow = () => { geometry.drawRange.count = Infinity; };
          mesh.onAfterShadow = () => { geometry.drawRange.count = paintCount; };
        }
        car.add(mesh);
      }
      return { car, paint, spec };
    },
    // Lamps from daytime (0) to night (1); a storm runs them part way up.
    setLights(level) { headlights.emissiveIntensity = .3 + 2 * level; taillights.emissiveIntensity = .25 + 1.55 * level; },
    dispose() {
      for (const template of templates) for (const geometry of Object.values(template.parts)) geometry.dispose();
      for (const mat of [...paints, details, headlights, taillights]) mat.dispose();
    },
  };
}
