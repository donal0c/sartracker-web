import { expect, test, type Page } from '@playwright/test'

import { installTrackingErrorCapture, readTrackingSourceInPage } from '../../scripts/war06-surface-observation.mjs'

type ProbeWindow = Window & {
  __SARTRACKER_TRACKING_VISIBLE__?: boolean
  __SARTRACKER_MAP__?: { getSource: (id: string) => { fire: (event: unknown) => void } | undefined }
}

async function openHarness(page: Page) {
  await page.goto('/?missionHarness=1&missionModel=1')
  await page.getByTestId('app-title').waitFor({ state: 'visible', timeout: 15_000 })
}

/**
 * DON-353: the packaged WAR-06 probe only accepts a zero on the map as proof
 * when the renderer reports tracking shown, because hidden tracking feeds the
 * map an empty snapshot, and only on a map it watched for source errors from
 * the moment the map was published.
 */
test('the map reports tracking shown, so a watched tracking source reading is ready [DON-353]', async ({ page }) => {
  await page.addInitScript(installTrackingErrorCapture)
  await openHarness(page)
  await expect.poll(() => page.evaluate(() => (window as ProbeWindow).__SARTRACKER_TRACKING_VISIBLE__), { timeout: 15_000 }).toBe(true)
  await expect.poll(async () => (await page.evaluate(readTrackingSourceInPage)).state, { timeout: 15_000 }).toBe('ready')
})

test('an error from the real tracking source fails every later reading [DON-353]', async ({ page }) => {
  await page.addInitScript(installTrackingErrorCapture)
  await openHarness(page)
  await expect.poll(async () => (await page.evaluate(readTrackingSourceInPage)).state, { timeout: 15_000 }).toBe('ready')
  // As MapLibre does when its worker rejects an update: the source fires an
  // error event, which bubbles to the map with sourceId 'tracking'.
  await page.evaluate(() => (window as ProbeWindow).__SARTRACKER_MAP__?.getSource('tracking')?.fire({ type: 'error', error: new Error('worker rejected the update') }))
  expect(await page.evaluate(readTrackingSourceInPage)).toMatchObject({ state: 'failed', reason: expect.stringContaining('worker rejected the update') })
})

test('without the capture installed first, a reading is never ready [DON-353]', async ({ page }) => {
  await openHarness(page)
  await expect.poll(() => page.evaluate(() => (window as ProbeWindow).__SARTRACKER_TRACKING_VISIBLE__), { timeout: 15_000 }).toBe(true)
  await page.evaluate(installTrackingErrorCapture)
  expect((await page.evaluate(readTrackingSourceInPage)).state).toBe('uncaptured')
})
