import * as THREE from 'three';
import { PAVEMENT_LEVEL } from './world/city-route.js';

const STREET_LIMIT = 96, HEADLIGHT_LIMIT = 25, RANGE = 145;
const up = new THREE.Vector3(0, 1, 0), lensColor = new THREE.Color('#fff1c8');

// Small CPU-generated masks, shared by every instance. No lights, render
// targets, bloom, shadow maps, or extra work in the city's surface shaders.
function lightMask(headlight) {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size, v = (y + .5) / size;
    let alpha;
    if (headlight) {
      const width = .055 + v * .25;
      const left = Math.exp(-(((u - .39) / width) ** 2) * 2);
      const right = Math.exp(-(((u - .61) / width) ** 2) * 2);
      alpha = Math.min(1, left + right) * Math.min(1, v * 12) * (1 - v) ** 1.4;
      alpha *= Math.min(1, u * 16, (1 - u) * 16);
    } else alpha = Math.max(0, 1 - ((u * 2 - 1) ** 2 + (v * 2 - 1) ** 2)) ** 2;
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(alpha * 255);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export class NightLighting {
  constructor(scene) {
    this.group = new THREE.Group(); this.group.name = 'night-lighting';
    this.group.visible = false; scene.add(this.group);
    this.transform = new THREE.Object3D(); this.color = new THREE.Color();
    this.forward = new THREE.Vector3(); this.position = new THREE.Vector3();
    this.selected = []; this.lastX = Infinity; this.lastZ = Infinity;
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const make = (name, geometry, material, count) => {
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.name = name; mesh.count = 0; mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.userData.ambientOcclusion = false;
      this.group.add(mesh); return mesh;
    };
    const patch = headlight => new THREE.MeshBasicMaterial({
      color: headlight ? '#fff0cc' : '#ffcf83', map: lightMask(headlight),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      toneMapped: false, opacity: 0,
    });
    this.pools = make('street-light-pools', plane, patch(false), STREET_LIMIT);
    this.beams = make('headlight-pools', plane, patch(true), HEADLIGHT_LIMIT);
    this.lenses = make('street-light-lenses', new THREE.BoxGeometry(.72, .065, .30),
      new THREE.MeshBasicMaterial({ color: '#ffe9b1', toneMapped: false }), STREET_LIMIT);
  }
  update(world, player, traffic, level) {
    const strength = THREE.MathUtils.smoothstep(level, .65, 1);
    this.group.visible = strength > .001;
    if (!this.group.visible) return;
    const origin = world.origin, x = player.car.position.x, z = player.car.position.z - origin;
    // Refresh nearby lamps only after meaningful movement or streaming changes.
    const refresh = this.world !== world || this.center !== world.center || this.chunkCount !== world.chunks.size
      || Math.hypot(x - this.lastX, z - this.lastZ) > 6;
    if (refresh) {
      this.world = world; this.center = world.center; this.chunkCount = world.chunks.size;
      this.lastX = x; this.lastZ = z;
      const candidates = [];
      for (const chunk of world.chunks.values()) for (const lamp of chunk.features.lamps ?? []) {
        const distance = Math.hypot(lamp.x - x, lamp.z - z);
        if (distance < RANGE) candidates.push({ lamp, distance });
      }
      candidates.sort((a, b) => a.distance - b.distance);
      this.selected = candidates.slice(0, STREET_LIMIT);
    }
    this.pools.material.opacity = .48 * strength;
    this.beams.material.opacity = .56 * strength;
    this.lenses.material.color.copy(lensColor).multiplyScalar(strength);
    const t = this.transform;
    const uploadStreet = refresh || this.lastOrigin !== origin;
    this.lastOrigin = origin;
    if (uploadStreet) for (let i = 0; i < this.selected.length; i++) {
      const { lamp } = this.selected[i];
      const fade = 1 - THREE.MathUtils.smoothstep(Math.hypot(lamp.x - x, lamp.z - z), 95, RANGE);
      t.position.set(lamp.x, (lamp.ground ?? lamp.y - 7.36) + .025, lamp.z + origin);
      t.rotation.set(0, lamp.yaw, 0); t.scale.set(12, 1, 10); t.updateMatrix();
      this.pools.setMatrixAt(i, t.matrix); this.pools.setColorAt(i, this.color.setScalar(fade));
      t.position.y = lamp.y; t.scale.setScalar(1); t.updateMatrix();
      this.lenses.setMatrixAt(i, t.matrix);
      this.lenses.setColorAt(i, this.color.setScalar(fade));
    }
    this.pools.count = this.lenses.count = this.selected.length;
    let count = 0;
    const beam = (car, spec, offset = 0) => {
      if (count >= HEADLIGHT_LIMIT) return;
      this.position.copy(car.position); this.position.z += offset;
      const distance = Math.hypot(this.position.x - x, this.position.z - origin - z);
      if (distance >= RANGE) return;
      // Keep the patch on the street when the suspension or car body tilts.
      this.forward.set(0, 0, -1).applyQuaternion(car.quaternion); this.forward.y = 0; this.forward.normalize();
      const length = 18;
      t.position.copy(this.position).addScaledVector(this.forward, spec.length / 2 + length / 2);
      t.position.y = PAVEMENT_LEVEL + .03;
      t.quaternion.setFromAxisAngle(up, Math.atan2(-this.forward.x, -this.forward.z));
      t.scale.set(8, 1, length); t.updateMatrix(); this.beams.setMatrixAt(count, t.matrix);
      this.beams.setColorAt(count++, this.color.setScalar(1 - THREE.MathUtils.smoothstep(distance, 95, RANGE)));
    };
    // Formula cars have only a rear rain light.
    if (player.nightLights.length > 1) beam(player.car, player.spec);
    if (traffic.enabled) for (const car of traffic.vehicles) beam(car.car, car.spec, origin);
    this.beams.count = count;
    for (const mesh of this.group.children) {
      mesh.visible = mesh.count > 0;
      if (mesh !== this.beams && !uploadStreet) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  dispose() {
    this.group.removeFromParent();
    const geometries = new Set();
    for (const mesh of this.group.children) {
      geometries.add(mesh.geometry); mesh.material.map?.dispose(); mesh.material.dispose(); mesh.dispose();
    }
    for (const geometry of geometries) geometry.dispose();
  }
}
