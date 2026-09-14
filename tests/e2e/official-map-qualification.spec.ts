import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'
import { DEFAULT_APP_SETTINGS } from '../../src/features/settings/settings-types'

const require = createRequire(import.meta.url)
const { NO_COVERAGE_TILE_BASE64 } = require('../../electron/official-map-no-coverage.cjs') as {NO_COVERAGE_TILE_BASE64: string}
const mapPackage = {id: 'synthetic-official-map', sourceType: 'mbtiles', mapId: 'official_discovery_topo',
  packagePath: '/synthetic/test.mbtiles', status: 'ready', bounds: [-11, 50, -5, 56], minZoom: 0, maxZoom: 19,
  tileCount: 1, tileFormat: 'png', createdAt: '2026-09-13T10:00:00.000Z', verifiedAt: '2026-09-13T10:00:00.000Z',
  message: 'Synthetic package validation', attestation: {version: 1, schemaVersion: 1,
    decoderPolicy: 'native-raster-256-or-512-opaque-v1', sha256: 'a'.repeat(64), identity: 'synthetic'},
}

test('official map readiness follows checked tiles, movement, and package removal', async ({page}) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, route => route.fulfill({
    status: 200, contentType: 'image/png', body: Buffer.from(NO_COVERAGE_TILE_BASE64, 'base64'),
  }))
  await page.goto('/?missionHarness=1')
  await expect(page.getByTestId('app-title')).toContainText('SAR Tracker')
  await expect(page.locator('canvas').first()).toBeVisible()
  await page.evaluate(({defaults, mapPackage, png}) => {
    const settings = {...defaults, officialMaps: {...defaults.officialMaps, packages: [mapPackage]}}
    let notifyChanged: () => void = () => undefined
    const bridge = {
      loadAppSettings: async () => structuredClone(settings),
      fetchOfficialMapTile: async () => ({contentType: 'image/png', bytesBase64: png}),
      checkOfficialMapView: async (request: {mapId: string; bounds: {west: number; south: number; east: number; north: number}; zoom: number}) => ({
        ...request, status: settings.officialMaps.packages[0]!.status === 'ready' ? 'complete' : 'missing',
        totalTiles: 4, usableTiles: settings.officialMaps.packages[0]!.status === 'ready' ? 4 : 0,
        checkedAt: new Date().toISOString(),
        packageIdentities: settings.officialMaps.packages[0]!.status === 'ready'
          ? [{id: mapPackage.id, sha256: mapPackage.attestation.sha256}] : [],
        message: settings.officialMaps.packages[0]!.status === 'ready'
          ? 'Synthetic native check: every required tile usable.' : 'Synthetic native check: package missing.',
      }),
      onOfficialMapPackagesChanged: (callback: () => void) => { notifyChanged = callback; return () => { notifyChanged = () => undefined } },
    }
    Object.defineProperty(window, 'sartrackerElectron', {configurable: true, value: bridge})
    Object.defineProperty(window, '__WAR11_REMOVE_PACKAGE__', {configurable: true, value: () => {
      settings.officialMaps.packages[0]!.status = 'missing'
      notifyChanged()
    }})
    Object.defineProperty(window, '__WAR11_RESTORE_PACKAGE__', {configurable: true, value: () => {
      settings.officialMaps.packages[0]!.status = 'ready'
      notifyChanged()
    }})
    window.dispatchEvent(new Event('sartracker:settings-updated'))
  }, {defaults: DEFAULT_APP_SETTINGS, mapPackage, png: NO_COVERAGE_TILE_BASE64})
  await page.getByTestId('basemap-menu-toggle').click()
  await page.getByTestId('basemap-btn-official_discovery_topo').click()
  await page.getByTestId('basemap-menu-toggle').click()
  await expect(page.getByTestId('basemap-offline-readiness')).toContainText('Official package validated')
  await expect(page.getByTestId('field-readiness-checklist')).not.toContainText('Field ready')
  await page.getByTestId('check-offline-map-coverage').click()
  await expect(page.getByTestId('basemap-offline-coverage')).toContainText('Current view tiles verified')
  await expect(page.getByTestId('field-readiness-checklist')).toContainText('Field ready')
  await page.screenshot({path: 'tmp/war-11/browser-view-checked.png', fullPage: true})
  await page.evaluate(() => window.dispatchEvent(new Event('sartracker:official-map-tile-failed')))
  await expect(page.getByTestId('basemap-offline-coverage')).toContainText('Current view not checked')
  await expect(page.getByTestId('field-readiness-checklist')).not.toContainText('Field ready')
  await page.getByTestId('check-offline-map-coverage').click()
  await expect(page.getByTestId('field-readiness-checklist')).toContainText('Field ready')
  await page.evaluate(() => {
    const map = (window as unknown as {__SARTRACKER_MAP__: {zoomTo: (zoom: number, options: {duration: number}) => void; getZoom: () => number}}).__SARTRACKER_MAP__
    map.zoomTo(map.getZoom() + 1, {duration: 0})
  })
  await expect(page.getByTestId('field-readiness-checklist')).not.toContainText('Field ready')
  await page.getByTestId('check-offline-map-coverage').click()
  await expect(page.getByTestId('field-readiness-checklist')).toContainText('Field ready')
  await page.evaluate(() => (window as unknown as {__WAR11_REMOVE_PACKAGE__: () => void}).__WAR11_REMOVE_PACKAGE__())
  await expect(page.getByTestId('field-readiness-checklist')).not.toContainText('Field ready')
  await expect(page.getByTestId('basemap-offline-readiness')).toContainText('missing')
  await page.screenshot({path: 'tmp/war-11/browser-package-removed.png', fullPage: true})
  await page.getByTestId('check-offline-map-coverage').click()
  await expect(page.getByTestId('basemap-offline-coverage')).toContainText('Official offline coverage incomplete')
  await page.evaluate(() => window.dispatchEvent(new Event('sartracker:official-map-tile-failed')))
  await expect(page.getByTestId('basemap-offline-coverage')).toContainText('Official offline coverage incomplete')
  await expect(page.getByTestId('field-readiness-checklist')).not.toContainText('Field ready')
  await page.screenshot({path: 'tmp/war-11/browser-negative-result-retained.png', fullPage: true})
  await page.evaluate(() => (window as unknown as {__WAR11_RESTORE_PACKAGE__: () => void}).__WAR11_RESTORE_PACKAGE__())
  await expect(page.getByTestId('basemap-offline-coverage')).toContainText('Current view not checked')
  await expect(page.getByTestId('field-readiness-checklist')).not.toContainText('Field ready')
  await page.getByTestId('check-offline-map-coverage').click()
  await expect(page.getByTestId('basemap-offline-coverage')).toContainText('Current view tiles verified')
  await expect(page.getByTestId('field-readiness-checklist')).toContainText('Field ready')
})
