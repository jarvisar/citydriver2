import * as THREE from 'three';
import { cityWalker, walkerFloat, createWalkerMaterial, walkerAppearance, setWalkerAppearance, taxiGroupAppearance } from './world/city-life.js';
import { ROAD_LEVEL, PAVEMENT_LEVEL, roadAt } from './world/city-route.js';
import { profileOf } from './world/city.js';
import { STOP_RADIUS, STOP_SECONDS, RATINGS, taxiRoute, fareBand, arrivalRating } from './taxi-run.js';
import { taxiLicense } from './taxi-license.js';
import { goalProgress } from './taxi-goals.js';
import { routeDistance } from './world/nav-graph.js';
import { DestinationArrow } from './destination-arrow.js';
import { applyWalkerHop } from './world/pedestrian-reactions.js';

const $ = id => document.getElementById(id);
const money = value => `$${Math.round(value ?? 0).toLocaleString('en-US')}`;
const distanceLabel = meters => meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters / 10) * 10} m`;
const compactCash = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const text = (id, value) => { const element = $(id), next = String(value); if (element.textContent !== next) element.textContent = next; };
// The HUD refreshes ten times a second, mostly with values it already shows.
// Rewriting an unchanged attribute or style still costs a style recalculation
// under the HUD's :has() rules, so compare first, as text() does.
const hide = (element, hidden) => { if (element.hidden !== hidden) element.hidden = hidden; };
const data = (id, key, value) => { const element = $(id), next = String(value); if (element.dataset[key] !== next) element.dataset[key] = next; };
const attribute = (element, name, value) => { const next = String(value); if (element.getAttribute(name) !== next) element.setAttribute(name, next); };
const width = (id, value) => { const style = $(id).style; if (style.width !== value) style.width = value; };
const passengerFloat = {};
const markerScale = 1.3;
export class TaxiView {
  constructor(scene) {
    this.navigation = new DestinationArrow(globalThis.document ? $('taxi-arrow') : null);
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
    this.revision = -1; this.markers = []; this.palette = new Map();
    this.skidGeometry = new THREE.PlaneGeometry(.22, 1.2); this.skidGeometry.rotateX(-Math.PI / 2);
    this.skidMaterial = new THREE.MeshBasicMaterial({ color: '#202526', transparent: true, opacity: .52, depthWrite: false });
    this.skids = new THREE.InstancedMesh(this.skidGeometry, this.skidMaterial, 160); this.skids.count = 0;
    this.skids.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.skids.frustumCulled = false; this.skids.userData.ambientOcclusion = false;
    this.group.add(this.skids); this.trails = []; this.trailIndex = 0; this.lastTrail = 0; this.transform = new THREE.Object3D();
  }
  // Every waiting fare gets a badge: a dollar sign in the ring's distance
  // colour, as in Crazy Taxi, plus a white ×N when a group shares the ride.
  badge(count, color) {
    const key = `${count}${color}`;
    if (!this.partyBadges.has(key) && globalThis.document) {
      const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#17262f'; ctx.beginPath(); ctx.roundRect(2, 2, 124, 60, 18); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();
      const suffix = count > 1 ? `×${count}` : '';
      ctx.font = 'bold 42px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const dollar = ctx.measureText('$').width, tail = suffix ? ctx.measureText(suffix).width : 0;
      const left = 64 - (dollar + tail) / 2;
      ctx.fillStyle = color; ctx.fillText('$', left, 34);
      if (suffix) { ctx.fillStyle = '#fff8e7'; ctx.fillText(suffix, left + dollar, 34); }
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
    return [new THREE.Mesh(this.ring, solid), new THREE.Mesh(this.beam, glow), ...(badge ? [new THREE.Sprite(badge)] : [])];
  }
  rebuild(run) {
    const previousReactions = new Map(this.markers.map(marker => [marker.stop.id, marker.reactions]));
    for (const marker of this.markers) { marker.person?.dispose(); this.group.remove(marker.group); }
    this.markers = []; this.revision = run.revision;
    const stops = run.status === 'pickup' ? run.customers : run.status === 'driving' ? [{ ...run.target, color: '#ffd240' }] : [];
    for (const stop of stops) {
      const street = stop.profile ?? roadAt(stop.s, stop.u, 60)?.road.profile ?? profileOf('minor');
      const group = new THREE.Group(), { solid, glow } = this.markerMaterials(stop.color);
      // Local -z is the way the stop faces; riders wait on the kerb to its right.
      group.rotation.y = -(stop.heading ?? 0);
      // Keep the full radius across the street and visible over the adjacent curb.
      const ring = new THREE.Mesh(this.ring, solid); ring.position.y = PAVEMENT_LEVEL + .07; group.add(ring);
      const beam = new THREE.Mesh(this.beam, glow); beam.position.y = ROAD_LEVEL + 2.5; group.add(beam);
      const arrow = new THREE.Mesh(this.cone, solid); arrow.position.y = ROAD_LEVEL + 7; group.add(arrow);
      const badgeMaterial = run.status === 'pickup' && this.badge(stop.passengers, stop.color);
      if (badgeMaterial) {
        const badge = new THREE.Sprite(badgeMaterial); badge.position.y = ROAD_LEVEL + 9;
        badge.scale.set(3.6, 1.8, 1); badge.renderOrder = 1; group.add(badge);
      }
      let person = null;
      const float = { phase: this.markers.length * 2.4, speed: .2 };
      if (run.status === 'pickup') {
        person = new THREE.InstancedMesh(cityWalker, this.people, stop.passengers);
        const seed = Math.imul(Math.round(stop.s * 10), 73856093) ^ Math.imul(Math.round(stop.u * 10), 19349663);
        for (let i = 0; i < stop.passengers; i++) {
          setWalkerAppearance(person, i, stop.passengers > 1 ? taxiGroupAppearance(seed, i) : walkerAppearance(seed));
        }
        person.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // All riders share a draw call and stay in a compact line on the curb.
        const curb = street.halfWidth - street.lane + 2;
        person.boundingSphere = new THREE.Sphere(new THREE.Vector3(curb, PAVEMENT_LEVEL + 1.5, 0), 5);
        group.add(person);
      }
      group.traverse(object => { object.userData.ambientOcclusion = false; });
      const previous = previousReactions.get(stop.id), count = person?.count ?? 0;
      const reactions = previous?.length === count ? previous : Array.from({ length: count }, (_, i) => previous?.[i] ?? {});
      this.markers.push({ group, stop, arrow, ring, beam, person, float, reactions, curb: street.halfWidth - street.lane + 2 }); this.group.add(group);
    }
  }
  reset() {
    this.trails = []; this.trailIndex = 0; this.lastTrail = 0; this.skids.count = 0; this.revision = -1;
    for (const marker of this.markers) marker.reactions = null;
  }
  render(run, vehicle, origin, time, contacts = null) {
    this.group.visible = run.running;
    if (!run.running) return;
    if (this.revision !== run.revision) this.rebuild(run);
    this.group.position.z = origin;
    for (const marker of this.markers) {
      const selected = run.status === 'driving' || marker.stop.id === run.boarding?.id;
      marker.group.position.set(marker.stop.u, 0, -marker.stop.s);
      if (marker.person) {
        const { stop, person, curb } = marker;
        const cos = Math.cos(marker.group.rotation.y), sin = Math.sin(marker.group.rotation.y);
        for (let i = 0; i < person.count; i++) {
          const motion = walkerFloat(marker.float, time + i * .7, passengerFloat);
          const along = (i - (person.count - 1) / 2) * 1.35;
          this.transform.position.set(curb, PAVEMENT_LEVEL + motion.lift, along);
          this.transform.rotation.set(0, Math.PI / 2, motion.roll);
          this.transform.scale.set(1.25, 1.25 * motion.stretch, 1.25); this.transform.updateMatrix();
          const p = this.transform.position, reaction = marker.reactions[i];
          contacts?.hit(reaction, stop.u + cos * p.x + sin * p.z, p.y, -stop.s - sin * p.x + cos * p.z, .35, time);
          applyWalkerHop(reaction, this.transform.matrix, time);
          person.setMatrixAt(i, this.transform.matrix);
        }
        person.instanceMatrix.needsUpdate = true;
      }
      marker.arrow.position.y = ROAD_LEVEL + 7 + Math.sin(time * 3) * .35;
      marker.arrow.scale.setScalar(selected ? 1 : .65);
      marker.beam.visible = selected;
      const pulse = selected ? 1 + Math.sin(time * 4) * .035 : 1;
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
      text('taxi-boost-state', vehicle.boosting ? 'Boosting' : 'Hold');
      data('taxi-buttons', 'boosting', String(vehicle.boosting));
      data('taxi-buttons', 'drifting', String(vehicle.drifting));
      return;
    }
    text('taxi-clock', Math.ceil(run.timeLeft)); data('taxi-clock', 'urgent', String(run.timeLeft <= 15));
    text('taxi-cash', run.cash >= 1000 ? compactCash.format(run.cash) : money(run.cash));
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
    text('taxi-stage', pickup ? 'Pick up' : run.fare.stops.length > 1 ? `Stop ${run.stopIndex + 1} of ${run.fare.stops.length}` : 'Drop off');
    data('taxi-task', 'stage', run.status);
    // Pulse in the last seconds before the riders give up.
    data('taxi-task', 'urgent', String(!pickup && run.fareLeft <= 10));
    // Tips multiply by the combo and by every rider aboard.
    text('taxi-combo', !pickup && run.tipMultiplier > 1 ? `Tips ×${run.tipMultiplier}` : '');
    const track = $('taxi-stop-progress').parentElement;
    hide(track, run.hold <= 0);
    attribute(track, 'aria-label', pickup ? 'Passenger boarding' : 'Passenger drop-off');
    attribute(track, 'aria-valuenow', String(Math.round(Math.min(1, run.hold / STOP_SECONDS) * 100)));
    if (!stop) {
      const nearby = run.boarding ?? run.customers.reduce((best, customer) => {
        const d = Math.hypot(customer.s - vehicle.s, customer.u - vehicle.u);
        return d < 32 && (!best || d < Math.hypot(best.s - vehicle.s, best.u - vehicle.u)) ? customer : best;
      }, null);
      data('taxi-task', 'arriving', String(Boolean(run.boarding)));
      text('taxi-task-title', nearby ? nearby.destination.name : 'Find a passenger');
      const band = nearby && fareBand(nearby.length);
      text('taxi-party', band ? `${band.label} · ${distanceLabel(nearby.length)}` : '');
      data('taxi-party', 'band', band?.id ?? '');
      text('taxi-next-stop', nearby?.passengers > 1 ? `${nearby.passengers} riders · ${nearby.stops.length} stops` : '');
      hide($('taxi-timer'), true); hide($('taxi-timer-fill').parentElement, true);
      const risky = Boolean(nearby) && !run.boarding && run.shiftAfter(nearby) < 0;
      data('taxi-task', 'risky', String(risky));
      this.instruction(run.boarding ? 'Boarding…' : risky ? 'Risky · the shift may end first' : '');
      text('taxi-fare-status', nearby ? money(nearby.fare + nearby.groupBonus) : '');
      width('taxi-stop-progress', `${Math.min(1, run.hold / STOP_SECONDS) * 100}%`);
      return;
    }
    data('taxi-task', 'risky', 'false');
    const length = routeDistance(taxiRoute(vehicle, stop));
    const nearStop = Math.hypot(stop.s - vehicle.s, stop.u - vehicle.u) < STOP_RADIUS;
    text('taxi-nav-distance', nearStop ? 'Here' : `${Math.max(10, Math.round(length / 10) * 10)} m`);
    attribute($('taxi-nav'), 'aria-label', `Drop-off ${Math.round(length)} meters by road; the green arrow points directly to the destination`);
    text('taxi-task-title', stop.name);
    // The pill counts down to the riders giving up; its colour and the bar
    // show this rider's own window, so they always say what stopping now earns.
    const remaining = run.legRemaining, rating = arrivalRating(remaining);
    hide($('taxi-timer'), false); hide($('taxi-timer-fill').parentElement, false);
    text('taxi-timer', `${Math.ceil(run.fareLeft)}s ${rating.label}`);
    data('taxi-timer', 'rating', rating.id); data('taxi-timer-fill', 'rating', rating.id);
    attribute($('taxi-timer'), 'aria-label', `${Math.ceil(run.fareLeft)} seconds left; arriving now rates ${rating.label}`);
    width('taxi-timer-fill', `${remaining * 100}%`);
    text('taxi-fare-status', money(run.remainingFare + run.tips));
    data('taxi-party', 'band', '');
    text('taxi-party', run.fare.passengers > 1 ? `${run.onboard} aboard` : '');
    const next = run.fare.stops[run.stopIndex + 1];
    text('taxi-next-stop', next ? `Next · ${next.destination.name} · ${Math.round(next.length / 10) * 10} m` : run.fare.passengers > 1 ? 'Last stop' : '');
    const instruction = nearStop ? Math.abs(vehicle.speed) >= 2.5 ? 'Stop to drop off' : 'Dropping off…' : '';
    this.instruction(instruction);
    data('taxi-task', 'arriving', String(nearStop));
    width('taxi-stop-progress', `${Math.min(1, run.hold / STOP_SECONDS) * 100}%`);
  }
  instruction(text) {
    // Announce state changes, not every HUD refresh or countdown tick.
    if ($('taxi-task-detail').textContent !== text) $('taxi-task-detail').textContent = text;
  }
  results(run) {
    const license = taxiLicense(run.cash), best = taxiLicense(run.best);
    const summary = run.summary, career = run.career, beaten = id => Boolean(summary?.beaten.includes(id));
    const clock = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    $('taxi-result-shift').textContent = clock(Math.round(run.elapsed)); $('taxi-result-shift').dataset.new = String(beaten('shift'));
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
    $('taxi-result-best').textContent = `Best ${money(run.best)} · ${best.name}`;
    $('taxi-results').hidden = false;
  }
  dispose() {
    this.navigation.dispose();
    this.taskObserver?.disconnect(); globalThis.window?.removeEventListener('resize', this.measureTask);
    for (const { solid, glow } of this.palette.values()) { solid.dispose(); glow.dispose(); }
    for (const material of this.partyBadges.values()) { material.map.dispose(); material.dispose(); }
    for (const marker of this.markers) marker.person?.dispose();
    for (const resource of [this.ring, this.beam, this.cone, this.people, this.skidGeometry, this.skidMaterial]) resource.dispose();
    this.skids.dispose(); this.group.removeFromParent();
  }
}
