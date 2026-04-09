import { expect, test } from '@playwright/test'

test.describe('M6 marker workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    await expect(page.getByTestId('app-title')).toHaveText('SAR Tracker Web')
    await page.waitForSelector('canvas', { timeout: 15000 })
    await page.getByTestId('mission-name-input').fill('Marker Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
  })

  test('creates a clue marker from a map click and persists it', async ({ page }) => {
    await clickMapCentre(page)

    const dialog = page.getByTestId('marker-dialog')
    await expect(dialog).toBeVisible()
    await page.getByTestId('marker-name-input').fill('Boot print')
    await dialog.getByText('Clue', { exact: true }).click()
    await page.getByTestId('marker-clue-type-input').selectOption('Footprint')
    await page.getByTestId('marker-confidence-input').selectOption('Probable')
    await page.getByTestId('marker-found-by-input').fill('Team 2')
    await page.getByTestId('marker-save-btn').click()

    await expect(page.getByTestId('marker-dialog')).toBeHidden()

    const persistedState = await page.evaluate(() => {
      const raw = window.sessionStorage.getItem('sartracker:browser-harness')
      return raw === null ? null : JSON.parse(raw)
    })

    expect(persistedState?.markers).toHaveLength(1)
    expect(persistedState?.markers[0]).toMatchObject({
      type: 'clue',
      name: 'Boot print',
      clue_type: 'Footprint',
      confidence: 0.8,
      found_by: 'Team 2',
    })
  })

  test('edits and deletes an existing marker through the modal flow', async ({ page }) => {
    await clickMapCentre(page)
    const dialog = page.getByTestId('marker-dialog')
    await page.getByTestId('marker-name-input').fill('Initial hazard')
    await dialog.getByText('Hazard', { exact: true }).click()
    await page.getByTestId('marker-hazard-type-input').selectOption('Cliff/Drop-off')
    await page.getByTestId('marker-severity-input').selectOption('High')
    await page.getByTestId('marker-save-btn').click()
    await expect(page.getByTestId('marker-dialog')).toBeHidden()

    await clickMapCentre(page)
    await expect(page.getByTestId('marker-dialog')).toBeVisible()
    await expect(page.getByTestId('marker-name-input')).toHaveValue('Initial hazard')
    await page.getByTestId('marker-name-input').fill('Updated hazard')
    await page.getByTestId('marker-save-btn').click()
    await expect(page.getByTestId('marker-dialog')).toBeHidden()

    let persistedState = await page.evaluate(() => {
      const raw = window.sessionStorage.getItem('sartracker:browser-harness')
      return raw === null ? null : JSON.parse(raw)
    })

    expect(persistedState?.markers[0]?.name).toBe('Updated hazard')

    await clickMapCentre(page)
    await page.getByTestId('marker-delete-btn').click()
    await expect(page.getByTestId('marker-dialog')).toBeHidden()

    persistedState = await page.evaluate(() => {
      const raw = window.sessionStorage.getItem('sartracker:browser-harness')
      return raw === null ? null : JSON.parse(raw)
    })

    expect(persistedState?.markers).toHaveLength(0)
  })
})

async function clickMapCentre(page: Parameters<typeof test>[0]['page']) {
  const mapContainer = page.getByTestId('map-container')
  const bounds = await mapContainer.boundingBox()
  expect(bounds).toBeTruthy()

  if (bounds === null) {
    throw new Error('Map bounds were unavailable.')
  }

  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
}
