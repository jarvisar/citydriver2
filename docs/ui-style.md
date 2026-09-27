# UI Styles

`src/city-theme.css` loads after the component styles. It sets colors, fonts, borders and hover/focus states. The component styles handle positioning, layout and visibility.

## Theme

| Role | Token / value |
| --- | --- |
| Panel | `--city-panel`: `#263b45` |
| In-game panel | `--city-glass`: panel color at 95% opacity |
| Raised control/card | `--city-raised`: `#304954` |
| Hover | `--city-hover`: `#3b5662` |
| Recessed content | `--city-recessed`: `#1b2d36` |
| Primary text | `--city-text`: `#f5f4e9` |
| Secondary text | `--city-muted`: `#c4d3d8` |
| Primary action/selection | `--city-accent` with dark text: `#ffd238` in a taxi run, `#ff9433` in demolition, `#5fd0c0` in free drive |
| Accent as light text | `--city-accent-soft` |
| Section label/focus | `--city-gold`: `#f3d899` |
| Panel/control corners | 16px / 10px |
| Font | Segoe UI, Arial, sans-serif |

Use slate for secondary actions and the accent for primary actions and selections. Each mode has its own accent, set on `body[data-mode]`. Use the tokens instead of a fixed yellow so buttons, switches and the HUD follow the mode. Fare ratings keep their own colors in every mode. Use the muted text color as is instead of lowering the opacity on translucent panels. Red and green are used for urgent deadlines and arrivals.

The action bar matches the district/compass panel's background, border, corners, font and height. The compass, steering stick and switches stay circular.

The VR menus and HUD are drawn on canvases and can't read CSS, so `src/vr-status.js` copies these tokens into its `UI` object, and each mode's accent into `ACCENTS`. Change both together. See [VR](vr.md).

The district panel should shrink and cut off its text before it touches the action bar. Run `node scripts/hud-test.mjs` after changing touch sizes or layout. It checks for overlap in the header, expanded maps and controller layouts.
