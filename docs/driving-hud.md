# Driving HUD

The top left shows shift time and earnings. Camera, reset, and pause sit at the top right. A navigation card groups distance, destination, fare, and next action. A green 3D arrow sits inside the card above the distance and points directly to the destination relative to the active camera.

## Behavior

- Phones put navigation below the top row; wider screens put it between the corners.
- The map starts closed on small or short screens and open on desktop. A manual toggle persists through resizing during the session.
- Players choose fares by stopping at any passenger ring. Before boarding completes, show nearby pickup markers without a selected passenger, route, arrow, or destination preview.
- The delivery deadline reads `Arrive in …s`, separate from the shift clock.
- Brake and boarding prompts appear on arrival. Progress appears while stopping. Screen-reader announcements follow state changes, not countdown ticks.
- Scoring notifications share the instruction slot; arrival prompts take priority. Boarding does not show a redundant drive-to-drop-off message.
- Expanded maps use the card's measured height to avoid wrapped text. On short screens, map content scrolls and Close map stays accessible.
- Boost charge sits with Boost. Boost shows a hold instruction; Drift shows tap-and-steer. Both show active feedback. Speed stays clear of touch controls.

Phone text sizes are 14px for instructions, 17px for destinations, and 12px for supporting navigation. Minimum touch targets are 44px for map/pause and 64px for driving actions. The steering stick stays on the right.

Use the shared [UI theme](ui-style.md). Keep safe-area spacing, controller visibility, hidden HUDs in dialogs, and reduced-motion behavior.

## Tests

With a dev server running:

```sh
node scripts/hud-test.mjs
```

HUD checks cover 320×568, 390×844, 568×320, 667×375, 844×390, 768×1024, and 1440×960. They check overlap, screen bounds, touch targets, map controls, pickups/deliveries, urgent deadlines, no navigation before boarding, depleted boost, large earnings, safe areas, pause, and free drive.

Screenshots and reports go to `.artifacts/hud/`. Taxi tests include simultaneous steering with boost/drift. These are browser-emulated touch checks; physical phone playtesting is still needed.

The compass uses a single low-poly mesh with baked face colors and no textures or shadows. Its transparent canvas is at most 104 by 104 pixels and redraws only when the bearing changes. It clears when the fare ends and works with chase, first-person, and overhead cameras.
