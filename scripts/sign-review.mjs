// The complete sign catalogue, grouped by trade/place for a visual review.
// node scripts/sign-review.mjs [outDir] [--street seed] [--shops]
// Each face uses the game's canvas painter and its physical proportions.
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const args = process.argv.slice(2), street = args.indexOf('--street');
const shopsOnly = args.includes('--shops');
const out = args[0] && !args[0].startsWith('--') ? args[0] : '.artifacts/signs';
await mkdir(out, { recursive: true });
const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // A blank same-origin page avoids booting the city just to inspect its atlas.
  await page.route('**/sign-review', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/sign-review`);
  const groups = await page.evaluate(async shopsOnly => {
    const { SIGN_CATALOG, drawSign } = await import('/src/world/city-signs.js');
    window.drawSign = drawSign; window.signs = SIGN_CATALOG.filter(sign => !shopsOnly || sign.category);
    document.head.insertAdjacentHTML('beforeend', `<style>
      * { box-sizing: border-box } body { margin: 0; padding: 24px; background: #d4d3ca; color: #27332f; font: 14px sans-serif }
      h1 { margin: 0 0 20px; font-size: 22px } main { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px }
      article { background: #e9e7df; padding: 12px } canvas { display: block; width: 352px; height: 172px }
      p { margin: 10px 0 0; font-size: 12px }
    </style>`);
    return [...new Set(window.signs.map(sign => sign.category ?? sign.type))];
  }, shopsOnly);
  for (const group of [...groups, 'overview']) {
    const count = await page.evaluate(group => {
      document.body.replaceChildren();
      const heading = document.createElement('h1'); heading.textContent = group; document.body.append(heading);
      const main = document.createElement('main'); document.body.append(main);
      const signs = group === 'overview'
        ? window.signs.filter((sign, i, signs) => signs.findIndex(other => (other.category ?? other.type) === (sign.category ?? sign.type)) === i)
        : window.signs.filter(sign => (sign.category ?? sign.type) === group);
      for (const sign of signs) {
        const article = document.createElement('article'), canvas = document.createElement('canvas');
        canvas.width = 704; canvas.height = 344;
        const ctx = canvas.getContext('2d'), scale = Math.min(660 / 512, 306 / (512 / sign.aspect));
        ctx.translate((canvas.width - 512 * scale) / 2, (canvas.height - 512 / sign.aspect * scale) / 2);
        ctx.scale(scale, scale); window.drawSign(ctx, sign);
        const label = document.createElement('p'); label.textContent = `${sign.tile} · ${sign.name}`;
        article.append(canvas, label); main.append(article);
      }
      return signs.length;
    }, group);
    await page.setViewportSize({ width: 1200, height: 80 + Math.ceil(count / 3) * 230 });
    await page.screenshot({ path: `${out}/${group.toLowerCase()}.png`, fullPage: true });
    console.log(`${group}: ${count} signs`);
  }
  await writeFile(`${out}/catalogue.json`, JSON.stringify(await page.evaluate(() => window.signs), null, 2));
  if (street >= 0) {
    const seed = args[street + 1] ?? '4817';
    await page.setViewportSize({ width: 1200, height: 760 });
    page.setDefaultTimeout(180000);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?seed=${seed}`);
    await page.waitForFunction(() => document.querySelector('#loading.loaded') && window.__citydriver);
    await page.click('#free-drive');
    const spots = await page.evaluate(async () => {
      const g = window.__citydriver;
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { cityPlaces } = await import('/src/city-exploration.js');
      const { SIGN_CATALOG } = await import('/src/world/city-signs.js');
      const { PAVEMENT_LEVEL } = await import('/src/world/city-route.js');
      g.traffic.setEnabled(false, g.vehicle);
      g.weather.setMode('clear', { immediate: true });
      window.reviewSigns = spot => {
        const v = g.vehicle;
        v.s = spot.s; v.u = spot.u; v.speed = 0; v.update(0, {});
        g.world.update(v.s, v.u);
        while (g.world.pending.length || g.world.distantPending.length) g.world.update(v.s, v.u);
        const r = g.rendering;
        r.setView(4); r.snap(); v.render(0, g.world.origin); r.update(v.car, 1, g.world.origin);
        r.scene.updateMatrixWorld(true);
        const found = [], m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), scale = new THREE.Vector3();
        r.scene.traverse(o => {
          if (!o.isInstancedMesh || !o.visible || !o.material?.userData?.signAtlas || o.name.endsWith('sign-edge')) return;
          for (let i = 0; i < o.count; i++) {
            o.getMatrixAt(i, m); m.premultiply(o.matrixWorld); m.decompose(p, q, scale);
            if (Math.hypot(p.x - spot.u, g.world.origin - p.z - spot.s) > 100) continue;
            const sign = SIGN_CATALOG[Math.round(o.instanceColor.array[i * 3])];
            const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
            found.push({ family: sign.category ?? sign.type, name: sign.name, tile: sign.tile, x: p.x, y: p.y, z: p.z, nx: n.x, nz: n.z, width: scale.x });
          }
        });
        return found;
      };
      window.reviewShot = (sign, angle = 0) => {
        const r = g.rendering, camera = r.camera, distance = sign.width > 5 || sign.y - PAVEMENT_LEVEL > 6 ? 16 : 11;
        r.renderer.setPixelRatio(1); r.renderer.setSize(1200, 760, false); camera.aspect = 1200 / 760;
        camera.position.set(sign.x + (sign.nx * Math.cos(angle) - sign.nz * Math.sin(angle)) * distance,
          PAVEMENT_LEVEL + 1.7, sign.z + (sign.nz * Math.cos(angle) + sign.nx * Math.sin(angle)) * distance);
        camera.up.set(0, 1, 0); camera.lookAt(sign.x, sign.y, sign.z);
        camera.fov = 50; camera.near = .3; camera.far = 900; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
        g.vehicle.car.visible = false;
        const ghost = r.scene.getObjectByName('car-silhouette'); if (ghost) ghost.visible = false;
        r.renderer.render(r.scene, camera);
        g.vehicle.car.visible = true;
        return r.renderer.domElement.toDataURL('image/png');
      };
      // Large parks put their boards at a gate, sometimes well away from the
      // park's centre. Include both so every existing sign family is sampled.
      return cityPlaces().flatMap(p => [{ u: p.u, s: p.s, family: p.type }, { u: p.entrance.u, s: p.entrance.s, family: p.type }]);
    });
    const seen = new Set(), rows = [];
    for (const spot of spots) {
      if (seen.size === groups.length) break;
      if (seen.has(spot.family) && groups.filter(group => group === group.toUpperCase()).every(group => seen.has(group))) continue;
      const signs = await page.evaluate(spot => window.reviewSigns(spot), spot);
      for (const sign of signs) {
        if (!groups.includes(sign.family) || seen.has(sign.family)) continue;
        seen.add(sign.family); rows.push(sign);
        for (const [view, angle] of [['front', 0], ['angle', .55]]) {
          const data = await page.evaluate(([sign, angle]) => window.reviewShot(sign, angle), [sign, angle]);
          await writeFile(`${out}/street-${sign.family.toLowerCase()}-${view}.png`, Buffer.from(data.split(',')[1], 'base64'));
        }
        console.log(`Street: ${sign.family} / ${sign.name}`);
      }
    }
    await writeFile(`${out}/street.json`, JSON.stringify(rows, null, 2));
    const missing = groups.filter(group => !seen.has(group));
    if (missing.length) throw new Error(`No street sample for ${missing.join(', ')}; try another seed`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close(); await server.close();
}
