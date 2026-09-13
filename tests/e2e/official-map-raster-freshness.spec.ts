import { expect, test, type Page, type Route } from '@playwright/test'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { DEFAULT_APP_SETTINGS } from '../../src/features/settings/settings-types'
import { createSyntheticRasterTilePng, installOfficialMapRenderCapture } from '../../build/electron-official-map-qualification-smoke-lib.js'

type Variant = 'a' | 'b'
type TestWindow = Window & {
  __SARTRACKER_MAP__: MapLibreMap
  __WAR11_MUTATE_RASTER__: (variant: Variant | 'missing', repeat?: boolean) => void
  __WAR11_GPU__: {latest: {sampledPixels: number[][]} | null; cleanup: () => void}
}
const palettes = {a: [[44, 62, 103], [114, 210, 182]], b: [[36, 79, 69], [240, 201, 77]]}

test.use({viewport: {width: 1440, height: 1100}})

/** Uses real MapLibre rendering with an explicitly synthetic native package bridge. */
async function openSyntheticMap(page: Page, variant: Variant): Promise<void> {
  const a = createSyntheticRasterTilePng('a').toString('base64')
  const b = createSyntheticRasterTilePng('b').toString('base64')
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, route => route.fulfill({
    contentType: 'image/png', body: Buffer.from(a, 'base64'),
  }))
  await page.goto('/?missionHarness=1')
  await expect(page.getByTestId('app-title')).toContainText('SAR Tracker')
  await expect(page.locator('canvas').first()).toBeVisible()
  await page.evaluate(({defaults, a, b, initial}) => {
    let variant: 'a' | 'b' | 'missing' = initial
    const listeners = new Set<() => void>()
    const settings = {...defaults, officialMaps: {...defaults.officialMaps, packages: [{
      id: 'synthetic-raster', mapId: 'official_discovery_topo', sourceType: 'mbtiles',
      packagePath: '/synthetic/same-path.mbtiles', status: 'ready',
      bounds: [-11, 50, -5, 56], minZoom: 0, maxZoom: 19, tileCount: 1, tileFormat: 'png',
      createdAt: '2026-09-13T10:00:00.000Z', verifiedAt: '2026-09-13T10:00:00.000Z',
      message: 'Synthetic raster package', attestation: {version: 1, schemaVersion: 1,
        decoderPolicy: 'native-raster-256-or-512-opaque-v1', sha256: initial.repeat(64), identity: initial},
    }]}}
    const bridge = {
      loadAppSettings: async () => structuredClone(settings),
      fetchOfficialMapTile: async () => {
        if (variant === 'missing') throw new Error('Synthetic package is missing')
        return {contentType: 'image/png', bytesBase64: variant === 'a' ? a : b}
      },
      checkOfficialMapView: async (request: {mapId: string; bounds: object; zoom: number}) => ({
        ...request, status: variant === 'missing' ? 'missing' : 'complete',
        totalTiles: 4, usableTiles: variant === 'missing' ? 0 : 4, checkedAt: new Date().toISOString(),
        packageIdentities: variant === 'missing' ? [] : [{id: 'synthetic-raster', sha256: variant.repeat(64)}],
        message: 'Synthetic native coverage result',
      }),
      onOfficialMapPackagesChanged: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
    Object.defineProperty(window, 'sartrackerElectron', {configurable: true, value: bridge})
    Object.defineProperty(window, '__WAR11_MUTATE_RASTER__', {configurable: true,
      value: (next: 'a' | 'b' | 'missing', repeat = false) => {
        variant = next
        const pkg = settings.officialMaps.packages[0]!
        pkg.status = next === 'missing' ? 'missing' : 'ready'
        pkg.attestation = {...pkg.attestation, sha256: next.repeat(64), identity: next}
        for (const listener of [...listeners]) listener()
        if (repeat) for (const listener of [...listeners]) listener()
      },
    })
    window.dispatchEvent(new Event('sartracker:settings-updated'))
  }, {defaults: DEFAULT_APP_SETTINGS, a, b, initial: variant})
  await page.getByTestId('basemap-menu-toggle').click()
  await page.getByTestId('basemap-btn-official_discovery_topo').click()
  await page.getByTestId('basemap-menu-toggle').click()
  await page.evaluate(installOfficialMapRenderCapture, {
    key: '__WAR11_GPU__', sourceId: 'official_discovery_topo', deadlineAt: Date.now() + 60_000,
  })
  await expectPalette(page, variant)
  await page.getByTestId('check-offline-map-coverage').click()
  await expect(page.getByTestId('field-readiness-checklist')).toContainText('Field ready')
}

/** Samples inside MapLibre's real render callback, independently of global loaded state. */
async function expectPalette(page: Page, expected: Variant | 'none'): Promise<void> {
  await expect.poll(() => page.evaluate(({palettes, expected}) => {
    const latest = (window as TestWindow).__WAR11_GPU__.latest
    if (latest === null) return false
    const has = (variant: 'a' | 'b') => latest.sampledPixels.some(pixel =>
      palettes[variant].some(palette => palette.every((value, i) => Math.abs(pixel[i]! - value) <= 16)))
    return expected === 'none' ? !has('a') && !has('b') : has(expected) && !has(expected === 'a' ? 'b' : 'a')
  }, {palettes, expected}), {timeout: 10_000, message: `Expected only ${expected} raster pixels`}).toBe(true)
}

/** Keeps a genuine unrelated GeoJSON source pending without changing MapLibre's predicates. */
async function addPendingOverlay(page: Page): Promise<() => Promise<void>> {
  let pending: Route | undefined
  await page.route('**/war11-pending-overlay.geojson', route => { pending = route })
  await Promise.all([
    page.waitForRequest('**/war11-pending-overlay.geojson'),
    page.evaluate(() => {
      const map = (window as TestWindow).__SARTRACKER_MAP__
      map.addSource('war11-unrelated-pending', {type: 'geojson', data: '/war11-pending-overlay.geojson'})
      map.addLayer({id: 'war11-unrelated-overlay', type: 'circle', source: 'war11-unrelated-pending'})
    }),
  ])
  await expect.poll(() => page.evaluate(() => (window as TestWindow).__SARTRACKER_MAP__.isStyleLoaded())).toBe(false)
  return async () => { await pending?.fulfill({contentType: 'application/json', body: '{"type":"FeatureCollection","features":[]}'}) }
}

/** Records the unrelated layer order and camera that targeted invalidation must preserve. */
async function readContext(page: Page) {
  return page.evaluate(() => {
    const map = (window as TestWindow).__SARTRACKER_MAP__
    const center = map.getCenter()
    return {center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(),
      overlays: map.getStyle().layers.filter(layer => layer.id !== 'official_discovery_topo-layer').map(layer => layer.id),
      pendingSource: map.getStyle().sources['war11-unrelated-pending'],
    }
  })
}

for (const pendingOverlay of [false, true]) {
  test(`external removal clears resident raster and reimport recovers (${pendingOverlay ? 'pending overlay' : 'loaded'})`, async ({page}, testInfo) => {
    await openSyntheticMap(page, 'b')
    const release = pendingOverlay ? await addPendingOverlay(page) : async () => undefined
    const before = await readContext(page)
    try {
      await page.evaluate(() => (window as TestWindow).__WAR11_MUTATE_RASTER__('missing', true))
      await expect(page.getByTestId('field-readiness-checklist')).not.toContainText('Field ready')
      await expect(page.getByTestId('basemap-offline-readiness')).toContainText('missing')
      await expectPalette(page, 'none')
      expect(await readContext(page)).toEqual(before)
      await page.screenshot({path: testInfo.outputPath('removed-raster.png'), fullPage: true})
      await page.evaluate(() => (window as TestWindow).__WAR11_MUTATE_RASTER__('a', true))
      await expectPalette(page, 'a')
      await expect(page.getByTestId('field-readiness-checklist')).not.toContainText('Field ready')
      await page.getByTestId('check-offline-map-coverage').click()
      await expect(page.getByTestId('field-readiness-checklist')).toContainText('Field ready')
      expect(await readContext(page)).toEqual(before)
      await page.screenshot({path: testInfo.outputPath('reimported-raster.png'), fullPage: true})
    } finally {
      await page.screenshot({path: testInfo.outputPath('final-raster.png'), fullPage: true})
      await release()
      await page.evaluate(() => (window as TestWindow).__WAR11_GPU__.cleanup())
    }
  })
}

test('same-path A to B replacement clears old pixels while unrelated overlay is pending', async ({page}, testInfo) => {
  await openSyntheticMap(page, 'a')
  const release = await addPendingOverlay(page)
  const before = await readContext(page)
  try {
    await page.evaluate(() => (window as TestWindow).__WAR11_MUTATE_RASTER__('b', true))
    await expect(page.getByTestId('field-readiness-checklist')).not.toContainText('Field ready')
    await expectPalette(page, 'b')
    expect(await readContext(page)).toEqual(before)
    await page.getByTestId('check-offline-map-coverage').click()
    await expect(page.getByTestId('field-readiness-checklist')).toContainText('Field ready')
  } finally {
    await page.screenshot({path: testInfo.outputPath('replacement-raster.png'), fullPage: true})
    await release()
    await page.evaluate(() => (window as TestWindow).__WAR11_GPU__.cleanup())
  }
})
