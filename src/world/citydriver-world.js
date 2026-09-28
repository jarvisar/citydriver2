import * as THREE from 'three';
import { CITY, cityCell, CITY_CELL, cityStyleDistrict } from './city.js';
import { ROAD_LEVEL, PAVEMENT_LEVEL, WATER_LEVEL } from './city-route.js';
import { HarbourBoats } from './city-boats.js';
import { cityAssets, cityTrees, looseTree, twinLamp, signalMastPiece, LANTERN_HEIGHT, SIGNAL_LENSES, MAST_HEIGHT, parkedCars, PARKED_PAINTS, boatModels } from './city-assets.js';
import { TRAFFIC_MODELS } from '../traffic-models.js';
import { seededRandom, randomAt } from './route.js';
import { residentWindow } from './resident.js';
import { buildCityBuildingSteps } from './city-buildings.js';
import { createSignMaterials, discoverySignFor, signCore } from './city-signs.js';
import { cityItemMatrix, cityRigidFrame, cityAffinePoint, itemFrame } from './city-layout-render.js';
import { addSurfacePolygon, faceSlabEdges } from './city-surfaces.js';
import { buildGrassFringeSteps, grassGeometry, MAX_LAWN_TUFTS } from './city-grass.js';
import { createWaterMaterial } from './city-water.js';
import { Surface, setColor } from './surface.js';
import { cityWalker, walkerFloat, WALKER_COLORS, createWalkerMaterial, createWalkerAlert, addWalkerAlert, walkerAppearance, setWalkerAppearance, setWalkerTurn, pairWalkers, offsetWalkerPose } from './city-life.js';
import { walkedAt, paceAt, standing, rejoinWalk, stopWalkers, regroupWalkers, lookYaw, lean, glance } from './pedestrian-reactions.js';
import { stableShadowDepth } from './shadow-depth.js';
import { navGraph } from './nav-graph.js';
import { cityGreen } from '../city-junctions.js';
import { signalLens, round } from './city-detail-assets.js';
import { buildMonument } from './city-monuments.js';
import { cityPlaces } from '../city-exploration.js';
import { basinRim, basinWater } from './city-public-space-geometry.js';
import { buildStreetSurfaces, placeStreetFurniture, findBridges, PARAPET } from './city-streets.js';
import { offsetPolygon, calcPolygonArea, averagePoint } from '../mapgen/polygon-util.js';

const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const windowGeometry = new THREE.PlaneGeometry(1, 1);
const warmupMergedGeometry = new THREE.BufferGeometry();
for (const name of ['position', 'normal', 'color']) warmupMergedGeometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(9), 3));
const transform = new THREE.Object3D();
const residentItem = { p: [0, 0, 0], scale: [1, 1, 1], yaw: 0, roll: 0 }, watching = { x: 0, z: 0, set(x, z) { this.x = x; this.z = z; return this; } };
const residentFloat = {};
// How far either side of a corner of their walk a resident turns through it (m)
const WALKER_TURN = 1.2;
// How far a resident can end up from their walk, shoved or knocked flying (m)
const WALKERS_STRAY = 40;
const tint = new THREE.Color();
// A structure's batch key, made once for each (a key made afresh for every
// window of every building is hashed afresh by every lookup)
const structureKeys = new Map();
const structureKey = key => { let made = structureKeys.get(key); if (made === undefined) structureKeys.set(key, made = `structure-${key}`); return made; };
const dryRoad = new THREE.Color('#666c70'), wetRoad = new THREE.Color('#424e58');
// A lit room seen by day is only a warmer pane among the dark ones; the
// window's own cream shows as the light fails (see city-weather.js)
const dayWindow = new THREE.Color().setRGB(.023, .032, .057), nightWindow = new THREE.Color(1, 1, 1);
const GREENS = ['#63924d', '#80a85c', '#4f8054', '#93ab65'];
const SIGNAL_GREEN = new THREE.Color('#62d996'), SIGNAL_AMBER = new THREE.Color('#ffd571'), SIGNAL_RED = new THREE.Color('#ed654b'), SIGNAL_OFF = new THREE.Color('#293538');
// Distant chunks further than this many cells from the car are not drawn at all.
const DISTANT_VISIBLE = 4;
// A detailed chunk this near the car is built at once, whatever the frame
// budget: a venue's grounds put colliders up to ~65 m beyond their own cell.
// The ring a car crosses into starts a whole cell away, so there is time to
// build it over several frames before it gets this close.
const URGENT_REACH = 80;
// The static streets are cut into tiles this size, so the renderer can leave
// out the tiles off screen instead of drawing the whole island every frame.
const STATIC_TILE = CITY_CELL * 3;
const pick = (items, random) => items[Math.floor(random() * items.length)];
const cullFrustum = new THREE.Frustum(), cullMatrix = new THREE.Matrix4(), cullSphere = new THREE.Sphere(), meshSphere = new THREE.Sphere(), walkPoint = new THREE.Vector3();
// Chunks and the static streets never move once placed (the world is never
// rebased), so the renderer's per-frame matrix walk skips them unless placing
// them flagged an update. That's hundreds of meshes a frame, mostly in skyline
// chunks hidden by fog.
function settledMatrixWorld(force) {
  if (force || this.matrixWorldNeedsUpdate) THREE.Object3D.prototype.updateMatrixWorld.call(this, force);
}
// A sphere round every mesh of a finished chunk, in the chunk's own frame;
// null if one of them is never culled
function chunkBounds(group) {
  const bounds = new THREE.Sphere();
  for (const mesh of group.children) {
    const sphere = mesh.isInstancedMesh ? mesh.boundingSphere : mesh.geometry?.boundingSphere;
    if (mesh.frustumCulled === false || !sphere) return null;
    bounds.union(meshSphere.copy(sphere).applyMatrix4(mesh.matrix));
  }
  return bounds;
}

// How much of its own colour a sign gives off at full night
const SIGN_GLOW = .85;
// Window panes never cast, they lie flat on their walls. In a skyline chunk only
// buildings cast. It's at least a cell from the car, and a tree's shadow (30 m at
// the lowest sun) can't reach the area the sun's map covers (140 m at most),
// while a tower's evening shadow can.
function batchFlags(key, material, distant = false) {
  const flags = {
    castShadow: !key.startsWith('surface-') && !key.startsWith('public-water') && !['road', 'water', 'lit', 'signal-lens', 'detail-clock', 'glass', 'grass-fringe', 'distant-glass', 'distant-lit'].includes(key)
      && !(distant && key.startsWith('tree-')),
    receiveShadow: !['lit', 'signal-lens', 'detail-clock'].includes(key), ambientOcclusion: true,
  };
  // (signs take the shade of what stands round them, but cast none, and
  // keep out of the AO prepass, which would see their whole rectangles)
  if (material.userData.signAtlas) flags.castShadow = flags.ambientOcclusion = false;
  if (key === 'water' || key === 'grass-fringe') flags.ambientOcclusion = false;
  return flags;
}
// At low shadow detail (see QUALITY_LEVELS' shadowDetail) only buildings,
// trees, vehicles and tall posts cast (a street lamp's or a signal mast's
// evening shadow crosses the road). People and short street furniture keep
// out of the shadow pass, and so does facade trim: frames, sills, ledges,
// pilasters and courses, nine in ten of a building's boxes and most of the
// pass's triangles, for shadows a texel or two wide. A box casts if it is
// 30 cm or more every way (a cornice, a chimney, a column) or a slab 60 cm
// deep (a balcony). A mesh keeps what always casts first and the pass draws
// only that much of it (`shadowFrom`: its instances, or a merged mesh's
// indices), so no split costs another draw; one with nothing before that
// point stops casting.
const SMALL_CASTERS = new Set(['residents', 'lantern', 'bin', 'bollard', 'railing', 'signal', 'signal-head', 'stop', 'yield', 'parking-sign', 'mooring-line']);
const smallCaster = key => SMALL_CASTERS.has(key) || key.startsWith('square-flowers-');
const facadeTrim = ({ scale: [x, y, z] }) => Math.min(x, y, z) < .3 && Math.min(x, z) < .6;
function castFirst() {
  if (!this.userData.lowShadow) return;
  if (this.isInstancedMesh) { this.userData.drawn = this.count; this.count = Math.min(this.count, this.userData.shadowFrom); }
  else { this.userData.drawn = this.geometry.drawRange.count; this.geometry.drawRange.count = this.userData.shadowFrom; }
}
function castAll() {
  if (this.userData.drawn === undefined) return;
  if (this.isInstancedMesh) this.count = this.userData.drawn; else this.geometry.drawRange.count = this.userData.drawn;
  this.userData.drawn = undefined;
}
function castFrom(mesh, from) {
  if (from === undefined) return;
  mesh.userData.shadowFrom = from;
  if (from > 0) { mesh.onBeforeShadow = castFirst; mesh.onAfterShadow = castAll; }
}
function applyShadowDetail(group, full) {
  for (const mesh of group.children) {
    const from = mesh.userData.shadowFrom;
    if (from === 0) mesh.castShadow = full;
    else if (from !== undefined) mesh.userData.lowShadow = !full;
  }
}
function finishBatchMesh(mesh, { castShadow, receiveShadow, ambientOcclusion }, structure) {
  mesh.renderOrder = structure ? -2 : 0;
  mesh.castShadow = castShadow; mesh.receiveShadow = receiveShadow;
  if (!ambientOcclusion) mesh.userData.ambientOcclusion = false;
  stableShadowDepth(mesh);
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  if (mesh.isInstancedMesh) mesh.computeBoundingSphere();
  // (a surface's geometry comes with its sphere)
  else if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  return mesh;
}

// Small batches that share a material draw as one merged mesh per chunk,
// with each instance's transform and colour baked into the vertices; big
// batches stay instanced. A chunk bakes at most this many vertices in all:
// the cheapest groups merge first, so the draws saved come cheap and a busy
// street corner stays instanced.
const MERGE_INSTANCE_LIMIT = 32, MERGE_VERTEX_LIMIT = 6000, MERGE_CHUNK_VERTICES = 18000;
const LIVE_BATCHES = new Set(['residents', 'signal-lens', 'water']);
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
function* mergeBatchSteps(entries, east, start, small = () => false) {
  // (what casts at low shadow detail first: see smallCaster)
  entries = [...entries.filter(([key]) => !small(key)), ...entries.filter(([key]) => small(key))];
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
  const record = {}, wakeable = [];
  let shadowFrom;
  for (const [batchKey, { geometry, items }] of entries) {
    if (shadowFrom === undefined && small(batchKey)) shadowFrom = next;
    const matrices = record[batchKey] = new Float32Array(items.length * 16);
    const count = geometry.attributes.position.count, source = geometry.index?.array;
    const p = vectors(geometry.attributes.position), n = vectors(geometry.attributes.normal), c = vectors(geometry.attributes.color);
    for (let k = 0; k < items.length; k++) {
      const item = items[k], matrix = cityItemMatrix(item, east, start, transform.matrix);
      matrix.toArray(matrices, k * 16);
      const [e0, e1, e2, , e4, e5, e6, , e8, e9, e10, , e12, e13, e14] = matrix.elements.map(f);
      const sx = e0 * e0 + e1 * e1 + e2 * e2, sy = e4 * e4 + e5 * e5 + e6 * e6, sz = e8 * e8 + e9 * e9 + e10 * e10;
      setColor(tint, item.color);
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
      if (item.wakeable) wakeable.push(item.render = { start: vertex, count });
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
  castFrom(mesh, shadowFrom);
  for (const render of wakeable) render.mesh = mesh;
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
function* renderBatchSteps(group, batches, east = 0, start = 0, distant = false) {
  const groups = new Map();
  for (const [batchKey, batch] of batches) {
    const key = batch.structure ? batchKey.slice('structure-'.length) : batchKey;
    if (!batch.items.length || !mergeable(key, batch)) continue;
    const flags = batchFlags(key, batch.material, distant);
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
  for (const [batchKey, { geometry, material, items: built, structure }] of batches) {
    const key = structure ? batchKey.slice('structure-'.length) : batchKey;
    if (!built.length || merged.has(batchKey)) continue;
    // (a building's trim last: see facadeTrim)
    const items = batchKey === 'structure-solid' ? [...built.filter(item => !facadeTrim(item)), ...built.filter(facadeTrim)] : built;
    const mesh = new THREE.InstancedMesh(geometry, material, items.length); mesh.name = `citydriver-${batchKey}`;
    for (let i = 0; i < items.length; i++) {
      // (a big batch, such as a block's window frames, spans several steps)
      if (i && i % 500 === 0) yield;
      const item = items[i];
      const matrix = cityItemMatrix(item, east, start, transform.matrix);
      mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, setColor(tint, item.color));
      if (item.wakeable) item.render = { mesh, index: i };
      if (item.signTile !== undefined) mesh.setColorAt(i, tint.setRGB(...item.signTile));
      if (key === 'residents') setWalkerAppearance(mesh, i, item.appearance);
    }
    const flags = batchFlags(key, material, distant);
    finishBatchMesh(mesh, flags, structure);
    if (flags.castShadow) {
      const trimFrom = items === built ? -1 : items.findIndex(facadeTrim);
      castFrom(mesh, smallCaster(key) ? 0 : trimFrom === -1 ? undefined : trimFrom);
    }
    group.add(mesh);
    yield;
  }
  const small = batchKey => smallCaster(batchKey.startsWith('structure-') ? batchKey.slice('structure-'.length) : batchKey);
  for (const { keys, flags, structure } of merges.values()) {
    const mesh = yield* mergeBatchSteps(keys.map(key => [key, batches.get(key)]), east, start, flags.castShadow ? small : undefined);
    group.add(finishBatchMesh(mesh, flags, structure));
    yield;
  }
}

// A parked car knocked loose leaves its bay empty: its instance, or its stretch
// of a merged mesh, is folded to a point until it is put back.
const folded = new THREE.Matrix4().makeScale(0, 0, 0);
function hideItem(item, hidden) {
  const render = item.render;
  if (!render || Boolean(render.hidden) === hidden) return;
  render.hidden = hidden;
  if (render.mesh.isInstancedMesh) {
    render.saved ??= render.mesh.getMatrixAt(render.index, new THREE.Matrix4());
    render.mesh.setMatrixAt(render.index, hidden ? folded : render.saved);
    render.mesh.instanceMatrix.needsUpdate = true;
    return;
  }
  const position = render.mesh.geometry.attributes.position, from = render.start * 3, to = (render.start + render.count) * 3;
  render.saved ??= position.array.slice(from, to);
  if (hidden) for (let i = from; i < to; i += 3) position.array.set(render.saved.subarray(0, 3), i);
  else position.array.set(render.saved, from);
  position.addUpdateRange(from, to - from); position.needsUpdate = true;
}

function resources() {
  const standard = options => new THREE.MeshStandardMaterial({ roughness: .9, flatShading: true, ...options });
  const result = {
    solid: standard({ color: '#ffffff' }),
    road: standard({ color: '#666c70', roughness: .6 }),
    glass: standard({ color: '#ffffff', roughness: .2, metalness: .25 }),
    lit: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
    lens: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
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
  ({ signs: result.signs, edges: result.signEdges } = createSignMaterials());
  return result;
}

// A cell of the city: the lots and street furniture inside it, built either
// in full detail or as the distant skyline. Its item/box/solid calls are the
// placement API the buildings (city-buildings.js) build with.
export class CityChunk {
  constructor(world, ix, iz, distant = false, deferred = false) {
    this.world = world; this.ix = ix; this.iz = iz; this.start = iz * CITY_CELL; this.east = ix * CITY_CELL;
    this.index = `${ix},${iz}`; this.materials = world.materials; this.distant = distant;
    this.plan = { seed: Math.floor(randomAt(ix, iz + 7102, CITY.seed) * 0xffffffff) >>> 0, kind: 'blocks', ix, iz };
    this.group = new THREE.Group(); this.group.name = `citydriver-block-${this.index}`; this.group.updateMatrixWorld = settledMatrixWorld;
    this.features = { colliders: [], bridges: [], buildings: [], discoveries: [], medians: [], junctions: [], signals: [], lamps: [] };
    this.batches = new Map(); this.bodies = new Surface();
    this.lots = world.lotsByChunk.get(this.index) ?? [];
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
    yield* this.furnitureSteps(); yield;
    this.buildLife(); yield;
    this.mapFeatures(); yield;
    yield* buildGrassFringeSteps(this); yield;
    yield* this.finishSteps();
    this.surfacePoints = null; this.surfaceLayers = null;
  }
  layoutFrame(s, u) { return cityRigidFrame(s, u); }
  item(key, geometry, material, p, scale = [1, 1, 1], color = '#ffffff', yaw = 0, roll = 0, structure = this.buildingStructure === true) {
    if (structure) key = structureKey(key);
    let batch = this.batches.get(key);
    if (!batch) this.batches.set(key, batch = { geometry, material, items: [], structure });
    const anchor = this.layoutAnchor ?? { s: this.start - p[2], u: this.east + p[0] };
    const item = { p, scale, color, yaw, roll, anchor, frame: this.layoutPlacement ?? this.layoutFrame(anchor.s, anchor.u) };
    batch.items.push(item);
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
  // A building's footprint; `top` (its roof's height) makes it something the
  // chase camera cannot see through (see sightLine). A pitched roof sets
  // `ridge` on what this returns, which the helicopter lands on.
  polygonSolid(points, top) {
    if (this.distant) return null;
    const solid = { logicalPolygon: points.map(([x, s]) => [this.east + x, this.start + s]), top };
    this.features.colliders.push(solid);
    return solid;
  }
  box(x, y, s, width, height, depth, color, kind = 'solid', yaw = 0, roll = 0) {
    return this.item(kind, boxGeometry, this.materials[kind], [x, y, -s], [width, height, depth], color, yaw, roll);
  }
  // A sign's painted face centred at (x, y, s), looking along its yaw (see
  // faceYaw), with its board `back` metres behind it: the sign's own
  // silhouette a `border` wider all round, so the board is the sign's shape
  signFace(key, sign, x, y, s, yaw, width, height, back = .05, border = .09) {
    if (this.distant || !sign) return;
    const nx = Math.sin(yaw), ns = -Math.cos(yaw);
    this.item(key, windowGeometry, this.materials.signs, [x, y, -s], [width, height, 1], '#ffffff', yaw).signTile = sign.tint;
    if (back !== null) this.item('sign-edge', windowGeometry, this.materials.signEdges, [x - nx * back, y, -(s - ns * back)], [width + 2 * border, height + 2 * border, 1], '#ffffff', yaw).signTile = sign.tint;
  }
  // A board painted on both faces, `gap` metres either side of its middle,
  // the dark silhouette between them: the first face looks along the yaw
  doubleSign(key, sign, x, y, s, yaw, width, height, gap = .045, border = .09) {
    if (this.distant || !sign) return;
    const nx = Math.sin(yaw), ns = -Math.cos(yaw);
    for (const side of [1, -1]) this.signFace(key, sign, x + nx * side * gap, y, s + ns * side * gap, side > 0 ? yaw : yaw + Math.PI, width, height, null);
    this.item('sign-edge', windowGeometry, this.materials.signEdges, [x, y, -s], [width + 2 * border, height + 2 * border, 1], '#ffffff', yaw).signTile = sign.tint;
  }
  // A free-standing board, painted on both faces, its bottom `bottom` above
  // the ground, on two posts or (`plinth`) a stone base: the posts and the
  // board's core run up behind the faces, wherever the sign's outline is
  standingSign(sign, x, s, yaw, width = 4.2, bottom = 1.9, plinth = null) {
    if (this.distant || !sign) return;
    const height = width / sign.aspect, y = PAVEMENT_LEVEL + bottom + height / 2, ex = Math.cos(yaw), es = Math.sin(yaw);
    this.doubleSign('sign-board', sign, x, y, s, yaw, width, height);
    const core = signCore(sign, width, height);
    this.box(x, y + core.y, s, core.width, core.height, .07, '#2f3538', 'solid', yaw);
    if (plinth) {
      // (a dark stem from the plinth up behind the board)
      const top = PAVEMENT_LEVEL + plinth.height, stem = y + core.y - top;
      this.box(x, top + stem / 2, s, core.width * .5, stem, .07, '#2f3538', 'solid', yaw);
      return;
    }
    for (const side of [-1, 1]) {
      const along = side * Math.min(width * .38, core.width / 2 - .08), px = x + ex * along, ps = s + es * along, top = y + core.y;
      // Both faces are only .09 m apart: a square .12 m post would poke
      // through their lettering. Flat posts stay inside the board's core.
      this.box(px, (PAVEMENT_LEVEL + top) / 2, ps, .12, top - PAVEMENT_LEVEL, .06, '#3d4246', 'solid', yaw);
      this.post(px, ps, .1);
    }
  }
  // (always inside rigid, which places it)
  solid(x, s, width, depth) {
    if (this.distant) return;
    this.features.colliders.push({
      x: this.east + x, z: -this.start - s,
      heading: 0, halfWidth: width / 2, halfLength: depth / 2, reach: Math.hypot(width, depth) / 2, anchor: this.layoutAnchor, frame: this.layoutPlacement,
    });
  }
  post(x, s, radius) { if (!this.distant) this.features.colliders.push({ x: this.east + x, z: -this.start - s, reach: radius, anchor: this.layoutAnchor, frame: this.layoutPlacement }); }
  prop(name, x, s, yaw = 0, y = PAVEMENT_LEVEL, scale = [1, 1, 1]) {
    if (this.distant) return null;
    return this.item(name, cityAssets[name], this.materials.props, [x, y, -s], scale, '#ffffff', yaw, 0, ['shelter', 'tank', 'kiosk', 'bandstand'].includes(name));
  }
  // The furniture just given a collider can be knocked loose (see
  // LooseProps): the pieces that come away, each a kind, a model and where it
  // stands in the first item's frame, and the items hidden while it is loose.
  // A lamp's light goes out with it (see NightLighting).
  knockable(items, pieces) {
    if (this.distant) return;
    const world = this.world, east = this.east, start = this.start;
    for (const item of items) item.wakeable = true;
    this.features.colliders.at(-1).prop = {
      items, pieces,
      matrix(target) {
        cityItemMatrix(items[0], east, start, target);
        target.elements[12] += east; target.elements[14] -= start;
        return target;
      },
      get ready() { return items.every(item => item.render?.mesh); },
      hide(hidden = true) { for (const item of items) hideItem(item, hidden); world.lampRevision++; },
    };
  }
  tree(x, s, scale = 7) {
    // An address owns its tree: extra garden trees in a detailed chunk must
    // not change the street trees when the distant model hands over to it.
    const random = seededRandom(Math.floor(randomAt(Math.round((this.east + x) * 10), Math.round((this.start + s) * 10), CITY.seed) * 0xffffffff));
    const index = random() < .28 ? 1 : 0, variant = cityTrees[index], p = [x, PAVEMENT_LEVEL, -s];
    const width = scale * (.82 + random() * .24), size = [width, scale, width], colour = pick(GREENS, random), yaw = random() * Math.PI * 2;
    if (this.distant) this.box(x, PAVEMENT_LEVEL + scale * .24, s, width * .085, scale * .48, width * .085, '#625548', 'solid', yaw);
    const trunk = this.distant ? null : this.item(`tree-trunks-${index}`, variant.bark, this.materials.bark, p, size, '#ffffff', yaw);
    const crown = this.item(`tree-crowns-${index}`, variant.leaves, this.materials.leaves, p, size, colour, yaw);
    this.features.trees ??= [];
    this.features.trees.push({ x, s, scale });
    this.post(x, s, .28);
    this.knockable([trunk, crown], [{ kind: 'tree', get geometry() { return looseTree(index, colour); } }]);
  }
  // A busy street's furniture, a few dozen pieces per step of a streamed build
  *furnitureSteps() {
    // (a cell with more lawn fringe than its budget keeps it evenly thinned)
    const tint = new THREE.Color(), fringe = this.furniture.reduce((n, piece) => n + (piece.kind === 'grass'), 0);
    const keep = Math.min(1, MAX_LAWN_TUFTS / Math.max(1, fringe));
    let tufts = 0;
    for (const [index, piece] of this.furniture.entries()) {
      if (index && index % 40 === 0) yield;
      const x = piece.u - this.east, s = piece.s - this.start;
      if (buildMonument(this, piece, x, s)) continue;
      // Posts, signs, bins, benches and mast signals can be knocked loose,
      // trees and shelters only by a car that breaks them (see LooseProps).
      // Railings stand firm
      if (piece.kind === 'lamp') { const lamp = this.prop('lamp', x, s, piece.yaw); this.post(x, s, .25); this.knockable([lamp], [{ kind: 'lamp', geometry: cityAssets.lamp }]); }
      // Two lamps back to back on one column, an arm over each carriageway
      else if (piece.kind === 'median-lamp') {
        const lamps = [piece.yaw, piece.yaw + Math.PI].map(yaw => this.prop('lamp', x, s, yaw));
        this.post(x, s, .25); this.knockable(lamps, [{ kind: 'lamp', geometry: twinLamp }]);
      }
      else if (piece.kind === 'tree') {
        this.tree(x, s, piece.scale);
        if (piece.pit && !this.distant) {
          const rim = piece.pit.map(p => ({ x: p.x - this.east, y: p.y - this.start })), soil = offsetPolygon(rim, -.12);
          if (soil.length >= 3) {
            const level = piece.pitLevel ?? PAVEMENT_LEVEL + .014;
            this.bodies.polygon(rim, level, '#989b8b', null, true, [soil]);
            this.bodies.polygon(soil, level, '#75664e');
          }
        }
      }
      else if (piece.kind === 'bench') {
        const bench = this.prop('bench', x, s, piece.yaw);
        this.rigid(x, s, () => this.solid(x, s, .7, 2), itemFrame(piece.s, piece.u, piece.yaw));
        this.knockable([bench], [{ kind: 'bench', geometry: cityAssets.bench }]);
      }
      else if (piece.kind === 'bin') { const bin = this.prop('bin', x, s); this.post(x, s, .36); this.knockable([bin], [{ kind: 'bin', geometry: cityAssets.bin }]); }
      else if (piece.kind === 'bollard') { this.prop('bollard', x, s); this.post(x, s, .16); }
      else if (piece.kind === 'railing') {
        // (a quay's lengths are all four metres; a bridge's are fitted between its posts)
        const length = piece.length ?? 4;
        // (and a bridge's parapet, drawn with the streets, only stops the car)
        if (!piece.parapet) this.prop('railing', x, s, piece.yaw, piece.y ?? PAVEMENT_LEVEL, [1, 1, length / 4]);
        this.rigid(x, s, () => this.solid(x, s, piece.parapet ? PARAPET : .24, length), itemFrame(piece.s, piece.u, piece.yaw));
      }
      else if (piece.kind === 'sign') this.standingSign(discoverySignFor(piece.type, piece.variant), x, s, piece.yaw, piece.width ?? 4.2, piece.bottom ?? 1.9);
      else if (piece.kind === 'stop' || piece.kind === 'yield') {
        const sign = this.prop(piece.kind, x, s, piece.yaw); this.post(x, s, .12);
        this.knockable([sign], [{ kind: 'sign', geometry: cityAssets[piece.kind] }]);
      }
      // A blue P on a post, read from along the street both ways (yaw lays
      // the panel across the pavement)
      else if (piece.kind === 'parking-sign') {
        const sign = this.prop('parking-sign', x, s, piece.yaw); this.post(x, s, .1);
        this.knockable([sign], [{ kind: 'sign', geometry: cityAssets['parking-sign'] }]);
      }
      else if (piece.kind === 'signal') {
        const yaw = piece.yaw, cos = Math.cos(yaw), sin = Math.sin(yaw);
        // A head `along` metres out along local -x from the pole, its middle lamp `height` up
        const head = (along, height) => {
          if (this.distant) return [];
          const hx = x - along * cos, hs = s - along * sin, indices = [], lenses = [];
          for (const dy of SIGNAL_LENSES) {
            lenses.push(this.item('signal-lens', signalLens, this.materials.lens, [hx + sin * .215, PAVEMENT_LEVEL + height + dy, -hs + cos * .215], [.105, .105, 1], '#293538', yaw));
            indices.push(this.batches.get('signal-lens').items.length - 1);
          }
          this.features.signals.push({ axis: piece.axis, indices });
          return lenses;
        };
        if (piece.mast) {
          // A tall pole with its arm out over the lanes and a head above each,
          // which comes down all together, dark (see signalMastPiece)
          const length = Math.max(...piece.mast) + .6, mast = piece.mast, items = [this.prop('signal-mast', x, s, yaw)];
          if (!this.distant) items.push(this.box(x - length / 2 * cos, PAVEMENT_LEVEL + MAST_HEIGHT - .2, s - length / 2 * sin, length, .2, .2, '#3d4246', 'solid', yaw));
          for (const along of mast) {
            if (!this.distant) items.push(this.item('signal-head', cityAssets['signal-head'], this.materials.props, [x - along * cos, PAVEMENT_LEVEL + MAST_HEIGHT - .95, -(s - along * sin)], [1, 1, 1], '#ffffff', yaw));
            items.push(...head(along, MAST_HEIGHT - .95));
          }
          this.post(x, s, .3);
          this.knockable(items, [{ kind: 'mast', get geometry() { return signalMastPiece(mast); } }]);
        } else {
          // (a pedestal signal knocked down goes dark)
          const pole = this.prop('signal', x, s, yaw); this.post(x, s, .15);
          this.knockable([pole, ...head(0, 4.6)], [{ kind: 'signal', geometry: cityAssets.signal }]);
        }
      }
      else if (piece.kind === 'shelter') {
        const shelter = this.prop('shelter', x, s, piece.yaw);
        this.rigid(x, s, () => this.solid(x + .5, s, .6, 4), itemFrame(piece.s, piece.u, piece.yaw));
        this.knockable([shelter], [{ kind: 'shelter', geometry: cityAssets.shelter }]);
      }
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
      else if (piece.kind === 'lantern') { const lantern = this.prop('lantern', x, s); this.post(x, s, .2); this.knockable([lantern], [{ kind: 'lantern', geometry: cityAssets.lantern }]); }
      // A boat's hull in its own paint, like a parked car's shell, and the
      // line to the quay of one moored alongside
      else if (piece.kind === 'boat' && !this.distant) {
        const model = boatModels[piece.model];
        this.item(`boat-paint-${piece.model}`, model.paint, this.materials.solid, [x, WATER_LEVEL, -s], [1, 1, 1], piece.paint, piece.yaw);
        this.item(`boat-${piece.model}`, model.detail, this.materials.props, [x, WATER_LEVEL, -s], [1, 1, 1], '#ffffff', piece.yaw);
      }
      else if (piece.kind === 'mooring') this.prop('mooring-line', x, s, piece.yaw, WATER_LEVEL, [piece.span / 1.45, 1, 1]);
      else if (piece.kind === 'parked') {
        const model = parkedCars[piece.model], spec = TRAFFIC_MODELS.find(m => m.name === piece.model);
        if (this.distant) continue;
        const colour = PARKED_PAINTS[piece.colour % PARKED_PAINTS.length], items = [
          this.item(`parked-paint-${piece.model}`, model.paint, this.materials.solid, [x, ROAD_LEVEL, -s], [1, 1, 1], colour, piece.yaw),
          this.item(`parked-trim-${piece.model}`, model.trim, this.materials.props, [x, ROAD_LEVEL, -s], [1, 1, 1], '#ffffff', piece.yaw),
        ];
        this.rigid(x, s, () => this.solid(x, s, spec.width, spec.length), itemFrame(piece.s, piece.u, piece.yaw));
        // A car can knock it loose (see CityTraffic.wake): which car it is,
        // which way its nose points, and its bay emptied or filled again
        for (const item of items) item.wakeable = true;
        this.features.colliders.at(-1).parked = {
          model: piece.model, colour, nose: { u: -Math.sin(piece.yaw), s: Math.cos(piece.yaw) },
          get ready() { return items.every(item => item.render?.mesh); },
          get hidden() { return items.every(item => item.render?.hidden); },
          hide(hidden = true) { for (const item of items) hideItem(item, hidden); },
        };
      }
      else if (piece.kind === 'bandstand') { this.prop('bandstand', x, s, piece.yaw); this.post(x, s, 5.4); }
      else if (piece.kind === 'rim') this.post(x, s, piece.radius);
      // A public lawn's fringe (see placeLawnFringe), up to a budget a cell
      else if (piece.kind === 'grass' && !this.distant && Math.floor(++tufts * keep) > Math.floor((tufts - 1) * keep)) {
        tint.set(piece.colour).multiplyScalar(piece.tint);
        this.item('grass-fringe', grassGeometry, this.materials.props, [x, piece.level, -s], [piece.width, piece.height, piece.width], `#${tint.getHexString()}`, piece.yaw);
      }
    }
  }
  // Residents walk the pavement round their block; pairs stroll together.
  buildLife() {
    this.walkers = [];
    if (this.distant) return;
    const random = seededRandom(this.plan.seed + 912);
    for (const block of this.world.blocksByChunk.get(this.index) ?? []) {
      const count = block.perimeter > 140 ? 3 : 2, walkers = [];
      // (residents dress for their district)
      const middle = block.points.reduce((sum, p) => ({ x: sum.x + p.x / block.points.length, y: sum.y + p.y / block.points.length }), { x: 0, y: 0 });
      const district = cityStyleDistrict(middle.y, middle.x);
      for (let i = 0; i < count; i++) walkers.push({
        loop: block, phase: random() * block.perimeter, speed: 1.1 + random() * 1.1, side: 0,
        direction: i % 2 ? -1 : 1, size: .9 + random() * .22, width: .92 + random() * .16, color: pick(WALKER_COLORS, random),
        appearance: walkerAppearance(this.plan.seed + block.index * 131 + i * 719, district),
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
  // Where a walker is on its loop, `walked` metres on: world (x east, s north)
  // and a yaw facing the way it walks. The yaw turns through each corner
  // over a metre or so either side of it (less on a short side), so a walker
  // rounds it rather than snapping about, and a pair's sideways spacing,
  // which follows the yaw, swings round with them.
  walkerPose(walker, walked) {
    const loop = walker.loop, travel = walker.phase + walked * walker.direction;
    const d = ((travel % loop.perimeter) + loop.perimeter) % loop.perimeter, points = loop.points, cumulative = loop.cumulative, n = points.length;
    let i = 0;
    while (i < n - 1 && cumulative[i + 1] <= d) i++;
    const a = points[i], b = points[(i + 1) % n], span = (cumulative[i + 1] - cumulative[i]) || 1, t = (d - cumulative[i]) / span;
    const side = k => { const p = points[((k % n) + n) % n], q = points[(((k + 1) % n) + n) % n]; return Math.atan2(q.x - p.x, q.y - p.y); };
    const length = k => cumulative[((k % n) + n) % n + 1] - cumulative[((k % n) + n) % n];
    // (the corner nearer this point, and how far through its turn it is)
    const along = d - cumulative[i], atEnd = along > span / 2, reach = Math.min(WALKER_TURN, span / 2, length(atEnd ? i + 1 : i - 1) / 2);
    const from = atEnd ? side(i) : side(i - 1), to = atEnd ? side(i + 1) : side(i), past = atEnd ? along - span : along;
    const blend = reach > 1e-6 ? THREE.MathUtils.smoothstep(past, -reach, reach) : past >= 0 ? 1 : 0;
    const heading = from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * blend;
    return { x: a.x + (b.x - a.x) * t, s: a.y + (b.y - a.y) * t, yaw: -heading + (walker.direction < 0 ? Math.PI : 0) };
  }
  animate(time, signalTime = time, animatePeople = true, contacts = null) {
    this.animateSignals(signalTime);
    if (!animatePeople || !this.peopleMesh) return;
    const mesh = this.peopleMesh;
    // (from where the residents are drawn to the world, for those knocked flying)
    this.peopleFrame ??= new THREE.Matrix4().makeTranslation(this.east, 0, -this.start);
    // (the player, in the residents' frame, for them to look round at)
    const player = contacts?.player, watch = player ? watching.set(player.u - this.east, -player.s + this.start) : null;
    for (let i = 0; i < this.walkers.length; i++) {
      const walker = this.walkers[i], partner = walker.pairOffset ? this.walkers[i + (walker.pairOffset < 0 ? 1 : -1)] : null;
      const pose = offsetWalkerPose(this.walkerPose(walker, walkedAt(walker, time)), walker);
      const motion = walkerFloat(walker, time, residentFloat), width = walker.size * walker.width;
      const x = pose.x - this.east, z = -(pose.s - this.start), pace = paceAt(walker, time);
      // The slower they go, the less they bob; standing still, barely. Waiting
      // for someone knocked over or catching up, they turn to watch them;
      // going back to meet them, they face that way. Shoved aside by the
      // player on foot, they look round at them.
      let look = null;
      if (pace < 0) look = pose.yaw + Math.PI;
      else if (walker.shovedBy && time < walker.shovedBy.until) look = Math.atan2(x - walker.shovedBy.x, z - walker.shovedBy.z);
      else if (standing(walker, time) && partner?.drawn && (partner.away || !standing(partner, time))) look = Math.atan2(x - partner.drawn.x, z - partner.drawn.z);
      const bob = .3 + .7 * Math.min(1, Math.abs(pace) / walker.speed);
      residentItem.p[0] = x; residentItem.p[1] = PAVEMENT_LEVEL + motion.lift * bob; residentItem.p[2] = z;
      residentItem.yaw = lookYaw(walker, pose.yaw, look, time); residentItem.roll = motion.roll * bob;
      setWalkerTurn(mesh, i, walker.away ? 0 : glance(walker, residentItem.yaw, x, z, watch, time, partner ? Math.sign(-walker.pairOffset) : 0));
      residentItem.scale[0] = residentItem.scale[2] = width; residentItem.scale[1] = walker.size * motion.stretch;
      const matrix = cityItemMatrix(residentItem, this.east, this.start, transform.matrix);
      lean(matrix, pace - walker.speed - .3);
      // Knocked over they stop, and so does anyone with them; up again, they
      // rejoin their walk from where they landed (see rejoinWalk), and once
      // back on it, catch up with each other (see regroupWalkers)
      const away = contacts?.person(walker, matrix, this.peopleFrame, .28 * width, time, rejoinWalk) ?? false;
      if (away && !walker.away) { walker.away = true; stopWalkers(walker, partner, time); }
      else if (!away && walker.away) { walker.away = false; regroupWalkers(walker, partner, time, walker.arrival ?? 0); walker.arrival = 0; }
      walker.drawn ??= { x: 0, z: 0 };
      walker.drawn.x = matrix.elements[12]; walker.drawn.z = matrix.elements[14];
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
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
  *finishSteps() {
    // Street lamps light the road below their heads, lanterns the walk round them
    const lights = (key, head, drop) => (this.batches.get(key)?.items ?? []).map(item => {
      const matrix = cityItemMatrix(item, this.east, this.start, transform.matrix);
      const point = head.clone().applyMatrix4(matrix);
      return { kind: key, x: point.x + this.east, y: point.y, z: point.z - this.start, ground: point.y - drop, yaw: Math.atan2(matrix.elements[8], matrix.elements[10]), item };
    });
    this.features.lamps = [...lights('lamp', new THREE.Vector3(-1.75, 7.36, 0), 7.36), ...lights('lantern', new THREE.Vector3(0, LANTERN_HEIGHT, 0), LANTERN_HEIGHT)];
    // The cell's building bodies are one flat-shaded mesh, with the edges of its thin paving
    faceSlabEdges(this); yield;
    if (!this.bodies.empty) {
      const mesh = new THREE.Mesh(this.bodies.build(), this.materials['merged-solid']);
      mesh.name = 'citydriver-bodies'; mesh.userData.bodies = true; mesh.dispose = () => mesh.geometry.dispose();
      this.group.add(finishBatchMesh(mesh, { castShadow: true, receiveShadow: true, ambientOcclusion: true }, true));
    }
    this.bodies = null;
    yield;
    yield* renderBatchSteps(this.group, this.batches, this.east, this.start, this.distant);
    this.signalMesh = this.group.getObjectByName('citydriver-signal-lens');
    this.peopleMesh = this.group.getObjectByName('citydriver-residents');
    if (this.peopleMesh) {
      this.peopleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Their initial positions don't bound the walk around the block, so bound
      // the loops they walk, with room for anyone shoved or knocked flying. The old
      // sphere round the whole cell and its neighbours kept every chunk's residents
      // drawn and animated, and the chunk itself couldn't be culled.
      const walks = new THREE.Box3();
      for (const loop of new Set(this.walkers.map(walker => walker.loop))) {
        for (const p of loop.points) walks.expandByPoint(walkPoint.set(p.x - this.east, PAVEMENT_LEVEL + 1, this.start - p.y));
      }
      this.peopleMesh.boundingSphere = walks.getBoundingSphere(new THREE.Sphere());
      this.peopleMesh.boundingSphere.radius += WALKERS_STRAY;
      addWalkerAlert(this.peopleMesh, this.world.peopleAlert);
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
    // Counts lamps knocked down or put back, for the night lighting to notice
    this.lampRevision = 0;
    this.pending = []; this.building = null; this.materials = resources(); this.nav = navGraph();
    // Demolition's red residents, off until setPeopleAlert
    this.peopleAlert = createWalkerAlert();
    this.animationFrustum = new THREE.Frustum(); this.animationMatrix = new THREE.Matrix4(); this.animationSphere = new THREE.Sphere();
    this.prepareLots(); this.bridges = findBridges(); this.placeFurniture();
    this.harbour = new HarbourBoats(scene, this.materials);
    this.staticGroup = new THREE.Group(); this.staticGroup.name = 'citydriver-static'; this.staticGroup.matrixAutoUpdate = false; this.staticGroup.updateMatrixWorld = settledMatrixWorld;
    scene.add(this.staticGroup);
    this.buildStatic(); this.staticGroup.updateMatrix();
    this.distantGroup = new THREE.Group(); this.distantGroup.name = 'citydriver-distant-city'; this.distantGroup.matrixAutoUpdate = false;
    scene.add(this.distantGroup);
    this.distant = new Map(); this.distantPending = [];
    // Detailed chunks the car has left, kept out of the scene for a while, and
    // the ones built ahead of it: crossing back over a cell edge, or into the
    // cell it was heading for, needs no build at all
    this.spare = new Map(); this.prefetching = null;
    this.shadowDetail = true;
    for (let ix = CITY.ix0; ix <= CITY.ix1; ix++) for (let iz = CITY.iz0; iz <= CITY.iz1; iz++) this.distantPending.push({ ix, iz, key: `${ix},${iz}` });
  }
  inCity(ix, iz) { return ix >= CITY.ix0 && ix <= CITY.ix1 && iz >= CITY.iz0 && iz <= CITY.iz1; }
  prepareLots() {
    this.lotsByChunk = new Map(); this.blocksByChunk = new Map();
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
    // The big surfaces are tiled (see STATIC_TILE); paths and water are small
    const add = (surface, material, { castShadow = false, receiveShadow = true, ambientOcclusion = true, name = 'static', tiled = false } = {}) => {
      if (surface.empty) return null;
      const meshes = (tiled ? surface.tiles(STATIC_TILE) : [surface.build()]).map(geometry => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `citydriver-${name}`; mesh.castShadow = castShadow; mesh.receiveShadow = receiveShadow;
        if (!ambientOcclusion) mesh.userData.ambientOcclusion = false;
        stableShadowDepth(mesh); mesh.matrixAutoUpdate = false; mesh.updateMatrix();
        this.staticGroup.add(mesh);
        return mesh;
      });
      return meshes[0];
    };
    buildStreetSurfaces({ ground, roads, paths, water, walls }, this.nav, this.bridges);
    add(ground, this.materials.ground, { name: 'ground', tiled: true });
    add(roads, this.materials.road, { name: 'roads', tiled: true });
    add(paths, this.materials.ground, { name: 'paths' });
    this.waterMesh = add(water, this.materials.water, { name: 'water', ambientOcclusion: false });
    add(walls, this.materials.ground, { name: 'walls', castShadow: true, tiled: true });
  }
  // (`skyline: false` leaves the skyline for a later call, so the loading
  // screen can say which it is building)
  update(s, u, { budgetMs = Infinity, skyline = true } = {}) {
    const deadline = performance.now() + budgetMs;
    const cell = cityCell(s, u), window = residentWindow();
    const radius = window.ahead >= 5 ? 3 : window.ahead >= 4 ? 2 : 1;
    this.track(s, u);
    if (this.center !== cell.key || this.radius !== radius) {
      // After a jump (the first frame, a reset, a new route) the whole
      // collision neighbourhood is built before the car moves
      const last = this.centerCell;
      this.jumped = !last || Math.max(Math.abs(last.ix - cell.ix), Math.abs(last.iz - cell.iz)) > 1;
      this.center = cell.key; this.centerCell = cell; this.radius = radius;
      for (const [key, chunk] of this.chunks) {
        if (Math.abs(chunk.ix - cell.ix) > radius || Math.abs(chunk.iz - cell.iz) > radius) {
          this.chunks.delete(key); chunk.group.removeFromParent(); this.spare.set(key, chunk);
        }
      }
      this.pending = [];
      for (let ix = cell.ix - radius; ix <= cell.ix + radius; ix++) for (let iz = cell.iz - radius; iz <= cell.iz + radius; iz++) {
        const key = `${ix},${iz}`;
        if (!this.inCity(ix, iz) || this.chunks.has(key)) continue;
        const spare = this.spare.get(key);
        if (spare) { this.spare.delete(key); this.place(spare); continue; }
        this.pending.push({ ix, iz, key, distance: Math.max(Math.abs(ix - cell.ix), Math.abs(iz - cell.iz)), gap: this.gap(ix, iz, s, u) });
      }
      this.pending.sort((a, b) => a.distance - b.distance || a.gap - b.gap || a.iz - b.iz || a.ix - b.ix);
      // A chunk built ahead of time for a cell the car has now reached goes on building as needed
      if (this.prefetching && this.pending.some(next => next.key === this.prefetching.index) && !this.building) { this.building = this.prefetching; this.prefetching = null; }
      if (this.building) {
        const at = this.pending.findIndex(next => next.key === this.building.index);
        if (at < 0) { this.building.dispose(); this.building = null; }
        else if (at > 0 && this.pending[at].distance === this.pending[0].distance) this.pending.unshift(...this.pending.splice(at, 1));
      }
      const ahead = this.prefetching;
      if (ahead && !this.pending.some(next => next.key === ahead.index) && !this.prefetchable(ahead.ix, ahead.iz)) { ahead.dispose(); this.prefetching = null; }
      this.trimSpare(s, u);
      // The skyline fills in from the car outward, and is only drawn where the fog can show it
      this.distantPending.sort((a, b) => Math.hypot(a.ix - cell.ix, a.iz - cell.iz) - Math.hypot(b.ix - cell.ix, b.iz - cell.iz));
      for (const chunk of this.distant.values()) this.showDistant(chunk, !this.chunks.has(chunk.index) && Math.max(Math.abs(chunk.ix - cell.ix), Math.abs(chunk.iz - cell.iz)) <= radius + DISTANT_VISIBLE);
    }
    let built = 0;
    // A chunk the car is about to reach is built now, whatever the budget
    for (let i = 0; i < this.pending.length; i++) {
      const next = this.pending[i];
      if (next.distance > 1 || !(this.jumped || this.gap(next.ix, next.iz, s, u) < URGENT_REACH)) continue;
      const chunk = this.claim(next.key) ?? new CityChunk(this, next.ix, next.iz, false, true);
      chunk.buildUntil();
      this.pending.splice(i--, 1); this.place(chunk); built++;
    }
    this.jumped = false;
    // and the rest nearest first, within the budget
    while (this.pending.length) {
      const next = this.pending[0];
      if (built > 0 && performance.now() >= deadline) break;
      if (this.building?.index !== next.key) {
        const started = this.claim(next.key);
        this.building?.dispose(); this.building = started ?? new CityChunk(this, next.ix, next.iz, false, true);
      }
      if (!this.building.buildUntil(deadline)) break;
      this.pending.shift();
      const chunk = this.building; this.building = null;
      this.place(chunk); built++;
    }
    // then, in what time is left, the chunks the car is heading for
    if (!this.pending.length && Number.isFinite(budgetMs)) this.prefetch(s, u, deadline);
    while (skyline && this.distantPending.length && (!Number.isFinite(budgetMs) || performance.now() < deadline)) {
      const next = this.distantPending.shift();
      const chunk = new CityChunk(this, next.ix, next.iz, true);
      chunk.group.position.set(chunk.east, 0, -chunk.start); chunk.group.updateMatrix();
      this.distant.set(next.key, chunk);
      this.showDistant(chunk, !this.chunks.has(next.key) && Math.max(Math.abs(chunk.ix - cell.ix), Math.abs(chunk.iz - cell.iz)) <= radius + DISTANT_VISIBLE);
    }
  }
  // How far a point is from a cell's square
  gap(ix, iz, s, u) {
    const du = Math.max(ix * CITY_CELL - u, 0, u - (ix + 1) * CITY_CELL), ds = Math.max(iz * CITY_CELL - s, 0, s - (iz + 1) * CITY_CELL);
    return Math.hypot(du, ds);
  }
  // A detailed chunk into the scene, over its skyline
  place(chunk) {
    chunk.group.position.set(chunk.east, 0, -chunk.start); chunk.group.updateMatrix();
    chunk.group.visible = true; applyShadowDetail(chunk.group, this.shadowDetail);
    this.chunks.set(chunk.index, chunk); this.scene.add(chunk.group);
    const distant = this.distant.get(chunk.index); if (distant) this.showDistant(distant, false);
  }
  // A skyline chunk out of range or under a detailed chunk leaves the scene,
  // so the renderer does not walk its meshes every frame
  showDistant(chunk, shown) {
    chunk.group.visible = shown;
    if (shown && !chunk.group.parent) this.distantGroup.add(chunk.group);
    else if (!shown && chunk.group.parent) chunk.group.removeFromParent();
  }
  // A chunk being built already, for the budget or ahead of the car
  claim(key) {
    for (const slot of ['building', 'prefetching']) {
      const chunk = this[slot];
      if (chunk?.index === key) { this[slot] = null; return chunk; }
    }
    return null;
  }
  // The way the car has been going, over the last few metres
  track(s, u) {
    const moved = this.trail ? Math.hypot(s - this.trail.s, u - this.trail.u) : Infinity;
    if (moved > 60) { this.trail = { s, u }; this.heading = null; return; }
    if (moved < 8) return;
    this.heading = { s: (s - this.trail.s) / moved, u: (u - this.trail.u) / moved };
    this.trail = { s, u };
  }
  // A cell of the ring just outside the detailed square, not built yet
  prefetchable(ix, iz) {
    const cell = this.centerCell, key = `${ix},${iz}`;
    return this.inCity(ix, iz) && !this.chunks.has(key) && !this.spare.has(key)
      && Math.max(Math.abs(ix - cell.ix), Math.abs(iz - cell.iz)) === this.radius + 1;
  }
  get spareLimit() { return 2 * (2 * this.radius + 1); }
  // Keep the nearest spare chunks, and none that are far from the car
  trimSpare(s, u) {
    const cell = this.centerCell;
    const spares = [...this.spare.values()].map(chunk => ({ chunk, gap: this.gap(chunk.ix, chunk.iz, s, u) })).sort((a, b) => a.gap - b.gap);
    spares.forEach(({ chunk }, i) => {
      if (i < this.spareLimit && Math.max(Math.abs(chunk.ix - cell.ix), Math.abs(chunk.iz - cell.iz)) <= this.radius + 2) return;
      this.spare.delete(chunk.index); chunk.dispose();
    });
  }
  // Build, into the spare chunks, the nearest chunk the car will want once it
  // crosses into the cell it is heading for
  prefetch(s, u, deadline) {
    if (performance.now() >= deadline) return;
    if (!this.prefetching) {
      if (!this.heading) return;
      const ahead = cityCell(s + this.heading.s * CITY_CELL, u + this.heading.u * CITY_CELL);
      if (ahead.key === this.center) return;
      let target = null;
      for (let ix = ahead.ix - this.radius; ix <= ahead.ix + this.radius; ix++) for (let iz = ahead.iz - this.radius; iz <= ahead.iz + this.radius; iz++) {
        if (!this.prefetchable(ix, iz)) continue;
        const gap = this.gap(ix, iz, s, u);
        if (!target || gap < target.gap) target = { ix, iz, gap };
      }
      if (!target) return;
      // (not when it would only push out a nearer spare chunk)
      if (this.spare.size >= this.spareLimit && [...this.spare.values()].every(chunk => this.gap(chunk.ix, chunk.iz, s, u) <= target.gap)) return;
      this.prefetching = new CityChunk(this, target.ix, target.iz, false, true);
    }
    if (!this.prefetching.buildUntil(deadline)) return;
    const chunk = this.prefetching; this.prefetching = null;
    this.spare.set(chunk.index, chunk); this.trimSpare(s, u);
  }
  // Whole chunks that neither the camera nor the sun's shadow can see are
  // hidden before the renderer walks their meshes one by one. A chunk is
  // hidden only when the sphere round all its meshes is outside both
  // frustums, so no mesh the renderer would have drawn is left out.
  cull(camera, shadow = null) {
    // (a headset camera carries one frustum round both eyes, which three culls with too)
    const view = camera
      ? cullFrustum.setFromProjectionMatrix(cullMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), THREE.WebGLCoordinateSystem, camera.reversedDepth)
      : null;
    const seen = chunk => {
      if (!view) return true;
      if (chunk.bounds === undefined) chunk.bounds = chunkBounds(chunk.group);
      if (!chunk.bounds) return true;
      cullSphere.copy(chunk.bounds).applyMatrix4(chunk.group.matrixWorld);
      return view.intersectsSphere(cullSphere) || Boolean(shadow?.intersectsSphere(cullSphere));
    };
    for (const chunk of this.chunks.values()) chunk.group.visible = seen(chunk);
    for (const chunk of this.distant.values()) if (chunk.group.parent) chunk.group.visible = seen(chunk);
  }
  setWindowGlow(amount) {
    const glow = Math.max(0, Math.min(1, amount));
    if (glow === this.windowGlow) return;
    this.windowGlow = glow;
    this.materials.lit.color.copy(dayWindow).lerp(nightWindow, glow * glow);
    // (and the signs light up as the windows do)
    this.materials.signs.userData.glow.value = glow * glow * SIGN_GLOW;
  }
  // A demolition run warns of the residents, whose every knock is a fine:
  // they glow red, and show through anything but buildings when `ghosts`
  // (a stencil buffer) allows
  setPeopleAlert(on, ghosts = true) {
    this.materials.residents.userData.alert.value = on ? 1 : 0;
    this.peopleAlert.mask.visible = this.peopleAlert.ghost.visible = on && ghosts;
  }
  // Whether people, short street furniture and facade trim cast (see SMALL_CASTERS)
  setShadowDetail(full) {
    if (full === this.shadowDetail) return;
    this.shadowDetail = full;
    for (const chunk of this.chunks.values()) applyShadowDetail(chunk.group, full);
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
    this.harbour.update(time, camera);
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
    for (const chunk of this.spare.values()) chunk.dispose(); this.spare.clear();
    this.building?.dispose(); this.building = null; this.prefetching?.dispose(); this.prefetching = null;
    for (const chunk of this.distant.values()) chunk.dispose(); this.distant.clear(); this.distantPending = [];
    this.distantGroup.removeFromParent(); this.harbour.dispose();
    for (const mesh of this.staticGroup.children) if (!mesh.isInstancedMesh) mesh.geometry.dispose(); else mesh.dispose();
    this.staticGroup.removeFromParent();
    for (const material of Object.values(this.materials)) { material.map?.dispose(); material.dispose(); }
    this.peopleAlert.mask.dispose(); this.peopleAlert.ghost.dispose();
  }
}
