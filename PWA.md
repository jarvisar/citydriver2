# Offline Installation

To install the game, open the pause menu and choose **Install Citydriver**. If your browser can't show an install prompt, the button shows instructions instead. On iPhone or iPad, use **Share → Add to Home Screen** in Safari.

Let the game load fully while online before playing offline. Hosting requires HTTPS, but localhost also works for testing.

## Testing Locally

```sh
npm run build
npm run preview
```

Open the preview URL and wait for the city to load before going offline. City generation, the garage, audio and rendering all work offline.

`npm run dev` shows the install help but doesn't register a service worker.

## Updates and Hosting

Close all game tabs for a downloaded update to take effect. Old Citydriver caches in the same scope are removed.

The build works from a subdirectory. To match GitHub Pages:

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
