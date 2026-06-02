import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test.describe('B6 hit-test priority', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    const title = page.getByTestId('app-title')
    await title.waitFor({ state: 'visible', timeout: 10000 })
    await expect(title).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15000 })
    await page.getByTestId('mission-name-input').fill('Hit Test Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
  })

  test('marker stacked inside a polygon wins the click (priority: marker > drawing)', async ({ page }) => {
    const markerScreenX = 500
    const markerScreenY = 280

    await clickMap(page, { x: markerScreenX, y: markerScreenY })

    const markerDialog = page.getByTestId('marker-dialog')
    await expect(markerDialog).toBeVisible()
    await page.getByTestId('marker-name-input').fill('LKP inside polygon')
    await markerDialog.getByText('Clue', { exact: true }).click()
    await page.getByTestId('marker-clue-type-input').selectOption('Footprint')
    await page.getByTestId('marker-confidence-input').selectOption('Probable')
    await page.getByTestId('marker-save-btn').click()
    await expect(markerDialog).toBeHidden()

    await page.getByTestId('drawing-toolbar-expand').click()
    await page.getByTestId('drawing-tool-search_area').click({ force: true })
    await clickMap(page, { x: markerScreenX - 120, y: markerScreenY - 80 })
    await clickMap(page, { x: markerScreenX + 120, y: markerScreenY - 80 })
    await clickMap(page, { x: markerScreenX + 120, y: markerScreenY + 80 })
    await clickMap(page, { x: markerScreenX - 120, y: markerScreenY + 80 })
    await rightClickMap(page, { x: markerScreenX - 120, y: markerScreenY + 80 })

    const drawingDialog = page.getByTestId('drawing-dialog')
    await expect(drawingDialog).toBeVisible()
    await page.getByTestId('drawing-name-input').fill('Search Area Alpha')
    await page.getByTestId('drawing-search-area-team-input').fill('Team Hit Test')
    await page.getByTestId('drawing-save-btn').click()
    await expect(drawingDialog).toBeHidden()

    // Saving returns the editor to the internal select/fallback mode (DON-72
    // removed the visible Select button), so a plain map click edits.
    await clickMap(page, { x: markerScreenX, y: markerScreenY })

    const reopenedMarkerDialog = page.getByTestId('marker-dialog')
    await expect(reopenedMarkerDialog).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('marker-name-input')).toHaveValue('LKP inside polygon')
    await expect(page.getByTestId('drawing-dialog')).toBeHidden()

    await reopenedMarkerDialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByTestId('marker-dialog')).toBeHidden()
  })

  test('clicking only the polygon (no marker stacked) still selects the polygon', async ({ page }) => {
    await page.getByTestId('drawing-toolbar-expand').click()

    await page.getByTestId('drawing-tool-search_area').click({ force: true })
    await clickMap(page, { x: 380, y: 200 })
    await clickMap(page, { x: 620, y: 200 })
    await clickMap(page, { x: 620, y: 360 })
    await clickMap(page, { x: 380, y: 360 })
    await rightClickMap(page, { x: 380, y: 360 })

    const drawingDialog = page.getByTestId('drawing-dialog')
    await expect(drawingDialog).toBeVisible()
    await page.getByTestId('drawing-name-input').fill('Search Area Bravo')
    await page.getByTestId('drawing-search-area-team-input').fill('Team Bravo')
    await page.getByTestId('drawing-save-btn').click()
    await expect(drawingDialog).toBeHidden()

    // Saving returns the editor to the internal select/fallback mode (DON-72).
    await clickMap(page, { x: 500, y: 280 })

    const reopenedDrawingDialog = page.getByTestId('drawing-dialog')
    await expect(reopenedDrawingDialog).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('drawing-name-input')).toHaveValue('Search Area Bravo')
    await expect(page.getByTestId('marker-dialog')).toBeHidden()
  })
})

async function clickMap(page: Page, position: { x: number; y: number }): Promise<void> {
  const target = page.locator('.maplibregl-canvas').first()
  await target.waitFor({ state: 'visible', timeout: 15000 })
  await target.click({ position, force: true })
}

async function rightClickMap(page: Page, position: { x: number; y: number }): Promise<void> {
  const target = page.locator('.maplibregl-canvas').first()
  await target.waitFor({ state: 'visible', timeout: 15000 })
  await target.click({ position, button: 'right', force: true })
}
