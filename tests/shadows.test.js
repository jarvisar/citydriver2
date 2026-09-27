import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CASTER_TOP, SHADOW_FADE, fitSunShadow, fitSunShadowAround } from '../src/shadows.js';

test('sun shadow texels stay anchored to world surfaces through camera motion and rebasing', () => {
  for (const offset of [[-145, 230, 95], [-170, 150, 120], [-170, 190, -80], [-55, 245, 40]]) {
    const camera = new THREE.OrthographicCamera(-132, 132, 82.5, -82.5, 1, 1200);
    const sun = new THREE.DirectionalLight(); sun.shadow.mapSize.set(2048, 2048);
    const sample = new THREE.Vector3(13.25, 7.75, -29.5);
    let reference;
    for (const origin of [0, 1024, -1024, 32768]) for (let frame = 0; frame < 40; frame++) {
      const target = new THREE.Vector3(frame * .031, 10 + frame * .007, origin - frame * .047);
      camera.position.copy(target).add(new THREE.Vector3(-220, 245, 260)); camera.lookAt(target);
      sun.position.copy(target).add(new THREE.Vector3(...offset)); sun.target.position.copy(target);
      fitSunShadow(camera, sun, 0, origin);
      const p = sample.clone().add(new THREE.Vector3(0, 0, origin)).project(sun.shadow.camera);
      const texel = [(p.x + 1) * 1024, (p.y + 1) * 1024];
      reference ??= texel;
      texel.forEach((value, axis) => {
        const delta = value - reference[axis];
        assert.ok(Math.abs(delta - Math.round(delta)) < 1e-6, 'a world point must keep its fractional shadow texel position');
      });
    }
  }
});

test('third-person turns do not stretch the shadow map', () => {
  const camera = new THREE.PerspectiveCamera(45, 1.6, .1, 1200);
  const sun = new THREE.DirectionalLight(); sun.shadow.mapSize.set(2048, 2048);
  let reference;
  for (let frame = 0; frame < 120; frame++) {
    const angle = frame * Math.PI / 60;
    camera.position.set(14 * Math.sin(angle), 8 + Math.sin(angle * 2), 14 * Math.cos(angle)); camera.lookAt(0, 1, 0);
    sun.position.set(-145, 230, 95);
    fitSunShadow(camera, sun);
    const shadow = sun.shadow.camera, size = [shadow.right - shadow.left, shadow.top - shadow.bottom];
    reference ??= size;
    size.forEach((value, axis) => assert.ok(Math.abs(value - reference[axis]) < 1e-9));
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      const receiver = new THREE.Vector3(x, y, 1).unproject(camera);
      receiver.sub(camera.position).multiplyScalar(90 / camera.far).add(camera.position).project(shadow);
      assert.ok(Math.max(Math.abs(receiver.x), Math.abs(receiver.y)) <= SHADOW_FADE && Math.abs(receiver.z) < 1, 'nearby corners keep full shadows');
    }
  }
});

test('sun shadows cover screen edges across journeys, zoom, resize and origin shifts', () => {
  for (const aspect of [390 / 844, 1.44, 16 / 9, 32 / 9]) {
    for (const size of [115, 128.8, 165, 200, 235, 263.2]) {
      for (const offset of [[-145, 230, 95], [-170, 150, 120], [-150, 230, 110], [-55, 245, 40]]) {
        for (const z of [0, -1000, 1000]) {
          const target = new THREE.Vector3(25, 65, z);
          const camera = new THREE.OrthographicCamera(-size * aspect / 2, size * aspect / 2, size / 2, -size / 2, 1, 1200);
          camera.position.copy(target).add(new THREE.Vector3(-220, 245, 260));
          camera.lookAt(target);
          const sun = new THREE.DirectionalLight();
          sun.position.copy(target).add(new THREE.Vector3(...offset));
          sun.target.position.copy(target);
          fitSunShadow(camera, sun);
          const direction = camera.getWorldDirection(new THREE.Vector3());
          const towardSun = new THREE.Vector3(...offset).normalize();
          for (const x of [-1, -.5, 0, .5, 1]) for (const y of [-1, 0, 1]) {
            for (const height of [-40, 0, 65, 120, 180]) {
              const receiver = new THREE.Vector3(x, y, -1).unproject(camera);
              receiver.addScaledVector(direction, (height - receiver.y) / direction.y);
              // An offscreen object as tall as anything gets can still cast onto a visible receiver.
              for (const distance of [0, Math.max(0, (CASTER_TOP - 1 - receiver.y) / towardSun.y)]) {
                const projected = receiver.clone().addScaledVector(towardSun, distance).project(sun.shadow.camera);
                // (full strength: the fade band lies beyond the view)
                assert.ok(Math.max(Math.abs(projected.x), Math.abs(projected.y)) <= SHADOW_FADE && Math.abs(projected.z) < 1,
                  `clipped shadow at aspect=${aspect}, size=${size}, screen=${x},${y}, height=${height}`);
              }
            }
          }
        }
      }
    }
  }
});

test('jungle shadows follow valley elevation without enlarging the shadow map coverage', () => {
  for (const aspect of [390 / 844, 2560 / 1271, 32 / 9]) for (const size of [75, 115, 165, 235, 263.2]) {
    let reference;
    for (const altitude of [0, -1000, -250, 500, 1000, 42000]) {
      const target = new THREE.Vector3(25, altitude, -1000);
      const camera = new THREE.OrthographicCamera(-size * aspect / 2, size * aspect / 2, size / 2, -size / 2, 1, 1200);
      camera.position.copy(target).add(new THREE.Vector3(-220, 245, 260)); camera.lookAt(target);
      const sun = new THREE.DirectionalLight(), offset = new THREE.Vector3(-55, 245, 40);
      sun.position.copy(target).add(offset); sun.target.position.copy(target);
      fitSunShadow(camera, sun, altitude);
      const shadow = sun.shadow.camera, direction = camera.getWorldDirection(new THREE.Vector3()), light = offset.clone().normalize();
      const extent = [shadow.right - shadow.left, shadow.top - shadow.bottom, shadow.far - shadow.near];
      reference ??= extent;
      extent.forEach((value, i) => assert.ok(Math.abs(value - reference[i]) < 1e-7, 'altitude must not reduce shadow texel density'));
      for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const height of [-40, -15, 0, 80, 180]) {
        const receiver = new THREE.Vector3(x, y, -1).unproject(camera);
        receiver.addScaledVector(direction, (altitude + height - receiver.y) / direction.y);
        for (const distance of [0, Math.max(0, (altitude + CASTER_TOP - 1 - receiver.y) / light.y)]) {
          const p = receiver.clone().addScaledVector(light, distance).project(shadow);
          assert.ok(Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)) < 1, `clipped jungle shadow at altitude ${altitude}, screen ${x},${y}`);
        }
      }
    }
  }
});

test('the lens opening up with speed does not resize the shadow map', () => {
  // (the chase camera says how wide it ever gets: see ThirdPersonCamera.resize)
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, .1, 1200);
  camera.userData.widestFov = 45 * 1.09;
  const sun = new THREE.DirectionalLight(); sun.shadow.mapSize.set(2048, 2048);
  camera.position.set(0, 3, 10); camera.lookAt(0, 1, 0); sun.position.set(-145, 230, 95);
  let reference;
  for (const fov of [45, 46.5, 47.8, 49.05]) {
    camera.fov = fov; camera.updateProjectionMatrix();
    const texel = fitSunShadow(camera, sun);
    const shadow = sun.shadow.camera, size = [shadow.right - shadow.left, shadow.top - shadow.bottom];
    reference ??= size;
    size.forEach((value, axis) => assert.ok(Math.abs(value - reference[axis]) < 1e-9, `fov ${fov}`));
    assert.ok(Math.abs(texel - size[0] / 2048) < 1e-12, 'returns the texel size');
  }
});

test('a shorter reach covers less ground at the same texel grid, and keeps its whole reach at full strength', () => {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, .1, 1200);
  camera.position.set(3, 6, 12); camera.lookAt(0, 1, -20);
  const widths = [];
  for (const distance of [45, 60, 80, 100, 140]) {
    const sun = new THREE.DirectionalLight(); sun.shadow.mapSize.set(1024, 1024); sun.position.set(-210, 105, 140);
    const texel = fitSunShadow(camera, sun, 0, 0, distance);
    const shadow = sun.shadow.camera;
    widths.push(shadow.right - shadow.left);
    assert.ok(Math.abs(texel * 1024 - (shadow.right - shadow.left)) < 1e-6);
    // Everything the lens sees nearer than the reach has full-strength shadows.
    for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) {
      const ray = new THREE.Vector3(x, y, 1).unproject(camera).sub(camera.position).normalize();
      for (const along of [2, distance / 2, distance * .98]) {
        const p = camera.position.clone().addScaledVector(ray, along).project(shadow);
        assert.ok(Math.max(Math.abs(p.x), Math.abs(p.y)) <= SHADOW_FADE, `reach ${distance}: ${along} m at ${x},${y}`);
      }
    }
  }
  for (let i = 1; i < widths.length; i++) assert.ok(widths[i] > widths[i - 1]);
  assert.ok(Math.abs(widths[4] / widths[0] - 140 / 45) < .05, 'coverage scales with the reach');
});

test('in a headset the shadows reach all round the head, and turning it changes nothing', () => {
  const sun = new THREE.DirectionalLight(); sun.shadow.mapSize.set(1024, 1024);
  let reference;
  for (const origin of [0, 2048]) for (let step = 0; step < 30; step++) {
    const head = new THREE.Vector3(step * .37, 1.6 + Math.sin(step) * .2, origin - step * .53);
    sun.position.copy(head).add(new THREE.Vector3(-150, 230, 110)); sun.target.position.copy(head);
    const texel = fitSunShadowAround(head, sun, 50, origin);
    const shadow = sun.shadow.camera, size = [shadow.right - shadow.left, shadow.top - shadow.bottom];
    reference ??= size;
    size.forEach((value, axis) => assert.ok(Math.abs(value - reference[axis]) < 1e-9, 'one size wherever the head goes'));
    assert.ok(texel < .12, `${texel} m texels`);
    // Every way round, level with the head and down on the ground
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) for (const drop of [0, -1.6]) {
      const p = head.clone().add(new THREE.Vector3(Math.cos(angle) * 48, drop, Math.sin(angle) * 48)).project(shadow);
      assert.ok(Math.max(Math.abs(p.x), Math.abs(p.y)) <= SHADOW_FADE && Math.abs(p.z) < 1, `angle ${angle.toFixed(2)}`);
    }
  }
});

test('shadows fade out over the outer band of the map instead of stopping at a line', async () => {
  const { stabilizeShadowFiltering } = await import('../src/shadows.js');
  stabilizeShadowFiltering();
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  assert.match(chunk, new RegExp(`smoothstep\\(${SHADOW_FADE.toFixed(3)}, 1\\.0, max\\(edge\\.x, edge\\.y\\)\\)`));
  assert.doesNotMatch(chunk, /interleavedGradientNoise\( gl_FragCoord\.xy \)/, 'no per-pixel rotation');
});

test('the shadow reaches back to the tallest caster however low the sun, and no deeper than that needs', () => {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, .1, 1200);
  camera.position.set(0, 3, 12); camera.lookAt(0, 1, -30);
  let evening, noon;
  for (const elevation of [12, 22.6, 35, 53, 75]) {
    const sun = new THREE.DirectionalLight(); sun.shadow.mapSize.set(2048, 2048);
    const e = THREE.MathUtils.degToRad(elevation);
    sun.position.set(-Math.cos(e) * 250, Math.sin(e) * 250, Math.cos(e) * 120); sun.target.position.set(0, 0, 0);
    fitSunShadow(camera, sun, 0, 0, 100);
    const shadow = sun.shadow.camera, toSun = sun.position.clone().normalize();
    // A tower's top on the way to the sun from any covered piece of ground
    for (const along of [0, 40, 90]) {
      const ground = camera.position.clone().add(new THREE.Vector3(0, -camera.position.y, -along));
      const top = ground.clone().addScaledVector(toSun, (CASTER_TOP - 1) / toSun.y).project(shadow);
      assert.ok(Math.abs(top.z) <= 1, `${elevation} deg: a ${CASTER_TOP} m caster ${along} m out keeps its shadow`);
    }
    const depth = shadow.far - shadow.near, spread = shadow.right - shadow.left;
    assert.ok(depth <= spread * SHADOW_FADE + CASTER_TOP / toSun.y + 2, `${elevation} deg: ${depth.toFixed(0)} m deep`);
    assert.ok(Math.abs(sun.shadow.bias * depth + .035) < 1e-9, 'a fixed depth bias in metres');
    assert.ok(Math.abs(sun.shadow.normalBias - Math.min(.2, Math.max(.05, spread / 2048 * 1.15))) < 1e-9, 'a normal bias of a texel and a bit');
    if (elevation === 22.6) evening = depth;
    if (elevation === 53) noon = depth;
  }
  // The old fixed 250 m each way cut the evening tips off the tallest towers,
  // and drew what could not shadow anything in the noon sun.
  assert.ok(evening > 250 && noon < 250 * 2, `evening ${evening.toFixed(0)} m, noon ${noon.toFixed(0)} m`);
});

test('four blended taps weigh the texels exactly as the nine-tap tent did', () => {
  // One axis of a compare texture: 0 or 1 per texel, blended linearly as the
  // hardware does between texel centres (t = coordinate * size - .5)
  const texels = Array.from({ length: 64 }, (_, i) => (Math.sin(i * 12.9898) * 43758.5453 % 1 + 1) % 1 > .5 ? 1 : 0);
  const blend = t => { const i = Math.floor(t), f = t - i; return texels[i] * (1 - f) + texels[i + 1] * f; };
  for (let k = 0; k < 400; k++) {
    const t = 3 + (k * .6180339887 % 1) * 56;
    const nine = (blend(t - 1) + 2 * blend(t) + blend(t + 1)) / 4;
    const cell = Math.floor(t), f = t - cell;
    // (the shader's lo/hi weights and a/b places, in texel-centre units)
    const four = (3 - 2 * f) / 4 * blend(cell - 1 + (2 - f) / (3 - 2 * f)) + (1 + 2 * f) / 4 * blend(cell + 1 + f / (1 + 2 * f));
    assert.ok(Math.abs(nine - four) < 1e-12, `at ${t}: ${nine} vs ${four}`);
  }
});
