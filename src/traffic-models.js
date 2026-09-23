import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { stableShadowDepth } from './world/shadow-depth.js';

export const TRAFFIC_MODELS = [
  { name: 'hatchback', width: 1.85, length: 3.45, cabin: [1.63, .75, 1.95], cabinZ: .25 },
  { name: 'sedan', width: 1.98, length: 4.25, cabin: [1.75, .7, 2.05], cabinZ: .05 },
  { name: 'wagon', width: 2, length: 4.55, cabin: [1.78, .85, 2.95], cabinZ: .37 },
  { name: 'pickup', width: 2.12, length: 5.2, cabin: [1.89, .95, 1.8], cabinZ: -.7 },
  { name: 'van', width: 2.08, length: 5.15, cabin: [1.93, 1.35, 3.95], cabinZ: .32 },
];

// Chooser-only: a low, short-cabin coupe. It is never spawned into traffic and
// is not any route's own car, so the roads keep their ordinary-looking fleet.
export const SPORTS_MODEL = { name: 'sports', width: 1.94, length: 4.2, cabin: [1.6, .56, 1.84], cabinZ: .3, drop: .2 };

export const TRAFFIC_COLORS = ['#d8c7a0', '#e9e5d9', '#577f96', '#829789', '#b34e43', '#d2a345', '#58636a', '#b7c4c9', '#796c8c', '#397e7b'];

export const WHEEL = { radius: .43, width: .25, hubRadius: .21, hubWidth: .26, y: .44 };

// Build one body shape as four merged geometries. Traffic bakes its wheels into
// the details mesh; a driven car asks for them separately so they can turn.
export function vehicleGeometry(spec, { separateWheels = false } = {}) {
  const parts = { paint: [], details: [], headlights: [], taillights: [] };
  const wheels = [];
  function add(geometry, location, category, color) {
    geometry.deleteAttribute('uv');
    geometry.translate(...location);
    if (color) {
      const tint = new THREE.Color(color), colors = [];
      for (let i = 0; i < geometry.attributes.position.count; i++) colors.push(tint.r, tint.g, tint.b);
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    }
    parts[category].push(geometry);
  }
  const box = (size, location, category = 'paint', color) => add(new THREE.BoxGeometry(...size), location, category, color);
  const { width: w, length: l, cabin: [cw, ch, cl], cabinZ: cz, name, drop = 0 } = spec;
  const roofY = 1.22 + ch;
  // Clip the four corners without adding subdivisions to the long body sides.
  // The short bevels catch light while keeping the original flat-panel style.
  const corner = .12;
  const outline = new THREE.Shape();
  outline.moveTo(-w / 2 + corner, -l / 2);
  for (const [x, z] of [[w / 2 - corner, -l / 2], [w / 2, -l / 2 + corner],
    [w / 2, l / 2 - corner], [w / 2 - corner, l / 2], [-w / 2 + corner, l / 2],
    [-w / 2, l / 2 - corner], [-w / 2, -l / 2 + corner]]) outline.lineTo(x, z);
  outline.closePath();
  const shell = new THREE.ExtrudeGeometry(outline, { depth: .65, bevelEnabled: false, steps: 1 });
  shell.rotateX(Math.PI / 2);
  // Extrusion is non-indexed; all pieces must share the box geometry format.
  shell.setIndex(Array.from({ length: shell.attributes.position.count }, (_, i) => i));
  add(shell, [0, 1.215, 0], 'paint');
  const deck = new THREE.BoxGeometry(w * .94, .13, l - .14);
  const deckVertices = deck.attributes.position;
  for (let i = 0; i < deckVertices.count; i++) {
    if (name === 'sports' && deckVertices.getZ(i) < 0) deckVertices.setY(i, deckVertices.getY(i) - .06);
  }
  deck.computeVertexNormals();
  add(deck, [0, 1.24, 0], 'paint');
  // Slightly sloped glass keeps the silhouettes in the player's faceted style.
  const glass = new THREE.BoxGeometry(cw, ch, cl);
  const vertices = glass.attributes.position;
  for (let i = 0; i < vertices.count; i++) if (vertices.getY(i) > 0) {
    vertices.setX(i, vertices.getX(i) * .94);
    vertices.setZ(i, vertices.getZ(i) + (vertices.getZ(i) < 0 ? .24 : -.12));
  }
  glass.computeVertexNormals();
  add(glass, [0, 1.22 + ch / 2, cz], 'details', '#344e55');
  box([cw * .94 + .08, .1, cl - .24], [0, roofY + .025, cz + .06]);
  for (const side of [-1, 1]) {
    // Follow the sloped glass edges: vertical posts left the windshield looking
    // like a dark box perched on the doors.
    for (const [end, rake] of [[-1, .24], [1, -.12]]) {
      const pillar = new THREE.BoxGeometry(.085, ch + .02, .1), p = pillar.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) {
        p.setX(i, p.getX(i) - side * cw * .03);
        p.setZ(i, p.getZ(i) + rake);
      }
      pillar.computeVertexNormals();
      add(pillar, [side * (cw / 2 - .015), 1.22 + ch / 2, cz + end * (cl / 2 - .025)], 'paint');
    }
    const post = new THREE.BoxGeometry(.085, ch, .12), pv = post.attributes.position;
    for (let i = 0; i < pv.count; i++) if (pv.getY(i) > 0) pv.setX(i, pv.getX(i) - side * cw * .03);
    post.computeVertexNormals();
    add(post, [side * (cw / 2 - .02), 1.22 + ch / 2, cz + .16], 'paint');
    box([.09, .12, cl], [side * cw / 2, 1.25, cz]);
    box([.19, .15, .25], [side * (w / 2 + .06), 1.46, cz - cl / 2 + .2]);
    box([.07, .065, .24], [side * (w / 2 + .01), 1.11, cz + .38], 'details', '#c6c9bd');
    box([.39, .23, .04], [side * w * .32, 1.01, -l / 2 - .022], 'headlights');
    box([.3, .2, .04], [side * w * .35, 1.01, l / 2 + .022], 'taillights');
    for (const z of [-l * .3, l * .3]) {
      if (separateWheels) { wheels.push({ x: side * w / 2, y: WHEEL.y, z, front: z < 0 }); continue; }
      const tire = new THREE.CylinderGeometry(WHEEL.radius, WHEEL.radius, WHEEL.width, 10); tire.rotateZ(Math.PI / 2);
      add(tire, [side * w / 2, WHEEL.y, z], 'details', '#2b3434');
      const hub = new THREE.CylinderGeometry(WHEEL.hubRadius, WHEEL.hubRadius, WHEEL.hubWidth, 8); hub.rotateZ(Math.PI / 2);
      add(hub, [side * w / 2, WHEEL.y, z], 'details', '#bfc4b9');
    }
  }
  for (const end of [-1, 1]) {
    // Meet the corner caps at their inner edges so the exposed top faces
    // share a seam instead of overlapping.
    box([w * .91 - .12, .14, .14], [0, .66, end * l / 2], 'details', '#bbc0b6');
    box([w * .8, .075, .16], [0, .57, end * (l / 2 - .035)], 'details', '#2b3434');
    for (const side of [-1, 1]) box([.12, .14, .22], [side * w * .455, .66, end * (l / 2 - .075)], 'details', '#46514f');
  }
  box([.68, .19, .04], [0, .99, -l / 2 - .023], 'details', '#2b3434');
  box([.49, .17, .04], [0, .96, l / 2 + .023], 'details', '#e9e2cb');
  if (name === 'pickup') {
    const bedFront = cz + cl / 2 + .12, bedRear = l / 2 - .08;
    const bedLength = bedRear - bedFront, bedZ = (bedRear + bedFront) / 2;
    box([w - .3, .08, bedLength], [0, 1.33, bedZ], 'details', '#414c4b');
    for (const side of [-1, 1]) box([.16, .34, bedLength], [side * (w / 2 - .08), 1.47, bedZ]);
    box([w, .34, .15], [0, 1.47, l / 2 - .08]);
    box([.34, .07, .025], [0, 1.48, l / 2 + .006], 'details', '#2b3434');
  }
  if (name === 'van') {
    // Solid rear quarter panels distinguish the van from the long-window wagon.
    for (const side of [-1, 1]) {
      box([.11, ch - .06, 2], [side * cw / 2, 1.22 + ch / 2, cz + cl / 2 - 1]);
      box([.025, .045, 1.75], [side * (cw / 2 + .061), 1.49, cz + cl / 2 - 1], 'details', '#697773');
    }
    box([cw, ch, .1], [0, 1.22 + ch / 2, cz + cl / 2]);
    box([cw * .69, .5, .025], [0, roofY - .37, cz + cl / 2 + .055], 'details', '#344e55');
  }
  if (name === 'wagon') for (const x of [-.65, .65]) box([.065, .11, 2.35], [x, roofY + .14, cz], 'details', '#46514f');
  if (name === 'sports') {
    // A splitter, skirts and a rear wing read as quick from the miniature view.
    box([w * .9, .1, .4], [0, .63, -l / 2 - .12], 'details', '#2f3a3c');
    for (const side of [-1, 1]) box([.1, .2, l * .44], [side * (w / 2 - .02), .62, .1], 'details', '#2f3a3c');
    for (const x of [-.55, .55]) box([.09, .3, .13], [x, 1.42, l / 2 - .3]);
    box([w * .78, .07, .44], [0, 1.6, l / 2 - .3]);
    box([.56, .1, 1], [0, 1.29, -l * .26]);
  }
  const merged = Object.fromEntries(Object.entries(parts).map(([key, geometries]) => {
    const geometry = mergeGeometries(geometries);
    // A lowered body sits closer to unchanged wheels, so drop only the shell.
    if (drop) geometry.translate(0, -drop, 0);
    for (const part of geometries) part.dispose();
    return [key, geometry];
  }));
  return { ...merged, wheels };
}

// Merge each model into four meshes, with shared geometry across the small fleet.
// Only the paint material belongs to an individual car.
export function createTrafficModels() {
  const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .76, flatShading: true, ...extra });
  const details = material('#ffffff', { vertexColors: true });
  const headlights = material('#fff0c3', { emissive: '#ffe3a3', emissiveIntensity: .3 });
  const taillights = material('#a5382e', { emissive: '#e12e18', emissiveIntensity: .25 });
  const templates = TRAFFIC_MODELS.map(spec => {
    const { paint, details: trim, headlights: front, taillights: rear } = vehicleGeometry(spec);
    // Each car casts its whole shadow in one draw instead of four. The trim
    // and lamp triangles follow the paint's in one buffer: the colour pass
    // draws only the paint's range, and the shadow pass all of it. The same
    // triangles reach the shadow map either way.
    const paintCount = paint.index.count, outline = trim.clone();
    outline.deleteAttribute('color');
    const body = mergeGeometries([paint, outline, front, rear]);
    outline.dispose(); paint.dispose();
    body.setDrawRange(0, paintCount);
    return { parts: { paint: body, details: trim, headlights: front, taillights: rear }, paintCount };
  });
  const paints = [];
  return {
    create(index, color) {
      const spec = TRAFFIC_MODELS[index], car = new THREE.Group(), paint = material(color);
      paints.push(paint); car.name = `traffic-${spec.name}`;
      const { parts, paintCount } = templates[index];
      for (const [key, geometry] of Object.entries(parts)) {
        const mesh = new THREE.Mesh(geometry, { paint, details, headlights, taillights }[key]);
        mesh.receiveShadow = true;
        if (key === 'paint') {
          mesh.castShadow = true; stableShadowDepth(mesh);
          mesh.onBeforeShadow = () => { geometry.drawRange.count = Infinity; };
          mesh.onAfterShadow = () => { geometry.drawRange.count = paintCount; };
        }
        car.add(mesh);
      }
      return { car, paint, spec };
    },
    // Lamps from daytime (0) to night (1); a storm runs them part way up.
    setLights(level) { headlights.emissiveIntensity = .3 + 2 * level; taillights.emissiveIntensity = .25 + 1.55 * level; },
    setNight(night) { this.setLights(night ? 1 : 0); },
    dispose() {
      for (const template of templates) for (const geometry of Object.values(template.parts)) geometry.dispose();
      for (const mat of [...paints, details, headlights, taillights]) mat.dispose();
    },
  };
}
