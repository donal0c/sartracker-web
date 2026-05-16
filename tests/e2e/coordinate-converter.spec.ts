import { expect, test } from '@playwright/test'

test.describe('M18 coordinate converter', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/?missionHarness=1')
    const title = page.getByTestId('app-title')
    await title.waitFor({ state: 'visible', timeout: 10000 })
    await expect(title).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15000 })
  })

  test('converts WGS84 input, copies results, and activates a go-to target', async ({ page }) => {
    await page.getByTestId('open-coordinate-converter').click()
    await expect(page.getByTestId('coordinate-converter-dialog')).toBeVisible()

    await page.getByTestId('coordinate-input-latitude').fill('51.99917')
    await page.getByTestId('coordinate-input-longitude').fill('-9.74406')
    await page.getByTestId('coordinate-convert-btn').click()

    await expect(page.getByTestId('coordinate-result-itm')).toContainText('480245, 584452')
    await expect(page.getByTestId('coordinate-result-tm65')).toContainText('V 80011 84363')

    await page.getByTestId('coordinate-result-tm65-copy').click()
    await expect(page.getByTestId('coordinate-result-tm65-copy')).toContainText('Copied')

    await page.getByTestId('coordinate-go-to-btn').click()
    await expect(page.getByTestId('coordinate-converter-dialog')).toBeHidden()
    await expect(page.getByTestId('coordinate-target-indicator')).toBeVisible()
  })

  test('converts ITM and TM65 flows with the same modal', async ({ page }) => {
    await page.getByTestId('open-coordinate-converter').click()

    await page.getByTestId('coordinate-mode-itm').click()
    await page.getByTestId('coordinate-input-itm-easting').fill('480245')
    await page.getByTestId('coordinate-input-itm-northing').fill('584452')
    await page.getByTestId('coordinate-convert-btn').click()
    await expect(page.getByTestId('coordinate-result-wgs84')).toContainText('51.999')

    await page.getByTestId('coordinate-mode-tm65').click()
    await page.getByTestId('coordinate-input-tm65-grid-ref').fill('V 80011 84363')
    await page.getByTestId('coordinate-convert-btn').click()
    await expect(page.getByTestId('coordinate-result-itm')).toContainText('480245')
  })

  test('uses dialog semantics, traps focus, and returns focus on Escape', async ({ page }) => {
    const opener = page.getByTestId('open-coordinate-converter')
    await opener.click()

    const dialog = page.getByRole('dialog', { name: 'Convert WGS84, ITM, and TM65' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()

    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: 'Reset' })).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
  })
})
