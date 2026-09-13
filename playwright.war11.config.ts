import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/** Runs deterministic offline-map regressions on an isolated browser server. */
export default defineConfig(base, {
  testMatch: ['**/official-map-qualification.spec.ts', '**/official-map-raster-freshness.spec.ts'],
  outputDir: 'test-results/war11-map-freshness',
  retries: 0,
  use: {...base.use, baseURL: 'http://127.0.0.1:1433', trace: 'on'},
  webServer: {command: 'npm run dev -- --port 1433', url: 'http://127.0.0.1:1433',
    reuseExistingServer: false, timeout: 120_000},
})
