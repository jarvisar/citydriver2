import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlayerFog, fitFogDistance } from '../src/player-fog.js';
import { ThirdPersonCamera } from '../src/third-person-camera.js';
import { WEATHER_PRESETS } from '../src/world/city-weather.js';

test('fog retains a broad fade in every weather and quality, with a fixed outer radius', () => {
  const fog = new PlayerFog('white');
  for (const weather of Object.values(WEATHER_PRESETS)) for (const detailed of [false, true]) {
    let previous = -Infinity, far;
    for (const distance of [0, .25, .5, 1]) {
      fog.setRange(weather.drivingFogNear, weather.drivingFogFar, detailed, distance);
      far ??= fog.far;
      assert.equal(fog.far, far);
      assert.ok(fog.far <= (detailed ? 310 : 205));
      assert.ok(fog.near >= previous && fog.near <= fog.far * .75);
      previous = fog.near;
    }
  }
});

test('the far plane contains every visible point through zoom, orbit, flight and wall pull-ins', () => {
  const fog = new PlayerFog('white'), point = new THREE.Vector3(), direction = new THREE.Vector3();
  for (const altitude of [0, 120]) for (const scale of [.36, 1, 1.2]) for (const aspect of [.4, 16 / 9, 4]) {
    const car = new THREE.Object3D(), rig = new ThirdPersonCamera();
    car.position.set(347, altitude, -900); car.userData.chaseScale = scale;
    fog.origin.copy(car.position); rig.resize(aspect);
    for (const zoom of [.45, 1, 3, 6]) for (const yaw of [0, 1.8, -2.8]) for (const tilt of [-.2, .4, 1]) {
      rig.zoomTarget = zoom; rig.snap(); rig.look(yaw, tilt); rig.update(car, 0);
      for (const wall of [null, () => .08]) {
        rig.sight = wall; rig.update(car, 1 / 60); fitFogDistance(rig.camera, fog);
        // The furthest point on the fog sphere is just beyond its visible interior.
        rig.camera.getWorldDirection(direction);
        point.copy(fog.origin).addScaledVector(direction, fog.far - .01).applyMatrix4(rig.camera.matrixWorldInverse);
        assert.ok(-point.z < rig.camera.far);
        assert.ok(rig.camera.far < fog.far + rig.camera.position.distanceTo(fog.origin) + 2.01);
        assert.ok(rig.camera.near < rig.camera.far);
      }
      rig.sight = null;
    }
  }
});

test('XR clipping covers the current tracked head in every direction, independent of the old camera pose', () => {
  const fog = new PlayerFog('white'), camera = new THREE.PerspectiveCamera(), head = new THREE.Vector3(72, 20, -17);
  const expected = Math.ceil(head.distanceTo(fog.origin) + fog.far) + 1;
  for (const yaw of [0, 1, 3]) {
    camera.position.set(-400, -400, -400); camera.rotation.y = yaw;
    fitFogDistance(camera, fog, head);
    assert.equal(camera.far, expected);
  }
});

test('fog bounds keep straddling geometry and reject only wholly hidden spheres', () => {
  const fog = new PlayerFog('white'), sphere = new THREE.Sphere(new THREE.Vector3(0, 0, -200), 15);
  assert.equal(fog.intersectsSphere(sphere), true);
  sphere.center.z = -230; assert.equal(fog.intersectsSphere(sphere), false);
  fog.origin.z = -30; assert.equal(fog.intersectsSphere(sphere), true);
  const camera = new THREE.OrthographicCamera(); camera.far = 1200;
  fitFogDistance(camera, fog); assert.equal(camera.far, 1200);
});
