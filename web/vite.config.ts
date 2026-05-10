import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { isWslWindowsDrvFsRepo, wslDevHints } from './vite-plugin-wsl-dev-hints';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const wslWindowsMount = isWslWindowsDrvFsRepo();

export default defineConfig({
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
    },
  },
});
