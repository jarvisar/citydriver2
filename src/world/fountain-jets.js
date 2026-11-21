import * as THREE from 'three';

// The fountains' water in motion: a plume up out of each spout falling back
// into its top bowl, and arcs from its bowls' rims down into the basin below,
// each a line of drops going round the same path. Where each drop is follows
// from the clock alone, as the harbor's boats do, so they stop when it does.
// Only the fountains nearest the camera are drawn, in one instanced draw of
// the props material, casting no shadows.
//
// A fountain (see CityChunk's features.fountains) is { x, z, spout, plume,
// tiers }: the spout's top (y) and how high its plume rises, and for each
// bowl that spills, [radius, rim y, landing radius, landing y], biggest last.

// Fountains within NEAR (m) of the camera are drawn, at most MOST of them
const NEAR = 85, MOST = 4;
// Drops in a plume, arcs round a bowl's rim and drops along each (and a
// splash where each lands), and an arc's time in the air (s)
const PLUME = 14, ARCS = 8, ALONG = 7, FLIGHT = .75;
const GRAVITY = 9.8, PER = PLUME + ARCS * (ALONG + 1) * 2;
const UP = new THREE.Vector3(0, 1, 0), byDistance = (a, b) => a.distance - b.distance;

// A drop: a small faceted bead drawn out along its way (local y)
function dropGeometry() {
  const g = new THREE.OctahedronGeometry(1, 0);
  g.scale(.04, .19, .04);
  const colour = new THREE.Color('#d4edf1'), colours = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < colours.length; i += 3) colour.toArray(colours, i);
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  g.deleteAttribute('uv');
  return g;
}

export class FountainJets {
  constructor(scene, material) {
    this.geometry = dropGeometry();
    this.mesh = new THREE.InstancedMesh(this.geometry, material, MOST * PER);
    this.mesh.name = 'citydriver-fountain-jets';
    this.mesh.castShadow = false; this.mesh.receiveShadow = false; this.mesh.userData.ambientOcclusion = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.visible = false; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.eye = new THREE.Vector3(); this.near = [];
    this.position = new THREE.Vector3(); this.velocity = new THREE.Vector3(); this.rotation = new THREE.Quaternion(); this.scale = new THREE.Vector3(1, 1, 1); this.matrix = new THREE.Matrix4();
  }
  // The drops of the fountains near the camera at `time`, from the chunks'
  // fountains, which lie `origin` along z from the scene
  update(time, chunks, camera = null, origin = 0) {
    const near = this.near;
    near.length = 0;
    if (camera) camera.getWorldPosition(this.eye);
    // (nothing allocated a frame: a fountain keeps its distance on itself)
    for (const chunk of chunks) {
      const fountains = chunk.features?.fountains;
      if (fountains) for (const fountain of fountains) {
        fountain.distance = camera ? Math.hypot(fountain.x - this.eye.x, fountain.z + origin - this.eye.z) : 0;
        if (fountain.distance < NEAR) near.push(fountain);
      }
    }
    near.sort(byDistance);
    let count = 0;
    for (let n = 0; n < Math.min(MOST, near.length); n++) {
      const fountain = near[n], x = fountain.x, z = fountain.z + origin, phase = fountain.phase ?? 0;
      // The plume: each drop up from the spout and back down, spread a little round it
      const rise = Math.sqrt(2 * GRAVITY * fountain.plume), up = 2 * rise / GRAVITY;
      for (let k = 0; k < PLUME; k++) {
        const t = ((time + phase) / up + k / PLUME) % 1 * up, a = k * 2.4, spread = .07 + .05 * (k % 3);
        this.velocity.set(Math.cos(a) * spread, rise - GRAVITY * t, Math.sin(a) * spread);
        this.position.set(x + Math.cos(a) * spread * t, fountain.spout + rise * t - GRAVITY * t * t / 2, z + Math.sin(a) * spread * t);
        this.set(count++);
      }
      // The arcs off each bowl's rim, the drops along each a quarter of its flight apart
      for (const [from, height, to, low] of fountain.tiers) {
        const out = (to - from) / FLIGHT, lift = (low - height + GRAVITY * FLIGHT * FLIGHT / 2) / FLIGHT;
        for (let arc = 0; arc < ARCS; arc++) {
          const a = (arc + .5) / ARCS * Math.PI * 2 + phase, cos = Math.cos(a), sin = Math.sin(a);
          for (let k = 0; k < ALONG; k++) {
            const t = ((time + phase) / FLIGHT + k / ALONG + arc * .13) % 1 * FLIGHT;
            this.velocity.set(cos * out, lift - GRAVITY * t, sin * out);
            this.position.set(x + cos * (from + out * t), height + lift * t - GRAVITY * t * t / 2, z + sin * (from + out * t));
            this.set(count++);
          }
          // (and a splash where it lands, swelling and falling back with each drop)
          const pulse = ((time + phase) / FLIGHT * ALONG + arc * .13 * ALONG) % 1;
          this.position.set(x + cos * to, low + .02, z + sin * to);
          this.velocity.set(0, 1, 0); this.scale.set(3 + pulse * 2, .3 + (1 - pulse) * .6, 3 + pulse * 2);
          this.set(count++);
          this.scale.set(1, 1, 1);
        }
      }
    }
    this.mesh.count = count; this.mesh.visible = count > 0;
    if (count) this.mesh.instanceMatrix.needsUpdate = true;
  }
  // A drop at this.position, turned along this.velocity
  set(index) {
    this.rotation.setFromUnitVectors(UP, this.velocity.normalize());
    this.matrix.compose(this.position, this.rotation, this.scale);
    this.mesh.setMatrixAt(index, this.matrix);
  }
  // (its program, compiled with the city)
  warmupObjects() { const mesh = new THREE.InstancedMesh(this.geometry, this.mesh.material, 1); mesh.setMatrixAt(0, this.matrix.identity()); return [mesh]; }
  dispose() { this.mesh.removeFromParent(); this.mesh.dispose(); this.geometry.dispose(); }
}
