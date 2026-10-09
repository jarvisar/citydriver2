# UI Styles

The look is based on web apps and Chrome Experiments from around 2010 to 2014: dark gunmetal panels with a fine grain, beveled buttons, glossy accents, sunk wells for readouts and condensed capitals for headings. Things like Bootstrap 2's buttons and striped progress bars, iOS 5's switches, OS X's dark HUD windows and Growl's notices.

`src/city-theme.css` loads after the component styles. It sets colors, fonts, borders and hover/focus states. The component styles handle positioning, layout and visibility.

## Theme

| Role | Token / value |
| --- | --- |
| Panel | `--city-panel-fill`: grain over a `#33404a` to `#1a2127` gradient |
| In-game panel | `--city-hud-fill`: the same at 95% opacity |
| Button | `--city-button-fill`, `--city-button-hover`, `--city-button-down` |
| Bevel | `--city-bevel`: a 1px highlight along the top and a small drop shadow |
| Pressed / sunk | `--city-pressed`, `--city-press-in`, `--city-push-in`, `--city-well`, `--city-sunk`, `--city-groove` (inset shadows) |
| Dark edge | `--city-edge`: `#080b0d`, the 1px border round panels and buttons |
| Primary text | `--city-text`: `#f4f1e6` |
| Secondary text | `--city-muted`: `#b9c4cb` |
| Primary action/selection | `--city-accent-fill` (a glossy gradient) with dark text. Taxi yellow in a taxi run, orange in demolition, teal in free drive |
| Accent as light text | `--city-accent-soft` |
| Section label/focus | `--city-gold`: `#f3d899` |
| Panel/control corners | 7px / 5px |
| Body font | Helvetica Neue, Helvetica, Arial |
| Headings, numbers, big buttons | `--city-display`: Oswald (`src/fonts`, SIL Open Font License) |

Light text on dark gets `--city-engrave` (a dark shadow above it), dark text on the accent gets `--city-emboss` (a light shadow below). The accent's gloss comes from `--city-accent-top`, `--city-accent-bottom` and `--city-accent-edge`, set per mode on `body`. The composite tokens are worked out on `body` too, so declare new ones there or they won't follow the mode.

Use the dark button for secondary actions and the accent for primary actions and selections. Use the tokens instead of a fixed yellow so buttons, switches and the HUD follow the mode. Fare ratings keep their own colors in every mode. Use the muted text color as is instead of lowering the opacity on translucent panels. Red and green are used for urgent deadlines and arrivals.

Mode buttons keep their own color. Free drive on either results screen uses the title's teal button finish, including hover and pressed states. The headset uses the same free-drive accent.

There is no backdrop blur. The city moves every frame, so a blur gets redrawn every frame for every panel, which phones can't spare, and the panels are nearly opaque anyway. The grain is an SVG noise tile, kept to panels and not every button.

Inset shadows are a few stacked 1px steps with no blur (see the tokens above). Chrome redoes a blurred inset shadow on the GPU every time its box repaints, which was about 2,000 blurs over one drive and garage scroll. Steps draw like a border and look the same at this size. Outer drop shadows can keep their blur, since Chrome caches those.

The first time Chrome draws a new kind of effect it compiles a shader for it on the GPU thread the game also uses, which used to freeze the first pause, garage, boost and drift for 20-200 ms. `src/interface-warmup.js` draws copies of the HUD states and menus under the loading screen so that happens while loading. A new screen or HUD state with its own look should get a scene there in `main.js`.

The action bar matches the district/compass panel's background, border, corners, font and height. The compass, steering stick and switches stay circular.

The VR menus and HUD are drawn on canvases and can't read CSS, so `src/vr-status.js` copies these tokens into its `UI` object (gradients as top and bottom pairs), and each mode's accent into `ACCENTS`. Change both together. See [VR](vr.md).

The district panel should shrink and cut off its text before it touches the action bar. Run `node scripts/hud-test.mjs` after changing touch sizes or layout. It checks for overlap in the header, expanded maps and controller layouts.
