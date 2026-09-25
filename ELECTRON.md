# Desktop App

The desktop app is built with Electron. It runs the same build as the website and keeps its saves separate from the browser.

## Running Locally

```sh
npm install
npm run electron:dev
```

Use `npm run electron:start` to build and run the production version.

The app starts in fullscreen. Press F, F11 or Alt+Enter to toggle it. Escape pauses.

Launch flags: `--windowed`, `--fullscreen`, `--seed=4817`, `--devtools`, `--software-gl` and `--dev-url=http://127.0.0.1:5173`.

Environment variables: `CITYDRIVER_DEV_URL`, `CITYDRIVER_DEVTOOLS`, `CITYDRIVER_SOFTWARE_GL`, `CITYDRIVER_FULLSCREEN` and `CITYDRIVER_USER_DATA`.

## Building

```sh
npm run electron:pack
npm run electron:build:win
npm run electron:build:linux
npm run electron:build:mac
```

Each platform has to be built on that platform. Builds go to `release/`:

- Windows: installer and portable EXE
- Linux: AppImage (make it executable before running it)
- macOS: DMG and ZIP

The builds are not code-signed. Run `npm run electron:icons` after changing `public/favicon.svg`.

## Tests

```sh
npm run test:electron -- --build
npm run test:electron -- --packaged
```

Checks startup, driving, settings, fullscreen, and that the browser-only install button is hidden. Reports go to `.artifacts/electron/`.

## Releases

After committing, create and push a version tag:

```sh
npm version patch
git push --follow-tags
```

Pushing a `v*` tag runs the **Build Citydriver desktop** workflow. Once the builds finish, the packages are published under **Releases**. Existing tags won't rebuild automatically.

Manual workflow runs and local builds don't publish a release. The app doesn't update itself.
