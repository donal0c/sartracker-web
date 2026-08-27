import { expect, test } from '@playwright/test'

test.describe('PR5 mission evidence and repeated search passes [DON-279]', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1&missionModel=1')
    await page.getByTestId('app-title').waitFor({ state: 'visible', timeout: 10_000 })
    await page.waitForSelector('canvas', { timeout: 15_000 })
    await page.getByTestId('mission-name-input').fill('Search Pass Evidence')
    await page.getByTestId('mission-start-btn').click()
    await page.getByTestId('outing-label-input').fill('Operational period 1')
    await page.getByTestId('outing-start-btn').click()

    await page.getByTestId('drawing-toolbar-expand').click()
    await page.getByTestId('drawing-tool-search_area').click({ force: true })
    await clickMap(page, { x: 500, y: 180 })
    await clickMap(page, { x: 650, y: 220 })
    await clickMap(page, { x: 540, y: 340 })
    await rightClickMap(page, { x: 540, y: 340 })
    await page.getByTestId('drawing-name-input').fill('Area Alpha')
    await page.getByTestId('drawing-save-btn').click()
  })

  test('records repeated coordinator outcomes without treating coverage as authority', async ({ page }) => {
    await page.getByTestId('open-mission-review-workspace').click()
    await page.getByRole('button', { name: 'Search Passes', exact: true }).click()
    await expect(page.getByTestId('search-operations-workspace')).toContainText('Area Alpha')
    await expect(page.getByTestId('search-operations-workspace')).toContainText(
      'coverage is advisory only',
    )

    await page.getByTestId('search-operation-coordinator').fill('Coordinator One')
    await page.getByTestId('search-assignment-team').fill('Team 1')
    await page.getByTestId('search-assignment-record').click()
    await expect(page.getByTestId('search-operation-feedback')).toContainText('Assignment recorded')

    await page.getByTestId('search-pass-outcome').selectOption('partial')
    await page.getByTestId('search-pass-record').click()
    await expect(page.getByTestId('search-operation-feedback')).toContainText(
      'Geometry did not set the outcome',
    )
    await page.getByTestId('search-pass-outcome').selectOption('full')
    await page.getByTestId('search-pass-record').click()

    await expect(page.locator('p[data-testid^="search-pass-"]')).toHaveCount(2)
    await expect(page.getByTestId('search-operations-workspace')).toContainText('Coordinator-declared: partial')
    await expect(page.getByTestId('search-operations-workspace')).toContainText('Coordinator-declared: full')
  })
})

async function clickMap(page: import('@playwright/test').Page, position: { x: number; y: number }) {
  await page.locator('.maplibregl-canvas').first().click({ position, force: true })
}

async function rightClickMap(page: import('@playwright/test').Page, position: { x: number; y: number }) {
  await page.locator('.maplibregl-canvas').first().click({ position, button: 'right', force: true })
}
