import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'
import { DEFAULT_APP_SETTINGS } from '../../src/features/settings/settings-types'

const require = createRequire(import.meta.url)
const { NO_COVERAGE_TILE_BASE64 } = require('../../electron/official-map-no-coverage.cjs') as {
  NO_COVERAGE_TILE_BASE64: string
}

const syntheticDiscoveryPackage = {
  id: 'synthetic-official-map',
  sourceType: 'mbtiles',
  mapId: 'official_discovery_topo',
  packagePath: '/synthetic/test.mbtiles',
  status: 'ready',
  bounds: [-11, 50, -5, 56],
  minZoom: 0,
  maxZoom: 19,
  tileCount: 1,
  tileFormat: 'png',
  createdAt: '2026-09-13T10:00:00.000Z',
  verifiedAt: '2026-09-13T10:00:00.000Z',
  message: 'Synthetic package validation',
  attestation: {
    version: 1,
    schemaVersion: 1,
    decoderPolicy: 'native-raster-256-or-512-opaque-v1',
    sha256: 'a'.repeat(64),
    identity: 'synthetic',
  },
}

/** Irish camera positions (Kerry, Wicklow, Co. Down, Donegal) at search zooms. */
const CAMERAS = [
  { lng: -9.74, lat: 51.99, zoom: 13 },
  { lng: -6.3, lat: 53.0, zoom: 15 },
  { lng: -5.5, lat: 54.4, zoom: 11.5 },
  { lng: -7.4, lat: 55.3, zoom: 16.5 },
] as const

type ScaleMeasurement = {
  readonly label: string
  readonly labelledM: number
  readonly measuredM: number
}

test.describe('map scale bar (DON-339 / M-01)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(NO_COVERAGE_TILE_BASE64, 'base64'),
      }),
    )
    await page.goto('/?missionHarness=1')
    await expect(page.getByTestId('app-title')).toContainText('SAR Tracker')
    await expect(page.locator('canvas').first()).toBeVisible()
  })

  test('labels the ground distance the bar covers on OpenTopoMap', async ({ page }) => {
    await selectBasemap(page, 'opentopomap')
    await expectScaleMatchesMapLibre(page)
  })

  test('labels the ground distance the bar covers on Discovery Topo', async ({ page }) => {
    await page.evaluate(
      ({ defaults, mapPackage, png }) => {
        const settings = { ...defaults, officialMaps: { ...defaults.officialMaps, packages: [mapPackage] } }
        const bridge = {
          loadAppSettings: async () => structuredClone(settings),
          fetchOfficialMapTile: async () => ({ contentType: 'image/png', bytesBase64: png }),
          checkOfficialMapView: async (request: Record<string, unknown>) => ({
            ...request,
            status: 'complete',
            totalTiles: 4,
            usableTiles: 4,
            checkedAt: new Date().toISOString(),
            packageIdentities: [{ id: mapPackage.id, sha256: mapPackage.attestation.sha256 }],
            message: 'Synthetic native check: every required tile usable.',
          }),
          onOfficialMapPackagesChanged: () => () => undefined,
        }
        Object.defineProperty(window, 'sartrackerElectron', { configurable: true, value: bridge })
        window.dispatchEvent(new Event('sartracker:settings-updated'))
      },
      { defaults: DEFAULT_APP_SETTINGS, mapPackage: syntheticDiscoveryPackage, png: NO_COVERAGE_TILE_BASE64 },
    )
    await selectBasemap(page, 'official_discovery_topo')
    await expect(page.getByTestId('basemap-offline-readiness')).toContainText('Official package validated')
    await expectScaleMatchesMapLibre(page)
  })
})

/** Switches the basemap through the operator menu. */
async function selectBasemap(page: Page, basemapId: string): Promise<void> {
  await page.getByTestId('basemap-menu-toggle').click()
  await page.getByTestId(`basemap-btn-${basemapId}`).click()
  await page.getByTestId('basemap-menu-toggle').click()
}

/**
 * Measures, at each camera, the ground distance between the two ends of the drawn bar
 * using MapLibre's own unproject at the map centre, and compares it with the label.
 */
async function expectScaleMatchesMapLibre(page: Page): Promise<void> {
  for (const camera of CAMERAS) {
    await page.evaluate((target) => {
      const map = (window as Window & { __SARTRACKER_MAP__?: import('maplibre-gl').Map }).__SARTRACKER_MAP__
      if (map === undefined) {
        throw new Error('Map instance is not exposed.')
      }
      map.jumpTo({ center: [target.lng, target.lat], zoom: target.zoom, bearing: 0, pitch: 0 })
    }, camera)
    await page.waitForTimeout(100)

    const measurement = await page.evaluate((): ScaleMeasurement => {
      const map = (window as Window & { __SARTRACKER_MAP__?: import('maplibre-gl').Map }).__SARTRACKER_MAP__
      const bar = document.querySelector('[data-testid="map-scale-bar"]')
      const labelElement = document.querySelector('[data-testid="map-scale-label"]')
      if (map === undefined || !(bar instanceof HTMLElement) || !(labelElement instanceof HTMLElement)) {
        throw new Error('Scale bar or map is missing.')
      }
      const label = labelElement.textContent?.trim() ?? ''
      const match = /^([\d.]+)\s*(m|km)$/.exec(label)
      if (match === null) {
        throw new Error(`Unexpected scale label "${label}".`)
      }
      const labelledM = Number(match[1]) * (match[2] === 'km' ? 1000 : 1)
      const widthPx = bar.getBoundingClientRect().width
      const canvas = map.getCanvas()
      const y = canvas.clientHeight / 2
      const x = canvas.clientWidth / 2
      const west = map.unproject([x, y])
      const east = map.unproject([x + widthPx, y])
      return { label, labelledM, measuredM: west.distanceTo(east) }
    })

    const relativeError = Math.abs(measurement.measuredM - measurement.labelledM) / measurement.labelledM
    expect(
      relativeError,
      `${measurement.label} bar at ${camera.lat},${camera.lng} z${camera.zoom} covers ${measurement.measuredM.toFixed(1)} m`,
    ).toBeLessThan(0.03)
  }
}
