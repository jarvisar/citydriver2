import { ROOT } from './profiles.js';

// The game's cues, as short phrases in F major: bright and rising for a good
// thing, falling for a lost fare, and a quiet tick for the shift's last seconds. Each note is { at, step, length,
// level, wave }, `step` in semitones above the root two octaves up.
const note = (at, step, length = .16, level = .05, wave = 'triangle') => ({ at, step, length, level, wave });
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
export function cueNotes(kind, detail = {}) {
  switch (kind) {
    case 'pickup': return [note(0, 4), note(.07, 7, .24)];
    case 'dropoff': return [note(0, 7), note(.07, 12, .26)];
    case 'paid': {
      const great = detail.rating === 'speedy', notes = [note(0, 0, .12), note(.055, 4, .12), note(.11, 7, .14), note(.165, 12, great ? .3 : .45)];
      // coins: a glint on top, two for a speedy fare
      notes.push(note(.2, 31, .09, .018, 'sine'));
      if (great) notes.push(note(.23, 16, .4, .04), note(.26, 36, .09, .014, 'sine'));
      return detail.rating === 'slow' ? notes.slice(0, 2).concat(note(.11, 4, .3)) : notes;
    }
    case 'missed': return [note(0, -3, .2, .045, 'sine'), note(.15, -8, .4, .04, 'sine')];
    // Each stunt in a combo climbs a step
    case 'tip': return [note(0, 12 + PENTATONIC[Math.min(PENTATONIC.length - 1, Math.max(0, (detail.combo ?? 1) - 1))], .1, .03)];
    case 'tick': return [note(0, detail.urgent ? 28 : 24, .05, detail.urgent ? .04 : .028, 'sine')];
    case 'goal': return [note(0, 0, .1), note(.08, 4, .1), note(.16, 7, .1), note(.24, 12, .5, .055), note(.24, 16, .5, .03)];
    case 'discovery': return [note(0, 4, .5, .035), note(.12, 7, .5, .035), note(.24, 12, .7, .04)];
    default: return [];
  }
}
export const cueFrequency = step => 440 * 2 ** ((ROOT + 24 + step - 69) / 12);
