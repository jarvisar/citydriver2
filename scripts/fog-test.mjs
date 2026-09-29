// Pixels at fixed world points must keep their haze through zoom and orbit.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 0, host: '127.0.0.1', watch: null, hmr: false }, logLevel: 'error' });
await server.listen();
let browser;
try {
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH }
      : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/fog-fixture.html', route => route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/fog-fixture.html`);
  const result = await page.evaluate(async () => {
    const source = await fetch('/src/player-fog.js').then(response => response.text());
    const THREE = await import(source.match(/import \* as THREE from ["']([^"']+)["']/)[1]);
    const { PlayerFog, fitFogDistance } = await import('/src/player-fog.js');
    const { installPlayerFog } = await import('/src/rendering-compat.js');
    const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas') });
    renderer.setSize(129, 129);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('white');
    scene.fog = new PlayerFog('white'); scene.fog.near = 80; scene.fog.far = 220;
    const owner = installPlayerFog(renderer), camera = new THREE.PerspectiveCamera(50, 1, .1, 1000);
    const geometry = new THREE.PlaneGeometry(60, 60), material = new THREE.MeshBasicMaterial({ color: 'black', side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.Mesh(geometry, material), instances = new THREE.InstancedMesh(geometry, material, 1);
    scene.add(mesh, instances); owner.prepare(scene);
    renderer.compile(scene, camera);
    const gl = renderer.getContext(), pixel = new Uint8Array(4), matrix = new THREE.Matrix4();
    const rows = [], target = new THREE.Vector3();
    for (const shift of [0, 20000]) {
      scene.fog.origin.set(31, 20, -shift);
      for (const kind of ['mesh', 'instance']) {
        mesh.visible = kind === 'mesh'; instances.visible = !mesh.visible;
        for (const point of [[0, 0, -60], [75, 0, -115], [-130, 15, -130], [0, 0, -240]]) {
          target.fromArray(point).add(scene.fog.origin);
          const expected = Math.round(THREE.MathUtils.smoothstep(Math.hypot(...point), scene.fog.near, scene.fog.far) * 255);
          const values = [];
          for (const pose of [[0, 4, 14], [0, 20, 84], [70, 40, 0], [-35, 90, 24]]) {
            camera.position.fromArray(pose).add(scene.fog.origin); camera.lookAt(target); camera.updateMatrixWorld();
            mesh.position.copy(target); mesh.lookAt(camera.position); mesh.updateMatrix();
            if (instances.visible) { matrix.copy(mesh.matrix); instances.setMatrixAt(0, matrix); instances.instanceMatrix.needsUpdate = true; instances.computeBoundingSphere(); }
            fitFogDistance(camera, scene.fog); renderer.render(scene, camera);
            gl.readPixels(64, 64, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            if (Math.abs(pixel[0] - expected) > 2) throw new Error(`${kind} ${point}: expected ${expected}, got ${pixel[0]} at camera ${pose}`);
            values.push(pixel[0]);
          }
          rows.push({ shift, kind, point, expected, values });
        }
      }
    }
    if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL error');
    material.dispose(); geometry.dispose(); instances.dispose(); renderer.dispose();
    return rows;
  });
  assert.deepEqual(errors, []);
  console.log(`${result.length * 4} pixel checks passed: mesh/instances, zoom, orbit, elevation and origin shifts.`);
} finally {
  await browser?.close(); await server.close();
}
