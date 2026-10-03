import { STOP_RADIUS, STOP_SECONDS, MOODS, taxiRoute, fareBand, arrivalRating, insideStop } from './taxi-run.js';
import { routeDistance } from './world/nav-graph.js';
import { money as damageMoney, contractProgress, CONTRACT_SECONDS } from './demolition-run.js';

const compactCash = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const money = value => `$${Math.round(value ?? 0).toLocaleString('en-US')}`;
const compact = (value, format = money) => value >= 1000 ? compactCash.format(value) : format(value);
const distanceLabel = meters => meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters / 10) * 10} m`;
const countUp = (shown, total, step) => total < shown ? total : Math.min(total, shown + Math.max(step, (total - shown) * .35));
const mileageFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
// What the Drift button says through a drift, as its sparks change (see Drift)
const DRIFT_STATES = ['Drifting', 'Blue', 'Orange', 'Pink'];

function baseHud(run, vehicle, free = false) {
  // (the Drift button shows the charge toward the next stage, then the turbo running down)
  const drift = vehicle.drift, charging = Boolean(drift && vehicle.drifting), turbo = !charging && drift?.boost > 0;
  return { running: run.running, buttons: run.running || free, boostVisible: run.running,
    boosting: run.running ? run.boostActive : vehicle.boosting, drifting: vehicle.drifting,
    driftStage: charging ? drift.stage : turbo ? drift.turboStage : 0, driftCharge: charging ? drift.progress : turbo ? drift.boost : 0,
    driftState: charging ? DRIFT_STATES[drift.stage] : turbo ? 'Turbo' : null, turbo,
    boost: run.boost, boostState: run.running ? run.boostActive ? 'Boosting' : run.boost < .1 ? 'Release to fill' : 'Hold'
      : vehicle.boosting ? vehicle.walker ? 'Sprinting' : 'Boosting' : 'Hold',
    speed: Math.round(Math.abs(vehicle.speed) * 2.23694), navigation: null, timer: null, stopProgress: null,
    combo: '', party: '', band: '', nextStop: '', mood: '', detail: '', info: '', fareStatus: '', arriving: false, taskUrgent: false, overtime: false };
}

// The waiting fare the cab is closest to, within sight of its ring
const NEARBY_FARE = 32;
function nearbyFare(run, vehicle) {
  const near = customer => Math.hypot(customer.s - vehicle.s, customer.u - vehicle.u);
  return run.boarding ?? run.customers.reduce((best, customer) => near(customer) < NEARBY_FARE && (!best || near(customer) < near(best)) ? customer : best, null);
}
// What a fare waiting by the cab offers: where to, who, how far and for
// how much, the same in a shift and in free drive's standby
function pickupCard(model, run, vehicle, nearby) {
  const band = nearby && fareBand(nearby.length), mood = MOODS[nearby?.mood];
  model.arriving = Boolean(run.boarding);
  model.title = nearby ? `To ${nearby.destination.name}` : '';
  model.party = band ? `${nearby.passengers > 1 ? `${nearby.passengers} riders` : nearby.name} · ${band.label} · ${distanceLabel(nearby.length)}` : '';
  model.band = band?.id ?? '';
  model.nextStop = mood ? `${mood.label} · ${mood.rule}` : nearby?.passengers > 1 ? `${nearby.stops.length} stops · paid at the last` : '';
  model.mood = nearby?.mood ?? '';
  const inRing = nearby && nearby.id !== run.blockedPickup?.id && Math.hypot(nearby.s - vehicle.s, nearby.u - vehicle.u) < STOP_RADIUS;
  model.detail = run.boarding ? 'Boarding…' : inRing ? 'Stop to pick up' : '';
  // (a special rider's rule matters more than the band, and the fare is on the line above)
  model.info = mood ? 'next' : 'party';
  model.fareStatus = nearby ? `Fare ${money(nearby.fare + nearby.groupBonus)}` : '';
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
    const nearby = nearbyFare(run, vehicle);
    pickupCard(model, run, vehicle, nearby);
    model.title ||= 'Find a passenger';
    model.detail ||= hint(!nearby && 'rings');
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
  model.info = model.nextStop ? 'next' : 'party';
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
    model.detail = hint(run.multiplier > 1 ? 'bank' : ''); model.info = 'next';
  } else {
    const next = open[0];
    model.stage = next ? 'Contract' : 'Demolition';
    model.timer = { text: `${contracts.length - open.length} / ${contracts.length}`, tone: 'chain', fraction: null,
      label: `${contracts.length - open.length} of ${contracts.length} contracts done` };
    model.fareStatus = ''; model.title = next ? next.text : 'Smash everything';
    model.party = next ? `${contractProgress(next)} · +${CONTRACT_SECONDS}s` : ''; model.band = next ? 'damage' : '';
    model.nextStop = next ? open.slice(1).map(other => `${other.short} ${contractProgress(other)}`).join(' · ') : contracts.length ? 'All contracts done' : '';
    model.detail = hint(run.bestChain ? 'time' : 'chain'); model.info = next ? 'party' : 'next';
  }
  return model;
}

// A test drive's card (see TestDrive): the clock, and once it is up, the car
// stopping or landing before the player's own takes its place
function testCard(model, test) {
  const seconds = Math.ceil(test.left);
  return Object.assign(model, { task: true, status: 'test', stage: test.stage ?? (test.over ? 'Test drive over' : 'Test drive'), fareStatus: test.price,
    timer: { text: test.clock, tone: seconds <= 15 ? 'slow' : 'chain', fraction: test.fraction, label: `${seconds} seconds of test drive left` },
    title: test.over ? test.landing ? 'Landing…' : 'Stopping…' : test.label, taskUrgent: !test.over && seconds <= 15,
    party: test.over ? `Back to your ${test.own}` : test.note, info: 'party' });
}

// Free drive's HUD, in the runs' panels. The task card only shows when it
// has something to say: a stunt chain going, a job on standby (a cab, with
// the fare it is by, see TaxiRun.standby, or the demolition truck), a test
// drive's clock. The rest of the time the view stays clear.
export function freeHudModel(stunts, vehicle, { taxi = null, demolition = null, test = null, hint = () => '' } = {}) {
  const model = Object.assign(baseHud({ running: false }, vehicle, true), { task: false, status: 'free' });
  if (test?.over) return testCard(model, test);
  if (stunts.chain) {
    return Object.assign(model, { task: true, status: 'chain', stage: `Chain ×${stunts.multiplier}`, fareStatus: money(stunts.pot),
      timer: { text: `${stunts.chain} stunt${stunts.chain === 1 ? '' : 's'}`, tone: 'chain', fraction: stunts.chainLeft, label: `${stunts.chain} stunts in the chain` },
      title: stunts.last?.label ?? 'Stunt', party: `+${money(stunts.last?.value)}`, band: 'damage',
      nextStop: stunts.nextStep ? `${stunts.nextStep} more for ×${stunts.multiplier + 1}` : 'Top multiplier', info: 'next', detail: hint('chain') });
  }
  const nearby = taxi?.waiting ? nearbyFare(taxi, vehicle) : null;
  if (nearby) {
    pickupCard(model, taxi, vehicle, nearby);
    return Object.assign(model, { task: true, status: 'pickup', stage: 'Fare',
      stopProgress: { visible: taxi.hold > 0, label: 'Passenger boarding', fraction: Math.min(1, taxi.hold / STOP_SECONDS) } });
  }
  if (test) return testCard(model, test);
  // (the demolition truck on standby: what starts the run, and its contracts)
  if (demolition?.waiting) {
    const contracts = demolition.contracts ?? [];
    return Object.assign(model, { task: true, status: 'standby', stage: 'Demolition', fareStatus: `Clock ${Math.round(demolition.timeLeft)} s`,
      title: 'Hit anything to start', party: contracts.length ? `Contracts · ${contracts.map(contract => contract.short).join(', ')}` : '', info: 'party' });
  }
  // (and a cab with no fare near: what starts the shift. Said once as a tip,
  // it left a shift picked on the menus with nothing on screen.)
  if (taxi?.waiting) {
    return Object.assign(model, { task: true, status: 'standby', stage: 'Taxi shift', fareStatus: `Clock ${Math.round(taxi.timeLeft)} s`,
      title: 'Find a passenger', party: 'Stop in a ring · the clock starts with the first fare', info: 'party' });
  }
  return model;
}

export function locationHudModel(vehicle, district, weather, cash = '') {
  const degrees = ((vehicle.heading * 180 / Math.PI) % 360 + 360) % 360;
  return { distance: mileageFormat.format(vehicle.distance / 1609.344),
    heading: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8], place: district, weather, cash };
}

export function headsetHudModel(run, location, hint = '') {
  // (free drive's card, when it has one, between the heading and the cash)
  if (!run?.running && run?.task) return { free: true, heading: location.heading, place: location.place, cash: location.cash,
    stage: [run.stage, run.fareStatus].filter(Boolean).join(' · '), title: run.title, distance: run.navigation?.distance ?? '',
    detail: run.detail || [run.party, run.nextStop].filter(Boolean).join(' · '),
    timer: run.timer && { text: run.timer.text, tone: run.timer.tone, fraction: run.timer.fraction === null ? null : Math.round(run.timer.fraction * 100) / 100 }, hint };
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
