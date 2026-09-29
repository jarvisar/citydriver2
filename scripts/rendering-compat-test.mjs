// Real WebGL coverage for the dependency adapter. Pass an output directory to
// keep fixed-scene pixels for before/after comparisons.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const out = process.argv[2] ?? '.artifacts/rendering-compat';
await mkdir(out, { recursive: true });
const server = await createServer({ server: { port: 0, host: '127.0.0.1', watch: null }, logLevel: 'error' });
await server.listen();
let browser;
try {
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH }
      : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || message.text().includes('[rendering-compat]')) errors.push(message.text());
  });
  // Keep the game out of this small, deterministic fixture.
  await page.route('**/fixture.html', route => route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/fixture.html`);
  const source = process.env.RENDER_SOURCE ?? '/src';
  const result = await page.evaluate(async source => {
    // Use Vite's resolved Three module, the same instance as the shader patch.
    const module = await fetch(`${source}/ambient-occlusion-pass.js`).then(response => response.text());
    const threePath = module.match(/import \* as THREE from ["']([^"']+)["']/)[1];
    const THREE = await import(threePath);
    const { AmbientOcclusion } = await import(`${source}/ambient-occlusion-pass.js`);
    const { stabilizeShadowFiltering } = await import(`${source}/shadows.js`);
    stabilizeShadowFiltering(); stabilizeShadowFiltering();
    if (!THREE.ShaderChunk.shadowmap_pars_fragment.includes('vec2 place =')) throw new Error('Fixture uses an unpatched Three instance');
    const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas'), preserveDrawingBuffer: true });
    renderer.setSize(320, 240);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#bfd5e5');
    scene.add(new THREE.HemisphereLight(0xffffff, 0x536040, 2));
    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.position.set(-3, 6, 4); sun.castShadow = true; sun.shadow.mapSize.set(512, 512);
    Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: .1, far: 25 });
    sun.shadow.camera.updateProjectionMatrix(); scene.add(sun);
    const ground = new THREE.Mesh(new THREE.BoxGeometry(12, .2, 12), new THREE.MeshStandardMaterial({ color: '#a4a68a' }));
    ground.position.y = -.1; ground.receiveShadow = true; scene.add(ground);
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ color: '#b77342' }));
    box.position.y = 1; box.castShadow = box.receiveShadow = true; scene.add(box);
    const overlay = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: 'red', transparent: true, opacity: .2, depthWrite: false }));
    overlay.position.set(2, .02, 0); overlay.rotation.x = -Math.PI / 2; scene.add(overlay);
    const ortho = new THREE.OrthographicCamera(-5, 5, 3.75, -3.75, .1, 30);
    const perspective = new THREE.PerspectiveCamera(45, 4 / 3, .1, 30);
    for (const camera of [ortho, perspective]) { camera.position.set(6, 5, 8); camera.lookAt(0, .5, 0); }
    let effect = new AmbientOcclusion(renderer, scene, ortho);
    const shots = [], memory = [];
    function draw(name, camera, quality, width = 320, height = 240) {
      renderer.setSize(width, height); effect.setQuality(quality);
      effect.render(camera);
      if (!overlay.visible || scene.overrideMaterial || !renderer.shadowMap.autoUpdate || !scene.matrixWorldAutoUpdate) throw new Error('AO left scene state changed');
      const gl = renderer.getContext(), pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL error');
      shots.push({ name, pixels: Array.from(pixels), png: renderer.domElement.toDataURL(), calls: renderer.info.render.calls });
    }
    draw('overhead', ortho, 'high'); draw('chase', perspective, 'high');
    draw('resized', perspective, 'low', 400, 300); draw('overhead-again', ortho, 'high');
    effect.enabled = false; draw('without-ao', perspective, 'high');
    effect.dispose();
    for (let i = 0; i < 3; i++) {
      effect = new AmbientOcclusion(renderer, scene, perspective);
      effect.render(perspective); effect.dispose();
      memory.push({ ...renderer.info.memory });
    }
    renderer.dispose();
    return { shots, memory };
  }, source);
  if (source === '/src') await page.evaluate(async () => {
    const module = await fetch('/src/rendering-compat.js').then(response => response.text());
    const THREE = await import(module.match(/import \* as THREE from ["']([^"']+)["']/)[1]);
    const { rendererPrograms } = await import('/src/rendering-compat.js');
    const canvas = document.createElement('canvas'), renderer = new THREE.WebGLRenderer({ canvas });
    renderer.setSize(64, 64);
    const owner = rendererPrograms(renderer), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
    camera.position.z = 5;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); scene.add(mesh);
    const gl = renderer.getContext(), linkProgram = gl.linkProgram.bind(gl);
    let links = 0;
    gl.linkProgram = (...args) => { links++; return linkProgram(...args); };
    renderer.render(scene, camera); owner.warm(); owner.retain();
    const first = renderer.info.programs[0], initialLinks = links;
    if (first.usedTimes !== 2) throw new Error('Program was not retained exactly once');
    mesh.material.dispose();
    if (first.usedTimes !== 1 || !gl.isProgram(first.program)) throw new Error('Material disposal deleted a retained program');
    mesh.material = new THREE.MeshBasicMaterial(); renderer.render(scene, camera); owner.retain();
    if (links !== initialLinks || renderer.info.programs[0] !== first) throw new Error('Identical material recompiled');
    const event = name => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), 5000);
      canvas.addEventListener(name, () => { clearTimeout(timeout); resolve(); }, { once: true });
    });
    const lost = event('webglcontextlost'); renderer.forceContextLoss(); await lost;
    // Restoration must be requested after the loss event finishes dispatching.
    await new Promise(resolve => setTimeout(resolve, 100));
    const restored = event('webglcontextrestored'); renderer.forceContextRestore(); await restored;
    renderer.render(scene, camera); owner.retain();
    const replacement = renderer.info.programs[0];
    if (replacement === first || replacement.usedTimes !== 2) throw new Error('Restored context did not retain its new program');
    mesh.material.dispose(); mesh.geometry.dispose(); renderer.dispose(); renderer.forceContextLoss();
  });
  const shots = [];
  for (const shot of result.shots) {
    const pixels = Buffer.from(shot.pixels);
    await writeFile(`${out}/${shot.name}.png`, Buffer.from(shot.png.split(',')[1], 'base64'));
    shots.push({ name: shot.name, calls: shot.calls, hash: createHash('sha256').update(pixels).digest('hex') });
  }
  assert.deepEqual(result.memory[1], result.memory[0], 'AO toggles release their resources');
  assert.deepEqual(result.memory[2], result.memory[0], 'AO resource counts stay stable');
  assert.deepEqual(errors, []);
  await writeFile(`${out}/results.json`, JSON.stringify({ shots, memory: result.memory }, null, 2));
  console.log(JSON.stringify({ shots, memory: result.memory }));
} finally {
  await browser?.close(); await server.close();
}
