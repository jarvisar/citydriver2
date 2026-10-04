import * as THREE from 'three';

// Shop windows and office lobbies light up after dark. Their panes are drawn
// with every other window's glass, and a pane whose instance color has its
// red raised by one (see nightLit) is lit: the shader takes the one off for
// its daylight color and adds a glow as the lit rooms come on (see
// setWindowGlow). Green raised too makes it a cool white shop light, blue a
// dimmer one. That needs no material or draw of its own, which works because
// the glass batches are never merged, so their colors stay floats (see
// mergeable in citydriver-world.js). So no glass may be pure white in any
// channel: 1 and over is the mark.
const WARM = new THREE.Color('#ffc274'), COOL = new THREE.Color('#d8e5f4');
const vec = c => `vec3( ${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)} )`;

export function createGlassMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .2, metalness: .25, flatShading: true });
  const glow = material.userData.shopGlow = { value: 0 };
  material.onBeforeCompile = shader => {
    shader.uniforms.shopGlow = glow;
    // (how far up its pane a point is: the ceiling lights make a shop brighter at the top)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying float vShopHeight;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n\tvShopHeight = position.y + .5;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float shopGlow;\nvarying float vShopHeight;`)
      .replace('#include <color_fragment>', `vec3 shopLight = vec3( 0.0 );
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	vec3 shopMark = step( vec3( 1.0 ), vColor.rgb );
	diffuseColor *= vec4( vColor.rgb - shopMark, vColor.a );
	shopLight = shopMark.x * ( 1.0 - .45 * shopMark.z ) * mix( ${vec(WARM)}, ${vec(COOL)}, shopMark.y );
#endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
	totalEmissiveRadiance += shopGlow * shopLight * ( .2 + .9 * vShopHeight * vShopHeight );`);
  };
  material.customProgramCacheKey = () => 'city-glass';
  return material;
}

// A pane's color by day, as a hex string, whether or not it is marked
export function daylight(colour) {
  if (typeof colour === 'string') return colour;
  const c = new THREE.Color(colour);
  if (c.r >= 1) { c.r -= 1; if (c.g >= 1) c.g -= 1; if (c.b >= 1) c.b -= 1; }
  return `#${c.getHexString()}`;
}

// A pane's color, marked to glow at night: `light` 0 warm, 1 cool white, 2 dim warm
const marked = new Map();
export function nightLit(colour, light = 0) {
  const key = `${colour} ${light}`;
  let lit = marked.get(key);
  if (!lit) {
    lit = new THREE.Color(colour);
    lit.r += 1; if (light === 1) lit.g += 1; if (light === 2) lit.b += 1;
    marked.set(key, lit);
  }
  return lit;
}
