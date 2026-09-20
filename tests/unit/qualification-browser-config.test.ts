import { describe, expect, it } from 'vitest'
import { qualificationBrowserConfig } from '../../scripts/qualification/browser-suite-config.mjs'

describe('owned browser qualification configuration', () => {
  it('never reuses an unrelated server or retries a failed workflow and captures each rendered result', () => {
    const configured = qualificationBrowserConfig({ retries: 2, use: { baseURL: 'http://127.0.0.1:1420' },
      projects: [{ name: 'chromium', use: { screenshot: 'off' } }, { name: 'visual' }],
      webServer: { command: 'npm run dev', reuseExistingServer: true } }, '/checkout', '/owned/output')
    expect(configured).toMatchObject({ retries: 0, workers: 1, testDir: '/checkout/tests/e2e', outputDir: '/owned/output',
      use: { screenshot: 'on', trace: 'off' }, webServer: { reuseExistingServer: false, cwd: '/checkout' } })
    expect(configured.projects).toEqual([{ name: 'chromium', use: { screenshot: 'on', trace: 'off' }, retries: 0 }])
  })
  it('fails closed if the reviewed browser project is absent', () => {
    expect(() => qualificationBrowserConfig({ projects: [], webServer: {} }, '/checkout', '/owned')).toThrow(/chromium/iu)
  })
})
