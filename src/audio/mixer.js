const LABELS = { master: 'Master volume', engine: 'Engine', road: 'Tires & wind', ambience: 'Environment', traffic: 'Traffic', cues: 'Game cues' };
const PRESETS = { balanced: 'Balanced', scenic: 'Scenic', night: 'Night drive' };

export function setupAudioMixer(audio) {
  const toggle = document.querySelector('#audio-mixer-toggle');
  const panel = document.querySelector('#audio-mixer');
  panel.innerHTML = `<div class="audio-presets" role="group" aria-label="Sound presets">${Object.entries(PRESETS).map(([id, label]) => `<button type="button" data-audio-preset="${id}" aria-pressed="false">${label}</button>`).join('')}</div>
    <div class="audio-channels">${Object.entries(LABELS).map(([id, label]) => `<div class="audio-channel"><label for="audio-${id}">${label}</label><output for="audio-${id}" id="audio-${id}-value"></output><input id="audio-${id}" data-audio-channel="${id}" type="range" min="0" max="100" step="1" aria-describedby="audio-mix-help"></div>`).join('')}</div>
    <button type="button" id="audio-night" class="panel-toggle" aria-pressed="false"><span>Soften loud sounds</span><span class="panel-switch" aria-hidden="true"></span></button>
    <p class="audio-description" id="audio-mix-help">Settings saved. Resume to listen.</p>`;
  const inputs = [...panel.querySelectorAll('[data-audio-channel]')];
  const presets = [...panel.querySelectorAll('[data-audio-preset]')];
  function refresh() {
    for (const input of inputs) {
      const value = Math.round(audio.mix[input.dataset.audioChannel] * 100);
      input.value = value;
      input.style.setProperty('--audio-level', `${value}%`);
      input.setAttribute('aria-valuetext', value === 0 ? 'Off' : `${value} percent`);
      document.getElementById(`${input.id}-value`).value = value === 0 ? 'Off' : `${value}%`;
    }
    for (const button of presets) button.setAttribute('aria-pressed', String(button.dataset.audioPreset === audio.preset));
    document.querySelector('#audio-night').setAttribute('aria-pressed', String(audio.mix.night));
    document.querySelector('#audio-mix-label').textContent = PRESETS[audio.preset] ?? 'Custom';
  }
  toggle.addEventListener('click', () => { panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); });
  for (const input of inputs) input.addEventListener('input', () => { audio.setMix(input.dataset.audioChannel, Number(input.value) / 100); refresh(); });
  for (const button of presets) button.addEventListener('click', () => { audio.setPreset(button.dataset.audioPreset); refresh(); });
  document.querySelector('#audio-night').addEventListener('click', () => { audio.setMix('night', !audio.mix.night); refresh(); });
  refresh();
  return refresh;
}
