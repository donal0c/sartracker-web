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

  test('converts DD input, copies results, and activates a go-to target', async ({ page }) => {
    await page.getByTestId('open-coordinate-converter').click()
    await expect(page.getByTestId('coordinate-converter-dialog')).toBeVisible()

    await page.getByTestId('coordinate-mode-dd').click()
    await page.getByTestId('coordinate-input-latitude').fill('52.179337')
    await page.getByTestId('coordinate-input-longitude').fill('-9.464944')
    await page.getByTestId('coordinate-convert-btn').click()

    await expect(page.getByTestId('coordinate-result-ig')).toContainText('Q 99842 04015')
    await expect(page.getByTestId('coordinate-result-dms')).toContainText('52°10')

    await page.getByTestId('coordinate-result-ig-copy').click()
    await expect(page.getByTestId('coordinate-result-ig-copy')).toContainText('Copied')

    await page.getByTestId('coordinate-go-to-btn').click()
    await expect(page.getByTestId('coordinate-converter-dialog')).toBeVisible()
    await expect(page.getByTestId('coordinate-target-indicator')).toBeVisible()
  })

  test('converts IG and DMS flows with the same modal and gates W3W', async ({ page }) => {
    await page.getByTestId('open-coordinate-converter').click()

    await page.getByTestId('coordinate-mode-ig').click()
    await page.getByTestId('coordinate-input-irish-grid-ref').fill('Q 99842 04015')
    await page.getByTestId('coordinate-convert-btn').click()
    await expect(page.getByTestId('coordinate-result-dd')).toContainText('52.179336')

    await page.getByTestId('coordinate-mode-dms').click()
    await page.getByTestId('coordinate-input-dms-latitude').fill('52°10\'45.613"N')
    await page.getByTestId('coordinate-input-dms-longitude').fill('9°27\'53.798"W')
    await page.getByTestId('coordinate-convert-btn').click()
    await expect(page.getByTestId('coordinate-result-ig')).toContainText('Q 99842 04015')

    await page.getByTestId('coordinate-mode-w3w').click()
    await page.getByTestId('coordinate-input-w3w').fill('filled.count.soap')
    await page.getByTestId('coordinate-convert-btn').click()
    await expect(page.getByText(/W3W conversion is not available/)).toBeVisible()
  })

  test('uses dialog semantics, traps focus, and returns focus on Escape', async ({ page }) => {
    const opener = page.getByTestId('open-coordinate-converter')
    await opener.click()

    const dialog = page.getByRole('dialog', { name: 'Convert IG, DD, DMS, and W3W' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()

    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: 'Reset' })).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
  })
})
