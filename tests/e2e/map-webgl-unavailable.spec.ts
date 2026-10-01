import { expect, test } from '@playwright/test'

// Chromium with WebGL switched off reproduces the blocklisted-GPU launch the
// test box showed without --ignore-gpu-blocklist: a blank window [DON-288].
test.use({ launchOptions: { args: ['--disable-webgl', '--disable-3d-apis'] } })

test('shows why the map is missing and keeps the shell usable when WebGL is unavailable [DON-288]', async ({ page }) => {
  await page.goto('/?missionHarness=1')
  await expect(page.getByTestId('app-title')).toContainText('SAR Tracker')

  const panel = page.getByTestId('map-renderer-unavailable')
  await expect(panel).toBeVisible({ timeout: 15_000 })
  await expect(panel).toContainText('The map cannot be shown')
  await expect(panel).toContainText('Tracking, devices and mission records still work')
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(0)

  // The rest of the shell still works without a map.
  await page.getByTestId('mission-name-input').fill('No WebGL mission')
  await expect(page.getByTestId('mission-name-input')).toHaveValue('No WebGL mission')
  await page.screenshot({ path: 'test-results/don-288-webgl-unavailable.png', fullPage: true })
})
