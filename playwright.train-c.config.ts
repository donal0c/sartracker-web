import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/** Isolates the map repair regressions from other local validation servers. */
export default defineConfig(base, {
  testMatch: ['**/map-idle-redraw.spec.ts', '**/map-navigation-recovery.spec.ts'],
  outputDir: 'test-results/train-c',
  retries: 0,
  use: { ...base.use, baseURL: 'http://127.0.0.1:1435', trace: 'on' },
  webServer: {
    command: 'npm run dev -- --port 1435', url: 'http://127.0.0.1:1435',
    reuseExistingServer: false, timeout: 120_000,
  },
})
