import * as THREE from 'three';
import { Pass } from 'three/addons/postprocessing/Pass.js';

// Keep dependency internals here. Upgrades need the contract tests and the
// WebGL fixture in scripts/rendering-compat-test.mjs before changing these.
export const RENDERING_COMPAT = Object.freeze({ three: '186', n8ao: '2.0.1' });
export const SHADOW_FADE = .9;

export class RenderingCompatibilityError extends Error {
  constructor(detail) {
    super(`[rendering-compat] ${detail}. Review src/rendering-compat.js before upgrading the renderer dependencies.`);
    this.name = 'RenderingCompatibilityError';
  }
}

function requireCompatible(condition, detail) {
  if (!condition) throw new RenderingCompatibilityError(detail);
}

function checkThree(revision) {
  requireCompatible(revision === RENDERING_COMPAT.three, `Expected Three.js r${RENDERING_COMPAT.three}, found r${revision}`);
}

const warned = new Set();
function warnOnce(feature, error, warn) {
  if (warned.has(feature)) return;
  warned.add(feature);
  warn(`${error.message} ${feature} disabled.`);
}

const rotation = 'interleavedGradientNoise( gl_FragCoord.xy ) * PI2';
const pcf = `shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
				) * 0.2;`;
// The old 3x3 tent, folded into four hardware-blended taps with the same
// weights. Screen-pixel rotation crawls when the camera moves, so keep it fixed.
const tent = `vec2 place = shadowCoord.xy * shadowMapSize - 0.5, cell = floor(place), f = place - cell;
    vec2 lo = (3.0 - 2.0 * f) * 0.25, hi = (1.0 + 2.0 * f) * 0.25;
    vec2 a = (cell - 0.5 + (2.0 - f) / (3.0 - 2.0 * f)) * texelSize, b = (cell + 1.5 + f / (1.0 + 2.0 * f)) * texelSize;
    shadow = lo.x * lo.y * texture(shadowMap, vec3(a, shadowCoord.z)) + hi.x * lo.y * texture(shadowMap, vec3(b.x, a.y, shadowCoord.z))
      + lo.x * hi.y * texture(shadowMap, vec3(a.x, b.y, shadowCoord.z)) + hi.x * hi.y * texture(shadowMap, vec3(b, shadowCoord.z));
    vec2 edge = abs(shadowCoord.xy * 2.0 - 1.0);
    shadow = mix(shadow, 1.0, smoothstep(${SHADOW_FADE.toFixed(3)}, 1.0, max(edge.x, edge.y)));`;

export function patchShadowShader(source, revision = THREE.REVISION) {
  checkThree(revision);
  requireCompatible(typeof source === 'string', 'Missing shadowmap_pars_fragment');
  source = source.replaceAll('\r\n', '\n');
  requireCompatible(source.split(rotation).length === 3 && source.split(pcf).length === 2,
    'Shadow shader changed (expected two rotations and one five-tap PCF block)');
  return source.replaceAll(rotation, '0.0').replace(pcf, tent);
}

const shadowOwners = new WeakMap();
export function stabilizeShadowFiltering({ chunks = THREE.ShaderChunk, revision = THREE.REVISION, warn = console.warn } = {}) {
  try {
    checkThree(revision);
    const current = chunks.shadowmap_pars_fragment;
    if (shadowOwners.has(chunks) && shadowOwners.get(chunks) === current) return true;
    const patched = patchShadowShader(current, revision);
    // Commit only after every replacement has been checked. This is global for
    // the page and must run before any renderer compiles a scene material.
    chunks.shadowmap_pars_fragment = patched;
    shadowOwners.set(chunks, patched);
    return true;
  } catch (error) {
    if (!(error instanceof RenderingCompatibilityError)) throw error;
    warnOnce('Stable shadow filtering', error, warn);
    return false;
  }
}

const programOwners = new WeakMap();
export function rendererPrograms(renderer, { revision = THREE.REVISION, warn = console.warn } = {}) {
  if (programOwners.has(renderer)) return programOwners.get(renderer);
  // One extra reference per program for the context's lifetime. There is no
  // safe public release hook in r186's program cache. Do not unpin a live
  // renderer. Weak keys let a lost/replaced context's old programs go away.
  const kept = new WeakSet();
  let disabled = false;
  function visit(warm) {
    if (disabled) return;
    try {
      checkThree(revision);
      const programs = renderer.info?.programs;
      requireCompatible(Array.isArray(programs), 'Missing renderer.info.programs');
      // Validate the whole batch before taking any references.
      for (const program of programs) requireCompatible(Number.isSafeInteger(program?.usedTimes) && program.usedTimes > 0
        && program.usedTimes < Number.MAX_SAFE_INTEGER && typeof program.getUniforms === 'function', 'WebGLProgram reference count or uniform access changed');
      for (const program of programs) {
        if (warm) program.getUniforms();
        if (!kept.has(program)) { program.usedTimes++; kept.add(program); }
      }
    } catch (error) {
      if (!(error instanceof RenderingCompatibilityError)) throw error;
      disabled = true;
      warnOnce('Program retention and uniform warm-up', error, warn);
    }
  }
  const owner = { retain: () => visit(false), warm: () => visit(true) };
  programOwners.set(renderer, owner);
  return owner;
}

// renderer.compile omits shadows. Match WebGLShadowMap's side/map settings
// for each custom depth variant, without drawing the stand-ins.
const shadowSide = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
export function precompileShadowPrograms(renderer, scene, roots, lens) {
  if (THREE.REVISION !== RENDERING_COMPAT.three) return;
  const casters = new THREE.Group(), kinds = new Set();
  for (const root of roots) root.traverse(object => {
    const depth = object.customDepthMaterial, material = object.material, geometry = object.geometry;
    if (!object.castShadow || !depth || !material || Array.isArray(material)) return;
    const side = material.shadowSide ?? shadowSide[material.side], morphs = geometry.morphAttributes;
    const kind = [depth.uuid, side, Boolean(material.map), material.alphaTest > 0, object.isInstancedMesh, Boolean(object.instanceColor), Boolean(object.morphTexture),
      object.isSkinnedMesh, Boolean(geometry.attributes.normal), morphs.position?.length, morphs.normal?.length, morphs.color?.length].join();
    if (kinds.has(kind)) return;
    kinds.add(kind);
    depth.side = side; depth.map = material.map; depth.alphaMap = material.alphaMap; depth.alphaTest = material.alphaTest;
    const standIn = object.clone(false); standIn.material = depth; casters.add(standIn);
  });
  if (!casters.children.length) return;
  const target = new THREE.WebGLRenderTarget(1, 1), previous = renderer.getRenderTarget();
  try { renderer.setRenderTarget(target); renderer.compile(casters, lens, scene); }
  finally {
    renderer.setRenderTarget(previous); target.dispose();
    for (const standIn of casters.children) standIn.morphTexture?.dispose();
  }
}

export function patchPlayerFogShader(shader, chunks = THREE.ShaderChunk, revision = THREE.REVISION) {
  checkThree(revision);
  for (const [stage, name] of [['vertexShader', 'fog_pars_vertex'], ['vertexShader', 'fog_vertex'],
    ['fragmentShader', 'fog_pars_fragment'], ['fragmentShader', 'fog_fragment']]) {
    requireCompatible(shader[stage]?.split(`#include <${name}>`).length === 2 && typeof chunks[name] === 'string', `Missing ${name} shader hook`);
  }
  requireCompatible(chunks.fog_vertex.includes('vFogDepth = - mvPosition.z;')
    && chunks.fog_fragment.includes('smoothstep( fogNear, fogFar, vFogDepth )'), 'Three fog calculation changed');
  shader.vertexShader = shader.vertexShader
    .replace('#include <fog_pars_vertex>', `${chunks.fog_pars_vertex}\n#ifdef USE_FOG\nuniform vec3 playerFogOrigin;\nvarying vec3 vPlayerFogOffset;\n#endif`)
    .replace('#include <fog_vertex>', `${chunks.fog_vertex}\n#ifdef USE_FOG\nvPlayerFogOffset = mvPosition.xyz - (viewMatrix * vec4(playerFogOrigin, 1.0)).xyz;\n#endif`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <fog_pars_fragment>', `${chunks.fog_pars_fragment}\n#ifdef USE_FOG\nuniform bool playerFog;\nvarying vec3 vPlayerFogOffset;\n#endif`)
    .replace('#include <fog_fragment>', chunks.fog_fragment.replace('smoothstep( fogNear, fogFar, vFogDepth )',
      'smoothstep( fogNear, fogFar, playerFog ? length(vPlayerFogOffset) : vFogDepth )'));
}

const fogMaterials = new WeakMap(), fogRenderers = new WeakMap();
function bindPlayerFog(material) {
  if (!material.fog) return null;
  if (fogMaterials.has(material)) return fogMaterials.get(material);
  const uniforms = { playerFog: { value: false }, playerFogOrigin: { value: new THREE.Vector3() } };
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    compile.call(this, shader, renderer);
    patchPlayerFogShader(shader);
    Object.assign(shader.uniforms, uniforms);
  };
  material.customProgramCacheKey = function () {
    return `${key === THREE.Material.prototype.customProgramCacheKey ? compile.toString() : key.call(this)}:player-fog-v1`;
  };
  material.needsUpdate = true;
  fogMaterials.set(material, uniforms);
  return uniforms;
}

export function installPlayerFog(renderer, { revision = THREE.REVISION, warn = console.warn } = {}) {
  if (fogRenderers.has(renderer)) return fogRenderers.get(renderer);
  try {
    patchPlayerFogShader({ vertexShader: '#include <fog_pars_vertex>\n#include <fog_vertex>',
      fragmentShader: '#include <fog_pars_fragment>\n#include <fog_fragment>' }, THREE.ShaderChunk, revision);
    requireCompatible(typeof renderer.renderBufferDirect === 'function', 'Missing renderer.renderBufferDirect');
    const draw = renderer.renderBufferDirect;
    // Catch newly streamed/cloned materials before their first program is made.
    // Existing materials are bound during warm-up, without a per-frame scene walk.
    renderer.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
      const uniforms = bindPlayerFog(material);
      if (uniforms) {
        uniforms.playerFog.value = Boolean(scene?.fog?.isPlayerFog);
        if (uniforms.playerFog.value) uniforms.playerFogOrigin.value.copy(scene.fog.origin);
      }
      return draw.call(this, camera, scene, geometry, material, object, group);
    };
    const owner = { prepare(root) {
      root.traverse(object => {
        if (Array.isArray(object.material)) object.material.forEach(bindPlayerFog);
        else if (object.material) bindPlayerFog(object.material);
      });
    } };
    fogRenderers.set(renderer, owner);
    return owner;
  } catch (error) {
    if (!(error instanceof RenderingCompatibilityError)) throw error;
    warnOnce('Player-centred fog', error, warn);
    return null;
  }
}

function updateAOFog(material, fog, camera) {
  if (!material.uniforms.playerFog) {
    const source = material.fragmentShader, depth = 'float fogDepth = -getWorldPos(depth, vUv).z;';
    requireCompatible(source.split(depth).length === 2, 'N8AO fog calculation changed');
    material.fragmentShader = `uniform bool playerFog;\nuniform vec3 playerFogOriginView;\n${source}`
      .replace(depth, 'float fogDepth = playerFog ? distance(getWorldPos(depth, vUv), playerFogOriginView) : -getWorldPos(depth, vUv).z;');
    material.uniforms.playerFog = { value: false };
    material.uniforms.playerFogOriginView = { value: new THREE.Vector3() };
    material.needsUpdate = true;
  }
  material.uniforms.playerFog.value = Boolean(fog?.isPlayerFog);
  if (fog?.isPlayerFog) material.uniforms.playerFogOriginView.value.copy(fog.origin).applyMatrix4(camera.matrixWorldInverse);
}

const aoTargets = ['beautyRenderTarget', 'writeTargetInternal', 'readTargetInternal', 'accumulationRenderTarget',
  'depthDownsampleTarget', 'transparencyRenderTargetDWFalse', 'transparencyRenderTargetDWTrue'];
const aoQuads = ['effectShaderQuad', 'poissonBlurQuad', 'effectCompositerQuad', 'accumulationQuad', 'depthDownsampleQuad', 'depthCopyPass'];
const aoMaterials = ['standardDenoiseMaterial', 'neuralDenoiseMaterial'];

function checkN8AO(pass, halfRes) {
  for (const method of ['setSize', 'setDisplayMode', 'render', 'configureSampleDependentPasses', 'configureEffectCompositer']) {
    requireCompatible(typeof pass[method] === 'function', `N8AO missing ${method}()`);
  }
  requireCompatible(pass.dispose === Pass.prototype.dispose, 'N8AO now owns dispose(), review manual cleanup');
  requireCompatible(pass.camera?.isCamera && Number.isFinite(pass.width) && Number.isFinite(pass.height)
    && Number.isFinite(pass.configuration?.depthBufferType), 'N8AO camera, dimensions or depth configuration changed');
  for (const key of aoTargets.slice(0, 4)) {
    requireCompatible(pass[key]?.isWebGLRenderTarget && pass[key].texture?.isTexture, `N8AO missing target ${key}`);
  }
  if (halfRes) requireCompatible(pass.depthDownsampleTarget?.isWebGLRenderTarget
    && pass.depthDownsampleTarget.textures?.length === 2 && pass.depthDownsampleTarget.textures.every(texture => texture.isTexture),
    'N8AO half-resolution depth/normal target changed');
  requireCompatible(pass.beautyRenderTarget.depthTexture?.isDepthTexture, 'N8AO beauty target has no depth texture');
  for (const key of aoQuads.slice(0, halfRes ? 5 : 4)) {
    requireCompatible(pass[key]?.material?.isMaterial && pass[key]?._mesh?.geometry?.isBufferGeometry, `N8AO fullscreen resource ${key} changed`);
  }
  requireCompatible(pass.bluenoise?.isTexture && pass.standardDenoiseMaterial?.isMaterial, 'N8AO noise or denoise material changed');
}

function disposeN8AO(pass) {
  // 2.0.1 inherits Pass's empty dispose(). Only these resources belong to the
  // pass, never the caller's scene/camera. Read the current materials because
  // a projection switch replaces them. Some are shared by multiple fields.
  const resources = new Set();
  for (const key of [...aoTargets, ...aoMaterials, 'bluenoise']) if (typeof pass[key]?.dispose === 'function') resources.add(pass[key]);
  for (const key of aoQuads) {
    if (typeof pass[key]?.material?.dispose === 'function') resources.add(pass[key].material);
    if (typeof pass[key]?._mesh?.geometry?.dispose === 'function') resources.add(pass[key]._mesh.geometry);
  }
  for (const resource of resources) resource.dispose();
}

// The constructor comes from the lazy AO module, so importing this adapter
// never fetches N8AO or its shaders for players who have soft shading off.
export function createN8AOIntegration(N8AOPass, version, scene, camera, configuration, revision = THREE.REVISION) {
  checkThree(revision);
  requireCompatible(version === RENDERING_COMPAT.n8ao, `Expected N8AO ${RENDERING_COMPAT.n8ao}, found ${version}`);
  requireCompatible(N8AOPass.prototype.dispose === Pass.prototype.dispose, 'N8AO now owns dispose(), review manual cleanup');
  const pass = new N8AOPass(scene, camera, 2, 2);
  try {
    checkN8AO(pass, false);
    for (const key of Object.keys(configuration)) requireCompatible(key in pass.configuration, `N8AO missing configuration.${key}`);
    Object.assign(pass.configuration, configuration);
    pass.setDisplayMode('AO');
    checkN8AO(pass, true);
    updateAOFog(pass.effectCompositerQuad.material, scene.fog, camera);
    // AO and depth must sample the same silhouette before denoising it.
    for (const key of aoTargets.slice(1, 4)) pass[key].texture.minFilter = pass[key].texture.magFilter = THREE.NearestFilter;
    pass.beautyRenderTarget.texture.type = THREE.UnsignedByteType;
  } catch (error) { disposeN8AO(pass); throw error; }
  let disposed = false;
  return {
    get depthTarget() { return pass.beautyRenderTarget; },
    update(camera, width, height) {
      const cameraChanged = Boolean(pass.camera.isOrthographicCamera) !== Boolean(camera.isOrthographicCamera);
      pass.camera = camera;
      if (pass.width !== width || pass.height !== height) pass.setSize(width, height);
      if (cameraChanged) {
        pass.configureSampleDependentPasses();
        pass.configureEffectCompositer(pass.configuration.depthBufferType, camera.isOrthographicCamera);
      }
      updateAOFog(pass.effectCompositerQuad.material, scene.fog, camera);
    },
    render(renderer, target) { pass.render(renderer, target); },
    dispose() { if (!disposed) { disposed = true; disposeN8AO(pass); } },
  };
}
