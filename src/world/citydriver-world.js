import * as THREE from 'three';
import { CITY, cityCell, CITY_CELL } from './city.js';
import { ROAD_LEVEL, PAVEMENT_LEVEL, WATER_LEVEL, roadAt, waterAt } from './city-route.js';
import { cityAssets, cityTrees, LANTERN_HEIGHT, SIGNAL_LENSES, MAST_HEIGHT, parkedCars, PARKED_PAINTS } from './city-assets.js';
import { TRAFFIC_MODELS } from '../traffic-models.js';
import { seededRandom, randomAt } from './route.js';
import { residentWindow } from './resident.js';
import { buildCityBuildingSteps } from './city-buildings.js';
import { createSignMaterial, discoverySignFor } from './city-signs.js';
import { cityItemMatrix, cityRigidFrame, cityAffinePoint, itemFrame } from './city-layout-render.js';
import { addSurfacePolygon, rectanglePolygon } from './city-surfaces.js';
import { buildGrassFringe } from './city-grass.js';
import { createWaterMaterial } from './city-water.js';
import { Surface } from './surface.js';
import { cityWalker, walkerFloat, WALKER_COLORS, createWalkerMaterial, walkerAppearance, setWalkerAppearance, pairWalkers, offsetWalkerPose } from './city-life.js';
import { applyWalkerHop, walkerTravelTime, holdWalkerTravel } from './pedestrian-reactions.js';
import { stableShadowDepth } from './shadow-depth.js';
import { navGraph } from './nav-graph.js';
import { cityGreen } from '../city-junctions.js';
import { signalLens, round } from './city-detail-assets.js';
import { buildMonument } from './city-monuments.js';
import { cityPlaces } from '../city-exploration.js';
import { basinRim, basinWater } from './city-public-space-geometry.js';
import { buildStreetSurfaces, placeStreetFurniture, findBridges } from './city-streets.js';
import { offsetPolygon, calcPolygonArea, averagePoint } from '../mapgen/polygon-util.js';

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
// A chunk bakes at most this many vertices in all: the cheapest groups merge
// first, so the draws saved come cheap and a busy street corner stays instanced.
const MERGE_INSTANCE_LIMIT = 32, MERGE_VERTEX_LIMIT = 6000, MERGE_CHUNK_VERTICES = 18000;
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
  const groups = new Map();
  for (const [batchKey, batch] of batches) {
    const key = batch.structure ? batchKey.slice('structure-'.length) : batchKey;
    if (!batch.items.length || !mergeable(key, batch)) continue;
    const flags = batchFlags(key, batch.material);
    const id = [batch.material.uuid, batch.structure, flags.castShadow, flags.receiveShadow, flags.ambientOcclusion].join();
    if (!groups.has(id)) groups.set(id, { flags, structure: batch.structure, keys: [], sizes: new Map(), vertices: 0 });
    const group = groups.get(id), vertices = batch.items.length * batch.geometry.attributes.position.count;
    group.keys.push(batchKey); group.sizes.set(batchKey, vertices); group.vertices += vertices;
  }
  // Only two or more batches together save a draw. Cheapest groups first; a
  // group too big for what is left merges its cheapest batches.
  const merges = new Map();
  let budget = MERGE_CHUNK_VERTICES;
  for (const [id, group] of [...groups].filter(([, group]) => group.keys.length > 1).sort((a, b) => a[1].vertices - b[1].vertices)) {
    const keys = [];
    let spent = 0;
    for (const key of group.keys.slice().sort((a, b) => group.sizes.get(a) - group.sizes.get(b))) {
      if (spent + group.sizes.get(key) > budget) break;
      keys.push(key); spent += group.sizes.get(key);
    }
    if (keys.length < 2) continue;
    budget -= spent; merges.set(id, { ...group, keys });
  }
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
    this.batches = new Map(); this.random = seededRandom(this.plan.seed); this.bodies = new Surface();
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
  // A double-sided board on two posts; yaw turns its face (see faceYaw)
  sign(sign, x, y, s, yaw, width = 6.1) {
    if (this.distant || !sign) return;
    const height = width / sign.aspect, ex = Math.cos(yaw), es = Math.sin(yaw);
    for (const facing of [yaw, yaw + Math.PI]) {
      this.item('sign-board', windowGeometry, this.materials.signs,
        [x + Math.sin(facing) * .08, y, -s + Math.cos(facing) * .08], [width, height, 1], '#ffffff', facing).signTile = sign.tile;
    }
    this.box(x, y, s, width + .16, height + .16, .1, '#3d4246', 'solid', yaw);
    for (const side of [-1, 1]) {
      const px = x + ex * side * width * .38, ps = s + es * side * width * .38, bottom = y - height / 2;
      this.box(px, (PAVEMENT_LEVEL + bottom) / 2, ps, .12, bottom - PAVEMENT_LEVEL, .12, '#3d4246', 'solid', yaw);
      this.post(px, ps, .1);
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
    this.item(name, cityAssets[name], this.materials.props, [x, y, -s], [1, 1, 1], '#ffffff', yaw, 0, ['shelter', 'tank', 'kiosk', 'bandstand'].includes(name));
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
      if (buildMonument(this, piece, x, s)) continue;
      if (piece.kind === 'lamp') { this.prop('lamp', x, s, piece.yaw); this.post(x, s, .25); }
      // Two lamps back to back on one column, an arm over each carriageway
      else if (piece.kind === 'median-lamp') { for (const yaw of [piece.yaw, piece.yaw + Math.PI]) this.prop('lamp', x, s, yaw); this.post(x, s, .25); }
      else if (piece.kind === 'tree') this.tree(x, s, piece.scale);
      else if (piece.kind === 'bench') { this.prop('bench', x, s, piece.yaw); this.rigid(x, s, () => this.solid(x, s, .7, 2), itemFrame(piece.s, piece.u, piece.yaw)); }
      else if (piece.kind === 'bin') { this.prop('bin', x, s); this.post(x, s, .36); }
      else if (piece.kind === 'bollard') { this.prop('bollard', x, s); this.post(x, s, .16); }
      else if (piece.kind === 'railing') { this.prop('railing', x, s, piece.yaw, piece.y ?? PAVEMENT_LEVEL); this.rigid(x, s, () => this.solid(x, s, .24, 4), itemFrame(piece.s, piece.u, piece.yaw)); }
      else if (piece.kind === 'sign') this.sign(discoverySignFor(piece.type, piece.variant), x, PAVEMENT_LEVEL + 2.9, s, piece.yaw, 4.2);
      else if (piece.kind === 'stop') { this.prop('stop', x, s, piece.yaw); this.post(x, s, .12); }
      else if (piece.kind === 'signal') {
        const yaw = piece.yaw, cos = Math.cos(yaw), sin = Math.sin(yaw);
        // A head `along` metres out along local -x from the pole, its middle lamp `height` up
        const head = (along, height) => {
          if (this.distant) return;
          const hx = x - along * cos, hs = s - along * sin, indices = [];
          for (const dy of SIGNAL_LENSES) {
            this.item('signal-lens', signalLens, this.materials.lit, [hx + sin * .215, PAVEMENT_LEVEL + height + dy, -hs + cos * .215], [.105, .105, 1], '#293538', yaw);
            indices.push(this.batches.get('signal-lens').items.length - 1);
          }
          this.features.signals.push({ axis: piece.axis, indices });
        };
        if (piece.mast) {
          // A tall pole with its arm out over the lanes and a head above each
          const length = Math.max(...piece.mast) + .6;
          this.prop('signal-mast', x, s, yaw);
          if (!this.distant) this.box(x - length / 2 * cos, PAVEMENT_LEVEL + MAST_HEIGHT - .2, s - length / 2 * sin, length, .2, .2, '#3d4246', 'solid', yaw);
          for (const along of piece.mast) {
            if (!this.distant) this.item('signal-head', cityAssets['signal-head'], this.materials.props, [x - along * cos, PAVEMENT_LEVEL + MAST_HEIGHT - .95, -(s - along * sin)], [1, 1, 1], '#ffffff', yaw);
            head(along, MAST_HEIGHT - .95);
          }
          this.post(x, s, .3);
        } else {
          this.prop('signal', x, s, yaw); this.post(x, s, .15);
          head(0, 4.6);
        }
      }
      else if (piece.kind === 'shelter') { this.prop('shelter', x, s, piece.yaw); this.rigid(x, s, () => this.solid(x + .5, s, .6, 4), itemFrame(piece.s, piece.u, piece.yaw)); }
      else if (piece.kind === 'fountain') {
        // A round basin with a column in it carrying a bowl of water, and in
        // a big square's fountain a smaller bowl above that, and a finial
        const k = piece.size ?? 1, stone = '#d7ccb3', water = '#4f93a0', bowl = Math.min(2, .8 + .5 * k);
        this.item('basin-rim', basinRim, this.materials.solid, [x, PAVEMENT_LEVEL + .4, -s], [3.4 * k, .8, 3.4 * k], stone);
        this.item('basin-water', basinWater, this.materials.glass, [x, PAVEMENT_LEVEL + .62, -s], [3.2 * k, 1, 3.2 * k], water);
        round(this, x, PAVEMENT_LEVEL + 1.1, s, .6, 1.6, .6, stone);
        round(this, x, PAVEMENT_LEVEL + 1.95, s, bowl * 2, .3, bowl * 2, stone);
        round(this, x, PAVEMENT_LEVEL + 2.1, s, bowl * 1.8, .04, bowl * 1.8, water, 'y', 'glass');
        let top = PAVEMENT_LEVEL + 2.1;
        if (k > 1.3) {
          round(this, x, PAVEMENT_LEVEL + 2.7, s, .38, 1.2, .38, stone);
          round(this, x, PAVEMENT_LEVEL + 3.35, s, bowl, .24, bowl, stone);
          round(this, x, PAVEMENT_LEVEL + 3.47, s, bowl * .86, .04, bowl * .86, water, 'y', 'glass');
          top = PAVEMENT_LEVEL + 3.47;
        }
        round(this, x, top + .35, s, .24, .7, .24, stone);
        this.post(x, s, 3.5 * k);
      }
      else if (piece.kind === 'lantern') { this.prop('lantern', x, s); this.post(x, s, .2); }
      else if (piece.kind === 'parked') {
        const model = parkedCars[piece.model], spec = TRAFFIC_MODELS.find(m => m.name === piece.model);
        if (!this.distant) {
          this.item(`parked-paint-${piece.model}`, model.paint, this.materials.solid, [x, ROAD_LEVEL + .13, -s], [1, 1, 1], PARKED_PAINTS[piece.colour % PARKED_PAINTS.length], piece.yaw);
          this.item(`parked-trim-${piece.model}`, model.trim, this.materials.props, [x, ROAD_LEVEL + .13, -s], [1, 1, 1], '#ffffff', piece.yaw);
        }
        this.rigid(x, s, () => this.solid(x, s, spec.width, spec.length), itemFrame(piece.s, piece.u, piece.yaw));
      }
      else if (piece.kind === 'bandstand') { this.prop('bandstand', x, s, piece.yaw); this.post(x, s, 5.4); }
      else if (piece.kind === 'rim') this.post(x, s, piece.radius);
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
    // Street lamps light the road below their heads, lanterns the walk round them
    const lights = (key, head, drop) => (this.batches.get(key)?.items ?? []).map(item => {
      const matrix = cityItemMatrix(item, this.east, this.start, transform.matrix);
      const point = head.clone().applyMatrix4(matrix);
      return { kind: key, x: point.x + this.east, y: point.y, z: point.z - this.start, ground: point.y - drop, yaw: Math.atan2(matrix.elements[8], matrix.elements[10]) };
    });
    this.features.lamps = [...lights('lamp', new THREE.Vector3(-1.75, 7.36, 0), 7.36), ...lights('lantern', new THREE.Vector3(0, LANTERN_HEIGHT, 0), LANTERN_HEIGHT)];
    // The cell's building bodies are one flat-shaded mesh
    if (!this.bodies.empty) {
      const mesh = new THREE.Mesh(this.bodies.build(), this.materials['merged-solid']);
      mesh.name = 'citydriver-bodies'; mesh.userData.bodies = true; mesh.dispose = () => mesh.geometry.dispose();
      this.group.add(finishBatchMesh(mesh, { castShadow: true, receiveShadow: true, ambientOcclusion: true }, true));
    }
    this.bodies = null;
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
    this.prepareLots(); this.bridges = findBridges(); this.placeFurniture();
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
      if (block.kerb.length < 3) return;
      const points = offsetPolygon(block.kerb, -1.5);
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
      const lot = { polygon, index, block: CITY.lotBlocks?.[index] ?? -1, edges: CITY.lotEdges?.[index] ?? null, depth: CITY.lotDepths?.[index] ?? 0, centre, area, seed: Math.floor(randomAt(Math.round(centre.x), Math.round(centre.y) + 7102, CITY.seed) * 0xffffffff) >>> 0 };
      if (!this.lotsByChunk.has(cell.key)) this.lotsByChunk.set(cell.key, []);
      this.lotsByChunk.get(cell.key).push(lot);
    });
    // A venue with a block to itself is built as one lot, the whole block
    for (const place of cityPlaces()) {
      if (place.block === undefined) continue;
      const polygon = place.polygon, centre = { x: place.u, y: place.s }, cell = cityCell(place.s, place.u);
      const lot = { polygon, block: place.block, edges: null, depth: 0, centre, area: calcPolygonArea(polygon), place, seed: Math.floor(randomAt(Math.round(centre.x), Math.round(centre.y) + 7104, CITY.seed) * 0xffffffff) >>> 0 };
      if (!this.lotsByChunk.has(cell.key)) this.lotsByChunk.set(cell.key, []);
      this.lotsByChunk.get(cell.key).push(lot);
    }
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
  // Lamps, trees, signs and signals, railings and the parks' trees and
  // benches: placed once (see city-streets.js) and handed to whichever chunk
  // they fall in.
  placeFurniture() {
    this.furnitureByChunk = new Map();
    placeStreetFurniture(this.nav, this.bridges, piece => {
      const key = cityCell(piece.s, piece.u).key;
      if (!this.furnitureByChunk.has(key)) this.furnitureByChunk.set(key, []);
      this.furnitureByChunk.get(key).push(piece);
    });
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
    buildStreetSurfaces({ ground, roads, paths, water, walls }, this.nav, this.bridges);
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
    for (const mesh of this.staticGroup.children) if (!mesh.isInstancedMesh) mesh.geometry.dispose(); else mesh.dispose();
    this.staticGroup.removeFromParent();
    for (const material of Object.values(this.materials)) { material.map?.dispose(); material.dispose(); }
  }
}
