import { defineConfig } from '@playwright/test'

// Exposed GC is confined to this app-free browser process, never the SAR app.
export default defineConfig({
  testDir: './tests/browser-driver',
  outputDir: 'test-results/browser-driver',
  // The subsequent default E2E run clears test-results; keep the receipt outside it.
  reporter: [['list'], ['json', { outputFile: 'tmp/browser-driver/report.json' }]],
  workers: 1,
  retries: 0,
  timeout: 30_000,
  forbidOnly: true,
  use: {
    browserName: 'chromium',
    launchOptions: { args: ['--js-flags=--expose-gc'] },
  },
})
