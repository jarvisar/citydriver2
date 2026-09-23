import * as THREE from 'three';
import { randomAt } from './route.js';

const WIDTH = 240, HEIGHT = 160, DEPTH = 280, COUNT = 1800, NEAR_COUNT = 600;
const wrap = (value, extent) => value - Math.floor(value / extent) * extent - extent / 2;

// One reusable point cloud, like rain: no textures, shadows or extra passes.
// World-space wrapping keeps flakes from travelling sideways with the car.
export class Snowfall {
  constructor() {
    this.seeds = new Float32Array(COUNT * 4);
    const sizes = new Float32Array(COUNT), near = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      this.seeds.set([randomAt(i, 81) * WIDTH, randomAt(i, 82) * HEIGHT,
        randomAt(i, 83) * DEPTH, 2.2 + randomAt(i, 84) * 2.4], i * 4);
      sizes[i] = .55 + randomAt(i, 85) ** 2 * .9;
      near[i] = i < NEAR_COUNT ? 1 : 0;
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('flakeSize', new THREE.BufferAttribute(sizes, 1));
    this.geometry.setAttribute('flakeNear', new THREE.BufferAttribute(near, 1));
    this.geometry.setAttribute('snowSeed', new THREE.BufferAttribute(this.seeds, 4));
    this.uniforms = { snowTime: { value: 0 }, snowOrigin: { value: 0 } };
    this.material = new THREE.PointsMaterial({ color: '#f0f6ff', size: 1, transparent: true,
      opacity: .85, depthWrite: false, sizeAttenuation: false, toneMapped: false });
    this.material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = `attribute float flakeSize; attribute float flakeNear;
        attribute vec4 snowSeed; uniform float snowTime; uniform float snowOrigin;
        varying float vFlakeAlpha;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
        #include <project_vertex>
        bool overhead = projectionMatrix[2][3] != -1.0;
        vec3 snowExtent = vec3(1.25 / projectionMatrix[0][0], 1.25 / projectionMatrix[1][1], 80.0);
        vec3 snowLocal = vec3(0.0);
        if (overhead) {
          // Fill the orthographic frustum, with the wrap/fade margin offscreen.
          // Use the whole particle budget instead of concentrating it at the car.
          vec3 seed = snowSeed.xyz / vec3(${WIDTH}.0, ${HEIGHT}.0, ${DEPTH}.0);
          vec3 drift = vec3(snowTime * 0.65 + sin(snowTime * 0.6 + snowSeed.w * 7.0) * 1.8,
            -snowTime * snowSeed.w, sin(snowTime * 0.4 + snowSeed.w * 11.0) * 1.4);
          vec3 logicalCamera = cameraPosition - vec3(0.0, 0.0, snowOrigin);
          snowLocal = mod(seed * snowExtent * 2.0 + mat3(viewMatrix) * (drift - logicalCamera),
            snowExtent * 2.0) - snowExtent;
          // Keep a layer of air in front of the city even at the bottom of a
          // wide scenic view. Depth testing still lets buildings occlude flakes.
          float focusDepth = -(modelViewMatrix * vec4(0.0, -55.0, 0.0, 1.0)).z;
          float layerDepth = max(90.0, focusDepth - 100.0 - 1.0 / projectionMatrix[1][1]);
          mvPosition = vec4(snowLocal + vec3(0.0, 0.0, -layerDepth), 1.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `);
      shader.vertexShader = shader.vertexShader.replace('gl_PointSize = size;', `
        float perspective = projectionMatrix[2][3] == -1.0 ? clamp(90.0 / max(8.0, -mvPosition.z), 0.6, 2.5) : 1.0;
        gl_PointSize = size * flakeSize * 4.0 * perspective;
        vec3 extent = mix(vec3(${WIDTH / 2}.0, ${HEIGHT / 2}.0, ${DEPTH / 2}.0), vec3(36.0, 35.0, 36.0), flakeNear);
        vec3 edge = abs(position + vec3(0.0, 40.0 * flakeNear, 0.0)) / extent;
        vFlakeAlpha = (1.0 - smoothstep(0.7, 1.0, max(edge.x, max(edge.y, edge.z))))
          * smoothstep(2.0, 8.0, -mvPosition.z);
        if (overhead) {
          vec3 viewEdge = abs(snowLocal) / snowExtent;
          vFlakeAlpha = (1.0 - smoothstep(0.8, 1.0, max(viewEdge.x, viewEdge.y)))
            * (1.0 - smoothstep(0.7, 1.0, viewEdge.z));
        }
      `);
      shader.fragmentShader = 'varying float vFlakeAlpha;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        float radius = length(gl_PointCoord - vec2(0.5));
        if (radius > 0.5) discard;
        diffuseColor.a *= (1.0 - smoothstep(0.12, 0.5, radius)) * vFlakeAlpha;
      `);
    };
    this.material.customProgramCacheKey = () => 'city-snow-v2';
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'falling-snow'; this.points.frustumCulled = false;
  }
  update(time, anchor, origin) {
    this.uniforms.snowTime.value = time;
    this.uniforms.snowOrigin.value = origin;
    this.points.position.set(anchor.x, anchor.y, anchor.z + origin);
    const positions = this.geometry.attributes.position;
    for (let i = 0; i < COUNT; i++) {
      const n = i * 4, phase = this.seeds[n + 3];
      // Reserve a third of the same budget for street-level flakes so driving
      // cameras see snowfall nearby, not just high above the rooftops.
      const near = i < NEAR_COUNT, yOffset = near ? 40 : 0;
      positions.setXYZ(i,
        wrap(this.seeds[n] + time * .65 + Math.sin(time * .6 + phase * 7) * 1.8 - anchor.x, near ? 72 : WIDTH),
        wrap(this.seeds[n + 1] - time * phase - anchor.y + yOffset, near ? 70 : HEIGHT) - yOffset,
        wrap(this.seeds[n + 2] + Math.sin(time * .4 + phase * 11) * 1.4 - anchor.z, near ? 72 : DEPTH));
    }
    positions.needsUpdate = true;
  }
  dispose() { this.points.removeFromParent(); this.geometry.dispose(); this.material.dispose(); }
}
