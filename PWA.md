# Offline installation

Open the pause menu and choose **Install Citydriver**. If your browser can't show an install prompt, the button displays instructions. On iPhone or iPad, use Safari's **Share → Add to Home Screen**.

Load the game fully while online before playing offline. Hosting requires HTTPS; localhost also works.

## Test locally

```sh
npm run build
npm run preview
```

Open the preview URL and wait for the city to load before disconnecting. City generation, the garage, audio, and rendering work offline.

`npm run dev` shows install help but doesn't register a service worker.

## Updates and hosting

Close all game tabs to let a downloaded update take effect. Old Citydriver caches are removed within the same scope.

The build supports subdirectories. To match GitHub Pages:

```sh
npm run build -- --base=/citydriver2/
npm run preview
```

## Assets and tests

```sh
npm run pwa:icons
npm run pwa:screenshots
npm run test:pwa
```

These commands generate icons, capture desktop/mobile screenshots, and test installation, offline driving, and cache updates at root and subdirectory URLs. Set `CHROME_PATH` if Chrome is outside the default location.
