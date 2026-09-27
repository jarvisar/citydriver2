import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ShaderChunk } from 'three';
import { cityWalker, walkerShape, WALKER_STYLES, WALKER_OUTFITS, WALKER_FACES, WALKER_GEAR, WALKER_TARGETS, WALKER_CHANNELS as CH, WALKER_LOOKS, WALKER_SKIN, WALKER_HAIR,
  walkerAppearance, taxiGroupAppearance, pairWalkers, createWalkerMaterial, createWalkerAlert, addWalkerAlert, setWalkerAppearance, setWalkerTurn } from '../src/world/city-walkers.js';
import { glance } from '../src/world/pedestrian-reactions.js';

const SLOTS = [WALKER_OUTFITS, WALKER_STYLES, WALKER_FACES, WALKER_GEAR];
const base = SLOTS.map((_, i) => SLOTS.slice(0, i).reduce((sum, slot) => sum + slot.length, 0));

// Outfits, hair, faces and gear are each morph targets of one small shape,
// drawn by the thousand: 693 vertices and 620 triangles, one instanced draw
test('every combination shares one lightweight topology', () => {
  const count = cityWalker.attributes.position.count, triangles = cityWalker.index.count / 3;
  for (const name of ['position', 'normal', 'color']) {
    assert.equal(cityWalker.morphAttributes[name].length, WALKER_TARGETS);
    for (const attribute of cityWalker.morphAttributes[name]) assert.equal(attribute.count, count);
  }
  assert.equal(cityWalker.morphTargetsRelative, true);
  assert.ok(triangles <= 630 && count <= 710, `${triangles} triangles, ${count} vertices`);
});

// A target moves only its own slot's vertices, so the stock morph path (AO,
// with one weight a slot) builds the combination the walker shader picks
test('each slot\'s targets leave the other slots alone', () => {
  const slot = cityWalker.attributes.walkerSlot.array;
  SLOTS.forEach((variants, s) => variants.forEach((_, v) => {
    for (const name of ['position', 'normal', 'color']) {
      const array = cityWalker.morphAttributes[name][base[s] + v].array, size = name === 'color' ? 4 : 3;
      for (let k = 0; k < slot.length; k++) if (slot[k] !== s) for (let n = 0; n < size; n++) assert.equal(array[k * size + n], 0);
    }
  }));
});

// The vertex shader reads each vertex's paint as [channel, shade]: a stray
// channel would draw the wrong palette
test('walker paint is a known channel and a sensible shade', () => {
  const channels = new Set(Object.values(CH));
  for (let outfit = 0; outfit < WALKER_OUTFITS.length; outfit++) {
    const shape = walkerShape({ outfit, style: outfit, face: outfit % WALKER_FACES.length, gear: outfit % WALKER_GEAR.length });
    for (let k = 0; k < shape.slot.length; k++) {
      const channel = shape.color[k * 4], shade = shape.color[k * 4 + 1];
      assert.ok(channels.has(Math.round(channel)) && Math.abs(channel - Math.round(channel)) < 1e-5, `channel ${channel}`);
      assert.ok(shade > .5 && shade <= 1.1, `shade ${shade}`);
    }
  }
});

// The shader patches name three's own chunks: if an upgrade renamed one, the
// replacement would silently do nothing and every resident would be one shape
test('the walker shaders replace the chunks they patch', () => {
  const vertexShader = ['common', 'color_vertex', 'morphinstance_vertex', 'morphnormal_vertex', 'morphtarget_vertex', 'morphcolor_vertex'].map(chunk => `#include <${chunk}>`).join('\n');
  const fragmentShader = '#include <common>\n#include <emissivemap_fragment>';
  const shader = { vertexShader, fragmentShader, uniforms: {} };
  createWalkerMaterial().onBeforeCompile(shader);
  for (const chunk of ['color_vertex', 'morphinstance_vertex', 'morphnormal_vertex', 'morphtarget_vertex', 'morphcolor_vertex']) {
    assert.ok(ShaderChunk[chunk] !== undefined, chunk); assert.ok(!shader.vertexShader.includes(`<${chunk}>`), chunk);
  }
  assert.match(shader.vertexShader, /walkerYaw/);
});

// A party dresses from one wardrobe: a team shares its tops, other groups
// take turns between two coordinated coats rather than all wearing one
test('a taxi party is coordinated without every rider in one coat', () => {
  let alternating = 0, uniform = 0;
  for (let seed = 1; seed < 400; seed++) {
    const looks = new Set([0, 1, 2, 3].map(passenger => taxiGroupAppearance(seed * 7919, passenger).look));
    assert.ok(looks.size <= 2 && [...looks].every(look => look < WALKER_LOOKS.length));
    if (looks.size === 2) alternating++; else uniform++;
  }
  assert.ok(alternating > 250 && uniform > 20, `${alternating} alternating, ${uniform} uniform`);
});

// What a ray from the middle of the head meets last on its way out: the
// channel of the outermost surface, in one combination
function outermost(combination, direction) {
  const shape = walkerShape(combination), index = shape.index, p = shape.position;
  const ray = new THREE.Ray(new THREE.Vector3(0, 1.45, 0), direction.clone().normalize()), hit = new THREE.Vector3();
  const [a, b, c] = [0, 1, 2].map(() => new THREE.Vector3());
  let far = -1, channel = null;
  for (let i = 0; i < index.length; i += 3) {
    a.fromArray(p, index[i] * 3); b.fromArray(p, index[i + 1] * 3); c.fromArray(p, index[i + 2] * 3);
    if (!ray.intersectTriangle(a, b, c, false, hit)) continue;
    const distance = hit.distanceTo(ray.origin);
    if (distance > far) { far = distance; channel = Math.round(shape.color[index[i] * 4]); }
  }
  return channel;
}

// Seen from behind (as the chase camera sees people walking ahead), short
// hair comes down to the nape: a cap over the crown alone read as a bald head
test('hair covers the back of the head down to the nape', () => {
  const behind = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -.45, 1), new THREE.Vector3(.5, -.3, 1)];
  for (const style of [0, 1, 2, 3, 4, 6, 7, 8, 9, 11]) {
    for (const direction of behind) assert.equal(outermost({ style }, direction), CH.hair, `${WALKER_STYLES[style]} at ${direction.toArray()}`);
  }
  // Under a cap or a hat the hair shows at the nape; a headscarf covers all
  for (const style of [12, 13, 15]) {
    assert.equal(outermost({ style }, new THREE.Vector3(0, -.45, 1)), CH.hair, WALKER_STYLES[style]);
    assert.ok([CH.accent, CH.straw].includes(outermost({ style }, new THREE.Vector3(0, 1, .3))), WALKER_STYLES[style]);
  }
  for (const direction of [...behind, new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, -.3, .2)]) assert.equal(outermost({ style: 14 }, direction), CH.accent);
  // A beanie covers it; a bald head keeps a fringe round the back
  assert.equal(outermost({ style: 10 }, new THREE.Vector3(0, 0, 1)), CH.trim);
  assert.equal(outermost({ style: 5 }, new THREE.Vector3(0, -.45, 1)), CH.hair);
  assert.notEqual(outermost({ style: 5 }, new THREE.Vector3(0, 1, 0)), CH.hair);
  // and the face stays clear under the hairline, whatever the face
  for (const style of WALKER_STYLES.keys()) for (const face of WALKER_FACES.keys()) {
    assert.ok([CH.skin, CH.ink, CH.lens].includes(outermost({ style, face }, new THREE.Vector3(0, .05, -1))), `${WALKER_STYLES[style]} ${WALKER_FACES[face]}`);
  }
});

// Sparse hair facets used to cut through the wider head facets between
// their rings, leaving isolated skin-coloured holes behind the temples.
// These points sit inside the hair, clear of its edge and the visible ears.
test('hair shells cover the head between their rings at the temples', () => {
  for (const [style, direction] of [
    [4, [-.93792, 0, .34684]], [8, [-.93792, 0, .34684]],
    [6, [-.96665, -.04998, .25116]], [9, [-.946, -.025, .32319]],
    [11, [-.83718, -.3429, -.4261]],
  ]) assert.equal(outermost({ style }, new THREE.Vector3(...direction)), CH.hair, WALKER_STYLES[style]);
  // round the sides of a headscarf, all the way down
  for (let turn = 1.1; turn < 2.3; turn += .1) for (const rise of [.2, 0, -.3]) for (const side of [-1, 1]) {
    assert.equal(outermost({ style: 14 }, new THREE.Vector3(side * Math.sin(turn), rise, -Math.cos(turn))), CH.accent, `turn ${turn} rise ${rise}`);
  }
});

// Hair a shade from the face hides the hairline, brows and moustache in it
test('no resident has hair the colour of their face', () => {
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  for (let seed = 0; seed < 5000; seed++) {
    const { skin, hair } = walkerAppearance(seed * 131);
    const [s, h] = [rgb(WALKER_SKIN[skin]), rgb(WALKER_HAIR[hair])];
    assert.ok(Math.hypot(...s.map((c, i) => c - h[i])) >= 34, `${WALKER_SKIN[skin]} with ${WALKER_HAIR[hair]}`);
  }
});

// Each district dresses its own way, and some things never go together
test('residents dress for their district', () => {
  const tally = district => {
    const count = { suits: 0, workwear: 0, sunHats: 0, all: 0 };
    for (let seed = 0; seed < 2000; seed++) {
      const a = walkerAppearance(seed * 7919 + 11, district);
      count.all++;
      if (a.outfit === 14) count.suits++;
      if (a.look >= 27) count.workwear++;
      if (a.style === 15) count.sunHats++;
      // dresses and facial hair stay apart; a hood leaves no room for a backpack
      if (a.outfit === 12) assert.equal(a.presentation, 'feminine');
      if (a.face === 2) assert.equal(a.presentation, 'masculine');
      if ([2, 13].includes(a.outfit)) assert.ok(a.gear === 0 || a.gear === 2);
      // suits in suit cloth, and hi-vis only on work wear
      if (a.outfit === 14) assert.ok(a.look >= 24 && a.look <= 26);
      if (a.look >= 27) assert.ok([10, 15, 13, 2, 9].includes(a.outfit));
      for (const [key, size] of [['outfit', WALKER_OUTFITS], ['style', WALKER_STYLES], ['face', WALKER_FACES], ['gear', WALKER_GEAR]]) assert.ok(a[key] >= 0 && a[key] < size.length);
    }
    return count;
  };
  const midtown = tally('Midtown'), warehouse = tally('Warehouse district'), garden = tally('Garden quarter');
  assert.ok(midtown.suits > midtown.all * .15, `${midtown.suits} suits in Midtown`);
  assert.equal(warehouse.suits, 0);
  assert.ok(warehouse.workwear > warehouse.all * .08 && midtown.workwear === 0, `${warehouse.workwear} in work wear`);
  assert.ok(garden.sunHats > midtown.sunHats, 'sun hats in the gardens');
});

// Partners walk together dressed apart
test('paired residents wear different coats and cuts', () => {
  for (let seed = 0; seed < 300; seed++) {
    const walkers = [0, 1, 2, 3].map(i => ({ phase: i, speed: 1.5, side: 0, direction: 1, appearance: walkerAppearance(seed * 31 + i, 'Midtown') }));
    pairWalkers(walkers, seed);
    for (let i = 0; i + 1 < walkers.length; i += 2) {
      if (!walkers[i].pairOffset) continue;
      const [a, b] = [walkers[i].appearance, walkers[i + 1].appearance];
      assert.ok(a.look !== b.look && a.outfit !== b.outfit);
    }
  }
});

// Heads turn toward a car going by, never round behind them, and ease back
test('residents glance round at what passes, on a spring', () => {
  const person = { phase: 0 };
  // (facing -z at the origin: a car to their right, at +x, is a turn of -π/2,
  // held at the most a head turns)
  let turn = glance(person, 0, 0, 0, { x: 6, z: 0 }, 0);
  assert.ok(Math.abs(turn + 1.1) < 1e-9, `${turn}`);
  // behind them, or far off: back ahead (or an idle whim) on the spring
  for (let t = 1 / 30; t < 3; t += 1 / 30) turn = glance(person, 0, 0, 0, { x: 0, z: 8 }, t);
  assert.ok(Math.abs(turn) <= .85 + 1e-6);
  const far = glance({ phase: 0 }, 0, 0, 0, { x: 30, z: -30 }, 0);
  assert.ok(Math.abs(far) <= .85 + 1e-6);
  // a moment's look eases in rather than snapping
  const easing = { phase: 0 };
  glance(easing, 0, 0, 0, null, 0);
  const next = glance(easing, 0, 0, 0, { x: -5, z: -5 }, 1 / 30);
  assert.ok(next > 0 && next < .5, `${next}`);
});

test('a head turn rides in the instance colour, beside the choices', () => {
  const mesh = new THREE.InstancedMesh(cityWalker, createWalkerMaterial(), 2);
  setWalkerAppearance(mesh, 1, { look: 5, skin: 3, hair: 2, style: 11, outfit: 12, face: 4, gear: 2, legs: 4, accent: 7 });
  const [r, g] = [mesh.instanceColor.array[3], mesh.instanceColor.array[4]];
  assert.equal(r & 15, 12); assert.equal((r >> 4) & 15, 11); assert.equal((r >> 8) & 7, 4); assert.equal((r >> 11) & 3, 2); assert.equal((r >> 13) & 31, 5);
  assert.equal(g & 7, 3); assert.equal((g >> 3) & 7, 2); assert.equal((g >> 6) & 7, 4); assert.equal((g >> 9) & 7, 7);
  setWalkerTurn(mesh, 1, -.7);
  assert.ok(Math.abs(mesh.instanceColor.array[5] + .7) < 1e-6);
  // one weight a slot for the renderer's own passes
  const weights = new Array(WALKER_TARGETS).fill(0);
  mesh.getMorphAt(1, { morphTargetInfluences: weights });
  const on = weights.map((w, i) => w ? i : -1).filter(i => i >= 0);
  assert.deepEqual(on, [12, base[1] + 11, base[2] + 4, base[3] + 2]);
  assert.ok(mesh.customDepthMaterial?.isMeshDepthMaterial);
});

// Demolition's warning: the mask marks the stencil where a resident stands in
// front of the buildings (drawn after them, before anything else), and the
// ghost draws last, only there and only behind something nearer. Off, and
// drawing nothing, until a run switches it on.
test('the demolition warning shows residents through props but not buildings, and is off by default', () => {
  const alert = createWalkerAlert(), material = createWalkerMaterial();
  assert.equal(material.userData.alert.value, 0);
  assert.equal(alert.mask.visible, false); assert.equal(alert.ghost.visible, false);
  assert.equal(alert.mask.colorWrite, false); assert.equal(alert.mask.depthWrite, false);
  assert.equal(alert.mask.stencilWrite, true); assert.equal(alert.mask.stencilZPass, THREE.ReplaceStencilOp);
  assert.equal(alert.ghost.transparent, true); assert.equal(alert.ghost.depthWrite, false);
  assert.equal(alert.ghost.depthFunc, THREE.GreaterDepth);
  assert.equal(alert.ghost.stencilFunc, THREE.EqualStencilFunc); assert.equal(alert.ghost.stencilRef, alert.mask.stencilRef);
  // (each pixel once: parts of one resident never blend over each other)
  assert.equal(alert.ghost.stencilZPass, THREE.ZeroStencilOp);

  const mesh = new THREE.InstancedMesh(cityWalker, material, 3);
  for (let i = 0; i < 3; i++) setWalkerAppearance(mesh, i, walkerAppearance(i));
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
  addWalkerAlert(mesh, alert);
  const [mask, ghost] = mesh.children;
  assert.equal(mask.material, alert.mask); assert.equal(ghost.material, alert.ghost);
  // buildings draw at -2 and everything else from 0, so the mask sits between
  assert.equal(mask.renderOrder, -1); assert.equal(ghost.renderOrder, 2);
  for (const copy of [mask, ghost]) {
    assert.equal(copy.geometry, cityWalker); assert.equal(copy.count, 3);
    assert.equal(copy.instanceMatrix, mesh.instanceMatrix); assert.equal(copy.instanceColor, mesh.instanceColor);
    assert.equal(copy.morphTexture, mesh.morphTexture); assert.equal(copy.boundingSphere, mesh.boundingSphere);
    assert.equal(copy.castShadow, false); assert.equal(copy.userData.ambientOcclusion, false);
  }
  let disposed = false;
  cityWalker.addEventListener('dispose', () => { disposed = true; });
  mesh.dispose();
  assert.equal(disposed, false, 'the shared geometry stays');
  assert.equal(mask.morphTexture, null); assert.equal(ghost.morphTexture, null);
});
