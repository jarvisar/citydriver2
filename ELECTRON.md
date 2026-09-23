# Desktop app

The Electron app runs the browser build locally at `app://citydriver/` and stores saves separately from the browser.

## Run locally

```sh
npm install
npm run electron:dev
```

Use `npm run electron:start` to build and run the production version.

Fullscreen is the default. Press F, F11, or Alt+Enter to toggle it; Escape pauses.

Launch flags: `--windowed`, `--fullscreen`, `--seed=4817`, `--devtools`, `--software-gl`, and `--dev-url=http://127.0.0.1:5173`.

Environment variables: `CITYDRIVER_DEV_URL`, `CITYDRIVER_DEVTOOLS`, `CITYDRIVER_SOFTWARE_GL`, `CITYDRIVER_FULLSCREEN`, and `CITYDRIVER_USER_DATA`.

## Build

```sh
npm run electron:pack
npm run electron:build:win
npm run electron:build:linux
npm run electron:build:mac
```

Build on the target platform. Output goes to `release/`: installer and portable EXE for Windows, AppImage for Linux, and DMG/ZIP for macOS. Builds are unsigned. On Linux, make the AppImage executable before launching.

Run `npm run electron:icons` after changing `public/favicon.svg`.

## Tests

```sh
npm run test:electron -- --build
npm run test:electron -- --packaged
```

Checks startup, driving, settings, fullscreen, and browser-only install UI. Reports go to `.artifacts/electron/`.

## Releases

After committing your changes, create and push a version tag:

```sh
npm version patch
git push --follow-tags
```

The `v*` tag triggers **Build Citydriver desktop** in GitHub Actions. Once all builds finish, packages appear under **Releases**. The tag must contain the release workflow; existing tags won't rebuild automatically.

Manual workflow runs upload Actions artifacts. Local builds write files to `release/`. Neither publishes a release. The app has no automatic updater.
