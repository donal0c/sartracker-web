import { expect, type Page } from '@playwright/test'

/** Creates the deterministic participant, outing, and Unassigned coverage scenario. */
export async function seedCoverageMission(page: Page): Promise<void> {
  await page.goto('/?missionHarness=1&missionModel=1&coverage=1')
  await page.getByTestId('app-title').waitFor({ state: 'visible', timeout: 15_000 })
  await page.waitForSelector('canvas', { timeout: 20_000 })
  await page.evaluate(async () => {
    await window.__SARTRACKER_BROWSER_HARNESS__?.setParticipantDiscovery({
      groups: [],
      devices: [
        device('alpha', 'Alpha Team'),
        device('bravo', 'Bravo Team'),
        device('discovery-only', 'Discovery Only'),
      ],
    })

    function device(deviceId: string, name: string) {
      return {
        device_id: deviceId,
        name,
        status: 'online' as const,
        last_seen: new Date().toISOString(),
        unique_id: `imei-${deviceId}`,
        category: null,
        group_id: null,
      }
    }
  })
  await page.getByTestId('participant-device-picker').getByText('Alpha Team', { exact: true }).click()
  await page.getByTestId('participant-device-picker').getByText('Bravo Team', { exact: true }).click()
  await page.getByTestId('mission-name-input').fill('Complete Coverage Mission')
  await page.getByTestId('mission-offset-input').fill('2')
  await page.getByTestId('mission-start-btn').click()
  await expect(page.getByTestId('mission-control')).toContainText('active')

  await injectCoverageSnapshot(page, 'unassigned', -60)
  await page.getByTestId('outing-label-input').fill('Ridge sweep')
  await page.getByTestId('outing-start-btn').click()
  await expect(page.getByTestId('active-outing-label')).toContainText('Ridge sweep')
  await injectCoverageSnapshot(page, 'outing', 0)
}

async function injectCoverageSnapshot(
  page: Page,
  identity: string,
  offsetMinutes: number,
): Promise<void> {
  await page.evaluate(async ({ identity, offsetMinutes }) => {
    const timestamp = new Date(Date.now() + offsetMinutes * 60_000).toISOString()
    const devices = [
      device('alpha', 'Alpha Team'),
      device('bravo', 'Bravo Team'),
      device('discovery-only', 'Discovery Only'),
    ]
    const positions = devices.map((device, index) => ({
      id: `${identity}-${device.device_id}`,
      device_id: device.device_id,
      lat: 52.01 + index * 0.002,
      lon: -9.74 - index * 0.002,
      altitude: null,
      speed: null,
      battery: null,
      accuracy: null,
      timestamp,
      source: 'traccar',
      data_origin: 'live' as const,
      cache_age_seconds: null,
      device_cache_stale: false,
    }))
    await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot({
      devices,
      positions,
      breadcrumbs: positions,
      rawBreadcrumbsForPersistence: positions,
    })

    function device(deviceId: string, name: string) {
      return {
        device_id: deviceId,
        name,
        status: 'online' as const,
        last_seen: timestamp,
        unique_id: `imei-${deviceId}`,
        category: null,
        group_id: null,
      }
    }
  }, { identity, offsetMinutes })
}
