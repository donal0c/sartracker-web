import { expect, test } from '@playwright/test'

test.describe('M19 devices workspace', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    const title = page.getByTestId('app-title')
    await title.waitFor({ state: 'visible', timeout: 10000 })
    await expect(title).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15000 })
    await page.getByTestId('mission-name-input').fill('Devices Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
    await seedTrackingWorkspace(page)
  })

  test('opens the dedicated workspace, renders the roster, and supports selection plus zoom', async ({
    page,
  }) => {
    await page.getByTestId('open-devices-workspace').click()
    await expect(page.getByTestId('devices-workspace')).toBeVisible()
    await expect(page.getByTestId('device-row-alpha')).toBeVisible()
    await expect(page.getByTestId('device-row-bravo')).toBeVisible()

    await page.getByTestId('device-row-bravo').click()
    await expect(page.getByTestId('devices-inspector-title')).toContainText('Bravo Team')
    await expect(page.getByTestId('devices-tracking-mode')).toContainText('offline')
    await expect(page.getByTestId('devices-tracking-warning')).toContainText('OFFLINE MODE')

    await page.getByTestId('device-zoom-alpha').click()
    await expect(page.getByTestId('coordinate-target-indicator')).toContainText('Alpha Team')
  })

  test('toggles per-device visibility from the workspace', async ({ page }) => {
    await page.getByTestId('open-devices-workspace').click()
    await expect(page.getByTestId('device-visibility-bravo')).toBeChecked()
    await page.getByTestId('device-visibility-bravo').click()
    await expect(page.getByTestId('device-visibility-bravo')).not.toBeChecked()
  })
})

async function seedTrackingWorkspace(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    const harness = window.__SARTRACKER_BROWSER_HARNESS__
    if (harness === undefined) {
      throw new Error('Browser harness API unavailable.')
    }

    await harness.injectTrackingSnapshot(
      {
        devices: [
          {
            device_id: 'alpha',
            name: 'Alpha Team',
            status: 'online',
            last_seen: '2026-04-10T17:00:00.000Z',
            unique_id: null,
            category: null,
          },
          {
            device_id: 'bravo',
            name: 'Bravo Team',
            status: 'offline',
            last_seen: '2026-04-10T16:40:00.000Z',
            unique_id: null,
            category: null,
          },
        ],
        positions: [
          {
            id: 'pos-alpha',
            device_id: 'alpha',
            lat: 51.99917,
            lon: -9.74406,
            altitude: null,
            speed: 3.5,
            battery: 82,
            accuracy: null,
            timestamp: '2026-04-10T17:00:00.000Z',
            source: null,
            data_origin: 'live',
            cache_age_seconds: null,
            device_cache_stale: false,
          },
          {
            id: 'pos-bravo',
            device_id: 'bravo',
            lat: 52.05944,
            lon: -9.50722,
            altitude: null,
            speed: null,
            battery: null,
            accuracy: null,
            timestamp: '2026-04-10T16:40:00.000Z',
            source: null,
            data_origin: 'cache',
            cache_age_seconds: 1200,
            device_cache_stale: true,
          },
        ],
        breadcrumbs: [],
      },
      {
        mode: 'offline',
        consecutiveFailures: 1,
        recovered: false,
        lastSuccessAt: '2026-04-10T17:00:00.000Z',
        warning: 'OFFLINE MODE — showing last known positions.',
      },
    )
  })
}
