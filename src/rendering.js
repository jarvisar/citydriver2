import * as THREE from 'three';
import { fitSunShadow, fitSunShadowAround } from './shadows.js';
import { stabilizeShadowFiltering, rendererPrograms, precompileShadowPrograms, installPlayerFog } from './rendering-compat.js';
import { PlayerFog, fitFogDistance } from './player-fog.js';
import { CAMERA_VIEWS, CAMERA_ZOOM_MIN, CameraPreferences } from './camera-preferences.js';
import { Handoff, ThirdPersonCamera } from './third-person-camera.js';
import { FirstPersonCamera } from './first-person-camera.js';
import { CameraTransition, carryCameraLook } from './camera-transition.js';
import { AmbientOcclusion } from './ambient-occlusion.js';
import { CarSilhouette } from './car-silhouette.js';
import { SkyClouds } from './sky-clouds.js';
import { Graphics, drawingPixelRatio, gpuName, HEADSET_FALLBACK_RATE } from './graphics.js';
import { XRCameraRig } from './xr-camera.js';
import { sampleCityWeather } from './world/city-weather.js';
export { fitFogDistance } from './player-fog.js';

// A slight turn of the lens, jittering a few times a second, that grows with
// the square of how shaken the car is (0 to 1): under a degree even for the
// hardest crash, and a knock barely stirs it. Keep it subtle. Two sines to
// each axis never quite repeat.
export function shakeCamera(camera, trauma, time, scale = 1) {
  const shake = trauma * trauma * scale;
  if (shake < 1e-4) return;
  const wobble = (a, b) => Math.sin(time * a) * .6 + Math.sin(time * b + a) * .4;
  camera.rotateY(.009 * shake * wobble(31, 47)); camera.rotateX(.007 * shake * wobble(37, 23)); camera.rotateZ(.0125 * shake * wobble(29, 41));
  camera.updateMatrixWorld();
}

export function createRendering(canvas, graphics = new Graphics(), { showCarSilhouette = () => true, beforeDraw = () => {} } = {}) {
  stabilizeShadowFiltering();
  // Multisampling belongs to the context and cannot be changed later, so the
  // level this page starts on decides it. The stencil lets demolition's red
  // residents show through props but not buildings (see createWalkerAlert).
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: graphics.antialias, stencil: true, powerPreference: 'high-performance' });
  const programs = rendererPrograms(renderer);
  const fogMaterials = installPlayerFog(renderer);
  // Whether soft shading is on by default depends on the card drawing the game.
  graphics.setGpu(gpuName(renderer.getContext()));
  let canvasWidth, canvasHeight, pixelRatio;
  // The canvas fills the page's own box (#app, fixed to the window), the same
  // box the HUD is laid out in, so the scene and the panels always agree. The
  // window's size can disagree with it: in Android Chrome's fullscreen,
  // viewport units came out a toolbar taller than the screen.
  const viewSize = () => ({ width: canvas.clientWidth || window.innerWidth, height: canvas.clientHeight || window.innerHeight });
  function resizeCanvas() {
    if (renderer.xr.isPresenting) return;
    const { width, height } = viewSize(), ratio = drawingPixelRatio(graphics.settings, window.devicePixelRatio, width, height);
    if (width === canvasWidth && height === canvasHeight && ratio === pixelRatio) return;
    // Update size and density together: setPixelRatio followed by setSize allocates twice.
    renderer.setDrawingBufferSize(width, height, ratio);
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
  const clouds = new SkyClouds(scene);
  const drivingFog = fogMaterials ? new PlayerFog('#c2e2db') : new THREE.Fog('#c2e2db', 100, 205);
  const sky = new THREE.HemisphereLight('#e4f2f5', '#617149', 1.45); scene.add(sky);
  const sun = new THREE.DirectionalLight('#fff1db', 2.5); sun.castShadow = true;
  // (each fit sets the shadow camera's extent and depth, and the biases that
  // go with its texels: see shadows.js)
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 650;
  scene.add(sun); scene.add(sun.target);
  // Whatever can leave out whole groups of meshes (the city's chunks) does so
  // here, inside every render of the scene: after its matrices are updated and
  // before the camera's and the sun's passes walk it, with both their frustums.
  const cullers = new Set();
  scene.onBeforeRender = (renderer, scene, camera) => {
    if (!cullers.size) return;
    sun.shadow.updateMatrices(sun);
    const shadow = renderer.shadowMap.enabled && sun.castShadow ? sun.shadow.getFrustum() : null;
    for (const cull of cullers) cull(camera, shadow, scene.fog);
  };
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1200);
  const thirdPerson = new ThirdPersonCamera();
  const firstPerson = new FirstPersonCamera();
  const cameraTransition = new CameraTransition(), subjectBounds = new THREE.Box3();
  const cameraPreferences = new CameraPreferences();
  let cameraMode = null, headsetCamera = false;
  let followedCar;
  // A crash shakes the chase and driver's views: never a headset's, nor for
  // anyone who prefers reduced motion.
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  thirdPerson.calm = reducedMotion;
  let shakeTime = 0;
  const vrCamera = new XRCameraRig();
  scene.add(vrCamera.rig);
  renderer.xr.cameraAutoUpdate = false;
  renderer.xr.addEventListener('sessionend', () => { graphics.suspend(); resizeCanvas(); });
  const ambientOcclusion = new AmbientOcclusion(renderer, scene, camera, {
    onReady: () => { if (!document.hidden && !renderer.xr.isPresenting) render(); },
  });
  // Resolution, the sun shadow's size and reach, and the AO budget follow the
  // quality level; whether AO is on at all is the player's choice, else the
  // device's default. A new shadow map size only takes effect once the old
  // texture is released.
  let shadowDistance;
  function applyQuality(settings) {
    ambientOcclusion.enabled = settings.ambientOcclusion;
    ambientOcclusion.setQuality(settings.aoQuality);
    if (sun.shadow.mapSize.x !== settings.shadowMap) {
      sun.shadow.mapSize.set(settings.shadowMap, settings.shadowMap);
      sun.shadow.map?.dispose(); sun.shadow.map = null;
    }
    shadowDistance = settings.shadowDistance;
    resizeCanvas();
  }
  // (the fit sets the shadow's biases too: see shadows.js)
  function fitShadow(lens, origin) { fitSunShadow(lens, sun, 0, origin, shadowDistance); }
  applyQuality(graphics.settings);
  graphics.onChange(applyQuality);
  const target = new THREE.Vector3(), head = new THREE.Vector3();
  // (the overhead views glide from one body to the next too, getting in or out)
  const overhead = new Handoff();
  const cameraOffset = new THREE.Vector3(-220, 245, 260);
  const touchScreen = window.matchMedia('(any-pointer: coarse)');
  const sunOffset = new THREE.Vector3(-110, 240, 100);
  const views = CAMERA_VIEWS;
  const perspectiveCamera = () => views[view].firstPerson ? firstPerson.camera : thirdPerson.camera;
  const activeCamera = () => cameraTransition.active ? cameraTransition.camera : views[view].firstPerson || views[view].thirdPerson ? perspectiveCamera() : camera;
  let initialized = false; let view = touchScreen.matches ? 1 : 0; let viewHeight = views[view].height; let previousOrigin = 0;
  let weatherFog = null;
  const weatherSun = new THREE.Vector3();
  const cityFog = { thirdNear: 190, thirdFar: 420 };
  function updateFog() {
    // Overhead cameras turn distance fog into a wash across the top of the city.
    // Only perspective views need fog to conceal the distant streaming boundary.
    if (!activeCamera().isPerspectiveCamera) { scene.fog = null; return; }
    scene.fog = drivingFog;
    const profile = weatherFog ?? cityFog;
    // Matching the sky exactly lets fully faded terrain disappear without a seam.
    scene.fog.color.copy(scene.background);
    const settings = graphics.settings;
    if (drivingFog.isPlayerFog) {
      drivingFog.setRange(profile.thirdNear, profile.thirdFar, settings.chunks.ahead >= 5, settings.fogDistance);
      if (followedCar) drivingFog.origin.copy(followedCar.position);
    } else {
      drivingFog.far = Math.min(profile.thirdFar, 205);
      drivingFog.near = Math.min(profile.thirdNear, drivingFog.far * .5);
    }
    fitFogDistance(activeCamera(), scene.fog);
  }
  function resize() {
    const { width, height } = viewSize();
    const aspect = width / height;
    // Portrait leaves a little more room ahead for the surrounding streets.
    const size = viewHeight * (aspect < 1 ? 1.12 : 1);
    camera.left = -size * aspect / 2; camera.right = size * aspect / 2; camera.top = size / 2; camera.bottom = -size / 2; camera.updateProjectionMatrix();
    thirdPerson.resize(aspect);
    firstPerson.resize(aspect);
    updateFog();
    if (initialized) fitShadow(activeCamera(), previousOrigin);
  }
  function update(car, dt, origin) {
    if (!initialized) overhead.reset();
    followedCar = car;
    previousOrigin = origin; initialized = true;
    // (someone on foot is seen from nearer: see Walker)
    const nextHeight = THREE.MathUtils.damp(viewHeight, views[view].height * (car.userData.overheadScale ?? 1), 4, dt);
    if (Math.abs(nextHeight - viewHeight) > .01) { viewHeight = nextHeight; resize(); }
    // The car is already interpolated for this frame. Following that position
    // directly keeps it centered while driving, zooming and rebasing the world.
    target.copy(overhead.follow(car, car.position, dt));
    // A fixed azimuth and elevation keep the miniature city easy to read.
    camera.position.copy(target).add(cameraOffset); camera.lookAt(target);
    camera.userData.focusDistance = cameraOffset.length();
    if (views[view].thirdPerson || cameraTransition.active) { thirdPerson.update(car, dt); target.copy(car.position); }
    if (views[view].firstPerson || cameraTransition.active) { firstPerson.update(car, dt, renderer.xr.isPresenting || reducedMotion); target.copy(car.position); }
    if (cameraTransition.active) {
      cameraTransition.update(perspectiveCamera(), car, dt);
      if (cameraTransition.active) {
        const lens = cameraTransition.camera, eye = firstPerson.camera.position;
        thirdPerson.clampHeight(lens.position, thirdPerson.lid);
        const open = thirdPerson.sight?.(eye, lens.position) ?? 1;
        lens.position.sub(eye).multiplyScalar(open).add(eye);
        thirdPerson.clampHeight(lens.position, thirdPerson.lid);
        lens.updateMatrixWorld();
      }
    }
    shakeTime += dt;
    if ((views[view].thirdPerson || views[view].firstPerson) && !renderer.xr.isPresenting && !reducedMotion) shakeCamera(activeCamera(), car.userData.trauma ?? 0, shakeTime, views[view].firstPerson ? .6 : 1);
    updateFog();
    sun.position.copy(target).add(sunOffset); sun.target.position.copy(target);
    fitShadow(activeCamera(), origin);
  }
  // The box changes without a window resize too (entering fullscreen, the
  // toolbars settling after a turn), so it is watched itself.
  const onResize = () => { graphics.suspend(); resizeCanvas(); resize(); };
  // (a new reach shows at once, paused or not)
  graphics.onChange(() => { updateFog(); if (initialized) fitShadow(activeCamera(), previousOrigin); });
  window.addEventListener('resize', onResize); globalThis.ResizeObserver && new ResizeObserver(onResize).observe(canvas); resize();
  // Golden hour until the game applies the city's weather
  setWeather(sampleCityWeather(0, 'sunset'), 0);
  function setWeather(state, dt = 0) {
    if (!state) return;
    // Weather already changes gradually with the simulation clock. A short
    // render fade also keeps camera switches and lighting adjustments soft;
    // a paused redraw (dt=0) displays the selected conditions immediately.
    const blend = !weatherFog || dt <= 0 ? 1 : 1 - Math.exp(-Math.min(dt, 1) * 4);
    weatherFog ??= { thirdNear: state.drivingFogNear, thirdFar: state.drivingFogFar };
    scene.background.lerp(state.background, blend);
    clouds.setWeather(state, scene.background, blend, dt);
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
      fitShadow(activeCamera(), previousOrigin);
    }
    renderer.toneMappingExposure += (state.exposure + state.flash * .12 - renderer.toneMappingExposure) * blend;
    updateFog();
  }
  function draw(viewCamera, stereo = false) {
    beforeDraw(viewCamera);
    clouds.follow(viewCamera, previousOrigin, stereo);
    carSilhouette.update(followedCar, showCarSilhouette() && !stereo && viewCamera.isOrthographicCamera);
    // Hide the player's exterior for the whole first-person draw, including
    // shadows and AO. Restore it for other views and after render failures.
    // Leave the exterior visible until the gliding lens reaches the body.
    const inside = cameraTransition.active && followedCar && subjectBounds.setFromObject(followedCar).expandByScalar(.2).containsPoint(viewCamera.position);
    const car = (cameraTransition.active ? inside : views[view].firstPerson) ? followedCar : null;
    const visible = car?.visible;
    if (car) car.visible = false;
    try {
      if (stereo) renderer.render(scene, viewCamera);
      else ambientOcclusion.render(viewCamera);
    } finally { if (car) car.visible = visible; }
    programs.retain();
  }
  function render(frame, beforeXRRender) {
    if (renderer.xr.isPresenting) {
      const pose = frame?.getViewerPose(renderer.xr.getReferenceSpace());
      // Ask each eye for its rung's share of the framebuffer (Graphics.xrScale).
      // It applies from the next frame.
      if (pose) for (const eye of pose.views) eye.requestViewportScale?.(graphics.xrScale);
      vrCamera.update(activeCamera(), pose);
      fitFogDistance(vrCamera.camera, scene.fog, vrCamera.head);
      renderer.xr.updateCamera(vrCamera.camera);
      beforeXRRender?.();
      if (!renderer.xr.isPresenting) { draw(activeCamera()); return; }
      // The head can turn anywhere between frames: its shadows reach all round it.
      fitSunShadowAround(head.setFromMatrixPosition(vrCamera.camera.matrixWorld), sun, shadowDistance, previousOrigin);
      // The AO compositor is a monoscopic screen pass. Render the scene
      // directly so Three.js draws both headset eyes with their own lenses.
      draw(vrCamera.camera, true);
    } else draw(activeCamera());
  }
  // Fog is part of every material's program, and only the perspective views
  // draw with it, so compile the scene both ways. Warm-up objects stand in for
  // materials that are not on screen yet.
  // Otherwise the first chase-camera frame, river or fare stalls the drive
  // while the browser compiles shaders, which phones feel the most.
  function precompile(warmupObjects = []) {
    const warmup = new THREE.Group(), fog = scene.fog, lens = activeCamera(), pending = [];
    for (const object of [...warmupObjects, carSilhouette.warmup]) warmup.add(object);
    const parallel = renderer.extensions.has('KHR_parallel_shader_compile'), skyVisible = clouds.group.visible, starsVisible = clouds.stars.visible;
    clouds.group.visible = clouds.stars.visible = true;
    try {
      for (const variant of [null, drivingFog]) {
        scene.fog = variant;
        for (const target of [scene, warmup]) {
          fogMaterials?.prepare(target);
          if (parallel) pending.push(renderer.compileAsync(target, lens, scene));
          else renderer.compile(target, lens, scene);
        }
      }
    } finally { scene.fog = fog; clouds.group.visible = skyVisible; clouds.stars.visible = starsVisible; }
    precompileShadowPrograms(renderer, scene, [scene, warmup], lens);
    // Upload textures now too. Otherwise the 4096 px sign atlas and its mipmaps
    // upload in the first frame that shows a sign.
    const textures = new Set();
    for (const target of [scene, warmup]) target.traverse(object => { for (const material of [object.material].flat()) if (material?.map) textures.add(material.map); });
    for (const texture of textures) renderer.initTexture(texture);
    // A program's first draw also reads back its uniforms and info log, which
    // for the fogged half waited for the first chase-camera frame (the title's
    // overhead views draw without fog). Do that now, behind the loading screen.
    return Promise.all(pending).then(() => {
      programs.warm();
      // Linking does not finish a driver's first-draw setup. Exercise the real
      // vertex layouts behind loading, on the same framebuffer as gameplay.
      // A render target would select different tone-mapping/output programs.
      const drawScene = new THREE.Scene(); drawScene.add(warmup);
      drawScene.environment = scene.environment;
      warmup.traverse(object => { object.visible = true; object.frustumCulled = false; });
      const viewport = renderer.getViewport(new THREE.Vector4()), scissor = renderer.getScissor(new THREE.Vector4());
      const scissorTest = renderer.getScissorTest(), target = renderer.getRenderTarget();
      const cubeFace = renderer.getActiveCubeFace(), mipLevel = renderer.getActiveMipmapLevel();
      const shadowAutoUpdate = renderer.shadowMap.autoUpdate, shadowNeedsUpdate = renderer.shadowMap.needsUpdate;
      const xrEnabled = renderer.xr.enabled, autoClear = renderer.autoClear;
      try {
        renderer.xr.enabled = false; renderer.autoClear = true;
        renderer.setRenderTarget(null);
        renderer.setViewport(0, 0, 1, 1); renderer.setScissor(0, 0, 1, 1); renderer.setScissorTest(true);
        // Allocate real shadow maps before the stand-ins sample them. A null
        // map binds a colour fallback, which is invalid for a shadow sampler.
        renderer.shadowMap.needsUpdate = true; renderer.render(scene, lens);
        renderer.shadowMap.autoUpdate = renderer.shadowMap.needsUpdate = false;
        scene.traverseVisible(object => {
          if (!object.isLight) return;
          const light = object.clone();
          if (light.shadow) { light.shadow.map = object.shadow.map; light.shadow.matrix.copy(object.shadow.matrix); }
          drawScene.add(light);
        });
        for (const variant of [null, drivingFog]) { drawScene.fog = variant; renderer.render(drawScene, lens); }
        // Finish the queued draws before loading clears, rather than merely
        // moving the stall to the next frame.
        const gl = renderer.getContext();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        programs.warm();
      } finally {
        renderer.setRenderTarget(target, cubeFace, mipLevel);
        renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
        renderer.shadowMap.autoUpdate = shadowAutoUpdate; renderer.shadowMap.needsUpdate = shadowNeedsUpdate;
        renderer.xr.enabled = xrEnabled; renderer.autoClear = autoClear;
      }
    });
  }
  function setView(index, remember = false, glide = false) {
    if (!Number.isInteger(index) || !views[index]) return views[view].label;
    const carry = glide && followedCar && !headsetCamera && activeCamera().isPerspectiveCamera && (views[index].thirdPerson || views[index].firstPerson);
    if (carry) cameraTransition.start(activeCamera(), followedCar);
    else cameraTransition.cancel();
    view = index; thirdPerson.snap(); firstPerson.snap();
    if (carry) {
      carryCameraLook(views[view].firstPerson ? firstPerson : thirdPerson, cameraTransition.camera, followedCar, reducedMotion);
      if (reducedMotion) cameraTransition.cancel();
    }
    updateFog();
    if (remember && !headsetCamera) cameraPreferences.setProfile(cameraMode, { view });
    return views[view].label;
  }
  function setZoom(value, immediate = false) {
    thirdPerson.setZoom(value);
    if (immediate) { cameraTransition.cancel(); thirdPerson.zoom = thirdPerson.zoomTarget; }
    if (!headsetCamera) cameraPreferences.setProfile(cameraMode, { zoom: thirdPerson.zoomTarget });
  }
  function useCameraProfile(mode, restore = false) {
    if (!cameraPreferences.profiles[mode] || (cameraMode === mode && !restore)) return;
    cameraMode = mode;
    if (headsetCamera) return;
    cameraTransition.cancel();
    const profile = cameraPreferences.profiles[mode];
    thirdPerson.setZoom(profile.zoom);
    if (view !== profile.view) setView(profile.view);
  }
  function recenter(immediate = false) {
    if (!followedCar || !activeCamera().isPerspectiveCamera) return;
    if (immediate || reducedMotion) cameraTransition.cancel();
    (views[view].firstPerson ? firstPerson : thirdPerson).recenter(followedCar, immediate || reducedMotion);
  }
  let desktopView;
  function enterVR() {
    headsetCamera = true;
    desktopView = view; setView(views.findIndex(view => view.thirdPerson));
    const session = renderer.xr.getSession(), scalable = typeof XRView !== 'undefined' && 'requestViewportScale' in XRView.prototype;
    graphics.setHeadset(true, { frameRate: session?.frameRate, scalable });
    session?.addEventListener?.('frameratechange', () => graphics.setHeadsetRate(session.frameRate));
    askHeadsetRate(graphics.headsetRate);
  }
  // Asks the headset for the supported refresh rate nearest `rate`. False if
  // it can't change or is there already.
  function askHeadsetRate(rate) {
    const session = renderer.xr.getSession(), rates = session?.supportedFrameRates;
    if (!session?.updateTargetFrameRate || !rates?.length) return false;
    const nearest = [...rates].sort((a, b) => Math.abs(a - rate) - Math.abs(b - rate) || a - b)[0];
    if (nearest === session.frameRate) return false;
    session.updateTargetFrameRate(nearest).then(() => graphics.setHeadsetRate(session.frameRate), () => {});
    return true;
  }
  // (Auto's last resort, see Graphics.judgeHeadset, and a new choice from the headset's menu)
  graphics.lowerHeadsetRate = () => renderer.xr.getSession()?.frameRate > HEADSET_FALLBACK_RATE && askHeadsetRate(HEADSET_FALLBACK_RATE);
  graphics.onChange((settings, reason) => { if (reason === 'headset-rate' && renderer.xr.isPresenting) askHeadsetRate(graphics.headsetRate); });
  function exitVR() {
    headsetCamera = false;
    if (cameraMode) useCameraProfile(cameraMode, true);
    else if (desktopView !== undefined) setView(desktopView);
    desktopView = undefined; graphics.setHeadset(false);
  }
  function addCuller(cull) { cullers.add(cull); return () => cullers.delete(cull); }
  // What the chase camera cannot see through (see ThirdPersonCamera.sight),
  // the ground it keeps above, and whether a bridge's deck is over a point
  function setSightLine(sight) { thirdPerson.sight = sight; }
  function setGround(ground, decked = null) { thirdPerson.ground = ground; thirdPerson.decked = decked; }
  function setCameraClearance(clearance) { thirdPerson.clearance = clearance; firstPerson.clearance = clearance; vrCamera.clearance = clearance; }
  // The mouse turns the chase camera round the car, or the view through the
  // player's eyes. Zoom crosses between those seats at the closest distance.
  const look = (yaw, pitch) => (views[view].firstPerson ? firstPerson : thirdPerson).look(yaw, pitch);
  const zoom = factor => {
    if (!Number.isFinite(factor) || factor <= 0 || factor === 1 || headsetCamera) return;
    if (views[view].firstPerson) {
      if (factor < 1) return;
      setZoom(CAMERA_ZOOM_MIN * factor);
      setView(views.findIndex(view => view.thirdPerson), true, true);
    } else if (views[view].thirdPerson) {
      const distance = thirdPerson.zoomTarget * factor;
      setZoom(distance);
      if (factor < 1 && distance <= CAMERA_ZOOM_MIN + 1e-6) setView(views.findIndex(view => view.firstPerson), true, true);
    }
  };
  const stencil = renderer.getContext().getContextAttributes()?.stencil === true;
  return { renderer, scene, graphics, ambientOcclusion, vrCamera, stencil, render, precompile, addCuller, setSightLine, setGround, setCameraClearance, look, zoom, setZoom, recenter, cameraPreferences, useCameraProfile,
    get cameraMode() { return cameraMode; }, get viewIndex() { return view; }, get zoomLevel() { return thirdPerson.zoomTarget; },
    enterVR, exitVR, setView, toggleAO() { return graphics.toggleAmbientOcclusion(); }, get camera() { return activeCamera(); }, update, resize, recordFrame, setWeather, get viewLabel() { return views[view].label; }, get chaseView() { return Boolean(views[view].thirdPerson); }, get firstPersonView() { return Boolean(views[view].firstPerson); }, toggleView() { return setView((view + 1) % views.length, true); }, snap() { initialized = false; cameraTransition.cancel(); thirdPerson.snap(); firstPerson.snap(); } };
}
