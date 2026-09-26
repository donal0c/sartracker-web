import { defineConfig } from '@playwright/test'
import base from '../../playwright.config'

export default defineConfig({
  ...base,
  testDir: '../../tests/e2e',
  outputDir: '../../test-results/pr54-ci-navigation',
  retries: 0,
  workers: 1,
  use: { ...base.use, trace: 'off', screenshot: 'off' },
  webServer: { ...base.webServer, reuseExistingServer: false, stdout: 'pipe', stderr: 'pipe' },
  projects: base.projects?.filter(project => project.name === 'chromium').map(project => ({
    ...project,
    testIgnore: ['**/visual/**', '**/electron/**', '**/ui-feedback-batch.spec.ts'],
  })),
})
