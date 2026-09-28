import * as THREE from 'three';

// What the residents say to someone on foot (see OnFoot.talk), in speech
// bubbles over their heads: a word about the weather or their part of town,
// the way to a landmark the player has not found yet, the car they turned up
// in, and what they call out when shoved, knocked over or passed in the
// street. Chosen by a number the caller keeps (`key`), so a resident says
// the same thing each time they are asked the same way.

// First names by how a resident presents (see walkerAppearance)
const NAMES = {
  feminine: ['Ada', 'Aisha', 'Bea', 'Carmen', 'Chloe', 'Daisy', 'Dot', 'Elif', 'Esi', 'Fatima', 'Grace', 'Hana', 'Ines', 'Joy', 'Kasia',
    'Lena', 'Maggie', 'Mei', 'Nadia', 'Olu', 'Priya', 'Rosa', 'Saoirse', 'Tess', 'Uma', 'Vera', 'Wren', 'Yara', 'Zoe', 'June'],
  masculine: ['Abdul', 'Alf', 'Ben', 'Bruno', 'Cal', 'Carlos', 'Dev', 'Dmitri', 'Eddie', 'Emeka', 'Femi', 'Finn', 'Gus', 'Hamid', 'Hugo',
    'Ivan', 'Jack', 'Kofi', 'Luca', 'Marek', 'Nils', 'Omar', 'Pete', 'Raj', 'Sam', 'Theo', 'Vic', 'Wes', 'Yusuf', 'Stan'],
};
export function residentName(appearance, key) {
  const names = NAMES[appearance?.presentation] ?? NAMES.feminine;
  return names[Math.abs(Math.floor(key)) % names.length];
}

const WEATHER = {
  clear: ['Lovely day for it.', 'Not a cloud in the sky. Well, a few.', 'Nice out, isn\'t it?'],
  sunset: ['Look at that light.', 'Best time of day, this.', 'Sun\'s going down already.'],
  overcast: ['Looks like rain later.', 'Grey old day, isn\'t it?', 'Can\'t decide what it wants to do, this weather.'],
  rain: ['Typical. Left my umbrella at home.', 'Proper soaking out here.', 'Lovely weather for ducks.'],
  storm: ['Did you hear that thunder?', 'I\'d get inside if I were you.', 'Wild out, isn\'t it?'],
  snow: ['Mind how you go, it\'s slippery.', 'Snow! Here! I ask you.', 'Haven\'t been warm since Tuesday.'],
  night: ['Bit late for a stroll, isn\'t it?', 'Can\'t sleep either?', 'Lovely night for it.'],
};
const DISTRICTS = {
  'Old town': ['Old town\'s the best bit of the city. Don\'t tell anyone.', 'These streets were never meant for cars.', 'My gran was born round the corner.'],
  'Garden quarter': ['Have you seen the roses this year?', 'Quietest bit of town, this.', 'Everyone round here has a greenhouse.'],
  'Warehouse district': ['Shift starts in ten minutes.', 'Mind the lorries round here.', 'You\'d never guess what\'s in half these sheds.'],
  'Market district': ['Get to the market early. The good fruit goes first.', 'I only came out for bread.', 'Best coffee in the city is round here.'],
  'Civic quarter': ['All these columns. Who needs that many columns?', 'I\'m off to complain at City Hall.', 'Posh round here, isn\'t it?'],
  Midtown: ['Everyone\'s always in a hurry in Midtown.', 'I had a meeting. I think I still do.', 'Can\'t hear yourself think round here.'],
  Downtown: ['Everyone\'s always in a hurry downtown.', 'Busy, busy, busy.', 'I work up there. Top floor. Lovely view of a car park.'],
  Harbour: ['Smell that sea air.', 'The boats go round and round all day.', 'Mind you don\'t fall in.'],
  Riverfront: ['Nice by the river, isn\'t it?', 'I saw a fish once. Big one.', 'Mind you don\'t fall in.'],
};
// Odd things residents know about the city
const ASIDES = ['I\'ve walked round this block forty times today.', 'Everyone round here walks in circles. I blame the council.',
  'Watch the traffic. They never look where they\'re going.', 'Somebody knocked over every lamp on this street last week.',
  'I heard there\'s a helicopter going cheap somewhere.', 'Taxi drivers in this city are mad. Absolutely mad.',
  'Do you ever feel like someone\'s watching us?', 'Try jumping twice. Everyone\'s doing it.',
  'My cousin drives a cab. Says the tips are all in the stunts.', 'Nice backpack, by the way.'];
const GOODBYES = ['Anyway, can\'t stand here all day.', 'Right, I\'m off. Mind how you go.', 'Nice chatting. See you around.', 'Anyway. Places to be.'];
const AGAIN = ['Still here?', 'You again!', 'We\'ve done this bit.'];
const CALLS = {
  shoved: ['Oi!', 'Excuse me!', 'Watch it!', 'Do you mind?', 'Steady on!', 'Rude.', 'Careful!', 'Pardon me!'],
  floored: ['What was that for?', 'Honestly!', 'Ow!', 'Some people!'],
  run: ['Learn to drive!', 'My hip!', 'Oi! I saw that!', 'Road hog!', 'I\'m calling someone about this.'],
  passing: { day: ['Hiya.', 'Alright?', 'Hello!', 'Hi there.'], night: ['Evening.', 'Night.', 'Alright?'] },
};

const pick = (list, key) => list[Math.abs(Math.floor(key)) % list.length];
const capital = text => text[0].toUpperCase() + text.slice(1);
// How far a place is, said the way people say it: `metres` off, `way` a compass word
export function howFar(metres, way) {
  if (metres < 150) return `just round the corner, ${way}`;
  if (metres < 450) return `a short walk ${way}`;
  if (metres < 950) return `a good walk ${way}`;
  return `a long way ${way}`;
}
// Lines that fit a bubble, three rows at most
const LONGEST = 72;
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
// The compass word for a way to go, (du, ds) east and north
export function compass(du, ds) {
  return COMPASS[(Math.round(Math.atan2(du, ds) / (Math.PI / 4)) % 8 + 8) % 8];
}

// A resident's line. `turn` is how far into a chat they are (0 the first
// line, then 1, 2...) or a call: 'shoved', 'floored', 'run', 'passing'.
// `context`: { weather, district, place: { name, metres, way } (the nearest
// landmark not found yet, if any), car: { name, borrowed } (the car the
// player came in, if it is near), night, again }. Returns { text, ending,
// pointing }: `ending` once they have said goodbye, `pointing` when the
// line gives the way to `context.place`.
export function streetLine(turn, context, key) {
  if (typeof turn === 'string') {
    const calls = turn === 'passing' ? CALLS.passing[context.night ? 'night' : 'day'] : CALLS[turn];
    return { text: pick(calls, key), ending: true, pointing: false };
  }
  if (context.again) return { text: pick(AGAIN, key), ending: true, pointing: false };
  const district = DISTRICTS[context.district], weather = WEATHER[context.weather];
  if (turn === 0) {
    const own = district && key % 2 ? district : weather ?? district ?? ASIDES;
    return { text: pick(own, key >> 1), ending: false, pointing: false };
  }
  if (turn === 1) {
    const place = context.place;
    if (!place) return { text: key % 3 ? pick(ASIDES, key >> 2) : 'You know this city better than I do.', ending: false, pointing: false };
    const far = howFar(place.metres, place.way);
    const lines = [`Have you been to ${place.name}? It's ${far}.`, `If you're after ${place.name}, it's ${far}.`, `You should see ${place.name}. ${capital(far)}.`];
    // (a long way off, they say so, if there is room)
    let text = pick(lines, key);
    if (place.metres >= 950 && text.length + 18 <= LONGEST) text += ' You\'d want a car.';
    return { text, ending: false, pointing: true };
  }
  if (turn === 2) {
    const car = context.car;
    if (car?.borrowed) return { text: pick(['Wasn\'t that someone else\'s car?', 'I saw that. Does the owner know?'], key), ending: false, pointing: false };
    if (car) return { text: pick([`Is that your ${car.name}? Nice.`, `That ${car.name} yours? Mind it doesn't get towed.`, `You can't leave a ${car.name} there, you know.`], key), ending: false, pointing: false };
    return { text: pick(ASIDES, key + 3), ending: false, pointing: false };
  }
  return { text: pick(GOODBYES, key), ending: true, pointing: false };
}

// Speech bubbles: a few canvas sprites over whoever is speaking, drawn over
// everything so they can be read, a steady size on screen near the camera,
// popping up and fading after a reading time
// A bubble's tail stands OVER m over the speaker's feet. On screen it is
// SCREEN px wide (so its words read on a phone as on a monitor), at most
// SHARE of the view's width, and between SMALLEST and WIDEST m in the world,
// so one far off is smaller. With no screen to go by (a headset) it is NEAR
// times its distance. It is kept below the top of the view by TOP (of the
// half height), coming down over the speaker if it must.
const BUBBLES = 4, WIDE = 512, TALL = 184, FONT = "700 34px 'Segoe UI', Arial, sans-serif", OVER = 2.05, NEAR = .26, SMALLEST = .45, WIDEST = 2.8, TOP = .94;
const SCREEN = 230, SHARE = .6;
const eye = new THREE.Vector3(), place = new THREE.Vector3(), seen = new THREE.Vector3(), up = new THREE.Vector3();
// (a line's words laid out in rows of `room` px: two at full size, else
// three a little smaller)
function layout(ctx, text, room) {
  let rows = [];
  for (const [size, most] of [[34, 2], [30, 3], [26, 3]]) {
    ctx.font = FONT.replace('34px', `${size}px`);
    rows = [''];
    for (const word of text.split(' ')) {
      const row = rows.at(-1), next = row ? `${row} ${word}` : word;
      if (ctx.measureText(next).width <= room || !row) rows[rows.length - 1] = next; else rows.push(word);
    }
    if (rows.length <= most) return { rows, size };
  }
  return { rows, size: 26 };
}
export class SpeechBubbles {
  constructor(scene) {
    this.group = new THREE.Group(); this.group.name = 'speech-bubbles'; scene.add(this.group);
    this.bubbles = globalThis.document ? Array.from({ length: BUBBLES }, () => {
      const canvas = document.createElement('canvas'); canvas.width = WIDE; canvas.height = TALL;
      const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.SpriteMaterial({ map, depthTest: false, depthWrite: false, transparent: true, fog: false });
      const sprite = new THREE.Sprite(material); sprite.visible = false; sprite.renderOrder = 4; sprite.center.set(.5, 0); sprite.userData.ambientOcclusion = false;
      this.group.add(sprite);
      return { canvas, ctx: canvas.getContext('2d'), map, material, sprite, speaker: null, who: null, text: '', age: Infinity, life: 0 };
    }) : [];
    this.lastTime = null;
  }
  warmupObjects() { return this.bubbles.length ? [new THREE.Sprite(this.bubbles[0].material)] : []; }
  // Whether `who` is saying something now
  speaking(who) { return this.bubbles.some(bubble => bubble.who === who && bubble.age < bubble.life); }
  // `text` over `who`, wherever `speaker()` says they stand ({ x, y, z } of
  // their feet in the world, or null once they are gone), for about as long
  // as it takes to read. A new line from the same person replaces their last.
  say(who, speaker, text) {
    if (!this.bubbles.length) return;
    const bubble = this.bubbles.find(each => each.who === who) ?? this.bubbles.reduce((a, b) => (b.age >= b.life ? Infinity : b.age) > (a.age >= a.life ? Infinity : a.age) ? b : a);
    const { ctx, canvas } = bubble, { rows, size } = layout(ctx, text, WIDE - 70);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const width = Math.min(WIDE - 12, Math.max(...rows.map(row => ctx.measureText(row).width)) + 48), height = rows.length * (size + 6) + 26;
    const left = (WIDE - width) / 2, top = TALL - 22 - height;
    ctx.fillStyle = '#fbf8f0'; ctx.strokeStyle = '#17262f'; ctx.lineWidth = 5; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.roundRect(left, top, width, height, 22);
    // (the tail, down to whoever is speaking)
    ctx.moveTo(WIDE / 2 - 16, top + height); ctx.lineTo(WIDE / 2, TALL - 4); ctx.lineTo(WIDE / 2 + 16, top + height);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fbf8f0'; ctx.fillRect(WIDE / 2 - 13, top + height - 5, 26, 8);
    ctx.fillStyle = '#17262f'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    rows.forEach((row, i) => ctx.fillText(row, WIDE / 2, top + 13 + (size + 6) * (i + .5) + 2));
    bubble.map.needsUpdate = true;
    Object.assign(bubble, { speaker, who, text, age: 0, life: 1.6 + text.length * .055 });
    bubble.sprite.visible = true;
  }
  // How long the line `who` is saying has left, in seconds (0 if none)
  left(who) { const bubble = this.bubbles.find(each => each.who === who); return bubble ? Math.max(0, bubble.life - bubble.age) : 0; }
  clear() { for (const bubble of this.bubbles) { bubble.age = Infinity; bubble.who = bubble.speaker = null; bubble.sprite.visible = false; } this.lastTime = null; }
  // Over their speakers' heads, popping up and fading. `camera` and `view`
  // (the canvas's { width, height } in CSS px) keep them a steady size on screen.
  render(origin, time, camera = null, view = null) {
    this.group.position.z = origin;
    if (camera) camera.getWorldPosition(eye);
    const dt = this.lastTime === null ? 0 : Math.min(.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    for (const bubble of this.bubbles) {
      const at = bubble.age < bubble.life ? bubble.speaker?.() : null;
      if (!at) { if (bubble.sprite.visible) { bubble.sprite.visible = false; bubble.who = bubble.speaker = null; bubble.age = Infinity; } continue; }
      bubble.age += dt;
      const t = bubble.age, pop = t < .12 ? .6 + t / .12 * .48 : t < .22 ? 1.08 - (t - .12) / .1 * .08 : 1;
      place.set(at.x, at.y + OVER, at.z);
      const far = camera ? Math.hypot(place.x - eye.x, place.y - eye.y, place.z + origin - eye.z) : 6;
      const half = camera?.isPerspectiveCamera ? Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * far : 0;
      const wanted = half && view?.height > 0 ? Math.min(SCREEN, view.width * SHARE) * 2 * half / view.height : far * NEAR;
      const width = Math.min(WIDEST, Math.max(SMALLEST, wanted)) * pop, height = width * TALL / WIDE;
      // (a camera close in over someone's shoulder would have it off the top of the view)
      if (half) {
        const top = seen.set(place.x, place.y, place.z + origin).project(camera).y + height / half;
        if (top > TOP && seen.z < 1) place.addScaledVector(up.set(0, 1, 0).applyQuaternion(camera.quaternion), -(top - TOP) * half);
      }
      bubble.sprite.position.copy(place); bubble.sprite.scale.set(width, height, 1);
      bubble.material.opacity = Math.min(1, (bubble.life - t) / .3);
      bubble.sprite.visible = true;
    }
  }
  dispose() {
    for (const bubble of this.bubbles) { bubble.map.dispose(); bubble.material.dispose(); }
    this.group.removeFromParent();
  }
}
