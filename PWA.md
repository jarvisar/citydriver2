# Offline Installation

To install the game, open the pause menu and choose `Install Citydriver`. If your browser can't show an install prompt, the button shows instructions instead. On iPhone or iPad, tap `Share` in Safari, then `Add to Home Screen`.

Let the game load fully while online before playing offline. Hosting requires HTTPS, but localhost also works for testing.

## Testing Locally

```sh
npm run build
npm run preview
```

Open the preview URL and wait for the city to load before going offline. City generation, the garage, audio and rendering all work offline.

`npm run dev` shows the install help but doesn't register a service worker.

## Updates and Hosting

An open tab checks for a new version every 10 minutes and when it comes back into view. Once the update has downloaded, the title and pause screens show `Update available` with a `Reload` button. It never shows over a drive, and nothing reloads until you press it. Closing all game tabs also picks up the update. Old Citydriver caches in the same scope are removed.

Pressing `Reload` in one tab moves every open tab onto the new version, so the other tabs show the notice too. They should reload soon, since files only the old version used are gone from the cache.

The build also works from a subdirectory, for example:

```sh
npm run build -- --base=/citydriver2/
npm run preview
```

## Icons, Screenshots and Tests

```sh
npm run pwa:icons
npm run pwa:screenshots
npm run test:pwa
```

These generate the icons, capture desktop and mobile screenshots, and test installing, offline driving and cache updates from both the root and a subdirectory. Set `CHROME_PATH` if Chrome isn't in the default location.
