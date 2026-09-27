import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityWalker, WALKER_STYLES, WALKER_LOOKS, WALKER_SKIN, WALKER_HAIR, walkerAppearance, taxiGroupAppearance, createWalkerMaterial, createWalkerAlert, addWalkerAlert, setWalkerAppearance } from '../src/world/city-walkers.js';

// Every style is a morph target of one small shape, drawn by the thousand
test('the twelve walker styles share one lightweight topology', () => {
  const count = cityWalker.attributes.position.count, triangles = cityWalker.index.count / 3;
  for (const name of ['position', 'normal', 'color']) {
    assert.equal(cityWalker.morphAttributes[name].length, WALKER_STYLES.length);
    for (const attribute of cityWalker.morphAttributes[name]) assert.equal(attribute.count, count);
  }
  assert.ok(triangles <= 520 && count <= 520, `${triangles} triangles, ${count} vertices`);
});

// The vertex shader reads colours as masks: coat (r, 0, 0), skin (0, g, 0),
// hair (0, 0, b), trim (r, g, 0), trousers (0, g, 1); anything else with all
// three channels is its own colour. A stray mask would draw the wrong palette.
test('walker colours are all palette masks or plain colours', () => {
  for (const [style, colors] of cityWalker.morphAttributes.color.entries()) {
    for (let i = 0; i < colors.count; i++) {
      const r = colors.getX(i), g = colors.getY(i), b = colors.getZ(i), lit = [r, g, b].filter(c => c > 0).length;
      const known = lit === 3 || lit === 1 || (b === 0 && r > 0 && g > 0) || (r === 0 && g > 0 && b === 1);
      assert.ok(known, `${WALKER_STYLES[style]} vertex ${i}: ${r}, ${g}, ${b}`);
    }
  }
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

// What a ray from the middle of the head meets last on its way out, in one style
function outermost(style, direction) {
  const position = cityWalker.morphAttributes.position[style], color = cityWalker.morphAttributes.color[style], index = cityWalker.index.array;
  const ray = new THREE.Ray(new THREE.Vector3(0, 1.45, 0), direction.clone().normalize()), hit = new THREE.Vector3();
  const [a, b, c] = [0, 1, 2].map(() => new THREE.Vector3());
  let far = -1, mask = null;
  for (let i = 0; i < index.length; i += 3) {
    a.fromBufferAttribute(position, index[i]); b.fromBufferAttribute(position, index[i + 1]); c.fromBufferAttribute(position, index[i + 2]);
    if (!ray.intersectTriangle(a, b, c, false, hit)) continue;
    const distance = hit.distanceTo(ray.origin);
    if (distance > far) { far = distance; mask = [color.getX(index[i]), color.getY(index[i]), color.getZ(index[i])]; }
  }
  return mask;
}
const isHair = ([r, g, b]) => r === 0 && g === 0 && b > 0, isTrim = ([r, g, b]) => b === 0 && r > 0 && g > 0;

// Seen from behind (as the chase camera sees people walking ahead), short
// hair comes down to the nape: a cap over the crown alone read as a bald head
test('hair covers the back of the head down to the nape', () => {
  for (const style of [0, 1, 2, 3, 4, 6, 7, 8, 9, 11]) {
    for (const direction of [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -.45, 1), new THREE.Vector3(.5, -.3, 1)]) {
      assert.ok(isHair(outermost(style, direction)), `${WALKER_STYLES[style]} at ${direction.toArray()}`);
    }
  }
  // A beanie covers it; a bald head keeps a fringe round the back
  assert.ok(isTrim(outermost(10, new THREE.Vector3(0, 0, 1))));
  assert.ok(isHair(outermost(5, new THREE.Vector3(0, -.45, 1))) && !isHair(outermost(5, new THREE.Vector3(0, 1, 0))));
  // and the face stays clear under the hairline
  for (const style of WALKER_STYLES.keys()) assert.ok(!isHair(outermost(style, new THREE.Vector3(0, .05, -1))), WALKER_STYLES[style]);
});

// Sparse hair facets used to cut through the wider head facets between
// their rings, leaving isolated skin-coloured holes behind the temples.
// These points sit inside the hair, clear of its edge and the visible ears.
test('hair shells cover the head between their rings at the temples', () => {
  for (const [style, direction] of [
    [4, [-.93792, 0, .34684]], [8, [-.93792, 0, .34684]],
    [6, [-.96665, -.04998, .25116]], [9, [-.946, -.025, .32319]],
    [11, [-.83718, -.3429, -.4261]],
  ]) assert.ok(isHair(outermost(style, new THREE.Vector3(...direction))), WALKER_STYLES[style]);
});

// Hair a shade from the face hides the hairline, brows and beard in it
test('no resident has hair the colour of their face', () => {
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  for (let seed = 0; seed < 5000; seed++) {
    const { skin, hair } = walkerAppearance(seed * 131);
    const [s, h] = [rgb(WALKER_SKIN[skin]), rgb(WALKER_HAIR[hair])];
    assert.ok(Math.hypot(...s.map((c, i) => c - h[i])) >= 34, `${WALKER_SKIN[skin]} with ${WALKER_HAIR[hair]}`);
  }
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
