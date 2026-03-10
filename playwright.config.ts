import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

const loadEnvFiles = () => {
  // Explicit path has the highest priority and preserves current scripts behavior.
  const explicitPath = process.env.DOTENV_CONFIG_PATH;
  if (explicitPath) {
    const full = path.resolve(__dirname, explicitPath);
    if (fs.existsSync(full)) {
      dotenv.config({ path: full });
      return;
    }
  }

  const baseEnvPath = path.resolve(__dirname, '.env');
  if (fs.existsSync(baseEnvPath)) {
    dotenv.config({ path: baseEnvPath });
  }

  const envName = (process.env.CHAT_ENV || process.env.NODE_ENV || '').trim();
  if (!envName) return;

  const scopedEnvPath = path.resolve(__dirname, `.env.${envName}`);
  if (fs.existsSync(scopedEnvPath)) {
    dotenv.config({ path: scopedEnvPath, override: true });
  }
};

loadEnvFiles();

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/{api,e2e,ui}/**/*.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
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
