import * as THREE from 'three';
import { cityWalker, walkerFloat, createWalkerMaterial, walkerAppearance, setWalkerAppearance, setWalkerTurn, taxiGroupAppearance } from './world/city-life.js';
import { ROAD_LEVEL, PAVEMENT_LEVEL, roadAt } from './world/city-route.js';
import { profileOf } from './world/city.js';
import { STOP_RADIUS, STOP_SECONDS, RATINGS, MOODS, taxiRoute, fareBand, arrivalRating, insideStop } from './taxi-run.js';
import { taxiLicense } from './taxi-license.js';
import { goalProgress } from './taxi-goals.js';
import { routeDistance } from './world/nav-graph.js';
import { DestinationArrow } from './destination-arrow.js';
import { lookYaw, glance } from './world/pedestrian-reactions.js';
import { FloatingLabels } from './floating-labels.js';
import { $, text, hide, data, attribute, width, compactCash, clock, OnceHints } from './hud-dom.js';

const money = value => `$${Math.round(value ?? 0).toLocaleString('en-US')}`;
const distanceLabel = meters => meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters / 10) * 10} m`;
const passengerFloat = {};
const markerScale = 1.3;
// Riders' meshes kept for reuse, of each party size: a pickup window holds
// about sixty fares, half of them lone riders
const SPARE_RIDERS = 48;
// Hints for new drivers, each shown once in the instruction line and saved
export const HINTS = {
  rings: 'Stop in any ring for a fare · green rings pay most',
  drive: 'Follow the arrow · arrive while the pill is green',
  group: 'Each rider has a stop · the group pays at the last',
  tips: 'Drifts and near misses earn tips · a crash ends the combo',
};
const HINT_SECONDS = 7, HINTS_KEY = 'citydriver-taxi-hints';
// Rating colours, as in taxi.css
const RATING_COLOURS = { speedy: '#7ce787', normal: '#ffd238', slow: '#ff8a7a' };
// The ring's outline round a drop-off stretch, in the marker's frame (local -z
// is the stop's heading). Each end is a half ring, so a one-point stretch
// gives the plain ring.
export function stretchOutline(stop, radius, cap = 20) {
  const line = stop.stretch?.length ? stop.stretch : [stop], n = line.length - 1, out = [];
  const cos = Math.cos(stop.heading ?? 0), sin = Math.sin(stop.heading ?? 0);
  const put = (p, du, ds) => {
    const x = p.u + du - stop.u, z = -(p.s + ds - stop.s);
    out.push(x * cos + z * sin, -x * sin + z * cos);
  };
  // Direction along the stretch at each point
  const along = line.map((p, i) => {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(n, i + 1)], du = b.u - a.u, ds = b.s - a.s, length = Math.hypot(du, ds);
    return length > 1e-6 ? { u: du / length, s: ds / length } : { u: sin, s: cos };
  });
  const turn = (p, t, from) => {
    for (let k = 1; k < cap; k++) {
      const angle = k / cap * Math.PI, c = Math.cos(angle) * from, s = Math.sin(angle) * from;
      put(p, (t.s * c + t.u * s) * radius, (-t.u * c + t.s * s) * radius);
    }
  };
  for (let i = 0; i <= n; i++) put(line[i], along[i].s * radius, -along[i].u * radius);
  turn(line[n], along[n], 1);
  for (let i = n; i >= 0; i--) put(line[i], -along[i].s * radius, along[i].u * radius);
  turn(line[0], along[0], -1);
  return out;
}
function stretchShape(stop) {
  const inner = stretchOutline(stop, 6 * markerScale), outer = stretchOutline(stop, 6.5 * markerScale), middle = stretchOutline(stop, 6.3 * markerScale);
  const count = inner.length / 2, band = [], wall = [], index = [];
  for (let k = 0; k < count; k++) {
    band.push(inner[k * 2], 0, inner[k * 2 + 1], outer[k * 2], 0, outer[k * 2 + 1]);
    wall.push(middle[k * 2], -2.5, middle[k * 2 + 1], middle[k * 2], 2.5, middle[k * 2 + 1]);
    const a = k * 2, b = (k + 1) % count * 2;
    index.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = positions => {
    const shape = new THREE.BufferGeometry();
    shape.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); shape.setIndex(index);
    shape.computeBoundingSphere();
    return shape;
  };
  return { band: geometry(band), wall: geometry(wall) };
}
// A special rider's icon, about 32 px, centred on (x, y)
function moodIcon(ctx, mood, x, y) {
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = '#fff8e7'; ctx.beginPath();
  if (mood === 'hurry') [[4, -16], [-9, 2], [-1, 2], [-4, 16], [9, -2], [1, -2]].forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py));
  else if (mood === 'thrill') for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 6.5 : 15, a = -Math.PI / 2 + i * Math.PI / 5;
    ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r + 1);
  } else {
    ctx.moveTo(0, 13); ctx.bezierCurveTo(-16, 2, -12, -14, 0, -6); ctx.bezierCurveTo(12, -14, 16, 2, 0, 13);
  }
  ctx.closePath(); ctx.fill(); ctx.restore();
}
export class TaxiView {
  constructor(scene, storage = null) {
    this.storage = storage;
    this.navigation = new DestinationArrow(globalThis.document ? $('taxi-arrow') : null);
    scene.add(this.navigation.headset);
    this.measureTask = () => {
      const task = $('taxi-task');
      if (!task.hidden) $('app').style.setProperty('--taxi-task-bottom', `${task.getBoundingClientRect().bottom}px`);
    };
    this.taskObserver = globalThis.ResizeObserver && globalThis.document ? new ResizeObserver(this.measureTask) : null;
    this.taskObserver?.observe($('taxi-task'));
    globalThis.window?.addEventListener('resize', this.measureTask);
    this.group = new THREE.Group(); this.group.name = 'taxi-markers'; scene.add(this.group);
    this.ring = new THREE.RingGeometry(6 * markerScale, 6.5 * markerScale, 40); this.ring.rotateX(-Math.PI / 2);
    this.beam = new THREE.CylinderGeometry(6.3 * markerScale, 6.3 * markerScale, 5, 32, 1, true);
    this.cone = new THREE.ConeGeometry(1, 2, 4); this.cone.rotateZ(Math.PI);
    this.people = createWalkerMaterial();
    this.partyBadges = new Map();
    this.revision = -1; this.markers = []; this.palette = new Map(); this.spares = new Map();
    this.skidGeometry = new THREE.PlaneGeometry(.22, 1.2); this.skidGeometry.rotateX(-Math.PI / 2);
    this.skidMaterial = new THREE.MeshBasicMaterial({ color: '#202526', transparent: true, opacity: .52, depthWrite: false });
    this.skids = new THREE.InstancedMesh(this.skidGeometry, this.skidMaterial, 160); this.skids.count = 0;
    this.skids.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.skids.frustumCulled = false; this.skids.userData.ambientOcclusion = false;
    this.group.add(this.skids); this.trails = []; this.trailIndex = 0; this.lastTrail = 0; this.transform = new THREE.Object3D();
    this.watch = new THREE.Vector3(); this.unplace = new THREE.Matrix4();
    this.labels = new FloatingLabels(scene, 'taxi-labels'); this.shownCash = 0;
  }
  // Labels over the cab for pay, time and tips
  pop(event, vehicle) {
    const at = { x: vehicle.u, y: ROAD_LEVEL + 1, z: -vehicle.s };
    const tip = (amount, stunt) => this.labels.pop({ ...at, amount: `+$${amount}`, caption: stunt.toUpperCase(), colour: '#ffe07a', size: 1.9 });
    if (event.kind === 'tip') tip(event.tip, `${event.trick}${event.combo > 1 ? ` ×${event.combo}` : ''}`);
    if (event.stunt > 0) tip(event.stunt, 'Crazy stop');
    if (event.paid) this.labels.pop({ ...at, amount: `+$${event.paid.toLocaleString('en-US')}`, caption: RATINGS.find(rating => rating.id === event.rating)?.label.toUpperCase() ?? '', colour: RATING_COLOURS[event.rating] ?? '#fff8e7', size: 3.2 });
    else if (event.kind === 'dropoff') this.labels.pop({ ...at, amount: RATINGS.find(rating => rating.id === event.rating)?.label ?? '', colour: RATING_COLOURS[event.rating] ?? '#fff8e7', size: 2.4 });
    if (event.seconds > 0) this.labels.pop({ ...at, amount: `+${event.seconds}s`, colour: '#8ff0b0', size: 2.2 });
  }
  // Every waiting fare gets a badge: a dollar sign in the ring's colour, as in
  // Crazy Taxi, plus ×N for a group or an icon for a special rider (bolt for
  // a hurry, star for a thrill seeker, heart for nervous).
  badge(count, color, mood = null) {
    const key = `${count}${color}${mood ?? ''}`;
    if (!this.partyBadges.has(key) && globalThis.document) {
      const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#17262f'; ctx.beginPath(); ctx.roundRect(2, 2, 124, 60, 18); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();
      const suffix = count > 1 ? `×${count}` : '';
      ctx.font = 'bold 42px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const dollar = ctx.measureText('$').width, tail = suffix ? ctx.measureText(suffix).width : mood ? 36 : 0;
      const left = 64 - (dollar + tail) / 2;
      ctx.fillStyle = color; ctx.fillText('$', left, 34);
      if (suffix) { ctx.fillStyle = '#fff8e7'; ctx.fillText(suffix, left + dollar, 34); }
      else if (mood) moodIcon(ctx, mood, left + dollar + 20, 32);
      const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
      this.partyBadges.set(key, new THREE.SpriteMaterial({ map, depthTest: false, depthWrite: false }));
    }
    return this.partyBadges.get(key);
  }
  // Fares come in a handful of colours. Keeping their materials keeps their
  // shader programs: disposing a program's last material deletes it, and the
  // next fare would stall the drive while it compiled again.
  markerMaterials(color) {
    if (!this.palette.has(color)) this.palette.set(color, {
      solid: new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
      glow: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .08, depthWrite: false, side: THREE.DoubleSide }),
    });
    return this.palette.get(color);
  }
  // Stand-ins for the marker programs, compiled with the city before the first
  // fare appears. They are never drawn.
  warmupObjects() {
    const { solid, glow } = this.markerMaterials('#ffd240'), badge = this.badge(1, '#ffd240');
    return [new THREE.Mesh(this.ring, solid), new THREE.Mesh(this.beam, glow), new THREE.Mesh(this.navigation.geometry, this.navigation.material), ...(badge ? [new THREE.Sprite(badge)] : []), ...this.labels.warmupObjects()];
  }
  // A fare still waiting keeps its marker through a refresh. A marker depends
  // only on its stop, apart from its bob, which follows its place in the list.
  // New markers reuse the riders' meshes of markers that went (the last
  // pickup's, after a drop-off), so their GPU buffers are not freed and made again.
  rebuild(run) {
    const previousReactions = new Map(this.markers.map(marker => [marker.stop.id, marker.reactions]));
    const stops = run.status === 'pickup' ? run.customers : run.status === 'driving' ? [{ ...run.target, color: '#ffd240' }] : [];
    const waiting = new Set(stops), kept = new Map();
    for (const marker of this.markers) {
      this.group.remove(marker.group);
      if (marker.status === run.status && waiting.has(marker.stop)) { kept.set(marker.stop, marker); continue; }
      marker.shape?.band.dispose(); marker.shape?.wall.dispose();
      if (marker.person) this.spare(marker.person);
    }
    this.markers = []; this.revision = run.revision;
    for (const stop of stops) {
      const marker = kept.get(stop) ?? this.marker(stop, run.status);
      marker.float.phase = this.markers.length * 2.4;
      const previous = previousReactions.get(stop.id), count = marker.person?.count ?? 0;
      marker.reactions = previous?.length === count ? previous : Array.from({ length: count }, (_, i) => previous?.[i] ?? {});
      this.markers.push(marker); this.group.add(marker.group);
    }
  }
  marker(stop, status) {
    const street = stop.profile ?? roadAt(stop.s, stop.u, 60)?.road.profile ?? profileOf('minor');
    const group = new THREE.Group(), { solid, glow } = this.markerMaterials(stop.color);
    // Local -z is the way the stop faces; riders wait on the kerb to its right.
    group.rotation.y = -(stop.heading ?? 0);
    // A drop-off with a stretch gets its own ring shape
    const shape = status === 'driving' && stop.stretch?.length > 1 ? stretchShape(stop) : null;
    // Keep the full radius across the street and visible over the adjacent curb.
    const ring = new THREE.Mesh(shape?.band ?? this.ring, solid); ring.position.y = PAVEMENT_LEVEL + .07; group.add(ring);
    const beam = new THREE.Mesh(shape?.wall ?? this.beam, glow); beam.position.y = ROAD_LEVEL + 2.5; group.add(beam);
    const arrow = new THREE.Mesh(this.cone, solid); arrow.position.y = ROAD_LEVEL + 7; group.add(arrow);
    const badgeMaterial = status === 'pickup' && this.badge(stop.passengers, stop.color, stop.mood);
    if (badgeMaterial) {
      const badge = new THREE.Sprite(badgeMaterial); badge.position.y = ROAD_LEVEL + 9;
      badge.scale.set(3.6, 1.8, 1); badge.renderOrder = 1; group.add(badge);
    }
    let person = null;
    if (status === 'pickup') {
      person = this.spares.get(stop.passengers)?.pop() ?? new THREE.InstancedMesh(cityWalker, this.people, stop.passengers);
      const seed = Math.imul(Math.round(stop.s * 10), 73856093) ^ Math.imul(Math.round(stop.u * 10), 19349663);
      for (let i = 0; i < stop.passengers; i++) {
        setWalkerAppearance(person, i, stop.passengers > 1 ? taxiGroupAppearance(seed, i) : walkerAppearance(seed));
      }
      person.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // All riders share a draw call and stay in a compact line on the curb.
      const curb = street.halfWidth - street.lane + 2;
      // (wide enough for one knocked flying, see PedestrianContacts)
      person.boundingSphere = new THREE.Sphere(new THREE.Vector3(curb, PAVEMENT_LEVEL + 1.5, 0), 40);
      group.add(person);
    }
    group.traverse(object => { object.userData.ambientOcclusion = false; });
    return { group, stop, status, arrow, ring, beam, person, float: { phase: 0, speed: .2 }, reactions: null, shape, curb: street.halfWidth - street.lane + 2 };
  }
  // Kept for the next party of the same size. Each rider's look is set again
  // when it is taken, and their pose every frame.
  spare(person) {
    if (!this.spares.has(person.count)) this.spares.set(person.count, []);
    const spares = this.spares.get(person.count);
    if (spares.length < SPARE_RIDERS) spares.push(person); else person.dispose();
  }
  reset() {
    this.trails = []; this.trailIndex = 0; this.lastTrail = 0; this.skids.count = 0; this.revision = -1; this.labels.reset(); this.shownCash = 0;
    for (const marker of this.markers) marker.reactions = null;
  }
  render(run, vehicle, origin, time, contacts = null, camera = null) {
    this.labels.render(origin, time, camera);
    this.group.visible = run.running;
    if (!run.running) return;
    if (this.revision !== run.revision) this.rebuild(run);
    this.group.position.z = origin;
    for (const marker of this.markers) {
      const selected = run.status === 'driving' || marker.stop.id === run.boarding?.id;
      marker.group.position.set(marker.stop.u, 0, -marker.stop.s);
      if (marker.person) {
        const { person, curb } = marker;
        marker.group.updateMatrix();
        // (the taxi, where they stand, for them to watch it pull up)
        const taxi = this.watch.set(vehicle.u, 0, -vehicle.s).applyMatrix4(this.unplace.copy(marker.group.matrix).invert());
        for (let i = 0; i < person.count; i++) {
          const motion = walkerFloat(marker.float, time + i * .7, passengerFloat), reaction = marker.reactions[i];
          const along = (i - (person.count - 1) / 2) * 1.35;
          this.transform.position.set(curb, PAVEMENT_LEVEL + motion.lift, along);
          this.transform.rotation.set(0, lookYaw(reaction, Math.PI / 2, null, time), motion.roll);
          this.transform.scale.set(1.25, 1.25 * motion.stretch, 1.25); this.transform.updateMatrix();
          // (a fare only jumps out of the way, and is still there to be picked up)
          contacts?.person(reaction, this.transform.matrix, marker.group.matrix, .35, time, null, true);
          reaction.drawn ??= { x: 0, z: 0 };
          reaction.drawn.x = this.transform.matrix.elements[12]; reaction.drawn.z = this.transform.matrix.elements[14];
          person.setMatrixAt(i, this.transform.matrix);
          setWalkerTurn(person, i, glance(reaction, this.transform.rotation.y, curb, along, taxi, time));
        }
        person.instanceMatrix.needsUpdate = true; person.instanceColor.needsUpdate = true;
      }
      marker.arrow.position.y = ROAD_LEVEL + 7 + Math.sin(time * 3) * .35;
      marker.arrow.scale.setScalar(selected ? 1 : .65);
      marker.beam.visible = selected;
      // Only plain rings pulse
      const pulse = selected && !marker.shape ? 1 + Math.sin(time * 4) * .035 : 1;
      marker.ring.scale.set(pulse, 1, pulse);
    }
    if (vehicle.drifting && time - this.lastTrail > .065) {
      this.lastTrail = time;
      for (const side of [-1, 1]) {
        const trail = { x: vehicle.u - Math.sin(vehicle.heading) * 1.3 + Math.cos(vehicle.heading) * side * .8,
          z: -vehicle.s + Math.cos(vehicle.heading) * 1.3 + Math.sin(vehicle.heading) * side * .8, heading: vehicle.heading };
        this.trails[this.trailIndex] = trail;
        this.transform.position.set(trail.x, ROAD_LEVEL + .08, trail.z);
        this.transform.rotation.set(0, -trail.heading, 0); this.transform.scale.setScalar(1); this.transform.updateMatrix();
        this.skids.setMatrixAt(this.trailIndex, this.transform.matrix);
        this.skids.instanceMatrix.addUpdateRange(this.trailIndex * 16, 16);
        this.trailIndex = (this.trailIndex + 1) % 160;
      }
      this.skids.instanceMatrix.needsUpdate = true;
    }
    this.skids.count = this.trails.length;
  }
  hud(run, vehicle, free = false) {
    // Settle each panel once per refresh: showing and then hiding one again
    // restyles the whole HUD twice, ten times a second.
    hide($('taxi-hud'), !run.running); hide($('taxi-nav'), !run.running || !run.target); hide($('taxi-task'), !run.running);
    // Free drive keeps Boost and Drift, with no meter: its boost is unlimited.
    hide($('taxi-buttons'), !run.running && !free);
    hide($('taxi-boost'), !run.running);
    hide($('taxi-dash'), !run.running);
    if (!run.running) {
      if (!free) return;
      text('taxi-boost-state', vehicle.boosting ? vehicle.walker ? 'Sprinting' : 'Boosting' : 'Hold');
      data('taxi-buttons', 'boosting', String(vehicle.boosting));
      data('taxi-buttons', 'drifting', String(vehicle.drifting));
      return;
    }
    text('taxi-clock-label', run.overtime ? 'LAST RIDE' : 'TIME');
    text('taxi-clock', Math.ceil(run.timeLeft)); data('taxi-clock', 'urgent', String(run.timeLeft <= 15));
    // Count the total up to new earnings
    this.shownCash = run.cash < this.shownCash ? run.cash : Math.min(run.cash, this.shownCash + Math.max(25, (run.cash - this.shownCash) * .35));
    const shown = Math.round(this.shownCash);
    text('taxi-cash', shown >= 1000 ? compactCash.format(shown) : money(shown));
    attribute($('taxi-cash'), 'aria-label', `Total earned ${money(run.cash)}`);
    text('taxi-fares', `${run.delivered} fare${run.delivered === 1 ? '' : 's'}`);
    text('taxi-speed', Math.round(Math.abs(vehicle.speed) * 2.23694));
    width('taxi-boost-fill', `${run.boost * 100}%`);
    attribute($('taxi-boost'), 'aria-valuenow', String(Math.round(run.boost * 100)));
    if ($('taxi-controller-boost').value !== run.boost) $('taxi-controller-boost').value = run.boost;
    text('taxi-boost-state', run.boostActive ? 'Boosting' : run.boost < .1 ? 'Release to fill' : 'Hold');
    data('taxi-buttons', 'boosting', String(run.boostActive));
    data('taxi-buttons', 'drifting', String(vehicle.drifting));
    const stop = run.target;
    const pickup = run.status === 'pickup';
    text('taxi-stage', pickup ? 'Pick up' : run.overtime ? 'Last ride' : run.fare.stops.length > 1 ? `Stop ${run.stopIndex + 1} of ${run.fare.stops.length}` : 'Drop off');
    data('taxi-task', 'stage', run.status);
    // Pulse in the last seconds before the riders give up.
    data('taxi-task', 'urgent', String(!pickup && run.fareLeft <= 10));
    // The stunt combo
    text('taxi-combo', !pickup && run.combo > 1 ? `Combo ×${run.combo}` : '');
    const track = $('taxi-stop-progress').parentElement;
    hide(track, run.hold <= 0);
    attribute(track, 'aria-label', pickup ? 'Passenger boarding' : 'Passenger drop-off');
    attribute(track, 'aria-valuenow', String(Math.round(Math.min(1, run.hold / STOP_SECONDS) * 100)));
    width('taxi-stop-progress', `${Math.min(1, run.hold / STOP_SECONDS) * 100}%`);
    if (!stop) {
      const near = customer => Math.hypot(customer.s - vehicle.s, customer.u - vehicle.u);
      const nearby = run.boarding ?? run.customers.reduce((best, customer) => near(customer) < 32 && (!best || near(customer) < near(best)) ? customer : best, null);
      data('taxi-task', 'arriving', String(Boolean(run.boarding)));
      // Preview the nearest fare: destination, rider and pay
      text('taxi-task-title', nearby ? `To ${nearby.destination.name}` : 'Find a passenger');
      const band = nearby && fareBand(nearby.length), mood = MOODS[nearby?.mood];
      text('taxi-party', band ? `${nearby.passengers > 1 ? `${nearby.passengers} riders` : nearby.name} · ${band.label} · ${distanceLabel(nearby.length)}` : '');
      data('taxi-party', 'band', band?.id ?? '');
      text('taxi-next-stop', mood ? `${mood.label} · ${mood.rule}` : nearby?.passengers > 1 ? `${nearby.stops.length} stops · paid at the last` : '');
      data('taxi-next-stop', 'mood', nearby?.mood ?? '');
      hide($('taxi-timer'), true); hide($('taxi-timer-fill').parentElement, true);
      const inRing = nearby && nearby.id !== run.blockedPickup?.id && near(nearby) < STOP_RADIUS;
      this.instruction(run.boarding ? 'Boarding…' : inRing ? 'Stop to pick up' : this.hint(!nearby && 'rings'));
      text('taxi-fare-status', nearby ? `Fare ${money(nearby.fare + nearby.groupBonus)}` : '');
      return;
    }
    const length = routeDistance(taxiRoute(vehicle, run.approach(vehicle)));
    const nearStop = insideStop(stop, vehicle);
    text('taxi-nav-distance', nearStop ? 'Here' : `${Math.max(10, Math.round(length / 10) * 10)} m`);
    attribute($('taxi-nav'), 'aria-label', `Drop-off ${Math.round(length)} meters by road; the green arrow points directly to the destination`);
    text('taxi-task-title', stop.name);
    // The pill shows the current rating and the seconds until it drops, or
    // until the riders give up. The bar shows this rider's own time.
    const remaining = run.legRemaining, rating = arrivalRating(remaining), seconds = Math.ceil(run.ratingSeconds);
    hide($('taxi-timer'), false); hide($('taxi-timer-fill').parentElement, false);
    text('taxi-timer', `${rating.label} ${seconds}s`);
    data('taxi-timer', 'rating', rating.id); data('taxi-timer-fill', 'rating', rating.id);
    attribute($('taxi-timer'), 'aria-label', rating.remaining > 0 ? `Arrive within ${seconds} seconds for ${rating.label}` : `${seconds} seconds before the riders give up`);
    width('taxi-timer-fill', `${remaining * 100}%`);
    // Fares still to pay, plus tips
    text('taxi-fare-status', `Meter ${money(run.remainingFare + run.tips)}`);
    data('taxi-party', 'band', '');
    const mood = MOODS[run.fare.mood];
    text('taxi-party', run.fare.passengers > 1 ? `${run.onboard} aboard` : mood ? run.shaken ? `${mood.label} · no bonus now` : `${mood.label} · ${mood.rule}` : '');
    data('taxi-next-stop', 'mood', '');
    const next = run.fare.stops[run.stopIndex + 1];
    text('taxi-next-stop', next ? `Next · ${next.destination.name} · ${Math.round(next.length / 10) * 10} m` : run.fare.passengers > 1 ? 'Last stop' : '');
    const hint = run.tips > 0 ? 'tips' : run.fare.passengers > 1 ? 'group' : 'drive';
    this.instruction(nearStop ? Math.abs(vehicle.speed) >= 2.5 ? 'Stop to drop off' : 'Dropping off…' : this.hint(!run.overtime && hint));
    data('taxi-task', 'arriving', String(nearStop));
  }
  hint(key) {
    this.hints ??= new OnceHints(HINTS, HINTS_KEY, this.storage, HINT_SECONDS);
    return this.hints.get(key);
  }
  instruction(text) {
    // Announce state changes, not every HUD refresh or countdown tick.
    if ($('taxi-task-detail').textContent !== text) $('taxi-task-detail').textContent = text;
  }
  results(run, found = []) {
    const license = taxiLicense(run.cash), best = taxiLicense(run.best);
    const summary = run.summary, career = run.career, beaten = id => Boolean(summary?.beaten.includes(id));
    $('taxi-result-shift').textContent = `Shift ${clock(Math.round(run.elapsed))}`; $('taxi-result-shift').dataset.new = String(beaten('shift'));
    $('taxi-result-cash').textContent = money(run.cash);
    $('taxi-result-license').dataset.license = license.id;
    $('taxi-license-badge').textContent = license.badge;
    $('taxi-license-name').textContent = license.id === 'none' ? license.name : `${license.name} license`;
    const improved = run.cash > 0 && license.rank > taxiLicense(run.previousBest).rank;
    $('taxi-license-next').textContent = [improved && 'New best license!',
      license.next ? `${money(license.next.min - run.cash)} more for ${license.next.name}` : 'The top license'].filter(Boolean).join(' · ');
    // The shift in six numbers. A tile turns gold where it beat a career record.
    const rated = RATINGS.reduce((sum, rating) => sum + (run.ratings?.[rating.id] ?? 0), 0);
    const tiles = [['fares', 'Fares', String(run.delivered), beaten('fares')], ['riders', 'Riders', String(run.deliveredPassengers), false],
      ['speedy', 'Speedy', rated ? `${run.ratings.speedy}/${rated}` : '–', false],
      ['combo', 'Combo', run.bestCombo > 1 ? `×${run.bestCombo}` : '–', beaten('combo')], ['streak', 'Streak', String(run.bestStreak), beaten('streak')],
      ['tips', 'Tips', money(run.tipsBanked), beaten('tips')]];
    $('taxi-result-stats').innerHTML = tiles.map(([id, label, value, record]) =>
      `<li data-stat="${id}" data-new="${record}"><strong>${value}</strong><span>${label}</span></li>`).join('');
    const goals = run.goals ?? [], done = goals.filter(goal => goal.done), stats = run.stats;
    $('taxi-result-goals').innerHTML = !goals.length ? '' : `<div class="taxi-result-heading"><span>Goals</span><span>${done.length} / ${goals.length}${run.goalCash ? ` · +${money(run.goalCash)}` : ''}</span></div>`
      + `<ul>${goals.map(goal => `<li data-done="${goal.done}"><span aria-hidden="true">${goal.done ? '✓' : '○'}</span><span>${goal.text}</span>${goal.done ? '' : `<span>${goalProgress(goal, stats)} / ${goal.target}</span>`}</li>`).join('')}</ul>`;
    const rank = career?.rank;
    const career$ = $('taxi-result-career'); hide(career$, !rank);
    if (rank) {
      const span = rank.next ? rank.next.earnings - rank.earnings : 1, into = rank.next ? career.earnings - rank.earnings : 1;
      career$.dataset.promoted = String(Boolean(summary?.promoted));
      $('taxi-career-rank').textContent = summary?.promoted ? `Promoted · ${rank.name}` : rank.name;
      $('taxi-career-next').textContent = rank.next ? `${money(rank.next.earnings - career.earnings)} to ${rank.next.name}` : 'Top rank';
      const bar = $('taxi-career-progress'); bar.max = span; bar.value = Math.min(span, into);
      bar.setAttribute('aria-label', `${rank.name} rank, ${money(career.earnings)} career earnings`);
      $('taxi-career-livery').textContent = summary?.liveries.length ? `Livery unlocked · ${summary.liveries.map(livery => livery.name).join(', ')}` : '';
    }
    $('taxi-result-best').textContent = [`Best ${money(run.best)} · ${best.name}`, found.length && `${found.length} new ${found.length > 1 ? 'places' : 'place'} found`].filter(Boolean).join(' · ');
    $('taxi-results').hidden = false;
  }
  dispose() {
    this.navigation.dispose();
    this.taskObserver?.disconnect(); globalThis.window?.removeEventListener('resize', this.measureTask);
    for (const { solid, glow } of this.palette.values()) { solid.dispose(); glow.dispose(); }
    for (const material of this.partyBadges.values()) { material.map.dispose(); material.dispose(); }
    for (const marker of this.markers) { marker.person?.dispose(); marker.shape?.band.dispose(); marker.shape?.wall.dispose(); }
    for (const spares of this.spares.values()) for (const person of spares) person.dispose();
    for (const resource of [this.ring, this.beam, this.cone, this.people, this.skidGeometry, this.skidMaterial]) resource.dispose();
    this.labels.dispose();
    this.skids.dispose(); this.group.removeFromParent();
  }
}
