import { expect, test } from '@playwright/test'

test.describe('BCP-03 explicit outings [DON-270]', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1&missionModel=1')
    await page.getByTestId('app-title').waitFor({ state: 'visible', timeout: 10_000 })
    await page.waitForSelector('canvas', { timeout: 15_000 })
    await page.getByTestId('mission-name-input').fill('Outing Model Test')
    await page.getByTestId('mission-offset-input').fill('1')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('outing-controls-section')).toBeVisible()
  })

  test('keeps outing boundaries explicit and Unassigned visible', async ({ page }) => {
    await expect(page.getByTestId('outing-no-active-notice')).toHaveText(
      'No active outing — new fixes will be recorded as Unassigned.',
    )
    await expect(page.getByTestId('outing-unassigned-row')).toContainText('Accepted fixes: 0')

    await page.getByTestId('outing-label-input').fill('Night search')
    await page.getByTestId('outing-start-btn').click()
    await expect(page.getByTestId('active-outing-label')).toHaveText('Active: Night search')

    const firstOutingRow = page.locator('[data-testid^="outing-row-"]').first()
    await firstOutingRow.getByRole('button', { name: 'Edit' }).click()
    await page.getByTestId('outing-edit-label').fill('Night search A')
    await page.getByTestId('outing-edit-save').click()
    await expect(firstOutingRow).toContainText('Night search A')

    await page.getByTestId('outing-end-btn').click()
    await expect(page.getByTestId('outing-no-active-notice')).toBeVisible()
    await page.getByTestId('outing-start-btn').click()
    await expect(page.getByTestId('active-outing-label')).toHaveText('Active: Outing 2')

    const overlappingStart = await page.evaluate(() => {
      const raw = window.sessionStorage.getItem('sartracker:browser-harness')
      const state = raw === null ? null : JSON.parse(raw) as {
        outings?: Array<{ started_at: string }>
      }
      const startedAt = state?.outings?.[0]?.started_at
      if (startedAt === undefined) throw new Error('First outing was not persisted.')
      const date = new Date(startedAt)
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
      return local.toISOString().slice(0, 16)
    })
    await page.locator('[data-testid^="outing-row-"]').nth(1).getByRole('button', { name: 'Edit' }).click()
    await page.getByTestId('outing-edit-start').fill(overlappingStart)
    await page.getByTestId('outing-edit-save').click()
    await expect(page.getByTestId('outing-controls-section').getByRole('alert')).toContainText(/overlap/u)
  })

  test('offers but never forces ending an open outing before mission finish', async ({ page }) => {
    await page.getByTestId('outing-start-btn').click()
    await page.getByTestId('mission-finish-btn').click()

    const offer = page.getByTestId('outing-finish-offer')
    await expect(offer).toContainText('Finishing the mission won’t invent an end time')
    await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Confirm Finish' }).click()

    await expect(page.getByTestId('mission-governance-card')).toBeVisible()
    await expect(page.locator('[data-testid^="outing-row-"]').first()).toContainText('Open')
  })
})
