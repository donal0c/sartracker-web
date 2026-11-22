import { expect, test, type Page } from '@playwright/test'
import { openDevicesWorkspace, openMissionPanel } from '../helpers/workspace-panels'
import { captureAndRegister } from './helpers/verification-manifest'

for (const [width, height] of [[1280, 720], [1366, 768], [1440, 900], [1920, 1080]]) {
  test(`Devices controls at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto('/?missionHarness=1')
    await openMissionPanel(page)
    await page.getByTestId('mission-name-input').fill('Devices layout exercise')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')
    if (width === 1366 || width === 1920) await switchTheme(page)
    await page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__.injectTrackingSnapshot({
      devices: [{ device_id: 'alpha', name: 'Alpha Team — West Ridge', status: 'online', last_seen: new Date().toISOString(), unique_id: null, category: 'person' }],
      positions: [{ id: 'alpha-fix', device_id: 'alpha', lat: 52, lon: -9.7, altitude: null, speed: null, battery: null, accuracy: null, timestamp: new Date().toISOString(), source: 'gps', data_origin: 'live', cache_age_seconds: null, device_cache_stale: false }], breadcrumbs: [],
    }))
    await openDevicesWorkspace(page)
    await page.getByTestId('device-zoom-alpha').scrollIntoViewIfNeeded()
    await expect(page.getByTestId('device-zoom-alpha')).toBeEnabled()
    await captureAndRegister(page, {
      testId: `ui-feedback-devices-${width}`, testName: `Devices ${width}x${height}`, area: 'tracking', severity: 'critical',
      verificationPrompt: 'Check 1. Tracking Devices title, Reconnect and Close are readable. 2. Row Zoom action is fully visible after intentional horizontal scrolling. Leftmost columns may be scrolled away. 3. Selected device inspector text and its Zoom To Device action are readable without clipping against the list. 4. Operational secondary labels and selection are distinguishable. 5. Scroll areas are intentional rather than controls being painted over one another.',
      playwrightAssertions: ['row zoom enabled and scrolled into view'],
    })
  })
}

/** Switches light and dark from the top bar's More menu (DON-341). */
async function switchTheme(page: Page): Promise<void> {
  await page.getByTestId('ws-more-button').click()
  await page.getByTestId('theme-toggle').click()
  await page.getByTestId('ws-more-button').click()
  await expect(page.getByTestId('ws-more-menu')).toBeHidden()
}
