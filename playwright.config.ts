import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

const loadEnvFile = () => {
  const envName = process.env.CHAT_ENV || process.env.NODE_ENV;
  const candidates = [
    process.env.DOTENV_CONFIG_PATH,
    envName ? `.env.${envName}` : undefined,
    '.env',
  ].filter(Boolean) as string[];

  for (const rel of candidates) {
    const full = path.resolve(__dirname, rel);
    if (fs.existsSync(full)) {
      dotenv.config({ path: full });
      return full;
    }
  }
  return undefined;
};

loadEnvFile();

const envWorkers = (() => {
  const parsed = Number(process.env.CHAT_WORKERS);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return process.env.CI ? 1 : undefined;
})();

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/{api,e2e,ui}/**/*.spec.ts'],
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
