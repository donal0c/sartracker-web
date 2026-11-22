import { expect, test, type Page } from '@playwright/test'

import { openMissionPanel } from '../helpers/workspace-panels'
import { captureAndRegister } from './helpers/verification-manifest'

// Was "Focus safety": Focus Mode and the collapsed rail are gone in the new
// layout (DON-341). The same safety question remains: with tracking lost, the
// warning, the mission and the map's scale must all stay readable at every
// team screen size.
for (const [width, height] of [[1280, 720], [1366, 768], [1440, 900], [1920, 1080]]) {
  test(`UI feedback top-bar safety at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto('/?missionHarness=1')
    await openMissionPanel(page)
    await page.getByTestId('mission-name-input').fill('Ridge search — team exercise')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')
    if (width === 1366 || width === 1920) await switchTheme(page)
    await page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__.injectTrackingSnapshot(
      { devices: [], positions: [], breadcrumbs: [] },
      { mode: 'offline', consecutiveFailures: 2, recovered: false, lastSuccessAt: '2026-09-09T08:00:00Z', warning: 'Connection lost. Retained positions may be stale.' },
    ))
    await expect(page.getByTestId('ws-alarm')).toContainText('TRACKING LOST')
    await expect(page.getByTestId('ws-tracking-headline')).toBeVisible()
    await expect(page.getByTestId('mission-control')).toBeHidden()
    await expect(page.getByTestId('map-scale-readout')).toBeVisible()
    await captureAndRegister(page, {
      testId: `ui-feedback-top-bar-${width}`, testName: `Top-bar safety ${width}x${height}`, area: 'app-shell', severity: 'critical',
      verificationPrompt: 'Check 1. A red TRACKING LOST alarm strip across the map is readable and says what to do. 2. The top bar names the mission "Ridge search — team exercise" and shows it is running, with readable timers. 3. The tracking line in the top bar reads as lost tracking, in whole words, not cut mid-word. 4. The People, Layers, Full map, Settings and More buttons are readable and not overlapped. 5. The People panel may be open beside the map after Start; it must not cover the alarm. 6. The map scale and coordinates are readable and do not overlap the alarm. Map tiles loading or unavailable are acceptable and are not a failure.',
      playwrightAssertions: ['TRACKING LOST alarm visible', 'tracking headline visible', 'mission panel closed', 'scale visible'],
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
