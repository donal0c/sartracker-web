import { expect, test, type Page } from '@playwright/test'

import { openWorkspacePanel } from './helpers/workspace-panels'
import { navigateToHarness, pauseMission, resumeMission, startMission } from './visual/helpers/test-setup'

/*
 * DON-356: pausing a mission with one stale person turned the People badge
 * from "1 ⚠" into "3 ⚠", mixing that person's own problem with the pause the
 * alarm already announces. The badge must keep telling them apart.
 */

/** Three people; Charlie's latest position was already stale before any pause. */
async function injectOneStalePerson(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot({
      devices: [
        { device_id: 'alpha', name: 'Alpha Team', status: 'online', last_seen: '2026-04-10T12:00:00.000Z', unique_id: null, category: 'person' },
        { device_id: 'bravo', name: 'Bravo Team', status: 'online', last_seen: '2026-04-10T11:58:00.000Z', unique_id: null, category: 'person' },
        { device_id: 'charlie', name: 'Charlie Team', status: 'offline', last_seen: '2026-04-10T10:30:00.000Z', unique_id: null, category: 'person' },
      ],
      positions: [
        { id: 'pos-alpha', device_id: 'alpha', lat: 51.9985, lon: -9.7426, altitude: 320, speed: 1, battery: 85, accuracy: 8, timestamp: '2026-04-10T12:00:00.000Z', source: 'osmand', data_origin: 'live', cache_age_seconds: null, device_cache_stale: false },
        { id: 'pos-bravo', device_id: 'bravo', lat: 52.0012, lon: -9.7501, altitude: 280, speed: 0.5, battery: 42, accuracy: 15, timestamp: '2026-04-10T11:58:00.000Z', source: 'osmand', data_origin: 'live', cache_age_seconds: null, device_cache_stale: false },
        { id: 'pos-charlie', device_id: 'charlie', lat: 51.995, lon: -9.738, altitude: 350, speed: 0, battery: 12, accuracy: 20, timestamp: '2026-04-10T10:30:00.000Z', source: 'cache', data_origin: 'cache', cache_age_seconds: 600, device_cache_stale: true },
      ],
      breadcrumbs: [],
    }, { mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: '2026-04-10T12:00:01.000Z', warning: null })
  })
}

test('a paused mission with one stale person keeps the badge on that person [DON-356]', async ({ page }) => {
  await navigateToHarness(page)
  await startMission(page, 'Badge pause mission')
  await injectOneStalePerson(page)
  const badge = page.getByTestId('ws-people-attention')
  await expect(badge).toHaveText('1 ⚠')

  await pauseMission(page)
  await expect(page.getByTestId('ws-alarm')).toContainText('MISSION PAUSED')
  // The pause is announced once, by the alarm; the badge still singles out Charlie.
  await expect(badge).toHaveText('1 ⚠')
  await openWorkspacePanel(page, 'people')
  await expect(page.getByTestId('ws-person-status-charlie')).toContainText('Already out of date when updates stopped')
  await expect(page.getByTestId('ws-person-status-alpha')).toContainText('Last known position')

  await resumeMission(page)
  await expect(badge).toHaveText('1 ⚠')
})
