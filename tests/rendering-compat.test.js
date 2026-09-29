import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { N8AOPass } from 'n8ao';
import n8aoPackage from 'n8ao/package.json' with { type: 'json' };
import { RENDERING_COMPAT, RenderingCompatibilityError, patchShadowShader, stabilizeShadowFiltering,
  rendererPrograms, createN8AOIntegration, precompileShadowPrograms, patchPlayerFogShader, installPlayerFog } from '../src/rendering-compat.js';
import { PlayerFog } from '../src/player-fog.js';
import { AmbientOcclusion } from '../src/ambient-occlusion.js';
import { AmbientOcclusion as Effect } from '../src/ambient-occlusion-pass.js';

const originalShadow = THREE.ShaderChunk.shadowmap_pars_fragment;
const aoConfiguration = { halfRes: true, autoRenderBeauty: false, transparencyAware: false, gammaCorrection: false };

test('player fog composes with material hooks, follows the drawing scene and binds new materials before first use', () => {
  const material = new THREE.MeshBasicMaterial(), scene = new THREE.Scene(), fog = new PlayerFog('white');
  fog.origin.set(5, 7, 9); scene.fog = fog;
  let compiled, draws = 0;
  material.onBeforeCompile = shader => { shader.uniforms.existing = { value: 3 }; };
  material.customProgramCacheKey = () => 'existing-custom-material';
  const renderer = { renderBufferDirect(camera, drawnScene, geometry, drawnMaterial) {
    if (!compiled) {
      compiled = { vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader, uniforms: {} };
      drawnMaterial.onBeforeCompile(compiled, this);
    }
    draws++;
  } };
  const owner = installPlayerFog(renderer);
  assert.equal(installPlayerFog(renderer), owner);
  renderer.renderBufferDirect(null, scene, null, material);
  assert.equal(draws, 1); assert.equal(compiled.uniforms.existing.value, 3);
  assert.equal(compiled.uniforms.playerFog.value, true);
  assert.deepEqual(compiled.uniforms.playerFogOrigin.value, fog.origin);
  assert.match(material.customProgramCacheKey(), /^existing-custom-material:/);
  fog.origin.set(50, 70, 90); renderer.renderBufferDirect(null, scene, null, material);
  assert.deepEqual(compiled.uniforms.playerFogOrigin.value, fog.origin);
  scene.fog = new THREE.Fog('white'); renderer.renderBufferDirect(null, scene, null, material);
  assert.equal(compiled.uniforms.playerFog.value, false, 'ordinary fog on a shared material still works');
  const clone = material.clone(); compiled = null; scene.fog = fog;
  renderer.renderBufferDirect(null, scene, null, clone);
  assert.equal(compiled.uniforms.playerFog.value, true, 'clones created after warm-up get fog too');
  material.dispose(); clone.dispose();
});

test('unknown fog shader layouts cannot leave a partly patched shader', () => {
  const shader = { vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader };
  const before = { ...shader };
  assert.throws(() => patchPlayerFogShader(shader, { ...THREE.ShaderChunk, fog_fragment: 'changed' }), RenderingCompatibilityError);
  assert.deepEqual(shader, before);
  assert.throws(() => patchPlayerFogShader(shader, THREE.ShaderChunk, '999'), RenderingCompatibilityError);
});

test('AO uses the same player-centred fog after camera motion and projection changes', () => {
  const { integration, pass, scene } = aoFixture();
  scene.fog = new PlayerFog('white'); scene.fog.origin.set(3, 4, -100);
  try {
    for (const camera of [new THREE.PerspectiveCamera(), new THREE.OrthographicCamera(), new THREE.PerspectiveCamera()]) {
      camera.position.set(12, 18, 30); camera.lookAt(scene.fog.origin); camera.updateMatrixWorld();
      integration.update(camera, 640, 480);
      const uniforms = pass.effectCompositerQuad.material.uniforms;
      assert.equal(uniforms.playerFog.value, true);
      assert.deepEqual(uniforms.playerFogOriginView.value, scene.fog.origin.clone().applyMatrix4(camera.matrixWorldInverse));
    }
    scene.fog = null; integration.update(new THREE.PerspectiveCamera(), 640, 480);
    assert.equal(pass.effectCompositerQuad.material.uniforms.playerFog.value, false);
  } finally { integration.dispose(); }
});

test('installed renderer dependencies match the reviewed integration', () => {
  assert.equal(THREE.REVISION, RENDERING_COMPAT.three);
  assert.equal(n8aoPackage.version, RENDERING_COMPAT.n8ao);
  const threePackage = JSON.parse(readFileSync(new URL('../node_modules/three/package.json', import.meta.url)));
  assert.equal(threePackage.version, `0.${RENDERING_COMPAT.three}.0`, 'review patch releases too');
  assert.doesNotThrow(() => patchShadowShader(originalShadow));
});

test('shadow patch owns one global installation and preserves unrelated shader code', () => {
  const chunks = { shadowmap_pars_fragment: originalShadow };
  assert.equal(stabilizeShadowFiltering({ chunks }), true);
  const patched = chunks.shadowmap_pars_fragment;
  assert.equal(stabilizeShadowFiltering({ chunks }), true);
  assert.equal(chunks.shadowmap_pars_fragment, patched);
  assert.equal(patched.split('vec2 place =').length, 2);
  const tail = originalShadow.slice(originalShadow.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )'));
  assert.equal(patched.slice(patched.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )')),
    tail.replaceAll('interleavedGradientNoise( gl_FragCoord.xy ) * PI2', '0.0'));
});

test('an incompatible shadow chunk is never partly patched and warns only once', () => {
  const warnings = [];
  for (const source of [undefined, originalShadow.replace('vogelDiskSample( 2, 5, phi )', 'changedSample()'),
    originalShadow.replace('interleavedGradientNoise( gl_FragCoord.xy ) * PI2', 'newRotation()'), originalShadow + originalShadow]) {
    const chunks = { shadowmap_pars_fragment: source };
    assert.throws(() => patchShadowShader(source), RenderingCompatibilityError);
    assert.equal(stabilizeShadowFiltering({ chunks, warn: text => warnings.push(text) }), false);
    assert.equal(chunks.shadowmap_pars_fragment, source);
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /rendering-compat/);
  assert.throws(() => patchShadowShader(originalShadow, '999'), /Expected Three.js/);
  const chunks = { shadowmap_pars_fragment: originalShadow };
  assert.equal(stabilizeShadowFiltering({ chunks, revision: '999' }), false);
  assert.equal(chunks.shadowmap_pars_fragment, originalShadow);
});

const program = (usedTimes = 1) => ({ usedTimes, reads: 0, getUniforms() { this.reads++; } });
test('one renderer owns each program reference, including equal-sized replacement caches', () => {
  const a = program(2), b = program(), renderer = { info: { programs: [a] } };
  const owner = rendererPrograms(renderer);
  assert.equal(rendererPrograms(renderer), owner);
  owner.retain(); owner.retain(); owner.warm();
  assert.equal(a.usedTimes, 3); assert.equal(a.reads, 1);
  renderer.info.programs.push(b); owner.retain();
  assert.equal(b.usedTimes, 2); assert.equal(a.usedTimes, 3);
  const c = program(), d = program();
  renderer.info = { programs: [c, d] }; // WebGL context restored, same count
  owner.retain(); owner.warm();
  assert.equal(c.usedTimes, 2); assert.equal(d.usedTimes, 2);
  assert.equal(c.reads, 1); assert.equal(d.reads, 1);
  renderer.info.programs[1] = b; owner.retain();
  assert.equal(b.usedTimes, 2, 'identity, not the array length or position');
});

test('invalid program contracts leave the whole new batch alone and stop retrying', () => {
  const warnings = [], good = program();
  const renderer = { info: { programs: [good, program(NaN)] } };
  const owner = rendererPrograms(renderer, { warn: text => warnings.push(text) });
  owner.warm(); owner.retain();
  assert.equal(good.usedTimes, 1); assert.equal(good.reads, 0);
  assert.equal(warnings.length, 1);
  renderer.info.programs = [good]; owner.retain();
  assert.equal(good.usedTimes, 1);
  for (const usedTimes of [0, -1, Infinity, .5, '1', Number.MAX_SAFE_INTEGER]) {
    const p = program(usedTimes);
    rendererPrograms({ info: { programs: [p] } }).retain();
    assert.equal(p.usedTimes, usedTimes);
  }
  const other = program();
  rendererPrograms({ info: { programs: [other] } }, { revision: '999' }).warm();
  assert.equal(other.usedTimes, 1); assert.equal(other.reads, 0);
});

function aoFixture(PassClass = N8AOPass) {
  let pass;
  class CapturedPass extends PassClass { constructor(...args) { super(...args); pass = this; } }
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera();
  const integration = createN8AOIntegration(CapturedPass, n8aoPackage.version, scene, camera, aoConfiguration);
  return { integration, pass, scene, camera };
}

test('real N8AO targets keep the filters, depth format and half-resolution layout', () => {
  const { integration, pass } = aoFixture();
  try {
    integration.update(new THREE.PerspectiveCamera(), 640, 480);
    assert.equal(integration.depthTarget, pass.beautyRenderTarget);
    assert.equal(pass.beautyRenderTarget.texture.type, THREE.UnsignedByteType);
    assert.equal(pass.beautyRenderTarget.depthTexture.isDepthTexture, true);
    assert.deepEqual([pass.width, pass.height], [640, 480]);
    for (const target of [pass.writeTargetInternal, pass.readTargetInternal, pass.accumulationRenderTarget]) {
      assert.equal(target.texture.minFilter, THREE.NearestFilter); assert.equal(target.texture.magFilter, THREE.NearestFilter);
      assert.deepEqual([target.width, target.height], [320, 240]);
    }
    assert.equal(pass.depthDownsampleTarget.textures.length, 2);
    assert.equal(pass.configuration.renderMode, 1, 'AO only');
  } finally { integration.dispose(); }
});

test('N8AO recompiles all three projection-dependent shaders only when projection changes', () => {
  const { integration, pass, camera } = aoFixture();
  const materials = () => [pass.effectShaderQuad.material, pass.poissonBlurQuad.material, pass.effectCompositerQuad.material];
  try {
    const ortho = materials();
    ortho.forEach(material => assert.match(material.fragmentShader, /#define ORTHO/));
    integration.update(camera, 800, 600);
    assert.deepEqual(materials(), ortho, 'a resize does not change projection');
    integration.update(new THREE.PerspectiveCamera(), 800, 600);
    const perspective = materials();
    perspective.forEach((material, i) => {
      assert.notEqual(material, ortho[i]); assert.doesNotMatch(material.fragmentShader, /#define ORTHO/);
    });
    integration.update(new THREE.PerspectiveCamera(), 640, 480);
    assert.deepEqual(materials(), perspective, 'another perspective camera reuses shaders');
    integration.update(camera, 640, 480);
    materials().forEach(material => assert.match(material.fragmentShader, /#define ORTHO/));
  } finally { integration.dispose(); }
});

function watchResources(pass) {
  const counts = new Map();
  const watch = value => {
    if (!value?.addEventListener || counts.has(value)) return;
    counts.set(value, 0); value.addEventListener('dispose', () => counts.set(value, counts.get(value) + 1));
  };
  // Independent enumeration catches new upstream resources omitted by cleanup.
  for (const value of Object.values(pass)) {
    if (value?.isWebGLRenderTarget || value?.isTexture || value?.isMaterial) watch(value);
    watch(value?.material); watch(value?._mesh?.geometry);
  }
  return counts;
}

test('N8AO cleanup disposes every current owned resource once and leaves scene resources alone', () => {
  const { integration, pass, scene, camera } = aoFixture();
  integration.update(new THREE.PerspectiveCamera(), 800, 600);
  const counts = watchResources(pass);
  scene.addEventListener('dispose', () => assert.fail('scene belongs to the game'));
  camera.addEventListener('dispose', () => assert.fail('camera belongs to the game'));
  integration.dispose(); integration.dispose();
  for (const [resource, count] of counts) assert.equal(count, 1, resource.constructor.name);
});

test('N8AO rejects unknown versions before allocating and changed layouts before rendering', () => {
  class NeverConstruct { constructor() { assert.fail('unsupported version allocated resources'); } }
  assert.throws(() => createN8AOIntegration(NeverConstruct, '9.0.0'), /Expected N8AO/);
  assert.throws(() => createN8AOIntegration(NeverConstruct, n8aoPackage.version, null, null, {}, '999'), /Expected Three.js/);
  class NewDispose extends N8AOPass { dispose() {} }
  assert.throws(() => aoFixture(NewDispose), /now owns dispose/);
  let counts;
  class ChangedLayout extends N8AOPass {
    constructor(...args) { super(...args); counts = watchResources(this); this.configureEffectCompositer = null; }
  }
  assert.throws(() => aoFixture(ChangedLayout), /configureEffectCompositer/);
  for (const count of counts.values()) assert.equal(count, 1, 'failed setup cleans allocated resources');
});

test('AO render failures restore the caller target, scene, overlays and renderer flags', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), target = {};
  const overlay = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ depthWrite: false }));
  scene.add(overlay); scene.background = new THREE.Color('blue');
  const background = scene.background, failure = new Error('GPU failure');
  const renderer = { info: { autoReset: true, reset() {} }, autoClear: true, shadowMap: { autoUpdate: true }, xr: { enabled: true },
    target, render() {}, getRenderTarget() { return this.target; }, setRenderTarget(value) { this.target = value; },
    getDrawingBufferSize(size) { return size.set(320, 240); }, getPixelRatio() { return 1; } };
  const effect = new Effect(renderer, scene, camera);
  effect.pass.render = () => { assert.equal(overlay.visible, false); throw failure; };
  try {
    assert.throws(() => effect.render(camera), error => error === failure);
    assert.equal(renderer.target, target); assert.equal(renderer.autoClear, true);
    assert.equal(renderer.info.autoReset, true); assert.equal(renderer.shadowMap.autoUpdate, true); assert.equal(renderer.xr.enabled, true);
    assert.equal(scene.matrixWorldAutoUpdate, true); assert.equal(scene.overrideMaterial, null); assert.equal(scene.background, background);
    assert.equal(overlay.visible, true); assert.equal(effect.hidden.length, 0);
  } finally { effect.dispose(); overlay.geometry.dispose(); overlay.material.dispose(); }
});

test('lazy AO falls back after setup failure, releases the effect, and retries only after a toggle', async t => {
  const warnings = []; t.mock.method(console, 'warn', (...args) => warnings.push(args));
  let loads = 0, disposed = 0, renders = 0;
  class BrokenEffect { setQuality() { throw new RenderingCompatibilityError('test setup failure'); } dispose() { disposed++; } }
  const ao = new AmbientOcclusion({ render() { renders++; } }, {}, {}, {
    load: async () => { loads++; return { AmbientOcclusion: BrokenEffect }; },
  });
  assert.equal(ao.prepare(), null); assert.equal(loads, 0);
  ao.enabled = true; await ao.prepare();
  assert.equal(ao.effect, null); assert.equal(ao.failed, true); assert.equal(disposed, 1); assert.equal(warnings.length, 1);
  ao.render({}); ao.render({}); await ao.prepare();
  assert.equal(renders, 2); assert.equal(loads, 1);
  ao.enabled = false; ao.enabled = true; await ao.prepare();
  assert.equal(loads, 2); assert.equal(disposed, 2);
  ao.dispose();
});

test('a pending lazy AO load cannot create an effect after it was disabled or disposed', async () => {
  for (const finish of [ao => { ao.enabled = false; }, ao => ao.dispose()]) {
    let resolve;
    const ao = new AmbientOcclusion({}, {}, {}, { load: () => new Promise(done => { resolve = done; }) });
    ao.enabled = true; const ready = ao.prepare(); finish(ao);
    resolve({ AmbientOcclusion: class { constructor() { assert.fail('stale load'); } } });
    await ready; assert.equal(ao.effect, null); assert.equal(ao.ready, null);
  }
});

test('shadow warm-up matches custom depth sides and restores the render target on failure', () => {
  const scene = new THREE.Scene(), previous = {}, camera = new THREE.PerspectiveCamera();
  const caster = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, alphaTest: .5 }));
  caster.castShadow = true; caster.customDepthMaterial = new THREE.MeshDepthMaterial(); scene.add(caster);
  const failure = new Error('compile failed');
  let disposed = false;
  const renderer = {
    target: previous, getRenderTarget() { return this.target; }, setRenderTarget(value) { this.target = value; },
    compile(roots, lens, lights) {
      assert.equal(lens, camera); assert.equal(lights, scene); assert.notEqual(this.target, previous);
      this.target.addEventListener('dispose', () => { disposed = true; });
      assert.equal(roots.children[0].material, caster.customDepthMaterial);
      assert.equal(caster.customDepthMaterial.side, THREE.DoubleSide); assert.equal(caster.customDepthMaterial.alphaTest, .5);
      throw failure;
    },
  };
  try {
    assert.throws(() => precompileShadowPrograms(renderer, scene, [scene], camera), error => error === failure);
    assert.equal(renderer.target, previous); assert.equal(disposed, true);
  } finally { caster.material.dispose(); caster.customDepthMaterial.dispose(); caster.geometry.dispose(); }
});
