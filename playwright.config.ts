import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

// Load env file before reading process.env. Priority:
// 1) DOTENV_CONFIG_PATH
// 2) .env.<CHAT_ENV>
// 3) .env
(function loadEnv() {
  const cwd = __dirname;
  const envName = process.env.CHAT_ENV || process.env.NODE_ENV;
  const candidates = [
    process.env.DOTENV_CONFIG_PATH,
    envName ? `.env.${envName}` : undefined,
    '.env',
  ].filter(Boolean) as string[];

  for (const rel of candidates) {
    const full = path.resolve(cwd, rel);
    if (fs.existsSync(full)) {
      dotenv.config({ path: full });
      break;
    }
  }
})();

const envWorkers = (() => {
  const raw = process.env.CHAT_WORKERS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return process.env.CI ? 1 : undefined;
})();

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: envWorkers,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
