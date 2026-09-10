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

  test('keeps an out-and-back route clear and raises a new warning only after a stationary interval [AUD-02]', async ({ page }) => {
    /** Publishes immutable route fixtures through the supported browser harness. */
    const route = async (settled: boolean): Promise<void> => {
      await page.evaluate(async (settled) => {
        const legs = [[0, 0], [5, 100], [10, 200], [15, 100], [20, 0], ...(settled ? [[40, 0]] : [])]
        const breadcrumbs = legs.map(([minutes, metres], index) => ({
          id: `route-${index}`, device_id: 'alpha', lat: 52 + metres! / 111195, lon: -9.7,
          timestamp: new Date(Date.parse('2026-08-22T10:00:00Z') + minutes! * 60000).toISOString(),
          altitude: null, speed: null, battery: null, accuracy: 4, source: 'osmand',
          data_origin: 'live' as const, cache_age_seconds: null, device_cache_stale: false,
        }))
        await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot({
          devices: [{ device_id: 'alpha', name: 'Alpha Team', status: 'online',
            last_seen: breadcrumbs.at(-1)!.timestamp, unique_id: null, category: 'person' }],
          breadcrumbs, positions: [breadcrumbs.at(-1)!],
        })
      }, settled)
    }
    await route(false)
    await expect(page.getByTestId('stationary-attention-summary')).toHaveCount(0)
    await page.getByTestId('open-devices-workspace').click()
    await expect(page.getByTestId('device-attention-alpha')).toHaveCount(0)
    await page.screenshot({ path: 'output/repair-train-a/stationary-route-clear.png' })
    await route(true)
    await expect(page.getByTestId('device-attention-alpha')).toContainText('Stationary Attention')
    await page.screenshot({ path: 'output/repair-train-a/stationary-new-episode.png' })
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
