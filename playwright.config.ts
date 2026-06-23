import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  // Shared CI runners are heavily contended: the full suite takes 6-8min there
  // vs ~2min locally, and running heavy map/tracking specs concurrently starves
  // them enough to flake on timing (not on correctness — they pass in isolation
  // and locally). Serialize to one worker on CI to remove cross-spec contention,
  // and keep two workers locally for speed.
  workers: process.env.CI ? 1 : 2,
  // Retries are a backstop for transient CI infrastructure races (e.g. a
  // navigation destroying an evaluate context under load); a genuinely broken
  // test still fails all attempts. Local runs stay strict at zero retries.
  // `trace: 'on-first-retry'` below captures a trace when a retry happens.
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://127.0.0.1:1420',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: true,
    timeout: 120000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: '**/visual/**',
    },
    {
      name: 'visual',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        screenshot: 'on',
      },
      testMatch: '**/visual/**/*.spec.ts',
    },
  ],
})
