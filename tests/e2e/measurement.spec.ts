import { expect, test } from '@playwright/test'

test.describe('M9 measurement workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    const title = page.getByTestId('app-title')
    await title.waitFor({ state: 'visible', timeout: 10000 })
    await expect(title).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15000 })
    await page.getByTestId('mission-name-input').fill('Measurement Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
  })

  test('creates multiple measurements and clears them manually', async ({ page }) => {
    await page.getByTestId('measurement-arm-btn').click()
    await expect(page.getByTestId('measurement-status')).toContainText('Click the first point')

    await clickMap(page, { x: 420, y: 240 })
    await expect(page.getByTestId('measurement-status')).toContainText('Click the second point')
    await clickMap(page, { x: 560, y: 300 })

    await expect(page.getByTestId('measurement-count')).toHaveText('1')
    await expect(page.getByTestId('measurement-list')).toContainText('T ')
    await expect(page.getByTestId('measurement-list')).toContainText('M ')

    await clickMap(page, { x: 500, y: 200 })
    await clickMap(page, { x: 650, y: 230 })
    await expect(page.getByTestId('measurement-count')).toHaveText('2')

    await page.getByTestId('measurement-clear-btn').click()
    await expect(page.getByTestId('measurement-count')).toHaveText('0')
    await expect(page.getByTestId('measurement-list')).toContainText('No active measurements.')
  })

  test('cancels measurement mode with escape and clears measurements on mission finish', async ({
    page,
  }) => {
    await page.getByTestId('measurement-arm-btn').click()
    await clickMap(page, { x: 420, y: 240 })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('measurement-mode')).toHaveText('idle')
    await expect(page.getByTestId('measurement-status')).toContainText('Ready to measure')

    await page.getByTestId('measurement-arm-btn').click()
    await clickMap(page, { x: 420, y: 240 })
    await clickMap(page, { x: 560, y: 300 })
    await expect(page.getByTestId('measurement-count')).toHaveText('1')

    await page.getByTestId('mission-finish-btn').click()
    await page
      .getByTestId('mission-finish-dialog')
      .getByRole('button', { name: 'Confirm Finish' })
      .click()

    await expect(page.getByTestId('mission-control')).toContainText('idle')
    await expect(page.getByTestId('measurement-count')).toHaveText('0')
    await expect(page.getByTestId('measurement-arm-btn')).toBeDisabled()
  })

  test('hands map control cleanly between measurement mode and drawing tools', async ({
    page,
  }) => {
    await page.getByTestId('drawing-toolbar-expand').click()
    await page.getByTestId('drawing-tool-line').click()
    await expect(page.getByText('Active: Line')).toBeVisible()

    await page.getByTestId('measurement-arm-btn').click()
    await expect(page.getByTestId('measurement-mode')).toHaveText('armed')
    await expect(page.getByText('Active: Select')).toBeVisible()

    await page.getByTestId('drawing-tool-search_area').click()
    await expect(page.getByTestId('measurement-mode')).toHaveText('idle')
    await expect(page.getByText('Active: Search Area')).toBeVisible()
  })
})

async function clickMap(
  page: import('@playwright/test').Page,
  position: { x: number; y: number },
) {
  await page.getByTestId('map-container').click({ position })
}
