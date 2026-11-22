import { expect, test, type Page } from '@playwright/test'

import { openMissionPanel } from './helpers/workspace-panels'

type HarnessWindow = Window & {
  __SARTRACKER_BROWSER_HARNESS__?: {
    injectTrackingSnapshot: (snapshot: unknown) => Promise<void>
  }
  __SARTRACKER_MAP__?: {
    getSource: (id: string) => (Record<string, unknown> & { fire: (event: unknown) => void }) | undefined
  }
  __DON357_RESTORE__?: () => void
}

/** Sends one fresh fix for one person through the harness, as a poll would. */
async function injectFix(page: Page, minute: number) {
  await page.evaluate(async (fixMinute) => {
    const timestamp = new Date(Date.now() - 60_000 + fixMinute * 1_000).toISOString()
    await (window as HarnessWindow).__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot({
      devices: [{ device_id: 'alpha', name: 'Alpha Team', status: 'online', last_seen: timestamp, unique_id: null, category: null }],
      positions: [{
        id: `alpha-${fixMinute}`, device_id: 'alpha', lat: 52.1 + fixMinute * 0.0005, lon: -9.7, altitude: null, speed: null,
        battery: null, accuracy: 4, timestamp, source: 'osmand', data_origin: 'live', cache_age_seconds: null, device_cache_stale: false,
      }],
      breadcrumbs: [],
    })
  }, minute)
}

/**
 * DON-357: when MapLibre's worker rejects a tracking update, the map keeps the
 * old positions and only the source fires an error. The operator must see the
 * alarm, it must stay while updates keep failing, and it clears only once the
 * map draws a later update.
 */
test('a rejected tracking map update raises the alarm until a later update is drawn [DON-357]', async ({ page }) => {
  await page.goto('/?missionHarness=1')
  await page.getByTestId('app-title').waitFor({ state: 'visible', timeout: 15_000 })
  await page.waitForSelector('canvas', { timeout: 15_000 })
  await openMissionPanel(page)
  await page.getByTestId('mission-name-input').fill('Map Update Mission')
  await page.getByTestId('mission-start-btn').click()
  await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'active')
  await injectFix(page, 0)
  await expect.poll(() => page.evaluate(() => (window as HarnessWindow).__SARTRACKER_MAP__?.getSource('tracking') !== undefined), { timeout: 15_000 }).toBe(true)
  await expect(page.getByTestId('ws-alarm')).toHaveCount(0)

  // As MapLibre does when its worker rejects every update: each dispatch
  // starts, then the source fires an error and keeps its old data.
  await page.evaluate(() => {
    const source = (window as HarnessWindow).__SARTRACKER_MAP__?.getSource('tracking')
    if (source === undefined) throw new Error('No tracking source')
    const original = { setData: source.setData, updateData: source.updateData }
    const reject = function (this: typeof source) {
      this.fire({ type: 'dataloading', dataType: 'source' })
      queueMicrotask(() => this.fire({ type: 'error', error: new Error('worker rejected the update') }))
      return this
    }
    source.setData = reject
    source.updateData = reject
    ;(window as HarnessWindow).__DON357_RESTORE__ = () => {
      source.setData = original.setData
      source.updateData = original.updateData
    }
  })
  await injectFix(page, 1)

  const alarm = page.getByTestId('ws-alarm')
  await expect(alarm).toContainText('MAP NOT UPDATING')
  await expect(alarm).toContainText('out of date')
  await expect(page.getByTestId('ws-tracking-headline')).toHaveAttribute('data-condition', 'map')

  // The automatic resend is rejected too, and a later poll changes nothing:
  // the alarm stays.
  await injectFix(page, 2)
  await page.waitForTimeout(500)
  await expect(alarm).toContainText('MAP NOT UPDATING')

  // The map accepts updates again; the next poll is drawn in full and clears it.
  await page.evaluate(() => (window as HarnessWindow).__DON357_RESTORE__?.())
  await injectFix(page, 3)
  await expect(alarm).toHaveCount(0)
})
