import { expect, test } from '@playwright/test'

test.describe('M9 measurement workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    const title = page.getByTestId('app-title')
    await title.waitFor({ state: 'visible', timeout: 10000 })
    await expect(title).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15000 })
    await page.getByTestId('mission-name-input').fill('Measurement Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
    await page.getByTestId('drawing-toolbar-expand').click()
  })

  test('creates multiple measurements and clears them manually', async ({ page }) => {
    await expect(page.getByTestId('measurement-panel')).toBeHidden()
    await page.getByTestId('sidebar-tab-tools').click()
    await expect(page.getByTestId('measurement-panel')).toBeHidden()

    await page.getByTestId('drawing-tool-measure').click()
    await expect(page.getByTestId('measurement-status')).toContainText('Click the first point')
    await expect(page.locator('.maplibregl-canvas')).toHaveCSS('cursor', /crosshair|url/)

    await clickMap(page, { x: 680, y: 240 })
    await expect(page.getByTestId('measurement-status')).toContainText('Click the second point')
    await clickMap(page, { x: 820, y: 300 })

    await expect(page.getByTestId('measurement-mode')).toHaveText('idle')
    await expect(page.getByTestId('drawing-toolbar-active-mode')).toContainText('Select')
    await expect(page.getByTestId('measurement-count')).toHaveText('1')
    await expect(page.getByTestId('measurement-list')).toContainText(/km|m/)
    await expect(page.getByTestId('measurement-list')).toContainText('°')
    await expect(page.getByTestId('measurement-list')).not.toContainText('T ')
    await expect(page.getByTestId('measurement-list')).not.toContainText('M ')

    await page.getByTestId('drawing-tool-measure').click()
    await clickMap(page, { x: 650, y: 200 })
    await clickMap(page, { x: 800, y: 230 })
    await expect(page.getByTestId('measurement-count')).toHaveText('2')

    await page.getByTestId('measurement-clear-btn').click()
    await expect(page.getByTestId('measurement-clear-confirmation')).toBeVisible()
    await page.getByTestId('measurement-clear-confirm-btn').click()
    await expect(page.getByTestId('measurement-count')).toHaveText('0')
    await expect(page.getByTestId('measurement-list')).toContainText('No active measurements.')
  })

  test('cancels measurement mode with escape and clears measurements on mission finish', async ({
    page,
  }) => {
    await page.getByTestId('drawing-tool-measure').click()
    await clickMap(page, { x: 680, y: 240 })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('measurement-mode')).toHaveText('idle')
    await expect(page.getByTestId('measurement-status')).toContainText('Ready to measure')

    await page.getByTestId('drawing-tool-measure').click()
    await clickMap(page, { x: 680, y: 240 })
    await clickMap(page, { x: 820, y: 300 })
    await expect(page.getByTestId('measurement-count')).toHaveText('1')

    await page.getByTestId('mission-finish-btn').click()
    await page
      .getByTestId('mission-finish-dialog')
      .getByRole('button', { name: 'Confirm Finish' })
      .click()

    await expect(page.getByTestId('mission-control')).toContainText('idle')
    await expect(page.getByTestId('measurement-count')).toHaveText('0')
    await expect(page.getByTestId('drawing-tool-measure')).toBeDisabled()
  })

  test('hands map control cleanly between measurement mode and drawing tools', async ({
    page,
  }) => {
    await page.getByTestId('drawing-tool-line').click()
    await expect(page.getByTestId('drawing-toolbar-active-mode')).toContainText('Line')

    await page.getByTestId('drawing-tool-measure').click()
    await expect(page.getByTestId('measurement-mode')).toHaveText('armed')
    await expect(page.getByTestId('drawing-toolbar-active-mode')).toContainText('Measure')

    await page.getByTestId('drawing-tool-search_area').click()
    await expect(page.getByTestId('measurement-panel')).toBeHidden()
    await expect(page.getByTestId('drawing-toolbar-active-mode')).toContainText('Search Area')
  })

  test('arms measurement from the Map Tools toolbar', async ({ page }) => {
    await expect(page.getByTestId('drawing-toolbar')).toContainText('Map Tools')

    await page.getByTestId('drawing-tool-measure').click()
    await expect(page.getByTestId('measurement-mode')).toHaveText('armed')
    await expect(page.getByTestId('drawing-toolbar-active-mode')).toContainText('Measure')

    await clickMap(page, { x: 680, y: 240 })
    await clickMap(page, { x: 820, y: 300 })
    await expect(page.getByTestId('measurement-mode')).toHaveText('idle')
    await expect(page.getByTestId('measurement-count')).toHaveText('1')
    await expect(page.getByTestId('measurement-list')).toContainText('°')
  })

  test('reveals hidden Map Tools layers before creating measurement and drawings', async ({
    page,
  }) => {
    await waitForMapStyle(page)
    await hideMapToolsGroup(page)

    await page.getByTestId('drawing-tool-measure').click({ force: true })
    await expect
      .poll(async () => (await readVisibilityState(page)).measurementsVisible)
      .toBe(true)
    await clickMap(page, { x: 680, y: 240 })
    await clickMap(page, { x: 820, y: 300 })
    await expect(page.getByTestId('measurement-count')).toHaveText('1')
    await expect
      .poll(async () => readRenderedFeatureCount(page, [
        'mission-measurements-line',
        'mission-measurements-label',
      ]))
      .toBeGreaterThan(0)

    await hideMapToolsGroup(page)
    await page.getByTestId('sidebar-tab-tools').click()
    await page.getByTestId('drawing-tool-line').click({ force: true })
    await expect
      .poll(async () => (await readVisibilityState(page)).drawingTypeVisibility.line)
      .toBe(true)
    await clickMap(page, { x: 440, y: 260 })
    await clickMap(page, { x: 600, y: 320 })
    await rightClickMap(page, { x: 600, y: 320 })
    await page.getByTestId('drawing-dialog').waitFor({ state: 'visible', timeout: 5000 })
    await page.getByTestId('drawing-name-input').fill('Visible line after hidden catalog')
    await page.getByTestId('drawing-save-btn').click()
    await page.getByTestId('drawing-dialog').waitFor({ state: 'hidden', timeout: 5000 })
    await expect
      .poll(async () => readRenderedFeatureCount(page, [
        'mission-drawings-line',
        'mission-drawings-label',
      ]))
      .toBeGreaterThan(0)
  })
})

async function clickMap(
  page: import('@playwright/test').Page,
  position: { x: number; y: number },
) {
  await page.getByTestId('map-container').click({ position })
}

async function rightClickMap(
  page: import('@playwright/test').Page,
  position: { x: number; y: number },
) {
  await page.getByTestId('map-container').click({ position, button: 'right' })
}

async function hideMapToolsGroup(page: import('@playwright/test').Page) {
  await page.getByTestId('sidebar-tab-layers').click()
  const showHiddenInput = page.getByTestId('layer-show-hidden-toggle').locator('input')
  if (!(await showHiddenInput.isChecked())) {
    await page.getByTestId('layer-show-hidden-toggle').click()
  }
  const mapToolsGroup = page.getByTestId('layer-visibility-group-map-tools')
  await expect(mapToolsGroup).toBeVisible()
  if (await mapToolsGroup.isChecked()) {
    await mapToolsGroup.click()
  }
  await expect
    .poll(async () => (await readVisibilityState(page)).groupVisibility.mapTools)
    .toBe(false)
}

async function waitForMapStyle(page: import('@playwright/test').Page) {
  await page.waitForFunction(
    () => Boolean(window.__SARTRACKER_MAP__) && window.__SARTRACKER_MAP__?.isStyleLoaded(),
    null,
    { timeout: 30000 },
  )
}

async function readVisibilityState(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const { useLayerVisibilityStore } = await import(
      '/src/features/layers/layer-visibility-store.ts'
    )
    const state = useLayerVisibilityStore.getState()
    return {
      groupVisibility: { ...state.groupVisibility },
      drawingTypeVisibility: { ...state.drawingTypeVisibility },
      measurementsVisible: state.measurementsVisible,
    }
  })
}

async function readRenderedFeatureCount(
  page: import('@playwright/test').Page,
  layers: readonly string[],
) {
  return page.evaluate((layerIds) => {
    const map = window.__SARTRACKER_MAP__
    if (map === undefined) {
      throw new Error('Map instance is unavailable.')
    }
    return map.queryRenderedFeatures({ layers: [...layerIds] }).length
  }, layers)
}
