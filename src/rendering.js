import * as THREE from 'three';
import { fitSunShadow, stabilizeShadowFiltering } from './shadows.js';
import { ThirdPersonCamera } from './third-person-camera.js';
import { FirstPersonCamera } from './first-person-camera.js';
import { AmbientOcclusion } from './ambient-occlusion.js';
import { CarSilhouette } from './car-silhouette.js';
import { Graphics, drawingPixelRatio } from './graphics.js';
import { XRCameraRig } from './xr-camera.js';
import { sampleCityWeather } from './world/city-weather.js';
import { CITY_CELL } from './world/city.js';
const DISTANT_CITY_RADIUS = 6, CITY_BLOCK = CITY_CELL;

export function fitFogDistance(camera, fog) {
  if (!camera.isPerspectiveCamera || !fog?.isFog) return;
  // Linear fog has already replaced every pixel with sky at this depth.
  // Clipping there saves hidden draws without shortening the visible horizon.
  const far = Math.max(camera.near + 1, Math.ceil(fog.far) + 1);
  if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); }
}

export function createRendering(canvas, graphics = new Graphics(), { showCarSilhouette = () => true, beforeDraw = () => {} } = {}) {
  stabilizeShadowFiltering();
  // Multisampling belongs to the context and cannot be changed later, so the
  // level this page starts on decides it.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: graphics.antialias, powerPreference: 'high-performance' });
  let canvasWidth, canvasHeight, pixelRatio;
  function resizeCanvas() {
    if (renderer.xr.isPresenting) return;
    const width = window.innerWidth, height = window.innerHeight, ratio = drawingPixelRatio(graphics.settings, window.devicePixelRatio, width, height);
    if (width === canvasWidth && height === canvasHeight && ratio === pixelRatio) return;
    // Update size and density together: setPixelRatio followed by setSize allocates twice.
    renderer.setDrawingBufferSize(width, height, ratio);
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    canvasWidth = width; canvasHeight = height; pixelRatio = ratio;
  }
  resizeCanvas();
  // Frame times only describe the scene while it is actually drawing it.
  const recordFrame = (timestamp, active) => graphics.sample(timestamp, active);
  document.addEventListener('visibilitychange', () => graphics.suspend());
  window.addEventListener('blur', () => graphics.suspend());
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .94;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#b8dfe0');
  // The scene root never moves. Let static city transforms stay cached while
  // vehicles, cameras and streamed blocks update their own dirty matrices.
  scene.matrixAutoUpdate = false;
  const carSilhouette = new CarSilhouette(scene);
  const drivingFog = new THREE.Fog('#c2e2db', 460, 860);
  const sky = new THREE.HemisphereLight('#e4f2f5', '#617149', 1.45); scene.add(sky);
  const sun = new THREE.DirectionalLight('#fff1db', 2.5); sun.castShadow = true;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 650; sun.shadow.normalBias = .65; sun.shadow.bias = -.0003; sun.shadow.radius = 2;
  scene.add(sun); scene.add(sun.target);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1200);
  const thirdPerson = new ThirdPersonCamera();
  const firstPerson = new FirstPersonCamera();
  let followedCar;
  const vrCamera = new XRCameraRig();
  scene.add(vrCamera.rig);
  renderer.xr.cameraAutoUpdate = false;
  renderer.xr.addEventListener('sessionend', () => { graphics.suspend(); resizeCanvas(); });
  const ambientOcclusion = new AmbientOcclusion(renderer, scene, camera, {
    onReady: () => { if (!document.hidden && !renderer.xr.isPresenting) render(); },
  });
  // Resolution, sun-shadow detail and the AO budget follow the quality level;
  // whether AO is on at all is the player's own choice.
  // A new shadow map size only takes effect once the old texture is released.
  function applyQuality(settings) {
    ambientOcclusion.enabled = settings.ambientOcclusion;
    ambientOcclusion.setQuality(settings.aoQuality);
    if (sun.shadow.mapSize.x !== settings.shadowMap) {
      sun.shadow.mapSize.set(settings.shadowMap, settings.shadowMap);
      sun.shadow.map?.dispose(); sun.shadow.map = null;
    }
    resizeCanvas();
  }
  applyQuality(graphics.settings);
  graphics.onChange(applyQuality);
  const target = new THREE.Vector3();
  const cameraOffset = new THREE.Vector3(-220, 245, 260);
  const touchScreen = window.matchMedia('(any-pointer: coarse)');
  const sunOffset = new THREE.Vector3(-110, 240, 100);
  const views = [{ height: 235, label: 'Scenic view' }, { height: 165, label: 'Medium view' }, { height: 115, label: 'Close view' }, { height: 75, label: 'Extra close view' }, { height: 115, label: 'Third-person view', thirdPerson: true }, { height: 115, label: 'First-person view', firstPerson: true }];
  const activeCamera = () => views[view].firstPerson ? firstPerson.camera : views[view].thirdPerson ? thirdPerson.camera : camera;
  let initialized = false; let view = touchScreen.matches ? 2 : 1; let viewHeight = views[view].height; let previousOrigin = 0;
  let weatherFog = null;
  const weatherSun = new THREE.Vector3();
  const cityFog = { color: '#c9dbe2', near: 390, far: 780, thirdNear: 190, thirdFar: 420 };
  function updateFog() {
    // Overhead cameras turn distance fog into a wash across the top of the city.
    // Only perspective views need fog to conceal the distant streaming boundary.
    if (!activeCamera().isPerspectiveCamera) { scene.fog = null; return; }
    scene.fog = drivingFog;
    const profile = weatherFog ?? cityFog;
    // Matching the sky exactly lets fully faded terrain disappear without a seam.
    scene.fog.color.copy(scene.background);
    // Fog depth is measured along the camera, so a wide lens can see much
    // farther at the corners. Keep its entire far plane inside the distant
    // city ring, with room for the chase camera behind the car.
    const loadedDistance = graphics.settings.chunks.ahead >= 5 ? 310 : 205;
    // A lens that opens up with speed reports the widest it will ever be, so
    // the horizon stays covered without refitting the fog every frame.
    const lens = activeCamera(), widest = Math.max(lens.userData.widestFov ?? 0, lens.getEffectiveFOV());
    const slope = Math.tan(THREE.MathUtils.degToRad(widest) / 2);
    const horizonDistance = (CITY_BLOCK * DISTANT_CITY_RADIUS - 20) / Math.hypot(1, slope, slope * lens.aspect);
    scene.fog.far = Math.min(profile.thirdFar, loadedDistance, horizonDistance);
    scene.fog.near = weatherFog ? Math.min(profile.thirdNear, scene.fog.far * .5) : profile.thirdNear;
    fitFogDistance(lens, scene.fog);
  }
  function resize() {
    const width = window.innerWidth, height = window.innerHeight;
    const aspect = width / height;
    // Portrait leaves a little more room ahead for the surrounding streets.
    const size = viewHeight * (aspect < 1 ? 1.12 : 1);
    camera.left = -size * aspect / 2; camera.right = size * aspect / 2; camera.top = size / 2; camera.bottom = -size / 2; camera.updateProjectionMatrix();
    thirdPerson.resize(aspect);
    firstPerson.resize(aspect);
    updateFog();
    if (initialized) fitSunShadow(activeCamera(), sun, 0, previousOrigin);
  }
  function update(car, dt, origin) {
    followedCar = car;
    previousOrigin = origin; initialized = true;
    const nextHeight = THREE.MathUtils.damp(viewHeight, views[view].height, 4, dt);
    if (Math.abs(nextHeight - viewHeight) > .01) { viewHeight = nextHeight; resize(); }
    // The car is already interpolated for this frame. Following that position
    // directly keeps it centered while driving, zooming and rebasing the world.
    target.copy(car.position);
    // A fixed azimuth and elevation keep the miniature city easy to read.
    camera.position.copy(target).add(cameraOffset); camera.lookAt(target);
    camera.userData.focusDistance = cameraOffset.length();
    if (views[view].thirdPerson) { thirdPerson.update(car, dt); target.copy(car.position); }
    if (views[view].firstPerson) { firstPerson.update(car, dt); target.copy(car.position); }
    sun.position.copy(target).add(sunOffset); sun.target.position.copy(target);
    fitSunShadow(activeCamera(), sun, 0, origin);
  }
  // Zoom only changes the projection; resizing the canvas every zoom frame reallocates its buffers.
  window.addEventListener('resize', () => { graphics.suspend(); resizeCanvas(); resize(); }); resize();
  // The launcher still calls this when starting or resetting the city.
  function setJourney() {
    weatherFog = null;
    setWeather(sampleCityWeather(0, 'sunset'), 0);
    resize();
  }
  setJourney();
  function setWeather(state, dt = 0) {
    if (!state) return;
    // Weather already changes gradually with the simulation clock. A short
    // render fade also keeps camera switches and lighting adjustments soft;
    // a paused redraw (dt=0) displays the selected conditions immediately.
    const blend = !weatherFog || dt <= 0 ? 1 : 1 - Math.exp(-Math.min(dt, 1) * 4);
    weatherFog ??= { color: new THREE.Color(), near: state.fogNear, far: state.fogFar, thirdNear: state.drivingFogNear, thirdFar: state.drivingFogFar };
    scene.background.lerp(state.background, blend);
    weatherFog.color.lerp(state.fogColor, blend);
    weatherFog.near += (state.fogNear - weatherFog.near) * blend;
    weatherFog.far += (state.fogFar - weatherFog.far) * blend;
    weatherFog.thirdNear += (state.drivingFogNear - weatherFog.thirdNear) * blend;
    weatherFog.thirdFar += (state.drivingFogFar - weatherFog.thirdFar) * blend;
    sky.color.lerp(state.skyColor, blend);
    sky.groundColor.lerp(state.groundColor, blend);
    sky.intensity += (state.skyIntensity + state.flash * .8 - sky.intensity) * blend;
    sun.color.lerp(state.sunColor, blend);
    sun.intensity += (state.sunIntensity + state.flash * 1.5 - sun.intensity) * blend;
    weatherSun.set(state.sunX, state.sunY, state.sunZ);
    sunOffset.lerp(weatherSun, blend);
    if (dt <= 0 && initialized) {
      sun.position.copy(target).add(sunOffset); sun.target.position.copy(target);
      fitSunShadow(activeCamera(), sun, 0, previousOrigin);
    }
    renderer.toneMappingExposure += (state.exposure + state.flash * .12 - renderer.toneMappingExposure) * blend;
    updateFog();
  }
  function draw(viewCamera, stereo = false) {
    beforeDraw(viewCamera);
    carSilhouette.update(followedCar, showCarSilhouette() && !stereo && viewCamera.isOrthographicCamera);
    // Hide the player's exterior for the whole first-person draw, including
    // shadows and AO. Restore it for other views and after render failures.
    const car = views[view].firstPerson ? followedCar : null;
    const visible = car?.visible;
    if (car) car.visible = false;
    try {
      if (stereo) renderer.render(scene, viewCamera);
      else ambientOcclusion.render(viewCamera);
    } finally { if (car) car.visible = visible; }
  }
  function render(frame, beforeXRRender) {
    if (renderer.xr.isPresenting) {
      const pose = frame?.getViewerPose(renderer.xr.getReferenceSpace());
      vrCamera.update(activeCamera(), pose);
      renderer.xr.updateCamera(vrCamera.camera);
      beforeXRRender?.();
      if (!renderer.xr.isPresenting) { draw(activeCamera()); return; }
      // The AO compositor is a monoscopic screen pass. Render the scene
      // directly so Three.js draws both headset eyes with their own lenses.
      draw(vrCamera.camera, true);
    } else draw(activeCamera());
  }
  // Fog is part of every material's program, and only the perspective views
  // draw with it, so compile the scene both ways. Warm-up objects stand in for
  // materials that are not on screen yet; they are compiled, never drawn.
  // Otherwise the first chase-camera frame, river or fare stalls the drive
  // while the browser compiles shaders, which phones feel the most.
  function precompile(warmupObjects = []) {
    const warmup = new THREE.Group(), fog = scene.fog, lens = activeCamera(), pending = [];
    for (const object of warmupObjects) warmup.add(object);
    const parallel = renderer.extensions.has('KHR_parallel_shader_compile');
    try {
      for (const variant of [null, drivingFog]) {
        scene.fog = variant;
        for (const target of [scene, warmup]) {
          if (parallel) pending.push(renderer.compileAsync(target, lens, scene));
          else renderer.compile(target, lens, scene);
        }
      }
    } finally { scene.fog = fog; }
    return Promise.all(pending);
  }
  function setView(index) { view = index; updateFog(); thirdPerson.snap(); firstPerson.snap(); return views[view].label; }
  let desktopView;
  function enterVR() { desktopView = view; setView(views.findIndex(view => view.thirdPerson)); }
  function exitVR() { if (desktopView !== undefined) setView(desktopView); desktopView = undefined; }
  return { renderer, scene, graphics, ambientOcclusion, vrCamera, render, precompile, enterVR, exitVR, setView, toggleAO() { return graphics.toggleAmbientOcclusion(); }, get camera() { return activeCamera(); }, update, resize, recordFrame, setJourney, setWeather, get viewLabel() { return views[view].label; }, toggleView() { return setView((view + 1) % views.length); }, snap() { initialized = false; thirdPerson.snap(); firstPerson.snap(); } };
}
