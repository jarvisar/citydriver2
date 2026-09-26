import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CITY } from './city.js';
import { WATER_LEVEL } from './city-route.js';
import { harbourRoutes } from './city-streets.js';
import { boatModels } from './city-assets.js';
import { randomAt } from './route.js';

// A few boats going about the harbour: launches and workboats at a slow
// few metres a second round the loops off the sea walls (see city-streets.js),
// one on a short loop, two spaced apart on a long one, rising and falling a
// little on the water. Where each is follows from the game's clock alone, so
// they stop when it does. Only those near the camera are drawn: a paint and
// a detail batch for each kind, four draws at most.
const MODELS = ['launch', 'work'], SPEED = { launch: 4.2, work: 3.1 }, RANGE = 480;
const HULLS = { launch: [6, 2.3], work: [7.6, 2.7] };

// Its wake, flat on the water a little above it (the boat rises and falls
// less than that): a foam patch behind the stern, the two arms of a V
// spreading out behind it, and a bow wave along each side
function wake(length, beam) {
  const positions = [], colors = [], foam = new THREE.Color('#9fc6c4'), spray = new THREE.Color('#78aaad'), y = .1, stern = length / 2;
  const triangle = (a, b, c, colour) => {
    // (turned to face up)
    if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0) [b, c] = [c, b];
    for (const [x, z] of [a, b, c]) { positions.push(x, y, z); colors.push(colour.r, colour.g, colour.b); }
  };
  triangle([-beam * .34, stern], [beam * .34, stern], [0, stern + length * .55], foam);
  for (const side of [-1, 1]) {
    triangle([side * beam * .28, stern], [side * beam * .5, stern - .2], [side * beam * 1.25, stern + length * .85], spray);
    triangle([0, -stern - .12], [side * beam * .55, -stern * .2], [side * beam * .5, -stern * .05], foam);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((_, i) => i % 3 === 1 ? 1 : 0), 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(positions.map((_, i) => i).slice(0, positions.length / 3));
  return g;
}
const PAINTS = { launch: ['#2f4b68', '#ecebe4', '#6f9fbf', '#b8413a'], work: ['#a1433a', '#2f5d4f', '#35536e', '#c0892f'] };

// A point and heading along a closed loop, `distance` metres round it
function along(route, distance) {
  const { points, lengths } = route, d = ((distance % route.length) + route.length) % route.length;
  let i = 0;
  while (i < lengths.length - 1 && lengths[i + 1] < d) i++;
  const a = points[i], b = points[i + 1], t = (d - lengths[i]) / (lengths[i + 1] - lengths[i] || 1);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export class HarbourBoats {
  constructor(scene, materials) {
    const routes = harbourRoutes().map(route => {
      const lengths = [0];
      for (let i = 1; i < route.points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(route.points[i].x - route.points[i - 1].x, route.points[i].y - route.points[i - 1].y));
      return { ...route, lengths };
    });
    this.boats = routes.flatMap((route, r) => Array.from({ length: route.length > 1400 ? 2 : 1 }, (_, k) => {
      const salt = r * 31 + k, model = MODELS[Math.floor(randomAt(salt, 7431, CITY.seed) * MODELS.length)];
      const paints = PAINTS[model];
      return { route, model, speed: SPEED[model], start: route.length * (k / 2 + randomAt(salt, 7432, CITY.seed) * .3), bob: randomAt(salt, 7433, CITY.seed) * 6.3,
        paint: new THREE.Color(paints[Math.floor(randomAt(salt, 7434, CITY.seed) * paints.length)]) };
    }));
    this.group = new THREE.Group(); this.group.name = 'citydriver-harbour-boats';
    this.meshes = {};
    for (const model of MODELS) {
      const count = this.boats.filter(boat => boat.model === model).length;
      if (!count) continue;
      const paint = new THREE.InstancedMesh(boatModels[model].paint, materials.solid, count);
      const detail = new THREE.InstancedMesh(mergeGeometries([boatModels[model].detail, wake(...HULLS[model])]), materials.props, count);
      for (const mesh of [paint, detail]) { mesh.name = `citydriver-harbour-${model}`; mesh.castShadow = mesh.receiveShadow = true; mesh.count = 0; this.group.add(mesh); }
      paint.setColorAt(0, this.boats.find(boat => boat.model === model).paint);
      this.meshes[model] = { paint, detail };
    }
    scene.add(this.group);
    this.matrix = new THREE.Matrix4(); this.position = new THREE.Vector3(); this.rotation = new THREE.Quaternion(); this.scale = new THREE.Vector3(1, 1, 1); this.up = new THREE.Vector3(0, 1, 0);
    this.eye = new THREE.Vector3();
  }
  update(time, camera = null) {
    const counts = {};
    if (camera) camera.getWorldPosition(this.eye);
    for (const boat of this.boats) {
      const meshes = this.meshes[boat.model], d = boat.start + time * boat.speed;
      const here = along(boat.route, d);
      if (camera && Math.hypot(here.x - this.eye.x, -here.y - this.eye.z) > RANGE) continue;
      // (heading along the loop a little either side, so it turns smoothly at the ends)
      const behind = along(boat.route, d - 5), ahead = along(boat.route, d + 5), dx = ahead.x - behind.x, dy = ahead.y - behind.y;
      this.position.set(here.x, WATER_LEVEL + .04 * Math.sin(time * 1.3 + boat.bob), -here.y);
      this.rotation.setFromAxisAngle(this.up, Math.atan2(-dx, dy));
      this.matrix.compose(this.position, this.rotation, this.scale);
      const index = counts[boat.model] = (counts[boat.model] ?? -1) + 1;
      meshes.paint.setMatrixAt(index, this.matrix); meshes.detail.setMatrixAt(index, this.matrix);
      meshes.paint.setColorAt(index, boat.paint);
    }
    for (const [model, { paint, detail }] of Object.entries(this.meshes)) {
      const count = (counts[model] ?? -1) + 1;
      for (const mesh of [paint, detail]) {
        mesh.count = count; mesh.visible = count > 0;
        if (!count) continue;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
      if (count) paint.instanceColor.needsUpdate = true;
    }
  }
  dispose() {
    this.group.removeFromParent();
    for (const { paint, detail } of Object.values(this.meshes)) { paint.dispose(); detail.geometry.dispose(); detail.dispose(); }
  }
}
