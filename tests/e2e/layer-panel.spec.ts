import { expect, test } from '@playwright/test'

test.describe('M7 layer panel workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    const title = page.getByTestId('app-title'); await title.waitFor({ state: 'visible', timeout: 10000 }); await expect(title).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15000 })
    await page.getByTestId('mission-name-input').fill('Layer Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
    await seedLayerPanelData(page)
  })

  test('shows the panel expanded on the right with people, markers, and drawings sections', async ({ page }) => {
    await expect(page.getByTestId('layer-panel')).toBeVisible()
    await expect(page.getByTestId('layer-section-people')).toBeVisible()
    await expect(page.getByTestId('layer-section-markers')).toBeVisible()
    await expect(page.getByTestId('layer-section-drawings')).toBeVisible()
    await expect(page.getByTestId('layer-device-toggle-alpha')).toBeChecked()
    await expect(page.getByTestId('layer-marker-toggle-clue')).toBeChecked()
    await expect(page.getByTestId('layer-drawing-toggle-drawing-1')).toBeChecked()
  })

  test('supports searching people and toggling panel visibility controls', async ({ page }) => {
    await page.getByTestId('layer-people-search').fill('Bravo')
    await expect(page.getByText('Bravo Team')).toBeVisible()
    await expect(page.getByText('Alpha Team')).toBeHidden()

    await page.getByTestId('layer-device-toggle-bravo').click()
    await expect(page.getByTestId('layer-device-toggle-bravo')).not.toBeChecked()

    await page.getByTestId('layer-panel-toggle').click()
    await expect(page.getByTestId('layer-section-people')).toBeHidden()
    await page.getByTestId('layer-panel-toggle').click()
    await expect(page.getByTestId('layer-section-people')).toBeVisible()
  })

  test('persists layer visibility choices across reload within the mission harness', async ({
    page,
  }) => {
    await page.getByTestId('layer-device-toggle-bravo').click()
    await page.getByTestId('layer-marker-toggle-clue').click()
    await page.getByTestId('layer-drawing-toggle-drawing-1').click()

    await page.reload()

    const title = page.getByTestId('app-title')
    await title.waitFor({ state: 'visible', timeout: 10000 })
    await page.waitForSelector('canvas', { timeout: 15000 })
    await expect(page.getByTestId('mission-recovery-dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Resume' }).click()
    await page.evaluate(async () => {
      const { applyTrackingSnapshot } = await import('/src/features/tracking/tracking-store.ts')
      applyTrackingSnapshot({
        devices: [
          {
            device_id: 'alpha',
            name: 'Alpha Team',
            status: 'online',
            last_seen: '2026-04-09T16:00:00.000Z',
            unique_id: null,
            category: null,
          },
          {
            device_id: 'bravo',
            name: 'Bravo Team',
            status: 'offline',
            last_seen: '2026-04-09T15:40:00.000Z',
            unique_id: null,
            category: null,
          },
        ],
        positions: [],
        breadcrumbs: [],
      })
    })

    await expect(page.getByTestId('layer-device-toggle-bravo')).not.toBeChecked()
    await expect(page.getByTestId('layer-marker-toggle-clue')).not.toBeChecked()
    await expect(page.getByTestId('layer-drawing-toggle-drawing-1')).not.toBeChecked()
  })
})

async function seedLayerPanelData(page: import('@playwright/test').Page, retries = 1) {
  try {
    await page.evaluate(async () => {
      const [{ applyTrackingSnapshot }, { getBrowserHarnessStore }, { applyDrawingRuntime }] =
        await Promise.all([
          import('/src/features/tracking/tracking-store.ts'),
          import('/src/features/browser-validation/browser-harness-store.ts'),
          import('/src/features/drawings/drawing-store.ts'),
        ])
      const raw = window.sessionStorage.getItem('sartracker:browser-harness')
      if (raw === null) {
        throw new Error('Browser harness state was unavailable.')
      }

      const parsed = JSON.parse(raw) as { currentMissionId: string | null }
      const missionId = parsed.currentMissionId
      if (missionId === null) {
        throw new Error('Mission id was unavailable.')
      }

      applyTrackingSnapshot({
        devices: [
          {
            device_id: 'alpha',
            name: 'Alpha Team',
            status: 'online',
            last_seen: '2026-04-09T16:00:00.000Z',
            unique_id: null,
            category: null,
          },
          {
            device_id: 'bravo',
            name: 'Bravo Team',
            status: 'offline',
            last_seen: '2026-04-09T15:40:00.000Z',
            unique_id: null,
            category: null,
          },
        ],
        positions: [],
        breadcrumbs: [],
      })

      const harnessStore = getBrowserHarnessStore()
      await harnessStore.upsertMarker({
        mission_id: missionId,
        type: 'clue',
        name: 'Boot Print',
        lat: 52,
        lon: -9.7,
        irish_grid_e: 480000,
        irish_grid_n: 580000,
        display_order: 1,
        clue_type: 'Footprint',
        confidence: 0.8,
      })
      await harnessStore.upsertDrawing({
        id: 'drawing-1',
        mission_id: missionId,
        type: 'search_area',
        name: 'Sector Alpha',
        display_order: 1,
        geometry_json: '{}',
      })
      applyDrawingRuntime({
        activeMissionId: missionId,
        drawings: await harnessStore.listDrawings(missionId),
        loading: false,
        saving: false,
        error: null,
        activeTool: 'select',
        sketch: null,
        dialog: null,
        selectedDrawingId: null,
      })
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (retries > 0 && message.includes('Execution context was destroyed')) {
      await page.waitForLoadState('domcontentloaded')
      await seedLayerPanelData(page, retries - 1)
      return
    }
    throw error
  }
}
