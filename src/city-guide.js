import { CityMapCache, drawParkedCar } from './city-map.js';
import { CITY_PLACES, PLACE_TYPES } from './world/city-places.js';
import { CityExploration, cityPlaces } from './city-exploration.js';
import { taxiRoute, STOP_RADIUS } from './taxi-run.js';
import { goalProgress } from './taxi-goals.js';
import { contractProgress } from './demolition-run.js';
import { starText } from './jump-book.js';
import { $, attribute, hide } from './hud-dom.js';

const MAP_SCALE = .36;
// A ramp, for the notebook's jumps
const RAMP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18h18V9Z" fill="currentColor"/></svg>';
const EMPTY = [];
// What a place found pays into the fleet balance, the first of its kind more
export const PLACE_PAY = 50, KIND_PAY = 100;
export const placePay = found => found.reduce((sum, { first }) => sum + (first ? KIND_PAY : PLACE_PAY), 0);
export class CityGuide {
  constructor(notify, position) {
    // Discoveries last only for the visit: clear any an older build saved
    try { localStorage.removeItem('citydriver-city-notebook-v1'); } catch { /* Optional storage. */ }
    this.exploration = new CityExploration(); this.notify = notify; this.position = position;
    // (the places found since a run began, for its results)
    this.lately = [];
    this.mapCache = new CityMapCache();
    this.canvas = $('city-map'); this.ctx = this.canvas.getContext('2d');
    // A restored context starts blank, so the next update draws again
    this.canvas.addEventListener('contextrestored', () => { this.shown = null; });
    this.compactQuery = matchMedia('(max-width: 760px), (max-height: 560px)');
    this.setExpanded(!this.compactQuery.matches);
    this.compactQuery.addEventListener('change', () => {
      if (!this.mapPreferenceSet) this.setExpanded(!this.compactQuery.matches);
    });
    $('city-notebook').innerHTML = PLACE_TYPES.map(type => { const kind = CITY_PLACES[type]; return `<div class="notebook-place" data-place-type="${type}" title="${kind.description}" style="--place-color:${kind.color}"><span class="notebook-stamp">${kind.symbol}</span><span><strong>${kind.label}</strong><small>${kind.short}</small></span><span class="notebook-check" aria-hidden="true">○</span></div>`; }).join('');
    $('city-map-toggle').addEventListener('click', () => {
      this.mapPreferenceSet = true;
      this.setExpanded(!this.expanded);
    });
    this.refreshNotebook();
  }
  setExpanded(expanded) {
    this.expanded = expanded; this.canvas.hidden = !expanded;
    $('city-guide').dataset.expanded = String(expanded);
    $('city-map-toggle').setAttribute('aria-expanded', String(expanded));
    $('city-map-toggle').setAttribute('aria-label', expanded ? 'Hide map' : 'Show map');
    $('city-map-toggle').title = expanded ? 'Hide map' : 'Show map';
    $('taxi-offer').hidden = !expanded || !(this.taxi?.running || this.demolition?.running) || !$('taxi-offer').textContent;
    // Draw immediately so opening the map never exposes an empty canvas.
    if (expanded) {
      this.shown = null;
      if (this.taxi?.running) this.updateTaxi();
      else this.draw(this.position());
    }
  }
  // A kind's row names the places of that kind found so far, and says so
  // when the city has another still to find
  refreshNotebook() {
    const e = this.exploration, total = PLACE_TYPES.length;
    $('city-stamps').textContent = `${e.found.size} / ${total}`;
    $('city-notebook-progress').textContent = e.found.size === total ? `All ${total} found.` : `${e.found.size} / ${total} found. Drive past a place, or drop a fare there, to stamp it.`;
    for (const row of document.querySelectorAll('[data-place-type]')) {
      const kind = CITY_PLACES[row.dataset.placeType], all = cityPlaces().filter(place => place.type === row.dataset.placeType);
      const names = all.filter(place => e.seen.has(place.id)).map(place => place.name), more = all.length - names.length;
      row.dataset.found = String(names.length > 0);
      row.querySelector('small').textContent = names.length ? [...names, more && `${names.length} of ${all.length}`].filter(Boolean).join(' · ') : kind.short;
      row.querySelector('.notebook-check').textContent = names.length ? '✓' : '○';
      row.setAttribute('aria-label', `${kind.label}, ${names.length ? `found: ${names.join(' and ')}${more ? `, ${more} more in the city` : ''}` : 'not found yet'}`);
    }
  }
  // The city's named jumps (see JumpBook), how far each has been taken, and
  // the best ever. The rows are made once, when the book is first asked.
  refreshJumps() {
    const book = this.jumps, list = $('city-jumps');
    if (!book || !list) return;
    const sites = book.sites;
    if (!list.childElementCount && sites.length) list.innerHTML = sites.map(site => `<div class="notebook-place" data-jump="${site.id}" style="--place-color:${site.kind === 'river' ? '#e3b02c' : '#5fd0c0'}"><span class="notebook-stamp">${RAMP_ICON}</span><span><strong>${site.name}</strong><small></small></span><span class="notebook-check" aria-hidden="true"></span></div>`).join('');
    for (const row of list.children) {
      const site = sites.find(each => each.id === Number(row.dataset.jump)), best = book.best.get(site.id), stars = book.stars(site);
      const where = site.kind === 'river' ? 'Off the half-built bridge, over the water' : `By ${site.where}`;
      row.dataset.found = String(best !== undefined);
      row.querySelector('small').textContent = best === undefined ? where : `${where} · best ${best} m`;
      row.querySelector('.notebook-check').textContent = starText(stars);
      row.setAttribute('aria-label', `${site.name}, ${where}: ${best === undefined ? 'not jumped yet' : `best ${best} metres, ${stars} of 3 stars`}`);
    }
    $('city-jumps-progress').textContent = sites.length ? `${book.landed} / ${sites.length} landed. Take a run at a ramp: stars for how far you fly.` : 'This city has no named jumps.';
    const r = book.records, records = $('city-jump-records');
    records.hidden = !r.longest;
    records.textContent = r.longest ? ['Best ever', `${r.longest} m`, `${r.air.toFixed(1)} s in the air`, r.turns ? `${r.turns * 360} spin` : ''].filter(Boolean).join(' · ') : '';
  }
  // Every new place is news: the first of a kind stamps the notebook, and
  // another of a kind says how many there are
  announce(found) {
    const e = this.exploration, total = PLACE_TYPES.length, names = found.map(({ place }) => place.name);
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
    const one = found.length === 1 ? found[0].place : null, label = one && CITY_PLACES[one.type].label;
    // (no label where the name already says it: Maple Library, Station Square)
    const kind = label && !one.name.toLowerCase().includes(label.split(' ').at(-1).toLowerCase()) ? label : '';
    let count = '';
    if (found.some(each => each.first)) count = e.found.size === total ? `all ${total} found` : `${e.found.size} / ${total}`;
    else if (one) { const all = cityPlaces().filter(place => place.type === one.type); count = `${all.filter(place => e.seen.has(place.id)).length} of ${all.length}`; }
    this.notify(['Found ' + list, kind, count].filter(Boolean).join(' · '), found);
    this.lately.push(...found.map(({ place }) => place));
    this.refreshNotebook();
  }
  // The places found so far, for the maps
  foundPlaces() { return cityPlaces().filter(place => this.exploration.seen.has(place.id)); }
  // A fare dropped at a place finds it, wherever the cab stopped
  arrive(id) {
    const found = this.exploration.arrive(id);
    if (found.length) this.announce(found);
  }
  // `draw: false` skips the canvas for when nobody can see the page, as in a
  // headset. Discoveries and the map card's text still update.
  update(active, { draw = true } = {}) {
    if (!draw) this.mapState = null;
    const vehicle = this.position(), e = this.exploration;
    // (on foot, or seen from the air, a landmark counts from anywhere near it)
    const found = e.update(vehicle.s, vehicle.u, active, Boolean(vehicle.walker || vehicle.airborne));
    if (found.length) this.announce(found);
    if (this.taxi?.running) { this.updateTaxi(draw); return; }
    if (this.demolition?.running) { this.updateDemolition(draw); return; }
    attribute(this.canvas, 'title', 'Local street map');
    hide($('taxi-offer'), true);
    attribute(this.canvas, 'aria-label', `Local street map. Your heading is up; the white arrow is ${vehicle.walker ? 'you' : 'your car'}. Coloured dots are places you have found.${this.onFoot?.parked ? ' The car in a teal ring is your own, where you left it.' : ''}`);
    if (this.expanded && draw) this.draw(vehicle);
  }
  updateTaxi(draw = true) {
    const run = this.taxi, vehicle = this.position();
    // The map card keeps the next shift goal in view; the task card already
    // says everything else about the fare.
    const goal = run.goals?.find(goal => !goal.done);
    const offer = goal ? `Goal · ${goal.text} · ${goalProgress(goal, run.stats)} / ${goal.target}` : '';
    if ($('taxi-offer').textContent !== offer) $('taxi-offer').textContent = offer;
    hide($('taxi-offer'), !this.expanded || !offer);
    attribute(this.canvas, 'title', run.status === 'pickup' ? 'Nearby passengers' : 'Route to the drop-off');
    attribute(this.canvas, 'aria-label', run.status === 'pickup'
      ? 'Local street map. Your heading is up; the white arrow is your car. Dots mark waiting passengers, red for short trips through orange and yellow to green for long ones; numbers show group size.'
      : 'Local street map. Your heading is up; the white arrow is your car. Gold marks the current drop-off and the stretch of street to stop in; a dashed line leads to the next group stop.');
    if (this.expanded && draw) this.draw(vehicle);
  }
  // A demolition run's map card keeps its next contract in view, as a taxi
  // shift's does its next goal, and the map marks what the open contracts
  // ask for (`targets`, set up in main.js)
  updateDemolition(draw = true) {
    const run = this.demolition, vehicle = this.position(), contract = run.contracts.find(each => !each.done);
    const offer = contract ? `Contract · ${contract.text} · ${contractProgress(contract)}` : '';
    if ($('taxi-offer').textContent !== offer) $('taxi-offer').textContent = offer;
    hide($('taxi-offer'), !this.expanded || !offer);
    attribute(this.canvas, 'title', 'Local street map');
    attribute(this.canvas, 'aria-label', 'Local street map. Your heading is up; the white arrow is your car. Orange dots mark what your contracts ask for.');
    if (this.expanded && draw) this.draw(vehicle);
  }
  render(car, origin) {
    if (!this.expanded) return;
    if (!this.mapState) this.draw(this.position());
    const pose = this.mapPose ??= {};
    pose.u = car.position.x; pose.s = origin - car.position.z; pose.heading = -car.rotation.y;
    this.draw(pose, false);
  }
  draw(vehicle, refresh = true) {
    // Routes and marker lists stay on the HUD's slower refresh. Only their
    // screen positions follow the rendered car each frame.
    if (refresh || !this.mapState) {
      const run = this.taxi, target = run?.status === 'driving' ? run.target : null;
      const nextStop = target ? run.fare.stops[run.stopIndex + 1]?.destination : null;
      const parked = this.onFoot?.parked;
      const targets = this.demolition?.running ? this.targets?.() ?? EMPTY : EMPTY;
      const known = run?.running || this.demolition?.running ? [] : this.foundPlaces();
      // (and in free drive, the city's named jumps: gold once landed)
      const jumps = run?.running || this.demolition?.running || !this.jumps ? EMPTY : this.jumps.sites;
      this.mapState = { target, nextStop, parked, targets, known, jumps, landed: this.jumps?.landed, stopIndex: run?.stopIndex,
        places: run?.status === 'pickup' || run?.status === 'standby' ? run.customers : target ? [{ ...target, color: '#ffd238' }] : [],
        route: taxiRoute(vehicle, target && run.approach(vehicle)), nextRoute: nextStop ? taxiRoute(target, nextStop) : [],
        key: [run, run?.status, run?.status === 'pickup' || run?.status === 'standby' ? run.customers : null, target, nextStop, run?.stopIndex, parked, parked?.s, parked?.u, targets, known.length, jumps, this.jumps?.landed] };
    }
    const { target, nextStop, parked, targets, known, jumps, places, route, nextRoute, stopIndex, key } = this.mapState;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    // Everything the map shows comes from these (the route from the car's
    // position and its drop-off). While none has changed, as when paused or
    // waiting in a ring, the canvas already shows it.
    const shown = [ratio, vehicle.u, vehicle.s, vehicle.heading, ...key];
    if (this.shown?.length === shown.length && this.shown.every((value, i) => value === shown[i])) return;
    this.shown = shown;
    const ctx = this.ctx, width = 208, height = 144, scale = MAP_SCALE;
    const pixelWidth = Math.floor(width * ratio), pixelHeight = Math.floor(height * ratio);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) { this.canvas.width = pixelWidth; this.canvas.height = pixelHeight; }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#20383e'; ctx.fillRect(0, 0, width, height);
    // Roads and destinations share the car's frame; marker labels stay upright.
    const heading = vehicle.heading ?? 0, sin = Math.sin(heading), cos = Math.cos(heading);
    const point = p => {
      const du = p.u - vehicle.u, ds = p.s - vehicle.s;
      return [width / 2 + (du * cos - ds * sin) * scale, height / 2 - (du * sin + ds * cos) * scale];
    };
    this.mapCache.drawCached(ctx, vehicle, scale, width, height, ratio);
    if (nextStop) {
      ctx.save(); ctx.strokeStyle = '#95b8b9'; ctx.lineWidth = 2; ctx.setLineDash([3, 4]);
      ctx.beginPath(); nextRoute.forEach((p, i) => { const [x, y] = point(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke();
      ctx.restore();
      const [x, y] = point(nextStop);
      if (x > 7 && y > 7 && x < width - 7 && y < height - 7) {
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fillStyle = '#95b8b9'; ctx.fill();
        ctx.save(); ctx.fillStyle = '#17262f'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(stopIndex + 2), x, y); ctx.restore();
      }
    }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // The drop-off stretch, as wide as the stop reaches
    if (target?.stretch?.length > 1) {
      ctx.lineWidth = STOP_RADIUS * 2 * scale; ctx.strokeStyle = 'rgba(245, 214, 156, .5)';
      ctx.beginPath(); target.stretch.forEach((p, i) => { const [x, y] = point(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke();
    }
    ctx.lineWidth = 2; ctx.strokeStyle = '#efca8b';
    ctx.beginPath(); route.forEach((p, i) => { const [x, y] = point(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke();
    for (const place of places) {
      const [x, y] = point(place), selected = place.id === target?.id;
      if (x < 5 || y < 5 || x > width - 5 || y > height - 5) continue;
      ctx.beginPath(); ctx.arc(x, y, selected || place.passengers > 1 ? 6 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = selected ? '#f5d69c' : place.color; ctx.fill();
      if (place.passengers > 1) {
        ctx.save(); ctx.fillStyle = '#17262f'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(place.passengers), x, y); ctx.restore();
      }
      if (selected) { ctx.strokeStyle = '#fff4dc'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.strokeStyle = '#17262f'; ctx.lineWidth = 1.5;
    for (const place of known) {
      const [x, y] = point(place);
      if (x < 4 || y < 4 || x > width - 4 || y > height - 4) continue;
      ctx.fillStyle = CITY_PLACES[place.type].color;
      ctx.beginPath(); ctx.arc(x, y, 3.4, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
    }
    // A jump: a wedge pointing the way to take it
    for (const site of jumps) {
      const [x, y] = point(site);
      if (x < 6 || y < 6 || x > width - 6 || y > height - 6) continue;
      ctx.save(); ctx.translate(x, y); ctx.rotate(site.heading - heading);
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.5, 4); ctx.lineTo(-4.5, 4); ctx.closePath();
      ctx.fillStyle = this.jumps.best.has(site.id) ? '#e3b02c' : '#5fd0c0'; ctx.strokeStyle = '#17262f'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.fill(); ctx.restore();
    }
    ctx.fillStyle = '#ff9433'; ctx.strokeStyle = '#17262f'; ctx.lineWidth = 1.5;
    for (const place of targets) {
      const [x, y] = point(place);
      if (x < 4 || y < 4 || x > width - 4 || y > height - 4) continue;
      ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
    }
    // The car the player left, or where it is from the edge, pointed at
    if (parked) {
      const [x, y] = point(parked), dx = x - width / 2, dy = y - height / 2, edge = 10;
      const factor = Math.min(1, (width / 2 - edge) / Math.max(Math.abs(dx), .001), (height / 2 - edge) / Math.max(Math.abs(dy), .001));
      if (factor < 1) {
        ctx.save(); ctx.translate(width / 2 + dx * factor, height / 2 + dy * factor); ctx.rotate(Math.atan2(dy, dx));
        ctx.fillStyle = '#5fd0c0'; ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(5, -3.5); ctx.lineTo(5, 3.5); ctx.closePath(); ctx.fill(); ctx.restore();
      }
      drawParkedCar(ctx, width / 2 + dx * factor, height / 2 + dy * factor, factor < 1 ? 5 : 6.5);
    }
    if (target) {
      const [x, y] = point(target), dx = x - width / 2, dy = y - height / 2;
      const factor = Math.min(1, (width / 2 - 12) / Math.max(Math.abs(dx), .001), (height / 2 - 12) / Math.max(Math.abs(dy), .001));
      if (factor < 1) {
        ctx.save(); ctx.translate(width / 2 + dx * factor, height / 2 + dy * factor); ctx.rotate(Math.atan2(dy, dx));
        ctx.fillStyle = '#f5d69c'; ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill(); ctx.restore();
      }
    }
    ctx.save(); ctx.translate(width / 2, height / 2);
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5); ctx.closePath();
    ctx.fillStyle = '#fff9e9'; ctx.strokeStyle = '#163038'; ctx.lineWidth = 2; ctx.stroke(); ctx.fill(); ctx.restore();
    // A small compass keeps north available while the player always faces up.
    ctx.save(); ctx.translate(21, 22); ctx.rotate(-heading);
    ctx.strokeStyle = '#e2eee1'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, 5); ctx.lineTo(0, -5); ctx.moveTo(-3, -2); ctx.lineTo(0, -5); ctx.lineTo(3, -2); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.fillStyle = '#e2eee1'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', 21 - sin * 13, 22 - cos * 13); ctx.restore();
    ctx.fillStyle = '#b3c4ba'; ctx.font = '8px sans-serif'; ctx.fillText('100 m', width - 37, height - 9);
    ctx.fillRect(width - 43, height - 19, 100 * scale, 1);
  }
}
