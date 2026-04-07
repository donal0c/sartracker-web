import { expect, test } from '@playwright/test'

test('loads the scaffold shell', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('app-title')).toHaveText('SAR Tracker Web')
  await expect(page.getByTestId('map-shell')).toContainText('Map shell ready')
})
