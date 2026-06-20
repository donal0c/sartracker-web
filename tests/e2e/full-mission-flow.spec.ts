import { expect, test } from '@playwright/test'

test.describe('M10 full mission integration flow', () => {
  test.setTimeout(45_000)

  test('runs a complete mocked SAR mission with restart recovery and persistence checks', async ({
    page,
  }) => {
    await page.goto('/?missionHarness=1')
    await waitForShell(page)

    await page.getByTestId('mission-name-input').fill('Full Mission Flow')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')

    await injectMockTracking(page)
    await expect(page.getByTestId('tracking-status')).toContainText('online')
    await expect(page.getByTestId('tracking-status')).toContainText('2')
    await page.getByTestId('sidebar-tab-layers').click()
    await expect(page.getByText('Alpha Team')).toBeVisible()
    await expect(page.getByText('Bravo Team')).toBeVisible()
    await page.getByTestId('sidebar-tab-tracking').click()

    await clickMap(page, { x: 640, y: 250 })
    await expect(page.getByTestId('marker-dialog')).toBeVisible()
    await page.getByTestId('marker-name-input').fill('IPP Ridge')
    await page.getByTestId('marker-save-btn').click()
    await expect(page.getByTestId('marker-dialog')).toBeHidden()

    await clickMap(page, { x: 700, y: 300 })
    await expect(page.getByTestId('marker-dialog')).toBeVisible()
    await page.getByText('Clue', { exact: true }).click()
    await page.getByTestId('marker-name-input').fill('Boot Print')
    await page.getByTestId('marker-clue-type-input').selectOption('Footprint')
    await page.getByTestId('marker-confidence-input').selectOption('Probable')
    await page.getByTestId('marker-found-by-input').fill('Team 2')
    await page.getByTestId('marker-save-btn').click()
    await expect(page.getByTestId('marker-dialog')).toBeHidden()

    await page.getByTestId('drawing-toolbar-expand').click()
    await page.getByTestId('drawing-tool-search_area').click()
    await clickMap(page, { x: 420, y: 180 })
    await clickMap(page, { x: 620, y: 180 })
    await clickMap(page, { x: 540, y: 340 })
    await rightClickMap(page, { x: 540, y: 340 })
    await expect(page.getByTestId('drawing-dialog')).toBeVisible()
    await page.getByTestId('drawing-name-input').fill('Sector Alpha')
    await page.getByTestId('drawing-search-area-team-input').fill('Team 1')
    await page.getByTestId('drawing-search-area-status-input').selectOption('Assigned')
    await page.getByTestId('drawing-search-area-poa-input').fill('35')
    await page.getByTestId('drawing-save-btn').click()
    await expect(page.getByTestId('drawing-dialog')).toBeHidden()

    await page.getByTestId('drawing-tool-range_ring').click()
    await clickMap(page, { x: 640, y: 250 })
    await expect(page.getByTestId('drawing-dialog')).toBeVisible()
    await page.getByTestId('drawing-name-input').fill('IPP Rings')
    await page.getByTestId('drawing-range-ring-mode-manual').click()
    await page.getByTestId('drawing-range-ring-radius-input').fill('500')
    await page.getByTestId('drawing-save-btn').click()
    await expect(page.getByTestId('drawing-dialog')).toBeHidden()

    await page.getByTestId('drawing-tool-bearing_line').click()
    await clickMap(page, { x: 640, y: 250 })
    await expect(page.getByTestId('drawing-dialog')).toBeVisible()
    await page.getByTestId('drawing-name-input').fill('Bearing East')
    await page.getByTestId('drawing-bearing-type-input').selectOption('magnetic')
    await page.getByTestId('drawing-bearing-input').fill('90')
    await page.getByTestId('drawing-bearing-distance-input').fill('2000')
    await page.getByTestId('drawing-save-btn').click()
    await expect(page.getByTestId('drawing-dialog')).toBeHidden()

    await page.getByTestId('sidebar-tab-layers').click()
    const bravoVisibilityToggle = page.getByTestId('layer-visibility-feature-device-bravo')
    await expect(bravoVisibilityToggle).toBeVisible({ timeout: 15000 })
    await bravoVisibilityToggle.click()
    await expect(bravoVisibilityToggle).not.toBeChecked()

    await page.getByTestId('drawing-tool-measure').click()
    await clickMap(page, { x: 680, y: 240 })
    await clickMap(page, { x: 820, y: 285 })
    await expect(page.getByTestId('measurement-count')).toHaveText('1')

    await page.waitForTimeout(1100)
    const activeAtPause = parseDuration(await page.getByTestId('mission-active-search').textContent())
    await page.getByTestId('mission-pause-resume-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('paused')
    await page.waitForTimeout(1100)
    const pausedActive = parseDuration(await page.getByTestId('mission-active-search').textContent())
    expect(pausedActive).toBeGreaterThanOrEqual(Math.max(0, activeAtPause - 1))
    expect(pausedActive).toBeLessThanOrEqual(activeAtPause + 2)
    await page.waitForTimeout(1100)
    expect(
      Math.abs(
        parseDuration(await page.getByTestId('mission-active-search').textContent()) - pausedActive,
      ),
    ).toBeLessThanOrEqual(1)

    await page.getByTestId('mission-pause-resume-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')

    await page.reload()
    await waitForShell(page)
    await expect(page.getByTestId('mission-recovery-dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Resume' }).click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
    await page.getByTestId('sidebar-tab-layers').click()
    await expect(page.getByText('Alpha Team')).toBeVisible()

    await page.getByTestId('mission-finish-btn').click()
    await page
      .getByTestId('mission-finish-dialog')
      .getByRole('button', { name: 'Confirm Finish' })
      .click()
    await expect(page.getByTestId('mission-control')).toContainText('idle')

    const state = await readHarnessState(page)
    const mission = state.missions.find((candidate) => candidate.name === 'Full Mission Flow')
    expect(mission?.status).toBe('finished')
    expect(mission?.finish_time).not.toBeNull()
    expect(state.markers).toHaveLength(2)
    expect(state.drawings.some((drawing) => drawing.type === 'search_area')).toBe(true)
    expect(state.drawings.some((drawing) => drawing.type === 'range_ring')).toBe(true)
    expect(state.drawings.some((drawing) => drawing.type === 'bearing_line')).toBe(true)
    expect(state.devices).toHaveLength(2)
    expect(state.positions.length).toBeGreaterThanOrEqual(4)
  })
})

async function waitForShell(page: import('@playwright/test').Page) {
  const title = page.getByTestId('app-title')
  await title.waitFor({ state: 'visible', timeout: 10000 })
  await expect(title).toContainText('SAR Tracker')
  await page.waitForSelector('canvas', { timeout: 15000 })
}

async function injectMockTracking(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    const snapshot = {
      devices: [
        {
          device_id: 'alpha',
          name: 'Alpha Team',
          status: 'online' as const,
          last_seen: '2026-04-10T12:00:00.000Z',
          unique_id: null,
          category: 'person',
        },
        {
          device_id: 'bravo',
          name: 'Bravo Team',
          status: 'offline' as const,
          last_seen: '2026-04-10T11:50:00.000Z',
          unique_id: null,
          category: 'person',
        },
      ],
      positions: [
        {
          id: 'position-alpha-current',
          device_id: 'alpha',
          lat: 51.9985,
          lon: -9.7426,
          altitude: 320.5,
          speed: 1.2,
          battery: 85,
          accuracy: 8,
          timestamp: '2026-04-10T12:00:00.000Z',
          source: 'osmand',
          data_origin: 'live' as const,
          cache_age_seconds: null,
          device_cache_stale: false,
        },
        {
          id: 'position-bravo-current',
          device_id: 'bravo',
          lat: 52.0012,
          lon: -9.7501,
          altitude: 280,
          speed: 0,
          battery: 42,
          accuracy: 15,
          timestamp: '2026-04-10T11:50:00.000Z',
          source: 'osmand',
          data_origin: 'live' as const,
          cache_age_seconds: null,
          device_cache_stale: false,
        },
      ],
      breadcrumbs: [
        {
          id: 'breadcrumb-alpha-1',
          device_id: 'alpha',
          lat: 51.998,
          lon: -9.742,
          altitude: 315,
          speed: 1.5,
          battery: 90,
          accuracy: 5,
          timestamp: '2026-04-10T11:30:00.000Z',
          source: 'osmand',
          data_origin: 'live' as const,
          cache_age_seconds: null,
          device_cache_stale: false,
        },
        {
          id: 'breadcrumb-alpha-2',
          device_id: 'alpha',
          lat: 51.9982,
          lon: -9.7423,
          altitude: 318,
          speed: 1.3,
          battery: 87,
          accuracy: 6,
          timestamp: '2026-04-10T11:45:00.000Z',
          source: 'osmand',
          data_origin: 'live' as const,
          cache_age_seconds: null,
          device_cache_stale: false,
        },
      ],
    }

    await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot(snapshot, {
      mode: 'online',
      consecutiveFailures: 0,
      recovered: false,
      lastSuccessAt: '2026-04-10T12:00:01.000Z',
      warning: null,
    })
  })
}

async function readHarnessState(page: import('@playwright/test').Page) {
  return page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__?.readState() ?? null)
}

async function clickMap(
  page: import('@playwright/test').Page,
  position: { x: number; y: number },
) {
  const target = page.locator('.maplibregl-canvas').first()
  await target.waitFor({ state: 'visible', timeout: 15000 })
  await target.click({ position, force: true })
}

async function rightClickMap(
  page: import('@playwright/test').Page,
  position: { x: number; y: number },
) {
  const target = page.locator('.maplibregl-canvas').first()
  await target.waitFor({ state: 'visible', timeout: 15000 })
  await target.click({ position, button: 'right', force: true })
}

function parseDuration(value: string | null): number {
  if (value === null) {
    throw new Error('Duration text was missing.')
  }

  const [hours, minutes, seconds] = value.split(':').map((part) => Number(part))
  return hours * 3600 + minutes * 60 + seconds
}
