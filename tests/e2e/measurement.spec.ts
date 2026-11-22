import { expect, test } from '@playwright/test'
import { openMissionPanel, openWorkspacePanel } from './helpers/workspace-panels'
import { armMapTool } from './helpers/map-tools'

test.describe('M9 measurement workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    const title = page.getByTestId('app-title')
    await title.waitFor({ state: 'visible', timeout: 10000 })
    await expect(title).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15000 })
    await openMissionPanel(page)
    await page.getByTestId('mission-name-input').fill('Measurement Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'active')
    // Full map: the open Map Tools and its measurement list cover the left of
    // the map, so the map clicks below land to their right (DON-341).
    await backToFullMap(page)
    await page.getByTestId('drawing-toolbar-expand').click()
  })

  test('creates multiple measurements and clears them manually', async ({ page }) => {
    await expect(page.getByTestId('measurement-panel')).toBeHidden()
    await openWorkspacePanel(page, 'tools')
    await expect(page.getByTestId('measurement-panel')).toBeHidden()
    await backToFullMap(page)

    await page.getByTestId('drawing-tool-measure').click()
    await expect(page.getByTestId('measurement-status')).toContainText('Click the first point')
    await expect(page.locator('.maplibregl-canvas')).toHaveCSS('cursor', /crosshair|url/)

    await clickMap(page, { x: 680, y: 240 })
    await expect(page.getByTestId('measurement-status')).toContainText('Click the second point')
    await clickMap(page, { x: 820, y: 300 })

    await expect(page.getByTestId('measurement-mode')).toHaveText('idle')
    await expect(page.getByTestId('drawing-toolbar-active-mode')).toContainText('Open')
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

    await openMissionPanel(page)
    await page.getByTestId('mission-finish-btn').click()
    await page
      .getByTestId('mission-finish-dialog')
      .getByRole('button', { name: 'Confirm Finish' })
      .click()

    await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'idle')
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
    await openWorkspacePanel(page, 'tools')
    await backToFullMap(page)
    await armMapTool(page, 'line')
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

/** Closes whichever side panel is open (Tools opens over Layers), leaving the whole map. */
async function backToFullMap(page: import('@playwright/test').Page) {
  const fullMap = page.getByTestId('ws-full-map')
  if ((await fullMap.textContent())?.trim() === 'Full map') await fullMap.click()
  await expect(page.getByTestId('ws-side')).toHaveAttribute('data-empty', 'true')
}

/** How far right the clicks move so they clear the open Map Tools (DON-341). */
const CLEAR_OF_MAP_TOOLS = 220

async function clickMap(
  page: import('@playwright/test').Page,
  position: { x: number; y: number },
) {
  await page.getByTestId('map-container').click({ position: { x: position.x + CLEAR_OF_MAP_TOOLS, y: position.y } })
}

async function rightClickMap(
  page: import('@playwright/test').Page,
  position: { x: number; y: number },
) {
  await page.getByTestId('map-container').click({ position: { x: position.x + CLEAR_OF_MAP_TOOLS, y: position.y }, button: 'right' })
}

async function hideMapToolsGroup(page: import('@playwright/test').Page) {
  // The Layers panel always lists hidden items, unticked (DON-341).
  await openWorkspacePanel(page, 'layers')
  const mapToolsGroup = page.getByTestId('layer-visibility-group-map-tools')
  await expect(mapToolsGroup).toBeVisible()
  if (await mapToolsGroup.isChecked()) {
    await mapToolsGroup.click()
  }
  await expect
    .poll(async () => (await readVisibilityState(page)).groupVisibility.mapTools)
    .toBe(false)
  await backToFullMap(page)
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
