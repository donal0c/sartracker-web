import { expect, test } from '@playwright/test'
import { captureAndRegister } from './helpers/verification-manifest'

for (const [width, height] of [[1280, 720], [1366, 768], [1440, 900], [1920, 1080]]) {
  test(`UI feedback Focus safety at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto('/?missionHarness=1')
    await page.getByTestId('mission-name-input').fill('Ridge search — team exercise')
    await page.getByTestId('mission-start-btn').click()
    await page.getByTestId('mission-control-collapse-btn').click()
    await page.getByTestId('focus-mode-toggle').click()
    if (width === 1366 || width === 1920) await page.getByTestId('theme-toggle').click()
    await page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__.injectTrackingSnapshot(
      { devices: [], positions: [], breadcrumbs: [] },
      { mode: 'offline', consecutiveFailures: 2, recovered: false, lastSuccessAt: '2026-09-09T08:00:00Z', warning: 'Connection lost. Retained positions may be stale.' },
    ))
    await expect(page.getByTestId('persistent-tracking-health')).toContainText('Disconnected')
    await expect(page.getByTestId('mission-control')).toBeHidden()
    await expect(page.getByTestId('map-scale-readout')).toBeVisible()
    await captureAndRegister(page, {
      testId: `ui-feedback-focus-${width}`, testName: `Focus safety ${width}x${height}`, area: 'app-shell', severity: 'critical',
      verificationPrompt: 'Check 1. Disconnected/retrying and last-success information are readable in the top strip. 2. Mission name/state, Active search, Review and Restore mission are readable. 3. No full Mission Control card is visible. 4. Tracking, Tools, Layers tabs and Layer Workspace are reachable and not overlapped by other controls. 5. Map scale and Focus Coordinates are both readable and do not overlap. 6. Secondary text and button labels are legible. Map tiles loading or unavailable are acceptable and are not a failure.',
      playwrightAssertions: ['disconnected status visible', 'full mission card hidden', 'scale visible'],
    })
    await page.getByTestId('layer-panel-toggle').click()
    await expect(page.getByTestId('focus-mode-sidebar')).toBeHidden()
    await captureAndRegister(page, {
      testId: `ui-feedback-collapsed-${width}`, testName: `Collapsed safety ${width}x${height}`, area: 'app-shell', severity: 'critical',
      verificationPrompt: 'Check 1. Right sidebar is absent and map uses its width. 2. Restore workspace and Exit Focus controls are visible and readable. 3. Disconnected tracking warning and last success remain visible. 4. Compact mission name/state, timer, Review and Restore mission remain visible. 5. Map scale and coordinates do not overlap. Loading/unavailable tiles are acceptable.',
      playwrightAssertions: ['sidebar hidden after Layer Collapse', 'tracking awareness outside sidebar'],
    })
  })
}
