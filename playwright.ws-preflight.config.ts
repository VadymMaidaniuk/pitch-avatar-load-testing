import path from 'node:path';
import { defineConfig } from '@playwright/test';

const runId = process.env.WS_PREFLIGHT_RUN_ID ??= new Date().toISOString().replace(/[:.]/g, '-') + `-${process.pid}`;
export default defineConfig({
  testDir: './tests/performance',
  testMatch: 'chat-avatar-ws-preflight.spec.ts',
  workers: 1, retries: 0, repeatEach: 1, fullyParallel: false,
  outputDir: path.join('test-results', 'ws-preflight', runId),
  reporter: 'list',
  use: { trace: 'off', screenshot: 'off', video: 'off' },
});
