import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { stableShadowDepth } from './world/shadow-depth.js';
import { partsKit } from './helicopter.js';

// The garage's plane: a small high-wing monoplane on big soft tyres, the
// kind that gets in and out of short strips. The footprint (width, length)
// is its wheels and fuselage, which is what meets cars and walls on the
// ground; `span` is from wingtip to wingtip, which only buildings stop (see
// plane.js). `prop` is the propeller's radius. Like the helicopter, `eye`
// seats the first-person camera and `chaseLift` raises the chase camera
// over the wing, and `door` (metres ahead of the middle) and `seat` (metres
// up) are where someone climbs in and out. Getting out, they step down
// behind the wing, clear of its struts, at `exit` (across, along).
export const PLANE_SHAPE = { name: 'plane', width: 2.4, length: 7.4, span: 9.4, eye: [0, 1.95, -1.25], chaseLift: 1.1, door: .9, seat: 1.05, exit: [2.3, -1.4], prop: .95 };
// The point the body pitches and rolls about, near where it balances: in
// car space, nose to -z
export const PIVOT = new THREE.Vector3(0, 1.45, -.55);

const DARK = '#2b3434', CHROME = '#bfc4b9', GLASS = '#4d737c', CREAM = '#f5e8c8';
// Navigation lights: red on the left wingtip, green on the right, white on the tail
const PORT = '#e5402f', STARBOARD = '#3cc764', TAIL_LIGHT = '#f6f3e8';

// Where the moving parts turn, in car space: the propeller's hub, the wheels'
// axles (the nose wheel's steers about the upright through it) and the hinges
const HUB = [0, 1.45, -3.55];
const MAIN = { radius: .42, x: 1.02, y: .42, z: -.15 }, NOSE = { radius: .3, z: -2.85, fork: .62 };
const RUDDER = [0, 2.2, 3.215], ELEVATOR = [0, 1.72, 3.215];

// The fuselage, nose to tail: at each station, the right half of its section
// from the keel up (the bottom's corner, the chine, the stripe's edges, the
// sill and the roof's corner), mirrored for the left. The roof runs up into
// the wing, and the tail ends just ahead of the rudder's hinge.
const BODY = [
  [-3.42, [.26, 1], [.46, 1.13], [.5, 1.3, 1.43], [.47, 1.72], [.26, 1.9]],
  [-3.02, [.34, .88], [.6, 1.03], [.66, 1.29, 1.42], [.63, 1.74], [.36, 1.96]],
  [-2.3, [.46, .82], [.65, .95], [.67, 1.28, 1.41], [.67, 1.62], [.5, 1.97]],
  [-1.52, [.48, .8], [.66, .93], [.68, 1.28, 1.41], [.68, 1.52], [.55, 2.21]],
  [-.62, [.48, .8], [.66, .93], [.68, 1.28, 1.41], [.68, 1.52], [.55, 2.205]],
  [-.54, [.48, .8], [.66, .93], [.68, 1.28, 1.41], [.68, 1.52], [.55, 2.205]],
  [-.05, [.48, .8], [.66, .93], [.68, 1.28, 1.41], [.68, 1.52], [.55, 2.2]],
  [.05, [.48, .81], [.66, .94], [.68, 1.29, 1.42], [.68, 1.53], [.54, 2.19]],
  [.75, [.44, .93], [.62, 1.04], [.64, 1.34, 1.46], [.62, 1.6], [.5, 2.1]],
  [1.5, [.34, 1.1], [.49, 1.2], [.52, 1.45, 1.55], [.5, 1.74], [.38, 2.03]],
  [2.4, [.2, 1.34], [.3, 1.41], [.33, 1.6, 1.68], [.32, 1.84], [.22, 1.98]],
  [3.19, [.06, 1.56], [.12, 1.6], [.13, 1.7, 1.76], [.125, 1.84], [.065, 1.91]],
];
// Which faces of a stretch are glass (4 and 6 the sides above the sill, 5 the
// roof): the windscreen and its quarter lights, the door's window, the one
// behind the door post and the rear window that wraps over the deck behind
// the wing
const WINDOWS = { 2: [4, 5, 6], 3: [4, 6], 5: [4, 6], 7: [4, 5, 6] };

// The wing's section at the root (along, height), from the leading edge over
// the top to the trailing edge and back under its flat bottom. Outboard of
// the cabin it rises with the dihedral. Over the ailerons the fixed wing
// stops short at the hinge, and the aileron carries on to the trailing edge.
// Over the cabin the top, from the crest back, is a skylight.
const WING = [[-1.55, 2.215], [-1.47, 2.285], [-1.12, 2.32], [-.4, 2.244], [.05, 2.197], [.05, 2.183], [-1.49, 2.18]];
const CUT = [[-.3, 2.234], [-.3, 2.18]], AILERON = [[-.285, 2.207], [-.255, 2.232], [.05, 2.197], [.05, 2.183], [-.255, 2.18]];
const CABIN = .6, DIHEDRAL = .035, AILERONS = [2.42, 4.38], TIPS = 4.4;
const lift = x => Math.max(0, Math.abs(x) - CABIN) * DIHEDRAL;
// The tailplane's and the elevator's sections (along, height) at the root
const TAILPLANE = [[2.76, 1.72], [2.84, 1.745], [3.2, 1.736], [3.2, 1.704], [2.84, 1.698]];
const ELEVATOR_SECTION = [[3.215, 1.72], [3.245, 1.738], [3.58, 1.726], [3.58, 1.714], [3.245, 1.702]];
// The lift struts: where they meet (just inside the fuselage's side, so their
// ends are hidden), how far out under the wing they reach, and the two spars
// they go up to
const STRUTS = { foot: [.655, 1.12, -.8], reach: 2.75, spars: [-1.3, -.45] };
// The fin's outline (along, height), its foot down inside the fuselage
const FIN = [[2.15, 1.92], [3.2, 1.8], [3.2, 2.72], [3.1, 2.72], [3, 2.66], [2.6, 2.04]];
// The rudder's trailing edge at each height up it, and which bands are cream
const RUDDER_EDGE = [[1.9, 3.66], [2.1, 3.7], [2.2, 3.7], [2.3, 3.7], [2.4, 3.69], [2.62, 3.6], [2.74, 3.38]], RUDDER_STRIPES = [1, 3];

// The side view's numbers, for the garage portrait (see car-art.js)
export const PLANE_PROFILE = { body: BODY, windows: WINDOWS, wing: WING, lift, struts: STRUTS, fin: FIN, tailplane: TAILPLANE, elevator: ELEVATOR_SECTION, rudder: RUDDER_EDGE, stripes: RUDDER_STRIPES, hub: HUB, main: MAIN, nose: NOSE };

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

// Faces laid one by one in car space, gathered by category and colour, for
// the shapes a box will not bend to: skins through rings of points, the caps
// on their ends and flat plates of any outline
function faceKit(kit) {
  const groups = new Map();
  const triangle = (look, a, b, c) => {
    if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() < 1e-12) return;
    const [category, color = null] = look, key = `${category}/${color}`;
    if (!groups.has(key)) groups.set(key, { category, color, points: [] });
    groups.get(key).points.push(a, b, c);
  };
  // (a triangle turned, if need be, to face `out`)
  const facing = (look, a, b, c, out) => b.clone().sub(a).cross(c.clone().sub(a)).dot(out) < 0 ? triangle(look, a, c, b) : triangle(look, a, b, c);
  const centre = points => points.reduce((sum, p) => sum.add(p), v3(0, 0, 0)).multiplyScalar(1 / points.length);
  const faces = {
    // A skin through rings of points, all the same count and wound the same
    // way. `style(k, i)` dresses the face from ring k's edge i to the next
    // ring: [category, colour] or null for none. A ring of one repeated point
    // closes it to an apex.
    loft(rings, style) {
      // (Newell's normal of the first ring, against the way the rings run)
      const first = rings[0], normal = v3(0, 0, 0);
      first.forEach((p, i) => { const q = first[(i + 1) % first.length]; normal.x += (p.y - q.y) * (p.z + q.z); normal.y += (p.z - q.z) * (p.x + q.x); normal.z += (p.x - q.x) * (p.y + q.y); });
      const flip = normal.dot(centre(rings.at(-1)).sub(centre(first))) < 0;
      for (let k = 0; k + 1 < rings.length; k++) {
        const a = rings[k], b = rings[k + 1];
        for (let i = 0; i < a.length; i++) {
          const look = style(k, i), j = (i + 1) % a.length;
          if (!look) continue;
          if (flip) { triangle(look, a[i], b[j], a[j]); triangle(look, a[i], b[i], b[j]); }
          else { triangle(look, a[i], a[j], b[j]); triangle(look, a[i], b[j], b[i]); }
        }
      }
    },
    // A flat convex end on a ring, facing `out`
    cap(ring, out, look) { for (let i = 1; i + 1 < ring.length; i++) facing(look, ring[0], ring[i], ring[i + 1], out); },
    // A thin open tube from one point to another, `sides` round
    tube(from, to, radius, look, sides = 6) {
      const a = v3(...from), b = v3(...to), along = b.clone().sub(a).normalize();
      const u = (Math.abs(along.y) < .9 ? v3(0, 1, 0) : v3(1, 0, 0)).cross(along).normalize(), w = along.clone().cross(u);
      const ring = p => Array.from({ length: sides }, (_, i) => p.clone().addScaledVector(u, Math.cos(i * Math.PI * 2 / sides) * radius).addScaledVector(w, Math.sin(i * Math.PI * 2 / sides) * radius));
      faces.loft([ring(a), ring(b)], () => look);
    },
    // A plate round an outline on its middle plane, each point `half` its
    // thickness either side along `normal`
    plate(outline, halves, normal, look) {
      const n = normal.clone().normalize(), across = Math.abs(n.y) < .9 ? v3(0, 1, 0) : v3(1, 0, 0);
      const u = across.sub(n.clone().multiplyScalar(across.dot(n))).normalize(), w = n.clone().cross(u);
      const flat = outline.map(p => new THREE.Vector2(p.dot(u), p.dot(w)));
      const top = outline.map((p, i) => p.clone().addScaledVector(n, halves[i])), bottom = outline.map((p, i) => p.clone().addScaledVector(n, -halves[i]));
      for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(flat, [])) {
        facing(look, top[a], top[b], top[c], n); facing(look, bottom[a], bottom[b], bottom[c], n.clone().negate());
      }
      // (each edge's outside, from which way the outline runs round)
      const turn = THREE.ShapeUtils.isClockWise(flat) ? -1 : 1;
      outline.forEach((p, i) => {
        const j = (i + 1) % outline.length, out = outline[j].clone().sub(p).cross(n).multiplyScalar(turn);
        facing(look, bottom[i], bottom[j], top[j], out); facing(look, bottom[i], top[j], top[i], out);
      });
    },
    finish() {
      for (const { category, color, points } of groups.values()) {
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        geometry.setIndex([...points.keys()]);
        geometry.computeVertexNormals();
        kit.place(geometry, [0, 0, 0], category, color);
      }
    },
  };
  return faces;
}

// A ring of `count` points round an axis through `middle`, `radius` out
function circle(middle, radius, count, axis, turn = 0) {
  const a = axis === 'x' ? v3(0, 1, 0) : v3(1, 0, 0), b = axis === 'z' ? v3(0, 1, 0) : v3(0, 0, 1);
  return Array.from({ length: count }, (_, i) => {
    const angle = turn + i * Math.PI * 2 / count;
    return middle.clone().addScaledVector(a, Math.cos(angle) * radius).addScaledVector(b, Math.sin(angle) * radius);
  });
}

function build(kit, faces) {
  const { box, solid } = kit;
  const { loft, cap, tube, plate } = faces;
  // A straight member from one point to another, its width along the
  // airflow and its thickness across it
  const bar = (from, to, [width, thick], category = 'details', color = category === 'paint' ? null : DARK) => {
    const a = v3(...from), b = v3(...to), middle = a.clone().add(b).multiplyScalar(.5), along = b.clone().sub(a), half = along.length() / 2;
    along.normalize();
    const wide = v3(0, 0, 1).addScaledVector(along, -along.z).normalize(), thin = along.clone().cross(wide);
    solid((sx, sy, sz) => middle.clone().addScaledVector(along, sy * half).addScaledVector(thin, sx * thick / 2).addScaledVector(wide, sz * width / 2).toArray(), category, color);
  };
  const paint = ['paint'], trim = color => ['details', color];

  // The fuselage, with a cream stripe down each side, and its glass
  const ring = ([z, bottom, chine, [x, low, high], sill, roof]) => {
    const right = [bottom, chine, [x, low], [x, high], sill, roof];
    return [...right, ...right.map(([x, y]) => [-x, y]).reverse()].map(([x, y]) => v3(x, y, z));
  };
  const body = BODY.map(ring);
  loft(body, (k, i) => i === 2 || i === 8 ? trim(CREAM) : WINDOWS[k]?.includes(i) ? trim(GLASS) : paint);
  cap(body[0], v3(0, 0, -1), paint); cap(body.at(-1), v3(0, 0, 1), paint);
  // Posts either side of the windscreen
  for (const side of [-1, 1]) bar([side * .5, 1.97, -2.3], [side * .55, 2.22, -1.52], [.05, .05], 'paint');
  // The cowling's air inlets either side of the spinner, and the exhaust under it
  for (const side of [-1, 1]) box([.13, .12, .02], [side * .32, 1.47, -3.425], 'details', DARK);
  tube([.3, .9, -2.62], [.34, .78, -2.42], .03, trim(DARK));
  // Door handles, below the door's window
  for (const side of [-1, 1]) box([.03, .025, .09], [side * .69, 1.465, -.72], 'details', CHROME);

  // The wing, tip to tip: rounded cream tips, the ailerons' bays cut out of
  // its trailing edge, flat over the cabin and rising either side of it
  const section = (x, { cut = false, scale = 1, thin = 1, back = 0 } = {}) => WING.map(([z, y], i) => {
    if (cut && (i === 4 || i === 5)) [z, y] = CUT[i - 4];
    return v3(x, 2.18 + (y - 2.18) * thin + lift(x), -.75 + (z + .75) * scale + back);
  });
  const tip = [[4.7, { scale: .55, thin: .45, back: .1 }], [4.62, { scale: .86, thin: .75, back: .03 }], [TIPS, {}]];
  const half = [[TIPS, { cut: true }], [AILERONS[0] - .02, { cut: true }], [AILERONS[0] - .02, {}], [CABIN, {}]];
  const stations = [...tip, ...half];
  const wing = [...stations.map(([x, o]) => section(-x, o)), ...[...stations].reverse().map(([x, o]) => section(x, o))];
  // (the stretch over the cabin is glass behind the crest, its second face up)
  const cream = tip.length - 1, cabin = stations.length - 1;
  loft(wing, (k, i) => k < cream || k >= wing.length - 1 - cream ? trim(CREAM) : k === cabin && i === 2 ? trim(GLASS) : paint);
  cap(wing[0], v3(-1, 0, 0), trim(CREAM)); cap(wing.at(-1), v3(1, 0, 0), trim(CREAM));
  // Landing lamps in the leading edge, and the navigation lights on the tips
  for (const side of [-1, 1]) box([.24, .05, .03], [side * 2, 2.215 + lift(2), -1.555], 'lamps');
  box([.04, .04, .1], [-4.69, 2.35, -.95], 'details', PORT);
  box([.04, .04, .1], [4.69, 2.35, -.95], 'details', STARBOARD);
  // The ailerons
  for (const [side, category] of [[-1, 'aileronLeft'], [1, 'aileronRight']]) {
    const rings = AILERONS.map(x => AILERON.map(([z, y]) => v3(side * x, y + lift(x), z)));
    loft(rings, () => [category]);
    cap(rings[0], v3(-side, 0, 0), [category]); cap(rings[1], v3(side, 0, 0), [category]);
  }
  // Lift struts from the fuselage's sides up to both spars, each held to the
  // wing at its middle by a jury strut
  for (const side of [-1, 1]) {
    const { foot: [x, y, z], reach, spars } = STRUTS, foot = [side * x, y, z];
    for (const spar of spars) {
      const top = [side * reach, 2.2 + lift(reach), spar];
      bar(foot, top, [.075, .035], 'details', CREAM);
      const middle = foot.map((value, i) => (value + top[i]) / 2);
      bar(middle, [middle[0], 2.2 + lift(middle[0]), middle[2]], [.05, .025], 'details', CREAM);
    }
  }

  // The tail: a fin with a swept front, the tailplane through the fuselage
  // with cream tips, the striped rudder and the elevator on their hinges,
  // and the beacon on top
  plate(FIN.map(([z, y]) => v3(0, y, z)), [.04, .04, .028, .028, .028, .035], v3(1, 0, 0), paint);
  const tailplane = [[-1.5, .55], [-1.32, 1], [1.32, 1], [1.5, .55]].map(([x, scale]) => TAILPLANE.map(([z, y]) => v3(x, y, 3.2 - (3.2 - z) * scale)));
  loft(tailplane, k => k === 1 ? paint : trim(CREAM));
  cap(tailplane[0], v3(-1, 0, 0), trim(CREAM)); cap(tailplane.at(-1), v3(1, 0, 0), trim(CREAM));
  const elevator = [[-1.48, .65], [-1.32, 1], [1.32, 1], [1.48, .65]].map(([x, scale]) => ELEVATOR_SECTION.map(([z, y]) => v3(x, y, 3.215 + (z - 3.215) * scale)));
  loft(elevator, k => k === 1 ? ['elevator'] : ['elevatorTrim', CREAM]);
  cap(elevator[0], v3(-1, 0, 0), ['elevatorTrim', CREAM]); cap(elevator.at(-1), v3(1, 0, 0), ['elevatorTrim', CREAM]);
  // (a sharp nose on the hinge line, thickest a little behind it)
  const rudder = RUDDER_EDGE.map(([y, back]) => [v3(0, y, RUDDER[2]), v3(.026, y, 3.3), v3(0, y, back), v3(-.026, y, 3.3)]);
  loft(rudder, k => RUDDER_STRIPES.includes(k) ? ['rudderTrim', CREAM] : ['rudder']);
  cap(rudder[0], v3(0, -1, 0), ['rudder']); cap(rudder.at(-1), v3(0, 1, 0), ['rudder']);
  box([.07, .06, .12], [0, 2.745, 3.1], 'beacon');
  box([.04, .03, .02], [0, 1.63, 3.195], 'details', TAIL_LIGHT);
  box([.12, .07, .16], [0, .845, .3], 'beacon');

  // The main gear: a V of legs down to each axle, and the fat tyres on it
  for (const side of [-1, 1]) {
    const axle = [side * .88, MAIN.y, MAIN.z];
    for (const z of [-.62, .2]) bar([side * .44, .86, z], axle, [.06, .05]);
  }
  // A balloon of a tyre, crowned across its tread, on a small cream hub
  // (whose octagon is cut to cover the tyre's rim)
  const tyre = (middle, radius, width, count, category) => {
    const h = width / 2, profile = [[-.8, .32], [-1, .64], [-.7, .92], [0, 1], [.7, .92], [1, .64], [.8, .32]];
    loft(profile.map(([along, out]) => circle(middle.clone().add(v3(along * h, 0, 0)), out * radius, count, 'x')), () => [category, DARK]);
    const hub = [-1, 1].map(end => circle(middle.clone().add(v3(end * (h * .8 + .012), 0, 0)), radius * .32 / Math.cos(Math.PI / 8) + .004, 8, 'x', Math.PI / 8));
    loft(hub, () => [category, CREAM]);
    cap(hub[0], v3(-1, 0, 0), [category, CREAM]); cap(hub[1], v3(1, 0, 0), [category, CREAM]);
  };
  tyre(v3(-MAIN.x, MAIN.y, MAIN.z), MAIN.radius, .34, 12, 'wheelLeft');
  tyre(v3(MAIN.x, MAIN.y, MAIN.z), MAIN.radius, .34, 12, 'wheelRight');
  // The nose wheel: an oleo down out of the cowling, and the fork that steers
  tube([0, .95, NOSE.z], [0, .78, NOSE.z], .045, trim(CHROME));
  tube([0, .66, NOSE.z], [0, .82, NOSE.z], .032, ['fork', DARK]);
  box([.36, .05, .1], [0, .66, NOSE.z], 'fork', DARK);
  for (const side of [-1, 1]) bar([side * .16, .66, NOSE.z], [side * .16, NOSE.radius, NOSE.z], [.07, .03], 'fork');
  tyre(v3(0, NOSE.radius, NOSE.z), NOSE.radius, .24, 10, 'noseWheel');

  // The propeller: two twisted blades with cream tips, through a cream spinner
  const hub = v3(...HUB);
  for (const turn of [0, Math.PI]) {
    const rings = [[.1, .1, .9, .05], [.45, .16, .45, .035], [.86, .13, .28, .025], [.95, .08, .24, .02]].map(([r, chord, pitch, thick]) => {
      // (the blade's leading edge is the way it turns, and it bites forward)
      const lead = v3(-Math.cos(pitch), 0, -Math.sin(pitch)).multiplyScalar(chord / 2), face = v3(Math.sin(pitch), 0, -Math.cos(pitch)).multiplyScalar(thick / 2);
      return [lead.clone().add(face), lead.clone().sub(face), lead.clone().negate().sub(face), lead.clone().negate().add(face)]
        .map(p => p.add(v3(0, r, 0)).applyAxisAngle(v3(0, 0, 1), turn).add(hub));
    });
    loft(rings, k => ['propeller', k < 2 ? DARK : CREAM]);
    cap(rings.at(-1), v3(0, 1, 0).applyAxisAngle(v3(0, 0, 1), turn), ['propeller', CREAM]);
  }
  const spinner = [[.115, .24], [0, .22], [-.09, .14], [-.15, 0]].map(([along, radius]) => radius ? circle(hub.clone().add(v3(0, 0, along)), radius, 8, 'z') : Array(8).fill(hub.clone().add(v3(0, 0, along))));
  loft(spinner, () => ['propeller', CREAM]);
}

export function createPlane(entry) {
  const kit = partsKit(PIVOT), faces = faceKit(kit);
  build(kit, faces);
  faces.finish();
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .74, flatShading: true, ...extra });
  const paint = mat(entry.paint), trim = mat('#ffffff', { vertexColors: true });
  const lamps = mat('#fff5cf', { emissive: '#e9cc84', emissiveIntensity: .2 }), beacon = mat('#8e2a22', { emissive: '#e8261a', emissiveIntensity: .35 });
  // A faint disc where the blades blur, only while the engine runs fast
  const discMaterial = new THREE.MeshBasicMaterial({ color: '#1f2a2c', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const shells = Object.fromEntries(Object.entries(kit.parts).map(([key, geometries]) => [key, mergeGeometries(geometries)]));
  for (const geometries of Object.values(kit.parts)) for (const geometry of geometries) geometry.dispose();

  const car = new THREE.Group(); car.name = 'car-plane';
  const body = new THREE.Group(); body.position.copy(PIVOT); car.add(body);
  const mesh = (geometry, material, parent = body) => {
    const part = new THREE.Mesh(geometry, material);
    part.castShadow = true; part.receiveShadow = true; parent.add(part); return part;
  };
  mesh(shells.paint, paint); mesh(shells.details, trim); mesh(shells.lamps, lamps); mesh(shells.beacon, beacon);
  // Each moving part turns about its own hub, axle or hinge, so its group
  // sits there (placed in car space here) and its shells are moved into it
  const group = (parent, [x, y, z]) => {
    const part = new THREE.Group(); part.position.set(x, y, z);
    if (parent === body) part.position.sub(PIVOT);
    parent.add(part); return part;
  };
  const propeller = group(body, HUB);
  const wheel = (parent, at, radius) => ({ group: group(parent, at), radius });
  const nose = group(body, [0, NOSE.fork, NOSE.z]);
  const wheels = [wheel(body, [-MAIN.x, MAIN.y, MAIN.z], MAIN.radius), wheel(body, [MAIN.x, MAIN.y, MAIN.z], MAIN.radius), wheel(nose, [0, NOSE.radius - NOSE.fork, 0], NOSE.radius)];
  // (the ailerons' hinges rise with the wing's dihedral, so each hangs in a
  // group tilted to match)
  const aileron = side => {
    const x = side * AILERONS[0], tilt = group(body, [x, AILERON[0][1] + lift(x), AILERON[0][0]]);
    tilt.rotation.z = side * Math.atan(DIHEDRAL);
    return group(tilt, [0, 0, 0]);
  };
  const surfaces = { aileronLeft: aileron(-1), aileronRight: aileron(1), elevator: group(body, ELEVATOR), rudder: group(body, RUDDER) };
  car.updateMatrixWorld(true);
  const into = (key, part, material = trim) => {
    shells[key].applyMatrix4(part.matrixWorld.clone().invert().multiply(body.matrixWorld));
    mesh(shells[key], material, part);
  };
  into('propeller', propeller); into('fork', nose);
  into('wheelLeft', wheels[0].group); into('wheelRight', wheels[1].group); into('noseWheel', wheels[2].group);
  for (const [key, part] of Object.entries(surfaces)) into(key, part, paint);
  into('elevatorTrim', surfaces.elevator); into('rudderTrim', surfaces.rudder);
  const discGeometry = new THREE.CircleGeometry(PLANE_SHAPE.prop, 24);
  const disc = new THREE.Mesh(discGeometry, discMaterial); disc.position.copy(propeller.position); disc.visible = false; body.add(disc);
  car.traverse(stableShadowDepth);
  return {
    car, body, wheels: [],
    nightLights: [{ material: lamps, day: .2, night: 2.4 }, { material: beacon, day: .35, night: 2.6 }],
    rotors: { propeller, disc, wheels, nose, surfaces },
    applyTrim() {},
    paintCar(color) { paint.color.set(color || entry.paint); },
    disposeModel() {
      for (const geometry of [...Object.values(shells), discGeometry]) geometry.dispose();
      for (const material of [paint, trim, lamps, beacon, discMaterial]) material.dispose();
    },
  };
}
