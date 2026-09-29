import { STOP_RADIUS, STOP_SECONDS, MOODS, taxiRoute, fareBand, arrivalRating, insideStop } from './taxi-run.js';
import { routeDistance } from './world/nav-graph.js';
import { money as damageMoney, contractProgress, CONTRACT_SECONDS } from './demolition-run.js';

const compactCash = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const money = value => `$${Math.round(value ?? 0).toLocaleString('en-US')}`;
const compact = (value, format = money) => value >= 1000 ? compactCash.format(value) : format(value);
const distanceLabel = meters => meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters / 10) * 10} m`;
const countUp = (shown, total, step) => total < shown ? total : Math.min(total, shown + Math.max(step, (total - shown) * .35));
const mileageFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function baseHud(run, vehicle, free = false) {
  return { running: run.running, buttons: run.running || free, boostVisible: run.running,
    boosting: run.running ? run.boostActive : vehicle.boosting, drifting: vehicle.drifting,
    boost: run.boost, boostState: run.running ? run.boostActive ? 'Boosting' : run.boost < .1 ? 'Release to fill' : 'Hold'
      : vehicle.boosting ? vehicle.walker ? 'Sprinting' : 'Boosting' : 'Hold',
    speed: Math.round(Math.abs(vehicle.speed) * 2.23694), navigation: null, timer: null, stopProgress: null,
    combo: '', party: '', band: '', nextStop: '', mood: '', detail: '', arriving: false, taskUrgent: false, overtime: false };
}

// Build once per HUD tick. Counting cash and once-only hints must not advance
// separately for the page and the headset.
export function taxiHudModel(run, vehicle, { free = false, shownCash = 0, hint = () => '' } = {}) {
  const model = baseHud(run, vehicle, free);
  model.shownCash = shownCash;
  if (!run.running) return model;
  model.shownCash = countUp(shownCash, run.cash, 25);
  Object.assign(model, { clockLabel: run.overtime ? 'LAST RIDE' : 'TIME', clock: String(Math.ceil(run.timeLeft)), urgent: run.timeLeft <= 15,
    cash: compact(Math.round(model.shownCash)), cashLabel: `Total earned ${money(run.cash)}`,
    fares: `${run.delivered} fare${run.delivered === 1 ? '' : 's'}`, status: run.status });
  const stop = run.target, pickup = run.status === 'pickup';
  model.stage = pickup ? 'Pick up' : run.overtime ? 'Last ride' : run.fare.stops.length > 1 ? `Stop ${run.stopIndex + 1} of ${run.fare.stops.length}` : 'Drop off';
  model.taskUrgent = !pickup && run.fareLeft <= 10;
  model.combo = !pickup && run.combo > 1 ? `Combo ×${run.combo}` : '';
  model.stopProgress = { visible: run.hold > 0, label: pickup ? 'Passenger boarding' : 'Passenger drop-off', fraction: Math.min(1, run.hold / STOP_SECONDS) };
  if (!stop) {
    const near = customer => Math.hypot(customer.s - vehicle.s, customer.u - vehicle.u);
    const nearby = run.boarding ?? run.customers.reduce((best, customer) => near(customer) < 32 && (!best || near(customer) < near(best)) ? customer : best, null);
    const band = nearby && fareBand(nearby.length), mood = MOODS[nearby?.mood];
    model.arriving = Boolean(run.boarding);
    model.title = nearby ? `To ${nearby.destination.name}` : 'Find a passenger';
    model.party = band ? `${nearby.passengers > 1 ? `${nearby.passengers} riders` : nearby.name} · ${band.label} · ${distanceLabel(nearby.length)}` : '';
    model.band = band?.id ?? '';
    model.nextStop = mood ? `${mood.label} · ${mood.rule}` : nearby?.passengers > 1 ? `${nearby.stops.length} stops · paid at the last` : '';
    model.mood = nearby?.mood ?? '';
    const inRing = nearby && nearby.id !== run.blockedPickup?.id && near(nearby) < STOP_RADIUS;
    model.detail = run.boarding ? 'Boarding…' : inRing ? 'Stop to pick up' : hint(!nearby && 'rings');
    model.fareStatus = nearby ? `Fare ${money(nearby.fare + nearby.groupBonus)}` : '';
    return model;
  }
  const length = routeDistance(taxiRoute(vehicle, run.approach(vehicle))), nearStop = insideStop(stop, vehicle);
  model.navigation = { distance: nearStop ? 'Here' : `${Math.max(10, Math.round(length / 10) * 10)} m`,
    label: `Drop-off ${Math.round(length)} meters by road; the green arrow points directly to the destination` };
  model.title = stop.name;
  const remaining = run.legRemaining, rating = arrivalRating(remaining), seconds = Math.ceil(run.ratingSeconds);
  model.timer = { text: `${rating.label} ${seconds}s`, tone: rating.id, fraction: remaining,
    label: rating.remaining > 0 ? `Arrive within ${seconds} seconds for ${rating.label}` : `${seconds} seconds before the riders give up` };
  model.fareStatus = `Meter ${money(run.remainingFare + run.tips)}`;
  const mood = MOODS[run.fare.mood];
  model.party = run.fare.passengers > 1 ? `${run.onboard} aboard` : mood ? run.shaken ? `${mood.label} · no bonus now` : `${mood.label} · ${mood.rule}` : '';
  const next = run.fare.stops[run.stopIndex + 1];
  model.nextStop = next ? `Next · ${next.destination.name} · ${Math.round(next.length / 10) * 10} m` : run.fare.passengers > 1 ? 'Last stop' : '';
  const key = run.tips > 0 ? 'tips' : run.fare.passengers > 1 ? 'group' : 'drive';
  model.detail = nearStop ? Math.abs(vehicle.speed) >= 2.5 ? 'Stop to drop off' : 'Dropping off…' : hint(!run.overtime && key);
  model.arriving = nearStop;
  return model;
}

export function demolitionHudModel(run, vehicle, { shownCash = 0, hint = () => '' } = {}) {
  const model = baseHud(run, vehicle);
  model.shownCash = run.running ? countUp(shownCash, run.score, 900) : run.score;
  if (!run.running) return model;
  Object.assign(model, { clockLabel: run.overtime ? 'LAST CHAIN' : 'TIME', clock: run.overtime ? '' : String(Math.ceil(run.timeLeft)),
    overtime: run.overtime, urgent: run.timeLeft <= 10, cash: compact(model.shownCash, damageMoney), cashLabel: `Damage ${damageMoney(run.score)}`,
    fares: run.beatBest ? 'New best!' : run.previousBest > 0 ? `Best ${compact(run.previousBest, damageMoney)}` : `${run.smashed + run.carsHit} smashed`, status: 'demolition' });
  const contracts = run.contracts ?? [], open = contracts.filter(contract => !contract.done);
  if (run.chain > 0) {
    model.stage = `${run.overtime ? 'Last chain' : 'Chain'} ×${run.multiplier}`;
    model.timer = { text: `${run.chain} hit${run.chain === 1 ? '' : 's'}`, tone: 'chain', fraction: run.chainLeft, label: `${run.chain} hits in the chain` };
    model.fareStatus = damageMoney(run.pending);
    model.title = run.last.label;
    model.party = `+${damageMoney(run.last.value)}`; model.band = 'damage';
    model.nextStop = run.nextStep ? `${run.nextStep} more for ×${run.multiplier + 1}` : 'Top multiplier';
    model.detail = hint(run.multiplier > 1 ? 'bank' : '');
  } else {
    const next = open[0];
    model.stage = next ? 'Contract' : 'Demolition';
    model.timer = { text: `${contracts.length - open.length} / ${contracts.length}`, tone: 'chain', fraction: null,
      label: `${contracts.length - open.length} of ${contracts.length} contracts done` };
    model.fareStatus = ''; model.title = next ? next.text : 'Smash everything';
    model.party = next ? `${contractProgress(next)} · +${CONTRACT_SECONDS}s` : ''; model.band = next ? 'damage' : '';
    model.nextStop = next ? open.slice(1).map(other => `${other.short} ${contractProgress(other)}`).join(' · ') : contracts.length ? 'All contracts done' : '';
    model.detail = hint(run.bestChain ? 'time' : 'chain') || (next ? 'Mind the pedestrians' : 'Wreck cars and street furniture · Mind the pedestrians');
  }
  return model;
}

export function locationHudModel(vehicle, district, weather) {
  const degrees = ((vehicle.heading * 180 / Math.PI) % 360 + 360) % 360;
  return { distance: mileageFormat.format(vehicle.distance / 1609.344),
    heading: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8], place: district, weather };
}

export function headsetHudModel(run, location, hint = '') {
  if (!run?.running) return { ...location, hint };
  const pickup = run.status === 'pickup', contract = run.status === 'demolition' && run.timer?.fraction === null;
  return { taxi: true, clockLabel: run.clockLabel, clock: run.clock, urgent: run.urgent, cash: run.cash, fares: run.fares,
    stage: [run.stage, run.fareStatus].filter(Boolean).join(' · '), title: run.title,
    distance: pickup ? '' : run.navigation?.distance ?? '',
    detail: pickup || contract ? [run.party, run.detail].filter(Boolean).join(' · ')
      : run.detail || run.nextStop || [run.party, run.combo].filter(Boolean).join(' · '),
    // Whole percents avoid uploading a new canvas texture for tiny bar changes.
    timer: run.timer && { text: run.timer.text, tone: run.timer.tone, fraction: run.timer.fraction === null ? null : Math.round(run.timer.fraction * 100) / 100 }, hint };
}
