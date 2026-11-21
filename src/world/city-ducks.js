import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CITY } from './city.js';
import { randomAt } from './route.js';
import { cityParks, pondShore } from './city-parks.js';
import { POND_LEVEL } from './city-streets.js';
import { insidePolygon, distanceToPolyline } from '../mapgen/polygon-util.js';

// Ducks on the parks' ponds: a few small groups, each paddling slow circles
// round a spot that itself drifts round the pond, bobbing a little. Where
// each is follows from the clock alone, as the pigeons' and the boats' do.
// Two instanced draws (drakes and hens) of the props material, no shadows,
// only for ducks within NEAR (m) of the camera.
const NEAR = 120, MOST = 48;
// Groups a pond has for each this many square meters of it, ducks in a group,
// and how far (m) from the shore a group's spot keeps
const AREA = 900, GROUP = [3, 6], SHORE = 4;

// A duck facing -z, its waterline at y = 0: a boat-shaped body, a tail tip,
// a head on a short neck and a beak
function duck(head, body, chest) {
  const parts = [], tint = (g, colour) => {
    if (g.index) g = g.toNonIndexed();
    g.deleteAttribute('uv');
    const c = new THREE.Color(colour), colours = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colours.length; i += 3) c.toArray(colours, i);
    g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    parts.push(g);
  };
  const hull = new THREE.IcosahedronGeometry(1, 0); hull.scale(.15, .09, .24); hull.translate(0, .04, .02); tint(hull, body);
  const breast = new THREE.IcosahedronGeometry(1, 0); breast.scale(.12, .08, .1); breast.translate(0, .06, -.14); tint(breast, chest);
  const tail = new THREE.ConeGeometry(.06, .14, 4); tail.rotateX(Math.PI / 2 + .5); tail.translate(0, .1, .25); tint(tail, body);
  const neck = new THREE.CylinderGeometry(.04, .05, .12, 5); neck.translate(0, .15, -.17); tint(neck, head);
  const skull = new THREE.IcosahedronGeometry(.07, 0); skull.translate(0, .23, -.19); tint(skull, head);
  const beak = new THREE.ConeGeometry(.03, .09, 4); beak.rotateX(-Math.PI / 2); beak.translate(0, .21, -.28); tint(beak, '#d9973a');
  const geometry = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  geometry.computeVertexNormals();
  return geometry;
}

export class Ducks {
  constructor(scene, material) {
    // Each group: its pond's middle and how far its spot may wander from it,
    // and each duck's circle round the spot
    this.groups = [];
    for (const entry of cityParks()) {
      if (!entry.pond) continue;
      const shore = pondShore(entry.pond), ring = [...shore, shore[0]];
      const area = Math.abs(shore.reduce((sum, p, i) => { const q = shore[(i + 1) % shore.length]; return sum + p.x * q.y - q.x * p.y; }, 0) / 2);
      const middle = shore.reduce((m, p) => ({ x: m.x + p.x / shore.length, y: m.y + p.y / shore.length }), { x: 0, y: 0 });
      const groups = Math.max(1, Math.min(4, Math.round(area / AREA)));
      for (let g = 0; g < groups; g++) {
        const salt = entry.index * 17 + g, pick = k => randomAt(salt, 7460 + k, CITY.seed);
        // (a spot whose whole drift, and its ducks' circles round it, stay on the water)
        let spot = null;
        for (let k = 0; k < 12 && !spot; k++) {
          const a = pick(k) * Math.PI * 2, r = Math.sqrt(pick(k + 20)) * Math.sqrt(area / Math.PI) * .6;
          const p = { x: middle.x + Math.cos(a) * r, y: middle.y + Math.sin(a) * r };
          const room = insidePolygon(p, shore) ? distanceToPolyline(p, ring) - SHORE : 0;
          if (room > 5) spot = { ...p, drift: Math.min(room - 4.5, 10) };
        }
        if (!spot) continue;
        const count = GROUP[0] + Math.floor(pick(40) * (GROUP[1] - GROUP[0] + 1));
        const ducks = Array.from({ length: count }, (_, k) => ({
          radius: .7 + k * .6 + pick(50 + k) * .3, speed: .18 + pick(60 + k) * .2, phase: pick(70 + k) * Math.PI * 2, way: pick(80 + k) < .5 ? -1 : 1,
          hen: pick(90 + k) < .5, bob: pick(100 + k) * 6,
        }));
        this.groups.push({ ...spot, pace: .04 + pick(41) * .03, start: pick(42) * Math.PI * 2, ducks });
      }
    }
    this.geometries = [duck('#2f6b4a', '#9a9a8e', '#7a5440'), duck('#7a5b3c', '#8a6a48', '#a07c58')];
    this.meshes = this.geometries.map((geometry, k) => {
      const mesh = new THREE.InstancedMesh(geometry, material, MOST);
      mesh.name = `citydriver-ducks-${k ? 'hens' : 'drakes'}`;
      mesh.castShadow = false; mesh.receiveShadow = true; mesh.userData.ambientOcclusion = false;
      mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
      return mesh;
    });
    this.eye = new THREE.Vector3(); this.matrix = new THREE.Matrix4(); this.position = new THREE.Vector3(); this.rotation = new THREE.Quaternion();
    this.scale = new THREE.Vector3(1, 1, 1); this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
  }
  update(time, camera = null, origin = 0) {
    if (camera) camera.getWorldPosition(this.eye);
    const counts = [0, 0];
    for (const group of this.groups) {
      // (the group's spot drifts round a circle of its own)
      const turn = group.start + time * group.pace, cx = group.x + Math.cos(turn) * group.drift, cy = group.y + Math.sin(turn) * group.drift;
      if (camera && Math.hypot(cx - this.eye.x, -cy + origin - this.eye.z) > NEAR) continue;
      for (const duck of group.ducks) {
        const mesh = duck.hen ? 1 : 0;
        if (counts[mesh] >= MOST) continue;
        const a = duck.phase + duck.way * time * duck.speed / duck.radius;
        const x = cx + Math.cos(a) * duck.radius, y = cy + Math.sin(a) * duck.radius;
        // (facing along its circle: the model faces -z; nodding and rocking on the ripples)
        this.euler.set(Math.sin(time * 1.7 + duck.bob) * .06, Math.atan2(Math.sin(a) * duck.way, Math.cos(a) * duck.way), Math.sin(time * 1.3 + duck.bob) * .05);
        this.rotation.setFromEuler(this.euler);
        this.position.set(x, POND_LEVEL + .02 + Math.sin(time * 1.9 + duck.bob) * .015, -y + origin);
        this.matrix.compose(this.position, this.rotation, this.scale);
        this.meshes[mesh].setMatrixAt(counts[mesh]++, this.matrix);
      }
    }
    this.meshes.forEach((mesh, k) => {
      mesh.count = counts[k]; mesh.visible = counts[k] > 0;
      if (counts[k]) mesh.instanceMatrix.needsUpdate = true;
    });
  }
  warmupObjects() { return this.geometries.map(geometry => { const mesh = new THREE.InstancedMesh(geometry, this.meshes[0].material, 1); mesh.setMatrixAt(0, this.matrix.identity()); return mesh; }); }
  dispose() { for (const mesh of this.meshes) { mesh.removeFromParent(); mesh.dispose(); } for (const geometry of this.geometries) geometry.dispose(); }
}
