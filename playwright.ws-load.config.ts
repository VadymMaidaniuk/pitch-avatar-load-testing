import path from 'node:path';
import { defineConfig } from '@playwright/test';

// Workers re-evaluate this config: inherit one run ID from the parent process.
const runId = process.env.WS_LOAD_RUN_ID ??= new Date().toISOString().replace(/[:.]/g, '-') + `-${process.pid}`;
const outputRoot = path.join('test-results', 'ws-load', runId);

export default defineConfig({
  testDir: './tests/performance',
  testMatch: 'chat-avatar-ws-load.spec.ts',
  fullyParallel: false,
  workers: 1, // Concurrency is managed by sockets inside each scenario, not by workers.
  retries: 0,
  repeatEach: 1,
  outputDir: path.join(outputRoot, 'artifacts'),
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.join(outputRoot, 'html') }],
    ['json', { outputFile: path.join(outputRoot, 'playwright.json') }],
    ['./tests/helpers/wsLoadReporter.ts', { outputDir: outputRoot }],
  ],
  use: { trace: 'off', screenshot: 'off', video: 'off' },
});
