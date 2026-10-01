import { expect, test } from '@playwright/test'

// DON-300 manual-pass items at the common 1440 x 900 laptop size.
test.use({ viewport: { width: 1440, height: 900 } })

test.beforeEach(async ({ page }) => {
  await page.goto('/?missionHarness=1&missionModel=1')
  await page.getByTestId('app-title').waitFor()
})

test('top-bar labels fit their buttons instead of running together [DON-300]', async ({ page }) => {
  const overflowing = await page.locator('.sar-mast-button').evaluateAll((buttons) =>
    buttons.filter((button) => button.scrollWidth > button.clientWidth + 1)
      .map((button) => button.textContent?.trim()))
  expect(overflowing).toEqual([])
})

test('Diagnostics summary values stay inside their panel [DON-300]', async ({ page }) => {
  await page.getByTestId('open-diagnostics-workspace').click()
  const workspace = page.getByTestId('diagnostics-workspace')
  await expect(workspace).toBeVisible()
  const spilling = await workspace.locator('.sar-status-row').evaluateAll((rows) =>
    rows.filter((row) => {
      const panel = row.closest('section')!.getBoundingClientRect()
      return [...row.children].some((cell) => cell.getBoundingClientRect().right > panel.right + 1)
    }).map((row) => row.textContent?.trim().slice(0, 40)))
  expect(spilling).toEqual([])
})

test('the last Settings field is fully visible above the action bar when scrolled to the end [DON-300]', async ({ page }) => {
  await page.getByTestId('open-settings-workspace').click()
  const content = page.getByTestId('settings-workspace')
  await content.evaluate((element) => { element.scrollTop = element.scrollHeight })
  const hidden = await content.evaluate((element) => {
    const fields = [...element.querySelectorAll('input, textarea, select, button')]
      .filter((field) => (field as HTMLElement).offsetParent !== null)
    const last = fields.at(-1)!.getBoundingClientRect()
    return last.bottom > element.getBoundingClientRect().bottom + 1
  })
  expect(hidden).toBe(false)
})
