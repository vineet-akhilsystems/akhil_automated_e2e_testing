import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';
import 'dotenv/config';
import { moduleDir } from './tests/shared/module-paths';

export const STORAGE_STATE = `${process.env.AUTH_DIR ?? '.auth'}/admin.json`;
// Before the first `npm run auth` the file is missing; tests/fixtures/auth.ts then explains what to run.
const storageState = fs.existsSync(STORAGE_STATE) ? STORAGE_STATE : undefined;

export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.ts',
  // The demo backend is slow; pincode lookups and saves can take several seconds.
  // PORTAL_CASE_TIMEOUT_MS (set by the portal queue) caps each case; a stuck case fails alone instead of stalling its shard.
  timeout: Number(process.env.PORTAL_CASE_TIMEOUT_MS) || 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  // The portal parallelises with one process per independent case group (PORTAL_WORKERS) and passes --workers=1 to each;
  // within a process cases stay serial because registration cases share per-run files and the demo backend is slow.
  workers: 1,
  retries: 0,
  reporter: process.env.PORTAL_AUTH_RUN ? [['dot']] : [['list'], ['html', { open: 'never' }],
    // Registration-only summary/UHID reporter: skipped when the portal runs another module (PORTAL_MODULE_ID); unset keeps `npm run reg:*` behaviour.
    ...(!process.env.PORTAL_MODULE_ID || process.env.PORTAL_MODULE_ID === 'registration' ? [[`./${moduleDir('tests', 'registration')}/results-reporter.ts`] as [string]] : []),
    ...(process.env.PORTAL_RUN_DIR ? [['./portal/reporter.cjs'] as [string]] : [])],
  use: {
    baseURL: process.env.BASE_URL ?? 'https://demo.augastam.com',
    viewport: { width: 1600, height: 900 },
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    trace: process.env.PORTAL_AUTH_RUN ? 'off' : 'retain-on-failure',
    screenshot: process.env.PORTAL_AUTH_RUN ? 'off' : process.env.PORTAL_RUN_DIR ? { mode: 'on', fullPage: true } : 'only-on-failure',
    // Recording every test costs memory (a full run was killed for low memory); traces already hold a screencast.
    video: process.env.VIDEO ? 'retain-on-failure' : 'off',
    // SLOWMO=500 npm run test:headed  -> watch each step happen
    launchOptions: { slowMo: Number(process.env.SLOWMO ?? 0) },
  },
  projects: [
    // Listed first: the Playwright test agents (MCP server) use the first project as primary.
    {
      name: 'chromium',
      testIgnore: [/auth\.setup\.ts/, /discovery[\\/]module-discovery\.spec\.ts/],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 }, storageState },
    },
    // Generic read-only module discovery (needs MODULE_ID / MODULE_URL): run via `npm run module:discover`, never by `npm test`.
    {
      name: 'discovery',
      testMatch: /discovery[\\/]module-discovery\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 }, storageState },
    },
    // Logs in once and saves the session. Run with `npm run auth` when the session expires.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
  ],
});
