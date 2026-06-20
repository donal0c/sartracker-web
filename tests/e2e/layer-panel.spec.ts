import { expect, test } from '@playwright/test'

test.describe('M17 layer tree workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    const title = page.getByTestId('app-title')
    await title.waitFor({ state: 'visible', timeout: 10000 })
    await expect(title).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15000 })
    await page.getByTestId('mission-name-input').fill('Layer Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
    await seedLayerPanelData(page)
    await page.getByTestId('sidebar-tab-layers').click()
  })

  test('renders the nested layer tree and inspection workspace', async ({ page }) => {
    await expect(page.getByTestId('layer-tree')).toBeVisible()
    await expect(page.getByTestId('layer-row-group-tracking')).toBeVisible()
    await expect(page.getByTestId('layer-row-group-map-tools')).toBeVisible()
    await expect(page.getByText('Browser session storage only')).toHaveCount(0)
    await expect(page.getByText('SQLite persistence active (WAL mode).')).toHaveCount(0)

    await page.getByTestId('layer-select-feature-device-alpha').click()
    await expect(page.getByTestId('layer-inspector-title')).toContainText('Alpha Team')
    await expect(page.getByTestId('layer-inspector-details')).toContainText('Device ID')
  })

  test('supports search, selection, aliasing, and item visibility', async ({
    page,
  }) => {
    await page.getByTestId('layer-tree-search').fill('Boot')
    await expect(page.getByTestId('layer-row-feature-marker-marker-1')).toBeVisible()
    await expect(page.getByTestId('layer-row-feature-device-alpha')).toBeHidden()

    await page.getByTestId('layer-tree-search').fill('')
    await page.getByTestId('layer-select-layer-markers-clues').click()
    await page.getByTestId('layer-alias-input').fill('Evidence')
    await page.getByTestId('layer-alias-save').click()
    await expect(page.getByTestId('layer-select-layer-markers-clues')).toContainText('Evidence')

    await page.getByTestId('layer-visibility-feature-marker-marker-1').click()
    await expect(page.getByTestId('layer-visibility-feature-marker-marker-1')).not.toBeChecked()
  })

  test('the inert Favorite control is gone from the tree row and inspector', async ({
    page,
  }) => {
    await expect(page.getByTestId('layer-inspector-favorite')).toHaveCount(0)
    await page.getByTestId('layer-select-layer-markers-clues').click()
    await expect(page.getByTestId('layer-inspector-favorite')).toHaveCount(0)
    await expect(page.getByTestId('layer-favorite-feature-device-alpha')).toHaveCount(0)
    await expect(page.getByTestId('layer-inspector-details')).not.toContainText('Favorite')
  })

  test('Move Up reorders a feature item within its layer', async ({ page }) => {
    // Alpha sorts before Bravo by default. Selecting Bravo and moving it up must
    // visibly place Bravo above Alpha in the People layer.
    const peopleItems = page
      .getByTestId('layer-tree')
      .locator('[data-testid^="layer-row-feature-device-"]')

    await expect(peopleItems.first()).toHaveAttribute(
      'data-testid',
      'layer-row-feature-device-alpha',
    )

    await page.getByTestId('layer-select-feature-device-bravo').click()
    const moveUp = page.getByTestId('layer-move-up')
    await expect(moveUp).toBeEnabled()
    await moveUp.click()

    await expect(peopleItems.first()).toHaveAttribute(
      'data-testid',
      'layer-row-feature-device-bravo',
    )
  })

  test('Collapse All hides nested items and Expand All restores them', async ({
    page,
  }) => {
    await expect(page.getByTestId('layer-row-feature-device-alpha')).toBeVisible()

    await page.getByTestId('layer-collapse-all-btn').click()
    await expect(page.getByTestId('layer-row-feature-device-alpha')).toBeHidden()
    await expect(page.getByTestId('layer-row-group-tracking')).toBeVisible()

    await page.getByTestId('layer-expand-all-btn').click()
    await expect(page.getByTestId('layer-row-feature-device-alpha')).toBeVisible()
  })

  test('expanded layer workspace fills available RHS vertical space [DON-132]', async ({
    page,
  }) => {
    const layerPanel = page.getByTestId('layer-panel')
    await expect(layerPanel).toBeVisible()

    // The layer tree should not have a small fixed max-height cap.
    // It should grow to fill the available space in the sidebar tab content.
    const layerTree = page.getByTestId('layer-tree')
    await expect(layerTree).toBeVisible()

    const tabContent = page.locator('[data-testid="operational-sidebar"] [data-testid="sidebar-tab-content"]')
    await expect(tabContent).toBeVisible()

    // The layer panel should use most of the tab content height (at least 60%),
    // not be cramped into a small fixed-height box.
    const tabContentBox = await tabContent.boundingBox()
    const layerPanelBox = await layerPanel.boundingBox()
    expect(tabContentBox).not.toBeNull()
    expect(layerPanelBox).not.toBeNull()
    expect(layerPanelBox!.height).toBeGreaterThan(tabContentBox!.height * 0.6)
  })

  test('preserves expanded tree scroll while the catalog refreshes [DON-187]', async ({
    page,
  }) => {
    await page.getByTestId('layer-expand-all-btn').click()
    const layerTree = page.getByTestId('layer-tree')
    await expect(layerTree).toBeVisible()

    const before = await layerTree.evaluate((element) => {
      element.scrollTop = element.scrollHeight
      return {
        maxScrollTop: element.scrollHeight - element.clientHeight,
        scrollTop: element.scrollTop,
      }
    })
    expect(before.maxScrollTop).toBeGreaterThan(0)
    expect(before.scrollTop).toBeGreaterThan(0)

    await page.evaluate(async () => {
      const { useLayerCatalogStore } = await import('/src/features/layers/layer-catalog-store.ts')
      useLayerCatalogStore.setState((current) => ({ ...current, loading: true }))
    })
    await expect.poll(async () => layerTree.evaluate((element) => element.scrollTop)).toBeGreaterThan(
      before.scrollTop - 5,
    )
    await expect(page.getByTestId('layer-row-feature-marker-marker-1')).toBeVisible()
  })

  test('persists tree metadata and visibility across reload within the mission harness', async ({
    page,
  }) => {
    await page.getByTestId('layer-select-layer-markers-clues').click()
    await page.getByTestId('layer-alias-input').fill('Evidence')
    await page.getByTestId('layer-alias-save').click()
    await page.getByTestId('layer-visibility-feature-device-bravo').click()
    await page.getByTestId('layer-visibility-feature-marker-marker-1').click()

    await page.reload()
    await waitForShell(page)
    await expect(page.getByTestId('mission-recovery-dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Resume' }).click()
    await seedLayerPanelData(page)
    await page.getByTestId('sidebar-tab-layers').click()

    await expect(page.getByTestId('layer-visibility-feature-device-bravo')).not.toBeChecked()
    await expect(page.getByTestId('layer-visibility-feature-marker-marker-1')).not.toBeChecked()
    await expect(page.getByTestId('layer-select-layer-markers-clues')).toContainText('Evidence')
  })
})

async function waitForShell(page: import('@playwright/test').Page) {
  const title = page.getByTestId('app-title')
  await title.waitFor({ state: 'visible', timeout: 10000 })
  await expect(title).toContainText('SAR Tracker')
  await page.waitForSelector('canvas', { timeout: 15000 })
}

async function seedLayerPanelData(page: import('@playwright/test').Page, retries = 1) {
  try {
    await page.evaluate(async () => {
      const [
        { applyTrackingSnapshot },
        { getBrowserHarnessStore },
        { applyDrawingRuntime },
        { applyMarkerRuntime },
      ] =
        await Promise.all([
          import('/src/features/tracking/tracking-store.ts'),
          import('/src/features/browser-validation/browser-harness-store.ts'),
          import('/src/features/drawings/drawing-store.ts'),
          import('/src/features/markers/marker-store.ts'),
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
        breadcrumbs: [
          {
            id: 'breadcrumb-1',
            device_id: 'alpha',
            lat: 52,
            lon: -9.7,
            altitude: null,
            speed: null,
            battery: null,
            accuracy: null,
            timestamp: '2026-04-09T16:00:00.000Z',
            source: null,
            data_origin: 'live',
            cache_age_seconds: null,
            device_cache_stale: false,
          },
        ],
      })

      const harnessStore = getBrowserHarnessStore()
      for (let index = 0; index < 28; index += 1) {
        await harnessStore.upsertMarker({
          id: index === 0 ? 'marker-1' : `marker-${index + 1}`,
          mission_id: missionId,
          type: 'clue',
          name: index === 0 ? 'Boot Print' : `Clue ${String(index + 1).padStart(2, '0')}`,
          lat: 52 + index * 0.0001,
          lon: -9.7 - index * 0.0001,
          irish_grid_e: 480000 + index,
          irish_grid_n: 580000 + index,
          display_order: index + 1,
          clue_type: 'Footprint',
          confidence: 0.8,
        })
      }
      await harnessStore.upsertDrawing({
        id: 'drawing-1',
        mission_id: missionId,
        type: 'search_area',
        name: 'Sector Alpha',
        display_order: 1,
        geometry_json: '{}',
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
