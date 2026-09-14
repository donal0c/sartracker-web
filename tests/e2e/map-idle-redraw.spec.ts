import { expect, test, type Page } from '@playwright/test'
import { createSyntheticRasterTilePng } from '../../build/electron-official-map-qualification-smoke-lib.js'

const TRACKING_DEVICE_LAYER_ID = 'tracking-devices-circle'
const TRACKING_BREADCRUMB_LAYER_ID = 'tracking-breadcrumbs-line'
const IDLE_SAMPLE_MS = 350

type StyleWrite = {
  readonly method: 'setFilter' | 'setPaintProperty'
  readonly layerId: string
  readonly property?: string
}

type StyleWriteWindow = Window & {
  __AUD04_STYLE_WRITES__?: StyleWrite[]
  __AUD04_RENDER_EVENTS__?: number
}

type MapProbe = {
  readonly isStyleLoaded: () => boolean
  readonly getLayer: (layerId: string) => unknown
  readonly getFilter: (layerId: string) => unknown
  readonly getPaintProperty: (layerId: string, property: string) => unknown
  readonly queryRenderedFeatures: (
    geometry?: unknown,
    options?: { readonly layers?: readonly string[] },
  ) => readonly unknown[]
  readonly querySourceFeatures: (sourceId: string) => readonly unknown[]
  readonly setFilter: (layerId: string, filter: unknown, options?: unknown) => unknown
  readonly setPaintProperty: (
    layerId: string,
    property: string,
    value: unknown,
    options?: unknown,
  ) => unknown
  readonly fire: (eventName: string) => unknown
  readonly on?: (eventName: string, listener: () => void) => unknown
  readonly off?: (eventName: string, listener: () => void) => unknown
}

type HarnessWindow = Window & {
  __SARTRACKER_MAP__?: MapProbe
  __SARTRACKER_BROWSER_HARNESS__?: {
    readonly injectTrackingSnapshot: (snapshot: unknown, status?: unknown) => Promise<void>
  }
}

type StyleWriteSample = {
  readonly writeCount: number
  readonly writes: readonly StyleWrite[]
  readonly renderEvents: number
}

test.describe('AUD-04 MapLibre idle redraw regression', () => {
  test('keeps quiet idle free of redundant style writes and preserves live overlay sync', async ({
    page,
  }) => {
    test.setTimeout(30_000)
    await installSyntheticRasterFixture(page)
    if (process.env.SARTRACKER_AUD04_BASELINE === '1') {
      await installBaselineTrackingModule(page)
    }

    await page.goto('/?missionHarness=1')
    await expect(page.getByTestId('app-title')).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15_000 })

    await page.getByTestId('mission-name-input').fill('AUD-04 idle redraw')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
    await injectRenderedTrackingFixture(page)
    await waitForRenderedTrackingOverlay(page)
    // Let MapLibre finish the source/tile work caused by the fixture before
    // the bounded idle measurement begins.
    await page.waitForTimeout(1_000)

    await installStyleWriteProbe(page)

    // Control: once the real MapLibre style and overlays are settled, a bounded
    // window with no map event or operator state change must remain quiet.
    const quietWindow = await sampleStyleWrites(page, IDLE_SAMPLE_MS)
    expect(quietWindow.writeCount, JSON.stringify(quietWindow)).toBe(0)
    expect(quietWindow.renderEvents, JSON.stringify(quietWindow)).toBe(0)

    // Causal trigger: the style-sync listeners are subscribed to MapLibre's
    // idle event. Firing exactly one idle event exercises that path while the
    // rendered source, layers, and camera remain unchanged.
    const idleWindow = await sampleIdleStyleWrites(page, IDLE_SAMPLE_MS)
    expect(idleWindow.idleEvents, JSON.stringify(idleWindow)).toBeGreaterThan(0)
    expect(idleWindow.writeCount, JSON.stringify(idleWindow)).toBe(0)
    expect(idleWindow.renderEvents, JSON.stringify(idleWindow)).toBe(0)

    // Legitimate control: a visibility change must still reach the rendered
    // MapLibre layer and produce a real filter write.
    await page.evaluate(async () => {
      const { useLayerVisibilityStore } = await import(
        '/src/features/layers/layer-visibility-store.ts'
      )
      const store = useLayerVisibilityStore.getState()
      store.showAllDevices()
      store.toggleDeviceVisibility('alpha')
    })
    await expect.poll(
      () => readStyleWrites(page).then((writes) => writes.some(
        (write) => write.method === 'setFilter' && write.layerId === TRACKING_DEVICE_LAYER_ID,
      )),
      { timeout: 5_000 },
    ).toBe(true)
    await expect.poll(
      () => readRenderedTrackingDeviceCount(page),
      { timeout: 5_000 },
    ).toBe(0)

    await page.evaluate(async () => {
      const { useLayerVisibilityStore } = await import(
        '/src/features/layers/layer-visibility-store.ts'
      )
      useLayerVisibilityStore.getState().showAllDevices()
    })
    await expect.poll(() => readRenderedTrackingDeviceCount(page), { timeout: 5_000 })
      .toBeGreaterThan(0)

    // Style control: changing the basemap recreates the style, and the
    // application must reattach the operational tracking layers afterwards.
    await page.getByTestId('basemap-menu-toggle').click()
    await page.getByTestId('basemap-btn-esri_topo').click()
    await expect(page.getByTestId('basemap-menu-toggle')).toContainText('ESRI World Topo')
    await waitForRenderedTrackingOverlay(page)
    expect(await readMapOverlayState(page)).toMatchObject({
      deviceLayerPresent: true,
      breadcrumbLayerPresent: true,
    })
  })
})

/** Serves deterministic synthetic raster pixels for every external tile request. */
async function installSyntheticRasterFixture(page: Page): Promise<void> {
  const tile = createSyntheticRasterTilePng('a')
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: tile,
    }),
  )
}

/** Reverts only the browser module response to the pre-AUD-04 direct writes. */
async function installBaselineTrackingModule(page: Page): Promise<void> {
  await page.route('**/src/features/tracking/sync-tracking-overlay.ts*', async (route) => {
    const response = await route.fetch()
    const transformedSource = await response.text()
    const filterCallCount = transformedSource.match(/setMapFilterIfChanged\(map, /g)?.length ?? 0
    const paintCallCount = transformedSource.match(/setMapPaintPropertyIfChanged\(map, /g)?.length ?? 0
    if (filterCallCount === 0 || paintCallCount === 0) {
      throw new Error(
        `Baseline source substitution found no conditional tracking writes (filters=${filterCallCount}, paints=${paintCallCount}).`,
      )
    }
    const baselineSource = transformedSource
      .replaceAll('setMapFilterIfChanged(map, ', 'map.setFilter(')
      .replaceAll('setMapPaintPropertyIfChanged(map, ', 'map.setPaintProperty(')
    await route.fulfill({ response, body: baselineSource })
  })
}

/** Injects one in-view device and breadcrumb trail through the browser harness. */
async function injectRenderedTrackingFixture(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const harness = (window as HarnessWindow).__SARTRACKER_BROWSER_HARNESS__
    if (harness === undefined) {
      throw new Error('Browser harness API unavailable.')
    }
    const { useMissionStore } = await import('/src/features/mission/mission-store.ts')
    const { useActiveMissionDevicesStore } = await import(
      '/src/features/tracking/active-mission-devices-store.ts'
    )
    const missionId = useMissionStore.getState().currentMission?.id
    if (missionId === undefined) {
      throw new Error('Mission store did not expose the active synthetic mission.')
    }
    useActiveMissionDevicesStore.getState().setDeviceActive(missionId, 'alpha', true)
    await harness.injectTrackingSnapshot({
      devices: [{
        device_id: 'alpha',
        name: 'Alpha Team',
        status: 'online',
        last_seen: '2026-09-14T10:00:00.000Z',
        unique_id: null,
        category: 'person',
      }],
      positions: [{
        id: 'position-alpha',
        device_id: 'alpha',
        lat: 51.9985,
        lon: -9.7426,
        altitude: 320,
        speed: 1,
        battery: 85,
        accuracy: 8,
        timestamp: '2026-09-14T10:00:00.000Z',
        source: 'synthetic',
        data_origin: 'live',
        cache_age_seconds: null,
        device_cache_stale: false,
      }],
      breadcrumbs: [{
        id: 'breadcrumb-alpha',
        device_id: 'alpha',
        lat: 51.9975,
        lon: -9.7416,
        altitude: 315,
        speed: 1,
        battery: 86,
        accuracy: 8,
        timestamp: '2026-09-14T09:59:00.000Z',
        source: 'synthetic',
        data_origin: 'live',
        cache_age_seconds: null,
        device_cache_stale: false,
      }],
    }, {
      mode: 'online',
      consecutiveFailures: 0,
      recovered: false,
      lastSuccessAt: '2026-09-14T10:00:01.000Z',
      warning: null,
    })
  })
}

/** Waits for the real MapLibre style and both operational tracking layers. */
async function waitForRenderedTrackingOverlay(page: Page): Promise<void> {
  await expect.poll(
    () => page.evaluate(({ deviceLayerId, breadcrumbLayerId }) => {
      const map = (window as HarnessWindow).__SARTRACKER_MAP__
      return map !== undefined && map.isStyleLoaded() &&
        map.getLayer(deviceLayerId) !== undefined &&
        map.getLayer(breadcrumbLayerId) !== undefined
    }, {
      deviceLayerId: TRACKING_DEVICE_LAYER_ID,
      breadcrumbLayerId: TRACKING_BREADCRUMB_LAYER_ID,
    }),
    { timeout: 15_000 },
  ).toBe(true)
  await expect.poll(
    () => readRenderedTrackingDiagnostics(page).then((diagnostics) =>
      diagnostics.renderedDeviceCount > 0 && diagnostics.sourceFeatureCount > 0,
    ),
    { timeout: 10_000 },
  ).toBe(true)
}

/** Installs spies on the actual MapLibre instance used by the rendered map. */
async function installStyleWriteProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const map = (window as HarnessWindow).__SARTRACKER_MAP__
    if (map === undefined) {
      throw new Error('Map instance unavailable.')
    }
    const host = window as StyleWriteWindow
    const writes: StyleWrite[] = []
    host.__AUD04_STYLE_WRITES__ = writes
    host.__AUD04_RENDER_EVENTS__ = 0
    const onRender = () => {
      host.__AUD04_RENDER_EVENTS__ = (host.__AUD04_RENDER_EVENTS__ ?? 0) + 1
    }
    map.on?.('render', onRender)
    const originalSetFilter = map.setFilter.bind(map)
    map.setFilter = (layerId, filter, options) => {
      writes.push({ method: 'setFilter', layerId })
      return originalSetFilter(layerId, filter, options)
    }
    const originalSetPaintProperty = map.setPaintProperty.bind(map)
    map.setPaintProperty = (layerId, property, value, options) => {
      writes.push({ method: 'setPaintProperty', layerId, property })
      return originalSetPaintProperty(layerId, property, value, options)
    }
  })
}

/** Samples MapLibre style writes without injecting any synthetic map event. */
async function sampleStyleWrites(page: Page, durationMs: number): Promise<StyleWriteSample> {
  await page.waitForTimeout(durationMs)
  return readStyleWriteSample(page)
}

/** Fires one real MapLibre idle event and samples the following bounded window. */
async function sampleIdleStyleWrites(page: Page, durationMs: number): Promise<StyleWriteSample & {
  readonly idleEvents: number
}> {
  return page.evaluate(async (sampleDurationMs) => {
    const map = (window as HarnessWindow).__SARTRACKER_MAP__
    if (map === undefined) {
      throw new Error('Map instance unavailable.')
    }
    let idleEvents = 0
    const onIdle = () => { idleEvents += 1 }
    map.on?.('idle', onIdle)
    map.fire('idle')
    await new Promise<void>((resolve) => window.setTimeout(resolve, sampleDurationMs))
    map.off?.('idle', onIdle)
    const writes = (window as StyleWriteWindow).__AUD04_STYLE_WRITES__ ?? []
    return {
      idleEvents,
      writeCount: writes.length,
      writes: writes.slice(0, 16),
      renderEvents: (window as StyleWriteWindow).__AUD04_RENDER_EVENTS__ ?? 0,
    }
  }, durationMs)
}

/** Reads the bounded style-write log exposed by the browser probe. */
async function readStyleWrites(page: Page): Promise<readonly StyleWrite[]> {
  return page.evaluate(() => [
    ...((window as StyleWriteWindow).__AUD04_STYLE_WRITES__ ?? []),
  ])
}

/** Reads bounded setter and real MapLibre render-event counts. */
async function readStyleWriteSample(page: Page): Promise<StyleWriteSample> {
  return page.evaluate(() => {
    const writes = (window as StyleWriteWindow).__AUD04_STYLE_WRITES__ ?? []
    return {
      writeCount: writes.length,
      writes: writes.slice(0, 16),
      renderEvents: (window as StyleWriteWindow).__AUD04_RENDER_EVENTS__ ?? 0,
    }
  })
}

/** Reads actual rendered device features from MapLibre's device layer. */
async function readRenderedTrackingDeviceCount(page: Page): Promise<number> {
  return page.evaluate((deviceLayerId) => {
    const map = (window as HarnessWindow).__SARTRACKER_MAP__
    if (map === undefined) {
      return 0
    }
    return map.queryRenderedFeatures(undefined, {
      layers: [deviceLayerId],
    }).length
  }, TRACKING_DEVICE_LAYER_ID)
}

/** Reports source and rendered feature counts when the real map is settling. */
async function readRenderedTrackingDiagnostics(page: Page): Promise<{
  readonly renderedDeviceCount: number
  readonly sourceFeatureCount: number
  readonly zoom: number | null
}> {
  return page.evaluate((deviceLayerId) => {
    const map = (window as HarnessWindow).__SARTRACKER_MAP__
    if (map === undefined) {
      return { renderedDeviceCount: 0, sourceFeatureCount: 0, zoom: null }
    }
    const sourceFeatureCount = map.querySourceFeatures('tracking').length
    const renderedDeviceCount = map.queryRenderedFeatures(undefined, {
      layers: [deviceLayerId],
    }).length
    return {
      renderedDeviceCount,
      sourceFeatureCount,
      zoom: null,
    }
  }, TRACKING_DEVICE_LAYER_ID)
}

/** Reads the style structure after a basemap replacement. */
async function readMapOverlayState(page: Page): Promise<{
  readonly deviceLayerPresent: boolean
  readonly breadcrumbLayerPresent: boolean
}> {
  return page.evaluate(({ deviceLayerId, breadcrumbLayerId }) => {
    const map = (window as HarnessWindow).__SARTRACKER_MAP__
    return {
      deviceLayerPresent: map?.getLayer(deviceLayerId) !== undefined,
      breadcrumbLayerPresent: map?.getLayer(breadcrumbLayerId) !== undefined,
    }
  }, {
    deviceLayerId: TRACKING_DEVICE_LAYER_ID,
    breadcrumbLayerId: TRACKING_BREADCRUMB_LAYER_ID,
  })
}
