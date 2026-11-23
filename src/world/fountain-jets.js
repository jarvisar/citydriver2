import * as THREE from 'three';

// The fountains' water in motion, as shapes of water rather than drops: a
// jet up out of the spout that opens into a crown and falls back torn into
// streams, a curtain spilling all round each bowl's rim, a ring of jets
// arching in from the basin's edge on the bigger fountains, foam where the
// water lands and ripples running out over the pools. Each fountain's shapes
// are built once, when it first comes near; a shader moves the water over
// them, so a frame costs a distance check per fountain and allocates
// nothing. Only the fountains nearest the camera are drawn, one draw each,
// in a transparent material of their own (no shadows, no AO). After dark the
// water glows a little, as if lit from the basin.
//
// A fountain (see CityChunk.fountain) is { x, z, phase, spout, plume, bowls,
// pool, ring }: the spout's top (y) and how high its jet rises, each bowl
// that spills as [radius, water y] from the top one down, the basin's pool
// as [radius, water y], and how many jets arch in from the pool's edge.

// Fountains within NEAR (m) of the camera are drawn, at most MOST of them;
// their shapes are made from AHEAD, a part a frame (one already within NEAR
// HURRY ms of them a frame), and those of KEEP fountains are kept
const NEAR = 85, AHEAD = 140, MOST = 4, KEEP = 24, GRAVITY = 9.8, HURRY = .3, BIG = 'big';
// Each vertex's `flow` is (meters along the water's way, a coordinate across
// it counted in streams, how far it has torn into streams, kind + seed)
const WATER = 0, FOAM = 1, RIPPLE = 2, SPLASH = 3;
const CLEAR = new THREE.Color('#cfeef3'), WHITE = new THREE.Color('#ffffff');
const byDistance = (a, b) => a.distance - b.distance;

class Shape {
  constructor() { this.position = []; this.colour = []; this.flow = []; this.index = []; }
  // A grid of rows by columns, `at(i, j)` giving each vertex as
  // [x, y, z, colour, alpha, flow], and quads between neighbors
  grid(rows, columns, at) {
    const first = this.position.length / 3;
    for (let i = 0; i < rows; i++) for (let j = 0; j < columns; j++) {
      const [x, y, z, colour, alpha, flow] = at(i, j);
      this.position.push(x, y, z); this.colour.push(colour.r, colour.g, colour.b, alpha); this.flow.push(...flow);
    }
    for (let i = 0; i + 1 < rows; i++) for (let j = 0; j + 1 < columns; j++) {
      const a = first + i * columns + j, b = a + columns;
      this.index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  // A surface of revolution round the fountain's axis through `profile`
  // ({ r, y, along, tear, alpha, colour }), `streams` of them round it
  lathe(profile, segments, streams, kind, seed, turn = 0) {
    this.grid(profile.length, segments + 1, (i, j) => {
      const p = profile[i], a = turn + j / segments * Math.PI * 2;
      return [Math.cos(a) * p.r, p.y, Math.sin(a) * p.r, p.colour ?? CLEAR, p.alpha, [p.along, j / segments * streams, p.tear ?? 0, kind + seed]];
    });
  }
  // A tube along `path` ([x, y, z] points), `radius(t)` thick from end to end
  tube(path, radius, sides, alpha, seed) {
    const along = [0];
    for (let i = 1; i < path.length; i++) along.push(along[i - 1] + Math.hypot(...path[i].map((v, k) => v - path[i - 1][k])));
    const tangent = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(), across = new THREE.Vector3(1, 0, 0);
    this.grid(path.length, sides + 1, (i, j) => {
      const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
      tangent.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      side.crossVectors(tangent, Math.abs(tangent.x) > .9 ? up.set(0, 1, 0) : across).normalize();
      up.crossVectors(tangent, side);
      const angle = j / sides * Math.PI * 2, r = radius(i / (path.length - 1)), c = Math.cos(angle) * r, s = Math.sin(angle) * r;
      return [path[i][0] + side.x * c + up.x * s, path[i][1] + side.y * c + up.y * s, path[i][2] + side.z * c + up.z * s, CLEAR, alpha, [along[i], j / sides, 0, WATER + seed]];
    });
  }
  // A flat ring from `inner` to `outer` at `y`
  ring(inner, outer, y, segments, kind, seed, alpha, flow = (r, j) => [r, j / segments * Math.round(outer * 20), 0]) {
    this.grid(2, segments + 1, (i, j) => {
      const r = i ? outer : inner, a = j / segments * Math.PI * 2;
      return [Math.cos(a) * r, y, Math.sin(a) * r, kind === RIPPLE ? CLEAR : WHITE, alpha, [...flow(r, j), kind + seed]];
    });
  }
  // A small cone of spray at (x, z) on the water at `y`, pulsing in height
  splash(x, y, z, radius, height, seed) {
    const sides = 6;
    this.grid(2, sides + 1, (i, j) => {
      const a = j / sides * Math.PI * 2, r = i ? radius : radius * .12;
      return [x + Math.cos(a) * r, y + (i ? 0 : height), z + Math.sin(a) * r, WHITE, i ? .45 : .7, [y, 0, 0, SPLASH + seed]];
    });
  }
  *geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colour, 4));
    g.setAttribute('flow', new THREE.Float32BufferAttribute(this.flow, 4));
    g.setIndex(this.index);
    // (the normals next, the biggest part: see FountainJets.ahead)
    yield BIG;
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

// Points along the fall of water leaving (r, y) at (out, rise) m/s until it
// is down to `low`, `count` of them
function fall(r, y, out, rise, low, count) {
  const time = (rise + Math.sqrt(rise * rise + 2 * GRAVITY * Math.max(0, y - low))) / GRAVITY;
  return Array.from({ length: count }, (_, k) => { const t = k / (count - 1) * time; return { r: r + out * t, y: y + rise * t - GRAVITY * t * t / 2 }; });
}
// How far along a profile each point is, from `start`
function measure(points, start = 0) {
  let along = start;
  return points.map((p, k) => { if (k) along += Math.hypot(p.r - points[k - 1].r, p.y - points[k - 1].y); return { ...p, along }; });
}

// A fountain's water, round its own axis
export function fountainGeometry(f) {
  const steps = fountainSteps(f);
  for (;;) { const step = steps.next(); if (step.done) return step.value; }
}
// The same a part at a time, the last step returning it (see
// FountainJets.ahead): made in one go, a big fountain's water held a frame
// up a millisecond or more
export function* fountainSteps(f) {
  const shape = new Shape(), seed = k => (((f.phase ?? 0) * .137 + k * .618) % 1 + 1) % 1 * .999;
  const [poolRadius, poolY] = f.pool, bowls = f.bowls ?? [];
  const ripples = (from, to, y, count, salt) => {
    if (to - from < .3) return;
    for (let k = 0; k < count; k++) shape.ring(from, from + .05, y + .006, 32, RIPPLE, (k / count + seed(salt) * .2) % 1, .38, () => [0, to / from, 0]);
  };
  // The jet: a column out of the spout, widening as it slows, that opens at
  // its top into a crown falling back torn into streams
  const top = f.spout + f.plume, [catchRadius, catchY] = bowls[0] ?? [poolRadius, poolY];
  const land = Math.min(catchRadius * (bowls.length ? .7 : .45), catchRadius - .25, .9);
  shape.tube([0, .25, .5, .75, 1].map(t => [0, f.spout - .05 + t * (f.plume + .05), 0]), t => .045 + t * .04, 6, .72, seed(1));
  const time = Math.sqrt(2 * (top - catchY) / GRAVITY), out = (land - .1) / time;
  const crown = measure([{ r: 0, y: top + .14 }, { r: .07, y: top + .12 }, ...fall(.1, top, out, 0, catchY, 8)], f.plume)
    .map((p, k, all) => ({ ...p, alpha: .62 - .14 * k / all.length, tear: Math.min(1, Math.max(0, (k - 2) / (all.length - 5))) }));
  shape.lathe(crown, 20, 18, WATER, seed(2));
  yield;
  shape.ring(Math.max(.05, land - .08), land + .16, catchY + .012, 24, FOAM, seed(3), .7);
  if (bowls.length) ripples(land + .14, catchRadius * .92, catchY, 2, 4);
  // A curtain over each bowl's rim, down to the bowl below or the pool,
  // landing well inside it
  for (const [k, [radius, y]] of bowls.entries()) {
    yield;
    const [belowRadius, belowY] = bowls[k + 1] ?? [poolRadius, poolY], start = radius + .04, spill = y + .03, lift = .22;
    const time = (lift + Math.sqrt(lift * lift + 2 * GRAVITY * (spill - belowY))) / GRAVITY;
    const reach = Math.max(.1, Math.min(.42 + .12 * radius, (belowRadius - .25 - start) / time));
    const curtain = measure([{ r: radius - .06, y: y + .012 }, ...fall(start, spill, reach, lift, belowY, 7)])
      .map((p, i, all) => ({ ...p, alpha: .74 - .2 * i / all.length, tear: Math.max(0, (i - 2) / (all.length - 3)) * .9 }));
    const segments = Math.max(16, Math.min(40, Math.round(Math.PI * 2 * radius / .24))), landing = curtain.at(-1).r;
    shape.lathe(curtain, segments, Math.round(Math.PI * 2 * radius / .2), WATER, seed(10 + k), Math.PI / segments);
    yield;
    shape.ring(landing - .1, landing + .2, belowY + .012, Math.max(20, segments), FOAM, seed(20 + k), .72);
    ripples(landing + .16, belowRadius - .1, belowY, k === bowls.length - 1 ? 3 : 2, 30 + k);
  }
  // Jets arching in from just under the pool's edge to land between the
  // curtain and the basin's wall, each with its splash
  const inner = (bowls.at(-1)?.[0] ?? 0) + .5, from = poolRadius - .18, span = from - inner;
  if (f.ring && bowls.length && span > .28) {
    const height = Math.min(2.2, .55 + .4 * span), rise = Math.sqrt(2 * GRAVITY * height), flight = 2 * rise / GRAVITY, speed = span / flight;
    for (let k = 0; k < f.ring; k++) {
      if (k % 3 === 0) yield;
      const a = (k + .5) / f.ring * Math.PI * 2, cos = Math.cos(a), sin = Math.sin(a);
      const path = Array.from({ length: 14 }, (_, i) => { const t = i / 13 * flight, r = from - speed * t; return [cos * r, poolY - .02 + rise * t - GRAVITY * t * t / 2, sin * r]; });
      shape.tube(path, t => .036 - t * .008, 5, .7, seed(40 + k));
      shape.splash(cos * inner, poolY + .01, sin * inner, .18, .22, seed(60 + k));
    }
  }
  yield;
  return yield* shape.geometry();
}

// One material for all of it: water lit as anything else, its streaks, the
// tearing into streams, the foam's shimmer, the ripples and splashes all
// moved by the clock in the shader
function waterMaterial(uniforms) {
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, forceSinglePass: true, roughness: .16, metalness: 0 });
  material.customProgramCacheKey = () => 'citydriver-fountain-water-v1';
  material.onBeforeCompile = shader => {
    shader.uniforms.fountainTime = uniforms.time;
    shader.uniforms.fountainGlow = uniforms.glow;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `
      #include <common>
      uniform float fountainTime;
      attribute vec4 flow;
      varying vec4 vFlow;
      varying float vFade;
    `).replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vFlow = flow;
      vFade = 1.0;
      float fountainKind = floor(flow.w), fountainSeed = fract(flow.w);
      if (fountainKind == ${RIPPLE}.0) {
        float grown = fract(fountainTime * 0.42 + fountainSeed);
        transformed.xz *= mix(1.0, flow.y, grown);
        vFade = (1.0 - grown) * smoothstep(0.0, 0.15, grown);
      } else if (fountainKind == ${SPLASH}.0) {
        transformed.y = flow.x + (transformed.y - flow.x) * (0.55 + 0.45 * sin(fountainTime * 10.0 + fountainSeed * 6.2832));
      }
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      uniform float fountainTime;
      uniform float fountainGlow;
      varying vec4 vFlow;
      varying float vFade;
    `).replace('#include <color_fragment>', `
      #include <color_fragment>
      float fountainKind = floor(vFlow.w), fountainSeed = fract(vFlow.w);
      if (fountainKind == ${WATER}.0) {
        // Bright streaks running with the water, and lower down the sheet
        // breaking into separate streams that wander a little
        float streak = smoothstep(0.55, 0.95, 0.5 + 0.5 * sin((vFlow.x - fountainTime * 2.6) * 7.0 + vFlow.y * 2.1 + fountainSeed * 40.0));
        // (streams and the gaps between them of uneven widths, swaying)
        float across = vFlow.y + 0.3 * sin(vFlow.y * 0.61 + fountainSeed * 5.0) + 0.22 * sin(vFlow.x * 2.7 - fountainTime * 0.8 + fountainSeed * 9.0);
        float gap = 0.28 + 0.2 * sin(vFlow.y * 1.37 + fountainSeed * 3.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), streak * 0.45 + vFlow.z * 0.3);
        diffuseColor.a *= mix(1.0, smoothstep(gap, gap + 0.4, abs(sin(across * 3.14159))), vFlow.z) * (0.78 + streak * 0.22);
      } else if (fountainKind == ${FOAM}.0) {
        diffuseColor.a *= 0.72 + 0.28 * sin(vFlow.y * 6.2832 + fountainTime * 3.1 + fountainSeed * 17.0 + 1.6 * sin(vFlow.x * 19.0 - fountainTime * 2.3));
      } else {
        diffuseColor.a *= vFade;
      }
      if (diffuseColor.a < 0.02) discard;
    `).replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      totalEmissiveRadiance += diffuseColor.rgb * (0.14 + fountainGlow * 0.7);
    `);
  };
  return material;
}

export class FountainJets {
  constructor(scene) {
    this.uniforms = { time: { value: 0 }, glow: { value: 0 } };
    this.material = waterMaterial(this.uniforms);
    // (an empty shape, with the attributes anything walking the scene expects, until a fountain comes near)
    this.empty = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    this.meshes = Array.from({ length: MOST }, (_, k) => {
      const mesh = new THREE.Mesh(this.empty, this.material);
      mesh.name = `citydriver-fountain-water-${k}`;
      mesh.castShadow = false; mesh.receiveShadow = false; mesh.userData.ambientOcclusion = false; mesh.visible = false;
      scene.add(mesh);
      return mesh;
    });
    // (and those part made, by key: see fountainSteps)
    this.shapes = new Map(); this.making = new Map();
    this.eye = new THREE.Vector3(); this.near = [];
  }
  // After dark the water glows (see CitydriverWorld.setWindowGlow)
  setGlow(amount) { this.uniforms.glow.value = amount; }
  // The water of the fountains near the camera at `time`, from the chunks'
  // fountains, which lie `origin` along z from the scene
  update(time, chunks, camera = null, origin = 0) {
    this.uniforms.time.value = time;
    const near = this.near;
    near.length = 0;
    if (camera) camera.getWorldPosition(this.eye);
    // (nothing allocated a frame: a fountain keeps its distance on itself;
    // and one coming near has its shapes made ahead, a part of one a frame)
    let next = null;
    for (const chunk of chunks) {
      const fountains = chunk.features?.fountains;
      if (fountains) for (const fountain of fountains) {
        fountain.distance = camera ? Math.hypot(fountain.x - this.eye.x, fountain.z + origin - this.eye.z) : 0;
        fountain.key ??= this.key(fountain);
        if (fountain.distance < NEAR) near.push(fountain);
        else if (fountain.distance < AHEAD && !next && !this.shapes.has(fountain.key)) next = fountain;
      }
    }
    near.sort(byDistance);
    // One in reach without its shapes (a chunk built with it already near,
    // or a jump) has them made first, up to HURRY ms of them a frame, and
    // shows once they are: made whole, four at once held a frame up several
    // milliseconds
    for (let n = 0; n < MOST && n < near.length; n++) if (!this.shapes.has(near[n].key)) { next = near[n]; break; }
    if (next) this.ahead(next, next.distance < NEAR ? performance.now() + HURRY : 0);
    for (let n = 0; n < MOST; n++) {
      const mesh = this.meshes[n], fountain = near[n], geometry = fountain && this.shapes.get(fountain.key);
      mesh.visible = Boolean(geometry);
      if (!geometry) continue;
      mesh.geometry = geometry;
      mesh.position.set(fountain.x, 0, fountain.z + origin);
    }
  }
  // A fountain's shapes, made when first wanted and kept (a chunk built
  // again makes new records for the same fountains, so they go by place)
  key(fountain) { return `${fountain.x.toFixed(1)},${fountain.z.toFixed(1)}`; }
  // The next part of a fountain's shapes (see fountainSteps), and more until
  // `until` (a performance.now() time), leaving the biggest for a frame of its own
  ahead(fountain, until = 0) {
    const key = fountain.key;
    let steps = this.making.get(key);
    if (!steps) {
      // (a few part-made at most: those of fountains driven away from go, oldest first)
      if (this.making.size >= MOST) this.making.delete(this.making.keys().next().value);
      this.making.set(key, steps = fountainSteps(fountain));
    }
    let step;
    do step = steps.next(); while (!step.done && step.value !== BIG && performance.now() < until);
    if (step.done) { this.making.delete(key); this.keep(key, step.value); }
  }
  keep(key, geometry) {
    this.shapes.set(key, geometry);
    if (this.shapes.size > KEEP) for (const [old, kept] of this.shapes) {
      if (this.meshes.some(mesh => mesh.geometry === kept)) continue;
      kept.dispose(); this.shapes.delete(old); break;
    }
    return geometry;
  }
  // (its program, compiled with the city, on water as big as any: making it
  // runs the code a first fountain near the player would run cold)
  warmupObjects() {
    this.warmup ??= fountainGeometry({ spout: 2.4, plume: 1.6, bowls: [[.7, 2.1], [1.3, 1.3], [2, .8]], pool: [4.6, .5], ring: 10 });
    return [new THREE.Mesh(this.warmup, this.material)];
  }
  dispose() {
    for (const mesh of this.meshes) mesh.removeFromParent();
    for (const geometry of this.shapes.values()) geometry.dispose();
    this.shapes.clear(); this.empty.dispose(); this.warmup?.dispose(); this.material.dispose();
  }
}
