import { expect, test } from '@playwright/test'

test.describe('M2 map shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('app-title')).toHaveText('SAR Tracker Web')
    await page.waitForSelector('canvas', { timeout: 15000 })
  })

  test('renders the map canvas and basemap controls', async ({ page }) => {
    await expect(page.locator('canvas').first()).toBeVisible()
    await expect(page.getByTestId('basemap-switcher')).toBeVisible()
    await expect(page.getByTestId('basemap-btn-opentopomap')).toBeVisible()
    await expect(page.getByTestId('basemap-btn-esri_topo')).toBeVisible()
    await expect(page.getByTestId('basemap-btn-openstreetmap')).toBeVisible()
    await expect(page.getByTestId('basemap-btn-esri_satellite')).toBeVisible()
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
})
