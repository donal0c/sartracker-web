/**
 * Batch 2 follow-up: Parity tests for LPV-063 (show hidden), LPV-064 (refresh),
 * and LPV-065 (expand all) layer console controls.
 */
import { expect, test, type Page } from '@playwright/test'

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
    await page.getByTestId('mission-name-input').fill('Console Controls')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
    await seedLayerData(page)
    await page.waitForTimeout(500)
    await page.getByTestId('sidebar-tab-layers').click({ force: true })
  })

  test('LPV-063: show-hidden toggle filters hidden items from tree', async ({ page }) => {
    // Verify the toggle exists and defaults to checked (show hidden)
    const toggle = page.getByTestId('layer-show-hidden-toggle').locator('input')
    await expect(toggle).toBeVisible({ timeout: 5000 })
    await expect(toggle).toBeChecked()

    // Hide the marker via the tree checkbox
    const markerToggle = page.getByTestId('layer-visibility-feature-marker-marker-1')
    await expect(markerToggle).toBeVisible({ timeout: 10000 })
    await markerToggle.click()
    await expect(markerToggle).not.toBeChecked()

    // The hidden marker should still appear in the tree (showHidden = true)
    await expect(page.getByTestId('layer-row-feature-marker-marker-1')).toBeVisible()

    // Toggle showHidden off — the hidden marker should disappear from the tree listing
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await expect(page.getByTestId('layer-row-feature-marker-marker-1')).toBeHidden()

    // Toggle showHidden back on — the hidden marker reappears
    await toggle.click()
    await expect(toggle).toBeChecked()
    await expect(page.getByTestId('layer-row-feature-marker-marker-1')).toBeVisible()
  })

  test('LPV-064: refresh button exists and triggers catalog reload', async ({ page }) => {
    const refreshBtn = page.getByTestId('layer-refresh-btn')
    await expect(refreshBtn).toBeVisible({ timeout: 5000 })
    await expect(refreshBtn).toHaveText('Refresh')

    // Click refresh — the catalog should reload without error
    await refreshBtn.click()

    // Verify the tree still renders correctly after refresh
    await expect(page.getByTestId('layer-tree')).toBeVisible()
    await expect(page.getByTestId('layer-row-group-tracking')).toBeVisible()
  })

  test('LPV-065: expand-all button expands all tree nodes', async ({ page }) => {
    const expandAllBtn = page.getByTestId('layer-expand-all-btn')
    await expect(expandAllBtn).toBeVisible({ timeout: 5000 })

    // Collapse the tracking group
    const trackingExpand = page.getByTestId('layer-expand-group-tracking')
    await trackingExpand.click()
    // After collapse, device item should be hidden
    await expect(page.getByTestId('layer-row-feature-device-alpha')).toBeHidden()

    // Click Expand All — the device item should reappear
    await expandAllBtn.click()
    await expect(page.getByTestId('layer-row-feature-device-alpha')).toBeVisible()
  })

  test('LPV-066: collapse-all button collapses all tree nodes', async ({ page }) => {
    const collapseAllBtn = page.getByTestId('layer-collapse-all-btn')
    await expect(collapseAllBtn).toBeVisible({ timeout: 5000 })
    await expect(collapseAllBtn).toHaveText('Collapse All')

    // Device item is visible while the tracking group is expanded
    await expect(page.getByTestId('layer-row-feature-device-alpha')).toBeVisible()

    // Click Collapse All — nested items collapse but top-level groups remain
    await collapseAllBtn.click()
    await expect(page.getByTestId('layer-row-feature-device-alpha')).toBeHidden()
    await expect(page.getByTestId('layer-row-group-tracking')).toBeVisible()
  })
})
