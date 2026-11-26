import { expect, test } from '@playwright/test'
import { openMissionPanel, openWorkspacePanel, openDevicesWorkspace } from './helpers/workspace-panels'

test.describe('Stationary attention [DON-269]', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    await expect(page.getByTestId('app-title')).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15_000 })
    await openMissionPanel(page)
    await page.getByTestId('mission-name-input').fill('Stationary Attention')
    await page.getByTestId('mission-start-btn').click()
  })

  test('highlights, acknowledges, and clears attention without hiding the current fix', async ({ page }) => {
    await inject(page, 52.0, 52.00001)
    await openWorkspacePanel(page, 'tracking')
    // Was the Tracking tab's stationary summary; the Tracking panel lists it (DON-341).
    await expect(page.getByTestId('ws-tracking-happened')).toContainText('1 person not moving')
    await openDevicesWorkspace(page)
    await expect(page.getByTestId('device-attention-alpha')).toContainText('Stationary Attention')
    await page.getByTestId('acknowledge-stationary-attention').click()
    await expect(page.getByTestId('device-attention-alpha')).toContainText('Acknowledged')

    await inject(page, 52.0, 52.001)
    await expect(page.getByTestId('ws-tracking-headline')).not.toContainText('not moving')
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
    await openWorkspacePanel(page, 'tracking')
    await expect(page.getByTestId('ws-tracking-headline')).not.toContainText('not moving')
    await openDevicesWorkspace(page)
    await expect(page.getByTestId('device-attention-alpha')).toHaveCount(0)
    await page.screenshot({ path: 'output/repair-train-a/stationary-route-clear.png' })
    await route(true)
    await expect(page.getByTestId('device-attention-alpha')).toContainText('Stationary Attention')
    await page.screenshot({ path: 'output/repair-train-a/stationary-new-episode.png' })
  })

  test('preserves acknowledged duration through one ordinary noise fix and return [A-R15]', async ({ page }) => {
    /** Injects one immutable prefix of an otherwise stationary three-hour route. */
    const publish = async (count: number): Promise<void> => {
      await page.evaluate(async (count) => {
        const breadcrumbs = Array.from({ length: count }, (_, i) => ({
          id: `noise-${i}`, device_id: 'alpha', lat: 52 + (i === 5 ? 45 : 0) / 111195, lon: -9.7,
          timestamp: new Date(Date.parse('2026-08-22T10:00:00Z') + i * 20 * 60000).toISOString(),
          altitude: null, speed: null, battery: null, accuracy: 10, source: 'osmand',
          data_origin: 'live' as const, cache_age_seconds: null, device_cache_stale: false,
        }))
        await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot({
          devices: [{ device_id: 'alpha', name: 'Alpha Team', status: 'online',
            last_seen: breadcrumbs.at(-1)!.timestamp, unique_id: null, category: 'person' }],
          breadcrumbs, positions: [breadcrumbs.at(-1)!],
        })
      }, count)
    }
    await publish(5)
    await openDevicesWorkspace(page)
    await page.getByTestId('acknowledge-stationary-attention').click()
    for (const count of [6, 7, 10]) {
      await publish(count)
      await expect(page.getByTestId('device-attention-alpha')).toContainText('Acknowledged')
    }
    await expect(page.getByText('Acknowledged — 180 min without meaningful movement', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'output/repair-train-a/stationary-noise-acknowledged.png' })
  })
})

test.describe('Not-moving warnings off [DON-384]', () => {
  test('says once on the tracking line when someone with a position has no trail recorded, never per row', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-26T10:00:00Z') })
    await page.goto('/?missionHarness=1')
    await expect(page.getByTestId('app-title')).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15_000 })
    await openMissionPanel(page)
    await page.getByTestId('mission-name-input').fill('Not Moving Off')
    await page.getByTestId('mission-start-btn').click()
    // One current position and no recorded trail: the check has too little to work with.
    await page.evaluate(async () => {
      const now = new Date().toISOString()
      const latest = { id: 'only', device_id: 'alpha', lat: 52, lon: -9.7, timestamp: now, altitude: null, speed: null, battery: null, accuracy: 4, source: 'osmand', data_origin: 'live' as const, cache_age_seconds: null, device_cache_stale: false }
      await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot({
        devices: [{ device_id: 'alpha', name: 'Alpha Team', status: 'online', last_seen: now, unique_id: null, category: 'person' }],
        positions: [latest], breadcrumbs: [],
      })
    })
    const headline = page.getByTestId('ws-tracking-headline')
    // A phone's second position arrives well inside two minutes, so nothing is said yet.
    await expect(headline).not.toContainText('not-moving off')
    await page.clock.fastForward('02:05')
    await expect(headline).toContainText('1 not-moving off')
    await openWorkspacePanel(page, 'tracking')
    await expect(page.getByTestId('ws-tracking-happened'))
      .toContainText('Not-moving warnings are off for 1 person: their trail is not being recorded')
    await page.screenshot({ path: 'output/don-384/not-moving-off-tracking.png' })
    await openDevicesWorkspace(page)
    await expect(page.getByTestId('device-row-alpha')).toBeVisible()
    await expect(page.getByText('Stationary check unavailable', { exact: false })).toHaveCount(0)
    await page.screenshot({ path: 'output/don-384/not-moving-off-devices.png' })
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
