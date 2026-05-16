import { expect, test } from '@playwright/test'

test.describe('A3.9 weather links menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    await expect(page.getByTestId('app-title')).toContainText('SAR Tracker')
  })

  test('shows an explicit empty state when no weather links are configured', async ({ page }) => {
    await page.getByTestId('weather-menu-trigger').click()

    await expect(page.getByTestId('weather-menu')).toContainText(
      'No weather links configured',
    )
  })

  test('rejects unsafe weather URLs in settings', async ({ page }) => {
    await page.getByTestId('open-settings-workspace').click()
    await page.getByTestId('weather-link-add').click()
    await page.getByTestId('weather-link-name-0').fill('Unsafe weather')
    await page.getByTestId('weather-link-url-0').fill('javascript:alert(1)')

    await expect(page.getByText('Weather link URL must use http or https.')).toBeVisible()
    await expect(page.getByTestId('settings-save')).toBeDisabled()
  })

  test('configures and opens a named weather link safely', async ({ page }) => {
    await page.getByTestId('open-settings-workspace').click()
    await page.getByTestId('weather-link-add').click()
    await page.getByTestId('weather-link-name-0').fill('Met Éireann')
    await page.getByTestId('weather-link-url-0').fill('https://www.met.ie/')
    await page.getByTestId('settings-save').click()
    await expect(page.getByTestId('settings-workspace')).toBeHidden()

    await page.getByTestId('weather-menu-trigger').click()
    await expect(page.getByTestId('weather-menu')).toContainText('Met Éireann')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('weather-link-open-0').click()
    const popup = await popupPromise
    expect(popup.url()).toContain('https://www.met.ie')
    await popup.close()
  })
})
