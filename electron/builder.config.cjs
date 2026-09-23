// electron-builder configuration.
// Name and description come from the web app's own metadata so the
// desktop packages follow the web app without a second copy to maintain.
const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const { Arch } = require('electron-builder');

const root = path.join(__dirname, '..');
const read = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const manifest = read('public/manifest.webmanifest');
const pkg = read('package.json');
const productName = manifest.short_name;
const executableName = pkg.name;

// By default electron-builder extracts the Electron zip into release/<target>.tmp
// and renames it. On Windows, antivirus or search indexing can hold files in a
// freshly extracted tree open and that rename fails with EPERM (persistently on
// some machines). Windows hosts therefore stage Electron by copying an already
// unpacked distribution: node_modules/electron/dist for Windows targets, and a
// cached extraction of the official zip (same version) for other targets.
// Other hosts, including CI, use electron-builder's default flow.
async function electronDist({ platformName, arch, version }) {
  if (process.platform !== 'win32') return undefined;
  const archName = typeof arch === 'number' ? Arch[arch] : String(arch); // enum in some hooks, name in others
  const local = path.join(root, 'node_modules', 'electron', 'dist');
  if (platformName === 'win32' && archName === process.arch && existsSync(path.join(local, 'electron.exe'))) return local;
  const electronVersion = version ?? require('electron/package.json').version;
  const name = `electron-v${electronVersion}-${platformName}-${archName}`;
  const cacheRoot = path.resolve(root, 'node_modules', '.cache', 'citydriver-electron');
  const out = path.resolve(cacheRoot, name);
  if (path.dirname(out) !== cacheRoot) throw new Error('Electron cache target must stay inside this project');
  try {
    if (!existsSync(path.join(out, 'version'))) {
      const { downloadArtifact } = require('@electron/get'); // Electron's own downloader and cache
      const zip = await downloadArtifact({ version: electronVersion, platform: platformName, arch: archName, artifactName: 'electron' });
      rmSync(out, { recursive: true, force: true });
      mkdirSync(out, { recursive: true });
      // Windows ships bsdtar, which reads zip files; the GNU tar on a Git Bash PATH does not.
      const bsdtar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
      execFileSync(existsSync(bsdtar) ? bsdtar : 'tar', ['-xf', zip, '-C', out], { stdio: 'inherit' });
    }
    return out;
  } catch (error) {
    console.warn(`Could not stage ${name} by copying (${error.message}); using electron-builder's default flow.`);
    return undefined;
  }
}

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'games.citydriver.desktop',
  productName,
  copyright: `Copyright Â© ${new Date().getFullYear()} jarvisar`,
  extraMetadata: {
    // Written into the packaged package.json only; the repository's stays untouched.
    description: manifest.description,
    author: { name: 'jarvisar' },
    // Electron reads desktopName at startup so Linux desktops can match the window to its launcher.
    desktopName: `${executableName}.desktop`,
  },
  directories: { buildResources: 'electron/build', output: 'release' },
  electronDist,
  // The renderer is bundled by Vite; the desktop shell has no runtime packages.
  files: [
    'electron/main.js',
    'electron/preload.cjs',
    'electron/window-state.js',
    'electron/build/icon.png',
    'dist-electron/**/*',
    ...Object.keys(pkg.dependencies).map(name => `!node_modules/${name}/**`),
  ],
  asar: true,
  npmRebuild: false,
  nodeGypRebuild: false,
  // GitHub Actions attaches packages to releases; electron-builder only builds them.
  publish: null,
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',

  win: {
    target: [{ target: 'nsis', arch: ['x64'] }, { target: 'portable', arch: ['x64'] }],
    // Unsigned: SmartScreen shows a "Windows protected your PC" notice on first run.
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    shortcutName: productName,
    artifactName: '${productName}-${version}-${os}-${arch}-setup.${ext}',
  },
  portable: { artifactName: '${productName}-${version}-${os}-${arch}-portable.${ext}' },

  linux: {
    target: [{ target: 'AppImage', arch: ['x64'] }],
    executableName,
    syncDesktopName: true,
    category: 'Game',
    synopsis: 'Arcade taxi driving',
    description: manifest.description,
    desktop: { entry: { Name: productName, Keywords: 'driving;city;procedural;game;', StartupWMClass: executableName } },
  },

  mac: {
    target: [{ target: 'dmg', arch: ['x64', 'arm64'] }, { target: 'zip', arch: ['x64', 'arm64'] }],
    category: 'public.app-category.games',
    // Unsigned and not notarized: Gatekeeper requires right-click > Open, or `xattr -cr`.
    identity: null,
    hardenedRuntime: false,
    gatekeeperAssess: false,
    darkModeSupport: true,
  },
  dmg: { title: productName },
};
