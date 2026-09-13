import { expect, test } from '@playwright/test'

test('recovers an expired Search Operations page and records without resetting Review [DON-279]', async ({ page }) => {
  await page.goto('/?missionHarness=1&missionModel=1')
  await page.getByTestId('mission-name-input').fill('Train D Review recovery')
  await page.getByTestId('mission-start-btn').click()
  await page.getByTestId('outing-label-input').fill('Recovery outing')
  await page.getByTestId('outing-start-btn').click()
  await page.evaluate(async () => {
    const modulePath = '/src/features/browser-validation/browser-harness-store.ts'
    const { getBrowserHarnessStore } = await import(/* @vite-ignore */ modulePath)
    const store = getBrowserHarnessStore()
    const mission = window.__SARTRACKER_BROWSER_HARNESS__!.readState().missions[0]!
    for (let index = 0; index < 26; index += 1) await store.upsertDrawing({
      id: `train-d-area-${index}`, mission_id: mission.id, type: 'search_area',
      name: `Area ${String(index).padStart(2, '0')}`, display_order: index,
      geometry_json: '{"type":"Polygon","coordinates":[[[-9.7,52],[-9.69,52],[-9.69,52.01],[-9.7,52]]]}',
    })
  })
  await page.getByTestId('open-mission-review-workspace').click()
  await page.getByRole('button', { name: 'Search Passes', exact: true }).click()
  await expect(page.getByTestId('search-operation-areas-page-controls')).toContainText('Showing 25 of 26')
  await page.getByTestId('search-operation-coordinator').fill('Coordinator D')
  await page.getByTestId('search-assignment-team').fill('Team D')
  await page.evaluate(async () => {
    const modulePath = '/src/features/browser-validation/browser-harness-store.ts'
    const { getBrowserHarnessStore } = await import(/* @vite-ignore */ modulePath)
    const state = window.__SARTRACKER_BROWSER_HARNESS__!.readState()
    const drawing = state.drawings.find((entry) => entry.id === 'train-d-area-25')!
    await getBrowserHarnessStore().upsertDrawing({ ...drawing, name: 'Aardvark changed sort key' })
  })
  await page.getByTestId('search-operation-areas-next').click()
  await expect(page.getByTestId('search-operation-areas-page-controls').getByRole('alert')).toContainText('return to the first page')
  await expect(page.getByTestId('search-operation-coordinator')).toBeDisabled()
  await page.screenshot({ path: test.info().outputPath('expired-page.png'), fullPage: true })
  await page.getByTestId('search-operation-areas-first').click()
  await expect(page.getByTestId('search-operation-areas-page-controls').getByRole('alert')).toHaveCount(0)
  await expect(page.getByTestId('search-operation-coordinator')).toBeEnabled()
  await expect(page.getByTestId('search-operation-coordinator')).toHaveValue('Coordinator D')
  await expect(page.getByTestId('search-assignment-team')).toHaveValue('Team D')
  await page.getByTestId('search-operation-area').selectOption({ label: 'Aardvark changed sort key' })
  await page.getByTestId('search-operation-outing').selectOption({ label: 'Recovery outing' })
  await page.getByTestId('search-assignment-record').click()
  await expect(page.getByTestId('search-operation-feedback')).toContainText('Assignment recorded')
  const assignments = await page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__!.readState().searchAssignments)
  expect(assignments).toHaveLength(1)
  expect(assignments[0]).toMatchObject({ team_id: 'Team D', search_area_id: 'train-d-area-25' })
  await page.screenshot({ path: test.info().outputPath('recovered-recording.png'), fullPage: true })
})
