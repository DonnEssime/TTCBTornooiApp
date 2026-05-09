import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      // Dev: compile library from source so `npm run dev` works without a prior root `build`.
      'ttc-tornooiapp': path.resolve(__dirname, '../src/index.ts'),
    },
  },
});
