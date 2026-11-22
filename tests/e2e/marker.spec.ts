import { expect, test } from '@playwright/test'

test.describe('M6 marker workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1&classicLayout=1')
    const title = page.getByTestId('app-title'); await title.waitFor({ state: 'visible', timeout: 10000 }); await expect(title).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15000 })
    await page.getByTestId('mission-name-input').fill('Marker Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
  })

  test('creates a clue marker from a map click and persists it', async ({ page }) => {
    await clickMapCentre(page)

    const dialog = page.getByTestId('marker-dialog')
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('marker-name-input')).toHaveAttribute('maxlength', '120')
    await expect(page.getByTestId('marker-description-input')).toHaveAttribute('maxlength', '2000')
    await expect(page.getByTestId('marker-updated-by-input')).toHaveAttribute('maxlength', '120')
    await expect(page.getByTestId('marker-coordinator-ids-input')).toHaveAttribute('maxlength', '2000')
    await page.getByTestId('marker-name-input').fill('Boot print')
    await dialog.getByText('Clue', { exact: true }).click()
    await page.getByTestId('marker-clue-type-input').selectOption('Footprint')
    await page.getByTestId('marker-confidence-input').selectOption('Probable')
    await page.getByTestId('marker-found-by-input').fill('Team 2')
    await expect(page.getByTestId('marker-found-by-input')).toHaveAttribute('maxlength', '120')
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

  test('creates a marker from a coarse TM65 grid reference through Map Tools', async ({ page }) => {
    await page.getByTestId('sidebar-tab-tools').click()
    await expect(page.getByTestId('marker-at-grid-panel')).toBeHidden()

    await page.getByTestId('drawing-toolbar-expand').click()
    await page.getByTestId('drawing-tool-marker_at_grid').click()
    await expect(page.getByTestId('marker-at-grid-panel')).toBeVisible()
    await page.getByTestId('marker-at-grid-type-input').selectOption('hazard')
    await page.getByTestId('marker-at-grid-reference-input').fill('V 80 84')
    await page.getByTestId('marker-at-grid-create-btn').click()

    const dialog = page.getByTestId('marker-dialog')
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('marker-type-hazard')).toBeChecked()
    await expect(page.getByTestId('marker-tm65-readout')).toContainText('V 80500 84500')

    await page.getByTestId('marker-name-input').fill('Grid reference hazard')
    await page.getByTestId('marker-hazard-type-input').selectOption('Water Hazard')
    await page.getByTestId('marker-save-btn').click()

    const persistedState = await page.evaluate(() => {
      const raw = window.sessionStorage.getItem('sartracker:browser-harness')
      return raw === null ? null : JSON.parse(raw)
    })

    expect(persistedState?.markers).toHaveLength(1)
    expect(persistedState?.markers[0]).toMatchObject({
      type: 'hazard',
      name: 'Grid reference hazard',
      hazard_type: 'Water Hazard',
    })
  })

  test('rejects invalid marker grid references without opening the marker dialog', async ({ page }) => {
    await page.getByTestId('drawing-toolbar-expand').click()
    await page.getByTestId('drawing-tool-marker_at_grid').click()
    await page.getByTestId('marker-at-grid-reference-input').fill('bad ref')
    await page.getByTestId('marker-at-grid-create-btn').click()

    await expect(page.getByTestId('marker-at-grid-error')).toBeVisible()
    await expect(page.getByTestId('marker-dialog')).toBeHidden()
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
    await expect(page.getByTestId('marker-delete-confirmation')).toBeVisible()
    await page.getByTestId('marker-delete-confirm-btn').click()
    await expect(page.getByTestId('marker-dialog')).toBeHidden()

    persistedState = await page.evaluate(() => {
      const raw = window.sessionStorage.getItem('sartracker:browser-harness')
      return raw === null ? null : JSON.parse(raw)
    })

    expect(persistedState?.markers).toHaveLength(0)
  })

  test('uses dialog semantics, traps focus, and cancels with Escape', async ({ page }) => {
    await clickMapCentre(page)

    const dialog = page.getByRole('dialog', { name: 'Marker Details' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')

    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('marker-dialog')).toBeHidden()

    const persistedState = await page.evaluate(() => {
      const raw = window.sessionStorage.getItem('sartracker:browser-harness')
      return raw === null ? null : JSON.parse(raw)
    })

    expect(persistedState?.markers ?? []).toHaveLength(0)
  })

  test('blocks casualty marker save until Name, Casualty Status, and Evacuation Priority are filled', async ({ page }) => {
    await clickMapCentre(page)

    const dialog = page.getByTestId('marker-dialog')
    await expect(dialog).toBeVisible()

    await dialog.getByText('Casualty', { exact: true }).click()

    const saveBtn = page.getByTestId('marker-save-btn')
    await expect(saveBtn).toBeDisabled()
    await expect(page.getByTestId('marker-casualty-validation-error')).toBeVisible()

    const conditionSelect = page.getByTestId('marker-condition-input')
    await expect(conditionSelect).toHaveAttribute('aria-invalid', 'true')
    await expect(dialog.getByText('Casualty Status *', { exact: true })).toBeVisible()
    await expect(conditionSelect.locator('option')).toHaveText([
      'Select...',
      'Lost',
      'Crag Fast',
      'Medical Emergency',
      'Unknown',
      'Deceased',
    ])
    await expect(page.getByTestId('marker-evacuation-priority-input').locator('option')).toHaveText([
      'Select...',
      'Normal',
      'Urgent',
      'Walk-Off',
      'None',
      'Self-Evacuation',
    ])
    await expect(page.getByTestId('marker-label-size-input')).toHaveValue('16')

    await page.getByTestId('marker-name-input').fill('Subject Alpha')
    await expect(saveBtn).toBeDisabled()

    await conditionSelect.selectOption('Medical Emergency')
    await expect(saveBtn).toBeDisabled()

    await page.getByTestId('marker-evacuation-priority-input').selectOption('Urgent')
    await page.getByTestId('marker-label-size-input').fill('18')
    await expect(saveBtn).toBeEnabled()
    await expect(page.getByTestId('marker-casualty-validation-error')).toBeHidden()

    await saveBtn.click()
    await expect(page.getByTestId('marker-dialog')).toBeHidden()

    const persistedState = await page.evaluate(() => {
      const raw = window.sessionStorage.getItem('sartracker:browser-harness')
      return raw === null ? null : JSON.parse(raw)
    })

    expect(persistedState?.markers).toHaveLength(1)
    expect(persistedState?.markers[0]).toMatchObject({
      type: 'casualty',
      name: 'Subject Alpha',
      condition: 'Medical Emergency',
      evacuation_priority: 'Urgent',
      label_size: 18,
    })
  })

  test('saves a pending treatment update and protects unsaved edits on close [DON-348]', async ({ page }) => {
    await clickMapCentre(page)
    await page.getByTestId('marker-dialog').getByText('Casualty', { exact: true }).click()
    await page.getByTestId('marker-name-input').fill('Subject Charlie')
    await page.getByTestId('marker-condition-input').selectOption('Medical Emergency')
    await page.getByTestId('marker-evacuation-priority-input').selectOption('Urgent')
    await page.getByTestId('marker-treatment-update-input').fill('Gave 2 puffs salbutamol 14:05')
    await expect(page.getByTestId('marker-treatment-pending-note')).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('marker-pending-treatment.png') })
    await page.getByTestId('marker-save-btn').click()
    await expect(page.getByTestId('marker-dialog')).toBeHidden()

    await clickMapCentre(page)
    await expect(page.getByTestId('marker-treatment-update-input')).toHaveValue('')
    await expect(page.getByTestId('marker-treatment-log-input')).toHaveValue(/Gave 2 puffs salbutamol 14:05/)
    await page.getByTestId('marker-treatment-update-input').fill('Blanket applied')
    await page.getByTestId('marker-treatment-append-btn').click()
    await page.getByTestId('marker-close-btn').click()
    await expect(page.getByTestId('marker-discard-confirmation')).toBeVisible()
    await expect(page.getByTestId('marker-discard-keep-btn')).toBeFocused()
    await page.screenshot({ path: test.info().outputPath('marker-discard-confirmation.png') })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('marker-discard-confirmation')).toBeHidden()
    await expect(page.getByTestId('marker-treatment-log-input')).toHaveValue(/Blanket applied/)
    await page.getByTestId('marker-close-btn').click()
    await page.getByTestId('marker-discard-confirm-btn').click()
    await expect(page.getByTestId('marker-dialog')).toBeHidden()

    const treatment = await page.evaluate(() => {
      const raw = window.sessionStorage.getItem('sartracker:browser-harness')
      return raw === null ? null : JSON.parse(raw).markers[0]?.treatment
    })
    expect(treatment).toContain('Gave 2 puffs salbutamol 14:05')
    expect(treatment).not.toContain('Blanket applied')
  })

  test('shows a rejected marker placement over the map [DON-348]', async ({ page }) => {
    await page.evaluate(async () => {
      const moduleUrl = '/src/features/markers/marker-store.ts'
      const { useMarkerStore } = await import(moduleUrl) as typeof import('../../src/features/markers/marker-store')
      const controller = useMarkerStore.getState().controller
      if (controller === null) throw new Error('Marker runtime is not ready.')
      controller.beginCreateAt(0, 0)
    })
    const banner = page.getByTestId('marker-status-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toHaveAttribute('role', 'alert')
    await expect(banner).toContainText('Marker could not be placed')
    await expect(page.getByTestId('marker-dialog')).toBeHidden()
    await page.screenshot({ path: test.info().outputPath('marker-placement-error.png') })

    await page.getByTestId('marker-status-dismiss-btn').click()
    await expect(banner).toBeHidden()
  })

  test('preserves and edits an accumulated casualty treatment log beyond 2,000 bytes', async ({ page }) => {
    await clickMapCentre(page)
    const dialog = page.getByTestId('marker-dialog')
    await dialog.getByText('Casualty', { exact: true }).click()
    await page.getByTestId('marker-name-input').fill('Subject Bravo')
    await page.getByTestId('marker-condition-input').selectOption('Medical Emergency')
    await page.getByTestId('marker-evacuation-priority-input').selectOption('Urgent')

    const accumulatedTreatment = '[2026-08-29 10:00] Coordinator: Treatment evidence retained.\n\n'.repeat(80)
    expect(new TextEncoder().encode(accumulatedTreatment).byteLength).toBeGreaterThan(2_000)
    await page.getByTestId('marker-treatment-log-input').fill(accumulatedTreatment)
    await expect(page.getByTestId('marker-treatment-log-input')).toHaveAttribute('maxlength', '524288')
    await expect(page.getByTestId('marker-treatment-log-budget')).toContainText('of 524,288 UTF-8 bytes used')
    await page.getByTestId('marker-treatment-update-input').fill('Further treatment recorded')
    await page.getByTestId('marker-treatment-append-btn').click()
    await page.getByTestId('marker-save-btn').click()
    await expect(dialog).toBeHidden()

    await clickMapCentre(page)
    await expect(page.getByTestId('marker-treatment-log-input')).toHaveValue(/Further treatment recorded/u)
    await page.getByTestId('marker-evacuation-priority-input').selectOption('Walk-Off')
    await page.getByTestId('marker-save-btn').click()

    const persistedState = await page.evaluate(() => {
      const raw = window.sessionStorage.getItem('sartracker:browser-harness')
      return raw === null ? null : JSON.parse(raw)
    })
    expect(persistedState?.markers[0]?.treatment).toContain('Treatment evidence retained.')
    expect(persistedState?.markers[0]?.treatment).toContain('Further treatment recorded')
    expect(persistedState?.markers[0]?.evacuation_priority).toBe('Walk-Off')
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
