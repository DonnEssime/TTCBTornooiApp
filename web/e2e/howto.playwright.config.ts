import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');

/** Dedicated config for regenerating docs/howto screenshots + PDF (not part of CI e2e). */
export default defineConfig({
  testDir: path.join(__dirname, 'scripts'),
  testMatch: /capture-howto\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173/TTCBTornooiApp/',
    viewport: { width: 1280, height: 800 },
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    cwd: webRoot,
    url: 'http://127.0.0.1:5173/TTCBTornooiApp/',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...process.env, VITE_E2E: 'true' },
  },
});
