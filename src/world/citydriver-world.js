import * as THREE from 'three';
import { CITY, cityCell, CITY_CELL } from './city.js';
import { ROAD_LEVEL, PAVEMENT_LEVEL, WATER_LEVEL, roadAt, waterAt } from './city-route.js';
import { cityAssets, cityTrees } from './city-assets.js';
import { seededRandom, randomAt } from './route.js';
import { residentWindow } from './resident.js';
import { buildCityBuildingSteps } from './city-buildings.js';
import { createSignMaterial, discoverySignFor } from './city-signs.js';
import { cityItemMatrix, cityRigidFrame, cityAffinePoint } from './city-layout-render.js';
import { addSurfacePolygon, rectanglePolygon } from './city-surfaces.js';
import { buildGrassFringe } from './city-grass.js';
import { createWaterMaterial } from './city-water.js';
import { cityWalker, walkerFloat, WALKER_COLORS, createWalkerMaterial, walkerAppearance, setWalkerAppearance, pairWalkers, offsetWalkerPose } from './city-life.js';
import { applyWalkerHop, walkerTravelTime, holdWalkerTravel } from './pedestrian-reactions.js';
import { stableShadowDepth } from './shadow-depth.js';
import { navGraph } from './nav-graph.js';
import { junctionControls, cityGreen } from '../city-junctions.js';
import { signalLens } from './city-detail-assets.js';
import { cityPlaces } from '../city-exploration.js';
import { SIDEWALK } from '../mapgen/generate.js';
import { offsetPolyline, offsetPolygon, insidePolygon, calcPolygonArea, averagePoint, polygonBounds, dedupePolygon, extendPolyline } from '../mapgen/polygon-util.js';

const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const windowGeometry = new THREE.PlaneGeometry(1, 1);
const warmupMergedGeometry = new THREE.BufferGeometry();
for (const name of ['position', 'normal', 'color']) warmupMergedGeometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(9), 3));
const transform = new THREE.Object3D();
const residentItem = { p: [0, 0, 0], scale: [1, 1, 1], yaw: 0, roll: 0 };
const residentFloat = {};
const tint = new THREE.Color();
const dryRoad = new THREE.Color('#666c70'), wetRoad = new THREE.Color('#424e58');
const GREENS = ['#63924d', '#80a85c', '#4f8054', '#93ab65'];
const SIGNAL_GREEN = new THREE.Color('#62d996'), SIGNAL_AMBER = new THREE.Color('#ffd571'), SIGNAL_RED = new THREE.Color('#ed654b'), SIGNAL_OFF = new THREE.Color('#293538');
// Distant chunks further than this many cells from the car are not drawn at all.
const DISTANT_VISIBLE = 4;
const pick = (items, random) => items[Math.floor(random() * items.length)];
const LAMP_SPACING = 26, TREE_SPACING = 21;

function batchFlags(key, material) {
  const flags = {
    castShadow: !key.startsWith('surface-') && !key.startsWith('public-water') && !['road', 'water', 'lit', 'signal-lens', 'detail-clock', 'glass', 'grass-fringe'].includes(key),
    receiveShadow: !['lit', 'signal-lens', 'detail-clock'].includes(key), ambientOcclusion: true,
  };
  if (material.userData.signAtlas) flags.castShadow = flags.receiveShadow = flags.ambientOcclusion = false;
  if (key === 'water' || key === 'grass-fringe') flags.ambientOcclusion = false;
  return flags;
}
function finishBatchMesh(mesh, { castShadow, receiveShadow, ambientOcclusion }, structure) {
  mesh.renderOrder = structure ? -2 : 0;
  mesh.castShadow = castShadow; mesh.receiveShadow = receiveShadow;
  if (!ambientOcclusion) mesh.userData.ambientOcclusion = false;
  stableShadowDepth(mesh);
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  if (mesh.isInstancedMesh) mesh.computeBoundingSphere();
  else mesh.geometry.computeBoundingSphere();
  return mesh;
}

// Small batches that share a material draw as one merged mesh per chunk,
// with each instance's transform and colour baked into the vertices; big
// batches stay instanced. See citydriver's world for the reasoning.
const MERGE_INSTANCE_LIMIT = 32, MERGE_VERTEX_LIMIT = 6000;
const LIVE_BATCHES = new Set(['residents', 'signal-lens', 'canal-boat', 'water']);
const mergedMaterials = new WeakMap(), unitColors = new WeakMap();
function inUnitRange(color) {
  if (!unitColors.has(color)) unitColors.set(color, color.array.every(value => value >= 0 && value <= 1));
  return unitColors.get(color);
}
function mergeable(key, { geometry, material, items }) {
  const { position, normal, color } = geometry.attributes;
  return mergedMaterials.has(material) && !LIVE_BATCHES.has(key) && Boolean(normal)
    && (!color || (color.itemSize === 3 && inUnitRange(color))) && Object.keys(geometry.morphAttributes).length === 0
    && items.length <= MERGE_INSTANCE_LIMIT && items.length * position.count <= MERGE_VERTEX_LIMIT
    && items.every(item => item.signTile === undefined);
}
function vectors(attribute) {
  if (!attribute) return null;
  if (!attribute.isInterleavedBufferAttribute && !attribute.normalized && attribute.itemSize === 3) return attribute.array;
  const values = new Float32Array(attribute.count * 3);
  for (let i = 0; i < attribute.count; i++) {
    values[i * 3] = attribute.getX(i); values[i * 3 + 1] = attribute.getY(i); values[i * 3 + 2] = attribute.getZ(i);
  }
  return values;
}
function* mergeBatchSteps(entries, east, start) {
  const batches = entries.map(([, batch]) => batch);
  let vertexCount = 0, indexCount = 0;
  for (const { geometry, items } of batches) {
    vertexCount += geometry.attributes.position.count * items.length;
    indexCount += (geometry.index ?? geometry.attributes.position).count * items.length;
  }
  const position = new Float32Array(vertexCount * 3), normal = new Int16Array(vertexCount * 3), color = new Uint16Array(vertexCount * 3);
  const index = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  const f = Math.fround;
  let vertex = 0, next = 0;
  const record = {};
  for (const [batchKey, { geometry, items }] of entries) {
    const matrices = record[batchKey] = new Float32Array(items.length * 16);
    const count = geometry.attributes.position.count, source = geometry.index?.array;
    const p = vectors(geometry.attributes.position), n = vectors(geometry.attributes.normal), c = vectors(geometry.attributes.color);
    for (let k = 0; k < items.length; k++) {
      const item = items[k], matrix = cityItemMatrix(item, east, start, transform.matrix);
      matrix.toArray(matrices, k * 16);
      const [e0, e1, e2, , e4, e5, e6, , e8, e9, e10, , e12, e13, e14] = matrix.elements.map(f);
      const sx = e0 * e0 + e1 * e1 + e2 * e2, sy = e4 * e4 + e5 * e5 + e6 * e6, sz = e8 * e8 + e9 * e9 + e10 * e10;
      tint.set(item.color);
      const r = f(tint.r), g = f(tint.g), b = f(tint.b);
      for (let i = 0, j = 0; i < count; i++, j += 3) {
        const o = (vertex + i) * 3, x = p[j], y = p[j + 1], z = p[j + 2];
        position[o] = e0 * x + e4 * y + e8 * z + e12;
        position[o + 1] = e1 * x + e5 * y + e9 * z + e13;
        position[o + 2] = e2 * x + e6 * y + e10 * z + e14;
        const nx = n[j] / sx, ny = n[j + 1] / sy, nz = n[j + 2] / sz;
        const wx = e0 * nx + e4 * ny + e8 * nz, wy = e1 * nx + e5 * ny + e9 * nz, wz = e2 * nx + e6 * ny + e10 * nz;
        const unit = 32767 / (Math.hypot(wx, wy, wz) || 1);
        normal[o] = Math.round(wx * unit); normal[o + 1] = Math.round(wy * unit); normal[o + 2] = Math.round(wz * unit);
        color[o] = Math.round((c ? c[j] : 1) * r * 65535);
        color[o + 1] = Math.round((c ? c[j + 1] : 1) * g * 65535);
        color[o + 2] = Math.round((c ? c[j + 2] : 1) * b * 65535);
      }
      if (source) for (let i = 0; i < source.length; i++) index[next++] = vertex + source[i];
      else for (let i = 0; i < count; i++) index[next++] = vertex + i;
      vertex += count;
    }
    yield;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3, true));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3, true));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  const mesh = new THREE.Mesh(geometry, mergedMaterials.get(batches[0].material));
  mesh.name = 'citydriver-merged'; mesh.userData.batches = record;
  mesh.dispose = () => { geometry.dispose(); mesh.dispatchEvent({ type: 'dispose' }); };
  return mesh;
}
export function* blockBatches(group) {
  for (const mesh of group.children) {
    if (mesh.isInstancedMesh) yield { name: mesh.name.slice('citydriver-'.length), mesh, count: mesh.count, matrixAt: (i, target) => mesh.getMatrixAt(i, target) };
    else for (const [name, matrices] of Object.entries(mesh.userData.batches ?? {})) {
      yield { name, mesh, count: matrices.length / 16, matrixAt: (i, target) => target.fromArray(matrices, i * 16) };
    }
  }
}
function* renderBatchSteps(group, batches, east = 0, start = 0) {
  const merges = new Map();
  for (const [batchKey, batch] of batches) {
    const key = batch.structure ? batchKey.slice('structure-'.length) : batchKey;
    if (!batch.items.length || !mergeable(key, batch)) continue;
    const flags = batchFlags(key, batch.material);
    const id = [batch.material.uuid, batch.structure, flags.castShadow, flags.receiveShadow, flags.ambientOcclusion].join();
    if (!merges.has(id)) merges.set(id, { flags, structure: batch.structure, keys: [] });
    merges.get(id).keys.push(batchKey);
  }
  for (const [id, merge] of merges) if (merge.keys.length < 2) merges.delete(id);
  const merged = new Set([...merges.values()].flatMap(merge => merge.keys));
  for (const [batchKey, { geometry, material, items, structure }] of batches) {
    const key = structure ? batchKey.slice('structure-'.length) : batchKey;
    if (!items.length || merged.has(batchKey)) continue;
    const mesh = new THREE.InstancedMesh(geometry, material, items.length); mesh.name = `citydriver-${batchKey}`;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const matrix = cityItemMatrix(item, east, start, transform.matrix);
      mesh.setMatrixAt(i, matrix); tint.set(item.color); mesh.setColorAt(i, tint);
      if (item.signTile !== undefined) mesh.setColorAt(i, tint.setRGB(item.signTile, 0, 0));
      if (key === 'residents') setWalkerAppearance(mesh, i, item.appearance);
    }
    finishBatchMesh(mesh, batchFlags(key, material), structure);
    group.add(mesh);
    yield;
  }
  for (const { keys, flags, structure } of merges.values()) {
    const mesh = yield* mergeBatchSteps(keys.map(key => [key, batches.get(key)]), east, start);
    group.add(finishBatchMesh(mesh, flags, structure));
    yield;
  }
}

function resources() {
  const standard = options => new THREE.MeshStandardMaterial({ roughness: .9, flatShading: true, ...options });
  const result = {
    solid: standard({ color: '#ffffff' }),
    road: standard({ color: '#666c70', roughness: .6 }),
    glass: standard({ color: '#ffffff', roughness: .2, metalness: .25 }),
    lit: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
    clock: new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, toneMapped: false }),
    water: createWaterMaterial(),
    props: standard({ color: '#ffffff', vertexColors: true, roughness: .62 }),
    residents: createWalkerMaterial(),
    bark: standard({ color: '#625548', vertexColors: true, roughness: .97 }),
    leaves: standard({ color: '#ffffff', vertexColors: true, roughness: .8 }),
    // Ground, kerbs, lawns, quays and markings share one vertex-coloured material.
    ground: standard({ color: '#ffffff', vertexColors: true, roughness: .92, side: THREE.DoubleSide }),
  };
  for (const name of ['solid', 'props', 'bark', 'leaves']) {
    const merged = result[name].clone();
    merged.vertexColors = true;
    mergedMaterials.set(result[name], merged);
    result[`merged-${name}`] = merged;
  }
  result.signs = createSignMaterial();
  return result;
}

// Flat-shaded static geometry: every triangle carries its own face normal
// and colour, so the whole ground, the roads or the water are one draw each.
class Surface {
  constructor() { this.positions = []; this.normals = []; this.colors = []; this.flows = null; this.color = new THREE.Color(); }
  face(ax, ay, az, bx, by, bz, cx, cy, cz, color, flow = null) {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1; nx /= length; ny /= length; nz /= length;
    this.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    const { r, g, b } = this.color.set(color);
    for (let i = 0; i < 3; i++) { this.normals.push(nx, ny, nz); this.colors.push(r, g, b); }
    if (flow) { this.flows ??= []; for (let i = 0; i < 3; i++) this.flows.push(flow[0], flow[1]); }
  }
  // Horizontal triangle with its normal up, whichever way the points wind. Points are {x, y} on the map.
  flat(a, b, c, y, color, flow = null) {
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) < 1e-9) return;
    if (cross > 0) this.face(a.x, y, -a.y, b.x, y, -b.y, c.x, y, -c.y, color, flow);
    else this.face(a.x, y, -a.y, c.x, y, -c.y, b.x, y, -b.y, color, flow);
  }
  polygon(points, y, color, flowOf = null) {
    const clean = dedupePolygon(points);
    if (clean.length < 3) return;
    const faces = THREE.ShapeUtils.triangulateShape(clean.map(p => new THREE.Vector2(p.x, p.y)), []);
    for (const [i0, i1, i2] of faces) {
      const a = clean[i0], b = clean[i1], c = clean[i2];
      this.flat(a, b, c, y, color, flowOf ? flowOf((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3) : null);
    }
  }
  // A strip of road along a polyline
  ribbon(points, halfWidth, y, color) {
    const left = offsetPolyline(points, halfWidth), right = offsetPolyline(points, -halfWidth);
    for (let i = 0; i < points.length - 1; i++) {
      this.flat(left[i], right[i], right[i + 1], y, color);
      this.flat(left[i], right[i + 1], left[i + 1], y, color);
    }
  }
  // Vertical faces along a polyline, closed when asked
  wall(points, top, bottom, color, closed = false) {
    const count = closed ? points.length : points.length - 1;
    for (let i = 0; i < count; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      this.face(a.x, top, -a.y, b.x, top, -b.y, b.x, bottom, -b.y, color);
      this.face(a.x, top, -a.y, b.x, bottom, -b.y, a.x, bottom, -a.y, color);
    }
  }
  build() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    if (this.flows) geometry.setAttribute('flowDirection', new THREE.Float32BufferAttribute(this.flows, 2));
    geometry.computeBoundingSphere();
    return geometry;
  }
  get empty() { return this.positions.length === 0; }
}

// Points every `step` metres along a polyline, with the unit tangent
function* samples(points, step, offset = 0) {
  let carried = -offset;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < 1e-9) continue;
    const tx = dx / length, ty = dy / length;
    for (let d = carried < 0 ? -carried : step - carried; d <= length; d += step) {
      yield { x: a.x + tx * d, y: a.y + ty * d, tx, ty };
      carried = length - d;
    }
    if (carried < 0 || carried >= step) carried = (length + (carried < 0 ? -carried : carried)) % step;
    carried = (length - Math.floor((length + (carried < 0 ? -carried : 0)) / step) * step);
  }
}
// Simpler: distances along a polyline at fixed intervals
function alongPolyline(points, step, offset = 0) {
  const out = [];
  let travelled = 0, next = offset;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < 1e-9) continue;
    const tx = dx / length, ty = dy / length;
    while (next <= travelled + length) {
      const d = next - travelled;
      out.push({ x: a.x + tx * d, y: a.y + ty * d, tx, ty, distance: next });
      next += step;
    }
    travelled += length;
  }
  return out;
}

// A cell of the city: the lots and street furniture inside it, built either
// in full detail or as the distant skyline. Chunks share the batching and
// placement API of citydriver's grid blocks, so its buildings build unchanged.
export class CityChunk {
  constructor(world, ix, iz, distant = false, deferred = false) {
    this.world = world; this.ix = ix; this.iz = iz; this.start = iz * CITY_CELL; this.east = ix * CITY_CELL;
    this.index = `${ix},${iz}`; this.materials = world.materials; this.distant = distant;
    this.plan = { seed: Math.floor(randomAt(ix, iz + 7102, CITY.seed) * 0xffffffff) >>> 0, kind: 'blocks', ix, iz };
    this.group = new THREE.Group(); this.group.name = `citydriver-block-${this.index}`;
    this.features = { colliders: [], bridges: [], buildings: [], discoveries: [], medians: [], junctions: [], signals: [], lamps: [] };
    this.batches = new Map(); this.random = seededRandom(this.plan.seed);
    this.lots = world.lotsByChunk.get(this.index) ?? []; this.neighbourLots = world.neighbourLots(ix, iz);
    this.furniture = world.furnitureByChunk.get(this.index) ?? [];
    this.construction = this.buildSteps();
    if (!deferred) this.buildUntil();
  }
  buildUntil(deadline = Infinity) {
    while (this.construction && performance.now() < deadline) {
      if (this.construction.next().done) this.construction = null;
    }
    return this.construction === null;
  }
  *buildSteps() {
    yield* buildCityBuildingSteps(this);
    yield;
    this.buildFurniture(); yield;
    this.buildLife(); yield;
    this.mapFeatures(); yield;
    buildGrassFringe(this); yield;
    yield* this.finishSteps();
    this.surfacePoints = null; this.surfaceLayers = null;
  }
  layoutFrame(s, u) { return cityRigidFrame(s, u); }
  item(key, geometry, material, p, scale = [1, 1, 1], color = '#ffffff', yaw = 0, roll = 0, structure = this.buildingStructure === true) {
    if (structure) key = `structure-${key}`;
    if (!this.batches.has(key)) this.batches.set(key, { geometry, material, items: [], structure });
    const anchor = this.layoutAnchor ?? { s: this.start - p[2], u: this.east + p[0] };
    const item = { p, scale, color, yaw, roll, anchor, frame: this.layoutPlacement ?? this.layoutFrame(anchor.s, anchor.u) };
    this.batches.get(key).items.push(item);
    return item;
  }
  rigid(x, s, build, placement = null) {
    const previousAnchor = this.layoutAnchor, previousPlacement = this.layoutPlacement;
    this.layoutAnchor = { s: this.start + s, u: this.east + x };
    this.layoutPlacement = placement ?? this.layoutFrame(this.layoutAnchor.s, this.layoutAnchor.u);
    try { return build(); } finally { this.layoutAnchor = previousAnchor; this.layoutPlacement = previousPlacement; }
  }
  structure(x, s, build, placement = null) {
    const previous = this.buildingStructure;
    this.buildingStructure = true;
    try { return this.rigid(x, s, build, placement); }
    finally { this.buildingStructure = previous; }
  }
  polygon(points, y, height, color, kind = 'solid') { addSurfacePolygon(this, points, y, height, color, kind); }
  groundPoint(x, s) {
    if (!this.layoutAnchor) return [x, s];
    const p = cityAffinePoint(this.start + s, this.east + x, this.layoutAnchor, this.layoutPlacement ?? this.layoutFrame(this.layoutAnchor.s, this.layoutAnchor.u));
    return [p.u - this.east, p.s - this.start];
  }
  recordPath(points, width, endSection = null) {
    this.features.walkways ??= [];
    this.features.walkways.push({ points: points.map(p => [...p]), width, ...(endSection ? { endSection } : {}) });
  }
  recordPlanting(points) { this.features.planting ??= []; this.features.planting.push(points.map(p => [...p])); }
  recordReserve(points) { this.features.plantingExclusions ??= []; this.features.plantingExclusions.push(points.map(p => [...p])); }
  polygonSolid(points) {
    if (!this.distant) this.features.colliders.push({ logicalPolygon: points.map(([x, s]) => [this.east + x, this.start + s]) });
  }
  surface(x, y, s, width, height, depth, color, kind = 'solid', yaw = 0, roll = 0) {
    if (this.layoutAnchor || roll) return this.box(x, y, s, width, height, depth, color, kind, yaw, roll);
    this.polygon(rectanglePolygon(x, s, width, depth, yaw), y, height, color, kind);
  }
  box(x, y, s, width, height, depth, color, kind = 'solid', yaw = 0, roll = 0) {
    this.item(kind, boxGeometry, this.materials[kind], [x, y, -s], [width, height, depth], color, yaw, roll);
  }
  sign(sign, x, y, s, yaw, width = 6.1) {
    if (this.distant || !sign) return;
    for (const facing of [yaw, yaw + Math.PI]) {
      this.item('sign-board', windowGeometry, this.materials.signs,
        [x + Math.sin(facing) * .14, y, -s + Math.cos(facing) * .14], [width, width / sign.aspect, 1], '#ffffff', facing).signTile = sign.tile;
    }
  }
  solid(x, s, width, depth, flexible = false) {
    if (this.distant) return;
    const nx = !this.layoutAnchor && depth < 1 ? Math.ceil(width / 14) : 1;
    const nz = !this.layoutAnchor && width < 1 ? Math.ceil(depth / 14) : 1;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) this.features.colliders.push({
      x: this.east + x + (nx === 1 ? 0 : -width / 2 + (i + .5) * width / nx), z: -this.start - s + (nz === 1 ? 0 : depth / 2 - (j + .5) * depth / nz),
      heading: 0, halfWidth: width / nx / 2, halfLength: depth / nz / 2, reach: Math.hypot(width / nx, depth / nz) / 2, anchor: this.layoutAnchor, frame: this.layoutPlacement, flexible,
    });
  }
  post(x, s, radius) { if (!this.distant) this.features.colliders.push({ x: this.east + x, z: -this.start - s, reach: radius, anchor: this.layoutAnchor, frame: this.layoutPlacement }); }
  prop(name, x, s, yaw = 0, y = PAVEMENT_LEVEL) {
    if (this.distant) return;
    this.item(name, cityAssets[name], this.materials.props, [x, y, -s], [1, 1, 1], '#ffffff', yaw, 0, ['shelter', 'tank', 'kiosk'].includes(name));
  }
  tree(x, s, scale = 7) {
    const index = this.random() < .28 ? 1 : 0, variant = cityTrees[index], p = [x, PAVEMENT_LEVEL, -s];
    const width = scale * (.82 + this.random() * .24), size = [width, scale, width];
    if (this.distant) this.box(x, PAVEMENT_LEVEL + scale * .24, s, .2, scale * .48, .2, '#625548');
    else this.item(`tree-trunks-${index}`, variant.bark, this.materials.bark, p, size);
    this.item(`tree-crowns-${index}`, variant.leaves, this.materials.leaves, p, size, pick(GREENS, this.random));
    this.features.trees ??= [];
    this.features.trees.push({ x, s, scale });
    this.post(x, s, .28);
  }
  buildFurniture() {
    for (const piece of this.furniture) {
      const x = piece.u - this.east, s = piece.s - this.start;
      if (piece.kind === 'lamp') { this.prop('lamp', x, s, piece.yaw); this.post(x, s, .25); }
      else if (piece.kind === 'tree') this.tree(x, s, piece.scale);
      else if (piece.kind === 'bench') { this.prop('bench', x, s, piece.yaw); this.rigid(x, s, () => this.solid(x, s, .7, 2), cityRigidFrame(piece.s, piece.u, piece.yaw)); }
      else if (piece.kind === 'bin') { this.prop('bin', x, s); this.post(x, s, .36); }
      else if (piece.kind === 'bollard') { this.prop('bollard', x, s); this.post(x, s, .16); }
      else if (piece.kind === 'railing') this.rigid(x, s, () => { this.prop('railing', x, s, 0, piece.y ?? PAVEMENT_LEVEL); this.solid(x, s, .24, 4); }, cityRigidFrame(piece.s, piece.u, piece.yaw));
      else if (piece.kind === 'sign') this.sign(discoverySignFor(piece.type, piece.variant), x, PAVEMENT_LEVEL + 2.6, s, piece.yaw);
      else if (piece.kind === 'stop') { this.prop('stop', x, s, piece.yaw); this.post(x, s, .12); }
      else if (piece.kind === 'signal') {
        this.prop('signal', x, s, piece.yaw); this.post(x, s, .15);
        if (this.distant) continue;
        const indices = [];
        for (const y of [4.92, 4.6, 4.28]) {
          this.item('signal-lens', signalLens, this.materials.lit, [x + Math.sin(piece.yaw) * .215, PAVEMENT_LEVEL + y, -s + Math.cos(piece.yaw) * .215], [.105, .105, 1], '#293538', piece.yaw);
          indices.push(this.batches.get('signal-lens').items.length - 1);
        }
        this.features.signals.push({ axis: piece.axis, indices });
      }
      else if (piece.kind === 'hedge') this.rigid(x, s, () => { this.box(x, PAVEMENT_LEVEL + .55, s, 1.6, 1.1, piece.length, '#4f7a46'); this.solid(x, s, 1.6, piece.length); }, cityRigidFrame(piece.s, piece.u, piece.yaw));
      else if (piece.kind === 'barrier') this.rigid(x, s, () => {
        this.box(x, PAVEMENT_LEVEL + .5, s, piece.length, .9, .3, '#d8d3c3'); this.box(x, PAVEMENT_LEVEL + .62, s, piece.length, .18, .32, '#c0463a');
        this.solid(x, s, piece.length, .3);
      }, cityRigidFrame(piece.s, piece.u, piece.yaw));
    }
  }
  // Residents walk the pavement round their block; pairs stroll together.
  buildLife() {
    this.walkers = [];
    if (this.distant) return;
    const random = seededRandom(this.plan.seed + 912);
    for (const block of this.world.blocksByChunk.get(this.index) ?? []) {
      const count = block.perimeter > 140 ? 3 : 2, walkers = [];
      for (let i = 0; i < count; i++) walkers.push({
        loop: block, phase: random() * block.perimeter, speed: 1.1 + random() * 1.1, side: 0,
        direction: i % 2 ? -1 : 1, size: .9 + random() * .22, width: .92 + random() * .16, color: pick(WALKER_COLORS, random),
        appearance: walkerAppearance(this.plan.seed + block.index * 131 + i * 719),
      });
      pairWalkers(walkers, this.plan.seed + block.index);
      this.walkers.push(...walkers);
    }
    for (const walker of this.walkers) {
      const pose = offsetWalkerPose(this.walkerPose(walker, 0), walker);
      const motion = walkerFloat(walker, 0, residentFloat), width = walker.size * walker.width;
      this.item('residents', cityWalker, this.materials.residents, [pose.x - this.east, PAVEMENT_LEVEL + motion.lift, -(pose.s - this.start)],
        [width, walker.size * motion.stretch, width], walker.color, pose.yaw, motion.roll);
      this.batches.get('residents').items.at(-1).appearance = walker.appearance;
    }
  }
  // Where a walker is on its loop: world (x east, s north) and a yaw facing the way it walks
  walkerPose(walker, time) {
    const loop = walker.loop, travel = walker.phase + time * walker.speed * walker.direction;
    const d = ((travel % loop.perimeter) + loop.perimeter) % loop.perimeter, points = loop.points, cumulative = loop.cumulative;
    let i = 0;
    while (i < points.length - 1 && cumulative[i + 1] <= d) i++;
    const a = points[i], b = points[(i + 1) % points.length], span = (cumulative[i + 1] - cumulative[i]) || 1, t = (d - cumulative[i]) / span;
    const du = (b.x - a.x) / span * walker.direction, ds = (b.y - a.y) / span * walker.direction;
    return { x: a.x + (b.x - a.x) * t, s: a.y + (b.y - a.y) * t, yaw: -Math.atan2(du, ds) };
  }
  animate(time, signalTime = time, animatePeople = true, contacts = null) {
    this.animateSignals(signalTime);
    if (!animatePeople || !this.peopleMesh) return;
    const mesh = this.peopleMesh;
    for (let i = 0; i < this.walkers.length; i++) {
      const walker = this.walkers[i], travelTime = walkerTravelTime(walker, time);
      const pose = offsetWalkerPose(this.walkerPose(walker, travelTime), walker);
      const motion = walkerFloat(walker, time, residentFloat), width = walker.size * walker.width;
      residentItem.p[0] = pose.x - this.east; residentItem.p[1] = PAVEMENT_LEVEL + motion.lift; residentItem.p[2] = -(pose.s - this.start);
      residentItem.yaw = pose.yaw; residentItem.roll = motion.roll;
      residentItem.scale[0] = residentItem.scale[2] = width; residentItem.scale[1] = walker.size * motion.stretch;
      const matrix = cityItemMatrix(residentItem, this.east, this.start, transform.matrix), e = matrix.elements;
      if (contacts?.hit(walker, e[12] + this.east, e[13], e[14] - this.start, .28 * width, time)) {
        const partner = walker.pairOffset ? this.walkers[i + (walker.pairOffset < 0 ? 1 : -1)] : null;
        holdWalkerTravel(walker, partner, time);
      }
      applyWalkerHop(walker, matrix, time);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  animateSignals(signalTime) {
    const phase = Math.floor(signalTime % 24);
    // The lamps change at six moments in each cycle; recolour only then.
    const northGreen = cityGreen('north', signalTime), eastGreen = cityGreen('east', signalTime);
    const lights = (northGreen ? 1 : phase === 10 ? 2 : 0) + (eastGreen ? 3 : phase === 22 ? 6 : 0);
    if (lights === this.signalLights || !this.signalMesh) return;
    this.signalLights = lights;
    for (const signal of this.features.signals) {
      const north = signal.axis === 'north', green = north ? northGreen : eastGreen, amber = north ? phase === 10 : phase === 22;
      for (let i = 0; i < 3; i++) {
        this.signalMesh.setColorAt(signal.indices[i], (i === 2 && green) ? SIGNAL_GREEN : (i === 1 && amber) ? SIGNAL_AMBER : (i === 0 && !green && !amber) ? SIGNAL_RED : SIGNAL_OFF);
      }
    }
    this.signalMesh.instanceColor.needsUpdate = true;
  }
  finish() { for (const _ of this.finishSteps()) { /* synchronous tools/startup */ } }
  *finishSteps() {
    this.features.lamps = (this.batches.get('lamp')?.items ?? []).map(item => {
      const matrix = cityItemMatrix(item, this.east, this.start, transform.matrix);
      const point = new THREE.Vector3(-1.75, 7.36, 0).applyMatrix4(matrix);
      return { x: point.x + this.east, y: point.y, z: point.z - this.start, yaw: Math.atan2(matrix.elements[8], matrix.elements[10]) };
    });
    yield* renderBatchSteps(this.group, this.batches, this.east, this.start);
    this.signalMesh = this.group.getObjectByName('citydriver-signal-lens');
    this.peopleMesh = this.group.getObjectByName('citydriver-residents');
    if (this.peopleMesh) {
      this.peopleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Their initial positions do not bound the full walk around the block.
      this.peopleMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(CITY_CELL / 2, PAVEMENT_LEVEL + 1, -CITY_CELL / 2), CITY_CELL * 1.3);
    }
    this.group.matrixAutoUpdate = false;
    this.collisionBounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const c of this.features.colliders) {
      this.collisionBounds.minX = Math.min(this.collisionBounds.minX, c.x - c.reach);
      this.collisionBounds.maxX = Math.max(this.collisionBounds.maxX, c.x + c.reach);
      this.collisionBounds.minZ = Math.min(this.collisionBounds.minZ, c.z - c.reach);
      this.collisionBounds.maxZ = Math.max(this.collisionBounds.maxZ, c.z + c.reach);
    }
    this.batches = null;
  }
  mapFeatures() {
    for (const c of this.features.colliders) {
      if (c.logicalPolygon) {
        const n = c.logicalPolygon.length;
        c.corners = c.logicalPolygon.map(([u, s]) => ({ x: u, z: -s }));
        c.x = c.corners.reduce((sum, p) => sum + p.x, 0) / n; c.z = c.corners.reduce((sum, p) => sum + p.z, 0) / n;
        c.reach = Math.max(...c.corners.map(p => Math.hypot(p.x - c.x, p.z - c.z)));
        c.heading = 0; delete c.logicalPolygon; continue;
      }
      const s = -c.z, u = c.x, anchor = c.anchor ?? { s, u }, frame = c.frame ?? this.layoutFrame(anchor.s, anchor.u);
      const p = cityAffinePoint(s, u, anchor, frame);
      c.x = p.u; c.z = -p.s;
      if (c.halfWidth !== undefined) {
        c.corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([dx, ds]) => {
          const v = cityAffinePoint(s + ds * c.halfLength, u + dx * c.halfWidth, anchor, frame);
          return { x: v.u, z: -v.s };
        });
        c.reach = Math.max(...c.corners.map(v => Math.hypot(v.x - c.x, v.z - c.z)));
        c.heading = Math.atan2(frame.nu, frame.ns);
      }
      delete c.anchor; delete c.frame;
    }
  }
  dispose() {
    this.construction?.return(); this.construction = null;
    this.group.removeFromParent(); for (const mesh of this.group.children) mesh.dispose();
  }
}

export class CitydriverWorld {
  constructor(scene) {
    this.scene = scene; this.chunks = new Map(); this.origin = 0; this.center = null; this.radius = 0;
    this.pending = []; this.building = null; this.materials = resources(); this.nav = navGraph();
    this.animationFrustum = new THREE.Frustum(); this.animationMatrix = new THREE.Matrix4(); this.animationSphere = new THREE.Sphere();
    this.prepareLots(); this.placeFurniture();
    this.staticGroup = new THREE.Group(); this.staticGroup.name = 'citydriver-static'; this.staticGroup.matrixAutoUpdate = false;
    scene.add(this.staticGroup);
    this.buildStatic();
    this.distantGroup = new THREE.Group(); this.distantGroup.name = 'citydriver-distant-city'; this.distantGroup.matrixAutoUpdate = false;
    scene.add(this.distantGroup);
    this.distant = new Map(); this.distantPending = [];
    for (let ix = CITY.ix0; ix <= CITY.ix1; ix++) for (let iz = CITY.iz0; iz <= CITY.iz1; iz++) this.distantPending.push({ ix, iz, key: `${ix},${iz}` });
  }
  inCity(ix, iz) { return ix >= CITY.ix0 && ix <= CITY.ix1 && iz >= CITY.iz0 && iz <= CITY.iz1; }
  prepareLots() {
    this.lotsByChunk = new Map(); this.neighbourCache = new Map(); this.blocksByChunk = new Map();
    // A walking loop just inside every block's kerb
    CITY.blocks.forEach((block, index) => {
      if (block.sidewalk.length < 3) return;
      const points = offsetPolygon(block.sidewalk, -1.5);
      if (points.length < 3) return;
      const cumulative = [0];
      for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; cumulative.push(cumulative[i] + Math.hypot(b.x - a.x, b.y - a.y)); }
      const perimeter = cumulative[points.length];
      if (perimeter < 70) return;
      const centre = averagePoint(points), key = cityCell(centre.y, centre.x).key;
      if (!this.blocksByChunk.has(key)) this.blocksByChunk.set(key, []);
      this.blocksByChunk.get(key).push({ index, points, cumulative, perimeter });
    });
    CITY.lots.forEach((polygon, index) => {
      const centre = averagePoint(polygon), area = calcPolygonArea(polygon), cell = cityCell(centre.y, centre.x);
      const lot = { polygon, index, centre, area, seed: Math.floor(randomAt(Math.round(centre.x), Math.round(centre.y) + 7102, CITY.seed) * 0xffffffff) >>> 0, fit: null };
      if (!this.lotsByChunk.has(cell.key)) this.lotsByChunk.set(cell.key, []);
      this.lotsByChunk.get(cell.key).push(lot);
    });
  }
  neighbourLots(ix, iz) {
    const key = `${ix},${iz}`;
    if (!this.neighbourCache.has(key)) {
      const lots = [];
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) lots.push(...(this.lotsByChunk.get(`${ix + dx},${iz + dz}`) ?? []));
      this.neighbourCache.set(key, lots);
    }
    return this.neighbourCache.get(key);
  }
  insideLot(u, s) {
    const point = { x: u, y: s };
    return this.neighbourLots(Math.floor(u / CITY_CELL), Math.floor(s / CITY_CELL)).some(lot => insidePolygon(point, lot.polygon));
  }
  // Lamps and trees along every street, trees through the parks, railings on
  // the bridges: computed once and handed to whichever chunk they fall in.
  placeFurniture() {
    this.furnitureByChunk = new Map();
    const add = piece => {
      const key = cityCell(piece.s, piece.u).key;
      if (!this.furnitureByChunk.has(key)) this.furnitureByChunk.set(key, []);
      this.furnitureByChunk.get(key).push(piece);
    };
    const junctions = this.nav.nodes.filter(node => node.edges.length >= 3);
    const nearJunction = (x, y, radius) => junctions.some(node => Math.abs(node.x - x) < radius && Math.abs(node.y - y) < radius && Math.hypot(node.x - x, node.y - y) < radius);
    const clear = (x, y, radius) => !nearJunction(x, y, radius) && !waterAt(y, x) && !this.insideLot(x, y);
    for (const road of CITY.roads) {
      if (road.kind === 'path') continue;
      const halfWidth = road.profile.halfWidth;
      alongPolyline(road.points, LAMP_SPACING, 13).forEach((p, i) => {
        const side = i % 2 ? 1 : -1, nx = -p.ty * side, ny = p.tx * side;
        const x = p.x + nx * (halfWidth + 1.1), y = p.y + ny * (halfWidth + 1.1);
        if (clear(x, y, 12)) add({ kind: 'lamp', u: x, s: y, yaw: Math.atan2(ny, nx) });
      });
      alongPolyline(road.points, TREE_SPACING, 24).forEach((p, i) => {
        const side = i % 2 ? -1 : 1, nx = -p.ty * side, ny = p.tx * side;
        const x = p.x + nx * (halfWidth + 2.7), y = p.y + ny * (halfWidth + 2.7);
        if (clear(x, y, 11)) add({ kind: 'tree', u: x, s: y, scale: 7.5 + randomAt(Math.round(x), Math.round(y) + 31, CITY.seed) * 2.5 });
      });
    }
    // Parks: trees scattered off the paths, benches beside them
    this.parkLawns = [];
    CITY.parks.forEach((park, index) => {
      const lawn = offsetPolygon(park, (a, b) => { const road = roadAt((a.y + b.y) / 2, (a.x + b.x) / 2, 30); return -((road?.road.profile.halfWidth ?? 6.5) + 1.2); });
      if (!lawn.length) return;
      this.parkLawns.push(lawn);
      const random = seededRandom(CITY.seed + index * 7919), bounds = polygonBounds(lawn), area = calcPolygonArea(lawn);
      const placed = [], wanted = Math.min(400, Math.floor(area / 240));
      for (let attempt = 0; attempt < wanted * 6 && placed.length < wanted; attempt++) {
        const x = bounds.minX + random() * (bounds.maxX - bounds.minX), y = bounds.minY + random() * (bounds.maxY - bounds.minY);
        if (!insidePolygon({ x, y }, lawn)) continue;
        const road = roadAt(y, x, 30);
        if (road && road.distance < road.road.profile.halfWidth + 3.5) continue;
        if (placed.some(q => Math.hypot(q.x - x, q.y - y) < 8)) continue;
        placed.push({ x, y });
        add({ kind: 'tree', u: x, s: y, scale: 7 + random() * 4.5 });
      }
      for (const road of CITY.roads) {
        if (road.kind !== 'path') continue;
        alongPolyline(road.points, 44, 22).forEach((p, i) => {
          const side = i % 2 ? 1 : -1, nx = -p.ty * side, ny = p.tx * side, x = p.x + nx * 5.3, y = p.y + ny * 5.3;
          if (!insidePolygon({ x, y }, lawn) || nearJunction(x, y, 10)) return;
          // The bench faces the path: its seat looks along +x, so turn +x toward the path
          add({ kind: 'bench', u: x, s: y, yaw: Math.atan2(-ny, -nx) });
        });
      }
    });
    // Signals and stop signs at the right-hand kerb of every controlled approach
    for (const [node, control] of junctionControls(this.nav)) {
      for (const [edge, approach] of control.approaches) {
        if (approach.kind === 'priority') continue;
        const direction = edge.b === node.id ? 1 : -1;
        const end = this.nav.pose(edge, edge.length, direction), du = Math.sin(end.heading), ds = Math.cos(end.heading);
        const back = approach.crossHalfWidth + 2.2, right = edge.profile.halfWidth + 1.2;
        const u = node.x - du * back + ds * right, y = node.y - ds * back - du * right;
        if (waterAt(y, u)) continue;
        // The head faces back down the approach, toward the arriving car
        const yaw = Math.atan2(-du, -ds);
        add(approach.kind === 'signal' ? { kind: 'signal', u, s: y, yaw, axis: approach.axis } : { kind: 'stop', u, s: y, yaw });
      }
    }
    // Railings along the quays, with a gap wherever a road meets the water
    for (const run of CITY.walls) {
      const inland = offsetPolyline(run, -1.1);
      for (const p of alongPolyline(inland, 4, 2)) {
        const road = roadAt(p.y, p.x, 30);
        if (road && road.distance < road.road.profile.halfWidth + 1.5) continue;
        add({ kind: 'railing', u: p.x, s: p.y, yaw: Math.atan2(p.tx, p.ty), y: PAVEMENT_LEVEL });
      }
    }
    // A hedge around the edge of the city, with a barrier across every road that reaches it
    const edgeRuns = [
      [{ x: CITY.minX + CITY.margin, y: CITY.minY + CITY.margin }, { x: CITY.maxX - CITY.margin, y: CITY.minY + CITY.margin }],
      [{ x: CITY.maxX - CITY.margin, y: CITY.minY + CITY.margin }, { x: CITY.maxX - CITY.margin, y: CITY.maxY - CITY.margin }],
      [{ x: CITY.maxX - CITY.margin, y: CITY.maxY - CITY.margin }, { x: CITY.minX + CITY.margin, y: CITY.maxY - CITY.margin }],
      [{ x: CITY.minX + CITY.margin, y: CITY.maxY - CITY.margin }, { x: CITY.minX + CITY.margin, y: CITY.minY + CITY.margin }],
    ];
    const barred = new Set();
    for (const run of edgeRuns) for (const p of alongPolyline(run, 6, 3)) {
      const inward = { x: p.x - p.ty * 3, y: p.y + p.tx * 3 };
      if (waterAt(inward.y, inward.x)) continue;
      const road = roadAt(inward.y, inward.x, 30);
      if (road && road.distance < road.road.profile.halfWidth + 2.5) {
        const key = `${road.roadIndex}:${Math.round(p.x / 40)}:${Math.round(p.y / 40)}`;
        if (barred.has(key)) continue;
        barred.add(key);
        add({ kind: 'barrier', u: road.x - road.tx * 0 , s: road.y, yaw: Math.atan2(road.tx, road.ty) + Math.PI / 2, length: road.road.profile.halfWidth * 2 - .6 });
        continue;
      }
      add({ kind: 'hedge', u: inward.x, s: inward.y, yaw: Math.atan2(p.tx, p.ty), length: 6.2 });
    }
    // A sign board on the pavement at every venue's entrance
    for (const place of cityPlaces()) {
      const road = roadAt(place.entrance.s, place.entrance.u, 40);
      if (!road) continue;
      const du = Math.sin(place.entrance.heading), ds = Math.cos(place.entrance.heading), reach = road.road.profile.halfWidth + 2.6;
      const u = road.x + ds * reach, y = road.y - du * reach;
      if (waterAt(y, u) || this.insideLot(u, y)) continue;
      add({ kind: 'sign', type: place.type, variant: place.variant, u, s: y, yaw: Math.atan2(du, ds) + Math.PI / 2 });
    }
    // Bridges: a run of road over water gets railings on both edges
    this.bridges = [];
    for (const road of CITY.roads) {
      if (road.kind === 'path') continue;
      let run = null;
      const flush = () => { if (run && run.length > 2) this.bridges.push({ road, points: run }); run = null; };
      for (const p of alongPolyline(road.points, 3)) {
        if (waterAt(p.y, p.x)) { run ??= []; run.push(p); } else flush();
      }
      flush();
    }
    for (const bridge of this.bridges) {
      const halfWidth = bridge.road.profile.halfWidth, line = extendPolyline(bridge.points.map(p => ({ x: p.x, y: p.y, clone() { return { ...this }; }, sub(v) { this.x -= v.x; this.y -= v.y; return this; }, add(v) { this.x += v.x; this.y += v.y; return this; }, setLength(l) { const d = Math.hypot(this.x, this.y) || 1; this.x *= l / d; this.y *= l / d; return this; } })), 5);
      for (const side of [-1, 1]) {
        const edge = offsetPolyline(line, side * (halfWidth - .35));
        for (const p of alongPolyline(edge, 4, 2)) add({ kind: 'railing', u: p.x, s: p.y, yaw: Math.atan2(p.tx, p.ty), y: ROAD_LEVEL });
      }
    }
  }
  buildStatic() {
    const ground = new Surface(), roads = new Surface(), paths = new Surface(), water = new Surface(), walls = new Surface();
    const add = (surface, material, { castShadow = false, receiveShadow = true, ambientOcclusion = true, name = 'static' } = {}) => {
      if (surface.empty) return null;
      const mesh = new THREE.Mesh(surface.build(), material);
      mesh.name = `citydriver-${name}`; mesh.castShadow = castShadow; mesh.receiveShadow = receiveShadow;
      if (!ambientOcclusion) mesh.userData.ambientOcclusion = false;
      stableShadowDepth(mesh); mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      this.staticGroup.add(mesh);
      return mesh;
    };
    // Land, in the pieces the water leaves
    for (const piece of CITY.land) ground.polygon(piece, ROAD_LEVEL - .04, '#a9ad9f');
    // Roads, with their markings, then the park paths a little higher on the lawns
    const junctions = this.nav.nodes.filter(node => node.edges.length >= 3);
    const nearJunction = (x, y, radius) => junctions.some(node => Math.hypot(node.x - x, node.y - y) < radius);
    for (const road of CITY.roads) {
      const profile = road.profile;
      if (road.kind === 'path') { paths.ribbon(road.points, profile.halfWidth, PAVEMENT_LEVEL + .01, '#b9ad8e'); continue; }
      roads.ribbon(road.points, profile.halfWidth, ROAD_LEVEL, '#666c70');
      const markings = new Surface();
      if (profile.kind === 'boulevard') {
        for (const p of alongPolyline(road.points, 11, 4)) {
          if (nearJunction(p.x, p.y, profile.halfWidth + 14)) continue;
          const a = { x: p.x, y: p.y }, b = { x: p.x + p.tx * 5, y: p.y + p.ty * 5 };
          for (const offset of [-profile.median - .4, profile.median + .4]) markings.ribbon(offsetPolyline([a, b], offset), .12, ROAD_LEVEL + .012, '#d8bd80');
          for (const offset of [-(profile.halfWidth - .6), profile.halfWidth - .6]) markings.ribbon(offsetPolyline([a, b], offset), .13, ROAD_LEVEL + .012, '#d7d8c9');
        }
        // The planted median between junctions
        for (const p of alongPolyline(road.points, 3, 0)) {
          if (nearJunction(p.x, p.y, profile.halfWidth + 16)) continue;
          const a = { x: p.x, y: p.y }, b = { x: p.x + p.tx * 3.05, y: p.y + p.ty * 3.05 };
          ground.ribbon([a, b], profile.median, ROAD_LEVEL + .22, '#c3bfab');
          ground.ribbon([a, b], profile.median - .2, ROAD_LEVEL + .28, '#779757');
          ground.wall(offsetPolyline([a, b], profile.median), ROAD_LEVEL + .22, ROAD_LEVEL, '#b5b19e');
          ground.wall(offsetPolyline([a, b], -profile.median), ROAD_LEVEL + .22, ROAD_LEVEL, '#b5b19e');
        }
      } else if (profile.kind === 'avenue') {
        for (const p of alongPolyline(road.points, 11, 4)) {
          if (nearJunction(p.x, p.y, profile.halfWidth + 12)) continue;
          markings.ribbon([{ x: p.x, y: p.y }, { x: p.x + p.tx * 4, y: p.y + p.ty * 4 }], .13, ROAD_LEVEL + .012, '#d8bd80');
        }
      }
      if (!markings.empty) { for (let i = 0; i < markings.positions.length; i++) ground.positions.push(markings.positions[i]); ground.normals.push(...markings.normals); ground.colors.push(...markings.colors); }
    }
    // Stop lines and zebra crossings on every controlled approach
    for (const [node, control] of junctionControls(this.nav)) {
      for (const [edge, approach] of control.approaches) {
        const direction = edge.b === node.id ? 1 : -1;
        const end = this.nav.pose(edge, edge.length, direction), du = Math.sin(end.heading), ds = Math.cos(end.heading);
        const halfWidth = edge.profile.halfWidth, back = approach.crossHalfWidth;
        const at = (behind, across) => ({ x: node.x - du * behind + ds * across, y: node.y - ds * behind - du * across });
        if (approach.kind !== 'priority') ground.polygon([at(back + 1.2, .3), at(back + 1.2, halfWidth - .4), at(back + 1.6, halfWidth - .4), at(back + 1.6, .3)], ROAD_LEVEL + .014, '#e1dfce');
        for (let across = -halfWidth + .9; across < halfWidth - .4; across += 1.7) {
          ground.polygon([at(back + 2.1, across), at(back + 2.1, across + .9), at(back + 4.9, across + .9), at(back + 4.9, across)], ROAD_LEVEL + .014, '#deddd0');
        }
      }
    }
    // Sidewalks with kerbs, parks, then the lots on top
    for (const block of CITY.blocks) {
      if (block.sidewalk.length < 3) continue;
      ground.polygon(block.sidewalk, PAVEMENT_LEVEL, '#acafa8');
      ground.wall(block.sidewalk, PAVEMENT_LEVEL, ROAD_LEVEL - .02, '#9a9d98', true);
    }
    for (const lawn of this.parkLawns) {
      ground.polygon(lawn, PAVEMENT_LEVEL, '#79a05a');
      ground.wall(lawn, PAVEMENT_LEVEL, ROAD_LEVEL - .02, '#9a9d98', true);
    }
    for (const lot of CITY.lots) ground.polygon(lot, PAVEMENT_LEVEL + .03, '#b3b2a5');
    // Water and the quays that hold the city above it
    const riverCentre = CITY.riverCentre;
    const flowAt = (x, y) => {
      if (!riverCentre) return [1, 0];
      let best = 0, bestDistance = Infinity;
      for (let i = 0; i < riverCentre.length - 1; i += 4) { const d = Math.hypot(riverCentre[i].x - x, riverCentre[i].y - y); if (d < bestDistance) { bestDistance = d; best = i; } }
      const a = riverCentre[best], b = riverCentre[Math.min(riverCentre.length - 1, best + 1)], length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return [(b.x - a.x) / length, -(b.y - a.y) / length];
    };
    if (CITY.sea) water.polygon(CITY.sea, WATER_LEVEL, '#397780', () => [1, 0]);
    if (CITY.river) water.polygon(CITY.river, WATER_LEVEL, '#397780', flowAt);
    for (const run of CITY.walls) { walls.wall(run, PAVEMENT_LEVEL + .02, WATER_LEVEL - 1.6, '#9b9789'); walls.ribbon(offsetPolyline(run, -.25), .3, PAVEMENT_LEVEL + .2, '#b3aea0'); }
    // Bridge decks: the road surface is already there; add the sides and piers
    for (const bridge of this.bridges) {
      const halfWidth = bridge.road.profile.halfWidth, points = bridge.points;
      for (const side of [-1, 1]) walls.wall(offsetPolyline(points, side * halfWidth), ROAD_LEVEL - .01, ROAD_LEVEL - 1.4, '#8f8b80');
      walls.ribbon(points, halfWidth, ROAD_LEVEL - 1.4, '#6f6b63');
      for (const p of alongPolyline(points, 30, 15)) {
        const nx = -p.ty, ny = p.tx, along = 1.2, across = halfWidth - 1;
        const corners = [
          { x: p.x + p.tx * along + nx * across, y: p.y + p.ty * along + ny * across }, { x: p.x - p.tx * along + nx * across, y: p.y - p.ty * along + ny * across },
          { x: p.x - p.tx * along - nx * across, y: p.y - p.ty * along - ny * across }, { x: p.x + p.tx * along - nx * across, y: p.y + p.ty * along - ny * across },
        ];
        walls.wall(corners, ROAD_LEVEL - 1.3, WATER_LEVEL - 3, '#7d7a72', true);
      }
    }
    this.groundMesh = add(ground, this.materials.ground, { name: 'ground' });
    this.roadMesh = add(roads, this.materials.road, { name: 'roads' });
    add(paths, this.materials.ground, { name: 'paths' });
    this.waterMesh = add(water, this.materials.water, { name: 'water', ambientOcclusion: false });
    add(walls, this.materials.ground, { name: 'walls', castShadow: true });
  }
  update(s, u, { budgetMs = Infinity } = {}) {
    const deadline = performance.now() + budgetMs;
    const cell = cityCell(s, u), window = residentWindow();
    const radius = window.ahead >= 5 ? 3 : window.ahead >= 4 ? 2 : 1;
    if (this.center !== cell.key || this.radius !== radius) {
      this.center = cell.key; this.radius = radius;
      for (const [key, chunk] of this.chunks) {
        if (Math.abs(chunk.ix - cell.ix) > radius || Math.abs(chunk.iz - cell.iz) > radius) {
          chunk.dispose(); this.chunks.delete(key);
          const distant = this.distant.get(key); if (distant) distant.group.visible = true;
        }
      }
      this.pending = [];
      for (let ix = cell.ix - radius; ix <= cell.ix + radius; ix++) for (let iz = cell.iz - radius; iz <= cell.iz + radius; iz++) {
        const key = `${ix},${iz}`;
        if (this.inCity(ix, iz) && !this.chunks.has(key)) this.pending.push({ ix, iz, key, distance: Math.max(Math.abs(ix - cell.ix), Math.abs(iz - cell.iz)) });
      }
      this.pending.sort((a, b) => a.distance - b.distance || a.iz - b.iz || a.ix - b.ix);
      if (this.building && !this.pending.some(next => next.key === this.building.index)) { this.building.dispose(); this.building = null; }
      // The skyline fills in from the car outward, and is only drawn where the fog can show it
      this.distantPending.sort((a, b) => Math.hypot(a.ix - cell.ix, a.iz - cell.iz) - Math.hypot(b.ix - cell.ix, b.iz - cell.iz));
      for (const chunk of this.distant.values()) chunk.group.visible = !this.chunks.has(chunk.index) && Math.max(Math.abs(chunk.ix - cell.ix), Math.abs(chunk.iz - cell.iz)) <= radius + DISTANT_VISIBLE;
    }
    let built = 0;
    while (this.pending.length) {
      const next = this.pending[0], urgent = next.distance <= 1;
      if (!urgent && built > 0 && performance.now() >= deadline) break;
      if (!this.building || this.building.index !== next.key) { this.building?.dispose(); this.building = new CityChunk(this, next.ix, next.iz, false, true); }
      if (!this.building.buildUntil(urgent ? Infinity : deadline)) break;
      this.pending.shift();
      const chunk = this.building; this.building = null;
      chunk.group.position.set(chunk.east, 0, -chunk.start); chunk.group.updateMatrix();
      this.chunks.set(chunk.index, chunk); this.scene.add(chunk.group);
      const distant = this.distant.get(chunk.index); if (distant) distant.group.visible = false;
      built++;
    }
    while (this.distantPending.length && (!Number.isFinite(budgetMs) || performance.now() < deadline)) {
      const next = this.distantPending.shift();
      const chunk = new CityChunk(this, next.ix, next.iz, true);
      chunk.group.position.set(chunk.east, 0, -chunk.start); chunk.group.updateMatrix();
      chunk.group.visible = !this.chunks.has(next.key) && Math.max(Math.abs(chunk.ix - cell.ix), Math.abs(chunk.iz - cell.iz)) <= radius + DISTANT_VISIBLE;
      this.distantGroup.add(chunk.group); this.distant.set(next.key, chunk);
    }
  }
  setWetness(amount) {
    const wet = Math.max(0, Math.min(1, amount));
    if (wet === this.wetness) return;
    this.wetness = wet;
    this.materials.road.roughness = .6 - wet * .33;
    this.materials.road.color.copy(dryRoad).lerp(wetRoad, wet);
  }
  animate(time, signalTime = time, camera = null, contacts = null) {
    this.materials.water.userData.time.value = time;
    if (camera) {
      camera.updateMatrixWorld();
      this.animationMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.animationFrustum.setFromProjectionMatrix(this.animationMatrix);
    }
    for (const chunk of this.chunks.values()) {
      let visible = true;
      if (camera && chunk.peopleMesh) {
        this.animationSphere.copy(chunk.peopleMesh.boundingSphere);
        this.animationSphere.center.add(chunk.group.position);
        // Include residents whose shadows can fall into the visible area.
        this.animationSphere.radius += 12;
        visible = this.animationFrustum.intersectsSphere(this.animationSphere);
      }
      chunk.animate(time, signalTime, visible, contacts);
    }
  }
  warmupObjects() {
    return Object.entries(this.materials).filter(([key]) => key !== 'residents').map(([key, material]) => {
      if (key.startsWith('merged-') || key === 'ground' || key === 'water') return new THREE.Mesh(warmupMergedGeometry, material);
      const mesh = new THREE.InstancedMesh(boxGeometry, material, 1);
      mesh.setColorAt(0, tint.setRGB(1, 1, 1));
      return mesh;
    });
  }
  dispose() {
    for (const chunk of this.chunks.values()) chunk.dispose(); this.chunks.clear(); this.pending = [];
    this.building?.dispose(); this.building = null;
    for (const chunk of this.distant.values()) chunk.dispose(); this.distant.clear(); this.distantPending = [];
    this.distantGroup.removeFromParent();
    for (const mesh of this.staticGroup.children) mesh.geometry.dispose();
    this.staticGroup.removeFromParent();
    for (const material of Object.values(this.materials)) { material.map?.dispose(); material.dispose(); }
  }
}
