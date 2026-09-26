// Development only: `npm run dev`, then `?xr` in the address. Meta's Immersive
// Web Emulation Runtime (IWER) stands in for a Quest 3, so Enter VR, the
// headset's menus and its HUD can be checked on a desktop. It draws one eye
// across the page; `?xr=stereo` draws both side by side. Scripts move its
// head and controllers through `window.__xr`: `.quaternion`, `.position`,
// `controllers.right.updateButtonValue('trigger', 1)`, `updateAxes(...)`.
// It also reports a Quest's user agent. main.js imports this only when
// `import.meta.env.DEV`, so builds leave it out.
import { XRDevice, metaQuest3 } from 'iwer';

export function installXREmulator(mode) {
  const device = new XRDevice(metaQuest3, { stereoEnabled: mode === 'stereo' });
  // The desktop browser has a WebXR runtime of its own, usually with no headset.
  device.installRuntime({ forceInstall: true });
  window.__xr = device;
  return device;
}
