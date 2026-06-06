import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { isWslWindowsDrvFsRepo, wslDevHints } from './vite-plugin-wsl-dev-hints';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const buildInfoGenerated = path.resolve(__dirname, 'src/generated/build-info.json');
const buildInfoDefault = path.resolve(__dirname, 'src/generated/build-info.default.json');
const buildInfoPath = fs.existsSync(buildInfoGenerated) ? buildInfoGenerated : buildInfoDefault;

const wslWindowsMount = isWslWindowsDrvFsRepo();

export default defineConfig({
  base: '/TTCBTornooiApp/',
  plugins: [svelte(), wslDevHints()],
  /** Listen on all interfaces (required for LAN / Docker / WSL port forward), not loopback-only. */
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    ...(wslWindowsMount
      ? {
          watch: {
            usePolling: true,
            interval: 300,
          },
        }
      : {}),
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
  resolve: {
    alias: {
      // Dev: compile library from source so `npm run dev` works without a prior root `build`.
      'ttc-tornooiapp': path.resolve(__dirname, '../src/index.ts'),
      '@build-info': buildInfoPath,
    },
  },
});
