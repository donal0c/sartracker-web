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
    await page.getByTestId('settings-section-weather-links').click()
    await page.getByTestId('weather-link-add').click()
    await page.getByTestId('weather-link-name-0').fill('Unsafe weather')
    await page.getByTestId('weather-link-url-0').fill('javascript:alert(1)')

    await expect(page.getByText('Weather link URL must use http or https.')).toBeVisible()
    await expect(page.getByTestId('settings-save')).toBeDisabled()
  })

  test('configures and opens a named weather link safely', async ({ page }) => {
    await page.getByTestId('open-settings-workspace').click()
    await page.getByTestId('settings-section-weather-links').click()
    await page.getByTestId('weather-link-add').click()
    await page.getByTestId('weather-link-name-0').type('Met Éireann')
    await expect(page.getByTestId('weather-link-name-0')).toHaveValue('Met Éireann')
    await page.getByTestId('weather-link-url-0').type('met.ie')
    await expect(page.getByTestId('weather-link-url-0')).toHaveValue('met.ie')
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

  test('normalizes multiple bare weather domains', async ({ page }) => {
    await page.getByTestId('open-settings-workspace').click()
    await page.getByTestId('settings-section-weather-links').click()

    await page.getByTestId('weather-link-add').click()
    await page.getByTestId('weather-link-name-0').fill('Met Éireann')
    await page.getByTestId('weather-link-url-0').fill('met.ie')

    await page.getByTestId('weather-link-add').click()
    await page.getByTestId('weather-link-name-1').fill('YR')
    await page.getByTestId('weather-link-url-1').fill('yr.no')

    await page.getByTestId('settings-save').click()
    await expect(page.getByTestId('settings-workspace')).toBeHidden()

    await page.getByTestId('open-settings-workspace').click()
    await page.getByTestId('settings-section-weather-links').click()
    await expect(page.getByTestId('weather-link-url-0')).toHaveValue('https://met.ie')
    await expect(page.getByTestId('weather-link-url-1')).toHaveValue('https://yr.no')
  })

  test('shows the weather menu above the map so its links can be clicked [DON-340]', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByTestId('open-settings-workspace').click()
    await page.getByTestId('settings-section-weather-links').click()
    await page.getByTestId('weather-link-add').click()
    await page.getByTestId('weather-link-name-0').fill('Met Éireann')
    await page.getByTestId('weather-link-url-0').fill('https://www.met.ie')
    await page.getByTestId('settings-save').click()
    await expect(page.getByTestId('settings-workspace')).toBeHidden()

    await page.getByTestId('weather-menu-trigger').click()
    const link = page.getByTestId('weather-link-open-0')
    await expect(link).toBeVisible()

    // The menu used to open inside the top bar, which clips its contents, so the
    // links were invisible and every click landed on the page underneath.
    const hit = await link.evaluate((element) => {
      const box = element.getBoundingClientRect()
      const topmost = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      return { onLink: topmost !== null && element.contains(topmost), width: box.width, height: box.height }
    })
    expect(hit.width).toBeGreaterThan(0)
    expect(hit.height).toBeGreaterThan(0)
    expect(hit.onLink).toBe(true)

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('weather-menu')).toBeHidden()
  })
})
