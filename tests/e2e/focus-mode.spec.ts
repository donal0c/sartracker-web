import { expect, test, type Page } from '@playwright/test'

test.describe('M24 focus mode parity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    await page.evaluate(() => {
      window.localStorage.removeItem('sartracker:focus-mode-active')
    })
    await page.reload()
    await waitForShell(page)
  })

  test('enters a map-first shell, mirrors coordinates, and persists across reload', async ({ page }) => {
    const normalMapBounds = await page.getByTestId('map-container').boundingBox()
    expect(normalMapBounds).toBeTruthy()

    await page.getByTestId('focus-mode-toggle').click()
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-focus-mode', 'true')
    await expect(page.getByTestId('focus-mode-sidebar')).toBeVisible()
    await expect(page.getByTestId('operational-sidebar')).toHaveCount(0)
    await expect(page.getByTestId('hosted-browser-testing-banner')).toContainText(
      'Browser testing mode',
    )
    await expect(page.getByTestId('focus-mode-layer-controls')).toBeVisible()
    await expect(page.getByTestId('layer-panel')).toBeVisible()

    const focusMapBounds = await page.getByTestId('map-container').boundingBox()
    expect(focusMapBounds).toBeTruthy()
    if (normalMapBounds !== null && focusMapBounds !== null) {
      expect(focusMapBounds.width).toBeGreaterThan(normalMapBounds.width)
    }

    await moveOverMap(page)
    await expect(page.getByTestId('focus-mode-coordinate-display')).toContainText('°')
    await expect(page.getByTestId('coordinate-display')).toHaveCount(0)

    await page.reload()
    await waitForShell(page)
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-focus-mode', 'true')
    await expect(page.getByTestId('focus-mode-sidebar')).toBeVisible()
    await expect(page.getByTestId('hosted-browser-testing-banner')).toContainText(
      'Browser testing mode',
    )
    await expect(page.getByTestId('focus-mode-toggle')).toContainText('Exit Focus Mode Plus')
    await expect(page.getByTestId('coordinate-display')).toHaveCount(0)

    await page.getByTestId('focus-mode-toggle').click()
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-focus-mode', 'false')
    await expect(page.getByTestId('operational-sidebar')).toBeVisible()
  })

  test('preserves mission recovery, tracking awareness, and drawing workflows', async ({ page }) => {
    await page.getByTestId('mission-name-input').fill('Focus Mode Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')

    await page.getByTestId('focus-mode-toggle').click()
    await expect(page.getByTestId('focus-mode-sidebar')).toBeVisible()
    await expect(page.getByTestId('mission-control')).toContainText('Focus Mode Mission')
    await expect(page.getByTestId('mission-control')).toContainText('active')

    await injectMockTracking(page)
    await expect(page.getByTestId('tracking-status')).toContainText('online')
    await expect(page.getByTestId('tracking-status')).toContainText('2')

    await page.getByTestId('mission-pause-resume-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('paused')
    await page.getByTestId('mission-pause-resume-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')

    await page.getByTestId('drawing-toolbar-expand').click()
    await page.getByTestId('drawing-tool-line').click({ force: true })
    await clickMap(page, { x: 420, y: 240 })
    await clickMap(page, { x: 560, y: 300 })
    await rightClickMap(page, { x: 560, y: 300 })
    await expect(page.getByTestId('drawing-dialog')).toBeVisible()
    await page.getByTestId('drawing-name-input').fill('Focus Ingress')
    await page.getByTestId('drawing-save-btn').click()
    await expect(page.getByTestId('drawing-dialog')).toBeHidden()

    const drawings = await readMissionDrawings(page)
    expect(drawings.some((drawing) => drawing.name === 'Focus Ingress' && drawing.type === 'line')).toBe(true)

    await page.reload()
    await waitForShell(page)
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-focus-mode', 'true')
    await expect(page.getByTestId('mission-recovery-dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Resume' }).click()
    await expect(page.getByTestId('mission-control')).toContainText('active')

    await page.getByTestId('mission-finish-btn').click()
    await page
      .getByTestId('mission-finish-dialog')
      .getByRole('button', { name: 'Confirm Finish' })
      .click()
    await expect(page.getByTestId('mission-control')).toContainText('idle')
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-focus-mode', 'true')
  })
})

async function waitForShell(page: Page) {
  await expect(page.getByTestId('app-title')).toContainText('SAR Tracker')
  await page.waitForSelector('canvas', { timeout: 15000 })
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
