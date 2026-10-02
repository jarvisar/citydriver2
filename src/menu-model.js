export const WEATHER_CHOICES = [
  ['auto', 'Auto'], ['clear', 'Day'], ['overcast', 'Overcast'], ['rain', 'Rain'], ['storm', 'Storm'], ['snow', 'Snow'], ['sunset', 'Golden hour'], ['night', 'Night'],
];
export const cycleChoice = (list, value) => list[(list.indexOf(value) + 1) % list.length];
const VR_CONTROLS = 'Right trigger: gas · Left trigger: brake\nLeft stick: steer · Left grip: drift\nRight grip: boost · A: camera · B: pause';
const VR_POINTING = 'Point and pull the trigger, or use either stick and A · B: back';

// Controls have stable names. Desktop binds them to its own markup, while VR
// lays out these same labels, values and commands on a canvas.
export function menuControls(state, actions) {
  const control = (label, activate, extra = {}) => ({ label, activate, ...extra });
  const run = state.mode !== 'free', taxi = state.mode === 'taxi', locked = state.started && run;
  return {
    start: control('Taxi shift', actions.start), taxi: control('Taxi shift', actions.taxi), demolition: control('Demolition', actions.demolition), free: control('Free drive', actions.free),
    resume: control('Resume', actions.resume), back: control('Back', actions.back), exit: control('Exit VR', actions.exit),
    retry: control(taxi ? 'Next shift' : 'Play again', state.mode === 'demolition' ? actions.demolition : actions.taxi),
    // Carrying on in free drive after a run, in the same car at the same spot
    keep: control('Keep driving', actions.keep),
    // (free drive's is New city, asked twice: it drops the places found and the jump stars)
    restart: control(run ? 'Restart run' : state.newCityArmed ? 'Again for a new city' : 'New city', state.mode === 'demolition' ? actions.demolition : actions.newCity),
    end: control(taxi ? 'End shift' : 'End run', actions.end),
    switchMode: control('Taxi shift', actions.taxi),
    otherRun: control(state.mode === 'demolition' ? 'Taxi shift' : 'Demolition', state.mode === 'demolition' ? actions.taxi : actions.demolition),
    fleet: control('Taxi fleet', actions.fleet, { value: state.fleetName }),
    garage: control('Garage', actions.garage, { value: state.carName, disabled: locked }),
    autodrive: control('Autodrive', actions.autodrive, { toggle: state.autodrive, disabled: locked }),
    traffic: control('Traffic', actions.traffic, { toggle: state.traffic, disabled: locked }),
    driftTap: control('Tap to drift', actions.driftTap, { toggle: state.driftTap }),
    reset: control('Reset car', actions.reset, { value: state.running ? '−5 seconds' : '' }),
    map: control('City map', actions.map, { value: state.location.place }),
    weather: control('Weather', actions.weather, { value: WEATHER_CHOICES.find(([id]) => id === state.weather)?.[1] }),
    view: control('Camera', actions.view, { value: state.view.replace(/ view$/, '') }),
    recenter: control('Recenter view', actions.recenter), comfort: control('Comfort vignette', actions.comfort, { toggle: state.comfort }),
    lookSensitivity: control('Stick look speed', actions.lookSensitivity, { value: `${Math.round((state.lookSensitivity ?? 1) * 100)}%` }),
    graphics: control('Graphics', actions.graphics, { value: state.graphics }),
    rate: control('Refresh rate', actions.rate, { value: state.rateChoice === null ? state.frameRate ? `Auto · ${Math.round(state.frameRate)} Hz` : 'Auto' : `${state.rateChoice} Hz` }),
    sound: control('Sound', actions.sound, { toggle: state.sound }),
    vibration: control('Vibration', actions.vibration, { toggle: state.vibration }),
    mix: control('Sound mix', actions.mix, { value: state.mix[0].toUpperCase() + state.mix.slice(1) }),
  };
}

export function menuModel(state, controls, { garage, fleet, result, mapImage, mapKey, mark } = {}) {
  const item = (key, extra) => ({ id: key, ...controls[key], ...extra });
  const back = item('back', { footer: true });
  if (state.loading) return { id: 'loading', title: 'Loading…', subtitle: 'Your drive will be ready shortly', items: [] };
  if (state.chooser === 'map') return { id: 'map', title: 'City map', subtitle: `You are in ${state.location.place}`, image: mapImage, imageKey: mapKey, items: [back], hint: 'B: back' };
  if (state.chooser === 'fleet') return { id: 'taxi-fleet-dialog', title: 'Taxi fleet', subtitle: `Fleet balance ${fleet.balance} · Faster cabs fit more fares into a run`,
    flow: true, items: [...fleet.cabs, ...fleet.liveries, back], hint: VR_POINTING };
  if (state.chooser === 'garage') return { id: 'car-dialog', title: 'Garage', subtitle: 'Paint applies to all cars', flow: true, items: [...garage.paints, ...garage.cars, back], hint: VR_POINTING };
  if (state.over) return { id: `${state.mode}-results`, title: `Time up · ${result.cash}`,
    subtitle: [result.name, state.mode === 'demolition' ? result.next : result.best].filter(Boolean).join(' · '), hint: VR_POINTING,
    items: [item('retry', { primary: true }), item('keep'), item(state.mode === 'demolition' ? 'taxi' : 'fleet', { value: undefined }), item('exit', { footer: true })] };
  if (!state.started) return { id: 'title', title: 'citydriver', wordmark: true, mark, subtitle: 'Pick up. Drop off. Beat the clock.', hint: VR_CONTROLS,
    items: [item('start', { primary: true }), item('demolition'), item('free'), item('exit')] };
  if (!state.paused) return null;
  const drive = key => item(key, { group: 'Driving' });
  const view = key => item(key, { column: 1, group: 'View' });
  return { id: 'pause', title: 'Paused', subtitle: [state.location.place, state.career].filter(Boolean).join(' · '), columns: 2,
    hint: state.mode === 'free' ? `${VR_CONTROLS} · Y: get out` : VR_CONTROLS, items: [
      item('resume', { primary: true, header: true }),
      ...(state.mode === 'taxi' ? ['end', 'demolition', 'fleet'] : state.mode === 'demolition' ? ['restart', 'end', 'taxi'] : ['taxi', 'demolition', 'garage', 'fleet', 'autodrive', 'traffic']).map(drive),
      drive('driftTap'), drive('reset'), item('map', { group: 'The city' }), item('weather', { group: 'The city' }),
      ...['view', 'recenter', 'lookSensitivity', 'comfort', 'graphics'].map(view), ...(state.rates.length ? [view('rate')] : []),
      item('sound', { column: 1, group: 'Sound' }), item('mix', { column: 1, group: 'Sound' }), item('vibration', { column: 1, group: 'Sound' }), item('exit', { footer: true }),
    ] };
}
