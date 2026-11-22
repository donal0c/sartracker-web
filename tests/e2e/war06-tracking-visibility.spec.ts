import { expect, test } from '@playwright/test'

import { readTrackingSourceInPage } from '../../scripts/war06-surface-observation.mjs'

/**
 * DON-353: the packaged WAR-06 probe only accepts a zero on the map as proof
 * when the renderer reports tracking shown, because hidden tracking feeds the
 * map an empty snapshot. The renderer must report it once the map draws.
 */
test('the map reports tracking shown, so a tracking source reading is ready [DON-353]', async ({ page }) => {
  await page.goto('/?missionHarness=1&missionModel=1')
  await page.getByTestId('app-title').waitFor({ state: 'visible', timeout: 15_000 })
  await expect.poll(() => page.evaluate(() =>
    (window as Window & { __SARTRACKER_TRACKING_VISIBLE__?: boolean }).__SARTRACKER_TRACKING_VISIBLE__), { timeout: 15_000 }).toBe(true)
  await expect.poll(async () => (await page.evaluate(readTrackingSourceInPage)).state, { timeout: 15_000 }).toBe('ready')
})
