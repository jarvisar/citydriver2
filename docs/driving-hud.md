# Driving HUD

The top left shows the shift time and earnings. Camera, reset and pause buttons are at the top right. The navigation card shows the distance, destination, fare and next action, with a green 3D arrow above the distance that points to the destination from the current camera.

## Layout

- On phones, navigation goes below the top row. On wider screens it sits between the corners.
- The map starts closed on small or short screens and open on desktop. If the player opens or closes it, that choice stays for the session, including after resizing.
- Players choose a fare by stopping at any passenger ring. Until the passenger has boarded, only nearby pickup markers are shown, with no route, arrow or destination.
- The delivery deadline reads `Arrive in …s` and is separate from the shift clock.
- Brake and boarding prompts show on arrival, with a progress bar while stopping. Screen reader announcements are made when the state changes, not on every countdown tick.
- Scoring messages share the instruction line, but arrival prompts take priority. Boarding doesn't show an extra "drive to drop-off" message.
- Expanded maps use the card's measured height so text doesn't wrap. On short screens the map scrolls and Close map stays visible.
- The boost meter sits with the Boost button. Boost shows a hold hint and Drift shows a tap-and-steer hint, and both light up while active. The speedometer stays clear of the touch controls.

On phones, instructions are 14px, destinations 17px and other navigation text 12px. Touch targets are at least 44px for the map and pause buttons and 64px for driving buttons. The steering stick appears wherever the thumb first touches the screen.

Use the shared [UI theme](ui-style.md). Keep the safe-area spacing, controller support, hidden HUD behind dialogs and reduced-motion support.

## Compass

The compass is a single low-poly mesh with baked face colors and no textures or shadows. Its canvas is at most 104 × 104 pixels and only redraws when the bearing changes. It clears when the fare ends and works in the chase, first-person and overhead cameras.

## Tests

With the dev server running:

```sh
node scripts/hud-test.mjs
```

The HUD test runs at 320×568, 390×844, 568×320, 667×375, 844×390, 768×1024 and 1440×960. It checks for overlap, screen bounds, touch target sizes, map controls, pickups and drop-offs, urgent deadlines, no navigation before boarding, empty boost, large earnings, safe areas, pause and free drive. Screenshots and reports go to `.artifacts/hud/`.

These tests emulate touch in the browser, so the game still needs testing on real phones.
