import { defineConfig } from 'vite';
import { citydriverPwa } from './scripts/pwa-plugin.mjs';

export default defineConfig({ plugins: [citydriverPwa()] });
