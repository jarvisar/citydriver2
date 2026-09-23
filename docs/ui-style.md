# UI styles

`src/city-theme.css` loads after component styles. It owns colors, typography, borders, and interaction states. Component styles own positioning, responsive layout, and visibility.

## Theme

| Role | Token / value |
| --- | --- |
| Panel | `--city-panel`: `#263b45` |
| In-game panel | `--city-glass`: panel color at 95% opacity |
| Raised control/card | `--city-raised`: `#304954` |
| Hover | `--city-hover`: `#3b5662` |
| Recessed content | `--city-recessed`: `#1b2d36` |
| Primary text | `--city-text`: `#f5f4e9` |
| Supporting text | `--city-muted`: `#c4d3d8` |
| Primary action/selection | `--city-accent`: `#ffd238` with dark text |
| Section label/focus | `--city-gold`: `#f3d899` |
| Panel/control corners | 16px / 10px |
| Font | Segoe UI, Arial, sans-serif |

Use slate for secondary actions and yellow for primary actions or selections. Use the muted text color directly; don't stack low opacity on translucent panels. Urgency and arrival use red/green.

The action bar matches the district/compass panel's background, border, radius, font, and height. Circular compass, steering, and switch controls keep their shapes.

The district panel must shrink and truncate before touching the action bar. Run `node scripts/hud-test.mjs` after changing touch sizes or layout; it checks header overlap, expanded maps, and controller layouts.
