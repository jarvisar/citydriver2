import * as THREE from 'three';
import { N8AOPass } from 'n8ao';
import n8aoPackage from 'n8ao/package.json' with { type: 'json' };
import { createN8AOIntegration } from './rendering-compat.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// N8AO shades at exactly half the size of the depth it is given, the one ratio
// its depth-aware upsampling is built for. That depth follows the drawing
// buffer, which the graphics presets already scale, so a cheaper preset is
// cheaper AO too, with no second upsampler of our own to pay for at native size.
//
// `maxPixelRatio` stops the depth at that many device pixels per CSS pixel. A
// dense phone screen would otherwise pay for AO detail it cannot show; the
// finished mask is filtered up the rest of the way, which softens it by less
// than a CSS pixel. Displays at or under the limit keep exact silhouettes.
export const AO_QUALITY = {
  high: { maxPixelRatio: 1.5 },
  low: { maxPixelRatio: 1 },
};

export class AmbientOcclusion {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.enabled = true;
    this.size = new THREE.Vector2();
    this.hidden = [];
    // N8AO's noise is fixed to the screen, so while the world scrolls beneath it
    // whatever noise survives denoising reads as crawling shade. Measured at
    // fixed world points, samples and a wide denoise radius are what quiet
    // it; more resolution, or N8AO's sharper radius-6
    // presets, make it worse. Every preset shares these, so changing level never
    // recompiles the AO shaders mid-drive.
    this.pass = createN8AOIntegration(N8AOPass, n8aoPackage.version, scene, camera, {
      aoRadius: 2.4, distanceFalloff: 1, intensity: 2,
      aoSamples: 32, denoiseSamples: 16, denoiseRadius: 12, denoiseIterations: 2,
      halfRes: true, gammaCorrection: false, autoRenderBeauty: false,
      transparencyAware: false, accumulate: false, depthAwareUpsampling: true,
    });
    this.setQuality('high');
    // Draw geometry once more for depth alone. N8AO derives its normals from
    // depth, so nothing reads this pass's color and no fragment is shaded.
    this.depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, fog: false });
    this.aoTarget = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false });
    this.material = new THREE.ShaderMaterial({
      name: 'Soft ambient occlusion',
      uniforms: {
        tAO: { value: this.aoTarget.texture },
        intensity: { value: .48 },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D tAO;
        uniform float intensity;
        varying vec2 vUv;
        void main() {
          // N8AO already leaves the sky unshaded and fades its mask with fog.
          gl_FragColor = vec4(vec3(mix(1.0, texture2D(tAO, vUv).r, intensity)), 1.0);
        }
      `,
      blending: THREE.MultiplyBlending, transparent: true, premultipliedAlpha: true,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.material);
    // Bound once: this runs over every visible object on every rendered frame.
    this.hideOverlay = object => {
      if (!object.isMesh) return;
      // Background layers still draw; they just stay out of the AO prepass,
      // which is a second pass over the whole scene's geometry.
      if (object.userData.ambientOcclusion === false) {
        this.hidden.push(object);
        object.visible = false;
        return;
      }
      const material = object.material;
      if (Array.isArray(material) ? material.every(item => !item.depthWrite) : !material.depthWrite) {
        this.hidden.push(object);
        object.visible = false;
      }
    };
  }

  setQuality(quality) {
    this.quality = quality;
    this.maxPixelRatio = AO_QUALITY[quality].maxPixelRatio;
  }

  render(camera) {
    const { renderer, scene, pass } = this;
    // Keep renderer.info meaningful across the scene and postprocessing draws.
    const autoReset = renderer.info.autoReset;
    renderer.info.autoReset = false;
    if (autoReset) renderer.info.reset();
    const autoClear = renderer.autoClear;
    const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const matrixWorldAutoUpdate = scene.matrixWorldAutoUpdate;
    const overrideMaterial = scene.overrideMaterial;
    const background = scene.background;
    const xrEnabled = renderer.xr.enabled;
    const target = renderer.getRenderTarget();
    try {
      renderer.render(scene, camera);
      if (!this.enabled) return;

      renderer.getDrawingBufferSize(this.size);
      const scale = Math.min(1, this.maxPixelRatio / renderer.getPixelRatio());
      // Even dimensions keep half-resolution depth and AO texels aligned.
      const width = Math.max(2, Math.floor(this.size.x * scale / 2) * 2);
      const height = Math.max(2, Math.floor(this.size.y * scale / 2) * 2);
      pass.update(camera, width, height);
      if (this.aoTarget.width !== width || this.aoTarget.height !== height) this.aoTarget.setSize(width, height);
      // Foam, mist, flakes and other overlays must not become opaque AO casters.
      scene.traverseVisible(this.hideOverlay);
      renderer.shadowMap.autoUpdate = false;
      // The color pass already updated every transform. AO uses the same pose.
      scene.matrixWorldAutoUpdate = false;
      scene.overrideMaterial = this.depthMaterial;
      scene.background = null;
      renderer.setRenderTarget(pass.depthTarget);
      renderer.render(scene, camera);
      scene.overrideMaterial = overrideMaterial;
      scene.background = background;
      pass.render(renderer, this.aoTarget);
      renderer.setRenderTarget(target);
      renderer.autoClear = false;
      this.quad.render(renderer);
    } finally {
      for (const object of this.hidden) object.visible = true;
      this.hidden.length = 0;
      renderer.setRenderTarget(target);
      renderer.shadowMap.autoUpdate = shadowAutoUpdate;
      scene.matrixWorldAutoUpdate = matrixWorldAutoUpdate;
      scene.overrideMaterial = overrideMaterial;
      scene.background = background;
      renderer.xr.enabled = xrEnabled;
      renderer.autoClear = autoClear;
      renderer.info.autoReset = autoReset;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.pass.dispose();
    this.aoTarget.dispose();
    this.depthMaterial.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
