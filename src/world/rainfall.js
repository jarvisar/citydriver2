import * as THREE from 'three';
import { randomAt } from './route.js';

const WIDTH = 300, HEIGHT = 200, DEPTH = 360, COUNT = 1900;
const wrap = (value, extent) => value - Math.floor(value / extent) * extent - extent / 2;

// Rain in a world-anchored volume, built like the alpine snowfall: one draw
// call of points, wrapped around the car. Each point is masked to a thin
// vertical streak instead of a soft disc and falls straight down. Nearer
// drops draw longer; the distant ones thin out into a grey veil.
export class Rainfall {
  constructor() {
    const positions = new Float32Array(COUNT * 3), sizes = [], opacity = [];
    this.seeds = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT; i++) {
      this.seeds.set([randomAt(i, 64) * WIDTH, randomAt(i, 65) * HEIGHT, randomAt(i, 66) * DEPTH, 21 + randomAt(i, 67) * 9], i * 4);
      sizes.push(.75 + randomAt(i, 69) ** 2 * 1.4);
      opacity.push(.16 + randomAt(i, 70) * .3);
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('dropSize', new THREE.Float32BufferAttribute(sizes, 1));
    this.geometry.setAttribute('dropOpacity', new THREE.Float32BufferAttribute(opacity, 1));
    this.material = new THREE.PointsMaterial({ color: '#d5dee6', size: 1, transparent: true,
      opacity: .9, depthWrite: false, sizeAttenuation: false, toneMapped: false });
    this.material.onBeforeCompile = shader => {
      shader.vertexShader = `attribute float dropSize; attribute float dropOpacity;
        varying float vDropAlpha; varying vec2 vDropDirection;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('gl_PointSize = size;', `
        gl_PointSize = size * dropSize * 10.0 * clamp(430.0 / max(80.0, -mvPosition.z), 0.7, 1.5);
        // Project world-down into the point sprite, including perspective
        // and viewport aspect, so the streak follows the actual fall.
        vec4 fallClip = projectionMatrix * viewMatrix * vec4(0.0, -1.0, 0.0, 0.0);
        vec2 fallScreen = fallClip.xy * gl_Position.w - gl_Position.xy * fallClip.w;
        fallScreen.x *= projectionMatrix[1][1] / projectionMatrix[0][0];
        fallScreen.y *= -1.0;
        vDropDirection = length(fallScreen) > 0.00001 ? normalize(fallScreen) : vec2(0.0, 1.0);
        vec3 edge = abs(position) / vec3(${WIDTH / 2}.0, ${HEIGHT / 2}.0, ${DEPTH / 2}.0);
        vDropAlpha = dropOpacity * (1.0 - smoothstep(0.72, 1.0, max(edge.x, max(edge.y, edge.z))));
      `);
      shader.fragmentShader = 'varying float vDropAlpha; varying vec2 vDropDirection;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        vec2 d = gl_PointCoord - vec2(0.5);
        // A soft, tapered streak with a finer tail above the falling drop.
        float along = dot(d, vDropDirection);
        float across = abs(dot(d, vec2(-vDropDirection.y, vDropDirection.x)));
        if (across > 0.07) discard;
        float width = mix(0.035, 0.065, smoothstep(-0.45, 0.3, along));
        float ends = 1.0 - smoothstep(0.28, 0.5, abs(along));
        diffuseColor.a *= (1.0 - smoothstep(width * 0.35, width, across)) * ends * vDropAlpha;
      `);
    };
    this.material.customProgramCacheKey = () => 'city-rain-streaks-v2';
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'falling-rain'; this.points.frustumCulled = false;
  }
  update(time, anchor, origin) {
    this.points.position.set(anchor.x, anchor.y, anchor.z + origin);
    const positions = this.geometry.attributes.position;
    for (let i = 0; i < COUNT; i++) {
      const n = i * 4;
      positions.setXYZ(i,
        wrap(this.seeds[n] - anchor.x, WIDTH),
        wrap(this.seeds[n + 1] - time * this.seeds[n + 3] - anchor.y, HEIGHT),
        wrap(this.seeds[n + 2] - anchor.z, DEPTH));
    }
    positions.needsUpdate = true;
  }
  dispose() { this.points.removeFromParent(); this.geometry.dispose(); this.material.dispose(); }
}
