import { expect, test, type Page } from '@playwright/test'
import { openMissionPanel, openWorkspacePanel, pressPauseResume } from './helpers/workspace-panels'
import { armMapTool } from './helpers/map-tools'

/**
 * Focus Mode (M24) was retired with the old screen (DON-341). Each of its
 * capabilities moved, as listed on DON-341; these tests keep the same parity
 * checks against where each one lives now. "Full map" replaced Focus Mode.
 */
test.describe('M24 focus mode parity, now Full map (DON-341)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    await page.evaluate(() => {
      window.localStorage.clear()
    })
    await page.reload()
    await waitForShell(page)
  })

  test('Full map gives the map the screen, keeps coordinates and warnings, and persists across reload', async ({ page }) => {
    await startMission(page, 'Full Map Mission')
    await openWorkspacePanel(page, 'people')
    await page.getByTestId('ws-full-map').click()
    await expect(page.getByTestId('ws-side')).toHaveAttribute('data-empty', 'true')
    await expect(page.getByTestId('ws-full-map')).toHaveText('Show panel')
    // The safety banner stays while the panel is closed (was: banner kept with the mast hidden).
    await expect(page.getByTestId('hosted-browser-testing-banner')).toContainText('Browser testing mode')
    // Tracking health stays in the top bar.
    await expect(page.getByTestId('ws-tracking-headline')).toBeVisible()

    // Layers and Mission stay reachable from the top bar (was: Focus sidebar tabs and dock).
    await page.getByTestId('ws-toggle-layers').click()
    await expect(page.getByTestId('layer-panel')).toBeVisible()
    await openMissionPanel(page)
    await expect(page.getByTestId('mission-control')).toBeVisible()
    await page.getByTestId('ws-mission-close').click()
    await page.getByTestId('ws-full-map').click()
    await expect(page.getByTestId('ws-side')).toHaveAttribute('data-empty', 'true')

    // The normal coordinate bar replaced the Focus Coordinates readout.
    await moveOverMap(page)
    await expect(page.getByTestId('coordinate-display')).toContainText('°')
    await expect(page.getByTestId('focus-mode-coordinate-display')).toHaveCount(0)

    // Remembered across a reload, as Focus Mode was.
    await page.reload()
    await waitForShell(page)
    await page.getByTestId('start-screen-resume-btn').click()
    await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')
    await expect(page.getByTestId('ws-full-map')).toHaveText('Show panel')
    await expect(page.getByTestId('ws-side')).toHaveAttribute('data-empty', 'true')
    await expect(page.getByTestId('hosted-browser-testing-banner')).toContainText('Browser testing mode')

    await page.getByTestId('ws-full-map').click()
    await expect(page.getByTestId('ws-people-panel')).toBeVisible()
  })

  test('with Full map on, recovery, tracking awareness and drawing still work', async ({ page }) => {
    await startMission(page, 'Focus Mode Mission')
    await openWorkspacePanel(page, 'people')
    await page.getByTestId('ws-full-map').click()
    await expect(page.getByTestId('ws-side')).toHaveAttribute('data-empty', 'true')
    await expect(page.getByTestId('ws-mission-button')).toContainText('Focus Mode Mission')

    // Tracking awareness: two devices, one online, are counted and described.
    await injectMockTracking(page)
    await expect(page.getByTestId('ws-toggle-people')).toContainText('People 2')
    await expect(page.getByTestId('ws-tracking-headline')).toContainText('1 position out of date')
    await openWorkspacePanel(page, 'tracking')
    await expect(page.getByTestId('ws-tracking-happened')).toContainText('Tracking is running')

    // Pause and resume.
    await pressPauseResume(page)
    await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'paused')
    await pressPauseResume(page)
    await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'active')
    // A phase change closes the open panel, so Full map is back.
    await expect(page.getByTestId('ws-side')).toHaveAttribute('data-empty', 'true')

    // Drawing.
    await armMapTool(page, 'line')
    await clickMap(page, { x: 420, y: 340 })
    await clickMap(page, { x: 560, y: 400 })
    await rightClickMap(page, { x: 560, y: 400 })
    await expect(page.getByTestId('drawing-dialog')).toBeVisible()
    await page.getByTestId('drawing-name-input').fill('Focus Ingress')
    await page.getByTestId('drawing-save-btn').click()
    await expect(page.getByTestId('drawing-dialog')).toBeHidden()

    // The harness saves after the dialog closes; wait for it rather than read once.
    await expect.poll(async () => (await readMissionDrawings(page))
      .some((drawing) => drawing.name === 'Focus Ingress' && drawing.type === 'line')).toBe(true)

    // Recovery after a reload, still on Full map.
    await page.reload()
    await waitForShell(page)
    await expect(page.getByTestId('start-screen-resume')).toBeVisible()
    await page.getByTestId('start-screen-resume-btn').click()
    await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')
    await expect(page.getByTestId('ws-side')).toHaveAttribute('data-empty', 'true')

    await openMissionPanel(page)
    await page.getByTestId('mission-finish-btn').click()
    await page
      .getByTestId('mission-finish-dialog')
      .getByRole('button', { name: 'Confirm Finish' })
      .click()
    await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'idle')
  })
})

async function waitForShell(page: Page) {
  await expect(page.getByTestId('app-title')).toContainText('SAR Tracker')
  await page.waitForSelector('canvas', { timeout: 15000 })
}

async function startMission(page: Page, name: string) {
  await openMissionPanel(page)
  await page.getByTestId('mission-name-input').fill(name)
  await page.getByTestId('mission-start-btn').click()
  await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'active')
}

async function moveOverMap(page: Page) {
  const mapContainer = page.getByTestId('map-container')
  const bounds = await mapContainer.boundingBox()
  expect(bounds).toBeTruthy()
  if (bounds !== null) {
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  }
}

async function clickMap(page: Page, position: { readonly x: number; readonly y: number }) {
  const target = page.locator('.maplibregl-canvas').first()
  await target.waitFor({ state: 'visible', timeout: 15000 })
  await target.click({ position, force: true })
}

async function rightClickMap(page: Page, position: { readonly x: number; readonly y: number }) {
  const target = page.locator('.maplibregl-canvas').first()
  await target.waitFor({ state: 'visible', timeout: 15000 })
  await target.click({ position, button: 'right', force: true })
}

async function injectMockTracking(page: Page) {
  await page.evaluate(() => {
    window.__SARTRACKER_BROWSER_HARNESS__.injectTrackingSnapshot({
      devices: [
        {
          device_id: 'alpha',
          name: 'Alpha Team',
          status: 'online',
          last_seen: '2026-04-10T12:00:00.000Z',
          unique_id: null,
          category: 'person',
        },
        {
          device_id: 'bravo',
          name: 'Bravo Team',
          status: 'offline',
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
          data_origin: 'live',
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
          data_origin: 'cache',
          cache_age_seconds: 180,
          device_cache_stale: true,
        },
      ],
      breadcrumbs: [],
    })
  })
}

async function readMissionDrawings(page: Page) {
  return page.evaluate(() => {
    const raw = window.sessionStorage.getItem('sartracker:browser-harness')
    if (raw === null) {
      return []
    }

    const parsed = JSON.parse(raw) as {
      drawings?: Array<{ name: string; type: string }>
    }

    return parsed.drawings ?? []
  })
}
