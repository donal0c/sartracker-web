import { expect, test } from '@playwright/test'

test.describe('M12 settings workspace', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    const title = page.getByTestId('app-title')
    await title.waitFor({ state: 'visible', timeout: 10000 })
    await expect(title).toContainText('SAR Tracker')
  })

  test('opens the workspace and validates Traccar provider inputs', async ({ page }) => {
    await page.getByTestId('open-settings-workspace').click()
    await expect(page.getByTestId('settings-workspace')).toBeVisible()

    await page.getByRole('button', { name: 'Traccar HTTP' }).click()
    await page.getByTestId('settings-provider-url').fill('https://traccar.example.com')
    await expect(page.getByTestId('settings-save')).toBeDisabled()
    await expect(page.getByText(
      'Password is required for basic authentication.',
    )).toBeVisible()

    await page.getByTestId('settings-provider-email').fill('ops@example.com')
    await page.getByTestId('settings-provider-secret').fill('secret')
    await page.getByTestId('settings-test-connection').click()
    await expect(page.getByTestId('settings-feedback')).toContainText('connection shape looks valid')
  })

  test('persists mission defaults and coordinate display preference in browser validation mode', async ({
    page,
  }) => {
    await page.getByTestId('open-settings-workspace').click()
    await expect(page.getByTestId('settings-workspace')).toBeVisible()

    await page.getByTestId('settings-auto-save-interval').fill('90')
    await page.getByTestId('settings-primary-root').fill('/missions/primary')
    await page.getByTestId('settings-tracking-cache-enabled').uncheck()
    await page.getByRole('button', { name: 'TM65 first' }).click()
    await page.getByTestId('settings-save').click()
    await expect(page.getByTestId('settings-feedback')).toContainText('Settings saved.')
    await page.getByTestId('workspace-close-btn').click()

    await page.reload()
    await page.getByTestId('open-settings-workspace').click()
    await expect(page.getByTestId('settings-auto-save-interval')).toHaveValue('90')
    await expect(page.getByTestId('settings-primary-root')).toHaveValue('/missions/primary')
    await expect(page.getByTestId('settings-tracking-cache-enabled')).not.toBeChecked()
    await expect(page.getByRole('button', { name: 'TM65 first' })).toHaveClass(/bg-amber-500/)
  })
})
