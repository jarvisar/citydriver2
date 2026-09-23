import * as THREE from 'three';

// The sea and the river: citydriver's river water, with the current following
// the water's own direction instead of the old grid's river axes. Small waves
// displace the surface; analytic normals follow them, and the hemisphere sky
// is reflected as a soft sheen.
export function createWaterMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: '#397780', roughness: .3, metalness: .04, flatShading: true });
  const time = { value: 0 }, origin = { value: 0 };
  material.userData.time = time;
  material.userData.origin = origin;
  material.customProgramCacheKey = () => 'citydriver-water-v1';
  material.onBeforeCompile = shader => {
    shader.uniforms.riverTime = time;
    shader.uniforms.riverOrigin = origin;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `
      #include <common>
      uniform float riverTime;
      uniform float riverOrigin;
      varying vec2 vRiverPosition;
      attribute vec2 flowDirection;
      varying vec2 vFlowDirection;
    `).replace('#include <project_vertex>', `
      vec4 riverPoint = vec4(transformed, 1.0);
      vRiverPosition = (modelMatrix * riverPoint).xz - vec2(0.0, riverOrigin);
      vFlowDirection = flowDirection;
      float riverWave = 0.075 * sin(dot(vRiverPosition, vec2(0.18, 0.24)) - riverTime * 0.72)
        + 0.045 * sin(dot(vRiverPosition, vec2(-0.32, 0.16)) - riverTime * 0.53);
      transformed.y += riverWave;
      #include <project_vertex>
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      uniform float riverTime;
      varying vec2 vRiverPosition;
      varying vec2 vFlowDirection;
      float riverHash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      vec2 riverCurrent(vec2 p) {
        float lane = floor(p.x / 4.0);
        float laneSeed = riverHash(vec2(lane, 37.0));
        float along = p.y - riverTime * (1.35 + laneSeed * 0.35) + laneSeed * 43.0;
        float segment = floor(along / 28.0);
        float seed = riverHash(vec2(lane, segment));
        float y = mod(along, 28.0) - 14.0;
        float halfLength = 4.5 + seed * 6.5;
        float taper = max(0.0, 1.0 - abs(y) / halfLength);
        float x = mod(p.x, 4.0) - 2.0 - (laneSeed - 0.5) * 1.4 - (seed - 0.5) * 0.5;
        x += (abs(y + halfLength * 0.25) - abs(y - halfLength * 0.4)) * (seed - 0.5) * 0.06;
        float aa = max(fwidth(x), 0.035);
        float width = (0.25 + seed * 0.4) * taper;
        float ribbon = (1.0 - smoothstep(width - aa, width + aa, abs(x))) * taper;
        float glint = (1.0 - smoothstep(0.09 - aa, 0.09 + aa, abs(x - width * 0.55))) * taper;
        float distanceFade = 1.0 - smoothstep(0.4, 1.4, length(fwidth(p)));
        return vec2(ribbon, glint) * (0.55 + seed * 0.45) * distanceFade;
      }
    `).replace('#include <color_fragment>', `
      #include <color_fragment>
      // Facets run along the flow: across the current for x, with it for y.
      vec2 flow = normalize(vFlowDirection + vec2(0.0001, 0.0));
      vec2 address = vec2(dot(vRiverPosition, vec2(flow.y, -flow.x)), dot(vRiverPosition, flow));
      vec2 current = riverCurrent(address);
      diffuseColor.rgb *= 1.0 + current.x * 0.12;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.57, 0.58), current.y * 0.12);
    `).replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      vec2 slope = vec2(0.18, 0.24) * 0.075
        * cos(dot(vRiverPosition, vec2(0.18, 0.24)) - riverTime * 0.72)
        + vec2(-0.32, 0.16) * 0.045
        * cos(dot(vRiverPosition, vec2(-0.32, 0.16)) - riverTime * 0.53);
      normal = normalize(mat3(viewMatrix) * vec3(-slope.x, 1.0, -slope.y));
      nonPerturbedNormal = normal;
      vec3 riverView = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
      float riverFresnel = 0.035 + 0.4 * pow(1.0 - max(dot(normal, riverView), 0.0), 5.0);
    `).replace('#include <lights_fragment_end>', `
      #include <lights_fragment_end>
      vec3 riverReflection = reflect(-riverView, normal);
      vec3 riverSky = vec3(0.0);
      #if NUM_HEMI_LIGHTS > 0
        for (int i = 0; i < NUM_HEMI_LIGHTS; i++) {
          float skyFacing = clamp(dot(riverReflection, hemisphereLights[i].direction) * 0.5 + 0.5, 0.0, 1.0);
          riverSky += mix(hemisphereLights[i].groundColor, hemisphereLights[i].skyColor, skyFacing);
        }
      #endif
      reflectedLight.indirectSpecular += riverSky * riverFresnel;
    `);
  };
  return material;
}
