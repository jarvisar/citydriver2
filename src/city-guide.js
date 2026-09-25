import { cityCell } from './world/city-route.js';
import { CityMapCache } from './city-map.js';
import { CITY_PLACES, PLACE_TYPES } from './world/city-places.js';
import { CityExploration } from './city-exploration.js';
import { taxiRoute } from './taxi-run.js';
import { goalProgress } from './taxi-goals.js';

const $ = id => document.getElementById(id);
// Updates run ten times a second; rewriting an unchanged attribute still
// invalidates style, so compare first.
const attribute = (element, name, value) => { if (element.getAttribute(name) !== value) element.setAttribute(name, value); };
const hide = (element, hidden) => { if (element.hidden !== hidden) element.hidden = hidden; };
const MAP_SCALE = .36;
export class CityGuide {
  constructor(notify, position) {
    // Discoveries are no longer kept between visits: drop any saved before
    try { localStorage.removeItem('citydriver-city-notebook-v1'); } catch { /* Optional storage. */ }
    this.exploration = new CityExploration(); this.notify = notify; this.position = position;
    this.mapCache = new CityMapCache();
    this.canvas = $('city-map'); this.ctx = this.canvas.getContext('2d');
    this.compactQuery = matchMedia('(max-width: 760px), (max-height: 560px)');
    this.setExpanded(!this.compactQuery.matches);
    this.compactQuery.addEventListener('change', () => {
      if (!this.mapPreferenceSet) this.setExpanded(!this.compactQuery.matches);
    });
    $('city-notebook').innerHTML = PLACE_TYPES.map(type => `<div class="notebook-place" data-place-type="${type}" title="${CITY_PLACES[type].description}" style="--place-color:${CITY_PLACES[type].color}"><span class="notebook-stamp">${CITY_PLACES[type].symbol}</span><span><strong>${CITY_PLACES[type].name}</strong><small>${CITY_PLACES[type].short}</small></span><span class="notebook-check" aria-hidden="true">○</span></div>`).join('');
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
    $('city-map-toggle').textContent = expanded ? 'Hide' : 'Show map';
    $('taxi-offer').hidden = !expanded || !this.taxi?.running || !$('taxi-offer').textContent;
    // Draw immediately so opening the map never exposes an empty canvas.
    if (expanded) {
      if (this.taxi?.running) this.updateTaxi();
      else this.draw(this.position());
    }
  }
  refreshNotebook() {
    const found = this.exploration.found;
    $('city-stamps').textContent = `${found.size} / ${PLACE_TYPES.length}`;
    $('city-notebook-progress').textContent = found.size === PLACE_TYPES.length
      ? `${PLACE_TYPES.length} / ${PLACE_TYPES.length} visited`
      : `${found.size} / ${PLACE_TYPES.length} visited`;
    for (const button of document.querySelectorAll('[data-place-type]')) {
      const collected = found.has(button.dataset.placeType);
      button.dataset.found = String(collected);
      button.querySelector('.notebook-check').textContent = collected ? '✓' : '○';
      button.setAttribute('aria-label', `${CITY_PLACES[button.dataset.placeType].name}, ${collected ? 'discovered' : 'undiscovered'}`);
    }
  }
  update(active) {
    const vehicle = this.position(), e = this.exploration;
    const found = e.update(vehicle.s, vehicle.u, active);
    if (found.length) {
      this.notify(e.found.size === PLACE_TYPES.length ? 'All landmarks visited' : `${found[0].name} · ${e.found.size} / ${PLACE_TYPES.length}`);
      this.refreshNotebook();
    }
    if (this.taxi?.running) { this.updateTaxi(); return; }
    attribute(this.canvas, 'title', 'Local street map');
    hide($('taxi-offer'), true);
    attribute(this.canvas, 'aria-label', 'Local street map. North is up; the white arrow is your car.');
    if (this.expanded) this.draw(vehicle);
  }
  updateTaxi() {
    const run = this.taxi, vehicle = this.position(), target = run.target;
    // The map card keeps the next shift goal in view; the task card already
    // says everything else about the fare.
    const goal = run.goals?.find(goal => !goal.done);
    const offer = goal ? `Goal · ${goal.text} · ${goalProgress(goal, run.stats)} / ${goal.target}` : '';
    if ($('taxi-offer').textContent !== offer) $('taxi-offer').textContent = offer;
    hide($('taxi-offer'), !this.expanded || !offer);
    attribute(this.canvas, 'title', run.status === 'pickup' ? 'Nearby passengers' : 'Route to the drop-off');
    attribute(this.canvas, 'aria-label', run.status === 'pickup'
      ? 'Local street map. North is up; the white arrow is your car. Dots mark waiting passengers, red for short trips through orange and yellow to green for long ones; numbers show group size.'
      : 'Local street map. North is up; the white arrow is your car. Gold marks the current drop-off; a dashed line leads to the next group stop.');
    if (this.expanded) this.draw(vehicle);
  }
  draw(vehicle) {
    // Resolve markers on every redraw; exploration and previous fares must not
    // leave destinations behind after the passenger has gone.
    const run = this.taxi;
    const target = run?.status === 'driving' ? run.target : null;
    const nextStop = target ? run.fare.stops[run.stopIndex + 1]?.destination : null;
    const places = run?.status === 'pickup' ? run.customers : target ? [{ ...target, color: '#ffd238' }] : [];
    const route = taxiRoute(vehicle, target);
    const ctx = this.ctx, width = 208, height = 144, scale = MAP_SCALE;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.floor(width * ratio), pixelHeight = Math.floor(height * ratio);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) { this.canvas.width = pixelWidth; this.canvas.height = pixelHeight; }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#20383e'; ctx.fillRect(0, 0, width, height);
    const point = p => [width / 2 + (p.u - vehicle.u) * scale, height / 2 - (p.s - vehicle.s) * scale];
    const { ix, iz } = cityCell(vehicle.s, vehicle.u);
    this.mapCache.update(ix, iz);
    this.mapCache.draw(ctx, vehicle, scale, width, height);
    if (nextStop) {
      ctx.save(); ctx.strokeStyle = '#95b8b9'; ctx.lineWidth = 2; ctx.setLineDash([3, 4]);
      ctx.beginPath(); taxiRoute(target, nextStop).forEach((p, i) => { const [x, y] = point(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke();
      ctx.restore();
      const [x, y] = point(nextStop);
      if (x > 7 && y > 7 && x < width - 7 && y < height - 7) {
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fillStyle = '#95b8b9'; ctx.fill();
        ctx.save(); ctx.fillStyle = '#17262f'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(run.stopIndex + 2), x, y); ctx.restore();
      }
    }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = 2; ctx.strokeStyle = '#efca8b';
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
    if (target) {
      const [x, y] = point(target), dx = x - width / 2, dy = y - height / 2;
      const factor = Math.min(1, (width / 2 - 12) / Math.max(Math.abs(dx), .001), (height / 2 - 12) / Math.max(Math.abs(dy), .001));
      if (factor < 1) {
        ctx.save(); ctx.translate(width / 2 + dx * factor, height / 2 + dy * factor); ctx.rotate(Math.atan2(dy, dx));
        ctx.fillStyle = '#f5d69c'; ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill(); ctx.restore();
      }
    }
    ctx.save(); ctx.translate(width / 2, height / 2); ctx.rotate(vehicle.heading);
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5); ctx.closePath();
    ctx.fillStyle = '#fff9e9'; ctx.strokeStyle = '#163038'; ctx.lineWidth = 2; ctx.stroke(); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#e2eee1'; ctx.font = 'bold 9px sans-serif'; ctx.fillText('N ↑', 10, 16);
    ctx.fillStyle = '#b3c4ba'; ctx.font = '8px sans-serif'; ctx.fillText('100 m', width - 37, height - 9);
    ctx.fillRect(width - 43, height - 19, 100 * scale, 1);
  }
}
