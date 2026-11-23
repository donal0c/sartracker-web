/**
 * Batch 2 follow-up: Parity test for LPV-063 (hidden items stay listed). The
 * LPV-064 to LPV-066 console buttons are not in the new Layers panel (DON-341).
 */
import { expect, test, type Page } from '@playwright/test'
import { expandAllLayers } from './helpers/layers'
import { openMissionPanel, openWorkspacePanel } from './helpers/workspace-panels'

async function waitForShell(page: Page) {
  const title = page.getByTestId('app-title')
  await title.waitFor({ state: 'visible', timeout: 10000 })
  await expect(title).toContainText('SAR Tracker')
  await page.waitForSelector('canvas', { timeout: 15000 })
}

async function seedLayerData(page: Page, retries = 2): Promise<void> {
  try {
    await page.evaluate(async () => {
      const [
        { applyTrackingSnapshot },
        { getBrowserHarnessStore },
        { applyDrawingRuntime },
        { applyMarkerRuntime },
      ] = await Promise.all([
        import('/src/features/tracking/tracking-store.ts'),
        import('/src/features/browser-validation/browser-harness-store.ts'),
        import('/src/features/drawings/drawing-store.ts'),
        import('/src/features/markers/marker-store.ts'),
      ])

      const raw = window.sessionStorage.getItem('sartracker:browser-harness')
      if (raw === null) throw new Error('Harness state unavailable')
      const parsed = JSON.parse(raw) as { currentMissionId: string | null }
      const missionId = parsed.currentMissionId
      if (missionId === null) throw new Error('No active mission')

      applyTrackingSnapshot({
        devices: [
          { device_id: 'alpha', name: 'Alpha Team', status: 'online', last_seen: '2026-04-09T16:00:00.000Z', unique_id: null, category: null },
        ],
        positions: [],
        breadcrumbs: [],
      })

      const harnessStore = getBrowserHarnessStore()
      await harnessStore.upsertMarker({
        id: 'marker-1',
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
      applyMarkerRuntime({
        activeMissionId: missionId,
        markers: await harnessStore.listMarkers(missionId),
        loading: false,
        saving: false,
        error: null,
        dialog: null,
      })
      applyDrawingRuntime({
        activeMissionId: missionId,
        drawings: [],
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
      await seedLayerData(page, retries - 1)
      return
    }
    throw error
  }
}

test.describe('Batch 2 follow-up: layer console controls (LPV-063, LPV-064, LPV-065)', () => {
  test.setTimeout(30_000)

  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    await waitForShell(page)
    await openMissionPanel(page)
    await page.getByTestId('mission-name-input').fill('Console Controls')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'active')
    await seedLayerData(page)
    await page.waitForTimeout(500)
    await openWorkspacePanel(page, 'layers')
  })

  test('LPV-063: hidden items stay listed, unticked, so they can be switched back on', async ({ page }) => {
    // The new Layers panel (DON-341) always lists hidden items; the Show hidden
    // toggle is gone. A hidden item must stay in the tree, unticked.
    await expect(page.getByTestId('layer-show-hidden-toggle')).toHaveCount(0)
    await expandAllLayers(page)

    const markerToggle = page.getByTestId('layer-visibility-feature-marker-marker-1')
    await expect(markerToggle).toBeVisible({ timeout: 10000 })
    await markerToggle.click()
    await expect(markerToggle).not.toBeChecked()
    await expect(page.getByTestId('layer-row-feature-marker-marker-1')).toBeVisible()

    await markerToggle.click()
    await expect(markerToggle).toBeChecked()
  })

  // LPV-064 (Refresh), LPV-065 (Expand All) and LPV-066 (Collapse All) tested
  // buttons the new Layers panel does not have (DON-341). Folding and unfolding
  // one heading is covered in layer-panel.spec.ts.

})
