import test from 'node:test';
import assert from 'node:assert/strict';
import { SHEET_SIGNS, SIGN_SHEET_SIZE } from '../src/world/city-sign-sheet.js';
import { SIGN_CATALOG, SIGN_ATLAS, SIGN_USES, SIGNS_BY_USE, BUSINESS_SIGNS, DISCOVERY_SIGNS, dealSign } from '../src/world/city-signs.js';
import { hangs, crownSign, upstairsSign } from '../src/world/city-building-signs.js';
import { planLot, edgeFacade, edgeWindows, windowBays, shopFront } from '../src/world/city-buildings.js';
import { CITY } from '../src/world/city.js';
import { PAVEMENT_LEVEL as G } from '../src/world/city-route.js';
import { Surface } from '../src/world/surface.js';
import { seededRandom } from '../src/world/route.js';
import { averagePoint, calcPolygonArea, insidePolygon } from '../src/mapgen/polygon-util.js';

const apart = (a, b, gap = 0) => a[0] + a[2] + gap <= b[0] || b[0] + b[2] + gap <= a[0] || a[1] + a[3] + gap <= b[1] || b[1] + b[3] + gap <= a[1];

test('every design on the sheet is catalogued once, inside the sheet and clear of the others', () => {
  assert.ok(SHEET_SIGNS.length >= 120);
  for (const sign of SHEET_SIGNS) {
    const [x, y, w, h] = sign.rect;
    assert.ok(x >= 0 && y >= 0 && w > 20 && h > 20 && x + w <= SIGN_SHEET_SIZE && y + h <= SIGN_SHEET_SIZE, `${sign.name} lies on the sheet`);
    assert.ok(sign.uses.length && sign.uses.every(use => SIGN_USES.includes(use)), `${sign.name} has known uses`);
    assert.equal(sign.uses.includes('decal'), sign.size > 0, `${sign.name}: a decal, and only a decal, has a size`);
  }
  assert.equal(new Set(SHEET_SIGNS.map(sign => sign.name)).size, SHEET_SIGNS.length, 'one entry per design');
  for (const [i, a] of SHEET_SIGNS.entries()) for (const b of SHEET_SIGNS.slice(i + 1)) assert.ok(apart(a.rect, b.rect), `${a.name} and ${b.name} overlap`);
  for (const use of SIGN_USES) assert.ok(SIGNS_BY_USE[use].length, `some sign for ${use}`);
});

test('the atlas gives every face a rectangle of its own at the face\'s proportions, gutters and all', () => {
  const { width, height, gutter } = SIGN_ATLAS;
  assert.ok(width <= 4096 && height <= 2048, `a ${width} x ${height} atlas`);
  assert.equal(SIGN_CATALOG.length, BUSINESS_SIGNS.length + DISCOVERY_SIGNS.length);
  for (const sign of SIGN_CATALOG) {
    const [x, y, w, h] = sign.atlas;
    assert.ok(x >= gutter && y >= gutter && x + w + gutter <= width && y + h + gutter <= height, `${sign.name} fits the atlas`);
    assert.ok(Math.abs(w / h / sign.aspect - 1) < .03, `${sign.name} keeps its proportions`);
    // (the instance colour carries the rectangle to the shader, flipped)
    const [r, g, b] = sign.tint, faceWidth = Math.floor(b / 4096);
    assert.deepEqual([r, height - g - (b - faceWidth * 4096), faceWidth, b - faceWidth * 4096], sign.atlas);
    assert.ok(b < 2 ** 24, 'exact in a float');
  }
  const boxes = SIGN_CATALOG.map(sign => [sign.atlas[0] - gutter, sign.atlas[1] - gutter, sign.atlas[2] + 2 * gutter, sign.atlas[3] + 2 * gutter]);
  for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) assert.ok(apart(a, b), 'faces and gutters apart');
});

test('every business sign on the sheet is up somewhere in the city, each kind of building with its own', () => {
  const c = { east: 0, start: 0 }, shown = new Set(), mounts = {};
  CITY.lots.forEach((polygon, index) => {
    const lot = { polygon, index, block: CITY.lotBlocks[index], edges: CITY.lotEdges[index], depth: CITY.lotDepths[index], centre: averagePoint(polygon), area: calcPolygonArea(polygon), seed: index * 7919 };
    const plan = planLot(c, lot);
    if (plan.kind !== 'building') return;
    const { shop, decals = [], vacant, upstairs, lobby, crown, works } = plan.signs;
    for (const [mount, sign] of Object.entries({ shop, upstairs, lobby, crown, works, board: vacant?.board, poster: vacant?.poster })) {
      if (!sign) continue;
      shown.add(sign.name); mounts[mount] = (mounts[mount] ?? 0) + 1;
    }
    for (const sign of decals) shown.add(sign.name);
    // Each building's signs are those its use allows
    if (shop) assert.ok(plan.shopfront && shop.uses.includes('shop'));
    if (lobby) assert.ok(['office', 'atrium'].includes(plan.type) && lobby.uses.includes('firm'));
    if (works) assert.ok(plan.type === 'warehouse' && works.uses.includes('works'));
    if (crown) assert.ok(plan.floors >= 5 && crown.uses.some(use => use === 'firm' || use === 'home'));
    if (upstairs) assert.ok(plan.shopfront && upstairs.uses.includes('upstairs') && upstairs !== shop);
    assert.ok(!vacant || !shop, 'an empty shop has no name');
    assert.equal(new Set(decals).size, decals.length, 'no sticker twice in one window');
  });
  const missing = BUSINESS_SIGNS.filter(sign => !shown.has(sign.name)).map(sign => sign.name);
  assert.deepEqual(missing, [], 'every design is used');
  for (const mount of ['shop', 'upstairs', 'lobby', 'crown', 'works', 'board', 'poster']) assert.ok(mounts[mount] > 3, `${mount} signs are up`);
  assert.ok(mounts.shop > mounts.poster * 8, 'most shops are let');
});

test('a block deals each use\'s signs in turn, only from that use', () => {
  for (const use of SIGN_USES) {
    const signs = SIGNS_BY_USE[use];
    for (const shopBlock of [3, 77, 4817]) {
      const dealt = Array.from({ length: Math.min(12, signs.length) }, (_, shopSlot) => dealSign({ shopBlock, shopSlot, seed: 5 }, use));
      assert.ok(dealt.every(sign => sign.uses.includes(use)));
      assert.equal(new Set(dealt).size, dealt.length, `${use}: no repeat round a block`);
    }
  }
});

// A shopfront built with a given sign, and what it put up
function shopSigns(span, variation, signs) {
  const boxes = [], faces = [], hung = [], c = { distant: false, bodies: new Surface(), materials: { glass: {} },
    box(x, y, s, w, h, d, colour, kind) { boxes.push({ x, y, s, w, h, d, kind }); },
    item(key, geometry, material, p, scale, colour) { boxes.push({ x: p[0], y: p[1], s: -p[2], w: scale[0], h: scale[1], kind: 'glass' }); },
    signFace(key, sign, x, y, s, yaw, w, h, back) { faces.push({ key, sign, x, y, s, yaw, w, h, back }); },
    doubleSign(key, sign, x, y, s, yaw, w, h) { hung.push({ sign, x, y, s, yaw, w, h }); } };
  const f = edgeFacade(c, { x: 13, y: 27 }, { x: 13 + span * .6, y: 27 + span * .8 });
  f.street = true;
  shopFront(c, { type: 'apartment', variation, accent: '#386f73', seed: 41, signs }, f, 5.4, true);
  const at = p => ({ ...p, ...f.local(p.x, p.s) });
  return { f, boxes: boxes.map(at), faces: faces.map(at), hung: hung.map(at) };
}

test('a shop\'s name fits its fascia, a squarish one hangs clear of it, and stickers stay on the glass', () => {
  const decals = SIGNS_BY_USE.decal;
  for (const span of [5, 7.5, 12, 18, 32]) for (const variation of [0, 1, 2, 3]) for (const [k, sign] of SIGNS_BY_USE.shop.entries()) {
    const shown = decals.slice(k % decals.length).concat(decals.slice(0, k % decals.length)).slice(0, 3);
    const { f, boxes, faces, hung } = shopSigns(span, variation, { shop: sign, decals: shown });
    const fascia = boxes.find(p => p.h > 1 && p.y - p.h / 2 > G + 3.6), name = faces.find(p => p.sign === sign);
    assert.ok(name, `${sign.name} is up`);
    assert.ok(Math.abs(name.offset - fascia.offset) + name.w / 2 <= fascia.w / 2 + 1e-6, `${sign.name} stays on the fascia`);
    assert.ok(name.y - name.h / 2 >= fascia.y - fascia.h / 2 && name.y + name.h / 2 <= fascia.y + fascia.h / 2, `${sign.name} within the board's height`);
    assert.ok(name.outward > fascia.outward + fascia.d / 2, 'in front of the board');
    assert.ok(Math.abs(name.w / name.h - sign.aspect) < 1e-9, 'at its own proportions');
    if (span >= 7.5) assert.ok(name.h > .5, `${sign.name} readable on a ${span} m front (${name.h.toFixed(2)} m)`);
    // (a hanging sign stands out square to the wall, beside the name)
    for (const blade of hung) {
      assert.ok(hangs(sign) && blade.sign === sign);
      assert.ok(Math.abs(Math.cos(blade.yaw - f.yaw)) < 1e-9, 'square to the wall');
      assert.ok(Math.abs(blade.offset - name.offset) > name.w / 2, 'clear of the name on the fascia');
      assert.ok(blade.y - blade.h / 2 > G + 3.6 && blade.y + blade.h / 2 < G + 5.2, 'over the awnings, under the first floor');
      assert.ok(blade.outward - blade.w / 2 > fascia.outward + fascia.d / 2, 'off the fascia');
    }
    if (hangs(sign) && span >= 7.5) assert.equal(hung.length, 1, `${sign.name} hangs from a bracket`);
    const panes = boxes.filter(p => p.kind === 'glass' && Math.abs(p.h - 2.03) < 1e-9), mullions = boxes.filter(p => p.w === .08 && Math.abs(p.h - 2.03) < 1e-9);
    for (const decal of faces.filter(p => p.sign.uses.includes('decal'))) {
      assert.ok(decal.back === null, 'a sticker has no board');
      assert.ok(panes.some(p => Math.abs(decal.offset - p.offset) + decal.w / 2 <= p.w / 2 && Math.abs(decal.y - p.y) + decal.h / 2 <= p.h / 2), `${decal.sign.name} on the glass`);
      assert.ok(!mullions.some(m => Math.abs(decal.offset - m.offset) < (decal.w + m.w) / 2), `${decal.sign.name} clear of the mullion`);
      assert.ok(decal.outward > .22 && decal.outward < .25, 'just proud of the glass');
    }
  }
});

test('an empty shop has a letting board on the fascia and a poster in the window', () => {
  const [board] = SIGNS_BY_USE.vacant.filter(sign => sign.aspect > 2), [poster] = SIGNS_BY_USE.vacant.filter(sign => sign.aspect <= 2);
  for (const span of [5, 12, 32]) for (const variation of [0, 1]) {
    const { faces, boxes } = shopSigns(span, variation, { vacant: { board, poster } });
    assert.deepEqual(faces.map(p => p.sign.name).sort(), [board.name, poster.name].sort());
    const pane = boxes.find(p => p.kind === 'glass' && Math.abs(p.h - 2.03) < 1e-9), up = faces.find(p => p.sign === poster);
    assert.ok(up.y - up.h / 2 > pane.y - pane.h / 2 && up.y + up.h / 2 < pane.y + pane.h / 2, 'the poster is in the window');
  }
});

// A wall of a building, windows and all, with an upstairs sign, and what
// they put up. `plots` are the plots its signs must keep out of.
function signedWall(type, span, floors, upstairs, plots = []) {
  const windows = [], hung = [], pieces = [], c = { distant: false, bodies: new Surface(), materials: {}, item() {},
    box(x, y, s, w, h, d, colour, kind) { (kind === 'glass' || kind === 'lit' ? windows : pieces).push({ x, y, s, w, h, d }); },
    signFace() {}, doubleSign(key, sign, x, y, s, yaw, w, h) { hung.push({ sign, x, y, s, w, h }); } };
  const f = edgeFacade(c, { x: 5, y: 9 }, { x: 5 + span * .8, y: 9 - span * .6 }), b = { type, variation: 1, accent: '#386f73' };
  f.street = true; f.plots = plots;
  const bottom = G + 5.4, top = bottom + floors * 3.6;
  upstairsSign(c, f, upstairs, windowBays(b, f), 1, bottom, top);
  edgeWindows(c, b, f, bottom, floors, seededRandom(7));
  const at = p => ({ ...p, ...f.local(p.x, p.s) });
  return { f, top, windows: windows.map(at), hung: hung.map(at), pieces: pieces.map(at) };
}

test('an upstairs sign stands out between the first-floor windows, clear of balconies, under the eaves', () => {
  for (const type of ['brick', 'apartment', 'shop', 'deco', 'atrium']) for (const span of [7, 11, 18, 30]) for (const sign of SIGNS_BY_USE.upstairs) {
    const { f, top, windows, hung, pieces } = signedWall(type, span, type === 'shop' ? 1 : 3, sign);
    for (const blade of hung) {
      assert.ok(Math.abs(blade.offset) < f.span / 2 - .8, 'off the corner');
      assert.ok(blade.y - blade.h / 2 > G + 5.4 && blade.y + blade.h / 2 < top - .4, 'on the upper floors, under the eaves');
      for (const w of windows) assert.ok(Math.abs(w.offset - blade.offset) > w.w / 2 + .1, `${sign.name} clear of the windows`);
      // (pilasters and fins run up the piers; the sign starts at their face)
      for (const p of pieces.filter(p => p.h > 3 && Math.abs(p.offset - blade.offset) < p.w / 2)) assert.ok(blade.outward - blade.w / 2 >= p.outward + p.d / 2, `${sign.name} clear of the ${type} pier`);
      // (balconies are the broad pieces standing out more than a metre)
      for (const p of pieces.filter(p => p.w > 1 && p.d > 1 && p.outward > .3)) assert.ok(Math.abs(p.offset - blade.offset) > p.w / 2 + .05, `${sign.name} clear of a balcony`);
    }
    // (a glass front's windows leave no room between them)
    if (span >= 11 && type !== 'atrium') assert.equal(hung.length, 1, `${sign.name} is up on a ${span} m ${type}`);
  }
});

test('a sign standing out from a wall keeps clear of a wall standing forward beside it', () => {
  const [sign] = SIGNS_BY_USE.upstairs;
  for (const side of [1, -1]) {
    const { f, hung } = signedWall('brick', 18, 3, sign);
    assert.equal(hung.length, 1);
    // A neighbour's plot reaching 4 m forward of the front over the sign's end of the wall
    const end = side * f.span / 2, corner = (along, out) => { const p = f.position(along, 0, out); return { x: p[0], y: -p[2] }; };
    const plot = [corner(end, -8), corner(end - side * 7, -8), corner(end - side * 7, 4), corner(end, 4)];
    const moved = signedWall('brick', 18, 3, sign, [plot]).hung;
    for (const blade of moved) assert.ok(Math.abs(blade.offset - end) > 7, 'the sign moves out of the way');
  }
});

test('a name on the roof stands on a frame behind the parapet, as wide as the front allows', () => {
  for (const span of [10, 16, 28, 44]) for (const sign of [...SIGNS_BY_USE.firm, ...SIGNS_BY_USE.home]) {
    const faces = [], posts = [], c = { distant: false, bodies: new Surface(), materials: {}, item() {},
      box(x, y, s, w, h, d) { posts.push({ x, y, s, w, h, d }); }, signFace(key, sign, x, y, s, yaw, w, h, back) { faces.push({ x, y, s, w, h, back }); } };
    const f = edgeFacade(c, { x: 5, y: 9 }, { x: 5 + span * .8, y: 9 - span * .6 }), roof = G + 30, parapet = roof + .6;
    const strip = crownSign(c, f, sign, roof, parapet);
    if (!faces.length) { assert.equal(strip, null); assert.ok((span - 2.4) / sign.aspect < 1.2, `${sign.name} is left off only a front too narrow for it`); continue; }
    const [face] = faces.map(p => ({ ...p, ...f.local(p.x, p.s) }));
    assert.ok(Math.abs(face.offset) + face.w / 2 <= f.span / 2 - 1.1, `${sign.name} clear of the corners`);
    assert.ok(face.y - face.h / 2 > parapet && face.outward < -.3, `${sign.name} stands over and behind the parapet`);
    assert.ok(Math.abs(face.w / face.h - sign.aspect) < 1e-9 && face.h >= 1.2);
    assert.equal(face.back === null, Boolean(sign.letters), 'a board has its back, cut-out letters none');
    const legs = posts.filter(p => p.h > 1).map(p => ({ ...p, ...f.local(p.x, p.s) }));
    assert.ok(legs.length >= 2 && legs.every(p => Math.abs(p.y - p.h / 2 - roof) < 1e-9 && p.outward < face.outward), 'posts stand on the roof behind the board');
    assert.ok(legs.every(p => Math.abs(p.offset) < face.w / 2), 'posts stay behind the board');
    // (the strip kept clear of chimneys covers the frame)
    for (const p of [...legs, face]) assert.ok(insidePolygon({ x: p.x, y: p.s }, strip), 'the frame is inside the strip kept clear');
  }
});
