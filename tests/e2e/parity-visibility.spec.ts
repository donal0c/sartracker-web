/**
 * Batch 1: Critical visibility parity tests (LPV-240 through LPV-247)
 *
 * These tests verify that tree visibility toggles actually flow through
 * to the MapLibre filter state via the Zustand visibility store.
 *
 * The visibility store is the source of truth for all overlay hooks:
 * - use-map-overlays → hiddenDeviceIds, breadcrumbsVisible, markerTypeVisibility, hiddenMarkerIds
 * - use-map-drawing-overlays → drawingTypeVisibility, hiddenDrawingIds
 * - use-map-measurement-overlays → measurementsVisible
 *
 * If the visibility store does not update after a tree toggle, the map cannot change.
 */
import { expect, test, type Page } from '@playwright/test'

async function waitForShell(page: Page) {
  const title = page.getByTestId('app-title')
  await title.waitFor({ state: 'visible', timeout: 10000 })
  await expect(title).toContainText('SAR Tracker')
  await page.waitForSelector('canvas', { timeout: 15000 })
}

/**
 * Reads the current visibility store state from the running app.
 *
 * This is a synchronous read — callers that have just triggered an async cycle
 * (cascade toggle, catalog refresh) should use `expect.poll(() => readVisibilityState(...))`
 * with a predicate, instead of relying on a fixed sleep, so the test waits for
 * the actual condition rather than a guessed propagation delay.
 */
async function readVisibilityState(page: Page) {
  return page.evaluate(async () => {
    const { useLayerVisibilityStore } = await import(
      '/src/features/layers/layer-visibility-store.ts'
    )
    const state = useLayerVisibilityStore.getState()
    return {
      hiddenDeviceIds: [...state.hiddenDeviceIds],
      hiddenMarkerIds: [...state.hiddenMarkerIds],
      hiddenDrawingIds: [...state.hiddenDrawingIds],
      groupVisibility: { ...state.groupVisibility },
      markerTypeVisibility: { ...state.markerTypeVisibility },
      drawingTypeVisibility: { ...state.drawingTypeVisibility },
      breadcrumbsVisible: state.breadcrumbsVisible,
      measurementsVisible: state.measurementsVisible,
      hydratedMissionId: state.hydratedMissionId,
    }
  })
}

async function readMapFilterState(page: Page) {
  return page.evaluate(() => {
    const map = (
      window as Window & {
        __SARTRACKER_MAP__?: {
          getFilter: (layerId: string) => unknown
        }
      }
    ).__SARTRACKER_MAP__

    if (map === undefined) {
      throw new Error('Map instance is unavailable.')
    }

    const readFilter = (layerId: string) =>
      map.getLayer(layerId) === undefined ? null : (map.getFilter(layerId) ?? null)

    return {
      drawingLine: readFilter('mission-drawings-line'),
      drawingLabel: readFilter('mission-drawings-label'),
      clueMarkers: readFilter('mission-markers-symbol-clue'),
    }
  })
}

/** Seeds a mission with tracking, markers, and drawings for visibility testing. */
async function seedVisibilityTestData(page: Page, retries = 2): Promise<void> {
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

    // Seed 2 tracking devices
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
          status: 'online',
          last_seen: '2026-04-09T15:50:00.000Z',
          unique_id: null,
          category: null,
        },
      ],
      positions: [
        {
          id: 'pos-alpha',
          device_id: 'alpha',
          lat: 51.95,
          lon: -9.85,
          altitude: null,
          speed: null,
          battery: null,
          accuracy: null,
          timestamp: '2026-04-09T16:00:00.000Z',
          source: null,
          data_origin: 'live' as const,
          cache_age_seconds: null,
          device_cache_stale: false,
        },
        {
          id: 'pos-bravo',
          device_id: 'bravo',
          lat: 51.96,
          lon: -9.84,
          altitude: null,
          speed: null,
          battery: null,
          accuracy: null,
          timestamp: '2026-04-09T15:50:00.000Z',
          source: null,
          data_origin: 'live' as const,
          cache_age_seconds: null,
          device_cache_stale: false,
        },
      ],
      breadcrumbs: [
        {
          id: 'bc-alpha-1',
          device_id: 'alpha',
          lat: 51.94,
          lon: -9.86,
          altitude: null,
          speed: null,
          battery: null,
          accuracy: null,
          timestamp: '2026-04-09T15:55:00.000Z',
          source: null,
          data_origin: 'live' as const,
          cache_age_seconds: null,
          device_cache_stale: false,
        },
        {
          id: 'bc-bravo-1',
          device_id: 'bravo',
          lat: 51.955,
          lon: -9.845,
          altitude: null,
          speed: null,
          battery: null,
          accuracy: null,
          timestamp: '2026-04-09T15:45:00.000Z',
          source: null,
          data_origin: 'live' as const,
          cache_age_seconds: null,
          device_cache_stale: false,
        },
      ],
    })

    const harnessStore = getBrowserHarnessStore()

    // Seed markers: 1 clue, 1 hazard
    await harnessStore.upsertMarker({
      id: 'marker-clue-1',
      mission_id: missionId,
      type: 'clue',
      name: 'Boot Print',
      lat: 51.95,
      lon: -9.85,
      irish_grid_e: 480000,
      irish_grid_n: 580000,
      display_order: 1,
      clue_type: 'Footprint',
      confidence: 0.8,
    })
    await harnessStore.upsertMarker({
      id: 'marker-hazard-1',
      mission_id: missionId,
      type: 'hazard',
      name: 'Cliff Edge',
      lat: 51.96,
      lon: -9.84,
      irish_grid_e: 481000,
      irish_grid_n: 581000,
      display_order: 2,
      hazard_type: 'Cliff',
      hazard_severity: 'High',
    })

    // Seed drawings: 1 line, 1 range_ring
    await harnessStore.upsertDrawing({
      id: 'drawing-line-1',
      mission_id: missionId,
      type: 'line',
      name: 'Route Alpha',
      display_order: 1,
      geometry_json: JSON.stringify({
        type: 'LineString',
        coordinates: [
          [-9.86, 51.94],
          [-9.85, 51.95],
          [-9.84, 51.96],
        ],
      }),
    })
    await harnessStore.upsertDrawing({
      id: 'drawing-ring-1',
      mission_id: missionId,
      type: 'range_ring',
      name: 'IPP Rings',
      display_order: 2,
      geometry_json: JSON.stringify({
        type: 'Point',
        coordinates: [-9.85, 51.95],
      }),
      metadata_json: JSON.stringify({
        mode: 'manual',
        radii: [500, 1000, 2000],
      }),
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
      await seedVisibilityTestData(page, retries - 1)
      return
    }
    throw error
  }
}

test.describe('Batch 1: Critical visibility parity (LPV-240 to LPV-247)', () => {
  test.setTimeout(45_000)

  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    await waitForShell(page)
    await page.getByTestId('mission-name-input').fill('Visibility Test')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
    await seedVisibilityTestData(page)
    // Wait for the catalog runtime to ingest the seeded data and surface the
    // expected device/marker/drawing nodes. State-based wait keeps the test
    // robust under load instead of guessing a propagation delay.
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const { useLayerCatalogStore } = await import(
              '/src/features/layers/layer-catalog-store.ts'
            )
            const root = useLayerCatalogStore.getState().root
            const featureIds = root.children
              .flatMap((group) => group.children)
              .flatMap((layer) => layer.children.map((feature) => feature.id))
            return featureIds
          }),
        { timeout: 10_000 },
      )
      .toEqual(
        expect.arrayContaining([
          'feature:device:alpha',
          'feature:device:bravo',
          'feature:marker:marker-clue-1',
          'feature:drawing:drawing-line-1',
        ]),
      )
    await page.getByTestId('sidebar-tab-layers').click()
  })

  test('LPV-240: per-device tracking visibility toggle propagates to visibility store', async ({
    page,
  }) => {
    // Verify initial state: no hidden devices
    const before = await readVisibilityState(page)
    expect(before.hiddenDeviceIds).toEqual([])

    // Find and click the Bravo device visibility toggle in the tree
    const bravoToggle = page.getByTestId('layer-visibility-feature-device-bravo')
    await expect(bravoToggle).toBeVisible({ timeout: 10000 })
    await expect(bravoToggle).toBeChecked()
    await bravoToggle.click()
    await expect(bravoToggle).not.toBeChecked()

    // CRITICAL: Does the visibility store now contain bravo as hidden?
    const after = await readVisibilityState(page)
    expect(after.hiddenDeviceIds).toContain('bravo')
    expect(after.hiddenDeviceIds).not.toContain('alpha')

    // Re-show: toggle again
    await bravoToggle.click()
    await expect(bravoToggle).toBeChecked()

    const restored = await readVisibilityState(page)
    expect(restored.hiddenDeviceIds).not.toContain('bravo')
  })

  test('LPV-241: marker-type visibility toggle propagates to visibility store', async ({
    page,
  }) => {
    // Verify initial state: all marker types visible
    const before = await readVisibilityState(page)
    expect(before.markerTypeVisibility.clue).toBe(true)
    expect(before.markerTypeVisibility.hazard).toBe(true)

    // Toggle clue layer visibility off
    const clueLayerToggle = page.getByTestId('layer-visibility-layer-markers-clues')
    await expect(clueLayerToggle).toBeVisible({ timeout: 10000 })
    await clueLayerToggle.click()
    await expect(clueLayerToggle).not.toBeChecked()

    // CRITICAL: Does the visibility store now show clue=false?
    const after = await readVisibilityState(page)
    expect(after.markerTypeVisibility.clue).toBe(false)
    // Hazard must remain visible
    expect(after.markerTypeVisibility.hazard).toBe(true)
  })

  test('LPV-242: individual marker visibility toggle propagates to visibility store', async ({
    page,
  }) => {
    const before = await readVisibilityState(page)
    expect(before.hiddenMarkerIds).toEqual([])

    // Toggle individual clue marker visibility
    const markerToggle = page.getByTestId('layer-visibility-feature-marker-marker-clue-1')
    await expect(markerToggle).toBeVisible({ timeout: 10000 })
    await markerToggle.click()
    await expect(markerToggle).not.toBeChecked()

    const after = await readVisibilityState(page)
    expect(after.hiddenMarkerIds).toContain('marker-clue-1')
    // Hazard marker must NOT be hidden
    expect(after.hiddenMarkerIds).not.toContain('marker-hazard-1')
  })

  test('LPV-243: drawing-type visibility toggle propagates to visibility store', async ({
    page,
  }) => {
    const before = await readVisibilityState(page)
    expect(before.drawingTypeVisibility.range_ring).toBe(true)
    expect(before.drawingTypeVisibility.line).toBe(true)

    // Toggle range_ring layer visibility off
    const ringLayerToggle = page.getByTestId('layer-visibility-layer-drawings-range-ring')
    await expect(ringLayerToggle).toBeVisible({ timeout: 10000 })
    await ringLayerToggle.click()

    const after = await readVisibilityState(page)
    expect(after.drawingTypeVisibility.range_ring).toBe(false)
    expect(after.drawingTypeVisibility.line).toBe(true)
  })

  test('LPV-244: individual drawing visibility toggle propagates to visibility store', async ({
    page,
  }) => {
    const before = await readVisibilityState(page)
    expect(before.hiddenDrawingIds).toEqual([])

    const drawingToggle = page.getByTestId('layer-visibility-feature-drawing-drawing-line-1')
    await expect(drawingToggle).toBeVisible({ timeout: 10000 })
    await drawingToggle.click()

    const after = await readVisibilityState(page)
    expect(after.hiddenDrawingIds).toContain('drawing-line-1')
    expect(after.hiddenDrawingIds).not.toContain('drawing-ring-1')
  })

  test('LPV-245: measurement visibility toggle propagates to visibility store', async ({
    page,
  }) => {
    const before = await readVisibilityState(page)
    expect(before.measurementsVisible).toBe(true)

    // Toggle measurement layer visibility
    const measurementToggle = page.getByTestId(
      'layer-visibility-layer-map-tools-measurements',
    )
    await expect(measurementToggle).toBeVisible({ timeout: 10000 })
    await measurementToggle.click()

    const after = await readVisibilityState(page)
    expect(after.measurementsVisible).toBe(false)

    // Re-show
    await measurementToggle.click()
    const restored = await readVisibilityState(page)
    expect(restored.measurementsVisible).toBe(true)
  })

  test('LPV-246: group visibility cascade propagates to visibility store', async ({
    page,
  }) => {
    // Verify initial: no hidden devices
    const before = await readVisibilityState(page)
    expect(before.hiddenDeviceIds).toEqual([])

    // Toggle the entire "Tracking" group off
    const trackingGroupToggle = page.getByTestId('layer-visibility-group-tracking')
    await expect(trackingGroupToggle).toBeVisible({ timeout: 10000 })
    await trackingGroupToggle.click()

    // CRITICAL: Are all devices now hidden in the visibility store?
    // Poll the actual condition rather than guessing the cascade-persist delay.
    await expect
      .poll(async () => (await readVisibilityState(page)).hiddenDeviceIds.sort(), {
        timeout: 5_000,
      })
      .toEqual(['alpha', 'bravo'])
    await expect
      .poll(async () => (await readVisibilityState(page)).breadcrumbsVisible, {
        timeout: 5_000,
      })
      .toBe(false)

    // Re-enable group
    await trackingGroupToggle.click()

    await expect
      .poll(async () => (await readVisibilityState(page)).hiddenDeviceIds, {
        timeout: 5_000,
      })
      .toEqual([])
    await expect
      .poll(async () => (await readVisibilityState(page)).breadcrumbsVisible, {
        timeout: 5_000,
      })
      .toBe(true)
  })

  test('LPV-246a: Map Tools group visibility cascade propagates to all map-tool runtime channels', async ({
    page,
  }) => {
    const before = await readVisibilityState(page)
    const beforeFilters = await readMapFilterState(page)
    expect(before.groupVisibility.mapTools).toBe(true)
    expect(before.markerTypeVisibility.clue).toBe(true)
    expect(before.drawingTypeVisibility.range_ring).toBe(true)
    expect(before.measurementsVisible).toBe(true)
    expect(JSON.stringify(beforeFilters.drawingLabel)).not.toContain('__hidden__')
    expect(JSON.stringify(beforeFilters.clueMarkers)).not.toContain('__hidden__')

    const mapToolsGroupToggle = page.getByTestId('layer-visibility-group-map-tools')
    await expect(mapToolsGroupToggle).toBeVisible({ timeout: 10000 })
    await mapToolsGroupToggle.click()

    // Wait on the actual cascade signal (mapTools group flag flipped) rather than
    // a fixed delay; everything else under it propagates synchronously by then.
    await expect
      .poll(async () => (await readVisibilityState(page)).groupVisibility.mapTools, {
        timeout: 5_000,
      })
      .toBe(false)

    const after = await readVisibilityState(page)
    expect(after.groupVisibility.mapTools).toBe(false)
    expect(after.markerTypeVisibility.clue).toBe(false)
    expect(after.markerTypeVisibility.hazard).toBe(false)
    expect(after.drawingTypeVisibility.line).toBe(false)
    expect(after.drawingTypeVisibility.range_ring).toBe(false)
    expect(after.hiddenDrawingIds).toContain('drawing-line-1')
    expect(after.hiddenDrawingIds).toContain('drawing-ring-1')
    expect(after.measurementsVisible).toBe(false)
    await expect
      .poll(async () => JSON.stringify((await readMapFilterState(page)).drawingLabel), {
        timeout: 5000,
      })
      .toContain('__hidden__')
    await expect
      .poll(async () => JSON.stringify((await readMapFilterState(page)).clueMarkers), {
        timeout: 5000,
      })
      .toContain('__hidden__')

    await mapToolsGroupToggle.click()
    await expect
      .poll(async () => (await readVisibilityState(page)).groupVisibility.mapTools, {
        timeout: 5_000,
      })
      .toBe(true)

    const restored = await readVisibilityState(page)
    await expect
      .poll(async () => JSON.stringify((await readMapFilterState(page)).drawingLabel), {
        timeout: 5000,
      })
      .not.toContain('__hidden__')
    await expect
      .poll(async () => JSON.stringify((await readMapFilterState(page)).clueMarkers), {
        timeout: 5000,
      })
      .not.toContain('__hidden__')
    expect(restored.groupVisibility.mapTools).toBe(true)
    expect(restored.markerTypeVisibility.clue).toBe(true)
    expect(restored.markerTypeVisibility.hazard).toBe(true)
    expect(restored.drawingTypeVisibility.line).toBe(true)
    expect(restored.drawingTypeVisibility.range_ring).toBe(true)
    expect(restored.hiddenDrawingIds).toEqual([])
    expect(restored.measurementsVisible).toBe(true)
  })

  test('LPV-247: tree/canvas synchronization — repeated toggles maintain consistency', async ({
    page,
  }) => {
    // Toggle device off and on rapidly
    const bravoToggle = page.getByTestId('layer-visibility-feature-device-bravo')
    await expect(bravoToggle).toBeVisible({ timeout: 10000 })

    // Rapid toggle sequence
    await bravoToggle.click()
    const state1 = await readVisibilityState(page)
    expect(state1.hiddenDeviceIds).toContain('bravo')

    await bravoToggle.click()
    const state2 = await readVisibilityState(page)
    expect(state2.hiddenDeviceIds).not.toContain('bravo')

    // Toggle marker type
    const clueToggle = page.getByTestId('layer-visibility-layer-markers-clues')
    await expect(clueToggle).toBeVisible({ timeout: 10000 })
    await clueToggle.click()
    const state3 = await readVisibilityState(page)
    expect(state3.markerTypeVisibility.clue).toBe(false)

    await clueToggle.click()
    const state4 = await readVisibilityState(page)
    expect(state4.markerTypeVisibility.clue).toBe(true)

    // Toggle drawing type
    const lineToggle = page.getByTestId('layer-visibility-layer-drawings-line')
    await expect(lineToggle).toBeVisible({ timeout: 10000 })
    await lineToggle.click()
    const state5 = await readVisibilityState(page)
    expect(state5.drawingTypeVisibility.line).toBe(false)
  })
})
