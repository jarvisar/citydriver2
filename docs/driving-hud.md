# Driving HUD

The top left shows the shift time and earnings. Camera, reset and pause buttons are at the top right. The task card is two lines: the stage, the rating timer and the money, then the destination with one extra after it. A green 3D arrow above the distance points to the destination from the current camera.

## Layout

- On phones, navigation goes below the top row. On wider screens it sits between the corners.
- On touch screens the driving buttons are at the bottom right with Boost in the corner, and the speed sits above them. The street map takes the bottom left, which otherwise stays clear for the steering thumb. On an upright phone in free drive there's no room for the map beside three buttons, so it sits a row higher.
- On phones the top right only has round view and pause buttons, like most mobile racers. Reset makes a new city in free drive, so it isn't on the phone HUD there (New city is in the pause menu), and in a run it only appears once the car has been still for 3 seconds. The camera buttons (zoom out, recenter, zoom in) only show on tablets, as a row under the top-right buttons. On a phone the distance is set in the Camera settings and the camera recenters itself.
- In free drive the district card (heading, district and weather) only shows for a few seconds when a drive starts and when you drive into another district. The new name has to hold for a second and a half first, and a district shown in the last 30 seconds isn't shown again, because along the water the name flips between Harbour or Riverfront and the district behind it.
- The map starts closed on small or short screens and open on desktop. If the player opens or closes it, that choice stays for the session, including after resizing.
- The extra on the task card's second line depends on the state: the riders, band and distance of a nearby fare (or a special rider's rule), the next stop of a group, the special rule during a fare, and in demolition the contract's progress or how many more hits the next multiplier needs. Hints, arrival prompts and toasts take its place while they show, and an arrival prompt keeps its words even if the destination has to be cut short. Earlier versions stacked all of these as separate lines, and a demolition chain's card covered almost half of a small phone's screen on its side.
- Players choose a fare by stopping at any passenger ring. Driving up to a ring previews the fare in the task card. Until the passenger has boarded, there is no route or arrow.
- The timer pill shows the current rating and the seconds until it drops, for example `Speedy 12s`. It is separate from the shift clock, which reads LAST RIDE once time has run out with riders aboard.
- The distance counts down to the near end of the drop-off zone and says Here anywhere inside it. The map shows the zone as a gold band along the street.
- Brake and boarding prompts show on arrival, with a progress bar while stopping. Screen reader announcements are made when the state changes, not on every countdown tick.
- Boarding doesn't show an extra "drive to drop-off" message.
- Expanded maps use the card's measured height so text doesn't wrap. On short screens the map scrolls and Close map stays visible.
- The boost meter sits with the Boost button. Boost shows a hold hint and Drift a hold-and-steer hint (tap-and-steer with Tap to drift on), and both light up while active. During a drift the Drift button's border and a thin bar along its bottom take the sparks' colour, and the bar fills toward the next colour. After letting go it says Turbo while the boost lasts. The speedometer stays clear of the touch controls.

On phones the task card uses 11px for the first line, 15px for the destination and 12px for the extra, and the top row is 50px tall. Touch targets are at least 44px for the map and pause buttons and 64px for driving buttons. The steering stick appears wherever the thumb first touches the screen.

Use the shared [UI theme](ui-style.md). Keep the safe-area spacing, controller support and reduced-motion support, and keep the HUD hidden behind dialogs.

## Compass

The compass is a single low-poly mesh with baked face colors and no textures or shadows. Its canvas is at most 104 × 104 pixels and only redraws when the bearing changes. It clears when the fare ends and works in the chase, first-person and overhead cameras.

## Tests

With the dev server running:

```sh
node scripts/hud-test.mjs
```

The HUD test runs at 320×568, 390×844, 568×320, 667×375, 844×390, 768×1024 and 1440×960. It checks for overlap, screen bounds, touch target sizes, map controls, pickups and drop-offs, urgent deadlines, no navigation before boarding, empty boost, large earnings, safe areas, pause and free drive. Screenshots and reports go to `.artifacts/hud/`.

These tests emulate touch in the browser, so the game still needs testing on real phones.
