import { expect, test } from '@playwright/test'

test.describe('M8 drawing workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    const title = page.getByTestId('app-title'); await title.waitFor({ state: 'visible', timeout: 10000 }); await expect(title).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15000 })
    await page.getByTestId('mission-name-input').fill('Drawing Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
    await page.getByTestId('drawing-toolbar-expand').click()
  })

  test('creates a line drawing from the toolbar and persists it', async ({ page }) => {
    await page.getByTestId('drawing-tool-line').click({ force: true })
    await clickMap(page, { x: 420, y: 240 })
    await clickMap(page, { x: 560, y: 300 })
    await rightClickMap(page, { x: 560, y: 300 })

    await expect(page.getByTestId('drawing-dialog')).toBeVisible()
    await page.getByTestId('drawing-name-input').fill('Ingress Line')
    await page.getByTestId('drawing-save-btn').click()
    await expect(page.getByTestId('drawing-dialog')).toBeHidden()

    const drawings = await readMissionDrawings(page)
    expect(drawings.some((drawing) => drawing.type === 'line' && drawing.name === 'Ingress Line')).toBe(true)
  })

  test('creates a search area with metadata', async ({ page }) => {
    await page.getByTestId('drawing-tool-search_area').click({ force: true })
    await clickMap(page, { x: 440, y: 180 })
    await clickMap(page, { x: 620, y: 180 })
    await clickMap(page, { x: 540, y: 340 })
    await rightClickMap(page, { x: 540, y: 340 })

    await expect(page.getByTestId('drawing-dialog')).toBeVisible()
    await page.getByTestId('drawing-name-input').fill('Sector Alpha')
    await page.getByTestId('drawing-search-area-team-input').fill('Team 1')
    await page.getByTestId('drawing-search-area-status-input').selectOption('Assigned')
    await page.getByTestId('drawing-search-area-poa-input').fill('35')
    await expect(page.getByTestId('drawing-search-area-terrain-input')).toBeEditable()
    await page.getByTestId('drawing-search-area-terrain-input').fill('Rocky ground')
    await page.getByTestId('drawing-search-area-notes-input').fill('Approach from east ridge')
    await page.getByTestId('drawing-save-btn').click()

    const drawings = await readMissionDrawings(page)
    const drawing = drawings.find((candidate) => candidate.name === 'Sector Alpha')
    expect(drawing?.type).toBe('search_area')
    expect(drawing?.metadata_json).toContain('Assigned')
    expect(drawing?.metadata_json).toContain('Team 1')
  })

  test('creates LPB range rings and bearing lines with conversion', async ({ page }) => {
    await page.getByTestId('drawing-tool-range_ring').click({ force: true })
    await clickMap(page, { x: 500, y: 240 })

    await expect(page.getByTestId('drawing-dialog')).toBeVisible()
    await page.getByTestId('drawing-name-input').fill('LPB Hiker')
    await page.getByTestId('drawing-range-ring-mode-lpb').click()
    await page.getByTestId('drawing-range-ring-lpb-category-input').selectOption('hiker')
    await page.getByTestId('drawing-save-btn').click()

    await page.getByTestId('drawing-tool-bearing_line').click({ force: true })
    await clickMap(page, { x: 620, y: 260 })

    await expect(page.getByTestId('drawing-dialog')).toBeVisible()
    await page.getByTestId('drawing-name-input').fill('Bearing East')
    await page.getByTestId('drawing-bearing-type-input').selectOption('magnetic')
    await page.getByTestId('drawing-bearing-input').fill('90')
    await page.getByTestId('drawing-bearing-distance-input').fill('2000')
    await expect(page.getByTestId('drawing-bearing-conversion')).toContainText('True 94.5° / Magnetic 90.0°')
    await page.getByTestId('drawing-save-btn').click()

    const drawings = await readMissionDrawings(page)
    expect(drawings.some((drawing) => drawing.name === 'LPB Hiker' && drawing.type === 'range_ring')).toBe(true)
    expect(drawings.some((drawing) => drawing.name === 'Bearing East' && drawing.type === 'bearing_line')).toBe(true)
  })

  test('creates a search sector and supports escape cancellation', async ({ page }) => {
    await page.getByTestId('drawing-tool-search_sector').click({ force: true })
    await clickMap(page, { x: 360, y: 260 })

    await expect(page.getByTestId('drawing-dialog')).toBeVisible()
    await page.getByTestId('drawing-name-input').fill('Sector North')
    await page.getByTestId('drawing-sector-start-input').fill('350')
    await page.getByTestId('drawing-sector-end-input').fill('20')
    await page.getByTestId('drawing-sector-radius-input').fill('1500')
    await page.getByTestId('drawing-save-btn').click()

    await page.getByTestId('drawing-tool-line').click({ force: true })
    await page.keyboard.press('Escape')
    await expect(page.getByText('Active: Select')).toBeVisible()

    const drawings = await readMissionDrawings(page)
    expect(drawings.some((drawing) => drawing.name === 'Sector North' && drawing.type === 'search_sector')).toBe(true)
  })

  test('creates, edits, and exposes text labels through the layer tree', async ({ page }) => {
    await page.getByTestId('drawing-tool-text_label').click({ force: true })
    await clickMap(page, { x: 540, y: 220 })

    await expect(page.getByTestId('drawing-dialog')).toBeVisible()
    await page.getByTestId('drawing-text-label-text-input').fill('Landing Zone')
    await page.getByTestId('drawing-text-label-font-size-input').fill('18')
    await page.getByTestId('drawing-text-label-color-input').fill('#FFCC00')
    await page.getByTestId('drawing-save-btn').click()

    const drawings = await readMissionDrawings(page)
    expect(drawings.some((drawing) => drawing.type === 'text_label' && drawing.name === 'Landing Zone')).toBe(true)

    await clickMap(page, { x: 540, y: 220 })
    await expect(page.getByTestId('drawing-dialog')).toBeVisible()
    await page.getByTestId('drawing-text-label-text-input').fill('Updated Landing Zone')
    await page.getByTestId('drawing-save-btn').click()

    await page.getByTestId('sidebar-tab-layers').click()
    await page.getByTestId('layer-panel').scrollIntoViewIfNeeded()
    await page.getByTestId('layer-tree-search').fill('Updated Landing')
    await expect(page.getByText('Text Labels')).toBeVisible()
    await expect(page.getByText('Updated Landing Zone')).toBeVisible()
  })

  test('edits and deletes an existing drawing through select mode', async ({ page }) => {
    await page.getByTestId('drawing-tool-line').click({ force: true })
    await clickMap(page, { x: 420, y: 240 })
    await clickMap(page, { x: 560, y: 300 })
    await rightClickMap(page, { x: 560, y: 300 })
    await page.getByTestId('drawing-name-input').fill('Edit Me')
    await page.getByTestId('drawing-save-btn').click()

    await clickMap(page, { x: 490, y: 270 })
    await expect(page.getByTestId('drawing-dialog')).toBeVisible()
    await page.getByTestId('drawing-name-input').fill('Edited Name')
    await page.getByTestId('drawing-save-btn').click()

    let drawings = await readMissionDrawings(page)
    expect(drawings.some((drawing) => drawing.name === 'Edited Name' && drawing.type === 'line')).toBe(true)

    await clickMap(page, { x: 490, y: 270 })
    await expect(page.getByTestId('drawing-dialog')).toBeVisible()
    await page.getByTestId('drawing-delete-btn').click()
    await expect(page.getByTestId('drawing-dialog')).toBeHidden()

    drawings = await readMissionDrawings(page)
    expect(drawings.some((drawing) => drawing.name === 'Edited Name')).toBe(false)
  })

  test('does not open the marker modal while a drawing tool is active', async ({ page }) => {
    await page.getByTestId('drawing-tool-range_ring').click({ force: true })
    await clickMap(page, { x: 500, y: 240 })

    await expect(page.getByTestId('drawing-dialog')).toBeVisible()
    await expect(page.getByTestId('marker-dialog')).toBeHidden()
  })

  test('uses dialog semantics, traps focus, and cancels with Escape', async ({ page }) => {
    await page.getByTestId('drawing-tool-line').click({ force: true })
    await clickMap(page, { x: 420, y: 240 })
    await clickMap(page, { x: 560, y: 300 })
    await rightClickMap(page, { x: 560, y: 300 })

    const dialog = page.getByRole('dialog', { name: 'Line Details' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')

    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('drawing-dialog')).toBeHidden()

    const drawings = await readMissionDrawings(page)
    expect(drawings).toHaveLength(0)
  })
})

async function clickMap(
  page: import('@playwright/test').Page,
  position: { x: number; y: number },
) {
  const target = page.locator('.maplibregl-canvas').first()
  await target.waitFor({ state: 'visible', timeout: 15000 })
  await target.click({ position, force: true })
}

async function rightClickMap(
  page: import('@playwright/test').Page,
  position: { x: number; y: number },
) {
  const target = page.locator('.maplibregl-canvas').first()
  await target.waitFor({ state: 'visible', timeout: 15000 })
  await target.click({ position, button: 'right', force: true })
}

async function readMissionDrawings(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const raw = window.sessionStorage.getItem('sartracker:browser-harness')
    if (raw === null) {
      return []
    }

    const parsed = JSON.parse(raw) as {
      drawings?: Array<{
        name: string
        type: string
        metadata_json: string | null
      }>
    }

    return parsed.drawings ?? []
  })
}
