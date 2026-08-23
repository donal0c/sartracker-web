import { expect, test } from '@playwright/test'

test.describe('Stationary attention [DON-269]', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    await expect(page.getByTestId('app-title')).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15_000 })
    await page.getByTestId('mission-name-input').fill('Stationary Attention')
    await page.getByTestId('mission-start-btn').click()
  })

  test('highlights, acknowledges, and clears attention without hiding the current fix', async ({ page }) => {
    await inject(page, 52.0, 52.00001)
    await expect(page.getByTestId('stationary-attention-summary')).toContainText('1 device needs stationary attention')
    await page.getByTestId('open-devices-workspace').click()
    await expect(page.getByTestId('device-attention-alpha')).toContainText('Stationary Attention')
    await page.getByTestId('acknowledge-stationary-attention').click()
    await expect(page.getByTestId('device-attention-alpha')).toContainText('Acknowledged')

    await inject(page, 52.0, 52.001)
    await expect(page.getByTestId('stationary-attention-summary')).toHaveCount(0)
    await expect(page.getByTestId('device-attention-alpha')).toHaveCount(0)
  })
})

async function inject(page: import('@playwright/test').Page, firstLat: number, latestLat: number): Promise<void> {
  await page.evaluate(async ({ firstLat, latestLat }) => {
    const base = { device_id: 'alpha', lon: -9.7, altitude: null, speed: null, battery: null, accuracy: 4, source: 'osmand', data_origin: 'live' as const, cache_age_seconds: null, device_cache_stale: false }
    const first = { ...base, id: 'first', lat: firstLat, timestamp: '2026-08-22T10:00:00.000Z' }
    const latest = { ...base, id: 'latest', lat: latestLat, timestamp: '2026-08-22T10:20:00.000Z' }
    await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot({
      devices: [{ device_id: 'alpha', name: 'Alpha Team', status: 'online', last_seen: latest.timestamp, unique_id: null, category: 'person' }],
      positions: [latest], breadcrumbs: [first, latest],
    })
  }, { firstLat, latestLat })
}
