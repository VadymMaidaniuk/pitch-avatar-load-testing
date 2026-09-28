import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/local',
  testMatch: 'ws-load.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: 'list',
  outputDir: 'test-results/ws-load-local',
});
