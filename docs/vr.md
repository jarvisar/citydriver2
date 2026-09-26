# VR

Citydriver uses WebXR for VR. **Enter VR** shows on the main menu and the pause menu when the browser supports `immersive-vr` on an HTTPS page. The desktop app doesn't offer VR.

The page's menus and HUD can't be seen in a headset, so `src/vr-status.js` draws its own on canvases in the scene. `src/main.js` describes them: `vrMenuModel` for the menus and `vrHudModel` for the HUD.

## Entering and Leaving

- In a headset's own browser (Meta Quest Browser, Pico, Wolvic) Enter VR is the first, yellow button on the main menu and the first row of the pause screen. Its controls use touch sizes of at least 44px. Without a gamepad the page can't be driven there.
- On a page that isn't HTTPS, a headset's browser shows a message saying that VR needs HTTPS.
- VR starts on a menu with the car standing still: the title menu, or the pause menu when Enter VR was chosen while paused. The shift clock doesn't run until the player starts or resumes.
- Exit VR is in the pause menu and on the results. Leaving VR pauses a drive, or goes back to the main menu.
- Holding the headset's Meta button to recenter also recenters the game.

## Menus

- Menus use the page's colors: slate panels, a yellow main action and a gold ring round the selected row. See [UI styles](ui-style.md).
- A menu opens 1.5 m away and 5° below eye level, in front of wherever the player is looking. It then stays in place. Menus are never locked to the head.
- Rows are about 2.6° tall and labels about 1.1°.
- The pause menu has the same groups as the pause screen: Driving, The city, View and Sound. Resume is at the top right and is selected first. Exit VR is at the bottom.
- The garage and taxi fleet list the page's own buttons in two columns under headings, with pages. The city map shows as a picture.
- Closing the map or a garage goes back to the row that opened it.
- While a menu is open each controller shows a short beam, with a dot where it points. Moving a pointer onto a row selects it. A pointer already resting on the panel when it opens doesn't change the selection. A trigger held when a menu opens has to be released before it can press anything.
- Hand tracking can point at menus and pinch to select. Driving needs controllers.

## HUD

- The HUD sits below the car, from 21° below eye level. It moves with the car like a dashboard and can't be pointed at.
- It shows the same text as the page's HUD. In a taxi run that is the shift clock, earnings, stage, destination, distance and fare clock. In free drive it is the heading, district and weather. Messages replace the last line for two seconds.
- During a fare a green arrow floats above the car and points to the drop-off. In first-person view it floats ahead of the car.
- The controls are listed under the HUD until the player has driven for 10 seconds.

## Comfort

- The camera follows the chase camera's position and heading only. Pitch and roll come from the headset, and there is no camera shake.
- The comfort vignette darkens the edge of the view when the camera turns faster than about 20° a second, or the car speeds up or slows down sharply. It keeps the middle of the view clear, fades once the turn ends and never shows in menus. It can be turned off in the pause menu. The setting is saved.

## Controls

See the [README](../README.md#vr). B and Y both pause, so no single button leaves VR. X in free drive puts the car back on the road instead of making a new city.

## Testing

- Run `npm run dev` and add `?xr` to the URL (`?xr=stereo` shows both eyes). This installs Meta's Immersive Web Emulation Runtime (IWER) as a Quest 3 and reports a Quest's user agent. It is only in development builds. `window.__xr` moves the headset and controllers, for example `__xr.controllers.right.updateButtonValue('trigger', 1)`.
- `node scripts/vr-review.mjs [output directory]` enters VR this way, steps through every menu and checks the game's state at each step. It saves the headset's view, a close-up at about a Quest 3's sharpness and each panel's canvas.
- `tests/xr.test.js` covers the controls, menu layout, pointing, rig and vignette.
