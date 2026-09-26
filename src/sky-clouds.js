import * as THREE from 'three';

// Low-poly clouds: a layer of flat-based cumulus 750 m up, over a 12 km
// patch of sky that wraps round the camera and drifts with the wind. The
// camera's far plane stops just past the fog (about 200 m at its nearest),
// so each cloud is drawn shrunk to 60 m from the lens by its own distance,
// which keeps its true size and shape on screen: small and squashed toward
// the horizon, broad overhead, and passing slowly as the car drives. They
// are drawn first and without depth, so everything else draws over them,
// and fade into the sky's own colour in the distance. One instanced draw,
// with no shadows and no AO prepass.
const NEAR = 60, ALTITUDE = 750, SPAN = 12000, COUNT = 60;

// A puff: a rounded low-poly lobe with its underside cut flat
function puff() {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, Math.max(-.3, p.getY(i)));
  g.deleteAttribute('uv');
  return g;
}

// Each cloud is a heap of puffs whose flat undersides share its base, the
// biggest near its middle. Its own fixed stream, never the city's.
function layout() {
  let state = 0x6d2b79f5;
  const random = () => { state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x9e3779b9) >>> 0; return state / 4294967296; };
  const clouds = [];
  for (let i = 0; i < COUNT; i++) {
    const width = 420 + random() ** 1.4 * 1100, depth = width * (.45 + random() * .35), count = 4 + Math.floor(random() * 4), squash = .5 + random() * .2;
    const puffs = [];
    for (let k = 0; k < count; k++) {
      const t = k / (count - 1) - .5, middle = 1 - Math.abs(t * 2);
      const radius = width * (.2 + middle * .14 + random() * .07), rise = middle * random() * width * .05;
      puffs.push({ along: t * width * .72 + (random() - .5) * width * .1, out: (random() - .5) * depth * .55, up: rise + radius * squash * .3, radius, squash });
    }
    // (most with a heap on top, a little off the middle)
    if (random() < .65) {
      const radius = width * (.17 + random() * .08);
      puffs.push({ along: (random() - .5) * width * .3, out: (random() - .5) * depth * .2, up: width * (.1 + random() * .05) + radius * squash * .3, radius, squash });
    }
    clouds.push({ x: random() * SPAN, s: random() * SPAN, yaw: random() * Math.PI, puffs, threshold: random(), grown: 0 });
  }
  // (in the order they come out, so the clouds a sky shows are the first ones drawn)
  return clouds.sort((a, b) => a.threshold - b.threshold);
}

const wrap = value => value - Math.floor(value / SPAN + .5) * SPAN;

export class SkyClouds {
  constructor(scene) {
    this.clouds = layout();
    const count = this.clouds.reduce((sum, cloud) => sum + cloud.puffs.length, 0);
    this.material = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true, fog: false, depthWrite: false });
    // Fade to the sky's colour with distance, after tone mapping, as the
    // background is cleared to it
    this.haze = { value: new THREE.Color() };
    this.material.onBeforeCompile = shader => {
      shader.uniforms.cloudHaze = this.haze;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCloudDirection;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvCloudDirection = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz - cameraPosition;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCloudDirection;\nuniform vec3 cloudHaze;')
        .replace('#include <tonemapping_fragment>', '#include <tonemapping_fragment>\ngl_FragColor.rgb = mix(cloudHaze, gl_FragColor.rgb, .9 * smoothstep(.035, .22, normalize(vCloudDirection).y));');
    };
    this.material.customProgramCacheKey = () => 'sky-clouds';
    this.mesh = new THREE.InstancedMesh(puff(), this.material, count);
    this.mesh.name = 'sky-clouds';
    this.mesh.frustumCulled = false; this.mesh.renderOrder = -10;
    this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    this.mesh.userData.ambientOcclusion = false;
    // (the instances carry the clouds' whole placement)
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    scene.add(this.group);
    this.cover = -1; this.heavy = 1; this.wind = { x: 0, s: 0 };
    this.matrix = new THREE.Matrix4(); this.eye = new THREE.Vector3();
    this.setCover(0);
  }
  // A cloud shows once the cover passes its threshold, growing in as it does,
  // and a heavy sky's clouds are bigger. Only the clouds out are drawn.
  setCover(cover) {
    if (Math.abs(cover - this.cover) < .002) return;
    this.cover = cover; this.heavy = 1 + Math.max(0, cover - .5) * 1.1;
    let drawn = 0, index = 0;
    for (const cloud of this.clouds) {
      cloud.grown = THREE.MathUtils.clamp((cover * 1.1 - cloud.threshold) / .1, 0, 1);
      index += cloud.puffs.length;
      if (cloud.grown > 0) drawn = index;
    }
    this.mesh.count = drawn;
  }
  setWeather(state, background, blend = 1, dt = 0) {
    this.setCover(this.cover < 0 || blend >= 1 ? state.cloudCover : this.cover + (state.cloudCover - this.cover) * blend);
    this.material.color.lerp(state.cloudColor, blend);
    this.material.emissive.copy(this.material.color).multiplyScalar(.45 * Math.min(1, state.skyIntensity / 1.6) * Math.min(1, state.sunIntensity / 1.2));
    this.haze.value.copy(background);
    if (dt > 0) { this.wind.x += dt * 9; this.wind.s += dt * 4; }
  }
  // Round the lens about to draw, each cloud where its place in the sky is
  // seen from there (map s is measured from the world's current origin);
  // nothing to draw over an overhead map
  follow(camera, origin = 0, stereo = false) {
    this.group.visible = stereo || Boolean(camera.isPerspectiveCamera);
    if (!this.group.visible) return;
    const eye = camera.getWorldPosition(this.eye), u = eye.x, s = origin - eye.z;
    let index = 0;
    for (const cloud of this.clouds) {
      if (index >= this.mesh.count) break;
      const dx = wrap(cloud.x + this.wind.x - u), ds = wrap(cloud.s + this.wind.s - s);
      // (shrinking away before the patch wraps, far out in the haze)
      const edge = THREE.MathUtils.clamp((SPAN / 2 - Math.max(Math.abs(dx), Math.abs(ds))) / 1500, 0, 1);
      const k = NEAR / Math.hypot(dx, ALTITUDE, ds), size = k * this.heavy * cloud.grown * edge;
      const cx = eye.x + dx * k, cy = eye.y + ALTITUDE * k, cz = eye.z - ds * k, cos = Math.cos(cloud.yaw), sin = Math.sin(cloud.yaw);
      for (const p of cloud.puffs) {
        const along = p.along * size, out = p.out * size, r = p.radius * size;
        this.matrix.set(
          r * cos, 0, r * sin, cx + along * cos + out * sin,
          0, r * p.squash, 0, cy + p.up * size,
          -r * sin, 0, r * cos, cz - along * sin + out * cos,
          0, 0, 0, 1);
        this.mesh.setMatrixAt(index++, this.matrix);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
