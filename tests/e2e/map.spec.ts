import { expect, test } from '@playwright/test'

test.describe('M2 map shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    const title = page.getByTestId('app-title'); await title.waitFor({ state: 'visible', timeout: 10000 }); await expect(title).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15000 })
  })

  test('renders the map canvas and basemap controls', async ({ page }) => {
    await expect(page.locator('canvas').first()).toBeVisible()
    await expect(page.getByTestId('basemap-switcher')).toBeVisible()
    await expect(page.getByTestId('map-health')).toContainText('basemap')
    await expect(page.getByTestId('basemap-btn-opentopomap')).toBeVisible()
    await expect(page.getByTestId('basemap-btn-esri_topo')).toBeVisible()
    await expect(page.getByTestId('basemap-btn-openstreetmap')).toBeVisible()
    await expect(page.getByTestId('basemap-btn-esri_satellite')).toBeVisible()
  })

  test('keeps the live map container at a non-zero height', async ({ page }) => {
    const dimensions = await page.evaluate(() => {
      const mapContainer = document.querySelector('[data-testid="map-container"]')
      const mapRoot = document.querySelector('.maplibregl-map')
      const target = mapContainer ?? mapRoot

      if (!(target instanceof HTMLElement)) {
        return null
      }

      const rect = target.getBoundingClientRect()
      return {
        width: rect.width,
        height: rect.height,
      }
    })

    expect(dimensions).not.toBeNull()
    expect(dimensions?.width ?? 0).toBeGreaterThan(100)
    expect(dimensions?.height ?? 0).toBeGreaterThan(100)
  })

  test('persists the selected basemap', async ({ page }) => {
    await page.getByTestId('basemap-btn-esri_topo').click()
    await expect(page.getByTestId('basemap-btn-esri_topo')).toHaveClass(/bg-amber-300/)

    await page.reload()
    await page.waitForSelector('canvas', { timeout: 15000 })

    await expect(page.getByTestId('basemap-btn-esri_topo')).toHaveClass(/bg-amber-300/)
  })

  test('updates the coordinate bar on mouse move', async ({ page }) => {
    const mapContainer = page.getByTestId('map-container')
    const bounds = await mapContainer.boundingBox()

    expect(bounds).toBeTruthy()

    if (!bounds) {
      return
    }

    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)

    await expect(page.getByTestId('coords-combined')).not.toHaveText('—')
    await expect(page.getByTestId('coords-combined')).toContainText('°')
    await expect(page.getByTestId('coords-combined')).toContainText('|')
  })

  test('shows the operator-facing tracking status panel', async ({ page }) => {
    await expect(page.getByTestId('tracking-status')).toBeVisible()
    await expect(page.getByTestId('tracking-status')).toContainText('Tracking')
    await expect(page.getByTestId('tracking-status')).toContainText('idle')
    await expect(page.getByTestId('tracking-status')).toContainText('Tracking is not configured.')
  })

  test('shows the mission control panel shell', async ({ page }) => {
    await expect(page.getByTestId('mission-control')).toBeVisible()
    await expect(page.getByTestId('mission-control')).toContainText('Mission Control')
    await expect(page.getByTestId('mission-control')).toContainText('idle')
    await expect(page.getByTestId('mission-start-btn')).toBeDisabled()
  })
})
