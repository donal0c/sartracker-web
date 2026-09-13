import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/** Isolates this repair's browser server from other active SAR worktrees. */
export default defineConfig(base, {
  testMatch: '**/war06-mission-scope.spec.ts',
  outputDir: 'test-results/war06-mission-scope',
  retries: 0,
  use: { ...base.use, baseURL: 'http://127.0.0.1:1437' },
  webServer: { command: 'npm run dev -- --port 1437', url: 'http://127.0.0.1:1437',
    reuseExistingServer: false, timeout: 120_000 },
})
