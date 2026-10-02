import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Keep installation support independent of the scene and its HTML.
export function citydriverPwa() {
  let config;
  return {
    name: 'citydriver-pwa',
    configResolved(resolved) { config = resolved; },
    transformIndexHtml() {
      const base = config.base;
      return [
        { tag: 'link', attrs: { rel: 'manifest', href: `${base}manifest.webmanifest` } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', sizes: '180x180', href: `${base}icons/apple-touch-icon.png` } },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' } },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: 'Citydriver' } },
        ...(config.command === 'build' ? [{
          tag: 'script', attrs: { src: `${base}pwa-register.js`, defer: true }, injectTo: 'body',
        }] : []),
        {
          tag: 'script', attrs: { src: `${base}pwa-install.js`, defer: true }, injectTo: 'body',
        }, {
          tag: 'link', attrs: { rel: 'stylesheet', href: `${base}pwa-install.css` },
        },
      ];
    },
    async closeBundle() {
      if (config.command !== 'build') return;
      const outDir = path.resolve(config.root, config.build.outDir);
      const files = [];
      async function walk(directory, prefix = '') {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const name = `${prefix}${entry.name}`;
          if (entry.isDirectory()) await walk(path.join(directory, entry.name), `${name}/`);
          else if (name !== 'sw.js' && !name.endsWith('.map')) files.push(name);
        }
      }
      await walk(outDir);
      files.sort();
      const hash = createHash('sha256');
      for (const file of files) hash.update(file).update(await readFile(path.join(outDir, file)));
      const template = await readFile(new URL('./service-worker.js', import.meta.url), 'utf8');
      const version = hash.update(template).digest('hex').slice(0, 16);
      await writeFile(path.join(outDir, 'sw.js'), template
        .replace('__BUILD_VERSION__', JSON.stringify(version))
        .replace('__PRECACHE_FILES__', JSON.stringify(files)));
    },
  };
}
